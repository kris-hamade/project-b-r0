const Discord = require("discord.js");
const client = require("./client");
const {
  generateEventData,
  generateImageResponse,
  generateResponse,
  shouldRespondCheck,
} = require("../openai/gpt");
const { generateImage } = require("../imaging/imageGeneration");
const { preprocessUserInput } = require("../utils/preprocessor");
const {
  buildHistory,
  clearAllHistory,
  clearUsersHistory,
} = require("./historyLog");
const {
  getUserAllowedModels,
  getConfigInformation,
  getUptime,
} = require("../utils/config");
const { getChatConfig, setChatConfig } = require("./chatConfig");
const {
  deleteEvent,
  loadJobsFromDatabase,
} = require("../utils/eventScheduler");
const ScheduledEvent = require("../models/scheduledEvent");
const moment = require("moment-timezone");
const cronstrue = require("cronstrue");
const Personas = require("../models/personas");
const { getImageDescription } = require("../imaging/vision");
const WebhookSubs = require("../models/webhookSub");
const { loadWebhookSubs } = require("../utils/webhook");
const { DiceRoll } = require("@dice-roller/rpg-dice-roller");
const { initEntropyEngine, createDiceRng } = require("../utils/entropyEngine");
const { classifyMessage } = require("../services/classifierClient");
const { buildSystemPrompt, buildUserPrompt } = require("../prompting/promptBuilder");
const { getClassifierConfidenceThreshold } = require("../utils/config");
const ChannelCheckIn = require("../models/channelCheckIn");
const { initializeCheckInScheduler } = require("../utils/channelCheckIn");
const ChannelResponseMode = require("../models/channelResponseMode");
const { 
  setMentalHealthCheckInFlag, 
  clearMentalHealthCheckInFlag, 
  checkIfUserIsOkay,
  initializeMentalHealthCheckInScheduler 
} = require("../utils/mentalHealthCheckIn");

// Include the required packages for slash commands
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");

const requiredUserTags = ["valon0022", "therazorpony", "teknowmusic", "fatedknight", "wars5187"]; // Discord usernames (not full tag)
let requiredUsers = []; // Will be populated with user IDs on ready

const activeSirModeIntervals = new Map(); // key = channelId, value = intervalId

client.once("ready", async () => {
  const allGuilds = await client.guilds.fetch();

  for (const [guildId] of allGuilds) {
    const guild = await client.guilds.fetch(guildId);
    const members = await guild.members.fetch();

    requiredUsers = members
      .filter((member) => requiredUserTags.includes(member.user.username))
      .map((member) => member.user.id);

    console.log("Resolved required users:", requiredUsers);
  }
});

async function handleMessage(message) {
  let nickname = message.guild
    ? message.member
      ? message.member.nickname || message.author.username
      : message.author.username
    : message.author.username;
  let username = message.author.username;
  let channelId = message.channel.id;

  // Ignore messages from other bots
  if (message.author.bot) return;

  // ============================ Mental Health DM Check-In Response =============================
  // Handle DM responses for mental health check-ins
  if (message.channel instanceof Discord.DMChannel) {
    try {
      const username = message.author.username;
      const ChatConfig = require("../models/chatConfig");
      // Check for mental health flag in any channel config for this user
      const config = await ChatConfig.findOne({ 
        username, 
        needsMentalHealthCheckIn: true 
      });
      
      if (config) {
        // User has a check-in flag set, check if they're responding to our check-in
        const { checkIfUserIsOkay } = require("../utils/mentalHealthCheckIn");
        const { isOkay, confidence, wantsToStop } = await checkIfUserIsOkay(message.content);
        
        if (wantsToStop) {
          // User wants to stop receiving check-in messages
          await clearMentalHealthCheckInFlag(username);
          
          // Send acknowledgment that respects their request
          const Personas = require("../models/personas");
          const { generateResponse } = require("../openai/gpt");
          const persona = await Personas.findOne({ name: 'assistant' }) || await Personas.findOne({});
          
          const stopMessage = await generateResponse(
            "The user has asked you to stop messaging them. Generate a brief, respectful acknowledgment (1-2 sentences) that you understand and will stop, but that you're here if they need to talk in the future. Be respectful and not pushy.",
            persona,
            'No DnD Data Found',
            username,
            persona.name,
            'gpt-4o-mini',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send(stopMessage);
          console.log(`[MentalHealth] Cleared check-in flag for ${username} after request to stop messaging`);
          return; // Don't process as a normal message
        } else if (isOkay && confidence >= 0.6) {
          // User seems okay, clear the flag
          await clearMentalHealthCheckInFlag(username);
          
          // Send a brief acknowledgment
          const Personas = require("../models/personas");
          const { generateResponse } = require("../openai/gpt");
          const persona = await Personas.findOne({ name: 'assistant' }) || await Personas.findOne({});
          
          const acknowledgment = await generateResponse(
            "The user has indicated they're okay. Generate a brief, warm acknowledgment (1-2 sentences) that you're glad to hear they're doing better, and that you're here if they need to talk.",
            persona,
            'No DnD Data Found',
            username,
            persona.name,
            'gpt-4o-mini',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send(acknowledgment);
          console.log(`[MentalHealth] Cleared check-in flag for ${username} after positive response`);
          return; // Don't process as a normal message
        } else if (!isOkay) {
          // User still seems to be struggling, keep the flag but acknowledge
          const Personas = require("../models/personas");
          const { generateResponse } = require("../openai/gpt");
          const persona = await Personas.findOne({ name: 'assistant' }) || await Personas.findOne({});
          
          const supportMessage = await generateResponse(
            "The user is still struggling. Generate a supportive, empathetic message (2-3 sentences) that acknowledges their feelings, offers support, and encourages them to reach out to real-world resources if needed. Be warm and caring.",
            persona,
            'No DnD Data Found',
            username,
            persona.name,
            'gpt-4o-mini',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send(supportMessage);
          console.log(`[MentalHealth] User ${username} still needs support, keeping flag active`);
          return; // Don't process as a normal message
        }
        // If confidence is low, treat as normal message but keep flag
      }
    } catch (error) {
      console.error('[MentalHealth] Error handling DM check-in response:', error);
      // Continue with normal message processing if check-in handling fails
    }
  }
  // ============================ End Mental Health DM Check-In Response =============================

  // Check for "don't have a cow"
  const regexCow = /\b(?:don'?t|do\s+not)\s+have\s+a\s+cow[\s'!,?]*\b/i;
  if (regexCow.test(message.content)) {
    await message.reply(
      "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWVva2V6cGpxMzM4cDN6MDNwNG40M3J3bGlpajV0ZWlibWZ6Mmw0ayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/h55EUEsTG9224/giphy.gif"
    );
    return;
  }

  // Check for incomplete Thunderfury name
  const containsThunderfury = /thunderfury/i.test(message.content);
  const fullThunderfuryName = /thunderfury[\s,]*blessed[\s,]*blade[\s,]*of[\s,]*the[\s,]*windseeker/i.test(message.content);

  if (containsThunderfury && !fullThunderfuryName) {
    await message.reply({
      content: `<@${message.author.id}> You mean,\n# Thunderfury, Blessed Blade of the Windseeker`,
      allowedMentions: { users: [message.author.id] },
    });
    return;
  }

  // Skip if message mentions other users (not the bot) - don't respond to @ mentions of other people
  if (!(message.channel instanceof Discord.DMChannel)) {
    const mentionedUsers = message.mentions.users;
    const botMentioned = message.mentions.has(client.user.id);
    const otherUsersMentioned = mentionedUsers.filter(user => user.id !== client.user.id && !user.bot);
    
    // If other users (not the bot) are mentioned, skip responding
    if (otherUsersMentioned.size > 0) {
      console.log(`[Bot] Skipping response: Message mentions other users (not the bot)`);
      return;
    }
    
    // Also skip if @everyone or @here is mentioned
    if (message.mentions.everyone || message.mentions.roles.size > 0) {
      console.log(`[Bot] Skipping response: Message mentions @everyone, @here, or roles`);
      return;
    }
  }

  // Check channel response mode setting (respond without mention)
  // This is checked BEFORE classifier to respect the channel setting
  if (!(message.channel instanceof Discord.DMChannel)) {
    try {
      const responseMode = await ChannelResponseMode.findOne({ channelId: message.channel.id });
      const respondWithoutMention = responseMode?.respondWithoutMention ?? false; // Default to false (off)
      
      // If respondWithoutMention is false (default), require @mention
      if (!respondWithoutMention && !message.mentions.has(client.user.id)) {
        console.log(`[ResponseMode] Skipping response: Bot not mentioned and respondWithoutMention is disabled for this channel`);
        return;
      }
      
      console.log(`[ResponseMode] Channel setting: respondWithoutMention=${respondWithoutMention}, botMentioned=${message.mentions.has(client.user.id)}`);
    } catch (error) {
      console.error('[ResponseMode] Error checking channel response mode:', error);
      // On error, default to requiring mention (fail closed)
      if (!message.mentions.has(client.user.id)) {
        console.log('[ResponseMode] Error occurred, defaulting to require mention');
        return;
      }
    }
  }

  // ============================ Classifier Integration =============================
  // Get recent messages for classifier context (last 5-10 messages from Discord API)
  let recentMessages = [];
  try {
    const messages = await message.channel.messages.fetch({ limit: 10 });
    recentMessages = Array.from(messages.values())
      .filter(m => m.id !== message.id && !m.author.bot) // Exclude current message and bot messages
      .map(m => m.content)
      .slice(0, 10) // Take up to 10 messages
      .reverse(); // Reverse to get chronological order (oldest first)
    console.log(`[Context] Fetched ${recentMessages.length} recent messages from Discord API`);
  } catch (error) {
    console.error('[Classifier] Failed to fetch recent messages:', error);
    // Continue with empty recentMessages array
  }

  // Classify the message using the classifier API
  let classification = null;
  let shouldUseClassifier = true;
  
  try {
    const channelName = message.channel instanceof Discord.DMChannel 
      ? 'dm' 
      : (message.channel.name || 'unknown');
    
    classification = await classifyMessage({
      message: message.content,
      recentMessages: recentMessages,
      channelName: channelName,
    });

    console.log(`[Classifier] Classification result:`, {
      shouldRespond: classification.shouldRespond,
      confidence: classification.confidence,
      topic: classification.topic,
      sensitivity: classification.sensitivity,
      reason: classification.reason,
    });

    // ============================ Mental Health Check-In Detection =============================
    // If high sensitivity detected, set mental health check-in flag and send immediate DM
    // Also clear recentMessages to prevent high-sensitivity context from contaminating future responses
    if (classification.sensitivity === "high") {
      try {
        const username = message.author.username;
        const userId = message.author.id;
        const channelId = message.channel.id;
        
        // Check if we already have a flag set and sent a recent DM
        const ChatConfig = require("../models/chatConfig");
        const existingConfig = await ChatConfig.findOne({ 
          username, 
          channelID: channelId,
          needsMentalHealthCheckIn: true 
        });
        
        // Only send immediate DM if we haven't sent one recently (within last hour)
        let shouldSendImmediateDM = true;
        if (existingConfig && existingConfig.lastCheckInAttempt) {
          const hoursSinceLastAttempt = moment().diff(moment(existingConfig.lastCheckInAttempt), 'hours');
          if (hoursSinceLastAttempt < 1) {
            shouldSendImmediateDM = false;
            console.log(`[MentalHealth] Skipping immediate DM for ${username}: Sent ${hoursSinceLastAttempt} hours ago`);
          }
        }
        
        // Set the flag in the actual channel config
        await setMentalHealthCheckInFlag(username, userId, channelId);
        console.log(`[MentalHealth] High sensitivity detected for ${username}, check-in flag set`);
        
        // Clear recentMessages to prevent high-sensitivity messages from influencing future responses
        // This ensures the bot responds to the current message without mental health context bleeding into normal conversation
        const originalRecentCount = recentMessages.length;
        recentMessages = []; // Clear recent messages to prevent contamination
        console.log(`[MentalHealth] Cleared ${originalRecentCount} recent messages from context to prevent mental health topic persistence`);
        
        // Send immediate DM check-in only if we haven't sent one recently
        if (shouldSendImmediateDM) {
          try {
            const { sendMentalHealthCheckInDM } = require("../utils/mentalHealthCheckIn");
            await sendMentalHealthCheckInDM(userId, client);
            console.log(`[MentalHealth] Immediate check-in DM sent to ${username}`);
          } catch (dmError) {
            console.error('[MentalHealth] Error sending immediate DM:', dmError);
            // Don't block the response if DM fails
          }
        }
      } catch (error) {
        console.error('[MentalHealth] Error setting check-in flag:', error);
        // Don't block the response if this fails
      }
    }
    // ============================ End Mental Health Check-In Detection =============================

    // Check if we should respond based on classifier
    const confidenceThreshold = getClassifierConfidenceThreshold();
    
    if (!classification.shouldRespond || classification.confidence < confidenceThreshold) {
      console.log(`[Classifier] Skipping response: ${classification.reason} (confidence: ${classification.confidence})`);
      return; // Don't respond - classifier says we shouldn't
    }
  } catch (error) {
    console.error('[Classifier] Error calling classifier API:', error.message);
    
    // Fallback behavior: if classifier is unavailable, use legacy mention check
    // This ensures the bot doesn't break if classifier service is down
    shouldUseClassifier = false;
    
    // Legacy mention check as fallback (only needed if classifier fails)
    // Note: The check above already handles other user mentions, but we keep this for consistency
    if (
      !(message.channel instanceof Discord.DMChannel) &&
      !message.mentions.has(client.user.id)
    ) {
      console.log('[Classifier] Fallback: Bot not mentioned, skipping response');
      return;
    }
    
    console.log('[Classifier] Fallback: Proceeding without classification (classifier unavailable)');
  }
  // ============================ End Classifier Integration =============================

  // ============================ Image Processing =============================
  let imageDescription;
  let imgUrl = "";

  // If there's an attachment with a URL
  if (message.attachments.size > 0 && message.attachments.first().url) {
    console.log(`processing ${message.attachments.first().url}`);
    imgUrl = message.attachments.first().url;
    imageDescription = await getImageDescription(
      message.attachments.first().url
    );
    //imageDescription = imageFullDescription.denseCaptions.join(", ");
    //console.log(imageDescription);
  }

  // If an image URL is found in the message content
  const imgUrlPattern = /https?:\/\/[^ "]+\.(?:png|jpg|jpeg|gif)/; // Adjust this regex pattern as needed
  if (imgUrlPattern.test(message.content)) {
    imgUrl = message.content.match(imgUrlPattern)[0];
    console.log(`processing ${imgUrl}`);
    imageDescription = await getImageDescription(imgUrl);
    //imageDescription = imageFullDescription.denseCaptions.join(", ");
    //console.log(imageDescription);

    // Remove the detected image URL from the message content
    message.content = message.content.replace(imgUrlPattern, "").trim();
  }
  // ============================ End of Image Processing =============================

  // Get the user's config from the database
  // Ensure config exists for the user and channel before fetching it.
  await setChatConfig(username, {}, channelId); // Pass an empty config, because your function will set defaults if not found
  let userConfig = await getChatConfig(username, channelId);

  // Fetch the persona details based on the current personality in user's chat config
  let currentPersonality = await Personas.findOne({
    name: userConfig.currentPersonality,
  });

  // Check if currentPersonality is null
  if (!currentPersonality) {
    console.error(
      `No personality found for name: ${userConfig.currentPersonality}`
    );
    return message.reply(
      `Sorry, I couldn't find the specified personality: ${userConfig.currentPersonality}`
    );
  }

  // ============================ Pre-Response Quality Check =============================
  // Double-check with LLM if we should actually respond (quality/timing check)
  if (classification && shouldUseClassifier) {
    try {
      const channelName = message.channel instanceof Discord.DMChannel 
        ? 'dm' 
        : (message.channel.name || 'unknown');
      
      const qualityCheck = await shouldRespondCheck(
        message.content,
        classification,
        recentMessages,
        channelName,
        'gpt-4o-mini' // Use cheaper model for this check
      );

      console.log(`[QualityCheck] Result:`, {
        shouldRespond: qualityCheck.shouldRespond,
        reason: qualityCheck.reason
      });

      if (!qualityCheck.shouldRespond) {
        console.log(`[QualityCheck] Skipping response: ${qualityCheck.reason}`);
        return; // Don't respond - quality check says it's not appropriate
      }
    } catch (error) {
      console.error('[QualityCheck] Error during quality check:', error);
      // On error, proceed anyway (fail open) since classifier already approved
      console.log('[QualityCheck] Check failed, proceeding based on classifier approval');
    }
  }
  // ============================ End Pre-Response Quality Check =============================

  // Show as typing in the discord channel - ONLY NOW that we've confirmed we're responding
  message.channel.sendTyping();

  console.log("THIS CURRENT PERSONALITY", currentPersonality);
  // Preprocess Message and Return Data from our DnD Journal / Sessions
  // Also sends user nickname to retrieve data about their character
  let dndData;
  if (
    message.content !== "" &&
    currentPersonality.type == "dnd" &&
    !imageDescription
  ) {
    dndData = await preprocessUserInput(message.content, nickname, channelId);
  } else {
    dndData = "No DnD Data Found";
  }

  // Interaction with ChatGPT API starts here.
  try {
    // Generate response from ChatGPT API
    let responseText;
    if (imageDescription) {
      responseText = await generateImageResponse(
        message.content,
        currentPersonality,
        userConfig.model,
        userConfig.temperature,
        imageDescription
      );
    } else {
      responseText = await generateResponse(
        message.content,
        currentPersonality,
        dndData,
        nickname,
        currentPersonality.name,
        userConfig.model,
        userConfig.temperature,
        imageDescription,
        channelId,
        classification, // Pass classification to enhance prompts
        recentMessages // Pass recent messages for conversation context
      );
    }

    // Trim persona name from response text if it exists.
    responseText = responseText.replace(
      new RegExp(
        `${currentPersonality.name}: |\\(${currentPersonality.name}\\) `,
        "gi"
      ),
      ""
    );

    // Check if this is a high-sensitivity mental health response
    // If so, don't save to history to prevent it from influencing future conversations
    const isMentalHealthResponse = classification && classification.sensitivity === "high";
    
    // Build History for Storage and Retrieval (skip for mental health responses in channels)
    // Mental health conversations should only happen in DMs, not in channel history
    if (!isMentalHealthResponse || message.channel instanceof Discord.DMChannel) {
      buildHistory(
        "user",
        nickname,
        message.content,
        nickname,
        channelId,
        imgUrl
      );
      buildHistory(
        "assistant",
        currentPersonality.name,
        responseText,
        nickname,
        channelId,
        imgUrl
      );
    } else {
      console.log(`[MentalHealth] Skipping history save for high-sensitivity response in channel ${channelId} to prevent future mental health references`);
    }

    const MAX_MESSAGE_LENGTH = 2000;
    if (responseText.length > MAX_MESSAGE_LENGTH) {
      let messageChunks = splitIntoChunks(responseText, MAX_MESSAGE_LENGTH);
      for (const chunk of messageChunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.channel.send(responseText);
    }
  } catch (err) {
    console.error(err);

    // If an error occurs, inform the user.
    await message.reply(
      "An error occurred while generating the response. Please try again."
    );
  }
}

// Function to start the sir mode with enhanced debugging for voice channel checks
function startSirMode(interaction, textChannel, checkTime, interval) {
  const voiceState = interaction.member.voice;
  const voiceChannel = client.channels.cache.get(voiceState.channelId);

  if (!voiceChannel) {
    console.error("startSirMode: No voice channel found.");
    textChannel.send("Voice channel not found.");
    return;
  }

  console.log(`startSirMode: Monitoring voice channel "${voiceChannel.name}"`);

  const now = new Date();
  const timeUntilCheck = checkTime - now;

  setTimeout(() => {
    const currentVoiceChannel = client.channels.cache.get(voiceState.channelId);
    if (!currentVoiceChannel) {
      console.error("Voice channel not found during periodic check.");
      textChannel.send("Voice channel not found during periodic check.");
      return;
    }

    // Start tracking missing users
    let missingUsers = new Set(requiredUsers.filter(id => !currentVoiceChannel.members.has(id)));

    // Don't ping the user who initiated if they're present
    if (currentVoiceChannel.members.has(interaction.user.id)) {
      missingUsers.delete(interaction.user.id);
    }

    if (missingUsers.size === 0) {
      console.log("All required users already present.");
      return;
    }

    const intervalId = setInterval(() => {
      const currentMembers = currentVoiceChannel.members;

      // Remove users who have now joined
      for (const userId of missingUsers) {
        if (currentMembers.has(userId)) {
          missingUsers.delete(userId);
          console.log(`✅ ${userId} has joined. Stopping their pings.`);
        }
      }

      // If all users are in, clear interval
      if (missingUsers.size === 0) {
        clearInterval(intervalId);
        activeSirModeIntervals.delete(textChannel.id);
        console.log("🎉 All required users are present. Ending sir mode.");
        textChannel.send("All required users have joined. Sir mode complete.");
      } else {
        // Ping only the users still missing
        for (const userId of missingUsers) {
          textChannel.send(`<@${userId}> SIR! You're not in the voice channel!`);
        }
      }
    }, interval);

    // Track the interval so we can cancel it manually
    activeSirModeIntervals.set(textChannel.id, intervalId);
  }, timeUntilCheck);
}


// Slash command configuration
const commands = [
  {
    name: "personas",
    description: "Manage personas",
    options: [
      {
        name: "list",
        description: "List all available personas",
        type: 1,
      },
      {
        name: "select",
        description: "Change your current persona",
        type: 1,
        options: [
          {
            name: "name",
            type: 3,
            description: "The name of the persona",
            required: true,
            // No choices here as it will be populated dynamically
          },
        ],
      },
    ],
  },
  {
    name: "model",
    description: "Manage User GPT Model",
    options: [
      {
        name: "list",
        description: "List all available GPT models",
        type: 1,
      },
      {
        name: "select",
        description: "Change your current GPT model",
        type: 1,
        options: [
          {
            name: "model",
            type: 3,
            description: "The name of the GPT model",
            required: true,
            // No choices here as it will be populated dynamically
          },
        ],
      },
    ],
  },
  {
    name: "temp",
    description: "Set the GPT temperature",
    options: [
      {
        name: "value",
        type: 10, // Discord's ApplicationCommandOptionType for NUMBER
        description: "The temperature value",
        required: true,
      },
    ],
  },
  {
    name: "uptime",
    description: "Get the uptime of the bot",
  },
  {
    name: "about",
    description: "Get information about the bot",
  },
  {
    name: "forgetme",
    description: "Clear your chat history",
  },
  {
    name: "forgetall",
    description: "Clear all chat history",
  },
  {
    name: "events",
    description: "List all scheduled events",
  },
  {
    name: "schedule",
    description: "Schedule an Event",
    options: [
      {
        name: "event",
        type: 3, // Discord's ApplicationCommandOptionType for STRING
        description: "Event name, date, time, and frequency of reminder",
        required: true,
      },
    ],
  },
  {
    name: "deleteevent",
    description: "Delete a scheduled event",
    options: [
      {
        name: "event",
        type: 3, // Discord's ApplicationCommandOptionType for STRING
        description: "The name of the event you want to delete",
        required: true,
      },
    ],
  },
  {
    name: "image",
    description: "Generate, Transform, and Manipulate Images",
    options: [
      {
        name: "generate",
        description: "Generate an image from a description",
        type: 1, // Discord's ApplicationCommandOptionType for SUB_COMMAND
        options: [
          {
            name: "description",
            type: 3, // Discord's ApplicationCommandOptionType for STRING
            description: "The description of the image",
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "roll",
    description: "Roll Dice or a Series of Dice",
    options: [
      {
        name: "dice",
        type: 3, // Discord's ApplicationCommandOptionType for NUMBER
        description: "The dice to roll",
        required: true,
      },
    ],
  },
  {
    name: "checkin",
    description: "Configure automatic check-in messages for inactive channels",
    options: [
      {
        name: "enable",
        description: "Enable check-ins for this channel",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: "inactivity_days",
            type: 4, // INTEGER
            description: "Days of inactivity before check-in (default: 1)",
            required: false,
          },
          {
            name: "check_in_time",
            type: 3, // STRING
            description: "Time to check (HH:mm format, default: 14:00)",
            required: false,
          },
          {
            name: "timezone",
            type: 3, // STRING
            description: "IANA timezone (default: America/New_York)",
            required: false,
          },
        ],
      },
      {
        name: "disable",
        description: "Disable check-ins for this channel",
        type: 1, // SUB_COMMAND
      },
      {
        name: "status",
        description: "View check-in configuration for this channel",
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: "responsemode",
    description: "Control whether the bot responds without being @mentioned",
    options: [
      {
        name: "enable",
        description: "Enable responding without @mention (bot will respond based on classifier)",
        type: 1, // SUB_COMMAND
      },
      {
        name: "disable",
        description: "Disable responding without @mention (bot only responds when @mentioned)",
        type: 1, // SUB_COMMAND
      },
      {
        name: "status",
        description: "View current response mode for this channel",
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: "webhook",
    description: "Subscribe to or unsubscribe from a webhook for the channel",
    options: [
      {
        name: "list",
        description: "List all available webhooks",
        type: 1, // Type 1 denotes a sub-command
      },
      {
        name: "subscribe",
        description: "Change webhook to subscribe to",
        type: 1,
        options: [
          {
            name: "name",
            type: 3, // Type 3 denotes a STRING
            description: "The name of the webhook to subscribe to",
            required: true,
            // No choices here as it will be populated dynamically
          },
        ],
      },
      {
        name: "unsubscribe",
        description: "Unsubscribe from a webhook",
        type: 1,
        options: [
          {
            name: "name",
            type: 3,
            description: "The name of the webhook to unsubscribe from",
            required: true,
            // No choices here as it will be populated dynamically
          },
        ],
      },
    ],
  },
  {
    name: "sirmode",
    description:
      "Activate sir mode at a specified time when required users are in the voice channel",
    options: [
      {
        name: "time",
        type: 3,
        description: "Time to start sir mode (e.g., 9pm)",
        required: true,
      },
    ],
  },
  {
    name: "endsirmode",
    description: "End sir mode early",
  },
];

function start() {
  client.on("ready", async () => {
    // Initialize entropy engine for dice rolling
    try {
      initEntropyEngine('https://pg.hamy.app', 2048);
      console.log('[EntropyEngine] Initialized with API entropy source');
    } catch (error) {
      console.error('[EntropyEngine] Failed to initialize:', error);
    }

    // Fetch the personas, sort them alphabetically by name, and then populate the personaChoices array:
    const availablePersonas = await Personas.find()
      .sort({ name: 1 })
      .catch((error) => {
        console.log("Error fetching personas", error);
      });
    let personaChoices = availablePersonas.map((persona) => ({
      name: persona.name,
      value: persona.name.toLowerCase(),
    }));

    // Add these choices to the 'select' subcommand configuration:
    const selectSubCommand = commands
      .find((cmd) => cmd.name === "personas")
      .options.find((opt) => opt.name === "select").options[0];
    selectSubCommand.choices = personaChoices;

    // Fetch the allowed models from the environment
    const allowedModels = getUserAllowedModels();
    const modelChoices = allowedModels.map((model) => ({
      name: model,
      value: model,
    }));

    // Add these choices to the 'select' subcommand configuration for models
    const selectModelSubCommand = commands
      .find((cmd) => cmd.name === "model")
      .options.find((opt) => opt.name === "select").options[0];
    selectModelSubCommand.choices = modelChoices;

    // Fetch unique origins and sort them alphabetically
    const availableWebhooks = await WebhookSubs.find()
      .sort({ origin: 1 })
      .catch((error) => {
        console.log("Error fetching webhooks", error);
      });
    const uniqueOrigins = new Set(
      availableWebhooks.map((webhook) => webhook.origin)
    );
    const webhookChoices = Array.from(uniqueOrigins).map((origin) => ({
      name: origin,
      value: origin.toLowerCase(),
    }));

    // Add these choices to the 'subscribe' subcommand
    const subscribeWebhookSubCommand = commands
      .find((cmd) => cmd.name === "webhook")
      .options.find((opt) => opt.name === "subscribe").options[0];
    subscribeWebhookSubCommand.choices = webhookChoices;

    // Initialize check-in scheduler
    initializeCheckInScheduler(client);
    console.log('[CheckIn] Check-in scheduler initialized');

    // Initialize mental health check-in scheduler
    initializeMentalHealthCheckInScheduler(client);
    console.log('[MentalHealth] Mental health check-in scheduler initialized');

    // Add these choices to the 'unsubscribe' subcommand
    const unsubscribeWebhookSubCommand = commands
      .find((cmd) => cmd.name === "webhook")
      .options.find((opt) => opt.name === "unsubscribe").options[0];
    unsubscribeWebhookSubCommand.choices = webhookChoices;

    // Database Loading
    // Load Scheduled Events from Database
    loadJobsFromDatabase(client);

    // Slash command registration
    const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN);

    try {
      console.log("Started refreshing application (/) commands.");

      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands,
      });

      console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
      console.error(error);
    }
  });

  // Handling the interaction created when a user invokes your slash command.
  client.on("interactionCreate", async (interaction) => {
    console.log(`Received interaction: ${interaction.commandName}`);

    let userConfig;

    try {
      if (!interaction.isCommand()) return;

      const { commandName } = interaction;

      switch (commandName) {
        case "personas": {
          const subCommand = interaction.options.getSubcommand();
          if (subCommand === "list") {
            // Fetch available personas from the database
            const availablePersonas = await Personas.find().catch((error) => {
              console.log("Error fetching personas", error);
            });
            const personaNames = availablePersonas.map(
              (persona) => persona.name
            ); // Assuming your schema has a name field for each persona

            await interaction.reply(
              `Available personas are: ${personaNames.join(", ")}`
            );
          } else if (subCommand === "select") {
            const selectedPersonaName = interaction.options
              .getString("name")
              .toLowerCase();

            // Check if the persona exists in the database.
            // This step is more about verifying the consistency of data rather than validating user input,
            // as the choice provided by the user is always from a predefined list.
            const foundPersona = await Personas.findOne({
              name: selectedPersonaName,
            });

            if (foundPersona) {
              userConfig = await getChatConfig(
                interaction.user.username,
                interaction.channelId
              );
              userConfig.currentPersonality = selectedPersonaName;
              setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId
              );
              await interaction.reply(
                `Switched to persona ${selectedPersonaName}.`
              );
            } else {
              await interaction.reply(`Error: Persona not found.`);
            }
          }
          break;
        }

        case "model": {
          const subCommand = interaction.options.getSubcommand();

          if (subCommand === "list") {
            // Fetch the allowed models from config
            const allowedModels = getUserAllowedModels();

            // Reply with the list of models
            if (allowedModels.length > 0) {
              await interaction.reply(
                `Available GPT models are: ${allowedModels.join(", ")}`
              );
            } else {
              await interaction.reply(`No GPT models available.`);
            }
          } else if (subCommand === "select") {
            const selectedModelName = interaction.options.getString("model");

            // Fetch the allowed models from config
            const allowedModels = getUserAllowedModels();

            if (allowedModels.includes(selectedModelName)) {
              userConfig = await getChatConfig(
                interaction.user.username,
                interaction.channelId
              );
              userConfig.model = selectedModelName;
              setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId
              );
              await interaction.reply(
                `Switched to GPT model ${selectedModelName}.`
              );
            } else {
              await interaction.reply(
                `Invalid GPT model: ${selectedModelName}. Allowed models: ${allowedModels.join(
                  ","
                )}`
              );
            }
          }
          break;
        }

        case "temp": {
          const newTemp = interaction.options.getNumber("value");
          userConfig = await getChatConfig(
            interaction.user.username,
            interaction.channelId
          );

          if (userConfig) {
            // Convert the input to a number in case it's a string
            const temperature = parseFloat(newTemp);

            // Validate temperature
            if (!isNaN(temperature) && temperature >= 0 && temperature <= 1) {
              // Update the user's config with the new temperature
              userConfig.temperature = temperature;
              // Save the updated config
              setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId
              );
              await interaction.reply(`Set GPT temperature to ${newTemp}.`);
            } else {
              await interaction.reply(
                `Invalid GPT temperature: ${newTemp}. Temperature should be between 0 and 1.`
              );
            }
          } else {
            await interaction.reply(
              `Could not retrieve configuration for user ${interaction.user.username}`
            );
          }
          break;
        }

        case "uptime": {
          const uptime = getUptime();
          await interaction.reply(`Uptime: ${uptime}`);
          break;
        }

        case "about": {
          userConfig = await getChatConfig(
            interaction.user.username,
            interaction.channelId
          );
          const configInfo = getConfigInformation(
            userConfig.model,
            userConfig.temperature
          );
          await interaction.reply(configInfo);
          break;
        }

        case "forgetme": {
          const user = interaction.user.username;
          console.log("forgetme", interaction.channelId);
          clearUsersHistory(user, interaction.channelId)
            .then(() => {
              interaction.reply(`--Memory of ${user} Erased--`);
            })
            .catch((err) => {
              interaction.reply(`Unable to erase memory of ${user}`);
            });
          break;
        }

        case "forgetall": {
          clearAllHistory()
            .then(() => {
              interaction.reply("-- Memory Erased --");
            })
            .catch((err) => {
              interaction.reply("Unable to erase memory");
            });
          break;
        }

        case "sirmode": {
          const voiceState = interaction.member.voice;

          if (!voiceState || !voiceState.channelId) {
            await interaction.reply(
              "You must be in a voice channel to use this command."
            );
            return;
          }

          const voiceChannel = client.channels.cache.get(voiceState.channelId);
          if (!voiceChannel) {
            await interaction.reply("Could not find your voice channel.");
            return;
          }

          const timeParam = interaction.options.getString("time");
          let checkMoment = moment(timeParam, ["hA", "h:mmA", "H:mm"], true);

          if (!checkMoment.isValid()) {
            await interaction.reply(
              "Invalid time format. Please use a format like '9pm' or '21:00'."
            );
            return;
          }

          const now = moment();
          checkMoment.set({
            year: now.year(),
            month: now.month(),
            date: now.date(),
            second: 0,
            millisecond: 0,
          });

          if (checkMoment.isBefore(now)) {
            checkMoment.add(1, "day");
          }

          const checkTime = checkMoment.toDate();
          const interval = 10000; // 1 minute

          startSirMode(interaction, interaction.channel, checkTime, interval);
          await interaction.reply(
            `Sir mode activated and will start at ${checkMoment.format(
              "h:mm A"
            )}.`
          );
          break;
        }

        case "endsirmode": {
          const channelId = interaction.channelId;

          if (activeSirModeIntervals.has(channelId)) {
            clearInterval(activeSirModeIntervals.get(channelId));
            activeSirModeIntervals.delete(channelId);
            await interaction.reply("Sir mode ended early.");
          } else {
            await interaction.reply("Sir mode is not active in this channel.");
          }
          break;
        }

        case "events": {
          try {
            const events = await ScheduledEvent.find({});
            console.log("Fetched events:", events);
            if (events.length === 0) {
              await interaction.reply("No events are currently scheduled.");
            } else {
              let eventList = "Scheduled Events:\n";
              events.forEach((event) => {
                const eventTime = moment.tz(event.time, event.timezone);
                const formattedEventTime = eventTime.format(
                  "MMMM D, YYYY [at] h:mm A"
                );
                const humanReadableFrequency = cronstrue.toString(
                  event.frequency
                );
                const now = moment();
                const duration = moment.duration(eventTime.diff(now));
                const timeRemaining = [
                  duration.years() > 0 ? duration.years() + " years" : null,
                  duration.days() > 0 ? duration.days() + " days" : null,
                  duration.hours() > 0 ? duration.hours() + " hours" : null,
                  duration.minutes() > 0
                    ? duration.minutes() + " minutes"
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                eventList += `- **${event.eventName}** on ${formattedEventTime} (Timezone: ${event.timezone}, Frequency: ${humanReadableFrequency}, Time Remaining: ${timeRemaining})\n`;
              });
              await interaction.reply(eventList);
            }
          } catch (error) {
            console.error(`Error fetching events: ${error}`);
            await interaction.reply(
              "An error occurred while fetching the events."
            );
          }
          break;
        }

        case "schedule": {
          const event = interaction.options.getString("event");
          interaction.reply("Generating Event Data: " + event);
          const reply = await generateEventData(
            event,
            interaction.channelId,
            client
          );
          await interaction.followUp(reply);
          break;
        }
        case "deleteevent": {
          const eventName = interaction.options.getString("event");
          if (!eventName) {
            await interaction.reply(`Event name must be provided.`);
            return;
          }
          try {
            const result = await deleteEvent(eventName.toLowerCase());
            if (result) {
              await interaction.reply(
                `Event with Name ${eventName} has been deleted.`
              );
            } else {
              await interaction.reply(
                `Event with Name ${eventName} could not be found or deleted.`
              );
            }
          } catch (error) {
            console.error(`Error deleting event: ${error}`);
            await interaction.reply(
              "An error occurred while deleting the event."
            );
          }
          break;
        }

        case "roll": {
          const dice = interaction.options.getString("dice");
          try {
            // Use custom entropy engine for dice rolling
            // The dice-roller library accepts an options object with an rng property
            const customRng = createDiceRng();
            const roll = new DiceRoll(dice, { rng: customRng });
            const expandedRoll = roll.output.split(" =")[0];

            await interaction.reply(
              `**You Rolled ${roll.total}**: (${expandedRoll})`
            );
          } catch (error) {
            console.error('[DiceRoll] Error with custom RNG, falling back to default:', error);
            // Fallback to default RNG if custom RNG fails
            const roll = new DiceRoll(dice);
            const expandedRoll = roll.output.split(" =")[0];
            await interaction.reply(
              `**You Rolled ${roll.total}**: (${expandedRoll})`
            );
          }
          break;
        }

        case "image": {
          try {
            await interaction.deferReply();
            const description = interaction.options.getString("description");

            // Generate the image(s) and get base64 strings
            const { imageBase64, eta } = await generateImage(description);

            // Add a delay if there's an ETA provided
            setTimeout(() => {
              // Convert base64 strings to buffers and create attachments
              const attachments = imageBase64.map((b64, idx) =>
                new Discord.AttachmentBuilder(Buffer.from(b64, "base64"))
                  .setName(`image_${idx + 1}.png`)
                  .setDescription("Generated image")
              );
              interaction.followUp({
                content: description,
                files: attachments,
              });
            }, eta * 1000);
          } catch (err) {
            console.error(`Error generating images: ${err}`);
            await interaction.followUp(
              "An error occurred while generating the images. Please try again later."
            );
          }
          break;
        }

        case "webhook": {
          const subCommand = interaction.options.getSubcommand();
          const channelId = interaction.channelId;

          if (subCommand === "list") {
          } else if (subCommand === "subscribe") {
            const selectedWebhookName = interaction.options
              .getString("name")
              .toLowerCase();

            // Check if already subscribed
            const alreadySubscribed = await WebhookSubs.findOne({
              origin: selectedWebhookName,
              channelId: channelId,
            });
            if (alreadySubscribed) {
              await interaction.reply(
                `This channel is already subscribed to ${selectedWebhookName}.`
              );
              return;
            }

            // Subscribe to the webhook
            const newSubscription = new WebhookSubs({
              origin: selectedWebhookName,
              channelId: channelId,
            });

            await newSubscription.save();
            await interaction.reply(
              `Successfully subscribed this channel to ${selectedWebhookName}.`
            );
          } else if (subCommand === "unsubscribe") {
            const webhookToUnsubscribe = interaction.options
              .getString("name")
              .toLowerCase();

            const foundWebhook = await WebhookSubs.findOne({
              origin: webhookToUnsubscribe,
              channelId: channelId,
            });

            if (foundWebhook) {
              await WebhookSubs.deleteOne({ _id: foundWebhook._id });
              await interaction.reply(
                `Successfully unsubscribed this channel from ${webhookToUnsubscribe}.`
              );
            } else {
              await interaction.reply(
                `Error: This channel is not subscribed to ${webhookToUnsubscribe}.`
              );
            }
          }
          loadWebhookSubs();
          break;
        }

        case "checkin": {
          const subCommand = interaction.options.getSubcommand();
          const channelId = interaction.channelId;

          if (subCommand === "enable") {
            try {
              const inactivityDays = interaction.options.getInteger("inactivity_days") || 1;
              const checkInTime = interaction.options.getString("check_in_time") || "14:00";
              const timezone = interaction.options.getString("timezone") || "America/New_York";

              // Validate time format
              if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(checkInTime)) {
                await interaction.reply("Invalid time format. Please use HH:mm format (e.g., 14:00).");
                return;
              }

              // Update or create check-in config
              const config = await ChannelCheckIn.findOneAndUpdate(
                { channelId },
                {
                  enabled: true,
                  inactivityDays,
                  checkInTime,
                  timezone,
                },
                { upsert: true, new: true }
              );

              await interaction.reply(
                `✅ Check-ins enabled for this channel!\n` +
                `- Inactivity threshold: ${inactivityDays} day(s)\n` +
                `- Check-in time: ${checkInTime}\n` +
                `- Timezone: ${timezone}\n` +
                `The bot will check in if the channel was active in the past ${inactivityDays} day(s) but quiet today.`
              );
            } catch (error) {
              console.error(`[CheckIn] Error enabling check-in:`, error);
              await interaction.reply("An error occurred while enabling check-ins.");
            }
          } else if (subCommand === "disable") {
            try {
              const config = await ChannelCheckIn.findOneAndUpdate(
                { channelId },
                { enabled: false },
                { new: true }
              );

              if (config) {
                await interaction.reply("✅ Check-ins disabled for this channel.");
              } else {
                await interaction.reply("Check-ins were not enabled for this channel.");
              }
            } catch (error) {
              console.error(`[CheckIn] Error disabling check-in:`, error);
              await interaction.reply("An error occurred while disabling check-ins.");
            }
          } else if (subCommand === "status") {
            try {
              const config = await ChannelCheckIn.findOne({ channelId });

              if (!config || !config.enabled) {
                await interaction.reply("Check-ins are not enabled for this channel.");
              } else {
                const statusMessage = 
                  `**Check-in Configuration:**\n` +
                  `- Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                  `- Inactivity threshold: ${config.inactivityDays} day(s)\n` +
                  `- Check-in time: ${config.checkInTime}\n` +
                  `- Timezone: ${config.timezone}\n` +
                  `- Minimum messages per day: ${config.minMessagesPerDay || 5}\n` +
                  (config.lastCheckIn 
                    ? `- Last check-in: ${moment(config.lastCheckIn).format('YYYY-MM-DD HH:mm:ss')}\n`
                    : `- Last check-in: Never\n`);

                await interaction.reply(statusMessage);
              }
            } catch (error) {
              console.error(`[CheckIn] Error getting status:`, error);
              await interaction.reply("An error occurred while getting check-in status.");
            }
          }
          break;
        }

        case "responsemode": {
          const subCommand = interaction.options.getSubcommand();
          const channelId = interaction.channelId;

          if (subCommand === "enable") {
            try {
              const responseMode = await ChannelResponseMode.findOneAndUpdate(
                { channelId },
                { respondWithoutMention: true },
                { upsert: true, new: true }
              );

              await interaction.reply(
                `✅ Response mode enabled!\n` +
                `The bot will now respond to messages in this channel without being @mentioned, based on the classifier's decision.`
              );
            } catch (error) {
              console.error(`[ResponseMode] Error enabling response mode:`, error);
              await interaction.reply("An error occurred while enabling response mode.");
            }
          } else if (subCommand === "disable") {
            try {
              const responseMode = await ChannelResponseMode.findOneAndUpdate(
                { channelId },
                { respondWithoutMention: false },
                { upsert: true, new: true }
              );

              await interaction.reply(
                `✅ Response mode disabled!\n` +
                `The bot will now only respond when @mentioned in this channel.`
              );
            } catch (error) {
              console.error(`[ResponseMode] Error disabling response mode:`, error);
              await interaction.reply("An error occurred while disabling response mode.");
            }
          } else if (subCommand === "status") {
            try {
              const responseMode = await ChannelResponseMode.findOne({ channelId });
              const respondWithoutMention = responseMode?.respondWithoutMention ?? false;

              const statusMessage = 
                `**Response Mode Configuration:**\n` +
                `- Respond without @mention: ${respondWithoutMention ? '✅ Enabled' : '❌ Disabled (default)'}\n` +
                (respondWithoutMention 
                  ? `The bot will respond based on the classifier's decision.\n`
                  : `The bot will only respond when @mentioned.\n`);

              await interaction.reply(statusMessage);
            } catch (error) {
              console.error(`[ResponseMode] Error getting status:`, error);
              await interaction.reply("An error occurred while getting response mode status.");
            }
          }
          break;
        }

        default:
          await interaction.reply("Unknown command");
      }
    } catch (error) {
      console.log(`Error handling command: ${error}`);
    }
  });

  client.on("messageCreate", handleMessage);

  console.log("Attempting to log in to Discord...");
  client
    .login(process.env.DISCORD_TOKEN)
    .then(() => console.log(`Logged in as ${client.user.tag}`))
    .catch((err) => {
      console.error("Error during client login:", err);
      process.exit(1); // Exit if login fails
    });
}

/**
 * Splits a string into chunks up to a specified max length.
 * @param {string} str - The string to split.
 * @param {number} maxLength - The maximum length of each chunk.
 * @returns {string[]} An array of string chunks.
 */
function splitIntoChunks(str, maxLength) {
  let chunks = [];
  while (str.length > 0) {
    let chunkSize = Math.min(str.length, maxLength);
    let chunk = str.substring(0, chunkSize);
    chunks.push(chunk);
    // Ensure we move to the next piece of the string
    str = str.substring(chunkSize);
  }
  return chunks;
}

module.exports = {
  start,
};
