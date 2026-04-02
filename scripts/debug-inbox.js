/**
 * debug-inbox.js — Probe LinkedIn inbox structure + selectors
 * Usage: node scripts/debug-inbox.js <nickname>
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
  await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    // Probe conversation list
    const convSelectors = [
      'ul.msg-conversations-container__conversations-list > li',
      '.msg-conversation-listitem',
      '[data-control-name="view_message"]',
      '.msg-conversations-container li',
    ];

    const results = {};
    for (const sel of convSelectors) {
      results[sel] = document.querySelectorAll(sel).length;
    }

    // Find first conversation item and inspect it
    const firstConv = document.querySelector('ul.msg-conversations-container__conversations-list > li') ||
                      document.querySelector('.msg-conversation-listitem');
    let firstConvInfo = null;
    if (firstConv) {
      const link = firstConv.querySelector('a');
      const unreadBadge = firstConv.querySelector('[class*="unread"], [class*="badge"], [class*="notification"]');
      const nameEl = firstConv.querySelector('[class*="name"], strong, h3');
      const snippetEl = firstConv.querySelector('[class*="snippet"], [class*="preview"], p');
      firstConvInfo = {
        linkHref: link?.href?.substring(0, 80),
        linkAriaLabel: link?.getAttribute('aria-label'),
        hasUnreadBadge: !!unreadBadge,
        unreadClass: unreadBadge?.className?.substring(0, 60),
        nameText: nameEl?.textContent?.trim()?.substring(0, 40),
        snippetText: snippetEl?.textContent?.trim()?.substring(0, 80),
        fullTag: firstConv.tagName,
        firstChildClass: firstConv.firstElementChild?.className?.substring(0, 80),
      };
    }

    // Check if there's an unread count indicator somewhere
    const unreadCount = document.querySelector('[class*="unread-count"], .notification-badge, [data-test="unread-count"]');

    return {
      convSelectors: results,
      firstConvInfo,
      unreadIndicator: unreadCount?.textContent?.trim(),
      pageTitle: document.title,
    };
  });

  console.log('\n=== LinkedIn Inbox Probe ===');
  console.log('Page title:', info.pageTitle);
  console.log('\nConversation list counts:');
  Object.entries(info.convSelectors).forEach(([sel, count]) => console.log(`  "${sel}": ${count}`));
  console.log('\nFirst conversation:', JSON.stringify(info.firstConvInfo, null, 2));
  console.log('Unread indicator:', info.unreadIndicator);

  // Now click first conversation and probe the message thread
  await page.waitForTimeout(1000);
  const firstLink = await page.locator('ul.msg-conversations-container__conversations-list > li a').first();
  if (await firstLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstLink.click();
    await page.waitForTimeout(2000);

    const threadInfo = await page.evaluate(() => {
      const msgSelectors = [
        '.msg-s-message-list__event',
        '.msg-s-event-listitem',
        '[class*="message-list"] li',
        '.msg-s-message-group',
      ];
      const threadResults = {};
      for (const sel of msgSelectors) {
        threadResults[sel] = document.querySelectorAll(sel).length;
      }

      // Find message body
      const msgBodies = document.querySelectorAll('.msg-s-event-listitem__body, [class*="message-body"]');
      const lastMsg = msgBodies[msgBodies.length - 1];

      // Find reply input
      const replyInput = document.querySelector('.msg-form__contenteditable, [class*="msg-form"] [contenteditable]');
      const sendBtn = document.querySelector('.msg-form__send-button, button[class*="send"]');

      return {
        msgSelectors: threadResults,
        lastMsgText: lastMsg?.textContent?.trim()?.substring(0, 120),
        lastMsgClass: lastMsg?.className?.substring(0, 60),
        replyInputSelector: replyInput ? `.msg-form__contenteditable` : null,
        replyInputAriaLabel: replyInput?.getAttribute('aria-label'),
        sendBtnText: sendBtn?.textContent?.trim(),
        sendBtnAriaLabel: sendBtn?.getAttribute('aria-label'),
        sendBtnClass: sendBtn?.className?.substring(0, 60),
      };
    });

    console.log('\n=== Thread Probe ===');
    console.log('Message counts:', JSON.stringify(threadInfo.msgSelectors));
    console.log('Last message:', threadInfo.lastMsgText);
    console.log('Reply input aria-label:', threadInfo.replyInputAriaLabel);
    console.log('Send button:', { text: threadInfo.sendBtnText, ariaLabel: threadInfo.sendBtnAriaLabel });
  }

  await browser.close();
  process.exit(0);
})();
