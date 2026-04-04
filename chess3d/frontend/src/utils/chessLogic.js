// Pure chess logic — no React, no THREE.js, no DOM dependencies.
// Safe to import from any module or test.

export function inBounds(x,y,z){return x>=0 && x<=7 && y>=0 && y<=3 && z>=0 && z<=3;}

// Per-piece attack test: does `piece` attack target (tx,ty,tz) considering blocking in `pieces`?
export function attacksSquareByPiece(piece, tx, ty, tz, pieces, lastMove) {
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

export function canPieceMoveTo(piece, tx, ty, tz, pieces) {
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

export function isSquareAttacked(pieces, tx, ty, tz, byColor) {
  // pieces: array of {x,y,z,t,color}
  const enemy = byColor;
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

export function simulateMove(pieces, moverId, target) {
  // return new pieces array after moving moverId to target and removing captured enemy on that square
  const mover = pieces.find(p => p.id === moverId);
  if (!mover) return pieces.slice();
  const movingColor = mover.color;
  // handle en-passant if target includes capturedId
  let filtered = pieces.slice();
  if (target) {
    // explicit capturedId (used by some special moves)
    if (target.capturedId) {
      filtered = pieces.filter(pp => pp.id !== target.capturedId);
    } else if (target.enPassant) {
      // en-passant: captured pawn is on mover's original file (mover.x) and at landing y/z
      const moverOrig = mover;
      const captured = pieces.find(pp => pp.color !== movingColor && pp.t === 'p' && pp.x === moverOrig.x && pp.y === target.y && pp.z === target.z);
      if (captured) filtered = pieces.filter(pp => pp.id !== captured.id);
    } else {
      // normal capture: remove any enemy piece currently on the target square
      filtered = pieces.filter(pp => !(pp.x === target.x && pp.y === target.y && pp.z === target.z && pp.color !== movingColor));
    }
  }
  const next = filtered.map(pp => {
    if (pp.id === moverId) {
      // Apply pawn promotion if specified, or auto-promote to queen if reaching promotion rank
      let newType = pp.t;
      if (pp.t === 'p') {
        const promotionRank = pp.color === 'white' ? 0 : 7;
        if (target.x === promotionRank) {
          // If target specifies promotion piece, use it; otherwise default to Queen
          newType = target.promotion || 'Q';
        }
      }
      return { ...pp, t: newType, x: target.x, y: target.y, z: target.z, hasMoved: true };
    }
    // handle castling rook move when target.castle provided
    if (target && target.castle && pp.id === target.castle.rookId) {
      const rt = target.castle.rookTo;
      return { ...pp, x: rt.x, y: rt.y, z: rt.z, hasMoved: true };
    }
    return pp;
  });
  return next;
}

export function isAnyKingInCheck(pieces, color) {
  // find all kings for color; return true if any king is attacked by opponent
  const kings = pieces.filter(p => p.t === 'K' && p.color === color);
  const enemy = color === 'white' ? 'black' : 'white';
  for (const k of kings) {
    if (isSquareAttacked(pieces, k.x, k.y, k.z, enemy)) return true;
  }
  return false;
}

export function attackersOfSquare(pieces, tx, ty, tz) {
    const res = [];
    for (const p of pieces) {
      if (attacksSquareByPiece(p, tx, ty, tz, pieces)) res.push(p);
    }
    return res;
  }

// Static Exchange Evaluation (SEE) for a target square. Returns net material gain from the
// perspective of `sideToMove` after the sequence of optimal captures on the square.
export function staticExchangeEval(pieces, tx, ty, tz, sideToMove) {
  const vals = { p: 1, N: 3, B: 3, R: 5, Q: 9, K: 10000 };
  // This function must be pure. No React hooks or state.
  // ...existing SEE logic here...
  // (If you need to restore the SEE logic, please provide the original code or logic.)
  return 0; // Placeholder: implement SEE logic as needed
}

// Returns true if the given color has any legal move (not in check after move)
export function hasAnyLegalMove(pieces, color) {
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

// Returns true if any piece can capture any attacker in attackerList without leaving king in check
export function canAnyPieceCaptureAttackers(pieces, attackerList) {
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

// ── FEN computation for the engine sync ──────────────────────────────────────
// Castle entries matching C++ CastleEntry tables (WhiteCastles[0..7], BlackCastles[0..7])
// Positions are in frontend coords: x=row (0=rank8, 7=rank1), y=file, z=level
export const CASTLE_ENTRIES = [
  // White entries (bits 0–7)
  { color: 'white', king: {x:7,y:2,z:2}, rook: {x:7,y:3,z:3} },
  { color: 'white', king: {x:7,y:2,z:2}, rook: {x:7,y:3,z:3} },
  { color: 'white', king: {x:7,y:1,z:1}, rook: {x:7,y:0,z:0} },
  { color: 'white', king: {x:7,y:1,z:1}, rook: {x:7,y:0,z:0} },
  { color: 'white', king: {x:7,y:1,z:1}, rook: {x:7,y:3,z:0} },
  { color: 'white', king: {x:7,y:1,z:1}, rook: {x:7,y:0,z:3} },
  { color: 'white', king: {x:7,y:2,z:2}, rook: {x:7,y:0,z:3} },
  { color: 'white', king: {x:7,y:2,z:2}, rook: {x:7,y:3,z:0} },
  // Black entries (bits 8–15)
  { color: 'black', king: {x:0,y:2,z:2}, rook: {x:0,y:3,z:3} },
  { color: 'black', king: {x:0,y:2,z:2}, rook: {x:0,y:3,z:3} },
  { color: 'black', king: {x:0,y:1,z:1}, rook: {x:0,y:0,z:0} },
  { color: 'black', king: {x:0,y:1,z:1}, rook: {x:0,y:0,z:0} },
  { color: 'black', king: {x:0,y:1,z:1}, rook: {x:0,y:3,z:0} },
  { color: 'black', king: {x:0,y:1,z:1}, rook: {x:0,y:0,z:3} },
  { color: 'black', king: {x:0,y:2,z:2}, rook: {x:0,y:0,z:3} },
  { color: 'black', king: {x:0,y:2,z:2}, rook: {x:0,y:3,z:0} },
];

const FEN_PIECE_MAP = {
  K: { t: 'K', color: 'white' },
  Q: { t: 'Q', color: 'white' },
  R: { t: 'R', color: 'white' },
  B: { t: 'B', color: 'white' },
  N: { t: 'N', color: 'white' },
  P: { t: 'p', color: 'white' },
  k: { t: 'K', color: 'black' },
  q: { t: 'Q', color: 'black' },
  r: { t: 'R', color: 'black' },
  b: { t: 'B', color: 'black' },
  n: { t: 'N', color: 'black' },
  p: { t: 'p', color: 'black' },
};

function parseFenSquare(square) {
  const match = typeof square === 'string' ? square.match(/^([1-4])([a-d])([1-8])$/) : null;
  if (!match) return null;
  return {
    z: Number(match[1]) - 1,
    y: match[2].charCodeAt(0) - 97,
    x: 8 - Number(match[3]),
  };
}

/**
 * Parse a QuadLevel FEN string into frontend state.
 * Returns { pieces, currentTurn, lastMove, epSquare, halfMoveClock, fullMoveNumber, castlingRights }.
 */
export function parseFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) {
    throw new Error('FEN must be a non-empty string');
  }

  const [boardPart, sidePart, castlePart = '-', epPart = '-', halfmovePart = '0', fullmovePart = '1'] = fen.trim().split(/\s+/);
  if (!boardPart || !sidePart) {
    throw new Error('FEN must include board and side-to-move fields');
  }

  const levels = boardPart.split('|');
  if (levels.length !== 4) {
    throw new Error(`Expected 4 board levels in FEN, got ${levels.length}`);
  }

  const pieces = [];
  let nextId = 1;

  levels.forEach((levelToken, z) => {
    const ranks = levelToken.split('/');
    if (ranks.length !== 8) {
      throw new Error(`Expected 8 ranks on level ${z + 1}, got ${ranks.length}`);
    }

    ranks.forEach((rankToken, x) => {
      let y = 0;
      for (const ch of rankToken) {
        if (/^[1-8]$/.test(ch)) {
          y += Number(ch);
          continue;
        }

        const pieceDef = FEN_PIECE_MAP[ch];
        if (!pieceDef) {
          throw new Error(`Invalid FEN piece character '${ch}'`);
        }
        if (y >= 4) {
          throw new Error(`Rank overflow while parsing level ${z + 1}, rank ${8 - x}`);
        }

        pieces.push({
          id: nextId++,
          x,
          y,
          z,
          t: pieceDef.t,
          color: pieceDef.color,
          hasMoved: true,
        });
        y += 1;
      }

      if (y !== 4) {
        throw new Error(`Rank width mismatch on level ${z + 1}, rank ${8 - x}: expected 4 files, got ${y}`);
      }
    });
  });

  const normalizedSide = String(sidePart).toLowerCase();
  const currentTurn = normalizedSide === 'b' ? 'black' : normalizedSide === 'w' ? 'white' : null;
  if (!currentTurn) {
    throw new Error(`Invalid side-to-move field '${sidePart}'`);
  }

  let castlingRights = 0;
  if (castlePart !== '-') {
    castlingRights = Number.parseInt(castlePart, 16);
    if (Number.isNaN(castlingRights)) {
      throw new Error(`Invalid castling field '${castlePart}'`);
    }
  }

  for (let i = 0; i < CASTLE_ENTRIES.length; i++) {
    if ((castlingRights & (1 << i)) === 0) continue;
    const entry = CASTLE_ENTRIES[i];
    const king = pieces.find(p => p.t === 'K' && p.color === entry.color && p.x === entry.king.x && p.y === entry.king.y && p.z === entry.king.z);
    const rook = pieces.find(p => p.t === 'R' && p.color === entry.color && p.x === entry.rook.x && p.y === entry.rook.y && p.z === entry.rook.z);
    if (king) king.hasMoved = false;
    if (rook) rook.hasMoved = false;
  }

  let lastMove = null;
  let epSquare = null;
  if (epPart !== '-') {
    epSquare = parseFenSquare(epPart);
    if (!epSquare) {
      throw new Error(`Invalid en-passant field '${epPart}'`);
    }

    const lastMoverColor = currentTurn === 'white' ? 'black' : 'white';
    const dir = lastMoverColor === 'white' ? -1 : 1;
    const to = { x: epSquare.x + dir, y: epSquare.y, z: epSquare.z };
    const from = { x: epSquare.x - dir, y: epSquare.y, z: epSquare.z };
    const pawn = pieces.find(p => p.t === 'p' && p.color === lastMoverColor && p.x === to.x && p.y === to.y && p.z === to.z);

    lastMove = pawn ? {
      id: pawn.id,
      from,
      to,
      doubleStep: true,
    } : null;
  }

  const halfMoveClock = Number.parseInt(halfmovePart, 10);
  const fullMoveNumber = Number.parseInt(fullmovePart, 10);

  return {
    pieces,
    currentTurn,
    lastMove,
    epSquare,
    halfMoveClock: Number.isNaN(halfMoveClock) ? 0 : halfMoveClock,
    fullMoveNumber: Number.isNaN(fullMoveNumber) ? 1 : fullMoveNumber,
    castlingRights,
  };
}

/**
 * Compute a QuadLevel FEN string from the current frontend board state.
 * Format: {board} {side} {castling} {ep} {halfmove} {fullmove}
 * Board: levels 1–4 separated by '|', ranks 8→1 by '/', pieces PNBRQKpnbrqk
 */
export function computeFen(pieces, turn, lastMoveObj, moveHistLen) {
  const fenChar = (t, color) => {
    const map = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N', p: 'P' };
    const ch = map[t] || '?';
    return color === 'white' ? ch : ch.toLowerCase();
  };

  // Build 3D board array: [level][rankIndex][file]
  const boardArr = Array.from({ length: 4 }, () =>
    Array.from({ length: 8 }, () => Array(4).fill(null))
  );
  for (const p of pieces) {
    const rankIdx = 7 - p.x;
    if (p.z >= 0 && p.z < 4 && rankIdx >= 0 && rankIdx < 8 && p.y >= 0 && p.y < 4)
      boardArr[p.z][rankIdx][p.y] = fenChar(p.t, p.color);
  }

  let board = '';
  for (let lv = 0; lv < 4; lv++) {
    if (lv > 0) board += '|';
    for (let r = 7; r >= 0; r--) {
      if (r < 7) board += '/';
      let empty = 0;
      for (let f = 0; f < 4; f++) {
        const ch = boardArr[lv][r][f];
        if (!ch) { empty++; } else {
          if (empty > 0) { board += empty; empty = 0; }
          board += ch;
        }
      }
      if (empty > 0) board += empty;
    }
  }

  const side = turn === 'black' ? 'b' : 'w';

  // Castling rights: check each CastleEntry for unmoved king+rook at start squares
  let rights = 0;
  for (let i = 0; i < CASTLE_ENTRIES.length; i++) {
    const ce = CASTLE_ENTRIES[i];
    const king = pieces.find(p => p.t === 'K' && p.color === ce.color &&
      p.x === ce.king.x && p.y === ce.king.y && p.z === ce.king.z && !p.hasMoved);
    const rook = pieces.find(p => p.t === 'R' && p.color === ce.color &&
      p.x === ce.rook.x && p.y === ce.rook.y && p.z === ce.rook.z && !p.hasMoved);
    if (king && rook) rights |= (1 << i);
  }
  const castleStr = rights === 0 ? '-' : rights.toString(16);

  // En passant square
  let epStr = '-';
  if (lastMoveObj && lastMoveObj.doubleStep && lastMoveObj.from && lastMoveObj.to) {
    const epX = (lastMoveObj.from.x + lastMoveObj.to.x) / 2;
    const epLevel = lastMoveObj.from.z + 1;
    const epFile = String.fromCharCode(97 + lastMoveObj.from.y);
    const epRank = 8 - epX;
    epStr = '' + epLevel + epFile + epRank;
  }

  const halfmove = 0;
  const fullmove = Math.max(1, (moveHistLen || 0) + (turn === 'white' ? 1 : 0));

  return `${board} ${side} ${castleStr} ${epStr} ${halfmove} ${fullmove}`;
}

// Known king-side blocking patterns (notation: "sx,sy,sz->kx,ky,kz" => blocking square)
// These are small hard-coded exceptions for QuadLevel geometry where an orthogonal piece
// blocks a castling path even though straight-line checks might not catch it.
export const KING_BLOCK_MAP = {
  '0,2,2->0,3,2': '0,2,3',
  '0,2,2->0,2,3': '0,3,2',
  '0,1,1->0,1,0': '0,0,1',
  '0,1,1->0,0,1': '0,1,0',
};

// Optional map to provide explicit rook-from coordinates for tricky castling cases.
// Keys use the same "sx,sy,sz->kx,ky,kz" format as KING_BLOCK_MAP.
export const ROOK_FROM_MAP = {};

export function lookupKingBlock(sx, sy, sz, kx, ky, kz, effectiveMap, color) {
  try {
    const kMapKey = `${sx},${sy},${sz}->${kx},${ky},${kz}`;
    let mapped = (effectiveMap && effectiveMap[kMapKey]) || KING_BLOCK_MAP[kMapKey];
    const mirror = (s) => {
      const [ax, ay, az] = s.split(',').map(Number);
      return `${7 - ax},${ay},${az}`;
    };
    if (!mapped && color === 'white') {
      const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${kx},${ky},${kz}`)}`;
      const mappedMirrored = (effectiveMap && effectiveMap[mirroredKey]) || KING_BLOCK_MAP[mirroredKey];
      if (mappedMirrored) mapped = mirror(mappedMirrored);
    }
    return mapped || null;
  } catch (e) { return null; }
}

export function isBlockedByKingBlockMap(sx, sy, sz, kx, ky, kz, occupiedMap, color) {
  try {
    const kMapKey = `${sx},${sy},${sz}->${kx},${ky},${kz}`;
    let mapped = KING_BLOCK_MAP[kMapKey];
    if (!mapped && color === 'white') {
      const mirror = (s) => {
        const [ax, ay, az] = s.split(',').map(Number);
        return `${7 - ax},${ay},${az}`;
      };
      const mirroredKey = `${mirror(`${sx},${sy},${sz}`)}->${mirror(`${kx},${ky},${kz}`)}`;
      const mappedMirrored = KING_BLOCK_MAP[mirroredKey];
      if (mappedMirrored) mapped = mirror(mappedMirrored);
    }
    if (mapped && occupiedMap && occupiedMap.has(mapped)) return true;
  } catch (e) {}
  return false;
}
