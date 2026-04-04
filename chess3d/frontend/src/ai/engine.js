export function createAiEngine({
  getAllLegalMoves,
  simulateMove,
  isAnyKingInCheck,
  attackersOfSquare,
  staticExchangeEval,
  attacksSquareByPiece,
  moveHistory,
  lastMove,
  prevPiecesRef,
  searchStateRef,
}) {
  const evaluatePosition = (pieces, color) => {
        // stronger material emphasis and center control with piece-safety penalization
        const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9, K: 10000 };
        let score = 0;
        // central 8 squares explicit set (x,y,z)
        const central8 = new Set(['3,1,1','4,1,1','3,2,1','4,2,1','3,1,2','4,1,2','3,2,2','4,2,2']);
        // centrality function: prefer central ranks/files and middle levels
        const centrality = (x, y, z) => {
          let s = 0;
          if (x >= 2 && x <= 5) s += 2;
          if (y >= 1 && y <= 2) s += 2;
          if (z === 1 || z === 2) s += 1;
          return s;
        };
        
        // Count developed pieces (knights and bishops that have moved from starting squares)
        let developedMinorPieces = 0;
        let undevelopedMinorPieces = 0;
        const startingRanks = { white: 7, black: 0 };
        const startRank = startingRanks[color];
        
        // First pass: count development
        for (const p of pieces) {
          if (p.color === color && (p.t === 'N' || p.t === 'B')) {
            if (p.x !== startRank) {
              developedMinorPieces++;
            } else {
              undevelopedMinorPieces++;
            }
          }
        }
        
        // OVERWHELMING penalty for each undeveloped minor piece in opening
        // This creates massive pressure to develop - each undeveloped piece is worth -2 pawns
        score -= undevelopedMinorPieces * 25000;
        
        // OVERWHELMING bonus for each developed minor piece
        // Each developed piece is worth +3 pawns equivalent
        score += developedMinorPieces * 35000;
        
        for (const p of pieces) {
          const v = vals[p.t] || 0;
          const side = (p.color === color) ? 1 : -1;
          // material is primary
          score += side * v * 1000;
          
          // MAJOR penalty for moving queen early
          if (p.color === color && p.t === 'Q') {
            if (p.x !== startRank && developedMinorPieces < 2) {
              score -= 25000; // queen early = catastrophic
            }
          }
          
          // MAJOR penalty for moving rooks early
          if (p.color === color && p.t === 'R') {
            if (p.x !== startRank && developedMinorPieces < 2) {
              score -= 18000; // rook early also very bad
            }
          }
          
          // central control bonus scaled by piece strength
          const cent = centrality(p.x, p.y, p.z);
          score += side * v * 60 * cent;
          
          // explicit larger bonus for occupying the central 8 squares
          try {
            const key = `${p.x},${p.y},${p.z}`;
            if (central8.has(key)) {
              let occBonus = 500;
              if (p.t === 'p') occBonus = 1800; // pawns especially good in center
              if (p.t === 'N' || p.t === 'B') occBonus = 3000; // developed pieces in center even better
              score += side * occBonus;
            }
          } catch (e) {}
          
          // safety: penalize pieces that are attacked more times than defended
          try {
            const attackers = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color !== p.color).length;
            const defenders = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color === p.color).length;
            if (attackers > defenders) {
              const diff = attackers - defenders;
              // penalize proportionally to piece value and number of attackers
              score -= side * v * 400 * diff;
            }
          } catch (e) {}
        }
        
        // mobility and pawn structure: mobility bonus
        try {
          const myMoves = getAllLegalMoves(pieces, color) || [];
          const oppMoves = getAllLegalMoves(pieces, color === 'white' ? 'black' : 'white') || [];
          score += (myMoves.length - oppMoves.length) * 15;
        } catch (e) {}
        
          // control of central 8: reward having attackers on those squares
          try {
            let centralControl = 0;
            for (const sq of Array.from(central8)) {
              const [cx, cy, cz] = sq.split(',').map(Number);
              const attackers = attackersOfSquare(pieces, cx, cy, cz).filter(a => a.color === color).length;
              const enemyAttackers = attackersOfSquare(pieces, cx, cy, cz).filter(a => a.color !== color).length;
              centralControl += (attackers - enemyAttackers);
            }
            score += centralControl * 300;
          } catch (e) {}
        
        // tactical scan: detect if opponent has a fork (attack >=2 high-value pieces) and penalize
        try {
          const opponent = color === 'white' ? 'black' : 'white';
          const oppMoves = getAllLegalMoves(pieces, opponent) || [];
          let forkThreat = false;
          for (const m of oppMoves) {
            try {
              const next = simulateMove(pieces, m.moverId, { x: m.x, y: m.y, z: m.z });
              let attackedHigh = 0;
              for (const p of next) {
                if (p.color !== color) continue;
                if (!(p.t === 'N' || p.t === 'B' || p.t === 'R' || p.t === 'Q')) continue;
                const attackers = attackersOfSquare(next, p.x, p.y, p.z).filter(a => a.color !== p.color).length;
                if (attackers > 0) attackedHigh++;
                if (attackedHigh >= 2) break;
              }
              if (attackedHigh >= 2) { forkThreat = true; break; }
            } catch (e) {}
          }
          if (forkThreat) score -= 2500;
        } catch (e) {}
        return score;
        };

  const orderMoves = (moves, pieces, side) => {
        const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9 };
        const centerFactor = (m) => -(Math.abs(m.x - 3.5) + Math.abs(m.y - 1.5));
        const central8 = new Set(['3,1,1','4,1,1','3,2,1','4,2,1','3,1,2','4,1,2','3,2,2','4,2,2']);
        // precompute currently-attacked own pieces for defensive bonuses
        const attackedNow = (pieces || []).filter(p => p.color === side).map(p => {
          const attackers = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color !== p.color).length;
          const defenders = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color === p.color).length;
          return { id: p.id, x: p.x, y: p.y, z: p.z, attackers, defenders };
        });
        return moves.slice().sort((a, b) => {
          const occA = (pieces || []).find(pp => pp.x === a.x && pp.y === a.y && pp.z === a.z && pp.color !== side);
          const occB = (pieces || []).find(pp => pp.x === b.x && pp.y === b.y && pp.z === b.z && pp.color !== side);
          const capA = occA ? (vals[occA.t] || 0) * 100 : 0;
          const capB = occB ? (vals[occB.t] || 0) * 100 : 0;
          let scoreA = capA + centerFactor(a);
          let scoreB = capB + centerFactor(b);
          try {
            // simulate and penalize moves that leave more undefended own pieces
            const nextA = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
            const nextB = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
            const countUndef = (arr, who) => {
              let cnt = 0;
              for (const p of arr) {
                if (p.color !== who) continue;
                const attackers = attackersOfSquare(arr, p.x, p.y, p.z).filter(x => x.color !== p.color).length;
                const defenders = attackersOfSquare(arr, p.x, p.y, p.z).filter(x => x.color === p.color).length;
                if (attackers > defenders) cnt++;
              }
              return cnt;
            };
            const undefA = countUndef(nextA, side);
            const undefB = countUndef(nextB, side);
            // penalize more undefended pieces
            scoreA -= undefA * 500;
            scoreB -= undefB * 500;
            // detect opponent's last mover/capture using prevPiecesRef so we can prefer immediate recaptures/follow-ups
            try {
              const prev = (prevPiecesRef && prevPiecesRef.current) ? prevPiecesRef.current : [];
              let movedList = [];
              for (const p of pieces) {
                try {
                  const pv = prev.find(pp => pp.id === p.id) || null;
                  if (!pv || pv.x !== p.x || pv.y !== p.y || pv.z !== p.z) movedList.push({ before: pv, after: p });
                } catch (e) {}
              }
              const lastMover = (movedList.length > 0) ? movedList[movedList.length - 1].after : null;
              // find any piece that disappeared (captured) from prev to pieces
              let lastCaptured = null;
              for (const pv of prev) {
                try { if (!pieces.find(pp => pp.id === pv.id)) { lastCaptured = pv; break; } } catch (e) {}
              }
              if (lastMover && lastMover.color !== side) {
                try {
                  // if candidate captures the last mover directly, prioritize it
                  if (a.x === lastMover.x && a.y === lastMover.y && a.z === lastMover.z) { scoreA += 4200; try { console.debug('orderMoves: prefer capturing last mover', a, lastMover); } catch(e){} }
                  if (b.x === lastMover.x && b.y === lastMover.y && b.z === lastMover.z) { scoreB += 4200; try { console.debug('orderMoves: prefer capturing last mover', b, lastMover); } catch(e){} }
                  // also reward moves that increase our attackers on that square
                  try {
                    const afterAattackers = attackersOfSquare(nextA, lastMover.x, lastMover.y, lastMover.z).filter(x => x.color === side).length;
                    const afterBattackers = attackersOfSquare(nextB, lastMover.x, lastMover.y, lastMover.z).filter(x => x.color === side).length;
                    if (afterAattackers > 0) { scoreA += afterAattackers * 900; try { console.debug('orderMoves: increases attackers on lastMover square', a, afterAattackers); } catch(e){} }
                    if (afterBattackers > 0) { scoreB += afterBattackers * 900; try { console.debug('orderMoves: increases attackers on lastMover square', b, afterBattackers); } catch(e){} }
                  } catch (e) {}
                } catch (e) {}
              }
            } catch (e) {}
            // CRITICAL: Massively discourage early queen moves to enforce proper opening principles
            try {
              const ply = (moveHistory && moveHistory.length) ? moveHistory.length * 2 : 0;
              // Extremely harsh penalties for early queen moves - queen should stay home in opening!
              let earlyQueenPenalty = 0;
              if (ply < 10) earlyQueenPenalty = 50000; // moves 1-5: absolutely crushing penalty
              else if (ply < 16) earlyQueenPenalty = 25000; // moves 6-8: still massive
              else if (ply < 24) earlyQueenPenalty = 12000; // moves 9-12: very strong
              else if (ply < 32) earlyQueenPenalty = 5000; // moves 13-16: strong
              else earlyQueenPenalty = 1500; // later: mild
              
              const moverA = (pieces || []).find(pp => pp.id === a.moverId);
              const moverB = (pieces || []).find(pp => pp.id === b.moverId);
              
              // Apply queen penalty (reduced if capturing high-value piece)
              if (moverA && moverA.t === 'Q') {
                const cappedQueenA = (capA > 500) ? (earlyQueenPenalty * 0.3) : earlyQueenPenalty; // allow queen if capturing high value
                scoreA -= cappedQueenA;
                if (cappedQueenA > 1000) try { console.debug('orderMoves: CRUSHING early queen penalty', a, cappedQueenA, 'ply=', ply); } catch(e){}
              }
              if (moverB && moverB.t === 'Q') {
                const cappedQueenB = (capB > 500) ? (earlyQueenPenalty * 0.3) : earlyQueenPenalty;
                scoreB -= cappedQueenB;
                if (cappedQueenB > 1000) try { console.debug('orderMoves: CRUSHING early queen penalty', b, cappedQueenB, 'ply=', ply); } catch(e){}
              }
              
              // Reward developing minor pieces (knights, bishops) in opening - MASSIVE PRIORITY
              const developmentBonus = (ply < 20) ? 100000 : 15000; // OVERWHELMING bonus (increased from 25000)
              if (moverA && (moverA.t === 'N' || moverA.t === 'B') && !moverA.hasMoved) {
                scoreA += developmentBonus;
                try { console.debug('orderMoves: OVERWHELMING development bonus for', moverA.t, a, developmentBonus); } catch(e){}
              }
              if (moverB && (moverB.t === 'N' || moverB.t === 'B') && !moverB.hasMoved) {
                scoreB += developmentBonus;
                try { console.debug('orderMoves: OVERWHELMING development bonus for', moverB.t, b, developmentBonus); } catch(e){}
              }
              
              // CRITICAL: Massively penalize moving the same piece twice before development is complete
              try {
                const startRankWhite = 7;
                const startRankBlack = 0;
                const startRank = (side === 'white') ? startRankWhite : startRankBlack;
                
                // Count undeveloped minor pieces (knights/bishops still on starting rank)
                const undevelopedMinors = (pieces || []).filter(p => 
                  p.color === side && 
                  (p.t === 'N' || p.t === 'B') && 
                  p.x === startRank
                ).length;
                
                // If there are undeveloped pieces, heavily penalize moving already-moved pieces
                if (undevelopedMinors > 0 && ply < 24) {
                  if (moverA && moverA.hasMoved && (moverA.t !== 'K')) {
                    // Exception: allow if capturing valuable piece or escaping immediate threat
                    const isCapturingValuable = capA >= 300; // capturing knight or better
                    let isEscapingThreat = false;
                    try {
                      const attackers = attackersOfSquare(pieces, moverA.x, moverA.y, moverA.z).filter(att => att.color !== side).length;
                      const defenders = attackersOfSquare(pieces, moverA.x, moverA.y, moverA.z).filter(def => def.color === side).length;
                      isEscapingThreat = (attackers > defenders);
                    } catch (e) {}
                    
                    if (!isCapturingValuable && !isEscapingThreat) {
                      const penalty = 40000; // CRUSHING penalty for moving same piece twice
                      scoreA -= penalty;
                      try { console.debug('orderMoves: CRUSHING penalty for moving same piece twice', moverA.t, a, 'undeveloped=', undevelopedMinors, 'penalty=', penalty); } catch(e){}
                    }
                  }
                  
                  if (moverB && moverB.hasMoved && (moverB.t !== 'K')) {
                    const isCapturingValuable = capB >= 300;
                    let isEscapingThreat = false;
                    try {
                      const attackers = attackersOfSquare(pieces, moverB.x, moverB.y, moverB.z).filter(att => att.color !== side).length;
                      const defenders = attackersOfSquare(pieces, moverB.x, moverB.y, moverB.z).filter(def => def.color === side).length;
                      isEscapingThreat = (attackers > defenders);
                    } catch (e) {}
                    
                    if (!isCapturingValuable && !isEscapingThreat) {
                      const penalty = 40000;
                      scoreB -= penalty;
                      try { console.debug('orderMoves: CRUSHING penalty for moving same piece twice', moverB.t, b, 'undeveloped=', undevelopedMinors, 'penalty=', penalty); } catch(e){}
                    }
                  }
                }
              } catch (e) {}
              
              // Extra bonus for central development (knights to c3/f3/c6/f6 area, bishops to good diagonals)
              try {
                const central8 = new Set(['3,1,1','4,1,1','3,2,1','4,2,1','3,1,2','4,1,2','3,2,2','4,2,2']);
                const keyA = `${a.x},${a.y},${a.z}`;
                const keyB = `${b.x},${b.y},${b.z}`;
                if (moverA && (moverA.t === 'N' || moverA.t === 'B') && central8.has(keyA)) {
                  scoreA += 6000; // increased from 3000
                  try { console.debug('orderMoves: central development bonus', moverA.t, a); } catch(e){}
                }
                if (moverB && (moverB.t === 'N' || moverB.t === 'B') && central8.has(keyB)) {
                  scoreB += 6000;
                  try { console.debug('orderMoves: central development bonus', moverB.t, b); } catch(e){}
                }
                
                // Bonus for ANY piece attacking central squares (not just occupying)
                if (ply < 30) {
                  let centralAttacksA = 0;
                  let centralAttacksB = 0;
                  for (const sq of Array.from(central8)) {
                    const [cx, cy, cz] = sq.split(',').map(Number);
                    // Check if move A's piece can attack this central square after the move
                    try {
                      const nextA = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
                      const movedPiece = nextA.find(p => p.id === a.moverId);
                      if (movedPiece && attacksSquareByPiece(movedPiece, cx, cy, cz, nextA)) {
                        centralAttacksA++;
                      }
                    } catch (e) {}
                    try {
                      const nextB = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
                      const movedPiece = nextB.find(p => p.id === b.moverId);
                      if (movedPiece && attacksSquareByPiece(movedPiece, cx, cy, cz, nextB)) {
                        centralAttacksB++;
                      }
                    } catch (e) {}
                  }
                  if (centralAttacksA > 0) {
                    const bonus = centralAttacksA * 2500;
                    scoreA += bonus;
                    try { console.debug('orderMoves: central attack bonus', a, 'attacks=', centralAttacksA, 'bonus=', bonus); } catch(e){}
                  }
                  if (centralAttacksB > 0) {
                    const bonus = centralAttacksB * 2500;
                    scoreB += bonus;
                    try { console.debug('orderMoves: central attack bonus', b, 'attacks=', centralAttacksB, 'bonus=', bonus); } catch(e){}
                  }
                }
              } catch (e) {}
              
              // HUGE bonus for double-pawn moves if they're safe and advance toward center
              if (moverA && moverA.t === 'p' && ply < 20) {
                const pawnMoveDist = Math.abs(a.x - moverA.x);
                if (pawnMoveDist === 2) {
                  // This is a double-pawn move
                  // Check if it's safe (not immediately capturable with positive SEE)
                  try {
                    const nextA = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
                    const opponent = side === 'white' ? 'black' : 'white';
                    const oppMoves = getAllLegalMoves(nextA, opponent) || [];
                    let isSafe = true;
                    for (const oc of oppMoves) {
                      if (oc.x === a.x && oc.y === a.y && oc.z === a.z) {
                        try {
                          const see = staticExchangeEval(nextA, oc.x, oc.y, oc.z, opponent);
                          if (typeof see === 'number' && see > 0) { isSafe = false; break; }
                        } catch (e) {}
                      }
                    }
                    if (isSafe) {
                      // Extra bonus for central files
                      const centralFile = (a.y === 1 || a.y === 2) ? 50000 : 25000; // HUGE increase from 8000/4000
                      scoreA += centralFile;
                      try { console.debug('orderMoves: HUGE double-pawn move bonus', a, centralFile); } catch(e){}
                    }
                  } catch (e) {}
                }
              }
              if (moverB && moverB.t === 'p' && ply < 20) {
                const pawnMoveDist = Math.abs(b.x - moverB.x);
                if (pawnMoveDist === 2) {
                  try {
                    const nextB = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
                    const opponent = side === 'white' ? 'black' : 'white';
                    const oppMoves = getAllLegalMoves(nextB, opponent) || [];
                    let isSafe = true;
                    for (const oc of oppMoves) {
                      if (oc.x === b.x && oc.y === b.y && oc.z === b.z) {
                        try {
                          const see = staticExchangeEval(nextB, oc.x, oc.y, oc.z, opponent);
                          if (typeof see === 'number' && see > 0) { isSafe = false; break; }
                        } catch (e) {}
                      }
                    }
                    if (isSafe) {
                      const centralFile = (b.y === 1 || b.y === 2) ? 50000 : 25000; // HUGE increase from 8000/4000
                      scoreB += centralFile;
                      try { console.debug('orderMoves: HUGE double-pawn move bonus', b, centralFile); } catch(e){}
                    }
                  } catch (e) {}
                }
              }
              
              // Note: Pawn moves (both single and double) serve important purposes:
              // - Defend other pawns
              // - Open lines for bishops
              // - Control center
              // The AI should focus on DEVELOPING KNIGHTS AND BISHOPS, not avoiding pawn moves
              
              // MASSIVE penalties for early rook moves (ruins castling, wastes tempo)
              let earlyRookPenalty = 0;
              if (ply < 12) earlyRookPenalty = 35000; // moves 1-6: crushing
              else if (ply < 20) earlyRookPenalty = 15000; // moves 7-10: very strong
              else if (ply < 30) earlyRookPenalty = 3000; // moves 11-15: strong
              else earlyRookPenalty = 800; // later: mild
              if (moverA && moverA.t === 'R' && capA === 0) {
                // measure mobility improvement -- if small, apply extra penalty
                try {
                  const myMovesBefore = (getAllLegalMoves(pieces, side) || []).length;
                  const myMovesAfter = (getAllLegalMoves(nextA, side) || []).length;
                  const mobilityDelta = myMovesAfter - myMovesBefore;
                  if (mobilityDelta < 2) scoreA -= earlyRookPenalty + 600; else scoreA -= earlyRookPenalty;
                } catch (e) { scoreA -= earlyRookPenalty; }
                try {
                  // additional: penalize moving rook off an open file or losing file control
                  const rook = (pieces || []).find(pp => pp.id === a.moverId);
                  if (rook && rook.t === 'R') {
                    // file = y coordinate; open file = no pawns on that y
                    const pawnsOnFile = (pieces || []).filter(p => p.t === 'p' && p.y === rook.y).length;
                    const movesBeforeRook = (getAllLegalMoves(pieces, side) || []).filter(mv => mv.moverId === rook.id).length;
                    const movesAfterRook = (getAllLegalMoves(nextA, side) || []).filter(mv => mv.moverId === rook.id).length;
                    if (pawnsOnFile === 0 && a.y !== rook.y) {
                      scoreA -= 3000;
                      try { console.debug('orderMoves: penalize rook moving off open file', a, { pawnsOnFile, movesBeforeRook, movesAfterRook }); } catch(e){}
                    } else if (movesAfterRook < movesBeforeRook && movesBeforeRook >= 3) {
                      scoreA -= 1200;
                      try { console.debug('orderMoves: penalize rook mobility loss', a, { movesBeforeRook, movesAfterRook }); } catch(e){}
                    }
                    // penalize moving rook from back rank early
                    try {
                      const backRankX = (rook.color === 'white') ? 7 : 0;
                      if (rook.x === backRankX && a.x !== backRankX && (moveHistory && moveHistory.length) && moveHistory.length < 20) {
                        scoreA -= 1000;
                        try { console.debug('orderMoves: penalize early back-rank rook move', a, { rookBeforeX: rook.x }); } catch(e){}
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
              }
              if (moverB && moverB.t === 'R' && capB === 0) {
                try {
                  const myMovesBefore = (getAllLegalMoves(pieces, side) || []).length;
                  const myMovesAfter = (getAllLegalMoves(nextB, side) || []).length;
                  const mobilityDelta = myMovesAfter - myMovesBefore;
                  if (mobilityDelta < 2) scoreB -= earlyRookPenalty + 600; else scoreB -= earlyRookPenalty;
                } catch (e) { scoreB -= earlyRookPenalty; }
                try {
                  const rook = (pieces || []).find(pp => pp.id === b.moverId);
                  if (rook && rook.t === 'R') {
                    const pawnsOnFile = (pieces || []).filter(p => p.t === 'p' && p.y === rook.y).length;
                    const movesBeforeRook = (getAllLegalMoves(pieces, side) || []).filter(mv => mv.moverId === rook.id).length;
                    const movesAfterRook = (getAllLegalMoves(nextB, side) || []).filter(mv => mv.moverId === rook.id).length;
                    if (pawnsOnFile === 0 && b.y !== rook.y) {
                      scoreB -= 3000;
                      try { console.debug('orderMoves: penalize rook moving off open file', b, { pawnsOnFile, movesBeforeRook, movesAfterRook }); } catch(e){}
                    } else if (movesAfterRook < movesBeforeRook && movesBeforeRook >= 3) {
                      scoreB -= 1200;
                      try { console.debug('orderMoves: penalize rook mobility loss', b, { movesBeforeRook, movesAfterRook }); } catch(e){}
                    }
                    try {
                      const backRankX = (rook.color === 'white') ? 7 : 0;
                      if (rook.x === backRankX && b.x !== backRankX && (moveHistory && moveHistory.length) && moveHistory.length < 20) {
                        scoreB -= 1000;
                        try { console.debug('orderMoves: penalize early back-rank rook move', b, { rookBeforeX: rook.x }); } catch(e){}
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
              }
              // discourage early knight sorties if pawns haven't supported center (prefer pawn moves first)
              try {
                const pawnMovedCount = (pieces || []).filter(p => p.color === side && p.t === 'p' && p.hasMoved).length;
                const knightEarlyPenalty = (ply < 20 && pawnMovedCount < 2) ? 700 : 0;
                if (moverA && moverA.t === 'N' && capA === 0) scoreA -= knightEarlyPenalty;
                if (moverB && moverB.t === 'N' && capB === 0) scoreB -= knightEarlyPenalty;
                // discourage early king moves (except castling) strongly in opening unless they clearly improve safety
                try {
                  const kingEarlyCutoff = 20; // ply cutoff
                  const kingPenaltyBase = 10000;
                  const moverA_k = (pieces || []).find(pp => pp.id === a.moverId);
                  const moverB_k = (pieces || []).find(pp => pp.id === b.moverId);
                  if (ply < kingEarlyCutoff) {
                    if (moverA_k && moverA_k.t === 'K') {
                      const isCastle = Math.abs((a.y || 0) - (moverA_k.y || 0)) === 2;
                      if (!isCastle) {
                        try {
                          const attackersBefore = attackersOfSquare(pieces, moverA_k.x, moverA_k.y, moverA_k.z).filter(x => x.color !== side).length;
                          const attackersAfter = attackersOfSquare(nextA, a.x, a.y, a.z).filter(x => x.color !== side).length;
                          if (attackersAfter >= attackersBefore) {
                            scoreA -= kingPenaltyBase; // heavily discourage aimless king moves
                          } else {
                            scoreA -= Math.floor(kingPenaltyBase / 4); // small penalty even if it improves safety
                          }
                        } catch (e) { scoreA -= kingPenaltyBase; }
                      }
                    }
                    if (moverB_k && moverB_k.t === 'K') {
                      const isCastleB = Math.abs((b.y || 0) - (moverB_k.y || 0)) === 2;
                      if (!isCastleB) {
                        try {
                          const attackersBeforeB = attackersOfSquare(pieces, moverB_k.x, moverB_k.y, moverB_k.z).filter(x => x.color !== side).length;
                          const attackersAfterB = attackersOfSquare(nextB, b.x, b.y, b.z).filter(x => x.color !== side).length;
                          if (attackersAfterB >= attackersBeforeB) {
                            scoreB -= kingPenaltyBase;
                          } else {
                            scoreB -= Math.floor(kingPenaltyBase / 4);
                          }
                        } catch (e) { scoreB -= kingPenaltyBase; }
                      }
                    }
                  }
                } catch (e) {}
                // discourage moving the same minor piece twice in the opening (first 10 full moves)
                try {
                  const openingMinorPenalty = (ply < 20) ? 1800 : 800;
                  if (moverA && (moverA.t === 'N' || moverA.t === 'B') && moverA.hasMoved) {
                    scoreA -= openingMinorPenalty;
                    try { console.debug('orderMoves: penalize minor-piece moving twice in opening', a, openingMinorPenalty); } catch(e){}
                  }
                  if (moverB && (moverB.t === 'N' || moverB.t === 'B') && moverB.hasMoved) {
                    scoreB -= openingMinorPenalty;
                    try { console.debug('orderMoves: penalize minor-piece moving twice in opening', b, openingMinorPenalty); } catch(e){}
                  }
                } catch (e) {}
              } catch (e) {}
            } catch (e) {}
            // prefer castling moves
            try {
              if (a.castle) scoreA += 700;
              if (b.castle) scoreB += 700;
            } catch (e) {}
            // favor moves that occupy or increase control of central-8 squares
            try {
              const aKey = `${a.x},${a.y},${a.z}`;
              const bKey = `${b.x},${b.y},${b.z}`;
              if (central8.has(aKey)) { scoreA += 900; try { console.debug('orderMoves: central8 occupy bonus for move', a); } catch(e){} }
              if (central8.has(bKey)) { scoreB += 900; try { console.debug('orderMoves: central8 occupy bonus for move', b); } catch(e){} }
              // also reward moves that increase net attackers on central squares
              try {
                const nextA = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
                const nextB = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
                let deltaA = 0, deltaB = 0;
                for (const sq of Array.from(central8)) {
                  const [cx, cy, cz] = sq.split(',').map(Number);
                  const before = attackersOfSquare(pieces, cx, cy, cz).filter(x => x.color === side).length - attackersOfSquare(pieces, cx, cy, cz).filter(x => x.color !== side).length;
                  const afterA = attackersOfSquare(nextA, cx, cy, cz).filter(x => x.color === side).length - attackersOfSquare(nextA, cx, cy, cz).filter(x => x.color !== side).length;
                  const afterB = attackersOfSquare(nextB, cx, cy, cz).filter(x => x.color === side).length - attackersOfSquare(nextB, cx, cy, cz).filter(x => x.color !== side).length;
                  deltaA += (afterA - before);
                  deltaB += (afterB - before);
                }
                scoreA += deltaA * 220;
                scoreB += deltaB * 220;
                if (deltaA > 0) try { console.debug('orderMoves: increased central control by', deltaA, 'for', a); } catch(e) {}
                if (deltaB > 0) try { console.debug('orderMoves: increased central control by', deltaB, 'for', b); } catch(e) {}
              } catch (e) {}
              // if opponent just moved a pawn into central-8, prioritize moves that contest or defend it
              try {
                if (typeof lastMove !== 'undefined' && lastMove && lastMove.to) {
                  const lm = lastMove.to;
                  const lmKey = `${lm.x},${lm.y},${lm.z}`;
                  const oppPawnThere = (pieces || []).find(pp => pp.x === lm.x && pp.y === lm.y && pp.z === lm.z && pp.t === 'p' && pp.color !== side);
                  if (central8.has(lmKey) && oppPawnThere) {
                    // capturing that pawn is highest priority
                    if (a.x === lm.x && a.y === lm.y && a.z === lm.z) { scoreA += 8000; try { console.debug('orderMoves: capture central pawn priority', a); } catch(e){} }
                    if (b.x === lm.x && b.y === lm.y && b.z === lm.z) { scoreB += 8000; try { console.debug('orderMoves: capture central pawn priority', b); } catch(e){} }
                    // moving own pawn into central-8 to contest
                    if ((pieces || []).find(pp => pp.id === a.moverId && pp.t === 'p')) {
                      const aKey2 = `${a.x},${a.y},${a.z}`;
                      if (central8.has(aKey2)) { scoreA += 5000; try { console.debug('orderMoves: pawn contest central8 bonus', a); } catch(e){} }
                      // pawn approach bonus: reward pawn moves that move closer to any central8 square
                      try {
                        const pawnBefore = (pieces || []).find(pp => pp.id === a.moverId);
                        if (pawnBefore) {
                          let beforeDist = Infinity, afterDist = Infinity;
                          for (const sq of Array.from(central8)) {
                            const [cx, cy, cz] = sq.split(',').map(Number);
                            const dBefore = Math.abs(pawnBefore.x - cx) + Math.abs(pawnBefore.y - cy) + Math.abs(pawnBefore.z - cz);
                            const dAfter = Math.abs(a.x - cx) + Math.abs(a.y - cy) + Math.abs(a.z - cz);
                            if (dBefore < beforeDist) beforeDist = dBefore;
                            if (dAfter < afterDist) afterDist = dAfter;
                          }
                          const delta = beforeDist - afterDist;
                          if (delta > 0) { scoreA += delta * 1600; try { console.debug('orderMoves: pawn approach central8 bonus', a, delta); } catch(e){} }
                        }
                      } catch (e) {}
                    }
                    if ((pieces || []).find(pp => pp.id === b.moverId && pp.t === 'p')) {
                      const bKey2 = `${b.x},${b.y},${b.z}`;
                      if (central8.has(bKey2)) { scoreB += 5000; try { console.debug('orderMoves: pawn contest central8 bonus', b); } catch(e){} }
                      try {
                        const pawnBefore = (pieces || []).find(pp => pp.id === b.moverId);
                        if (pawnBefore) {
                          let beforeDist = Infinity, afterDist = Infinity;
                          for (const sq of Array.from(central8)) {
                            const [cx, cy, cz] = sq.split(',').map(Number);
                            const dBefore = Math.abs(pawnBefore.x - cx) + Math.abs(pawnBefore.y - cy) + Math.abs(pawnBefore.z - cz);
                            const dAfter = Math.abs(b.x - cx) + Math.abs(b.y - cy) + Math.abs(b.z - cz);
                            if (dBefore < beforeDist) beforeDist = dBefore;
                            if (dAfter < afterDist) afterDist = dAfter;
                          }
                          const delta = beforeDist - afterDist;
                          if (delta > 0) { scoreB += delta * 1600; try { console.debug('orderMoves: pawn approach central8 bonus', b, delta); } catch(e){} }
                        }
                      } catch (e) {}
                    }
                    // rewarding moves that increase defenders on that pawn
                    try {
                      const beforeDef = attackersOfSquare(pieces, lm.x, lm.y, lm.z).filter(a2 => a2.color === oppPawnThere.color).length;
                      const nextA2 = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
                      const nextB2 = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
                      const defA = attackersOfSquare(nextA2, lm.x, lm.y, lm.z).filter(a2 => a2.color === oppPawnThere.color).length;
                      const defB = attackersOfSquare(nextB2, lm.x, lm.y, lm.z).filter(a2 => a2.color === oppPawnThere.color).length;
                      // if our move increases attackers of that pawn by our side (i.e., we defend it), give bonus
                      const ourBefore = attackersOfSquare(pieces, lm.x, lm.y, lm.z).filter(a2 => a2.color === side).length;
                      const ourAfterA = attackersOfSquare(nextA2, lm.x, lm.y, lm.z).filter(a2 => a2.color === side).length;
                      const ourAfterB = attackersOfSquare(nextB2, lm.x, lm.y, lm.z).filter(a2 => a2.color === side).length;
                      const deltaOurA = ourAfterA - ourBefore;
                      const deltaOurB = ourAfterB - ourBefore;
                      if (deltaOurA > 0) { scoreA += deltaOurA * 2500; try { console.debug('orderMoves: defend opponent-central-pawn? increased our defenders by', deltaOurA, a); } catch(e){} }
                      if (deltaOurB > 0) { scoreB += deltaOurB * 2500; try { console.debug('orderMoves: defend opponent-central-pawn? increased our defenders by', deltaOurB, b); } catch(e){} }
                    } catch (e) {}
                  }
                }
              } catch (e) {}
            } catch (e) {}
            // avoid early non-capturing king moves unless in check
            try {
              const inCheck = isAnyKingInCheck(pieces, side);
              const moverA = (pieces || []).find(pp => pp.id === a.moverId);
              const moverB = (pieces || []).find(pp => pp.id === b.moverId);
              if (moverA && moverA.t === 'K' && !occA && !inCheck) scoreA -= 12000;
              if (moverB && moverB.t === 'K' && !occB && !inCheck) scoreB -= 12000;
              // extra: penalize king moves that reduce mobility or central presence when not capturing
              try {
                if (moverA && moverA.t === 'K' && !occA && !inCheck) {
                  const beforeMob = (getAllLegalMoves(pieces, side) || []).filter(mv => mv.moverId === moverA.id).length;
                  const afterA = simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z });
                  const afterMob = (getAllLegalMoves(afterA, side) || []).filter(mv => mv.moverId === moverA.id).length;
                  const mobDelta = afterMob - beforeMob;
                  const beforeCent = Math.abs(moverA.x - 3.5) + Math.abs(moverA.y - 1.5);
                  const afterCent = Math.abs(a.x - 3.5) + Math.abs(a.y - 1.5);
                  if (mobDelta < 0 || afterCent > beforeCent) { scoreA -= 3000; try { console.debug('orderMoves: penalize king retreat/mobility loss', { move: a, mobDelta, beforeCent, afterCent }); } catch(e){} }
                }
                if (moverB && moverB.t === 'K' && !occB && !inCheck) {
                  const beforeMob = (getAllLegalMoves(pieces, side) || []).filter(mv => mv.moverId === moverB.id).length;
                  const afterB = simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z });
                  const afterMob = (getAllLegalMoves(afterB, side) || []).filter(mv => mv.moverId === moverB.id).length;
                  const mobDelta = afterMob - beforeMob;
                  const beforeCent = Math.abs(moverB.x - 3.5) + Math.abs(moverB.y - 1.5);
                  const afterCent = Math.abs(b.x - 3.5) + Math.abs(b.y - 1.5);
                  if (mobDelta < 0 || afterCent > beforeCent) { scoreB -= 3000; try { console.debug('orderMoves: penalize king retreat/mobility loss', { move: b, mobDelta, beforeCent, afterCent }); } catch(e){} }
                }
              } catch (e) {}
            } catch (e) {}
            // prioritize immediate recapture of last moved-to square
            try {
              if (typeof lastMove !== 'undefined' && lastMove && lastMove.to) {
                const lx = lastMove.to.x, ly = lastMove.to.y, lz = lastMove.to.z;
                // require tactical sanity: only heavily prefer recapture if SEE is non-negative.
                try {
                  if (a.x === lx && a.y === ly && a.z === lz) {
                    try {
                      const seeA = staticExchangeEval(pieces, lx, ly, lz, side);
                      const moverA = (pieces || []).find(pp => pp.id === a.moverId) || null;
                      if (seeA >= 0) scoreA += 5000;
                      else {
                        if (moverA && (moverA.t === 'R' || moverA.t === 'Q')) scoreA -= 4000; else scoreA += 200;
                        try { console.debug('orderMoves: recapture discouraged by SEE', { move: a, seeA, mover: moverA && moverA.t }); } catch(e){}
                      }
                    } catch (e) { scoreA += 0; }
                  }
                } catch (e) {}
                try {
                  if (b.x === lx && b.y === ly && b.z === lz) {
                    try {
                      const seeB = staticExchangeEval(pieces, lx, ly, lz, side);
                      const moverB = (pieces || []).find(pp => pp.id === b.moverId) || null;
                      if (seeB >= 0) scoreB += 5000;
                      else {
                        if (moverB && (moverB.t === 'R' || moverB.t === 'Q')) scoreB -= 4000; else scoreB += 200;
                        try { console.debug('orderMoves: recapture discouraged by SEE', { move: b, seeB, mover: moverB && moverB.t }); } catch(e){}
                      }
                    } catch (e) { scoreB += 0; }
                  }
                } catch (e) {}
              }
            } catch (e) {}
            // reward moves that improve defenders on currently-attacked own pieces
            try {
              const defenderBonus = (m) => {
                let bonus = 0;
                try {
                  const next = simulateMove(pieces, m.moverId, { x: m.x, y: m.y, z: m.z });
                  for (const at of attackedNow) {
                    const afterOcc = next.find(pp => pp.id === at.id);
                    if (!afterOcc) continue; // captured
                    const attackersAfter = attackersOfSquare(next, afterOcc.x, afterOcc.y, afterOcc.z).filter(a => a.color !== afterOcc.color).length;
                    const defendersAfter = attackersOfSquare(next, afterOcc.x, afterOcc.y, afterOcc.z).filter(a => a.color === afterOcc.color).length;
                    // if defenders increased or attackers decreased, give bonus
                    if (defendersAfter > at.defenders) bonus += 400;
                    if (attackersAfter < at.attackers) bonus += 300;
                  }
                } catch (e) {}
                return bonus;
              };
              scoreA += defenderBonus(a);
              scoreB += defenderBonus(b);
            } catch (e) {}
            // If we have high-value own pieces currently attacked (B/N/R/Q), prefer moves that address them.
            try {
              const attackedHigh = (pieces || []).filter(p => p.color === side && (p.t === 'B' || p.t === 'N' || p.t === 'R' || p.t === 'Q')).map(p => {
                const attackers = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color !== p.color);
                const defenders = attackersOfSquare(pieces, p.x, p.y, p.z).filter(a => a.color === p.color);
                return { id: p.id, x: p.x, y: p.y, z: p.z, t: p.t, attackers: attackers, defenders: defenders };
              }).filter(h => h.attackers.length > h.defenders.length);
              if (attackedHigh && attackedHigh.length > 0) {
                const addressesThreat = (move, attackedList) => {
                  try {
                    const next = simulateMove(pieces, move.moverId, { x: move.x, y: move.y, z: move.z });
                    for (const hp of attackedList) {
                      // if our move captures one of the attackers, that's good
                      const attackersNow = attackersOfSquare(pieces, hp.x, hp.y, hp.z).filter(a => a.color !== hp.color);
                      for (const at of attackersNow) {
                        if (move.x === at.x && move.y === at.y && move.z === at.z) return true;
                      }
                      // if the threatened piece itself moved to safety
                      if (move.moverId === hp.id) {
                        const occAfter = next.find(pp => pp.id === hp.id);
                        if (!occAfter) return true; // moved/captured
                        const atkAfter = attackersOfSquare(next, occAfter.x, occAfter.y, occAfter.z).filter(a => a.color !== occAfter.color).length;
                        const defAfter = attackersOfSquare(next, occAfter.x, occAfter.y, occAfter.z).filter(a => a.color === occAfter.color).length;
                        if (defAfter >= atkAfter) return true;
                      }
                      // if our move increases defenders on threatened piece
                      const occAfter2 = next.find(pp => pp.id === hp.id);
                      if (occAfter2) {
                        const defAfter2 = attackersOfSquare(next, occAfter2.x, occAfter2.y, occAfter2.z).filter(a => a.color === occAfter2.color).length;
                        if (defAfter2 > hp.defenders.length) return true;
                      } else {
                        // piece disappeared (captured) - not good
                        return false;
                      }
                      // if our move captures the attacking piece by moving to their square
                    }
                  } catch (e) {}
                  return false;
                };
                try {
                  if (!addressesThreat(a, attackedHigh)) { scoreA -= 2000; try { console.debug('orderMoves: penalize move that ignores attacked high-value piece', a, attackedHigh); } catch(e){} }
                  if (!addressesThreat(b, attackedHigh)) { scoreB -= 2000; try { console.debug('orderMoves: penalize move that ignores attacked high-value piece', b, attackedHigh); } catch(e){} }
                } catch (e) {}
              }
            } catch (e) {}
            // reward moves that increase minor-piece mobility (knights and bishops)
            try {
              const minorMobility = (state, sideColor) => {
                let cnt = 0;
                for (const p of (state || [])) {
                  if (p.color !== sideColor) continue;
                  if (p.t !== 'N' && p.t !== 'B') continue;
                  try { cnt += (getAllLegalMoves(state, sideColor) || []).filter(mv => mv.moverId === p.id).length; } catch(e){}
                }
                return cnt;
              };
              try {
                const beforeMinor = (() => {
                  let c = 0; try { c = minorMobility(pieces, side); } catch(e){} return c;
                })();
                const afterA = (() => { try { return minorMobility(simulateMove(pieces, a.moverId, { x: a.x, y: a.y, z: a.z }), side); } catch(e){return 0;} })();
                const afterB = (() => { try { return minorMobility(simulateMove(pieces, b.moverId, { x: b.x, y: b.y, z: b.z }), side); } catch(e){return 0;} })();
                const deltaA = afterA - beforeMinor;
                const deltaB = afterB - beforeMinor;
                if (deltaA > 0) { scoreA += deltaA * 450; try { console.debug('orderMoves: minor mobility bonus', a, deltaA); } catch(e){} }
                if (deltaB > 0) { scoreB += deltaB * 450; try { console.debug('orderMoves: minor mobility bonus', b, deltaB); } catch(e){} }
              } catch (e){}
            } catch (e) {}
            // encourage pawn moves that open diagonals for bishops (development)
            try {
              const isPawnOpenForBishop = (move) => {
                try {
                  const mover = (pieces || []).find(pp => pp.id === move.moverId);
                  if (!mover || mover.t !== 'p') return 0;
                  const next = simulateMove(pieces, mover.id, { x: move.x, y: move.y, z: move.z });
                  // for each friendly bishop, count their legal moves before/after
                  let delta = 0;
                  for (const b of (pieces || []).filter(p => p.color === side && p.t === 'B')) {
                    const before = (getAllLegalMoves(pieces, side) || []).filter(mv=>mv.moverId===b.id).length;
                    const after = (getAllLegalMoves(next, side) || []).filter(mv=>mv.moverId===b.id).length;
                    delta += (after - before);
                  }
                  return delta;
                } catch (e) { return 0; }
              };
              const pawnOpenA = isPawnOpenForBishop(a);
              const pawnOpenB = isPawnOpenForBishop(b);
              if (pawnOpenA > 0) { scoreA += pawnOpenA * 700; try { console.debug('orderMoves: pawn move opens bishop mobility', a, pawnOpenA); } catch(e){} }
              if (pawnOpenB > 0) { scoreB += pawnOpenB * 700; try { console.debug('orderMoves: pawn move opens bishop mobility', b, pawnOpenB); } catch(e){} }
            } catch (e) {}
            // prefer favorable trades: use SEE to prefer captures that are non-negative
            try {
              if (occA) {
                try {
                  const seeA = staticExchangeEval(pieces, a.x, a.y, a.z, side);
                  if (seeA >= 0) {
                    scoreA += 1200;
                    try { console.debug('orderMoves: favorable trade (SEE) for', a, seeA); } catch(e){}
                  } else {
                    // penalize unsafe bishop/knight captures when SEE is negative (avoid cheap sacrifices)
                    const moverA = (pieces || []).find(pp => pp.id === a.moverId) || null;
                    if (moverA && (moverA.t === 'B' || moverA.t === 'N')) {
                      scoreA -= 3000;
                      try { console.debug('orderMoves: penalize unsafe minor-piece capture by SEE', a, seeA, moverA.t); } catch(e){}
                    }
                  }
                } catch (e) {}
              }
              if (occB) {
                try {
                  const seeB = staticExchangeEval(pieces, b.x, b.y, b.z, side);
                  if (seeB >= 0) {
                    scoreB += 1200;
                    try { console.debug('orderMoves: favorable trade (SEE) for', b, seeB); } catch(e){}
                  } else {
                    const moverB = (pieces || []).find(pp => pp.id === b.moverId) || null;
                    if (moverB && (moverB.t === 'B' || moverB.t === 'N')) {
                      scoreB -= 3000;
                      try { console.debug('orderMoves: penalize unsafe minor-piece capture by SEE', b, seeB, moverB.t); } catch(e){}
                    }
                  }
                } catch (e) {}
              }
            } catch (e) {}
          } catch (e) {}
          return scoreB - scoreA;
        });
        };

  const negamax = async (pieces, color, depth, alpha, beta, plyFromRoot = 0) => {
        // time cutoff or cancellation
        try { 
          if (searchStateRef.current && (Date.now() > searchStateRef.current.endTime || searchStateRef.current.cancelled)) {
            return evaluatePosition(pieces, color); 
          }
        } catch (e) {}
        
        // Mate distance pruning: prefer shorter mates
        if (plyFromRoot > 0) {
          alpha = Math.max(alpha, -100000 + plyFromRoot);
          beta = Math.min(beta, 100000 - plyFromRoot);
          if (alpha >= beta) return alpha;
        }

        // terminal checks
        const moves = getAllLegalMoves(pieces, color) || [];
        if (depth === 0 || moves.length === 0) {
          // if no moves, return checkmate or stalemate score
          if (moves.length === 0) {
            const inCheck = isAnyKingInCheck(pieces, color);
            return inCheck ? (-100000 + plyFromRoot) : 0; // checkmate or stalemate
          }
          // use quiescence search at leaf to resolve capture sequences
          try {
            return quiescenceSearch(pieces, color, alpha, beta, 4);
          } catch (e) {
            return evaluatePosition(pieces, color);
          }
        }

        const nextColor = color === 'white' ? 'black' : 'white';
        let value = -Infinity;
        const ordered = orderMoves(moves, pieces, color);

        let moveCount = 0;
        for (const m of ordered) {
          // Check cancellation and timeout
          try {
            if (searchStateRef.current && (Date.now() > searchStateRef.current.endTime || searchStateRef.current.cancelled)) {
              return evaluatePosition(pieces, color);
            }
          } catch (e) {}

          // Yield to browser every 3 moves to keep UI very responsive
          if (++moveCount % 3 === 0) {
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
          }

          const next = simulateMove(pieces, m.moverId, { x: m.x, y: m.y, z: m.z });
          const score = -await negamax(next, nextColor, depth - 1, -beta, -alpha, plyFromRoot + 1);
          value = Math.max(value, score);
          alpha = Math.max(alpha, value);
          if (alpha >= beta) break; // beta cutoff
        }
        return value;
  };

  // Quiescence search: explore capture sequences so static eval isn't fooled by immediate captures
  function quiescenceSearch(pieces, color, alpha, beta, depthLeft) {
        // stand-pat evaluation
        let standPat = evaluatePosition(pieces, color);
        if (standPat >= beta) return beta;
        if (alpha < standPat) alpha = standPat;
        if (depthLeft <= 0) return standPat;

        // generate capture moves only
        let captures = [];
        try {
          const all = getAllLegalMoves(pieces, color) || [];
          for (const m of all) {
            const occ = (pieces || []).find(pp => pp.x === m.x && pp.y === m.y && pp.z === m.z && pp.color !== color);
            // include en-passant and explicit captures
            if (occ || (m.enPassant)) captures.push(m);
          }
        } catch (e) { captures = []; }
        
        // if no captures, return stand-pat
        if (!captures || captures.length === 0) return standPat;
        
        // order captures by victim value
        captures = orderMoves(captures, pieces, color);
        const nextColor = color === 'white' ? 'black' : 'white';
        
        let value = -Infinity;
        for (const m of captures) {
          try { if (searchStateRef.current && (Date.now() > searchStateRef.current.endTime || searchStateRef.current.cancelled)) return evaluatePosition(pieces, color); } catch (e) {}
          
          const next = simulateMove(pieces, m.moverId, { x: m.x, y: m.y, z: m.z });
          const score = -quiescenceSearch(next, nextColor, -beta, -alpha, depthLeft - 1);
          value = Math.max(value, score);
          alpha = Math.max(alpha, value);
          if (alpha >= beta) break;
        }
        return value;
        }

  return {
    evaluatePosition,
    orderMoves,
    negamax,
  };
}
