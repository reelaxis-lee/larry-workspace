/**
 * test-run.js — Manually triggered mini-session (one action per phase)
 *
 * Usage: node scripts/test-run.js <nickname> [replyChannelId]
 * Example: node scripts/test-run.js darren D0AL85W960J
 *
 * Bypasses hasRunToday(). All sends go through messenger.js with GLOBAL.md rules.
 * All sent actions are written to HISTORY.md to prevent duplicates in future runs.
 * Does NOT update STATUS.md last run summary.
 *
 * Phases (1 action each):
 *   1. LinkedIn inbox reply (linkedin.com/messaging)
 *   2. Sales Nav inbox reply (linkedin.com/sales/inbox)
 *   3. Follow-up to an accepted connection (3+ days old)
 *   4. InMail to an Open Profile from saved search
 *   5. Connection request to a 2nd degree lead from saved search
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const http = require('http');
const os   = require('os');

const { loadAccountConfig }                         = require('./utils/config-loader');
const { launchProfile, verifyLinkedInSession,
        sleep, randomBetween }                      = require('./utils/browser');
const { classifyInboxMessage, generateInboxReply,
        generateFollowUp, generateConnectionRequest,
        generateInMail }                            = require('./utils/messenger');

const WORKSPACE   = path.resolve(__dirname, '..');
const LOCK_FILE   = path.join(WORKSPACE, 'logs', 'scheduler.lock');
const LOGS_DIR    = path.join(WORKSPACE, 'logs');

const nickname      = process.argv[2];
const replyChannel  = process.argv[3] || 'D0AL85W960J'; // Darren's DM with Larry

if (!nickname) {
  console.error('Usage: node scripts/test-run.js <nickname> [replyChannelId]');
  process.exit(1);
}

// ─── Profile-specific test lock ──────────────────────────────────────────────
const TEST_LOCK = path.join(LOGS_DIR, `${nickname}-test.lock`);

// ─── Slack helper ─────────────────────────────────────────────────────────────
function postSlack(message, channel) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || 'larry-oc-gateway-2026-secure';
  const port  = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789');
  const body  = JSON.stringify({
    tool: 'message',
    args: { action: 'send', target: channel || replyChannel, message },
  });
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port,
      path: '/tools/invoke', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', e => { console.error('[test-run] Slack error:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

// ─── HISTORY.md helpers ───────────────────────────────────────────────────────
function historyPath(nick) {
  return path.resolve(WORKSPACE, 'profiles', nick, 'HISTORY.md');
}

function appendToHistory(nick, line) {
  const p = historyPath(nick);
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf8');
  const updated = content.replace('## Log', `## Log\n${line}`);
  fs.writeFileSync(p, updated);
}

function loadRepliedNames(nick) {
  const p = historyPath(nick);
  if (!fs.existsSync(p)) return new Set();
  const content = fs.readFileSync(p, 'utf8');
  const names = new Set();
  const re = /Inbox reply → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

function loadFollowedUpNames(nick) {
  const p = historyPath(nick);
  if (!fs.existsSync(p)) return new Set();
  const content = fs.readFileSync(p, 'utf8');
  const names = new Set();
  const re = /Follow-up → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

function loadInMailedNames(nick) {
  const p = historyPath(nick);
  if (!fs.existsSync(p)) return new Set();
  const content = fs.readFileSync(p, 'utf8');
  const names = new Set();
  const re = /InMail → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

function loadConnectedNames(nick) {
  const p = historyPath(nick);
  if (!fs.existsSync(p)) return new Set();
  const content = fs.readFileSync(p, 'utf8');
  const names = new Set();
  const re = /Connect → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

// ─── Result shape ─────────────────────────────────────────────────────────────
function skipped(reason)           { return { status: 'Skipped', reason, name: '—', title: '', company: '', messageSent: '' }; }
function sent(data)                { return { status: 'Sent', reason: '', ...data }; }
function errored(reason)           { return { status: 'Error', reason, name: '—', title: '', company: '', messageSent: '' }; }

// ─── Phase 1: LinkedIn inbox reply ───────────────────────────────────────────
async function phase1LinkedInInbox(page, config) {
  setProgress(1, 'Navigating to LinkedIn messaging…');
  try {
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(randomBetween(3000, 4000));
    setProgress(1, 'Reading inbox threads…');

    const items = page.locator('.msg-conversation-listitem');
    const itemCount = await items.count().catch(() => 0);
    if (!itemCount) return skipped('No inbox threads found');

    const alreadyReplied = loadRepliedNames(config.nickname);

    for (let i = 0; i < Math.min(itemCount, 10); i++) {
      try {
        const item = items.nth(i);
        const nameEl = item.locator('.msg-conversation-listitem__participant-names, .t-16, .t-bold').first();
        const name = (await nameEl.textContent({ timeout: 2000 }).catch(() => '')).trim();
        if (!name || alreadyReplied.has(name.toLowerCase())) continue;

        // Click thread to open it
        await item.click();
        await sleep(randomBetween(2000, 3000));

        // Read last 8 messages
        const msgEls = await page.locator('.msg-s-message-list__event').all();
        const lastMsgs = msgEls.slice(-8);
        const conversation = [];
        for (const el of lastMsgs) {
          const text  = (await el.locator('.msg-s-event-listitem__body').textContent({ timeout: 1000 }).catch(() => '')).trim();
          const isMine = await el.locator('.msg-s-message-group--outgoing').count().then(c => c > 0).catch(() => false);
          if (text) conversation.push({ sender: isMine ? 'me' : 'them', text });
        }

        if (!conversation.length) continue;

        // Must end with "them"
        const last = conversation[conversation.length - 1];
        if (last.sender !== 'them') continue;

        // Classify
        const messages = conversation.map(m => ({ sender: m.sender === 'me' ? 'Me' : name, text: m.text }));
        const classification = await classifyInboxMessage(config, { contactName: name, messages, lastMessage: last.text });
        if (!['positive', 'neutral'].includes(classification.intent)) continue;

        // Generate reply
        const reply = await generateInboxReply(config, { contactName: name, messages, lastMessage: last.text, intent: classification.intent });

        // Send reply
        const editor = page.locator('.msg-form__contenteditable[contenteditable="true"]').first();
        if (!await editor.isVisible({ timeout: 3000 }).catch(() => false)) continue;
        await editor.click();
        await sleep(500);
        await page.keyboard.type(reply, { delay: randomBetween(30, 60) });
        await sleep(randomBetween(800, 1500));

        // Submit
        const sendBtn = page.locator('button.msg-form__send-button, button[type="submit"].msg-form__send-btn').first();
        if (!await sendBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
          // Try keyboard submit
          await page.keyboard.press('Enter');
        } else {
          await sendBtn.click();
        }
        await sleep(randomBetween(1500, 2500));

        // Log to HISTORY.md
        appendToHistory(config.nickname, `- Inbox reply → ${name}`);

        return sent({ name, title: '', company: '', messageSent: reply });

      } catch (threadErr) {
        console.log(`[test-run] LinkedIn inbox thread error: ${threadErr.message.substring(0, 80)}`);
        continue;
      }
    }

    return skipped('No positive/neutral threads found in first 10');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

// ─── Phase 2: Sales Nav inbox reply ──────────────────────────────────────────
async function phase2SalesNavInbox(page, config) {
  setProgress(2, 'Navigating to Sales Nav inbox…');
  try {
    await page.goto('https://www.linkedin.com/sales/inbox', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(4000, 6000));
    setProgress(2, 'Reading Sales Nav inbox threads…');

    // Verified selector: .conversation-list-item (20 found in live DOM probe 2026-04-06)
    const threadCount = await page.locator('.conversation-list-item').count().catch(() => 0);
    if (!threadCount) return skipped('No Sales Nav inbox threads found');

    const alreadyReplied = loadRepliedNames(config.nickname);

    for (let i = 0; i < Math.min(threadCount, 10); i++) {
      try {
        const thread = page.locator('.conversation-list-item').nth(i);

        // Get contact name from the thread list item before clicking
        const nameEl = thread.locator('span[data-anonymize="person-name"]').first();
        const name = (await nameEl.textContent({ timeout: 2000 }).catch(() => '')).trim();
        if (!name || alreadyReplied.has(name.toLowerCase())) continue;

        await thread.click();
        await sleep(randomBetween(2000, 3000));

        // Read messages — each is an <article> in .thread-container
        // Incoming messages have span[data-anonymize="person-name"]; outgoing do not
        const articles = await page.locator('.thread-container article').all();
        if (!articles.length) continue;

        const conversation = [];
        for (const article of articles) {
          // Check if incoming (has named sender span) or outgoing
          const senderEl = article.locator('span[data-anonymize="person-name"]').first();
          const isMine = !(await senderEl.isVisible({ timeout: 500 }).catch(() => false));
          const textEl = article.locator('p[data-anonymize="general-blurb"]').first();
          const text = (await textEl.textContent({ timeout: 1000 }).catch(() => '')).trim();
          if (text) conversation.push({ sender: isMine ? 'me' : 'them', text });
        }

        if (!conversation.length) continue;
        const last = conversation[conversation.length - 1];
        if (last.sender !== 'them') continue;  // Skip if Darren sent the last message

        const messages = conversation.map(m => ({ sender: m.sender === 'me' ? 'Me' : name, text: m.text }));
        const classification = await classifyInboxMessage(config, { contactName: name, messages, lastMessage: last.text });
        if (!['positive', 'neutral'].includes(classification.intent)) continue;

        const reply = await generateInboxReply(config, { contactName: name, messages, lastMessage: last.text, intent: classification.intent });

        // Verified compose selector: textarea[placeholder="Type your message here…"]
        // Send button: button[data-sales-action] (disabled until text typed)
        const textarea = page.locator('textarea[placeholder="Type your message here…"]').first();
        if (!await textarea.isVisible({ timeout: 4000 }).catch(() => false)) continue;
        await textarea.click();
        await sleep(500);
        await textarea.type(reply, { delay: randomBetween(30, 60) });
        await sleep(randomBetween(800, 1500));

        // Wait for send button to enable
        const sendBtn = page.locator('button[data-sales-action]').first();
        let sendReady = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          if (await sendBtn.isEnabled({ timeout: 500 }).catch(() => false)) { sendReady = true; break; }
          await sleep(500);
        }
        if (!sendReady) continue;
        await sendBtn.click();
        await sleep(randomBetween(1500, 2500));

        appendToHistory(config.nickname, `- Inbox reply → ${name}`);
        return sent({ name, title: '', company: '', messageSent: reply });

      } catch (threadErr) {
        console.log(`[test-run] Sales Nav inbox thread error: ${threadErr.message.substring(0, 80)}`);
        continue;
      }
    }

    return skipped('No positive/neutral threads found in first 10');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

// ─── Phase 3: Follow-up to accepted connection ────────────────────────────────
// Uses same verified selectors as follow-ups.js (live DOM probe 2026-04-06)
async function phase3FollowUp(page, config) {
  setProgress(3, 'Navigating to connections page…');
  try {
    await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await sleep(6000);
    setProgress(3, 'Scanning connections for 3+ day old contacts not yet followed up…');

    const alreadyFollowedUp = loadFollowedUpNames(config.nickname);
    let scrollAttempts = 0;
    let noNewCardsStreak = 0;
    let lastCardCount = 0;

    while (scrollAttempts < 30) {
      // Find message links for connection cards (not the nav Messaging link)
      const msgLinks = await page.locator('a[aria-label="Message"]').all();
      const cardLinks = [];
      for (const link of msgLinks) {
        const href = await link.getAttribute('href').catch(() => '');
        if (href && href.includes('/messaging/compose/')) cardLinks.push(link);
      }

      if (cardLinks.length === lastCardCount) {
        noNewCardsStreak++;
        if (noNewCardsStreak >= 3) break;
      } else {
        noNewCardsStreak = 0;
        lastCardCount = cardLinks.length;
      }

      for (const msgLink of cardLinks) {
        try {
          // Walk up DOM to find card root with name/date
          const data = await msgLink.evaluate((el) => {
            let node = el.parentElement;
            for (let i = 0; i < 12; i++) {
              if (!node) break;
              if (node.hasAttribute('componentkey') && node.innerText.includes('Connected on')) {
                const pTags = Array.from(node.querySelectorAll('p')).map(p => p.textContent.trim());
                const connectedP = pTags.find(t => t.startsWith('Connected on')) || '';
                return {
                  name:         pTags[0] || '',
                  occupation:   pTags[1] || '',
                  connectedText: connectedP,
                  msgHref:      el.getAttribute('href'),
                };
              }
              node = node.parentElement;
            }
            return null;
          });

          if (!data || !data.name || !data.connectedText) continue;
          if (!isOldEnough(data.connectedText)) continue;
          if (alreadyFollowedUp.has(data.name.toLowerCase())) continue;

          const lead = { name: data.name, title: data.occupation, company: '', location: '' };
          const message = await generateFollowUp(config, lead).catch(() => null);
          if (!message) continue;

          // Navigate to compose URL
          const composeUrl = data.msgHref.startsWith('http')
            ? data.msgHref
            : `https://www.linkedin.com${data.msgHref}`;
          await page.goto(composeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(randomBetween(3000, 4000));

          const replyBox = page.locator('.msg-form__contenteditable[contenteditable="true"]').first();
          if (!await replyBox.isVisible({ timeout: 6000 }).catch(() => false)) continue;

          await replyBox.click();
          await sleep(400);
          await page.keyboard.press('Control+a');
          await page.keyboard.press('Delete');
          await sleep(200);
          await page.keyboard.type(message, { delay: randomBetween(30, 60) });
          await page.evaluate(() => {
            const el = document.querySelector('.msg-form__contenteditable');
            if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
          }).catch(() => null);
          await sleep(randomBetween(800, 1500));

          const sendBtn = page.locator('.msg-form__send-button').first();
          let sendReady = false;
          for (let attempt = 0; attempt < 10; attempt++) {
            if (await sendBtn.isEnabled({ timeout: 500 }).catch(() => false)) { sendReady = true; break; }
            await sleep(400);
          }
          if (!sendReady) continue;

          await sendBtn.click({ timeout: 5000 });
          await sleep(randomBetween(1500, 2000));

          appendToHistory(config.nickname, `- Follow-up → ${data.name}`);
          return sent({ name: data.name, title: data.occupation, company: '', messageSent: message });

        } catch (cardErr) {
          console.log(`[test-run] Follow-up card error: ${cardErr.message.substring(0, 80)}`);
          continue;
        }
      }

      // Scroll for more connections
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(randomBetween(1500, 2500));
      scrollAttempts++;
    }

    return skipped('No eligible connection found (3+ days old, not yet followed up)');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

function isOldEnough(connectedText) {
  if (!connectedText) return false;
  const match = connectedText.match(/Connected on (\w+ \d+, \d{4})/);
  if (match) {
    const d = new Date(match[1]);
    if (!isNaN(d.getTime())) return (Date.now() - d.getTime()) / 86400000 >= 3;
  }
  const daysMatch = connectedText.match(/(\d+)\s+day/);
  if (daysMatch) return parseInt(daysMatch[1]) >= 3;
  if (/week|month|year/i.test(connectedText)) return true;
  return false;
}

// ─── Phase 4: InMail to Open Profile ─────────────────────────────────────────
async function phase4InMail(page, config) {
  setProgress(4, 'Navigating to Sales Nav saved search…');
  try {
    if (!config.salesNavSearchUrl) return skipped('No Sales Nav search URL configured');

    await page.goto(config.salesNavSearchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(5000, 7000)); // test run: tighter than full session
    setProgress(4, 'Scanning leads for Open Profile InMail candidates…');

    // Dismiss teaching bubbles
    const dismissBtns = await page.locator('[data-test-enterprise-teaching-bubble-dismiss-btn]').all();
    for (const b of dismissBtns) await b.click().catch(() => {});

    const alreadySent = loadInMailedNames(config.nickname);
    const leads = await page.locator('[data-x-search-result="LEAD"]').all();

    for (const lead of leads) {
      try {
        const name    = (await lead.locator('[data-anonymize="person-name"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        const title   = (await lead.locator('[data-anonymize="title"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        const company = (await lead.locator('[data-anonymize="company-name"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        if (!name || alreadySent.has(name.toLowerCase())) continue;

        // Must be 2nd or 3rd degree (skip 1st)
        const degreeBadge = (await lead.locator('.artdeco-entity-lockup__degree').first().textContent({ timeout: 500 }).catch(() => '')).trim();
        if (degreeBadge.includes('1st')) continue;

        // Must have a visible Message button (Open Profile indicator)
        // Test run: short timeout — don't wait 4s per non-open-profile lead
        const msgBtn = lead.locator(`button[aria-label^="Message "]`).first();
        if (!await msgBtn.isVisible({ timeout: 800 }).catch(() => false)) continue;

        // Confirm it's an Open Profile (not a credit InMail)
        const creditCheck = lead.locator('button[aria-label*="InMail credits renewal"]');
        if (await creditCheck.count() > 0) continue;

        const location = (await lead.locator('[data-anonymize="location"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        const leadData = { name, title, company, location };
        const { subject, body } = await generateInMail(config, leadData);

        await msgBtn.click();
        await sleep(randomBetween(2000, 3000));

        // Subject
        const subjectInput = page.locator('input[name="subject"], input[placeholder*="subject" i]').first();
        if (await subjectInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await subjectInput.click();
          await page.keyboard.type(subject, { delay: randomBetween(40, 80) });
          await sleep(randomBetween(500, 1000));
          await page.keyboard.press('Tab');
          await sleep(randomBetween(500, 800));
        }

        // Body
        const bodyInput = page.locator('textarea[name="message"], .msg-form__contenteditable[contenteditable]').first();
        if (await bodyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await bodyInput.click({ force: true });
          await sleep(500);
          await page.keyboard.type(body, { delay: randomBetween(30, 60) });
          await sleep(randomBetween(800, 1500));
        }

        // Wait for Send to enable + click
        let sendBtn = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          const btn = page.locator('button:has-text("Send")').first();
          if (await btn.isEnabled({ timeout: 500 }).catch(() => false)) { sendBtn = btn; break; }
          await sleep(500);
        }
        if (!sendBtn) { await page.keyboard.press('Escape').catch(() => {}); continue; }

        await sendBtn.click();
        await sleep(randomBetween(2000, 3000));
        await page.keyboard.press('Escape').catch(() => {});

        appendToHistory(config.nickname, `- InMail → ${name}`);
        return sent({ name, title, company, subject, messageSent: body });

      } catch (leadErr) {
        console.log(`[test-run] InMail lead error: ${leadErr.message.substring(0, 80)}`);
        continue;
      }
    }

    return skipped('No eligible Open Profile found on first page of search');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

// ─── Phase 5: Connection request ─────────────────────────────────────────────
async function phase5Connect(page, config) {
  setProgress(5, 'Navigating to Sales Nav saved search…');
  try {
    if (!config.salesNavSearchUrl) return skipped('No Sales Nav search URL configured');

    await page.goto(config.salesNavSearchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(5000, 7000)); // test run: tighter than full session
    setProgress(5, 'Scanning leads for eligible 2nd degree connection requests…');

    const dismissBtns = await page.locator('[data-test-enterprise-teaching-bubble-dismiss-btn]').all();
    for (const b of dismissBtns) await b.click().catch(() => {});

    const alreadyConnected = loadConnectedNames(config.nickname);
    const leads = await page.locator('[data-x-search-result="LEAD"]').all();

    for (const lead of leads) {
      try {
        const name    = (await lead.locator('[data-anonymize="person-name"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        const title   = (await lead.locator('[data-anonymize="title"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        const company = (await lead.locator('[data-anonymize="company-name"]').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
        if (!name || alreadyConnected.has(name.toLowerCase())) continue;

        // 2nd degree only
        const degreeBadge = (await lead.locator('.artdeco-entity-lockup__degree').first().textContent({ timeout: 500 }).catch(() => '')).trim();
        if (!degreeBadge.includes('2nd')) continue;

        const location = (await lead.locator('[data-anonymize="location"]').first().textContent({ timeout: 500 }).catch(() => '')).trim();
        const leadData = { name, title, company, location };

        const message = await generateConnectionRequest(config, leadData);

        // Navigate to lead's Sales Nav profile page (required for overflow menu connect flow)
        const searchUrl = page.url();
        const leadHref = await lead.locator('[data-control-name="view_lead_panel_via_search_lead_name"]').first()
          .getAttribute('href').catch(() => null);
        if (!leadHref) continue;

        const leadUrl = leadHref.startsWith('http') ? leadHref : `https://www.linkedin.com${leadHref}`;
        await page.goto(leadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(randomBetween(2000, 3000)); // test run: tighter

        // Open actions overflow menu
        const moreBtn = page.locator('button[aria-label="Open actions overflow menu"]').first();
        if (!await moreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await sleep(randomBetween(2000, 3000));
          continue;
        }
        await moreBtn.click();
        await sleep(randomBetween(800, 1400));

        const connectItem = page.locator('li:has-text("Connect"):not(:has-text("View")):not(:has-text("Copy"))').first();
        if (!await connectItem.isVisible({ timeout: 3000 }).catch(() => false)) {
          await page.keyboard.press('Escape').catch(() => {});
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await sleep(randomBetween(2000, 3000));
          continue;
        }
        await connectItem.click();
        await sleep(randomBetween(1200, 2000));

        // Fill invite dialog
        const addNoteBtn = page.locator('button:has-text("Add a note")').first();
        if (await addNoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addNoteBtn.click();
          await sleep(randomBetween(600, 1200));
        }

        const textarea = page.locator('textarea[name="message"], textarea#custom-message, [role="dialog"] textarea').first();
        if (!await textarea.isVisible({ timeout: 4000 }).catch(() => false)) {
          // No note field — send without note
          const sendBtn = page.locator('button:has-text("Send"), button:has-text("Send invitation")').first();
          if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await sendBtn.click();
            await sleep(randomBetween(1000, 2000));
            appendToHistory(config.nickname, `- Connect → ${name}`);
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            return sent({ name, title, company, messageSent: '(no note — connection sent without message)' });
          }
          continue;
        }

        await textarea.fill('');
        await textarea.type(message, { delay: randomBetween(30, 60) });
        await sleep(randomBetween(800, 1500));

        const sendBtn = page.locator('button:has-text("Send"), button:has-text("Send invitation")').first();
        if (!await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) continue;
        await sendBtn.click();
        await sleep(randomBetween(1200, 2000));

        appendToHistory(config.nickname, `- Connect → ${name}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(randomBetween(2000, 3000));
        return sent({ name, title, company, messageSent: message });

      } catch (leadErr) {
        console.log(`[test-run] Connect lead error: ${leadErr.message.substring(0, 80)}`);
        continue;
      }
    }

    return skipped('No eligible 2nd degree lead found on first page of search');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

// ─── Format Slack report ──────────────────────────────────────────────────────
function formatReport(nickname, results, startTime) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' });
  const totalSent = results.filter(r => r.status === 'Sent').length;

  const labels = [
    'LinkedIn inbox reply',
    'Sales Nav inbox reply',
    'Follow-up message',
    'InMail',
    'Connection request',
  ];

  const lines = results.map((r, i) => {
    const label = labels[i];
    if (r.status === 'Sent') {
      const to = [r.name, r.title, r.company].filter(Boolean).join(' · ');
      const msgLine = r.subject
        ? `Subject: "${r.subject}"\n   Body: "${r.messageSent}"`
        : `Message: "${r.messageSent}"`;
      return `${i + 1}. ${label}\n   To: ${to}\n   ${msgLine}\n   Status: ✅ Sent`;
    } else {
      return `${i + 1}. ${label}\n   Status: ⏭️ ${r.status}${r.reason ? ` — ${r.reason}` : ''}`;
    }
  });

  return `*TEST RUN COMPLETE — ${nickname} — ${ts}*\n\n${lines.join('\n\n')}\n\n*Total sent: ${totalSent}/5*`;
}

// ─── Progress state (updated by each phase, read by heartbeat) ───────────────
const progress = {
  phase: 0,
  phaseLabel: 'Starting…',
  status: 'Launching Chrome and verifying LinkedIn session…',
};

const PHASE_LABELS = [
  '',
  'Phase 1 — LinkedIn inbox reply',
  'Phase 2 — Sales Nav inbox reply',
  'Phase 3 — Follow-up message',
  'Phase 4 — InMail',
  'Phase 5 — Connection request',
];

function setProgress(phase, status) {
  progress.phase = phase;
  progress.phaseLabel = PHASE_LABELS[phase] || `Phase ${phase}`;
  progress.status = status;
  console.log(`[test-run] [${PHASE_LABELS[phase] || phase}] ${status}`);
}

function startHeartbeat(startTime, channel) {
  const interval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const elapsedStr = `${mins}:${String(secs).padStart(2, '0')}`;
    const msg = `⏱ *Test run update — ${nickname} (${elapsedStr} elapsed)*\nCurrently on: ${progress.phaseLabel}\nStatus: ${progress.status}`;
    await postSlack(msg, channel).catch(() => {});
  }, 60 * 1000);
  return interval;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function runTestSession() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  // Lock checks
  if (fs.existsSync(LOCK_FILE)) {
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (age < 6 * 60 * 60 * 1000) {
      await postSlack(`⚠️ *test run ${nickname}* aborted — scheduler is currently running (lock file exists, ${Math.round(age / 60000)}min old).`);
      process.exit(0);
    }
  }

  if (fs.existsSync(TEST_LOCK)) {
    const age = Date.now() - fs.statSync(TEST_LOCK).mtimeMs;
    if (age < 2 * 60 * 60 * 1000) {
      await postSlack(`⚠️ *test run ${nickname}* aborted — a test run for this profile is already in progress (${Math.round(age / 60000)}min old).`);
      process.exit(0);
    }
    fs.unlinkSync(TEST_LOCK);
  }

  fs.writeFileSync(TEST_LOCK, String(process.pid));

  const cleanup = () => {
    try { if (fs.existsSync(TEST_LOCK)) fs.unlinkSync(TEST_LOCK); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });

  const startTime = Date.now();

  try {
    const config = loadAccountConfig(nickname);
    console.log(`[test-run] Starting test session for: ${nickname} (${config.name})`);
    await postSlack(`🧪 *Test run starting for ${nickname}…* (5 phases — will report back when complete)`);

    // Start 60s heartbeat
    const heartbeat = startHeartbeat(startTime, replyChannel);

    // Launch Chrome
    const context = await launchProfile(config);
    const page = context.pages()[0] || await context.newPage();
    await verifyLinkedInSession(page, config.name);
    console.log(`[test-run] LinkedIn session verified ✓`);

    // Run all 5 phases independently
    const phase1 = await phase1LinkedInInbox(page, config).catch(e => errored(e.message.substring(0, 100)));
    const phase2 = await phase2SalesNavInbox(page, config).catch(e => errored(e.message.substring(0, 100)));
    const phase3 = await phase3FollowUp(page, config).catch(e => errored(e.message.substring(0, 100)));
    const phase4 = await phase4InMail(page, config).catch(e => errored(e.message.substring(0, 100)));
    const phase5 = await phase5Connect(page, config).catch(e => errored(e.message.substring(0, 100)));

    clearInterval(heartbeat);
    await context.close();

    const report = formatReport(nickname, [phase1, phase2, phase3, phase4, phase5], startTime);
    await postSlack(report);
    console.log(`[test-run] Complete.`);

  } catch (err) {
    if (typeof heartbeat !== 'undefined') clearInterval(heartbeat);
    console.error(`[test-run] Fatal error:`, err.message);
    await postSlack(`❌ *Test run failed for ${nickname}*\nError: ${err.message.substring(0, 200)}`);
  } finally {
    cleanup();
  }
}

runTestSession().catch(err => {
  console.error('[test-run] Unhandled error:', err);
  process.exit(1);
});
