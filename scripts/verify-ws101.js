'use strict';

const WebSocket = require('ws');
const url = process.env.WS_URL || 'ws://localhost:8080/tictactoe';
let upgradeStatus = null;

const socket = new WebSocket(url);
socket.once('upgrade', response => {
  upgradeStatus = response.statusCode;
});
socket.once('open', () => {
  if (upgradeStatus !== 101) {
    console.error(`Falha: handshake retornou ${upgradeStatus ?? 'status desconhecido'}, esperado 101.`);
    process.exitCode = 1;
  } else {
    console.log('HTTP 101 Switching Protocols confirmado no endpoint WebSocket.');
  }
  socket.close();
});
socket.once('error', error => {
  console.error(`Falha ao verificar WebSocket: ${error.message}`);
  process.exitCode = 1;
});
