const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChannelCheckInSchema = new Schema({
  channelId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  inactivityDays: { type: Number, default: 1 }, // Days of inactivity before check-in
  checkInTime: { type: String, default: '14:00' }, // Time of day to check (HH:mm format)
  timezone: { type: String, default: 'America/New_York' }, // IANA timezone
  lastCheckIn: { type: Date }, // Track last check-in to avoid duplicates
  minMessagesPerDay: { type: Number, default: 5 }, // Minimum messages per day to be considered "active"
}, { timestamps: true, collection: 'channelCheckIns' });

ChannelCheckInSchema.index({ channelId: 1 }, { unique: true });

module.exports = mongoose.model('ChannelCheckIn', ChannelCheckInSchema);

