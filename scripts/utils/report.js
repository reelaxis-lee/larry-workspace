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
    channel: 'slack',
    target: SLACK_REPORT_CHANNEL,
    message,
  });
  await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789'),
      path: '/api/message/send',
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
    flags = [],
    searchStatus = 'Active',
    sessionStart,
    sessionEnd,
  } = sessionResults;

  const entry = `
### ${date}
- Session: ${sessionStart} → ${sessionEnd}
- Connection requests sent: ${connectionsent}
- Follow-up messages sent: ${messagessent}
- New connections accepted: ${newConnectionsAccepted}
- Positive responses: ${positiveReplies.length}
- Flags/issues: ${flags.length > 0 ? flags.join('; ') : 'none'}
- Search status: ${searchStatus}
`;

  const current = fs.readFileSync(historyPath, 'utf8');
  const updated = current.replace('## Log', `## Log\n${entry}`);
  fs.writeFileSync(historyPath, updated);
  console.log(`[report] History logged to ${historyPath}`);
}

module.exports = { sendSessionReport, logToHistory, postSlackReport, alertError };
