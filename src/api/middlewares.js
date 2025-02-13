const Roll20Data = require("../models/roll20Data");

const API_KEY = process.env.API_KEY;

exports.errorHandler = function (err, req, res, next) {
    console.error(err.stack);
    res.status(500).send('Something went wrong');
};

exports.authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader !== API_KEY) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    next();
};

// Get current Journal /api/currentJournal
exports.getCurrentJournal = async (req, res) => {
    getCurrentRoll20Data('Journal', req, res);
};

// Get current Handouts /api/currentHandouts
exports.getCurrentHandouts = async (req, res) => {
    getCurrentRoll20Data('Handouts', req, res);
};

// Helper function to get current Roll20 data
async function getCurrentRoll20Data(type, req, res) {
    try {
        // Query MongoDB
        const data = await Roll20Data.find({}).lean();

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No data found in the database.`
            });
        }

        res.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'An error occurred.'
        });
    }
}