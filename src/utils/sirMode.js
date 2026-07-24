const Discord = require('discord.js');
const SirModeConfig = require('../models/sirModeConfig');
const { sanitizeMessage } = require('./security');

const timers = new Map();
let discordClient;

function clearTimers(guildId) {
  const current = timers.get(guildId);
  if (current?.timeout) clearTimeout(current.timeout);
  if (current?.interval) clearInterval(current.interval);
  timers.delete(guildId);
}

async function stopSirMode(guildId, reason = null) {
  clearTimers(guildId);
  const config = await SirModeConfig.findOneAndUpdate({ guildId }, { active: false }, { new: true });
  if (reason && config) {
    const channel = await discordClient.channels.fetch(config.textChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ content: reason, allowedMentions: { parse: [] } });
  }
  return config;
}

async function runCheck(guildId) {
  const config = await SirModeConfig.findOne({ guildId, active: true });
  if (!config) return clearTimers(guildId);
  const voice = await discordClient.channels.fetch(config.voiceChannelId).catch(() => null);
  const text = await discordClient.channels.fetch(config.textChannelId).catch(() => null);
  if (!voice || voice.type !== Discord.ChannelType.GuildVoice || !text?.isTextBased()) {
    return stopSirMode(guildId);
  }
  const missing = config.requiredUserIds.filter(id => !voice.members.has(id));
  if (!missing.length) return stopSirMode(guildId, '✅ Everyone has joined the voice channel. Sir Mode is complete.');
  if (config.remindersSent >= config.maxReminders) return stopSirMode(guildId, 'Sir Mode reached its reminder limit and stopped.');

  const mentions = missing.map(id => `<@${id}>`).join(' ');
  await text.send({
    content: `${mentions} ${sanitizeMessage(config.message)}`,
    allowedMentions: { parse: [], users: missing },
  });
  config.remindersSent += 1;
  await config.save();
}

async function armSirMode(config, client = discordClient) {
  discordClient = client;
  clearTimers(config.guildId);
  if (!config.active) return;
  const delay = Math.max(0, new Date(config.startsAt).getTime() - Date.now());
  const timeout = setTimeout(async () => {
    await runCheck(config.guildId);
    const fresh = await SirModeConfig.findOne({ guildId: config.guildId, active: true });
    if (!fresh) return;
    const interval = setInterval(() => runCheck(config.guildId), fresh.intervalMinutes * 60000);
    timers.set(config.guildId, { interval });
  }, delay);
  timers.set(config.guildId, { timeout });
}

async function loadSirModes(client) {
  discordClient = client;
  const active = await SirModeConfig.find({ active: true });
  for (const config of active) await armSirMode(config, client);
  console.log(`Loaded ${active.length} active Sir Mode configuration(s).`);
}

module.exports = { armSirMode, loadSirModes, stopSirMode };
