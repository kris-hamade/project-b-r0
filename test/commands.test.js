const test = require('node:test');
const assert = require('node:assert/strict');
const { commands } = require('../src/discord/bot');

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
    schedule: ['create', 'quick', 'edit', 'pause', 'resume', 'delete', 'list', 'help'],
    responsemode: ['enable', 'disable', 'status', 'configure'],
    sirmode: ['start', 'stop', 'status', 'adduser', 'removeuser'],
    mentalhealthcheckin: ['enable', 'disable', 'status', 'snooze', 'resume', 'test'],
  };
  for (const [name, subcommands] of Object.entries(expected)) {
    const command = commands.find(candidate => candidate.name === name);
    assert.deepEqual(command.options.map(option => option.name), subcommands);
  }
});
