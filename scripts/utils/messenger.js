/**
 * messenger.js — Generate personalized LinkedIn messages via Anthropic API
 * Used for connection requests, follow-ups, InMails, and post comments.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a personalized connection request message (max 300 chars).
 */
async function generateConnectionRequest(accountConfig, leadProfile) {
  const prompt = `You are writing a LinkedIn connection request for ${accountConfig.name}.

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

LEAD PROFILE:
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
- Must sound like ${accountConfig.name} wrote it personally
- Reference a specific detail from the lead's profile
- No pitch in connection requests — just connect
- No links
- Use -- instead of em dashes
- Max 1 exclamation point
- Never start with "Hi [Name]" every time — vary openers
- No synergy, leverage, circle back, touch base, cutting-edge

BANNED PHRASES: ${accountConfig.bannedPhrases || 'synergy, leverage, circle back, touch base, cutting-edge'}

Write ONLY the message text. Nothing else. No quotes, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
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
  const prompt = `You are writing a LinkedIn follow-up message for ${accountConfig.name}, sent after a connection request was accepted.

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

FOLLOW-UP GUIDANCE:
${accountConfig.followUpGuidance}

LEAD PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}

RULES:
- 3–4 sentences max
- Warm, human, conversational
- Soft offer — no hard sell
- No links
- No "I'd love to hop on a quick call"
- Use -- instead of em dashes
- No synergy, leverage, or corporate speak

Write ONLY the message text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Generate an InMail message (subject + body).
 */
async function generateInMail(accountConfig, leadProfile) {
  const prompt = `You are writing a LinkedIn InMail for ${accountConfig.name}.

ABOUT ${accountConfig.name.toUpperCase()}:
${accountConfig.offerDescription}

VOICE & TONE:
${accountConfig.voiceTone}

INMAIL GUIDANCE:
${accountConfig.inMailGuidance}

LEAD PROFILE:
Name: ${leadProfile.name}
Title: ${leadProfile.title}
Company: ${leadProfile.company}
Location: ${leadProfile.location || 'unknown'}

RULES:
- Subject: under 60 characters, feels personal, not generic
- Body: under 120 words
- One clear CTA — not multiple questions
- No links unless account config says otherwise
- Do NOT include a sign-off/name (auto-signature handles it)
- Use -- instead of em dashes

Return in this exact format:
SUBJECT: [subject line]
BODY: [message body]`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
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

VOICE & TONE:
${accountConfig.voiceTone}

POST AUTHOR: ${postAuthor}
POST CONTENT: ${postContent}

RULES:
- Max 2 sentences
- Adds a real perspective, asks a genuine question, or shares a brief insight
- Sounds like a real person, not a marketer
- Never generic ("Great post!", "So true!", "Love this!")
- No self-promotion
- Matches the account's voice

Write ONLY the comment text. Nothing else.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

module.exports = {
  generateConnectionRequest,
  generateFollowUp,
  generateInMail,
  generatePostComment,
};
