const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

test('public status endpoint is healthy without exposing secrets', async () => {
  const response = await createApp().request('/api/status');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(JSON.stringify(body).includes('API_KEY'), false);
});
test('campaign data endpoint requires authentication', async () => {
  const response = await createApp().request('/api/currentJournal?guildId=123');
  assert.equal(response.status, 401);
});
test('API documentation is HTML and OpenAPI JSON is available', async () => {
  const app = createApp();
  const docs = await app.request('/api-docs');
  assert.match(await docs.text(), /B-r0 Campaign Copilot API/);
  const spec = await (await app.request('/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
});
