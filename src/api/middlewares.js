const Roll20Data = require("../models/roll20Data");

const API_KEY = process.env.API_KEY;

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
    const authHeader = c.req.header('authorization');

    if (!authHeader || authHeader !== API_KEY) {
        return c.json({
            message: 'Unauthorized'
        }, 401);
    }

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
        // Query MongoDB
        const data = await Roll20Data.find({}).lean();

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
