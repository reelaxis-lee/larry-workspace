/**
 * follow-ups.js — Send follow-up messages to newly accepted connections
 * Rule: only message connections accepted 3+ days ago, not yet followed up
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { generateFollowUp } = require('../utils/messenger');
const { alertError } = require('../utils/report');

async function runFollowUps(page, config, results) {
  const target = config.dailyMessageTarget || 35;
  let sent = 0;

  console.log(`[${config.nickname}] Follow-ups — target: ${target}`);

  // Navigate to connections page
  await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await sleep(6000); // LinkedIn uses hashed classes + lazy render

  // Scroll down to load more connections (older ones are below the fold)
  // We need to find 3+ day old connections, so scroll past today's batch
  let scrollAttempts = 0;
  let qualifiedConnections = [];

  while (qualifiedConnections.length < target && scrollAttempts < 50) {
    qualifiedConnections = await extractQualifiedConnections(page);
    console.log(`[${config.nickname}] Scroll ${scrollAttempts + 1}: found ${qualifiedConnections.length} connections 3+ days old`);

    if (qualifiedConnections.length >= target) break;

    // Scroll down to load more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(randomBetween(1500, 2500));
    scrollAttempts++;

    // If page didn't load more, stop scrolling
    const currentCount = await page.evaluate(() =>
      document.querySelectorAll('p').filter
        ? [...document.querySelectorAll('p')].filter(p => p.textContent.includes('Connected on')).length
        : 0
    );
    if (currentCount === 0 && scrollAttempts > 3) break;
  }

  if (qualifiedConnections.length === 0) {
    console.log(`[${config.nickname}] No connections aged 3+ days found — follow-ups skipped`);
    results.messagessent = 0;
    return;
  }

  console.log(`[${config.nickname}] ${qualifiedConnections.length} connections to follow up`);

  for (const conn of qualifiedConnections.slice(0, target)) {
    if (sent >= target) break;

    try {
      const { name, title, href, dateText } = conn;
      console.log(`[${config.nickname}] Follow-up: ${name} — ${title} (${dateText})`);

      // Navigate to their LinkedIn profile
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(randomBetween(2000, 3500));

      // Get company context from profile
      const company = (await page.locator('.pv-text-details__right-panel .text-body-medium, .text-body-medium.break-words')
        .first().textContent({ timeout: 3000 }).catch(() => '')).trim();

      // Generate follow-up via Claude
      const message = await generateFollowUp(config, { name, title, company }).catch(() => null);
      if (!message) {
        console.log(`[${config.nickname}] Failed to generate message for ${name} — skipping`);
        await sleep(randomBetween(1000, 2000));
        continue;
      }

      // Find Message button on their profile
      // LinkedIn uses aria-label="Message John Smith" (includes name) — use contains match
      const msgBtn = page.locator(
        'button[aria-label*="Message"], a[aria-label*="Message"]'
      ).first();
      if (!await msgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log(`[${config.nickname}] No Message button for ${name} — skipping`);
        await sleep(randomBetween(1000, 2000));
        continue;
      }

      await msgBtn.click({ timeout: 8000 });
      await sleep(randomBetween(1500, 2500));

      // Type in the compose box — LinkedIn messaging uses contenteditable
      const composeBox = page.locator('.msg-form__contenteditable[contenteditable="true"], [role="textbox"][contenteditable="true"]').first();
      if (!await composeBox.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log(`[${config.nickname}] Compose box not visible for ${name}`);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(randomBetween(1000, 2000));
        continue;
      }

      await composeBox.click();
      await sleep(randomBetween(400, 800));
      await composeBox.type(message, { delay: randomBetween(30, 70) });
      await sleep(randomBetween(800, 1500));

      // Send button — submit type or aria-label
      const sendBtn = page.locator('button[type="submit"].msg-form__send-button, button[aria-label="Send"]').first();
      if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false) &&
          await sendBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
        await sendBtn.click();
        sent++;
        results.messagessent = (results.messagessent || 0) + 1;
        console.log(`[${config.nickname}] ✅ Follow-up sent to ${name} (${sent}/${target})`);
        await delays.betweenMessages();
      } else {
        console.log(`[${config.nickname}] Send button not ready for ${name}`);
        await page.keyboard.press('Escape').catch(() => {});
      }

      // Back to connections list for next iteration
      await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
        waitUntil: 'domcontentloaded', timeout: 20000
      });
      await sleep(randomBetween(2000, 3000));

    } catch (err) {
      console.log(`[${config.nickname}] Follow-up error: ${err.message.substring(0, 100)}`);
      await alertError(config, 'follow-ups', `send follow-up to ${name || 'unknown'}`, err.message.substring(0, 200), 'skipped and continued');
      await page.keyboard.press('Escape').catch(() => {});
      await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
        waitUntil: 'domcontentloaded', timeout: 20000
      }).catch(() => {});
      await sleep(randomBetween(2000, 3000));
    }
  }

  console.log(`[${config.nickname}] Follow-ups done — sent: ${sent}`);
  results.messagessent = sent;
}

/**
 * Extract connections from current page that are 3+ days old.
 * LinkedIn now uses hashed div classes — we use text content selectors.
 */
async function extractQualifiedConnections(page) {
  return page.evaluate(() => {
    // Inline — must live inside evaluate() (browser context, no Node.js access)
    function isOldEnoughInner(connectedText) {
      if (!connectedText) return false;
      const match = connectedText.match(/Connected on (\w+ \d+, \d{4})/);
      if (match) {
        const d = new Date(match[1]);
        if (!isNaN(d.getTime())) return (Date.now() - d.getTime()) / 86400000 >= 3;
      }
      const daysMatch = connectedText.match(/(\d+)\s+day/);
      if (daysMatch) return parseInt(daysMatch[1]) >= 3;
      if (/week|month|year/.test(connectedText.toLowerCase())) return true;
      return false;
    }

    const results = [];
    const seen = new Set();

    // Find all "Connected on [date]" paragraphs
    const dateParagraphs = [...document.querySelectorAll('p')].filter(p =>
      p.textContent.trim().startsWith('Connected on')
    );

    for (const dateP of dateParagraphs) {
      const dateText = dateP.textContent.trim(); // "Connected on March 17, 2026"
      if (!isOldEnoughInner(dateText)) continue;

      // Walk up to find card root — look for the div that contains a profile /in/ link
      let node = dateP;
      let card = null;
      for (let i = 0; i < 12; i++) {
        node = node.parentElement;
        if (!node) break;
        const link = node.querySelector('a[href*="linkedin.com/in/"]');
        const msgLink = node.querySelector('a[aria-label="Message"]');
        if (link && msgLink) {
          card = node;
          break;
        }
      }
      if (!card) continue;

      const profileLink = card.querySelector('a[href*="linkedin.com/in/"]');
      const href = profileLink ? profileLink.href : null;
      if (!href || seen.has(href)) continue;
      seen.add(href);

      // Extract name — aria-label is "View John Smith's profile" so strip it
      const rawAriaLabel = profileLink.getAttribute('aria-label') || '';
      const ariaName = rawAriaLabel.replace(/^View\s+/i, '').replace(/'s\s+profile.*$/i, '').trim();
      const nameFromEl = (card.querySelector('[data-anonymize="person-name"], strong, h3') || {}).textContent || '';
      const name = ariaName || nameFromEl;

      // Headline/title — skip the "Connected on" paragraph
      const allParas = [...card.querySelectorAll('p')];
      const titleEl = allParas.find(p => !p.textContent.includes('Connected on'));
      const title = titleEl ? titleEl.textContent.trim() : '';

      results.push({ name: name.trim(), title: title.trim(), href, dateText });
    }

    return results;
  });
}

module.exports = { runFollowUps };
