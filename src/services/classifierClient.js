// Use built-in fetch (available in Node 18+)
// If running on older Node, this will need to be polyfilled
const fetch = globalThis.fetch;

/**
 * Classifier API client for calling the classifier microservice
 * The classifier is a separate HTTP service that uses heuristics to classify messages
 */

const CLASSIFIER_API_URL = process.env.CLASSIFIER_API_URL || 'http://localhost:8000';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT, 10) || 5000; // 5 seconds default

/**
 * Classify a message using the classifier API
 * @param {Object} payload - Classification request payload
 * @param {string} payload.message - The message text to classify (required)
 * @param {string[]} [payload.recentMessages] - Array of recent messages for context
 * @param {string} [payload.channelName] - Discord channel name
 * @returns {Promise<Object>} Classification response
 * @throws {Error} If the classifier API call fails
 */
async function classifyMessage(payload) {
  if (!payload || !payload.message) {
    throw new Error('Message is required for classification');
  }

  const url = `${CLASSIFIER_API_URL}/classify`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: payload.message,
        recentMessages: payload.recentMessages || [],
        channelName: payload.channelName || 'unknown',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Classifier API returned ${response.status}: ${errorText || response.statusText}`
      );
    }

    const classification = await response.json();

    // Validate response structure
    if (
      typeof classification.shouldRespond !== 'boolean' ||
      typeof classification.confidence !== 'number' ||
      typeof classification.isQuestion !== 'boolean' ||
      !['dnd', 'tech', 'gaming', 'other'].includes(classification.topic) ||
      !['low', 'medium', 'high'].includes(classification.sensitivity) ||
      typeof classification.reason !== 'string'
    ) {
      throw new Error('Invalid classifier response format');
    }

    return classification;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Classifier API timeout after ${CLASSIFIER_TIMEOUT}ms`);
    }
    if (error.message.includes('Classifier API')) {
      throw error;
    }
    throw new Error(`Failed to call classifier API: ${error.message}`);
  }
}

/**
 * Check if the classifier service is healthy
 * @returns {Promise<boolean>} True if healthy, false otherwise
 */
async function checkClassifierHealth() {
  try {
    const url = `${CLASSIFIER_API_URL}/healthz`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('[ClassifierClient] Health check failed:', error.message);
    return false;
  }
}

module.exports = {
  classifyMessage,
  checkClassifierHealth,
};

