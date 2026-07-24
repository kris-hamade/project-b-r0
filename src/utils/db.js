const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });

const DOH_ENDPOINT = 'https://dns.google/resolve';
const DNS_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL', 'ENOTFOUND', 'EREFUSED']);

function isDnsFailure(error) {
  let current = error;
  while (current) {
    if (DNS_ERROR_CODES.has(current.code) || /query(?:Srv|Txt)|DNS/i.test(current.message || '')) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function resolveDnsOverHttps(name, type, fetchImpl = fetch) {
  const url = new URL(DOH_ENDPOINT);
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);

  const response = await fetchImpl(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`DNS-over-HTTPS returned HTTP ${response.status}`);

  const payload = await response.json();
  if (payload.Status !== 0 || !Array.isArray(payload.Answer)) {
    throw new Error(`DNS-over-HTTPS could not resolve ${type} records`);
  }
  return payload.Answer.map(answer => answer.data).filter(Boolean);
}

async function buildStandardAtlasUri(srvUri, fetchImpl = fetch) {
  const parsed = new URL(srvUri);
  if (parsed.protocol !== 'mongodb+srv:') throw new Error('A mongodb+srv URI is required');

  const hostname = parsed.hostname.toLowerCase();
  const parentDomain = hostname.split('.').slice(1).join('.');
  if (!parentDomain) throw new Error('MongoDB SRV hostname is invalid');

  const [srvRecords, txtRecords] = await Promise.all([
    resolveDnsOverHttps(`_mongodb._tcp.${hostname}`, 'SRV', fetchImpl),
    resolveDnsOverHttps(hostname, 'TXT', fetchImpl),
  ]);

  const hosts = srvRecords.map(record => {
    const match = record.match(/^\d+\s+\d+\s+(\d+)\s+([^\s]+)\.?$/);
    if (!match) throw new Error('Received an invalid MongoDB SRV record');
    const [, port, rawTarget] = match;
    const target = rawTarget.replace(/\.$/, '').toLowerCase();
    if (!target.endsWith(`.${parentDomain}`)) {
      throw new Error('MongoDB SRV record pointed outside the expected domain');
    }
    return `${target}:${port}`;
  });
  if (!hosts.length) throw new Error('No MongoDB SRV hosts were returned');

  const options = new URLSearchParams(parsed.searchParams);
  for (const txtRecord of txtRecords) {
    const cleaned = txtRecord.replace(/^"|"$/g, '');
    for (const [key, value] of new URLSearchParams(cleaned)) {
      if (!options.has(key)) options.set(key, value);
    }
  }
  if (!options.has('tls')) options.set('tls', 'true');

  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  return `mongodb://${credentials}${hosts.join(',')}${parsed.pathname}?${options}`;
}

function connectionOptions(uri) {
  const useTls = process.env.MONGODB_TLS
    ? process.env.MONGODB_TLS === 'true'
    : uri.startsWith('mongodb+srv://') || /[?&]tls=true(?:&|$)/i.test(uri);
  return {
    tls: useTls,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  };
}

function safeDatabaseError(error) {
  const message = String(error?.message || error || 'Unknown database error')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[MongoDB URI redacted]');
  return { name: error?.name || 'Error', code: error?.code, message };
}

function sanitizedDatabaseException(error) {
  const safe = safeDatabaseError(error);
  const sanitized = new Error(safe.message);
  sanitized.name = safe.name;
  sanitized.code = safe.code;
  return sanitized;
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri, connectionOptions(uri));
    console.log('Successfully connected to MongoDB Atlas!');
  } catch (error) {
    const fallbackEnabled = process.env.MONGODB_DOH_FALLBACK !== 'false';
    if (!fallbackEnabled || !uri.startsWith('mongodb+srv://') || !isDnsFailure(error)) {
      console.error('Error connecting to the database:', safeDatabaseError(error));
      throw sanitizedDatabaseException(error);
    }

    console.warn('MongoDB SRV lookup failed; retrying through DNS-over-HTTPS.');
    try {
      await mongoose.disconnect().catch(() => {});
      const fallbackUri = await buildStandardAtlasUri(uri);
      await mongoose.connect(fallbackUri, connectionOptions(fallbackUri));
      console.log('Successfully connected to MongoDB Atlas using the DNS-over-HTTPS fallback.');
    } catch (fallbackError) {
      console.error('Error connecting to the database after DNS fallback:', safeDatabaseError(fallbackError));
      throw sanitizedDatabaseException(fallbackError);
    }
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', safeDatabaseError(reason));
});

module.exports = {
  buildStandardAtlasUri,
  connectDB,
  isDnsFailure,
  safeDatabaseError,
};
