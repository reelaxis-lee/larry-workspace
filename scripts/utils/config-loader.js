/**
 * config-loader.js — Load and parse an account's ACCOUNT.md into a usable config object
 */

const fs = require('fs');
const path = require('path');

/**
 * Load account config from ACCOUNT.md
 * Returns a structured config object the scripts can use directly.
 */
function loadAccountConfig(nickname) {
  const configPath = path.resolve(
    __dirname,
    `../../profiles/${nickname}/ACCOUNT.md`
  );

  if (!fs.existsSync(configPath)) {
    throw new Error(`No ACCOUNT.md found for profile: ${nickname}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');

  // Helper to extract table field values
  const field = (label) => {
    const regex = new RegExp(`\\|\\s*${label}\\s*\\|\\s*(.+?)\\s*\\|`, 'i');
    const match = raw.match(regex);
    return match ? match[1].trim() : null;
  };

  // Helper to extract section content between two headings
  const section = (heading) => {
    const regex = new RegExp(`##\\s+${heading}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const match = raw.match(regex);
    return match ? match[1].trim() : '';
  };

  const config = {
    nickname: nickname,
    name: field('LinkedIn profile name'),
    firstName: (field('LinkedIn profile name') || '').split(' ')[0],
    linkedInUrl: field('LinkedIn URL') || null,
    chromeProfileName: field('Chrome profile name'),
    chromeProfilePath: field('Chrome profile path'),
    reportEmail: field('Customer report email'),
    timezone: field('Timezone') || 'America/Los_Angeles',
    personaLocation: field('Persona location'),
    // Only use proxyUrl if it's a real URL (not a placeholder)
    proxyUrl: (() => {
      const p = field('Bright Data proxy URL');
      return (p && !p.startsWith('[')) ? p : null;
    })(),

    // Playbook
    leadSource: raw.includes('[X] Sales Navigator') ? 'sales-navigator' : 'seamless',
    salesNavSearchUrl: field('Sales Nav search URL'),
    seamlessListPath: field('Seamless list path'),

    // Daily limits
    dailyConnectionTarget: 35,  // midpoint of 30-40
    dailyMessageTarget: 35,
    dailyLikeTarget: 7,         // midpoint of 5-10
    dailyCommentTarget: 4,      // midpoint of 3-6

    // Auto-signature
    hasAutoSignature: raw.includes('Auto-signature enabled | Yes') || raw.includes('auto-signature enabled | Yes'),
    autoSignatureText: field('Signature text'),

    // Content for message generation
    offerDescription: (() => {
      const offer = section('OFFER & VALUE PROP') || section('OFFER & CTA') || '';
      const cta = section('CTA & MESSAGING') || '';
      return [offer, cta].filter(Boolean).join('\n\n');
    })(),
    voiceTone: section('TONE & VOICE'),
    followUpGuidance: section('FOLLOW-UP MESSAGE GUIDANCE'),
    inMailGuidance: section('INMAIL GUIDANCE'),
    postEngagementGuidance: section('POST ENGAGEMENT GUIDANCE'),
    bannedPhrases: 'synergy, leverage, circle back, touch base, cutting-edge, em dashes',

    // ICP
    icp: section('TARGET ICP'),
  };

  return config;
}

/**
 * Check if a profile has already been run today.
 * Reads HISTORY.md and looks for today's date.
 */
function hasRunToday(nickname) {
  const historyPath = path.resolve(
    __dirname,
    `../../profiles/${nickname}/HISTORY.md`
  );

  if (!fs.existsSync(historyPath)) return false;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const history = fs.readFileSync(historyPath, 'utf8');
  return history.includes(`### ${today}`);
}

module.exports = { loadAccountConfig, hasRunToday };
