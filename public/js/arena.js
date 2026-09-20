const session = window.ws3.getSession();
const auth = window.ws3.getAuth();
if (!session.roomCode || !session.sessionToken || !auth.token) location.replace('/login.html');

const roomLabel = document.getElementById('roomLabel');
const scoreLabel = document.getElementById('scoreLabel');
const turnBanner = document.getElementById('turnBanner');
const countdownPanel = document.getElementById('countdownPanel');
const countdownValue = document.getElementById('countdownValue');
const boardEl = document.getElementById('board');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const modal = document.getElementById('gameOverModal');
const modalTitle = document.getElementById('modalTitle');
const summary = document.getElementById('summary');
const rematchBtn = document.getElementById('rematchBtn');
const leaveBtn = document.getElementById('leaveBtn');
const modalFoot = document.getElementById('modalFoot');

let state = { ...session };
let socket;
let countdownTimer;
let winningLine = [];
let shouldReconnect = true;
let provisionalForfeit = false;

roomLabel.textContent = `SALA ${state.roomCode} — JOGO DA VELHA MULTIPLAYER`;

function connect() {
  if (!shouldReconnect || !window.ws3.isTabActive()) return;
  socket = window.ws3.registerSocket(new WebSocket(window.WS3_URL));
  socket.addEventListener('open', () => window.ws3.authSocket(socket, auth.token));
  socket.addEventListener('close', event => {
    if (!shouldReconnect || window.ws3.wasTakenOver(event) || !window.ws3.isTabActive()) return;
    turnBanner.className = 'turn-banner danger';
    turnBanner.textContent = 'Conexão interrompida. Tentando reconectar...';
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', onMessage);
}

function onMessage(event) {
  const msg = JSON.parse(event.data);
  if (window.ws3.handleControlMessage(msg)) {
    shouldReconnect = false;
    clearInterval(countdownTimer);
    return;
  }
  if (msg.type === 'AUTH_OK') {
    socket.send(JSON.stringify({ type: 'RESUME_SESSION', roomCode: state.roomCode, sessionToken: state.sessionToken }));
  }
  if (msg.type === 'AUTH_ERROR') {
    shouldReconnect = false;
    window.ws3.clearAuth();
    location.replace('/login.html');
  }
  if (msg.type === 'SESSION_RESUMED' || msg.type === 'NEW_GAME_STARTED') {
    if (msg.type === 'SESSION_RESUMED' && msg.status === 'FINALIZADA') {
      window.ws3.clearSession();
      shouldReconnect = false;
      location.replace('/tela1-lobby.html');
      return;
    }
    state = { ...state, ...msg };
    provisionalForfeit = false;
    winningLine = [];
    window.ws3.saveSession(state);
    modal.classList.remove('show');
    updateAll();
  }
  if (msg.type === 'BOARD_UPDATE') {
    state.board = msg.board;
    state.nextTurn = msg.nextTurn;
    state.turnDeadline = msg.turnDeadline;
    state.turnSeconds = msg.turnSeconds || 15;
    if (msg.scores) state.scores = msg.scores;
    provisionalForfeit = false;
    renderBoard();
    renderScore();
    renderTurn();
    if (msg.reason === 'TURN_TIMEOUT') window.ws3.notify('Tempo esgotado: nenhuma casa foi marcada, a vez passou ao adversário e o cronômetro reiniciou em 15 s.', 'error');
  }
  if (msg.type === 'INVALID_MOVE') window.ws3.notify(msg.message, 'error');
  if (msg.type === 'CHAT_MESSAGE') appendChat(msg.senderId, msg.sender, msg.message);
  if (msg.type === 'PLAYER_DISCONNECTED') {
    provisionalForfeit = true;
    clearInterval(countdownTimer);
    countdownPanel.classList.add('paused');
    countdownValue.textContent = '—';
    turnBanner.className = 'turn-banner danger';
    turnBanner.textContent = `VITÓRIA POR W.O. — confirmação em ${msg.graceSeconds}s se o adversário não reconectar.`;
    window.ws3.notify('Vitória por W.O. — aguardando 30 segundos para confirmação. Se o adversário reconectar, a partida continua.', 'error');
  }
  if (msg.type === 'PLAYER_RECONNECTED') {
    provisionalForfeit = false;
    countdownPanel.classList.remove('paused');
    window.ws3.notify(`${msg.playerName} reconectou. O W.O. foi cancelado e o turno recomeçou com 15 segundos.`, 'success');
    renderTurn();
  }
  if (msg.type === 'NEW_GAME_REQUEST') {
    modal.classList.add('show');
    modalTitle.textContent = 'REVANCHE SOLICITADA';
    modalFoot.textContent = `${msg.requestedBy} solicitou uma revanche.`;
    rematchBtn.textContent = 'ACEITAR REVANCHE';
    rematchBtn.dataset.mode = 'accept';
  }
  if (msg.type === 'NEW_GAME_WAITING') {
    modalFoot.textContent = 'Aguardando resposta do oponente...';
    rematchBtn.disabled = true;
  }
  if (msg.type === 'GAME_OVER') showGameOver(msg);
  if (msg.type === 'PLAYER_LEFT') {
    window.ws3.notify('Oponente saiu da sala. Retornando ao lobby.', 'error');
    setTimeout(goLobby, 1500);
  }
  if (msg.type === 'ERROR') {
    if (msg.code === 'SESSION_EXPIRED') return goLobby();
    window.ws3.notify(msg.message, 'error');
  }
}

function updateAll() {
  roomLabel.textContent = `SALA ${state.roomCode} — JOGO DA VELHA MULTIPLAYER`;
  renderBoard();
  renderScore();
  renderTurn();
}

function renderScore() {
  const s = state.scores || {};
  scoreLabel.textContent = `PLACAR: ${s.hostName || 'Host'} ${s.host ?? 0} × ${s.guest ?? 0} ${s.guestName || 'Visitante'}`;
}

function renderBoard() {
  const board = state.board || Array(9).fill(null);
  boardEl.innerHTML = board.map((value, index) => {
    const mine = state.nextTurn === state.symbol;
    const disabled = Boolean(value) || !mine || state.status === 'FINALIZADA' || provisionalForfeit;
    const cls = `${value === 'O' ? 'o' : ''} ${winningLine.includes(index) ? 'win' : ''}`;
    return `<button class="cell ${cls}" data-pos="${index}" ${disabled ? 'disabled' : ''} aria-label="Casa ${index + 1}${value ? `: ${value}` : ''}">${value || ''}</button>`;
  }).join('');
  boardEl.querySelectorAll('[data-pos]').forEach(cell => cell.addEventListener('click', () => play(Number(cell.dataset.pos))));
}

function renderTurn() {
  clearInterval(countdownTimer);
  if (provisionalForfeit || state.status === 'FINALIZADA') return;
  const update = () => {
    const seconds = Math.max(0, Math.ceil((Number(state.turnDeadline || Date.now()) - Date.now()) / 1000));
    const mine = state.nextTurn === state.symbol;
    countdownValue.textContent = seconds;
    countdownPanel.classList.toggle('danger', seconds <= 5);
    countdownPanel.classList.remove('paused');
    turnBanner.className = `turn-banner ${mine ? '' : 'waiting'}`;
    turnBanner.textContent = mine
      ? `VOCÊ É O '${state.symbol}' | SUA VEZ DE JOGAR!`
      : `VOCÊ É O '${state.symbol}' | AGUARDANDO ${state.nextTurn}...`;
  };
  update();
  countdownTimer = setInterval(update, 200);
}

function play(position) {
  if (!window.ws3.isTabActive()) return;
  if (socket?.readyState !== WebSocket.OPEN) return window.ws3.notify('Conexão indisponível.', 'error');
  socket.send(JSON.stringify({ type: 'MOVE', roomCode: state.roomCode, position }));
}

function appendChat(senderId, sender, message) {
  const own = String(senderId) === String(state.playerId);
  const row = document.createElement('div');
  row.className = `chat-row ${own ? 'own' : 'received'}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const author = document.createElement('div');
  author.className = 'chat-author';
  author.textContent = own ? 'Você' : sender;

  const text = document.createElement('div');
  text.className = 'chat-text';
  text.textContent = message;

  bubble.append(author, text);
  row.appendChild(bubble);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !window.ws3.isTabActive() || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'CHAT', roomCode: state.roomCode, message }));
  chatInput.value = '';
});

function showGameOver(msg) {
  provisionalForfeit = false;
  clearInterval(countdownTimer);
  state.status = 'FINALIZADA';
  if (msg.scores) state.scores = msg.scores;
  winningLine = msg.winningLine || [];
  renderBoard();
  renderScore();
  countdownPanel.classList.remove('danger');
  countdownValue.textContent = '0';
  modal.classList.add('show');
  rematchBtn.disabled = false;
  rematchBtn.dataset.mode = 'request';
  rematchBtn.textContent = 'SOLICITAR REVANCHE';

  let title = 'EMPATE!';
  let resultLine = 'A partida terminou em empate.';
  if (msg.result === 'WIN') {
    const iWon = msg.winnerSymbol === state.symbol;
    title = iWon ? '🏆 VITÓRIA! VOCÊ VENCEU!' : 'PARTIDA ENCERRADA';
    resultLine = iWon ? `Três símbolos '${state.symbol}' alinhados.` : `O adversário venceu com '${msg.winnerSymbol}'.`;
  }
  if (msg.result === 'FORFEIT') {
    const iWon = msg.winnerSymbol === state.symbol;
    title = iWon ? '🏆 VITÓRIA POR W.O.' : 'PARTIDA ENCERRADA POR W.O.';
    resultLine = msg.message || 'A partida foi encerrada por desconexão.';
  }
  modalTitle.textContent = title;
  const s = state.scores || {};
  summary.innerHTML = `
    <strong>RESUMO DA PARTIDA</strong><br>
    ${resultLine}<br>
    ${msg.durationMs != null ? `Tempo de jogo: ${window.ws3.formatDuration(msg.durationMs)}<br>` : ''}
    Novo placar geral: <strong>${s.hostName || 'Host'} ${s.host ?? 0} × ${s.guest ?? 0} ${s.guestName || 'Visitante'}</strong>
  `;
  modalFoot.textContent = 'Aguardando sua decisão.';
}

rematchBtn.addEventListener('click', () => {
  if (!window.ws3.isTabActive()) return;
  if (rematchBtn.dataset.mode === 'accept') {
    socket.send(JSON.stringify({ type: 'ACCEPT_NEW_GAME', roomCode: state.roomCode }));
    modalFoot.textContent = 'Revanche aceita. Reiniciando...';
    rematchBtn.disabled = true;
  } else {
    socket.send(JSON.stringify({ type: 'NEW_GAME', roomCode: state.roomCode }));
  }
});

leaveBtn.addEventListener('click', () => {
  shouldReconnect = false;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'LEAVE_ROOM', roomCode: state.roomCode }));
  goLobby();
});

function goLobby() {
  shouldReconnect = false;
  window.ws3.clearSession();
  location.replace('/tela1-lobby.html');
}

(async function init() {
  const active = await window.ws3.ensureActiveTab();
  if (!active) return;
  updateAll();
  connect();
})();
