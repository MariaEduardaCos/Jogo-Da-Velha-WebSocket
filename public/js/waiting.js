const session = window.ws3.getSession();
const auth = window.ws3.getAuth();
if (!session.roomCode || !session.sessionToken || !auth.token) location.replace('/tela1-lobby.html');

const codeEl = document.getElementById('bigRoomCode');
const statusEl = document.getElementById('waitStatus');
const copyBtn = document.getElementById('copyCode');
const cancelBtn = document.getElementById('cancelRoom');
const headerEl = document.getElementById('waitingHeader');
const titleEl = document.getElementById('waitingTitle');
const instructionEl = document.getElementById('waitingInstruction');
const pulseTextEl = document.getElementById('waitingPulseText');
let socket;
let authenticated = false;
let allowReconnect = true;

codeEl.textContent = session.roomCode;
if (session.private) {
  headerEl.textContent = '▦  SALA PRIVADA — AGUARDANDO OPONENTE';
  titleEl.textContent = 'Sala privada criada com sucesso';
  instructionEl.textContent = 'Compartilhe este código com o segundo jogador:';
  pulseTextEl.textContent = 'Aguardando o companheiro entrar pelo código...';
} else {
  headerEl.textContent = '▦  PARTIDA RÁPIDA — AGUARDANDO OPONENTE';
  titleEl.textContent = 'Procurando adversário';
  instructionEl.textContent = 'Sua sala pública está disponível para pareamento:';
  pulseTextEl.textContent = 'Aguardando outro jogador entrar...';
}

function connect() {
  if (!allowReconnect || !window.ws3.isTabActive()) return;
  socket = window.ws3.registerSocket(new WebSocket(window.WS3_URL));
  socket.addEventListener('open', () => window.ws3.authSocket(socket, auth.token));
  socket.addEventListener('close', event => {
    authenticated = false;
    if (!allowReconnect || window.ws3.wasTakenOver(event) || !window.ws3.isTabActive()) return;
    statusEl.textContent = 'RECONECTANDO...';
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (window.ws3.handleControlMessage(msg)) {
      allowReconnect = false;
      return;
    }
    if (msg.type === 'AUTH_OK') {
      authenticated = true;
      statusEl.textContent = 'SERVIDOR ONLINE';
      socket.send(JSON.stringify({ type: 'RESUME_SESSION', roomCode: session.roomCode, sessionToken: session.sessionToken }));
    }
    if (msg.type === 'SESSION_RESUMED') {
      window.ws3.saveSession(msg);
      if (msg.status === 'EM_JOGO') location.replace('/tela2-arena.html');
    }
    if (msg.type === 'MATCH_STARTED') {
      window.ws3.saveSession(msg);
      location.replace('/tela2-arena.html');
    }
    if (msg.type === 'AUTH_ERROR') {
      allowReconnect = false;
      window.ws3.clearAuth();
      location.replace('/login.html');
    }
    if (msg.type === 'ERROR' && msg.code === 'SESSION_EXPIRED') {
      allowReconnect = false;
      window.ws3.clearSession();
      location.replace('/tela1-lobby.html');
    }
  });
}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(session.roomCode);
    window.ws3.notify('Código copiado para a área de transferência.', 'success');
  } catch {
    window.ws3.notify(`Código da sala: ${session.roomCode}`, 'success');
  }
});

cancelBtn.addEventListener('click', () => {
  allowReconnect = false;
  if (authenticated && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'LEAVE_ROOM', roomCode: session.roomCode }));
  window.ws3.clearSession();
  location.replace('/tela1-lobby.html');
});

(async function init() {
  const active = await window.ws3.ensureActiveTab();
  if (!active) return;
  connect();
})();
