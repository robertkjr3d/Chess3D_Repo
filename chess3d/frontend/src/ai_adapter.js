// AI adapter: exposes `findBestMove` which uses negamax + alpha-beta and accepts helper functions
// Designed to be called from App.js by passing App's helper functions (simulateMove, getAllLegalMoves, evaluatePosition, orderMoves, etc.)

export async function findBestMove({ pieces, moveHistory, aiSide = 'black', maxDepth = 3, timeLimit = 1500, helpers = {} } = {}) {
  const { simulateMove, getAllLegalMoves, evaluatePosition, orderMoves, isAnyKingInCheck } = helpers;
  if (!simulateMove || !getAllLegalMoves || !evaluatePosition || !orderMoves) {
    console.warn('ai_adapter.findBestMove: missing helpers', { simulateMove: !!simulateMove, getAllLegalMoves: !!getAllLegalMoves, evaluatePosition: !!evaluatePosition, orderMoves: !!orderMoves });
    return null;
  }

  try {
    console.log('ai_adapter.findBestMove called', { piecesCount: Array.isArray(pieces) ? pieces.length : 0, aiSide, maxDepth, timeLimit });
  } catch (e) {}

  const start = Date.now();
  const endTime = start + (timeLimit || 1500);
  let bestMove = null;
  let bestScore = -Infinity;

  function timeUp() { return Date.now() > endTime; }

  function negamax(piecesState, color, depth, alpha, beta) {
    if (timeUp()) return evaluatePosition(piecesState, color);
    const moves = getAllLegalMoves(piecesState, color) || [];
    if (depth === 0 || moves.length === 0) {
      if (moves.length === 0) {
        const inCheck = isAnyKingInCheck ? isAnyKingInCheck(piecesState, color) : false;
        return (inCheck ? -999999 : evaluatePosition(piecesState, color));
      }
      return evaluatePosition(piecesState, color);
    }

    const nextColor = color === 'white' ? 'black' : 'white';
    const ordered = orderMoves(moves, piecesState, color);

    let value = -Infinity;
    for (const m of ordered) {
      if (timeUp()) break;
      const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
      const score = -negamax(next, nextColor, depth - 1, -beta, -alpha);
      if (score > value) value = score;
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  // Iterative deepening
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (timeUp()) break;
    let localBest = null;
    let localBestScore = -Infinity;
    const moves = (getAllLegalMoves && typeof getAllLegalMoves === 'function') ? (getAllLegalMoves(pieces, aiSide) || []) : [];
    try { console.log('ai_adapter: depth', depth, 'movesCount', moves.length); } catch (e) {}
    const ordered = orderMoves(moves, pieces, aiSide);
    for (const m of ordered) {
      if (timeUp()) break;
      const next = simulateMove(pieces, m.moverId, { x: m.x, y: m.y, z: m.z });
      const score = -negamax(next, aiSide === 'white' ? 'black' : 'white', depth - 1, -Infinity, Infinity);
      if (score > localBestScore) {
        localBestScore = score;
        localBest = m;
      }
    }
    if (localBest && !timeUp()) {
      bestMove = localBest;
      bestScore = localBestScore;
    }
  }

  return bestMove;
}
