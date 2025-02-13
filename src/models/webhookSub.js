const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WebhookSubSchema = new Schema({
    origin: { type: String },
    channelId: { type: String },
}, { timestamps: true, collection: 'webhookSubs' });

// Create a compound index on username and channelId to ensure their combination is unique
WebhookSubSchema.index({ origin: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('WebhookSub', WebhookSubSchema);