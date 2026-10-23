// Board (projector) view. Polls fast so the room sees changes quickly, and
// keeps a record of which instance answered each request.

(() => {
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 1500;
  const STALE_MS = 30000;

  // Presenter controls: open /board?key=YOUR_ADMIN_KEY
  const params = new URLSearchParams(location.search);
  let adminKey = params.get('key');
  try {
    if (adminKey) sessionStorage.setItem('pb.key', adminKey);
    else adminKey = sessionStorage.getItem('pb.key');
  } catch { /* ignore */ }
  if (adminKey) document.body.classList.add('is-admin');

  const trail = [];                 // last 24 instance IDs that answered
  const seenByScreen = new Map();   // instanceId -> { lastSeen, revision }
  const knownTiles = new Set();
  let lastReactions = null;
  let state = null;

  $('join-url').textContent = location.host;

  function renderPoll() {
    const idx = state.polls.findIndex((p) => p.id === state.activePollId);
    const poll = state.polls[Math.max(idx, 0)];
    const counts = state.counts[poll.id] || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...Object.values(counts));

    $('poll-eyebrow').textContent = `Live poll ${Math.max(idx, 0) + 1} of ${state.polls.length}`;
    $('poll-q').textContent = poll.question;
    $('total').textContent = `${total} vote${total === 1 ? '' : 's'}`;

    const bars = $('bars');
    if (bars.dataset.poll !== poll.id) {
      bars.dataset.poll = poll.id;
      bars.innerHTML = poll.options.map((o, i) => `
        <div class="bar-row" data-o="${o.id}">
          <span class="bar-label">${PB.esc(o.label)}</span>
          <span class="bar-num">0</span>
          <div class="bar-track"><div class="bar-fill" style="background:${PB.BAR_COLORS[i % PB.BAR_COLORS.length]}"></div></div>
        </div>`).join('');
    }
    for (const o of poll.options) {
      const row = bars.querySelector(`[data-o="${o.id}"]`);
      const n = counts[o.id] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      row.querySelector('.bar-num').textContent = `${n} · ${pct}%`;
      row.querySelector('.bar-fill').style.width = `${(n / max) * 100}%`;
    }
  }

  function renderQuestions() {
    const list = state.questions.slice(0, 7);
    $('questions').innerHTML = list.length
      ? list.map((q) => `
          <li class="qitem">
            <span class="qvotes">▲ ${q.votes}</span>
            <p>${PB.esc(q.text)}</p>
            <button class="hide-q" data-q="${q.id}" title="Hide">✕</button>
          </li>`).join('')
      : '<li class="empty">Questions from the room show up here.</li>';
  }

  function renderReactions() {
    const r = state.reactions;
    $('reactions').innerHTML = Object.entries(PB.REACTIONS)
      .map(([k, emoji]) => `<div>${emoji}<span>${r[k] || 0}</span></div>`)
      .join('');

    if (lastReactions) {
      for (const [k, emoji] of Object.entries(PB.REACTIONS)) {
        const diff = Math.min((r[k] || 0) - (lastReactions[k] || 0), 6);
        for (let i = 0; i < diff; i++) float(emoji, i);
      }
    }
    lastReactions = r;
  }

  function float(emoji, i) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = emoji;
    el.style.left = `${5 + Math.random() * 90}%`;
    el.style.animationDelay = `${i * 120}ms`;
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function renderInfra() {
    const s = state.servedBy;
    const now = Date.now();

    trail.push(s.instance);
    if (trail.length > 24) trail.shift();
    seenByScreen.set(s.instance, { lastSeen: now, revision: s.revision });

    $('chip-storage').className = 'chip ' + state.app.storage;
    $('chip-storage').textContent = `v${state.app.version} · storage: ${state.app.storage}`;
    $('chip-rev').textContent = `revision ${PB.shortRevision(s.revision)}`;
    const served = $('chip-served');
    served.querySelector('.dot').style.background = PB.instanceColor(s.instance);
    served.querySelector('span').textContent = `this frame: ${s.instance}`;

    // Merge what the store knows (v2: every instance) with what this
    // screen has seen itself (v1: the only way to learn about others).
    const merged = new Map();
    for (const inst of state.instances) {
      merged.set(inst.id, { id: inst.id, revision: inst.revision, requests: inst.requests, lastSeen: inst.lastSeen });
    }
    for (const [id, seen] of seenByScreen) {
      const m = merged.get(id) || { id, revision: seen.revision, requests: null };
      // Clocks differ between machines, so trust whichever is fresher.
      m.lastSeen = Math.max(m.lastSeen || 0, seen.lastSeen);
      merged.set(id, m);
    }

    const tiles = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
    const live = tiles.filter((t) => now - t.lastSeen < STALE_MS);

    $('instances').innerHTML = tiles.map((t) => {
      const isNew = !knownTiles.has(t.id);
      knownTiles.add(t.id);
      const stale = now - t.lastSeen >= STALE_MS;
      return `
        <div class="inst ${t.id === s.instance ? 'current' : ''} ${stale ? 'stale' : ''} ${isNew ? 'new' : ''}"
             style="background:${PB.instanceColor(t.id)}">
          <b>${PB.esc(t.id)}</b>
          <small>rev ${PB.esc(PB.shortRevision(t.revision))}${t.requests != null ? ' · ' + t.requests + ' req' : ''}</small>
        </div>`;
    }).join('');

    $('trail').innerHTML = trail
      .map((id) => `<i title="${PB.esc(id)}" style="background:${PB.instanceColor(id)}"></i>`)
      .join('');
    $('inst-count').textContent = `${live.length} live`;

    // The v1 lesson, spelled out on screen.
    const distinct = new Set(trail).size;
    const warn = $('warning');
    if (state.app.storage === 'memory' && distinct > 1) {
      warn.innerHTML =
        `<b>Heads up:</b> this screen is talking to <b>${distinct} instances</b>, and each one keeps ` +
        `its own votes in memory. The totals change depending on which instance answers. ` +
        `That is why Cloud Run apps must be <b>stateless</b>.`;
      warn.classList.add('show');
    } else {
      warn.classList.remove('show');
    }
  }

  async function refresh() {
    try {
      state = await PB.api('/api/state');
      renderPoll();
      renderQuestions();
      renderReactions();
      renderInfra();
    } catch (err) {
      $('chip-served').querySelector('span').textContent = 'reconnecting…';
    }
  }

  // ---- presenter controls ----

  async function movePoll(step) {
    if (!state) return;
    const idx = state.polls.findIndex((p) => p.id === state.activePollId);
    const next = state.polls[(idx + step + state.polls.length) % state.polls.length];
    try {
      await PB.api('/api/admin/poll', { key: adminKey, pollId: next.id });
      refresh();
    } catch (err) {
      alert(err.message);
    }
  }
  $('prev').addEventListener('click', () => movePoll(-1));
  $('next').addEventListener('click', () => movePoll(1));
  document.addEventListener('keydown', (e) => {
    if (!adminKey) return;
    if (e.key === 'ArrowRight') movePoll(1);
    if (e.key === 'ArrowLeft') movePoll(-1);
  });

  $('questions').addEventListener('click', async (e) => {
    const btn = e.target.closest('.hide-q');
    if (!btn) return;
    try {
      await PB.api(`/api/admin/questions/${btn.dataset.q}/hide`, { key: adminKey });
      refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  refresh();
  setInterval(refresh, POLL_MS);
})();
