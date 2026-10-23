// PulseBoard: live polls, Q&A and reactions, built to demo Cloud Run.
//
// Every response tells you WHICH container instance served it and WHICH
// revision that instance belongs to. That makes autoscaling and
// deployments visible on the projector.

const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

const { getIdentity } = require('./src/identity');
const { createStore, httpError } = require('./src/store');
const polls = require('./polls.json');
const pkg = require('./package.json');

// Cloud Run tells the container which port to listen on via $PORT.
const PORT = Number(process.env.PORT) || 8080;
const ADMIN_KEY = process.env.ADMIN_KEY || 'pulseboard';

// Cloud Logging turns one-line JSON on stdout into structured log entries.
function log(severity, message, fields = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

async function main() {
  const identity = await getIdentity();
  const store = createStore({ polls });
  await store.init();

  const app = express();
  app.set('trust proxy', true); // Cloud Run sits behind Google's front end
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));

  // Stamp every response with the instance and revision that served it.
  app.use((req, res, next) => {
    res.set('X-Served-By', identity.id);
    res.set('X-Revision', identity.revision);
    next();
  });

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
  app.get('/board', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'board.html')),
  );

  // Health check for Cloud Run startup probes and for humans.
  app.get('/healthz', (req, res) =>
    res.json({ ok: true, instance: identity.id, revision: identity.revision }),
  );

  // The one endpoint everyone polls: the whole room's state.
  app.get('/api/state', async (req, res, next) => {
    try {
      await store.recordRequest(identity);
      const state = await store.getState();
      res.set('Cache-Control', 'no-store');
      res.json({
        app: { version: pkg.version, storage: store.kind },
        servedBy: {
          instance: identity.id,
          revision: identity.revision,
          uptimeSec: Math.round((Date.now() - identity.startedAt) / 1000),
        },
        polls,
        ...state,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/vote', async (req, res, next) => {
    try {
      const { pollId, optionId, voterId } = req.body || {};
      requireVoter(voterId);
      const result = await store.vote(String(pollId), String(optionId), voterId);
      log('INFO', 'vote', { pollId, optionId, instance: identity.id });
      res.json({ ok: true, ...result, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/questions', async (req, res, next) => {
    try {
      const { text, voterId } = req.body || {};
      requireVoter(voterId);
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (clean.length < 3) throw httpError(400, 'Question is too short');
      if (clean.length > 140) throw httpError(400, 'Keep it under 140 characters');
      const q = await store.addQuestion(clean, voterId);
      log('INFO', 'question', { id: q.id, instance: identity.id });
      res.status(201).json({ ok: true, question: q, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/questions/:id/upvote', async (req, res, next) => {
    try {
      const { voterId } = req.body || {};
      requireVoter(voterId);
      const result = await store.upvote(req.params.id, voterId);
      res.json({ ok: true, ...result, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/react', async (req, res, next) => {
    try {
      await store.react(String((req.body || {}).kind));
      res.json({ ok: true, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  // Presenter-only controls. The key comes from the ADMIN_KEY env var.
  const requireAdmin = (req, res, next) => {
    if ((req.body || {}).key !== ADMIN_KEY) {
      return next(httpError(403, 'Wrong admin key'));
    }
    next();
  };

  app.post('/api/admin/poll', requireAdmin, async (req, res, next) => {
    try {
      await store.setActivePoll(String(req.body.pollId));
      log('NOTICE', 'active poll changed', { pollId: req.body.pollId, instance: identity.id });
      res.json({ ok: true, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/questions/:id/hide', requireAdmin, async (req, res, next) => {
    try {
      await store.hideQuestion(req.params.id);
      res.json({ ok: true, servedBy: identity.id });
    } catch (err) {
      next(err);
    }
  });

  // QR code that points people at this deployment's own URL.
  app.get('/qr.svg', async (req, res, next) => {
    try {
      const url = `${req.protocol}://${req.get('host')}/`;
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        color: { dark: '#161616', light: '#ffffff' },
      });
      res.type('image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) log('ERROR', err.message, { stack: err.stack, instance: identity.id });
    res.status(status).json({ ok: false, error: err.message, servedBy: identity.id });
  });

  const server = app.listen(PORT, () => {
    log('INFO', `PulseBoard v${pkg.version} listening`, {
      port: PORT,
      instance: identity.id,
      revision: identity.revision,
      storage: store.kind,
    });
  });

  // Cloud Run sends SIGTERM before it shuts an instance down
  // (for example when scaling back in, or when a new revision takes over).
  process.on('SIGTERM', () => {
    log('NOTICE', 'SIGTERM received, shutting down', { instance: identity.id });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

function requireVoter(voterId) {
  if (typeof voterId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(voterId)) {
    throw httpError(400, 'Missing or invalid voterId');
  }
}

main().catch((err) => {
  log('CRITICAL', 'Failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
