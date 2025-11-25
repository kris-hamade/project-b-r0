const moment = require("moment");
const ChatHistory = require('../models/chatHistory');

async function buildHistory(type, username, content, requestor, channelId, image_url) {
  console.log(`Building history for ${type} ${username} ${content} ${requestor} ${channelId} ${image_url}`);
  let timestamp = getCurrentTimestamp();
  try {
    const chatHistory = new ChatHistory({ type, username, content, requestor, timestamp, channelId, image_url });
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

async function getHistory(nickname, personality, channelId, numberOfEntries = 5) {
  if (!channelId) {
    console.error("getHistory called with undefined channelId");
    return "Error: channelId is undefined";
  }
  try {
    console.log(`getHistory called with nickname=${nickname}, personality=${personality}, channelId=${channelId}`);

    // Fetching the last 'numberOfEntries' entries from chat history
    const historyDocs = await ChatHistory.find({
      $or: [
        { requestor: nickname, username: nickname, channelId: channelId },
        { type: "assistant", username: personality, channelId: channelId }
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

    console.log(`Last entries of chat history fetched: ${filteredDocs.length} (filtered from ${historyDocs.length})`);

    // Format and return the chat history
    const formattedHistory = formatChatHistory(filteredDocs);
    console.log("Formatted chat history:", formattedHistory);
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


async function clearUsersHistory(nickname, channelId) {
  try {
    await ChatHistory.deleteMany({
      $or: [
        { username: nickname },
        { requestor: nickname },
        { channelId: channelId }
      ]
    });
  } catch (error) {
    console.error(`Error clearing history for ${nickname} in chatHistory collection:`, error);
    throw error;
  }
}

async function clearAllHistory() {
  try {
    await ChatHistory.deleteMany({});
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