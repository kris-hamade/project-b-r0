const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChannelResponseModeSchema = new Schema({
  channelId: { type: String, required: true, unique: true },
  guildId: { type: String, index: true },
  respondWithoutMention: { type: Boolean, default: false }, // Off by default
  mode: { type: String, enum: ['mention', 'smart', 'always'], default: 'mention' },
  cooldownSeconds: { type: Number, min: 0, max: 3600, default: 15 },
  confidenceThreshold: { type: Number, min: 0, max: 1, default: 0.7 },
  updatedBy: String,
}, { timestamps: true, collection: 'channelResponseModes' });

module.exports = mongoose.model('ChannelResponseMode', ChannelResponseModeSchema);

