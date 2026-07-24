const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Roll20Schema = new Schema({
  Name: { type: String, required: true },
  Bio: { type: String, default: '' },
  type: { type: String, enum: ['Journal', 'Handouts'], required: true, index: true },
  guildId: { type: String, required: true, index: true },
}, { collection: 'roll20Data' });

Roll20Schema.index({ guildId: 1, type: 1, Name: 1 });

module.exports = mongoose.model('Roll20Data', Roll20Schema);
