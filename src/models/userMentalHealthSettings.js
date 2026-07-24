const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserMentalHealthSettingsSchema = new Schema({
  userId: { type: String, required: true, unique: true }, // Discord user ID
  username: { type: String, required: true }, // Discord username
  mentalHealthCheckInsEnabled: { type: Boolean, default: false }, // Default to OFF
  cadenceHours: { type: Number, min: 6, max: 168, default: 24 },
  timezone: { type: String, default: 'America/New_York' },
  quietStart: { type: String, default: '22:00' },
  quietEnd: { type: String, default: '08:00' },
  tone: { type: String, enum: ['gentle', 'brief'], default: 'gentle' },
  snoozedUntil: Date,
  lastCheckInAt: Date,
  consentedAt: Date,
}, { timestamps: true, collection: 'userMentalHealthSettings' });

module.exports = mongoose.model('UserMentalHealthSettings', UserMentalHealthSettingsSchema);
