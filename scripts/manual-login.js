/**
 * manual-login.js — One-shot login for a profile, with 2FA back-channel via Slack.
 * Usage: node scripts/manual-login.js <nickname> <email> <password>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const [,, nickname, email, password] = process.argv;
if (!nickname || !email || !password) {
  console.error('Usage: node scripts/manual-login.js <nickname> <email> <password>');
  process.exit(1);
}

const contextDir = path.resolve(os.homedir(), `.openclaw/workspace/profiles/${nickname}/browser-context`);
fs.mkdirSync(contextDir, { recursive: true });

// 2FA code injected externally via this file
const twoFaPath = path.join(os.homedir(), `.openclaw/workspace/profiles/${nickname}/.2fa`);

(async () => {
  console.log(`[login] Starting login for ${nickname} (${email})`);

  const context = await chromium.launchPersistentContext(contextDir, {
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized', '--no-first-run', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
  });

  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Already logged in?
  if (page.url().includes('/feed') || page.url().includes('/sales/home')) {
    console.log(`[login] Already logged in — saving session.`);
    await context.close();
    console.log(`[login] ✅ Done. Browser context saved to: ${contextDir}`);
    process.exit(0);
  }

  // Fill credentials
  await page.fill('#username', email);
  await page.waitForTimeout(500);
  await page.fill('#password', password);
  await page.waitForTimeout(500);
  await page.click('[type="submit"]');
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log(`[login] After submit — URL: ${url}`);

  // 2FA check
  const needs2FA =
    url.includes('checkpoint') ||
    url.includes('challenge') ||
    url.includes('verification') ||
    url.includes('two-step') ||
    await page.locator('input[name="pin"], #input__phone_verification_pin, #input__email_verification_pin').first().isVisible({ timeout: 3000 }).catch(() => false);

  if (needs2FA) {
    console.log(`[login] 2FA required — waiting for code...`);
    console.log(`[login] Write the code to: ${twoFaPath}`);

    // Poll for 2FA file (written by Larry when Darren sends the code)
    let code = null;
    for (let i = 0; i < 120; i++) { // wait up to 2 min
      if (fs.existsSync(twoFaPath)) {
        code = fs.readFileSync(twoFaPath, 'utf8').trim();
        fs.unlinkSync(twoFaPath);
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!code) {
      console.error('[login] Timed out waiting for 2FA code.');
      await context.close();
      process.exit(1);
    }

    console.log(`[login] Got code: ${code} — submitting...`);
    const pinInput = page.locator('input[name="pin"], #input__phone_verification_pin, #input__email_verification_pin').first();
    await pinInput.fill(code);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }

  // Verify we're logged in
  const finalUrl = page.url();
  if (finalUrl.includes('/feed') || finalUrl.includes('/sales') || finalUrl.includes('/mynetwork')) {
    console.log(`[login] ✅ Login successful — URL: ${finalUrl}`);
  } else {
    console.log(`[login] ⚠️  Unexpected URL after login: ${finalUrl}`);
  }

  // Save Sales Nav session too
  console.log(`[login] Loading Sales Navigator to save that session...`);
  await page.goto('https://www.linkedin.com/sales/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  await context.close();
  console.log(`[login] ✅ Browser context saved to: ${contextDir}`);
})();
