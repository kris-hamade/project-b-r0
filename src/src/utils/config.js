require("dotenv").config();
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
    let globalGptModel = process.env.GLOBAL_GPT_MODEL || "gpt-4o-mini";
    return globalGptModel;
}

function getModelTemperatures() {
    // Convert CHAT_OUTPUT_TEMPERATURE to a float or default to 0.6 if undefined or not a number
    let modelTemperatures = {
        chat_output_temperature: parseFloat(process.env.CHAT_OUTPUT_TEMPERATURE) || 0.6,
    };
    return modelTemperatures;
}

function getTokenLimits() {
    // Convert each TOKEN limit to an integer, returns NaN if not convertible, hence OR 0 or any default if required
    let tokenLimits = {
        chat_input_limit: parseInt(process.env.TOKEN_INPUT_LIMIT, 10),
        chat_output_limit: parseInt(process.env.TOKEN_OUTPUT_LIMIT, 10) || 1000,
        image_analysis_limit: parseInt(process.env.TOKEN_IMAGE_ANALYSIS_LIMIT, 10) || 1000,
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
    let allowedModels = process.env.ALLOWED_USER_GPT_MODELS ? process.env.ALLOWED_USER_GPT_MODELS.split(",") : [];
    return allowedModels;

}

function getVersion() {
    let version = process.env.VERSION || "0.0.0";
    // Sets the version of the bot
    console.log(`Version: ${version}`);
    return version;
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
    getUserAllowedModels
};