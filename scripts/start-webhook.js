/**
 * start-webhook.js
 * Starts the webhook server + Cloudflare tunnel.
 * Automatically updates the WEBHOOK_URL env var in Vercel when tunnel is ready.
 * Add to LaunchAgent so it runs at startup.
 *
 * Usage: node scripts/start-webhook.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 3743;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT = 'onboarding'; // Vercel project name
const VERCEL_TEAM = 'reelaxis';

// ── Start webhook server ──────────────────────────────────────────────────────
console.log('[start-webhook] Starting webhook server...');
const server = spawn('node', [path.join(__dirname, 'webhook-server.js')], {
  stdio: 'inherit',
  env: process.env,
});

server.on('error', err => console.error('[start-webhook] Server error:', err.message));

// ── Start Cloudflare tunnel + capture URL ─────────────────────────────────────
setTimeout(() => {
  console.log('[start-webhook] Starting Cloudflare tunnel...');
  const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let urlCaptured = false;

  function handleOutput(data) {
    const text = data.toString();
    process.stdout.write(text);

    if (!urlCaptured) {
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        urlCaptured = true;
        const tunnelUrl = match[0];
        console.log(`\n[start-webhook] ✅ Tunnel URL: ${tunnelUrl}`);
        updateVercel(tunnelUrl);
      }
    }
  }

  tunnel.stdout.on('data', handleOutput);
  tunnel.stderr.on('data', handleOutput);
  tunnel.on('error', err => console.error('[start-webhook] Tunnel error:', err.message));

}, 2000); // give webhook server 2s to start

// ── Update Vercel env var ─────────────────────────────────────────────────────
async function updateVercel(tunnelUrl) {
  if (!VERCEL_TOKEN) {
    console.log('[start-webhook] No VERCEL_TOKEN — skipping Vercel update');
    console.log(`[start-webhook] Set WEBHOOK_URL=${tunnelUrl} in Vercel manually`);
    return;
  }

  try {
    const { execSync } = require('child_process');
    const onboardingDir = path.join(__dirname, '../onboarding');

    // Remove old WEBHOOK_URL and WEBHOOK_SECRET if set, then re-add
    try {
      execSync(
        `cd ${onboardingDir} && vercel env rm WEBHOOK_URL production --token ${VERCEL_TOKEN} --yes 2>/dev/null`,
        { stdio: 'pipe' }
      );
    } catch (_) {}

    execSync(
      `cd ${onboardingDir} && echo "${tunnelUrl}" | vercel env add WEBHOOK_URL production --token ${VERCEL_TOKEN}`,
      { stdio: 'inherit' }
    );

    // Ensure WEBHOOK_SECRET is set
    try {
      execSync(
        `cd ${onboardingDir} && vercel env rm WEBHOOK_SECRET production --token ${VERCEL_TOKEN} --yes 2>/dev/null`,
        { stdio: 'pipe' }
      );
    } catch (_) {}

    execSync(
      `cd ${onboardingDir} && echo "${process.env.WEBHOOK_SECRET}" | vercel env add WEBHOOK_SECRET production --token ${VERCEL_TOKEN}`,
      { stdio: 'inherit' }
    );

    // Redeploy Vercel to pick up new env vars
    console.log('[start-webhook] Redeploying Vercel with new tunnel URL...');
    execSync(
      `cd ${onboardingDir} && vercel --token ${VERCEL_TOKEN} --yes --prod`,
      { stdio: 'inherit' }
    );

    console.log('[start-webhook] ✅ Vercel updated and redeployed.');

  } catch (err) {
    console.error('[start-webhook] Vercel update failed:', err.message);
    console.log(`[start-webhook] Set WEBHOOK_URL=${tunnelUrl} in Vercel manually`);
  }
}

process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
