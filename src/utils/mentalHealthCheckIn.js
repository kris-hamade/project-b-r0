const moment = require('moment-timezone');
const schedule = require('node-schedule');
const ChatConfig = require('../models/chatConfig');
const UserMentalHealthSettings = require('../models/userMentalHealthSettings');
const { SAFE_ALLOWED_MENTIONS } = require('./security');

async function isUserMentalHealthCheckInsEnabled(userId) {
  const settings = await UserMentalHealthSettings.findOne({ userId }).lean().catch(() => null);
  return settings?.mentalHealthCheckInsEnabled ?? false;
}

async function setMentalHealthCheckInFlag(username, userId, channelId) {
  return ChatConfig.findOneAndUpdate(
    { $or: [{ userId, channelID: channelId }, { username, channelID: channelId }] },
    { $set: { username, userId, channelID: channelId, needsMentalHealthCheckIn: true, mentalHealthCheckInDate: new Date() } },
    { upsert: true, new: true },
  );
}

async function clearMentalHealthCheckInFlag(identity, channelId = null) {
  const identityQuery = { $or: [{ userId: identity }, { username: identity }] };
  const query = channelId ? { $and: [identityQuery, { channelID: channelId }] } : identityQuery;
  const result = await ChatConfig.updateMany(query, { $set: { needsMentalHealthCheckIn: false }, $unset: { mentalHealthCheckInDate: 1, lastCheckInAttempt: 1 } });
  return result.modifiedCount > 0;
}

function inQuietHours(settings, at = new Date()) {
  const now = moment(at).tz(settings.timezone || 'America/New_York');
  const [startHour, startMinute] = (settings.quietStart || '22:00').split(':').map(Number);
  const [endHour, endMinute] = (settings.quietEnd || '08:00').split(':').map(Number);
  const minute = now.hour() * 60 + now.minute();
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

async function sendMentalHealthCheckInDM(userId, client, { force = false } = {}) {
  const settings = await UserMentalHealthSettings.findOne({ userId });
  if (!settings?.mentalHealthCheckInsEnabled) return { sent: false, reason: 'disabled' };
  const now = new Date();
  if (!force && settings.snoozedUntil && settings.snoozedUntil > now) return { sent: false, reason: 'snoozed' };
  if (!force && inQuietHours(settings, now)) return { sent: false, reason: 'quiet-hours' };
  const cadenceMs = (settings.cadenceHours || 24) * 3600000;
  if (!force && settings.lastCheckInAt && now - settings.lastCheckInAt < cadenceMs) return { sent: false, reason: 'cadence' };

  const user = await client.users.fetch(userId);
  const content = settings.tone === 'brief'
    ? 'Just checking in—how are you doing? Reply “stop” anytime to turn these messages off.'
    : 'Hey—just checking in because you opted into supportive DMs. How are you doing? There’s no pressure to reply, and you can reply “stop” or use `/mentalhealthcheckin disable` anytime.';
  try {
    await user.send({ content, allowedMentions: SAFE_ALLOWED_MENTIONS });
  } catch (error) {
    if (error.code === 50007) return { sent: false, reason: 'dms-disabled' };
    throw error;
  }
  settings.lastCheckInAt = now;
  await settings.save();
  await ChatConfig.updateMany({ userId, needsMentalHealthCheckIn: true }, { $set: { lastCheckInAttempt: now } });
  return { sent: true };
}

async function checkIfUserIsOkay(messageContent) {
  const content = String(messageContent).toLowerCase();
  const wantsToStop = /\b(stop|unsubscribe|opt out|leave me alone)\b|don'?t (message|dm|contact|check in)/i.test(content);
  const isOkay = wantsToStop || /\b(i'?m|i am|doing|feeling) (okay|ok|fine|good|better|great)\b|thanks.*(?:okay|fine|better)/i.test(content);
  return { isOkay, confidence: wantsToStop || isOkay ? 0.95 : 0.4, wantsToStop };
}

function initializeMentalHealthCheckInScheduler(client) {
  schedule.scheduleJob('*/15 * * * *', async () => {
    const configs = await ChatConfig.find({ needsMentalHealthCheckIn: true, userId: { $exists: true, $ne: null } });
    for (const userId of new Set(configs.map(config => config.userId))) {
      try { await sendMentalHealthCheckInDM(userId, client); }
      catch (error) { console.error(`[MentalHealth] Check-in failed for user ${userId}:`, error.message); }
    }
  });
  console.log('[MentalHealth] Consent-based scheduler initialized (15-minute evaluation cycle).');
}

module.exports = { checkIfUserIsOkay, clearMentalHealthCheckInFlag, inQuietHours, initializeMentalHealthCheckInScheduler, isUserMentalHealthCheckInsEnabled, sendMentalHealthCheckInDM, setMentalHealthCheckInFlag };
