/**
 * inmails.js — Send InMails to Open Profiles from Sales Navigator search
 * Verified dialog structure 2026-03-14:
 *   - Message button on card: button[aria-label^="Message "]
 *   - Dialog opens as chat overlay at bottom of page
 *   - Subject: input[aria-label="Subject (required)"]
 *   - Body: textarea[name="message"]
 *   - Send: button within overlay :has-text("Send")
 *   - Close: button[aria-label*="Close conversation"]
 *   - Paid indicator: button:has-text("InMail credits renewal help info") visible
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { generateInMail } = require('../utils/messenger');
const { alertError } = require('../utils/report');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Load names already InMailed from HISTORY.md to prevent cross-session duplicates.
 */
function loadInMailedNames(nickname) {
  const historyPath = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/HISTORY.md`);
  if (!fs.existsSync(historyPath)) return new Set();
  const content = fs.readFileSync(historyPath, 'utf8');
  const names = new Set();
  // Match lines like: "InMail → Name" or "InMail sent to Name"
  const re = /InMail(?:\s+sent\s+to|→)\s+([^\n|]+)/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    names.add(m[1].trim().toLowerCase());
  }
  return names;
}

async function runInMails(page, config, results) {
  const target = 5;
  let sent = 0;
  let checked = 0;
  const maxCheck = 20;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5; // bail out if every lead is failing

  // Dedup: track names sent this session + cross-session via HISTORY.md
  const alreadySent = loadInMailedNames(config.nickname);
  const sentThisSession = new Set();

  console.log(`[${config.nickname}] InMails — target: ${target} open profiles`);

  // Navigate to search page — Sales Nav needs extra time to render all button states
  const baseUrl = config.salesNavSearchUrl;
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randomBetween(7000, 10000)); // longer wait than normal — buttons render late

  // Dismiss any teaching bubbles
  const dismissBtns = await page.locator('[data-test-enterprise-teaching-bubble-dismiss-btn]').all();
  for (const b of dismissBtns) await b.click().catch(() => {});

  let pageNum = 1;

  while (sent < target && checked < maxCheck) {
    const leads = await page.locator('[data-x-search-result="LEAD"]').all();
    if (!leads.length) break;

    for (const lead of leads) {
      if (sent >= target || checked >= maxCheck) break;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.log(`[${config.nickname}] InMails — ${maxConsecutiveErrors} consecutive errors, bailing out`);
        return;
      }

      try {
        const name = (await lead.locator('[data-anonymize="person-name"]').first()
          .textContent({ timeout: 2000 }).catch(() => '')).trim();
        const title = (await lead.locator('[data-anonymize="title"]').first()
          .textContent({ timeout: 2000 }).catch(() => '')).trim();
        const company = (await lead.locator('[data-anonymize="company-name"]').first()
          .textContent({ timeout: 2000 }).catch(() => '')).trim();
        const location = (await lead.locator('[data-anonymize="location"]').first()
          .textContent({ timeout: 2000 }).catch(() => '')).trim();

        if (!name) continue;

        // Skip if already InMailed (this session or a previous session)
        const nameKey = name.toLowerCase();
        if (sentThisSession.has(nameKey) || alreadySent.has(nameKey)) {
          console.log(`[${config.nickname}] ${name} — already InMailed, skipping`);
          continue;
        }

        // Skip 1st degree (already connected — use follow-up instead)
        const deg = (await lead.locator('.artdeco-entity-lockup__degree').first()
          .textContent({ timeout: 1000 }).catch(() => '')).trim();
        if (deg.includes('1st')) continue;

        // Click Message button on the card (use prefix match — avoids special char issues)
        const msgBtn = lead.locator('button[aria-label^="Message "]').first();
        if (!await msgBtn.isVisible({ timeout: 4000 }).catch(() => false)) continue;

        checked++; // increment before click so a failed click still counts
        await msgBtn.click({ timeout: 8000 }); // short timeout — if it doesn't click fast, skip
        await sleep(randomBetween(2000, 3000));

        // Check if it's a paid InMail (credit counter button appears)
        const isPaid = await page.locator('button[aria-label*="InMail credits renewal"]').isVisible({ timeout: 2000 }).catch(() => false);
        if (isPaid) {
          console.log(`[${config.nickname}] ${name} — paid InMail, skipping`);
          await closeConversation(page, name);
          continue;
        }

        console.log(`[${config.nickname}] ${name} — Open Profile ✅ generating InMail...`);

        const leadProfile = { name, title, company, location };
        const inmail = await generateInMail(config, leadProfile).catch(() => null);
        if (!inmail) {
          await closeConversation(page, name);
          continue;
        }

        // Fill subject — click normally (no overlay blocking this field)
        const subjectInput = page.locator('input[aria-label="Subject (required)"]').first();
        if (!await subjectInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeConversation(page, name);
          continue;
        }
        await subjectInput.click();
        await sleep(randomBetween(300, 600));
        await subjectInput.type(inmail.subject, { delay: randomBetween(30, 60) });
        await sleep(randomBetween(500, 900));

        // Fill body — LinkedIn's "draft with AI" ghost overlay blocks direct clicks.
        // Use force:true to bypass it, then type to trigger change events.
        const bodyField = page.locator('textarea[name="message"]').first();
        if (!await bodyField.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeConversation(page, name);
          continue;
        }

        // Dismiss the AI ghost overlay first by clicking subject area, then Tab to body
        await subjectInput.click();
        await sleep(300);
        await page.keyboard.press('Tab');
        await sleep(randomBetween(400, 700));

        // If still blocked, use force click
        const bodyClickable = await bodyField.isEnabled({ timeout: 1000 }).catch(() => false);
        if (!bodyClickable) {
          await bodyField.click({ force: true });
        }
        await sleep(400);

        // Type the body content — typing triggers LinkedIn's change events to enable Send
        await bodyField.type(inmail.body, { delay: randomBetween(25, 55) });
        await sleep(randomBetween(800, 1500));

        // Send button becomes enabled after content is entered
        const sendBtn = page.locator('button:has-text("Send")').last();

        // Wait for it to become enabled (LinkedIn enables it after body has content)
        let sendEnabled = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          sendEnabled = await sendBtn.isEnabled({ timeout: 1000 }).catch(() => false);
          if (sendEnabled) break;
          await sleep(500);
        }

        if (sendEnabled) {
          await sendBtn.click({ timeout: 8000 });
          sent++;
          consecutiveErrors = 0; // reset on success
          sentThisSession.add(nameKey);
          results.messagessent = (results.messagessent || 0) + 1;
          console.log(`[${config.nickname}] ✅ InMail sent to ${name} (${sent}/${target}): "${inmail.subject}"`);
          await sleep(randomBetween(1500, 2500));
          await closeConversation(page, name);
          await delays.betweenInMails();
        } else {
          console.log(`[${config.nickname}] Send button never enabled for ${name}`);
          consecutiveErrors++;
          await closeConversation(page, name);
        }

      } catch (err) {
        consecutiveErrors++;
        console.log(`[${config.nickname}] InMail error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message.substring(0, 80)}`);
        await alertError(config, 'inmails', `send InMail to ${name || 'unknown'}`, err.message.substring(0, 200), consecutiveErrors >= maxConsecutiveErrors ? 'phase aborted' : 'skipped and continued');
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(randomBetween(2000, 3000));
      }
    }

    // Next page if needed
    if (sent < target && checked < maxCheck) {
      const nextBtn = page.locator('button[aria-label="Next"]').first();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false) &&
          await nextBtn.isEnabled().catch(() => false)) {
        await nextBtn.click({ force: true });
        pageNum++;
        await delays.afterPageLoad();
      } else {
        break;
      }
    }
  }

  console.log(`[${config.nickname}] InMails done — sent: ${sent}, checked: ${checked}`);
}

async function closeConversation(page, name) {
  try {
    const closeBtn = page.locator(`button[aria-label*="Close conversation with ${name}"]`).first();
    if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await closeBtn.click();
      await sleep(500);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
  } catch (_) {}
}

module.exports = { runInMails };
