const { zodTextFormat } = require('openai/helpers/zod');
const openai = require('./openAi');

function findRefusal(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'refusal') return content.refusal || 'Request refused';
    }
  }
  return null;
}

async function parseStructuredResponse({ name, schema, model, reasoning, input, maxOutputTokens, safetyIdentifier }) {
  const response = await openai.responses.parse({
    model,
    input,
    reasoning,
    text: { format: zodTextFormat(schema, name) },
    max_output_tokens: maxOutputTokens,
    store: false,
    ...(safetyIdentifier && { safety_identifier: safetyIdentifier }),
  });

  if (response.output_parsed) return response.output_parsed;
  const refusal = findRefusal(response);
  if (refusal) throw new Error(`OpenAI refused the structured request: ${refusal}`);
  throw new Error(`OpenAI returned no parsed ${name} output (status: ${response.status || 'unknown'})`);
}

module.exports = { parseStructuredResponse };
