const crypto = require('crypto');

/**
 * API-based entropy engine for cryptographically secure random number generation
 * Uses the entropy API at https://pg.hamy.app/v1/entropy/uint32
 */
class ApiEntropyEngine {
  constructor(apiBaseUrl, batchSize = 2048) {
    this.apiBaseUrl = apiBaseUrl;
    this.batchSize = batchSize;
    this.buffer = [];
    this.fetching = null;
  }

  /**
   * Fills the buffer with entropy from the API
   * @returns {Promise<void>}
   */
  async fillBuffer() {
    if (this.fetching) return this.fetching;

    this.fetching = (async () => {
      try {
        const url = `${this.apiBaseUrl}/v1/entropy/uint32?count=${this.batchSize}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const json = await response.json();
        
        if (!json.numbers || !Array.isArray(json.numbers)) {
          throw new Error('Invalid response format from entropy API');
        }

        for (const n of json.numbers) {
          this.buffer.push(n >>> 0); // Ensure uint32
        }
        
        console.log(`[EntropyEngine] Fetched ${json.numbers.length} entropy values from API`);
      } catch (error) {
        console.error('[EntropyEngine] Entropy fetch failed:', error.message);
        // Fallback: fill buffer with crypto.getRandomValues
        const fallbackValues = new Uint32Array(Math.min(100, this.batchSize));
        crypto.getRandomValues(fallbackValues);
        for (const n of fallbackValues) {
          this.buffer.push(n >>> 0);
        }
        console.log(`[EntropyEngine] Using fallback entropy (${fallbackValues.length} values)`);
      } finally {
        this.fetching = null;
      }
    })();

    return this.fetching;
  }

  /**
   * Gets the next uint32 value from the buffer
   * Automatically refills buffer when low
   * @returns {number} A 32-bit unsigned integer
   */
  next() {
    if (this.buffer.length === 0) {
      // Start async fetch but don't wait
      void this.fillBuffer();
      // Fallback while waiting
      const fallback = new Uint32Array(1);
      crypto.getRandomValues(fallback);
      return fallback[0] >>> 0;
    }

    const value = this.buffer.shift();

    // Prefetch when buffer is low (at 25% capacity)
    if (this.buffer.length < this.batchSize / 4) {
      void this.fillBuffer();
    }

    return value >>> 0;
  }

  /**
   * Gets a random number between 0 (inclusive) and 1 (exclusive)
   * Compatible with Math.random() interface
   * @returns {number} A number between 0 and 1
   */
  random() {
    const uint32 = this.next();
    // Convert uint32 to float in [0, 1)
    // Divide by 2^32 to get a value in [0, 1)
    return uint32 / 4294967296.0;
  }

  /**
   * Gets a random integer between min (inclusive) and max (exclusive)
   * @param {number} min - Minimum value (inclusive)
   * @param {number} max - Maximum value (exclusive)
   * @returns {number} A random integer
   */
  randomInt(min, max) {
    const range = max - min;
    const uint32 = this.next();
    return min + Math.floor((uint32 / 4294967296.0) * range);
  }
}

// Create a singleton instance
let entropyEngine = null;

/**
 * Initialize the entropy engine
 * @param {string} apiBaseUrl - Base URL for the entropy API
 * @param {number} batchSize - Number of entropy values to fetch per batch
 * @returns {ApiEntropyEngine}
 */
function initEntropyEngine(apiBaseUrl = 'https://pg.hamy.app', batchSize = 2048) {
  if (!entropyEngine) {
    entropyEngine = new ApiEntropyEngine(apiBaseUrl, batchSize);
    // Pre-fill the buffer on initialization
    void entropyEngine.fillBuffer();
  }
  return entropyEngine;
}

/**
 * Get the entropy engine instance
 * @returns {ApiEntropyEngine}
 */
function getEntropyEngine() {
  if (!entropyEngine) {
    // Initialize with default values if not already initialized
    return initEntropyEngine();
  }
  return entropyEngine;
}

/**
 * Creates a random number generator function compatible with dice-roller library
 * Returns a function that generates numbers between 0 and 1 (exclusive)
 * @returns {function(): number}
 */
function createDiceRng() {
  const engine = getEntropyEngine();
  return () => engine.random();
}

module.exports = {
  ApiEntropyEngine,
  initEntropyEngine,
  getEntropyEngine,
  createDiceRng,
};

