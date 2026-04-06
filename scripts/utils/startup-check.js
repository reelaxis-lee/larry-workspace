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
