const nick = document.getElementById('nickname');
const code = document.getElementById('roomCode');
const roomsBody = document.getElementById('roomsBody');
const serverStatus = document.getElementById('serverStatus');
const createBtn = document.getElementById('createRoom');
const quickBtn = document.getElementById('quickMatch');
const joinBtn = document.getElementById('joinRoom');

let socket;

function connect() {
  socket = new WebSocket(window.WS3_URL);
  socket.addEventListener('open', () => serverStatus.textContent = 'SERVIDOR ONLINE');
  socket.addEventListener('close', () => {
    serverStatus.textContent = 'RECONECTANDO...';
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'LOBBY_UPDATE') {
      serverStatus.textContent = `SERVIDOR ONLINE | ${msg.activeRooms} SALA(S) ATIVA(S)`;
      renderRooms(msg.rooms || []);
    }
    if (msg.type === 'ROOM_JOINED') {
      window.ws3.saveSession(msg);
      if (msg.waiting || !msg.opponentName) {
        window.ws3.notify(`Sala ${msg.roomCode} criada. Aguardando oponente...`, 'success');
      }
    }
    if (msg.type === 'MATCH_STARTED') {
      window.ws3.saveSession(msg);
      location.href = '/tela2-arena.html';
    }
    if (msg.type === 'ERROR') window.ws3.notify(msg.message, 'error');
  });
}

function validNick() {
  const value = nick.value.trim();
  if (!value) {
    window.ws3.notify('Informe seu apelido antes de continuar.', 'error');
    nick.focus();
    return null;
  }
  return value;
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
  const playerName = validNick();
  const roomCode = code.value.trim().toUpperCase();
  if (!playerName) return;
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return window.ws3.notify('Informe um código de sala válido com 6 caracteres.', 'error');
  socket.send(JSON.stringify({ type: 'JOIN_ROOM', playerName, roomCode }));
}

createBtn.addEventListener('click', () => {
  const playerName = validNick();
  if (!playerName) return;
  socket.send(JSON.stringify({ type: 'CREATE_ROOM', player: playerName }));
});
quickBtn.addEventListener('click', () => {
  const playerName = validNick();
  if (!playerName) return;
  socket.send(JSON.stringify({ type: 'QUICK_MATCH', player: playerName }));
});
joinBtn.addEventListener('click', doJoin);
code.addEventListener('input', () => code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));

connect();
