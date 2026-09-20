const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'ws3.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS jogador (
  id_jogador INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname VARCHAR(40) NOT NULL,
  email VARCHAR(100),
  senha_hash TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  vitorias_totais INTEGER NOT NULL DEFAULT 0,
  derrotas_totais INTEGER NOT NULL DEFAULT 0,
  data_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_session (
  id_sessao INTEGER PRIMARY KEY AUTOINCREMENT,
  id_jogador INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TIMESTAMP NOT NULL,
  FOREIGN KEY (id_jogador) REFERENCES jogador(id_jogador) ON DELETE CASCADE
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

// Migrações seguras para bancos criados pelas versões anteriores.
const jogadorColumns = new Set(db.prepare(`PRAGMA table_info(jogador)`).all().map(c => c.name));
if (!jogadorColumns.has('senha_hash')) db.exec(`ALTER TABLE jogador ADD COLUMN senha_hash TEXT`);
if (!jogadorColumns.has('is_guest')) db.exec(`ALTER TABLE jogador ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0`);

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jogador_email_unique ON jogador(email) WHERE email IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_session_player ON auth_session(id_jogador)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_session(expira_em)`);

const stmts = {
  createUser: db.prepare(`INSERT INTO jogador (nickname, email, senha_hash, is_guest) VALUES (?, ?, ?, 0)`),
  createGuest: db.prepare(`INSERT INTO jogador (nickname, email, senha_hash, is_guest) VALUES (?, NULL, NULL, 1)`),
  findUserByEmail: db.prepare(`SELECT * FROM jogador WHERE lower(email) = lower(?) AND is_guest = 0`),
  findUserByNickname: db.prepare(`SELECT * FROM jogador WHERE lower(nickname) = lower(?)`),
  getUserById: db.prepare(`SELECT id_jogador, nickname, email, is_guest, vitorias_totais, derrotas_totais, data_registro FROM jogador WHERE id_jogador = ?`),
  createAuthSession: db.prepare(`INSERT INTO auth_session (id_jogador, token_hash, expira_em) VALUES (?, ?, ?)`),
  getAuthSession: db.prepare(`
    SELECT s.id_sessao, s.id_jogador, s.expira_em,
           j.nickname, j.email, j.is_guest, j.vitorias_totais, j.derrotas_totais, j.data_registro
    FROM auth_session s
    JOIN jogador j ON j.id_jogador = s.id_jogador
    WHERE s.token_hash = ? AND datetime(s.expira_em) > datetime('now')
  `),
  deleteAuthSession: db.prepare(`DELETE FROM auth_session WHERE token_hash = ?`),
  deleteExpiredSessions: db.prepare(`DELETE FROM auth_session WHERE datetime(expira_em) <= datetime('now')`),
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

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createUser(nickname, email, password) {
  const cleanNickname = String(nickname || '').trim().slice(0, 40);
  const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 100);
  const passwordHash = hashPassword(password);
  const info = stmts.createUser.run(cleanNickname, cleanEmail, passwordHash);
  return getUserById(Number(info.lastInsertRowid));
}

function createGuestUser() {
  let nickname;
  do {
    nickname = `Visitante_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  } while (stmts.findUserByNickname.get(nickname));
  const info = stmts.createGuest.run(nickname);
  return getUserById(Number(info.lastInsertRowid));
}

function authenticateUser(email, password) {
  const row = stmts.findUserByEmail.get(String(email || '').trim().toLowerCase());
  if (!row || !verifyPassword(String(password || ''), row.senha_hash)) return null;
  return getUserById(row.id_jogador);
}

function userExists(nickname, email) {
  return Boolean(stmts.findUserByEmail.get(String(email || '').trim()) || stmts.findUserByNickname.get(String(nickname || '').trim()));
}

function getUserById(id) {
  return stmts.getUserById.get(id) || null;
}

function createAuthSession(playerId, days = 7) {
  stmts.deleteExpiredSessions.run();
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  stmts.createAuthSession.run(playerId, tokenHash(token), expiry);
  return { token, expiresAt: expiry };
}

function getUserByAuthToken(token) {
  if (!token) return null;
  const row = stmts.getAuthSession.get(tokenHash(token));
  if (!row) return null;
  return {
    id_jogador: row.id_jogador,
    nickname: row.nickname,
    email: row.email,
    is_guest: Boolean(row.is_guest),
    vitorias_totais: row.vitorias_totais,
    derrotas_totais: row.derrotas_totais,
    data_registro: row.data_registro
  };
}

function revokeAuthToken(token) {
  if (token) stmts.deleteAuthSession.run(tokenHash(token));
}

function createRoom(hostPlayerId, roomCode, isPrivate) {
  return Number(stmts.createRoom.run(hostPlayerId, roomCode, isPrivate ? 1 : 0).lastInsertRowid);
}
function joinRoom(roomId, guestPlayerId) { stmts.joinRoom.run(guestPlayerId, roomId); }
function finishRoom(roomId) { stmts.finishRoom.run(roomId); }
function startGame(roomId, currentTurn, hostScore, guestScore) {
  return Number(stmts.startGame.run(roomId, currentTurn, hostScore, guestScore).lastInsertRowid);
}
function updateGameTurn(gameId, currentTurn) { stmts.updateGameTurn.run(currentTurn, gameId); }
function finishGame(gameId, winnerPlayerId, result, hostScore, guestScore) {
  stmts.finishGame.run(winnerPlayerId || null, result, hostScore, guestScore, gameId);
}
function addMove(gameId, playerId, position, symbol) { stmts.addMove.run(gameId, playerId, position, symbol); }
function addMessage(roomId, playerId, text) { stmts.addMessage.run(roomId, playerId, text); }
function addWinLoss(winnerId, loserId) {
  if (winnerId) stmts.addWin.run(winnerId);
  if (loserId) stmts.addLoss.run(loserId);
}

module.exports = {
  createUser,
  createGuestUser,
  authenticateUser,
  userExists,
  getUserById,
  createAuthSession,
  getUserByAuthToken,
  revokeAuthToken,
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
