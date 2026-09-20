const session = window.ws3.getSession();
if (!session.roomCode || !session.sessionToken) location.replace('/tela1-lobby.html');

const roomLabel = document.getElementById('roomLabel');
const scoreLabel = document.getElementById('scoreLabel');
const turnBanner = document.getElementById('turnBanner');
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
let connectedOnce = false;
let countdownTimer;
let winningLine = [];

roomLabel.textContent = `SALA ${state.roomCode} — JOGO DA VELHA MULTIPLAYER`;

function connect() {
  socket = new WebSocket(window.WS3_URL);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'RESUME_SESSION',
      roomCode: state.roomCode,
      sessionToken: state.sessionToken
    }));
    connectedOnce = true;
  });
  socket.addEventListener('close', () => {
    turnBanner.className = 'turn-banner danger';
    turnBanner.textContent = 'Conexão interrompida. Tentando reconectar...';
    setTimeout(connect, 1000);
  });
  socket.addEventListener('message', onMessage);
}

function onMessage(event) {
  const msg = JSON.parse(event.data);
  if (msg.type === 'SESSION_RESUMED' || msg.type === 'NEW_GAME_STARTED') {
    state = { ...state, ...msg };
    winningLine = [];
    window.ws3.saveSession(state);
    modal.classList.remove('show');
    updateAll();
  }
  if (msg.type === 'BOARD_UPDATE') {
    state.board = msg.board;
    state.nextTurn = msg.nextTurn;
    state.turnDeadline = msg.turnDeadline;
    if (msg.scores) state.scores = msg.scores;
    renderBoard();
    renderScore();
    renderTurn();
    if (msg.reason === 'TURN_TIMEOUT') window.ws3.notify('Tempo esgotado. A vez passou para o adversário.');
  }
  if (msg.type === 'INVALID_MOVE') window.ws3.notify(msg.message, 'error');
  if (msg.type === 'CHAT_MESSAGE') appendChat(msg.sender, msg.message);
  if (msg.type === 'PLAYER_DISCONNECTED') {
    window.ws3.notify(`Adversário desconectado. Aguardando reconexão por ${msg.graceSeconds}s...`, 'error');
  }
  if (msg.type === 'PLAYER_RECONNECTED') window.ws3.notify(`${msg.playerName} reconectou à sala.`, 'success');
  if (msg.type === 'NEW_GAME_REQUEST') {
    modal.classList.add('show');
    modalTitle.textContent = 'REVANCHE SOLICITADA';
    modalFoot.textContent = `${msg.requestedBy} solicitou uma revanche.`;
    rematchBtn.textContent = 'ACEITAR REVANCHE';
    rematchBtn.dataset.mode = 'accept';
  }
  if (msg.type === 'NEW_GAME_WAITING') {
    modalFoot.textContent = 'Aguardando resposta do oponente via WebSocket...';
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
    const disabled = Boolean(value) || !mine || state.status === 'FINALIZADA';
    const cls = `${value === 'O' ? 'o' : ''} ${winningLine.includes(index) ? 'win' : ''}`;
    return `<button class="cell ${cls}" data-pos="${index}" ${disabled ? 'disabled' : ''}>${value || ''}</button>`;
  }).join('');
  boardEl.querySelectorAll('[data-pos]').forEach(cell => cell.addEventListener('click', () => play(Number(cell.dataset.pos))));
}

function renderTurn() {
  clearInterval(countdownTimer);
  const update = () => {
    const seconds = Math.max(0, Math.ceil((Number(state.turnDeadline || Date.now()) - Date.now()) / 1000));
    const mine = state.nextTurn === state.symbol;
    turnBanner.className = `turn-banner ${mine ? '' : 'waiting'}`;
    turnBanner.textContent = mine
      ? `VOCÊ É O '${state.symbol}' | SUA VEZ DE JOGAR! (Cronômetro: ${seconds}s)`
      : `VOCÊ É O '${state.symbol}' | AGUARDANDO ${state.nextTurn}... (${seconds}s)`;
  };
  update();
  countdownTimer = setInterval(update, 250);
}

function play(position) {
  socket.send(JSON.stringify({
    type: 'MOVE', roomCode: state.roomCode, position, playerSymbol: state.symbol
  }));
}

function appendChat(sender, message) {
  const p = document.createElement('p');
  p.className = 'chat-msg';
  const strong = document.createElement('strong');
  strong.textContent = `${sender}: `;
  p.append(strong, document.createTextNode(message));
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  socket.send(JSON.stringify({ type: 'CHAT', roomCode: state.roomCode, message }));
  chatInput.value = '';
});

function showGameOver(msg) {
  state.status = 'FINALIZADA';
  if (msg.scores) state.scores = msg.scores;
  winningLine = msg.winningLine || [];
  renderBoard();
  renderScore();
  modal.classList.add('show');
  rematchBtn.disabled = false;
  rematchBtn.dataset.mode = 'request';
  rematchBtn.textContent = 'SOLICITAR REVANCHE [WS]';

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
  if (rematchBtn.dataset.mode === 'accept') {
    socket.send(JSON.stringify({ type: 'ACCEPT_NEW_GAME', roomCode: state.roomCode }));
    modalFoot.textContent = 'Revanche aceita. Reiniciando...';
    rematchBtn.disabled = true;
  } else {
    socket.send(JSON.stringify({ type: 'NEW_GAME', roomCode: state.roomCode }));
  }
});

leaveBtn.addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'LEAVE_ROOM', roomCode: state.roomCode }));
  goLobby();
});

function goLobby() {
  window.ws3.clearSession();
  location.replace('/tela1-lobby.html');
}

window.addEventListener('beforeunload', () => {
  // Não envia LEAVE_ROOM aqui: o RF-08 exige tolerância de 30 s para reconexão.
});

updateAll();
connect();
