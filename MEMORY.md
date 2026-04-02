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
    report.js               ← HISTORY.md log + Slack post + Postmark email
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

### config-loader.js — ACCOUNT.md Section Mapping
| Config field | ACCOUNT.md section |
|---|---|
| `offerDescription` | `## OFFER & VALUE PROP` + `## CTA & MESSAGING` (combined) |
| `voiceTone` | `## TONE & VOICE` |
| `followUpGuidance` | `## FOLLOW-UP MESSAGE GUIDANCE` |
| `inMailGuidance` | `## INMAIL GUIDANCE` |
| `postEngagementGuidance` | `## POST ENGAGEMENT GUIDANCE` |
| `icp` | `## TARGET ICP` |

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
