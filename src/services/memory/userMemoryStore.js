const UserFacts = require('../../models/userFacts');

function normalizeText(text) {
  return (text || '').toLowerCase().trim();
}

function extractPreferenceSubject(factText) {
  const text = normalizeText(factText);
  const likeMatch = text.match(/\blikes\s+(.+)$/i);
  if (likeMatch) return { subject: likeMatch[1].trim(), polarity: 'like' };
  const dislikeMatch = text.match(/\bdislikes\s+(.+)$/i);
  if (dislikeMatch) return { subject: dislikeMatch[1].trim(), polarity: 'dislike' };
  return null;
}

async function getOrCreateDoc(userId, username, serverId) {
  let doc = await UserFacts.findOne({ userId, serverId });
  if (!doc) {
    doc = new UserFacts({ userId, username, serverId, enabled: true, facts: [] });
    await doc.save();
  }
  return doc;
}

async function isMemoryEnabled(userId, serverId) {
  const doc = await UserFacts.findOne({ userId, serverId });
  return doc ? !!doc.enabled : true;
}

async function setMemoryEnabled(userId, username, serverId, enabled) {
  const doc = await getOrCreateDoc(userId, username, serverId);
  doc.enabled = !!enabled;
  await doc.save();
  return doc.enabled;
}

async function getUserFacts(userId, serverId, options = {}) {
  const { onlyActive = true } = options;
  const doc = await UserFacts.findOne({ userId, serverId });
  if (!doc) return [];
  return (doc.facts || []).filter(f => (onlyActive ? f.isActive : true));
}

function areFactsEquivalent(a, b) {
  return normalizeText(a.fact) === normalizeText(b.fact) && a.category === b.category;
}

async function deactivateFacts(userId, serverId, predicate) {
  const doc = await UserFacts.findOne({ userId, serverId });
  if (!doc) return 0;
  let count = 0;
  for (const f of doc.facts) {
    if (f.isActive && predicate(f)) {
      f.isActive = false;
      f.updatedAt = new Date();
      count++;
    }
  }
  if (count > 0) await doc.save();
  return count;
}

async function upsertFacts(userId, username, serverId, facts) {
  if (!Array.isArray(facts) || facts.length === 0) return { added: 0, updated: 0, deactivated: 0 };
  const doc = await getOrCreateDoc(userId, username, serverId);

  let added = 0;
  let updated = 0;
  let deactivated = 0;

  for (const nf of facts) {
    if (!nf || !nf.fact || typeof nf.fact !== 'string') continue;
    const existing = doc.facts.find(f => areFactsEquivalent(f, nf));
    // Contradiction handling for like/dislike pairs on same subject
    const pref = extractPreferenceSubject(nf.fact);
    if (pref) {
      const oppositePolarity = pref.polarity === 'like' ? 'dislike' : 'like';
      const oppositePhrase = `${oppositePolarity}s ${pref.subject}`;
      const candidates = doc.facts.filter(f => f.isActive && extractPreferenceSubject(f.fact));
      for (const f of candidates) {
        const p = extractPreferenceSubject(f.fact);
        if (!p) continue;
        if (p.subject === pref.subject && p.polarity !== pref.polarity) {
          if (f.isActive) {
            f.isActive = false;
            f.updatedAt = new Date();
            deactivated++;
          }
        }
      }
    }

    if (existing) {
      existing.isActive = true;
      existing.confidence = Math.max(existing.confidence || 0, nf.confidence || 0);
      existing.sourceMessageId = nf.sourceMessageId || existing.sourceMessageId;
      existing.updatedAt = new Date();
      updated++;
    } else {
      doc.facts.push({
        fact: nf.fact,
        category: nf.category || 'other',
        sourceMessageId: nf.sourceMessageId,
        confidence: typeof nf.confidence === 'number' ? nf.confidence : 0.8,
        isActive: nf.isActive !== false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      added++;
    }
  }

  await doc.save();
  return { added, updated, deactivated };
}

async function clearAllFacts(userId, serverId) {
  const doc = await UserFacts.findOne({ userId, serverId });
  if (!doc) return 0;
  const count = doc.facts.length;
  doc.facts = [];
  await doc.save();
  return count;
}

async function listFacts(userId, serverId, limit = 20) {
  const facts = await getUserFacts(userId, serverId, { onlyActive: true });
  return facts.slice(0, limit);
}

module.exports = {
  isMemoryEnabled,
  setMemoryEnabled,
  getUserFacts,
  upsertFacts,
  deactivateFacts,
  clearAllFacts,
  listFacts,
};



