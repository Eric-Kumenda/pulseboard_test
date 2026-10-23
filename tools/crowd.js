#!/usr/bin/env node
// Crowd simulator: pretend a room full of people is using PulseBoard.
//
// Use it when the room is small, or to rehearse at home:
//
//   node tools/crowd.js https://pulseboard-xxxx.a.run.app --users 60 --seconds 45
//
// Each virtual user polls /api/state every ~2s, votes once, sometimes asks
// a question, upvotes, and reacts. At the end it prints which instances
// answered, so you can see Cloud Run scaling out.

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:8080').replace(/\/$/, '');
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const USERS = opt('users', 40);
const SECONDS = opt('seconds', 30);

const sampleQuestions = [
  'How much does Cloud Run cost for a student project?',
  'Can Cloud Run connect to a database?',
  'What is the difference between Cloud Run and App Engine?',
  'How do cold starts affect my app?',
  'Can I use my own domain name?',
  'Does Cloud Run support WebSockets?',
  'How do I keep secrets out of my code?',
  'Is Cloud Run good for machine learning models?',
];
const reactions = ['fire', 'clap', 'rocket', 'heart', 'laugh'];

const servedBy = new Map();
let ok = 0;
let failed = 0;
const latencies = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function call(path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    latencies.push(performance.now() - t0);
    const inst = res.headers.get('x-served-by') || '?';
    servedBy.set(inst, (servedBy.get(inst) || 0) + 1);
    if (res.ok) ok++;
    else failed++;
    return res.ok ? res.json() : null;
  } catch {
    failed++;
    return null;
  }
}

async function user(n, deadline) {
  const voterId = `crowd-${n}-${Math.random().toString(16).slice(2, 10)}`;
  await sleep(Math.random() * 3000); // people don't all arrive at once
  let voted = new Set();

  while (Date.now() < deadline) {
    const state = await call('/api/state');
    if (state) {
      const poll = state.polls.find((p) => p.id === state.activePollId);
      if (poll && !voted.has(poll.id)) {
        await call('/api/vote', { pollId: poll.id, optionId: pick(poll.options).id, voterId });
        voted.add(poll.id);
      }
      if (Math.random() < 0.04) {
        await call('/api/questions', { text: pick(sampleQuestions), voterId });
      }
      if (state.questions.length && Math.random() < 0.15) {
        await call(`/api/questions/${pick(state.questions).id}/upvote`, { voterId });
      }
      if (Math.random() < 0.25) {
        await call('/api/react', { kind: pick(reactions) });
      }
    }
    await sleep(1500 + Math.random() * 1000);
  }
}

(async () => {
  console.log(`Simulating ${USERS} users against ${base} for ${SECONDS}s…`);
  const deadline = Date.now() + SECONDS * 1000;
  const timer = setInterval(() => {
    const line = [...servedBy.entries()].map(([k, v]) => `${k}:${v}`).join('  ');
    process.stdout.write(`\r  ok=${ok} failed=${failed}  instances=${servedBy.size}  ${line}`.slice(0, 160));
  }, 1000);

  await Promise.all(Array.from({ length: USERS }, (_, i) => user(i, deadline)));
  clearInterval(timer);

  latencies.sort((a, b) => a - b);
  const p = (q) => Math.round(latencies[Math.floor(q * (latencies.length - 1))] || 0);
  console.log('\n\nResults');
  console.log(`  requests ok/failed : ${ok}/${failed}`);
  console.log(`  latency p50/p95/max: ${p(0.5)}ms / ${p(0.95)}ms / ${p(1)}ms`);
  console.log(`  instances that answered: ${servedBy.size}`);
  for (const [k, v] of [...servedBy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(12)} ${'█'.repeat(Math.ceil((v / ok) * 40))} ${v}`);
  }
})();
