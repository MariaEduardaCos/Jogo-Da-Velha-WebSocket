# Ws3 — Jogo da Velha Multiplayer em Tempo Real

Implementação baseada na atividade prática **Ws3 (UML Completo)**, usando **Node.js + Express + WebSocket (`ws`) + SQLite**.

## Versão 1.0.1 — correção para npm 12 / Node 24

Esta versão já contém no `package.json` a autorização necessária para o script de instalação do `better-sqlite3`:

```json
"allowScripts": {
  "better-sqlite3@12.11.1": true
}
```

O `better-sqlite3` também foi fixado em `12.11.1` para evitar que uma instalação nova volte para a versão 11.x usada anteriormente.

Além disso, o projeto executa uma verificação automática do SQLite após `npm install`. Quando tudo estiver correto, aparecerá:

```text
[OK] better-sqlite3 carregado corretamente.
```

## Requisitos

- Node.js 20 ou superior
- npm

Foi testada a configuração visando também **Node.js 24 + npm 12 no Windows x64**.

## Instalação nova

Extraia o ZIP em uma pasta nova e execute:

```bash
npm install
npm start
```

Abra:

- http://localhost:8080/
- WebSocket: `ws://localhost:8080/tictactoe`

Para testar o multiplayer, abra o site em dois navegadores/abas independentes.

## Se estiver substituindo a versão antiga

Não copie a nova versão por cima de um `node_modules` antigo. Extraia o projeto em uma pasta nova. Se quiser reaproveitar a mesma pasta, remova `node_modules` e `package-lock.json` antes de executar `npm install`.

No PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm start
```

## Verificação manual do SQLite

```bash
npm run check:sqlite
```

Resultado esperado:

```text
[OK] better-sqlite3 carregado corretamente.
```

## Estrutura

- `server.js`: servidor HTTP + WebSocket e roteamento de eventos.
- `src/roomManager.js`: salas, turnos, movimentos, revanche e reconexão.
- `src/game.js`: regras do tabuleiro e avaliação de vitória/empate.
- `src/database.js`: persistência SQLite das entidades do ERD.
- `scripts/verify-sqlite.js`: teste automático do binding nativo do SQLite.
- `public/tela1-lobby.html`: Lobby.
- `public/tela2-arena.html`: Arena 3×3 e chat.
- `public/tela3-gameover.html`: protótipo isolado do modal Game Over.

## Eventos principais

Cliente → servidor:
- `CREATE_ROOM`
- `QUICK_MATCH`
- `JOIN_ROOM` (o servidor também aceita o alias `JOIN_GAME` descrito no RF-01)
- `RESUME_SESSION`
- `MOVE`
- `CHAT`
- `NEW_GAME`
- `ACCEPT_NEW_GAME`
- `LEAVE_ROOM`

Servidor → cliente:
- `ROOM_JOINED`
- `MATCH_STARTED`
- `BOARD_UPDATE`
- `INVALID_MOVE`
- `CHAT_MESSAGE`
- `GAME_OVER`
- `NEW_GAME_REQUEST`
- `NEW_GAME_STARTED`
- `PLAYER_DISCONNECTED`
- `PLAYER_RECONNECTED`
- `LOBBY_UPDATE`

## Autoridade do servidor

O navegador não decide o resultado, não altera o tabuleiro de forma definitiva e não escolhe o turno. Cada `MOVE` é validado no servidor; somente depois do `BOARD_UPDATE` a interface renderiza o novo estado.

## Banco de dados

O arquivo `ws3.sqlite` é criado automaticamente na primeira execução e persiste jogadores convidados, salas, partidas, jogadas e mensagens de chat.
