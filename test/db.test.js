const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStandardAtlasUri, isDnsFailure, safeDatabaseError } = require('../src/utils/db');

test('recognizes MongoDB SRV resolver failures', () => {
  assert.equal(isDnsFailure(Object.assign(new Error('querySrv failed'), { code: 'ETIMEOUT' })), true);
  assert.equal(isDnsFailure(new Error('authentication failed')), false);
});

test('converts an Atlas SRV URI using validated HTTPS DNS answers', async () => {
  const fakeFetch = async url => {
    const type = url.searchParams.get('type');
    return {
      ok: true,
      json: async () => type === 'SRV'
        ? { Status: 0, Answer: [{ data: '0 0 27017 shard-00-00.cluster.mongodb.net.' }] }
        : { Status: 0, Answer: [{ data: 'authSource=admin&replicaSet=atlas-test' }] },
    };
  };

  const result = await buildStandardAtlasUri(
    'mongodb+srv://user:p%40ss@cluster.mongodb.net/app?retryWrites=true',
    fakeFetch,
  );
  const safeResult = result.replace('user:p%40ss@', 'credentials@');
  assert.equal(
    safeResult,
    'mongodb://credentials@shard-00-00.cluster.mongodb.net:27017/app?retryWrites=true&authSource=admin&replicaSet=atlas-test&tls=true',
  );
});

test('rejects DNS fallback hosts outside the Atlas parent domain', async () => {
  const fakeFetch = async url => ({
    ok: true,
    json: async () => url.searchParams.get('type') === 'SRV'
      ? { Status: 0, Answer: [{ data: '0 0 27017 attacker.example.' }] }
      : { Status: 0, Answer: [] },
  });
  await assert.rejects(
    buildStandardAtlasUri('mongodb+srv://cluster.mongodb.net/app', fakeFetch),
    /outside the expected domain/,
  );
});

test('redacts MongoDB credentials from database errors', () => {
  const result = safeDatabaseError(
    new TypeError('Invalid mongodb://user:password@host-a:27017,host-b:27017/app?tls=true'),
  );
  assert.equal(result.message.includes('password'), false);
  assert.match(result.message, /redacted/);
});
