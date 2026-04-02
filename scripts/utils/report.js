/**
 * report.js — Session reporting: Slack channel post + Postmark email + HISTORY.md log
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { ServerClient } = require('postmark');
const fs = require('fs');
const path = require('path');

const SLACK_REPORT_CHANNEL = process.env.SLACK_REPORT_CHANNEL || 'C0ALWJRPQ6R';

/**
 * Post a session summary to the Slack report channel via OpenClaw gateway
 */
async function postSlackReport(accountConfig, sessionResults) {
  const {
    date, connectionsent = 0, messagessent = 0,
    newConnectionsAccepted = 0, positiveReplies = [],
    flags = [], searchStatus = 'Active', sessionStart, sessionEnd,
  } = sessionResults;

  const flagLines = flags.length > 0
    ? `\n⚠️ *Flags:* ${flags.join(' | ')}`
    : '';

  const repliesLine = positiveReplies.length > 0
    ? `\n🔥 *Positive replies:* ${positiveReplies.length}`
    : '';

  const message =
    `*${accountConfig.name} — Daily LinkedIn Summary (${date})*\n` +
    `🕐 ${sessionStart} → ${sessionEnd}\n` +
    `📤 Connections sent: *${connectionsent}*\n` +
    `💬 Messages sent: *${messagessent}*\n` +
    `🤝 New connections accepted: *${newConnectionsAccepted}*` +
    repliesLine +
    `\n🔍 Search: *${searchStatus}*` +
    flagLines;

  try {
    // Use OpenClaw gateway REST API to post to Slack
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
      }, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

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

module.exports = { sendSessionReport, logToHistory, postSlackReport };
