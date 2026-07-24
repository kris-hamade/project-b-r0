require("dotenv").config({ quiet: true });
const moment = require('moment');

// Start tracking bot uptime
const startTime = moment();

function getCharacterLimit() {
    // Convert CHARACTER_LIMIT to an integer or default to 96000 if undefined or not a number
    let characterLimit = parseInt(process.env.CHARACTER_LIMIT, 10) || 96000;

    // Estimate token count, if you intend to use this, assign to a variable or return
    characterLimit * 4;

    return characterLimit;
}

function getGlobalGptModel() {
    // Convert GLOBAL_GPT_MODEL to a string or default to an empty string if undefined
    const deprecated = new Set(["gpt-5-chat-latest", "gpt-4o", "gpt-4o-mini", "gpt-4", "gpt-3.5-turbo"]);
    let globalGptModel = process.env.GLOBAL_GPT_MODEL || "gpt-5.6-terra";
    if (deprecated.has(globalGptModel)) globalGptModel = "gpt-5.6-terra";
    return globalGptModel;
}

function getModelTemperatures() {
    // Convert CHAT_OUTPUT_TEMPERATURE to a float or default to 0.6 if undefined or not a number
    let modelTemperatures = {
        chat_output_temperature: parseNumber(process.env.CHAT_OUTPUT_TEMPERATURE, 0.6),
    };
    return modelTemperatures;
}

function getTokenLimits() {
    // Convert each TOKEN limit to an integer, returns NaN if not convertible, hence OR 0 or any default if required
    let tokenLimits = {
        chat_input_limit: parseInteger(process.env.TOKEN_INPUT_LIMIT, 12000),
        chat_output_limit: parseInteger(process.env.TOKEN_OUTPUT_LIMIT, 1200),
        image_analysis_limit: parseInteger(process.env.TOKEN_IMAGE_ANALYSIS_LIMIT, 1000),
    };
    return tokenLimits;
}

function getUptime() {
    const now = moment();
    const duration = moment.duration(now.diff(startTime));
    return duration.humanize();
}

function getUserAllowedModels() {
    // Convert ALLOWED_MODELS to an array of strings or default to an empty array if undefined
    const deprecated = new Set(["gpt-5-chat-latest", "gpt-4o", "gpt-4o-mini", "gpt-4", "gpt-3.5-turbo"]);
    let allowedModels = process.env.ALLOWED_USER_GPT_MODELS
        ? process.env.ALLOWED_USER_GPT_MODELS.split(",").map(model => model.trim()).filter(Boolean)
        : ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
    allowedModels = allowedModels.filter(model => !deprecated.has(model));
    if (process.env.STRICT_ALLOWED_MODELS !== "true") {
        allowedModels = [...new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", ...allowedModels])];
    }
    if (!allowedModels.length) allowedModels = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
    return allowedModels;
}

function getClassifierConfidenceThreshold() {
    // Convert CLASSIFIER_CONFIDENCE_THRESHOLD to a float or default to 0.7
    let threshold = parseNumber(process.env.CLASSIFIER_CONFIDENCE_THRESHOLD, 0.7);
    return threshold;
}

function getClassifierApiUrl() {
    // If full URL is provided, use it
    if (process.env.CLASSIFIER_API_URL) {
        return process.env.CLASSIFIER_API_URL;
    }
    
    // Otherwise, construct from host and port
    const host = process.env.CLASSIFIER_API_HOST || 'localhost';
    const port = process.env.CLASSIFIER_API_PORT || '8000';
    const protocol = process.env.CLASSIFIER_API_PROTOCOL || 'http';
    
    return `${protocol}://${host}:${port}`;
}

function getClassifierTimeout() {
    // Convert CLASSIFIER_TIMEOUT to an integer or default to 5000ms
    let timeout = parseInteger(process.env.CLASSIFIER_TIMEOUT, 5000);
    return timeout;
}

function getWebSearchModel() {
    // Get the configured web search model, or return null to use auto-mapping
    return process.env.WEB_SEARCH_MODEL || null;
}

function getVersion() {
    let version = process.env.VERSION || "0.0.0";
    // Sets the version of the bot
    console.log(`Version: ${version}`);
    return version;
}

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDiscordToken({ testing = process.env.NODE_ENV !== "production" } = {}) {
    if (testing && process.env.DISCORD_TESTING_TOKEN) {
        return process.env.DISCORD_TESTING_TOKEN;
    }
    return process.env.DISCORD_TOKEN_PROD || process.env.DISCORD_TOKEN;
}

function isMemoryEnabledByDefault() {
    return process.env.MEMORY_DEFAULT_ENABLED === "true";
}

function getPublicConfig() {
    return {
        version: process.env.VERSION || "0.0.0",
        uptime: getUptime(),
        model: getGlobalGptModel(),
        memoryDefaultEnabled: isMemoryEnabledByDefault(),
        webSearchEnabled: process.env.WEB_SEARCH_ENABLED === "true",
    };
}

function validateEnvironment() {
    const required = ["MONGODB_URI", "OPENAI_API_KEY"];
    const missing = required.filter(name => !process.env[name]);
    if (!getDiscordToken()) missing.push("DISCORD_TESTING_TOKEN or DISCORD_TOKEN");
    if (missing.length) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (process.env.NODE_ENV === "production" && !process.env.API_KEY) {
        throw new Error("API_KEY is required in production");
    }
}

function getConfigInformation(model, temperature) {
    let modelInformation = model !== "" ? `Model: ${model}` : "";
    let temperatureInformation = temperature !== "" ? `Temperature: ${temperature}` : "";

    return `Version: ${getVersion()}
  Character Limit: ${getCharacterLimit()}
  ${modelInformation}
  ${temperatureInformation}
  Start Time: ${startTime.format('YYYY-MM-DD HH:mm:ss')}
  Uptime: ${getUptime()}`;
}


module.exports = {
    getCharacterLimit,
    getConfigInformation,
    getGlobalGptModel,
    getModelTemperatures,
    getTokenLimits,
    getUptime,
    getUserAllowedModels,
    getClassifierConfidenceThreshold,
    getClassifierApiUrl,
    getClassifierTimeout,
    getWebSearchModel,
    getDiscordToken,
    getPublicConfig,
    isMemoryEnabledByDefault,
    validateEnvironment,
};
