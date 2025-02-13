const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authMiddleware, getCurrentJournal, getCurrentHandouts, verifyWebhookSecret } = require('./middlewares');

// GET Endpoints
// Check Bot Status, no API key required
/**
 * @swagger
 * /api/status:
 *   get:
 *     summary: Get the current status of the bot
 *     description: Returns a message indicating that the bot is up and running.
 *     responses:
 *       200:
 *         description: Success message indicating the bot is active.
 */
router.get('/status', controller.status);

// Check Bot Config, no API key required
/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get the bot configuration
 *     description: Retrieves the current configuration settings of the bot.
 *     responses:
 *       200:
 *         description: A JSON object containing the bot configuration settings.
 */
router.get('/config', controller.config);

// Check Bot Uptime, no API key required
/**
 * @swagger
 * /api/uptime:
 *   get:
 *     summary: Get bot uptime
 *     description: Retrieves the duration for which the bot has been running.
 *     responses:
 *       200:
 *         description: A message indicating how long the bot has been up.
 */
router.get('/uptime', controller.uptime);

// Get Chat History, API key required
/**
 * @swagger
 * /api/chatHistory:
 *   get:
 *     summary: Get chat history
 *     description: Retrieves the entire chat history.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: A JSON array containing chat history records.
 *       500:
 *         description: Error message in case of a server error.
 */
router.get('/chathistory', authMiddleware, controller.getChatHistory);

// Get current Journal, no API key required
/**
 * @swagger
 * /api/currentJournal:
 *   get:
 *     summary: Get Roll20 Journal Records
 *     description: Retrieves all roll20 journal records.
 *     responses:
 *       200:
 *         description: A JSON array containing roll20 journal records.
 *       500:
 *         description: Error message in case of a server error.
 */
router.get('/currentJournal', getCurrentJournal);

// Get current Handouts, no API key required
/**
 * @swagger
 * /api/currentHandouts:
 *   get:
 *     summary: Get Roll20 Handout Records
 *     description: Retrieves all roll20 handouts records.
 *     responses:
 *       200:
 *         description: A JSON array containing roll20 handouts records.
 *       500:
 *         description: Error message in case of a server error.
 */
router.get('/currentHandouts', getCurrentHandouts);

// POST Endpoints
// Endpoint to replace Roll20 JSON Data, API key required
/**
 * @swagger
 * /api/uploadRoll20Data:
 *   post:
 *     summary: Upload Roll20 data
 *     description: Allows uploading of Roll20 data in JSON format. The data is used to update existing entries or add new ones.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 description: Path of the file to upload.
 *     responses:
 *       200:
 *         description: Success message with details of the update and new entries added.
 *       400:
 *         description: Error message indicating a bad request, such as missing file or wrong file format.
 *       500:
 *         description: Error message in case of a server error.
 */
router.post('/uploadRoll20Data/:type', authMiddleware, controller.uploadRoll20Data);

// Webhook endpoint
/**
 * @swagger
 * /api/webhook:
 *   post:
 *     summary: Webhook handler
 *     description: Endpoint for handling incoming webhook data.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payload:
 *                 type: string
 *                 description: Webhook payload data.
 *     responses:
 *       200:
 *         description: Acknowledgment message indicating that webhook data is received.
 */
router.post('/webhook', authMiddleware, controller.webhookHandler);

// Delete Endpoints
// Clear chat history, API key required
/**
 * @swagger
 * /api/clearChatHistory:
 *   delete:
 *     summary: Clear chat history
 *     description: Clears the chat history from the database.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success message indicating the chat history has been cleared.
 *       500:
 *         description: Error message in case of a server error.
 */
router.delete('/clearChatHistory', authMiddleware, controller.clearChatHistory);

module.exports = router;