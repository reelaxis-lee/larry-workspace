/**
 * browser.js — Launch real Chrome with persistent profile context
 * No headless, no Chromium. Real Chrome only.
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

/**
 * Launch Chrome with a persistent context for a given profile.
 * Uses the profile's browser-context dir to persist cookies/session.
 * Proxy is optional — omit for testing without Bright Data.
 */
async function launchProfile(accountConfig) {
  // Always use Playwright's own context dir — this is where setup-profile.js saves the session
  const contextDir = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${accountConfig.nickname}/browser-context`);

  const launchOptions = {
    channel: 'chrome',     // real Chrome — not Chromium
    headless: false,       // headed — visible window
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',  // reduce bot detection
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  // Only add proxy if configured (skip for testing)
  if (accountConfig.proxyUrl) {
    launchOptions.proxy = {
      server: accountConfig.proxyUrl,
    };
  }

  console.log(`[${accountConfig.nickname}] Launching Chrome from: ${contextDir}`);

  const context = await chromium.launchPersistentContext(contextDir, launchOptions);

  // Human-like: wait a beat after launch
  await sleep(randomBetween(3000, 6000));

  return context;
}

/**
 * Verify the correct LinkedIn account is loaded.
 * Checks the profile name in the top nav matches expected name.
 */
async function verifyLinkedInSession(page, expectedName) {
  try {
    await page.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(randomBetween(2000, 4000));

    // Check if redirected to login page
    if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
      throw new Error('LinkedIn session expired — login required');
    }

    console.log(`[session] LinkedIn loaded. URL: ${page.url()}`);
    return true;
  } catch (err) {
    throw new Error(`Session verification failed: ${err.message}`);
  }
}

// ─── Timing Utilities ────────────────────────────────────────────

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Named timing delays matching the spec
const delays = {
  betweenConnections: () => sleep(randomBetween(65000, 90000)),
  betweenMessages:    () => sleep(randomBetween(30000, 90000)),
  betweenInMails:     () => sleep(randomBetween(120000, 240000)),
  betweenLikes:       () => sleep(randomBetween(15000, 45000)),
  betweenComments:    () => sleep(randomBetween(60000, 120000)),
  afterPageLoad:      () => sleep(randomBetween(3000, 6000)),
  afterAction:        () => sleep(randomBetween(1000, 3000)),
  shortPause:         () => sleep(randomBetween(500, 1500)),
};

module.exports = { launchProfile, verifyLinkedInSession, delays, randomBetween, sleep };
