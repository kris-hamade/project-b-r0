const mongoose = require('mongoose');

const ScheduledEventSchema = new mongoose.Schema({
  eventName: String,
  channelId: String,
  guildId: { type: String, index: true },
  creatorId: String,
  frequency: String,
  time: String,
  timezone: { type: String, default: 'America/New_York' },
  startsAt: Date,
  recurrence: { type: String, enum: ['once', 'daily', 'weekly', 'biweekly', 'monthly'], default: 'once' },
  reminderMinutes: { type: [Number], default: [1440, 60] },
  status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' },
  lastOccurrenceAt: Date
}, { timestamps: true, collection: 'scheduledEvents' });

ScheduledEventSchema.index({ guildId: 1, eventName: 1 });

const ScheduledEvent = mongoose.model('ScheduledEvent', ScheduledEventSchema);

module.exports = ScheduledEvent;
