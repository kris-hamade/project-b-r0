const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatConfigSchema = new Schema({
  username: { type: String, required: true },
  currentPersonality: { type: String, default: "b-r0" },
  model: { type: String, default: "gpt-4o" },
  temperature: { type: Number, default: 1 },
  channelID: { type: String, required: true },
}, { timestamps: true, collection: 'chatConfig' });

// Create a compound index on username and channelID to ensure their combination is unique
ChatConfigSchema.index({ username: 1, channelID: 1 }, { unique: true });

module.exports = mongoose.model('ChatConfig', ChatConfigSchema);