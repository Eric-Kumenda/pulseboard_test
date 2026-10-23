// Attendee (phone) view: vote, ask, upvote, react.

(() => {
  const me = PB.voterId();
  const myVotes = PB.storage.get('pb.myVotes', {});      // pollId -> optionId
  const myUpvotes = new Set(PB.storage.get('pb.myUpvotes', []));
  let state = null;

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function renderPoll() {
    const idx = Math.max(state.polls.findIndex((p) => p.id === state.activePollId), 0);
    const poll = state.polls[idx];
    const counts = state.counts[poll.id] || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const mine = myVotes[poll.id];

    $('poll-eyebrow').textContent = `Live poll · ${pad(idx + 1)} of ${pad(state.polls.length)}`;
    $('poll-q').textContent = poll.question;
    $('options').innerHTML = poll.options.map((o, i) => {
      const n = counts[o.id] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      return `
        <button class="option ${mine === o.id ? 'mine' : ''}" data-poll="${poll.id}" data-option="${o.id}">
          <i class="fill" style="width:${mine ? pct : 0}%"></i>
          <span class="n">${pad(i + 1)}</span>
          <span class="label">${PB.esc(o.label)}</span>
          <span class="pct">${mine ? pct + '%' : ''}</span>
        </button>`;
    }).join('');
  }

  function renderQuestions() {
    const list = state.questions.slice(0, 15);
    $('questions').innerHTML = list.length
      ? list.map((q, i) => `
          <li class="qitem ${i === 0 ? 'top' : ''}">
            <span class="num">${pad(i + 1)}</span>
            <p>${PB.esc(q.text)}</p>
            <button class="upvote ${myUpvotes.has(q.id) ? 'done' : ''}" data-q="${q.id}"
              aria-label="Upvote">▲ ${q.votes}</button>
          </li>`).join('')
      : '<li class="empty">No questions yet. Be the first!</li>';
  }

  function renderInfra() {
    const chip = $('storage-chip');
    chip.className = 'chip ' + state.app.storage;
    chip.textContent = `v${state.app.version} · ${state.app.storage}`;

    const served = $('served-chip');
    served.querySelector('.dot').style.background = PB.instanceColor(state.servedBy.instance);
    served.querySelector('span').textContent =
      `served by ${state.servedBy.instance} · rev ${PB.shortRevision(state.servedBy.revision)}`;
  }

  async function refresh() {
    try {
      state = await PB.api('/api/state');
      renderPoll();
      renderQuestions();
      renderInfra();
    } catch (err) {
      $('storage-chip').textContent = 'reconnecting…';
    }
  }

  // ---- interactions ----

  $('options').addEventListener('click', async (e) => {
    const btn = e.target.closest('.option');
    if (!btn) return;
    const { poll, option } = btn.dataset;
    try {
      const r = await PB.api('/api/vote', { pollId: poll, optionId: option, voterId: me });
      myVotes[poll] = option;
      PB.storage.set('pb.myVotes', myVotes);
      toast(`Vote counted by instance ${r.servedBy}`);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  $('ask-text').addEventListener('input', (e) => {
    $('ask-count').textContent = e.target.value.length;
  });

  $('ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('ask-text').value.trim();
    if (!text) return;
    try {
      const r = await PB.api('/api/questions', { text, voterId: me });
      myUpvotes.add(r.question.id);
      PB.storage.set('pb.myUpvotes', [...myUpvotes]);
      $('ask-text').value = '';
      $('ask-count').textContent = '0';
      toast('Question sent!');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  $('questions').addEventListener('click', async (e) => {
    const btn = e.target.closest('.upvote');
    if (!btn || myUpvotes.has(btn.dataset.q)) return;
    try {
      await PB.api(`/api/questions/${btn.dataset.q}/upvote`, { voterId: me });
      myUpvotes.add(btn.dataset.q);
      PB.storage.set('pb.myUpvotes', [...myUpvotes]);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  $('reactbar').innerHTML = Object.entries(PB.REACTIONS)
    .map(([k, emoji]) => `<button data-r="${k}" aria-label="${k}">${emoji}</button>`)
    .join('');
  $('reactbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    PB.api('/api/react', { kind: btn.dataset.r }).catch((err) => toast(err.message));
  });

  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 3000);
})();
