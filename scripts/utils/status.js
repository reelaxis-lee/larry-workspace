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
