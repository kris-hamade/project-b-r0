const moment = require('moment-timezone');
const schedule = require('node-schedule');
const ChannelCheckIn = require('../models/channelCheckIn');
const { generateResponse } = require('../openai/gpt');
const Personas = require('../models/personas');

/**
 * Check if a channel should receive a check-in message
 * @param {string} channelId - Discord channel ID
 * @param {Discord.Client} client - Discord client
 * @returns {Promise<{shouldCheckIn: boolean, reason: string}>}
 */
async function shouldCheckIn(channelId, client) {
  try {
    const config = await ChannelCheckIn.findOne({ channelId, enabled: true });
    
    if (!config) {
      return { shouldCheckIn: false, reason: 'Check-ins not enabled for this channel' };
    }

    // Check if we already checked in today
    if (config.lastCheckIn) {
      const lastCheckIn = moment(config.lastCheckIn);
      const today = moment().startOf('day');
      if (lastCheckIn.isSameOrAfter(today)) {
        return { shouldCheckIn: false, reason: 'Already checked in today' };
      }
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return { shouldCheckIn: false, reason: 'Channel not found or not a text channel' };
    }

    // Get messages from the last few days
    const cutoffDate = moment().subtract(config.inactivityDays || 1, 'days');
    const messages = await channel.messages.fetch({ limit: 100 });
    
    // Filter to messages from the last N days (excluding bot messages)
    const recentMessages = Array.from(messages.values())
      .filter(msg => {
        const msgDate = moment(msg.createdAt);
        return msgDate.isAfter(cutoffDate) && !msg.author.bot;
      });

    // Check if channel was active in the past few days but not today
    const today = moment().startOf('day');
    const messagesToday = recentMessages.filter(msg => 
      moment(msg.createdAt).isSameOrAfter(today)
    );
    
    const messagesPastDays = recentMessages.filter(msg => 
      moment(msg.createdAt).isBefore(today) && 
      moment(msg.createdAt).isAfter(cutoffDate)
    );

    // Channel should be active (had messages in past days) but quiet today
    const minMessages = config.minMessagesPerDay || 5;
    const wasActive = messagesPastDays.length >= minMessages;
    const isQuietToday = messagesToday.length === 0;

    if (wasActive && isQuietToday) {
      return { 
        shouldCheckIn: true, 
        reason: `Channel was active (${messagesPastDays.length} messages in past ${config.inactivityDays} days) but no messages today` 
      };
    }

    return { 
      shouldCheckIn: false, 
      reason: wasActive 
        ? `Channel has messages today (${messagesToday.length})` 
        : `Channel not active enough (${messagesPastDays.length} messages, need ${minMessages})` 
    };
  } catch (error) {
    console.error(`[CheckIn] Error checking channel ${channelId}:`, error);
    return { shouldCheckIn: false, reason: `Error: ${error.message}` };
  }
}

/**
 * Generate and send a check-in message
 * @param {string} channelId - Discord channel ID
 * @param {Discord.Client} client - Discord client
 */
async function sendCheckIn(channelId, client) {
  try {
    const config = await ChannelCheckIn.findOne({ channelId, enabled: true });
    if (!config) {
      console.log(`[CheckIn] Check-in not enabled for channel ${channelId}`);
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.log(`[CheckIn] Channel ${channelId} not found or not a text channel`);
      return;
    }

    // Get default persona for check-ins (or use a specific one)
    const defaultPersona = await Personas.findOne({ name: 'assistant' }) || 
                           await Personas.findOne({});
    
    if (!defaultPersona) {
      console.error('[CheckIn] No persona found for check-in message');
      return;
    }

    // Get channel activity context
    const cutoffDate = moment().subtract(config.inactivityDays || 1, 'days');
    const messages = await channel.messages.fetch({ limit: 50 });
    const recentMessages = Array.from(messages.values())
      .filter(msg => {
        const msgDate = moment(msg.createdAt);
        return msgDate.isAfter(cutoffDate) && !msg.author.bot;
      })
      .map(msg => msg.content)
      .reverse();

    // Generate a friendly check-in message
    const checkInPrompt = `The channel has been quiet today, but was active in the past few days. Generate a friendly, casual check-in message to spark conversation. Keep it brief (1-2 sentences), warm, and engaging. Don't be pushy or demanding.`;

    const checkInMessage = await generateResponse(
      checkInPrompt,
      defaultPersona,
      'No DnD Data Found',
      'Channel',
      defaultPersona.name,
      'gpt-4o-mini', // Use cheaper model for check-ins
      0.7,
      null,
      channelId,
      null, // No classification needed
      recentMessages.slice(-5) // Recent context
    );

    await channel.send(checkInMessage);
    
    // Update last check-in time
    config.lastCheckIn = new Date();
    await config.save();
    
    console.log(`[CheckIn] Sent check-in message to channel ${channelId}`);
  } catch (error) {
    console.error(`[CheckIn] Error sending check-in to channel ${channelId}:`, error);
  }
}

/**
 * Initialize scheduled check-in jobs for all enabled channels
 * @param {Discord.Client} client - Discord client
 */
function initializeCheckInScheduler(client) {
  // Run check-in check every hour at the top of the hour
  schedule.scheduleJob('0 * * * *', async () => {
    try {
      const enabledCheckIns = await ChannelCheckIn.find({ enabled: true });
      console.log(`[CheckIn] Checking ${enabledCheckIns.length} enabled channels for check-ins`);
      
      for (const config of enabledCheckIns) {
        try {
          // Check if it's the right time for this channel
          const timezone = config.timezone || 'America/New_York';
          const now = moment.tz(timezone);
          const checkInTimeStr = config.checkInTime || '14:00';
          const [hours, minutes] = checkInTimeStr.split(':').map(Number);
          const checkInTime = moment.tz(timezone).hour(hours).minute(minutes).second(0);
          
          // Only check if current hour matches the check-in hour
          if (now.hour() === checkInTime.hour()) {
            const checkInResult = await shouldCheckIn(config.channelId, client);
            if (checkInResult.shouldCheckIn) {
              console.log(`[CheckIn] Triggering check-in for channel ${config.channelId}: ${checkInResult.reason}`);
              await sendCheckIn(config.channelId, client);
            } else {
              console.log(`[CheckIn] Skipping check-in for channel ${config.channelId}: ${checkInResult.reason}`);
            }
          }
        } catch (error) {
          console.error(`[CheckIn] Error processing check-in for channel ${config.channelId}:`, error);
        }
      }
    } catch (error) {
      console.error('[CheckIn] Error in scheduled check-in job:', error);
    }
  });
  
  console.log('[CheckIn] Scheduled check-in job initialized (runs every hour at :00)');
}

module.exports = {
  shouldCheckIn,
  sendCheckIn,
  initializeCheckInScheduler,
};

