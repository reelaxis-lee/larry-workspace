# TOOLS.md - Local Notes

## Machine
- **Host:** Darren's Mac Mini (arm64, Darwin 25.3.0)
- **Working dir:** `~/.openclaw/workspace/`
- **Node:** v24.14.0

## Browser Sessions (how it actually works)

Each LinkedIn account uses a **Playwright persistent context** — an isolated browser environment with its own cookies, localStorage, and session. Chrome's native profile system (Profile 1, Profile 2, etc.) is NOT used by the automation.

| Profile | Context directory |
|---------|------------------|
| darren | `profiles/darren/browser-context/` |
| chris | `profiles/chris/browser-context/` |
| nicolepindul | `profiles/nicolepindul/browser-context/` |

When a session runs, Playwright launches Chrome with `--user-data-dir=profiles/<nickname>/browser-context/`. Each account is fully isolated — Chrome has no knowledge of the other accounts.

Sessions are created either via:
- `node scripts/setup-profile.js <nickname>` — manual one-time login (fallback)
- The onboarding app Step 2 — automated Playwright login (standard path)

## Profile Nicknames
- `darren` → `profiles/darren/` — Darren Duffy, Pacific Time
- `chris` → `profiles/chris/` — Chris Lee, Pacific Time
- `nicolepindul` → `profiles/nicolepindul/` — Nicole DeLutio, Eastern Time (OpGen Media)

## Sales Navigator URLs
- Darren: `savedSearchId=1973008580` ⚠️ EXHAUSTED — needs new search
- Chris: `savedSearchId=1962706540`
- Nicole: `savedSearchId=1985871018` — "Nicole ICP — B2B Tech VPs Directors US" — VP/Director/CMO at 500+ employee B2B tech, US-wide

## API Keys / Services
- **Anthropic (Claude):** in `.env` as `ANTHROPIC_API_KEY`
- **Postmark:** API key `e5451295-0d10-4ef9-a7f6-8f6799d8b798` — email reports
- **Bright Data:** not yet configured — needed before scaling

## Slack
- **Report channel:** `#linkedin-updates` → ID `C0ALWJRPQ6R`
- **Larry listens in:** that channel (requireMention: false) + all DMs + group DMs
- **OpenClaw gateway port:** 18789
- **Config file:** `~/.openclaw/openclaw.json`

## LaunchAgents
| Plist | Purpose | Trigger |
|-------|---------|---------|
| `ai.getnarrow.larry.plist` | Daily scheduler → `scheduler.js` | 8:30am daily |
| `ai.getnarrow.webhook.plist` | Webhook server + Cloudflare tunnel → `start-webhook.js` | At boot (RunAtLoad) |

- Restart scheduler: `launchctl kickstart -k gui/501/ai.getnarrow.larry`
- Restart webhook: `launchctl kickstart -k gui/501/ai.getnarrow.webhook`

## Useful Commands
```bash
# Run a profile manually
node scripts/run-profile.js darren
node scripts/run-profile.js chris

# One-time login setup for a new profile (manual fallback — onboarding app handles this automatically now)
node scripts/setup-profile.js <nickname>

# Start webhook server manually (normally handled by LaunchAgent)
node scripts/start-webhook.js

# Convert a raw Sales Nav query URL to a saved search (run when URL lacks savedSearchId)
node scripts/save-search.js <nickname> "<rawSalesNavUrl>" "<Search Name>"
# → prints the stable savedSearchId URL to paste into ACCOUNT.md

# Restart LaunchAgents
launchctl kickstart -k gui/501/ai.getnarrow.larry    # scheduler
launchctl kickstart -k gui/501/ai.getnarrow.webhook  # webhook server

# Tail logs
openclaw logs --follow
tail -f logs/webhook.log
tail -f logs/scheduler.log

# Restart OpenClaw gateway
openclaw gateway restart
```

## Onboarding App
- **Live URL:** https://onboarding-nu-lovat.vercel.app
- **Repo:** https://github.com/reelaxis-lee/larry-onboarding
- **Local dir:** `onboarding/`
- **Webhook server:** `scripts/webhook-server.js` — port 3743
- **Tunnel:** Cloudflare quick tunnel — URL auto-updates in Vercel on restart
- **Deploy:** `cd onboarding && vercel --token $VERCEL_TOKEN --yes --prod`
- **Intake emails sent to:** darren@reelaxis.com via Postmark
- **On intake complete:** intake JSON POSTed to Mac Mini → ACCOUNT.md + HISTORY.md auto-created
- **On login complete:** browser-context saved → Slack notification sent

## Credentials
- `GITHUB_TOKEN` — in `.env` — reelaxis-lee org (repo + read:org scope)
- `VERCEL_TOKEN` — in `.env` — reelaxis team deploy access

## Key File Paths
```
scripts/run-profile.js              ← main session runner
scripts/scheduler.js                ← daily cron orchestrator
scripts/setup-profile.js            ← manual one-time login (fallback)
scripts/webhook-server.js           ← onboarding webhook (login + intake endpoints)
scripts/linkedin-login.js           ← Playwright login with 2FA support
scripts/start-webhook.js            ← startup: server + cloudflare + Vercel update
scripts/save-search.js              ← convert raw Sales Nav query URL → savedSearchId (run for new profiles)
scripts/phases/connect-salenav.js
scripts/phases/follow-ups.js
scripts/phases/post-engagement.js
scripts/phases/inmails.js           ← fixed 2026-03-17
scripts/utils/browser.js
scripts/utils/config-loader.js
scripts/utils/messenger.js          ← Claude API for message/comment generation
scripts/utils/report.js             ← Postmark + HISTORY.md logging + Slack post
onboarding/api/chat.js              ← Vercel: Claude chat + intake handler
onboarding/api/login.js             ← Vercel: proxy to Mac Mini webhook
onboarding/public/index.html        ← Onboarding UI (chat + LinkedIn login step)
profiles/darren/ACCOUNT.md
profiles/chris/ACCOUNT.md
profiles/nicolepindul/ACCOUNT.md    ← created 2026-03-26
~/Library/LaunchAgents/ai.getnarrow.larry.plist
~/Library/LaunchAgents/ai.getnarrow.webhook.plist
logs/webhook.log
logs/scheduler.log
```
