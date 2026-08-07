const schedule = require('node-schedule');
const moment = require('moment-timezone');
const ScheduledEvent = require('../models/scheduledEvent');
const { SAFE_ALLOWED_MENTIONS, escapeRegex } = require('./security');

const jobs = new Map();
let discordClient;

class EventInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EventInputError';
  }
}

const TIMEZONE_ALIASES = Object.freeze({
  utc: 'Etc/UTC',
  gmt: 'Etc/UTC',
  est: 'America/New_York',
  edt: 'America/New_York',
  eastern: 'America/New_York',
  et: 'America/New_York',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  central: 'America/Chicago',
  ct: 'America/Chicago',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mountain: 'America/Denver',
  mt: 'America/Denver',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  pt: 'America/Los_Angeles',
});
const IANA_TIMEZONES = new Map(moment.tz.names().map(name => [name.toLowerCase(), name]));

function cancelEventJobs(id) {
  for (const job of jobs.get(String(id)) || []) job.cancel();
  jobs.delete(String(id));
}

function parseReminderOffsets(value = '1d,1h') {
  if (Array.isArray(value)) return [...new Set(value.map(Number).filter(n => n >= 0 && n <= 525600))].sort((a, b) => b - a);
  if (/^(none|off|no reminders)$/i.test(String(value).trim())) return [];
  const units = { m: 1, h: 60, d: 1440, w: 10080 };
  const result = String(value).split(',').map(part => part.trim().toLowerCase()).filter(Boolean).map(part => {
    const match = part.match(/^(\d+)\s*([mhdw])$/);
    if (!match) throw new EventInputError(`Invalid reminder "${part}". Use values such as 1d, 2h, 30m.`);
    return Number(match[1]) * units[match[2]];
  });
  if (result.length > 8) throw new EventInputError('Use no more than 8 advance reminders.');
  return [...new Set(result)].sort((a, b) => b - a);
}

function normalizeTimezone(value, fallback = 'America/New_York') {
  const supplied = String(value || fallback).trim();
  const lookup = supplied.toLowerCase();
  const normalized = TIMEZONE_ALIASES[lookup] || IANA_TIMEZONES.get(lookup);
  if (normalized && moment.tz.zone(normalized)) return normalized;
  throw new EventInputError(`Timezone "${supplied}" is not recognized. Try Eastern, Pacific, UTC, or an IANA timezone such as America/New_York.`);
}

function parseUserDate(value, timezone = 'America/New_York') {
  timezone = normalizeTimezone(timezone);
  const text = String(value).trim();
  const now = moment.tz(timezone);
  const relative = text.match(/^(today|tomorrow)\s+(?:at\s+)?(.+)$/i);
  let parsed;
  if (relative) {
    const day = now.clone().startOf('day').add(relative[1].toLowerCase() === 'tomorrow' ? 1 : 0, 'day');
    const clock = moment(relative[2], ['h:mm A', 'h A', 'HH:mm'], true);
    if (clock.isValid()) parsed = day.hour(clock.hour()).minute(clock.minute());
  }
  if (!parsed) {
    const formats = ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD h:mm A', 'MM/DD/YYYY h:mm A', moment.ISO_8601];
    parsed = moment.tz(text, formats, true, timezone);
  }
  if (!parsed?.isValid()) throw new EventInputError('Invalid date. Try `tomorrow 7:30 PM` or `2026-08-14 19:30`.');
  if (!parsed.isAfter(now)) throw new EventInputError('The event must start in the future.');
  return parsed.toDate();
}

function nextOccurrence(date, recurrence) {
  const next = moment(date);
  if (recurrence === 'daily') next.add(1, 'day');
  else if (recurrence === 'weekly') next.add(1, 'week');
  else if (recurrence === 'biweekly') next.add(2, 'weeks');
  else if (recurrence === 'monthly') next.add(1, 'month');
  else return null;
  return next.toDate();
}

function formatOffset(minutes) {
  if (minutes % 10080 === 0) return `${minutes / 10080}w`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatEvent(event) {
  const when = moment(event.startsAt).tz(event.timezone).format('ddd, MMM D, YYYY [at] h:mm A z');
  const reminders = (event.reminderMinutes || []).map(formatOffset).join(', ') || 'none';
  return `**${event.eventName}** · ${when}\nStatus: ${event.status} · Repeats: ${event.recurrence} · Reminders: ${reminders}`;
}

async function send(channelId, content) {
  const channel = await discordClient.channels.fetch(channelId);
  if (channel?.isTextBased()) await channel.send({ content, allowedMentions: SAFE_ALLOWED_MENTIONS });
}

async function scheduleDocument(event) {
  cancelEventJobs(event._id);
  if (event.status !== 'active' || !event.startsAt) return;
  const eventJobs = [];
  const startsAt = new Date(event.startsAt);

  for (const minutes of event.reminderMinutes || []) {
    const runAt = new Date(startsAt.getTime() - minutes * 60000);
    if (runAt > new Date()) {
      const job = schedule.scheduleJob(runAt, () => send(event.channelId, `⏰ **${event.eventName}** starts in ${formatOffset(minutes)}.`));
      if (job) eventJobs.push(job);
    }
  }

  if (startsAt > new Date()) {
    const startJob = schedule.scheduleJob(startsAt, async () => {
      await send(event.channelId, `🎲 **${event.eventName}** is starting now.`);
      const following = nextOccurrence(event.startsAt, event.recurrence);
      if (following) {
        event.lastOccurrenceAt = event.startsAt;
        event.startsAt = following;
        event.time = moment(following).tz(event.timezone).format('YYYY-MM-DDTHH:mm:ss');
        await event.save();
        await scheduleDocument(event);
      } else {
        event.status = 'completed';
        event.lastOccurrenceAt = event.startsAt;
        await event.save();
        cancelEventJobs(event._id);
      }
    });
    if (startJob) eventJobs.push(startJob);
  }
  jobs.set(String(event._id), eventJobs);
}

async function loadJobsFromDatabase(client) {
  discordClient = client;
  const events = await ScheduledEvent.find({ guildId: { $exists: true, $ne: null } });
  for (const event of events) {
    if (!event.startsAt && event.time) event.startsAt = moment.tz(event.time, event.timezone || 'America/New_York').toDate();
    if (!event.recurrence) event.recurrence = 'once';
    if (!event.status) event.status = 'active';
    while (event.status === 'active' && event.startsAt <= new Date() && event.recurrence !== 'once') {
      event.startsAt = nextOccurrence(event.startsAt, event.recurrence);
    }
    if (event.status === 'active' && event.startsAt <= new Date()) event.status = 'completed';
    await event.save();
    await scheduleDocument(event);
  }
  console.log(`Loaded ${events.length} scheduled events.`);
}

async function createEvent(data, client) {
  discordClient = client || discordClient;
  if (!data.eventName?.trim()) throw new EventInputError('Event name is required.');
  const timezone = normalizeTimezone(data.timezone);
  const duplicate = await findEvent(data.eventName, data.guildId);
  if (duplicate) throw new EventInputError('An event with that name already exists. Edit it or choose a different name.');
  const event = await ScheduledEvent.create({
    eventName: String(data.eventName).trim().slice(0, 100),
    channelId: data.channelId,
    guildId: data.guildId,
    creatorId: data.creatorId,
    timezone,
    startsAt: data.startsAt,
    time: moment(data.startsAt).tz(timezone).format('YYYY-MM-DDTHH:mm:ss'),
    recurrence: data.recurrence || 'once',
    frequency: data.recurrence || 'once',
    reminderMinutes: parseReminderOffsets(data.reminders),
    status: 'active',
  });
  await scheduleDocument(event);
  return event;
}

async function updateEvent(eventName, guildId, changes) {
  const event = await findEvent(eventName, guildId);
  if (!event) return null;
  return applyEventChanges(event, changes);
}

async function updateEventById(id, guildId, changes) {
  const event = await ScheduledEvent.findOne({ _id: id, guildId });
  if (!event) return null;
  return applyEventChanges(event, changes);
}

async function applyEventChanges(event, changes) {
  if (changes.eventName && changes.eventName.trim().toLowerCase() !== event.eventName.toLowerCase()) {
    const duplicate = await findEvent(changes.eventName, event.guildId);
    if (duplicate && String(duplicate._id) !== String(event._id)) {
      throw new EventInputError('An event with that name already exists.');
    }
  }
  if (changes.eventName) event.eventName = changes.eventName.trim().slice(0, 100);
  if (changes.timezone) {
    event.timezone = normalizeTimezone(changes.timezone);
  }
  if (changes.when) event.startsAt = parseUserDate(changes.when, event.timezone);
  if (changes.recurrence) event.recurrence = changes.recurrence;
  if (changes.reminders) event.reminderMinutes = parseReminderOffsets(changes.reminders);
  event.time = moment(event.startsAt).tz(event.timezone).format('YYYY-MM-DDTHH:mm:ss');
  await event.save();
  await scheduleDocument(event);
  return event;
}

async function findEvent(eventName, guildId) {
  return ScheduledEvent.findOne({ guildId, eventName: { $regex: new RegExp(`^${escapeRegex(eventName)}$`, 'i') } });
}

async function setEventEnabled(eventName, guildId, enabled) {
  const event = await findEvent(eventName, guildId);
  if (!event) return null;
  return applyEventEnabled(event, enabled);
}

async function setEventEnabledById(id, guildId, enabled) {
  const event = await ScheduledEvent.findOne({ _id: id, guildId });
  if (!event) return null;
  return applyEventEnabled(event, enabled);
}

async function applyEventEnabled(event, enabled) {
  event.status = enabled ? 'active' : 'paused';
  if (enabled && event.startsAt <= new Date()) throw new EventInputError('Edit this event to a future date before resuming it.');
  await event.save();
  await scheduleDocument(event);
  return event;
}

async function deleteEvent(eventName, guildId) {
  const event = await findEvent(eventName, guildId);
  if (!event) return false;
  return removeEvent(event);
}

async function deleteEventById(id, guildId) {
  const event = await ScheduledEvent.findOne({ _id: id, guildId });
  if (!event) return false;
  return removeEvent(event);
}

async function removeEvent(event) {
  cancelEventJobs(event._id);
  await event.deleteOne();
  return true;
}

// Backward-compatible adapter for the natural-language quick scheduler.
async function scheduleEvent(eventData, channelId, client, _save = true, metadata = {}) {
  const timezone = normalizeTimezone(eventData.Timezone || eventData.timezone);
  const date = eventData.Date || eventData.date;
  const time = eventData.Time || eventData.time;
  const startsAt = parseUserDate(`${date} ${time}`, timezone);
  const recurrence = eventData.Recurrence || eventData.recurrence || 'once';
  const reminders = eventData.reminderMinutes || eventData.Reminders || '1d,1h';
  const event = await createEvent({ eventName: eventData['Event Name'] || eventData.eventName, startsAt, recurrence, reminders, timezone, channelId, guildId: metadata.guildId, creatorId: metadata.creatorId }, client);
  return formatEvent(event);
}

module.exports = {
  createEvent,
  deleteEvent,
  deleteEventById,
  EventInputError,
  findEvent,
  formatEvent,
  loadJobsFromDatabase,
  normalizeTimezone,
  parseReminderOffsets,
  parseUserDate,
  scheduleEvent,
  setEventEnabled,
  setEventEnabledById,
  updateEvent,
  updateEventById,
};
