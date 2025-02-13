const Sentry = require("@sentry/node");


const sentryLogging = async () => {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0, // Adjust this value based on your needs
    integrations: [new Sentry.Integrations.Http({ tracing: true })],
  });
};

module.exports = { sentryLogging };