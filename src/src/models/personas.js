const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PersonaSchema = new Schema({
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ['wow', 'dnd'] },
    description: { type: String },
    mannerisms: { type: String },
    sayings: [{ type: String }],
    generated_phrases: [{ type: String }],
}, { timestamps: true, collection: 'personas' });

module.exports = mongoose.model('Personas', PersonaSchema);
