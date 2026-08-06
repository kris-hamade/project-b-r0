const assert = require('node:assert/strict');
const test = require('node:test');
const { createSafetyIdentifier, getWorkloadConfig } = require('../src/openai/modelRouting');

test('routes interactive and background workloads to appropriate GPT-5.6 tiers', () => {
  assert.equal(getWorkloadConfig('chat').model, process.env.GLOBAL_GPT_MODEL || 'gpt-5.6-terra');
  assert.equal(getWorkloadConfig('scheduling').model, process.env.SCHEDULING_MODEL || 'gpt-5.6-luna');
  assert.equal(getWorkloadConfig('responseCheck').model, process.env.RESPONSE_CHECK_MODEL || 'gpt-5.6-luna');
  assert.equal(getWorkloadConfig('webhookReport').model, process.env.WEBHOOK_REPORT_MODEL || 'gpt-5.6-terra');
});

test('honors a user model override without changing workload reasoning policy', () => {
  const route = getWorkloadConfig('chat', 'gpt-5.6-sol');
  assert.equal(route.model, 'gpt-5.6-sol');
  assert.equal(route.reasoning.effort, process.env.CHAT_REASONING_EFFORT || 'low');
});

test('creates stable pseudonymous safety identifiers', () => {
  const first = createSafetyIdentifier('discord-user-123');
  assert.equal(first, createSafetyIdentifier('discord-user-123'));
  assert.notEqual(first, createSafetyIdentifier('discord-user-456'));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(createSafetyIdentifier(), undefined);
});
