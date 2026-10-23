// Helpers shared by the attendee page and the board.

const PB = (() => {
  const REACTIONS = {
    fire: '🔥',
    clap: '👏',
    rocket: '🚀',
    heart: '💙',
    laugh: '😂',
  };

  const BAR_COLORS = ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#57caff', '#ff7daf'];
  const INSTANCE_COLORS = [
    '#c3ecf6', '#f8d8d8', '#ffe7a5', '#ccf6c5',
    '#57caff', '#ff7daf', '#ffd427', '#5cdb6d',
  ];

  // localStorage can be blocked (private mode), so every access is guarded.
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
  };

  function voterId() {
    let id = storage.get('pb.voterId', null);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
        String(Date.now()) + '-' + Math.random().toString(16).slice(2, 10);
      storage.set('pb.voterId', id);
    }
    return id;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Same instance ID -> same colour, on every screen.
  function instanceColor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return INSTANCE_COLORS[h % INSTANCE_COLORS.length];
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function shortRevision(rev) {
    // "pulseboard-00003-k7x" -> "00003-k7x"
    const m = String(rev).match(/(\d{5}-[a-z0-9]+)$/);
    return m ? m[1] : rev;
  }

  return { REACTIONS, BAR_COLORS, storage, voterId, api, instanceColor, esc, shortRevision };
})();
