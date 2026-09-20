'use strict';

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('SELECT 1 AS ok').get();
  db.close();
} catch (error) {
  console.error('\n[ERRO] O módulo nativo do better-sqlite3 não foi carregado.');
  console.error('O projeto já autoriza o script de instalação do better-sqlite3 no package.json.');
  console.error('Tente remover node_modules e package-lock.json e executar npm install novamente.\n');
  console.error(error.message);
  process.exit(1);
}
