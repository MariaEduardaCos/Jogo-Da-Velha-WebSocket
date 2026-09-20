const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'ws3.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS jogador (
  id_jogador INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname VARCHAR(40) NOT NULL,
  email VARCHAR(100),
  vitorias_totais INTEGER NOT NULL DEFAULT 0,
  derrotas_totais INTEGER NOT NULL DEFAULT 0,
  data_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sala_jogo (
  id_sala INTEGER PRIMARY KEY AUTOINCREMENT,
  id_jogador_host INTEGER NOT NULL,
  id_jogador_visitante INTEGER,
  codigo_sala VARCHAR(10) NOT NULL UNIQUE,
  privada BOOLEAN NOT NULL DEFAULT 0,
  status_sala VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO',
  FOREIGN KEY (id_jogador_host) REFERENCES jogador(id_jogador),
  FOREIGN KEY (id_jogador_visitante) REFERENCES jogador(id_jogador)
);

CREATE TABLE IF NOT EXISTS partida (
  id_partida INTEGER PRIMARY KEY AUTOINCREMENT,
  id_sala INTEGER NOT NULL,
  id_vencedor INTEGER,
  simbolo_turno_atual VARCHAR(1) NOT NULL,
  placar_host INTEGER NOT NULL DEFAULT 0,
  placar_visitante INTEGER NOT NULL DEFAULT 0,
  status_resultado VARCHAR(20) NOT NULL DEFAULT 'EM_ANDAMENTO',
  data_hora_inicio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data_hora_fim TIMESTAMP,
  FOREIGN KEY (id_sala) REFERENCES sala_jogo(id_sala),
  FOREIGN KEY (id_vencedor) REFERENCES jogador(id_jogador)
);

CREATE TABLE IF NOT EXISTS jogada (
  id_jogada INTEGER PRIMARY KEY AUTOINCREMENT,
  id_partida INTEGER NOT NULL,
  id_jogador INTEGER NOT NULL,
  posicao_celula INTEGER NOT NULL CHECK(posicao_celula BETWEEN 0 AND 8),
  simbolo VARCHAR(1) NOT NULL CHECK(simbolo IN ('X', 'O')),
  timestamp_jogada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_partida) REFERENCES partida(id_partida),
  FOREIGN KEY (id_jogador) REFERENCES jogador(id_jogador)
);

CREATE TABLE IF NOT EXISTS mensagem_chat (
  id_mensagem INTEGER PRIMARY KEY AUTOINCREMENT,
  id_sala INTEGER NOT NULL,
  id_jogador_remetente INTEGER NOT NULL,
  conteudo_texto TEXT NOT NULL,
  timestamp_envio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_sala) REFERENCES sala_jogo(id_sala),
  FOREIGN KEY (id_jogador_remetente) REFERENCES jogador(id_jogador)
);
`);

const stmts = {
  createPlayer: db.prepare(`INSERT INTO jogador (nickname) VALUES (?)`),
  createRoom: db.prepare(`INSERT INTO sala_jogo (id_jogador_host, codigo_sala, privada) VALUES (?, ?, ?)`),
  joinRoom: db.prepare(`UPDATE sala_jogo SET id_jogador_visitante = ?, status_sala = 'EM_JOGO' WHERE id_sala = ?`),
  finishRoom: db.prepare(`UPDATE sala_jogo SET status_sala = 'FINALIZADA' WHERE id_sala = ?`),
  startGame: db.prepare(`INSERT INTO partida (id_sala, simbolo_turno_atual, placar_host, placar_visitante) VALUES (?, ?, ?, ?)`),
  updateGameTurn: db.prepare(`UPDATE partida SET simbolo_turno_atual = ? WHERE id_partida = ?`),
  finishGame: db.prepare(`UPDATE partida SET id_vencedor = ?, status_resultado = ?, placar_host = ?, placar_visitante = ?, data_hora_fim = CURRENT_TIMESTAMP WHERE id_partida = ?`),
  addMove: db.prepare(`INSERT INTO jogada (id_partida, id_jogador, posicao_celula, simbolo) VALUES (?, ?, ?, ?)`),
  addMessage: db.prepare(`INSERT INTO mensagem_chat (id_sala, id_jogador_remetente, conteudo_texto) VALUES (?, ?, ?)`),
  addWin: db.prepare(`UPDATE jogador SET vitorias_totais = vitorias_totais + 1 WHERE id_jogador = ?`),
  addLoss: db.prepare(`UPDATE jogador SET derrotas_totais = derrotas_totais + 1 WHERE id_jogador = ?`)
};

function createPlayer(nickname) {
  return Number(stmts.createPlayer.run(nickname).lastInsertRowid);
}

function createRoom(hostPlayerId, roomCode, isPrivate) {
  return Number(stmts.createRoom.run(hostPlayerId, roomCode, isPrivate ? 1 : 0).lastInsertRowid);
}

function joinRoom(roomId, guestPlayerId) {
  stmts.joinRoom.run(guestPlayerId, roomId);
}

function finishRoom(roomId) {
  stmts.finishRoom.run(roomId);
}

function startGame(roomId, currentTurn, hostScore, guestScore) {
  return Number(stmts.startGame.run(roomId, currentTurn, hostScore, guestScore).lastInsertRowid);
}

function updateGameTurn(gameId, currentTurn) {
  stmts.updateGameTurn.run(currentTurn, gameId);
}

function finishGame(gameId, winnerPlayerId, result, hostScore, guestScore) {
  stmts.finishGame.run(winnerPlayerId || null, result, hostScore, guestScore, gameId);
}

function addMove(gameId, playerId, position, symbol) {
  stmts.addMove.run(gameId, playerId, position, symbol);
}

function addMessage(roomId, playerId, text) {
  stmts.addMessage.run(roomId, playerId, text);
}

function addWinLoss(winnerId, loserId) {
  if (winnerId) stmts.addWin.run(winnerId);
  if (loserId) stmts.addLoss.run(loserId);
}

module.exports = {
  createPlayer,
  createRoom,
  joinRoom,
  finishRoom,
  startGame,
  updateGameTurn,
  finishGame,
  addMove,
  addMessage,
  addWinLoss
};
