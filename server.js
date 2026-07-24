require("dotenv").config({ quiet: true });
const Sentry = require("@sentry/node");
const { sentryLogging } = require("./src/sentry/sentry");  // Sentry initialization function

// Initialize Sentry with Tracing
sentryLogging();

const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const { routeDefinitions, getAvailableEndpoints } = require("./src/api/routes");
const { authMiddleware, webhookAuthMiddleware, errorHandler } = require("./src/api/middlewares");
const { connectDB } = require("./src/utils/db");
const { start: bot } = require("./src/discord/bot");
const { loadWebhookSubs } = require('./src/utils/webhook');
const { swaggerSpec, renderApiDocs } = require('./src/api/swagger');
const { validateEnvironment } = require('./src/utils/config');
const mongoose = require('mongoose');
const discordClient = require('./src/discord/client');
const { randomUUID } = require('crypto');

function createApp() {
const app = new Hono();
const rateLimit = new Map();

// Sentry request handler middleware
app.use('/api/*', async (c, next) => {
  const now = Date.now();
  c.header('X-Request-Id', c.req.header('x-request-id') || randomUUID());
  const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
  const windowMs = 60_000;
  const maxRequests = Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 120;
  const current = rateLimit.get(key);
  if (rateLimit.size > 10_000) {
    for (const [candidate, record] of rateLimit) if (record.resetAt <= now) rateLimit.delete(candidate);
  }
  if (!current || current.resetAt <= now) rateLimit.set(key, { count: 1, resetAt: now + windowMs });
  else if (++current.count > maxRequests) return c.json({ error: 'Too many requests' }, 429);
  const contentLength = Number(c.req.header('content-length')) || 0;
  const maxBody = Number(process.env.API_MAX_BODY_BYTES) || 3 * 1024 * 1024;
  if (contentLength > maxBody) return c.json({ error: 'Request body too large' }, 413);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  await next();
});

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
    app[method](fullPath, route.authType === 'webhook' ? webhookAuthMiddleware : authMiddleware, route.handler);
  } else {
    // Route without authentication
    app[method](fullPath, route.handler);
  }
});

// Swagger UI endpoint (using Express-compatible setup for now)
// Note: You may want to use @hono/swagger-ui for better Hono integration
app.get('/api-docs', async (c) => {
  return c.html(renderApiDocs());
});
app.get('/openapi.json', c => c.json(swaggerSpec));

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

return app;
}

async function startServer() {
  try {
    validateEnvironment();
    await connectDB();

    // Load Webhook Subscriptions from Database
    await loadWebhookSubs().catch(err => {
      console.error(`Failed to load webhook subscriptions: ${err}`);
    });

    console.log('Successfully connected to Database');
    await bot();
    const app = createApp();
    const port = Number(process.env.PORT) || 8940;
    const server = serve({ fetch: app.fetch, port }, info => console.log(`Server running on port ${info.port}`));
    let shuttingDown = false;
    const shutdown = async signal => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Received ${signal}; shutting down.`);
      await new Promise(resolve => server.close(resolve));
      discordClient.destroy();
      await mongoose.disconnect();
      await Sentry.close(2000);
    };
    process.once('SIGTERM', () => shutdown('SIGTERM').catch(error => console.error('Shutdown failed:', error.message)));
    process.once('SIGINT', () => shutdown('SIGINT').catch(error => console.error('Shutdown failed:', error.message)));
    return server;
  } catch (err) {
    Sentry.captureException(err);
    console.error('Startup failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  startServer().catch(() => { process.exitCode = 1; });
}

module.exports = { createApp, startServer };
