/**
 * messenger.js — Generate personalized LinkedIn messages via Anthropic API
 * Used for connection requests, follow-ups, InMails, and post comments.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load global rules — applied to every message generation call
let GLOBAL_RULES = '';
try {
  GLOBAL_RULES = fs.readFileSync(
    path.resolve(__dirname, '../../GLOBAL.md'), 'utf8'
  );
} catch (e) {
  console.warn('[messenger] GLOBAL.md not found — no global rules applied');
}

/**
 * Generate a personalized connection request message (max 300 chars).
 */
async function generateConnectionRequest(accountConfig, leadProfile) {
  const leadFirstName = leadProfile.name ? leadProfile.name.split(' ')[0] : 'there';
  const prompt = `You are writing a LinkedIn connection request MESSAGE.

SENDER (the person sending the request): ${accountConfig.name}
RECIPIENT (the person receiving the request): ${leadProfile.name}

The message is written BY ${accountConfig.name} TO ${leadProfile.name}.
Never address ${accountConfig.name} by name — they are the sender, not the recipient.
If you use a salutation, use ${leadFirstName}'s name, not the sender's.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT THE SENDER (${accountConfig.name}):
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

RECIPIENT PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}
Location: ${leadProfile.location || 'unknown'}
Tenure: ${leadProfile.tenure || 'unknown'}
Mutual connections: ${leadProfile.mutualConnections || 0}
About snippet: ${leadProfile.about || 'none'}
Recent activity: ${leadProfile.recentActivity || 'none'}

RULES:
- Maximum 300 characters (HARD LIMIT — count carefully)
- Target 240–285 characters
- Written from ${accountConfig.name}'s perspective, addressed to ${leadProfile.name}
- Reference a specific detail from the recipient's profile
- No pitch in connection requests — just connect
- No links
- Vary your openers — do not always start with the recipient's name

BANNED PHRASES: ${accountConfig.bannedPhrases || 'synergy, leverage, circle back, touch base, cutting-edge'}

Write ONLY the message text. Nothing else. No quotes, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  const message = response.content[0].text.trim();

  // Safety check: enforce 300 char limit
  if (message.length > 300) {
    // Truncate at last space before 300
    return message.substring(0, 297).replace(/\s+\S*$/, '...');
  }

  return message;
}

/**
 * Generate a follow-up message after connection accepted.
 */
async function generateFollowUp(accountConfig, leadProfile) {
  const leadFirstName = leadProfile.name ? leadProfile.name.split(' ')[0] : leadProfile.name;
  const prompt = `You are writing a LinkedIn follow-up message. This message is written BY ${accountConfig.name} TO ${leadFirstName}.

SENDER (writing the message): ${accountConfig.name}
RECIPIENT (receiving the message): ${leadProfile.name}

Never address ${accountConfig.name} by name — they are the sender, not the recipient.
If the message opens with a name, it must be ${leadFirstName}'s name, not ${accountConfig.name}'s.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT THE SENDER (${accountConfig.name}):
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

FOLLOW-UP GUIDANCE:
${accountConfig.followUpGuidance}

RECIPIENT PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}

RULES:
- 3–4 sentences max
- Warm, human, conversational
- Soft offer — no hard sell
- No links
- No "I'd love to hop on a quick call"

Write ONLY the message text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Generate an InMail message (subject + body).
 */
async function generateInMail(accountConfig, leadProfile) {
  const leadFirstName = leadProfile.name ? leadProfile.name.split(' ')[0] : leadProfile.name;
  const prompt = `You are writing a LinkedIn InMail. This message is written BY ${accountConfig.name} TO ${leadFirstName}.

SENDER (writing the message): ${accountConfig.name}
RECIPIENT (receiving the message): ${leadProfile.name}

Never address ${accountConfig.name} by name — they are the sender, not the recipient.
If the message opens with a name, it must be ${leadFirstName}'s name, not ${accountConfig.name}'s.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT THE SENDER (${accountConfig.name}):
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

INMAIL GUIDANCE:
${accountConfig.inMailGuidance}

RECIPIENT PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}
Location: ${leadProfile.location || 'unknown'}

RULES:
- Subject: under 60 characters, feels personal, not generic
- Body: under 120 words
- One clear CTA — not multiple questions
- No links unless account config says otherwise
- ${accountConfig.hasAutoSignature ? 'Do NOT include a sign-off — auto-signature is appended' : 'Include a natural sign-off'}

Return in this exact format:
SUBJECT: [subject line]
BODY: [message body]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch ? subjectMatch[1].trim() : 'Quick thought',
    body: bodyMatch ? bodyMatch[1].trim() : text,
  };
}

/**
 * Generate a post comment.
 */
async function generatePostComment(accountConfig, postContent, postAuthor) {
  const prompt = `You are writing a LinkedIn comment for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

VOICE & TONE:
${accountConfig.voiceTone}

POST ENGAGEMENT GUIDANCE:
${accountConfig.postEngagementGuidance}

POST AUTHOR: ${postAuthor}
POST CONTENT: ${postContent}

RULES:
- Max 2 sentences
- Adds a real perspective, asks a genuine question, or shares a brief insight
- Sounds like a real person, not a marketer
- Never generic ("Great post!", "So true!", "Love this!")
- No self-promotion

Write ONLY the comment text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Classify an inbox message's intent.
 * Returns { intent: 'positive'|'neutral'|'negative'|'skip', reason: string }
 */
async function classifyInboxMessage(accountConfig, { contactName, messages, lastMessage }) {
  const convoText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');

  const prompt = `You are analyzing a LinkedIn message thread for ${accountConfig.name} to determine how to respond.

CONVERSATION:
${convoText}

LATEST MESSAGE FROM ${contactName}:
"${lastMessage}"

ACCOUNT'S OFFER:
${accountConfig.offerDescription}

Classify the intent of ${contactName}'s latest message into ONE of these categories:
- positive: They are clearly interested, want to learn more, asked to schedule a call, said yes, or gave a positive buying signal
- neutral: They asked a clarifying question, gave a general professional response, or are open but not clearly interested yet
- negative: They are not interested, asked to be removed, said stop, or expressed frustration
- skip: The message is completely unrelated (e.g., a generic LinkedIn notification, spam, automated message, or they are clearly talking about something else entirely)

Return ONLY a JSON object like this, nothing else:
{"intent": "positive", "reason": "They asked to schedule a demo"}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    return JSON.parse(response.content[0].text.trim());
  } catch {
    return { intent: 'skip', reason: 'parse error' };
  }
}

/**
 * Generate a reply to an inbox message.
 */
async function generateInboxReply(accountConfig, { contactName, messages, lastMessage, intent }) {
  const convoText = messages.map(m => `${m.sender}: ${m.text}`).join('\n');

  const intentGuide = intent === 'positive'
    ? 'They are interested. Move toward booking a call or next step. Keep it warm and not pushy.'
    : 'They asked a question or gave a neutral response. Answer naturally and keep the conversation going. Do not pitch hard.';

  const prompt = `You are writing a LinkedIn reply for ${accountConfig.name}.

=== GLOBAL RULES (override everything else) ===
${GLOBAL_RULES}
=== END GLOBAL RULES ===

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

CONVERSATION SO FAR:
${convoText}

LATEST MESSAGE FROM ${contactName}:
"${lastMessage}"

INTENT: ${intentGuide}

RULES:
- 2–4 sentences max
- Sound like a real person continuing a real conversation
- Address what they actually said
- ${intent === 'positive' ? 'Suggest a next step (call, demo, or send them a link if config allows)' : 'Keep it conversational — no hard sell'}
- No bullet points
- ${accountConfig.hasAutoSignature ? 'No sign-off — auto-signature is appended' : 'End naturally'}

Write ONLY the reply text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

module.exports = {
  generateConnectionRequest,
  generateFollowUp,
  generateInMail,
  generatePostComment,
  classifyInboxMessage,
  generateInboxReply,
};
