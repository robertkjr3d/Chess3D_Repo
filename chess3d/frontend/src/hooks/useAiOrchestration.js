import { useEffect } from "react";
import { API_BASE_URL } from '../config';
import { computeFen } from '../utils/chessLogic';

export function useAiOrchestration({
  aiSide,
  gameOver,
  currentTurn,
  aiStrength,
  aiDelay,
  aiPaused,
  viewIndex,
  piecesState,
  moveHistory,
  lastMove,
  aiDelayRef,
  aiStrengthRef,
  aiLastMoveCountRef,
  aiTimeoutRef,
  coordMoveHistoryRef,
  prevPiecesRef,
  searchStateRef,
  setAiThinking,
  rebuildCoordMoveHistory,
  getAllLegalMoves,
  simulateMove,
  negamax,
  applyMove,
  orderMoves,
  isAnyKingInCheck,
  staticExchangeEval,
  attackersOfSquare,
  pushDebug,
  aiPausedRef,
}) {
      useEffect(() => {
        try { 
          console.log('=== AI useEffect TRIGGERED ===', {
            aiSide, gameOver, currentTurn,
            aiSideCheck: !aiSide ? 'FAIL' : 'PASS',
            gameOverCheck: gameOver ? 'FAIL' : 'PASS', 
            currentTurnCheck: currentTurn !== aiSide ? 'FAIL' : 'PASS'
          }); 
        } catch (e) {}
        
        if (!aiSide) return;
        if (gameOver) return;
        if (aiSide !== 'both' && currentTurn !== aiSide) return;
        
        // Get current move count (number of half-moves played)
        const currentMoveCount = (moveHistory || []).reduce((sum, entry) => {
          return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
        }, 0);
        
        try { 
          console.log('AI useEffect: currentTurn=', currentTurn, 'aiSide=', aiSide, 
                      'currentMoveCount=', currentMoveCount, 'aiLastMoveCountRef=', aiLastMoveCountRef.current); 
        } catch (e) {}
        
        // Prevent AI from making multiple moves for the same position
        // AI should only play when the move count has INCREASED since it last played
        if (aiLastMoveCountRef.current >= currentMoveCount) {
          try { console.debug('AI useEffect blocked: already played for move', currentMoveCount, 'lastPlayed=', aiLastMoveCountRef.current); } catch (e) {}
          return;
        }
        
        // Don't start next move if paused or while the user is browsing history
        if (aiPaused) return;
        if (viewIndex !== null) return;

        // IMMEDIATELY mark this move count as being processed to preventrace conditions
        // This prevents multiple setTimeout instances from starting if useEffect fires rapidly
        aiLastMoveCountRef.current = currentMoveCount;
        try { console.debug('AI started thinking for move', currentMoveCount, 'ref set to', currentMoveCount); } catch (e) {}
        
        // Clear any existing timeout if it's for a DIFFERENT move
        if (aiTimeoutRef.current.id && aiTimeoutRef.current.moveCount !== currentMoveCount) {
          try { console.debug('AI: Clearing old timeout for different move', aiTimeoutRef.current.moveCount, 'vs', currentMoveCount); } catch (e) {}
          clearTimeout(aiTimeoutRef.current.id);
          aiTimeoutRef.current = { id: null, moveCount: null };
        }
        
        // For AI vs AI: act as the side whose turn it is right now
        const effectiveSide = aiSide === 'both' ? currentTurn : aiSide;
        const thinkDelay = Math.max(150, aiDelayRef.current) + Math.floor(Math.random() * 200);
        if (aiSide !== 'both') setAiThinking(true);
        const t = setTimeout(() => {
          (async () => {
            try {
              // Clear timeout ref when we start executing  (timeout has fired)
              aiTimeoutRef.current = { id: null, moveCount: null };
              // Shadow outer aiSide so all existing logic below uses the correct acting side
              const aiSide = effectiveSide; // eslint-disable-line no-shadow

              // â”€â”€ the engine backend path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              let engineAttempted = false;
              if (aiStrengthRef.current !== 'dumb' && aiSide) {
                try {
                  // Use raw coordinate move list (e.g. "2d82c6") â€” guaranteed parseable by C++ engine
                  // This avoids divergence from algebraic notation the engine may not fully understand

                  // Safety: if coord history is out of sync (e.g. loaded from old save without coordMoveHistory),
                  // rebuild it by simulating from start using the stored algebraic notation.
                  const expectedHalfMoves = (moveHistory || []).reduce((s, e) => s + (e.white ? 1 : 0) + (e.black ? 1 : 0), 0);
                  if (coordMoveHistoryRef.current.length < expectedHalfMoves - 1) {
                    console.log('Engine: coordMoveHistory out of sync (have', coordMoveHistoryRef.current.length, ', expected ~', expectedHalfMoves, ') â€” rebuilding...');
                    rebuildCoordMoveHistory();
                  }

                  const movesFlat = coordMoveHistoryRef.current.slice();
                  console.log('Engine coord moves:', movesFlat);
                  // Compute FEN from current board state â€” avoids castling/move-replay desync
                  const livePiecesForFen = prevPiecesRef.current || piecesState || [];
                  const fenStr = computeFen(livePiecesForFen, currentTurn, lastMove, (moveHistory || []).length);
                  console.log('Engine FEN:', fenStr);
                  // Smart AI: depth 8 / 5s | Smarter AI: depth 14 / 12s
                  const sfDepth = aiStrengthRef.current === 'smarter' ? 14 : 8;
                  const sfTimeMs = aiStrengthRef.current === 'smarter' ? 12000 : 5000;
                  const sfUrl = `${API_BASE_URL}/api/ai/bestmove`;
                  console.log('Calling Engine at', sfUrl, 'fen:', fenStr);
                  const sfResp = await fetch(sfUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fen: fenStr, moves: movesFlat, depth: sfDepth, timeMs: sfTimeMs }),
                    signal: AbortSignal.timeout(sfTimeMs + 8000)
                  });
                  console.log('Engine HTTP status:', sfResp.status);
                  if (sfResp.ok) {
                    const sfResult = await sfResp.json();
                    engineAttempted = true; // Engine responded â€” do NOT fall back to JS AI
                    console.log('Engine result:', sfResult, 'searchDepth:', sfResult.searchDepth);
                    // Parse LfileRank notation (e.g. "1a4") â†’ internal {x,y,z}
                    const parseQL = (s) => {
                      const m = s && s.match(/^([1-4])([a-h])([1-8])$/);
                      if (!m) return null;
                      return { z: Number(m[1]) - 1, y: m[2].charCodeAt(0) - 97, x: 8 - Number(m[3]) };
                    };
                    const toCoord = parseQL(sfResult.toNotation);
                    const fromCoord = parseQL(sfResult.fromNotation);
                    // Log every piece that is on the from-square regardless of color, to diagnose lookup failures
                    const livePiecesAll = prevPiecesRef.current || piecesState || [];
                    const piecesAtFrom = fromCoord ? livePiecesAll.filter(p => p.x === fromCoord.x && p.y === fromCoord.y && p.z === fromCoord.z) : [];
                    console.log('Engine lookup debug: fromCoord=', fromCoord, 'toCoord=', toCoord,
                      'aiSide=', aiSide, 'livePieces.length=', livePiecesAll.length,
                      'piecesAtFromSquare=', piecesAtFrom);
                    if (toCoord) {
                      // Use prevPiecesRef.current â€” piecesState closure is stale inside setTimeout
                      const livePieces = livePiecesAll.length > 0 ? livePiecesAll : (piecesState || []);
                      let mover = null;
                      // Find piece at source square â€” no color filter needed, the engine only returns moves for aiSide
                      if (fromCoord) {
                        mover = livePieces.find(p =>
                          p.x === fromCoord.x && p.y === fromCoord.y && p.z === fromCoord.z
                        );
                        if (mover) console.log('Engine: found mover by fromCoord', fromCoord, mover);
                      }
                      // Fallback: any legal move whose source AND destination both match
                      if (!mover) {
                        console.warn('Engine: no piece at fromCoord', fromCoord, 'â€” searching legal moves for toCoord', toCoord);
                        const allLegal = getAllLegalMoves(livePieces, aiSide) || [];
                        console.log('Engine: legal moves for', aiSide, allLegal.length, 'moves');
                        // First try: match both source and destination
                        let match = fromCoord
                          ? allLegal.find(mv =>
                              mv.x === toCoord.x && mv.y === toCoord.y && mv.z === toCoord.z &&
                              livePieces.find(p => p.id === mv.moverId && p.x === fromCoord.x && p.y === fromCoord.y && p.z === fromCoord.z)
                            )
                          : null;
                        // Second try: destination only
                        if (!match) match = allLegal.find(mv => mv.x === toCoord.x && mv.y === toCoord.y && mv.z === toCoord.z);
                        if (match) mover = livePieces.find(p => p.id === match.moverId);
                      }
                      if (mover) {
                        // If the engine flagged this as a castling move, build
                        // the castle metadata that applyMove needs to also move the rook.
                        let enrichedTarget = toCoord;
                        if (sfResult.isCastling && mover.t === 'K' && fromCoord) {
                          try {
                            const sx = fromCoord.x, sy = fromCoord.y, sz = fromCoord.z;
                            const ky = toCoord.y, kz = toCoord.z;
                            const dy = Math.abs(ky - sy), dz = Math.abs(kz - sz);
                            // rookFromMap: keyed by Black convention (x=0); Y/Z same for both colours
                            const rookFromMap = {
                              '0,2,2->0,3,2': '0,3,3', '0,2,2->0,2,3': '0,3,3',
                              '0,1,1->0,1,0': '0,0,0', '0,1,1->0,0,1': '0,0,0',
                              '0,1,1->0,3,1': '0,3,0', '0,1,1->0,1,3': '0,0,3',
                              '0,2,2->0,0,2': '0,0,3', '0,2,2->0,2,0': '0,3,0',
                            };
                            const mapKey = '0,' + sy + ',' + sz + '->0,' + ky + ',' + kz;
                            const rookFromStr = rookFromMap[mapKey];
                            if (rookFromStr) {
                              const rfParts = rookFromStr.split(',').map(Number);
                              const ry = rfParts[1], rz = rfParts[2], rx = sx;
                              const rook = livePieces.find(p =>
                                p.t === 'R' && p.color === aiSide && p.x === rx && p.y === ry && p.z === rz
                              );
                              if (rook) {
                                const isQueenSide = (dy === 2 || dz === 2);
                                const axis = dy > 0 ? 'y' : 'z';
                                const rookTo = isQueenSide
                                  ? (axis === 'y'
                                    ? { x: sx, y: sy + Math.sign(ky - sy), z: sz }
                                    : { x: sx, y: sy, z: sz + Math.sign(kz - sz) })
                                  : { x: sx, y: sy, z: sz };
                                enrichedTarget = { ...toCoord, castle: {
                                  type: isQueenSide ? 'queen' : 'king',
                                  rookId: rook.id,
                                  rookFrom: { x: rx, y: ry, z: rz },
                                  rookTo
                                }};
                                console.log('Engine: castling detected via engine flag', enrichedTarget.castle);
                              } else {
                                console.warn('Engine: castling flagged but rook not found at', {x: rx, y: ry, z: rz});
                              }
                            } else {
                              console.warn('Engine: castling flagged but no rookFromMap entry for', mapKey);
                            }
                          } catch (e) {
                            console.warn('Engine: castle metadata construction failed', e);
                          }
                        }
                        if (aiPausedRef.current) { console.log('Engine: AI paused â€” suppressing move'); return; }
                        applyMove(mover.id, enrichedTarget);
                        console.log('Engine move applied:', sfResult.raw, 'â†’ piece', mover.t, mover.color, 'to', enrichedTarget);
                        return; // done â€” skip JS negamax
                      }
                      console.warn('Engine: could not map move to piece, falling back to JS AI', sfResult, 'fromCoord:', fromCoord, 'toCoord:', toCoord);
                    }
                  } else {
                    const errBody = await sfResp.text().catch(() => '(no body)');
                    console.warn('Engine API returned', sfResp.status, 'â€” body:', errBody, 'â€” falling back to JS AI');
                  }
                } catch (sfErr) {
                  console.warn('Engine call failed, falling back to JS AI:', sfErr);
                }
              }
              // â”€â”€ end The Engine path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              // If The Engine responded (even if piece lookup failed), do not run JS AI
              if (engineAttempted) {
                console.warn('Engine responded but piece lookup failed â€” skipping JS AI to avoid override');
                return;
              }

              // Random opening move for AI White
              if (aiSide === 'white' && moveHistory.length === 0) {
                const openingMoves = ['2c4', '2b4', '3c4', '3b4'];
                const selectedOpening = openingMoves[Math.floor(Math.random() * openingMoves.length)];
                console.log(`AI White: Selected random opening move: ${selectedOpening}`);
                
                // Parse notation: format is "ZYX" where Z=level(1-4), Y=file(a-d), X=rank(1-8)
                // Example: "2c5" means level 2, file c, rank 5
                const parseNotation = (s) => {
                  const m = s.match(/^([1-4])([a-d])([1-8])$/);
                  if (!m) return null;
                  const z = Number(m[1]) - 1;  // level 0-3
                  const y = m[2].charCodeAt(0) - 'a'.charCodeAt(0);  // file 0-3 (a=0, b=1, c=2, d=3)
                  const x = 8 - Number(m[3]);  // rank to x: rank 8â†’x=0, rank 1â†’x=7
                  return { x, y, z };
                };
                
                const targetSquare = parseNotation(selectedOpening);
                console.log(`AI White: Parsed target square:`, targetSquare);
                
                if (targetSquare) {
                  // Find the pawn that can move to this square
                  // White pawns start at x=6 (rank 2)
                  const pawn = (piecesState || []).find(p => 
                    p.color === 'white' && 
                    p.t === 'p' && 
                    p.y === targetSquare.y && 
                    p.z === targetSquare.z &&
                    p.x === 6
                  );
                  
                  console.log(`AI White: Found pawn:`, pawn);
                  
                  if (pawn) {
                    try {
                      applyMove(pawn.id, { x: targetSquare.x, y: targetSquare.y, z: targetSquare.z });
                      console.log(`AI White: Successfully applied opening move ${selectedOpening}`);
                      return;
                    } catch (e) {
                      console.error('AI White: Failed to apply opening move', e);
                    }
                  } else {
                    console.warn('AI White: Could not find pawn for opening move', selectedOpening, 'at position', targetSquare);
                    // List all white pawns for debugging
                    const allWhitePawns = (piecesState || []).filter(p => p.color === 'white' && p.t === 'p');
                    console.log('AI White: All white pawns:', allWhitePawns);
                  }
                }
              }
              
              let moves = getAllLegalMoves(piecesState, aiSide || 'black');
              
              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
              
              // CRITICAL: Hard filter to completely block early queen moves in opening
              try {
                const plyCount = (moveHistory || []).length || 0;
                const totalPlies = plyCount * 2; // convert to half-moves
                
                // Count developed minor pieces (knights and bishops off starting rank)
                const startRank = aiSide === 'white' ? 7 : 0;
                const developedMinors = (piecesState || []).filter(p => 
                  p.color === aiSide && 
                  (p.t === 'N' || p.t === 'B') && 
                  p.x !== startRank
                ).length;
                
                // ABSOLUTE BAN on queen moves until move 10+ (totalPlies >= 20)
                if (totalPlies < 20) {
                  const beforeFilter = moves.length;
                  moves = moves.filter(m => {
                    const mover = (piecesState || []).find(p => p.id === m.moverId);
                    // Allow only if not a queen, OR if queen is capturing a high-value piece (R/Q)
                    if (mover && mover.t === 'Q') {
                      const target = (piecesState || []).find(p => p.x === m.x && p.y === m.y && p.z === m.z && p.color !== aiSide);
                      const isHighValueCapture = target && (target.t === 'Q' || target.t === 'R');
                      if (!isHighValueCapture) {
                        console.log(`AI: BLOCKED early queen move to ${m.x},${m.y},${m.z} (totalPlies=${totalPlies}, must wait until move 10+)`);
                        return false; // BLOCK IT
                      }
                    }
                    return true;
                  });
                  if (beforeFilter !== moves.length) {
                    console.log(`AI: Filtered out ${beforeFilter - moves.length} early queen moves, ${moves.length} moves remain`);
                  }
                }
                
                // BLOCK pointless queen shuffling on back rank (beginner move with no purpose)
                const beforeBackRankFilter = moves.length;
                moves = moves.filter(m => {
                  const mover = (piecesState || []).find(p => p.id === m.moverId);
                  if (mover && mover.t === 'Q' && mover.x === startRank && m.x === startRank) {
                    // Queen moving along back rank - only allow if defending an attacked piece
                    const target = (piecesState || []).find(p => p.x === m.x && p.y === m.y && p.z === m.z);
                    if (!target) {
                      // Not capturing, check if this defends anything meaningful
                      let hasDefensivePurpose = false;
                      try {
                        const nextPieces = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                        for (const p of nextPieces) {
                          if (p.color === aiSide && p.id !== m.moverId) {
                            const defendersBefore = attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            const defendersAfter = attackersOfSquare(nextPieces, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            if (defendersAfter > defendersBefore) {
                              hasDefensivePurpose = true;
                              break;
                            }
                          }
                        }
                      } catch (e) {}
                      
                      if (!hasDefensivePurpose) {
                        console.log(`AI: BLOCKED pointless queen shuffle on back rank from ${mover.y},${mover.z} to ${m.y},${m.z}`);
                        return false; // BLOCK IT
                      }
                    }
                  }
                  return true;
                });
                if (beforeBackRankFilter !== moves.length) {
                  console.log(`AI: Filtered out ${beforeBackRankFilter - moves.length} pointless queen back-rank shuffles`);
                }
              } catch (e) {
                console.error('AI: Early queen filter error', e);
              }
              
              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
              
              // CRITICAL: Hard filter to block early rook moves (ruins castling, wastes tempo)
              try {
                const plyCount = (moveHistory || []).length || 0;
                const totalPlies = plyCount * 2;
                
                // Count developed pieces
                const startRank = aiSide === 'white' ? 7 : 0;
                const developedMinors = (piecesState || []).filter(p => 
                  p.color === aiSide && 
                  (p.t === 'N' || p.t === 'B') && 
                  p.x !== startRank
                ).length;
                
                const movedPawns = (piecesState || []).filter(p => 
                  p.color === aiSide && 
                  p.t === 'p' && 
                  p.hasMoved
                ).length;
                
                // Check if we've castled yet
                const kingPiece = (piecesState || []).find(p => p.color === aiSide && p.t === 'K');
                const hasCastled = kingPiece && kingPiece.hasMoved; // simplified check
                
                // BLOCK rook moves if:
                // - Before move 10 AND
                // - Haven't developed at least 2 minor pieces AND
                // - Haven't castled yet
                if (totalPlies < 20 && developedMinors < 2 && !hasCastled) {
                  const beforeFilter = moves.length;
                  moves = moves.filter(m => {
                    const mover = (piecesState || []).find(p => p.id === m.moverId);
                    if (mover && mover.t === 'R') {
                      // Allow only if capturing a valuable piece
                      const target = (piecesState || []).find(p => p.x === m.x && p.y === m.y && p.z === m.z && p.color !== aiSide);
                      const isGoodCapture = target && (target.t === 'Q' || target.t === 'R' || target.t === 'B' || target.t === 'N');
                      if (!isGoodCapture) {
                        console.log(`AI: BLOCKED early rook move to ${m.x},${m.y},${m.z} (developedMinors=${developedMinors}, hasCastled=${hasCastled}, totalPlies=${totalPlies})`);
                        return false; // BLOCK IT
                      }
                    }
                    return true;
                  });
                  if (beforeFilter !== moves.length) {
                    console.log(`AI: Filtered out ${beforeFilter - moves.length} early rook moves`);
                  }
                }
              } catch (e) {
                console.error('AI: Early rook filter error', e);
              }
              
              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
              
              // CRITICAL: Hard filter to block moving the same piece twice before development
              try {
                const plyCount = (moveHistory || []).length || 0;
                const totalPlies = plyCount * 2;
                
                // Count undeveloped minor pieces (knights/bishops on starting rank)
                const startRank = aiSide === 'white' ? 7 : 0;
                const undevelopedMinors = (piecesState || []).filter(p => 
                  p.color === aiSide && 
                  (p.t === 'N' || p.t === 'B') && 
                  p.x === startRank
                ).length;
                
                // BLOCK moving any piece that has already moved if we have undeveloped minors
                if (undevelopedMinors > 0 && totalPlies < 24) {
                  const beforeFilter = moves.length;
                  moves = moves.filter(m => {
                    const mover = (piecesState || []).find(p => p.id === m.moverId);
                    if (mover && mover.hasMoved && mover.t !== 'K') {
                      // Exceptions: allow if capturing valuable piece or escaping threat
                      const target = (piecesState || []).find(p => p.x === m.x && p.y === m.y && p.z === m.z && p.color !== aiSide);
                      const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9 };
                      const targetValue = target ? (vals[target.t] || 0) : 0;
                      const isCapturingValuable = targetValue >= 3; // knight or better
                      
                      let isEscapingThreat = false;
                      try {
                        const attackers = attackersOfSquare(piecesState, mover.x, mover.y, mover.z).filter(a => a.color !== aiSide).length;
                        const defenders = attackersOfSquare(piecesState, mover.x, mover.y, mover.z).filter(a => a.color === aiSide).length;
                        isEscapingThreat = (attackers > defenders);
                      } catch (e) {}
                      
                      if (!isCapturingValuable && !isEscapingThreat) {
                        console.log(`AI: BLOCKED moving same ${mover.t} twice (from ${mover.x},${mover.y},${mover.z} to ${m.x},${m.y},${m.z}) - undeveloped minors: ${undevelopedMinors}`);
                        return false; // BLOCK IT
                      }
                    }
                    return true;
                  });
                  if (beforeFilter !== moves.length) {
                    console.log(`AI: Filtered out ${beforeFilter - moves.length} repeat moves, ${moves.length} moves remain`);
                  }
                }
              } catch (e) {
                console.error('AI: Repeat move filter error', e);
              }
              
              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
              
              // Hard-ban early non-castling king moves if castling is currently available
              try {
                const plyCount = (moveHistory || []).length || 0;
                // consider castling rights possible if king and at least one rook haven't moved (even if castling isn't legal right now)
                const kingPiece = (piecesState || []).find(p => p.color === aiSide && p.t === 'K');
                const rookExists = (piecesState || []).some(p => p.color === aiSide && p.t === 'R' && !p.hasMoved);
                const castleAvailable = kingPiece && !kingPiece.hasMoved && rookExists;
                if (castleAvailable && plyCount < 12) {
                  const nonKing = (moves || []).filter(m => {
                    try {
                      const pm = (piecesState || []).find(p => p.id === m.moverId) || null;
                      if (!pm) return true;
                      // allow castling moves, disallow other king moves
                      if (pm.t === 'K' && !(m && m.castle)) return false;
                      return true;
                    } catch (e) { return true; }
                  });
                  if (nonKing.length > 0) {
                    try { console.debug('AI filtered out early non-castling king moves to preserve castling', { before: moves.length, after: nonKing.length }); } catch (e) {}
                    moves = nonKing;
                  }
                }
              } catch (e) {}
              if (!moves || moves.length === 0) return;

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Opening book reply (best-effort, safe-guarded)
              try {
                const openingMap = {
                  '3c4': '3c5', '3b4': '3b5', '2b4': '2b5', '2c4': '2c5', '2a4': '2c5', '2d4': '2b5',
                  '3a4': '3c5', '3d4': '3b5', 'N1c3': '2c5', 'N2b3': '2c5', 'N2c3': '2c5', 'N3d3': '2b5',
                  'N4b3': '3b5', 'N3c3': '3b5'
                };
                const parseNotation = (s) => {
                  if (!s || typeof s !== 'string') return null;
                  const m = s.match(/^([1-4])([a-d])([1-8])$/);
                  if (!m) return null;
                  const z = Number(m[1]) - 1;
                  const y = m[2].charCodeAt(0) - 'a'.charCodeAt(0);
                  const x = 8 - Number(m[3]);
                  return { x, y, z };
                };
                const lastEntry = (moveHistory && moveHistory.length) ? moveHistory[moveHistory.length - 1] : null;
                if (lastEntry && moveHistory.length === 1) {
                  const lastNotationRaw = (aiSide === 'black') ? lastEntry.white : lastEntry.black;
                  let lastNotation = lastNotationRaw;
                  try { if (lastNotation) lastNotation = lastNotation.replace(/\([^)]*\)/g, '').replace(/x/g, '').trim(); } catch (e) {}
                  if (lastNotation) {
                    let matched = null; let reply = null; let usedMirror = false;
                    if (openingMap[lastNotation]) { matched = lastNotation; reply = openingMap[lastNotation]; }
                    else {
                      try {
                        const mm = (lastNotation || '').match(/^([NBRQK]?)([1-4][a-d][1-8])$/i);
                        if (mm) {
                          const prefix = mm[1] || '';
                          const core = mm[2];
                          const parsed = parseNotation(core);
                          if (parsed) {
                            const mirrored = { x: 7 - parsed.x, y: parsed.y, z: parsed.z };
                            const mirroredKey = prefix + (mirrored.z + 1) + String.fromCharCode('a'.charCodeAt(0) + mirrored.y) + (8 - mirrored.x);
                            if (openingMap[mirroredKey]) { matched = mirroredKey; reply = openingMap[mirroredKey]; usedMirror = true; }
                          }
                        }
                      } catch (e) {}
                    }
                    // if nothing matched and this is Black's first automatic reply, default to 3c5
                    try {
                      if (!matched && aiSide === 'black' && (!moveHistory || moveHistory.length === 1)) {
                        matched = '3c5'; reply = '3c5'; usedMirror = false;
                      }
                    } catch (e) {}

                    if (matched && reply) {
                      let coord = parseNotation(reply);
                      if (coord) {
                        if (usedMirror) coord = { x: 7 - coord.x, y: coord.y, z: coord.z };
                      }
                      const candidate = moves.find(m => m.x === coord.x && m.y === coord.y && m.z === coord.z);
                      if (candidate) {
                        try {
                          const nextTmp = simulateMove(piecesState, candidate.moverId, { x: candidate.x, y: candidate.y, z: candidate.z });
                          const opp = aiSide === 'white' ? 'black' : 'white';
                          const oppMovesTmp = getAllLegalMoves(nextTmp, opp) || [];
                          let unsafe = false;
                          for (const oc of oppMovesTmp) {
                            const targetOcc = nextTmp.find(pp => pp.x === oc.x && pp.y === oc.y && pp.z === oc.z && pp.color === aiSide);
                            if (!targetOcc) continue;
                            try { if (staticExchangeEval(nextTmp, oc.x, oc.y, oc.z, opp) > 0) { unsafe = true; break; } } catch (e) {}
                          }
                          try { console.debug('AI opening book reply playing', { reply, candidate, unsafe }); } catch (e) {}
                          applyMove(candidate.moverId, { x: candidate.x, y: candidate.y, z: candidate.z });
                          return;
                        } catch (e) { /* skip book reply on any error */ }
                      }
                    }
                  }
                }
              } catch (e) {}

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // CRITICAL: FORCE DEVELOPMENT - If we have undeveloped knights or bishops, we MUST move them!
              // This runs AFTER opening book so book moves (like 3c5 reply) are allowed
              try {
                const plyCount = (moveHistory || []).length || 0;
                const totalPlies = plyCount * 2;
                const startRank = aiSide === 'white' ? 7 : 0;
                
                // Only apply development forcing after the opening book phase (move 2+)
                if (plyCount >= 2) {
                  // Find undeveloped minor pieces
                  const undevelopedMinors = (piecesState || []).filter(p => 
                    p.color === aiSide && 
                    (p.t === 'N' || p.t === 'B') && 
                    p.x === startRank
                  );
                  
                  // MODIFIED: Instead of forcing ONLY development, prefer development + good pawn moves
                  // Only force pure development if we have most pieces undeveloped (6+ out of 8 in 4D chess)
                  if (undevelopedMinors.length >= 6 && totalPlies < 12) {
                    // Find moves that develop knights or bishops
                    const developmentMoves = moves.filter(m => {
                      const mover = (piecesState || []).find(p => p.id === m.moverId);
                      return mover && (mover.t === 'N' || mover.t === 'B') && mover.x === startRank;
                    });
                    
                    // Also allow strategically valuable pawn moves
                    const goodPawnMoves = moves.filter(m => {
                      const mover = (piecesState || []).find(p => p.id === m.moverId);
                      if (!mover || mover.t !== 'p' || mover.hasMoved) return false;
                      
                      // Allow ONLY: (1) double-pawn move, OR (2) defends a piece
                      const moveDist = Math.abs(m.x - mover.x);
                      const isDouble = moveDist === 2;
                      
                      // Check if this pawn move defends another piece
                      let defendsPiece = false;
                      try {
                        const nextPieces = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                        for (const p of nextPieces) {
                          if (p.color === aiSide && p.id !== m.moverId) {
                            const defendersBefore = attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            const defendersAfter = attackersOfSquare(nextPieces, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            if (defendersAfter > defendersBefore) {
                              defendsPiece = true;
                              break;
                            }
                          }
                        }
                      } catch (e) {}
                      
                      return isDouble || defendsPiece;
                    });
                    
                    const combinedMoves = [...developmentMoves, ...goodPawnMoves];
                    if (combinedMoves.length > 0) {
                      console.log(`AI: Prioritizing development (${developmentMoves.length}) + good pawns (${goodPawnMoves.length}) - ${undevelopedMinors.length}/8 pieces undeveloped`);
                      moves = combinedMoves;
                    }
                  } else if (undevelopedMinors.length > 0 && totalPlies < 24) {
                    // We have 1-5 undeveloped pieces: allow both development AND good pawn moves
                    const developmentMoves = moves.filter(m => {
                      const mover = (piecesState || []).find(p => p.id === m.moverId);
                      return mover && (mover.t === 'N' || mover.t === 'B') && mover.x === startRank;
                    });
                    
                    const goodPawnMoves = moves.filter(m => {
                      const mover = (piecesState || []).find(p => p.id === m.moverId);
                      if (!mover || mover.t !== 'p' || mover.hasMoved) return false;
                      
                      // Allow ONLY: (1) double-pawn move, OR (2) defends a piece
                      const moveDist = Math.abs(m.x - mover.x);
                      const isDouble = moveDist === 2;
                      
                      // Check if this pawn move defends another piece
                      let defendsPiece = false;
                      try {
                        const nextPieces = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                        for (const p of nextPieces) {
                          if (p.color === aiSide && p.id !== m.moverId) {
                            const defendersBefore = attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            const defendersAfter = attackersOfSquare(nextPieces, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                            if (defendersAfter > defendersBefore) {
                              defendsPiece = true;
                              break;
                            }
                          }
                        }
                      } catch (e) {}
                      
                      return isDouble || defendsPiece;
                    });
                    
                    const combinedMoves = [...developmentMoves, ...goodPawnMoves];
                    if (combinedMoves.length > 0) {
                      console.log(`AI: Mixing development (${developmentMoves.length}) + good pawns (${goodPawnMoves.length}) - ${undevelopedMinors.length}/8 pieces remain`);
                      moves = combinedMoves;
                    }
                  }
                }
              } catch (e) {
                console.error('AI: Force development filter error', e);
              }

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // iterative deepening search with safety heuristics
              const maxMillis = 1200; // Increased from 800 to allow deeper search for tactics
              searchStateRef.current.endTime = Date.now() + maxMillis;
              const maxDepth = 4;
              let best = null; let bestScore = -Infinity;
              let orderedMoves = orderMoves(moves, piecesState, aiSide);
              // Diagnostic: snapshot ordered moves with basic SEE/attackers info for each candidate
              try {
                const opponent = aiSide === 'white' ? 'black' : 'white';
                const snap = [];
                for (const m of orderedMoves) {
                  try {
                    const mover = (piecesState || []).find(p => p.id === m.moverId) || null;
                    const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    const attackers = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color !== aiSide).length;
                    const defenders = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color === aiSide).length;
                    const oppMoves = getAllLegalMoves(next, opponent) || [];
                    const captures = oppMoves.filter(oc => oc.x === m.x && oc.y === m.y && oc.z === m.z);
                    let bestSee = null;
                    for (const oc of captures) {
                      try { const s = staticExchangeEval(next, oc.x, oc.y, oc.z, opponent); if (typeof s === 'number' && (bestSee == null || s > bestSee)) bestSee = s; } catch (e) { bestSee = 'ERR'; }
                    }
                    snap.push({ moverId: m.moverId, type: mover ? mover.t : '?', from: {x: mover ? mover.x : null, y: mover ? mover.y : null, z: mover ? mover.z : null}, to: {x: m.x,y: m.y,z: m.z}, attackers, defenders, bestSee });
                  } catch (e) { snap.push({ moverId: m.moverId, to: {x: m.x,y: m.y,z: m.z}, err: true }); }
                }
                try { pushDebug('orderedMovesSnapshot', { snap, moveHistoryLen: (moveHistory||[]).length }); } catch (e) {}
                try { console.log('orderedMovesSnapshot', snap); } catch (e) {}
              } catch (e) {}

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Strict immediate-loss veto: remove any move that allows an immediate positive-SEE capture
              try {
                const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9, K: 10000 };
                const opponent = aiSide === 'white' ? 'black' : 'white';
                const filtered = [];
                for (const m of orderedMoves) {
                  try {
                    const targetBefore = (piecesState || []).find(pp => pp.x === m.x && pp.y === m.y && pp.z === m.z && pp.color !== aiSide) || null;
                    const n = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    // is opponent able to capture moved square with positive SEE?
                    const oppMoves = getAllLegalMoves(n, opponent) || [];
                    let maxSee = 0; let canCapture = false;
                    for (const oc of oppMoves) {
                      if (oc.x === m.x && oc.y === m.y && oc.z === m.z) {
                        try { const s = staticExchangeEval(n, oc.x, oc.y, oc.z, opponent); if (typeof s === 'number' && s > maxSee) maxSee = s; canCapture = true; } catch (e) { canCapture = true; maxSee = Math.max(maxSee, 0); }
                      }
                    }
                    const attackers = attackersOfSquare(n, m.x, m.y, m.z).filter(a => a.color !== aiSide).length;
                    const defenders = attackersOfSquare(n, m.x, m.y, m.z).filter(a => a.color === aiSide).length;
                    let veto = false;
                    if (canCapture && maxSee > 0 && attackers > defenders) {
                      // allow if moved piece captures a higher-value piece than the opponent's gain
                      if (targetBefore && (vals[targetBefore.t] || 0) > maxSee) {
                        veto = false;
                      } else {
                        // allow if this move gives mate to opponent (rare) -- detect: opponent has no legal moves and is in check after their capture? skip veto if mate-in-1 for opponent? conservatively veto
                        veto = true;
                      }
                    }
                    if (!veto) filtered.push(m);
                    else { try { console.debug('AI immediate-loss veto removed move', { move: m, maxSee, attackers, defenders, captured: targetBefore && targetBefore.t }); } catch (e) {} }
                  } catch (e) { filtered.push(m); }
                }
                if (filtered.length > 0) orderedMoves = filtered;
              } catch (e) {}

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Strong defender-priority: if any Queen/Rook/Knight/Bishop is attacked and can be safely retreated/defended, prioritize those moves
              try {
                const highVals = ['Q','R','N','B'];
                const threatenedPieces = (piecesState || []).filter(p => p.color === aiSide && highVals.includes(p.t) && attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color !== aiSide).length > 0);
                if (threatenedPieces.length > 0) {
                  const rescueMoves = [];
                  for (const tp of threatenedPieces) {
                    try {
                      const myMoves = (getAllLegalMoves(piecesState, aiSide) || []).filter(m => m.moverId === tp.id);
                      for (const mm of myMoves) {
                        try {
                          const n = simulateMove(piecesState, mm.moverId, { x: mm.x, y: mm.y, z: mm.z });
                          const opponent = aiSide === 'white' ? 'black' : 'white';
                          const oppMoves = getAllLegalMoves(n, opponent) || [];
                          let canBeCaptured = false; let maxSee = 0;
                          for (const oc of oppMoves) {
                            if (oc.x === mm.x && oc.y === mm.y && oc.z === mm.z) {
                              try { const s = staticExchangeEval(n, oc.x, oc.y, oc.z, opponent); if (typeof s === 'number') { maxSee = Math.max(maxSee, s); if (s > 0) canBeCaptured = true; } else { canBeCaptured = true; } } catch (e) { canBeCaptured = true; }
                            }
                          }
                          const attackers = attackersOfSquare(n, mm.x, mm.y, mm.z).filter(a => a.color !== aiSide).length;
                          const defenders = attackersOfSquare(n, mm.x, mm.y, mm.z).filter(a => a.color === aiSide).length;
                          // consider this a valid rescue if it eliminates positive-SEE capture and defenders >= attackers
                          if (!canBeCaptured || defenders >= attackers) {
                            rescueMoves.push(mm);
                          }
                        } catch (e) {}
                      }
                    } catch (e) {}
                  }
                  if (rescueMoves.length > 0) {
                    try { console.debug('AI defender-priority: prioritizing rescue moves', { rescueCount: rescueMoves.length, threatened: threatenedPieces.map(p=>p.id) }); } catch (e) {}
                    // move rescues to the front preserving order
                    orderedMoves = rescueMoves.concat(orderedMoves.filter(m => !rescueMoves.find(r => r.moverId === m.moverId && r.x === m.x && r.y === m.y && r.z === m.z)));
                  }
                }
              } catch (e) {}

              // Mate-threat filter: prefer moves that prevent opponent mate-in-1
              try {
                const opponent = aiSide === 'white' ? 'black' : 'white';
                const evasive = [];
                for (const m of orderedMoves) {
                  try {
                    const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    const oppMoves = getAllLegalMoves(next, opponent) || [];
                    let leavesMate = false;
                    for (const om of oppMoves) {
                      try {
                        const next2 = simulateMove(next, om.moverId, { x: om.x, y: om.y, z: om.z });
                        const inCheck = isAnyKingInCheck(next2, aiSide);
                        const myLegal = (getAllLegalMoves(next2, aiSide) || []);
                        if (inCheck && myLegal.length === 0) { leavesMate = true; break; }
                      } catch (e) { /* ignore simulation errors */ }
                    }
                    if (!leavesMate) evasive.push(m);
                  } catch (e) { /* ignore per-move errors */ }
                }
                if (evasive.length > 0) {
                  try { console.debug('AI mate-threat filter applied, reducing moves', { before: orderedMoves.length, after: evasive.length }); } catch (e) {}
                  orderedMoves = evasive;
                }
              } catch (e) { /* fail-safe: ignore mate filter on error */ }

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // High-value piece safety filter: prefer moves that address immediate threats to Q/R
              try {
                const highVals = ['Q','R'];
                const opponent = aiSide === 'white' ? 'black' : 'white';
                const threatened = [];
                for (const p of (piecesState || [])) {
                  if (p.color !== aiSide) continue;
                  if (!highVals.includes(p.t)) continue;
                  try {
                    const attackers = attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color !== aiSide).length;
                    const defenders = attackersOfSquare(piecesState, p.x, p.y, p.z).filter(a => a.color === aiSide).length;
                    if (attackers > defenders) threatened.push(p);
                    else {
                      try { const seeNow = staticExchangeEval(piecesState, p.x, p.y, p.z, opponent); if (typeof seeNow === 'number' && seeNow > 0) threatened.push(p); } catch (e) {}
                    }
                  } catch (e) {}
                }
                if (threatened.length > 0) {
                  const defendersMoves = [];
                  for (const m of orderedMoves) {
                    try {
                      const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                      let addresses = false;
                      for (const tp of threatened) {
                        try {
                          // find the piece in the new position (it may have moved)
                          const myPiece = next.find(pp => pp.id === tp.id) || null;
                          const tx = myPiece ? myPiece.x : tp.x;
                          const ty = myPiece ? myPiece.y : tp.y;
                          const tz = myPiece ? myPiece.z : tp.z;
                          const attackers = attackersOfSquare(next, tx, ty, tz).filter(a => a.color !== aiSide).length;
                          const defenders = attackersOfSquare(next, tx, ty, tz).filter(a => a.color === aiSide).length;
                          if (defenders >= attackers) { addresses = true; break; }
                          // also allow moves that capture an attacker
                          const attackedBy = attackersOfSquare(next, tx, ty, tz).filter(a => a.color !== aiSide);
                          for (const at of attackedBy) {
                            if (next.find(pp => pp.id === m.moverId && pp.x === at.x && pp.y === at.y && pp.z === at.z)) { addresses = true; break; }
                          }
                        } catch (e) {}
                      }
                      if (addresses) defendersMoves.push(m);
                    } catch (e) {}
                  }
                  if (defendersMoves.length > 0) {
                    try { console.debug('AI high-value safety filter applied', { threatenedCount: threatened.length, before: orderedMoves.length, after: defendersMoves.length }); } catch (e) {}
                    orderedMoves = defendersMoves;
                  }
                }
              } catch (e) { /* ignore safety filter failures */ }

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Diagnostic: log detailed info for pawn moves that are capturable next turn
              try {
                const opponent = aiSide === 'white' ? 'black' : 'white';
                for (const m of orderedMoves) {
                  try {
                    const mover = (piecesState || []).find(p => p.id === m.moverId);
                    if (!mover || mover.t !== 'p') continue;
                    const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    const oppMoves = getAllLegalMoves(next, opponent) || [];
                    const captures = oppMoves.filter(oc => oc.x === m.x && oc.y === m.y && oc.z === m.z);
                    if (captures.length === 0) continue;
                    const capDetails = [];
                    for (const oc of captures) {
                      try {
                        const see = staticExchangeEval(next, oc.x, oc.y, oc.z, opponent);
                        const capPiece = next.find(pp => pp.x === oc.x && pp.y === oc.y && pp.z === oc.z && pp.color === aiSide) || null;
                        capDetails.push({ by: oc.moverId, moverType: (next.find(pp=>pp.id===oc.moverId)||{}).t || '?', see, capPieceType: capPiece ? capPiece.t : null });
                      } catch (e) { capDetails.push({ by: oc.moverId, moverType: (next.find(pp=>pp.id===oc.moverId)||{}).t || '?', see: 'ERR' }); }
                    }
                    const attackers = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color !== aiSide).length;
                    const defenders = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color === aiSide).length;
                    try { pushDebug('pawnDiagnostic', { moverId: mover.id, from: {x:mover.x,y:mover.y,z:mover.z}, to: {x:m.x,y:m.y,z:m.z}, captures: capDetails, attackers, defenders, moveHistoryLen: (moveHistory||[]).length }); } catch (e) {}
                    try { console.log('pawnDiagnostic', { moverId: mover.id, from: {x:mover.x,y:mover.y,z:mover.z}, to: {x:m.x,y:m.y,z:m.z}, captures: capDetails, attackers, defenders }); } catch (e) {}
                  } catch (e) {}
                }
              } catch (e) {}

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Pawn-safety filter: avoid pawn moves that immediately lose material
              try {
                const pawnSafe = [];
                const opponent = aiSide === 'white' ? 'black' : 'white';
                for (const m of orderedMoves) {
                  try {
                    const mover = (piecesState || []).find(p => p.id === m.moverId);
                    if (!mover || mover.t !== 'p') { pawnSafe.push(m); continue; }
                    const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    const oppMoves = getAllLegalMoves(next, opponent) || [];
                    let donation = false;
                    for (const oc of oppMoves) {
                      if (oc.x === m.x && oc.y === m.y && oc.z === m.z) {
                        try {
                          const see = staticExchangeEval(next, oc.x, oc.y, oc.z, opponent);
                          const attackers = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color !== aiSide).length;
                          const defenders = attackersOfSquare(next, m.x, m.y, m.z).filter(a => a.color === aiSide).length;
                          if ((typeof see === 'number' && see > 0) || attackers > defenders) { donation = true; break; }
                        } catch (e) { /* ignore */ }
                      }
                    }
                    if (!donation) pawnSafe.push(m);
                  } catch (e) { pawnSafe.push(m); }
                }
                if (pawnSafe.length > 0 && pawnSafe.length < orderedMoves.length) {
                  try { console.debug('AI pawn-safety filter applied', { before: orderedMoves.length, after: pawnSafe.length }); } catch (e) {}
                  orderedMoves = pawnSafe;
                }
              } catch (e) { /* ignore pawn filter failures */ }

              // Yield to keep UI responsive
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // quick immediate capture scan (all moves) but respect immediate-loss veto
              try {
                const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9, K: 10000 };
                const captureMoves = (moves || []).filter(m => (piecesState || []).some(pp => pp.x === m.x && pp.y === m.y && pp.z === m.z && pp.color !== aiSide));
                if (captureMoves.length > 0) {
                  let bestCap = null; let bestSee = -Infinity;
                  for (const m of captureMoves) {
                    try {
                      const see = staticExchangeEval(piecesState, m.x, m.y, m.z, aiSide);
                      // simulate and ensure this capture isn't immediately punished by opponent (veto)
                      const nextTmp = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                      const opp = aiSide === 'white' ? 'black' : 'white';
                      const oppMovesTmp = getAllLegalMoves(nextTmp, opp) || [];
                      let maxOppSee = 0; let oppCanCapture = false;
                      for (const oc of oppMovesTmp) {
                        if (oc.x === m.x && oc.y === m.y && oc.z === m.z) {
                          try { const s = staticExchangeEval(nextTmp, oc.x, oc.y, oc.z, opp); if (typeof s === 'number' && s > maxOppSee) maxOppSee = s; oppCanCapture = true; } catch (e) { oppCanCapture = true; maxOppSee = Math.max(maxOppSee, 0); }
                        }
                      }
                      const attackers = attackersOfSquare(nextTmp, m.x, m.y, m.z).filter(a => a.color !== aiSide).length;
                      const defenders = attackersOfSquare(nextTmp, m.x, m.y, m.z).filter(a => a.color === aiSide).length;
                      const capturedPiece = (piecesState || []).find(pp => pp.x === m.x && pp.y === m.y && pp.z === m.z && pp.color !== aiSide) || null;
                      const capturedVal = capturedPiece ? (vals[capturedPiece.t] || 0) : 0;
                      // veto capture if opponent can immediately gain material and attackers outnumber defenders, unless we captured a strictly higher-value piece
                      const veto = oppCanCapture && maxOppSee > 0 && attackers > defenders && !(capturedVal > maxOppSee);
                      if (!veto) {
                        if (typeof see === 'number' && see > bestSee) { bestSee = see; bestCap = m; }
                      } else {
                        try { console.debug('AI capture-scan vetoed unsafe capture', { move: m, maxOppSee, attackers, defenders, captured: capturedPiece && capturedPiece.t }); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                  if (bestCap && (bestSee >= 1 || ((piecesState || []).find(pp=>pp.x===bestCap.x && pp.y===bestCap.y && pp.z===bestCap.z && pp.color!==aiSide) || {}).t === 'R' || ((piecesState || []).find(pp=>pp.x===bestCap.x && pp.y===bestCap.y && pp.z===bestCap.z && pp.color!==aiSide) || {}).t === 'Q')) {
                    if (!aiPausedRef.current) { try { applyMove(bestCap.moverId, { x: bestCap.x, y: bestCap.y, z: bestCap.z }); } catch (e) {} }
                    return;
                  }
                }
              } catch (e) {}

              // Yield to keep UI responsive before starting iterative deepening
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

              // Iterative deepening search with proper move ordering
              console.log('AI: Starting iterative deepening search, maxDepth=', maxDepth, 'candidates=', orderedMoves.length);
              
              // Reset cancelled flag at start of search
              searchStateRef.current.cancelled = false;
              
              for (let depth = 1; depth <= maxDepth; depth++) {
                if (Date.now() > searchStateRef.current.endTime || searchStateRef.current.cancelled) {
                  console.log('AI: Time cutoff or cancelled at depth', depth);
                  break;
                }
                
                let localBest = null; 
                let localBestScore = -Infinity;
                const moveScores = new Map(); // track scores for move ordering next iteration
                
                console.log(`AI: Searching depth ${depth}/${maxDepth}, evaluating ${orderedMoves.length} moves`);
                
                let moveCount = 0;
                for (const m of orderedMoves) {
                  if (Date.now() > searchStateRef.current.endTime || searchStateRef.current.cancelled) break;
                  
                  // Yield every 3 moves to allow camera movement and UI updates
                  if (++moveCount % 3 === 0) {
                    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
                  }
                  
                  try {
                    const next = simulateMove(piecesState, m.moverId, { x: m.x, y: m.y, z: m.z });
                    const opp = aiSide === 'white' ? 'black' : 'white';
                    
                    // Check for immediate checkmate
                    const oppMoves = getAllLegalMoves(next, opp) || [];
                    if (oppMoves.length === 0 && isAnyKingInCheck(next, opp)) {
                      localBest = m; 
                      localBestScore = 100000 - depth; // prefer shorter mates
                      console.log('AI: Found checkmate!', m);
                      break;
                    }
                    
                    // Call negamax from opponent's perspective (negate result)
                    const score = -await negamax(next, opp, depth - 1, -Infinity, Infinity, 1);
                    moveScores.set(m, score);
                    
                    if (score > localBestScore) {
                      localBestScore = score;
                      localBest = m;
                    }
                  } catch (e) {
                    console.debug('AI: Error evaluating move', m, e);
                  }
                }
                
                // Update best move if we completed this depth
                if (localBest && Date.now() <= searchStateRef.current.endTime && !searchStateRef.current.cancelled) {
                  best = localBest;
                  bestScore = localBestScore;
                  console.log(`AI: Depth ${depth} complete, best score=${localBestScore.toFixed(1)}, move=`, localBest);
                  
                  // Re-order moves for next iteration based on scores (best-first)
                  orderedMoves.sort((a, b) => {
                    const scoreA = moveScores.get(a) ?? -Infinity;
                    const scoreB = moveScores.get(b) ?? -Infinity;
                    return scoreB - scoreA; // descending
                  });
                }
                
                // Yield between depth iterations to keep UI responsive
                await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
              }
              
              console.log('AI: Search complete, final best=', best, 'score=', bestScore);

              // final safety: avoid moves where moved piece is immediately captured with positive SEE if alternatives exist
              try {
                if (best) {
                  const next = simulateMove(piecesState, best.moverId, { x: best.x, y: best.y, z: best.z });
                  const opponent = aiSide === 'white' ? 'black' : 'white';
                  const oppMoves = getAllLegalMoves(next, opponent) || [];
                  let immediateBad = false;
                  for (const oc of oppMoves) {
                    if (oc.x === best.x && oc.y === best.y && oc.z === best.z) {
                      try {
                        const seeVal = staticExchangeEval(next, oc.x, oc.y, oc.z, opponent);
                        const attackers = attackersOfSquare(next, best.x, best.y, best.z).filter(a => a.color !== aiSide).length;
                        const defenders = attackersOfSquare(next, best.x, best.y, best.z).filter(a => a.color === aiSide).length;
                        // treat as immediate bad if SEE > 0 or attackers outnumber defenders (undefended)
                        if ((typeof seeVal === 'number' && seeVal > 0) || (attackers > defenders)) { immediateBad = true; break; }
                      } catch (e) {}
                    }
                  }
                  if (immediateBad) {
                    // try to find any ordered alternative that is not immediately badly captured
                    for (const cand of orderedMoves) {
                      if (cand === best) continue;
                      try {
                        const n2 = simulateMove(piecesState, cand.moverId, { x: cand.x, y: cand.y, z: cand.z });
                        const opp2 = getAllLegalMoves(n2, opponent) || [];
                        let bad2 = false;
                        for (const oc of opp2) {
                          if (oc.x === cand.x && oc.y === cand.y && oc.z === cand.z) {
                            try {
                              const s2 = staticExchangeEval(n2, oc.x, oc.y, oc.z, opponent);
                              const attackers2 = attackersOfSquare(n2, cand.x, cand.y, cand.z).filter(a => a.color !== aiSide).length;
                              const defenders2 = attackersOfSquare(n2, cand.x, cand.y, cand.z).filter(a => a.color === aiSide).length;
                              if ((typeof s2 === 'number' && s2 > 0) || (attackers2 > defenders2)) { bad2 = true; break; }
                            } catch (e) { bad2 = true; break; }
                          }
                        }
                        if (!bad2) { try { console.debug('AI switched from immediate-bad best to safer candidate', { from: best, to: cand }); } catch (e) {} best = cand; break; }
                      } catch (e) {}
                    }
                  }
                }
              } catch (e) {}

                // apply final move
              try {
                if (!best) best = moves[Math.floor(Math.random() * moves.length)];
                // Safety selection: prefer candidate with minimal opponent immediate capture SEE
                try {
                  const opponent = aiSide === 'white' ? 'black' : 'white';
                  let candidates = orderedMoves.slice();
                  if (!candidates || candidates.length === 0) candidates = [best];
                  let safest = null; let safestSee = Infinity; let safestIsPawn = true;
                  for (const cand of candidates) {
                    try {
                      const n = simulateMove(piecesState, cand.moverId, { x: cand.x, y: cand.y, z: cand.z });
                      const oppMoves = getAllLegalMoves(n, opponent) || [];
                      let maxSee = -Infinity;
                      for (const oc of oppMoves) {
                        if (oc.x === cand.x && oc.y === cand.y && oc.z === cand.z) {
                          try { const s = staticExchangeEval(n, oc.x, oc.y, oc.z, opponent); if (typeof s === 'number' && s > maxSee) maxSee = s; } catch (e) { maxSee = Math.max(maxSee, 0); }
                        }
                      }
                      if (maxSee < safestSee || (maxSee === safestSee && ((piecesState||[]).find(p=>p.id===cand.moverId)||{}).t !== 'p' && safestIsPawn)) {
                        safest = cand; safestSee = (maxSee === -Infinity ? 0 : maxSee);
                        safestIsPawn = (((piecesState||[]).find(p=>p.id===cand.moverId)||{}).t === 'p');
                      }
                    } catch (e) {}
                  }
                  if (safest) {
                    try { console.debug('AI safety selection chose', { from: best, to: safest, safestSee }); } catch (e) {}
                    best = safest;
                  }
                } catch (e) {}
                // Detailed debug: log why this final move is chosen, especially for pawns
                try {
                  const moverPiece = (piecesState || []).find(p => p.id === best.moverId) || null;
                  const opponent = aiSide === 'white' ? 'black' : 'white';
                  const next = simulateMove(piecesState, best.moverId, { x: best.x, y: best.y, z: best.z });
                  const oppMoves = getAllLegalMoves(next, opponent) || [];
                  const captures = oppMoves.filter(oc => oc.x === best.x && oc.y === best.y && oc.z === best.z).map(oc => {
                    try { return { moverId: oc.moverId, type: (next.find(pp=>pp.id===oc.moverId)||{}).t || '?', see: staticExchangeEval(next, oc.x, oc.y, oc.z, opponent) }; } catch (e) { return { moverId: oc.moverId, type: (next.find(pp=>pp.id===oc.moverId)||{}).t || '?', see: 'ERR' }; }
                  });
                  const attackers = attackersOfSquare(next, best.x, best.y, best.z).filter(a => a.color !== aiSide).length;
                  const defenders = attackersOfSquare(next, best.x, best.y, best.z).filter(a => a.color === aiSide).length;
                  try { pushDebug('finalMoveDecision', { best, moverPieceType: moverPiece ? moverPiece.t : null, captures, attackers, defenders, moveHistoryLen: (moveHistory||[]).length }); } catch (e) {}
                  try { console.log('finalMoveDecision', { best, moverPieceType: moverPiece ? moverPiece.t : null, captures, attackers, defenders }); } catch (e) {}
                } catch (e) {}
                // Extra king-safety veto: avoid moving king into as-many-or-more attacked square
                try {
                  const moverPieceFinal = (piecesState || []).find(p => p.id === best.moverId) || null;
                  if (moverPieceFinal && moverPieceFinal.t === 'K') {
                    try {
                      const kingBefore = moverPieceFinal;
                      const attackersBefore = attackersOfSquare(piecesState, kingBefore.x, kingBefore.y, kingBefore.z).filter(a => a.color !== aiSide).length;
                      const nextBest = simulateMove(piecesState, best.moverId, { x: best.x, y: best.y, z: best.z });
                      const attackersAfter = attackersOfSquare(nextBest, best.x, best.y, best.z).filter(a => a.color !== aiSide).length;
                      if (attackersAfter > 0 && attackersAfter >= attackersBefore) {
                        // try to find a non-king alternative that improves king safety
                        let alternative = null;
                        for (const cand of orderedMoves) {
                          try {
                            const moverCand = (piecesState || []).find(p => p.id === cand.moverId) || null;
                            if (moverCand && moverCand.t === 'K') continue;
                            const nCand = simulateMove(piecesState, cand.moverId, { x: cand.x, y: cand.y, z: cand.z });
                            const attackersCand = attackersOfSquare(nCand, cand.x, cand.y, cand.z).filter(a => a.color !== aiSide).length;
                            if (attackersCand < attackersBefore) { alternative = cand; break; }
                          } catch (e) { /* ignore candidate errors */ }
                        }
                        if (alternative) {
                          try { console.debug('AI avoided unsafe king move, switching to alternative', { from: best, to: alternative, attackersBefore, attackersAfter }); } catch (e) {}
                          best = alternative;
                        } else {
                          try { console.debug('AI allowed king move despite safety check', { best, attackersBefore, attackersAfter }); } catch (e) {}
                        }
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
                // Preserve castling rights: avoid early non-castling king moves when castling is available
                try {
                  const moverPieceFinal = (piecesState || []).find(p => p.id === best.moverId) || null;
                  if (moverPieceFinal && moverPieceFinal.t === 'K' && !(best && best.castle)) {
                    try {
                      const plyCount = (moveHistory || []).length || 0;
                        // consider castling rights possible if king and at least one rook haven't moved (even if castling isn't legal right now)
                        const kingPiece = (piecesState || []).find(p => p.color === aiSide && p.t === 'K');
                        const rookExists = (piecesState || []).some(p => p.color === aiSide && p.t === 'R' && !p.hasMoved);
                        const castleAvailable = kingPiece && !kingPiece.hasMoved && rookExists;
                      // if castling is available and early in the game, prefer non-king moves
                      if (castleAvailable && plyCount < 12) {
                        let alternative = null;
                        for (const cand of orderedMoves) {
                          try {
                            const moverCand = (piecesState || []).find(p => p.id === cand.moverId) || null;
                            if (!moverCand) continue;
                            if (moverCand.t === 'K') continue;
                            // prefer move that doesn't worsen king safety
                            const nCand = simulateMove(piecesState, cand.moverId, { x: cand.x, y: cand.y, z: cand.z });
                            const kingPos = moverPieceFinal;
                            const attackersBefore = attackersOfSquare(piecesState, kingPos.x, kingPos.y, kingPos.z).filter(a => a.color !== aiSide).length;
                            const attackersAfter = attackersOfSquare(nCand, kingPos.x, kingPos.y, kingPos.z).filter(a => a.color !== aiSide).length;
                            if (attackersAfter <= attackersBefore) { alternative = cand; break; }
                          } catch (e) { /* ignore candidate errors */ }
                        }
                        if (alternative) {
                          try { console.debug('AI avoided early king move to preserve castling, switching to alternative', { from: best, to: alternative }); } catch (e) {}
                          best = alternative;
                        } else {
                          try { console.debug('No suitable alternative found to preserve castling; allowing king move', { best }); } catch (e) {}
                        }
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
                // Only apply move if search wasn't cancelled and not paused
                if (!searchStateRef.current.cancelled && !aiPausedRef.current && best) {
                  applyMove(best.moverId, { x: best.x, y: best.y, z: best.z });
                  try { console.debug('AI applied move', best); } catch (e) {}  } else {
                  try { console.debug('AI move cancelled, paused, or no best move found'); } catch (e) {}
                }
              } catch (e) { try { console.debug('AI applyMove failed', e); } catch (ee) {} }

            } catch (e) { try { console.debug('AI move failed', e); } catch (ee) {} }
            finally {
              try { console.debug('AI finished thinking for move', currentMoveCount); } catch (e) {}
              setAiThinking(false);
            }
          })();
        }, thinkDelay);
        
        // Store timeout with its move count so cleanup knows about it
        aiTimeoutRef.current = { id: t, moveCount: currentMoveCount };
        try { console.debug('AI: Stored timeout for move', currentMoveCount); } catch (e) {}
        
        return () => {
          // Clear timeout only if we've moved to a COMPLETELY DIFFERENT position
          // Check: if aiLastMoveCountRef has changed to something > stored moveCount, clear it
          // But if ref still matches stored moveCount, keep the timeout (we're still on same position)
          if (aiTimeoutRef.current.id) {
            const storedMove = aiTimeoutRef.current.moveCount;
            const currentRef = aiLastMoveCountRef.current;
            // Clear if we've clearly moved past this position (ref > stored) OR if going backwards
            if (currentRef !== storedMove) {
              try { console.debug('AI useEffect cleanup: clearing timeout (moved from move', storedMove, 'to', currentRef, ')'); } catch (e) {}
              clearTimeout(aiTimeoutRef.current.id);
              aiTimeoutRef.current = { id: null, moveCount: null };
            } else {
              try { console.debug('AI useEffect cleanup: keeping timeout (still on move', storedMove, ')'); } catch (e) {}
            }
          }
        };
      }, [currentTurn, aiSide, aiStrength, aiDelay, aiPaused, viewIndex, piecesState, gameOver, moveHistory, getAllLegalMoves, simulateMove, negamax, applyMove, orderMoves, isAnyKingInCheck, staticExchangeEval, attackersOfSquare, rebuildCoordMoveHistory]);
}
