const crypto = require('crypto');

const VALID_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);

const WORKLOADS = Object.freeze({
  chat: { env: 'GLOBAL_GPT_MODEL', fallback: 'gpt-5.6-terra', effortEnv: 'CHAT_REASONING_EFFORT', effort: 'low' },
  scheduling: { env: 'SCHEDULING_MODEL', fallback: 'gpt-5.6-luna', effortEnv: 'SCHEDULING_REASONING_EFFORT', effort: 'low' },
  responseCheck: { env: 'RESPONSE_CHECK_MODEL', fallback: 'gpt-5.6-luna', effortEnv: 'RESPONSE_CHECK_REASONING_EFFORT', effort: 'none' },
  factExtraction: { env: 'FACT_EXTRACTOR_MODEL', fallback: 'gpt-5.6-luna', effortEnv: 'FACT_EXTRACTOR_REASONING_EFFORT', effort: 'low' },
  summary: { env: 'SUMMARY_MODEL', fallback: 'gpt-5.6-luna', effortEnv: 'SUMMARY_REASONING_EFFORT', effort: 'none' },
  webhookReport: { env: 'WEBHOOK_REPORT_MODEL', fallback: 'gpt-5.6-terra', effortEnv: 'WEBHOOK_REPORT_REASONING_EFFORT', effort: 'low' },
  imageAnalysis: { env: 'IMAGE_ANALYSIS_MODEL', fallback: 'gpt-5.6-terra', effortEnv: 'IMAGE_ANALYSIS_REASONING_EFFORT', effort: 'low' },
});

function getWorkloadConfig(workload, modelOverride) {
  const route = WORKLOADS[workload];
  if (!route) throw new Error(`Unknown OpenAI workload: ${workload}`);
  const configuredEffort = process.env[route.effortEnv] || route.effort;
  return {
    model: modelOverride || process.env[route.env] || route.fallback,
    reasoning: { effort: VALID_REASONING_EFFORTS.has(configuredEffort) ? configuredEffort : route.effort },
  };
}

function createSafetyIdentifier(userId) {
  if (!userId) return undefined;
  return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

module.exports = { WORKLOADS, createSafetyIdentifier, getWorkloadConfig };
