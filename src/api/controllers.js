const moment = require("moment");
const ChatHistory = require('../models/chatHistory');
const Roll20Data = require("../models/roll20Data");
const fs = require('fs').promises;

const {
  getConfigInformation,
  getUptime,
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
  return c.text("Bot is up and running");
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
  return c.json(getConfigInformation());
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
    // Remove all documents from the ChatHistory collection
    await ChatHistory.deleteMany({});

    console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Chat history cleared successfully.`);
    return c.json({
      success: true,
      message: "Chat history cleared successfully.",
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
    // Get all documents from the ChatHistory collection
    const chatHistory = await ChatHistory.find({});

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
      uploadedFileName = file.name;
      uploadedDataRaw = await file.text();
    } else if (typeof file === 'string') {
      // If it's a file path (from multer or similar)
      uploadedFileName = file;
      uploadedDataRaw = await fs.readFile(file, 'utf-8');
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

    // If the uploaded file is named 'test.json', don't make any modifications
    if (uploadedFileName === "test.json") {
      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Test upload succeeded.`);
      return c.json({
        success: true,
        message: "Test Upload Succeeded.",
      });
    }

    try {
      // Parse uploaded file
      const uploadedData = JSON.parse(uploadedDataRaw);

      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] Uploaded data retrieved.`);

      let updateCount = 0;
      let newEntryCount = 0;

      // Get all existing documents
      const existingDocs = await Roll20Data.find({});
      const existingDocsMap = new Map();
      existingDocs.forEach(doc => existingDocsMap.set(doc.Name, doc));

      // Compare and update data
      for (const uploadedEntry of uploadedData) {
        const existingDoc = existingDocsMap.get(uploadedEntry.Name);
        if (existingDoc) {
          // If the Name exists in the server data, update the Bio if necessary
          if (uploadedEntry.Bio !== existingDoc.Bio) {
            existingDoc.Bio = uploadedEntry.Bio;
            await existingDoc.save();
            updateCount++;
          }
        } else {
          // If the Name doesn't exist in the server data, add the new entry
          const newDoc = new Roll20Data(uploadedEntry);
          await newDoc.save();
          newEntryCount++;
        }
      }

      console.log(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${updateCount} entries updated, ${newEntryCount} new entries added.`);

      return c.json({
        success: true,
        message: `${updateCount} entries updated, ${newEntryCount} new entries added.`,
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
  processWebhook(body);
  return c.text('Webhook data received!', 200);
};
