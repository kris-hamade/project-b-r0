const controller = require('./controllers');
const { authMiddleware, getCurrentJournal, getCurrentHandouts } = require('./middlewares');

/**
 * @typedef {Object} RouteDefinition
 * @property {string} endpoint - URL path pattern (supports :param syntax)
 * @property {'GET'|'POST'|'PUT'|'DELETE'|'PATCH'} method - HTTP method
 * @property {Function} handler - Controller function (c) => {}
 * @property {boolean} [requiresAuth=false] - Whether API key auth is required
 * @property {string} [description] - Route description for documentation
 */

/**
 * Route definitions array
 * @type {RouteDefinition[]}
 */
const routeDefinitions = [
    // Health & Status
    { 
        endpoint: '/status', 
        method: 'GET', 
        handler: controller.status,
        description: 'Get the current status of the bot'
    },
    { 
        endpoint: '/config', 
        method: 'GET', 
        handler: controller.config,
        description: 'Get the bot configuration'
    },
    { 
        endpoint: '/uptime', 
        method: 'GET', 
        handler: controller.uptime,
        description: 'Get bot uptime'
    },

    // Chat History
    { 
        endpoint: '/chathistory', 
        method: 'GET', 
        handler: controller.getChatHistory,
        requiresAuth: true,
        description: 'Get chat history'
    },
    { 
        endpoint: '/clearChatHistory', 
        method: 'DELETE', 
        handler: controller.clearChatHistory,
        requiresAuth: true,
        description: 'Clear chat history'
    },

    // Roll20 Data
    { 
        endpoint: '/currentJournal', 
        method: 'GET', 
        handler: getCurrentJournal,
        description: 'Get Roll20 Journal Records'
    },
    { 
        endpoint: '/currentHandouts', 
        method: 'GET', 
        handler: getCurrentHandouts,
        description: 'Get Roll20 Handout Records'
    },
    { 
        endpoint: '/uploadRoll20Data/:type', 
        method: 'POST', 
        handler: controller.uploadRoll20Data,
        requiresAuth: true,
        description: 'Upload Roll20 data'
    },

    // Webhooks
    { 
        endpoint: '/webhook', 
        method: 'POST', 
        handler: controller.webhookHandler,
        requiresAuth: true,
        description: 'Webhook handler'
    },
];

/**
 * Validates route definition structure
 * @param {RouteDefinition} route 
 * @throws {Error} If route is invalid
 */
function validateRoute(route) {
    if (!route.endpoint || typeof route.endpoint !== 'string') {
        throw new Error('Route must have a string endpoint');
    }
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method)) {
        throw new Error(`Invalid HTTP method: ${route.method}`);
    }
    if (typeof route.handler !== 'function') {
        throw new Error('Route handler must be a function');
    }
}

// Validate all routes at startup
routeDefinitions.forEach((route, index) => {
    try {
        validateRoute(route);
    } catch (error) {
        throw new Error(`Invalid route at index ${index}: ${error.message}`);
    }
});

/**
 * Get available endpoints for 404 responses
 * @returns {string[]}
 */
function getAvailableEndpoints() {
    return routeDefinitions.map(route => `${route.method} ${route.endpoint}`);
}

module.exports = {
    routeDefinitions,
    getAvailableEndpoints,
    setAuthMiddleware: (middleware) => {
        // This allows setting auth middleware if needed
        authMiddleware.set = middleware;
    }
};
