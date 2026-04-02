# BUGS.md — Active Issues & Open Tasks

Updated after every session or fix. Use this file for any active bug, open question, or pending task.

---

## Active Bugs

| Date Found | Description | Status | Resolved Date |
|------------|-------------|--------|---------------|
| 2026-03-29 | Post comments — TipTap fix deployed but comments still showing 0. page.keyboard.type() + page-level submit button scope applied. Unconfirmed in production. | Open | — |
| 2026-04-02 | Inbox phase — send button not enabling after typing reply into .msg-form__contenteditable. Ember.js change detection may not fire from keyboard events alone. | Open | — |
| 2026-04-02 | Inbox phase — browser context closes unexpectedly after failed reply attempt, causing page.goto error on next iteration. | Open | — |

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
