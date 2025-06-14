const Discord = require("discord.js");

const client = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildVoiceStates,
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.DirectMessageReactions,
        Discord.GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
        Discord.Partials.Channel,
        Discord.Partials.Message,
        Discord.Partials.User,
        Discord.Partials.GuildMember
    ],
    fetchAllMembers: true
});

// Add error handling for member fetching
client.on('error', error => {
    if (error.code === 'GuildMembersTimeout') {
        console.warn('Guild members fetch timed out. This is normal for large servers.');
    } else {
        console.error('Discord client error:', error);
    }
});

module.exports = client;