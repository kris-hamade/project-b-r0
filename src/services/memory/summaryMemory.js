const openai = require('../../openai/openAi');
const UserSummary = require('../../models/userSummary');

async function getOrCreate(userId, username, serverId) {
  let doc = await UserSummary.findOne({ userId, serverId });
  if (!doc) {
    doc = new UserSummary({ userId, username, serverId, summary: '' });
    await doc.save();
  }
  return doc;
}

async function getSummary(userId, serverId) {
  const doc = await UserSummary.findOne({ userId, serverId });
  return doc?.summary || '';
}

async function updateSummary(userId, username, serverId, previousSummary, userMessage, assistantReply) {
  const prompt = `You maintain a short, privacy-aware conversation summary for a Discord user within a server.\n` +
    `Update the summary with the latest interaction while keeping it under 500 characters.\n` +
    `Do not include sensitive medical/mental health content.\n\n` +
    `Previous summary:\n${previousSummary || '(none)'}\n\n` +
    `Latest messages:\nUSER: ${userMessage}\nASSISTANT: ${assistantReply}\n\n` +
    `Return only the updated summary text.`;

  const response = await openai.chat.completions.create({
    model: process.env.SUMMARY_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You create compact summaries for ongoing conversations.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_completion_tokens: 300
  });

  const summary = (response.choices?.[0]?.message?.content || '').trim().slice(0, 600);
  const doc = await getOrCreate(userId, username, serverId);
  doc.summary = summary;
  doc.updatedAt = new Date();
  await doc.save();
  return summary;
}

module.exports = {
  getSummary,
  updateSummary,
};



