const moment = require('moment-timezone');
const schedule = require('node-schedule');
const ChatConfig = require('../models/chatConfig');
const { generateResponse } = require('../openai/gpt');
const Personas = require('../models/personas');

/**
 * Set the mental health check-in flag for a user in their actual channel config
 * @param {string} username - Discord username
 * @param {string} userId - Discord user ID
 * @param {string} channelId - The actual Discord channel ID where the message was sent
 */
async function setMentalHealthCheckInFlag(username, userId, channelId) {
  try {
    // Find or create config for this user in the actual channel
    let config = await ChatConfig.findOne({ username, channelID: channelId });
    
    if (!config) {
      // Create new config with mental health flag
      config = new ChatConfig({
        username,
        channelID: channelId,
        userId: userId,
        needsMentalHealthCheckIn: true,
        mentalHealthCheckInDate: new Date(),
      });
    } else {
      // Update userId if not set
      if (!config.userId) {
        config.userId = userId;
      }
      // Only update if not already set (don't overwrite existing flag)
      if (!config.needsMentalHealthCheckIn) {
        config.needsMentalHealthCheckIn = true;
        config.mentalHealthCheckInDate = new Date();
      }
    }
    
    await config.save();
    console.log(`[MentalHealth] Set check-in flag for user ${username} (${userId}) in channel ${channelId}`);
    
    return config;
  } catch (error) {
    console.error(`[MentalHealth] Error setting check-in flag for ${username}:`, error);
    throw error;
  }
}

/**
 * Clear the mental health check-in flag for a user
 * @param {string} username - Discord username
 * @param {string} channelId - Optional channel ID, if not provided clears from all channels
 */
async function clearMentalHealthCheckInFlag(username, channelId = null) {
  try {
    let configs;
    
    if (channelId) {
      // Clear from specific channel
      const config = await ChatConfig.findOne({ username, channelID: channelId });
      configs = config ? [config] : [];
    } else {
      // Clear from all channels for this user
      configs = await ChatConfig.find({ username, needsMentalHealthCheckIn: true });
    }
    
    let cleared = false;
    for (const config of configs) {
      if (config.needsMentalHealthCheckIn) {
        config.needsMentalHealthCheckIn = false;
        config.mentalHealthCheckInDate = null;
        config.lastCheckInAttempt = null;
        await config.save();
        cleared = true;
        console.log(`[MentalHealth] Cleared check-in flag for user ${username} in channel ${config.channelID}`);
      }
    }
    
    return cleared;
  } catch (error) {
    console.error(`[MentalHealth] Error clearing check-in flag for ${username}:`, error);
    return false;
  }
}

/**
 * Send a mental health check-in DM to a user
 * @param {string} userId - Discord user ID
 * @param {Discord.Client} client - Discord client
 */
async function sendMentalHealthCheckInDM(userId, client) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) {
      console.log(`[MentalHealth] User ${userId} not found`);
      return false;
    }

    // Get default persona for check-ins
    const defaultPersona = await Personas.findOne({ name: 'assistant' }) || 
                           await Personas.findOne({});
    
    if (!defaultPersona) {
      console.error('[MentalHealth] No persona found for check-in message');
      return false;
    }

    // Generate a caring, empathetic check-in message
    const checkInPrompt = `Generate a warm, caring, and empathetic check-in message for someone who may be struggling. The message should:
- Be brief (2-3 sentences)
- Express genuine concern and care
- Ask how they're doing
- Be supportive without being pushy
- Encourage them to reach out if they need to talk
- Avoid being clinical or overly formal

Keep it personal and human-like.`;

    const checkInMessage = await generateResponse(
      checkInPrompt,
      defaultPersona,
      'No DnD Data Found',
      user.username,
      defaultPersona.name,
      'gpt-4o-mini', // Use cheaper model for check-ins
      0.7,
      null,
      `dm_${userId}`, // Use a DM-specific channel ID
      null, // No classification needed
      [] // No recent messages
    );

    // Try to send DM
    try {
      await user.send({ content: checkInMessage, flags: require('discord.js').MessageFlags.SuppressEmbeds });
      console.log(`[MentalHealth] Sent check-in DM to user ${user.username} (${userId})`);
      
      // Update last check-in attempt in all channels for this user
      const configs = await ChatConfig.find({ username: user.username, needsMentalHealthCheckIn: true });
      for (const config of configs) {
        config.lastCheckInAttempt = new Date();
        await config.save();
      }
      
      return true;
    } catch (dmError) {
      // User may have DMs disabled
      if (dmError.code === 50007) {
        console.log(`[MentalHealth] Cannot send DM to user ${user.username} (${userId}): DMs disabled`);
      } else {
        console.error(`[MentalHealth] Error sending DM to user ${user.username} (${userId}):`, dmError);
      }
      return false;
    }
  } catch (error) {
    console.error(`[MentalHealth] Error in sendMentalHealthCheckInDM for ${userId}:`, error);
    return false;
  }
}

/**
 * Check if a user's response indicates they're okay or wants to stop messaging
 * @param {string} messageContent - The user's message
 * @returns {Promise<{isOkay: boolean, confidence: number, wantsToStop: boolean}>}
 */
async function checkIfUserIsOkay(messageContent) {
  // Check for requests to stop messaging first
  const stopIndicators = [
    /stop (messaging|texting|dm|dming|contacting|checking in on)/i,
    /don'?t (message|text|dm|contact|check in on)/i,
    /no (more|longer) (messages|texts|dms|check ins)/i,
    /please stop/i,
    /leave me alone/i,
    /i don'?t want (you|this|these) (to|messages|texts|dms)/i,
  ];
  
  const content = messageContent.toLowerCase();
  const wantsToStop = stopIndicators.some(pattern => pattern.test(content));
  
  if (wantsToStop) {
    return { isOkay: true, confidence: 0.9, wantsToStop: true };
  }
  
  // Simple heuristic check - if they respond positively, they're likely okay
  const positiveIndicators = [
    /i['']?m (ok|fine|good|alright|better)/i,
    /i feel (ok|fine|good|better|alright)/i,
    /doing (ok|fine|good|better|alright)/i,
    /thanks|thank you/i,
    /i appreciate/i,
    /yes|yeah|yep/i,
  ];
  
  const negativeIndicators = [
    /i['']?m (not ok|not fine|not good|bad|worse)/i,
    /i feel (not ok|not fine|not good|bad|worse)/i,
    /still (struggling|hurting|sad|depressed)/i,
    /no|nope|nah/i,
  ];
  
  // Check for positive indicators
  const hasPositive = positiveIndicators.some(pattern => pattern.test(content));
  const hasNegative = negativeIndicators.some(pattern => pattern.test(content));
  
  if (hasPositive && !hasNegative) {
    return { isOkay: true, confidence: 0.8, wantsToStop: false };
  } else if (hasNegative) {
    return { isOkay: false, confidence: 0.7, wantsToStop: false };
  }
  
  // If they responded at all, that's somewhat positive
  return { isOkay: true, confidence: 0.6, wantsToStop: false };
}

/**
 * Initialize scheduled mental health check-in job
 * @param {Discord.Client} client - Discord client
 */
function initializeMentalHealthCheckInScheduler(client) {
  // Run check-in every 6 hours
  schedule.scheduleJob('0 */6 * * *', async () => {
    try {
      // Find all users who need check-ins across all channels
      const usersNeedingCheckIn = await ChatConfig.find({
        needsMentalHealthCheckIn: true,
      });
      
      // Group by username to avoid duplicate DMs
      const usersByUsername = new Map();
      for (const config of usersNeedingCheckIn) {
        if (!usersByUsername.has(config.username)) {
          usersByUsername.set(config.username, config);
        }
      }
      
      console.log(`[MentalHealth] Checking ${usersByUsername.size} unique users who need check-ins`);
      
      for (const [username, config] of usersByUsername) {
        try {
          // Check if we've attempted a check-in recently (within last 12 hours)
          if (config.lastCheckInAttempt) {
            const hoursSinceLastAttempt = moment().diff(moment(config.lastCheckInAttempt), 'hours');
            if (hoursSinceLastAttempt < 12) {
              console.log(`[MentalHealth] Skipping ${username}: Checked in ${hoursSinceLastAttempt} hours ago`);
              continue;
            }
          }
          
          // Check if we have a userId stored
          if (!config.userId) {
            console.log(`[MentalHealth] Skipping ${username}: No userId stored`);
            continue;
          }
          
          // Send check-in DM
          console.log(`[MentalHealth] Attempting check-in for ${username} (${config.userId})`);
          await sendMentalHealthCheckInDM(config.userId, client);
        } catch (error) {
          console.error(`[MentalHealth] Error processing check-in for ${username}:`, error);
        }
      }
    } catch (error) {
      console.error('[MentalHealth] Error in scheduled check-in job:', error);
    }
  });
  
  console.log('[MentalHealth] Scheduled mental health check-in job initialized (runs every 6 hours)');
}

module.exports = {
  setMentalHealthCheckInFlag,
  clearMentalHealthCheckInFlag,
  sendMentalHealthCheckInDM,
  checkIfUserIsOkay,
  initializeMentalHealthCheckInScheduler,
};

