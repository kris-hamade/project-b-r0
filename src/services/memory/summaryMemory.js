const openai = require('../../openai/openAi');
const UserSummary = require('../../models/userSummary');
const { getWorkloadConfig } = require('../../openai/modelRouting');

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

  const route = getWorkloadConfig('summary');
  const response = await openai.responses.create({
    ...route,
    input: [
      { role: 'developer', content: 'Create compact, privacy-aware summaries for ongoing conversations. Return only summary text.' },
      { role: 'user', content: prompt },
    ],
    text: { verbosity: 'low' },
    max_output_tokens: 300,
    store: false,
  });

  const summary = (response.output_text || '').trim().slice(0, 500);
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



