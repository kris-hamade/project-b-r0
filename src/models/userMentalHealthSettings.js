const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserMentalHealthSettingsSchema = new Schema({
  userId: { type: String, required: true, unique: true }, // Discord user ID
  username: { type: String, required: true }, // Discord username
  mentalHealthCheckInsEnabled: { type: Boolean, default: false }, // Default to OFF
}, { timestamps: true, collection: 'userMentalHealthSettings' });

UserMentalHealthSettingsSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('UserMentalHealthSettings', UserMentalHealthSettingsSchema);
