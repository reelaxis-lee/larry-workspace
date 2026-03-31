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

// Read timezone from profile's ACCOUNT.md
function getProfileTimezone(nickname) {
  const accountPath = path.join(PROFILES_DIR, nickname, 'ACCOUNT.md');
  if (!fs.existsSync(accountPath)) return 'America/Los_Angeles';
  const content = fs.readFileSync(accountPath, 'utf8');
  const match = content.match(/\|\s*Timezone\s*\|\s*([^\|\n]+)\|/);
  return match ? match[1].trim() : 'America/Los_Angeles';
}

// Get all active profiles (have ACCOUNT.md + browser-context)
function getActiveProfiles() {
  return fs.readdirSync(PROFILES_DIR)
    .filter(name => {
      const dir = path.join(PROFILES_DIR, name);
      return fs.statSync(dir).isDirectory() &&
             fs.existsSync(path.join(dir, 'ACCOUNT.md')) &&
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
