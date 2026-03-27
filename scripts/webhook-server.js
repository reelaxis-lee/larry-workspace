/**
 * webhook-server.js
 * Local webhook server on the Mac Mini for remote LinkedIn onboarding.
 * Receives login requests from the Vercel onboarding app, runs Playwright,
 * handles 2FA back-channel, saves browser sessions.
 *
 * Run: node scripts/webhook-server.js
 * Exposed via: cloudflared tunnel (see TOOLS.md)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { linkedInLogin } = require('./linkedin-login');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.WEBHOOK_PORT || 3743;

// Active login sessions: Map<sessionId, sessionState>
const sessions = new Map();

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  const token = req.headers['x-webhook-secret'] || req.body?.secret;
  if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── POST /login ───────────────────────────────────────────────────────────────
// Start a LinkedIn login for a new profile.
// Body: { nickname, email, password, secret }
app.post('/login', requireSecret, async (req, res) => {
  const { nickname, email, password } = req.body;

  if (!nickname || !email || !password) {
    return res.status(400).json({ error: 'Missing nickname, email, or password' });
  }

  // Check if profile context already exists (already logged in)
  const contextDir = path.resolve(
    require('os').homedir(),
    `.openclaw/workspace/profiles/${nickname}/browser-context`
  );
  const cookieFile = path.join(contextDir, 'Default', 'Cookies');
  if (fs.existsSync(cookieFile)) {
    return res.json({ status: 'already_exists', message: 'Session already saved for this profile.' });
  }

  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    nickname,
    status: 'logging_in',
    message: null,
    codeResolver: null,
    context: null,
    page: null,
    startedAt: Date.now(),
  };

  sessions.set(sessionId, session);

  // Run login async — don't block the response
  linkedInLogin(nickname, email, password, session)
    .then(() => {
      if (session.status === 'success') {
        console.log(`[webhook] ✅ Login complete for ${nickname}`);
        notifySlack(nickname);
      }
    })
    .catch(err => {
      session.status = 'error';
      session.message = err.message;
      console.error(`[webhook] Login error for ${nickname}:`, err.message);
    });

  res.json({ sessionId, status: 'logging_in' });
});

// ── GET /status/:sessionId ────────────────────────────────────────────────────
// Poll for login status.
app.get('/status/:sessionId', requireSecret, (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    status: session.status,   // logging_in | need_2fa | success | error
    message: session.message || null,
  });
});

// ── POST /verify-2fa ──────────────────────────────────────────────────────────
// Submit a 2FA verification code.
// Body: { sessionId, code, secret }
app.post('/verify-2fa', requireSecret, (req, res) => {
  const { sessionId, code } = req.body;
  if (!sessionId || !code) {
    return res.status(400).json({ error: 'Missing sessionId or code' });
  }

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'need_2fa') {
    return res.status(400).json({ error: `Session is in state: ${session.status}` });
  }
  if (!session.codeResolver) {
    return res.status(500).json({ error: '2FA resolver not ready — try again in a moment' });
  }

  session.status = 'verifying';
  session.codeResolver(code);
  res.json({ status: 'verifying' });
});

// ── POST /intake ──────────────────────────────────────────────────────────────
// Receive completed intake JSON from Vercel, create ACCOUNT.md + HISTORY.md.
// Body: { intake: {...}, secret }
app.post('/intake', requireSecret, async (req, res) => {
  const { intake } = req.body;
  if (!intake || !intake.name) {
    return res.status(400).json({ error: 'Missing intake data' });
  }

  try {
    const nickname = deriveNickname(intake.name);
    const profileDir = path.resolve(require('os').homedir(), `.openclaw/workspace/profiles/${nickname}`);
    const fs = require('fs');
    fs.mkdirSync(profileDir, { recursive: true });

    // Write intake.json for reference
    fs.writeFileSync(path.join(profileDir, 'intake.json'), JSON.stringify(intake, null, 2));

    // Generate message templates via Claude
    console.log(`[webhook] Generating message templates for ${intake.name}...`);
    const templates = await generateMessageTemplates(intake);

    // Generate ACCOUNT.md — back up existing file first if present
    const accountPath = path.join(profileDir, 'ACCOUNT.md');
    if (fs.existsSync(accountPath)) {
      const backupPath = path.join(profileDir, `ACCOUNT.md.bak.${Date.now()}`);
      fs.copyFileSync(accountPath, backupPath);
      console.log(`[webhook] Backed up existing ACCOUNT.md → ${path.basename(backupPath)}`);
    }
    const accountMd = generateAccountMd(nickname, intake, templates);
    fs.writeFileSync(accountPath, accountMd);

    // Create blank HISTORY.md
    const historyPath = path.join(profileDir, 'HISTORY.md');
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, `# Activity History — ${intake.name}\n\n| Date | Action | Target | Outcome |\n|------|--------|--------|---------|\n`);
    }

    console.log(`[webhook] ✅ Profile created for ${intake.name} → ${nickname}`);
    await notifySlackIntake(intake, nickname);
    res.json({ status: 'ok', nickname });

  } catch (err) {
    console.error('[webhook] Intake error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function deriveNickname(name) {
  return name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function generateMessageTemplates(intake) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[webhook] No ANTHROPIC_API_KEY — skipping template generation');
    return null;
  }

  const firstName = intake.name.split(' ')[0];
  const talkingPoints = Array.isArray(intake.talkingPoints) ? intake.talkingPoints.join('\n- ') : intake.talkingPoints || '';
  const avoid = Array.isArray(intake.avoid) ? intake.avoid.join(', ') : intake.avoid || '';
  const titles = (intake.icp?.titles || []).slice(0, 5).join(', ');

  const prompt = `You are writing LinkedIn outreach message templates for a professional named ${firstName}.

Here is their campaign info:
- Offer: ${intake.offer}
- Unique angle: ${intake.angle || 'N/A'}
- Tone: ${intake.tone}
- Talking points: ${talkingPoints}
- Avoid: ${avoid}
- CTA: ${intake.cta}
- Booking link: ${intake.bookingLink || 'None'}
- Free offer/hook: ${intake.freeOffer || 'None'}
- Target titles: ${titles}
- Target industries: ${(intake.icp?.industries || []).join(', ')}
- Connection opener style: ${intake.connectionOpener || 'not specified'}
- Message length preference: ${intake.messageLength || 'short'}
- Additional messaging notes: ${intake.messagingNotes || 'none'}
- Auto-signature: ${intake.autoSignature ? `Yes — "${intake.autoSignature}" (do NOT write a sign-off in the message body)` : 'No — include a natural sign-off'}

Write THREE message templates:

1. CONNECTION REQUEST (max 300 characters — this is a hard LinkedIn limit. count carefully.)
2. FOLLOW-UP MESSAGE (sent 3 days after connecting — under 100 words)  
3. INMAIL MESSAGE (for Open Profiles — subject line + body under 120 words)

Rules:
- Each template uses [First Name] as placeholder
- Match the tone exactly — if casual, be casual. If direct, be direct.
- No filler openers ("Hope you're well", "I wanted to reach out", etc.)
- The connection request must be under 300 characters — count the characters
- Follow-ups should feel human, not like a sequence drip
- InMail subject line: specific and benefit-oriented, under 8 words
- Respect the avoid list strictly
- If auto-signature is set, do NOT write a sign-off in the body
- Write templates ${firstName} would actually send — voice-matched, not generic

Format your response EXACTLY like this (no other text):

CONNECTION_REQUEST:
[the connection request text]

FOLLOWUP_SUBJECT:
[subject line if applicable, else NONE]

FOLLOWUP_MESSAGE:
[the follow-up message text]

INMAIL_SUBJECT:
[the inmail subject line]

INMAIL_BODY:
[the inmail body text]`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;

    // Parse sections
    const extract = (key) => {
      const match = text.match(new RegExp(`${key}:\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
      return match ? match[1].trim() : '';
    };

    return {
      connectionRequest: extract('CONNECTION_REQUEST'),
      followupMessage: extract('FOLLOWUP_MESSAGE'),
      inmailSubject: extract('INMAIL_SUBJECT'),
      inmailBody: extract('INMAIL_BODY'),
    };
  } catch (err) {
    console.error('[webhook] Template generation failed:', err.message);
    return null;
  }
}

// Map common timezone aliases → valid IANA strings
const TIMEZONE_MAP = {
  'eastern':             'America/New_York',
  'eastern time':        'America/New_York',
  'et':                  'America/New_York',
  'est':                 'America/New_York',
  'edt':                 'America/New_York',
  'central':             'America/Chicago',
  'central time':        'America/Chicago',
  'ct':                  'America/Chicago',
  'cst':                 'America/Chicago',
  'cdt':                 'America/Chicago',
  'mountain':            'America/Denver',
  'mountain time':       'America/Denver',
  'mt':                  'America/Denver',
  'mst':                 'America/Denver',
  'mdt':                 'America/Denver',
  'pacific':             'America/Los_Angeles',
  'pacific time':        'America/Los_Angeles',
  'pt':                  'America/Los_Angeles',
  'pst':                 'America/Los_Angeles',
  'pdt':                 'America/Los_Angeles',
  'alaska':              'America/Anchorage',
  'hawaii':              'Pacific/Honolulu',
  'utc':                 'UTC',
  'gmt':                 'UTC',
};

function normalizeTimezone(raw) {
  if (!raw) return 'America/Los_Angeles';
  const trimmed = raw.trim();

  // Already a valid IANA string (contains slash, no spaces beyond the slash)
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(trimmed)) return trimmed;

  // Strip parenthetical suffixes: "America/New_York (Eastern)" → "America/New_York"
  const stripped = trimmed.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(stripped)) return stripped;

  // Try alias lookup (case-insensitive)
  const lookup = stripped.toLowerCase();
  if (TIMEZONE_MAP[lookup]) return TIMEZONE_MAP[lookup];

  // Fallback
  console.warn(`[webhook] Unknown timezone "${raw}" — defaulting to America/Los_Angeles`);
  return 'America/Los_Angeles';
}

function generateAccountMd(nickname, i, templates) {
  const titles = (i.icp?.titles || []).join(', ') || 'Not specified';
  const industries = (i.icp?.industries || []).join(', ') || 'Not specified';
  const talkingPoints = Array.isArray(i.talkingPoints) ? i.talkingPoints.join('\n- ') : i.talkingPoints || 'Not specified';
  const avoid = Array.isArray(i.avoid) ? i.avoid.join(', ') : i.avoid || 'None';
  const displayName = i.name || nickname;

  return `# LinkedIn Larry — Account Config: ${displayName}

---

## ACCOUNT IDENTITY

| Field | Value |
|-------|-------|
| Account nickname | ${nickname} |
| LinkedIn profile name | ${displayName} |
| LinkedIn URL | ${i.linkedinUrl || 'Not provided'} |
| LinkedIn email | ${i.email || '[set before first run]'} |
| Chrome profile path | [to be configured] |
| Customer report email | ${i.email || '[set before first run]'} |
| Timezone | ${normalizeTimezone(i.timezone)} |
| Persona location | ${i.city || 'Not specified'} |
| Bright Data zone | [to be configured] |
| Bright Data proxy URL | [to be configured] |

---

## PLAYBOOK

| Field | Value |
|-------|-------|
| Lead source | [ ] Sales Navigator  [ ] Seamless.ai |
| Sales Nav search URL | ${i.salesNavUrl || '[to be configured]'} |
| Seamless list path | N/A |
| Search status | [ ] Active |

---

## DAILY LIMITS

| Action | Daily Target | Daily Max |
|--------|-------------|-----------|
| Connection requests | 30–40 | 40 |
| Messages (follow-ups + InMails combined) | 30–40 | 40 |
| Post likes | 5–10 | 10 |
| Post comments | 3–6 | 6 |

---

## SESSION TIMING

| Field | Value |
|-------|-------|
| Timezone | ${normalizeTimezone(i.timezone)} |
| Earliest start | 7:00 AM local |
| Latest start | Must complete by 11:00 PM local |
| Target session length | 45–60 min |

---

## INMAIL CREDITS

| Field | Value |
|-------|-------|
| Monthly InMail credit allotment | 150/month |
| Open Profile InMails | Free — do not deduct from credit count |
| Paid credit usage | Only use paid credits if explicitly instructed |

Always prefer Open Profile targets.

---

## AUTO-SIGNATURE

| Field | Value |
|-------|-------|
| LinkedIn auto-signature enabled | ${i.autoSignature ? 'Yes' : 'No'} |
| Signature text | ${i.autoSignature || 'None — include sign-off in message'} |

${i.autoSignature ? 'Do NOT type a sign-off. It is appended automatically.' : 'Include a natural sign-off in each message.'}

---

## TARGET ICP

| Field | Value |
|-------|-------|
| Job titles | ${titles} |
| Industries | ${industries} |
| Company size | ${i.icp?.companySize || 'Not specified'} |
| Geography | ${i.icp?.geography || 'Not specified'} |

---

## OFFER & VALUE PROP

**What this profile offers:**
${i.offer || 'Not specified'}

**Unique angle / differentiator:**
${i.angle || 'Not specified'}

**Talking points:**
- ${talkingPoints}

**Avoid saying:**
${avoid}

**Free offer / hook:**
${i.freeOffer || 'None'}

---

## CTA & MESSAGING

**Primary CTA:**
${i.cta || 'Not specified'}

**Booking link:** ${i.bookingLink || 'None'}

---

## TONE & VOICE

| Field | Value |
|-------|-------|
| Overall tone | ${i.tone || 'Professional and conversational'} |

---

## CAMPAIGN GOALS

**Success looks like:**
${i.goals || 'Not specified'}

**Timeline:**
${i.timeline || 'Ongoing'}

---

## CONNECTION REQUEST GUIDANCE

Max 300 characters (hard LinkedIn limit). ${i.connectionOpener ? `Opening style: ${i.connectionOpener}.` : ''} ${i.messageLength === 'short' ? 'Keep it punchy.' : ''}

${templates?.connectionRequest ? `**Template (generated from intake):**
\`\`\`
${templates.connectionRequest}
\`\`\`` : `**Template:** [To be written — connection opener style: ${i.connectionOpener || 'not specified'}]`}

**What NOT to do:**
${Array.isArray(i.avoid) ? i.avoid.map(a => `- ${a}`).join('\n') : `- ${i.avoid || 'See avoid list above'}`}

---

## FOLLOW-UP MESSAGE GUIDANCE

Sent 3 days after connecting. ${i.messageLength ? `Length preference: ${i.messageLength}.` : 'Keep it short.'}

${templates?.followupMessage ? `**Template (generated from intake):**
\`\`\`
${templates.followupMessage}
\`\`\`` : `**Template:** [To be written]`}

${i.autoSignature ? `Do NOT type a sign-off. "${i.autoSignature}" is appended automatically.` : 'Include a natural sign-off.'}

---

## INMAIL GUIDANCE

Open Profiles only (free). Subject line under 8 words.

${templates?.inmailSubject ? `**Subject line template:**
\`\`\`
${templates.inmailSubject}
\`\`\`` : '**Subject line:** [To be written]'}

${templates?.inmailBody ? `**Body template (generated from intake):**
\`\`\`
${templates.inmailBody}
\`\`\`` : '**Body:** [To be written]'}

---

## SKIP RULES

1. Skip "Saved" leads — already contacted
2. Skip 1st-degree connections — already connected
3. Skip 3rd-degree connections — flag high-value ones as InMail candidates
4. Skip leads clearly outside the target ICP

---

## CHANGE LOG

| Date | Change | Updated by |
|------|--------|------------|
| ${new Date().toISOString().split('T')[0]} | Profile created via onboarding intake | Larry |
`;
}

async function notifySlackIntake(intake, nickname) {
  try {
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    const port = process.env.OPENCLAW_GATEWAY_PORT || 18789;
    if (!token) return;

    await fetch(`http://localhost:${port}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        channel: 'C0ALWJRPQ6R',
        message: `🆕 New profile intake received: *${intake.name}* (${intake.company})\n\nProfile folder: \`profiles/${nickname}/\`\n✅ \`ACCOUNT.md\` created\n✅ \`HISTORY.md\` created\n\n*Still needed before first run:*\n1. Set Chrome profile path in \`ACCOUNT.md\`\n2. Configure Bright Data proxy zone\n3. Set Sales Navigator search URL (if not provided)`,
      }),
    });
  } catch (e) {
    console.error('[webhook] Slack notify failed:', e.message);
  }
}

// ── Cleanup old sessions every 30 min ────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.startedAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000);

// ── Slack notification ────────────────────────────────────────────────────────
async function notifySlack(nickname) {
  try {
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    const port = process.env.OPENCLAW_GATEWAY_PORT || 18789;
    if (!token) return;

    await fetch(`http://localhost:${port}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        channel: 'C0ALWJRPQ6R',
        message: `✅ LinkedIn session saved for *${nickname}* — ready to run.\n\nStill needed:\n1. Set Chrome profile path in \`profiles/${nickname}/ACCOUNT.md\`\n2. Profile will run at next scheduler cycle`,
      }),
    });
  } catch (e) {
    console.error('[webhook] Slack notify failed:', e.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n🔗 Webhook server running on http://localhost:${PORT}`);
  console.log(`   Expose with: cloudflared tunnel --url http://localhost:${PORT}`);
});
