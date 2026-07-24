const test = require('node:test');
const assert = require('node:assert/strict');
const moment = require('moment-timezone');
const { parseReminderOffsets, parseUserDate } = require('../src/utils/eventScheduler');
const { inQuietHours } = require('../src/utils/mentalHealthCheckIn');
const { getUserAllowedModels } = require('../src/utils/config');

test('current model catalog includes all GPT-5.6 user tiers', () => {
  const models = getUserAllowedModels();
  assert.deepEqual(models.slice(0, 3), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
});

test('parses friendly advance reminder offsets', () => {
  assert.deepEqual(parseReminderOffsets('15m,1d,2h,1d'), [1440, 120, 15]);
  assert.throws(() => parseReminderOffsets('sometime'), /Invalid reminder/);
});

test('parses tomorrow in the requested timezone', () => {
  const date = parseUserDate('tomorrow 7:30 PM', 'America/New_York');
  const parsed = moment(date).tz('America/New_York');
  assert.equal(parsed.hour(), 19);
  assert.equal(parsed.minute(), 30);
});

test('quiet hours work across midnight', () => {
  const settings = { timezone: 'America/New_York', quietStart: '22:00', quietEnd: '08:00' };
  assert.equal(inQuietHours(settings, moment.tz('2026-07-17 23:00', 'America/New_York').toDate()), true);
  assert.equal(inQuietHours(settings, moment.tz('2026-07-17 12:00', 'America/New_York').toDate()), false);
});
