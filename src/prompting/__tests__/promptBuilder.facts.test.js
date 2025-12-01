const assert = require('assert');
const { buildUserFactsContext } = require('../promptBuilder');

function run() {
  const empty = buildUserFactsContext([]);
  assert.strictEqual(empty, "", 'Empty facts should yield empty context');

  const ctx = buildUserFactsContext([
    { fact: 'likes steak' },
    { fact: 'timezone PST' },
  ]);
  assert.ok(ctx.includes('Known about this user:'), 'Should include prefix');
  assert.ok(ctx.includes('likes steak'), 'Should include first fact');
  assert.ok(ctx.includes('timezone PST'), 'Should include second fact');

  console.log('promptBuilder.facts.test passed');
}

if (require.main === module) {
  run();
}

module.exports = { run };



