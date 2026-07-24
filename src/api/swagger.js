const { routeDefinitions } = require('./routes');

const swaggerSpec = {
  openapi: '3.1.0',
  info: {
    title: 'B-r0 Campaign Copilot API',
    version: process.env.VERSION || '1.0.0',
    description: 'Administrative API for health, campaign data, chat history, and webhooks.',
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: Object.fromEntries(routeDefinitions.map(route => [
    `/api${route.endpoint.replace(/:([^/]+)/g, '{$1}')}`,
    {
      [route.method.toLowerCase()]: {
        summary: route.description,
        security: route.requiresAuth ? [{ ApiKeyAuth: [] }] : [],
        responses: {
          200: { description: 'Success' },
          400: { description: 'Invalid request' },
          401: { description: 'Unauthorized' },
          500: { description: 'Server error' },
        },
      },
    },
  ])),
};

function renderApiDocs() {
  const rows = routeDefinitions.map(route =>
    `<tr><td><span class="method ${route.method.toLowerCase()}">${route.method}</span></td><td><code>/api${route.endpoint}</code></td><td>${route.description || ''}</td><td>${route.requiresAuth ? 'Bearer key' : 'Public'}</td></tr>`
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>B-r0 API</title><style>
  body{font:16px system-ui;background:#0f1117;color:#e8eaf0;max-width:1100px;margin:40px auto;padding:0 20px}h1{color:#b9a7ff}a{color:#8bd5ff}table{width:100%;border-collapse:collapse;background:#171a23}th,td{text-align:left;padding:12px;border-bottom:1px solid #2c3140}.method{font-weight:700}.get{color:#72e5a1}.post{color:#8bd5ff}.delete{color:#ff8e9d}code{color:#f1d58a}</style></head><body>
  <h1>B-r0 Campaign Copilot API</h1><p>Use <code>Authorization: Bearer &lt;API_KEY&gt;</code> on protected routes. Campaign routes also require <code>guildId</code> or <code>X-Guild-Id</code>.</p>
  <p><a href="/openapi.json">OpenAPI 3.1 JSON</a></p><table><thead><tr><th>Method</th><th>Path</th><th>Description</th><th>Access</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

module.exports = { swaggerSpec, renderApiDocs };
