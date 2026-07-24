const Roll20Data = require("../models/roll20Data");
const crypto = require("crypto");

function safeEqual(provided, expected) {
    if (!provided || !expected) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractCredential(header = '') {
    return header.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Error handler middleware for Hono
 * @param {Error} err 
 * @param {Context} c 
 * @returns {Response}
 */
exports.errorHandler = function (err, c) {
    console.error(err.stack);
    return c.json({ error: 'Something went wrong' }, 500);
};

/**
 * Authentication middleware for Hono
 * @param {Context} c 
 * @param {Function} next 
 * @returns {Promise<Response|void>}
 */
exports.authMiddleware = async (c, next) => {
    const credential = extractCredential(c.req.header('authorization'));
    const apiKey = process.env.API_KEY;

    if (!safeEqual(credential, apiKey)) {
        return c.json({
            message: 'Unauthorized'
        }, 401);
    }

    await next();
};

exports.webhookAuthMiddleware = async (c, next) => {
    const credential = extractCredential(c.req.header('authorization')) || c.req.header('x-webhook-key');
    const webhookKey = process.env.WEBHOOK_KEY || process.env.API_KEY;
    if (!safeEqual(credential, webhookKey)) return c.json({ message: 'Unauthorized' }, 401);
    await next();
};

/**
 * Get current Journal handler
 * @param {Context} c 
 * @returns {Promise<Response>}
 */
exports.getCurrentJournal = async (c) => {
    return getCurrentRoll20Data('Journal', c);
};

/**
 * Get current Handouts handler
 * @param {Context} c 
 * @returns {Promise<Response>}
 */
exports.getCurrentHandouts = async (c) => {
    return getCurrentRoll20Data('Handouts', c);
};

/**
 * Helper function to get current Roll20 data
 * @param {string} type 
 * @param {Context} c 
 * @returns {Promise<Response>}
 */
async function getCurrentRoll20Data(type, c) {
    try {
        const guildId = c.req.query('guildId') || c.req.header('x-guild-id');
        if (!guildId) return c.json({ success: false, message: 'guildId is required.' }, 400);
        const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500);
        const skip = Math.max(Number(c.req.query('skip')) || 0, 0);
        const data = await Roll20Data.find({ guildId, type }).sort({ Name: 1 }).skip(skip).limit(limit).lean();

        if (!data || data.length === 0) {
            return c.json({
                success: false,
                message: `No data found in the database.`
            }, 404);
        }

        return c.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error(err);
        return c.json({
            success: false,
            message: 'An error occurred.'
        }, 500);
    }
}

exports._safeEqual = safeEqual;
