# Ws3 — Jogo da Velha Multiplayer com WebSocket

Versão 1.2.2 do projeto da atividade Ws3.

## Requisitos

- Node.js 20 ou superior.
- npm 12 é suportado.
- Windows, Linux ou macOS.

A configuração do `better-sqlite3` já está registrada no `package.json` por meio de `allowScripts`, portanto não é necessário aprovar manualmente o script do pacote em uma instalação normal.

## Instalação

```bash
npm install
npm start
```

Abra:

```text
http://localhost:8080
```

O servidor imprime apenas uma mensagem curta de inicialização, além das mensagens normais do próprio npm.

## WebSocket e HTTP 101

Endpoint único:

```text
ws://localhost:8080/tictactoe
```

O upgrade HTTP para WebSocket é tratado explicitamente em `server.js`. Uma conexão WebSocket válida recebe:

```text
HTTP/1.1 101 Switching Protocols
```

Para verificar manualmente, deixe `npm start` rodando em um terminal e execute em outro:

```bash
npm run check:ws101
```

## Autenticação

Há três formas de acesso:

- Entrar com uma conta cadastrada.
- Criar uma conta persistente com apelido, e-mail e senha.
- Jogar como visitante.

O visitante pode usar partida rápida, entrar em salas públicas e entrar em uma sala privada por código. A única restrição funcional do visitante é não poder criar uma sala privada.

## Múltiplas contas em abas do mesmo navegador

Não há mais trava de "uma única aba ativa". Cada aba mantém sua própria autenticação e sua própria sessão de partida em `sessionStorage`.

Assim, é possível usar a Conta A na primeira aba e a Conta B na segunda aba do mesmo Chrome/Edge/Firefox. Uma aba não substitui a autenticação, o código da sala ou o token de reconexão da outra. A página de login também limpa apenas a identidade da própria aba, o que evita que uma aba duplicada herde automaticamente a conta anterior.

A tolerância de reconexão de 30 segundos continua independente para cada jogador/partida.

## Salas

- Conta cadastrada: partida rápida, entrada por código e criação de sala privada.
- Visitante: partida rápida e entrada por código.
- Ao criar uma sala privada, o host é enviado para uma tela de espera onde o código de 6 caracteres permanece visível.

## Jogo

- Regras e validações executadas no servidor.
- Tabuleiro 3x3 responsivo.
- Cronômetro visível de 15 segundos por jogada, conforme o enunciado da atividade.
- Se o tempo chegar a zero, nenhuma casa é marcada e a vez passa ao adversário.
- Fechamento/perda de conexão mostra W.O. provisório ao adversário e mantém a tolerância de 30 segundos para reconexão. Esses 30 segundos são de desconexão, não de tempo para realizar a jogada.
- Revanche sem destruir a sala.
- Placar de sessão.

## Chat

- Mensagens são restritas à sala atual.
- Mensagens enviadas pelo próprio jogador aparecem à direita.
- Mensagens recebidas aparecem à esquerda.

## Banco de dados

SQLite com `better-sqlite3`.

Entidades principais:

- `jogador`
- `auth_session`
- `sala_jogo`
- `partida`
- `jogada`
- `mensagem_chat`

As versões anteriores do banco são migradas automaticamente para incluir a identificação de usuário visitante.

## Diagnóstico

Verificar o binding do SQLite:

```bash
npm run check:sqlite
```

Verificar o handshake HTTP 101, com o servidor em execução:

```bash
npm run check:ws101
```

Endpoint de saúde:

```text
http://localhost:8080/health
```

Esse endpoint também expõe as métricas de processamento das jogadas sem imprimir mensagens de requisitos no terminal.

## v1.2.1 — múltiplas contas em abas do mesmo navegador

A autenticação e a sessão da partida são armazenadas em `sessionStorage`, e não em `localStorage`.
Isso permite usar, por exemplo, a Conta A na primeira aba e a Conta B na segunda aba do mesmo navegador,
sem uma aba sobrescrever a autenticação ou o código/sessão da outra.

Para testar localmente:
1. Abra `http://localhost:8080/login.html` em uma aba e entre com a primeira conta.
2. Abra `http://localhost:8080/login.html` em outra aba e entre com a segunda conta.
3. A primeira conta pode criar a sala privada e copiar o código.
4. A segunda conta pode entrar pelo código sem deslogar ou interferir na primeira aba.

O controle antigo que obrigava apenas uma aba ativa por navegador foi removido também no servidor. As conexões WebSocket são autenticadas de forma independente; a separação entre as contas e partidas de cada aba é feita pelo token de autenticação e pelo `sessionStorage` daquela aba.


## v1.2.2 — ajustes pontuais de interface

- Removida a marcação `[WS]` dos botões de solicitar revanche.
- Corrigida a tela de espera de salas públicas e privadas: o indicador animado não interfere mais no texto e as mensagens quebram linha sem ficar escondidas.
- Mantido o cronômetro de 15 segundos por jogada, porque esse é o tempo especificado nos critérios de aceite da atividade.
- Mantida separadamente a tolerância de 30 segundos apenas para reconexão após desconexão.

## Subir ao GitHub

Este pacote foi preparado para versionamento no GitHub.

O diretório `node_modules` e os arquivos temporários do SQLite não fazem parte do repositório. Após clonar/baixar o projeto, execute:

```bash
npm install
npm start
```

Não é necessário copiar `node_modules` de outro computador.
