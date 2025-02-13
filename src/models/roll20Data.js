const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Roll20Schema = new Schema({
  Name: String,
  Bio: String,
}, { collection: 'roll20Data' });

module.exports = mongoose.model('Roll20Data', Roll20Schema);
