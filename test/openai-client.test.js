const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('OpenAI modules can be imported in credential-free CI tests', () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ADMIN_KEY;
  const repositoryRoot = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', "require('./src/openai/openAi'); console.log('imported')"], {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /imported/);
});
