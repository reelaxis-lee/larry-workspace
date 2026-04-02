/**
 * inbox.js — Read LinkedIn inbox and respond to positive/interested messages
 *
 * Flow per session:
 *   1. Open LinkedIn messaging — process unread threads first, then recent
 *   2. For each thread: read context, classify intent via Claude
 *   3. positive/interested → generate + send a reply, flag as hot lead
 *   4. neutral/question   → generate + send a reply
 *   5. negative           → log and skip (do not reply)
 *   6. already replied    → skip
 *   7. Check Sales Navigator inbox (same logic, read-only for now)
 *
 * Limits: max 10 threads read, max 8 replies sent per session
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { classifyInboxMessage, generateInboxReply } = require('../utils/messenger');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_THREADS = 10;
const MAX_REPLIES = 8;

/**
 * Load names we've already replied to from HISTORY.md (prevents double-replies)
 */
function loadRepliedNames(nickname) {
  const historyPath = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/HISTORY.md`);
  if (!fs.existsSync(historyPath)) return new Set();
  const content = fs.readFileSync(historyPath, 'utf8');
  const names = new Set();
  const re = /Inbox reply → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

async function runInboxCheck(page, config, results) {
  console.log(`[${config.nickname}] Inbox check — reading threads`);

  const alreadyReplied = loadRepliedNames(config.nickname);
  let threadsRead = 0;
  let repliesSent = 0;
  const hotLeads = [];

  try {
    // ── LinkedIn Messaging ─────────────────────────────────────────
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
    await sleep(randomBetween(3000, 4500));

    const items = page.locator('.msg-conversation-listitem');
    const itemCount = await items.count().catch(() => 0);
    if (!itemCount) {
      console.log(`[${config.nickname}] No inbox items found`);
      return;
    }

    // Collect thread info before clicking (clicking changes DOM)
    const threads = [];
    for (let i = 0; i < Math.min(itemCount, MAX_THREADS + 2); i++) {
      const item = items.nth(i);
      // Extract name from dedicated name element (avoids picking up "Status is online" etc.)
      const nameEl = item.locator('.msg-conversation-card__participant-names, .msg-conversation-listitem__participant-names').first();
      const name = (await nameEl.textContent().catch(() => '')).trim() ||
                   (await item.innerText().catch(() => '')).split('\n').find(l => l.trim().length > 2 && !l.includes('Status is')) || '';
      if (!name || name.length < 2) continue;

      const hasUnread = await item.locator('.notification-badge--show').count().catch(() => 0) > 0;
      const preview = (await item.innerText().catch(() => '')).trim().substring(0, 120);

      threads.push({ index: i, name, hasUnread, text: preview });
    }

    // Prioritize: unread first, then recent
    threads.sort((a, b) => (b.hasUnread ? 1 : 0) - (a.hasUnread ? 1 : 0));

    for (const thread of threads.slice(0, MAX_THREADS)) {
      if (repliesSent >= MAX_REPLIES) break;

      const nameKey = thread.name.toLowerCase();
      if (alreadyReplied.has(nameKey)) {
        console.log(`[${config.nickname}] ${thread.name} — already replied this week, skipping`);
        continue;
      }

      // Click the thread
      await items.nth(thread.index).click({ timeout: 5000 }).catch(() => null);
      await sleep(randomBetween(1800, 2800));

      // Read the conversation
      const convo = await page.evaluate((profileName) => {
        const groups = [...document.querySelectorAll('.msg-s-message-group')];
        const messages = groups.flatMap(group => {
          const sender = group.querySelector('.msg-s-message-group__name')?.textContent?.trim() || 'Unknown';
          const bodies = [...group.querySelectorAll('.msg-s-event-listitem__body')];
          return bodies.map(b => ({ sender, text: b.textContent?.trim() }));
        }).filter(m => m.text);

        // Last message sender — is it them or us?
        const lastMsg = messages[messages.length - 1];
        const theirMessages = messages.filter(m => m.sender !== profileName);
        const lastTheirMsg = theirMessages[theirMessages.length - 1];

        return {
          messages: messages.slice(-6), // last 6 messages for context
          lastSender: lastMsg?.sender,
          lastTheirMessage: lastTheirMsg?.text,
          totalMessages: messages.length,
        };
      }, config.name);

      threadsRead++;

      // Skip if we sent the last message (waiting on their reply)
      if (convo.lastSender === config.name || !convo.lastTheirMessage) {
        console.log(`[${config.nickname}] ${thread.name} — we sent last, no new reply`);
        continue;
      }

      console.log(`[${config.nickname}] ${thread.name} — last msg: "${convo.lastTheirMessage.substring(0, 80)}"`);

      // Classify via Claude
      const classification = await classifyInboxMessage(config, {
        contactName: thread.name,
        messages: convo.messages,
        lastMessage: convo.lastTheirMessage,
      }).catch(() => ({ intent: 'skip', reason: 'classification failed' }));

      console.log(`[${config.nickname}] ${thread.name} — intent: ${classification.intent}`);

      if (classification.intent === 'negative' || classification.intent === 'skip') {
        if (classification.intent === 'negative') {
          results.flags.push(`${thread.name} replied negatively — review`);
        }
        continue;
      }

      // Positive or neutral — generate + send a reply
      const reply = await generateInboxReply(config, {
        contactName: thread.name,
        messages: convo.messages,
        lastMessage: convo.lastTheirMessage,
        intent: classification.intent,
      }).catch(() => null);

      if (!reply) {
        console.log(`[${config.nickname}] ${thread.name} — reply generation failed`);
        continue;
      }

      // Type reply into the message box
      const replyBox = page.locator('.msg-form__contenteditable').first();
      if (!await replyBox.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`[${config.nickname}] ${thread.name} — reply box not visible`);
        continue;
      }

      await replyBox.click();
      await sleep(randomBetween(500, 900));
      await page.keyboard.type(reply, { delay: randomBetween(30, 60) });
      await sleep(randomBetween(1000, 1800));

      // Send button becomes enabled after content is typed
      const sendBtn = page.locator('.msg-form__send-button').first();
      let sendEnabled = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        sendEnabled = await sendBtn.isEnabled({ timeout: 500 }).catch(() => false);
        if (sendEnabled) break;
        await sleep(300);
      }

      if (!sendEnabled) {
        console.log(`[${config.nickname}] ${thread.name} — send button never enabled`);
        await page.keyboard.press('Escape').catch(() => {});
        continue;
      }

      await sendBtn.click({ timeout: 5000 });
      repliesSent++;
      alreadyReplied.add(nameKey);

      if (classification.intent === 'positive') {
        hotLeads.push({ name: thread.name, message: convo.lastTheirMessage.substring(0, 80) });
        results.positiveReplies = results.positiveReplies || [];
        results.positiveReplies.push(thread.name);
        console.log(`[${config.nickname}] 🔥 Hot lead replied: ${thread.name} (${repliesSent}/${MAX_REPLIES})`);
      } else {
        console.log(`[${config.nickname}] ✅ Replied to ${thread.name} (${repliesSent}/${MAX_REPLIES})`);
      }

      results.messagessent = (results.messagessent || 0) + 1;
      await delays.betweenMessages();
    }

    console.log(`[${config.nickname}] Inbox done — read: ${threadsRead}, replied: ${repliesSent}, hot leads: ${hotLeads.length}`);

    // Flag hot leads for Slack attention
    if (hotLeads.length > 0) {
      results.flags.push(`🔥 ${hotLeads.length} hot lead(s): ${hotLeads.map(l => l.name).join(', ')}`);
      results.topReplies = (results.topReplies || []).concat(hotLeads.map(l => ({ name: l.name, title: '', company: '' })));
    }

  } catch (err) {
    console.log(`[${config.nickname}] Inbox error: ${err.message.substring(0, 80)}`);
  }
}

module.exports = { runInboxCheck };
