const moment = require("moment");
const ChatHistory = require('../models/chatHistory');
const Roll20Data = require("../models/roll20Data");

const {
  getConfigInformation,
  getUptime,
  getPublicConfig,
} = require("../utils/config");

const { processWebhook } = require("../utils/webhook");

/**
 * Get Bot Status
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.status = async (c) => {
  console.log(
    `[${moment().format("YYYY-MM-DD HH:mm:ss")}] Bot status requested.`
  );
  return c.json({ status: "ok", uptime: getUptime() });
};

/**
 * Get Bot Config
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.config = async (c) => {
  console.log(
    `[${moment().format("YYYY-MM-DD HH:mm:ss")}] Bot config requested.`
  );
  return c.json(getPublicConfig());
};

/**
 * Get Bot Uptime
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.uptime = async (c) => {
  console.log(
    `[${moment().format("YYYY-MM-DD HH:mm:ss")}] Bot uptime requested.`
  );
  return c.text(getUptime());
};

/**
 * Clear Chat History
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.clearChatHistory = async (c) => {
  console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Clear chat history requested.`);

  try {
    const guildId = c.req.query('guildId') || c.req.header('x-guild-id');
    if (!guildId) return c.json({ success: false, message: 'guildId is required.' }, 400);
    const result = await ChatHistory.deleteMany({ guildId });

    console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Chat history cleared successfully.`);
    return c.json({
      success: true,
      message: `Deleted ${result.deletedCount} chat history records.`,
    });
  } catch (err) {
    console.error(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] An error occurred while clearing the chat history:`, err);
    return c.json({
      success: false,
      message: "An error occurred while clearing the chat history.",
    }, 500);
  }
};

/**
 * Get Chat History
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.getChatHistory = async (c) => {
  console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Chat history requested.`);

  try {
    const guildId = c.req.query('guildId') || c.req.header('x-guild-id');
    if (!guildId) return c.json({ success: false, message: 'guildId is required.' }, 400);
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500);
    const skip = Math.max(Number(c.req.query('skip')) || 0, 0);
    const chatHistory = await ChatHistory.find({ guildId }).sort({ _id: -1 }).skip(skip).limit(limit).lean();

    console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Chat history retrieved.`);
    return c.json({
      success: true,
      chatHistory,
    });
  } catch (err) {
    console.error(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] An error occurred while reading the chat history:`, err);
    return c.json({
      success: false,
      message: "An error occurred while reading the chat history.",
    }, 500);
  }
};

/**
 * Upload Roll20 Data
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.uploadRoll20Data = async (c) => {
  console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Roll20 data upload requested.`);
  const type = c.req.param('type');
  const normalizedType = { journal: 'Journal', handouts: 'Handouts' }[String(type).toLowerCase()];
  const guildId = c.req.query('guildId') || c.req.header('x-guild-id');
  if (!normalizedType) return c.json({ success: false, message: "type must be journal or handouts." }, 400);
  if (!guildId) return c.json({ success: false, message: "guildId is required." }, 400);

  try {
    // Get file from form data (Hono handles multipart/form-data)
    const body = await c.req.parseBody();
    const file = body.file;

    // Check if a file was uploaded
    if (!file) {
      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] No file uploaded.`);
      return c.json({
        success: false,
        message: "A file is required.",
      }, 400);
    }

    // Handle file - Hono returns File object for multipart uploads
    let uploadedDataRaw;
    let uploadedFileName;

    if (file instanceof File) {
      const maxBytes = Number(process.env.ROLL20_UPLOAD_MAX_BYTES) || 2 * 1024 * 1024;
      if (file.size > maxBytes) return c.json({ success: false, message: "File is too large." }, 413);
      uploadedFileName = file.name;
      uploadedDataRaw = await file.text();
    } else {
      return c.json({
        success: false,
        message: "Invalid file format.",
      }, 400);
    }

    console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Uploaded file:`, uploadedFileName);

    // Check if the file is a JSON file
    if (!uploadedFileName.endsWith(".json")) {
      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Invalid file type.`);
      return c.json({
        success: false,
        message: "Only JSON files are allowed.",
      }, 400);
    }

    try {
      // Parse uploaded file
      const uploadedData = JSON.parse(uploadedDataRaw);
      if (!Array.isArray(uploadedData) || uploadedData.length > 5000) {
        return c.json({ success: false, message: "JSON must be an array of at most 5,000 entries." }, 400);
      }
      const sanitizedEntries = uploadedData.map(entry => ({
        Name: typeof entry?.Name === 'string' ? entry.Name.trim().slice(0, 300) : '',
        Bio: typeof entry?.Bio === 'string' ? entry.Bio.slice(0, 100000) : '',
      }));
      if (sanitizedEntries.some(entry => !entry.Name)) {
        return c.json({ success: false, message: "Every entry requires a Name string." }, 400);
      }

      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Uploaded data retrieved.`);

      const dedupedEntries = [...new Map(sanitizedEntries.map(entry => [entry.Name, entry])).values()];
      const operations = dedupedEntries.map(entry => ({
        updateOne: {
          filter: { guildId, type: normalizedType, Name: entry.Name },
          update: { $set: { Bio: entry.Bio, guildId, type: normalizedType } },
          upsert: true,
        },
      }));
      const result = operations.length ? await Roll20Data.bulkWrite(operations, { ordered: false }) : null;
      const updateCount = result?.modifiedCount || 0;
      const newEntryCount = result?.upsertedCount || 0;
      let removedCount = 0;
      if (c.req.query('replace') === 'true') {
        const removal = await Roll20Data.deleteMany({
          guildId,
          type: normalizedType,
          Name: { $nin: dedupedEntries.map(entry => entry.Name) },
        });
        removedCount = removal.deletedCount;
      }

      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${updateCount} entries updated, ${newEntryCount} new entries added.`);

      return c.json({
        success: true,
        message: `${updateCount} updated, ${newEntryCount} added, ${removedCount} removed.`,
      });
    } catch (err) {
      console.error(err);
      return c.json({
        success: false,
        message: "An error occurred.",
      }, 500);
    }
  } catch (err) {
    console.error(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] An error occurred while processing the file:`, err);
    return c.json({
      success: false,
      message: "An error occurred while processing the file.",
    }, 500);
  }
};

/**
 * Webhook Handler
 * @param {Context} c - Hono context
 * @returns {Response}
 */
exports.webhookHandler = async (c) => {
  // Process the incoming webhook data here
  const body = await c.req.json();
  await processWebhook(body);
  return c.text('Webhook data received!', 200);
};
