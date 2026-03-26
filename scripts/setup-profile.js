/**
 * setup-profile.js — One-time login setup for a profile
 *
 * Opens a real Chrome window to linkedin.com. Log in manually.
 * Playwright saves the session — all future runs use it automatically.
 *
 * Usage: node scripts/setup-profile.js <nickname>
 * Example: node scripts/setup-profile.js darren
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const readline = require('readline');

const nickname = process.argv[2];
if (!nickname) {
  console.error('Usage: node scripts/setup-profile.js <nickname>');
  process.exit(1);
}

// Use a dedicated Playwright context dir (not the locked Chrome profile)
const contextDir = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/browser-context`);

console.log(`\n${'='.repeat(60)}`);
console.log(`LinkedIn Session Setup — ${nickname}`);
console.log(`${'='.repeat(60)}`);
console.log(`\nContext will be saved to:\n  ${contextDir}`);
console.log('\nA Chrome window will open. Log into LinkedIn manually.');
console.log('When done, come back here and press ENTER to save and close.\n');

(async () => {
  const context = await chromium.launchPersistentContext(contextDir, {
    channel: 'chrome',
    headless: false,
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  console.log('Chrome is open. Log in to LinkedIn now.');
  console.log('When fully logged in and on your feed, press ENTER here...\n');
  await waitForEnter();

  // Now navigate to Sales Navigator to capture that session too
  console.log('\nNavigating to Sales Navigator to save that session as well...');
  await page.goto('https://www.linkedin.com/sales/home', { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Sales Navigator is loading.');
  console.log('If it asks you to log in again, do so. Once you see the Sales Navigator home page, press ENTER...\n');
  await waitForEnter();

  // Verify both sessions
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint')) {
    console.log('⚠️  Still on login page. Make sure you are fully logged in before pressing ENTER.');
  } else {
    console.log(`✅ Session saved for: ${nickname} (LinkedIn + Sales Navigator)`);
    console.log(`   Context dir: ${contextDir}`);
  }

  await context.close();
  console.log('\nDone. Chrome closed. Future runs will use this saved session.');
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

function waitForEnter() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Press ENTER when logged in > ', () => {
      rl.close();
      resolve();
    });
  });
}
