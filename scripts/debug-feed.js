/**
 * debug-feed.js — Verify new post-engagement selectors work (read-only check, no actions).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const nickname = process.argv[2] || 'chris';
const contextDir = path.join(os.homedir(), `.openclaw/workspace/profiles/${nickname}/browser-context`);

(async () => {
  const browser = await chromium.launchPersistentContext(contextDir, {
    channel: 'chrome', headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    viewport: null,
  });

  const page = await browser.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(1200); }
  await page.waitForTimeout(2000);

  // Test new selectors
  const posts = page.locator('div[role="listitem"]');
  const postCount = await posts.count();
  console.log(`\nPost containers (div[role="listitem"]): ${postCount}`);

  let likeablePosts = 0;
  let commentablePosts = 0;

  for (let i = 0; i < Math.min(postCount, 8); i++) {
    const post = posts.nth(i);
    const hasCtrl = await post.locator('button[aria-label^="Open control menu for post by"]').first().isVisible({ timeout: 500 }).catch(() => false);
    if (!hasCtrl) continue;

    const ctrlLabel = await post.locator('button[aria-label^="Open control menu for post by"]').first().getAttribute('aria-label').catch(() => '');
    const author = ctrlLabel.replace('Open control menu for post by ', '');

    const likeBtn = post.locator('button[aria-label*="Reaction button state: no reaction"]').first();
    const canLike = await likeBtn.isVisible({ timeout: 500 }).catch(() => false);
    if (canLike) likeablePosts++;

    const commentBtn = post.locator('button:has-text("Comment")').first();
    const canComment = await commentBtn.isVisible({ timeout: 500 }).catch(() => false);
    if (canComment) commentablePosts++;

    console.log(`  Post by "${author}" — likeable: ${canLike}, commentable: ${canComment}`);
  }

  console.log(`\nSummary: ${likeablePosts} likeable, ${commentablePosts} commentable`);

  await browser.close();
  process.exit(0);
})();
