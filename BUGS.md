# BUGS.md — Active Issues & Open Tasks

Updated after every session or fix. Use this file for any active bug, open question, or pending task.

---

## Active Bugs

| Date Found | Description | Status | Resolved Date |
|------------|-------------|--------|---------------|
| 2026-03-29 | Post comments — TipTap fix deployed but comments still showing 0. page.keyboard.type() + page-level submit button scope applied. Unconfirmed in production. | Open | — |
| 2026-04-02 | [inbox] Send button not enabling after typing reply into .msg-form__contenteditable. Ember.js change detection may not fire from keyboard events alone. Fix deployed but not confirmed. | Unverified — not confirmed fixed | — |
| 2026-04-02 | [inbox] Browser context closes unexpectedly after failed reply attempt, causing page.goto error on next thread. Fix deployed but not confirmed. | Unverified — not confirmed fixed | — |
| 2026-04-02 | [inbox] Thread reading reliability — scroll to latest message may not load all messages before reading. Fix deployed but not confirmed. | Unverified — not confirmed fixed | — |

---

## Open Tasks

| Date Added | Description | Status | Notes |
|------------|-------------|--------|-------|
| 2026-03-13 | Set up Bright Data residential proxies | Pending | Critical before scaling — currently no proxies active |
| 2026-03-26 | Fix nickname derivation mismatch in onboarding | Pending | Chat step uses first name ("nicole"), login step uses email prefix ("nicolepindul") — folders can end up split |
| 2026-03-26 | Add custom domain: onboard.getnarrow.ai | Pending | Requires DNS + Vercel config |
| 2026-03-26 | Set up named Cloudflare tunnel (permanent URL) | Pending | Currently using free trycloudflare.com — URL changes on restart |
| 2026-03-31 | Confirm from address for client email reports | Pending | larry@getnarrow.ai or reports@getnarrow.ai — TBD with Chris |
| 2026-03-31 | Chris Sales Nav search — set up new saved search | Pending | Current search (savedSearchId=1985861058) exhausted |
| 2026-03-31 | InMail duplicate dedup via HISTORY.md — confirm working in production | Pending | Fix deployed 2026-04-01, needs one full week of runs to verify |
| 2026-04-02 | Follow-up messages — confirm working end-to-end in production | Pending | Selectors fixed 2026-03-27, not yet confirmed with live data |
| 2026-04-02 | Inbox response — complete send-button + crash fixes, then test on non-Darren profile | Pending | Send button not enabling; context crash after failed send |
| 2026-04-02 | Teague Goddard — build ACCOUNT.md, get Sales Nav search URL | Pending | Browser context saved 2026-03-31, no ACCOUNT.md yet |
| 2026-04-02 | Seamless.ai API access | Pending | Chris to enable — needed for profiles not using Sales Nav |
| 2026-04-02 | Scale plan: rotating schedule vs second Mac Mini for 24 profiles | Pending | Discuss with Chris/Darren |

## Resolved Bugs

| Date Found | Description | Resolved | Notes |
|------------|-------------|----------|-------|
| 2026-04-06 | Expired `ANTHROPIC_API_KEY` in `.env` — valid key was only in shell/openclaw.json env. `messenger.js` had `override: true` on dotenv which stomped the valid key with the stale one on every module load. All production sessions since search exhaustion (April 3–6) sent 0 messages so no malformed content was sent. | 2026-04-06 | Fixed: `.env` updated with valid key; `override: true` removed from messenger.js |
| 2026-04-06 | `classifyInboxMessage` and `generateInboxReply` called with reversed arg order in `test-run.js` phases 1 & 2 — caused `.map` crash on every inbox thread. | 2026-04-06 | Fixed: corrected to `(config, { contactName, messages, lastMessage })` |
| 2026-03-13 | Connection requests opened with sender's name (e.g. "Darren, your work...") instead of recipient's name. Prompt ambiguity caused Claude to use the sender name as salutation. Affected every connection request across all profiles since launch. | 2026-04-06 | Fixed: rewrote `generateConnectionRequest` prompt to explicitly label SENDER vs RECIPIENT; added hard rule against addressing sender by name |
| 2026-03-13 | `connect-salenav.js` incorrectly skipped all 3rd degree leads and flagged them as "InMail candidates only." 3rd degree leads are eligible for connection requests. `inmails.js` had no degree filter issue. `test-run.js` phase 5 only allowed 2nd degree. All corrected — now only 1st degree is skipped for connections; InMails allow 2nd and 3rd degree open profiles. | 2026-04-06 | Fixed: removed 3rd degree skip from `connect-salenav.js`; updated degree check in `test-run.js` phase 5; updated MEMORY.md workflow |
| 2026-03-13 | `follow-ups.js` used outdated CSS class selectors (`.mn-connection-card`, `.mn-connection-card__name`, etc.) that no longer exist after LinkedIn's UI update to hashed class names. Zero follow-ups were ever sent since launch. | 2026-04-06 | Fixed: full rewrite using `a[aria-label="Message"]` + DOM walk to `div[componentkey]` card root; verified via live DOM probe. `test-run.js` phase 3 updated to match. |
| 2026-03-13 | `inbox.js` only checked `linkedin.com/messaging` — Sales Navigator inbox (`linkedin.com/sales/inbox`) was never checked. InMail replies from prospects in Sales Nav were silently ignored on every session run. | 2026-04-06 | Fixed: added `runSalesNavInboxCheck()` as Pass 2 in `inbox.js` using DOM-verified selectors from live probe of Darren's Sales Nav inbox |

---

## Auto-logged Session Errors
<!-- Auto-managed by report.js alertError() -->
| Date Found | Description | Status | Resolved Date |
|------------|-------------|--------|---------------|
