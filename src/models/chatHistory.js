const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const chatHistorySchema = new Schema({
  userId: String,
  guildId: String,
  type: String,
  username: String,
  content: String,
  image_url: String,
  requestor: String,
  timestamp: String,
  channelId: String,
}, { collection: 'chatHistory' });

chatHistorySchema.index({ requestor: 1, channelId: 1 }, { unique: false });
chatHistorySchema.index({ userId: 1, guildId: 1, channelId: 1, _id: -1 });

const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

module.exports = ChatHistory;
