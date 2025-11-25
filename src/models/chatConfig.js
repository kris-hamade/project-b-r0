const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatConfigSchema = new Schema({
  username: { type: String, required: true },
  currentPersonality: { type: String, default: "assistant" },
  model: { type: String, default: "gpt-5-chat-latest" },
  temperature: { type: Number, default: 1 },
  channelID: { type: String, required: true },
  // Mental health check-in fields
  needsMentalHealthCheckIn: { type: Boolean, default: false },
  mentalHealthCheckInDate: { type: Date }, // When the flag was set
  lastCheckInAttempt: { type: Date }, // When we last attempted to check in
  userId: { type: String }, // Discord user ID for DM check-ins
}, { timestamps: true, collection: 'chatConfig' });

// Create a compound index on username and channelID to ensure their combination is unique
ChatConfigSchema.index({ username: 1, channelID: 1 }, { unique: true });

module.exports = mongoose.model('ChatConfig', ChatConfigSchema);