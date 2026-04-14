import { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { getLevelY } from '../utils/constants';

// Returns a board X-scale that shrinks on smaller screens and grows on 4K screens.
// Range: 0.50 (≤480 px) → 0.62 (768 px) → 0.78 (≥2560 px wide), linearly interpolated.
export function useBoardXScale() {
  const compute = () => {
    const w = window.innerWidth;
    if (w <= 480) return 0.50;  // narrow phones (S8+): boards fit within portrait viewport
    if (w <= 768) return 0.62;
    if (w >= 2560) return 0.78;
    return 0.62 + (0.78 - 0.62) * (w - 768) / (2560 - 768);
  };
  const [xs, setXs] = useState(compute);
  useEffect(() => {
    const onResize = () => setXs(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return xs;
}

function Square({ position, color, xs, highlight }) {
  // Create a parallelogram-shaped square matching the board's shear angle
  const geometry = useMemo(() => {
    const shear = 0.475; // Shear factor matching board layout
    const geo = new THREE.BufferGeometry();
    // Parallelogram vertices: back edge straight, front edge sheared
    const positions = new Float32Array([
      // Bottom face (y = -0.075)
      -0.5*xs, -0.075, -0.5,                    // 0: back-left
      0.5*xs, -0.075, -0.5,                     // 1: back-right
      (0.5 + shear)*xs, -0.075, 0.475,           // 2: front-right (sheared)
      (-0.5 + shear)*xs, -0.075, 0.5,           // 3: front-left (sheared)
      // Top face (y = 0.075)
      -0.5*xs, 0.075, -0.5,                     // 4: back-left
      0.5*xs, 0.075, -0.5,                      // 5: back-right
      (0.5 + shear)*xs, 0.075, 0.475,            // 6: front-right (sheared)
      (-0.5 + shear)*xs, 0.075, 0.475            // 7: front-left (sheared)
    ]);
    const indices = new Uint16Array([
      // Bottom face
      0, 1, 2, 0, 2, 3,
      // Top face
      4, 6, 5, 4, 7, 6,
      // Back face
      0, 4, 5, 0, 5, 1,
      // Front face
      2, 6, 7, 2, 7, 3,
      // Left face
      0, 3, 7, 0, 7, 4,
      // Right face
      1, 5, 6, 1, 6, 2
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [xs]);

  return (
    <mesh position={position} geometry={geometry}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function BoardLevel({ y, z, flip = false, flipBoard = false, lastMove, hintSquares }) {
  const xs = useBoardXScale();
  const squares = [];
  for (let x = 0; x < 8; x++) {
    for (let row = 0; row < 4; row++) {
      const yIndex = 3 - row;
      const baseWhite = ((x + yIndex + (flip ? 1 : 0)) % 2) !== 0;
      const isWhite = flipBoard ? !baseWhite : baseWhite;
      const shearFactor = 0.475;
      const worldX = (x + yIndex * shearFactor - 4.1) * xs;
      const worldZ = yIndex;
      // Determine if this square should be highlighted
      let highlight = null;
      let color = isWhite ? "#f0d9b5" : "#b58863";
      if (lastMove && lastMove.from && lastMove.to) {
        // lastMove.from and lastMove.to are objects with x, y, z
        // Use x directly if flip is true, otherwise use (7-x)
        const boardX = flipBoard ? 7 - x : x;
        let isHighlight =
          (lastMove.from.x === boardX && lastMove.from.y === row && lastMove.from.z === z) ||
          (lastMove.to.x === boardX && lastMove.to.y === row && lastMove.to.z === z);

        // If castling, also highlight rook destination (mirror x, y, z for display if board is flipped)
        if (lastMove.castle && lastMove.castle.rookTo) {
          let rookToX = flipBoard ? (7 - lastMove.castle.rookTo.x) : lastMove.castle.rookTo.x;
          let rookToY = lastMove.castle.rookTo.y;
          let rookToZ = lastMove.castle.rookTo.z;
          if (
            rookToX === x &&
            rookToY === row &&
            rookToZ === z
          ) {
            isHighlight = true;
          }
        }
        if (isHighlight) {
          color = isWhite ? '#fff176' : '#f8d56d';
        }
      }
      // Hint squares: yellow highlight for suggested move (drawn over lastMove highlight)
      if (hintSquares && hintSquares.from && hintSquares.to) {
        const boardX = flipBoard ? 7 - x : x;
        const isHint =
          (hintSquares.from.x === boardX && hintSquares.from.y === row && hintSquares.from.z === z) ||
          (hintSquares.to.x === boardX && hintSquares.to.y === row && hintSquares.to.z === z);
        if (isHint) {
          color = isWhite ? '#fde047' : '#ca8a04';
        }
      }
      squares.push(
        <Square
          key={`${y}-${x}-${row}`}
          position={[worldX, y, worldZ]}
          color={color}
          xs={xs}
          highlight={highlight}
        />
      );
    }
  }
  return <group>{squares}</group>;
}

export function QuadLevelBoard({ flipBoard = false, lastMove, hintSquares }) {
  // render from bottom -> top for correct visual stacking
  const bottomToTop = getLevelY().slice().reverse();
  return (
    <group>
      {bottomToTop.map((y, i) => (
        <BoardLevel
          key={`lvl-${i}-${lastMove && lastMove.id ? lastMove.id : ''}`}
          y={y}
          z={3 - i} // pass logical z index (0 = top, 3 = bottom)
          flip={i % 2 === 0}
          flipBoard={flipBoard}
          lastMove={lastMove}
          hintSquares={hintSquares}
        />
      ))}
    </group>
  );
}
