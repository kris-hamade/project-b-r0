const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HaggleStatsSchema = new Schema({
    haggleDeaths: { type: Number },
    moneySpent: { type: Number },
}, { timestamps: true, collection: 'haggleStats' });

module.exports = mongoose.model('HaggleStats', HaggleStatsSchema);
