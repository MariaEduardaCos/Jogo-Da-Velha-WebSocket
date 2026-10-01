const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./src/roomManager');
const db = require('./src/database');

const PORT = Number(process.env.PORT || 8080);
const WS_PATH = '/tictactoe';
const app = express();
const server = http.createServer(app);
const rooms = new RoomManager();
const moveTimings = [];

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/login.html'));

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id_jogador,
    nickname: user.nickname,
    email: user.email,
    isGuest: Boolean(user.is_guest),
    wins: user.vitorias_totais,
    losses: user.derrotas_totais,
    registeredAt: user.data_registro
  };
}

function extractBearer(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireAuth(req, res, next) {
  const user = db.getUserByAuthToken(extractBearer(req));
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  req.user = user;
  next();
}

app.post('/api/auth/register', (req, res) => {
  const nickname = String(req.body?.nickname || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[\p{L}\p{N}_ .-]{3,40}$/u.test(nickname)) return res.status(400).json({ error: 'Apelido deve ter entre 3 e 40 caracteres.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  if (db.userExists(nickname, email)) return res.status(409).json({ error: 'E-mail ou apelido já cadastrado.' });
  try {
    const user = db.createUser(nickname, email, password);
    const session = db.createAuthSession(user.id_jogador);
    return res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Falha ao cadastrar usuário:', error.message);
    return res.status(500).json({ error: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.authenticateUser(email, password);
  if (!user) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  const session = db.createAuthSession(user.id_jogador);
  res.json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(user) });
});

app.post('/api/auth/guest', (_req, res) => {
  try {
    const user = db.createGuestUser();
    const session = db.createAuthSession(user.id_jogador, 1);
    return res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(user) });
  } catch (error) {
    console.error('Falha ao criar visitante:', error.message);
    return res.status(500).json({ error: 'Não foi possível iniciar a sessão de visitante.' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: sanitizeUser(req.user) }));
app.post('/api/auth/logout', (req, res) => {
  db.revokeAuthToken(extractBearer(req));
  res.status(204).end();
});

function timingStats() {
  const values = [...moveTimings].sort((a, b) => a - b);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const p95 = values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] : 0;
  return { samples: values.length, averageMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)), targetMs: 50 };
}

app.get('/health', (_req, res) => res.json({
  ok: true,
  rooms: rooms.rooms.size,
  websocket: `ws://localhost:${PORT}${WS_PATH}`,
  websocketHandshakeStatus: 101,
  moveProcessing: timingStats()
}));

// O upgrade HTTP -> WebSocket é tratado explicitamente. Em uma conexão válida,
// ws.handleUpgrade responde com HTTP/1.1 101 Switching Protocols.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== WS_PATH) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.handshakeStatus = 101;
    wss.emit('connection', ws, req);
  });
});

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastLobby() {
  const payload = JSON.stringify({
    type: 'LOBBY_UPDATE',
    rooms: rooms.listPublicRooms(),
    online: [...wss.clients].filter(client => client.readyState === 1).length,
    activeRooms: rooms.rooms.size
  });
  for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
}

function emitMatchStarted(room) {
  room.players.forEach(player => {
    if (player?.socket) send(player.socket, { type: 'MATCH_STARTED', ...rooms.makeState(room, player) });
  });
}

function emitBoard(room, reason = 'MOVE', serverProcessingMs = null) {
  rooms.broadcast(room, {
    type: 'BOARD_UPDATE',
    board: room.board,
    nextTurn: room.currentTurn,
    reason,
    turnDeadline: room.turnDeadline,
    turnSeconds: 15,
    serverProcessingMs,
    scores: {
      host: room.scores[0],
      guest: room.scores[1],
      hostName: room.players[0]?.name,
      guestName: room.players[1]?.name
    }
  });
}

function authKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function authWs(ws, token) {
  const user = db.getUserByAuthToken(token);
  if (!user) return null;

  // Não existe trava global por navegador/aba. Cada conexão WebSocket é autenticada
  // de forma independente, permitindo contas diferentes em abas do mesmo navegador.
  ws.authUser = user;
  ws.authKey = authKey(token);
  return user;
}

wss.on('connection', ws => {
  send(ws, {
    type: 'CONNECTED',
    message: 'WebSocket conectado.',
    endpoint: `ws://localhost:${PORT}${WS_PATH}`,
    handshakeStatus: 101
  });
  broadcastLobby();

  ws.on('error', () => {});

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: 'ERROR', message: 'Payload JSON inválido.' }); }

    const type = String(msg.type || '').toUpperCase();

    if (type === 'AUTH') {
      const user = authWs(ws, msg.authToken);
      if (!user) return send(ws, { type: 'AUTH_ERROR', message: 'Autenticação inválida ou expirada.' });
      return send(ws, { type: 'AUTH_OK', user: sanitizeUser(user), handshakeStatus: ws.handshakeStatus || 101 });
    }

    if (!ws.authUser) return send(ws, { type: 'AUTH_ERROR', message: 'Autentique a conexão antes de usar o jogo.' });

    if (type === 'CREATE_ROOM') {
      if (ws.authUser.is_guest) {
        return send(ws, {
          type: 'ERROR',
          code: 'GUEST_PRIVATE_ROOM_FORBIDDEN',
          message: 'Visitantes podem jogar e entrar em salas, mas não podem criar salas privadas.'
        });
      }
      const { room, player } = rooms.createRoom(ws.authUser, ws, true);
      send(ws, { type: 'ROOM_JOINED', ...rooms.makeState(room, player), waiting: true });
      broadcastLobby();
      return;
    }

    if (type === 'QUICK_MATCH') {
      const result = rooms.findQuickMatch(ws.authUser, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.room.players[1]) emitMatchStarted(result.room);
      else send(ws, { type: 'ROOM_JOINED', ...rooms.makeState(result.room, result.player), waiting: true });
      broadcastLobby();
      return;
    }

    if (type === 'JOIN_ROOM' || type === 'JOIN_GAME') {
      const roomCode = String(msg.roomCode || '').trim().toUpperCase();
      if (!roomCode) return send(ws, { type: 'ERROR', message: 'Código da sala é obrigatório.' });
      const result = rooms.joinRoom(roomCode, ws.authUser, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      emitMatchStarted(result.room);
      broadcastLobby();
      return;
    }

    if (type === 'RESUME_SESSION') {
      const result = rooms.resume(msg.roomCode, msg.sessionToken, ws, ws.authUser.id_jogador);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error, code: 'SESSION_EXPIRED' });
      send(ws, { type: 'SESSION_RESUMED', ...rooms.makeState(result.room, result.player) });
      rooms.broadcast(result.room, {
        type: 'PLAYER_RECONNECTED',
        playerName: result.player.name,
        message: 'Jogador reconectado dentro da tolerância de 30 segundos. Partida retomada com 15 segundos no turno.'
      }, ws);
      return;
    }

    if (type === 'MOVE') {
      const started = performance.now();
      const result = rooms.move(msg.roomCode, ws, msg.position);
      const elapsed = Number((performance.now() - started).toFixed(2));
      moveTimings.push(elapsed);
      if (moveTimings.length > 100) moveTimings.shift();

      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.invalid) return send(ws, { type: 'INVALID_MOVE', message: result.invalid });
      if (result.gameOver) {
        emitBoard(result.room, 'FINAL_MOVE', elapsed);
        const durationMs = Date.now() - result.room.startedAt;
        rooms.broadcast(result.room, {
          type: 'GAME_OVER',
          result: result.gameOver.result,
          winnerSymbol: result.gameOver.winnerSymbol,
          winningLine: result.gameOver.winningLine,
          durationMs,
          serverProcessingMs: elapsed,
          scores: {
            host: result.room.scores[0],
            guest: result.room.scores[1],
            hostName: result.room.players[0]?.name,
            guestName: result.room.players[1]?.name
          }
        });
      } else {
        emitBoard(result.room, 'MOVE', elapsed);
      }
      return;
    }

    if (type === 'CHAT' || type === 'CHAT_MESSAGE') {
      const result = rooms.addChat(msg.roomCode, ws, msg.message || msg.text);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      rooms.broadcast(result.room, {
        type: 'CHAT_MESSAGE',
        senderId: result.player.id,
        sender: result.player.name,
        message: result.text,
        timestamp: Date.now()
      });
      return;
    }

    if (type === 'NEW_GAME') {
      const result = rooms.requestRematch(msg.roomCode, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      rooms.broadcast(result.room, { type: 'NEW_GAME_REQUEST', requestedBy: result.player.name }, ws);
      send(ws, { type: 'NEW_GAME_WAITING', message: 'Solicitação de revanche enviada.' });
      return;
    }

    if (type === 'ACCEPT_NEW_GAME') {
      const result = rooms.acceptRematch(msg.roomCode, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.started) result.room.players.forEach(player => send(player.socket, { type: 'NEW_GAME_STARTED', ...rooms.makeState(result.room, player) }));
      return;
    }

    if (type === 'DECLINE_NEW_GAME' || type === 'LEAVE_ROOM') {
      const left = rooms.leaveRoom(msg.roomCode, ws);
      if (left) rooms.broadcast(left.room, { type: 'PLAYER_LEFT', playerName: left.player.name }, ws);
      broadcastLobby();
    }
  });

  ws.on('close', code => {
    const takeover = ws.sessionTakenOver || Number(code) === 4001;
    const disconnected = rooms.disconnect(ws, (room, loser, winner) => {
      rooms.broadcast(room, {
        type: 'GAME_OVER',
        result: 'FORFEIT',
        winnerSymbol: winner?.symbol || null,
        winnerName: winner?.name || null,
        message: `${loser.name} não reconectou em 30 segundos. Vitória por W.O. confirmada.`,
        durationMs: room.startedAt ? Date.now() - room.startedAt : null,
        scores: {
          host: room.scores[0],
          guest: room.scores[1],
          hostName: room.players[0]?.name,
          guestName: room.players[1]?.name
        }
      });
      broadcastLobby();
    });

    if (disconnected?.room?.status === 'EM_JOGO' && !takeover) {
      rooms.broadcast(disconnected.room, {
        type: 'PLAYER_DISCONNECTED',
        playerName: disconnected.player.name,
        graceSeconds: 30,
        provisionalForfeit: true,
        message: 'Vitória por W.O. — aguardando 30 segundos para confirmar caso o adversário não reconecte.'
      });
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
