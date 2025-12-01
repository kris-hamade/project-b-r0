const openai = require('../../openai/openAi');
const { loadCore } = require('../langchain/index');

const MIN_CONFIDENCE = parseFloat(process.env.FACT_CONFIDENCE_MIN || '0.75');

async function getParserAndPrompt() {
  const { StructuredOutputParser, PromptTemplate, z } = await loadCore();
  const schema = z.object({
    facts: z.array(z.object({
      fact: z.string().min(3).describe('A short, declarative fact about the user, e.g., "likes steak"'),
      category: z.enum(['preference_like','preference_dislike','bio','pronouns','timezone','game_role','other']),
      confidence: z.number().min(0).max(1).describe('Confidence 0-1'),
    })).describe('A list of extracted facts about the user'),
  });
  const parser = StructuredOutputParser.fromZodSchema(schema);
  const formatInstructions = parser.getFormatInstructions();
  const template = PromptTemplate.fromTemplate(
`Extract stable, long-term personal facts about the USER from the message below.
- Only include facts if the user states them clearly.
- Prefer durable preferences and personal details (likes/dislikes, timezone, pronouns, roles).
- Ignore ephemeral context or sensitive/medical content.
- Keep each fact short and declarative, e.g., "likes steak", "timezone PST".

Return ONLY valid JSON in the exact format requested.

{format_instructions}

USER MESSAGE:
{message}`
  );
  return { parser, template, formatInstructions };
}

async function extractFactsFromMessage(messageContent) {
  if (!messageContent || typeof messageContent !== 'string') return [];
  const { parser, template, formatInstructions } = await getParserAndPrompt();
  const prompt = await template.format({
    message: messageContent,
    format_instructions: formatInstructions,
  });

  const response = await openai.chat.completions.create({
    model: process.env.FACT_EXTRACTOR_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a precise information extraction system.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = await parser.parse(content);
  } catch (err) {
    try {
      parsed = JSON.parse(content);
    } catch (_e) {
      return [];
    }
  }
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
  extractFactsFromMessage,
};



