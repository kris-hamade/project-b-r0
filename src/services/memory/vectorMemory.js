const openai = require('../../openai/openAi');
const { getUserFacts } = require('./userMemoryStore');

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(texts) {
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const res = await openai.embeddings.create({
    model,
    input: texts,
  });
  return res.data.map(d => d.embedding);
}

async function findSimilarFacts(userId, serverId, query, topK = 5) {
  const facts = await getUserFacts(userId, serverId, { onlyActive: true });
  if (!facts.length || !query) return [];
  const corpus = facts.map(f => f.fact);
  const [qEmb, ...cEmb] = await embed([query, ...corpus]);
  const scored = facts.map((f, i) => ({ fact: f, score: cosineSim(qEmb, cEmb[i]) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = {
  findSimilarFacts,
};



