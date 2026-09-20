const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./src/roomManager');

const PORT = Number(process.env.PORT || 8080);
const app = express();
const server = http.createServer(app);
const rooms = new RoomManager();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.redirect('/tela1-lobby.html'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

const wss = new WebSocketServer({ server, path: '/tictactoe' });

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
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function emitMatchStarted(room) {
  room.players.forEach(player => {
    if (player?.socket) {
      send(player.socket, { type: 'MATCH_STARTED', ...rooms.makeState(room, player) });
    }
  });
}

function emitBoard(room, reason = 'MOVE') {
  rooms.broadcast(room, {
    type: 'BOARD_UPDATE',
    board: room.board,
    nextTurn: room.currentTurn,
    reason,
    turnDeadline: room.turnDeadline,
    scores: {
      host: room.scores[0],
      guest: room.scores[1],
      hostName: room.players[0]?.name,
      guestName: room.players[1]?.name
    }
  });
}

wss.on('connection', ws => {
  send(ws, { type: 'CONNECTED', message: 'WebSocket conectado.' });
  broadcastLobby();

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'ERROR', message: 'Payload JSON inválido.' });
      return;
    }

    const type = String(msg.type || '').toUpperCase();

    if (type === 'CREATE_ROOM') {
      const playerName = String(msg.player || msg.playerName || '').trim().slice(0, 40);
      if (!playerName) return send(ws, { type: 'ERROR', message: 'Informe seu apelido.' });
      const { room, player } = rooms.createRoom(playerName, ws, true);
      send(ws, { type: 'ROOM_JOINED', ...rooms.makeState(room, player) });
      broadcastLobby();
      return;
    }

    if (type === 'QUICK_MATCH') {
      const playerName = String(msg.player || msg.playerName || '').trim().slice(0, 40);
      if (!playerName) return send(ws, { type: 'ERROR', message: 'Informe seu apelido.' });
      const result = rooms.findQuickMatch(playerName, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.room.players[1]) emitMatchStarted(result.room);
      else send(ws, { type: 'ROOM_JOINED', ...rooms.makeState(result.room, result.player), waiting: true });
      broadcastLobby();
      return;
    }

    if (type === 'JOIN_ROOM' || type === 'JOIN_GAME') {
      const playerName = String(msg.player || msg.playerName || '').trim().slice(0, 40);
      const roomCode = String(msg.roomCode || '').trim().toUpperCase();
      if (!playerName || !roomCode) return send(ws, { type: 'ERROR', message: 'Apelido e código da sala são obrigatórios.' });
      const result = rooms.joinRoom(roomCode, playerName, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      emitMatchStarted(result.room);
      broadcastLobby();
      return;
    }

    if (type === 'RESUME_SESSION') {
      const result = rooms.resume(msg.roomCode, msg.sessionToken, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error, code: 'SESSION_EXPIRED' });
      send(ws, { type: 'SESSION_RESUMED', ...rooms.makeState(result.room, result.player) });
      rooms.broadcast(result.room, { type: 'PLAYER_RECONNECTED', playerName: result.player.name }, ws);
      return;
    }

    if (type === 'MOVE') {
      const result = rooms.move(msg.roomCode, ws, msg.position, msg.playerSymbol);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.invalid) return send(ws, { type: 'INVALID_MOVE', message: result.invalid });

      if (result.gameOver) {
        emitBoard(result.room, 'FINAL_MOVE');
        const durationMs = Date.now() - result.room.startedAt;
        rooms.broadcast(result.room, {
          type: 'GAME_OVER',
          result: result.gameOver.result,
          winnerSymbol: result.gameOver.winnerSymbol,
          winningLine: result.gameOver.winningLine,
          durationMs,
          scores: {
            host: result.room.scores[0],
            guest: result.room.scores[1],
            hostName: result.room.players[0]?.name,
            guestName: result.room.players[1]?.name
          }
        });
      } else {
        emitBoard(result.room);
      }
      return;
    }

    if (type === 'CHAT' || type === 'CHAT_MESSAGE') {
      const result = rooms.addChat(msg.roomCode, ws, msg.message || msg.text);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      rooms.broadcast(result.room, {
        type: 'CHAT_MESSAGE',
        sender: result.player.name,
        message: result.text,
        timestamp: Date.now()
      });
      return;
    }

    if (type === 'NEW_GAME') {
      const result = rooms.requestRematch(msg.roomCode, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      rooms.broadcast(result.room, {
        type: 'NEW_GAME_REQUEST',
        requestedBy: result.player.name
      }, ws);
      send(ws, { type: 'NEW_GAME_WAITING', message: 'Solicitação de revanche enviada.' });
      return;
    }

    if (type === 'ACCEPT_NEW_GAME') {
      const result = rooms.acceptRematch(msg.roomCode, ws);
      if (result.error) return send(ws, { type: 'ERROR', message: result.error });
      if (result.started) {
        result.room.players.forEach(player => send(player.socket, {
          type: 'NEW_GAME_STARTED',
          ...rooms.makeState(result.room, player)
        }));
      }
      return;
    }

    if (type === 'DECLINE_NEW_GAME') {
      const left = rooms.leaveRoom(msg.roomCode, ws);
      if (left) rooms.broadcast(left.room, { type: 'PLAYER_LEFT', playerName: left.player.name }, ws);
      broadcastLobby();
      return;
    }

    if (type === 'LEAVE_ROOM') {
      const left = rooms.leaveRoom(msg.roomCode, ws);
      if (left) rooms.broadcast(left.room, { type: 'PLAYER_LEFT', playerName: left.player.name }, ws);
      broadcastLobby();
      return;
    }
  });

  ws.on('close', () => {
    const disconnected = rooms.disconnect(ws, (room, loser, winner) => {
      rooms.broadcast(room, {
        type: 'GAME_OVER',
        result: 'FORFEIT',
        winnerSymbol: winner?.symbol || null,
        winnerName: winner?.name || null,
        message: `${loser.name} não reconectou em 30 segundos. Vitória por W.O.`,
        scores: {
          host: room.scores[0],
          guest: room.scores[1],
          hostName: room.players[0]?.name,
          guestName: room.players[1]?.name
        }
      });
      broadcastLobby();
    });

    if (disconnected?.room?.status === 'EM_JOGO') {
      rooms.broadcast(disconnected.room, {
        type: 'PLAYER_DISCONNECTED',
        playerName: disconnected.player.name,
        graceSeconds: 30
      });
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/tictactoe`);
});
