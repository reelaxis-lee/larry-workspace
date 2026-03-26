# MEMORY.md — Larry's Long-Term Memory

## Last Updated: 2026-03-26

---

## Who I Am

- Name: Larry, LinkedIn Specialist Agent
- Running on: Darren's Mac Mini (this machine)
- Managed by: Chris Lee (getnarrow.ai + ReelAxis)

---

## The System We're Building

### Purpose
Fully autonomous LinkedIn outreach system managing 24 LinkedIn profiles. Runs daily without human intervention. All actions look human to LinkedIn.

### Tech Stack
- **Orchestrator:** Larry (me, OpenClaw on this Mac Mini)
- **Browser automation:** Playwright with real Chrome (not headless, not Chromium)
- **Proxy:** Bright Data — one dedicated residential sticky session zone per profile
- **Lead sources:** Sales Navigator (most profiles) + Seamless.ai (some profiles, CSV export or API)
- **Logging:** Profile HISTORY.md files + daily Slack digest to Chris
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
- One-time human login per profile — session saved, reused every run
- Proxy consistency is critical: same Bright Data zone per profile every time
- If LinkedIn shows login screen or CAPTCHA → Larry stops and alerts Chris via Slack immediately

---

## Daily Workflow Per Profile

### Scheduling Rules
- Operating window: **5am–11pm in the profile's local timezone** (never outside this)
- Start times randomized within the window (no robot-exact 7:00:00am starts)
- One profile at a time, sequentially — never two LinkedIn accounts open simultaneously
- Each profile session: **45–60 minutes** (randomized to look human)
- Max profiles per day on one machine: ~16–18 (math: 16hr window ÷ ~52min avg)
- 24 profiles: rotating schedule OR second Mac Mini

### Session Flow (per profile)
```
1. Pre-flight: read account config, check if already run today
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
- Flag when search exhausted → alert Chris, wait for new search

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
    HISTORY.md          ← running log of all actions (date, action type, target, outcome)
```

---

## Pilot Plan

- Start with **2–3 profiles** before scaling to 24
- Active pilots: Darren (Chrome "Profile 1") + Chris (Chrome "Profile 2")
- Validate full end-to-end flow before onboarding more accounts

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

---

## People

- **Chris Lee** — Boss. getnarrow.ai + ReelAxis. Oceanside/Carlsbad CA. Pacific Time.
- **Darren Duffy** — First pilot profile. ReelAxis. San Diego. Chrome "Profile 1" on this machine.
- **Nicole DeLutio** — First client profile (OpGen Media). Toms River, NJ. Eastern Time. Onboarded 2026-03-26.

---

## Automation Stack — What's Built & Working (as of 2026-03-17)

### Scripts
```
scripts/
  run-profile.js          ← main session runner (orchestrates all phases)
  setup-profile.js        ← one-time login setup per profile (manual fallback)
  save-search.js          ← convert raw Sales Nav query URL → savedSearchId (run for new profiles)
  scheduler.js            ← timezone-aware daily cron runner
  phases/
    connect-salenav.js    ← Sales Nav connections ✅ WORKING
    follow-ups.js         ← follow-up messages to accepted connections ✅ built, untested
    post-engagement.js    ← likes + comments on feed ✅ WORKING
    inmails.js            ← InMails to open profiles ✅ WORKING (fixed 2026-03-17)
  utils/
    browser.js            ← Chrome launch, session verify, delays
    config-loader.js      ← loads ACCOUNT.md per profile
    messenger.js          ← Claude API for message/comment generation
    report.js             ← Postmark email + HISTORY.md logging + Slack post
```

### LaunchAgent
- Plist: `/Users/darrenduffy/Library/LaunchAgents/ai.getnarrow.larry.plist`
- Fires scheduler.js at 8:30am daily
- Scheduler checks profile timezones and skips if outside 5am–11pm window

### Verified Selectors (Sales Navigator)
- Lead cards: `[data-x-search-result="LEAD"]`
- Person name: `[data-anonymize="person-name"]`
- Title: `[data-anonymize="title"]`
- Company: `[data-anonymize="company-name"]`
- Location: `[data-anonymize="location"]`
- Degree badge: `.artdeco-entity-lockup__degree` (text: "· 2nd", "· 1st", "· 3rd")
- Next page: `button[aria-label="Next"]`

### Connection Request Flow (VERIFIED WORKING 2026-03-13)
1. Read lead data + degree from card
2. Skip 1st degree, flag 3rd degree as InMail candidate
3. Generate personalized message via Claude
4. Navigate to lead's Sales Nav page
5. Click `button[aria-label="Open actions overflow menu"]`
6. Click `li:has-text("Connect"):not(:has-text("View")):not(:has-text("Copy"))`
7. Fill invite dialog textarea → Send

### Post Engagement Flow (VERIFIED WORKING 2026-03-13)
- Post selector: `[data-id^="urn:li:activity"]`
- Dedup by `data-id` before processing
- Like: `button[aria-label*="React Like"]` where `aria-pressed="false"`
- Comment editor: `.ql-editor[contenteditable="true"]` — scoped to post element
- Submit: `button.comments-comment-box__submit-button--cr` — scoped to post
- Escape before/after each comment to close open editors

### InMail Flow (VERIFIED WORKING 2026-03-17)
1. Navigate to Sales Nav search, wait 7–10s for buttons to render
2. Find leads with `button[aria-label^="Message "]` (isVisible timeout: 4000ms)
3. Skip non-Open Profiles (check for `button[aria-label*="InMail credits renewal"]`)
4. Click Message button → compose overlay opens
5. Fill subject via `.type()` with per-char delay (triggers LinkedIn change events)
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
2. **If it's a raw query URL** (contains `query=` or `recentSearchParam`) — run `scripts/save-nicole-search.js` pattern:
   - Launch Playwright with the profile's browser context
   - Navigate to the raw URL
   - Click the "Save search" toggle in the left sidebar
   - Fill in a descriptive name: `"[Name] ICP — [short description]"`
   - Capture the `savedSearchId` from the redirect URL
   - Update ACCOUNT.md with the clean `savedSearchId=XXXXXXXXXX` URL
   - Update TOOLS.md with the saved search ID and name
   
**Why this matters:** Raw query URLs include a `sessionId` parameter that expires. Saved searches persist indefinitely and return a stable `savedSearchId` URL that works reliably every run.

### What Claude Collects (and enforces)
- Only 5 areas in scope (listed above)
- Hard blocks on: daily limits, workflow/process questions, cross-account references
- Redirect phrase: "That's handled by the team on the backend"
- Intake JSON includes: name, linkedinUrl, company, email, timezone, city, icp (titles/industries/companySize/geography), salesNavUrl, offer, angle, tone, talkingPoints, avoid, cta, bookingLink, freeOffer, goals, timeline, autoSignature

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

### Env Vars (Vercel)
- `ANTHROPIC_API_KEY` — active key (updated 2026-03-25)
- `POSTMARK_API_KEY` — e5451295-0d10-4ef9-a7f6-8f6799d8b798
- `INTAKE_NOTIFY_EMAIL` — darren@reelaxis.com
- `WEBHOOK_URL` — cloudflare tunnel URL (auto-updated on Mac Mini restart)
- `WEBHOOK_SECRET` — matches Mac Mini .env (auto-updated on Mac Mini restart)

### Repo
https://github.com/reelaxis-lee/larry-onboarding

### Deploy
```bash
cd onboarding && vercel --token $VERCEL_TOKEN --yes --prod
```

### Known Bug (to fix)
Nickname derivation mismatch: chat step derives from first name ("nicole"), login step derives from email prefix ("nicolepindul"). Folders can end up in different locations. Fix: pass nickname from chat step through to login step via hidden field in UI.

---

## Active Profiles

| Nickname | Full Name | Company | Timezone | Status |
|----------|-----------|---------|----------|--------|
| darren | Darren Duffy | ReelAxis | America/Los_Angeles | ✅ Active (Sales Nav exhausted — needs new search) |
| chris | Chris Lee | getnarrow.ai | America/Los_Angeles | ✅ Active |
| nicolepindul | Nicole DeLutio | OpGen Media | America/New_York | ✅ Ready — savedSearchId=1985871018 |

### Nicole DeLutio — Profile Notes
- Onboarded 2026-03-26 via intake chat
- ICP: VP/Director/CMO level at 500+ employee B2B tech companies (SaaS, Fintech, Healthcare, etc.) — US-wide
- Offer: Verified MQLs, cost-per-lead model, you only pay for leads you approve
- Hook: Free ICP assessment before commitment
- Booking: http://calendly.com/msp-one/opgen-intro
- A/B testing enabled
- Browser context: ✅ saved at profiles/nicolepindul/browser-context/
- Sales Nav URL: ✅ `savedSearchId=1985871018` — "Nicole ICP — B2B Tech VPs Directors US"

---

## Open Questions / To Do

### Blocking (can't run without these)
- [x] Nicole: Sales Nav search saved — savedSearchId=1985871018
- [ ] Darren: set up new Sales Nav saved search (current one exhausted since Mar 20)
- [ ] Get Bright Data account set up (critical before scaling — currently no proxies)

### Onboarding System
- [ ] Fix nickname derivation mismatch (chat uses first name, login uses email prefix)
- [ ] Add custom domain: onboard.getnarrow.ai
- [ ] Set up named Cloudflare tunnel (permanent URL, requires Cloudflare account login)

### Automation (existing profiles)
- [ ] Debug post comments dropout on Darren's profile (stopped ~March 22)
- [ ] Test follow-up messages (first eligible batch was ~March 20 — still untested)
- [ ] Inbox response handling (warm lead replies — not built yet)
- [ ] Review 21+ unread messages in Darren's LinkedIn inbox

### Scaling
- [ ] Confirm from address: larry@getnarrow.ai or reports@getnarrow.ai
- [ ] Determine timezone for each of the 24 profiles (for scheduling)
- [ ] Decide: rotating schedule (all 24, some days) or second Mac Mini (all 24, every day)
- [ ] Seamless.ai API access (Chris to enable)
- [ ] Get details for additional pilot profiles from Chris/Darren
