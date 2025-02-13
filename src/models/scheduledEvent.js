const mongoose = require('mongoose');

const ScheduledEventSchema = new mongoose.Schema({
  eventName: String,
  channelId: String,
  frequency: String,
  time: String,
  timezone: String
}, { timestamps: true, collection: 'scheduledEvents' });

const ScheduledEvent = mongoose.model('ScheduledEvent', ScheduledEventSchema);

module.exports = ScheduledEvent;
