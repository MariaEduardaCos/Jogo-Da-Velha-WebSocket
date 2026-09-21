const code = document.getElementById('roomCode');
const roomsBody = document.getElementById('roomsBody');
const serverStatus = document.getElementById('serverStatus');
const createBtn = document.getElementById('createRoom');
const quickBtn = document.getElementById('quickMatch');
const joinBtn = document.getElementById('joinRoom');
const nicknameEl = document.getElementById('nickname');
const recordEl = document.getElementById('record');
const profileType = document.getElementById('profileType');
const privateRoomHint = document.getElementById('privateRoomHint');
const playerSummary = document.getElementById('playerSummary');
const logoutBtn = document.getElementById('logoutBtn');

let socket;
let auth;
let authenticatedSocket = false;
let allowReconnect = true;

async function init() {
  const active = await window.ws3.ensureActiveTab();
  if (!active) return;
  auth = await window.ws3.requireAuth();
  if (!auth) return;
  renderProfile(auth.user);
  const previousGame = window.ws3.getSession();
  if (previousGame.roomCode && previousGame.sessionToken) {
    location.replace(previousGame.status === 'AGUARDANDO' ? '/tela-espera.html' : '/tela2-arena.html');
    return;
  }
  connect();
}

function renderProfile(user) {
  const guest = Boolean(user.isGuest);
  nicknameEl.textContent = user.nickname;
  profileType.textContent = guest ? 'Jogador visitante' : 'Jogador autenticado';
  recordEl.textContent = guest ? 'Sessão de visitante' : `${user.wins ?? 0} vitórias · ${user.losses ?? 0} derrotas`;
  playerSummary.textContent = guest
    ? `${user.nickname} | VISITANTE`
    : `${user.nickname} | ${user.wins ?? 0}V ${user.losses ?? 0}D`;
  createBtn.disabled = guest;
  privateRoomHint.classList.toggle('hidden', !guest);
  privateRoomHint.textContent = guest ? 'Visitantes podem entrar em salas privadas por código, mas não podem criar uma.' : '';
}

function connect() {
  if (!allowReconnect || !window.ws3.isTabActive()) return;
  socket = window.ws3.registerSocket(new WebSocket(window.WS3_URL));
  socket.addEventListener('open', () => {
    serverStatus.textContent = 'AUTENTICANDO CONEXÃO WEBSOCKET...';
    window.ws3.authSocket(socket, auth.token);
  });
  socket.addEventListener('close', event => {
    authenticatedSocket = false;
    if (!allowReconnect || window.ws3.wasTakenOver(event) || !window.ws3.isTabActive()) return;
    serverStatus.textContent = 'RECONECTANDO...';
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (window.ws3.handleControlMessage(msg)) {
      allowReconnect = false;
      return;
    }
    if (msg.type === 'AUTH_OK') {
      authenticatedSocket = true;
      serverStatus.textContent = 'SERVIDOR ONLINE';
      if (msg.user) {
        auth.user = msg.user;
        window.ws3.saveAuth(auth);
        renderProfile(msg.user);
      }
    }
    if (msg.type === 'AUTH_ERROR') {
      allowReconnect = false;
      window.ws3.clearAuth();
      location.replace('/login.html');
    }
    if (msg.type === 'LOBBY_UPDATE') {
      serverStatus.textContent = `SERVIDOR ONLINE | ${msg.activeRooms} SALA(S) ATIVA(S)`;
      renderRooms(msg.rooms || []);
    }
    if (msg.type === 'ROOM_JOINED') {
      window.ws3.saveSession(msg);
      if (msg.waiting) location.href = '/tela-espera.html';
    }
    if (msg.type === 'MATCH_STARTED') {
      window.ws3.saveSession(msg);
      location.href = '/tela2-arena.html';
    }
    if (msg.type === 'ERROR') window.ws3.notify(msg.message, 'error');
  });
}

function ready() {
  if (!window.ws3.isTabActive()) return false;
  if (!authenticatedSocket || socket?.readyState !== WebSocket.OPEN) {
    window.ws3.notify('Aguarde a conexão autenticada com o servidor.', 'error');
    return false;
  }
  return true;
}

function renderRooms(rooms) {
  if (!rooms.length) {
    roomsBody.innerHTML = `<tr><td colspan="4" class="empty">Nenhuma sala pública aguardando jogador.</td></tr>`;
    return;
  }
  roomsBody.innerHTML = rooms.map(room => `
    <tr>
      <td><strong>${room.roomCode}</strong></td>
      <td>${escapeHtml(room.host)}</td>
      <td>${room.occupancy}</td>
      <td><button class="link-button" data-code="${room.roomCode}">Entrar →</button></td>
    </tr>`).join('');
  roomsBody.querySelectorAll('[data-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      code.value = btn.dataset.code;
      doJoin();
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function doJoin() {
  if (!ready()) return;
  const roomCode = code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return window.ws3.notify('Informe um código de sala válido com 6 caracteres.', 'error');
  socket.send(JSON.stringify({ type: 'JOIN_ROOM', roomCode }));
}

createBtn.addEventListener('click', () => {
  if (!ready()) return;
  if (auth?.user?.isGuest) return window.ws3.notify('Visitantes não podem criar salas privadas.', 'error');
  socket.send(JSON.stringify({ type: 'CREATE_ROOM' }));
});
quickBtn.addEventListener('click', () => {
  if (!ready()) return;
  socket.send(JSON.stringify({ type: 'QUICK_MATCH' }));
});
joinBtn.addEventListener('click', doJoin);
code.addEventListener('input', () => code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));

logoutBtn.addEventListener('click', async () => {
  allowReconnect = false;
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } });
  } finally {
    window.ws3.clearAuth();
    location.replace('/login.html');
  }
});

init();
