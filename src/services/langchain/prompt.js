const { loadCore } = require('./index');

async function buildBaseSystemMessages({ currentDate, currentDateTime, currentYear, personaText }) {
  const { PromptTemplate } = await loadCore();

  const dateTpl = PromptTemplate.fromTemplate(
    'The current date is {currentDate} ({currentYear}). Today is {currentDateTime}. Always use this date when answering questions about dates, time, or current events. Do not use the model\'s training date or any other date.'
  );
  const dateContent = await dateTpl.format({ currentDate, currentDateTime, currentYear });

  const guidelines = `IMPORTANT: You are responding in Discord, which does NOT support markdown tables or charts. When presenting data:
- Use simple text lists with bullet points or numbered lists
- Use emoji for visual indicators (📊 📈 📉 ✅ ❌ etc.)
- For comparisons, use simple text format: "Option A: value | Option B: value"
- For rankings, use numbered lists: "1. First item\n2. Second item"
- NEVER use markdown table syntax (| col1 | col2 |)
- NEVER use markdown code blocks for charts or graphs
- Keep data presentation simple and readable in plain text
- Use code blocks only for actual code, not for formatting tables`;

  const concise = 'Make sure your response is as concise as possible';

  const messages = [
    { role: 'system', content: dateContent },
    { role: 'system', content: guidelines },
    { role: 'system', content: concise },
  ];
  if (personaText && personaText.trim()) {
    messages.push({ role: 'system', content: personaText });
  }
  return messages;
}

module.exports = {
  buildBaseSystemMessages,
};



