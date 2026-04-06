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
