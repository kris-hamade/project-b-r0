require('dotenv').config({ quiet: true });
const OpenAI = require('openai');
const { Client, GatewayIntentBits } = require('discord.js');
const { getGlobalGptModel } = require('../src/utils/config');

async function smokeDiscord() {
  if (!process.env.DISCORD_TESTING_TOKEN) throw new Error('DISCORD_TESTING_TOKEN is missing');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const timeout = setTimeout(() => client.destroy(), 20_000);
  try {
    await client.login(process.env.DISCORD_TESTING_TOKEN);
    if (!client.user) throw new Error('Discord login returned without a user');
    console.log(`Discord testing login passed for ${client.user.tag}.`);
  } finally {
    clearTimeout(timeout);
    client.destroy();
  }
}

async function smokeOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: getGlobalGptModel(),
    input: 'Reply with exactly: OK',
    max_output_tokens: 32,
  });
  if (!response.output_text?.includes('OK')) throw new Error('OpenAI smoke response was unexpected');
  console.log(`OpenAI Responses API smoke test passed with ${getGlobalGptModel()}.`);
}

(async () => {
  await smokeDiscord();
  await smokeOpenAI();
})().catch(error => {
  console.error(`Integration smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
