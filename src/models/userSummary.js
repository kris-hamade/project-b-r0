const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSummarySchema = new Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  serverId: { type: String, required: true },
  summary: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'userSummaries' });

UserSummarySchema.index({ userId: 1, serverId: 1 }, { unique: true });

module.exports = mongoose.model('UserSummary', UserSummarySchema);



