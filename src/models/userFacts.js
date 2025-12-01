const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserFactSchema = new Schema({
  fact: { type: String, required: true },
  category: { type: String, enum: [
    'preference_like',
    'preference_dislike',
    'bio',
    'pronouns',
    'timezone',
    'game_role',
    'other'
  ], default: 'other' },
  sourceMessageId: { type: String },
  confidence: { type: Number, default: 0.8 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const UserFactsSchema = new Schema({
  userId: { type: String, required: true },
  username: { type: String, required: true },
  serverId: { type: String, required: true },
  enabled: { type: Boolean, default: true }, // per-user per-server opt-out
  facts: { type: [UserFactSchema], default: [] }
}, { timestamps: true, collection: 'userFacts' });

UserFactsSchema.index({ userId: 1, serverId: 1 }, { unique: true });

module.exports = mongoose.model('UserFacts', UserFactsSchema);



