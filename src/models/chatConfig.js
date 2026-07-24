const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatConfigSchema = new Schema({
  userId: { type: String },
  guildId: { type: String },
  username: { type: String, required: true },
  currentPersonality: { type: String, default: "assistant" },
  model: { type: String, default: "gpt-5.6-terra" },
  temperature: { type: Number, default: 1 },
  channelID: { type: String, required: true },
  // Mental health check-in fields
  needsMentalHealthCheckIn: { type: Boolean, default: false },
  mentalHealthCheckInDate: { type: Date }, // When the flag was set
  lastCheckInAttempt: { type: Date }, // When we last attempted to check in
}, { timestamps: true, collection: 'chatConfig' });

// Create a compound index on username and channelID to ensure their combination is unique
ChatConfigSchema.index({ username: 1, channelID: 1 }, { unique: true });
ChatConfigSchema.index({ userId: 1, channelID: 1 });

module.exports = mongoose.model('ChatConfig', ChatConfigSchema);
