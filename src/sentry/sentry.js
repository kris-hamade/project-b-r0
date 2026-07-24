const Sentry = require("@sentry/node");


const sentryLogging = async () => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    sendDefaultPii: false,
  });
};

module.exports = { sentryLogging };
