# WORKSPACE_SUMMARY_2

Current state snapshot — Generated: 2026-04-06 09:52 PDT. Delete after review.

---

## scripts/scheduler.js

```js
/**
 * scheduler.js — Daily session scheduler
 * Runs all active profiles sequentially, respecting each profile's local timezone.
 * Operating window: 5am–11pm in the PROFILE's local timezone (not the Mac's clock).
 * Called once daily by launchd.
 *
 * Usage: node scripts/scheduler.js
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { runStartupCheck } = require('./utils/startup-check');

const WORKSPACE = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(WORKSPACE, 'profiles');
const LOCK_FILE = path.join(WORKSPACE, 'logs', 'scheduler.lock');

// Prevent two scheduler instances running simultaneously
if (fs.existsSync(LOCK_FILE)) {
  const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
  if (lockAge < 6 * 60 * 60 * 1000) { // stale after 6 hours
    console.log(`[scheduler] Already running (lock file exists, ${Math.round(lockAge / 60000)}min old). Exiting.`);
    process.exit(0);
  }
  console.log(`[scheduler] Stale lock file removed (${Math.round(lockAge / 60000)}min old).`);
  fs.unlinkSync(LOCK_FILE);
}
fs.writeFileSync(LOCK_FILE, String(process.pid));

const WINDOW_START_HOUR = 5;   // 5am profile local time
const WINDOW_END_HOUR   = 23;  // 11pm profile local time

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get current hour in a given IANA timezone (e.g. "America/Los_Angeles")
function getLocalHour(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  return parseInt(formatter.format(now), 10);
}

// Get current time string in a given timezone for logging
function getLocalTimeString(timezone) {
  return new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour12: true });
}

// Read timezone from profile's account.json (source of truth)
function getProfileTimezone(nickname) {
  const jsonPath = path.join(PROFILES_DIR, nickname, 'account.json');
  if (!fs.existsSync(jsonPath)) return 'America/Los_Angeles';
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return data.timezone || 'America/Los_Angeles';
  } catch (_) {
    return 'America/Los_Angeles';
  }
}

// Get all active profiles (have account.json + browser-context)
function getActiveProfiles() {
  return fs.readdirSync(PROFILES_DIR)
    .filter(name => {
      const dir = path.join(PROFILES_DIR, name);
      return fs.statSync(dir).isDirectory() &&
             fs.existsSync(path.join(dir, 'account.json')) &&
             fs.existsSync(path.join(dir, 'browser-context'));
    });
}

// Run a profile session and wait for it to complete
function runProfile(nickname) {
  return new Promise((resolve, reject) => {
    console.log(`[scheduler] Starting session: ${nickname}`);
    const proc = spawn('node', [path.join(WORKSPACE, 'scripts/run-profile.js'), nickname], {
      cwd: WORKSPACE,
      stdio: 'inherit'
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${nickname} exited with code ${code}`));
    });
  });
}

// Clean up lock on exit (normal or crash)
function releaseLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch (_) {}
}
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

async function main() {
  console.log(`[scheduler] Daily run triggered at ${new Date().toLocaleString()}`);

  const profiles = getActiveProfiles();
  console.log(`[scheduler] Active profiles: ${profiles.join(', ')}`);

  // ── Startup health check — runs before any profile session ──────
  const health = await runStartupCheck(profiles);
  if (health.abort) {
    console.error('[scheduler] ❌ Startup check failed — critical files missing. Aborting.');
    process.exit(1);
  }
  if (health.degraded) {
    console.warn('[scheduler] ⚠️  Startup check degraded — proceeding with caution.');
  } else {
    console.log('[scheduler] ✅ Startup check passed.');
  }
  // ────────────────────────────────────────────────────────────────

  for (const nickname of profiles) {
    const timezone = getProfileTimezone(nickname);
    const localHour = getLocalHour(timezone);
    const localTime = getLocalTimeString(timezone);

    console.log(`[scheduler] ${nickname} — local time: ${localTime} (${timezone})`);

    // Check operating window: 5am–11pm profile local time
    if (localHour < WINDOW_START_HOUR || localHour >= WINDOW_END_HOUR) {
      console.log(`[scheduler] ${nickname} — outside window (${WINDOW_START_HOUR}am–${WINDOW_END_HOUR % 12 || 12}pm). Skipping.`);
      continue;
    }

    // Random inter-profile delay (5–15 min) after the first one
    if (profiles.indexOf(nickname) > 0) {
      const waitMin = randomBetween(5, 15);
      console.log(`[scheduler] Waiting ${waitMin} min before ${nickname}...`);
      await sleep(waitMin * 60 * 1000);

      // Re-check window after the wait
      const hourAfterWait = getLocalHour(timezone);
      if (hourAfterWait >= WINDOW_END_HOUR) {
        console.log(`[scheduler] ${nickname} — window closed after wait. Skipping.`);
        continue;
      }
    }

    try {
      await runProfile(nickname);
      console.log(`[scheduler] ✅ ${nickname} complete`);
    } catch (err) {
      console.error(`[scheduler] ❌ ${nickname} failed: ${err.message}`);
    }
  }

  console.log(`[scheduler] All profiles processed.`);
}

main().catch(err => {
  console.error('[scheduler] Fatal:', err.message);
  process.exit(1);
});

```

---

## scripts/run-profile.js

```js
/**
 * run-profile.js — Main entry point for running one LinkedIn profile session
 *
 * Usage: node scripts/run-profile.js <nickname>
 * Example: node scripts/run-profile.js darren
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { loadAccountConfig, hasRunToday } = require('./utils/config-loader');
const { launchProfile, verifyLinkedInSession, delays, sleep } = require('./utils/browser');
const { sendSessionReport, logToHistory, postSlackReport, alertError } = require('./utils/report');

const nickname = process.argv[2];

if (!nickname) {
  console.error('Usage: node scripts/run-profile.js <nickname>');
  process.exit(1);
}

// ─── Phase runners ────────────────────────────────────────────────
const { runSalesNavConnections } = require('./phases/connect-salenav');
const { runFollowUps }           = require('./phases/follow-ups');
const { runInMails }             = require('./phases/inmails');
const { runInboxCheck }          = require('./phases/inbox');
const { isSearchExhausted }      = require('./utils/status');

async function runConnections(page, config, results) {
  console.log(`[${config.nickname}] Phase 6: Connection requests (${config.leadSource})`);

  // Skip if search was previously flagged exhausted AND the URL hasn't changed
  if (config.leadSource === 'sales-navigator' && isSearchExhausted(config.nickname, config.salesNavSearchUrl)) {
    const msg = 'Connection phase skipped — search exhausted, new URL needed';
    console.log(`[${config.nickname}] ${msg}`);
    results.flags = results.flags || [];
    results.flags.push(msg);
    results.searchStatus = 'Exhausted';
    return;
  }

  if (config.leadSource === 'sales-navigator') {
    await runSalesNavConnections(page, config, results);
  } else {
    console.log(`[${config.nickname}] Seamless playbook — coming soon`);
  }
}

// ─── Main Session Runner ─────────────────────────────────────────

async function runSession(nickname) {
  const startTime = new Date();
  const dateStr = startTime.toISOString().split('T')[0];
  const startStr = startTime.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[larry] Starting session for: ${nickname}`);
  console.log(`[larry] Time: ${startStr} PT`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Phase 0: Pre-flight ────────────────────────────────────────
  const config = loadAccountConfig(nickname);
  console.log(`[${nickname}] Config loaded: ${config.name}`);

  if (hasRunToday(nickname)) {
    console.log(`[${nickname}] Already run today. Skipping.`);
    return;
  }

  // Session results tracker
  const results = {
    date: dateStr,
    sessionStart: startStr,
    sessionEnd: null,
    connectionsent: 0,
    messagessent: 0,
    newConnectionsAccepted: 0,
    errorCount: 0,
    positiveReplies: [],
    topReplies: [],
    upcomingFollowUps: 0,
    searchStatus: 'Active',
    flags: [],
  };

  let context = null;

  try {
    // ── Phase 2: Launch Chrome + verify session ────────────────
    console.log(`[${nickname}] Launching Chrome...`);
    context = await launchProfile(config);

    const page = context.pages()[0] || await context.newPage();
    await verifyLinkedInSession(page, config.name);
    console.log(`[${nickname}] LinkedIn session verified ✓`);

    // ── Phases 3–7: Run workflow ───────────────────────────────
    // Each phase is wrapped independently — one failure never kills the session.
    const phases = [
      { name: 'inbox',       fn: () => runInboxCheck(page, config, results) },
      { name: 'follow-ups',  fn: () => runFollowUps(page, config, results) },
      { name: 'connections', fn: () => runConnections(page, config, results) },
      { name: 'inmails',     fn: () => runInMails(page, config, results) },
    ];

    for (const phase of phases) {
      try {
        await phase.fn();
      } catch (phaseErr) {
        results.errorCount++;
        await alertError(
          config,
          phase.name,
          `running ${phase.name} phase`,
          phaseErr.message.substring(0, 200),
          'phase aborted — continuing to next phase'
        );
      }
    }

    console.log(`[${nickname}] All phases complete ✓ (errors: ${results.errorCount})`);

  } catch (err) {
    const errMsg = `Session error: ${err.message}`;
    console.error(`[${nickname}] ${errMsg}`);
    results.flags.push(errMsg);

    // Check if it's an auth issue
    if (err.message.includes('login') || err.message.includes('checkpoint') || err.message.includes('CAPTCHA')) {
      results.flags.push('ACTION REQUIRED: LinkedIn session needs re-authentication');
    }

  } finally {
    // ── Phase 8: Close browser ─────────────────────────────────
    if (context) {
      await context.close();
      console.log(`[${nickname}] Browser closed`);
    }

    // ── Phase 9: Log + report ──────────────────────────────────
    const endTime = new Date();
    results.sessionEnd = endTime.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });

    const durationMin = Math.round((endTime - startTime) / 60000);
    console.log(`\n[${nickname}] Session duration: ${durationMin} minutes`);
    console.log(`[${nickname}] Results:`, JSON.stringify(results, null, 2));

    // Log to HISTORY.md
    try {
      logToHistory(config, results);
    } catch (e) {
      console.error(`[${nickname}] Failed to write history: ${e.message}`);
    }

    // Post to Slack report channel
    try {
      await postSlackReport(config, results);
    } catch (e) {
      console.error(`[${nickname}] Failed to post Slack report: ${e.message}`);
    }

    // Send email report if we have a recipient
    if (config.reportEmail && !config.reportEmail.includes('[')) {
      try {
        await sendSessionReport(config, results);
      } catch (e) {
        console.error(`[${nickname}] Failed to send report email: ${e.message}`);
      }
    } else {
      console.log(`[${nickname}] No report email configured — skipping email`);
    }
  }
}

// Run
runSession(nickname).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

```

---

## scripts/utils/report.js

```js
/**
 * report.js — Session reporting: Slack channel post + Postmark email + HISTORY.md log
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { ServerClient } = require('postmark');
const fs = require('fs');
const path = require('path');

const SLACK_REPORT_CHANNEL = process.env.SLACK_REPORT_CHANNEL || 'C0ALWJRPQ6R';
const BUGS_PATH = path.resolve(__dirname, '../../BUGS.md');

/**
 * Shared: post any message to Slack immediately via OpenClaw gateway.
 */
async function postSlackMessage(message) {
  const http = require('http');
  const body = JSON.stringify({
    tool: 'message',
    args: { action: 'send', target: SLACK_REPORT_CHANNEL, message },
  });
  await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789'),
      path: '/tools/invoke',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN || 'larry-oc-gateway-2026-secure'}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Immediately alert Darren to an error via Slack + log it to BUGS.md.
 *
 * @param {object|null} config  - account config (or null if pre-config)
 * @param {string} phase        - phase name, e.g. "follow-ups"
 * @param {string} attempted    - what was being attempted
 * @param {string} errorMsg     - the error message
 * @param {string} actionTaken  - "skipped and continued" | "phase aborted" | etc.
 */
async function alertError(config, phase, attempted, errorMsg, actionTaken) {
  const nickname = config?.nickname || 'unknown';
  const slackMsg =
    `🚨 *LARRY ERROR*\n` +
    `Profile: ${nickname}\n` +
    `Phase: ${phase}\n` +
    `Attempted: ${attempted}\n` +
    `Error: ${errorMsg}\n` +
    `Action taken: ${actionTaken}`;

  // Post to Slack immediately (fire and forget — don't let this block the session)
  postSlackMessage(slackMsg).catch(e => console.error(`[alert] Slack post failed: ${e.message}`));

  // Log to BUGS.md
  try {
    const today = new Date().toISOString().split('T')[0];
    const row = `| ${today} | [${nickname}] ${phase}: ${attempted.substring(0, 60)} | Investigating | — |\n`;
    const bugs = fs.existsSync(BUGS_PATH) ? fs.readFileSync(BUGS_PATH, 'utf8') : '';
    // Append under "## Active Bugs" table if it exists, else append at end
    const autoSection = '\n## Auto-logged Session Errors\n\n| Date Found | Description | Status | Resolved Date |\n|------------|-------------|--------|---------------|\n';
    if (bugs.includes('## Auto-logged Session Errors')) {
      // Find the end of that table and insert before the next ## or EOF
      const updated = bugs.replace(
        /(## Auto-logged Session Errors[\s\S]*?\|[-| ]+\|\n)([\s\S]*?)(\n## |\n*$)/,
        (_, header, rows, tail) => `${header}${rows}${row}${tail}`
      );
      fs.writeFileSync(BUGS_PATH, updated);
    } else {
      fs.appendFileSync(BUGS_PATH, autoSection + row);
    }
  } catch (e) {
    console.error(`[alert] BUGS.md write failed: ${e.message}`);
  }

  console.error(`[${nickname}] ⚠️  ${phase} error: ${errorMsg}`);
}

/**
 * Post a session summary to the Slack report channel via OpenClaw gateway
 */
async function postSlackReport(accountConfig, sessionResults) {
  const {
    date, connectionsent = 0, messagessent = 0,
    newConnectionsAccepted = 0, positiveReplies = [],
    flags = [], searchStatus = 'Active', sessionStart, sessionEnd,
    errorCount = 0,
  } = sessionResults;

  const flagLines = flags.length > 0
    ? `\n⚠️ *Flags:* ${flags.join(' | ')}`
    : '';

  const repliesLine = positiveReplies.length > 0
    ? `\n🔥 *Positive replies:* ${positiveReplies.length}`
    : '';

  const errorLine = errorCount > 0
    ? `\n🚨 *Errors this session: ${errorCount}* — check alerts above`
    : `\n✅ Errors this session: 0`;

  const message =
    `*${accountConfig.name} — Daily LinkedIn Summary (${date})*\n` +
    `🕐 ${sessionStart} → ${sessionEnd}\n` +
    `📤 Connections sent: *${connectionsent}*\n` +
    `💬 Messages sent: *${messagessent}*\n` +
    `🤝 New connections accepted: *${newConnectionsAccepted}*` +
    repliesLine +
    `\n🔍 Search: *${searchStatus}*` +
    errorLine +
    flagLines;

  try {
    await postSlackMessage(message);
    console.log(`[report] Slack report posted to ${SLACK_REPORT_CHANNEL}`);
  } catch (err) {
    console.error(`[report] Slack post failed: ${err.message}`);
  }
}

const client = new ServerClient(process.env.POSTMARK_API_KEY);
const FROM_EMAIL = process.env.POSTMARK_FROM || 'larry@getnarrow.ai';

/**
 * Send the daily activity summary email to the customer.
 * @param {object} accountConfig - the account's config
 * @param {object} sessionResults - activity data from the session
 */
async function sendSessionReport(accountConfig, sessionResults) {
  const {
    date,
    connectionsent = 0,
    messagessent = 0,
    newConnectionsAccepted = 0,
    positiveReplies = [],
    upcomingFollowUps = 0,
    searchStatus = 'Active',
    flags = [],
    topReplies = [],
  } = sessionResults;

  const subject = `Your LinkedIn Activity — ${date}`;

  const flagSection = flags.length > 0
    ? `\n⚠️ Items needing attention:\n${flags.map(f => `- ${f}`).join('\n')}\n`
    : '';

  const repliesSection = topReplies.length > 0
    ? `\n🔥 Positive replies today:\n${topReplies.map(r => `- ${r.name} (${r.title}, ${r.company})`).join('\n')}\n`
    : '';

  const textBody = `Hi ${accountConfig.firstName || accountConfig.nickname},

Here's your LinkedIn activity summary for ${date}:

📤 Connection requests sent: ${connectionsent}
💬 Messages sent: ${messagessent}
🤝 New connections accepted: ${newConnectionsAccepted}
🔥 Positive replies: ${positiveReplies.length}
${repliesSection}
📅 Upcoming follow-ups due: ${upcomingFollowUps}
🔍 Search status: ${searchStatus}
${flagSection}
---
Powered by Larry at getnarrow.ai
`;

  const htmlBody = `
<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="color: #0a66c2;">Your LinkedIn Activity — ${date}</h2>
  <p>Hi ${accountConfig.firstName || accountConfig.nickname},</p>
  <p>Here's what happened on LinkedIn today:</p>

  <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
    <tr style="background:#f3f4f6;"><td style="padding:8px 12px;">📤 Connection requests sent</td><td style="padding:8px 12px; font-weight:bold;">${connectionsent}</td></tr>
    <tr><td style="padding:8px 12px;">💬 Messages sent</td><td style="padding:8px 12px; font-weight:bold;">${messagessent}</td></tr>
    <tr style="background:#f3f4f6;"><td style="padding:8px 12px;">🤝 New connections accepted</td><td style="padding:8px 12px; font-weight:bold;">${newConnectionsAccepted}</td></tr>
    <tr><td style="padding:8px 12px;">🔥 Positive replies</td><td style="padding:8px 12px; font-weight:bold;">${positiveReplies.length}</td></tr>
    <tr style="background:#f3f4f6;"><td style="padding:8px 12px;">📅 Follow-ups due tomorrow</td><td style="padding:8px 12px; font-weight:bold;">${upcomingFollowUps}</td></tr>
    <tr><td style="padding:8px 12px;">🔍 Search status</td><td style="padding:8px 12px; font-weight:bold;">${searchStatus}</td></tr>
  </table>

  ${topReplies.length > 0 ? `
  <h3 style="color:#057642;">🔥 Positive Replies Today</h3>
  <ul>${topReplies.map(r => `<li><strong>${r.name}</strong> — ${r.title}, ${r.company}</li>`).join('')}</ul>
  ` : ''}

  ${flags.length > 0 ? `
  <h3 style="color:#b91c1c;">⚠️ Items Needing Attention</h3>
  <ul>${flags.map(f => `<li>${f}</li>`).join('')}</ul>
  ` : ''}

  <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
  <p style="font-size:12px; color:#6b7280;">Powered by Larry at <a href="https://getnarrow.ai">getnarrow.ai</a></p>
</div>
`;

  try {
    await client.sendEmail({
      From: FROM_EMAIL,
      To: accountConfig.reportEmail,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: 'outbound',
    });
    console.log(`[report] Email sent to ${accountConfig.reportEmail}`);
  } catch (err) {
    console.error(`[report] Failed to send email: ${err.message}`);
    throw err;
  }
}

/**
 * Append session results to the profile's HISTORY.md
 */
function logToHistory(accountConfig, sessionResults) {
  const historyPath = path.resolve(
    __dirname,
    `../../profiles/${accountConfig.nickname}/HISTORY.md`
  );

  const {
    date,
    connectionsent = 0,
    messagessent = 0,
    newConnectionsAccepted = 0,
    positiveReplies = [],
    inboxRepliesLog = [],
    flags = [],
    searchStatus = 'Active',
    sessionStart,
    sessionEnd,
  } = sessionResults;

  // Write one line per inbox reply so loadRepliedNames() can dedup across sessions
  const inboxReplyLines = inboxRepliesLog.length > 0
    ? '\n' + inboxRepliesLog.map(n => `- Inbox reply → ${n}`).join('\n')
    : '';

  const entry = `
### ${date}
- Session: ${sessionStart} → ${sessionEnd}
- Connection requests sent: ${connectionsent}
- Follow-up messages sent: ${messagessent}
- New connections accepted: ${newConnectionsAccepted}
- Positive responses: ${positiveReplies.length}${inboxReplyLines}
- Flags/issues: ${flags.length > 0 ? flags.join('; ') : 'none'}
- Search status: ${searchStatus}
`;

  const current = fs.readFileSync(historyPath, 'utf8');
  const updated = current.replace('## Log', `## Log\n${entry}`);
  fs.writeFileSync(historyPath, updated);
  console.log(`[report] History logged to ${historyPath}`);

  // Also update the Last Run Summary table in STATUS.md
  updateStatusLastRun(accountConfig, sessionResults);
}

/**
 * Rewrite the current profile's row in STATUS.md "Last Run Summary" table.
 */
function updateStatusLastRun(accountConfig, sessionResults) {
  const statusPath = path.resolve(__dirname, '../../STATUS.md');
  if (!fs.existsSync(statusPath)) return;

  const {
    date,
    connectionsent   = 0,
    messagessent     = 0,
    inboxRepliesLog  = [],
    flags            = [],
    searchStatus     = 'Active',
  } = sessionResults;

  const nickname     = accountConfig.nickname;
  const inMailsSent  = sessionResults.inMailsSent || 0;
  const notes        = flags.length > 0 ? flags[0].substring(0, 40) : searchStatus;
  const newRow       = `| ${nickname} | ${connectionsent} | ${messagessent} | ${inMailsSent} | ${inboxRepliesLog.length} | ${notes} |`;

  let content = fs.readFileSync(statusPath, 'utf8');

  // Update the date in the section header
  content = content.replace(
    /## Last Run Summary \([^)]+\)/,
    `## Last Run Summary (${date})`
  );

  // Replace existing row for this nickname, or append it
  const rowRegex = new RegExp(`\\| ${nickname} \\|[^\\n]*`, 'm');
  if (rowRegex.test(content)) {
    content = content.replace(rowRegex, newRow);
  } else {
    // Append after table header row inside Last Run Summary
    content = content.replace(
      /(## Last Run Summary[\s\S]*?\|[-| ]+\|\n)/,
      `$1${newRow}\n`
    );
  }

  fs.writeFileSync(statusPath, content);
  console.log(`[report] STATUS.md last run updated for ${nickname}`);
}

module.exports = { sendSessionReport, logToHistory, postSlackReport, alertError, postSlackMessage };

```

---

## scripts/utils/config-loader.js

```js
/**
 * config-loader.js — Load account config from account.json
 *
 * Source of truth is profiles/[nickname]/account.json.
 * ACCOUNT.md is a human-readable reference only — do not read from it here.
 *
 * Returns a structured config object used by all phase scripts.
 */

const fs   = require('fs');
const path = require('path');

/**
 * Load account config for a given nickname.
 * Reads account.json and maps fields to the shape all scripts expect.
 */
function loadAccountConfig(nickname) {
  const jsonPath = path.resolve(__dirname, `../../profiles/${nickname}/account.json`);

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`No account.json found for profile: ${nickname}`);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Resolve proxy: if "see .env", use BRIGHT_DATA_PROXY env var
  const proxyUrl = (() => {
    if (!raw.proxy || raw.proxy === 'see .env') {
      return process.env.BRIGHT_DATA_PROXY || null;
    }
    if (raw.proxy.startsWith('http')) return raw.proxy;
    return null;
  })();

  const config = {
    // ── Identity ──────────────────────────────────────────────
    nickname:           raw.nickname || nickname,
    name:               raw.fullName,
    firstName:          (raw.fullName || '').split(' ')[0],
    company:            raw.company,
    linkedInUrl:        raw.linkedInUrl || null,
    reportEmail:        raw.reportEmail || null,
    timezone:           raw.timezone || 'America/Los_Angeles',

    // ── Proxy ─────────────────────────────────────────────────
    proxyUrl,

    // ── Playbook ──────────────────────────────────────────────
    leadSource:         raw.salesNavUrl ? 'sales-navigator' : 'seamless',
    salesNavSearchUrl:  raw.salesNavUrl || null,
    salesNavUrl:        raw.salesNavUrl || null,   // alias kept for compatibility

    // ── Daily limits ──────────────────────────────────────────
    dailyConnectionTarget: raw.dailyLimits?.connections || 35,
    dailyMessageTarget:    raw.dailyLimits?.messages    || 35,
    dailyInMailTarget:     raw.dailyLimits?.inmails     || 5,

    // ── Auto-signature ────────────────────────────────────────
    hasAutoSignature:  raw.autoSignature === true,
    autoSignatureText: raw.autoSignature === true ? raw.autoSignatureText || null : null,

    // ── Message generation content ────────────────────────────
    icp:                  raw.icp               || '',
    offerDescription:     raw.offerDescription  || '',
    voiceTone:            raw.voiceTone          || '',
    followUpGuidance:     raw.followUpGuidance   || '',
    inMailGuidance:            raw.inMailGuidance           || '',
    postEngagementGuidance:    raw.postEngagementGuidance   || '',
    bannedPhrases:             raw.bannedPhrases             || 'synergy, leverage, circle back, touch base, cutting-edge, em dashes',

    // ── Message templates ─────────────────────────────────────
    messageTemplates: raw.messageTemplates || {
      connectionRequest: { a: '', b: '' },
      followUp:          { a: '', b: '' },
      inMail:            { subject: '', body: '' },
    },

    // ── Dashboard meta (pass-through) ─────────────────────────
    dashboardMeta: raw.dashboardMeta || {},

    // ── Raw JSON (for anything that needs direct access) ──────
    _raw: raw,
  };

  return config;
}

/**
 * Check if a profile has already been run today.
 * Reads HISTORY.md and looks for today's date header.
 */
function hasRunToday(nickname) {
  const historyPath = path.resolve(__dirname, `../../profiles/${nickname}/HISTORY.md`);
  if (!fs.existsSync(historyPath)) return false;
  const today   = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const history = fs.readFileSync(historyPath, 'utf8');
  return history.includes(`### ${today}`);
}

module.exports = { loadAccountConfig, hasRunToday };

```

---

## scripts/utils/messenger.js

```js
/**
 * messenger.js — Generate personalized LinkedIn messages via Anthropic API
 * Used for connection requests, follow-ups, InMails, and post comments.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), override: true });
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load global rules — applied to every message generation call
let GLOBAL_RULES = '';
try {
  GLOBAL_RULES = fs.readFileSync(
    path.resolve(__dirname, '../../GLOBAL.md'), 'utf8'
  );
} catch (e) {
  console.warn('[messenger] GLOBAL.md not found — no global rules applied');
}

/**
 * Generate a personalized connection request message (max 300 chars).
 */
async function generateConnectionRequest(accountConfig, leadProfile) {
  const prompt = `You are writing a LinkedIn connection request for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

LEAD PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}
Location: ${leadProfile.location || 'unknown'}
Tenure: ${leadProfile.tenure || 'unknown'}
Mutual connections: ${leadProfile.mutualConnections || 0}
About snippet: ${leadProfile.about || 'none'}
Recent activity: ${leadProfile.recentActivity || 'none'}

RULES:
- Maximum 300 characters (HARD LIMIT — count carefully)
- Target 240–285 characters
- Must sound like ${accountConfig.name} wrote it personally
- Reference a specific detail from the lead's profile
- No pitch in connection requests — just connect
- No links
- Never start with "Hi [Name]" every time — vary openers

BANNED PHRASES: ${accountConfig.bannedPhrases || 'synergy, leverage, circle back, touch base, cutting-edge'}

Write ONLY the message text. Nothing else. No quotes, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  const message = response.content[0].text.trim();

  // Safety check: enforce 300 char limit
  if (message.length > 300) {
    // Truncate at last space before 300
    return message.substring(0, 297).replace(/\s+\S*$/, '...');
  }

  return message;
}

/**
 * Generate a follow-up message after connection accepted.
 */
async function generateFollowUp(accountConfig, leadProfile) {
  const prompt = `You are writing a LinkedIn follow-up message for ${accountConfig.name}, sent after a connection request was accepted.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

FOLLOW-UP GUIDANCE:
${accountConfig.followUpGuidance}

LEAD PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}

RULES:
- 3–4 sentences max
- Warm, human, conversational
- Soft offer — no hard sell
- No links
- No "I'd love to hop on a quick call"

Write ONLY the message text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Generate an InMail message (subject + body).
 */
async function generateInMail(accountConfig, leadProfile) {
  const prompt = `You are writing a LinkedIn InMail for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

INMAIL GUIDANCE:
${accountConfig.inMailGuidance}

LEAD PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}
Location: ${leadProfile.location || 'unknown'}

RULES:
- Subject: under 60 characters, feels personal, not generic
- Body: under 120 words
- One clear CTA — not multiple questions
- No links unless account config says otherwise
- ${accountConfig.hasAutoSignature ? 'Do NOT include a sign-off — auto-signature is appended' : 'Include a natural sign-off'}

Return in this exact format:
SUBJECT: [subject line]
BODY: [message body]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch ? subjectMatch[1].trim() : 'Quick thought',
    body: bodyMatch ? bodyMatch[1].trim() : text,
  };
}

/**
 * Generate a post comment.
 */
async function generatePostComment(accountConfig, postContent, postAuthor) {
  const prompt = `You are writing a LinkedIn comment for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

VOICE & TONE:
${accountConfig.voiceTone}

POST ENGAGEMENT GUIDANCE:
${accountConfig.postEngagementGuidance}

POST AUTHOR: ${postAuthor}
POST CONTENT: ${postContent}

RULES:
- Max 2 sentences
- Adds a real perspective, asks a genuine question, or shares a brief insight
- Sounds like a real person, not a marketer
- Never generic ("Great post!", "So true!", "Love this!")
- No self-promotion

Write ONLY the comment text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Classify an inbox message's intent.
 * Returns { intent: 'positive'|'neutral'|'negative'|'skip', reason: string }
 */
async function classifyInboxMessage(accountConfig, { contactName, messages, lastMessage }) {
  const convoText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');

  const prompt = `You are analyzing a LinkedIn message thread for ${accountConfig.name} to determine how to respond.

CONVERSATION:
${convoText}

LATEST MESSAGE FROM ${contactName}:
"${lastMessage}"

ACCOUNT'S OFFER:
${accountConfig.offerDescription}

Classify the intent of ${contactName}'s latest message into ONE of these categories:
- positive: They are clearly interested, want to learn more, asked to schedule a call, said yes, or gave a positive buying signal
- neutral: They asked a clarifying question, gave a general professional response, or are open but not clearly interested yet
- negative: They are not interested, asked to be removed, said stop, or expressed frustration
- skip: The message is completely unrelated (e.g., a generic LinkedIn notification, spam, automated message, or they are clearly talking about something else entirely)

Return ONLY a JSON object like this, nothing else:
{"intent": "positive", "reason": "They asked to schedule a demo"}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    return JSON.parse(response.content[0].text.trim());
  } catch {
    return { intent: 'skip', reason: 'parse error' };
  }
}

/**
 * Generate a reply to an inbox message.
 */
async function generateInboxReply(accountConfig, { contactName, messages, lastMessage, intent }) {
  const convoText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');

  const intentGuide = intent === 'positive'
    ? 'They are interested. Move toward booking a call or next step. Keep it warm and not pushy.'
    : 'They asked a question or gave a neutral response. Answer naturally and keep the conversation going. Do not pitch hard.';

  const prompt = `You are writing a LinkedIn reply for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

CONVERSATION SO FAR:
${convoText}

LATEST MESSAGE FROM ${contactName}:
"${lastMessage}"

INTENT: ${intentGuide}

RULES:
- 2–4 sentences max
- Sound like a real person continuing a real conversation
- Address what they actually said
- ${intent === 'positive' ? 'Suggest a next step (call, demo, or send them a link if config allows)' : 'Keep it conversational — no hard sell'}
- No bullet points
- ${accountConfig.hasAutoSignature ? 'No sign-off — auto-signature is appended' : 'End naturally'}

Write ONLY the reply text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

module.exports = {
  generateConnectionRequest,
  generateFollowUp,
  generateInMail,
  generatePostComment,
  classifyInboxMessage,
  generateInboxReply,
};

```

---

## scripts/utils/status.js

```js
/**
 * status.js — Read/write helpers for STATUS.md
 *
 * Manages the "## Search Exhausted Flags" section at the bottom of STATUS.md.
 * This section is auto-managed — do not edit it manually.
 *
 * Format:
 *   ## Search Exhausted Flags
 *   | Nickname | Search URL | Flagged Date |
 *   |----------|-----------|--------------|
 *   | chris | savedSearchId=1985861058 | 2026-04-02 |
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATUS_PATH = path.resolve(os.homedir(), '.openclaw/workspace/STATUS.md');

const EXHAUSTED_HEADER =
  '\n## Search Exhausted Flags\n' +
  '<!-- Auto-managed by connect-salenav.js — do not edit manually -->\n' +
  '| Nickname | Search URL | Flagged Date |\n' +
  '|----------|-----------|-------------- |\n';

/**
 * Parse the Search Exhausted Flags table from STATUS.md.
 * Returns Map<nickname, { searchUrl, date }>
 */
function readExhaustedFlags() {
  if (!fs.existsSync(STATUS_PATH)) return new Map();
  const content = fs.readFileSync(STATUS_PATH, 'utf8');
  const section = content.match(/## Search Exhausted Flags[\s\S]*?(?=\n## |\n*$)/);
  if (!section) return new Map();

  const map = new Map();
  const rows = section[0].split('\n').filter(l => l.startsWith('|') && !l.startsWith('| Nickname') && !l.startsWith('|---'));
  for (const row of rows) {
    const parts = row.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      map.set(parts[0], { searchUrl: parts[1], date: parts[2] || '' });
    }
  }
  return map;
}

/**
 * Write the Search Exhausted Flags table back to STATUS.md.
 */
function writeExhaustedFlags(map) {
  if (!fs.existsSync(STATUS_PATH)) return;
  let content = fs.readFileSync(STATUS_PATH, 'utf8');

  // Build new section content
  let rows = '';
  for (const [nickname, { searchUrl, date }] of map) {
    rows += `| ${nickname} | ${searchUrl} | ${date} |\n`;
  }
  const newSection = EXHAUSTED_HEADER + rows;

  if (content.includes('## Search Exhausted Flags')) {
    content = content.replace(/## Search Exhausted Flags[\s\S]*?(?=\n## |\n*$)/, newSection.trimEnd());
  } else {
    content = content.trimEnd() + '\n' + newSection;
  }
  fs.writeFileSync(STATUS_PATH, content);
}

/**
 * Flag a profile's search as exhausted.
 * @param {string} nickname
 * @param {string} searchUrl  - the salesNavSearchUrl that is exhausted
 */
function setSearchExhausted(nickname, searchUrl) {
  const flags = readExhaustedFlags();
  const today = new Date().toISOString().split('T')[0];
  flags.set(nickname, { searchUrl: extractSearchId(searchUrl), date: today });
  writeExhaustedFlags(flags);
}

/**
 * Check if a profile's search is currently flagged as exhausted.
 * Returns false if the search URL in ACCOUNT.md has changed (auto-reset).
 * @param {string} nickname
 * @param {string} currentSearchUrl  - current salesNavSearchUrl from config
 */
function isSearchExhausted(nickname, currentSearchUrl) {
  const flags = readExhaustedFlags();
  if (!flags.has(nickname)) return false;
  const recorded = flags.get(nickname);
  const current = extractSearchId(currentSearchUrl);
  if (recorded.searchUrl !== current) {
    // Search URL changed — auto-reset the flag
    clearSearchExhausted(nickname);
    return false;
  }
  return true;
}

/**
 * Remove the exhausted flag for a profile (called when new search URL detected).
 */
function clearSearchExhausted(nickname) {
  const flags = readExhaustedFlags();
  if (flags.has(nickname)) {
    flags.delete(nickname);
    writeExhaustedFlags(flags);
  }
}

/**
 * Extract a stable search identifier from a Sales Nav URL.
 * Prefers savedSearchId param; falls back to full URL.
 */
function extractSearchId(url) {
  if (!url) return '';
  const match = url.match(/savedSearchId=(\d+)/);
  return match ? `savedSearchId=${match[1]}` : url.substring(0, 80);
}

module.exports = { setSearchExhausted, isSearchExhausted, clearSearchExhausted };

```

---

## scripts/utils/startup-check.js

```js
/**
 * startup-check.js — Pre-scheduler health check
 *
 * Called once at the top of scheduler.js before any profiles are queued.
 * Posts a structured Slack summary and returns { ok, degraded, abort }.
 *
 * Returns:
 *   { ok: true }                   — all clear, proceed
 *   { ok: false, degraded: true }  — issues found, still proceed
 *   { ok: false, abort: true }     — critical file missing, DO NOT proceed
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const http = require('http');

const WORKSPACE           = path.resolve(__dirname, '../..');
const SLACK_CHANNEL       = process.env.SLACK_REPORT_CHANNEL || 'C0ALWJRPQ6R';
const OPENCLAW_PORT       = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789');
const OPENCLAW_TOKEN      = process.env.OPENCLAW_GATEWAY_TOKEN || 'larry-oc-gateway-2026-secure';
const STALE_PROFILE_DAYS  = 2;  // flag profiles that haven't run in this many days

// ─── Critical files that must exist before we proceed ─────────────
const CRITICAL_FILES = [
  'GLOBAL.md',
  'MEMORY.md',
  'STATUS.md',
  'BUGS.md',
  'AGENTS.md',
];

// ─── Slack helper ─────────────────────────────────────────────────
function postSlack(message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      tool: 'message',
      args: { action: 'send', target: SLACK_CHANNEL, message },
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: OPENCLAW_PORT,
      path: '/tools/invoke',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', e => { console.error(`[startup-check] Slack post error: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

// ─── File checks ──────────────────────────────────────────────────
function checkCriticalFiles() {
  const missing = [];
  for (const f of CRITICAL_FILES) {
    const fullPath = path.join(WORKSPACE, f);
    try {
      fs.accessSync(fullPath, fs.constants.R_OK);
    } catch (_) {
      missing.push(f);
    }
  }
  return missing;
}

// ─── STATUS.md parsing ────────────────────────────────────────────

/**
 * Parse active profiles from STATUS.md Active Profiles table.
 * Returns array of { nickname, timezone, salesNavStatus, sessionStatus, notes }
 */
function parseActiveProfiles() {
  const statusPath = path.join(WORKSPACE, 'STATUS.md');
  if (!fs.existsSync(statusPath)) return [];

  const content = fs.readFileSync(statusPath, 'utf8');
  // Find the Active Profiles table
  const tableMatch = content.match(/## Active Profiles[\s\S]*?\n(\|[\s\S]*?)(?=\n##|\n*$)/);
  if (!tableMatch) return [];

  const rows = tableMatch[1]
    .split('\n')
    .filter(l => l.startsWith('|') && !l.startsWith('| Nickname') && !l.startsWith('|---'));

  return rows.map(row => {
    const cols = row.split('|').map(s => s.trim()).filter(Boolean);
    return {
      nickname:       cols[0] || '',
      fullName:       cols[1] || '',
      company:        cols[2] || '',
      timezone:       cols[3] || '',
      salesNavStatus: cols[4] || '',
      sessionStatus:  cols[5] || '',
      notes:          cols[6] || '',
    };
  }).filter(p => p.nickname);
}

/**
 * Parse Last Run Summary from STATUS.md.
 * Returns Map<nickname, { date, connections, followUps, inMails, inboxReplies, notes }>
 */
function parseLastRunSummary() {
  const statusPath = path.join(WORKSPACE, 'STATUS.md');
  if (!fs.existsSync(statusPath)) return new Map();

  const content = fs.readFileSync(statusPath, 'utf8');
  const match = content.match(/## Last Run Summary \(([^)]+)\)([\s\S]*?)(?=\n##|\n*$)/);
  if (!match) return new Map();

  const date = match[1];
  const map  = new Map();
  const rows = match[2]
    .split('\n')
    .filter(l => l.startsWith('|') && !l.startsWith('| Profile') && !l.startsWith('|---'));

  for (const row of rows) {
    const cols = row.split('|').map(s => s.trim()).filter(Boolean);
    if (cols[0]) {
      map.set(cols[0], { date, connections: cols[1], followUps: cols[2], inMails: cols[3], inboxReplies: cols[4], notes: cols[5] || '' });
    }
  }
  return map;
}

/**
 * Read Search Exhausted Flags from STATUS.md.
 * Returns Set<nickname>
 */
function parseExhaustedFlags() {
  const statusPath = path.join(WORKSPACE, 'STATUS.md');
  if (!fs.existsSync(statusPath)) return new Set();

  const content = fs.readFileSync(statusPath, 'utf8');
  const section = content.match(/## Search Exhausted Flags[\s\S]*?(?=\n## |\n*$)/);
  if (!section) return new Set();

  const exhausted = new Set();
  const rows = section[0].split('\n').filter(l => l.startsWith('|') && !l.startsWith('| Nickname') && !l.startsWith('|---'));
  for (const row of rows) {
    const nick = row.split('|').map(s => s.trim()).filter(Boolean)[0];
    if (nick) exhausted.add(nick);
  }
  return exhausted;
}

// ─── BUGS.md parsing ──────────────────────────────────────────────

/**
 * Count open bugs by status keyword.
 * Returns { unverified, investigating, total }
 */
function parseBugCounts() {
  const bugsPath = path.join(WORKSPACE, 'BUGS.md');
  if (!fs.existsSync(bugsPath)) return { unverified: 0, investigating: 0, total: 0 };

  const content  = fs.readFileSync(bugsPath, 'utf8');
  const rows     = content.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| Date') && !l.startsWith('|---'));
  let unverified = 0, investigating = 0;

  for (const row of rows) {
    const lower = row.toLowerCase();
    if (lower.includes('unverified')) unverified++;
    else if (lower.includes('investigating')) investigating++;
  }

  return { unverified, investigating, total: unverified + investigating };
}

// ─── Stale profile detection ──────────────────────────────────────

/**
 * Check if a last-run date is stale (> STALE_PROFILE_DAYS days ago).
 * date format: "YYYY-MM-DD"
 */
function isStale(dateStr) {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false; // can't parse — don't flag
  const diffMs   = Date.now() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > STALE_PROFILE_DAYS;
}

// ─── Main ─────────────────────────────────────────────────────────

async function runStartupCheck(queuedProfiles) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const issues = [];
  let abort = false;

  // 1. Critical file check
  const missingFiles = checkCriticalFiles();
  if (missingFiles.length > 0) {
    const msg = `Critical files missing: ${missingFiles.join(', ')}`;
    issues.push(msg);
    console.error(`[startup-check] ❌ ${msg}`);
    abort = true;
  } else {
    console.log('[startup-check] ✅ Critical files OK');
  }

  // 2. Profile status from STATUS.md
  const profiles      = parseActiveProfiles();
  const lastRuns      = parseLastRunSummary();
  const exhaustedSet  = parseExhaustedFlags();
  const staleProfiles = [];
  const exhaustedProfiles = [];

  for (const p of profiles) {
    if (!queuedProfiles.includes(p.nickname)) continue; // only check profiles in today's queue

    const lastRun = lastRuns.get(p.nickname);
    if (lastRun && isStale(lastRun.date)) {
      staleProfiles.push(`${p.nickname} (last run: ${lastRun.date})`);
    }
    if (exhaustedSet.has(p.nickname)) {
      exhaustedProfiles.push(p.nickname);
    }
  }

  if (staleProfiles.length > 0) {
    issues.push(`Stale profiles (>2 days): ${staleProfiles.join(', ')}`);
  }

  // 3. Bug counts
  const bugs = parseBugCounts();
  if (bugs.total > 0) {
    console.log(`[startup-check] ⚠️  Open bugs: ${bugs.total} (${bugs.unverified} unverified, ${bugs.investigating} investigating)`);
  } else {
    console.log('[startup-check] ✅ No open bugs');
  }

  // 4. Build Slack message
  const profilesLine    = queuedProfiles.length > 0 ? queuedProfiles.join(', ') : 'none';
  const bugsLine        = bugs.total > 0
    ? `${bugs.total} — ${bugs.unverified} unverified, ${bugs.investigating} investigating`
    : '0';
  const flagsLine       = exhaustedProfiles.length > 0
    ? `Search exhausted: ${exhaustedProfiles.join(', ')}`
    : 'none';

  let statusLine;
  if (abort) {
    statusLine = `ABORT — ${issues[0]}`;
  } else if (issues.length > 0) {
    statusLine = `DEGRADED — ${issues.join('; ')}`;
  } else {
    statusLine = 'READY';
  }

  const message =
    `🟢 *LARRY STARTUP — ${today}*\n` +
    `Profiles queued: ${profilesLine}\n` +
    `Open bugs: ${bugsLine}\n` +
    `Flags: ${flagsLine}\n` +
    `Status: ${statusLine}`;

  await postSlack(message);
  console.log(`[startup-check] Startup report posted to Slack — Status: ${statusLine}`);

  if (abort) {
    return { ok: false, abort: true };
  }
  if (issues.length > 0) {
    return { ok: false, degraded: true };
  }
  return { ok: true };
}

module.exports = { runStartupCheck };

```
