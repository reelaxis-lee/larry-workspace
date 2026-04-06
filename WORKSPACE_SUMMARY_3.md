# WORKSPACE_SUMMARY_3

Current state snapshot — Generated: 2026-04-06 09:52 PDT. Delete after review.

---

## scripts/phases/follow-ups.js

```js
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

```

---

## scripts/phases/connect-salenav.js

```js
/**
 * connect-salenav.js — Sales Navigator connection request phase
 * Selectors verified against live Sales Navigator DOM 2026-03-13
 */

const { delays, sleep, randomBetween } = require('../utils/browser');
const { generateConnectionRequest } = require('../utils/messenger');
const { alertError } = require('../utils/report');
const { setSearchExhausted } = require('../utils/status');

const EMPTY_PAGE_LIMIT = 10; // pages with zero eligible leads before declaring exhausted

async function runSalesNavConnections(page, config, results) {
  const target = config.dailyConnectionTarget || 35;
  let sent = 0;
  let skipped = 0;
  let consecutiveEmptyPages = 0; // pages where no leads passed the eligibility filter

  console.log(`[${config.nickname}] Sales Nav connections — target: ${target}`);

  await page.goto(config.salesNavSearchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delays.afterPageLoad();

  // Dismiss any teaching bubbles / tooltips that might block clicks
  await dismissTeachingBubbles(page);

  // Human-like scroll
  await page.mouse.wheel(0, 200);
  await sleep(randomBetween(1500, 3000));

  let pageNum = 1;

  while (sent < target) {
    const leads = await page.locator('[data-x-search-result="LEAD"]').all();

    if (leads.length === 0) {
      consecutiveEmptyPages++;
      console.log(`[${config.nickname}] No leads on page ${pageNum} — 0 results (${consecutiveEmptyPages}/${EMPTY_PAGE_LIMIT} consecutive empty pages)`);
      if (consecutiveEmptyPages >= EMPTY_PAGE_LIMIT) {
        console.log(`[${config.nickname}] Search exhausted — ${EMPTY_PAGE_LIMIT} consecutive pages with no results`);
        results.searchStatus = 'Exhausted';
        await flagSearchExhausted(config, results);
        break;
      }
      // Not yet at threshold — try next page before flagging
      const nextBtn = page.locator('button[aria-label="Next"]').first();
      const hasNext = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasNext) {
        // No next page either — genuinely exhausted
        console.log(`[${config.nickname}] No leads and no next page — search exhausted`);
        results.searchStatus = 'Exhausted';
        await flagSearchExhausted(config, results);
        break;
      }
      await nextBtn.click({ force: true });
      pageNum++;
      await delays.afterPageLoad();
      continue;
    }

    console.log(`[${config.nickname}] Page ${pageNum}: ${leads.length} leads`);
    let eligibleThisPage = 0;

    for (let i = 0; i < leads.length; i++) {
      if (sent >= target) break;

      const lead = leads[i];
      let name = ''; // declared outside try so catch block can reference it

      try {
        // Clear any modal overlays before reading/clicking this lead
        await dismissModals(page);

        // Read profile data from card
        name                = (await lead.locator('[data-anonymize="person-name"]').first().textContent({ timeout: 3000 }).catch(() => '')).trim();
        const title    = (await lead.locator('[data-anonymize="title"]').first().textContent({ timeout: 3000 }).catch(() => '')).trim();
        const company  = (await lead.locator('[data-anonymize="company-name"]').first().textContent({ timeout: 3000 }).catch(() => '')).trim();
        const location = (await lead.locator('[data-anonymize="location"]').first().textContent({ timeout: 3000 }).catch(() => '')).trim();
        const tenure   = (await lead.locator('[data-anonymize="job-title"]').first().textContent({ timeout: 3000 }).catch(() => '')).trim();
        const about    = (await lead.locator('[data-anonymize="person-blurb"]').first().textContent({ timeout: 2000 }).catch(() => '')).trim().substring(0, 300);

        if (!name) { skipped++; continue; }

        // Read degree
        const degreeEl = (await lead.locator('.artdeco-entity-lockup__degree').first().textContent({ timeout: 2000 }).catch(() => '')).trim();
        const degree = degreeEl.includes('1st') ? '1st' : degreeEl.includes('3rd') ? '3rd' : '2nd';

        // Read mutual connections
        const mutualEl = await lead.locator('[data-control-name="search_spotlight_second_degree_connection"]').first().textContent({ timeout: 2000 }).catch(() => '');
        const mutualMatch = mutualEl.match(/(\d+)/);
        const mutualConnections = mutualMatch ? parseInt(mutualMatch[1]) : 0;

        console.log(`[${config.nickname}] [${i+1}/${leads.length}] ${name} — ${title} at ${company} (${degree})`);

        // Skip rules
        if (degree === '1st') {
          console.log(`  Skip: 1st degree`);
          skipped++;
          continue;
        }

        if (degree === '3rd') {
          console.log(`  Skip: 3rd degree — InMail candidate`);
          results.flags = results.flags || [];
          results.flags.push(`InMail candidate: ${name}, ${title} at ${company}`);
          skipped++;
          continue;
        }

        // Check if already saved (contacted)
        const isSaved = await lead.locator('button[aria-label*="Saved"]').first().isVisible({ timeout: 1000 }).catch(() => false);
        if (isSaved) {
          console.log(`  Skip: already saved`);
          skipped++;
          continue;
        }

        // This lead passed all filters — eligible
        eligibleThisPage++;

        // Generate personalized message
        const leadProfile = { name, title, company, location, tenure, about, mutualConnections, degree };
        console.log(`  Generating message...`);
        const message = await generateConnectionRequest(config, leadProfile);
        console.log(`  Message (${message.length} chars): "${message.substring(0, 80)}..."`);

        // Primary: navigate directly to their LinkedIn profile page and connect from there
        let ok = false;
        try {
          ok = await sendViaProfilePage(page, lead, message, name, config.nickname);
        } catch (sendErr) {
          // Only alert on genuine send failures — not on skips or soft failures
          await alertError(config, 'connections', `send connection request to ${name}`, sendErr.message.substring(0, 200), 'skipped and continued');
          skipped++;
          await page.keyboard.press('Escape').catch(() => {});
          await sleep(randomBetween(2000, 4000));
          continue;
        }

        if (ok) {
          sent++;
          results.connectionsent = (results.connectionsent || 0) + 1;
          console.log(`  ✅ Sent (${sent}/${target})`);
          await delays.betweenConnections();
        } else {
          skipped++;
          console.log(`  ⚠️  Could not send — skipping`);
          await sleep(randomBetween(3000, 6000));
        }

        // Dismiss any post-action bubbles
        await dismissTeachingBubbles(page);

      } catch (err) {
        // Outer catch covers lead data reading errors — not alertable, just skip
        console.log(`  Error: ${err.message.substring(0, 100)}`);
        skipped++;
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(randomBetween(2000, 4000));
      }
    }

    // After processing this page: check if it was empty (no eligible leads)
    if (eligibleThisPage === 0) {
      consecutiveEmptyPages++;
      console.log(`[${config.nickname}] Page ${pageNum}: 0 eligible leads (${consecutiveEmptyPages}/${EMPTY_PAGE_LIMIT} consecutive empty pages)`);
      if (consecutiveEmptyPages >= EMPTY_PAGE_LIMIT) {
        console.log(`[${config.nickname}] Search exhausted — ${EMPTY_PAGE_LIMIT} pages with no eligible leads`);
        results.searchStatus = 'Exhausted';
        await flagSearchExhausted(config, results);
        break;
      }
    } else {
      consecutiveEmptyPages = 0; // reset on any page that had eligible leads
    }

    // Next page
    if (sent < target) {
      await dismissModals(page);
      const nextBtn = page.locator('button[aria-label="Next"]').first();
      const hasNext = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasNext && await nextBtn.isEnabled().catch(() => false)) {
        console.log(`[${config.nickname}] Next page...`);
        await nextBtn.click({ force: true });
        pageNum++;
        await delays.afterPageLoad();
        await page.mouse.wheel(0, 200);
        await sleep(randomBetween(2000, 4000));
        await dismissTeachingBubbles(page);
      } else {
        console.log(`[${config.nickname}] No next page — done`);
        results.searchStatus = 'Exhausted';
        await flagSearchExhausted(config, results);
        break;
      }
    }
  }

  console.log(`[${config.nickname}] Done — sent: ${sent}, skipped: ${skipped}`);
  results.connectionsent = sent;
}

// ─── Connect via "..." overflow menu ─────────────────────────────

async function sendViaOverflowMenu(page, leadEl, message, name, nickname) {
  try {
    // Click the "..." overflow button on this lead card
    const moreBtn = leadEl.locator('button[aria-label*="See more actions for"]').first();
    const visible = await moreBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) return false;

    await moreBtn.click();
    await sleep(randomBetween(800, 1500));

    // Look for Connect in the dropdown
    const connectItem = page.locator('[role="menuitem"]:has-text("Connect"), li:has-text("Connect") button').first();
    const connectVisible = await connectItem.isVisible({ timeout: 3000 }).catch(() => false);

    if (!connectVisible) {
      await page.keyboard.press('Escape');
      await sleep(500);
      return false;
    }

    await connectItem.click();
    await sleep(randomBetween(1000, 2000));

    return await fillAndSendInvite(page, message, name, nickname);

  } catch (err) {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

// ─── Connect via Sales Nav lead profile page → actions overflow → Connect ────
// Verified flow 2026-03-13:
//   1. Navigate to /sales/lead/... URL
//   2. Click button[aria-label="Open actions overflow menu"]
//   3. Dropdown shows: Connect / View LinkedIn profile / Copy LinkedIn.com URL
//   4. Click Connect → fill invite dialog → send
//   5. Navigate back to search URL

async function sendViaProfilePage(page, leadEl, message, name, nickname) {
  const searchUrl = page.url();
  try {
    const salesNavHref = await leadEl.locator('[data-control-name="view_lead_panel_via_search_lead_name"]')
      .first().getAttribute('href').catch(() => null);
    if (!salesNavHref) return false;

    const leadUrl = salesNavHref.startsWith('http') ? salesNavHref : `https://www.linkedin.com${salesNavHref}`;
    await page.goto(leadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(3000, 5000));

    // Click the "..." actions overflow menu
    const moreBtn = page.locator('button[aria-label="Open actions overflow menu"]').first();
    if (!await moreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`  No overflow menu found`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(randomBetween(2000, 3000));
      return false;
    }

    await moreBtn.click();
    await sleep(randomBetween(800, 1400));

    // Dropdown has: Connect / View LinkedIn profile / Copy LinkedIn.com URL
    // Target the Connect item specifically
    const connectItem = page.locator('li:has-text("Connect"):not(:has-text("View")):not(:has-text("Copy"))').first();
    if (!await connectItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(`  Connect not in overflow menu (already connected?)`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(randomBetween(2000, 3000));
      return false;
    }

    await connectItem.click();
    await sleep(randomBetween(1200, 2000));

    const ok = await fillAndSendInvite(page, message, name, nickname);

    // Return to search results
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(2500, 4000));
    return ok;

  } catch (err) {
    console.log(`  profilePage error: ${err.message.substring(0, 80)}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(randomBetween(2000, 3000));
    return false;
  }
}

// ─── Connect via profile name click → panel ───────────────────────

async function sendViaProfilePanel(page, leadEl, message, name, nickname) {
  try {
    // Dismiss any modal/iframe overlays before clicking
    await dismissModals(page);

    // Click the lead name to open the right-side profile panel
    const nameLink = leadEl.locator('[data-control-name="view_lead_panel_via_search_lead_name"]').first();
    await nameLink.click({ force: true });
    await sleep(randomBetween(2500, 4000));

    // Panel opens as an aside/drawer — wait for it
    // Connect button may be direct or inside a "More" overflow
    // Try direct Connect button first (various Sales Nav panel selectors)
    const connectSelectors = [
      'button[data-anchor-connect-lead]',
      'aside button:has-text("Connect")',
      '[data-view-name*="profile"] button:has-text("Connect")',
      '.profile-detail button:has-text("Connect")',
      'section button:has-text("Connect")',
    ];

    let connectBtn = null;
    for (const sel of connectSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        connectBtn = btn;
        break;
      }
    }

    // If not found directly, try the panel's "..." overflow menu
    if (!connectBtn) {
      const panelMore = page.locator('aside button[aria-label*="More"], aside button[data-search-overflow-trigger]').first();
      if (await panelMore.isVisible({ timeout: 2000 }).catch(() => false)) {
        await panelMore.click();
        await sleep(randomBetween(800, 1400));
        const menuConnect = page.locator('[role="menuitem"]:has-text("Connect"), li:has-text("Connect")').first();
        if (await menuConnect.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuConnect.click();
          await sleep(randomBetween(1000, 2000));
          return await fillAndSendInvite(page, message, name, nickname);
        }
        await page.keyboard.press('Escape').catch(() => {});
      }
      // Close panel and give up
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    await connectBtn.click();
    await sleep(randomBetween(1000, 2000));
    return await fillAndSendInvite(page, message, name, nickname);

  } catch (err) {
    console.log(`  panel error: ${err.message.substring(0, 80)}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

// ─── Fill invite dialog and send ─────────────────────────────────

async function fillAndSendInvite(page, message, name, nickname) {
  try {
    // Try "Add a note" button first
    const addNoteBtn = page.locator('button:has-text("Add a note")').first();
    if (await addNoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addNoteBtn.click();
      await sleep(randomBetween(600, 1200));
    }

    // Find textarea
    const textarea = page.locator('textarea[name="message"], textarea#custom-message, [role="dialog"] textarea').first();
    if (!await textarea.isVisible({ timeout: 4000 }).catch(() => false)) {
      // No note field — send without note
      const sendBtn = page.locator('button:has-text("Send"), button:has-text("Send invitation")').first();
      if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sendBtn.click();
        await sleep(randomBetween(1000, 2000));
        return true;
      }
      return false;
    }

    if (message.length > 300) {
      console.log(`  Message too long (${message.length}) — truncating`);
      message = message.substring(0, 297) + '...';
    }

    await textarea.click();
    await sleep(randomBetween(400, 800));
    await textarea.fill(message);
    await sleep(randomBetween(600, 1200));

    const sendBtn = page.locator('button:has-text("Send"), button:has-text("Send invitation")').first();
    await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
    await sendBtn.click();
    await sleep(randomBetween(1500, 2500));

    // Dismiss any modal
    const dismiss = page.locator('button:has-text("Dismiss"), button[aria-label="Dismiss"]').first();
    if (await dismiss.isVisible({ timeout: 2000 }).catch(() => false)) await dismiss.click();

    return true;

  } catch (err) {
    console.log(`  fillAndSend error: ${err.message.substring(0, 80)}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

// ─── Dismiss modals + teaching bubbles ───────────────────────────

async function dismissTeachingBubbles(page) {
  try {
    const dismissBtns = await page.locator('[data-test-enterprise-teaching-bubble-dismiss-btn]').all();
    for (const btn of dismissBtns) {
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click();
        await sleep(300);
      }
    }
  } catch (_) {}
}

async function dismissModals(page) {
  try {
    // Close any "Recent activity" or other iframes blocking pointer events
    // Press Escape to close any open overlays
    await page.keyboard.press('Escape');
    await sleep(400);

    // Click a safe empty area in the search results to defocus anything open
    await page.click('[data-x-search-results]', { force: true, timeout: 1000 }).catch(() => {});

    // Dismiss teaching bubbles too
    await dismissTeachingBubbles(page);

    // Remove blocking iframes via JS if still present
    const hasBlockingIframe = await page.locator('#hue-web-modal-outlet iframe').isVisible({ timeout: 500 }).catch(() => false);
    if (hasBlockingIframe) {
      await page.evaluate(() => {
        const outlet = document.getElementById('hue-web-modal-outlet');
        if (outlet) outlet.innerHTML = '';
      }).catch(() => {});
      await sleep(300);
    }
  } catch (_) {}
}

/**
 * Post a search-exhausted alert to Slack and update STATUS.md.
 */
async function flagSearchExhausted(config, results) {
  const { postSlackMessage } = require('../utils/report');
  const { setSearchExhausted } = require('../utils/status');

  const searchId = (config.salesNavSearchUrl || '').match(/savedSearchId=(\d+)/)?.[1] || config.salesNavSearchUrl || 'unknown';

  const msg =
    `🚩 *LARRY FLAG -- SEARCH EXHAUSTED*\n` +
    `Profile: ${config.nickname}\n` +
    `Search ID: ${searchId}\n` +
    `Result: 0 eligible leads found after ${EMPTY_PAGE_LIMIT} pages\n` +
    `Action: Connection phase ending early -- new search URL needed`;

  postSlackMessage(msg).catch(e => console.error(`[alert] Slack post failed: ${e.message}`));
  setSearchExhausted(config.nickname, config.salesNavSearchUrl || '');
  results.flags = results.flags || [];
  results.flags.push(`Search exhausted — new Sales Nav URL needed for ${config.nickname}`);
  console.log(`[${config.nickname}] 🚩 Search exhausted flag set in STATUS.md`);
}

module.exports = { runSalesNavConnections };

```

---

## scripts/phases/inmails.js

```js
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

```

---

## scripts/phases/inbox.js

```js
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

```

---

## scripts/webhook-server.js

```js
/**
 * webhook-server.js
 * Local webhook server on the Mac Mini for remote LinkedIn onboarding.
 * Receives login requests from the Vercel onboarding app, runs Playwright,
 * handles 2FA back-channel, saves browser sessions.
 *
 * Run: node scripts/webhook-server.js
 * Exposed via: cloudflared tunnel (see TOOLS.md)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { linkedInLogin } = require('./linkedin-login');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.WEBHOOK_PORT || 3743;

// Active login sessions: Map<sessionId, sessionState>
const sessions = new Map();

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  const token = req.headers['x-webhook-secret'] || req.body?.secret;
  if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── POST /login ───────────────────────────────────────────────────────────────
// Start a LinkedIn login for a new profile.
// Body: { nickname, email, password, secret }
app.post('/login', requireSecret, async (req, res) => {
  const { nickname, email, password } = req.body;

  if (!nickname || !email || !password) {
    return res.status(400).json({ error: 'Missing nickname, email, or password' });
  }

  // Check if profile context already exists (already logged in)
  const contextDir = path.resolve(
    require('os').homedir(),
    `.openclaw/workspace/profiles/${nickname}/browser-context`
  );
  const cookieFile = path.join(contextDir, 'Default', 'Cookies');
  if (fs.existsSync(cookieFile)) {
    return res.json({ status: 'already_exists', message: 'Session already saved for this profile.' });
  }

  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    nickname,
    status: 'logging_in',
    message: null,
    codeResolver: null,
    context: null,
    page: null,
    startedAt: Date.now(),
  };

  sessions.set(sessionId, session);

  // Run login async — don't block the response
  linkedInLogin(nickname, email, password, session)
    .then(() => {
      if (session.status === 'success') {
        console.log(`[webhook] ✅ Login complete for ${nickname}`);
        notifySlack(nickname);
      }
    })
    .catch(err => {
      session.status = 'error';
      session.message = err.message;
      console.error(`[webhook] Login error for ${nickname}:`, err.message);
    });

  res.json({ sessionId, status: 'logging_in' });
});

// ── GET /status/:sessionId ────────────────────────────────────────────────────
// Poll for login status.
app.get('/status/:sessionId', requireSecret, (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    status: session.status,   // logging_in | need_2fa | success | error
    message: session.message || null,
  });
});

// ── POST /verify-2fa ──────────────────────────────────────────────────────────
// Submit a 2FA verification code.
// Body: { sessionId, code, secret }
app.post('/verify-2fa', requireSecret, (req, res) => {
  const { sessionId, code } = req.body;
  if (!sessionId || !code) {
    return res.status(400).json({ error: 'Missing sessionId or code' });
  }

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'need_2fa') {
    return res.status(400).json({ error: `Session is in state: ${session.status}` });
  }
  if (!session.codeResolver) {
    return res.status(500).json({ error: '2FA resolver not ready — try again in a moment' });
  }

  session.status = 'verifying';
  session.codeResolver(code);
  res.json({ status: 'verifying' });
});

// ── POST /intake ──────────────────────────────────────────────────────────────
// Receive completed intake JSON from Vercel, create ACCOUNT.md + HISTORY.md.
// Body: { intake: {...}, secret }
app.post('/intake', requireSecret, async (req, res) => {
  const { intake } = req.body;
  if (!intake || !intake.name) {
    return res.status(400).json({ error: 'Missing intake data' });
  }

  try {
    const nickname = deriveNickname(intake.name);
    const profileDir = path.resolve(require('os').homedir(), `.openclaw/workspace/profiles/${nickname}`);
    const fs = require('fs');
    fs.mkdirSync(profileDir, { recursive: true });

    // Write intake.json for reference
    fs.writeFileSync(path.join(profileDir, 'intake.json'), JSON.stringify(intake, null, 2));

    // Generate message templates via Claude
    console.log(`[webhook] Generating message templates for ${intake.name}...`);
    const templates = await generateMessageTemplates(intake);

    // Generate account.json — source of truth
    const jsonPath = path.join(profileDir, 'account.json');
    if (fs.existsSync(jsonPath)) {
      const jsonBackup = path.join(profileDir, `account.json.bak.${Date.now()}`);
      fs.copyFileSync(jsonPath, jsonBackup);
      console.log(`[webhook] Backed up existing account.json → ${path.basename(jsonBackup)}`);
    }
    const accountJson = generateAccountJson(nickname, intake, templates);
    fs.writeFileSync(jsonPath, JSON.stringify(accountJson, null, 2));
    console.log(`[webhook] ✅ account.json written for ${nickname}`);

    // Generate ACCOUNT.md — human-readable reference copy (not source of truth)
    const accountPath = path.join(profileDir, 'ACCOUNT.md');
    if (fs.existsSync(accountPath)) {
      const backupPath = path.join(profileDir, `ACCOUNT.md.bak.${Date.now()}`);
      fs.copyFileSync(accountPath, backupPath);
      console.log(`[webhook] Backed up existing ACCOUNT.md → ${path.basename(backupPath)}`);
    }
    const accountMd = '> **REFERENCE ONLY — source of truth is account.json. Do not edit this file directly.**\n\n' +
                      generateAccountMd(nickname, intake, templates);
    fs.writeFileSync(accountPath, accountMd);

    // Create blank HISTORY.md
    const historyPath = path.join(profileDir, 'HISTORY.md');
    if (!fs.existsSync(historyPath)) {
      const today = new Date().toISOString().split('T')[0];
      fs.writeFileSync(historyPath,
        `# Activity History — ${intake.name}\n\n` +
        `| Date | Action |\n|------|--------|\n` +
        `| ${today} | Profile created — intake complete |\n\n` +
        `## Log\n`
      );
    }

    console.log(`[webhook] ✅ Profile created for ${intake.name} → ${nickname}`);
    await notifySlackIntake(intake, nickname);
    res.json({ status: 'ok', nickname });

  } catch (err) {
    console.error('[webhook] Intake error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function deriveNickname(name) {
  return name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function generateMessageTemplates(intake) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[webhook] No ANTHROPIC_API_KEY — skipping template generation');
    return null;
  }

  const firstName = intake.name.split(' ')[0];
  const talkingPoints = Array.isArray(intake.talkingPoints) ? intake.talkingPoints.join('\n- ') : intake.talkingPoints || '';
  const avoid = Array.isArray(intake.avoid) ? intake.avoid.join(', ') : intake.avoid || '';
  const titles = (intake.icp?.titles || []).slice(0, 5).join(', ');

  const prompt = `You are writing LinkedIn outreach message templates for a professional named ${firstName}.

Here is their campaign info:
- Offer: ${intake.offer}
- Unique angle: ${intake.angle || 'N/A'}
- Tone: ${intake.tone}
- Talking points: ${talkingPoints}
- Avoid: ${avoid}
- CTA: ${intake.cta}
- Booking link: ${intake.bookingLink || 'None'}
- Free offer/hook: ${intake.freeOffer || 'None'}
- Target titles: ${titles}
- Target industries: ${(intake.icp?.industries || []).join(', ')}
- Connection opener style: ${intake.connectionOpener || 'not specified'}
- Message length preference: ${intake.messageLength || 'short'}
- Additional messaging notes: ${intake.messagingNotes || 'none'}
- Auto-signature: ${intake.autoSignature ? `Yes — "${intake.autoSignature}" (do NOT write a sign-off in the message body)` : 'No — include a natural sign-off'}

Write THREE message templates:

1. CONNECTION REQUEST (max 300 characters — this is a hard LinkedIn limit. count carefully.)
2. FOLLOW-UP MESSAGE (sent 3 days after connecting — under 100 words)  
3. INMAIL MESSAGE (for Open Profiles — subject line + body under 120 words)

Rules:
- Each template uses [First Name] as placeholder
- Match the tone exactly — if casual, be casual. If direct, be direct.
- No filler openers ("Hope you're well", "I wanted to reach out", etc.)
- The connection request must be under 300 characters — count the characters
- Follow-ups should feel human, not like a sequence drip
- InMail subject line: specific and benefit-oriented, under 8 words
- Respect the avoid list strictly
- If auto-signature is set, do NOT write a sign-off in the body
- Write templates ${firstName} would actually send — voice-matched, not generic

Format your response EXACTLY like this (no other text):

CONNECTION_REQUEST:
[the connection request text]

FOLLOWUP_SUBJECT:
[subject line if applicable, else NONE]

FOLLOWUP_MESSAGE:
[the follow-up message text]

INMAIL_SUBJECT:
[the inmail subject line]

INMAIL_BODY:
[the inmail body text]`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;

    // Parse sections
    const extract = (key) => {
      const match = text.match(new RegExp(`${key}:\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
      return match ? match[1].trim() : '';
    };

    return {
      connectionRequest: extract('CONNECTION_REQUEST'),
      followupMessage: extract('FOLLOWUP_MESSAGE'),
      inmailSubject: extract('INMAIL_SUBJECT'),
      inmailBody: extract('INMAIL_BODY'),
    };
  } catch (err) {
    console.error('[webhook] Template generation failed:', err.message);
    return null;
  }
}

// Map common timezone aliases → valid IANA strings
const TIMEZONE_MAP = {
  'eastern':             'America/New_York',
  'eastern time':        'America/New_York',
  'et':                  'America/New_York',
  'est':                 'America/New_York',
  'edt':                 'America/New_York',
  'central':             'America/Chicago',
  'central time':        'America/Chicago',
  'ct':                  'America/Chicago',
  'cst':                 'America/Chicago',
  'cdt':                 'America/Chicago',
  'mountain':            'America/Denver',
  'mountain time':       'America/Denver',
  'mt':                  'America/Denver',
  'mst':                 'America/Denver',
  'mdt':                 'America/Denver',
  'pacific':             'America/Los_Angeles',
  'pacific time':        'America/Los_Angeles',
  'pt':                  'America/Los_Angeles',
  'pst':                 'America/Los_Angeles',
  'pdt':                 'America/Los_Angeles',
  'alaska':              'America/Anchorage',
  'hawaii':              'Pacific/Honolulu',
  'utc':                 'UTC',
  'gmt':                 'UTC',
};

function normalizeTimezone(raw) {
  if (!raw) return 'America/Los_Angeles';
  const trimmed = raw.trim();

  // Already a valid IANA string (contains slash, no spaces beyond the slash)
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(trimmed)) return trimmed;

  // Strip parenthetical suffixes: "America/New_York (Eastern)" → "America/New_York"
  const stripped = trimmed.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(stripped)) return stripped;

  // Try alias lookup (case-insensitive)
  const lookup = stripped.toLowerCase();
  if (TIMEZONE_MAP[lookup]) return TIMEZONE_MAP[lookup];

  // Fallback
  console.warn(`[webhook] Unknown timezone "${raw}" — defaulting to America/Los_Angeles`);
  return 'America/Los_Angeles';
}

function generateAccountMd(nickname, i, templates) {
  const titles = (i.icp?.titles || []).join(', ') || 'Not specified';
  const industries = (i.icp?.industries || []).join(', ') || 'Not specified';
  const talkingPoints = Array.isArray(i.talkingPoints) ? i.talkingPoints.join('\n- ') : i.talkingPoints || 'Not specified';
  const avoid = Array.isArray(i.avoid) ? i.avoid.join(', ') : i.avoid || 'None';
  const displayName = i.name || nickname;

  return `# LinkedIn Larry — Account Config: ${displayName}

---

## ACCOUNT IDENTITY

| Field | Value |
|-------|-------|
| Account nickname | ${nickname} |
| LinkedIn profile name | ${displayName} |
| LinkedIn URL | ${i.linkedinUrl || 'Not provided'} |
| LinkedIn email | ${i.email || '[set before first run]'} |
| Chrome profile path | [to be configured] |
| Customer report email | ${i.email || '[set before first run]'} |
| Timezone | ${normalizeTimezone(i.timezone)} |
| Persona location | ${i.city || 'Not specified'} |
| Bright Data zone | [to be configured] |
| Bright Data proxy URL | [to be configured] |

---

## PLAYBOOK

| Field | Value |
|-------|-------|
| Lead source | [ ] Sales Navigator  [ ] Seamless.ai |
| Sales Nav search URL | ${i.salesNavUrl || '[to be configured]'} |
| Seamless list path | N/A |
| Search status | [ ] Active |

---

## DAILY LIMITS

| Action | Daily Target | Daily Max |
|--------|-------------|-----------|
| Connection requests | 30–40 | 40 |
| Messages (follow-ups + InMails combined) | 30–40 | 40 |
| Post likes | 5–10 | 10 |
| Post comments | 3–6 | 6 |

---

## SESSION TIMING

| Field | Value |
|-------|-------|
| Timezone | ${normalizeTimezone(i.timezone)} |
| Earliest start | 7:00 AM local |
| Latest start | Must complete by 11:00 PM local |
| Target session length | 45–60 min |

---

## INMAIL CREDITS

| Field | Value |
|-------|-------|
| Monthly InMail credit allotment | 150/month |
| Open Profile InMails | Free — do not deduct from credit count |
| Paid credit usage | Only use paid credits if explicitly instructed |

Always prefer Open Profile targets.

---

## AUTO-SIGNATURE

| Field | Value |
|-------|-------|
| LinkedIn auto-signature enabled | ${i.autoSignature ? 'Yes' : 'No'} |
| Signature text | ${i.autoSignature || 'None — include sign-off in message'} |

${i.autoSignature ? 'Do NOT type a sign-off. It is appended automatically.' : 'Include a natural sign-off in each message.'}

---

## TARGET ICP

| Field | Value |
|-------|-------|
| Job titles | ${titles} |
| Industries | ${industries} |
| Company size | ${i.icp?.companySize || 'Not specified'} |
| Geography | ${i.icp?.geography || 'Not specified'} |

---

## OFFER & VALUE PROP

**What this profile offers:**
${i.offer || 'Not specified'}

**Unique angle / differentiator:**
${i.angle || 'Not specified'}

**Talking points:**
- ${talkingPoints}

**Avoid saying:**
${avoid}

**Free offer / hook:**
${i.freeOffer || 'None'}

---

## CTA & MESSAGING

**Primary CTA:**
${i.cta || 'Not specified'}

**Booking link:** ${i.bookingLink || 'None'}

---

## TONE & VOICE

| Field | Value |
|-------|-------|
| Overall tone | ${i.tone || 'Professional and conversational'} |

---

## CAMPAIGN GOALS

**Success looks like:**
${i.goals || 'Not specified'}

**Timeline:**
${i.timeline || 'Ongoing'}

---

## CONNECTION REQUEST GUIDANCE

Max 300 characters (hard LinkedIn limit). ${i.connectionOpener ? `Opening style: ${i.connectionOpener}.` : ''} ${i.messageLength === 'short' ? 'Keep it punchy.' : ''}

${templates?.connectionRequest ? `**Template (generated from intake):**
\`\`\`
${templates.connectionRequest}
\`\`\`` : `**Template:** [To be written — connection opener style: ${i.connectionOpener || 'not specified'}]`}

**What NOT to do:**
${Array.isArray(i.avoid) ? i.avoid.map(a => `- ${a}`).join('\n') : `- ${i.avoid || 'See avoid list above'}`}

---

## FOLLOW-UP MESSAGE GUIDANCE

Sent 3 days after connecting. ${i.messageLength ? `Length preference: ${i.messageLength}.` : 'Keep it short.'}

${templates?.followupMessage ? `**Template (generated from intake):**
\`\`\`
${templates.followupMessage}
\`\`\`` : `**Template:** [To be written]`}

${i.autoSignature ? `Do NOT type a sign-off. "${i.autoSignature}" is appended automatically.` : 'Include a natural sign-off.'}

---

## INMAIL GUIDANCE

Open Profiles only (free). Subject line under 8 words.

${templates?.inmailSubject ? `**Subject line template:**
\`\`\`
${templates.inmailSubject}
\`\`\`` : '**Subject line:** [To be written]'}

${templates?.inmailBody ? `**Body template (generated from intake):**
\`\`\`
${templates.inmailBody}
\`\`\`` : '**Body:** [To be written]'}

---

## SKIP RULES

1. Skip "Saved" leads — already contacted
2. Skip 1st-degree connections — already connected
3. Skip 3rd-degree connections — flag high-value ones as InMail candidates
4. Skip leads clearly outside the target ICP

---

## CHANGE LOG

| Date | Change | Updated by |
|------|--------|------------|
| ${new Date().toISOString().split('T')[0]} | Profile created via onboarding intake | Larry |
`;
}

/**
 * Build an account.json object from intake data + generated templates.
 * This is the source of truth; ACCOUNT.md is generated as a reference copy.
 */
function generateAccountJson(nickname, i, templates) {
  const today = new Date().toISOString().split('T')[0];
  const tz    = normalizeTimezone(i.timezone);

  return {
    nickname,
    fullName:         i.name || nickname,
    company:          i.company || '',
    timezone:         tz,
    salesNavUrl:      i.salesNavUrl || '',
    proxy:            'see .env',
    autoSignature:    !!i.autoSignature,
    dailyLimits: {
      connections: 40,
      messages:    40,
      inmails:     5,
    },
    icp: [
      i.icp?.titles?.length    ? `Job titles: ${i.icp.titles.join(', ')}.`      : '',
      i.icp?.industries?.length ? `Industries: ${i.icp.industries.join(', ')}.` : '',
      i.icp?.companySize       ? `Company size: ${i.icp.companySize}.`           : '',
      i.icp?.geography         ? `Geography: ${i.icp.geography}.`                : '',
    ].filter(Boolean).join(' '),
    offerDescription:        i.offerDescription  || i.offer || '',
    voiceTone:               i.tone              || '',
    followUpGuidance:        i.followUpGuidance  || '',
    inMailGuidance:          i.inMailGuidance    || '',
    postEngagementGuidance:  '',
    messageTemplates: {
      connectionRequest: {
        a: templates?.connectionRequest || '',
        b: '',
      },
      followUp: {
        a: templates?.followupMessage || '',
        b: '',
      },
      inMail: {
        subject: templates?.inmailSubject || '',
        body:    templates?.inmailBody    || '',
      },
    },
    webhookEndpoints: {},
    dashboardMeta: {
      createdAt:    today,
      lastModified: today,
      modifiedBy:   'larry',
    },
  };
}

async function notifySlackIntake(intake, nickname) {
  const message = `🆕 New profile intake received: *${intake.fullName || intake.name}* (${intake.company})\n\nProfile folder: \`profiles/${nickname}/\`\n✅ \`account.json\` created (source of truth)\n✅ \`ACCOUNT.md\` created (reference copy)\n✅ \`HISTORY.md\` created\n\n*Still needed before first run:*\n1. Configure Bright Data proxy zone (update \`account.json\` or \`.env\`)\n2. Set Sales Navigator search URL in \`account.json\` if not provided\n3. Run setup-profile.js to save browser context`;
  await postSlackGateway(message);
}

// ── Cleanup old sessions every 30 min ────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.startedAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

// ── Slack gateway helper (shared by all webhook notifications) ───────────────
function postSlackGateway(message) {
  const http = require('http');
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const port  = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789');
  if (!token) return Promise.resolve();
  const body = JSON.stringify({
    tool: 'message',
    args: { action: 'send', target: 'C0ALWJRPQ6R', message },
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
    req.on('error', e => { console.error('[webhook] Slack notify failed:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

// ── Slack notification ────────────────────────────────────────────────────────
async function notifySlack(nickname) {
  const message = `✅ LinkedIn session saved for *${nickname}* — ready to run.\n\nStill needed:\n1. Configure Bright Data proxy zone in \`account.json\` or \`.env\`\n2. Profile will run at next scheduler cycle`;
  await postSlackGateway(message);
}

app.listen(PORT, () => {
  console.log(`\n🔗 Webhook server running on http://localhost:${PORT}`);
  console.log(`   Expose with: cloudflared tunnel --url http://localhost:${PORT}`);
});

```
