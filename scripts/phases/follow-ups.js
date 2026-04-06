/**
 * follow-ups.js — Send follow-up messages to newly accepted connections
 *
 * Rule: only message connections accepted 3+ days ago, not yet followed up.
 *
 * Verified selectors (live DOM probe 2026-04-06 — LinkedIn uses hashed CSS classes,
 * so all selectors use stable attributes, not class names):
 *
 * Card discovery:
 *   Message links:  a[aria-label="Message"] where href includes /messaging/compose/
 *   Card root:      walk up from Message link until div[componentkey] with "Connected on" text
 *   Name:           first <p> inside card root
 *   Occupation:     second <p> inside card root
 *   Connected date: third <p> inside card root (contains "Connected on")
 *   Profile URL:    a[href*="/in/"] inside card root
 *
 * Sending:
 *   Navigate directly to the /messaging/compose/?profileUrn=... URL (opens overlay).
 *   Reply box:   .msg-form__contenteditable[contenteditable="true"]
 *   Send button: .msg-form__send-button (poll for enabled)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { sleep, randomBetween, delays } = require('../utils/browser');
const { generateFollowUp }             = require('../utils/messenger');
const { alertError }                   = require('../utils/report');

const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';

// ── HISTORY.md helpers ────────────────────────────────────────────────────────

function historyPath(nickname) {
  return path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/HISTORY.md`);
}

function loadFollowedUpNames(nickname) {
  const p = historyPath(nickname);
  if (!fs.existsSync(p)) return new Set();
  const content = fs.readFileSync(p, 'utf8');
  const names = new Set();
  const re = /Follow-up → ([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1].trim().toLowerCase());
  return names;
}

function appendFollowUpToHistory(nickname, name) {
  const p = historyPath(nickname);
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf8');
  const updated = content.replace('## Log', `## Log\n- Follow-up → ${name}`);
  fs.writeFileSync(p, updated);
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function isOldEnough(connectedText) {
  if (!connectedText) return false;

  // "Connected on April 3, 2026"
  const fullMatch = connectedText.match(/Connected on (\w+ \d+, \d{4})/);
  if (fullMatch) {
    const d = new Date(fullMatch[1]);
    if (!isNaN(d.getTime())) return (Date.now() - d.getTime()) / 86400000 >= 3;
  }

  // "X days ago" fallback
  const daysMatch = connectedText.match(/(\d+)\s+day/);
  if (daysMatch) return parseInt(daysMatch[1]) >= 3;

  // Weeks/months/years — always old enough
  if (/week|month|year/i.test(connectedText)) return true;

  return false;
}

// ── Card extraction ───────────────────────────────────────────────────────────

/**
 * Given a Playwright locator for a[aria-label="Message"], walk up the DOM
 * to find the card root (div[componentkey] containing "Connected on" text).
 * Returns { name, occupation, connectedText, profileHref, msgHref } or null.
 */
async function extractCardData(msgLink) {
  try {
    // Get the href first — we'll use it for composing
    const msgHref = await msgLink.getAttribute('href').catch(() => null);
    if (!msgHref || !msgHref.includes('/messaging/compose/')) return null;

    // Walk up via page.evaluate — faster than Playwright locator chaining
    const data = await msgLink.evaluate((el) => {
      // Walk up to find the card root: a div with componentkey that has "Connected on" text
      let node = el.parentElement;
      for (let i = 0; i < 12; i++) {
        if (!node) break;
        if (node.hasAttribute('componentkey') && node.innerText.includes('Connected on')) {
          // Found the card root — extract p tags
          const pTags = Array.from(node.querySelectorAll('p')).map(p => p.textContent.trim());
          const name       = pTags[0] || '';
          const occupation = pTags[1] || '';
          const connectedP = pTags.find(t => t.startsWith('Connected on')) || '';
          const profileLink = node.querySelector('a[href*="/in/"]');
          return {
            name,
            occupation,
            connectedText: connectedP,
            profileHref: profileLink ? profileLink.href : '',
          };
        }
        node = node.parentElement;
      }
      return null;
    });

    if (!data || !data.name || !data.connectedText) return null;

    return { ...data, msgHref };
  } catch (_) {
    return null;
  }
}

// ── Main phase ────────────────────────────────────────────────────────────────

async function runFollowUps(page, config, results) {
  const target = config.dailyMessageTarget || 35;
  let sent = 0;
  const alreadyFollowedUp = loadFollowedUpNames(config.nickname);

  console.log(`[${config.nickname}] Follow-ups — target: ${target}`);

  try {
    await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);

    let scrollAttempts = 0;
    const maxScrollAttempts = 40;
    let lastCardCount = 0;
    let noNewCardsStreak = 0;

    while (sent < target && scrollAttempts < maxScrollAttempts) {
      // Re-query all message links on current page state
      const msgLinks = await page.locator('a[aria-label="Message"]').all();
      // Filter to connection card links only (not the nav Messaging link)
      const cardLinks = [];
      for (const link of msgLinks) {
        const href = await link.getAttribute('href').catch(() => '');
        if (href && href.includes('/messaging/compose/')) cardLinks.push(link);
      }

      console.log(`[${config.nickname}] Follow-ups — scroll ${scrollAttempts}: ${cardLinks.length} cards visible`);

      // Detect if scroll loaded new cards
      if (cardLinks.length === lastCardCount) {
        noNewCardsStreak++;
        if (noNewCardsStreak >= 3) {
          console.log(`[${config.nickname}] Follow-ups — no new cards after ${noNewCardsStreak} scrolls, stopping`);
          break;
        }
      } else {
        noNewCardsStreak = 0;
        lastCardCount = cardLinks.length;
      }

      // Process cards — only ones we haven't tried yet
      for (const msgLink of cardLinks) {
        if (sent >= target) break;

        const card = await extractCardData(msgLink);
        if (!card) continue;
        if (!card.connectedText) continue;
        if (!isOldEnough(card.connectedText)) continue;
        if (alreadyFollowedUp.has(card.name.toLowerCase())) continue;

        // Extract first name for logging
        const firstName = card.name.split(/[\s,]+/)[0];

        console.log(`[${config.nickname}] Follow-up candidate: ${card.name} (${card.connectedText})`);

        // Generate message via Claude
        const lead = {
          name:     card.name,
          title:    card.occupation,
          company:  '', // occupation field may include company already
          location: '',
        };
        const message = await generateFollowUp(config, lead).catch(() => null);
        if (!message) {
          console.log(`[${config.nickname}] Follow-ups — message generation failed for ${card.name}`);
          continue;
        }

        // Navigate to compose URL (opens messaging overlay)
        const composeUrl = card.msgHref.startsWith('http')
          ? card.msgHref
          : `https://www.linkedin.com${card.msgHref}`;

        await page.goto(composeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(randomBetween(3000, 4000));

        // Find compose box — LinkedIn may redirect to /messaging/ with overlay
        const replyBox = page.locator('.msg-form__contenteditable[contenteditable="true"]').first();
        if (!await replyBox.isVisible({ timeout: 6000 }).catch(() => false)) {
          console.log(`[${config.nickname}] Follow-ups — compose box not visible for ${card.name}, skipping`);
          // Return to connections page for next card
          await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(randomBetween(3000, 4000));
          continue;
        }

        await replyBox.click();
        await sleep(randomBetween(400, 700));
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await sleep(200);
        await page.keyboard.type(message, { delay: randomBetween(30, 60) });
        await page.evaluate(() => {
          const el = document.querySelector('.msg-form__contenteditable');
          if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
        }).catch(() => null);
        await sleep(randomBetween(800, 1500));

        // Poll send button
        const sendBtn = page.locator('.msg-form__send-button').first();
        let sendReady = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          if (await sendBtn.isEnabled({ timeout: 500 }).catch(() => false)) { sendReady = true; break; }
          await sleep(400);
        }

        if (!sendReady) {
          console.log(`[${config.nickname}] Follow-ups — send button never enabled for ${card.name}`);
          await page.keyboard.press('Escape').catch(() => null);
          await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(randomBetween(3000, 4000));
          continue;
        }

        await sendBtn.click({ timeout: 5000 });
        await sleep(randomBetween(1500, 2500));

        // Log to HISTORY.md + update results
        appendFollowUpToHistory(config.nickname, card.name);
        alreadyFollowedUp.add(card.name.toLowerCase());
        sent++;
        results.messagessent = (results.messagessent || 0) + 1;
        console.log(`[${config.nickname}] ✅ Follow-up sent to ${card.name} (${sent}/${target})`);

        // Return to connections page for next card
        await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(randomBetween(4000, 6000));

        // Reset scroll state — page reloaded
        lastCardCount = 0;
        noNewCardsStreak = 0;
        scrollAttempts = 0;

        await delays.betweenMessages();
      }

      if (sent >= target) break;

      // Scroll to load more connections
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(randomBetween(2000, 3000));
      scrollAttempts++;
    }

    console.log(`[${config.nickname}] Follow-ups done — sent: ${sent}`);

  } catch (err) {
    console.log(`[${config.nickname}] Follow-ups error: ${err.message.substring(0, 100)}`);
    await alertError(config, 'follow-ups', 'running follow-ups phase', err.message.substring(0, 200), 'phase aborted');
  }
}

module.exports = { runFollowUps };
