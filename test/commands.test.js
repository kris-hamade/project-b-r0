const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { commands, looksLikeSchedulingRequest } = require('../src/discord/bot');

test('Discord command names are unique and choice lists fit Discord limits', () => {
  const names = commands.map(command => command.name);
  assert.equal(new Set(names).size, names.length);
  function inspect(options = []) {
    for (const option of options) {
      if (option.choices) assert.ok(option.choices.length <= 25);
      inspect(option.options);
    }
  }
  commands.forEach(command => inspect(command.options));
});

test('server-mutating commands advertise Manage Server permissions', () => {
  const protectedNames = ['forgetall', 'schedule', 'deleteevent', 'checkin', 'responsemode', 'webhook', 'sirmode'];
  for (const name of protectedNames) {
    const command = commands.find(candidate => candidate.name === name);
    assert.ok(command?.default_member_permissions, `${name} should be permission gated`);
  }
});

test('enhanced feature command surfaces are registered', () => {
  const expected = {
    schedule: ['create', 'quick', 'edit', 'pause', 'resume', 'delete', 'manage', 'list', 'help'],
    responsemode: ['enable', 'disable', 'status', 'configure'],
    sirmode: ['start', 'stop', 'status', 'adduser', 'removeuser'],
    mentalhealthcheckin: ['enable', 'disable', 'status', 'snooze', 'resume', 'test'],
  };
  for (const [name, subcommands] of Object.entries(expected)) {
    const command = commands.find(candidate => candidate.name === name);
    assert.deepEqual(command.options.map(option => option.name), subcommands);
  }
});

test('event mutation fields provide autocomplete', () => {
  const schedule = commands.find(command => command.name === 'schedule');
  for (const name of ['edit', 'pause', 'resume', 'delete']) {
    const subcommand = schedule.options.find(option => option.name === name);
    assert.equal(subcommand.options.find(option => option.name === 'event').autocomplete, true);
  }
  const legacyDelete = commands.find(command => command.name === 'deleteevent');
  assert.equal(legacyDelete.options[0].autocomplete, true);
});

test('Discord interaction responses use message flags instead of deprecated ephemeral options', () => {
  const sourceFiles = [
    path.resolve(__dirname, '../src/discord/bot.js'),
    path.resolve(__dirname, '../src/utils/security.js'),
  ];
  for (const sourceFile of sourceFiles) {
    assert.doesNotMatch(fs.readFileSync(sourceFile, 'utf8'), /ephemeral\s*:\s*true/);
  }
});

test('natural scheduling intent requires an explicit action request', () => {
  assert.equal(looksLikeSchedulingRequest('<@123> schedule game night Thursday at 8 PM', '123'), true);
  assert.equal(looksLikeSchedulingRequest('Could you book Session 37 for next Friday?', '123'), true);
  assert.equal(looksLikeSchedulingRequest('Remind us daily at 5 PM about the game', '123'), true);
  assert.equal(looksLikeSchedulingRequest('What is on the schedule this week?', '123'), false);
  assert.equal(looksLikeSchedulingRequest('We discussed Thursday at 8 PM', '123'), false);
});
