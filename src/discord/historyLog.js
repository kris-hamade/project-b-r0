const moment = require("moment");
const ChatHistory = require('../models/chatHistory');

async function buildHistory(type, username, content, requestor, channelId, image_url, metadata = {}) {
  let timestamp = getCurrentTimestamp();
  try {
    const chatHistory = new ChatHistory({
      type, username, content, requestor, timestamp, channelId, image_url,
      userId: metadata.userId,
      guildId: metadata.guildId,
    });
    await chatHistory.save();
    return chatHistory;
  } catch (error) {
    console.error("Error building history:", error);
    throw error;
  }
}

async function getHistoryJson(size) {
  try {
    if (size === "complete") {
      const allHistory = await ChatHistory.find().catch((error) => console.error("Error getting all history JSON:", error));
      return allHistory;
    }
  } catch (error) {
    console.error("Error getting history JSON:", error);
    throw error;
  }
}

async function getHistory(nickname, personality, channelId, numberOfEntries = 5, userId = null) {
  if (!channelId) {
    console.error("getHistory called with undefined channelId");
    return "Error: channelId is undefined";
  }
  try {
    // Fetching the last 'numberOfEntries' entries from chat history
    const historyDocs = await ChatHistory.find({
      $or: [
        userId
          ? { userId, type: "user", channelId }
          : { requestor: nickname, username: nickname, channelId },
        userId
          ? { userId, type: "assistant", username: personality, channelId }
          : { type: "assistant", username: personality, requestor: nickname, channelId }
      ]
    }).sort({ _id: -1 }).limit(numberOfEntries * 2); // Fetch more to account for potential filtering

    // Since the documents are fetched in reverse order, reverse them to get the correct chronological order
    const reversedHistoryDocs = historyDocs.reverse();
    
    // Filter out mental health-related messages to prevent them from influencing future conversations
    // Only filter if the message contains very specific mental health support language
    const mentalHealthPattern = /(i['']m here for you|checking in on you|how are you doing|are you okay|reach out if you need|support.*mental|mental health.*support)/i;
    const filteredDocs = reversedHistoryDocs.filter(doc => {
      // Keep messages that don't match mental health support patterns
      return !mentalHealthPattern.test(doc.content);
    }).slice(0, numberOfEntries); // Take only the requested number after filtering

    // Format and return the chat history
    const formattedHistory = formatChatHistory(filteredDocs);
    return formattedHistory;
  } catch (error) {
    console.error("Error getting history:", error);
    throw error;
  }
}

function formatChatHistory(chatHistory) {
  return chatHistory
    .map((item) => {
      if (item.type === "user") {
        return `User: ${item.username}\n${item.content}`;
      } else if (item.type === "assistant") {
        return `Assistant: ${item.content}`;
      }
    })
    .join("\n");
}


async function clearUsersHistory({ userId, nickname, guildId, channelId = null, channelIds = [] }) {
  try {
    const identities = [{ username: nickname }, { requestor: nickname }];
    if (userId) identities.unshift({ userId });
    const scopes = [];
    if (guildId) scopes.push({ guildId });
    if (channelId) scopes.push({ channelId });
    else if (channelIds.length) scopes.push({ channelId: { $in: channelIds } });
    if (!scopes.length) throw new Error('A deletion scope is required');
    const query = { $and: [{ $or: identities }, { $or: scopes }] };
    const result = await ChatHistory.deleteMany(query);
    return result.deletedCount;
  } catch (error) {
    console.error(`Error clearing history for ${nickname} in chatHistory collection:`, error);
    throw error;
  }
}

async function clearAllHistory(guildId, channelIds = []) {
  try {
    if (!guildId) throw new Error("guildId is required to clear server history");
    const scopes = [{ guildId }];
    if (channelIds.length) scopes.push({ channelId: { $in: channelIds } });
    const result = await ChatHistory.deleteMany({ $or: scopes });
    return result.deletedCount;
  } catch (error) {
    console.error("Error clearing ChatHistory collection:", error);
    throw error;
  }
}

function getCurrentTimestamp() {
  return moment().format("YYYYMMDD-HH:mm:ss");
}

module.exports = {
  buildHistory,
  clearAllHistory,
  clearUsersHistory,
  getHistory,
};
