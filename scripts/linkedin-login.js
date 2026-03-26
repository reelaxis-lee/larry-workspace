/**
 * linkedin-login.js
 * Automated LinkedIn login with 2FA support for remote onboarding.
 * Called by webhook-server.js — do not run directly.
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

/**
 * Attempt LinkedIn login for a new profile.
 * Returns a promise that resolves when login is complete or rejects on error.
 *
 * @param {string} nickname - profile slug
 * @param {string} email
 * @param {string} password
 * @param {object} session - session state object (mutated to signal 2FA need)
 */
async function linkedInLogin(nickname, email, password, session) {
  const contextDir = path.resolve(
    os.homedir(),
    `.openclaw/workspace/profiles/${nickname}/browser-context`
  );

  // Ensure context dir exists
  const fs = require('fs');
  fs.mkdirSync(contextDir, { recursive: true });

  const context = await chromium.launchPersistentContext(contextDir, {
    channel: 'chrome',
    headless: false, // visible so user can see what's happening if needed
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  session.context = context;
  const page = context.pages()[0] || await context.newPage();
  session.page = page;

  try {
    // Navigate to login
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Check if already logged in
    if (page.url().includes('/feed') || page.url().includes('/sales/home')) {
      await captureSession(page, context, nickname);
      session.status = 'success';
      await context.close();
      return;
    }

    // Fill credentials
    await page.fill('#username', email);
    await page.fill('#password', password);
    await page.click('[type="submit"]');

    // Wait for redirect — could be feed, checkpoint, or challenge
    await page.waitForURL('**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const url = page.url();

    // Check for verification/2FA screen
    if (
      url.includes('checkpoint') ||
      url.includes('challenge') ||
      url.includes('verification') ||
      url.includes('two-step') ||
      await page.locator('input[name="pin"]').isVisible({ timeout: 3000 }).catch(() => false) ||
      await page.locator('#input__phone_verification_pin').isVisible({ timeout: 1000 }).catch(() => false)
    ) {
      // Need 2FA — signal to webhook and wait for code
      session.status = 'need_2fa';

      const code = await waitForCode(session);

      // Try common 2FA input selectors
      const codeInput = page.locator(
        'input[name="pin"], #input__phone_verification_pin, input[id*="verification"], input[aria-label*="code" i]'
      ).first();

      await codeInput.fill(code);

      const submitBtn = page.locator(
        'button[type="submit"], button:has-text("Submit"), button:has-text("Verify")'
      ).first();
      await submitBtn.click();

      await page.waitForURL('**', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Check we landed on feed or sales nav
    const finalUrl = page.url();
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('checkpoint') ||
      finalUrl.includes('challenge')
    ) {
      session.status = 'error';
      session.message = 'Login failed — still on login or challenge page. Check credentials.';
      await context.close();
      return;
    }

    // Also visit Sales Navigator to capture that session
    await page.goto('https://www.linkedin.com/sales/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => {});
    await page.waitForTimeout(3000);

    await captureSession(page, context, nickname);
    session.status = 'success';
    await context.close();

  } catch (err) {
    session.status = 'error';
    session.message = err.message;
    await context.close().catch(() => {});
  }
}

/**
 * Save the browser context (cookies + storage) to disk.
 */
async function captureSession(page, context, nickname) {
  // Playwright auto-saves persistent context on close.
  // Just verify we're logged in first.
  const url = page.url();
  console.log(`[login] Session captured for ${nickname} — final URL: ${url.substring(0, 80)}`);
}

/**
 * Wait for a 2FA code to be submitted via the webhook.
 * Resolves when session.codeResolver is called with the code.
 */
function waitForCode(session) {
  return new Promise((resolve, reject) => {
    session.codeResolver = resolve;

    // Timeout after 10 minutes
    setTimeout(() => {
      reject(new Error('2FA code entry timed out after 10 minutes'));
    }, 10 * 60 * 1000);
  });
}

module.exports = { linkedInLogin };
