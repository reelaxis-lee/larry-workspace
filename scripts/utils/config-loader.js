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
