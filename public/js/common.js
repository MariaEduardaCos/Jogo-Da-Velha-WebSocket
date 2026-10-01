(function () {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const TAB_ID_KEY = 'ws3TabId';
  const AUTH_KEY = 'ws3Auth';
  const GAME_SESSION_KEY = 'ws3Session';

  window.WS3_URL = `${scheme}://${location.host}/tictactoe`;

  // Cada aba possui sua própria identidade. sessionStorage é isolado por aba,
  // permitindo Conta A na aba 1 e Conta B na aba 2 do mesmo navegador.
  const tabId = sessionStorage.getItem(TAB_ID_KEY)
    || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  sessionStorage.setItem(TAB_ID_KEY, tabId);

  const sockets = new Set();

  function registerSocket(socket) {
    if (!socket) return socket;
    sockets.add(socket);
    socket.addEventListener('close', () => sockets.delete(socket), { once: true });
    return socket;
  }

  // Mantido por compatibilidade com os scripts das telas. Não há mais bloqueio
  // entre abas: cada uma pode operar de forma independente com sua própria conta.
  function handleControlMessage(message) {
    if (message?.type !== 'SESSION_TAKEN_OVER') return false;
    // Esse evento só pode ocorrer se duas abas reutilizarem exatamente o mesmo
    // token de autenticação. Ele não afeta contas diferentes.
    notify(message.message || 'Esta sessão de autenticação foi aberta em outra aba.', 'error');
    return true;
  }

  function notify(message, kind = '') {
    const el = document.getElementById('notice');
    if (!el) return;
    el.textContent = message;
    el.className = `notice show ${kind}`;
    clearTimeout(window.__noticeTimer);
    window.__noticeTimer = setTimeout(() => el.className = 'notice', 3600);
  }

  window.ws3 = {
    tabId,
    async ensureActiveTab() { return true; },
    isTabActive() { return true; },
    registerSocket,
    handleControlMessage,
    wasTakenOver(event) { return Number(event?.code) === 4001; },
    notify,
    saveSession(state) {
      const current = JSON.parse(sessionStorage.getItem(GAME_SESSION_KEY) || '{}');
      sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify({ ...current, ...state }));
    },
    getSession() {
      try { return JSON.parse(sessionStorage.getItem(GAME_SESSION_KEY) || '{}'); }
      catch { return {}; }
    },
    clearSession() { sessionStorage.removeItem(GAME_SESSION_KEY); },
    saveAuth(data) {
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(data));
    },
    getAuth() {
      try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || '{}'); }
      catch { return {}; }
    },
    clearAuth() {
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(GAME_SESSION_KEY);
    },
    async requireAuth() {
      const auth = this.getAuth();
      if (!auth.token) {
        location.replace('/login.html');
        return null;
      }
      try {
        const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${auth.token}` } });
        if (!response.ok) throw new Error('expired');
        const data = await response.json();
        this.saveAuth({ ...auth, user: data.user });
        return { ...auth, user: data.user };
      } catch {
        this.clearAuth();
        location.replace('/login.html');
        return null;
      }
    },
    authSocket(socket, token) {
      socket.send(JSON.stringify({ type: 'AUTH', authToken: token, tabId }));
    },
    formatDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const min = Math.floor(total / 60);
      const sec = total % 60;
      return `${min}min ${String(sec).padStart(2, '0')}s`;
    }
  };
})();
