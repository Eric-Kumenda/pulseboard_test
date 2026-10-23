// =====================================================================
//  PulseBoard v1 store: EVERYTHING LIVES IN THIS CONTAINER'S MEMORY.
// =====================================================================
//
// This works perfectly on your laptop and on Cloud Run with ONE instance.
// The moment Cloud Run scales out to 2, 3, 4 instances, each instance has
// its own copy of these variables. Votes sent to instance A are invisible
// to instance B, so the board "flickers" between different totals.
//
// That is the bug we deploy on purpose in the session. v2 replaces this
// file with a Firestore-backed store that has the same functions.

const crypto = require('node:crypto');

const REACTIONS = ['fire', 'clap', 'rocket', 'heart', 'laugh'];

function createStore({ polls }) {
  let activePollId = polls[0].id;

  // counts[pollId][optionId] = number of votes
  const counts = {};
  for (const p of polls) {
    counts[p.id] = Object.fromEntries(p.options.map((o) => [o.id, 0]));
  }

  const votes = new Map();      // `${pollId}:${voterId}` -> optionId
  const questions = new Map();  // id -> { id, text, votes, createdAt, hidden }
  const upvoters = new Set();   // `${questionId}:${voterId}`
  const reactions = Object.fromEntries(REACTIONS.map((r) => [r, 0]));
  const instances = new Map();  // only ever contains THIS instance in v1

  return {
    kind: 'memory',

    async init() {},

    async recordRequest(identity) {
      const now = Date.now();
      const me = instances.get(identity.id) || {
        id: identity.id,
        revision: identity.revision,
        requests: 0,
        startedAt: identity.startedAt,
      };
      me.requests += 1;
      me.lastSeen = now;
      instances.set(identity.id, me);
    },

    async getState() {
      const visible = [...questions.values()]
        .filter((q) => !q.hidden)
        .sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt)
        .slice(0, 30);
      return {
        activePollId,
        counts: structuredClone(counts),
        questions: visible,
        reactions: { ...reactions },
        instances: [...instances.values()],
      };
    },

    async vote(pollId, optionId, voterId) {
      if (!counts[pollId] || !(optionId in counts[pollId])) {
        throw httpError(400, 'Unknown poll or option');
      }
      const key = `${pollId}:${voterId}`;
      const previous = votes.get(key);
      if (previous === optionId) return { changed: false };
      if (previous) counts[pollId][previous] -= 1;
      counts[pollId][optionId] += 1;
      votes.set(key, optionId);
      return { changed: true };
    },

    async addQuestion(text, voterId) {
      const q = {
        id: crypto.randomUUID(),
        text,
        votes: 1,
        createdAt: Date.now(),
        hidden: false,
      };
      questions.set(q.id, q);
      upvoters.add(`${q.id}:${voterId}`);
      return q;
    },

    async upvote(questionId, voterId) {
      const q = questions.get(questionId);
      if (!q) throw httpError(404, 'Question not found (maybe it lives on another instance?)');
      const key = `${questionId}:${voterId}`;
      if (upvoters.has(key)) return { changed: false };
      upvoters.add(key);
      q.votes += 1;
      return { changed: true };
    },

    async react(kind) {
      if (!REACTIONS.includes(kind)) throw httpError(400, 'Unknown reaction');
      reactions[kind] += 1;
    },

    async setActivePoll(pollId) {
      if (!counts[pollId]) throw httpError(400, 'Unknown poll');
      activePollId = pollId;
    },

    async hideQuestion(questionId) {
      const q = questions.get(questionId);
      if (q) q.hidden = true;
    },
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { createStore, REACTIONS, httpError };
