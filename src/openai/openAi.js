const OpenAI = require("openai");

let client;

function getOpenAIClient() {
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}

// Keep imports side-effect free. OpenAI SDK 7 validates credentials when its
// client is constructed, but most unit tests only import modules and never make
// an API request. The application startup validation still fails fast when a
// real runtime is missing OPENAI_API_KEY.
const openai = new Proxy({}, {
    get(_target, property) {
        if (property === 'getClient') return getOpenAIClient;
        const activeClient = getOpenAIClient();
        const value = activeClient[property];
        return typeof value === 'function' ? value.bind(activeClient) : value;
    },
});

module.exports = openai;
