function startSearch() {
  this.bestEvalThisIteration = 0;
  this.bestEval = 0;

  this.bestMoveThisIteration = this.invalidMove;
  this.bestMove = this.invalidMove;

  // Equivalent to: searchDepth = 2;
  this.searchDepth = 2;

  console.log("Search started");

  this.searchMoves(
    this.searchDepth,
    0,
    this.negativeInfinity,
    this.positiveInfinity
  );

  if (this.bestMoveThisIteration?.movedPiece) {
    const move = this.bestMoveThisIteration;
    console.debug(
      `bestmove found = ${move.movedPiece.pieceType}` +
      `${move.newCoords.x},${move.newCoords.y},${move.newCoords.z}`
    );
  }

  this.bestMove = this.bestMoveThisIteration;
  this.bestEval = this.bestEvalThisIteration;

  console.log("Search completed");

  // Equivalent to: onSearchComplete?.Invoke(bestMove);
  if (typeof this.onSearchComplete === "function") {
    this.onSearchComplete(this.bestMove);
  }
}

function randomMove(player) {
  const possibleMoves = [];

  for (const piece of player.activePieces) {
    player.removeIllegalMoves(piece);

    for (const move of piece.availableMoves) {
      possibleMoves.push(move);
    }
  }

  if (possibleMoves.length === 0) {
    return; // no legal moves
  }

  const randomIndex = Math.floor(Math.random() * possibleMoves.length);
  const selectedMove = possibleMoves[randomIndex];

  this.move = selectedMove;
  this.moveFound = true;
}

function searchMoves(depth, plyFromRoot, alpha, beta) {
  if (plyFromRoot > 0) {
    alpha = Math.max(alpha, -this.iMateScore + plyFromRoot);
    beta = Math.min(beta, this.iMateScore - plyFromRoot);

    if (alpha >= beta) {
      return alpha;
    }
  }

  if (depth === 0) {
    return this.searchAllCaptures(alpha, beta);
  }

  let removethoseVectors = false;
  let removethoseVectors2 = false;
  let removethoseVectors3 = false;
  let removethoseVectors4 = false;
  let move5 = false;
  let notes = null;

  // Opening logic
  if (depth === this.searchDepth) {
    const openingMoveCount = ChessGameController.GameHistory.length;

    if (openingMoveCount < 12) {
      const history = [...ChessGameController.GameHistory];
      notes = this.chessController.Board.convertToNotation(history);

      let step1 = false;
      for (const item of notes) {
        if (item.includes("2b4") || item.includes("3c4")) {
          step1 = true;
        }
      }

      if (step1) {
        for (const item of notes) {
          if (item.includes("2b5") || item.includes("3c5")) {
            if (ChessGameController.gameType === ChessGameController.GameType.AiWhite) {
              removethoseVectors = true;
            } else {
              if (
                item.includes("2b5") &&
                item.includes("2c5") &&
                item.includes("3b5")
              ) {
                // intentional no-op
              } else {
                removethoseVectors3 = true;
              }
            }
          }
        }
      }

      // First-response logic
      if (openingMoveCount === 1) {
        const m = history[0];
        if (
          m.movedPiece.pieceType === "Pawn" &&
          m.newCoords.y === 3 &&
          (m.newCoords.z === 1 || m.newCoords.z === 2) &&
          (m.newCoords.x === 1 || m.newCoords.x === 2)
        ) {
          const x = m.oldCoords.x;
          const oldy = 7 - m.oldCoords.y;
          const y = 7 - m.newCoords.y;
          const z = m.oldCoords.z;

          const fromSquare = { x, y: oldy, z };
          const toSquare = { x, y, z };

          const piece = this.chessController.Board.getPieceOnSquare(fromSquare);
          const p = new Move(piece, fromSquare, toSquare, null);

          this.bestEvalThisIteration = 5;
          this.bestMoveThisIteration = p;
          return 5;
        }
      }
    }
  }

  let moves = this.generateMoves(false);
  this.orderMoves(moves);

  // Checkmate / stalemate
  if (moves.length === 0) {
    if (this.chessController.isCheck) {
      return -(this.iMateScore - plyFromRoot);
    }
    return 0;
  }

  // Opening move pruning helpers
  const removeMovesByCoords = (coords) => {
    moves = moves.filter(
      m => !coords.some(
        c => c.x === m.newCoords.x && c.y === m.newCoords.y && c.z === m.newCoords.z
      )
    );
  };

  if (removethoseVectors) {
    removeMovesByCoords([
      { x: 2, y: 3, z: 1 },
      { x: 1, y: 3, z: 2 }
    ]);
  }

  if (removethoseVectors3) {
    removeMovesByCoords([
      { x: 2, y: 4, z: 1 },
      { x: 1, y: 4, z: 2 }
    ]);
  }

  if (removethoseVectors4) {
    removeMovesByCoords([{ x: 2, y: 4, z: 2 }]);
  }

  if (removethoseVectors2) {
    const toRemove = [];

    for (const move of moves) {
      if (
        (move.newCoords.x === 2 && move.newCoords.y === 4 && move.newCoords.z === 1) ||
        (move.newCoords.x === 1 && move.newCoords.y === 4 && move.newCoords.z === 2)
      ) {
        toRemove.push(move);
      }

      if (move5 && notes) {
        const currentMoves = this.chessController.Board.convertToNotation(move);
        const lastMove = notes[0];
        const currentMove = currentMoves[0];

        if (
          (lastMove === "B2d4" && currentMove === "N2b6") ||
          (lastMove === "B3a4" && currentMove === "N3c6")
        ) {
          toRemove.push(move);
        }
      }
    }

    moves = moves.filter(m => !toRemove.includes(m));
  }

  // Main negamax loop
  for (const move of moves) {
    const undo = this.chessController.Board.makeMove(move, true, true);
    const evalScore = -this.searchMoves(
      depth - 1,
      plyFromRoot + 1,
      -beta,
      -alpha
    );
    this.chessController.Board.undoMove(undo, true, true);

    if (this.CANCEL) return alpha;

    if (evalScore >= beta) return beta;

    if (evalScore > alpha) {
      alpha = evalScore;

      if (plyFromRoot === 0) {
        this.bestMoveThisIteration = move;
        this.bestEvalThisIteration = evalScore;
      }
    }
  }

  return alpha;
}

//const move = getRandomMove(player);
//if (move) {
//  moveFound = true;
//}

function searchAllCaptures(alpha, beta) {
  let evalScore = this.evaluate();

  if (evalScore >= beta) return beta;

  if (evalScore > alpha) alpha = evalScore;

  let captureMoves = this.generateMoves(true);
  this.orderMoves(captureMoves);

  for (const move of captureMoves) {
    const undo = this.chessController.Board.makeMove(move, true, true);
    evalScore = -this.searchAllCaptures(-beta, -alpha);
    this.chessController.Board.undoMove(undo, true, true);

    if (this.CANCEL) return alpha;

    if (evalScore >= beta) return beta;
    if (evalScore > alpha) alpha = evalScore;
  }

  return alpha;
}


function generateMoves(onlyCaptures) {
  const moves = [];
  const currentPlayer = this.chessController.activePlayer;

  for (const piece of currentPlayer.activePieces) {
    if (!piece.isActive) continue;

    currentPlayer.removeIllegalMoves(piece);

    for (const move of piece.availableMoves) {
      const enemyPiece = this.chessController.Board.getPieceOnSquare(
        move.newCoords
      );

      if (onlyCaptures) {
        if (
          enemyPiece &&
          !piece.isFromSameTeam(enemyPiece) &&
          enemyPiece.isActive
        ) {
          moves.push(move);
        }
      } else {
        if (
          enemyPiece &&
          !piece.isFromSameTeam(enemyPiece) &&
          enemyPiece.isActive
        ) {
          moves.push(move);
        } else if (!enemyPiece) {
          moves.push(move);
        }
      }
    }
  }

  return moves;
}

function orderMoves(moves) {
  if (moves.length < 1) return;

  // Precompute opponent pawn attacks
  moves[0].movedPiece.owner.opponent.generatePawnAttackMap();

  this.moveScores = new Array(moves.length).fill(0);

  for (let i = 0; i < moves.length; i++) {
    let score = 0;

    const move = moves[i];
    const movingPiece = move.movedPiece;
    const capturedPiece = move.capturedPiece;

    // Pawn-promotion bug workaround (ported as-is)
    if (movingPiece.constructor.name === "Pawn") {
      movingPiece.pieceType = PieceType.Pawn;
    }

    if (capturedPiece) {
      score =
        this.capturedPieceValueMultiplier *
          capturedPiece.pieceValue -
        movingPiece.pieceValue;
    }

    if (movingPiece.pieceType === PieceType.Pawn) {
      if (movingPiece.checkPromotion()) {
        score += PieceValues.QUEEN_VALUE;
      }
    } else {
      if (
        movingPiece.owner.opponent.pawnAttackMap?.some(
          sq =>
            sq.x === move.newCoords.x &&
            sq.y === move.newCoords.y &&
            sq.z === move.newCoords.z
        )
      ) {
        score -= this.squareControlledByOpponentPawnPenalty;
      }
    }

    this.moveScores[i] = score;
  }

  this.sortMoves(moves);
}

function sortMoves(moves) {
  for (let i = 0; i < moves.length - 1; i++) {
    for (let j = i + 1; j > 0; j--) {
      const swapIndex = j - 1;

      if (this.moveScores[swapIndex] < this.moveScores[j]) {
        // Swap moves
        [moves[j], moves[swapIndex]] = [
          moves[swapIndex],
          moves[j]
        ];

        // Swap scores
        [this.moveScores[j], this.moveScores[swapIndex]] = [
          this.moveScores[swapIndex],
          this.moveScores[j]
        ];
      }
    }
  }
}

function evaluate() {
  let whiteEval = 0;
  let blackEval = 0;

  const whiteMaterial = this.countMaterial(this.chessController.whitePlayer);
  const blackMaterial = this.countMaterial(this.chessController.blackPlayer);

  const whiteMaterialWithoutPawns =
    whiteMaterial -
    this.chessController.whitePlayer.getActivePawns() *
      PieceValues.PAWN_VALUE;

  const blackMaterialWithoutPawns =
    blackMaterial -
    this.chessController.blackPlayer.getActivePawns() *
      PieceValues.PAWN_VALUE;

  const whiteEndgamePhaseWeight =
    this.endgamePhaseWeight(whiteMaterialWithoutPawns);

  const blackEndgamePhaseWeight =
    this.endgamePhaseWeight(blackMaterialWithoutPawns);

  whiteEval += whiteMaterial;
  blackEval += blackMaterial;

  whiteEval += this.evaluatePieceSquareTables(
    this.chessController.whitePlayer,
    blackEndgamePhaseWeight
  );

  blackEval += this.evaluatePieceSquareTables(
    this.chessController.blackPlayer,
    whiteEndgamePhaseWeight
  );

  const evalScore = whiteEval - blackEval;
  const perspective = this.chessController.isWhiteToMove ? 1 : -1;

  return evalScore * perspective;
}

const ENDGAME_MATERIAL_START =
  PieceValues.ROOK_VALUE * 2 +
  PieceValues.BISHOP_VALUE +
  PieceValues.KNIGHT_VALUE;

function endgamePhaseWeight(materialCountWithoutPawns) {
  const multiplier = 1 / ENDGAME_MATERIAL_START;
  return 1 - Math.min(1, materialCountWithoutPawns * multiplier);
}

function countMaterial(player) {
  let material = 0;

  for (const piece of player.activePieces) {
    if (piece.isActive) {
      material += piece.pieceValue;
    }
  }

  return material;
}

function evaluatePieceSquareTables(player, endgamePhaseWeight) {
  let value = 0;
  const isWhite = player.team === TeamColor.White;

  value += evaluatePieceSquareTable(
    PieceSquareValues.pawns,
    player.pawns,
    isWhite
  );

  value += evaluatePieceSquareTable(
    PieceSquareValues.rooks,
    player.rooks,
    isWhite
  );

  value += evaluatePieceSquareTable(
    PieceSquareValues.knights,
    player.knights,
    isWhite
  );

  value += evaluatePieceSquareTable(
    PieceSquareValues.bishops,
    player.bishops,
    isWhite
  );

  value += evaluatePieceSquareTable(
    PieceSquareValues.queens,
    player.queens,
    isWhite
  );

  // King: tapered eval (middlegame → endgame)
  const kingSquare = player.kings.values().next().value.occupiedSquare;

  const kingEarlyPhase =
    PieceSquareValues.read(
      PieceSquareValues.kingMiddle,
      kingSquare,
      isWhite
    );

  value += Math.floor(
    kingEarlyPhase * (1 - endgamePhaseWeight)
  );

  return value;
}

function evaluatePieceSquareTable(table, pieces, isWhite) {
  let value = 0;

  for (const piece of pieces) {
    if (piece.isActive) {
      value += PieceSquareValues.read(
        table,
        piece.occupiedSquare,
        isWhite
      );
    }
  }

  return value;
}



