const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function createEmptyBoard() {
  return Array(9).fill(null);
}

function evaluateBoard(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { status: 'WIN', winnerSymbol: board[a], winningLine: line };
    }
  }

  if (board.every(Boolean)) {
    return { status: 'DRAW', winnerSymbol: null, winningLine: [] };
  }

  return { status: 'PLAYING', winnerSymbol: null, winningLine: [] };
}

module.exports = { createEmptyBoard, evaluateBoard, WINNING_LINES };
