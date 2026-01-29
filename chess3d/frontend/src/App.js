import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from 'three';
//import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import "./App.css";

const GLOBAL_PIECE_SCALE = {
  pawn: 0.013,
  knight: 0.013,
  bishop: 0.013,
  rook: 0.013,
  queen: 0.013,
  king: 0.013,
};
const GHOST_SCALE_FACTOR = 1.0;
// Per-level multiplier applied to the dragged ghost.
// Note: logical level `z` is ordered with z=0 at the TOP board and z=3 at the BOTTOM board.
// Index mapping: DRAG_LEVEL_SCALE[0] -> top board (z0), ... DRAG_LEVEL_SCALE[3] -> bottom board (z3).
// Tweak these values to make ghosts smaller/larger per-board level.
//const DRAG_LEVEL_SCALE = [1.0, 0.8, 0.7, 0.6];
const DRAG_LEVEL_SCALE = [0.6, 0.7, 0.8, 1.0];

// Y positions for each logical level `z` (index 0 = TOP board, index 3 = BOTTOM board)
const LEVEL_Y = [8.75, 6.6, 3.725, 0];

// Helper utilities for move/check logic
//function keyOf(x,y,z){return `${x},${y},${z}`;}
function inBounds(x,y,z){return x>=0 && x<=7 && y>=0 && y<=3 && z>=0 && z<=3;}

function isSquareAttacked(pieces, tx, ty, tz, byColor) {
  // pieces: array of {x,y,z,t,color}
  // check pawns, knights, kings, sliding pieces
  const enemy = byColor;
  // pawn attacks: follow same rules as pawn capture generation
  const dir = enemy === 'white' ? -1 : 1; // white pawns move -1 in x
  for (const p of pieces) {
    if (p.color !== enemy) continue;
    if (p.t === 'p') {
      const oneX = p.x + dir;
      const candidates = [[p.y+1,p.z],[p.y-1,p.z],[p.y,p.z+1],[p.y,p.z-1]];
      for (const [cy,cz] of candidates) {
        if (oneX === tx && cy === ty && cz === tz) return true;
      }
    }
  }
  // knights
  const knightOffsets = [[2,1,0],[1,2,0],[2,0,1],[1,0,2],[-2,1,0],[-1,2,0],[-2,0,1],[-1,0,2],[2,-1,0],[1,-2,0],[2,0,-1],[1,0,-2],[-2,-1,0],[-1,-2,0],[-2,0,-1],[-1,0,-2]];
  for (const p of pieces) {
    if (p.color !== enemy) continue;
    if (p.t === 'N') {
      for (const [dx,dy,dz] of knightOffsets) {
        if (p.x+dx === tx && p.y+dy === ty && p.z+dz === tz) return true;
      }
    }
  }
  // king adjacency
  const kingOffsets = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
  for (const p of pieces) {
    if (p.color !== enemy) continue;
    if (p.t === 'K') {
      for (const [dx,dy,dz] of kingOffsets) {
        if (p.x+dx === tx && p.y+dy === ty && p.z+dz === tz) return true;
      }
    }
  }

  // sliding pieces: scan from target outwards along directions and see first piece
  const rookDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const bishopDirs = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
  const allDirs = rookDirs.concat(bishopDirs);
  for (const [dx,dy,dz] of allDirs) {
    for (let step=1;;step++){
      const nx = tx + dx*step;
      const ny = ty + dy*step;
      const nz = tz + dz*step;
      if (!inBounds(nx,ny,nz)) break;
      const occ = pieces.find(pp => pp.x===nx && pp.y===ny && pp.z===nz);
      if (!occ) continue;
      if (occ.color !== enemy) break; // blocked by non-attacker
      // occ is attacker; check type compatibility
      const isRookLike = rookDirs.some(d => d[0]===dx && d[1]===dy && d[2]===dz);
      const isBishopLike = bishopDirs.some(d => d[0]===dx && d[1]===dy && d[2]===dz);
      if (occ.t === 'Q') return true;
      if (occ.t === 'R' && isRookLike) return true;
      if (occ.t === 'B' && isBishopLike) return true;
      break;
    }
  }
  return false;
}

function simulateMove(pieces, moverId, target) {
  // return new pieces array after moving moverId to target and removing captured enemy on that square
  const mover = pieces.find(p => p.id === moverId);
  if (!mover) return pieces.slice();
  const movingColor = mover.color;
  // handle en-passant if target includes capturedId
  let filtered = pieces;
  //if (target && target.enPassant) {
  if (target) {
    if (target.capturedId) {
      filtered = pieces.filter(pp => pp.id !== target.capturedId);
    } else {
      // fallback: captured pawn may not be present on target square;
      // for en-passant the captured pawn sits on the mover's original file (mover.x)
      // and on the landing square's y/z. Find an enemy pawn there and remove it.
      const moverOrig = mover;
      const captured = pieces.find(pp => pp.color !== movingColor && pp.t === 'p' && pp.x === moverOrig.x && pp.y === target.y && pp.z === target.z);
      if (captured) filtered = pieces.filter(pp => pp.id !== captured.id);
      else filtered = pieces.slice();
    }
  } else {
    filtered = pieces.filter(pp => !(pp.x === target.x && pp.y === target.y && pp.z === target.z && pp.color !== movingColor));
  }
  const next = filtered.map(pp => {
    if (pp.id === moverId) return { ...pp, x: target.x, y: target.y, z: target.z, hasMoved: true };
    // handle castling rook move when target.castle provided
    if (target && target.castle && pp.id === target.castle.rookId) {
      const rt = target.castle.rookTo;
      return { ...pp, x: rt.x, y: rt.y, z: rt.z, hasMoved: true };
    }
    return pp;
  });
  return next;
}

function isAnyKingInCheck(pieces, color) {
  // find all kings for color; return true if any king is attacked by opponent
  const kings = pieces.filter(p => p.t === 'K' && p.color === color);
  const enemy = color === 'white' ? 'black' : 'white';
  for (const k of kings) {
    if (isSquareAttacked(pieces, k.x, k.y, k.z, enemy)) return true;
  }
  return false;
}

function attackersOfSquare(pieces, tx, ty, tz) {
    const res = [];
    for (const p of pieces) {
      if (attacksSquareByPiece(p, tx, ty, tz, pieces)) res.push(p);
    }
    return res;
  }

function canPieceMoveTo(piece, tx, ty, tz, pieces) {
  // raw move perm (igno king in check)
  if (!inBounds(tx,ty,tz)) return false;
  // cannot move onto friendly-occupied square
  const occ = pieces.find(pp => pp.x===tx && pp.y===ty && pp.z===tz);
  if (occ && occ.color === piece.color) return false;
  // pawn forward moves (one or two) are not captures and handled specially
  if (piece.t === 'p') {
    // captures
    if (attacksSquareByPiece(piece, tx, ty, tz, pieces)) return true;
    const dir = piece.color === 'white' ? -1 : 1;
    // one-step forward
    if (tx === piece.x + dir && ty === piece.y && tz === piece.z && !occ) return true;
    // two-step from start
    const startX = piece.color === 'white' ? 6 : 1;
    if (piece.x === startX && tx === piece.x + dir*2 && ty === piece.y && tz === piece.z) {
      const mid = pieces.find(pp => pp.x === piece.x + dir && pp.y === piece.y && pp.z === piece.z);
      if (!mid && !occ) return true;
    }
    return false;
  }
  // other pieces: reuse attack test (covers knights, kings, sliding pieces)
  return attacksSquareByPiece(piece, tx, ty, tz, pieces);
}

function hasAnyLegalMove(pieces, color) {
  for (const p of pieces) {
    if (p.color !== color) continue;
    // brute force all areas for possible moves
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          if (!canPieceMoveTo(p, x, y, z, pieces)) continue;
          const next = simulateMove(pieces, p.id, { x, y, z });
          if (!isAnyKingInCheck(next, p.color)) return true;
        }
      }
    }
  }
  return false;
}

function canAnyPieceCaptureAttackers(pieces, attackerList) {
  if (!attackerList || attackerList.length === 0) return false;
  const attackerCoords = attackerList.map(a => ({ x: a.x, y: a.y, z: a.z, id: a.id }));
  for (const p of pieces) {
    for (const a of attackerCoords) {
      if (!canPieceMoveTo(p, a.x, a.y, a.z, pieces)) continue;
      const next = simulateMove(pieces, p.id, { x: a.x, y: a.y, z: a.z });
      // ensure attacker removed and move doesn't leave mover in check
      const stillHasAttacker = next.find(pp => pp.id === a.id);
      if (stillHasAttacker) continue;
      if (!isAnyKingInCheck(next, p.color)) return true;
    }
  }
  return false;
}

function cloneAndColor(gltf, color) {
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

  obj.traverse((n) => {
    if (n.isMesh) {
      if (n.material) {
        n.material = n.material.clone();
        try { n.material.color.set(color); } catch (e) {}
        n.castShadow = true;
        n.receiveShadow = true;
      }
    }
  });
  return obj;
}

// Per-piece attack test: does `piece` attack target (tx,ty,tz) considering blocking in `pieces`?
function attacksSquareByPiece(piece, tx, ty, tz, pieces, lastMove) {
  if (!piece) return false;
  // dx/dy/dz were unused here and removed to satisfy lint
  if (piece.t === 'p') {
    const dir = piece.color === 'white' ? -1 : 1;
    const oneX = piece.x + dir;
    if (oneX !== tx) return false;
    if ((piece.y+1 === ty && piece.z === tz) || (piece.y-1 === ty && piece.z === tz) || (piece.y === ty && piece.z+1 === tz) || (piece.y === ty && piece.z-1 === tz)) return true;
    return false;
  }
  if (piece.t === 'N') {
    const moves = [[2,1,0],[1,2,0],[2,0,1],[1,0,2]];
    for (const [ax,ay,az] of moves) {
      const xs = ax === 0 ? [0] : [-ax, ax];
      const ys = ay === 0 ? [0] : [-ay, ay];
      const zs = az === 0 ? [0] : [-az, az];
      for (const x of xs) for (const y of ys) for (const z of zs) {
        if (!(z === 0 || y === 0)) continue;
        if (piece.x + x === tx && piece.y + y === ty && piece.z + z === tz) return true;
      }
    }
    return false;
  }
  if (piece.t === 'K') {
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
    for (const [rx,ry,rz] of dirs) {
      if (piece.x + rx === tx && piece.y + ry === ty && piece.z + rz === tz) return true;
    }
    return false;
  }
  // sliding pieces R, B, Q
  const rookDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const bishopDirs = [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]];
  const allDirs = rookDirs.concat(bishopDirs);
  for (const [dxu,dyu,dzu] of allDirs) {
    // check along this dir from piece until out of bounds
    for (let step=1;;step++){
      const nx = piece.x + dxu*step;
      const ny = piece.y + dyu*step;
      const nz = piece.z + dzu*step;
      if (!inBounds(nx,ny,nz)) break;
      if (nx === tx && ny === ty && nz === tz) {
        // ensure piece type supports this dir
        if (piece.t === 'Q') return true;
        if (piece.t === 'R' && rookDirs.some(d => d[0]===dxu && d[1]===dyu && d[2]===dzu)) return true;
        if (piece.t === 'B' && bishopDirs.some(d => d[0]===dxu && d[1]===dyu && d[2]===dzu)) return true;
        return false;
      }
      // if blocked before reaching target, stop
      const occ = pieces.find(pp => pp.x === nx && pp.y === ny && pp.z === nz);
      if (occ) break;
    }
  }
  return false;
}
    function Square({ position, color }) {
      return (
        <mesh position={position}>
          <boxGeometry args={[1, 0.15, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    }

    function BoardLevel({ y, flip = false }) {
      const squares = [];
      for (let x = 0; x < 8; x++) {
        for (let row = 0; row < 4; row++) {
          // within-board rows use logical y; flip so logical y=0 maps to visual top within board
          const yIndex = 3 - row;
          const isWhite = ((x + yIndex + (flip ? 1 : 0)) % 2) !== 0;
          squares.push(
            <Square
              key={`${y}-${x}-${row}`}
              // world coordinates: X, world Y (level), world Z (in-board row)
              position={[x - 3.5, y, yIndex - 3.5]}
              color={isWhite ? "#f0d9b5" : "#b58863"}
            />
          );
        }
      }
      return <group>{squares}</group>;
    }

    function QuadLevelBoard() {
      // render from bottom -> top for correct visual stacking
      const bottomToTop = LEVEL_Y.slice().reverse();
      return (
        <group>
          {bottomToTop.map((y, i) => <BoardLevel key={`lvl-${i}`} y={y} flip={i % 2 === 0} />)}
        </group>
      );
    }

    function Pieces({ piecesState, setPiecesState, selectedPieceId, setSelectedPieceId, isDragging, dragPoint, setIsDragging, setDragPoint, dragPointWorld, setDragPointWorld, setPointerActive, controlsRef, pointerDownRef, pointerStartRef, pointerStartScreenRef, pointerDepthRef, pointerDownPieceRef, pointerDownWasSelectedRef, kingGltf, pawnGltf, knightGltf, bishopGltf, rookGltf, queenGltf, clones, pendingDrop, setPendingDrop, groupRef, setDragHeight, sceneScale, currentTurn, setCurrentTurn, lastMove, setLastMove, gameOver }) {
      const levels = LEVEL_Y;
      const pieces = [];

      // Per-piece scale constants (tweak these if models look too big/small)
      const scaleMap = GLOBAL_PIECE_SCALE;

      // piecesState is an array of piece objects with {id,x,y,z,t,color}
      const allPieces = piecesState;

      // occupancy set keyed by logical coords (unused currently)

      // helper to convert logical coords to world positions
      function worldPosFromLogical(lx, ly, lz) {
        const wx = lx - 3.5;
        const wy = levels[lz] + 0.11;
        const wz = (3 - ly) - 3.5;
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

              for (const rook of rooks) {
                if (rook.hasMoved) continue;
                const rx = rook.x, ry = rook.y, rz = rook.z;
                const candidateLandings = [];
                if (ry !== sy) candidateLandings.push({ x: sx, y: sy + Math.sign(ry - sy), z: sz, axis: 'y' });
                if (rz !== sz) candidateLandings.push({ x: sx, y: sy, z: sz + Math.sign(rz - sz), axis: 'z' });

                for (const landing of candidateLandings) {
                  const landingKey = `${landing.x},${landing.y},${landing.z}`;
                  if (occupiedMap.has(landingKey)) continue;
                  if (isSquareAttacked(allPieces, sx, sy, sz, enemy)) continue;
                  if (isSquareAttacked(allPieces, landing.x, landing.y, landing.z, enemy)) continue;

                  const okPathToKingOrig = pathClearFrom(rx, ry, rz, ['y','z'], sy, sz) || pathClearFrom(rx, ry, rz, ['z','y'], sy, sz);
                  if (okPathToKingOrig) {
                    moves.push({ x: landing.x, y: landing.y, z: landing.z, castle: { type: 'king', rookId: rook.id, rookFrom: { x: rx, y: ry, z: rz }, rookTo: { x: sx, y: sy, z: sz } } });
                  }

                  // unified queen-side handling (both Y and Z axis cases)
                  if (landing.axis === 'y' || landing.axis === 'z') {
                    const kingLanding = landing.axis === 'y' ? { x: sx, y: ry, z: sz } : { x: sx, y: sy, z: rz };
                    const mapKey = `${sx},${sy},${sz}->${kingLanding.x},${kingLanding.y},${kingLanding.z}`;
                    let mapped = queenBlockMap[mapKey];
                    // If not found and this is the white side, try mirrored lookup (mirror X across board)
                    if (!mapped && friendly === 'white') {
                      const mirror = (s) => {
                        const [ax, ay, az] = s.split(',').map(Number);
                        return `${7 - ax},${ay},${az}`;
                      };
                      const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${kingLanding.x},${kingLanding.y},${kingLanding.z}`)}`;
                      const mappedMirrored = queenBlockMap[mirroredKey];
                      if (mappedMirrored) mapped = mirror(mappedMirrored);
                      try { console.debug('queenBlockMap mirrored lookup', { mirroredKey, mappedMirrored, mapped }); } catch (e) {}
                    }
                    try { console.debug('queenBlockMap check unified', { mapKey, mapped, occupied: occupiedMap.get(mapped) }); } catch (e) {}
                    if (mapped && occupiedMap.get(mapped)) continue;

                    // helper: return array of coord-strings strictly between A (exclusive) and B (exclusive)
                    const betweenExclusive = (A, B) => {
                      const res = [];
                      const dx = Math.sign(B.x - A.x);
                      const dy = Math.sign(B.y - A.y);
                      const dz = Math.sign(B.z - A.z);
                      let cx = A.x + dx, cy = A.y + dy, cz = A.z + dz;
                      while (!(cx === B.x && cy === B.y && cz === B.z)) {
                        res.push(`${cx},${cy},${cz}`);
                        cx += dx; cy += dy; cz += dz;
                        // safety: avoid infinite loop
                        if (res.length > 20) break;
                      }
                      return res;
                    };

                    // ensure king path (squares between start and landing) are empty and not attacked
                    const kingBetween = betweenExclusive({ x: sx, y: sy, z: sz }, kingLanding);
                    let kingPathClear = true;
                    for (const sq of kingBetween) {
                      if (occupiedMap.has(sq)) { kingPathClear = false; break; }
                      const [kx, ky, kz] = sq.split(',').map(Number);
                      if (isSquareAttacked(allPieces, kx, ky, kz, enemy)) { kingPathClear = false; break; }
                    }
                    if (!kingPathClear) continue;

                    // ensure rook path from rook -> rookTo is clear (exclusive)
                    const rookTo = landing.axis === 'y' ? { x: sx, y: sy + Math.sign(ry - sy), z: sz } : { x: sx, y: sy, z: sz + Math.sign(rz - sz) };
                    const rookBetween = betweenExclusive({ x: rx, y: ry, z: rz }, rookTo);
                    let rookPathClear = true;
                    for (const sq of rookBetween) {
                      if (occupiedMap.has(sq)) { rookPathClear = false; break; }
                    }
                    if (!rookPathClear) continue;

                    // additional safety: verify rook can reach rookTo via our existing pathClearFrom fallback
                    const okRookPath = pathClearFrom(rx, ry, rz, ['y','z'], rookTo.y, rookTo.z) || pathClearFrom(rx, ry, rz, ['z','y'], rookTo.y, rookTo.z);
                    if (!okRookPath) continue;

                    moves.push({ x: kingLanding.x, y: kingLanding.y, z: kingLanding.z, castle: { type: 'queen', rookId: rook.id, rookFrom: { x: rx, y: ry, z: rz }, rookTo } });
                  }
                }
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
            if (!merged.has(k)) { merged.set(k, m); uniq.push(m); }
            else { Object.assign(merged.get(k), m); }
          }
          moves = uniq;
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
            <primitive
              object={(clones && clones[`${p.t}-${isWhite ? 'white' : '#615c5c'}`]) ? clones[`${p.t}-${isWhite ? 'white' : '#615c5c'}`].clone(true) : cloneAndColor(gltf, isWhite ? '#ffffff' : '#615c5c')}
              scale={s}
              rotation={isWhite ? [0, Math.PI, 0] : [0, 0, 0]}
            />
          </group>
        );
      });

      const moveLockRef = useRef(false);

      // render move indicators (red dots)
      const moveTo = useCallback((target) => {
        if (selectedPieceId == null) return;
        if (moveLockRef.current) return;
        // if this is a king-side castling attempt, confirm with the user; queen-side is automatic
        try {
          if (target && target.castle && target.castle.type === 'king') {
            const ok = typeof window !== 'undefined' ? window.confirm('Castle?') : true;
            if (!ok) {
              setSelectedPieceId(null);
              return;
            }
          }
        } catch (e) {}
        moveLockRef.current = true;
        // clear lock shortly after to allow subsequent moves
        setTimeout(() => { moveLockRef.current = false; }, 50);
        const moverBefore = piecesState.find(pp => pp.id === selectedPieceId);
        setPiecesState((prev) => {
          const mover = prev.find(pp => pp.id === selectedPieceId);
          if (!mover) return prev;
          const movingColor = mover.color;
          // if target indicates en-passant capture, remove the captured pawn by id
          let withoutCaptured;
          try {
            if (target && target.enPassant && target.capturedId) {
              withoutCaptured = prev.filter(pp => pp.id !== target.capturedId);
            } else {
              withoutCaptured = prev.filter(pp => !(pp.x === target.x && pp.y === target.y && pp.z === target.z && pp.color !== movingColor));
            }
            const next = withoutCaptured.map((pp) => {
              if (pp.id === selectedPieceId) return { ...pp, x: target.x, y: target.y, z: target.z, hasMoved: true };
              // handle castling rook movement
              if (target && target.castle && pp.id === target.castle.rookId) {
                const rt = target.castle.rookTo;
                return { ...pp, x: rt.x, y: rt.y, z: rt.z, hasMoved: true };
              }
              return pp;
            });
            try { console.log('moveTo:', { selectedPieceId, target, movingColor, beforeCount: prev.length, afterCount: next.length }); } catch (e) {}
            return next;
          } catch (e) { return prev; }
        });
        setSelectedPieceId(null);
        try {
          if (setCurrentTurn) setCurrentTurn((prev) => {
            const next = prev === 'white' ? 'black' : 'white';
            try { console.debug('turn toggled', prev, '->', next); } catch (e) {}
            return next;
          });
        } catch (e) {}
        try {
          if (moverBefore && moverBefore.t === 'p') {
            const dx = Math.abs(target.x - moverBefore.x);
            if (dx === 2) {
              const lm = { id: moverBefore.id, from: { x: moverBefore.x, y: moverBefore.y, z: moverBefore.z }, to: { x: target.x, y: target.y, z: target.z }, doubleStep: true };
              try { if (setLastMove) setLastMove(lm); try { console.log('lastMove set', lm); } catch (e) {} } catch (e) {}
            } else {
              try { if (setLastMove) { setLastMove(null); try { console.log('lastMove cleared'); } catch (e) {} } } catch (e) {}
            }
          } else {
            try { if (setLastMove) { setLastMove(null); try { console.log('lastMove cleared'); } catch (e) {} } } catch (e) {}
          }
        } catch (e) {}
      }, [selectedPieceId, setPiecesState, setSelectedPieceId, setCurrentTurn, piecesState, setLastMove]);

      // when App reports a pendingDrop, decide whether it's a legal landing square
      useEffect(() => {
        if (!pendingDrop) return;
        if (selectedPieceId == null) {
          setPendingDrop(null);
          return;
        }
        try {
          // convert world point to local coords
          const v = new THREE.Vector3(pendingDrop[0], pendingDrop[1], pendingDrop[2]);
          if (groupRef && groupRef.current) groupRef.current.worldToLocal(v);
          // determine nearest logical coords
          const lx = Math.round(v.x + 3.5);
          const ly = Math.round(3 - (v.z + 3.5));
          // pick level by closest Y
          const levels = LEVEL_Y;
          let lz = 0;
          let bestDist = Infinity;
          for (let i = 0; i < levels.length; i++) {
            const d = Math.abs(v.y - (levels[i] + 0.11));
            if (d < bestDist) { bestDist = d; lz = i; }
          }
          // const key = `${lx},${ly},${lz}`; // unused
          // find a matching legal move object so we preserve en-passant metadata
          const moveObj = legalMoves.find(mv => mv.x === lx && mv.y === ly && mv.z === lz);
          if (moveObj) {
            moveTo(moveObj);
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
          <mesh key={`move-ind-${i}`} position={indicatorPos} onPointerUp={(e) => { e.stopPropagation(); moveTo(m); try { if (controlsRef.current) controlsRef.current.enabled = true; } catch{} }} renderOrder={999}>
            <sphereGeometry args={[0.14, 16, 16]} />
            <meshStandardMaterial color="#ff0000" depthTest={false} depthWrite={false} />
          </mesh>
        );
      });

      return <group>{pieces.concat(indicators)}</group>;
    }

    

    function Ghost({ dragPoint, dragPointWorld, selectedPieceId, piecesState, isDragging, pointerDownRef, kingGltf, pawnGltf, knightGltf, bishopGltf, rookGltf, queenGltf, clones }) {
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
          <primitive object={cloned} position={dragPoint} scale={[finalScale, finalScale, finalScale]} />
        </group>
      );
    }

    export default function App() {
      const [currentTurn, setCurrentTurn] = useState('white');
      const [gameOver, setGameOver] = useState(false);
      const [gameWinner, setGameWinner] = useState(null);
      const [statusMessage, setStatusMessage] = useState('');
        const [lastMove, setLastMove] = useState(null); // track last move for en-passant (double-step)
      const [aiSide, setAiSide] = useState(null);
      const [selectedPieceId, setSelectedPieceId] = useState(null);
      const [isDragging, setIsDragging] = useState(false);
      const [dragPoint, setDragPoint] = useState([0, 0, 0]);
      const [dragHeight, setDragHeight] = useState(0);
      const [dragPointWorld, setDragPointWorld] = useState(null);
      
      const [pendingDrop, setPendingDrop] = useState(null);
      const [pointerActive, setPointerActive] = useState(false);
      const pointerDownRef = useRef(false);
      const pointerStartRef = useRef(null);
      const pointerDepthRef = useRef(null);
      const pointerStartScreenRef = useRef(null);
      const pointerDownPieceRef = useRef(null);
      const pointerDownWasSelectedRef = useRef(false);
      const groupRef = useRef();
      const sceneScale = 0.470;
      // load models once at App level and pass to children
      const kingGltf = useGLTF('/models/king2.glb');
      const pawnGltf = useGLTF('/models/pawn2.glb');
      const knightGltf = useGLTF('/models/knight_-_staunton_full_size_chess_set.glb');
      const bishopGltf = useGLTF('/models/bishop_-_staunton_full_size_chess_set.glb');
      const rookGltf = useGLTF('/models/rook_-_staunton_full_size_chess_set.glb');
      const queenGltf = useGLTF('/models/queen_-_staunton_full_size_chess_set.glb');

      // build a cache of normalized clones per piece type + color so ghost and piece share same object
      const clones = useMemo(() => {
        const map = {};
        const modelMap = { R: rookGltf, N: knightGltf, B: bishopGltf, K: kingGltf, Q: queenGltf, p: pawnGltf };
        ['white','#615c5c'].forEach((colorHex) => {
          Object.keys(modelMap).forEach((t) => {
            try {
              const c = cloneAndColor(modelMap[t], colorHex);
              map[`${t}-${colorHex}`] = c;
            } catch (err) {}
          });
        });
        return map;
      }, [kingGltf, pawnGltf, knightGltf, bishopGltf, rookGltf, queenGltf]);
      

      // build initial pieces list (logical coords)
      function getInitialPieces() {
        const levels = [0, 1, 2, 3]; // logical levels
        const res = [];
        let id = 1;
        levels.forEach((lz) => {
          for (let row = 0; row < 4; row++) {
            res.push({ id: id++, x: 1, y: row, z: lz, t: 'p', color: 'black', hasMoved: false });
            res.push({ id: id++, x: 6, y: row, z: lz, t: 'p', color: 'white', hasMoved: false });
          }
        });

        const placements = [
          { x: 0, y: 0, z: 0, t: 'R' },
          { x: 0, y: 1, z: 0, t: 'N' },
          { x: 0, y: 2, z: 0, t: 'B' },
          { x: 0, y: 3, z: 0, t: 'R' },
          { x: 0, y: 0, z: 1, t: 'B' },
          { x: 0, y: 1, z: 1, t: 'K' },
          { x: 0, y: 2, z: 1, t: 'Q' },
          { x: 0, y: 3, z: 1, t: 'N' },
          { x: 0, y: 0, z: 2, t: 'N' },
          { x: 0, y: 1, z: 2, t: 'Q' },
          { x: 0, y: 2, z: 2, t: 'K' },
          { x: 0, y: 3, z: 2, t: 'B' },
          { x: 0, y: 0, z: 3, t: 'R' },
          { x: 0, y: 1, z: 3, t: 'B' },
          { x: 0, y: 2, z: 3, t: 'N' },
          { x: 0, y: 3, z: 3, t: 'R' },
        ];
        placements.forEach((p) => {
          res.push({ id: id++, x: p.x, y: p.y, z: p.z, t: p.t, color: 'black', hasMoved: false });
          res.push({ id: id++, x: 7 - p.x, y: p.y, z: p.z, t: p.t, color: 'white', hasMoved: false });
        });
        return res;
      }

      const [piecesState, setPiecesState] = useState(() => getInitialPieces());
      const prevPiecesRef = useRef(piecesState);

      // derive lastMove by diffing piecesState changes so it's always accurate
      useEffect(() => {
        try {
          const prev = prevPiecesRef.current || [];
          const curr = piecesState || [];
          // find moved piece(s)
          const moved = [];
          for (const c of curr) {
            const p = prev.find(pp => pp.id === c.id);
            if (!p) continue;
            if (p.x !== c.x || p.y !== c.y || p.z !== c.z) moved.push({ before: p, after: c });
          }
          if (moved.length === 1) {
            const mv = moved[0];
            if (mv.before.t === 'p' && Math.abs(mv.before.x - mv.after.x) === 2) {
              const lm = { id: mv.after.id, from: { x: mv.before.x, y: mv.before.y, z: mv.before.z }, to: { x: mv.after.x, y: mv.after.y, z: mv.after.z }, doubleStep: true };
              try { setLastMove(lm); console.log('lastMove derived', lm); } catch (e) {}
            } else {
              try { setLastMove(null); } catch (e) {}
            }
          } else {
            try { setLastMove(null); } catch (e) {}
          }
          prevPiecesRef.current = curr.map(c => ({ ...c }));
        } catch (e) {}
      }, [piecesState, setLastMove]);

      // Debug: log entire piecesState and currentTurn when pieces change (helps track unexpected state)
      useEffect(() => {
        try {
          console.debug('piecesState changed. count:', piecesState.length, 'currentTurn:', currentTurn);
        } catch (e) {}
      }, [piecesState, currentTurn]);

      // compute check / checkmate / double-check status whenever board or turn changes
      useEffect(() => {
        try {
          const whiteInCheck = isAnyKingInCheck(piecesState, 'white');
          const blackInCheck = isAnyKingInCheck(piecesState, 'black');
          if (whiteInCheck && blackInCheck) {
            // find attackers for each king
            const whiteKings = piecesState.filter(p => p.t === 'K' && p.color === 'white');
            const blackKings = piecesState.filter(p => p.t === 'K' && p.color === 'black');
            const attackers = [];
            whiteKings.forEach(k => attackers.push(...attackersOfSquare(piecesState, k.x, k.y, k.z)));
            blackKings.forEach(k => attackers.push(...attackersOfSquare(piecesState, k.x, k.y, k.z)));
            const uniqueAttackers = Array.from(new Map(attackers.map(a => [a.id, a])).values());
            const attackerColors = Array.from(new Set(uniqueAttackers.map(a => a.color)));
            if (uniqueAttackers.length > 0 && attackerColors.length === 1) {
              // single-color attacker(s)
              const attackColor = attackerColors[0];
              const capturePossible = canAnyPieceCaptureAttackers(piecesState, uniqueAttackers);
              if (!capturePossible) {
                setGameOver(true);
                setGameWinner(attackColor);
                setStatusMessage(`Double-check: ${attackColor} wins`);
                return;
              }
            }
            // otherwise show check message for both, but don't end game
            setGameOver(false);
            setGameWinner(null);
            setStatusMessage('Double-check');
            return;
          }
          // determine if the side to move is in checkmate
          const sideToMove = currentTurn;
          const sideInCheck = isAnyKingInCheck(piecesState, sideToMove);
          const hasMove = hasAnyLegalMove(piecesState, sideToMove);
          if (sideInCheck && !hasMove) {
            setGameOver(true);
            const winner = sideToMove === 'white' ? 'black' : 'white';
            setGameWinner(winner);
            setStatusMessage(`Checkmate: ${winner} wins`);
            return;
          }
          // normal check notification
          if (whiteInCheck || blackInCheck) {
            if (whiteInCheck) setStatusMessage('Check: white');
            else setStatusMessage('Check: black');
            setGameOver(false);
            setGameWinner(null);
            return;
          }
          // clear status
          setStatusMessage('');
          setGameOver(false);
          setGameWinner(null);
        } catch (e) {}
      }, [piecesState, currentTurn]);

      // camera / controls persistence
      const controlsRef = useRef();
      // prefer explicit saved defaults if present; otherwise fall back to last-used camPos
      const [camPos, setCamPos] = useState(() => {
        try {
          return JSON.parse(localStorage.getItem('camDefaultPos')) || JSON.parse(localStorage.getItem('camPos')) || [6, 5, -8];
        } catch { return [6,5,-8]; }
      });
      const [camTarget, setCamTarget] = useState(() => {
        try {
          return JSON.parse(localStorage.getItem('camDefaultTarget')) || JSON.parse(localStorage.getItem('camTarget')) || [0, 1.7, 0];
        } catch { return [0,1.7,0]; }
      });

      useEffect(() => {
        // apply saved target to controls when they mount
        if (controlsRef.current) {
          const c = controlsRef.current;
          if (c.target && Array.isArray(camTarget)) {
            c.target.set(camTarget[0], camTarget[1], camTarget[2]);
            c.update();
          }
          // ensure camera position if accessible
          if (c.object && Array.isArray(camPos)) {
            c.object.position.set(camPos[0], camPos[1], camPos[2]);
          }
        }
      }, [controlsRef, camPos, camTarget]);

      // keep OrbitControls enabled state in sync with pointer interaction/dragging
      useEffect(() => {
        try {
          if (controlsRef.current) {
            controlsRef.current.enabled = !pointerActive && !isDragging;
          }
        } catch (e) {}
      }, [pointerActive, isDragging, controlsRef]);



      return (
        <>
        <div className="layout">
          <aside className="sidebar">
            <h2 className="title">Quadlevel 3D Chess</h2>
            <div className="menu">
              <button className="menu-button" onClick={() => setAiSide('white')}>
                Play AI White
              </button>
              <button className="menu-button" onClick={() => setAiSide('black')}>
                Play AI Black
              </button>
            </div>
            <div className="status">AI playing: {aiSide || 'none'}</div>
            <div className="status">Status: {statusMessage || 'none'}</div>
            <div className="status">Game Over: {gameOver ? `yes — ${gameWinner || 'unknown'}` : 'no'}</div>
            <div className="status">Last double-step: {lastMove ? `to [${lastMove.to.x},${lastMove.to.y},${lastMove.to.z}] id:${lastMove.id}` : 'none'}</div>
          </aside>
          <main className="main">
            <Canvas
              className="canvas"
              camera={{ position: camPos, fov: 32 }}
              onPointerMove={(e) => {
                // if pointer was pressed on a piece and user moved enough (screen-space), start dragging
                if (pointerDownRef.current && !isDragging && selectedPieceId != null && pointerStartScreenRef.current) {
                  const dx = e.clientX - pointerStartScreenRef.current.x;
                  const dy = e.clientY - pointerStartScreenRef.current.y;
                  const dist = Math.hypot(dx, dy);
                  // pixel threshold for consistent drag start across depths
                  if (dist > 6) {
                    setIsDragging(true);
                    // clear pending click-on-same-piece because we've started a drag
                    try { pointerDownPieceRef.current = null; } catch {}
                    try { if (controlsRef.current) controlsRef.current.enabled = false; } catch {}
                  }
                }
                // update drag point while pointer is down (so piece follows cursor immediately) or when dragging
                if (pointerDownRef.current || isDragging) {
                  // compute world point for ghost: prefer e.point (hit), otherwise raycast from camera to horizontal plane at dragHeight
                  let worldPoint = null;
                  // Prefer event point/ray; otherwise build ray from event.camera or controls camera
                  try {
                    if (e.point) {
                      worldPoint = new THREE.Vector3(e.point.x, e.point.y, e.point.z);
                      console.debug('used e.point');
                    } else if (pointerDepthRef && pointerDepthRef.current != null) {
                      // use stored clip-space depth to unproject mouse to world
                      try {
                        const canvas = document.querySelector('canvas');
                        if (canvas) {
                          const rect = canvas.getBoundingClientRect();
                          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                          const nz = pointerDepthRef.current;
                          const cam = e.camera || (controlsRef && controlsRef.current && controlsRef.current.object);
                            if (cam) {
                            const v = new THREE.Vector3(nx, ny, nz).unproject(cam);
                            worldPoint = v;
                            console.debug('used depth-unproject');
                          }
                        }
                      } catch (err) {}
                    } else {
                      const ray = e.ray;
                      let ro, rd;
                        if (ray) {
                        ro = ray.origin;
                        rd = ray.direction;
                        console.debug('used e.ray');
                      } else {
                        const cam = e.camera || (controlsRef.current && controlsRef.current.object);
                        if (cam && document.querySelector('canvas')) {
                          const canvas = document.querySelector('canvas');
                          const rect = canvas.getBoundingClientRect();
                          const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                          const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                          const rc = new THREE.Raycaster();
                          rc.setFromCamera(new THREE.Vector2(x, y), cam);
                          ro = rc.ray.origin;
                          rd = rc.ray.direction;
                          console.debug('used camera raycaster');
                        }
                      }
                      if (ro && rd) {
                        const planeY = dragHeight;
                        if (Math.abs(rd.y) > 1e-6) {
                          const t = (planeY - ro.y) / rd.y;
                          console.debug(`t=${t.toFixed(3)}`);
                          if (t > 0.001 && t < 200) {
                            worldPoint = new THREE.Vector3().copy(rd).multiplyScalar(t).add(ro);
                          } else {
                            // fallback: compute intersection using unproject(near/far) to avoid negative/behind-camera t issues
                            try {
                              if (document.querySelector('canvas')) {
                                const canvas = document.querySelector('canvas');
                                const rect = canvas.getBoundingClientRect();
                                const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                                const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                                const nearV = new THREE.Vector3(nx, ny, -1).unproject(e.camera || (controlsRef.current && controlsRef.current.object));
                                const farV = new THREE.Vector3(nx, ny, 1).unproject(e.camera || (controlsRef.current && controlsRef.current.object));
                                const denom = farV.y - nearV.y;
                                if (Math.abs(denom) > 1e-6) {
                                  const u = (planeY - nearV.y) / denom;
                                  console.debug(`fallback u=${u.toFixed(3)}`);
                                  worldPoint = new THREE.Vector3().copy(nearV).lerp(farV, u);
                                }
                              }
                            } catch (err) { }
                            }
                          }
                        }
                      }
                    } catch (err) {
                    console.debug('ray compute error');
                  }

                  if (worldPoint) {
                    setDragPointWorld([worldPoint.x, worldPoint.y, worldPoint.z]);
                    if (groupRef.current) {
                      const v = worldPoint.clone();
                      groupRef.current.worldToLocal(v);
                      // use the transformed local y directly and add small offset to avoid z-fighting
                      v.y = v.y + 0.02;
                      setDragPoint([v.x, v.y, v.z]);
                    } else {
                      setDragPoint([worldPoint.x / sceneScale, dragHeight + 0.02, worldPoint.z / sceneScale]);
                    }
                  }
                }
              }}
              onPointerUp={(e) => {
                // if we were dragging, send the last world point for drop processing
                if (isDragging && dragPointWorld) {
                  setPendingDrop(dragPointWorld);
                }
                // if pointer up and it was NOT a drag, and we started the press on a piece, treat as click toggle
                if (!isDragging && pointerDownPieceRef.current) {
                  try {
                    const pid = pointerDownPieceRef.current;
                    if (pointerDownWasSelectedRef.current) {
                      // toggle when user pressed the already-selected piece
                      if (selectedPieceId === pid) setSelectedPieceId(null);
                      else setSelectedPieceId(pid);
                    } else {
                      // user pressed a different piece: ensure it is selected
                      if (selectedPieceId !== pid) setSelectedPieceId(pid);
                    }
                  } catch (err) {}
                }
                // release drag anywhere
                pointerDownRef.current = false;
                try { pointerDownPieceRef.current = null; pointerDownWasSelectedRef.current = false; } catch {}
                pointerStartRef.current = null;
                try { pointerStartScreenRef.current = null; } catch {}
                try { if (pointerDepthRef) pointerDepthRef.current = null; } catch {}
                setIsDragging(false);
                setDragPointWorld(null);
                setPointerActive(false);
                // always re-enable controls on pointer up
                try { if (controlsRef.current) controlsRef.current.enabled = true; } catch {}
              }}
            >
              <ambientLight intensity={0.6} />
              <directionalLight position={[5, 12, 5]} intensity={0.9} />
              <group ref={groupRef} scale={sceneScale}>
                <QuadLevelBoard />
                <Pieces
                  piecesState={piecesState}
                  setPiecesState={setPiecesState}
                  selectedPieceId={selectedPieceId}
                  setSelectedPieceId={setSelectedPieceId}
                  isDragging={isDragging}
                  dragPoint={dragPoint}
                  setIsDragging={setIsDragging}
                  setDragPoint={setDragPoint}
                  dragPointWorld={dragPointWorld}
                  setDragPointWorld={setDragPointWorld}
                  setPointerActive={setPointerActive}
                  controlsRef={controlsRef}
                  pointerDownRef={pointerDownRef}
                  pointerStartRef={pointerStartRef}
                  pointerDepthRef={pointerDepthRef}
                   kingGltf={kingGltf}
                   pawnGltf={pawnGltf}
                   knightGltf={knightGltf}
                   bishopGltf={bishopGltf}
                   rookGltf={rookGltf}
                   queenGltf={queenGltf}
                   clones={clones}
                  pointerDownPieceRef={pointerDownPieceRef}
                  pointerStartScreenRef={pointerStartScreenRef}
                  pendingDrop={pendingDrop}
                  setPendingDrop={setPendingDrop}
                  groupRef={groupRef}
                  setDragHeight={setDragHeight}
                  sceneScale={sceneScale}
                  currentTurn={currentTurn}
                  setCurrentTurn={setCurrentTurn}
                  lastMove={lastMove}
                    setLastMove={setLastMove}
                    pointerDownWasSelectedRef={pointerDownWasSelectedRef}
                    gameOver={gameOver}
                />
                <Ghost dragPoint={dragPoint} dragPointWorld={dragPointWorld} selectedPieceId={selectedPieceId} piecesState={piecesState} isDragging={isDragging} pointerDownRef={pointerDownRef} kingGltf={kingGltf} pawnGltf={pawnGltf} knightGltf={knightGltf} bishopGltf={bishopGltf} rookGltf={rookGltf} queenGltf={queenGltf} clones={clones} />
                
              </group>
                
              <OrbitControls
                ref={controlsRef}
                makeDefault
                enablePan={false}
                enableDamping={true}
                dampingFactor={0.08}
                rotateSpeed={0.45}
                zoomSpeed={0.6}
                target={camTarget}
                onEnd={() => {
                  // persist camera and target when user finishes interacting
                  const c = controlsRef.current;
                  if (!c) return;
                  const cam = c.object;
                  if (cam) {
                    const pos = [cam.position.x, cam.position.y, cam.position.z];
                    setCamPos(pos);
                    try { localStorage.setItem('camPos', JSON.stringify(pos)); } catch {}
                  }
                  if (c.target) {
                    const tgt = [c.target.x, c.target.y, c.target.z];
                    setCamTarget(tgt);
                    try { localStorage.setItem('camTarget', JSON.stringify(tgt)); } catch {}
                  }
                }}
              />
            </Canvas>
          </main>
        </div>
        
        </>
      );
    }
//                setCamTarget(tgt);
  //              try { localStorage.setItem('camTarget', JSON.stringify(tgt)); } catch {}
    //          }
      //      }}
        //  />
        //</Canvas>
      //</main>
    //</div>
  //);
//}
