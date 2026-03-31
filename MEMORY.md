# MEMORY.md — Larry's Long-Term Memory

## Last Updated: 2026-03-31

---

## Who I Am

- Name: Larry, LinkedIn Specialist Agent
- Running on: Darren's Mac Mini (this machine)
- Managed by: Chris Lee (getnarrow.ai + ReelAxis), Darren Duffy (ReelAxis)

---

## The System We're Building

### Purpose
Fully autonomous LinkedIn outreach system managing 24 LinkedIn profiles. Runs daily without human intervention. All actions look human to LinkedIn.

### Tech Stack
- **Orchestrator:** Larry (me, OpenClaw on this Mac Mini)
- **Browser automation:** Playwright with real Chrome (not headless, not Chromium)
- **Proxy:** Bright Data — one dedicated residential sticky session zone per profile
- **Lead sources:** Sales Navigator (most profiles) + Seamless.ai (some profiles, CSV export or API)
- **Logging:** Profile HISTORY.md files + daily Slack digest to Chris/Darren
- **Reporting:**
  - Daily Slack post to #linkedin-updates (C0ALWJRPQ6R) after each session completes
  - Daily email to each customer (profile owner) via Postmark — sent immediately after their session
  - From address: larry@getnarrow.ai (or reports@getnarrow.ai — TBD)

### Why Playwright + Real Chrome (not a SaaS tool like HeyReach)
- Most LinkedIn automation tools can't message Open Profiles
- Open Profile InMails are free and high-value — we keep this capability
- Real Chrome + residential proxy = indistinguishable from manual use
- Full programmatic control without a third-party platform dependency

### Authentication
- Each profile has a persistent Playwright browser context stored in `profiles/[name]/browser-context/`
- One-time human login per profile via onboarding app (or `setup-profile.js` manual fallback)
- Proxy consistency is critical: same Bright Data zone per profile every time
- If LinkedIn shows login screen or CAPTCHA → Larry stops and alerts Darren via Slack immediately

---

## Daily Workflow Per Profile

### Scheduling Rules
- Operating window: **5am–11pm in the profile's local timezone** (never outside this)
- Scheduler fires at **5:00am PDT** daily (changed from 8:30am on 2026-03-30)
- One profile at a time, sequentially — never two LinkedIn accounts open simultaneously
- Lock file (`logs/scheduler.lock`) prevents parallel scheduler instances
- Each profile session: **45–60 minutes** (randomized to look human)
- Max profiles per day on one machine: ~16–18 (math: 16hr window ÷ ~52min avg)
- 24 profiles: rotating schedule OR second Mac Mini

### Session Flow (per profile)
```
1. Pre-flight: read account config, check if already run today (hasRunToday check)
2. Launch Chrome via Playwright with profile's browser context + Bright Data proxy
3. Verify correct LinkedIn account is logged in
4. Inbox check: review messages, respond to warm leads, escalate hot ones
5. Follow-up messages: message newly accepted connections (3-day wait rule)
6. Post engagement:
   - Like 5–10 posts (from feed or ICP targets)
   - Comment on 3–6 posts (thoughtful, voice-matched — Larry generates these)
7. Connection requests: from Sales Navigator saved search OR Seamless.ai list
8. InMails: Open Profiles only (free) unless paid credits explicitly authorized
9. Log all activity to HISTORY.md
10. Close Chrome session
11. Post Slack report to #linkedin-updates
```

### Daily Targets Per Profile
- Connection requests: 30–40 per day
- Messages (follow-ups + InMails combined): 30–40 per day
- Post likes: 5–10
- Post comments: 3–6
- Sessions per account: 1 per day

### Timing Between Actions
| Action | Wait |
|--------|------|
| Between connection requests | 65–90 sec (randomized) |
| Between follow-up messages | 30–90 sec (randomized) |
| Between InMails | 2–4 min (randomized) |
| Between post likes | 15–45 sec (randomized) |
| Between post comments | 60–120 sec (randomized) |
| After page load (standard) | 3–6 sec |
| After Sales Nav page load | 7–10 sec (buttons render late) |

---

## Two Playbooks

### Playbook A: Sales Navigator
- Navigate to saved search URL (from account config)
- Work results sequentially from top
- Skip: 1st degree (already connected), flag 3rd degree as InMail candidates
- Personalized connection request per profile read
- Flag when search exhausted → alert Darren, wait for new search

### Playbook B: Seamless.ai
- Read lead list from `profiles/[name]/leads/[filename].csv` OR pull via Seamless API
- Navigate directly to each LinkedIn URL
- Same connect + personalize flow
- Mark each row as sent in the CSV after action
- Eventually: Larry queries Seamless API directly (no CSV needed)

---

## Post Engagement Rules

- **Where to find posts:** LinkedIn feed, posts from ICP targets, 1st degree connections
- **Likes:** quick scroll of feed, like relevant/professional posts — no engagement with political/controversial content
- **Comments:** Larry generates thoughtful comments matching the profile's voice/tone — never generic ("Great post!", "So true!")
- **Comment quality bar:** adds a real perspective, asks a question, or shares a brief relevant insight
- **Avoid:** commenting on competitor content, anything that could embarrass the persona

---

## Profile Architecture

```
~/.openclaw/workspace/profiles/
  [account-name]/
    ACCOUNT.md          ← full config (identity, limits, ICP, offer, tone, proxy creds, playbook)
    browser-context/    ← Playwright persistent session (cookies, storage)
    leads/              ← Seamless.ai CSV drops (Playbook B only)
    HISTORY.md          ← running log of all actions — must contain "## Log" header for logToHistory() to work
```

---

## Pilot Plan

- 3 active pilots: Darren, Chris, Nicole
- Running daily since ~March 17 (Darren + Chris), March 27+ (Nicole)
- Validate + stabilize before onboarding more accounts

---

## Key Decisions Log

| Date | Decision |
|------|----------|
| 2026-03-13 | Chose Playwright + real Chrome over SaaS tool (HeyReach) — Open Profile InMail requirement |
| 2026-03-13 | Chose Bright Data residential sticky sessions over NordVPN |
| 2026-03-13 | No sub-agents for daily execution — Larry + Playwright is the full stack |
| 2026-03-13 | Sequential profile execution (one at a time) — LinkedIn safety + Chrome profile locking |
| 2026-03-13 | 45–60 min per profile session, 5am–11pm profile timezone window |
| 2026-03-13 | Added post engagement: 5–10 likes + 3–6 comments per session |
| 2026-03-13 | Replaced Excel tracker + PDF report with daily Slack digest from Larry |
| 2026-03-13 | Email reporting via Postmark from getnarrow.ai |
| 2026-03-13 | Connections: verified via Sales Nav lead profile page + actions overflow menu |
| 2026-03-13 | Comments: fixed duplicate bug — dedup posts by data-id + scope editor to post element |
| 2026-03-16 | Added Slack channel monitoring: C0ALWJRPQ6R with requireMention: false |
| 2026-03-16 | Enabled Slack group DMs (dm.groupEnabled: true) |
| 2026-03-16 | report.js updated to post session summaries to Slack after each run |
| 2026-03-17 | InMails fixed — "draft with AI" overlay bypass + Send button enable polling |
| 2026-03-25 | Built Claude-powered onboarding chat app, deployed to Vercel |
| 2026-03-25 | Fixed Anthropic API key (old key had workspace spend cap — new key issued) |
| 2026-03-26 | Added Step 2 to onboarding: automated LinkedIn login with Playwright + 2FA back-channel |
| 2026-03-26 | Added /intake webhook endpoint — auto-creates ACCOUNT.md + HISTORY.md on intake complete |
| 2026-03-26 | Added LaunchAgent (ai.getnarrow.webhook.plist) — webhook server starts at boot |
| 2026-03-26 | Cloudflare tunnel auto-updates Vercel WEBHOOK_URL env var on restart |
| 2026-03-26 | First client profile onboarded: Nicole DeLutio (OpGen Media) |
| 2026-03-26 | Standard process: raw Sales Nav URLs must be saved via save-search.js before use |
| 2026-03-26 | Nicole fully ready: browser context + ACCOUNT.md + savedSearchId=1985871018 |
| 2026-03-26 | Chris re-onboarded via intake tool — new ACCOUNT.md + templates generated |
| 2026-03-26 | Onboarding now generates Claude message templates on intake complete |
| 2026-03-26 | Onboarding /intake endpoint now backs up existing ACCOUNT.md before overwrite |
| 2026-03-26 | Workspace pushed to private GitHub repo: reelaxis-lee/larry-workspace |
| 2026-03-27 | Fixed follow-ups: name extraction (strip "View …'s profile" from aria-label) + Message button uses contains match `[aria-label*="Message"]` |
| 2026-03-29 | Post engagement: LinkedIn switched feed structure — no more data-id, new selectors for post containers + like buttons |
| 2026-03-29 | Fixed 3 onboarding bugs: offer section name mismatch, HISTORY.md missing ## Log header, hasRunToday() always false |
| 2026-03-29 | Post engagement: LinkedIn switched from Quill to TipTap/ProseMirror editor — all comment selectors updated |
| 2026-03-30 | Scheduler moved to 5:00am PDT (was 8:30am) so EDT profiles can run at 8am their time |
| 2026-03-31 | Lock file added to scheduler — prevents two instances running simultaneously |
| 2026-03-31 | Comments: TipTap requires page.keyboard.type() + page-level Submit button scope — fix deployed |

---

## People

- **Chris Lee** — Boss. getnarrow.ai + ReelAxis. Oceanside/Carlsbad CA. Pacific Time.
- **Darren Duffy** — First pilot profile + ops manager. ReelAxis. San Diego. Pacific Time.
- **Nicole DeLutio** — First client profile (OpGen Media). Toms River, NJ. Eastern Time. Onboarded 2026-03-26.

---

## Automation Stack — Current State (as of 2026-03-31)

### Scripts
```
scripts/
  run-profile.js          ← main session runner (orchestrates all phases)
  setup-profile.js        ← one-time login setup per profile (manual fallback)
  save-search.js          ← convert raw Sales Nav query URL → savedSearchId (run for new profiles)
  scheduler.js            ← timezone-aware daily cron runner (lock file added 2026-03-31)
  phases/
    connect-salenav.js    ← Sales Nav connections ✅ WORKING
    follow-ups.js         ← follow-up messages to accepted connections ✅ WORKING (fixed 2026-03-27)
    post-engagement.js    ← likes + comments ✅ Likes WORKING / Comments fix deployed 2026-03-31 (pending confirm)
    inmails.js            ← InMails to open profiles ✅ WORKING (fixed 2026-03-17, timeout guard added)
  utils/
    browser.js            ← Chrome launch, session verify, delays
    config-loader.js      ← loads ACCOUNT.md per profile (offer section fix 2026-03-29)
    messenger.js          ← Claude API for message/comment generation
    report.js             ← Postmark email + HISTORY.md logging + Slack post
  webhook-server.js       ← Express server (port 3743) — intake + login endpoints
  linkedin-login.js       ← Playwright login with 2FA back-channel
  start-webhook.js        ← starts server + cloudflare tunnel + updates Vercel env vars
```

### LaunchAgents
- `ai.getnarrow.larry.plist` → fires `scheduler.js` at **5:00am daily**
- `ai.getnarrow.webhook.plist` → runs `start-webhook.js` at boot

### Verified Selectors (Sales Navigator)
- Lead cards: `[data-x-search-result="LEAD"]`
- Person name: `[data-anonymize="person-name"]`
- Title: `[data-anonymize="title"]`
- Company: `[data-anonymize="company-name"]`
- Location: `[data-anonymize="location"]`
- Degree badge: `.artdeco-entity-lockup__degree` (text: "· 2nd", "· 1st", "· 3rd")
- Next page: `button[aria-label="Next"]`

### Connection Request Flow (VERIFIED WORKING)
1. Read lead data + degree from card
2. Skip 1st degree, flag 3rd degree as InMail candidate
3. Generate personalized message via Claude
4. Navigate to lead's Sales Nav page
5. Click `button[aria-label="Open actions overflow menu"]`
6. Click `li:has-text("Connect"):not(:has-text("View")):not(:has-text("Copy"))`
7. Fill invite dialog textarea → Send

### Post Engagement Flow (UPDATED 2026-03-29/31 — LinkedIn feed structure changed)
- Post containers: `div[role="listitem"]` (no more `data-id` attributes)
- Skip non-post list items: verify `button[aria-label^="Open control menu for post by"]` exists
- Like: `button[aria-label*="Reaction button state: no reaction"]` (was `aria-pressed="false"`)
- Comment button: `button:has-text("Comment")` scoped to post
- Comment editor: `[aria-label="Text editor for creating comment"]` (LinkedIn switched from Quill to **TipTap/ProseMirror**)
- Typing into editor: `page.keyboard.type()` at page level (NOT `element.type()` — TipTap requires page-level keyboard events)
- Submit button: `page.locator('button:has-text("Submit")').last()` at page level (may render outside listitem)
- Submit polling: up to 8x / 300ms to wait for enabled state

### Follow-up Message Flow (FIXED 2026-03-27)
- Name extraction: `profileLink.getAttribute('aria-label')` → strip `"View "` prefix + `"'s profile"` suffix
- Message button: `[aria-label*="Message"]` (contains match — button includes person's name in aria-label)
- 3-day wait rule: only message connections accepted 3+ days ago

### InMail Flow (VERIFIED WORKING — fixed 2026-03-17)
1. Navigate to Sales Nav search, wait 7–10s for buttons to render
2. Find leads with `button[aria-label^="Message "]` (isVisible timeout: 4000ms)
3. Skip non-Open Profiles (check for `button[aria-label*="InMail credits renewal"]`)
4. Click Message button → compose overlay opens
5. Fill subject via `.type()` with per-char delay
6. Tab from subject into body to dismiss "draft with AI" ghost overlay
7. If still blocked: `click({ force: true })` on `textarea[name="message"]`
8. Type body content via `.type()` with per-char delay
9. Poll `button:has-text("Send")` enabled state up to 10x / 500ms each
10. Click Send when enabled
11. Close conversation overlay

---

## Slack Config
- Channel: `#linkedin-updates` → ID `C0ALWJRPQ6R`
- `requireMention: false` — Larry responds to all messages in that channel
- `dm.groupEnabled: true` — Larry receives group DMs
- Reports post automatically after each profile session

---

## Profile Onboarding System (built 2026-03-25, extended 2026-03-26)

New accounts onboard via a Claude-powered chat app — fully self-service, zero manual steps from Darren.

### Live URL
**https://onboarding-nu-lovat.vercel.app**

### Full End-to-End Flow (as of 2026-03-26)
1. Darren sends URL to new client
2. Client chats with Claude — 5 topic areas covered conversationally:
   - Account details + LinkedIn info
   - Targeting / ICP + Sales Nav URL
   - Messaging strategy (offer, angle, tone, talking points, avoid list)
   - CTA (action, booking link, free offer)
   - Campaign goals + timeline
3. On chat completion:
   - **Vercel POSTs intake JSON to Mac Mini webhook** (`POST /intake`)
   - Mac Mini auto-creates `profiles/<nickname>/ACCOUNT.md`, `HISTORY.md`, `intake.json`
   - HISTORY.md includes `## Log` header (required by logToHistory())
   - Slack notification to #linkedin-updates with profile summary + what's still needed
   - Postmark email backup sent to darren@reelaxis.com
4. Step 2 appears in UI: client enters LinkedIn email + password
5. Playwright on Mac Mini opens Chrome, logs into LinkedIn automatically
6. If 2FA: page shows code entry field → client enters code → Playwright submits it
7. Browser context saved to `profiles/<nickname>/browser-context/`
8. Slack notification: "Session saved for <name> — ready to run"
9. Profile runs automatically at next scheduler cycle (once Sales Nav URL is configured)

**Darren's only remaining manual step:** Provide a Sales Nav search URL (saved or raw query) — Larry handles the rest.

### Sales Nav URL Handling (Standard Process)
When a Sales Nav URL is provided for a new profile:
1. **If it contains `savedSearchId=`** — use it directly in ACCOUNT.md. Done.
2. **If it's a raw query URL** (contains `query=` or `recentSearchParam`) — run `scripts/save-search.js` pattern:
   - Launch Playwright with the profile's browser context
   - Navigate to the raw URL
   - Click the "Save search" toggle in the left sidebar
   - Fill in a descriptive name: `"[Name] ICP — [short description]"`
   - Capture the `savedSearchId` from the redirect URL
   - Update ACCOUNT.md with the clean `savedSearchId=XXXXXXXXXX` URL

**Why this matters:** Raw query URLs include a `sessionId` parameter that expires. Saved searches persist indefinitely.

### config-loader.js — Section Name Mapping (IMPORTANT)
Generated ACCOUNT.md section names vs what config-loader reads:

| config-loader field | ACCOUNT.md section |
|--------------------|-------------------|
| `offerDescription` | `## OFFER & VALUE PROP` + `## CTA & MESSAGING` (combined) |
| `voiceTone` | `## TONE & VOICE` |
| `followUpGuidance` | `## FOLLOW-UP MESSAGE GUIDANCE` |
| `inMailGuidance` | `## INMAIL GUIDANCE` |
| `postEngagementGuidance` | `## POST ENGAGEMENT GUIDANCE` |
| `icp` | `## TARGET ICP` |

### HISTORY.md Format (IMPORTANT)
Must include `## Log` header for `logToHistory()` and `hasRunToday()` to work:
```markdown
# Activity History — [Name]

| Date | Action |
|------|--------|
| YYYY-MM-DD | Profile created — intake complete |

## Log
```
Session entries are inserted after `## Log` as `### YYYY-MM-DD` blocks.

### Message Template Generation
When intake completes, webhook server calls Claude to generate:
- Connection request (under 300 chars, A/B variants)
- Follow-up message (under 100 words, A/B variants)
- InMail subject line + body (under 120 words)
Templates are voice-matched from intake data and written directly into ACCOUNT.md.

### Architecture
```
Vercel (onboarding app):
  onboarding/api/chat.js      ← Claude chat + intake handler + webhook push
  onboarding/api/login.js     ← proxy to Mac Mini webhook (login/status/2fa)
  onboarding/public/index.html ← full UI: chat step + LinkedIn login step

Mac Mini (webhook server):
  scripts/webhook-server.js   ← Express server, port 3743
  scripts/linkedin-login.js   ← Playwright login with 2FA back-channel
  scripts/start-webhook.js    ← starts server + cloudflare tunnel + updates Vercel env vars

LaunchAgent:
  ~/Library/LaunchAgents/ai.getnarrow.webhook.plist ← runs start-webhook.js at boot
```

### Webhook Endpoints (Mac Mini, port 3743)
| Method | Path | Purpose |
|--------|------|---------|
| POST | /login | Start Playwright LinkedIn login |
| GET | /status/:sessionId | Poll login status (logging_in / need_2fa / success / error) |
| POST | /verify-2fa | Submit 2FA verification code |
| POST | /intake | Receive intake JSON → create ACCOUNT.md + HISTORY.md |

### Cloudflare Tunnel
- Uses free quick tunnel (trycloudflare.com) — URL changes on restart
- `start-webhook.js` auto-captures new URL, updates `WEBHOOK_URL` in Vercel, redeploys
- For permanent URL: set up named tunnel via `cloudflared tunnel login` (requires Cloudflare account)

### Repos
- Workspace: https://github.com/reelaxis-lee/larry-workspace
- Onboarding app: https://github.com/reelaxis-lee/larry-onboarding

---

## Active Profiles

| Nickname | Full Name | Company | Timezone | Status |
|----------|-----------|---------|----------|--------|
| darren | Darren Duffy | ReelAxis | America/Los_Angeles | ✅ Active — check Sales Nav search status |
| chris | Chris Lee | getnarrow.ai | America/Los_Angeles | ⚠️ Active — Sales Nav search exhausted (0 connections since ~Mar 30) |
| nicolepindul | Nicole DeLutio | OpGen Media | America/New_York | ✅ Active — savedSearchId=1985871018, 35 connections/day |

### Chris Sales Nav
- savedSearchId=1985861058 — exhausted as of ~March 30
- Needs new saved search from Chris

### Darren Sales Nav  
- savedSearchId=1973008580 — was exhausted ~March 20, appeared to recover briefly
- Monitor — may need new search

---

## Open Questions / To Do

### Blocking
- [ ] Chris: set up new Sales Nav saved search (current exhausted)
- [ ] Get Bright Data account set up (critical before scaling)

### Bugs to Confirm
- [ ] Post comments: TipTap fix deployed 2026-03-31 — confirm working in tomorrow's run
- [ ] InMail duplicate: Chris sent same InMail to Michael Kanaby twice — add "already messaged" dedup guard to inmails.js

### Onboarding System
- [ ] Fix nickname derivation mismatch (chat uses first name, login uses email prefix)
- [ ] Add custom domain: onboard.getnarrow.ai
- [ ] Set up named Cloudflare tunnel (permanent URL)

### Automation (existing profiles)
- [ ] Test follow-up messages end-to-end (selectors fixed but not yet confirmed working in production)
- [ ] Inbox response handling (warm lead replies — not built yet)
- [ ] Review 21+ unread messages in Chris's LinkedIn inbox

### Scaling
- [ ] Confirm from address: larry@getnarrow.ai or reports@getnarrow.ai
- [ ] Determine timezone for each of the 24 profiles (for scheduling)
- [ ] Decide: rotating schedule (all 24, some days) or second Mac Mini (all 24, every day)
- [ ] Seamless.ai API access (Chris to enable)
- [ ] Get details for additional pilot profiles from Chris/Darren
