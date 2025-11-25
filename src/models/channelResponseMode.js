const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChannelResponseModeSchema = new Schema({
  channelId: { type: String, required: true, unique: true },
  respondWithoutMention: { type: Boolean, default: false }, // Off by default
}, { timestamps: true, collection: 'channelResponseModes' });

ChannelResponseModeSchema.index({ channelId: 1 }, { unique: true });

module.exports = mongoose.model('ChannelResponseMode', ChannelResponseModeSchema);

