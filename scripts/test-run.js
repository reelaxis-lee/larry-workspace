/**
 * test-run.js — DRY RUN preview (one eligible target per phase, nothing sent)
 *
 * Usage: node scripts/test-run.js <nickname> [replyChannelId]
 * Example: node scripts/test-run.js darren D0AL85W960J
 *
 * DRY RUN rules:
 *   - All 5 phases navigate, find eligible targets, and generate real messages via Claude
 *   - Nothing is ever sent — no .click() on send buttons, no .type() into compose boxes
 *   - Nothing is written to HISTORY.md or STATUS.md
 *   - Reasoning guardrails still apply: if Claude output looks like internal reasoning,
 *     it is flagged in the report instead of shown as the preview message
 *   - The Slack report shows exactly what WOULD have been sent for review
 *
 * Phases (1 eligible target each):
 *   1. LinkedIn inbox reply (linkedin.com/messaging)
 *   2. Sales Nav inbox reply (linkedin.com/sales/inbox)
 *   3. Follow-up to an accepted connection (3+ days old)
 *   4. InMail to an Open Profile from saved search
 *   5. Connection request to a 2nd or 3rd degree lead from saved search
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
function skipped(reason)           { return { status: 'Skipped',   reason, name: '—', title: '', company: '', messageSent: '' }; }
function dryRun(data)              { return { status: 'DRY RUN',   reason: '', ...data }; }
function guardrail(name, pattern)  { return { status: 'GUARDRAIL', reason: `Pattern matched: ${pattern}`, name, title: '', company: '', messageSent: '' }; }
function errored(reason)           { return { status: 'Error',     reason, name: '—', title: '', company: '', messageSent: '' }; }

// ─── Safety guardrail — never send internal reasoning text ───────────────────
// If Claude outputs meta-reasoning instead of a reply (e.g. because it detected
// the conversation context was malformed), abort the send and log a warning.
const INTERNAL_REASONING_PATTERNS = [
  /it looks like.*last message/i,
  /the latest message shown/i,
  /there['']s no reply from/i,
  /could you share what .{1,30} (wrote|said|sent)/i,
  /I can['']t see a (reply|response) from/i,
  /it appears (that )?(you|darren) sent the last/i,
  /I don['']t have enough context/i,
  /could you provide (more|the actual)/i,
];

function looksLikeInternalReasoning(text) {
  return INTERNAL_REASONING_PATTERNS.some(p => p.test(text));
}

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

        // Read last 8 message groups
        // isMine detection: .msg-s-message-group__profile-link contains sender name.
        // .msg-s-message-group--outgoing is DEAD (LinkedIn hashed-class UI update 2026-04).
        const msgEls = await page.locator('.msg-s-message-list__event').all();
        const lastMsgs = msgEls.slice(-8);
        const conversation = [];
        for (const el of lastMsgs) {
          const text = (await el.locator('.msg-s-event-listitem__body').first().textContent({ timeout: 1000 }).catch(() => '')).trim();
          const senderName = (await el.locator('.msg-s-message-group__profile-link').first().textContent({ timeout: 500 }).catch(() => '')).trim();
          const isMine = !senderName || senderName === config.name;
          if (text) conversation.push({ sender: isMine ? 'me' : 'them', text });
        }

        if (!conversation.length) continue;

        // Skip if we sent the last message — check BEFORE any Claude call
        const last = conversation[conversation.length - 1];
        if (last.sender !== 'them') continue;

        // Classify
        const messages = conversation.map(m => ({ sender: m.sender === 'me' ? 'Me' : name, text: m.text }));
        const classification = await classifyInboxMessage(config, { contactName: name, messages, lastMessage: last.text });
        if (!['positive', 'neutral'].includes(classification.intent)) continue;

        // Generate reply
        const reply = await generateInboxReply(config, { contactName: name, messages, lastMessage: last.text, intent: classification.intent });

        // Reasoning guardrail — check before any send action
        const triggeredPattern = INTERNAL_REASONING_PATTERNS.find(p => p.test(reply));
        if (!reply || triggeredPattern) {
          console.log(`[test-run] LinkedIn inbox — guardrail triggered for ${name}`);
          return guardrail(name, String(triggeredPattern));
        }

        // DRY RUN — do not send, do not write to HISTORY.md
        console.log(`[test-run] LinkedIn inbox — DRY RUN: would send to ${name}`);
        return dryRun({ name, title: '', company: '', messageSent: reply });

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

        // Reasoning guardrail — check before any send action
        const triggeredPattern = INTERNAL_REASONING_PATTERNS.find(p => p.test(reply));
        if (!reply || triggeredPattern) {
          console.log(`[test-run] Sales Nav inbox — guardrail triggered for ${name}`);
          return guardrail(name, String(triggeredPattern));
        }

        // DRY RUN — do not send, do not write to HISTORY.md
        console.log(`[test-run] Sales Nav inbox — DRY RUN: would send to ${name}`);
        return dryRun({ name, title: '', company: '', messageSent: reply });

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

          // DRY RUN — do not navigate to compose URL, do not send, do not write to HISTORY.md
          console.log(`[test-run] Follow-up — DRY RUN: would send to ${data.name}`);
          return dryRun({ name: data.name, title: data.occupation, company: '', messageSent: message });

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

        // DRY RUN — do not click Message button, do not send, do not write to HISTORY.md
        console.log(`[test-run] InMail — DRY RUN: would send to ${name}`);
        return dryRun({ name, title, company, subject, messageSent: body });

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
    setProgress(5, 'Scanning leads for eligible 2nd or 3rd degree connection requests…');

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

        // 2nd and 3rd degree eligible — only skip 1st
        const degreeBadge = (await lead.locator('.artdeco-entity-lockup__degree').first().textContent({ timeout: 500 }).catch(() => '')).trim();
        if (degreeBadge.includes('1st')) continue;

        const location = (await lead.locator('[data-anonymize="location"]').first().textContent({ timeout: 500 }).catch(() => '')).trim();
        const leadData = { name, title, company, location };

        const message = await generateConnectionRequest(config, leadData);

        // DRY RUN — do not navigate to lead profile, do not send, do not write to HISTORY.md
        // (Profile navigation is only needed for the send flow via overflow menu)
        console.log(`[test-run] Connection request — DRY RUN: would send to ${name}`);
        return dryRun({ name, title, company, messageSent: message });

      } catch (leadErr) {
        console.log(`[test-run] Connect lead error: ${leadErr.message.substring(0, 80)}`);
        continue;
      }
    }

    return skipped('No eligible 2nd or 3rd degree lead found on first page of search');
  } catch (err) {
    return errored(err.message.substring(0, 100));
  }
}

// ─── Format Slack report ──────────────────────────────────────────────────────
function formatReport(nickname, results, startTime) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' });
  const totalWouldSend = results.filter(r => r.status === 'DRY RUN').length;

  const labels = [
    'LinkedIn inbox reply',
    'Sales Nav inbox reply',
    'Follow-up message',
    'InMail',
    'Connection request',
  ];

  const lines = results.map((r, i) => {
    const label = labels[i];
    const to = [r.name, r.title, r.company].filter(s => s && s !== '—').join(' · ') || r.name;

    if (r.status === 'DRY RUN') {
      const msgBlock = r.subject
        ? `Subject: "${r.subject}"\n   Body: "${r.messageSent}"`
        : `Would send: "${r.messageSent}"`;
      return `${i + 1}. ${label}\n   To: ${to}\n   ${msgBlock}\n   Status: DRY RUN — not sent`;
    } else if (r.status === 'GUARDRAIL') {
      return `${i + 1}. ${label}\n   To: ${to}\n   Status: ⚠️ GUARDRAIL TRIGGERED — ${r.reason}`;
    } else {
      return `${i + 1}. ${label}\n   Status: ⏭️ ${r.status}${r.reason ? ` — ${r.reason}` : ''}`;
    }
  });

  return `*TEST RUN COMPLETE (DRY RUN) — ${nickname} — ${ts}*\n_No messages were sent. This is a preview only._\n\n${lines.join('\n\n')}\n\n*Total would send: ${totalWouldSend}/5*`;
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
    await postSlack(`🧪 *Dry run starting for ${nickname}…* (5 phases, preview only — no messages will be sent)`);

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
