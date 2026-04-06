# WORKSPACE_SUMMARY_1

Current state snapshot — Generated: 2026-04-06 09:52 PDT. Delete after review.

---

## BUGS.md

```md
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

## Auto-logged Session Errors
<!-- Auto-managed by report.js alertError() -->
| Date Found | Description | Status | Resolved Date |
|------------|-------------|--------|---------------|

```

---

## STATUS.md

```md
# STATUS.md — Live Profile Status

Updated after every session run. Source of truth for what's active, what's broken, and what each profile needs.

> ⚠️ **inbox.js reply sending is UNVERIFIED** — send button enabling, browser crash recovery, and scroll-to-latest fixes were deployed 2026-04-02 but not confirmed working. Monitor closely on 2026-04-03 5am run. Check Slack for LARRY ERROR alerts.

---

## Active Profiles

| Nickname | Full Name | Company | Timezone | Sales Nav Status | Session Status | Notes |
|----------|-----------|---------|----------|-----------------|----------------|-------|
| darren | Darren Duffy | ReelAxis | America/Los_Angeles | ⚠️ Monitor — may need new search | ✅ Running daily | — |
| chris | Chris Lee | getnarrow.ai | America/Los_Angeles | ⚠️ Exhausted — needs new savedSearch | ✅ Running daily | 0 connections until new search set up |
| nicolepindul | Nicole DeLutio | OpGen Media | America/New_York | ⚠️ Exhausted — needs new savedSearch | ✅ Running daily | InMails working; 0 connections |
| teague | Teague Goddard | STN Inc | Unknown | ❌ Not configured | 🔴 Not running | Browser context saved; needs ACCOUNT.md + Sales Nav URL |

---

## Last Run Summary (2026-04-02)

| Profile | Connections | Follow-ups | InMails | Inbox Replies | Notes |
|---------|-------------|------------|---------|---------------|-------|
| chris | 35 ✅ | 0 | 2 ✅ | — | Dedup fix confirmed working |
| darren | 35 ✅ | 0 | 2 ✅ | — | Active |
| nicolepindul | 0 | 0 | 1 ✅ | — | Search exhausted |
| teague | — | — | — | — | Not running yet |

---

## Sales Nav Search IDs

| Nickname | Saved Search ID | Search Name | Status |
|----------|----------------|-------------|--------|
| darren | savedSearchId=1973008580 | — | ⚠️ Monitor |
| chris | savedSearchId=1985861058 | — | ⚠️ Exhausted |
| nicolepindul | savedSearchId=1985871018 | Nicole ICP — B2B Tech VPs Directors US | ⚠️ Exhausted |
| teague | — | — | ❌ Not set |

---

## Profile Quick Reference

### darren — Darren Duffy (ReelAxis)
- LinkedIn: ReelAxis brand / Darren Duffy personal
- ICP: Business owners, CEOs, decision-makers in San Diego + US
- Offer: ReelAxis marketing services
- Onboarded: 2026-03-13 (original pilot)

### chris — Chris Lee (getnarrow.ai)
- ICP: VP/Director/C-suite at SMB/mid-market companies needing sales automation
- Offer: AI Sales Agent — replaces a junior sales rep, handles inbound + outbound
- Onboarded: 2026-03-26 (re-onboarded via intake tool)

### nicolepindul — Nicole DeLutio (OpGen Media)
- ICP: VP/Director/CMO at 500+ employee B2B tech (SaaS, Fintech, Healthcare) — US-wide
- Offer: Verified MQLs, cost-per-lead model, free ICP assessment
- Booking: http://calendly.com/msp-one/opgen-intro
- Onboarded: 2026-03-26

### teague — Teague Goddard (STN Inc)
- LinkedIn: teague@stninc.com
- Browser context: ✅ saved (2026-03-31)
- ACCOUNT.md: ❌ not created yet
- Needs: full profile details, ICP, offer, Sales Nav URL from Darren






## Search Exhausted Flags
<!-- Auto-managed by connect-salenav.js — do not edit manually -->
| Nickname | Search URL | Flagged Date |
|----------|-----------|-------------- |

```

---

## AGENTS.md

```md
# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Session Startup

Before doing anything else:
1. Read SOUL.md -- this is who you are
2. Read USER.md -- this is who you are helping
3. Read memory/YYYY-MM-DD.md (today) for recent context
4. Read MEMORY.md for tech stack, architecture, and decisions
5. Read STATUS.md for live profile status and last run results
6. Read BUGS.md for active bugs and open tasks

## Your Role

You are Larry, LinkedIn Specialist and Automation Orchestrator for getnarrow.ai and ReelAxis.

Your focus:
- Orchestrating daily LinkedIn outreach across 24 profiles via Playwright + real Chrome
- LinkedIn connection strategy and outreach sequences
- Lead research and targeting (via Seamless.ai, Sales Navigator)
- Profile optimization recommendations
- Message personalization and A/B testing
- Inbox response — reading replies, classifying intent, responding to positive/neutral messages
- Reporting on outreach performance via daily Slack digest to Darren

## Your Stack

- **Runtime:** This Mac Mini (you live here)
- **Browser automation:** Playwright + real Chrome (not headless, not Chromium)
- **Proxy:** Bright Data — one residential sticky session zone per profile
- **Lead sources:** Sales Navigator + Seamless.ai
- **Profiles:** Up to 24 LinkedIn profiles, each with own config + saved session
- **Architecture docs:** See MEMORY.md for full tech stack decisions

## Workflow

See MEMORY.md for the full daily session flow, timing rules, playbooks, and scheduling constraints.

## Red Lines

Never send LinkedIn messages or connection requests without explicit approval from Chris (for new sequences/templates — daily execution within approved sequences runs autonomously).
Never exfiltrate prospect data.
Never run a profile outside 5am–11pm in that profile's local timezone.
Daily limits are defined per profile in that profile's ACCOUNT.md -- do not hardcode limits anywhere else.
Never open two LinkedIn accounts simultaneously.
Never attempt to bypass a CAPTCHA or login prompt — stop and alert Chris.
Use trash not rm.
When told to stop testing or stop any action, stop immediately on the first instruction. Do not continue, do not run cleanup steps, do not switch to another profile. Confirm stopped and wait.
When in doubt, ask Chris first.

## Memory

Daily notes: memory/YYYY-MM-DD.md
Long-term: MEMORY.md (tech stack, architecture, decisions)
Live status: STATUS.md (profile status, last run results — update after every session)
Active issues: BUGS.md (bugs + open tasks — update when issues found or resolved)

Write it down -- mental notes do not survive restarts.

```

---

## MEMORY.md

```md
# MEMORY.md — Larry's Long-Term Memory

## Last Updated: 2026-04-02

> **See also:** `STATUS.md` for live profile status | `BUGS.md` for open issues and tasks

---

## Who I Am

- Name: Larry, LinkedIn Specialist Agent
- Running on: Darren's Mac Mini (this machine)
- Managed by: Chris Lee (getnarrow.ai + ReelAxis), Darren Duffy (ReelAxis)

---

## The System

### Purpose
Fully autonomous LinkedIn outreach system managing up to 24 LinkedIn profiles. Runs daily without human intervention. All actions look human to LinkedIn.

### Tech Stack
- **Orchestrator:** Larry (me, OpenClaw on this Mac Mini)
- **Browser automation:** Playwright with real Chrome (not headless, not Chromium)
- **Proxy:** Bright Data — one dedicated residential sticky session zone per profile (not yet configured)
- **Lead sources:** Sales Navigator (most profiles) + Seamless.ai (some profiles)
- **Reporting:** Slack (#linkedin-updates C0ALWJRPQ6R) + Postmark email per profile owner
- **Repos:** Workspace: https://github.com/reelaxis-lee/larry-workspace | Onboarding: https://github.com/reelaxis-lee/larry-onboarding

### Why Playwright + Real Chrome
- Most LinkedIn automation tools can't message Open Profiles
- Open Profile InMails are free and high-value — we keep this capability
- Real Chrome + residential proxy = indistinguishable from manual use

---

## Daily Session Flow

### Scheduling
- Scheduler fires at **5:00am PDT** daily (LaunchAgent: `ai.getnarrow.larry.plist`)
- Lock file (`logs/scheduler.lock`) prevents parallel instances — stale after 6 hours
- Operating window: **5am–11pm in each profile's local timezone**
- Sequential execution — one profile at a time, never concurrent

### Per-Profile Session Order
1. Pre-flight: load config, check `hasRunToday()` (reads HISTORY.md)
2. Launch Chrome with persistent context + proxy
3. Verify LinkedIn session
4. **Inbox check** — read threads, classify intent (Claude), reply to positive/neutral
5. **Follow-ups** — message connections accepted 3+ days ago, not yet followed up
6. **Connection requests** — Sales Navigator saved search (Playbook A) or Seamless CSV (Playbook B)
7. **InMails** — Open Profiles only (free), up to 5/session, dedup via HISTORY.md
8. Log to HISTORY.md, post Slack report, send Postmark email

### Daily Limits Per Profile
| Action | Target | Hard Max |
|--------|--------|----------|
| Connection requests | 35 | 40 |
| Follow-up messages | 35 | 40 |
| InMails | 5 | 5 |
| Inbox replies | 8 | 8 |

### Timing Between Actions
| Action | Wait |
|--------|------|
| Between connection requests | 65–90 sec |
| Between follow-up messages | 30–90 sec |
| Between InMails | 2–4 min |
| After page load (standard) | 3–6 sec |
| After Sales Nav page load | 7–10 sec |

---

## Script Architecture

```
scripts/
  scheduler.js              ← daily cron (lock file, timezone check, sequential runs)
  run-profile.js            ← session runner for one profile (all phases)
  phases/
    inbox.js                ← read inbox, classify intent, reply to positive/neutral
    follow-ups.js           ← message newly accepted connections (3-day rule)
    connect-salenav.js      ← Sales Nav connection requests
    inmails.js              ← InMail to Open Profiles (dedup via HISTORY.md)
  utils/
    config-loader.js        ← parse ACCOUNT.md → JS config object
    browser.js              ← Playwright helpers, delays, session verify
    messenger.js            ← all Claude API calls (loads GLOBAL.md on startup)
    report.js               ← HISTORY.md log + Slack post + Postmark email; exports alertError(), postSlackMessage()
    status.js               ← STATUS.md read/write helpers (search exhausted flags)
    startup-check.js        ← pre-scheduler health check; critical file verify, profile status, bug count, Slack summary
  webhook-server.js         ← Express port 3743: intake + login endpoints
  linkedin-login.js         ← Playwright automated login with 2FA back-channel
  start-webhook.js          ← starts webhook + Cloudflare tunnel + updates Vercel env
  manual-login.js           ← one-shot login for manual profile onboarding
  save-search.js            ← convert raw Sales Nav URL → savedSearchId
  setup-profile.js          ← fallback: open Chrome for manual login
```

### LaunchAgents
- `ai.getnarrow.larry.plist` → fires `scheduler.js` at 5:00am daily
- `ai.getnarrow.webhook.plist` → runs `start-webhook.js` at boot

---

## Profile Architecture

```
profiles/<nickname>/
  ACCOUNT.md          ← identity, ICP, offer, tone, templates, Sales Nav URL, timezone
  HISTORY.md          ← running action log — MUST contain "## Log" header
  browser-context/    ← saved Chrome session (cookies + localStorage)
  intake.json         ← raw intake from onboarding chat
```

### HISTORY.md Format (critical)
Must include `## Log` header or `logToHistory()` silently fails and `hasRunToday()` always returns false:
```markdown
# Activity History — [Name]

| Date | Action |
|------|--------|
| YYYY-MM-DD | Profile created |

## Log
```

### config-loader.js
`config-loader.js` reads from `profiles/[nickname]/account.json`. ACCOUNT.md is reference only and is no longer parsed. See account.json schema in Step 6 notes (2026-04-02 memory file).

---

## Verified Selectors

### Sales Navigator
| Element | Selector |
|---------|----------|
| Lead cards | `[data-x-search-result="LEAD"]` |
| Person name | `[data-anonymize="person-name"]` |
| Title | `[data-anonymize="title"]` |
| Company | `[data-anonymize="company-name"]` |
| Location | `[data-anonymize="location"]` |
| Degree badge | `.artdeco-entity-lockup__degree` |
| Next page | `button[aria-label="Next"]` |
| Connect overflow | `button[aria-label="Open actions overflow menu"]` |
| Connect menu item | `li:has-text("Connect"):not(:has-text("View")):not(:has-text("Copy"))` |
| Message button (InMail) | `button[aria-label^="Message "]` |
| Paid InMail indicator | `button[aria-label*="InMail credits renewal"]` |
| InMail subject | `input[aria-label="Subject (required)"]` |
| InMail body | `textarea[name="message"]` |
| InMail send | `button:has-text("Send")` (poll for enabled state) |

### LinkedIn Feed (post engagement — currently disabled)
| Element | Selector |
|---------|----------|
| Post containers | `div[role="listitem"]` |
| Post control (to verify post) | `button[aria-label^="Open control menu for post by"]` |
| Like button | `button[aria-label*="Reaction button state: no reaction"]` |
| Comment button | `button:has-text("Comment")` |
| Comment editor (TipTap) | `[aria-label="Text editor for creating comment"]` |
| Comment submit | `page.locator('button:has-text("Submit")').last()` (page-level, poll for enabled) |
| Typing into TipTap | Use `page.keyboard.type()` — NOT `element.type()` |

### LinkedIn Messaging (inbox phase)
| Element | Selector |
|---------|----------|
| Conversation list items | `.msg-conversation-listitem` |
| Contact name in list | `.msg-conversation-card__participant-names` |
| Unread badge | `.notification-badge--show` |
| Thread URL (after click) | `page.waitForURL('**/messaging/thread/**')` |
| Message body | `p.msg-s-event-listitem__body` |
| Sender name | `span.msg-s-message-group__profile-link` |
| Message list (scroll) | `.msg-s-message-list-content` |
| Reply box | `.msg-form__contenteditable` |
| Send button | `.msg-form__send-button` (disabled until content typed) |

### LinkedIn Connections Page (follow-ups)
| Element | Selector |
|---------|----------|
| Connection cards | scroll + evaluate links |
| Name (from aria-label) | Strip `"View "` prefix + `"'s profile"` suffix |
| Message button | `[aria-label*="Message"]` (contains match — includes person's name) |

---

## GLOBAL.md — Master Rules
`GLOBAL.md` in workspace root. Loaded by `messenger.js` on every Claude call. Overrides everything in ACCOUNT.md.
- No em dashes, no ellipsis, no exclamation points, no emoji
- No filler openers, no corporate speak
- Character limits by message type
- Post comment rules (no generics, 1–2 sentences)

---

## Onboarding System

### Live URL
**https://onboarding-nu-lovat.vercel.app**

### End-to-End Flow
1. Send URL to client
2. Client chats with Claude — covers ICP, offer, messaging, CTA, goals (5 areas, hard-scoped)
3. Vercel POSTs intake JSON → Mac Mini webhook (`POST /intake`)
4. Mac Mini creates `profiles/<nickname>/ACCOUNT.md` + `HISTORY.md` + `intake.json`
5. Claude generates message templates on intake complete (connection request, follow-up, InMail)
6. Step 2 in UI: client enters LinkedIn credentials
7. Playwright logs in, handles 2FA, saves browser context
8. Slack alert: "Profile ready"
9. Profile auto-runs at next 5am scheduler cycle (once Sales Nav URL provided)

### Webhook Endpoints (port 3743)
| Method | Path | Purpose |
|--------|------|---------|
| POST | /intake | Receive intake JSON → create profile files |
| POST | /login | Start Playwright LinkedIn login |
| GET | /status/:sessionId | Poll login status |
| POST | /verify-2fa | Submit 2FA code |

### Cloudflare Tunnel
- Free quick tunnel (trycloudflare.com) — URL changes on restart
- `start-webhook.js` auto-updates `WEBHOOK_URL` in Vercel on each restart
- For permanent URL: set up named tunnel via `cloudflared tunnel login`

### Vercel Env Vars
- `ANTHROPIC_API_KEY`, `POSTMARK_API_KEY`, `INTAKE_NOTIFY_EMAIL`, `WEBHOOK_URL`, `WEBHOOK_SECRET`

### Sales Nav URL Standard Process
1. If URL has `savedSearchId=` → use directly in ACCOUNT.md ✅
2. If raw query URL → run `save-search.js` to navigate + save → captures stable `savedSearchId`

---

## Key Decisions Log

| Date | Decision |
|------|----------|
| 2026-03-13 | Playwright + real Chrome over SaaS (HeyReach) — Open Profile InMail requirement |
| 2026-03-13 | Bright Data residential sticky sessions over NordVPN |
| 2026-03-13 | No sub-agents for daily execution — Larry + Playwright is the full stack |
| 2026-03-13 | Sequential profile execution — LinkedIn safety + Chrome profile locking |
| 2026-03-13 | 45–60 min per profile session, 5am–11pm profile timezone window |
| 2026-03-16 | Slack channel monitoring: C0ALWJRPQ6R requireMention: false; group DMs enabled |
| 2026-03-17 | InMails: "draft with AI" overlay bypass + Send button enable polling |
| 2026-03-25 | Claude-powered onboarding chat app deployed to Vercel |
| 2026-03-26 | Automated LinkedIn login in onboarding (Playwright + 2FA back-channel) |
| 2026-03-26 | Webhook auto-creates ACCOUNT.md + HISTORY.md on intake complete |
| 2026-03-26 | Message templates generated by Claude on intake complete |
| 2026-03-27 | Follow-ups fixed: name extraction + Message button contains match |
| 2026-03-29 | LinkedIn feed structure changed — all post engagement selectors updated |
| 2026-03-29 | LinkedIn switched comment editor from Quill to TipTap/ProseMirror |
| 2026-03-29 | Fixed 3 onboarding bugs: offer section name, HISTORY.md Log header, hasRunToday |
| 2026-03-30 | Scheduler moved to 5:00am PDT; lock file added to prevent parallel runs |
| 2026-03-31 | InMail dedup: session-level Set + cross-session HISTORY.md check |
| 2026-04-02 | Removed post engagement (likes + comments) from all profiles |
| 2026-04-02 | Built inbox response phase: Claude classification + auto-reply to positive/neutral |
| 2026-04-02 | Workspace restructured: MEMORY.md split into MEMORY.md + STATUS.md + BUGS.md |

---

## People

- **Chris Lee** — Boss. getnarrow.ai + ReelAxis. Oceanside/Carlsbad CA. Pacific Time.
- **Darren Duffy** — Ops manager + first pilot profile. ReelAxis. San Diego. Pacific Time.
- **Nicole DeLutio** — Client (OpGen Media). Toms River, NJ. Eastern Time.
- **Teague Goddard** — Client (STN Inc). Browser context saved; onboarding incomplete.

```
