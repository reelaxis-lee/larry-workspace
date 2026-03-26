/**
 * save-search.js — Convert a raw Sales Navigator query URL to a saved search.
 *
 * Use when a profile is given a raw Sales Nav URL (contains `query=` or `recentSearchParam`
 * instead of `savedSearchId`). This opens the URL in the profile's browser session,
 * saves it as a named search, and prints the stable savedSearchId.
 *
 * Usage:
 *   node scripts/save-search.js <nickname> "<salesNavUrl>" "<searchName>"
 *
 * Example:
 *   node scripts/save-search.js nicole "https://www.linkedin.com/sales/search/people?query=..." "Nicole ICP — B2B Tech VPs US"
 *
 * After running: update ACCOUNT.md with the savedSearchId URL printed at the end.
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const nickname = process.argv[2];
const searchUrl = process.argv[3];
const searchName = process.argv[4] || `${nickname} ICP Search`;

if (!nickname || !searchUrl) {
  console.error('Usage: node scripts/save-search.js <nickname> "<salesNavUrl>" "<searchName>"');
  process.exit(1);
}

if (searchUrl.includes('savedSearchId=')) {
  console.log('✅ URL already contains savedSearchId — no conversion needed.');
  console.log('   Use this URL directly in ACCOUNT.md.');
  process.exit(0);
}

const contextDir = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/browser-context`);

(async () => {
  console.log(`[save-search] Profile: ${nickname}`);
  console.log(`[save-search] Search name: "${searchName}"`);
  console.log('[save-search] Launching Chrome...');

  const context = await chromium.launchPersistentContext(contextDir, {
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('[save-search] Navigating to Sales Navigator search...');
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000); // Sales Nav renders slowly

  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    console.error('[save-search] ERROR: Session expired — run setup-profile.js first');
    await context.close();
    process.exit(1);
  }

  // Find and click the "Save search" toggle
  const saveToggle = page.locator(
    'label:has-text("Save search"), button[aria-label*="Save search" i], input[aria-label*="Save search" i]'
  ).first();

  const toggleVisible = await saveToggle.isVisible({ timeout: 5000 }).catch(() => false);

  if (toggleVisible) {
    console.log('[save-search] Clicking Save search toggle...');
    await saveToggle.click();
  } else {
    const fallback = page.locator('[data-test-id*="save-search"], label').filter({ hasText: 'Save search' }).first();
    const fallbackVisible = await fallback.isVisible({ timeout: 3000 }).catch(() => false);
    if (fallbackVisible) {
      await fallback.click();
    } else {
      console.error('[save-search] ERROR: Could not find Save search toggle');
      await context.close();
      process.exit(2);
    }
  }

  await page.waitForTimeout(2000);

  // Fill in name if dialog appears
  const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="search" i]').first();
  const nameVisible = await nameInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (nameVisible) {
    await nameInput.clear();
    await nameInput.fill(searchName);
    console.log(`[save-search] Named search: "${searchName}"`);
    await page.waitForTimeout(500);
    const confirmBtn = page.locator('button:has-text("Save")').last();
    await confirmBtn.click();
    await page.waitForTimeout(3000);
  }

  // Extract savedSearchId from current URL
  const finalUrl = page.url();
  const savedIdMatch = finalUrl.match(/savedSearchId=(\d+)/);

  if (savedIdMatch) {
    const savedSearchId = savedIdMatch[1];
    const cleanUrl = `https://www.linkedin.com/sales/search/people?savedSearchId=${savedSearchId}`;
    console.log('\n✅ Search saved successfully!');
    console.log(`   Saved search ID: ${savedSearchId}`);
    console.log(`   Clean URL: ${cleanUrl}`);
    console.log(`\n→ Update profiles/${nickname}/ACCOUNT.md:`);
    console.log(`  | Sales Nav search URL | ${cleanUrl} |`);
  } else {
    console.log('[save-search] Save may have succeeded but no savedSearchId in URL.');
    console.log('[save-search] Check Sales Navigator saved searches manually.');
  }

  await context.close();
})().catch(e => {
  console.error('[save-search] Error:', e.message);
  process.exit(1);
});
