const ChatConfig = require('../models/chatConfig');
const DEPRECATED_MODELS = new Set(['gpt-5-chat-latest', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4']);

async function getChatConfig(username, channelID, userId = null, guildId = null) {
    const identityQuery = userId
        ? { $or: [{ userId, channelID }, { username, channelID }] }
        : { username, channelID };
    let chatConfig = await ChatConfig.findOne(identityQuery);

    // Check if the user's config exists, if not, create a default one
    if (!chatConfig) {
        chatConfig = new ChatConfig({ username, channelID, userId, guildId });
        await chatConfig.save();
    } else {
        let changed = false;
        if (userId && !chatConfig.userId) { chatConfig.userId = userId; changed = true; }
        if (guildId && !chatConfig.guildId) { chatConfig.guildId = guildId; changed = true; }
        if (DEPRECATED_MODELS.has(chatConfig.model)) { chatConfig.model = process.env.GLOBAL_GPT_MODEL || 'gpt-5.6-terra'; changed = true; }
        if (changed) await chatConfig.save();
    }
    return chatConfig;
}

async function setChatConfig(username, config, channelID, userId = null, guildId = null) {
    const identityQuery = userId
        ? { $or: [{ userId, channelID }, { username, channelID }] }
        : { username, channelID };
    let chatConfig = await ChatConfig.findOne(identityQuery);

    if (!chatConfig) {
        // If the config doesn't exist, create a new one
        chatConfig = new ChatConfig({ username, channelID, userId, guildId });
    }

    if (userId) chatConfig.userId = userId;
    if (guildId) chatConfig.guildId = guildId;

    // Update other configurations
    if (config.currentPersonality) {
        chatConfig.currentPersonality = config.currentPersonality;
    }
    if (config.temperature !== undefined) {
        chatConfig.temperature = config.temperature;
    }
    if (config.model) {
        chatConfig.model = config.model;
    }

    // Save the updated config
    await chatConfig.save();
    return chatConfig;
}


module.exports = {
    getChatConfig,
    setChatConfig
}
