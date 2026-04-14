import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import {
  GLOBAL_PIECE_SCALE, PIECE_ASPECT_RATIO, GHOST_SCALE_FACTOR, DRAG_LEVEL_SCALE,
  MOVE_PIXEL_THRESH, MOVE_WORLD_THRESH, MOVE_HIT_RADIUS, PIECE_HIT_RADIUS, PIECE_HIT_DISC_Y,
  DRAG_PIXEL_THRESHOLD, getLevelY,
} from '../utils/constants';
import {
  inBounds, isSquareAttacked, simulateMove, isAnyKingInCheck,
  KING_BLOCK_MAP, ROOK_FROM_MAP, lookupKingBlock,
} from '../utils/chessLogic';
import { useBoardXScale } from './Board';
export function cloneAndColor(gltf, color) {
  const obj = gltf.scene.clone(true);
  // normalize any embedded scale so external scale props control final size
  try { obj.scale.set(1,1,1); } catch (err) {}
  // compute bounding box and normalize to unit height so different model units match
  try {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y || 0;
    if (h > 1e-6) {
      const f = 1.0 / h;
      try { obj.scale.set(f, f, f); } catch (err) {}
      obj.userData._normalizedHeight = h;
    }
  } catch (err) {}
  // colorize all MeshStandardMaterial descendants
  obj.traverse(child => {
    if (child.isMesh && child.material && child.material.isMeshStandardMaterial) {
      child.material = child.material.clone();
      child.material.color.set(color);
      child.material.needsUpdate = true;
    }
  });
  return obj;
}

// Diagnostic component: logs Canvas mount/unmount events for a given key
export function CanvasLogger({ canvasKey }) {
  useEffect(() => {
    try { console.debug('Canvas mounted with key', canvasKey); } catch (e) {}
    return () => { try { console.debug('Canvas unmounted with key', canvasKey); } catch (e) {} };
  }, [canvasKey]);
  return null;
}


export function Pieces({ piecesState, setPiecesState, selectedPieceId, setSelectedPieceId, isDragging, dragPoint, setIsDragging, setDragPoint, dragPointWorld, setDragPointWorld, setPointerActive, controlsRef, pointerDownRef, pointerStartRef, pointerStartScreenRef, pointerLastScreenRef, pointerDepthRef, pointerDownPieceRef, pointerDownWasSelectedRef, kingGltf, pawnGltf, knightGltf, bishopGltf, rookGltf, queenGltf, clones, pendingDrop, setPendingDrop, groupRef, setDragHeight, sceneScale, currentTurn, setCurrentTurn, lastMove, setLastMove, setMoveHistory, moveHistory, showCastlePrompt, showPromotionPrompt, gameOver, generateMoveNotation, moveLockRef, aiSide, pushStateSnapshot, boardFlipped, coordMoveHistoryRef, setCoordMoveHistory, onBeforeUserMove, onPuzzleHumanMove, inHistoryView, displayPiecesOverride }) {
      const boardXScale = useBoardXScale();
      const levels = getLevelY();
      const pieces = [];

      // Per-piece scale constants (tweak these if models look too big/small)
      const scaleMap = GLOBAL_PIECE_SCALE;

      // piecesState is an array of piece objects with {id,x,y,z,t,color}
      // When in history view, displayPiecesOverride contains the snapshot pieces to render
      const allPieces = displayPiecesOverride || piecesState;

      // occupancy set keyed by logical coords (unused currently)

      // helper to convert logical coords to world positions
      function worldPosFromLogical(lx, ly, lz) {
        // When it's Black's turn we mirror the X axis so the board appears reversed
        // flip for 2-player when black's turn, or when playing as black (boardFlipped)
        const shouldFlip = boardFlipped || ((currentTurn === 'black') && !aiSide);
        const effectiveLX = shouldFlip ? (7 - lx) : lx;
        // Parallelogram layout: x direction goes straight, y direction goes at an angle
        const effectiveLY = 3 - ly;  // flip ly for visual consistency
        const shearFactor = 0.475;
        const wx = (effectiveLX + effectiveLY * shearFactor - 3.88) * boardXScale;  // Center the board
        const wy = levels[lz] + 0.09;
        const wz = effectiveLY - 0.06;  // Y goes in Z direction, centered
        return [wx, wy, wz];
      }

      // compute legal moves for a selected white piece (pawns + knights)
      const legalMoves = useMemo(() => {
        const occupiedMap = new Map(allPieces.map((p) => [`${p.x},${p.y},${p.z}`, p.color]));
        let moves = [];
        if (selectedPieceId == null) return moves;
        const sel = allPieces.find((pp) => pp.id === selectedPieceId);
        if (!sel || sel.color !== currentTurn) return moves;
        const { x: sx, y: sy, z: sz, t: st } = sel;
        const friendly = sel.color;
        const enemy = friendly === 'white' ? 'black' : 'white';
        if (st === 'p') {
          // pawn forward depends on color: white moves -1 in x (toward 0), black moves +1
          const dir = friendly === 'white' ? -1 : 1;
          const oneX = sx + dir;
          if (oneX >= 0 && oneX <= 7) {
            const keyOne = `${oneX},${sy},${sz}`;
            if (!occupiedMap.has(keyOne)) {
              moves.push({ x: oneX, y: sy, z: sz });
              // two-step from starting rank
              const startX = friendly === 'white' ? 6 : 1;
              const twoX = sx + dir * 2;
              const keyTwo = `${twoX},${sy},${sz}`;
              if (sx === startX && twoX >= 0 && twoX <= 7 && !occupiedMap.has(keyTwo)) {
                moves.push({ x: twoX, y: sy, z: sz });
              }
            }
            // capture diagonals: X+dir, Y+-1 same Z
            [[sy+1, sz], [sy-1, sz], [sy, sz+1], [sy, sz-1]].forEach(([cy, cz]) => {
              if (cy >= 0 && cy <= 3 && cz >= 0 && cz <= 3) {
                const k = `${oneX},${cy},${cz}`;
                if (occupiedMap.get(k) === enemy) moves.push({ x: oneX, y: cy, z: cz });
              }
            });
            // en-passant: if enemy just moved a pawn two squares and is adjacent in Y/Z and at same X
            try {
              if (lastMove && lastMove.doubleStep && lastMove.to) {
                // lastMove.to.x should equal the captor's x (enemy pawn landed adjacent in Y/Z)
                if (lastMove.to.x === sx) {
                  const ay = lastMove.to.y; const az = lastMove.to.z;
                  const manh = Math.abs(ay - sy) + Math.abs(az - sz);
                  try { console.log('en-passant check', { lastMove: lastMove.to, sx, sy, sz, oneX, ay, az, manh }); } catch (e) {}
                  if (manh === 1) {
                    // can capture en-passant landing at oneX,ay,az
                    if (oneX >= 0 && oneX <= 7) {
                      moves.push({ x: oneX, y: ay, z: az, enPassant: true, capturedId: lastMove.id });
                      try { console.log('en-passant candidate added', { moverId: sel.id, from: [sx,sy,sz], landing: [oneX, ay, az], capturedId: lastMove.id, lastMove }); } catch (e) {}
                    }
                  }
                }
              }
            } catch (err) { console.debug('en-passant check error', err); }
          }
        }
        if (st === 'N') {
          // Knight moves allowed only in X-Y (dz=0) or X-Z (dy=0) planes
          const perms = [[2, 1, 0], [1, 2, 0], [2, 0, 1], [1, 0, 2]];
          const moveSet = new Set();
          perms.forEach(([ax, ay, az]) => {
            const xs = ax === 0 ? [0] : [-ax, ax];
            const ys = ay === 0 ? [0] : [-ay, ay];
            const zs = az === 0 ? [0] : [-az, az];
            xs.forEach((dx) => ys.forEach((dy) => zs.forEach((dz) => {
              // enforce plane constraint: either dz===0 (XY move) or dy===0 (XZ move)
              if (!(dz === 0 || dy === 0)) return;
              const nx = sx + dx;
              const ny = sy + dy;
              const nz = sz + dz;
              if (nx < 0 || nx > 7 || ny < 0 || ny > 3 || nz < 0 || nz > 3) return;
              const key = `${nx},${ny},${nz}`;
              if (occupiedMap.get(key) === friendly) return;
              moveSet.add(key);
            })));
          });
          moveSet.forEach((k) => {
            const [x, y, z] = k.split(',').map(Number);
            moves.push({ x, y, z });
          });
        }
        // Rook: straight lines along x, y, or z (can move between levels vertically)
        if (st === 'R') {
          const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
          dirs.forEach(([dx,dy,dz]) => {
            let step = 1;
            while (true) {
              const nx = sx + dx*step;
              const ny = sy + dy*step;
              const nz = sz + dz*step;
              if (nx < 0 || nx > 7 || ny < 0 || ny > 3 || nz < 0 || nz > 3) break;
              const key = `${nx},${ny},${nz}`;
              const occ = occupiedMap.get(key);
              if (occ === friendly) break;
              moves.push({ x: nx, y: ny, z: nz });
              if (occ && occ !== friendly) break;
              step++;
            }
          });
        }

        // Bishop: diagonal moves in X-Y or X-Z planes
        if (st === 'B') {
          const dirs = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
          dirs.forEach(([dx,dy,dz]) => {
            let step = 1;
            while (true) {
              const nx = sx + dx*step;
              const ny = sy + dy*step;
              const nz = sz + dz*step;
              if (nx < 0 || nx > 7 || ny < 0 || ny > 3 || nz < 0 || nz > 3) break;
              const key = `${nx},${ny},${nz}`;
              const occ = occupiedMap.get(key);
              if (occ === friendly) break;
              moves.push({ x: nx, y: ny, z: nz });
              if (occ && occ !== friendly) break;
              step++;
            }
          });
        }

        // Queen: combination of rook + bishop
        if (st === 'Q') {
          const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
          dirs.forEach(([dx,dy,dz]) => {
            let step = 1;
            while (true) {
              const nx = sx + dx*step;
              const ny = sy + dy*step;
              const nz = sz + dz*step;
              if (nx < 0 || nx > 7 || ny < 0 || ny > 3 || nz < 0 || nz > 3) break;
              const key = `${nx},${ny},${nz}`;
              const occ = occupiedMap.get(key);
              if (occ === friendly) break;
              moves.push({ x: nx, y: ny, z: nz });
              if (occ && occ !== friendly) break;
              step++;
            }
          });
        }

        // King: one-step in queen directions
        if (st === 'K') {
          const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
          dirs.forEach(([dx,dy,dz]) => {
            const nx = sx + dx;
            const ny = sy + dy;
            const nz = sz + dz;
            if (nx < 0 || nx > 7 || ny < 0 || ny > 3 || nz < 0 || nz > 3) return;
            const key = `${nx},${ny},${nz}`;
            if (occupiedMap.get(key) === friendly) return;
            moves.push({ x: nx, y: ny, z: nz });
          });

          // Castling (QuadLevel variant): king may castle toward a rook along X (files) or Z (levels)
          try {
            if (!sel.hasMoved) {
              const enemy = friendly === 'white' ? 'black' : 'white';
              const rooks = allPieces.filter(p => p.t === 'R' && p.color === friendly && p.x === sx);

              const queenBlockMap = {
                '0,1,1->0,3,1': '0,2,0',
                '0,1,1->0,1,3': '0,0,2',
                '0,2,2->0,0,2': '0,1,3',
                '0,2,2->0,2,0': '0,3,1',
              };
              // specific king-side blocking cases where an orthogonal piece blocks castling path
              const kingBlockMap = {
                '0,2,2->0,3,2': '0,2,3',
                '0,2,2->0,2,3': '0,3,2',              
                '0,1,1->0,1,0': '0,0,1',              
                '0,1,1->0,0,1': '0,1,0',              
              };
              // optional mapping from king-move key to the correct rook-from coords to avoid selecting wrong rook
              const rookFromMapLocal = {
                // queenBlockMap entries -> preferred rook-from positions
                '0,1,1->0,3,1': '0,3,0',
                '0,1,1->0,1,3': '0,0,3',
                '0,2,2->0,0,2': '0,0,3',
                '0,2,2->0,2,0': '0,3,0',
                // kingBlockMap entries -> preferred rook-from positions
                '0,2,2->0,3,2': '0,3,3',
                '0,2,2->0,2,3': '0,3,3',
                '0,1,1->0,1,0': '0,0,0',
                '0,1,1->0,0,1': '0,0,0',
              };
              // Merge with the global KING_BLOCK_MAP so generation and execution-time checks align
              const effectiveKingBlockMap = { ...(typeof KING_BLOCK_MAP === 'object' ? KING_BLOCK_MAP : {}), ...kingBlockMap };
              // merged rook-from map so generation can prefer explicit rook positions when provided
              const effectiveRookFromMap = { ...(typeof ROOK_FROM_MAP === 'object' ? ROOK_FROM_MAP : {}), ...rookFromMapLocal };

              const pathClearFrom = (rxx, ryy, rzz, order, targetYParam = sy, targetZParam = sz) => {
                let cx = rxx, cy = ryy, cz = rzz;
                for (const axis of order) {
                  if (axis === 'y') {
                    const targetY = targetYParam;
                    const dirY = Math.sign(targetY - cy);
                    if (dirY !== 0) {
                      for (let yy = cy + dirY; yy !== targetY; yy += dirY) {
                        if (occupiedMap.has(`${cx},${yy},${cz}`)) return false;
                      }
                    }
                    cy = targetY;
                  } else if (axis === 'z') {
                    const targetZ = targetZParam;
                    const dirZ = Math.sign(targetZ - cz);
                    if (dirZ !== 0) {
                      for (let zz = cz + dirZ; zz !== targetZ; zz += dirZ) {
                        if (occupiedMap.has(`${cx},${cy},${zz}`)) return false;
                      }
                    }
                    cz = targetZ;
                  }
                }
                return true;
              };

              // compute candidate landings (neighbors in Y/Z) once and evaluate each
              const candidateLandings = [];
              // Add one-step king-side castle landings
              const potential = [ { x: sx, y: sy + 1, z: sz, axis: 'y' }, { x: sx, y: sy - 1, z: sz, axis: 'y' }, { x: sx, y: sy, z: sz + 1, axis: 'z' }, { x: sx, y: sy, z: sz - 1, axis: 'z' } ];
              for (const c of potential) {
                if (!inBounds(c.x, c.y, c.z)) continue;
                candidateLandings.push(c);
              }
              // Add two-step queen-side castle landings from queenBlockMap
              for (const qKey of Object.keys(queenBlockMap)) {
                const [fromPart, toPart] = qKey.split('->');
                const [fx, fy, fz] = fromPart.split(',').map(Number);
                const [tx, ty, tz] = toPart.split(',').map(Number);
                
                // For black, check if queenBlockMap entry matches current king position
                if (friendly === 'black' && fx === sx && fy === sy && fz === sz) {
                  const axis = (ty !== fy) ? 'y' : 'z';
                  candidateLandings.push({ x: tx, y: ty, z: tz, axis, isQueenSide: true });
                }
                // For white, check mirrored position
                else if (friendly === 'white') {
                  const mirroredFx = 7 - fx, mirroredTx = 7 - tx;
                  if (mirroredFx === sx && fy === sy && fz === sz) {
                    const axis = (ty !== fy) ? 'y' : 'z';
                    candidateLandings.push({ x: mirroredTx, y: ty, z: tz, axis, isQueenSide: true });
                  }
                }
              }

              for (const landing of candidateLandings) {
                const landingKey = `${landing.x},${landing.y},${landing.z}`;
                if (occupiedMap.has(landingKey)) continue;
                if (isSquareAttacked(allPieces, sx, sy, sz, enemy)) continue;
                if (isSquareAttacked(allPieces, landing.x, landing.y, landing.z, enemy)) continue;

                // helper to compute between-exclusive coords from A to B
                const betweenExclusiveLocal = (A, B) => {
                  const res = [];
                  const dx = Math.sign(B.x - A.x);
                  const dy = Math.sign(B.y - A.y);
                  const dz = Math.sign(B.z - A.z);
                  let cx = A.x + dx, cy = A.y + dy, cz = A.z + dz;
                  while (!(cx === B.x && cy === B.y && cz === B.z)) {
                    res.push(`${cx},${cy},${cz}`);
                    cx += dx; cy += dy; cz += dz;
                    if (res.length > 20) break;
                  }
                  return res;
                };

                // ensure king path between start and landing is empty and not attacked
                let kingPathOk = true;
                try {
                  const kMapKey = `${sx},${sy},${sz}->${landing.x},${landing.y},${landing.z}`;
                  let kMapped = effectiveKingBlockMap[kMapKey];
                  if (!kMapped && friendly === 'white') {
                    const mirror = (s) => { const [ax, ay, az] = s.split(',').map(Number); return `${7 - ax},${ay},${az}`; };
                    const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${landing.x},${landing.y},${landing.z}`)}`;
                    const mappedMirrored = effectiveKingBlockMap[mirroredKey];
                    if (mappedMirrored) kMapped = mirror(mappedMirrored);
                  }
                  try { console.debug('kingBlockMap check', { kMapKey, kMapped, occupied: kMapped ? occupiedMap.get(kMapped) : null }); } catch (e) {}
                  if (kMapped && occupiedMap.get(kMapped)) { kingPathOk = false; }
                } catch (e) {}

                const kingBetweenLocal = betweenExclusiveLocal({ x: sx, y: sy, z: sz }, landing);
                for (const sq of kingBetweenLocal) {
                  if (occupiedMap.has(sq)) { kingPathOk = false; break; }
                  const [kx, ky, kz] = sq.split(',').map(Number);
                  if (isSquareAttacked(allPieces, kx, ky, kz, enemy)) { kingPathOk = false; break; }
                }
                if (!kingPathOk) continue;

                // Check if this landing is a castle move (in kingBlockMap or queenBlockMap)
                const mapKey = `${sx},${sy},${sz}->${landing.x},${landing.y},${landing.z}`;
                let rookFromCoords = effectiveRookFromMap[mapKey];
                if (!rookFromCoords && friendly === 'white') {
                  const mirror = (s) => { const [ax, ay, az] = s.split(',').map(Number); return `${7 - ax},${ay},${az}`; };
                  const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${landing.x},${landing.y},${landing.z}`)}`;
                  const mappedMirrored = effectiveRookFromMap[mirroredKey];
                  if (mappedMirrored) rookFromCoords = mirror(mappedMirrored);
                  try { console.debug('rookFromMap mirror lookup', { mapKey, mirroredKey, mappedMirrored, rookFromCoords, isQueenSide: landing.isQueenSide }); } catch (e) {}
                } else {
                  try { console.debug('rookFromMap direct lookup', { mapKey, rookFromCoords, isQueenSide: landing.isQueenSide }); } catch (e) {}
                }

                // If not in rookFromMap (and not marked as queen-side), this is a regular king move
                if (!rookFromCoords && !landing.isQueenSide) continue;

                // This is a castle move - find the rook at the mapped position
                let rx, ry, rz, rook;
                if (rookFromCoords) {
                  [rx, ry, rz] = rookFromCoords.split(',').map(Number);
                  rook = allPieces.find(p => p.t === 'R' && p.color === friendly && p.x === rx && p.y === ry && p.z === rz && !p.hasMoved);
                  if (!rook) {
                    try { console.debug('castle move but rook not found or already moved', { mapKey, rookFromCoords, allRooks: allPieces.filter(p => p.t === 'R' && p.color === friendly) }); } catch (e) {}
                    continue;
                  }
                } else {
                  // For queen-side moves without explicit rook mapping, skip
                  try { console.debug('queen-side move without rook mapping, skipping', { landing, mapKey, allRookFromKeys: Object.keys(effectiveRookFromMap) }); } catch (e) {}
                  continue;
                }

                // Determine castle type and rookTo position
                const isQueenSideCastle = landing.isQueenSide || Math.abs(landing.y - sy) === 2 || Math.abs(landing.z - sz) === 2;
                const castleType = isQueenSideCastle ? 'queen' : 'king';
                
                // For king-side: rook moves to king's origin
                // For queen-side: rook moves one step from king's origin toward landing
                const rookTo = isQueenSideCastle
                  ? (landing.axis === 'y' ? { x: sx, y: sy + Math.sign(landing.y - sy), z: sz } : { x: sx, y: sy, z: sz + Math.sign(landing.z - sz) })
                  : { x: sx, y: sy, z: sz };

                // Check if rookTo square is unoccupied (or is the king's square which will be vacated)
                const rookToKey = `${rookTo.x},${rookTo.y},${rookTo.z}`;
                const kingKey = `${sx},${sy},${sz}`;
                if (rookToKey !== kingKey && occupiedMap.has(rookToKey)) continue;

                // Check queenBlockMap for queen-side castles
                if (isQueenSideCastle) {
                  let mappedQ = queenBlockMap[mapKey];
                  if (!mappedQ && friendly === 'white') {
                    const mirror = (s) => { const [ax, ay, az] = s.split(',').map(Number); return `${7 - ax},${ay},${az}`; };
                    const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${landing.x},${landing.y},${landing.z}`)}`;
                    const mappedMirrored = queenBlockMap[mirroredKey];
                    if (mappedMirrored) mappedQ = mirror(mappedMirrored);
                  }
                  if (mappedQ && occupiedMap.get(mappedQ)) continue;
                }

                // Check kingBlockMap
                const mappedBlock = lookupKingBlock(sx, sy, sz, landing.x, landing.y, landing.z, effectiveKingBlockMap, friendly);
                if (mappedBlock && occupiedMap && occupiedMap.has(mappedBlock)) continue;

                // Create castle candidate
                const castleCand = {
                  x: landing.x,
                  y: landing.y,
                  z: landing.z,
                  castle: {
                    type: castleType,
                    rookId: rook.id,
                    rookFrom: { x: rx, y: ry, z: rz },
                    rookTo
                  }
                };

                // Add the castle candidate - we've already validated everything via the explicit maps
                moves.push(castleCand);
                try {
                  console.log('Castle candidate generated:', {
                    type: castleType,
                    kingFrom: { x: sx, y: sy, z: sz },
                    kingTo: { x: landing.x, y: landing.y, z: landing.z },
                    rookFrom: { x: rx, y: ry, z: rz },
                    rookTo
                  });
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
        // dedupe moves so special metadata (e.g., castle) is preserved when a standard one-step move
        // and a castling-generated move land on the same square. Merge properties in that case.
        try {
          const merged = new Map();
          const uniq = [];
          for (const m of moves) {
            const k = `${m.x},${m.y},${m.z}`;
            if (!merged.has(k)) {
              merged.set(k, m);
              uniq.push(m);
            } else {
              const existing = merged.get(k);
              if (existing && existing.castle && m.castle) {
                const mergedCopy = { ...m };
                mergedCopy.castle = existing.castle;
                Object.assign(existing, mergedCopy);
              } else {
                Object.assign(existing, m);
              }
            }
          }
          moves = uniq;
        } catch (e) {}

          // Ensure castle.type matches the actual king displacement when generated.
          // If mismatched (e.g., 'queen' recorded for a one-step king move), correct it
          // so UI prompt logic (which checks for type==='king') works reliably.
          try {
            for (const m of moves) {
              if (!m.castle) continue;
              const dy = Math.abs(m.y - sel.y);
              const dz = Math.abs(m.z - sel.z);
              const desired = (dy === 2 || dz === 2) ? 'queen' : 'king';
              if (m.castle.type !== desired) {
                try { console.debug('fixing castle.type at generation', { from: [sel.x, sel.y, sel.z], landing: [m.x, m.y, m.z], before: m.castle.type, after: desired }); } catch (e) {}
                m.castle = { ...m.castle, type: desired };
              }
            }
          } catch (e) {}

        // filter out moves that leave any of the mover's kings in check
        const legal = moves.filter((m) => {
          const next = simulateMove(allPieces, sel.id, m);
          return !isAnyKingInCheck(next, friendly);
        });
        try { if (legal.some(m => m.enPassant)) console.log('legal en-passant moves:', legal.filter(m => m.enPassant)); } catch (e) {}
        return legal;
      }, [allPieces, selectedPieceId, currentTurn, lastMove]);

      // Debug: log legal moves when selection or turn changes to diagnose capture visibility
      useEffect(() => {
        try {
          const sel = allPieces.find((pp) => pp.id === selectedPieceId);
          if (sel) {
            console.log('Selected piece:', sel, 'currentTurn:', currentTurn, 'legalMoves:', legalMoves);
          }
        } catch (e) {}
      }, [selectedPieceId, currentTurn, legalMoves, allPieces]);

      // render all pieces
      allPieces.forEach((p, idx) => {
        const world = worldPosFromLogical(p.x, p.y, p.z);
        const modelMap = {
          R: rookGltf,
          N: knightGltf,
          B: bishopGltf,
          K: kingGltf,
          Q: queenGltf,
          p: pawnGltf,
        };
        const gltf = modelMap[p.t] || pawnGltf;
        const pieceNameMap = { N: 'knight', B: 'bishop', K: 'king', Q: 'queen' };
        const s = scaleMap[pieceNameMap[p.t] || 'pawn'];

        // clickable group for white pawns and knights
        const isWhite = p.color === 'white';
        const isSelected = selectedPieceId === p.id;
        // When selected and actively dragging, render the piece at the computed local `dragPoint`
        const pos = isSelected && isDragging ? dragPoint : world;
        const visible = !(isSelected && isDragging);
        pieces.push(
          <group
            key={`${p.id}-${p.t}-${idx}`}
            position={pos}
            visible={visible}
                onPointerDown={(e) => {
              e.stopPropagation();
              try { if (pointerStartScreenRef) pointerStartScreenRef.current = { x: e.clientX, y: e.clientY }; } catch {}
              // toggle selection when clicking same piece
                  if (gameOver) return;
                  if (inHistoryView) return; // block piece interaction while browsing history
                  // ignore input while a move is being applied
                  if (moveLockRef.current) return;
                  if (p.color === currentTurn) {
                // record which piece was pressed and whether it was already selected
                try { pointerDownPieceRef.current = p.id; pointerDownWasSelectedRef.current = (selectedPieceId === p.id); } catch {}
                if (selectedPieceId === p.id) {
                  // pressed the already-selected piece; selection toggle handled on pointer up
                } else {
                  // select the new piece immediately so dragging can start
                  setSelectedPieceId(p.id);
                }
                // record pointer-down start and initial drag height; don't start dragging yet
                pointerDownRef.current = true;
                pointerStartRef.current = e.point || null;
                // store clip-space depth (NDC z) for later unprojection if camera available
                try {
                  const cam = e.camera || (controlsRef && controlsRef.current && controlsRef.current.object);
                  if (cam && pointerDepthRef) {
                    const vv = new THREE.Vector3(world[0], world[1], world[2]);
                    vv.project(cam);
                    pointerDepthRef.current = vv.z;
                  }
                } catch (err) {}
                // convert initial world pos into group's local coords so ghost appears at same place
                if (groupRef.current) {
                  try {
                    const lv = new THREE.Vector3(world[0], world[1], world[2]);
                    groupRef.current.worldToLocal(lv);
                    setDragPoint([lv.x, lv.y, lv.z]);
                  } catch (err) {
                    setDragPoint(world);
                  }
                } else {
                  setDragPoint([world[0] / sceneScale, world[1], world[2] / sceneScale]);
                }
                setDragHeight(world[1]);
                    try { if (setDragPointWorld) setDragPointWorld([e.point.x, e.point.y, e.point.z]); } catch {}
                    try { if (setPointerActive) setPointerActive(true); } catch {}
                // immediately disable OrbitControls so the board doesn't move while attempting drag
                try { if (controlsRef.current) controlsRef.current.enabled = false; } catch {}
              } else {
                // if user clicked an enemy piece while a piece is selected, treat as click-to-capture
                try {
                  if (selectedPieceId != null) {
                    const lx = p.x; const ly = p.y; const lz = p.z;
                    const mv = legalMoves.find(mv => mv.x === lx && mv.y === ly && mv.z === lz);
                    if (mv) {
                      e.stopPropagation();
                      try { if (controlsRef.current) controlsRef.current.enabled = false; } catch {}
                      try { moveTo(mv); } catch (err) {}
                      // consumed click
                      return;
                    }
                  }
                } catch (err) {}
                setSelectedPieceId(null);
              }
            }}
          >
            {/* Pickup hit disc â€” flat horizontal circle lying on board surface, no vertical overlap between levels */}
            {/* Tune: PIECE_HIT_RADIUS (disc size), PIECE_HIT_DISC_Y (height above board surface) */}
            <mesh position={[0, PIECE_HIT_DISC_Y, 0]} rotation={[0, 0, 0]} renderOrder={0}>
              <cylinderGeometry args={[PIECE_HIT_RADIUS, PIECE_HIT_RADIUS, 0.04, 16]} />
              <meshBasicMaterial transparent={true} opacity={0} depthWrite={false} />
            </mesh>
            <primitive
              object={(clones && clones[`${p.t}-${isWhite ? 'white' : '#615c5c'}`]) ? clones[`${p.t}-${isWhite ? 'white' : '#615c5c'}`].clone(true) : cloneAndColor(gltf, isWhite ? '#ffffff' : '#615c5c')}
              scale={[s * PIECE_ASPECT_RATIO[0], s * PIECE_ASPECT_RATIO[1], s * PIECE_ASPECT_RATIO[2]]}
              rotation={(aiSide) ? [0, 0, 0] : ((p.color === currentTurn) ? [0, Math.PI, 0] : [0, 0, 0])}
            />
          </group>
        );
      });

      // Notation helpers for 3D chess (used when recording moves)
      // Accept either 0-based coords (internal) or 1-based human coords.
      // If callers pass already 1-based values, normalize back to 0-based first.
      const squareToNotation = ({ x, y, z }) => {
        const level = z + 1; // z=0 -> 1
        const file = String.fromCharCode('a'.charCodeAt(0) + y); // y=0 -> a
        const rank = 8 - x; // x 0..7 => rank 1..8
        return `${level}${file}${rank}`;
      };

      

      // verify castling is still legal at execution time (defensive check)
      const isCastleStillLegal = (moverId, castleObj, piecesArr) => {
        try {
          if (!castleObj) return false;
          const mover = piecesArr.find(p => p.id === moverId);
          if (!mover) return false;
          if (mover.hasMoved) return false;
          const sx = mover.x, sy = mover.y, sz = mover.z;
          // kingLanding from castleObj (when king-side we stored landing as kingTo)
          const kLand = castleObj.kingTo || { x: mover.x, y: mover.y, z: mover.z };

          const rook = piecesArr.find(p => p.id === castleObj.rookId);  // this is just finding a rook.  but it needs to find the right rook...
          if (!rook) return false;
          if (rook.hasMoved) return false;
          const rx = rook.x, ry = rook.y, rz = rook.z;
          const enemy = mover.color === 'white' ? 'black' : 'white';
          const occupiedMapLocal = new Map((piecesArr || []).map(p => [`${p.x},${p.y},${p.z}`, p]));
          // check explicit king-block map
          try {
            const mapped = lookupKingBlock(sx, sy, sz, kLand.x, kLand.y, kLand.z, null, mover.color);
            if (mapped && occupiedMapLocal && occupiedMapLocal.has(mapped)) return false;
          } catch (e) {}
          // compute squares between king start and landing
          const between = (A, B) => {
            const res = [];
            const dx = Math.sign(B.x - A.x);
            const dy = Math.sign(B.y - A.y);
            const dz = Math.sign(B.z - A.z);
            let cx = A.x + dx, cy = A.y + dy, cz = A.z + dz;
            while (!(cx === B.x && cy === B.y && cz === B.z)) {
              res.push({ x: cx, y: cy, z: cz });
              cx += dx; cy += dy; cz += dz;
              if (res.length > 30) break;
            }
            return res;
          };
          const kingBetween = between({ x: sx, y: sy, z: sz }, kLand);
          // king path must be empty and not attacked
          for (const sq of kingBetween) {
            const key = `${sq.x},${sq.y},${sq.z}`;
            if (occupiedMapLocal.has(key)) return false;
            if (isSquareAttacked(piecesArr, sq.x, sq.y, sq.z, enemy)) return false;
          }
          // rookTo typically is mover original square (for king-side) or computed elsewhere; use castleObj.rookTo
          const rookTo = castleObj.rookTo || { x: sx, y: sy, z: sz };
          const rookBetween = between({ x: rx, y: ry, z: rz }, rookTo);
          for (const sq of rookBetween) {
            const key = `${sq.x},${sq.y},${sq.z}`;
            if (occupiedMapLocal.has(key)) return false;
          }
          // verify rook can reach rookTo via existing pathClearFrom logic (reuse small helper)
          const pathClearFromLocal = (rxx, ryy, rzz, order, targetYParam = sy, targetZParam = sz) => {
            let cx = rxx, cy = ryy, cz = rzz;
            for (const axis of order) {
              if (axis === 'y') {
                const targetY = targetYParam;
                const dirY = Math.sign(targetY - cy);
                if (dirY !== 0) {
                  for (let yy = cy + dirY; yy !== targetY; yy += dirY) {
                    if (occupiedMapLocal.has(`${cx},${yy},${cz}`)) return false;
                  }
                }
                cy = targetY;
              } else if (axis === 'z') {
                const targetZ = targetZParam;
                const dirZ = Math.sign(targetZ - cz);
                if (dirZ !== 0) {
                  for (let zz = cz + dirZ; zz !== targetZ; zz += dirZ) {
                    if (occupiedMapLocal.has(`${cx},${cy},${zz}`)) return false;
                  }
                }
                cz = targetZ;
              }
            }
            return true;
          };
          const okRook = pathClearFromLocal(rx, ry, rz, ['y','z'], rookTo.y, rookTo.z) || pathClearFromLocal(rx, ry, rz, ['z','y'], rookTo.y, rookTo.z);
          if (!okRook) return false;
          return true;
        } catch (e) { return false; }
      };

      // extracted move executor so modal handlers can reuse it
      const _doMove = useCallback((finalTarget) => {
        if (moveLockRef.current) return;
        moveLockRef.current = true;
        try { (typeof pushStateSnapshot !== 'undefined') && pushStateSnapshot(); } catch (e) {}
        let moverBefore = null;
        try {
        if (finalTarget && finalTarget.castle) {
          // Defensive pattern-check: ensure castle.type matches the actual king displacement
          try {
            moverBefore = piecesState.find(pp => pp.id === selectedPieceId);
            if (moverBefore) {
              const dx = Math.abs((finalTarget.x || 0) - moverBefore.x);
              const dy = Math.abs((finalTarget.y || 0) - moverBefore.y);
              const dz = Math.abs((finalTarget.z || 0) - moverBefore.z);
              const cType = finalTarget.castle.type;
              if (cType === 'queen' && !(dy === 2 || dz === 2)) {
                try { console.debug('castle type mismatch: queen but king moved one-step; stripping castle', { moverBefore, finalTarget }); } catch (e) {}
                finalTarget = { ...finalTarget, castle: null };
              }
              if (cType === 'king' && !(dy === 1 || dz === 1)) {
                try { console.debug('castle type mismatch: king but king moved multi-step; stripping castle', { moverBefore, finalTarget }); } catch (e) {}
                finalTarget = { ...finalTarget, castle: null };
              }
            }
          } catch (e) {}
          // NOTE: We already validated the castle move during generation using explicit maps.
          // No need for re-validation here - trust the castle metadata from move generation.
        }
        if (selectedPieceId == null) return;
        try { if (typeof onBeforeUserMove === 'function') onBeforeUserMove(); } catch (err) {}
        moverBefore = piecesState.find(pp => pp.id === selectedPieceId);
        let notation = '';
        try { notation = generateMoveNotation(moverBefore, finalTarget, piecesState); } catch (err) { notation = ''; }
        let coordMove = '';
        try {
          if (moverBefore && finalTarget && typeof finalTarget.x === 'number' && typeof finalTarget.y === 'number' && typeof finalTarget.z === 'number') {
            const fromSq = `${moverBefore.z + 1}${String.fromCharCode(97 + moverBefore.y)}${8 - moverBefore.x}`;
            const toSq = `${finalTarget.z + 1}${String.fromCharCode(97 + finalTarget.y)}${8 - finalTarget.x}`;
            coordMove = `${fromSq}${toSq}`.toLowerCase();
          }
        } catch (err) { coordMove = ''; }
        try { if (typeof onPuzzleHumanMove === 'function') onPuzzleHumanMove(moverBefore, finalTarget, coordMove, notation); } catch (err) {}
        try {
          try { console.debug('notation details', { moverBefore, target: finalTarget, targetNotation: squareToNotation(finalTarget), computedNotation: notation }); } catch (e) {}
        } catch (e) {}
        setPiecesState((prev) => {
          const mover = prev.find(pp => pp.id === selectedPieceId);
          if (!mover) return prev;
          const movingColor = mover.color;
          // if target indicates en-passant capture, remove the captured pawn by id
          let withoutCaptured;
          try {
            if (finalTarget && finalTarget.enPassant && finalTarget.capturedId) {
              withoutCaptured = prev.filter(pp => pp.id !== finalTarget.capturedId);
            } else {
              withoutCaptured = prev.filter(pp => !(pp.x === finalTarget.x && pp.y === finalTarget.y && pp.z === finalTarget.z && pp.color !== movingColor));
            }
            const next = withoutCaptured.map((pp) => {
              if (pp.id === selectedPieceId) {
                const updated = { ...pp, x: finalTarget.x, y: finalTarget.y, z: finalTarget.z, hasMoved: true };
                // Apply pawn promotion if specified
                if (finalTarget.promotion && pp.t === 'p') {
                  updated.t = finalTarget.promotion;
                }
                return updated;
              }
              // handle castling rook movement â€” compute safe rookTo so it never lands onto the king's landing square
              if (finalTarget && finalTarget.castle && pp.id === finalTarget.castle.rookId) {
                try { console.debug('castle rook movement triggered', { pieceId: pp.id, rookId: finalTarget.castle.rookId, rookFrom: { x: pp.x, y: pp.y, z: pp.z }, originalRookTo: finalTarget.castle.rookTo }); } catch (e) {}
                const originalRookTo = finalTarget.castle.rookTo;
                // if rookTo equals king landing (would collide), fall back to mover's original square
                let safeRookTo = originalRookTo;
                try {
                  if (originalRookTo && finalTarget && typeof finalTarget.x === 'number' && typeof originalRookTo.x === 'number') {
                    if (originalRookTo.x === finalTarget.x && originalRookTo.y === finalTarget.y && originalRookTo.z === finalTarget.z) {
                      // fall back to mover's original position (king's origin)
                      safeRookTo = { x: mover.x, y: mover.y, z: mover.z };
                      try { console.debug('collision detected, using king origin as rookTo', safeRookTo); } catch (e) {}
                    }
                  }
                } catch (e) {}
                if (safeRookTo) {
                  try { console.debug('moving rook to', safeRookTo); } catch (e) {}
                  return { ...pp, x: safeRookTo.x, y: safeRookTo.y, z: safeRookTo.z, hasMoved: true };
                }
              }
              return pp;
            });
            try { console.log('moveTo:', { selectedPieceId, target: finalTarget, movingColor, beforeCount: prev.length, afterCount: next.length }); } catch (e) {}
            return next;
          } catch (e) { return prev; }
        });
        // record raw coord move for the engine synchronously
        try {
          if (moverBefore && finalTarget && typeof finalTarget.x === 'number' && typeof finalTarget.y === 'number' && typeof finalTarget.z === 'number' && coordMoveHistoryRef) {
            const fromSq = `${moverBefore.z + 1}${String.fromCharCode(97 + moverBefore.y)}${8 - moverBefore.x}`;
            const toSq   = `${finalTarget.z + 1}${String.fromCharCode(97 + finalTarget.y)}${8 - finalTarget.x}`;
            const coordMove = fromSq + toSq;
            console.log('Pieces moveTo coordMove:', coordMove);
            let newCoordMoves = [...coordMoveHistoryRef.current, coordMove];
            // If castling, also record the rook move as a separate coord move
            if (finalTarget.castle && finalTarget.castle.rookId && finalTarget.castle.rookFrom && finalTarget.castle.rookTo) {
              // Use x directly for rookFromSq to match board rendering logic (no 8-...)
              const rookFromSq = `${finalTarget.castle.rookFrom.z + 1}${String.fromCharCode(97 + finalTarget.castle.rookFrom.y)}${finalTarget.castle.rookFrom.x + 1}`;
              const rookToSq   = `${finalTarget.castle.rookTo.z + 1}${String.fromCharCode(97 + finalTarget.castle.rookTo.y)}${finalTarget.castle.rookTo.x + 1}`;
              const rookCoordMove = rookFromSq + rookToSq;
              console.log('Pieces moveTo rookCoordMove (castling):', rookCoordMove);
              newCoordMoves = [...newCoordMoves, rookCoordMove];
            }
            coordMoveHistoryRef.current = newCoordMoves;
            if (typeof setCoordMoveHistory === 'function') setCoordMoveHistory(newCoordMoves);
          }
        } catch (e) { console.debug('Pieces coordMoveHistory error', e); }
        // record notation into moveHistory (use moverBefore.color for which side moved)
        try {
          const side = moverBefore ? moverBefore.color : null;
          let finalNotation = notation;
          if (!finalNotation) {
            try { finalNotation = `${squareToNotation(moverBefore || {})}-${squareToNotation(finalTarget || {})}`; } catch (e) { finalNotation = ''; }
          }
          if (finalNotation && typeof setMoveHistory === 'function') {
            try { console.debug('recording notation', { notation: finalNotation, side }); } catch (e) {}
            setMoveHistory(prev => {
              const copy = prev ? prev.slice() : [];
              if (side === 'white') {
                const last = copy.length ? copy[copy.length - 1] : null;
                if (last && last.white === finalNotation) return copy;
                copy.push({ white: finalNotation, black: null });
              } else if (side === 'black') {
                if (copy.length === 0) copy.push({ white: null, black: finalNotation });
                else copy[copy.length - 1] = { ...copy[copy.length - 1], black: finalNotation };
              }
              try { console.debug('moveHistory now', copy); } catch (e) {}
              return copy;
            });
          }
        } catch (e) { console.debug('setMoveHistory error', e); }
        setSelectedPieceId(null);
        // Set lastMove for all moves, including castling, and flush before toggling turn
        if (moverBefore) {
          const lm = {
            id: moverBefore.id,
            from: { x: moverBefore.x, y: moverBefore.y, z: moverBefore.z },
            to: { x: finalTarget.x, y: finalTarget.y, z: finalTarget.z },
            doubleStep: (moverBefore.t === 'p' && Math.abs(finalTarget.x - moverBefore.x) === 2),
            castle: finalTarget.castle ? { ...finalTarget.castle } : undefined
          };
          if (setLastMove) setLastMove(lm);
          // Force a microtask flush so React processes setLastMove before setCurrentTurn
          Promise.resolve().then(() => {
            if (setCurrentTurn) setCurrentTurn((prev) => {
              const next = prev === 'white' ? 'black' : 'white';
              try { console.debug('turn toggled', prev, '->', next); } catch (e) {}
              return next;
            });
          });
          try { console.log('lastMove set', lm); } catch (e) {}
        } else {
          if (setLastMove) { setLastMove(null); try { console.log('lastMove cleared (1502)'); } catch (e) {} }
          if (setCurrentTurn) setCurrentTurn((prev) => {
            const next = prev === 'white' ? 'black' : 'white';
            try { console.debug('turn toggled', prev, '->', next); } catch (e) {}
            return next;
          });
        }
        // release move lock after move application (small delay to avoid immediate re-entrancy)
        try { setTimeout(() => { try { moveLockRef.current = false; } catch (e) {} }, 60); } catch (e) { try { moveLockRef.current = false; } catch (e) {} }
      } catch (e) {
        console.error('Error in _doMove:', e);
      }
      }, [selectedPieceId, piecesState, setPiecesState, setSelectedPieceId, setCurrentTurn, setLastMove, setMoveHistory, generateMoveNotation, squareToNotation, pushStateSnapshot, onBeforeUserMove, onPuzzleHumanMove]);

      // wrapper to prompt or execute
      const moveTo = useCallback((target) => {
        if (selectedPieceId == null) return;
        if (moveLockRef.current) return;
        
        try { console.debug('moveTo called', { target, hasCastle: !!target.castle, selectedPieceId }); } catch (e) {}
        
        // Check for pawn promotion
        try {
          const mover = piecesState.find(pp => pp.id === selectedPieceId);
          if (mover && mover.t === 'p') {
            // White pawns move from x=6 toward x=0, so promote at x=0. Black pawns move toward x=7 and promote there.
            const promotionRank = mover.color === 'white' ? 0 : 7;
            if (target.x === promotionRank) {
              // Show promotion dialog
              if (typeof showPromotionPrompt === 'function') {
                showPromotionPrompt({
                  onSelect: (pieceType) => _doMove({ ...target, promotion: pieceType })
                });
                return;
              }
              // Fallback: default to queen
              _doMove({ ...target, promotion: 'Q' });
              return;
            }
          }
        } catch (e) {}
        
        try {
          if (target && target.castle && target.castle.type === 'king') {
            if (typeof showCastlePrompt === 'function') {
              showCastlePrompt({ title: 'Castle?', onYes: () => _doMove(target), onNo: () => _doMove({ ...target, castle: null }) });
              return;
            }
            const ok = typeof window !== 'undefined' ? window.confirm('Castle?') : true;
            if (!ok) { setSelectedPieceId(null); return; }
          }
        } catch (e) {}
        _doMove(target);
      }, [selectedPieceId, moveLockRef, showCastlePrompt, showPromotionPrompt, _doMove, piecesState]);

      // when App reports a pendingDrop, decide whether it's a legal landing square
      useEffect(() => {
        if (!pendingDrop) return;
        if (inHistoryView) { setPendingDrop(null); return; } // ignore drops in history view
        if (selectedPieceId == null) {
          setPendingDrop(null);
          return;
        }
        try {
          // convert world point to local coords
          const v = new THREE.Vector3(pendingDrop[0], pendingDrop[1], pendingDrop[2]);
          if (groupRef && groupRef.current) groupRef.current.worldToLocal(v);
          // try: pick nearest legal move by screen-space distance (more perceptually appropriate)
          let chosenMove = null;
          try {
            if (legalMoves && legalMoves.length > 0) {
              // If we have a last screen position from pointer events, prefer pixel-distance check.
              const canvas = document.querySelector('canvas');
              const cam = controlsRef && controlsRef.current && controlsRef.current.object;
              if (pointerLastScreenRef && pointerLastScreenRef.current && canvas && cam) {
                try {
                  const rect = canvas.getBoundingClientRect();
                  let bestPx = Infinity; let bestMv = null;
                  for (const mv of legalMoves) {
                    const wp = worldPosFromLogical(mv.x, mv.y, mv.z);
                    const vec = new THREE.Vector3(wp[0], wp[1], wp[2]).project(cam);
                    const sx = rect.left + (vec.x + 1) * 0.5 * rect.width;
                    const sy = rect.top + (-vec.y + 1) * 0.5 * rect.height;
                    const dx = sx - pointerLastScreenRef.current.x;
                    const dy = sy - pointerLastScreenRef.current.y;
                    const pd = Math.hypot(dx, dy);
                    if (pd < bestPx) { bestPx = pd; bestMv = mv; }
                  }
                  if (bestMv && bestPx <= MOVE_PIXEL_THRESH) chosenMove = bestMv;
                } catch (err) { console.debug('pixel-tolerance check err', err); }
              } else {
                // fallback to world-space distance (legacy)
                let best = Infinity; let bestMv = null;
                for (const mv of legalMoves) {
                  const wp = worldPosFromLogical(mv.x, mv.y, mv.z);
                  const dx = wp[0] - v.x; const dy = wp[1] - v.y; const dz = wp[2] - v.z;
                  const d = Math.hypot(dx, dy, dz);
                  if (d < best) { best = d; bestMv = mv; }
                }
                if (bestMv && best <= MOVE_WORLD_THRESH) chosenMove = bestMv;
              }
            }
          } catch (err) { console.debug('nearest-move selection error', err); }

          // fallback: nearest logical rounding (legacy behavior)
          if (!chosenMove) {
            // Inverse parallelogram transformation: wx = lx + ly*0.4 - 4.4, wz = ly - 1.5
            // Solving: ly = wz + 1.5, lx = wx - ly*0.4 + 4.4
            const shearFactor = 0.475;
            const yIndex = v.z + 1.5;  // ly (but flipped is 3-ly)
            const lx = Math.round(v.x - yIndex * shearFactor + 4.6);
            const ly = Math.round(3 - yIndex);  // flip back to logical ly
            // pick level by closest Y
            const levels = getLevelY();
            let lz = 0;
            let bestDist = Infinity;
            for (let i = 0; i < levels.length; i++) {
              const d = Math.abs(v.y - (levels[i] + 0.11));
              if (d < bestDist) { bestDist = d; lz = i; }
            }
            const moveObj = legalMoves.find(mv => mv.x === lx && mv.y === ly && mv.z === lz);
            if (moveObj) chosenMove = moveObj;
          }

          if (chosenMove) {
            moveTo(chosenMove);
          } else {
            // cancel drag: clear selection and leave piecesState unchanged
            setSelectedPieceId(null);
          }
        } catch (e) {}
        setPendingDrop(null);
        // ensure dragging state cleared
        try { if (controlsRef && controlsRef.current) controlsRef.current.enabled = true; } catch {}
        try { pointerDownRef.current = false; } catch {}
        setIsDragging(false);
        setDragPointWorld(null);
        setPointerActive(false);
      }, [pendingDrop, controlsRef, groupRef, /*legalMoves*/ legalMoves, moveTo, pointerDownRef, selectedPieceId, setDragPointWorld, setIsDragging, setPendingDrop, setPointerActive, setSelectedPieceId]);

      

      const indicators = legalMoves.map((m, i) => {
        // default indicator position is landing square
        const wp = worldPosFromLogical(m.x, m.y, m.z);
        let indicatorPos = wp.slice();
        // en-passant: show indicator at the landing square (as if the pawn had moved one square)
        if (m.enPassant) {
          indicatorPos = [wp[0], wp[1] + 0.08, wp[2]];
        } else {
          // if a piece occupies the target, raise the indicator above that piece so it's visible for captures
          const occ = allPieces.find((pp) => pp.x === m.x && pp.y === m.y && pp.z === m.z);
          if (occ) {
            const pieceNameMap = { N: 'knight', B: 'bishop', K: 'king', Q: 'queen' };
            const s = GLOBAL_PIECE_SCALE[pieceNameMap[occ.t] || 'pawn'] || 0.013;
            const topOffset = s * sceneScale + 0.05;
            indicatorPos = [wp[0], wp[1] + topOffset, wp[2]];
          }
        }
        return (
          <group key={`move-ind-${i}`} position={indicatorPos}>
            <mesh key={`move-ind-hit-${i}`} onPointerUp={(e) => {
              // Only fire moveTo if: dragging a selected piece, clicking blank space, or
              // clicking the already-selected piece. If pointer went DOWN on a DIFFERENT piece,
              // let the event bubble so the canvas can handle piece selection instead.
              const pressedDifferentPiece = pointerDownPieceRef.current && pointerDownPieceRef.current !== selectedPieceId;
              if (pressedDifferentPiece) return; // don't stop propagation â€” let canvas select the new piece
              e.stopPropagation(); 
              moveTo(m);
              // Clean up drag state (since we're stopping propagation, canvas handler won't run)
              try { 
                setIsDragging(false);
                setDragPointWorld(null);
                setPointerActive(false);
                pointerDownRef.current = false;
                if (controlsRef.current) controlsRef.current.enabled = true;
              } catch{}
            }} renderOrder={998}>
              <sphereGeometry args={[MOVE_HIT_RADIUS, 8, 8]} />
              <meshBasicMaterial transparent={true} opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
            <mesh key={`move-ind-vis-${i}`} onPointerUp={(e) => {
              const pressedDifferentPiece = pointerDownPieceRef.current && pointerDownPieceRef.current !== selectedPieceId;
              if (pressedDifferentPiece) return;
              e.stopPropagation(); 
              moveTo(m);
              // Clean up drag state (since we're stopping propagation, canvas handler won't run)
              try { 
                setIsDragging(false);
                setDragPointWorld(null);
                setPointerActive(false);
                pointerDownRef.current = false;
                if (controlsRef.current) controlsRef.current.enabled = true;
              } catch{}
            }} renderOrder={999}>
              <sphereGeometry args={[0.14, 16, 16]} />
              <meshStandardMaterial color="#ff0000" depthTest={false} depthWrite={false} />
            </mesh>
          </group>
        );
      });

      return <group>{pieces.concat(indicators)}</group>;
    }

export function Ghost({ dragPoint, dragPointWorld, selectedPieceId, piecesState, isDragging, pointerDownRef, kingGltf, pawnGltf, knightGltf, bishopGltf, rookGltf, queenGltf, clones, currentTurn }) {
      const sel = piecesState.find((p) => p.id === selectedPieceId);
      const modelMap = {
        R: rookGltf,
        N: knightGltf,
        B: bishopGltf,
        K: kingGltf,
        Q: queenGltf,
        p: pawnGltf,
      };
      const gltf = sel ? (modelMap[sel.t] || pawnGltf) : null;
      const color = sel ? (sel.color === 'white' ? '#ffffff' : '#615c5c') : '#ffffff';

      // create a clone and make it render on top (hook always called)
      const cloned = useMemo(() => {
        if (!gltf || !sel) return null;
        try {
          const cacheKey = `${sel.t}-${sel.color === 'white' ? 'white' : '#615c5c'}`;
          const c = (clones && clones[cacheKey]) ? clones[cacheKey].clone(true) : cloneAndColor(gltf, color);
          c.traverse((n) => {
            if (n.isMesh && n.material) {
              try { n.material = n.material.clone(); } catch (err) {}
              n.material.transparent = true;
              n.material.opacity = 0.95;
              n.material.depthTest = false;
              n.material.depthWrite = false;
              n.renderOrder = 999;
            }
          });
          return c;
        } catch (err) { return null; }
      }, [gltf, color, sel, clones]);

      // show ghost only while actively dragging; don't render on simple pointer-down
      if (!dragPoint || !sel || !isDragging) return null;

      if (!cloned) return null;

      const s = GLOBAL_PIECE_SCALE[sel.t === 'N' ? 'knight' : (sel.t === 'p' ? 'pawn' : (sel.t === 'B' ? 'bishop' : (sel.t === 'R' ? 'rook' : (sel.t === 'Q' ? 'queen' : 'king'))))] || 0.013;

      // Apply per-level multiplier so lower boards can have smaller ghosts.
      const levelIndex = (typeof sel.z === 'number') ? sel.z : 3;
      const levelFactor = (DRAG_LEVEL_SCALE && DRAG_LEVEL_SCALE[levelIndex] != null) ? DRAG_LEVEL_SCALE[levelIndex] : 1.0;
      const finalScale = s * levelFactor * GHOST_SCALE_FACTOR;

      // Ghost is rendered inside the same scaled group as pieces; use the adjusted scale so it matches.
      return (
        <group raycast={() => null} renderOrder={999}>
          <primitive object={cloned} position={dragPoint} scale={[finalScale * PIECE_ASPECT_RATIO[0], finalScale * PIECE_ASPECT_RATIO[1], finalScale * PIECE_ASPECT_RATIO[2]]} rotation={(sel.color === currentTurn) ? [0, Math.PI, 0] : [0,0,0]} />
        </group>
      );
    }
