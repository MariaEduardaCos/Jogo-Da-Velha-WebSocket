const crypto = require('crypto');
const { createEmptyBoard, evaluateBoard } = require('./game');
const db = require('./database');

const TURN_SECONDS = 15;
const RECONNECT_GRACE_MS = 30_000;

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function makeCode(existingCodes) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (existingCodes.has(code));
  return code;
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => !room.private && room.status === 'AGUARDANDO' && room.players.filter(Boolean).length < 2)
      .map(room => ({
        roomCode: room.code,
        host: room.players[0]?.name || '-',
        occupancy: `${room.players.filter(Boolean).length}/2`
      }));
  }

  makePlayer(user, symbol, socket) {
    return {
      id: user.id_jogador,
      name: user.nickname,
      isGuest: Boolean(user.is_guest),
      symbol,
      socket,
      token: makeToken(),
      connected: true,
      reconnectTimer: null
    };
  }

  createRoom(user, socket, isPrivate = false) {
    const code = makeCode(new Set(this.rooms.keys()));
    const player = this.makePlayer(user, 'X', socket);
    const roomDbId = db.createRoom(player.id, code, isPrivate);
    const room = {
      id: roomDbId,
      code,
      private: isPrivate,
      status: 'AGUARDANDO',
      players: [player, null],
      board: createEmptyBoard(),
      currentTurn: 'X',
      scores: [0, 0],
      gameDbId: null,
      turnDeadline: null,
      turnTimer: null,
      startedAt: null,
      rematchRequestedBy: null,
      rematchAcceptedBy: new Set(),
      pausedForDisconnect: false
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  joinRoom(code, user, socket) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) return { error: 'Sala não encontrada. Verifique o código e tente novamente.' };
    if (room.players[1]) return { error: `A sala ${room.code} já possui 2 participantes ativos.` };
    if (room.status !== 'AGUARDANDO') return { error: 'Esta sala não está disponível para entrada.' };
    if (room.players[0]?.id === user.id_jogador) return { error: 'Você já é o criador desta sala.' };

    const player = this.makePlayer(user, 'O', socket);
    room.players[1] = player;
    room.status = 'EM_JOGO';
    db.joinRoom(room.id, player.id);
    this.startRound(room);
    return { room, player };
  }

  findQuickMatch(user, socket) {
    const open = [...this.rooms.values()].find(r => !r.private && r.status === 'AGUARDANDO' && !r.players[1] && r.players[0]?.id !== user.id_jogador);
    if (open) return this.joinRoom(open.code, user, socket);
    return this.createRoom(user, socket, false);
  }

  startRound(room) {
    room.board = createEmptyBoard();
    room.currentTurn = 'X';
    room.status = 'EM_JOGO';
    room.startedAt = Date.now();
    room.rematchRequestedBy = null;
    room.rematchAcceptedBy.clear();
    room.pausedForDisconnect = false;
    room.gameDbId = db.startGame(room.id, room.currentTurn, room.scores[0], room.scores[1]);
    this.scheduleTurn(room);
  }

  scheduleTurn(room) {
    clearTimeout(room.turnTimer);
    if (room.status !== 'EM_JOGO' || room.pausedForDisconnect) return;
    room.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    room.turnTimer = setTimeout(() => {
      if (room.status !== 'EM_JOGO' || room.pausedForDisconnect) return;
      // Regra formalizada: ao chegar a 0, nenhuma casa é marcada; a vez passa e um novo ciclo de 15 s começa.
      room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
      db.updateGameTurn(room.gameDbId, room.currentTurn);
      this.scheduleTurn(room);
      this.broadcast(room, {
        type: 'BOARD_UPDATE',
        board: room.board,
        nextTurn: room.currentTurn,
        reason: 'TURN_TIMEOUT',
        turnDeadline: room.turnDeadline,
        turnSeconds: TURN_SECONDS
      });
    }, TURN_SECONDS * 1000);
  }

  getPlayerBySocket(room, socket) {
    return room.players.find(p => p?.socket === socket) || null;
  }

  getPlayerByToken(room, token) {
    return room.players.find(p => p?.token === token) || null;
  }

  resume(roomCode, token, socket, authenticatedUserId) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return { error: 'Sala não encontrada para reconexão.' };
    const player = this.getPlayerByToken(room, token);
    if (!player || player.id !== authenticatedUserId) return { error: 'Sessão de jogador inválida ou expirada.' };

    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
    player.socket = socket;
    player.connected = true;

    if (room.status === 'EM_JOGO' && room.players.every(p => !p || p.connected)) {
      room.pausedForDisconnect = false;
      // Reconexão dentro dos 30 s: partida continua e o turno recebe 15 s completos.
      this.scheduleTurn(room);
    }
    return { room, player };
  }

  makeState(room, player) {
    return {
      roomCode: room.code,
      private: room.private,
      status: room.status,
      board: room.board,
      nextTurn: room.currentTurn,
      symbol: player.symbol,
      sessionToken: player.token,
      playerId: player.id,
      playerName: player.name,
      isGuest: Boolean(player.isGuest),
      opponentName: room.players.find(p => p && p !== player)?.name || null,
      scores: {
        host: room.scores[0],
        guest: room.scores[1],
        hostName: room.players[0]?.name || 'Host',
        guestName: room.players[1]?.name || 'Visitante'
      },
      turnDeadline: room.turnDeadline,
      turnSeconds: TURN_SECONDS
    };
  }

  move(roomCode, socket, position) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return { error: 'Sala inexistente.' };
    const player = this.getPlayerBySocket(room, socket);
    if (!player) return { error: 'Jogador não pertence a esta sala.' };

    const pos = Number(position);
    if (room.status !== 'EM_JOGO') return { invalid: 'A partida não está em andamento.' };
    if (room.pausedForDisconnect) return { invalid: 'A partida está pausada aguardando reconexão do adversário.' };
    if (!Number.isInteger(pos) || pos < 0 || pos > 8) return { invalid: 'Posição inválida.' };
    if (player.symbol !== room.currentTurn) return { invalid: 'Não é a sua vez de jogar.' };
    if (room.board[pos]) return { invalid: 'Esta célula já está ocupada.' };

    room.board[pos] = player.symbol;
    db.addMove(room.gameDbId, player.id, pos, player.symbol);

    const result = evaluateBoard(room.board);
    if (result.status === 'WIN') {
      clearTimeout(room.turnTimer);
      room.status = 'FINALIZADA';
      const winnerIndex = room.players.findIndex(p => p?.symbol === result.winnerSymbol);
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      room.scores[winnerIndex] += 1;
      db.finishGame(room.gameDbId, room.players[winnerIndex].id, winnerIndex === 0 ? 'VITORIA_HOST' : 'VITORIA_VISITANTE', room.scores[0], room.scores[1]);
      db.addWinLoss(room.players[winnerIndex].id, room.players[loserIndex]?.id);
      return { room, gameOver: { result: 'WIN', winnerSymbol: result.winnerSymbol, winningLine: result.winningLine } };
    }

    if (result.status === 'DRAW') {
      clearTimeout(room.turnTimer);
      room.status = 'FINALIZADA';
      db.finishGame(room.gameDbId, null, 'EMPATE', room.scores[0], room.scores[1]);
      return { room, gameOver: { result: 'DRAW', winnerSymbol: null, winningLine: [] } };
    }

    room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
    db.updateGameTurn(room.gameDbId, room.currentTurn);
    this.scheduleTurn(room);
    return { room, gameOver: null };
  }

  requestRematch(roomCode, socket) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return { error: 'Sala inexistente.' };
    const player = this.getPlayerBySocket(room, socket);
    if (!player) return { error: 'Jogador inválido.' };
    if (room.status !== 'FINALIZADA') return { error: 'A revanche só pode ser solicitada após o fim da partida.' };
    room.rematchRequestedBy = player.token;
    room.rematchAcceptedBy = new Set([player.token]);
    return { room, player };
  }

  acceptRematch(roomCode, socket) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return { error: 'Sala inexistente.' };
    const player = this.getPlayerBySocket(room, socket);
    if (!player) return { error: 'Jogador inválido.' };
    if (!room.rematchRequestedBy) return { error: 'Não há solicitação de revanche pendente.' };
    room.rematchAcceptedBy.add(player.token);
    if (room.rematchAcceptedBy.size < 2) return { room, started: false };

    const oldHostSymbol = room.players[0].symbol;
    room.players[0].symbol = room.players[1].symbol;
    room.players[1].symbol = oldHostSymbol;
    this.startRound(room);
    return { room, started: true };
  }

  addChat(roomCode, socket, message) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return { error: 'Sala inexistente.' };
    const player = this.getPlayerBySocket(room, socket);
    if (!player) return { error: 'Jogador inválido.' };
    const text = String(message || '').trim().slice(0, 500);
    if (!text) return { error: 'Mensagem vazia.' };
    db.addMessage(room.id, player.id, text);
    return { room, player, text };
  }

  disconnect(socket, onForfeit) {
    for (const room of this.rooms.values()) {
      const player = this.getPlayerBySocket(room, socket);
      if (!player) continue;
      player.connected = false;
      player.socket = null;
      if (room.status === 'EM_JOGO') {
        // A tolerância de 30 s é mantida. Durante esse período a partida fica pausada.
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
        room.turnDeadline = null;
        room.pausedForDisconnect = true;
        player.reconnectTimer = setTimeout(() => {
          if (player.connected || room.status !== 'EM_JOGO') return;
          room.status = 'FINALIZADA';
          const loserIndex = room.players.indexOf(player);
          const winnerIndex = loserIndex === 0 ? 1 : 0;
          if (room.players[winnerIndex]) {
            room.scores[winnerIndex] += 1;
            db.finishGame(room.gameDbId, room.players[winnerIndex].id, winnerIndex === 0 ? 'VITORIA_HOST' : 'VITORIA_VISITANTE', room.scores[0], room.scores[1]);
            db.addWinLoss(room.players[winnerIndex].id, player.id);
          }
          onForfeit(room, player, room.players[winnerIndex] || null);
        }, RECONNECT_GRACE_MS);
      }
      return { room, player };
    }
    return null;
  }

  leaveRoom(roomCode, socket) {
    const room = this.rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return null;
    const player = this.getPlayerBySocket(room, socket);
    if (!player) return null;
    clearTimeout(player.reconnectTimer);
    clearTimeout(room.turnTimer);
    db.finishRoom(room.id);
    this.rooms.delete(room.code);
    return { room, player };
  }

  broadcast(room, payload, excludeSocket = null) {
    const raw = JSON.stringify(payload);
    room.players.forEach(player => {
      const socket = player?.socket;
      if (socket && socket.readyState === 1 && socket !== excludeSocket) socket.send(raw);
    });
  }
}

module.exports = { RoomManager, TURN_SECONDS, RECONNECT_GRACE_MS };
