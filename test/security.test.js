const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeMessage, splitDiscordMessage, escapeRegex } = require('../src/utils/security');
const { rollDice } = require('../src/utils/dice');
const { _safeEqual } = require('../src/api/middlewares');

test('sanitizes mass mentions case-insensitively', () => {
  assert.equal(sanitizeMessage('@everyone and @HERE'), '@\u200beveryone and @\u200bhere');
});
test('splits long Discord messages on readable boundaries', () => {
  const chunks = splitDiscordMessage(`${'word '.repeat(500)}`.trim(), 200);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 200));
});
test('escapes regex control characters', () => {
  const value = 'raid (final)+';
  assert.ok(new RegExp(`^${escapeRegex(value)}$`).test(value));
});
test('rolls compound dice with an injected deterministic RNG', () => {
  const result = rollDice('2d6+1d4-2', () => 0);
  assert.deepEqual(result, { total: 1, expanded: '[1, 1] +[1] -2' });
});
test('rejects abusive dice expressions', () => {
  assert.throws(() => rollDice('1000d999999999'), /Dice must/);
  assert.throws(() => rollDice('2d6; process.exit()'), /Use dice notation/);
});
test('API key comparison fails closed', () => {
  assert.equal(_safeEqual('', ''), false);
  assert.equal(_safeEqual('secret', 'secret'), true);
  assert.equal(_safeEqual('secret', 'different'), false);
});
