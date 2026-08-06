const { z } = require('zod');
const { parseStructuredResponse } = require('../../openai/structuredOutput');
const { getWorkloadConfig } = require('../../openai/modelRouting');

const MIN_CONFIDENCE = parseFloat(process.env.FACT_CONFIDENCE_MIN || '0.75');

const factExtractionSchema = z.object({
    facts: z.array(z.object({
      fact: z.string().min(3).describe('A short, declarative fact about the user, e.g., "likes steak"'),
      category: z.enum(['preference_like','preference_dislike','bio','pronouns','timezone','game_role','other']),
      confidence: z.number().min(0).max(1).describe('Confidence 0-1'),
    })).max(12).describe('Stable, non-sensitive facts explicitly stated by the user'),
});

async function extractFactsFromMessage(messageContent) {
  if (!messageContent || typeof messageContent !== 'string') return [];
  const route = getWorkloadConfig('factExtraction');
  const parsed = await parseStructuredResponse({
    name: 'user_facts',
    schema: factExtractionSchema,
    ...route,
    maxOutputTokens: 600,
    input: [
      { role: 'developer', content: 'Extract only stable, long-term, non-sensitive facts explicitly stated by the user. Ignore ephemeral context and medical or mental-health content. Keep each fact short and declarative.' },
      { role: 'user', content: messageContent },
    ],
  });
  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const filtered = facts.filter(f => typeof f.fact === 'string' && f.fact.trim().length >= 3 && (f.confidence ?? 0) >= MIN_CONFIDENCE);

  // Normalize duplicates
  const seen = new Set();
  const deduped = [];
  for (const f of filtered) {
    const key = `${f.category || 'other'}::${f.fact.toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push({
        fact: f.fact.trim(),
        category: f.category || 'other',
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
      });
    }
  }
  return deduped;
}

module.exports = {
  factExtractionSchema,
  extractFactsFromMessage,
};



