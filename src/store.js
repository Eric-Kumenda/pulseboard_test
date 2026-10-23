// =====================================================================
//  PulseBoard v2 store: STATE LIVES IN FIRESTORE, SHARED BY ALL INSTANCES.
// =====================================================================
//
// Same functions as v1 (init, getState, vote, addQuestion, upvote, react,
// setActivePoll, hideQuestion, recordRequest), so server.js is unchanged.
//
// Data model (everything under one "room" so tests can use their own):
//
//   rooms/{room}                      { activePollId }
//   rooms/{room}/shards/{0..9}        { counts: {poll: {option: n}}, reactions: {kind: n} }
//   rooms/{room}/votes/{poll_voter}   { pollId, optionId, voterId }
//   rooms/{room}/questions/{id}       { text, votes, createdAt, hidden }
//   rooms/{room}/questions/{id}/upvoters/{voterId}
//   rooms/{room}/instances/{id}       { revision, requests, lastSeen }
//
// Two cost and scale decisions worth pointing out in the session:
//
// 1. LISTENERS, NOT POLLING. Each instance opens real-time listeners once
//    and keeps an in-memory copy. Phones poll the instance, not the
//    database. Firestore bills reads when data CHANGES, so 200 phones
//    polling every 3 seconds cost the same reads as 2 phones.
//
// 2. SHARDED COUNTERS. A single Firestore document should take about one
//    sustained write per second. A whole room voting at once would queue
//    up on one "totals" document, so totals are spread over 10 shard
//    documents and summed when read.

const crypto = require('node:crypto');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const KIND = 'firestore';
const REACTIONS = ['fire', 'clap', 'rocket', 'heart', 'laugh'];
const SHARDS = 10;
const HEARTBEAT_MS = 5000;

function createStore({ polls, namespace, db } = {}) {
  const firestore = db || new Firestore({ ignoreUndefinedProperties: true });
  const roomId = namespace || process.env.ROOM || 'main';
  const room = firestore.collection('rooms').doc(roomId);
  const pollIndex = new Map(polls.map((p) => [p.id, new Set(p.options.map((o) => o.id))]));

  // In-memory copy kept fresh by listeners.
  const cache = {
    activePollId: polls[0].id,
    shards: new Map(),
    questions: new Map(),
    instances: new Map(),
  };
  const unsubscribers = [];
  let pendingRequests = 0;
  let lastHeartbeat = 0;

  const randomShard = () => room.collection('shards').doc(String(Math.floor(Math.random() * SHARDS)));

  // Subscribe and resolve once the first snapshot arrives. If the listener
  // errors (for example a missing permission), log it and resubscribe.
  function listen(name, target, onSnapshot) {
    return new Promise((resolve, reject) => {
      let first = true;
      const subscribe = () => {
        const unsub = target.onSnapshot(
          (snap) => {
            onSnapshot(snap);
            if (first) {
              first = false;
              resolve();
            }
          },
          (err) => {
            console.log(JSON.stringify({ severity: 'ERROR', message: `listener ${name} failed`, error: err.message }));
            if (first) return reject(err);
            setTimeout(subscribe, 5000);
          },
        );
        unsubscribers.push(unsub);
      };
      subscribe();
    });
  }

  function emptyCounts() {
    const counts = {};
    for (const p of polls) counts[p.id] = Object.fromEntries(p.options.map((o) => [o.id, 0]));
    return counts;
  }

  return {
    kind: KIND,

    async init() {
      // Create the room document the first time, without overwriting it later.
      await room.create({ activePollId: polls[0].id, createdAt: Date.now() }).catch((err) => {
        if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
      });

      const ready = Promise.all([
        listen('room', room, (snap) => {
          if (snap.exists) cache.activePollId = snap.get('activePollId') || polls[0].id;
        }),
        listen('shards', room.collection('shards'), (snap) => {
          cache.shards = new Map(snap.docs.map((d) => [d.id, d.data()]));
        }),
        listen('questions', room.collection('questions'), (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type === 'removed') cache.questions.delete(change.doc.id);
            else cache.questions.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
          }
        }),
        listen('instances', room.collection('instances'), (snap) => {
          cache.instances = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
        }),
      ]);

      // If Firestore isn't reachable (no database, no permission) the app
      // refuses to start. Cloud Run then keeps the previous revision
      // serving traffic, so a bad deploy never takes the site down.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Firestore listeners did not start within 15s')), 15000);
      });
      try {
        await Promise.race([ready, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },

    // Batch the per-request heartbeat: one write per instance every 5s,
    // not one write per request.
    async recordRequest(identity, { force = false } = {}) {
      pendingRequests += 1;
      const now = Date.now();
      if (!force && now - lastHeartbeat < HEARTBEAT_MS) return;
      lastHeartbeat = now;
      const delta = pendingRequests;
      pendingRequests = 0;
      await room.collection('instances').doc(identity.id).set(
        {
          revision: identity.revision,
          startedAt: identity.startedAt,
          lastSeen: now,
          requests: FieldValue.increment(delta),
        },
        { merge: true },
      );
    },

    async getState() {
      const counts = emptyCounts();
      const reactions = Object.fromEntries(REACTIONS.map((r) => [r, 0]));
      for (const shard of cache.shards.values()) {
        for (const [pollId, opts] of Object.entries(shard.counts || {})) {
          for (const [optId, n] of Object.entries(opts)) {
            if (counts[pollId] && optId in counts[pollId]) counts[pollId][optId] += n;
          }
        }
        for (const [k, n] of Object.entries(shard.reactions || {})) {
          if (k in reactions) reactions[k] += n;
        }
      }
      const questions = [...cache.questions.values()]
        .filter((q) => !q.hidden)
        .sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt)
        .slice(0, 30)
        .map(({ id, text, votes, createdAt }) => ({ id, text, votes, createdAt }));

      return {
        activePollId: cache.activePollId,
        counts,
        questions,
        reactions,
        instances: [...cache.instances.values()].map(({ id, revision, requests, lastSeen }) => ({
          id, revision, requests, lastSeen,
        })),
      };
    },

    async vote(pollId, optionId, voterId) {
      const options = pollIndex.get(pollId);
      if (!options || !options.has(optionId)) throw httpError(400, 'Unknown poll or option');

      // The vote document ID is poll + voter, so each person has exactly one.
      const voteRef = room.collection('votes').doc(`${pollId}_${voterId}`);
      return firestore.runTransaction(async (tx) => {
        const existing = await tx.get(voteRef);
        const previous = existing.exists ? existing.get('optionId') : null;
        if (previous === optionId) return { changed: false };

        const counts = { [optionId]: FieldValue.increment(1) };
        if (previous) counts[previous] = FieldValue.increment(-1);
        tx.set(voteRef, { pollId, optionId, voterId, at: Date.now() });
        tx.set(randomShard(), { counts: { [pollId]: counts } }, { merge: true });
        return { changed: true };
      });
    },

    async addQuestion(text, voterId) {
      const id = crypto.randomUUID();
      const qRef = room.collection('questions').doc(id);
      const q = { text, votes: 1, createdAt: Date.now(), hidden: false, askedBy: voterId };
      const batch = firestore.batch();
      batch.create(qRef, q);
      batch.create(qRef.collection('upvoters').doc(voterId), { at: Date.now() });
      await batch.commit();
      return { id, text, votes: 1, createdAt: q.createdAt };
    },

    async upvote(questionId, voterId) {
      const qRef = room.collection('questions').doc(questionId);
      const upRef = qRef.collection('upvoters').doc(voterId);
      return firestore.runTransaction(async (tx) => {
        const [q, up] = await Promise.all([tx.get(qRef), tx.get(upRef)]);
        if (!q.exists) throw httpError(404, 'Question not found');
        if (up.exists) return { changed: false };
        tx.create(upRef, { at: Date.now() });
        tx.update(qRef, { votes: FieldValue.increment(1) });
        return { changed: true };
      });
    },

    async react(kind) {
      if (!REACTIONS.includes(kind)) throw httpError(400, 'Unknown reaction');
      await randomShard().set({ reactions: { [kind]: FieldValue.increment(1) } }, { merge: true });
    },

    async setActivePoll(pollId) {
      if (!pollIndex.has(pollId)) throw httpError(400, 'Unknown poll');
      await room.set({ activePollId: pollId }, { merge: true });
    },

    async hideQuestion(questionId) {
      await room.collection('questions').doc(questionId).update({ hidden: true }).catch((err) => {
        if (err.code !== 5) throw err; // 5 = NOT_FOUND: nothing to hide
      });
    },

    async close() {
      unsubscribers.forEach((u) => u());
      if (!db) await firestore.terminate();
    },
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { createStore, REACTIONS, httpError, KIND };
