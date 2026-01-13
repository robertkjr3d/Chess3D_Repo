import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function Square({ position, color }) {
  return (
    <mesh position={position}>
      <boxGeometry args={[1, 0.15, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function BoardLevel({ y }) {
  const squares = [];
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 4; z++) {
      const isWhite = (x + z) % 2 === 0;
      squares.push(
        <Square
          key={`${y}-${x}-${z}`}
          position={[x - 3.5, y, z - 3.5]}
          color={isWhite ? "#f0d9b5" : "#b58863"}
        />
      );
    }
  }
  return <group>{squares}</group>;
}

function QuadLevelBoard() {
  return (
    <group>
      <BoardLevel y={0} />
      <BoardLevel y={3.725} />
      <BoardLevel y={6.6} />
      <BoardLevel y={8.75} />
    </group>
  );
}

export default function App() {
  return (
  <div style={{ width: "100vw", height: "100vh" }}>
    <Canvas camera={{ position: [6, 5, -8], fov: 32 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 12, 5]} intensity={0.9} />
      <group scale={0.470}>
        <QuadLevelBoard />
      </group>
      <OrbitControls
		makeDefault
        enablePan={false}
        target={[0, 1.7, 0]}
      />
    </Canvas>
  </div>
  );
}
