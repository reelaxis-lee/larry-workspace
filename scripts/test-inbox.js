/**
 * test-inbox.js — Run just the inbox phase for one profile
 * Usage: node scripts/test-inbox.js <nickname>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });
const { loadAccountConfig } = require('./utils/config-loader');
const { launchProfile, verifyLinkedInSession } = require('./utils/browser');
const { runInboxCheck } = require('./phases/inbox');

const nickname = process.argv[2];
if (!nickname) { console.error('Usage: node scripts/test-inbox.js <nickname>'); process.exit(1); }

(async () => {
  console.log(`\n[test-inbox] Running inbox phase for: ${nickname}`);
  const config = loadAccountConfig(nickname);
  const results = { messagessent: 0, positiveReplies: [], topReplies: [], flags: [] };

  const context = await launchProfile(config);
  const page = context.pages()[0] || await context.newPage();
  await verifyLinkedInSession(page, config.name);
  console.log(`[test-inbox] Session verified ✓`);

  await runInboxCheck(page, config, results);

  await context.close();
  console.log('\n[test-inbox] Results:', JSON.stringify(results, null, 2));
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
