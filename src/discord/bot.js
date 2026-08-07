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
  getDiscordToken,
} = require("../utils/config");
const { getChatConfig, setChatConfig } = require("./chatConfig");
const {
  createEvent,
  deleteEvent,
  deleteEventById,
  EventInputError,
  formatEvent,
  loadJobsFromDatabase,
  parseUserDate,
  setEventEnabled,
  setEventEnabledById,
  updateEvent,
  updateEventById,
} = require("../utils/eventScheduler");
const ScheduledEvent = require("../models/scheduledEvent");
const moment = require("moment-timezone");
const Personas = require("../models/personas");
const { getImageDescription } = require("../imaging/vision");
const WebhookSubs = require("../models/webhookSub");
const { loadWebhookSubs } = require("../utils/webhook");
const { rollDice } = require("../utils/dice");
const { initEntropyEngine, createDiceRng } = require("../utils/entropyEngine");
const { classifyMessage } = require("../services/classifierClient");
const { buildSystemPrompt, buildUserPrompt } = require("../prompting/promptBuilder");
const { buildUserFactsContext } = require("../prompting/promptBuilder");
const { getClassifierConfidenceThreshold } = require("../utils/config");
const ChannelCheckIn = require("../models/channelCheckIn");
const { initializeCheckInScheduler } = require("../utils/channelCheckIn");
const ChannelResponseMode = require("../models/channelResponseMode");
const { 
  setMentalHealthCheckInFlag, 
  clearMentalHealthCheckInFlag, 
  checkIfUserIsOkay,
  initializeMentalHealthCheckInScheduler,
  isUserMentalHealthCheckInsEnabled
} = require("../utils/mentalHealthCheckIn");
const UserMentalHealthSettings = require("../models/userMentalHealthSettings");
const { 
  isMemoryEnabled, 
  setMemoryEnabled, 
  getUserFacts, 
  upsertFacts, 
  listFacts, 
  clearAllFacts, 
  deactivateFacts 
} = require("../services/memory/userMemoryStore");
const { extractFactsFromMessage } = require("../services/memory/factExtractor");
const { getSummary, updateSummary } = require("../services/memory/summaryMemory");
const UserFacts = require("../models/userFacts");
const UserSummary = require("../models/userSummary");
const ChatConfig = require("../models/chatConfig");
const SirModeConfig = require("../models/sirModeConfig");
const { armSirMode, loadSirModes, stopSirMode } = require("../utils/sirMode");
const {
  SAFE_ALLOWED_MENTIONS,
  sanitizeMessage,
  splitDiscordMessage,
  requireGuildManager,
} = require("../utils/security");

// Include the required packages for slash commands
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

const responseRateLimits = new Map();
const responseModeCooldowns = new Map();
const imageCooldowns = new Map();

async function handleMessage(message) {
  let nickname = message.guild
    ? message.member
      ? message.member.nickname || message.author.username
      : message.author.username
    : message.author.username;
  let username = message.author.username;
  let channelId = message.channel.id;
  let responseModeName = "mention";
  let responseModeConfig = null;
  
  // Check if bot is directly @mentioned or if message is a reply to the bot (available throughout function)
  // IMPORTANT: When @everyone is used, Discord includes ALL users in mentions, so we need to check
  // if @everyone/@here is present first, and if so, verify explicit bot mention in content
  const hasEveryoneOrHere = !(message.channel instanceof Discord.DMChannel) && 
    (message.mentions.everyone || message.mentions.here || /@everyone/i.test(message.content) || /@here/i.test(message.content));
  
  let botMentioned = false;
  
  if (!(message.channel instanceof Discord.DMChannel)) {
    if (hasEveryoneOrHere) {
      // If @everyone/@here is present, check for explicit bot mention in content
      // Discord formats explicit mentions as <@botId> or <@!botId>
      const botMentionPattern = new RegExp(`<@!?${client.user.id}>`);
      botMentioned = botMentionPattern.test(message.content);
      if (botMentioned) {
        console.log(`[Bot] Bot explicitly mentioned in @everyone/@here message`);
      }
    } else {
      // Normal case: check if bot is in mentions (not via @everyone)
      botMentioned = message.mentions.has(client.user.id);
    }
  }
  
  // Also check if the message is a reply to the bot's message
  if (!botMentioned && message.reference && message.reference.messageId) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMessage && referencedMessage.author.id === client.user.id) {
        botMentioned = true;
        console.log(`[Bot] Message is a reply to bot's message, treating as @mention`);
      }
    } catch (error) {
      console.error('[Bot] Error fetching referenced message:', error);
      // Continue without treating as mention if we can't fetch the referenced message
    }
  }

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
        userId: message.author.id,
        needsMentalHealthCheckIn: true 
      });
      
      if (config) {
        // User has a check-in flag set, check if they're responding to our check-in
        const { checkIfUserIsOkay } = require("../utils/mentalHealthCheckIn");
        const { isOkay, confidence, wantsToStop } = await checkIfUserIsOkay(message.content);
        
        if (wantsToStop) {
          // User wants to stop receiving check-in messages
          await clearMentalHealthCheckInFlag(message.author.id);
          
          // Also disable mental health check-ins for this user
          await UserMentalHealthSettings.findOneAndUpdate(
            { userId: message.author.id },
            { 
              userId: message.author.id,
              username: username,
              mentalHealthCheckInsEnabled: false 
            },
            { upsert: true, new: true }
          );
          console.log(`[MentalHealth] Disabled mental health check-ins for ${username} after request to stop`);
          
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
            'gpt-5.6-luna',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send({ 
            content: sanitizeMessage(stopMessage), 
            flags: Discord.MessageFlags.SuppressEmbeds,
            allowedMentions: { parse: [] }
          });
          console.log(`[MentalHealth] Cleared check-in flag for ${username} after request to stop messaging`);
          return; // Don't process as a normal message
        } else if (isOkay && confidence >= 0.6) {
          // User seems okay, clear the flag
          console.log(`[MentalHealth] User ${username} indicated they're okay (confidence: ${confidence}), clearing flag...`);
          const cleared = await clearMentalHealthCheckInFlag(message.author.id);
          
          if (cleared) {
            console.log(`[MentalHealth] Successfully cleared check-in flag for ${username}`);
          } else {
            console.warn(`[MentalHealth] Failed to clear check-in flag for ${username} - flag may not have existed`);
          }
          
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
            'gpt-5.6-luna',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send({ 
            content: sanitizeMessage(acknowledgment), 
            flags: Discord.MessageFlags.SuppressEmbeds,
            allowedMentions: { parse: [] }
          });
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
            'gpt-5.6-luna',
            0.7,
            null,
            `dm_${message.author.id}`,
            null,
            []
          );
          
          await message.channel.send({ 
            content: sanitizeMessage(supportMessage), 
            flags: Discord.MessageFlags.SuppressEmbeds,
            allowedMentions: { parse: [] }
          });
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
  // UNLESS the bot is also mentioned (always respond if bot is @mentioned)
  if (!(message.channel instanceof Discord.DMChannel)) {
    const mentionedUsers = message.mentions.users;
    // Use the botMentioned variable defined at the top of the function (includes @mentions and replies)
    const otherUsersMentioned = mentionedUsers.filter(user => user.id !== client.user.id && !user.bot);
    
    // If other users (not the bot) are mentioned AND bot is NOT mentioned, skip responding
    if (otherUsersMentioned.size > 0 && !botMentioned) {
      console.log(`[Bot] Skipping response: Message mentions other users (not the bot) and bot is not mentioned`);
      return;
    }
    
    // Check channel response mode setting (respond without mention)
    // This is checked BEFORE @everyone check to respect the channel setting
    let respondWithoutMention = false;
    try {
      const responseMode = await ChannelResponseMode.findOne({ channelId: message.channel.id });
      responseModeConfig = responseMode;
      responseModeName = responseMode?.mode || (responseMode?.respondWithoutMention ? "smart" : "mention");
      respondWithoutMention = responseModeName !== "mention";
      
      console.log(`[ResponseMode] Channel setting: respondWithoutMention=${respondWithoutMention}, botMentioned=${botMentioned}`);
    } catch (error) {
      console.error('[ResponseMode] Error checking channel response mode:', error);
      // On error, default to requiring mention (fail closed)
      respondWithoutMention = false;
    }
    
    // CRITICAL: Skip if @everyone or @here is mentioned UNLESS bot is explicitly mentioned
    // This is a safety check - responseMode should NOT allow responding to @everyone
    // Note: hasEveryoneOrHere is already checked above when determining botMentioned
    // Also check for role mentions
    const hasRoleMentions = message.mentions.roles.size > 0;
    
    // Only respond to @everyone/@here if the bot is explicitly mentioned (safety first)
    if ((hasEveryoneOrHere || hasRoleMentions) && !botMentioned) {
      console.log(`[Bot] Skipping response: Message mentions @everyone, @here, or roles (and bot is not explicitly mentioned - safety check)`);
      return;
    }
    
    // If respondWithoutMention is false (default), require @mention (but allow if @everyone was handled above)
    // Use botMentioned which correctly handles @everyone cases
    if (!respondWithoutMention && !botMentioned) {
      console.log(`[ResponseMode] Skipping response: Bot not mentioned and respondWithoutMention is disabled for this channel`);
      return;
    }
    
    // If bot is mentioned along with others, log it but continue
    if (botMentioned && otherUsersMentioned.size > 0) {
      console.log(`[Bot] Bot is @mentioned along with other users, responding anyway`);
    }
  }

  const rateKey = `${message.guild?.id || 'dm'}:${message.author.id}`;
  const nowMs = Date.now();
  const responseLimit = Number(process.env.DISCORD_RESPONSES_PER_MINUTE) || 10;
  const rate = responseRateLimits.get(rateKey);
  if (!rate || rate.resetAt <= nowMs) responseRateLimits.set(rateKey, { count: 1, resetAt: nowMs + 60_000 });
  else if (++rate.count > responseLimit) {
    if (botMentioned) await message.reply({ content: "I'm handling a lot right now—please try again in a moment.", allowedMentions: SAFE_ALLOWED_MENTIONS });
    return;
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
    // Only trigger if the user has enabled mental health check-ins (default is off)
    if (classification.sensitivity === "high") {
      try {
        const username = message.author.username;
        const userId = message.author.id;
        const channelId = message.channel.id;
        
        // Check if user has mental health check-ins enabled (default is off)
        const userHasCheckInsEnabled = await isUserMentalHealthCheckInsEnabled(userId);
        
        if (userHasCheckInsEnabled) {
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
        } else {
          console.log(`[MentalHealth] High sensitivity detected for ${username}, but mental health check-ins are disabled for this user`);
        }
      } catch (error) {
        console.error('[MentalHealth] Error setting check-in flag:', error);
        // Don't block the response if this fails
      }
    }
    // ============================ End Mental Health Check-In Detection =============================

    // Check if we should respond based on classifier
    const confidenceThreshold = responseModeConfig?.confidenceThreshold ?? getClassifierConfidenceThreshold();
    
    // If bot is directly @mentioned, always respond (bypass classifier decision)
    // But still use classification data for web search and other features
    if (botMentioned) {
      console.log(`[Bot] Direct @mention detected, bypassing classifier decision and responding`);
      // Continue to generate response - skip classifier check, but keep classification for features
    } else if (responseModeName !== "always" && (!classification.shouldRespond || classification.confidence < confidenceThreshold)) {
      console.log(`[Classifier] Skipping response: ${classification.reason} (confidence: ${classification.confidence})`);
      return; // Don't respond - classifier says we shouldn't
    }
  } catch (error) {
    console.error('[Classifier] Error calling classifier API:', error.message);
    
    // Fallback behavior: if classifier is unavailable, use legacy mention check
    // This ensures the bot doesn't break if classifier service is down
    shouldUseClassifier = false;
    
    // If bot is mentioned, create a default classification so web search and other features still work
    if (botMentioned) {
      console.log('[Classifier] Fallback: Bot @mentioned, creating default classification for features');
      // Create a basic classification that allows web search for questions
      const isQuestion = /[?]/.test(message.content) || 
                        /^(who|what|when|where|why|how|tell me|explain|help me)/i.test(message.content.trim());
      
      classification = {
        shouldRespond: true,
        confidence: 0.95, // High confidence since bot was directly mentioned
        isQuestion: isQuestion,
        topic: 'other',
        sensitivity: 'low',
        reason: 'Bot directly @mentioned (classifier unavailable, using fallback)'
      };
      console.log('[Classifier] Using fallback classification:', classification);
    } else {
      // Legacy mention check as fallback (only needed if classifier fails)
      // Note: The check above already handles other user mentions, but we keep this for consistency
      // Use botMentioned which correctly handles @everyone cases
      if (
        !(message.channel instanceof Discord.DMChannel) &&
        !botMentioned
      ) {
        console.log('[Classifier] Fallback: Bot not mentioned, skipping response');
        return;
      }
      
      console.log('[Classifier] Fallback: Proceeding without classification (classifier unavailable)');
    }
  }
  // ============================ End Classifier Integration =============================

  if (!botMentioned && responseModeName !== "mention") {
    const cooldownMs = (responseModeConfig?.cooldownSeconds ?? 15) * 1000;
    const lastResponse = responseModeCooldowns.get(channelId) || 0;
    if (Date.now() - lastResponse < cooldownMs) return;
    responseModeCooldowns.set(channelId, Date.now());
  }

  // ============================ Image Processing =============================
  let imageDescription;
  let imgUrl = "";

  // If there's an attachment with a URL
  if (message.attachments.size > 0 && message.attachments.first().url) {
    console.log('Processing an image attachment');
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
    console.log('Processing an image URL');
    imageDescription = await getImageDescription(imgUrl);
    //imageDescription = imageFullDescription.denseCaptions.join(", ");
    //console.log(imageDescription);

    // Remove the detected image URL from the message content
    message.content = message.content.replace(imgUrlPattern, "").trim();
  }
  // ============================ End of Image Processing =============================

  // Get the user's config from the database
  // Ensure config exists for the user and channel before fetching it.
  await setChatConfig(username, {}, channelId, message.author.id, message.guild?.id || null);
  let userConfig = await getChatConfig(username, channelId, message.author.id, message.guild?.id || null);

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
  // Skip quality check if bot is directly @mentioned (always respond to direct mentions)
  if (classification && shouldUseClassifier && !botMentioned && responseModeName !== "always") {
    try {
      const channelName = message.channel instanceof Discord.DMChannel 
        ? 'dm' 
        : (message.channel.name || 'unknown');
      
      const qualityCheck = await shouldRespondCheck(
        message.content,
        classification,
        recentMessages,
        channelName,
        'gpt-5.6-luna'
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
  } else if (botMentioned) {
    console.log(`[QualityCheck] Skipping quality check: Bot directly @mentioned, always responding`);
  }
  // ============================ End Pre-Response Quality Check =============================

  // Show as typing in the discord channel - ONLY NOW that we've confirmed we're responding
  message.channel.sendTyping();

  // Preprocess Message and Return Data from our DnD Journal / Sessions
  // Also sends user nickname to retrieve data about their character
  let dndData;
  if (
    message.content !== "" &&
    currentPersonality.type == "dnd" &&
    !imageDescription
  ) {
    dndData = await preprocessUserInput(message.content, nickname, channelId, message.guild?.id, message.author.id);
  } else {
    dndData = "No DnD Data Found";
  }

  // Interaction with ChatGPT API starts here.
  try {
    // Generate response from ChatGPT API
    let responseText;

    // ============================ Memory: fetch facts for prompt =============================
    let extraSystemContext = "";
    try {
      const serverId = message.guild?.id;
      if (process.env.MEMORY_ENABLED !== 'false' && serverId) {
        const enabled = await isMemoryEnabled(message.author.id, serverId);
        if (enabled) {
          const facts = await getUserFacts(message.author.id, serverId, { onlyActive: true });
          const factsContext = buildUserFactsContext(facts);
          const summary = await getSummary(message.author.id, serverId);
          const pieces = [];
          if (factsContext) pieces.push(factsContext);
          if (summary) pieces.push(`Conversation summary: ${summary}`);
          extraSystemContext = pieces.join(' ');
        }
      }
    } catch (e) {
      console.warn('[Memory] Failed to build facts context:', e.message);
    }
    // ============================ End Memory: fetch facts =============================
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
        recentMessages, // Pass recent messages for conversation context
        extraSystemContext, // Memory facts context
        { userId: message.author.id, guildId: message.guild?.id }
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
      await Promise.all([buildHistory(
        "user",
        nickname,
        message.content,
        nickname,
        channelId,
        imgUrl,
        { userId: message.author.id, guildId: message.guild?.id }
      ), buildHistory(
        "assistant",
        currentPersonality.name,
        responseText,
        nickname,
        channelId,
        imgUrl,
        { userId: message.author.id, guildId: message.guild?.id }
      )]);
    } else {
      console.log(`[MentalHealth] Skipping history save for high-sensitivity response in channel ${channelId} to prevent future mental health references`);
    }

    // CRITICAL: Sanitize response text to prevent @everyone and @here mentions
    // This is a security measure - the bot should NEVER mention @everyone or @here
    responseText = sanitizeMessage(responseText);
    
    const MAX_MESSAGE_LENGTH = 2000;
    if (responseText.length > MAX_MESSAGE_LENGTH) {
      let messageChunks = splitDiscordMessage(responseText, MAX_MESSAGE_LENGTH);
      for (const chunk of messageChunks) {
        await message.channel.send({ 
          content: sanitizeMessage(chunk), 
          flags: Discord.MessageFlags.SuppressEmbeds,
          allowedMentions: SAFE_ALLOWED_MENTIONS
        });
      }
    } else {
      await message.channel.send({ 
        content: responseText, 
        flags: Discord.MessageFlags.SuppressEmbeds,
        allowedMentions: SAFE_ALLOWED_MENTIONS
      });
    }

    // ============================ Memory: extract facts after response =============================
    try {
      const serverId = message.guild?.id;
      if (process.env.MEMORY_ENABLED !== 'false' && serverId) {
        const sensitivity = classification?.sensitivity || 'low';
        if (sensitivity !== 'high') {
          const enabled = await isMemoryEnabled(message.author.id, serverId);
          if (enabled) {
            const extracted = await extractFactsFromMessage(message.content);
            if (Array.isArray(extracted) && extracted.length > 0) {
              const results = await upsertFacts(message.author.id, username, serverId, extracted.map(f => ({
                ...f,
                sourceMessageId: message.id
              })));
              if ((results.added + results.updated + results.deactivated) > 0) {
                console.log('[Memory] Updated facts:', results);
              }
            }
            // Update conversation summary
            try {
              const prev = await getSummary(message.author.id, serverId);
              await updateSummary(message.author.id, username, serverId, prev, message.content, responseText);
            } catch (sumErr) {
              console.warn('[Memory] Summary update failed:', sumErr.message);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Memory] Extraction failed:', e.message);
    }
    // ============================ End Memory: extract facts =============================
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
    const requiredUsers = requiredUsersByGuild.get(interaction.guildId) || [];
    if (!requiredUsers.length) {
      textChannel.send({ content: "Sir mode has no configured required users for this server.", allowedMentions: SAFE_ALLOWED_MENTIONS });
      return;
    }
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
          textChannel.send({ content: `<@${userId}> SIR! You're not in the voice channel!`, allowedMentions: { users: [userId], parse: [] } });
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
    name: "memory",
    description: "Manage personal memory for this server",
    options: [
      { name: "status", description: "Show memory status", type: 1 },
      { name: "enable", description: "Enable memory for you here", type: 1 },
      { name: "disable", description: "Disable memory for you here", type: 1 },
      { 
        name: "list", 
        description: "List known facts (top 20)", 
        type: 1 
      },
      { 
        name: "forget", 
        description: "Forget facts by text or category", 
        type: 1,
        options: [
          {
            name: "text",
            type: 3,
            description: "Text to match in facts (optional)",
            required: false
          },
          {
            name: "category",
            type: 3,
            description: "Category to clear (preference_like, preference_dislike, bio, pronouns, timezone, game_role, other)",
            required: false
          }
        ]
      },
      { name: "clear", description: "Clear all facts for you here", type: 1 }
    ],
  },
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
    description: "Permanently clear your data in this server",
    options: [{ name: "confirm", type: 5, description: "Confirm permanent deletion", required: true }],
  },
  {
    name: "forgetall",
    description: "Clear all chat history for this server (admins only)",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
    options: [{ name: "confirm", type: 5, description: "Confirm permanent deletion", required: true }],
  },
  {
    name: "events",
    description: "List upcoming and paused scheduled events",
  },
  {
    name: "schedule",
    description: "Create and manage events and reminders",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
    options: [
      {
        name: "create", description: "Create an event with repeat and reminder controls", type: 1,
        options: [
          { name: "name", type: 3, description: "Event name", required: true },
          { name: "when", type: 3, description: "tomorrow 7:30 PM or 2026-08-14 19:30", required: true },
          { name: "recurrence", type: 3, description: "How often it repeats", required: false, choices: ["once", "daily", "weekly", "biweekly", "monthly"].map(value => ({ name: value === "biweekly" ? "Every two weeks" : value, value })) },
          { name: "reminders", type: 3, description: "Advance reminders, e.g. 1d,2h,15m", required: false },
          { name: "timezone", type: 3, description: "Eastern, Pacific, UTC, or America/New_York", required: false },
        ],
      },
      { name: "quick", description: "Create from natural language", type: 1, options: [{ name: "event", type: 3, description: "e.g. Game every two weeks Friday at 7 PM, remind 1d and 1h", required: true }] },
      {
        name: "edit", description: "Change an existing event", type: 1,
        options: [
          { name: "event", type: 3, description: "Current event name", required: true, autocomplete: true },
          { name: "name", type: 3, description: "New name", required: false },
          { name: "when", type: 3, description: "New date/time", required: false },
          { name: "recurrence", type: 3, description: "New repeat setting", required: false, choices: ["once", "daily", "weekly", "biweekly", "monthly"].map(value => ({ name: value === "biweekly" ? "Every two weeks" : value, value })) },
          { name: "reminders", type: 3, description: "Replace reminders, e.g. 1d,1h", required: false },
          { name: "timezone", type: 3, description: "Eastern, Pacific, UTC, or an IANA timezone", required: false },
        ],
      },
      { name: "pause", description: "Pause an event and its reminders", type: 1, options: [{ name: "event", type: 3, description: "Event name", required: true, autocomplete: true }] },
      { name: "resume", description: "Resume a paused future event", type: 1, options: [{ name: "event", type: 3, description: "Event name", required: true, autocomplete: true }] },
      { name: "delete", description: "Delete an event", type: 1, options: [{ name: "event", type: 3, description: "Event name", required: true, autocomplete: true }] },
      { name: "manage", description: "Open an interactive event editor", type: 1 },
      { name: "list", description: "List scheduled events", type: 1 },
      { name: "help", description: "Show scheduling examples", type: 1 },
    ],
  },
  {
    name: "deleteevent",
    description: "Delete a scheduled event",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
    options: [
      {
        name: "event",
        type: 3, // Discord's ApplicationCommandOptionType for STRING
        description: "The name of the event you want to delete",
        required: true,
        autocomplete: true,
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
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
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
    description: "Control how naturally the bot participates in this channel",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
    options: [
      {
        name: "enable",
        description: "Enable smart participation with safe defaults",
        type: 1, // SUB_COMMAND
      },
      {
        name: "disable",
        description: "Require an @mention or reply",
        type: 1, // SUB_COMMAND
      },
      {
        name: "status",
        description: "View behavior and limits for this channel",
        type: 1, // SUB_COMMAND
      },
      { name: "configure", description: "Choose behavior, cooldown, and confidence", type: 1, options: [
        { name: "mode", type: 3, description: "mention, smart, or always", required: true, choices: [
          { name: "Mention only", value: "mention" }, { name: "Smart participation", value: "smart" }, { name: "Always respond", value: "always" },
        ] },
        { name: "cooldown_seconds", type: 4, description: "Minimum seconds between unprompted replies (0-3600)", required: false, min_value: 0, max_value: 3600 },
        { name: "confidence", type: 10, description: "Smart-mode classifier threshold (0-1)", required: false, min_value: 0, max_value: 1 },
      ] },
    ],
  },
  {
    name: "webhook",
    description: "Subscribe to or unsubscribe from a webhook for the channel",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
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
    description: "Manage bounded voice-channel attendance reminders",
    default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
    options: [
      { name: "start", description: "Start or schedule Sir Mode for your voice channel", type: 1, options: [
        { name: "when", type: 3, description: "Optional start time; blank starts now", required: false },
        { name: "interval_minutes", type: 4, description: "Minutes between reminders (1-60)", required: false, min_value: 1, max_value: 60 },
        { name: "max_reminders", type: 4, description: "Stop after this many reminders (1-20)", required: false, min_value: 1, max_value: 20 },
        { name: "message", type: 3, description: "Custom reminder text", required: false },
      ] },
      { name: "stop", description: "Stop active reminders", type: 1 },
      { name: "status", description: "Show Sir Mode configuration", type: 1 },
      { name: "adduser", description: "Add a required voice participant", type: 1, options: [{ name: "user", type: 6, description: "Required participant", required: true }] },
      { name: "removeuser", description: "Remove a required participant", type: 1, options: [{ name: "user", type: 6, description: "Participant to remove", required: true }] },
    ],
  },
  {
    name: "endsirmode",
    description: "End sir mode early",
  },
  {
    name: "mentalhealthcheckin",
    description: "Manage private, opt-in supportive check-ins",
    options: [
      {
        name: "enable",
        description: "Enable private check-ins with consent controls",
        type: 1, // SUB_COMMAND
        options: [
          { name: "cadence_hours", type: 4, description: "Minimum hours between DMs (6-168)", required: false, min_value: 6, max_value: 168 },
          { name: "timezone", type: 3, description: "IANA timezone", required: false },
          { name: "quiet_start", type: 3, description: "Quiet hours start, HH:mm", required: false },
          { name: "quiet_end", type: 3, description: "Quiet hours end, HH:mm", required: false },
          { name: "tone", type: 3, description: "Message style", required: false, choices: [{ name: "Gentle", value: "gentle" }, { name: "Brief", value: "brief" }] },
        ],
      },
      {
        name: "disable",
        description: "Disable mental health DM check-ins",
        type: 1, // SUB_COMMAND
      },
      {
        name: "status",
        description: "View your current mental health check-in settings",
        type: 1, // SUB_COMMAND
      },
      { name: "snooze", description: "Pause check-ins temporarily", type: 1, options: [{ name: "hours", type: 4, description: "Snooze duration (1-720 hours)", required: true, min_value: 1, max_value: 720 }] },
      { name: "resume", description: "End a snooze without changing preferences", type: 1 },
      { name: "test", description: "Send yourself one test DM now", type: 1 },
    ],
  },
];

function eventReminderText(event) {
  const values = event.reminderMinutes || [];
  return values.map((minutes) => {
    if (minutes % 10080 === 0) return `${minutes / 10080}w`;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }).join(", ");
}

async function buildEventManager(guildId, selectedId = null) {
  const events = await ScheduledEvent.find({
    guildId,
    status: { $in: ["active", "paused"] },
  }).sort({ startsAt: 1 }).limit(25);

  if (!events.length) {
    return {
      content: "No active or paused events. Use `/schedule create` or `/schedule quick` to add one.",
      components: [],
    };
  }

  const selected = events.find(event => String(event._id) === String(selectedId));
  const select = new Discord.StringSelectMenuBuilder()
    .setCustomId("event_manager_select")
    .setPlaceholder("Choose an event to manage")
    .addOptions(events.map(event => ({
      label: event.eventName.slice(0, 100),
      description: `${event.status} · ${moment(event.startsAt).tz(event.timezone).format("MMM D, YYYY h:mm A")}`.slice(0, 100),
      value: String(event._id),
      default: selected ? String(event._id) === String(selected._id) : false,
    })));

  const components = [new Discord.ActionRowBuilder().addComponents(select)];
  let content = "**Event Manager**\nChoose an event below.";

  if (selected) {
    content = `**Event Manager**\n${formatEvent(selected)}`;
    components.push(new Discord.ActionRowBuilder().addComponents(
      new Discord.ButtonBuilder().setCustomId(`event_edit:${selected._id}`).setLabel("Edit").setStyle(Discord.ButtonStyle.Primary).setEmoji("✏️"),
      new Discord.ButtonBuilder().setCustomId(`event_toggle:${selected._id}`).setLabel(selected.status === "paused" ? "Resume" : "Pause").setStyle(Discord.ButtonStyle.Secondary),
      new Discord.ButtonBuilder().setCustomId(`event_delete:${selected._id}`).setLabel("Delete").setStyle(Discord.ButtonStyle.Danger).setEmoji("🗑️"),
    ));
  }

  return { content, components };
}

async function getManagedEvent(interaction, id) {
  if (!interaction.guildId) return null;
  return ScheduledEvent.findOne({ _id: id, guildId: interaction.guildId });
}

function eventEditModal(event) {
  const modal = new Discord.ModalBuilder()
    .setCustomId(`event_edit_modal:${event._id}`)
    .setTitle(`Edit ${event.eventName}`.slice(0, 45));

  const fields = [
    ["event_name", "Event name", event.eventName, Discord.TextInputStyle.Short],
    ["event_when", "Date and time", moment(event.startsAt).tz(event.timezone).format("YYYY-MM-DD HH:mm"), Discord.TextInputStyle.Short],
    ["event_recurrence", "Recurrence", event.recurrence || "once", Discord.TextInputStyle.Short],
    ["event_reminders", "Reminders", eventReminderText(event) || "none", Discord.TextInputStyle.Short],
    ["event_timezone", "Timezone", event.timezone || "America/New_York", Discord.TextInputStyle.Short],
  ];
  modal.addComponents(fields.map(([id, label, value, style]) =>
    new Discord.ActionRowBuilder().addComponents(
      new Discord.TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setRequired(true)
        .setValue(String(value).slice(0, 4000)),
    )));
  return modal;
}

function start() {
  client.on(Discord.Events.ClientReady, async () => {
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
    let personaChoices = (availablePersonas || []).slice(0, 25).map((persona) => ({
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
    const modelLabels = {
      "gpt-5.6-sol": "GPT-5.6 Sol — highest quality",
      "gpt-5.6-terra": "GPT-5.6 Terra — balanced",
      "gpt-5.6-luna": "GPT-5.6 Luna — fastest / lowest cost",
    };
    const modelChoices = allowedModels.slice(0, 25).map((model) => ({
      name: (modelLabels[model] || model).slice(0, 100),
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
    const webhookChoices = Array.from(uniqueOrigins).slice(0, 25).map((origin) => ({
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
    loadSirModes(client);

    // Slash command registration
    const discordToken = getDiscordToken();
    const rest = new REST({ version: "10" }).setToken(discordToken);

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
    let userConfig;

    try {
      if (interaction.isAutocomplete()) {
        if (!["schedule", "deleteevent"].includes(interaction.commandName) || !interaction.guildId) {
          await interaction.respond([]);
          return;
        }
        if (!interaction.memberPermissions?.has(Discord.PermissionsBitField.Flags.ManageGuild)) {
          await interaction.respond([]);
          return;
        }
        const focused = String(interaction.options.getFocused() || "").toLowerCase();
        const events = await ScheduledEvent.find({
          guildId: interaction.guildId,
          status: { $in: ["active", "paused"] },
        }).sort({ startsAt: 1 }).limit(100).lean();
        await interaction.respond(events
          .filter(event => event.eventName.toLowerCase().includes(focused))
          .slice(0, 25)
          .map(event => ({
            name: `${event.eventName} (${event.status})`.slice(0, 100),
            value: event.eventName.slice(0, 100),
          })));
        return;
      }

      const isEventComponent =
        (interaction.isStringSelectMenu() && interaction.customId === "event_manager_select") ||
        (interaction.isButton() && interaction.customId.startsWith("event_")) ||
        (interaction.isModalSubmit() && interaction.customId.startsWith("event_edit_modal:"));

      if (isEventComponent) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(Discord.PermissionsBitField.Flags.ManageGuild)) {
          await interaction.reply({ content: "You need **Manage Server** to manage scheduled events.", flags: Discord.MessageFlags.Ephemeral });
          return;
        }

        if (interaction.isStringSelectMenu()) {
          await interaction.update(await buildEventManager(interaction.guildId, interaction.values[0]));
          return;
        }

        const [action, eventId] = interaction.customId.split(":");
        const event = await getManagedEvent(interaction, eventId);
        if (!event) {
          const payload = { content: "That event no longer exists.", components: [] };
          if (interaction.isModalSubmit()) await interaction.reply({ ...payload, flags: Discord.MessageFlags.Ephemeral });
          else await interaction.update(payload);
          return;
        }

        if (action === "event_edit") {
          await interaction.showModal(eventEditModal(event));
        } else if (action === "event_toggle") {
          await setEventEnabledById(event._id, interaction.guildId, event.status === "paused");
          await interaction.update(await buildEventManager(interaction.guildId, eventId));
        } else if (action === "event_delete") {
          await interaction.update({
            content: `Delete **${event.eventName}** and all of its reminders? This cannot be undone.`,
            components: [new Discord.ActionRowBuilder().addComponents(
              new Discord.ButtonBuilder().setCustomId(`event_confirm_delete:${event._id}`).setLabel("Yes, delete").setStyle(Discord.ButtonStyle.Danger),
              new Discord.ButtonBuilder().setCustomId(`event_cancel_delete:${event._id}`).setLabel("Cancel").setStyle(Discord.ButtonStyle.Secondary),
            )],
          });
        } else if (action === "event_confirm_delete") {
          await deleteEventById(event._id, interaction.guildId);
          await interaction.update(await buildEventManager(interaction.guildId));
        } else if (action === "event_cancel_delete") {
          await interaction.update(await buildEventManager(interaction.guildId, eventId));
        } else if (action === "event_edit_modal") {
          const recurrence = interaction.fields.getTextInputValue("event_recurrence").trim().toLowerCase();
          if (!["once", "daily", "weekly", "biweekly", "monthly"].includes(recurrence)) {
            await interaction.reply({ content: "Recurrence must be `once`, `daily`, `weekly`, `biweekly`, or `monthly`.", flags: Discord.MessageFlags.Ephemeral });
            return;
          }
          const updated = await updateEventById(event._id, interaction.guildId, {
            eventName: interaction.fields.getTextInputValue("event_name"),
            when: interaction.fields.getTextInputValue("event_when"),
            recurrence,
            reminders: interaction.fields.getTextInputValue("event_reminders"),
            timezone: interaction.fields.getTextInputValue("event_timezone"),
          });
          const payload = await buildEventManager(interaction.guildId, updated._id);
          if (interaction.isFromMessage()) await interaction.update(payload);
          else await interaction.reply({ ...payload, flags: Discord.MessageFlags.Ephemeral });
        }
        return;
      }

      if (!interaction.isCommand()) return;

      const { commandName } = interaction;
      console.log(`Received interaction: ${commandName}`);

      const managerCommands = new Set(["forgetall", "schedule", "deleteevent", "checkin", "responsemode", "webhook", "sirmode", "endsirmode"]);
      if (managerCommands.has(commandName) && !(await requireGuildManager(interaction))) return;

      switch (commandName) {
        case "memory": {
          const userId = interaction.user.id;
          const username = interaction.user.username;
          const serverId = interaction.guildId; // per-server memory
          const sub = interaction.options.getSubcommand();

          if (!serverId) {
            await interaction.reply({ content: "Memory is only available in servers (not DMs).", flags: Discord.MessageFlags.Ephemeral });
            break;
          }

          try {
            if (sub === "status") {
              const enabled = await isMemoryEnabled(userId, serverId);
              const facts = await listFacts(userId, serverId, 5);
              const preview = facts.map(f => `- ${f.fact} (${f.category})`).join('\n') || "(no facts)";
              await interaction.reply({
                content: `Memory is ${enabled ? '✅ enabled' : '❌ disabled'} for you in this server.\nSample facts:\n${preview}`,
                flags: Discord.MessageFlags.Ephemeral
              });
            } else if (sub === "enable") {
              await setMemoryEnabled(userId, username, serverId, true);
              await interaction.reply({ content: "✅ Memory enabled for you in this server.", flags: Discord.MessageFlags.Ephemeral });
            } else if (sub === "disable") {
              await setMemoryEnabled(userId, username, serverId, false);
              await interaction.reply({ content: "✅ Memory disabled for you in this server.", flags: Discord.MessageFlags.Ephemeral });
            } else if (sub === "list") {
              const facts = await listFacts(userId, serverId, 20);
              const lines = facts.map((f, i) => `${i + 1}. ${f.fact} (${f.category})`);
              await interaction.reply({
                content: lines.length ? lines.join('\n') : "No stored facts for you in this server.",
                flags: Discord.MessageFlags.Ephemeral
              });
            } else if (sub === "forget") {
              const text = interaction.options.getString("text") || "";
              const category = interaction.options.getString("category") || "";
              if (!text && !category) {
                await interaction.reply({ content: "Provide at least one of: text or category.", flags: Discord.MessageFlags.Ephemeral });
                break;
              }
              const textNorm = (text || "").toLowerCase().trim();
              const categoryNorm = (category || "").toLowerCase().trim();
              const count = await deactivateFacts(userId, serverId, (f) => {
                const byText = textNorm ? (f.fact || '').toLowerCase().includes(textNorm) : false;
                const byCategory = categoryNorm ? ((f.category || '').toLowerCase() === categoryNorm) : false;
                return (text ? byText : false) || (category ? byCategory : false);
              });
              await interaction.reply({ content: `✅ Forgotten ${count} fact(s).`, flags: Discord.MessageFlags.Ephemeral });
            } else if (sub === "clear") {
              const count = await clearAllFacts(userId, serverId);
              await UserSummary.deleteOne({ userId, serverId });
              await interaction.reply({ content: `Cleared ${count} fact(s) and your conversation summary.`, flags: Discord.MessageFlags.Ephemeral });
            }
          } catch (err) {
            console.error('[Memory] Command error:', err);
            await interaction.reply({ content: "An error occurred handling memory command.", flags: Discord.MessageFlags.Ephemeral });
          }
          break;
        }
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
                interaction.channelId,
                interaction.user.id,
                interaction.guildId
              );
              userConfig.currentPersonality = selectedPersonaName;
              await setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId,
                interaction.user.id,
                interaction.guildId
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
              const descriptions = {
                "gpt-5.6-sol": "highest quality for difficult reasoning and rich campaign work",
                "gpt-5.6-terra": "recommended balance of intelligence, speed, and cost",
                "gpt-5.6-luna": "fastest and most economical for everyday chat",
              };
              await interaction.reply(
                `**Available models**\n${allowedModels.map(model => `- **${model}** — ${descriptions[model] || "custom configured model"}`).join("\n")}\n\nYour current model: **${userConfig.model}**`
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
                interaction.channelId,
                interaction.user.id,
                interaction.guildId
              );
              userConfig.model = selectedModelName;
              await setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId,
                interaction.user.id,
                interaction.guildId
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
            interaction.channelId,
            interaction.user.id,
            interaction.guildId
          );

          if (userConfig) {
            // Convert the input to a number in case it's a string
            const temperature = parseFloat(newTemp);

            // Validate temperature
            if (!isNaN(temperature) && temperature >= 0 && temperature <= 1) {
              // Update the user's config with the new temperature
              userConfig.temperature = temperature;
              // Save the updated config
              await setChatConfig(
                interaction.user.username,
                userConfig,
                interaction.channelId,
                interaction.user.id,
                interaction.guildId
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
            interaction.channelId,
            interaction.user.id,
            interaction.guildId
          );
          const configInfo = getConfigInformation(
            userConfig.model,
            userConfig.temperature
          );
          await interaction.reply(configInfo);
          break;
        }

        case "forgetme": {
          if (!interaction.guildId || !interaction.options.getBoolean("confirm")) {
            await interaction.reply({ content: "Deletion was not confirmed.", flags: Discord.MessageFlags.Ephemeral });
            break;
          }
          const userId = interaction.user.id;
          const guildId = interaction.guildId;
          const channelIds = [...interaction.guild.channels.cache.keys()];
          const deletedHistory = await clearUsersHistory({ userId, nickname: interaction.user.username, guildId, channelIds });
          await Promise.all([
            UserFacts.deleteOne({ userId, serverId: guildId }),
            UserSummary.deleteOne({ userId, serverId: guildId }),
            ChatConfig.deleteMany({
              $and: [
                { $or: [{ userId }, { username: interaction.user.username }] },
                { $or: [{ guildId }, { channelID: { $in: channelIds } }] },
              ],
            }),
          ]);
          await interaction.reply({ content: `Your stored data for this server was deleted (${deletedHistory} history records).`, flags: Discord.MessageFlags.Ephemeral });
          break;
        }

        case "forgetall": {
          if (!interaction.options.getBoolean("confirm")) {
            await interaction.reply({ content: "Deletion was not confirmed.", flags: Discord.MessageFlags.Ephemeral });
            break;
          }
          const deleted = await clearAllHistory(interaction.guildId, [...interaction.guild.channels.cache.keys()]);
          await interaction.reply({ content: `Deleted ${deleted} chat-history records for this server.`, flags: Discord.MessageFlags.Ephemeral });
          break;
        }

        case "sirmode": {
          const subCommand = interaction.options.getSubcommand();
          if (subCommand === "adduser" || subCommand === "removeuser") {
            const user = interaction.options.getUser("user");
            const operation = subCommand === "adduser" ? { $addToSet: { requiredUserIds: user.id } } : { $pull: { requiredUserIds: user.id } };
            await SirModeConfig.findOneAndUpdate(
              { guildId: interaction.guildId },
              { ...operation, $setOnInsert: { textChannelId: interaction.channelId, voiceChannelId: interaction.member.voice?.channelId || interaction.channelId } },
              { upsert: true, new: true },
            );
            await interaction.reply({ content: `${subCommand === "adduser" ? "Added" : "Removed"} ${user.username} ${subCommand === "adduser" ? "to" : "from"} Sir Mode.`, flags: Discord.MessageFlags.Ephemeral });
          } else if (subCommand === "start") {
            if (!interaction.member.voice?.channelId) {
              await interaction.reply({ content: "Join the voice channel you want Sir Mode to monitor first.", flags: Discord.MessageFlags.Ephemeral });
              break;
            }
            const existing = await SirModeConfig.findOne({ guildId: interaction.guildId });
            const when = interaction.options.getString("when");
            const timezone = process.env.DEFAULT_TIMEZONE || "America/New_York";
            const startsAt = when ? parseUserDate(when, timezone) : new Date(Date.now() + 1000);
            const requiredUserIds = existing?.requiredUserIds?.length ? existing.requiredUserIds : [interaction.user.id];
            const config = await SirModeConfig.findOneAndUpdate(
              { guildId: interaction.guildId },
              { guildId: interaction.guildId, textChannelId: interaction.channelId, voiceChannelId: interaction.member.voice.channelId, requiredUserIds, active: true, startsAt, remindersSent: 0, intervalMinutes: interaction.options.getInteger("interval_minutes") || existing?.intervalMinutes || 5, maxReminders: interaction.options.getInteger("max_reminders") || existing?.maxReminders || 3, message: interaction.options.getString("message") || existing?.message || "SIR! Game time—please join the voice channel.", updatedBy: interaction.user.id },
              { upsert: true, new: true },
            );
            await armSirMode(config, client);
            await interaction.reply(`✅ Sir Mode armed for <#${config.voiceChannelId}> at <t:${Math.floor(config.startsAt.getTime() / 1000)}:F>. It will send at most ${config.maxReminders} reminder(s), ${config.intervalMinutes} minute(s) apart.`);
          } else if (subCommand === "stop") {
            const stopped = await stopSirMode(interaction.guildId);
            await interaction.reply(stopped ? "Sir Mode stopped." : "Sir Mode has not been configured.");
          } else {
            const config = await SirModeConfig.findOne({ guildId: interaction.guildId });
            await interaction.reply(config ? `**Sir Mode**\nStatus: ${config.active ? "active" : "stopped"}\nVoice channel: <#${config.voiceChannelId}>\nRequired users: ${config.requiredUserIds.map(id => `<@${id}>`).join(", ") || "none"}\nInterval: ${config.intervalMinutes}m · Limit: ${config.maxReminders} · Sent: ${config.remindersSent}` : "Sir Mode has not been configured. Add required users, then use `/sirmode start`.");
          }
          break;
        }

        case "endsirmode": {
          const stopped = await stopSirMode(interaction.guildId);
          await interaction.reply(stopped ? "Sir Mode stopped." : "Sir Mode has not been configured.");
          break;
        }

        case "events": {
          try {
            const events = await ScheduledEvent.find({ guildId: interaction.guildId, status: { $in: ["active", "paused"] } }).sort({ startsAt: 1 });
            if (events.length === 0) {
              await interaction.reply("No events are currently scheduled.");
            } else {
              await interaction.reply(events.map(formatEvent).join("\n\n"));
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
          const subCommand = interaction.options.getSubcommand();
          await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
          if (subCommand === "help") {
            await interaction.editReply("**Scheduling examples**\n- `/schedule manage` opens the visual event editor.\n- `/schedule create name:Game Night when:tomorrow 7:30 PM recurrence:biweekly reminders:1d,2h,15m`\n- `/schedule quick event:Game Night every two weeks Friday at 7 PM, remind me 1 day and 1 hour before`\n- Event fields also autocomplete as you type.");
          } else if (subCommand === "manage") {
            await interaction.editReply(await buildEventManager(interaction.guildId));
          } else if (subCommand === "list") {
            const events = await ScheduledEvent.find({ guildId: interaction.guildId, status: { $in: ["active", "paused"] } }).sort({ startsAt: 1 });
            await interaction.editReply(events.length ? events.map(formatEvent).join("\n\n") : "No active or paused events.");
          } else if (subCommand === "quick") {
            const reply = await generateEventData(interaction.options.getString("event"), interaction.channelId, client, { guildId: interaction.guildId, creatorId: interaction.user.id });
            await interaction.editReply(reply ? `✅ Scheduled\n${reply}` : "I couldn't understand that schedule. Try `/schedule help`.");
          } else if (subCommand === "create") {
            const timezone = interaction.options.getString("timezone") || process.env.DEFAULT_TIMEZONE || "America/New_York";
            const event = await createEvent({ eventName: interaction.options.getString("name"), startsAt: parseUserDate(interaction.options.getString("when"), timezone), recurrence: interaction.options.getString("recurrence") || "once", reminders: interaction.options.getString("reminders") || "1d,1h", timezone, channelId: interaction.channelId, guildId: interaction.guildId, creatorId: interaction.user.id }, client);
            await interaction.editReply(`✅ Scheduled\n${formatEvent(event)}`);
          } else if (subCommand === "edit") {
            const event = await updateEvent(interaction.options.getString("event"), interaction.guildId, { eventName: interaction.options.getString("name"), when: interaction.options.getString("when"), recurrence: interaction.options.getString("recurrence"), reminders: interaction.options.getString("reminders"), timezone: interaction.options.getString("timezone") });
            await interaction.editReply(event ? `✅ Updated\n${formatEvent(event)}` : "Event not found. Use `/schedule list` to check its exact name.");
          } else if (subCommand === "pause" || subCommand === "resume") {
            const event = await setEventEnabled(interaction.options.getString("event"), interaction.guildId, subCommand === "resume");
            await interaction.editReply(event ? `✅ ${subCommand === "resume" ? "Resumed" : "Paused"}\n${formatEvent(event)}` : "Event not found.");
          } else if (subCommand === "delete") {
            const deleted = await deleteEvent(interaction.options.getString("event"), interaction.guildId);
            await interaction.editReply(deleted ? "Event and all of its reminders were deleted." : "Event not found.");
          }
          break;
        }
        case "deleteevent": {
          const eventName = interaction.options.getString("event");
          if (!eventName) {
            await interaction.reply(`Event name must be provided.`);
            return;
          }
          try {
            const result = await deleteEvent(eventName.toLowerCase(), interaction.guildId);
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
            const roll = rollDice(dice, customRng);

            await interaction.reply(
              `**You Rolled ${roll.total}**: (${roll.expanded})`
            );
          } catch (error) {
            console.error('[DiceRoll] Error with custom RNG, falling back to default:', error);
            await interaction.reply({ content: error.message || "Invalid dice notation.", flags: Discord.MessageFlags.Ephemeral });
          }
          break;
        }

        case "image": {
          try {
            const cooldownMs = Number(process.env.IMAGE_COOLDOWN_MS) || 120000;
            const previous = imageCooldowns.get(interaction.user.id) || 0;
            if (Date.now() - previous < cooldownMs) {
              await interaction.reply({ content: "Please wait before generating another image.", flags: Discord.MessageFlags.Ephemeral });
              break;
            }
            imageCooldowns.set(interaction.user.id, Date.now());
            await interaction.deferReply();
            const description = interaction.options.getString("description");

            // Generate the image(s) and get base64 strings
          const { imageBase64, eta } = await generateImage(description);

            if (!imageBase64.length || eta < 0) {
              await interaction.editReply("Image generation failed. Please try again later.");
              break;
            }

            // Add a delay if there's an ETA provided
            setTimeout(async () => {
              // Convert base64 strings to buffers and create attachments
              const attachments = imageBase64.map((b64, idx) =>
                new Discord.AttachmentBuilder(Buffer.from(b64, "base64"))
                  .setName(`image_${idx + 1}.png`)
                  .setDescription("Generated image")
              );
              await interaction.editReply({
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
            const subscriptions = await WebhookSubs.find({ guildId: interaction.guildId, channelId }).sort({ origin: 1 });
            const names = subscriptions.map(sub => sub.origin);
            await interaction.reply({ content: names.length ? `Subscribed webhooks: ${names.join(", ")}` : "This channel has no webhook subscriptions.", flags: Discord.MessageFlags.Ephemeral });
          } else if (subCommand === "subscribe") {
            const selectedWebhookName = interaction.options
              .getString("name")
              .toLowerCase();

            // Check if already subscribed
            const alreadySubscribed = await WebhookSubs.findOne({
              origin: selectedWebhookName,
              channelId: channelId,
              guildId: interaction.guildId,
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
              guildId: interaction.guildId,
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
              guildId: interaction.guildId,
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
                  guildId: interaction.guildId,
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
                { respondWithoutMention: true, mode: "smart", guildId: interaction.guildId, updatedBy: interaction.user.id },
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
                { respondWithoutMention: false, mode: "mention", guildId: interaction.guildId, updatedBy: interaction.user.id },
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
          } else if (subCommand === "configure") {
            const mode = interaction.options.getString("mode");
            const update = { mode, respondWithoutMention: mode !== "mention", guildId: interaction.guildId, updatedBy: interaction.user.id };
            const cooldown = interaction.options.getInteger("cooldown_seconds");
            const confidence = interaction.options.getNumber("confidence");
            if (cooldown !== null) update.cooldownSeconds = cooldown;
            if (confidence !== null) update.confidenceThreshold = confidence;
            const config = await ChannelResponseMode.findOneAndUpdate({ channelId }, update, { upsert: true, new: true });
            await interaction.reply(`✅ Response mode set to **${config.mode}**.\nCooldown: ${config.cooldownSeconds}s · Smart confidence: ${config.confidenceThreshold}`);
          } else if (subCommand === "status") {
            try {
              const responseMode = await ChannelResponseMode.findOne({ channelId });
              const respondWithoutMention = responseMode?.respondWithoutMention ?? false;
              const mode = responseMode?.mode || (respondWithoutMention ? "smart" : "mention");

              const statusMessage = 
                `**Response Mode Configuration:**\n` +
                `- Mode: **${mode}**\n` +
                `- Cooldown: ${responseMode?.cooldownSeconds ?? 15}s\n` +
                `- Smart confidence: ${responseMode?.confidenceThreshold ?? getClassifierConfidenceThreshold()}\n` +
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

        case "mentalhealthcheckin": {
          const subCommand = interaction.options.getSubcommand();
          const userId = interaction.user.id;
          const username = interaction.user.username;

          if (subCommand === "enable") {
            try {
              const timezone = interaction.options.getString("timezone") || "America/New_York";
              const quietStart = interaction.options.getString("quiet_start") || "22:00";
              const quietEnd = interaction.options.getString("quiet_end") || "08:00";
              if (!moment.tz.zone(timezone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)) {
                await interaction.reply({ content: "Use a valid IANA timezone and HH:mm quiet-hour values.", flags: Discord.MessageFlags.Ephemeral });
                break;
              }
              await UserMentalHealthSettings.findOneAndUpdate(
                { userId },
                { 
                  userId,
                  username,
                  mentalHealthCheckInsEnabled: true,
                  cadenceHours: interaction.options.getInteger("cadence_hours") || 24,
                  timezone,
                  quietStart,
                  quietEnd,
                  tone: interaction.options.getString("tone") || "gentle",
                  consentedAt: new Date(),
                  snoozedUntil: null,
                },
                { upsert: true, new: true }
              );

              await interaction.reply({
                content: `✅ Mental health DM check-ins enabled!\n` +
                  `When the bot detects that you may be struggling, it will send you a caring check-in DM.\n` +
                  `You can disable this at any time with \`/mentalhealthcheckin disable\`.`,
                flags: Discord.MessageFlags.Ephemeral
              });
            } catch (error) {
              console.error(`[MentalHealth] Error enabling check-ins:`, error);
              await interaction.reply({
                content: "An error occurred while enabling mental health check-ins.",
                flags: Discord.MessageFlags.Ephemeral
              });
            }
          } else if (subCommand === "disable") {
            try {
              await UserMentalHealthSettings.findOneAndUpdate(
                { userId },
                { 
                  userId,
                  username,
                  mentalHealthCheckInsEnabled: false 
                },
                { upsert: true, new: true }
              );

              // Also clear any pending check-in flags for this user
              await clearMentalHealthCheckInFlag(userId);

              await interaction.reply({
                content: `✅ Mental health DM check-ins disabled.\n` +
                  `You will no longer receive check-in DMs from the bot.\n` +
                  `You can re-enable this at any time with \`/mentalhealthcheckin enable\`.`,
                flags: Discord.MessageFlags.Ephemeral
              });
            } catch (error) {
              console.error(`[MentalHealth] Error disabling check-ins:`, error);
              await interaction.reply({
                content: "An error occurred while disabling mental health check-ins.",
                flags: Discord.MessageFlags.Ephemeral
              });
            }
          } else if (subCommand === "snooze") {
            const hours = interaction.options.getInteger("hours");
            const settings = await UserMentalHealthSettings.findOneAndUpdate({ userId, mentalHealthCheckInsEnabled: true }, { snoozedUntil: new Date(Date.now() + hours * 3600000) }, { new: true });
            await interaction.reply({ content: settings ? `Check-ins snoozed until <t:${Math.floor(settings.snoozedUntil.getTime() / 1000)}:F>.` : "Enable check-ins before snoozing them.", flags: Discord.MessageFlags.Ephemeral });
          } else if (subCommand === "resume") {
            await UserMentalHealthSettings.findOneAndUpdate({ userId }, { $unset: { snoozedUntil: 1 } });
            await interaction.reply({ content: "Check-in snooze cleared. Your existing preferences are unchanged.", flags: Discord.MessageFlags.Ephemeral });
          } else if (subCommand === "test") {
            const { sendMentalHealthCheckInDM } = require("../utils/mentalHealthCheckIn");
            const result = await sendMentalHealthCheckInDM(userId, client, { force: true });
            await interaction.reply({ content: result.sent ? "Test DM sent." : `Test DM not sent: ${result.reason}.`, flags: Discord.MessageFlags.Ephemeral });
          } else if (subCommand === "status") {
            try {
              const settings = await UserMentalHealthSettings.findOne({ userId });
              const isEnabled = settings?.mentalHealthCheckInsEnabled ?? false;
              const details = isEnabled
                ? `- Minimum cadence: ${settings.cadenceHours} hours\n- Quiet hours: ${settings.quietStart}–${settings.quietEnd} (${settings.timezone})\n- Tone: ${settings.tone}\n- Snoozed until: ${settings.snoozedUntil ? `<t:${Math.floor(settings.snoozedUntil.getTime() / 1000)}:F>` : "not snoozed"}\n`
                : "";

              const statusMessage = 
                `**Mental Health Check-In Settings:**\n` +
                details +
                `- Status: ${isEnabled ? '✅ Enabled' : '❌ Disabled (default)'}\n` +
                (isEnabled 
                  ? `The bot will send you caring DMs when it detects you may be struggling.\n`
                  : `The bot will not send you mental health check-in DMs.\n`) +
                `\nUse \`/mentalhealthcheckin enable\` or \`/mentalhealthcheckin disable\` to change this setting.`;

              await interaction.reply({
                content: statusMessage,
                flags: Discord.MessageFlags.Ephemeral
              });
            } catch (error) {
              console.error(`[MentalHealth] Error getting status:`, error);
              await interaction.reply({
                content: "An error occurred while getting mental health check-in status.",
                flags: Discord.MessageFlags.Ephemeral
              });
            }
          }
          break;
        }

        default:
          await interaction.reply("Unknown command");
      }
    } catch (error) {
      console.error(`Error handling command ${interaction.commandName}:`, error.message);
      const content = error instanceof EventInputError
        ? error.message
        : "That command couldn't be completed. Please try again.";
      const payload = { content, flags: Discord.MessageFlags.Ephemeral };
      try {
        if (interaction.deferred) await interaction.editReply({ content });
        else if (interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (replyError) {
        console.error('Unable to send command error response:', replyError.message);
      }
    }
  });

  client.on("messageCreate", handleMessage);

  console.log("Attempting to log in to Discord...");
  return client.login(getDiscordToken())
    .then(() => console.log(`Logged in as ${client.user.tag}`));
}

module.exports = {
  start,
  commands,
};
