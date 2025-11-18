require("dotenv").config();
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const { sentryLogging } = require("./src/sentry/sentry");  // Sentry initialization function

// Initialize Sentry with Tracing
sentryLogging();

const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const { routeDefinitions, getAvailableEndpoints } = require("./src/api/routes");
const { authMiddleware, errorHandler } = require("./src/api/middlewares");
const { connectDB } = require("./src/utils/db");
const { start: bot } = require("./src/discord/bot");
const { loadWebhookSubs } = require('./src/utils/webhook');
const { swaggerUi, swaggerSpec } = require('./src/api/swagger');

const app = new Hono();

// Sentry request handler middleware
app.use('*', async (c, next) => {
  try {
    await next();
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }
});

// JSON middleware
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    try {
      const contentType = c.req.header('content-type') || '';
      if (contentType.includes('application/json')) {
        // Hono automatically parses JSON, but we can ensure it's available
        await next();
      } else {
        await next();
      }
    } catch (error) {
      await next();
    }
  } else {
    await next();
  }
});

// Register routes from routeDefinitions with /api prefix
routeDefinitions.forEach(route => {
  // Register the route with Hono
  const method = route.method.toLowerCase();
  const fullPath = `/api${route.endpoint}`;
  
  if (route.requiresAuth) {
    // Route with authentication
    app[method](fullPath, authMiddleware, route.handler);
  } else {
    // Route without authentication
    app[method](fullPath, route.handler);
  }
});

// Swagger UI endpoint (using Express-compatible setup for now)
// Note: You may want to use @hono/swagger-ui for better Hono integration
app.get('/api-docs', async (c) => {
  // For now, redirect to a simple JSON response
  // You can integrate @hono/swagger-ui later if needed
  return c.json(swaggerSpec);
});

// 404 handler
app.notFound((c) => {
  const availableEndpoints = getAvailableEndpoints();
  return c.json({
    error: 'Not Found',
    message: `Endpoint not found. Available endpoints: ${availableEndpoints.join(', ')}`
  }, 404);
});

// Error handler
app.onError((err, c) => {
  return errorHandler(err, c);
});

// Connect to the database
(async () => {
  try {
    await connectDB();

    // Load Webhook Subscriptions from Database
    await loadWebhookSubs().catch(err => {
      console.error(`Failed to load webhook subscriptions: ${err}`);
    });

    console.log('Successfully connected to Database');
  } catch (err) {
    console.error('Error connecting to Database', err);
    process.exit(1);
  }
})();

const port = process.env.PORT || 3000;

// Start server with Hono
serve({
  fetch: app.fetch,
  port: port,
}, (info) => {
  console.log(`Server running on port ${info.port}`);
});

// Starting the bot
(async () => {
  bot();
})();
