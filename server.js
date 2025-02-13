require("dotenv").config();
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const { sentryLogging } = require("./src/sentry/sentry");  // Sentry initialization function

// Initialize Sentry with Tracing
sentryLogging();

const express = require("express");
const app = express();
const routes = require("./src/api/routes");
const { errorHandler } = require("./src/api/middlewares");
const { connectDB } = require("./src/utils/db");
const { start: bot } = require("./src/discord/bot");
const { loadWebhookSubs } = require('./src/utils/webhook');
const { swaggerUi, swaggerSpec } = require('./src/api/swagger');

// Sentry's request handler for tracing
app.use(Sentry.Handlers.requestHandler({
  transactionName: (req) => `${req.method} ${req.url}`, // Optional: customize transaction names
  tracingOrigins: ["localhost", /^\//], // Adjust according to your needs
}));

// Swagger setup
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Use JSON middleware
app.use(express.json());

// Use your routes
app.use("/api", routes);

// Sentry's error handler should be before your other error handlers
app.use(Sentry.Handlers.errorHandler());

// Error handling middleware
app.use(errorHandler);

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
app.listen(port, () => console.log(`Server running on port ${port}`));

// Starting the bot
(async () => {
  bot();
})();
