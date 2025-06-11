const ChatConfig = require('../models/chatConfig');

async function getChatConfig(username, channelID) {
    console.log("getChatConfig channel ID:", channelID)
    let chatConfig = await ChatConfig.findOne({ username, channelID });

    // Check if the user's config exists, if not, create a default one
    if (!chatConfig) {
        chatConfig = new ChatConfig({ username, channelID });
        await chatConfig.save();
    }

    console.log(chatConfig);
    return chatConfig;
}

async function setChatConfig(username, config, channelID) {
    console.log("channel ID: ", channelID);
    console.log("Set Chat Config: ", username, config, channelID);
    let chatConfig = await ChatConfig.findOne({ username, channelID });

    if (!chatConfig) {
        // If the config doesn't exist, create a new one
        chatConfig = new ChatConfig({ username, channelID });
    }

    // Update other configurations
    if (config.currentPersonality) {
        chatConfig.currentPersonality = config.currentPersonality;
    }
    if (config.temperature) {
        chatConfig.temperature = config.temperature;
    }
    if (config.model) {
        chatConfig.model = config.model;
    }

    // Save the updated config
    await chatConfig.save();
    console.log(chatConfig);
}


module.exports = {
    getChatConfig,
    setChatConfig
}
