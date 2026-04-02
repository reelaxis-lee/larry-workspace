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

async function runConnections(page, config, results) {
  console.log(`[${config.nickname}] Phase 6: Connection requests (${config.leadSource})`);
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
