// Dynamic import helpers for LangChain (ESM-only) from CommonJS code
async function loadCore() {
  const [{ StructuredOutputParser }, { PromptTemplate }] = await Promise.all([
    import('@langchain/core/output_parsers'),
    import('@langchain/core/prompts'),
  ]);
  const { z } = await import('zod');
  return { StructuredOutputParser, PromptTemplate, z };
}

module.exports = {
  loadCore,
};



