const mongoose = require('mongoose');

const SirModeConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  textChannelId: { type: String, required: true },
  voiceChannelId: { type: String, required: true },
  requiredUserIds: { type: [String], default: [] },
  active: { type: Boolean, default: false },
  startsAt: Date,
  intervalMinutes: { type: Number, min: 1, max: 60, default: 5 },
  maxReminders: { type: Number, min: 1, max: 20, default: 3 },
  remindersSent: { type: Number, default: 0 },
  message: { type: String, maxlength: 300, default: 'SIR! Game time—please join the voice channel.' },
  updatedBy: String,
}, { timestamps: true, collection: 'sirModeConfigs' });

module.exports = mongoose.model('SirModeConfig', SirModeConfigSchema);
