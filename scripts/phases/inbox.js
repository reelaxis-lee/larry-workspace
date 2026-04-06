/**
 * inbox.js — Read LinkedIn inbox and respond to positive/interested messages
 *
 * Flow per session:
 *   1. Open LinkedIn messaging — get thread URLs from the list
 *   2. Navigate to each thread directly (ensures full page load + all messages)
 *   3. Scroll to bottom, read last 8 messages
 *   4. Classify intent via Claude: positive / neutral / negative / skip
 *   5. positive/neutral → generate + send reply, flag hot leads to Slack
 *   6. negative → log, do not reply
 *
 * Limits: max 10 threads read, max 8 replies sent per session
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { classifyInboxMessage, generateInboxReply } = require('../utils/messenger');
const { alertError } = require('../utils/report');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_THREADS = 10;
const MAX_REPLIES = 8;

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
    // ── Step 1: Load messaging page + collect thread URLs ─────────
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
    await sleep(randomBetween(3000, 4000));

    const items = page.locator('.msg-conversation-listitem');
    const itemCount = await items.count().catch(() => 0);
    if (!itemCount) {
      console.log(`[${config.nickname}] No inbox items found`);
      return;
    }

    // Collect thread info: name + click to get thread URL
    const threads = [];
    for (let i = 0; i < Math.min(itemCount, MAX_THREADS + 3) && threads.length < MAX_THREADS; i++) {
      const item = items.nth(i);

      // Get name from dedicated element
      const nameEl = item.locator('.msg-conversation-card__participant-names, .msg-conversation-listitem__participant-names').first();
      const name = (await nameEl.textContent({ timeout: 1000 }).catch(() => '')).trim();
      if (!name || name.length < 2) continue;

      // Check for unread badge
      const hasUnread = await item.locator('.notification-badge--show').count().catch(() => 0) > 0;

      // Click to get thread URL
      await item.click({ timeout: 5000 }).catch(() => null);
      await page.waitForURL('**/messaging/thread/**', { timeout: 5000 }).catch(() => null);
      const threadUrl = page.url();

      if (!threadUrl.includes('/messaging/thread/')) {
        // Navigate back to list
        await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1500);
        continue;
      }

      threads.push({ name, hasUnread, threadUrl });

      // Go back to list for next item
      await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(randomBetween(1200, 1800));
    }

    console.log(`[${config.nickname}] Found ${threads.length} threads to process`);

    // Prioritize unread threads first
    threads.sort((a, b) => (b.hasUnread ? 1 : 0) - (a.hasUnread ? 1 : 0));

    // ── Step 2: Process each thread ───────────────────────────────
    for (const thread of threads) {
      if (repliesSent >= MAX_REPLIES) break;
      if (page.isClosed()) break; // bail if browser context died

      const nameKey = thread.name.toLowerCase();
      if (alreadyReplied.has(nameKey)) {
        console.log(`[${config.nickname}] ${thread.name} — already replied, skipping`);
        continue;
      }

      // Navigate directly to thread URL
      await page.goto(thread.threadUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomBetween(2000, 3000));

      // Wait for messages to appear
      await page.locator('p.msg-s-event-listitem__body').first().waitFor({ timeout: 8000 }).catch(() => null);

      // Scroll to bottom to load latest messages
      await page.evaluate(() => {
        const list = document.querySelector('.msg-s-message-list-content');
        if (list) list.scrollTop = list.scrollHeight;
      }).catch(() => null);
      await sleep(800);
      await page.evaluate(() => {
        const list = document.querySelector('.msg-s-message-list-content');
        if (list) list.scrollTop = list.scrollHeight;
      }).catch(() => null);
      await sleep(500);

      // Read messages
      const convo = await page.evaluate((profileName) => {
        // Each .msg-s-event-listitem = one message group
        // Sender: span.msg-s-message-group__profile-link
        // Body:   p.msg-s-event-listitem__body (may be multiple per group)
        const items = [...document.querySelectorAll('.msg-s-event-listitem')];
        const messages = items.flatMap(item => {
          const senderEl = item.querySelector('.msg-s-message-group__profile-link');
          const sender = senderEl?.textContent?.trim() || '';
          const bodies = [...item.querySelectorAll('p.msg-s-event-listitem__body')];
          return bodies.map(b => ({
            sender: sender || 'Unknown',
            text: b.textContent?.trim(),
          })).filter(m => m.text && m.text.length > 0);
        });

        const lastMsg = messages[messages.length - 1];
        const theirMessages = messages.filter(m => m.sender !== profileName);
        const lastTheirMsg = theirMessages[theirMessages.length - 1];

        return {
          messages: messages.slice(-8),
          lastSender: lastMsg?.sender,
          lastTheirMessage: lastTheirMsg?.text,
          totalMessages: messages.length,
          debug: messages.slice(-3).map(m => `${m.sender}: ${m.text?.substring(0, 40)}`),
        };
      }, config.name);

      threadsRead++;
      console.log(`[${config.nickname}] ${thread.name} — ${convo.totalMessages} msgs, last: "${convo.lastSender}" | ${JSON.stringify(convo.debug)}`);

      // Skip if we sent the last message
      if (!convo.lastTheirMessage || convo.lastSender === config.name) {
        console.log(`[${config.nickname}] ${thread.name} — we sent last, skipping`);
        continue;
      }

      // Classify intent via Claude
      const classification = await classifyInboxMessage(config, {
        contactName: thread.name,
        messages: convo.messages,
        lastMessage: convo.lastTheirMessage,
      }).catch(() => ({ intent: 'skip', reason: 'classification failed' }));

      console.log(`[${config.nickname}] ${thread.name} — intent: ${classification.intent} (${classification.reason})`);

      if (classification.intent === 'negative') {
        results.flags.push(`${thread.name} replied negatively — review inbox`);
        continue;
      }
      if (classification.intent === 'skip') continue;

      // Generate + send reply
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

      const replyBox = page.locator('.msg-form__contenteditable').first();
      if (!await replyBox.isVisible({ timeout: 4000 }).catch(() => false)) {
        console.log(`[${config.nickname}] ${thread.name} — reply box not visible`);
        continue;
      }

      // Focus + type — contenteditable needs click, then page-level keyboard events
      await replyBox.click();
      await sleep(randomBetween(400, 700));
      await replyBox.focus();
      await sleep(200);
      // Select all + delete any placeholder content, then type
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await sleep(200);
      await page.keyboard.type(reply, { delay: randomBetween(30, 60) });
      // Dispatch input event to trigger Ember.js change detection
      await page.evaluate(() => {
        const el = document.querySelector('.msg-form__contenteditable');
        if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
      }).catch(() => null);
      await sleep(randomBetween(1000, 1800));

      const sendBtn = page.locator('.msg-form__send-button').first();
      let sendEnabled = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        sendEnabled = await sendBtn.isEnabled({ timeout: 500 }).catch(() => false);
        if (sendEnabled) break;
        await sleep(400);
      }

      if (!sendEnabled) {
        console.log(`[${config.nickname}] ${thread.name} — send button never enabled, pressing Escape`);
        await page.keyboard.press('Escape').catch(() => null);
        continue;
      }

      await sendBtn.click({ timeout: 5000 });
      repliesSent++;
      alreadyReplied.add(nameKey);
      results.messagessent = (results.messagessent || 0) + 1;

      // Track replied names for HISTORY.md dedup log
      results.inboxRepliesLog = results.inboxRepliesLog || [];
      results.inboxRepliesLog.push(thread.name);

      if (classification.intent === 'positive') {
        hotLeads.push({ name: thread.name, message: convo.lastTheirMessage.substring(0, 80) });
        results.positiveReplies = (results.positiveReplies || []);
        results.positiveReplies.push(thread.name);
        console.log(`[${config.nickname}] 🔥 Hot lead replied: ${thread.name} (${repliesSent}/${MAX_REPLIES})`);
      } else {
        console.log(`[${config.nickname}] ✅ Replied to ${thread.name} (${repliesSent}/${MAX_REPLIES})`);
      }

      await delays.betweenMessages();
    }

    console.log(`[${config.nickname}] Inbox done — read: ${threadsRead}, replied: ${repliesSent}, hot leads: ${hotLeads.length}`);

    if (hotLeads.length > 0) {
      results.flags.push(`🔥 ${hotLeads.length} hot lead(s): ${hotLeads.map(l => l.name).join(', ')}`);
      results.topReplies = (results.topReplies || []).concat(
        hotLeads.map(l => ({ name: l.name, title: '', company: '' }))
      );
    }

  } catch (err) {
    console.log(`[${config.nickname}] Inbox error: ${err.message.substring(0, 100)}`);
    await alertError(config, 'inbox', 'reading/responding to inbox', err.message.substring(0, 200), 'phase aborted');
  }
}

module.exports = { runInboxCheck };
