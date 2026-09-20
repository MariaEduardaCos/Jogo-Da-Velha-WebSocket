(function () {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  window.WS3_URL = `${scheme}://${location.host}/tictactoe`;
  window.ws3 = {
    notify(message, kind = '') {
      const el = document.getElementById('notice');
      if (!el) return;
      el.textContent = message;
      el.className = `notice show ${kind}`;
      clearTimeout(window.__noticeTimer);
      window.__noticeTimer = setTimeout(() => el.className = 'notice', 3200);
    },
    saveSession(state) {
      const current = JSON.parse(sessionStorage.getItem('ws3Session') || '{}');
      sessionStorage.setItem('ws3Session', JSON.stringify({ ...current, ...state }));
    },
    getSession() {
      try { return JSON.parse(sessionStorage.getItem('ws3Session') || '{}'); }
      catch { return {}; }
    },
    clearSession() { sessionStorage.removeItem('ws3Session'); },
    formatDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const min = Math.floor(total / 60);
      const sec = total % 60;
      return `${min}min ${String(sec).padStart(2, '0')}s`;
    }
  };
})();
