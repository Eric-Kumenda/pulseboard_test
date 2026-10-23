// Contract tests for the store. The same tests run against v1 (memory)
// and v2 (Firestore, via the emulator) because both stores must behave
// the same way. Run with:  npm test
// For v2 locally:  FIRESTORE_EMULATOR_HOST=localhost:8085 npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const polls = require('../polls.json');

const identity = { id: 'test01', revision: 'test-rev', startedAt: Date.now() };
const voter = (n) => `voter-${n}-${Date.now().toString(16)}`;

async function freshStore() {
  const store = createStore({ polls, namespace: `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` });
  await store.init();
  return store;
}

// Firestore listeners update a moment after a write; memory is instant.
async function eventually(fn, ms = 5000) {
  const until = Date.now() + ms;
  let lastErr;
  while (Date.now() < until) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw lastErr;
}

test('votes are counted once per voter and can be changed', async () => {
  const store = await freshStore();
  const a = voter('a');
  const b = voter('b');
  await store.vote('docker', 'never', a);
  await store.vote('docker', 'never', a); // duplicate: ignored
  await store.vote('docker', 'prod', b);
  await store.vote('docker', 'projects', b); // b changes their mind

  await eventually(async () => {
    const { counts } = await store.getState();
    assert.equal(counts.docker.never, 1);
    assert.equal(counts.docker.prod, 0);
    assert.equal(counts.docker.projects, 1);
  });
  await store.close?.();
});

test('unknown poll or option is rejected', async () => {
  const store = await freshStore();
  await assert.rejects(store.vote('nope', 'x', voter('c')), /Unknown/);
  await assert.rejects(store.vote('docker', 'x', voter('c')), /Unknown/);
  await store.close?.();
});

test('questions are sorted by upvotes and upvotes are one per voter', async () => {
  const store = await freshStore();
  const q1 = await store.addQuestion('First question?', voter('d'));
  const q2 = await store.addQuestion('Second question?', voter('e'));
  const f = voter('f');
  await store.upvote(q2.id, f);
  await store.upvote(q2.id, f); // duplicate: ignored

  await eventually(async () => {
    const { questions } = await store.getState();
    assert.equal(questions[0].id, q2.id);
    assert.equal(questions[0].votes, 2);
    assert.equal(questions[1].id, q1.id);
  });

  await store.hideQuestion(q2.id);
  await eventually(async () => {
    const { questions } = await store.getState();
    assert.ok(!questions.some((q) => q.id === q2.id));
  });
  await store.close?.();
});

test('reactions, active poll and instance heartbeat', async () => {
  const store = await freshStore();
  await store.react('fire');
  await store.react('fire');
  await store.setActivePoll('fear');
  await store.recordRequest(identity, { force: true });

  await eventually(async () => {
    const s = await store.getState();
    assert.equal(s.reactions.fire, 2);
    assert.equal(s.activePollId, 'fear');
    assert.ok(s.instances.some((i) => i.id === 'test01'));
  });
  await assert.rejects(store.react('nope'), /Unknown/);
  await store.close?.();
});
