import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from 'three';
//import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import "./App.css";
import { API_BASE_URL } from './config';
import {
  inBounds, attacksSquareByPiece, canPieceMoveTo, isSquareAttacked,
  simulateMove, isAnyKingInCheck, attackersOfSquare, staticExchangeEval,
  hasAnyLegalMove, canAnyPieceCaptureAttackers,
  CASTLE_ENTRIES,
  KING_BLOCK_MAP, ROOK_FROM_MAP, lookupKingBlock, isBlockedByKingBlockMap, parseFen,
} from './utils/chessLogic';
import { GLOBAL_PIECE_SCALE, PIECE_ASPECT_RATIO, GHOST_SCALE_FACTOR, DRAG_LEVEL_SCALE,
  MOVE_PIXEL_THRESH, MOVE_WORLD_THRESH, MOVE_HIT_RADIUS, PIECE_HIT_RADIUS, PIECE_HIT_DISC_Y,
  DRAG_PIXEL_THRESHOLD, getLevelY, LEVEL_Y, LEVEL_Y_MOBILE } from './utils/constants';
import { parsePuzzleText, puzzleMoveMatches } from './utils/puzzles';
import { DEFAULT_MATE_IN_TWO_PUZZLES_TEXT } from './data/mateInTwoPuzzles';
import { QuadLevelBoard } from './components/Board';
import { ShowPuzzleAnswer } from './components/ShowPuzzleAnswer';
import { cloneAndColor, CanvasLogger, Pieces, Ghost } from './components/Pieces';
import { createAiEngine } from './ai/engine';
import { useAiOrchestration } from './hooks/useAiOrchestration';


// â”€â”€ Zoom calibration formula â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Calibrated empirically from 25 screen-resolution data points.
// Mobile (w<=768): width-based lookup â€” 0% error on all known devices.
// Desktop: min(w,h) / (0.032*min(w,h) + 30) â€” max error Â±1.4 on calibration set.
function getCalcZoomDebugInfo(w, h) {
  if (w <= 768) {
    let base;
    let branch;
    if (w <= 344) {
      base = 12.3;
      branch = 'mobile<=344';
    } else if (w <= 360) {
      base = (h >= 780) ? 14.0 : 12.2;
      branch = (h >= 780) ? 'mobile<=360_tall' : 'mobile<=360_short';
    } else if (w <= 375) {
      base = 11.4;
      branch = 'mobile<=375';
    } else if (w <= 390) {
      base = 12.1;
      branch = 'mobile<=390';
    } else if (w <= 414) {
      base = 12.7;
      branch = 'mobile<=414';
    } else if (w <= 430) {
      base = 13.5;
      branch = 'mobile<=430';
    } else if (w <= 540) {
      base = 11.7;
      branch = 'mobile<=540';
    } else {
      base = 14.5;
      branch = 'mobile>540';
    }
    const rawBase = base;
    let corrected = false;
    let refH = null;
    if (h > 150 && !document.fullscreenElement) {
      refH = w * 1.5;
      if (h < refH) {
        base = Math.max(base * 0.85, base - (refH - h) * 0.014);
        corrected = true;
      }
    }
    return {
      mode: 'mobile',
      branch,
      rawBase,
      zoom: base,
      corrected,
      refH,
      width: w,
      height: h,
    };
  }
  const m = Math.min(w, h);
  const zoom = Math.round(m / (0.029 * m + 34.5) * 0.98 * 10) / 10;
  return {
    mode: 'desktop',
    branch: 'desktop_formula',
    rawBase: zoom,
    zoom,
    corrected: false,
    refH: null,
    width: w,
    height: h,
  };
}

function calcZoom(w, h) {
  return getCalcZoomDebugInfo(w, h).zoom;
}

function getQueryParams() {
  const params = {};
  window.location.search.replace(/[?&]+([^=&]+)=?([^&]*)?/gi, (match, key, value) => {
    params[decodeURIComponent(key)] = value !== undefined ? decodeURIComponent(value) : '';
    return match;
  });
  return params;
}


    export default function App() {
      const [currentTurn, setCurrentTurn] = useState('white');
      const [gameOver, setGameOver] = useState(false);
      const [gameWinner, setGameWinner] = useState(null);
      const [showGameOverModal, setShowGameOverModal] = useState(false);
      const [statusMessage, setStatusMessage] = useState('');
      const [halfMoveClock, setHalfMoveClock] = useState(0); // 50-move rule: resets on pawn move or capture
      const [repetitionCount, setRepetitionCount] = useState(0); // threefold repetition tracking
        const [lastMove, setLastMove] = useState(null); // track last move for en-passant (double-step)
      const [aiSide, setAiSide] = useState(null);
      // 'dumb' = JS negamax only | 'smart' = the engine depth 8 / 5s | 'smarter' = the engine depth 14 / 12s
      const [aiStrength, setAiStrength] = useState('smart');
      const aiStrengthRef = useRef('smart');
      useEffect(() => { aiStrengthRef.current = aiStrength; }, [aiStrength]);
      // Delay between AI moves in ms (visible on-screen for AI vs AI; also adds think-feel for human games)
      const [aiDelay, setAiDelay] = useState(1500);
      const aiDelayRef = useRef(1500);
      useEffect(() => { aiDelayRef.current = aiDelay; }, [aiDelay]);
      const [selectedPieceId, setSelectedPieceId] = useState(null);
      const [moveHistory, setMoveHistory] = useState([]); // array of { white: string|null, black: string|null }
      const [coordMoveHistory, setCoordMoveHistory] = useState([]); // flat array of raw coord strings e.g. "2d82c6" â€” sent to the engine backend
      const [canvasKey, setCanvasKey] = useState(0);
      const [gameMode, setGameMode] = useState('standard');
      const [puzzleSet, setPuzzleSet] = useState([]);
      const [puzzleIndex, setPuzzleIndex] = useState(0);
      const [puzzlePlayerSide, setPuzzlePlayerSide] = useState(null);
      const [puzzleAttempted, setPuzzleAttempted] = useState(false);
      const [puzzleSolved, setPuzzleSolved] = useState(false);
      const [puzzleStatus, setPuzzleStatus] = useState('');
      const defaultPuzzleSet = useMemo(() => parsePuzzleText(DEFAULT_MATE_IN_TWO_PUZZLES_TEXT), []);
      // Auto-show the game-over modal whenever the game ends.
      // Separated from gameOver so Dismiss closes the popup without re-enabling the AI.
      useEffect(() => {
        if (gameOver) setShowGameOverModal(true);
      }, [gameOver]);
      const [gameStarted, setGameStarted] = useState(false);
      const [isDragging, setIsDragging] = useState(false);
      const [dragPoint, setDragPoint] = useState([0, 0, 0]);
      const [dragHeight, setDragHeight] = useState(0);
      const [dragPointWorld, setDragPointWorld] = useState(null);
      const [castlePrompt, setCastlePrompt] = useState(null);
      const [promotionPrompt, setPromotionPrompt] = useState(null);
      
      // Mobile-friendly states
      const [showAllMoves, setShowAllMoves] = useState(false);
      const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
      const [mobileMenuOpen, setMobileMenuOpen] = useState(() => {
        const isMobileInit = window.innerWidth <= 480;
        return isMobileInit ? true : false;
      });

      // Fullscreen state
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = window.navigator.standalone === true;
      const [isFullscreen, setIsFullscreen] = useState(false);
      useEffect(() => {
        const onChange = () => {
          setIsFullscreen(!!document.fullscreenElement);
          // canvas size changes after fullscreen transition â€” recalculate zoom
          setTimeout(() => window.dispatchEvent(new Event('chess3d:resize')), 150);
          setTimeout(() => window.dispatchEvent(new Event('chess3d:resize')), 400);
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
      }, []);
      const toggleFullscreen = () => {
        if (isIOS) {
          if (!isStandalone) alert('On iPhone/iPad, tap the Share button âŽ‹ then "Add to Home Screen" to play full-screen.');
          return;
        }
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen && document.exitFullscreen();
        }
      };

      // Board flip state (when playing as black)
      const [boardFlipped, setBoardFlipped] = useState(false);
      
      // Sync boardFlipped with aiSide (flip when playing as black against AI white)
      useEffect(() => {
        if (gameMode === 'puzzle') {
          setBoardFlipped(puzzlePlayerSide === 'black');
          return;
        }
        if (aiSide === 'white') {
          setBoardFlipped(true);
        } else if (aiSide === 'black' || aiSide === null) {
          setBoardFlipped(false);
        }
      }, [aiSide, gameMode, puzzlePlayerSide]);
      
      // Detect mobile viewport
      useEffect(() => {
        const handleResize = () => {
          setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
      }, []);
      
      const [pendingDrop, setPendingDrop] = useState(null);
      const [pointerActive, setPointerActive] = useState(false);
      const pointerDownRef = useRef(false);
      const pointerStartRef = useRef(null);
      const pointerDepthRef = useRef(null);
      const pointerStartScreenRef = useRef(null);
      const pointerLastScreenRef = useRef(null);
      const pointerDownPieceRef = useRef(null);
      const pointerDownWasSelectedRef = useRef(false);
      const groupRef = useRef();
      const sceneScale = 0.470;
      // load models once at App level and pass to children
      const kingGltf = useGLTF('/models/King_small.glb');
      const pawnGltf = useGLTF('/models/pawn_small.glb');
      const knightGltf = useGLTF('/models/knight_small.glb');
      const bishopGltf = useGLTF('/models/bishop_small.glb');
      const rookGltf = useGLTF('/models/rook_small.glb');
      const queenGltf = useGLTF('/models/queen_small.glb');

      // build a cache of normalized clones per piece type + color so ghost and piece share same object
      const clones = useMemo(() => {
        try { console.debug('recomputing clones cache'); } catch (e) {}
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

      const showCastlePrompt = (opts) => {
        // opts: { title, onYes, onNo }
        setCastlePrompt(opts);
      };

      const showPromotionPrompt = (opts) => {
        // opts: { onSelect: (pieceType) => void }
        setPromotionPrompt(opts);
      };
      

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
      // lightweight in-memory/localStorage debug event buffer for easier log collection
      const debugEventsRef = useRef([]);
      const pushDebug = useCallback((tag, payload) => {
        try {
          const ev = { t: Date.now(), tag, payload };
          debugEventsRef.current.push(ev);
          if (debugEventsRef.current.length > 200) debugEventsRef.current.shift();
          try { localStorage.setItem('chess3d:debugEvents', JSON.stringify(debugEventsRef.current.slice(-200))); } catch (e) {}
          try { window.__chess3d_debug = debugEventsRef.current.slice(-200); } catch (e) {}
          try { console.log('pushDebug', tag, payload); } catch (e) {}
        } catch (e) {}
      }, []);
      // reset game to initial position
      const resetGame = () => {
        try {
          // Cancel any ongoing AI search
          if (searchStateRef.current) {
            searchStateRef.current.cancelled = true;
          }
          // Reset AI move tracking
          aiLastMoveCountRef.current = -1;
          
          setPiecesState(getInitialPieces());
          setMoveHistory([]);
          setCoordMoveHistory([]);
          coordMoveHistoryRef.current = [];
          setCurrentTurn('white');
          setLastMove(null); try { console.log('lastMove cleared (1960)'); } catch (e) {}
          setAiSide(null);
          setSelectedPieceId(null);
          setGameOver(false);
          setGameWinner(null);
          setShowGameOverModal(false);
          setStatusMessage('');
          setBoardFlipped(false);
          setHalfMoveClock(0);
          setRepetitionCount(0);
          statesHistoryRef.current = [];
          setAiPaused(false);
          setViewIndex(null);
          setViewedPieces(null);
          setPuzzlePlayerSide(null);
          setPuzzleAttempted(false);
          setPuzzleSolved(false);
          setPuzzleStatus('');
        } catch (e) { console.debug('resetGame error', e); }
      };
      const prevPiecesRef = useRef(piecesState);
      const prevMoveHistoryRef = useRef(moveHistory);
      const coordMoveHistoryRef = useRef([]); // ref copy so the engine timeout closure always sees latest
      useEffect(() => { coordMoveHistoryRef.current = coordMoveHistory; }, [coordMoveHistory]);
      const statesHistoryRef = useRef([]); // stack of previous full states for take-back

      // push a shallow snapshot of the full app state for take-back
      const pushStateSnapshot = useCallback(() => {
        try {
          // use the current live state values (not prev refs) to avoid missing snapshots
          const snap = {
            piecesState: (piecesState || []).map(p => ({ ...p })),
            moveHistory: (moveHistory || []).slice(),
            coordMoveHistory: (coordMoveHistoryRef.current || []).slice(),
            currentTurn,
            lastMove,
            aiSide,
            gameStarted,
            halfMoveClock,
          };
          statesHistoryRef.current.push(snap);
          try { console.debug('pushed state snapshot (take-back depth)', statesHistoryRef.current.length); } catch (e) {}
          try { if (typeof pushDebug === 'function') pushDebug('pushedSnapshot', { depth: statesHistoryRef.current.length }); } catch (e) {}
        } catch (e) { console.debug('pushStateSnapshot failed', e); }
      }, [piecesState, moveHistory, currentTurn, lastMove, aiSide, gameStarted, halfMoveClock]);

      // navigate the play-through history; idx=null means go to live position
      const navigatePlayThrough = useCallback((idx) => {
        try {
          const snapshots = statesHistoryRef.current;
          const total = snapshots.length;
          if (idx === null || idx >= total) {
            // Navigate to live position
            setViewIndex(null);
            setViewedPieces(null);
            setSelectedPieceId(null);
            // In AI vs AI: resume the engine if the game is still going
            if (aiSide === 'both' && !gameOver) {
              aiLastMoveCountRef.current = -1;
              setAiPaused(false);
            }
          } else {
            const clampedIdx = Math.max(0, Math.min(idx, total - 1));
            setViewIndex(clampedIdx);
            setViewedPieces((snapshots[clampedIdx]?.piecesState || []).map(p => ({ ...p })));
            setSelectedPieceId(null);
            // In AI vs AI: auto-pause when the user navigates into history
            if (aiSide === 'both' && !gameOver && !aiPausedRef.current) {
              if (aiTimeoutRef.current.id) {
                clearTimeout(aiTimeoutRef.current.id);
                aiTimeoutRef.current = { id: null, moveCount: null };
                aiLastMoveCountRef.current = -1;
              }
              setAiPaused(true);
            }
          }
        } catch (e) { console.debug('navigatePlayThrough failed', e); }
      }, [aiSide, gameOver]);

      useEffect(() => { prevMoveHistoryRef.current = moveHistory; }, [moveHistory]);

      // notation helper (app-wide): convert internal coords to human-readable notation
      const squareToNotation = ({ x, y, z } = {}) => {
        const ix = (typeof x === 'number') ? x : 0;
        const iy = (typeof y === 'number') ? y : 0;
        const iz = (typeof z === 'number') ? z : 0;
        const level = iz + 1;
        const file = String.fromCharCode('a'.charCodeAt(0) + iy);
        const rank = 8 - ix;
        return `${level}${file}${rank}`;
      };

      const generateMoveNotation = (mover, target, pieces) => {
        if (!mover) return '';
        const mapCoordForNotation = (c, color) => {
          if (!c) return c;
          const ix = (typeof c.x === 'number') ? c.x : 0;
          const iy = (typeof c.y === 'number') ? c.y : 0;
          const iz = (typeof c.z === 'number') ? c.z : 0;
          return { x: ix, y: iy, z: iz };
        };
        try { try { console.debug('generateMoveNotation inputs', { mover, target, piecesCount: pieces && pieces.length }); } catch (e) {} } catch (e) {}
        const piece = mover.t;
        const letter = piece === 'p' ? '' : piece;
        const mappedTarget = mapCoordForNotation(target || {}, mover.color);
        const mappedOrigin = mapCoordForNotation(mover, mover.color);
        const targetNotation = squareToNotation(mappedTarget || {});

        // simulate the move to detect check / mate for proper notation suffix
        let checkSuffix = '';
        let simulated = null;
        try {
          simulated = simulateMove(pieces || [], mover.id, target || {});
          const opponent = mover.color === 'white' ? 'black' : 'white';
          try {
            const oppInCheck = isAnyKingInCheck(simulated, opponent);
            const oppLegal = (getAllLegalMoves(simulated, opponent) || []);
            const isMate = oppInCheck && oppLegal.length === 0;
            checkSuffix = isMate ? '#' : (oppInCheck ? '+' : '');
          } catch (e) {
            checkSuffix = '';
          }
          try { console.debug('generateMoveNotation mapped', { mappedTarget, targetNotation, mappedOrigin, simulatedMoved: simulated && simulated.find(s => s.id === mover.id) || null, checkSuffix }); } catch (e) {}
        } catch (e) { console.debug('simulateMove in notation err', e); }

        if (target && target.castle) {
          const startLevel = mover.z + 1;
          // endLevel = the king's destination level (target.z), NOT the rook's rookTo level
          const endLevel = (target.z != null) ? target.z + 1 : mover.z + 1;
          const o = target.castle.type === 'queen' ? 'O-O-O' : 'O-O';
          return `${startLevel}${o}${endLevel}${checkSuffix}`;
        }

        const promotionSuffix = (target && target.promotion) ? ('=' + target.promotion) : '';
        const isCapture = !!( (target && target.enPassant) || (pieces && pieces.find(p => p.x === (target && target.x) && p.y === (target && target.y) && p.z === (target && target.z) && p.color !== mover.color)) );
        if (piece === 'p') {
          if (!isCapture) return `${targetNotation}${promotionSuffix}${checkSuffix}`;
          const originFile = String.fromCharCode('a'.charCodeAt(0) + (mappedOrigin.y || 0));
          let ambiguousLevel = false;
          if (pieces && pieces.length) {
            for (const p of pieces) {
              if (p.id === mover.id) continue;
              if (p.t !== 'p' || p.color !== mover.color) continue;
              if (p.y !== mover.y) continue;
              if (canPieceMoveTo(p, target.x, target.y, target.z, pieces)) { ambiguousLevel = true; break; }
            }
          }
          if (ambiguousLevel) {
            const levelPrefix = (mappedOrigin.z != null ? (mappedOrigin.z + 1) : 1);
            return `${levelPrefix}${originFile}x${targetNotation}${promotionSuffix}${checkSuffix}`;
          }
          return `${originFile}x${targetNotation}${promotionSuffix}${checkSuffix}`;
        }
        let ambiguous = false;
        if (letter !== '') {
          for (const p of pieces) {
            if (p.id === mover.id) continue;
            if (p.t !== mover.t) continue;
            if (p.color !== mover.color) continue;
            if (canPieceMoveTo(p, target.x, target.y, target.z, pieces)) { ambiguous = true; break; }
          }
        }
        if (!ambiguous) return `${letter}${isCapture ? 'x' : ''}${targetNotation}${promotionSuffix}${checkSuffix}`;
        const origin = squareToNotation(mappedOrigin || {});
        return `${letter}(${origin})${isCapture ? 'x' : ''}${targetNotation}${promotionSuffix}${checkSuffix}`;
      };

      const moveLockRef = useRef(false);

      // helper: generate all legal moves for a color
      const getAllLegalMoves = useCallback((pieces, color) => {
        const res = [];
        for (const p of pieces) {
          if (p.color !== color) continue;
          for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 4; y++) {
              for (let z = 0; z < 4; z++) {
                try {
                  if (!canPieceMoveTo(p, x, y, z, pieces)) continue;
                  // For pawns, ensure diagonal captures only target enemy-occupied squares (avoid illegal diagonal moves into empty squares)
                  if (p.t === 'p') {
                    const isAttackMove = (function() {
                      try { return attacksSquareByPiece(p, x, y, z, pieces); } catch (e) { return false; }
                    })();
                    if (isAttackMove) {
                      const occ = pieces.find(pp => pp.x === x && pp.y === y && pp.z === z);
                      if (!occ || occ.color === p.color) {
                        // not a valid capture (no enemy there), skip
                        continue;
                      }
                    }
                  }
                  const next = simulateMove(pieces, p.id, { x, y, z });
                  if (!isAnyKingInCheck(next, color)) {
                    res.push({ moverId: p.id, x, y, z });
                  }
                } catch (e) {}
              }
            }
          }
        }
        return res;
      }, [simulateMove, canPieceMoveTo, isAnyKingInCheck]);

      // Rebuild coordMoveHistory by simulating from the initial position using stored algebraic notation.
      // Called automatically when loading old saves that predate coordMoveHistory persistence.
      const rebuildCoordMoveHistory = useCallback((historyOverride) => {
        try {
          const hist = historyOverride || moveHistory;
          if (!hist || hist.length === 0) return [];
          const parseQLlocal = (s) => {
            const m = s && s.match(/^([1-4])([a-h])([1-8])$/);
            if (!m) return null;
            return { z: Number(m[1]) - 1, y: m[2].charCodeAt(0) - 97, x: 8 - Number(m[3]) };
          };
          const coordToStr = (p) => `${p.z + 1}${String.fromCharCode(97 + p.y)}${8 - p.x}`;
          let simPieces = getInitialPieces();
          const coordMoves = [];
          for (const entry of hist) {
            for (const color of ['white', 'black']) {
              const raw = entry[color];
              if (!raw) continue;
              // Castling: e.g. "1O-O2" or "1O-O-O2"
              if (/O-O/.test(raw)) {
                const queenSide = raw.includes('O-O-O');
                const levelMatch = raw.match(/^(\d)O-O(?:-O)?(\d)/);
                const z_from = levelMatch ? Number(levelMatch[1]) - 1 : null;
                const z_to   = levelMatch ? Number(levelMatch[2]) - 1 : null;
                const king = simPieces.find(p => p.color === color && p.t === 'K' && (z_from === null || p.z === z_from));
                if (king) {
                  const legal = getAllLegalMoves(simPieces, color) || [];
                  const kingMoves = legal.filter(mv => mv.moverId === king.id && (z_to === null || mv.z === z_to));
                  const castleMove = queenSide
                    ? kingMoves.reduce((b, mv) => (!b || mv.y < b.y) ? mv : b, null)
                    : kingMoves.reduce((b, mv) => (!b || mv.y > b.y) ? mv : b, null);
                  if (castleMove && castleMove.castle) {
                    // Use the full castle move object, including the castle metadata
                    coordMoves.push(coordToStr(king) + coordToStr(castleMove));
                    try {
                      simPieces = simulateMove(simPieces, king.id, { x: castleMove.x, y: castleMove.y, z: castleMove.z, castle: castleMove.castle });
                    } catch (e) {}
                  } else if (castleMove) {
                    // Fallback: if castle metadata is missing, move king only (legacy)
                    coordMoves.push(coordToStr(king) + coordToStr(castleMove));
                    try {
                      simPieces = simulateMove(simPieces, king.id, { x: castleMove.x, y: castleMove.y, z: castleMove.z });
                    } catch (e) {}
                  }
                }
                continue;
              }
              // Extract all coord squares from notation (e.g. "N(2d8)x3c4" â†’ ["2d8","3c4"])
              const sqRe = /([1-4][a-h][1-8])/g;
              const squares = [];
              let sqm;
              while ((sqm = sqRe.exec(raw)) !== null) squares.push(sqm[1]);
              const destStr = squares[squares.length - 1];
              const srcStr  = squares.length >= 2 ? squares[0] : null;
              if (!destStr) continue;
              const toCoord   = parseQLlocal(destStr);
              const fromCoord = srcStr ? parseQLlocal(srcStr) : null;
              const pieceLetterMatch = raw.match(/^([NBRQK])/);
              const pieceLetter = pieceLetterMatch ? pieceLetterMatch[1] : 'p';
              let foundPiece = null;
              // Direct lookup if source square is encoded in notation
              if (fromCoord) {
                foundPiece = simPieces.find(p => p.color === color && p.x === fromCoord.x && p.y === fromCoord.y && p.z === fromCoord.z);
              }
              // Otherwise use legal moves
              if (!foundPiece && toCoord) {
                const legal = getAllLegalMoves(simPieces, color) || [];
                const candidates = legal.filter(mv => mv.x === toCoord.x && mv.y === toCoord.y && mv.z === toCoord.z);
                const typed = candidates.filter(mv => {
                  const pp = simPieces.find(p => p.id === mv.moverId);
                  return pp && (pieceLetter === 'p' ? pp.t === 'p' : pp.t === pieceLetter);
                });
                const pool = typed.length > 0 ? typed : candidates;
                if (pool.length > 0) foundPiece = simPieces.find(p => p.id === pool[0].moverId);
              }
              if (foundPiece && toCoord) {
                coordMoves.push(coordToStr(foundPiece) + coordToStr(toCoord));
                try { simPieces = simulateMove(simPieces, foundPiece.id, toCoord); } catch (e) {
                  console.warn('rebuildCoordMoveHistory: simulateMove failed for', raw, e);
                }
              } else {
                console.warn('rebuildCoordMoveHistory: could not resolve move', raw, '(color:', color, ')');
              }
            }
          }
          console.log('rebuildCoordMoveHistory: reconstructed', coordMoves.length, 'coord moves from', hist.length, 'history entries');
          coordMoveHistoryRef.current = coordMoves;
          setCoordMoveHistory(coordMoves);
          return coordMoves;
        } catch (e) {
          console.warn('rebuildCoordMoveHistory failed:', e);
          return [];
        }
      }, [moveHistory, getAllLegalMoves]);

      // search timing and state
      const searchStateRef = useRef({ endTime: 0, cancelled: false });
      const aiLastMoveCountRef = useRef(-1); // Track which move count the AI last played on
      const aiTimeoutRef = useRef({ id: null, moveCount: null }); // Track active AI timeout with its move count
      const [aiPaused, setAiPaused] = useState(false); // pause AI vs AI
      const aiPausedRef = useRef(false);
      useEffect(() => { aiPausedRef.current = aiPaused; }, [aiPaused]);
      const [aiThinking, setAiThinking] = useState(false); // show "Thinking..." indicator
      const [viewIndex, setViewIndex] = useState(null); // null = live; 0..N-1 = play-through snapshot index
      const [viewedPieces, setViewedPieces] = useState(null); // display-only pieces when browsing history
      const activePuzzle = gameMode === 'puzzle' ? (puzzleSet[puzzleIndex] || null) : null;

      const handlePuzzleHumanMove = useCallback((mover, finalTarget, coordMove, notation) => {
        if (gameMode !== 'puzzle') return;
        if (!activePuzzle) return;
        if (!mover || mover.color !== puzzlePlayerSide) return;

        if (!puzzleAttempted) {
          setPuzzleAttempted(true);
          if (puzzleMoveMatches(activePuzzle, coordMove, notation)) {
            setPuzzleSolved(true);
            setPuzzleStatus('Correct move.');
          } else {
            setPuzzleStatus('Not a mate in 2 path.');
          }
          return;
        }

        if (!puzzleSolved || !finalTarget) return;

        try {
          const nextPieces = simulateMove(piecesState || [], mover.id, finalTarget);
          const opponent = mover.color === 'white' ? 'black' : 'white';
          const opponentInCheck = isAnyKingInCheck(nextPieces, opponent);
          const opponentLegalMoves = getAllLegalMoves(nextPieces, opponent) || [];
          const isMate = opponentInCheck && opponentLegalMoves.length === 0;
          if (!isMate) {
            setPuzzleStatus('Not a mate in 2 path.');
          } else {
            setPuzzleStatus('Correct move.');
          }
        } catch (e) {
          console.debug('handlePuzzleHumanMove second move evaluation failed', e);
        }
      }, [gameMode, activePuzzle, puzzleAttempted, puzzleSolved, puzzlePlayerSide, piecesState, simulateMove, isAnyKingInCheck, getAllLegalMoves]);

      // helper: order moves (captures first, then center-oriented), prefer moves that reduce undefended pieces
      const { orderMoves, negamax } = useMemo(() => createAiEngine({
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
      }), [
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
      ]);

      // helper: perform a move programmatically (moverId + target)
      const applyMove = useCallback((moverId, finalTarget) => {
        try { console.debug('applyMove enter', { moverId, finalTarget, moveLock: moveLockRef.current }); } catch (e) {}
        if (moveLockRef.current) { try { console.debug('applyMove early return: moveLock active', { moverId }); } catch (e) {} return; }
        moveLockRef.current = true;
        try {
          // compute stable snapshot and notation BEFORE mutating state to avoid races
          const snapPieces = (prevPiecesRef.current && prevPiecesRef.current.length) ? prevPiecesRef.current : (piecesState || []);
          let moverBeforeSnap = null;
          try { moverBeforeSnap = snapPieces.find(p => p.id === moverId) || null; } catch (e) { moverBeforeSnap = null; }
          let coordMoveComputed = '';

          try {
            if (moverBeforeSnap && finalTarget && typeof finalTarget.x === 'number' && typeof finalTarget.y === 'number' && typeof finalTarget.z === 'number') {
              const fromSq = `${moverBeforeSnap.z + 1}${String.fromCharCode(97 + moverBeforeSnap.y)}${8 - moverBeforeSnap.x}`;
              const toSq = `${finalTarget.z + 1}${String.fromCharCode(97 + finalTarget.y)}${8 - finalTarget.x}`;
              coordMoveComputed = `${fromSq}${toSq}`.toLowerCase();
            }
          } catch (e) { coordMoveComputed = ''; }

          let finalNotationComputed = '';
          try {
            // always compute notation from stable pre-move snapshot to avoid races
            finalNotationComputed = generateMoveNotation(moverBeforeSnap, finalTarget, snapPieces) || '';
          } catch (e) { finalNotationComputed = '' }

          if (gameMode === 'puzzle' && activePuzzle && !puzzleAttempted && moverBeforeSnap && moverBeforeSnap.color === puzzlePlayerSide) {
            setPuzzleAttempted(true);
            if (!puzzleMoveMatches(activePuzzle, coordMoveComputed, finalNotationComputed)) {
              setPuzzleStatus('Not a mate in 2 path.');
            } else {
              setPuzzleSolved(true);
              setPuzzleStatus('Correct move.');
            }
          }

          try { (typeof pushStateSnapshot !== 'undefined') && pushStateSnapshot(); } catch (e) {}

          // 50-move rule: reset clock on pawn moves or captures, else increment
          try {
            const isPawnMove = moverBeforeSnap && moverBeforeSnap.t === 'p';
            const isCapture = (finalTarget && finalTarget.enPassant) ||
              snapPieces.some(pp =>
                pp.x === finalTarget.x && pp.y === finalTarget.y && pp.z === finalTarget.z &&
                pp.color !== (moverBeforeSnap ? moverBeforeSnap.color : null)
              );
            setHalfMoveClock(prev => (isPawnMove || isCapture) ? 0 : prev + 1);
          } catch (e) {}

          // perform state mutation
          setPiecesState((prev) => {
            const mover = prev.find(pp => pp.id === moverId);
            if (!mover) return prev;
            const movingColor = mover.color;
            let withoutCaptured;
            try {
              if (finalTarget && finalTarget.enPassant && finalTarget.capturedId) {
                withoutCaptured = prev.filter(pp => pp.id !== finalTarget.capturedId);
              } else {
                withoutCaptured = prev.filter(pp => !(pp.x === finalTarget.x && pp.y === finalTarget.y && pp.z === finalTarget.z && pp.color !== movingColor));
              }
              const next = withoutCaptured.map((pp) => {
                if (pp.id === moverId) {
                  // Apply pawn promotion if specified, or auto-promote to queen if reaching promotion rank
                  let newType = pp.t;
                  if (pp.t === 'p') {
                    const promotionRank = pp.color === 'white' ? 0 : 7;
                    if (finalTarget.x === promotionRank) {
                      // If finalTarget specifies promotion piece, use it; otherwise default to Queen
                      newType = finalTarget.promotion || 'Q';
                    }
                  }
                  return { ...pp, t: newType, x: finalTarget.x, y: finalTarget.y, z: finalTarget.z, hasMoved: true };
                }
                if (finalTarget && finalTarget.castle) {
                  // primary: match rook by explicit id
                  if (pp.id === finalTarget.castle.rookId) {
                    const originalRookTo = finalTarget.castle.rookTo;
                    let safeRookTo = originalRookTo;
                    try {
                      if (originalRookTo && finalTarget && typeof finalTarget.x === 'number' && typeof originalRookTo.x === 'number') {
                        if (originalRookTo.x === finalTarget.x && originalRookTo.y === finalTarget.y && originalRookTo.z === finalTarget.z) {
                          safeRookTo = { x: mover.x, y: mover.y, z: mover.z };
                        }
                      }
                    } catch (e) {}
                    if (safeRookTo) return { ...pp, x: safeRookTo.x, y: safeRookTo.y, z: safeRookTo.z, hasMoved: true };
                  }
                  // fallback: if rookId didn't match (possible mismatch), fall back to matching rookFrom coords
                  try {
                    const rf = finalTarget.castle.rookFrom;
                    if (rf && pp.x === rf.x && pp.y === rf.y && pp.z === rf.z) {
                      const originalRookTo = finalTarget.castle.rookTo;
                      let safeRookTo = originalRookTo;
                      try {
                        if (originalRookTo && finalTarget && typeof finalTarget.x === 'number' && typeof originalRookTo.x === 'number') {
                          if (originalRookTo.x === finalTarget.x && originalRookTo.y === finalTarget.y && originalRookTo.z === finalTarget.z) {
                            safeRookTo = { x: mover.x, y: mover.y, z: mover.z };
                          }
                        }
                      } catch (e) {}
                      if (safeRookTo) return { ...pp, x: safeRookTo.x, y: safeRookTo.y, z: safeRookTo.z, hasMoved: true };
                    }
                  } catch (e) {}
                }
                return pp;
              });
              return next;
            } catch (e) { return prev; }
          });

          // notation and history using the precomputed stable notation
          const moveAppliedRef = { current: true }; // Track if move was actually applied to history
          try {
            try { console.debug('applyMove notation computed', { moverId: moverId, moverBefore: moverBeforeSnap, finalTarget, finalNotation: finalNotationComputed }); } catch (e) {}
            if (finalNotationComputed) {
              const side = moverBeforeSnap ? moverBeforeSnap.color : null;
              
              // Check for duplicate SYNCHRONOUSLY using prevMoveHistoryRef before calling setState
              // This must happen before setMoveHistory because we need to know NOW whether to toggle turn
              // IMPORTANT: must match BOTH notation AND moverId â€” two different pieces (e.g. two Rooks)
              // can legitimately produce identical notation on the same turn in 3D chess.
              const currentHistory = prevMoveHistoryRef.current || [];
              if (side === 'white' && currentHistory.length > 0) {
                const last = currentHistory[currentHistory.length - 1];
                if (last && last.white === finalNotationComputed && last.whiteMoverId === moverId) {
                  moveAppliedRef.current = false;
                  try { console.warn('applyMove: DUPLICATE MOVE DETECTED (white), not updating history or turn', { notation: finalNotationComputed, moverId, lastEntry: last }); } catch (e) {}
                }
              }

              // Only update history if not a duplicate
              if (moveAppliedRef.current) {
                setMoveHistory(prev => {
                  const copy = prev ? prev.slice() : [];
                  
                  // Apply the move to history
                  if (side === 'white') {
                    copy.push({ white: finalNotationComputed, whiteMoverId: moverId, black: null });
                  } else if (side === 'black') {
                    if (copy.length === 0) copy.push({ white: null, black: finalNotationComputed, blackMoverId: moverId });
                    else copy[copy.length - 1] = { ...copy[copy.length - 1], black: finalNotationComputed, blackMoverId: moverId };
                  }
                  
                  // Calculate the NEW move count just for the debug log
                  const newMoveCount = copy.reduce((sum, entry) => {
                    return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
                  }, 0);
                  // NOTE: aiLastMoveCountRef is managed exclusively by the AI useEffect.
                  // Updating it here caused the next AI turn to be blocked in 'both' mode.
                  try { console.debug('applyMove moveHistory updated', { beforeLen: prev ? prev.length : 0, afterLen: copy.length, copyLast: copy[copy.length - 1], newMoveCount, refUpdated: newMoveCount }); } catch (e) {}
                  return copy;
                });
              }
            } else {
              try { console.debug('applyMove: no notation generated', { moverId: moverId, moverBefore: moverBeforeSnap, finalTarget }); } catch (e) {}
              moveAppliedRef.current = false; // No notation means no move applied
            }
          } catch (e) { 
            console.debug('applyMove history error', e); 
            moveAppliedRef.current = false;
          }

          try { 
            console.log('applyMove: moveAppliedRef.current=', moveAppliedRef.current, 'notation=', finalNotationComputed); 
          } catch (e) {}

          // Always record raw coord move for the engine â€” independent of notation/moveAppliedRef
          // so the engine always gets the correct move list regardless of notation edge-cases
          try {
            if (coordMoveComputed) {
              console.log('applyMove coordMove:', coordMoveComputed);
              coordMoveHistoryRef.current = [...coordMoveHistoryRef.current, coordMoveComputed];
              setCoordMoveHistory(coordMoveHistoryRef.current);
            }
          } catch (e) { console.debug('coordMoveHistory update error', e); }

          setSelectedPieceId(null);
          
          // Only toggle turn if the move was actually applied (not a duplicate)
          if (moveAppliedRef.current) {
            try { 
              console.log('applyMove: SWITCHING TURN from', currentTurn, 'to', (currentTurn === 'white' ? 'black' : 'white'));
            } catch (e) {}
            setCurrentTurn((prev) => {
              const next = prev === 'white' ? 'black' : 'white';
              try { console.log('setCurrentTurn executed: prev=', prev, ', next=', next); } catch (e) {}
              return next;
            });
          } else {
            try { console.warn('applyMove: SKIPPING turn toggle due to duplicate move or no notation'); } catch (e) {}
          }

          // set lastMove for double-step pawns based on snapshot mover
          try {
            if (moverBeforeSnap && moverBeforeSnap.t === 'p') {
              const dx = Math.abs(finalTarget.x - moverBeforeSnap.x);
              if (dx === 2) {
                const lm = { id: moverBeforeSnap.id, from: { x: moverBeforeSnap.x, y: moverBeforeSnap.y, z: moverBeforeSnap.z }, to: { x: finalTarget.x, y: finalTarget.y, z: finalTarget.z }, doubleStep: true };
                setLastMove(lm);
              } else { setLastMove(null); try { console.log('lastMove cleared (3284)'); } catch (e) {} }
            } else { setLastMove(null); try { console.log('lastMove cleared (3285)'); } catch (e) {} }
          } catch (e) { setLastMove(null); try { console.log('lastMove cleared (3286)'); } catch (e2) {} }
        } finally {
          moveLockRef.current = false;
        }
      }, [piecesState, setPiecesState, setMoveHistory, setCoordMoveHistory, setSelectedPieceId, setCurrentTurn, setLastMove, setHalfMoveClock, pushStateSnapshot, generateMoveNotation, moveHistory, currentTurn, gameMode, puzzleAttempted, puzzleSolved, activePuzzle, puzzlePlayerSide]);

      // take-back: undo last ply (or last two plies if playing against AI)
      const takeBack = useCallback(() => {
        try {
          // Cancel any ongoing AI search
          if (searchStateRef.current) {
            searchStateRef.current.cancelled = true;
          }
          
          if (!statesHistoryRef.current || statesHistoryRef.current.length === 0) return;
          try { console.debug('takeBack invoked, snapshot depth before pop:', statesHistoryRef.current.length, 'aiSide:', aiSide); } catch (e) {}
          const toPop = aiSide ? 2 : 1;
          let restored = null;
          for (let i = 0; i < toPop; i++) {
            if (statesHistoryRef.current.length === 0) break;
            restored = statesHistoryRef.current.pop();
          }
          try { console.debug('takeBack popped, snapshot depth after pop:', statesHistoryRef.current.length); } catch (e) {}
          if (!restored) return;
          try { if (typeof pushDebug === 'function') pushDebug('takeBackPopped', { restoredHas: !!restored, depth: statesHistoryRef.current.length }); } catch (e) {}
          
          // Calculate the move count from restored history and set ref
          const restoredMoveCount = (restored.moveHistory || []).reduce((sum, entry) => {
            return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
          }, 0);
          // Set to restoredMoveCount - 1 to allow AI to play if it's AI's turn after undo
          aiLastMoveCountRef.current = restoredMoveCount - 1;
          try { console.log('takeBack: Set aiLastMoveCountRef to', restoredMoveCount - 1, 'for restored history with', restoredMoveCount, 'moves'); } catch (e) {}
          
          // restore full state
          try { setPiecesState(restored.piecesState || []); } catch (e) {}
          try { setMoveHistory(restored.moveHistory || []); } catch (e) {}
          // restore coordMoveHistory so the engine replay stays in sync after take-back
          try { const restoredCoord = restored.coordMoveHistory || []; coordMoveHistoryRef.current = restoredCoord.slice(); setCoordMoveHistory(restoredCoord); } catch (e) {}
          try { setCurrentTurn(restored.currentTurn || 'white'); } catch (e) {}
          try { setLastMove(restored.lastMove || null); } catch (e) {}
          // also restore aiSide/gameStarted to avoid logic mismatches after undo
          try { setAiSide(restored.aiSide || null); } catch (e) {}
          try { setGameStarted(!!restored.gameStarted); } catch (e) {}
          try { setHalfMoveClock(restored.halfMoveClock || 0); } catch (e) {}
          // update refs to reflect restored state
          try { prevPiecesRef.current = (restored.piecesState || []).map(p => ({ ...p })); } catch (e) {}
          try { prevMoveHistoryRef.current = (restored.moveHistory || []).slice(); } catch (e) {}
          // persist immediately
          try { saveToServerImmediate({ piecesState: restored.piecesState, moveHistory: restored.moveHistory, currentTurn: restored.currentTurn, lastMove: restored.lastMove, aiSide: restored.aiSide, gameStarted: restored.gameStarted }); } catch (e) { console.debug('immediate save after takeBack failed', e); }
          try { console.debug('takeBack restored state', { currentTurn: restored.currentTurn, moveHistoryLen: (restored.moveHistory||[]).length, aiSide: restored.aiSide, gameStarted: restored.gameStarted }); } catch (e) {}
          try { if (typeof pushDebug === 'function') pushDebug('takeBackRestored', { currentTurn: restored.currentTurn, moveHistoryLen: (restored.moveHistory||[]).length, aiSide: restored.aiSide, gameStarted: restored.gameStarted }); } catch (e) {}
        } catch (e) { console.debug('takeBack failed', e); }
      }, [aiSide, gameStarted, saveToServerImmediate]);

      // derive lastMove by diffing piecesState changes so it's always accurate
      useEffect(() => {
        try {
          // If in history view, set lastMove from moveHistory at viewIndex
          if (typeof viewIndex === 'number' && viewIndex !== null && coordMoveHistoryRef && coordMoveHistoryRef.current && coordMoveHistoryRef.current.length > 0) {
            // coordMoveHistoryRef.current is an array of move strings like '2b72b5'
            // For castling, two moves (king and rook) are added per logical move. We want to highlight both in a single step.
            const idx = Math.max(0, Math.min(viewIndex, coordMoveHistoryRef.current.length - 1));
            const parseCoord = (s) => ({
              z: parseInt(s[0], 10) - 1,
              y: s.charCodeAt(1) - 97,
              x: 8 - parseInt(s[2], 10)
            });
            // Always check both the current and previous move for a castle pair
            const moveStrCurr = coordMoveHistoryRef.current[idx - 1];
            const moveStrPrev = coordMoveHistoryRef.current[idx - 2];
            let isCastle = false;
            let kingMove = null, rookMove = null;
            const pieces = viewedPieces || piecesState || [];
            function getPieceType(moveStr) {
              if (!moveStr || moveStr.length !== 6) return null;
              const from = parseCoord(moveStr.slice(0, 3));
              const piece = pieces.find(p => p.x === from.x && p.y === from.y && p.z === from.z);
              return piece ? piece.t : null;
            }
            // Check if current and previous move together form a castle (in either order)
            if (moveStrCurr && moveStrPrev && moveStrCurr.length === 6 && moveStrPrev.length === 6) {
              const typeCurr = getPieceType(moveStrCurr);
              const typePrev = getPieceType(moveStrPrev);
              if (typeCurr && typePrev && ((typeCurr === 'K' && typePrev === 'R') || (typeCurr === 'R' && typePrev === 'K'))) {
                isCastle = true;
                if (typeCurr === 'K') { kingMove = moveStrCurr; rookMove = moveStrPrev; }
                else { kingMove = moveStrPrev; rookMove = moveStrCurr; }
              }
            }
            if (isCastle && kingMove && rookMove) {
              // Highlight both king and rook moves
              const fromK = parseCoord(kingMove.slice(0, 3));
              const toK = parseCoord(kingMove.slice(3, 6));
              const fromR = parseCoord(rookMove.slice(0, 3));
              const toR = parseCoord(rookMove.slice(3, 6));
              setLastMove({
                from: fromK,
                to: toK,
                castle: {
                  rookFrom: fromR,
                  rookTo: toR
                }
              });
            } else if (moveStrCurr && moveStrCurr.length >= 6) {
              const from = parseCoord(moveStrCurr.slice(0, 3));
              const to = parseCoord(moveStrCurr.slice(3, 6));
              setLastMove({ from, to });
            } else {
              setLastMove(null);
              try { console.log('lastMove cleared (3359)'); } catch (e) {}
            }
            return;
          }
          // Otherwise, derive lastMove by diffing piecesState changes
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
            // Preserve lastMove.castle if it was set by the move logic (e.g., _doMove)
            setLastMove((prevLastMove) => {
              // If prevLastMove.castle exists, keep it; otherwise, try to infer from rook move
              let castle = prevLastMove && prevLastMove.castle ? prevLastMove.castle : undefined;
              if (!castle && prev && curr) {
                // Find a rook that moved in this update
                const rookMove = curr.find(c => c.t === 'R' && !prev.some(p => p.id === c.id && p.x === c.x && p.y === c.y && p.z === c.z));
                if (rookMove) {
                  // Find previous rook position
                  const rookPrev = prev.find(p => p.id === rookMove.id);
                  if (rookPrev) {
                    castle = { rookId: rookMove.id, rookFrom: { x: rookPrev.x, y: rookPrev.y, z: rookPrev.z }, rookTo: { x: rookMove.x, y: rookMove.y, z: rookMove.z } };
                  }
                }
              }
              return {
                id: mv.after.id,
                from: { x: mv.before.x, y: mv.before.y, z: mv.before.z },
                to: { x: mv.after.x, y: mv.after.y, z: mv.after.z },
                doubleStep: (mv.before.t === 'p' && Math.abs(mv.before.x - mv.after.x) === 2),
                castle
              };
            });
          } else {
            // If the previous lastMove had a castle, preserve it (don't clear highlight after castling)
            setLastMove((prevLastMove) => {
              if (prevLastMove && prevLastMove.castle) {
                return prevLastMove;
              } else {
                try { console.log('lastMove cleared (3399)'); } catch (e2) {}
                return null;
              }
            });
          }
          prevPiecesRef.current = curr.map(c => ({ ...c }));
        } catch (e) {}
      }, [piecesState, setLastMove, viewIndex, moveHistory]);

      // Debug: log entire piecesState and currentTurn when pieces change (helps track unexpected state)
      useEffect(() => {
        try {
          console.debug('piecesState changed. count:', piecesState.length, 'currentTurn:', currentTurn);
          try { pushDebug('piecesStateChanged', { count: piecesState.length, currentTurn }); } catch (e) {}
        } catch (e) {}
      }, [piecesState, currentTurn]);

      useEffect(() => {
        try { pushDebug('moveHistoryChanged', { moveHistory }); } catch (e) {}
      }, [moveHistory]);

      // â”€â”€ Draw condition helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Returns true if `color` has enough material to force checkmate.
      // Insufficient = lone king, K+N(s) only, K+same-color bishop(s) only.
      const hasSufficientMatingMaterial = useCallback((pieces, color) => {
        const mine = (pieces || []).filter(p => p.color === color && p.t !== 'K');
        if (mine.length === 0) return false; // lone king
        // Any pawn, queen, or rook is always sufficient
        if (mine.some(p => p.t === 'p' || p.t === 'Q' || p.t === 'R')) return true;
        const bishops = mine.filter(p => p.t === 'B');
        const knights = mine.filter(p => p.t === 'N');
        // Bishop + Knight pair
        if (bishops.length > 0 && knights.length > 0) return true;
        // 2+ Bishops on DIFFERENT square colors (using 3-axis parity)
        if (bishops.length >= 2) {
          const parity = bishops.map(b => (b.x + b.y + b.z) % 2);
          if (parity.some(p => p === 0) && parity.some(p => p === 1)) return true;
        }
        // 2+ Knights is sufficient (can force mate with help)
        if (knights.length >= 2) return true;
        return false; // lone knight, or only same-color bishops remain
      }, []);

      // Auto-scroll the moves list to the bottom whenever a new move is added (desktop only).
      useEffect(() => {
        if (isMobile) return;
        // Use rAF to ensure the browser has finished layout before reading scrollHeight
        const raf = requestAnimationFrame(() => {
          try {
            if (moveListRef.current) {
              moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
            }
          } catch (e) {}
        });
        return () => cancelAnimationFrame(raf);
      }, [moveHistory, isMobile]);

      // Generate a canonical position key for threefold repetition detection.
      // Encodes: piece placements (sorted by id), side to move, en-passant square, castling rights (hasMoved flags).
      const positionKey = useCallback((pieces, turn, lm) => {
        const sorted = (pieces || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
        const pStr = sorted.map(p => `${p.t}${p.color[0]}${p.x},${p.y},${p.z}`);
        const epStr = (lm && lm.doubleStep) ? `${lm.to.y},${lm.to.z}` : '';
        return `${turn}|${pStr}|ep:${epStr}`;
      }, []);

      // Recount how many times the current position has appeared (current + history snapshots).
      // Runs after every board/turn/lastMove change. statesHistoryRef stores pre-move snapshots,
      // so the current rendered state is counted as +1 on top of any matching snapshots.
      useEffect(() => {
        try {
          const currentKey = positionKey(piecesState, currentTurn, lastMove);
          let count = 1; // the current position itself counts as 1
          for (const snap of (statesHistoryRef.current || [])) {
            try {
              const snapKey = positionKey(snap.piecesState, snap.currentTurn, snap.lastMove);
              if (snapKey === currentKey) count++;
            } catch (e) {}
          }
          setRepetitionCount(count);
        } catch (e) {}
      }, [piecesState, currentTurn, lastMove, positionKey]);

      // compute check / checkmate / double-check status whenever board or turn changes
      useEffect(() => {
        try {
          // â”€â”€ Insufficient mating material â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          const whiteHas = hasSufficientMatingMaterial(piecesState, 'white');
          const blackHas = hasSufficientMatingMaterial(piecesState, 'black');
          if (!whiteHas && !blackHas) {
            setGameOver(true);
            setGameWinner(null);
            setStatusMessage('Draw: insufficient mating material');
            return;
          }

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
          // determine if the side to move is in checkmate or stalemate
          const sideToMove = currentTurn;
          const sideInCheck = isAnyKingInCheck(piecesState, sideToMove);
          const hasMove = hasAnyLegalMove(piecesState, sideToMove);
          if (!hasMove) {
            setGameOver(true);
            if (sideInCheck) {
              const winner = sideToMove === 'white' ? 'black' : 'white';
              setGameWinner(winner);
              setStatusMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`);
            } else {
              setGameWinner(null);
              setStatusMessage('Draw: stalemate');
            }
            return;
          }
          // â”€â”€ Threefold repetition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          // Auto-draw for AI games; 2-player games get a "Claim Draw" button instead
          if (repetitionCount >= 3 && aiSide) {
            setGameOver(true);
            setGameWinner(null);
            setStatusMessage('Draw: threefold repetition');
            return;
          }
          // â”€â”€ 50-move rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          // Auto-draw for AI games; 2-player games get a "Declare Draw" button instead
          if (halfMoveClock >= 100 && aiSide) {
            setGameOver(true);
            setGameWinner(null);
            setStatusMessage('Draw: 50-move rule');
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
      }, [piecesState, currentTurn, halfMoveClock, aiSide, hasSufficientMatingMaterial, repetitionCount]);

      // camera / controls persistence
      const controlsRef = useRef();
      const importInputRef = useRef(null);
      const puzzleInputRef = useRef(null);
      const sidebarRef = useRef(null);

      // Keep --sidebar-h CSS variable in sync with actual sidebar height so the
      // fixed-position mobile menu is always anchored right below the header bar.
      useEffect(() => {
        const sidebar = sidebarRef.current;
        if (!sidebar) return;
        const update = () => {
          const h = sidebar.getBoundingClientRect().height;
          document.documentElement.style.setProperty('--sidebar-h', `${Math.round(h)}px`);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(sidebar);
        return () => ro.disconnect();
      }, []);
      const moveListRef = useRef(null); // for auto-scrolling the moves list to the latest entry
      // prefer explicit saved defaults if present; otherwise fall back to last-used camPos
      const [camPos, setCamPos] = useState(() => {
        try {
          const isMobileInit = window.innerWidth <= 480;
          const mobileDefault = [0, 6.5, -10];   // slightly flatter angle for mobile
          const desktopDefault = [0, 5, -10];
          return JSON.parse(localStorage.getItem('camDefaultPos')) || JSON.parse(localStorage.getItem('camPos')) || (isMobileInit ? mobileDefault : desktopDefault);
        } catch { return [0, 5, -10]; }
      });
      const [camTarget, setCamTarget] = useState(() => {
        try {
          const isMobileInit = window.innerWidth <= 480;
          const mobileTarget = [0, 3.5, 0];   // look at mid-stack for mobile
          const desktopTarget = [0, 1.7, 0];
          return JSON.parse(localStorage.getItem('camDefaultTarget')) || JSON.parse(localStorage.getItem('camTarget')) || (isMobileInit ? mobileTarget : desktopTarget);
        } catch { return [0, 1.7, 0]; }
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

      // R3F helper: directly resize renderer and camera on window resize/unmaximize
      function R3FResize() {
        const { gl, camera } = useThree();
        useEffect(() => {
          const handler = () => {
            try { console.debug('R3FResize handler invoked'); } catch (e) {}
            if (window._chess3dMenuAnimating) return; // suppress during menu slide animation
            if (window._chess3dOrientChanging) return; // suppress during orientation change settle
            try {
              const canvas = gl && gl.domElement;
              if (!canvas) return;
              // prefer the main container size to avoid transient zero-width during window transitions
              const main = document.querySelector('.main');
              let w, h;
              if (main) {
                w = Math.max(1, Math.floor(main.clientWidth));
                h = Math.max(1, Math.floor(main.clientHeight));
              } else {
                const rect = canvas.getBoundingClientRect();
                w = Math.max(1, Math.floor(rect.width));
                h = Math.max(1, Math.floor(rect.height));
              }
              // Guard: if dimensions are suspiciously small the layout hasn't settled yet
              if (w < 60 || h < 60) return;
              // explicitly set renderer size and pixel ratio
              try { gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch (e) {}
              try { gl.setSize(w, h, false); } catch (e) {}
              // always orthographic â€” recompute frustum and update zoom to match new viewport width
              if (camera && camera.isOrthographicCamera) {
                // use actual canvas pixel size (not window size) â€” accounts for mobile browser chrome, sidebar, etc.
                const _w = w;
                const _h = h;
                let newZoom;
                if (window._chess3dZoomOverride != null) {
                  newZoom = window._chess3dZoomOverride;
                } else {
                  newZoom = calcZoom(_w, _h);
                }
                camera.zoom = newZoom;
                const halfW = w / 2 / newZoom;
                const halfH = h / 2 / newZoom;
                camera.left   = -halfW;
                camera.right  =  halfW;
                camera.top    =  halfH;
                camera.bottom = -halfH;
                try { camera.updateProjectionMatrix(); } catch (e) {}
              }
            } catch (e) {}
          };
          window.addEventListener('resize', handler);
          window.addEventListener('chess3d:resize', handler);
          // run a few times to stabilize after layout changes
          try { console.debug('R3FResize mounted'); } catch (e) {}
          setTimeout(handler, 50);
          setTimeout(handler, 200);
          setTimeout(handler, 500);
          return () => { window.removeEventListener('resize', handler); window.removeEventListener('chess3d:resize', handler); };
        }, [gl, camera]);
        return null;
      }

      // BoardBoundsGuard: after the camera zoom settles, project the world-space position
      // of the bottom board's front D-row (the southernmost row of the lowest board) into
      // NDC. If it falls below the viewport bottom (NDC y < -0.92), iteratively reduce zoom
      // until the row is fully visible. Runs after R3FResize's 50/200/500 ms timers settle.
      function BoardBoundsGuard() {
        const { camera, gl } = useThree();
        useEffect(() => {
          const check = () => {
            try {
              if (!camera || !camera.isOrthographicCamera) return;
              const sc = 0.470; // must match sceneScale constant
              const isMob = window.innerWidth <= 480;
              // Bottom board Y in object space (index 3 = lowest board in the stack)
              const levelYObj = (isMob ? LEVEL_Y_MOBILE : LEVEL_Y)[3];
              const groupY = isMob ? -0.4 : 0; // group position offset
              // World-space position of the front D-row centre on the bottom board.
              // Object-space worldZ â‰ˆ 3.5 (yIndex=3 row centre at z=3, plus ~0.5 front-face overhang).
              const worldY = levelYObj * sc + groupY;
              const worldZ = 3.5 * sc;
              const pt = new THREE.Vector3(0, worldY, worldZ);
              pt.project(camera); // NDC: y=+1 top, y=-1 bottom
              if (pt.y < -0.92) {
                // row is below viewport â€” nudge zoom down until it fits
                let zoom = camera.zoom;
                for (let i = 0; i < 30; i++) {
                  zoom *= 0.96;
                  camera.zoom = zoom;
                  camera.updateProjectionMatrix();
                  const tp = new THREE.Vector3(0, worldY, worldZ);
                  tp.project(camera);
                  if (tp.y >= -0.92) break;
                }
                // recompute frustum planes for the adjusted zoom
                const canvas = gl.domElement;
                const w = Math.max(1, canvas.clientWidth || canvas.width);
                const h = Math.max(1, canvas.clientHeight || canvas.height);
                camera.left   = -w / 2 / zoom;
                camera.right  =  w / 2 / zoom;
                camera.top    =  h / 2 / zoom;
                camera.bottom = -h / 2 / zoom;
                camera.updateProjectionMatrix();
              }
            } catch (e) {}
          };
          const t1 = setTimeout(check, 700);
          const t2 = setTimeout(check, 1400);
          const pending = { id: null };
          const onResize = () => {
            if (pending.id) clearTimeout(pending.id);
            pending.id = setTimeout(check, 200);
          };
          window.addEventListener('chess3d:resize', onResize);
          return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            if (pending.id) clearTimeout(pending.id);
            window.removeEventListener('chess3d:resize', onResize);
          };
        }, [camera, gl]);
        return null;
      }

      // remount the Canvas after a resize finishes (debounced) to emulate full-refresh initialization.
      // Orientation changes use a separate, fully-suppressed path to prevent flash.
      useEffect(() => {
        const timer = { id: null };
        // Generic resize: debounce to 350ms, skip during menu animation or orient change.
        const handler = () => {
          try {
            if (window._chess3dMenuAnimating) return;
            if (window._chess3dOrientChanging) return;
            if (timer.id) clearTimeout(timer.id);
            timer.id = setTimeout(() => {
              if (window._chess3dMenuAnimating || window._chess3dOrientChanging) { timer.id = null; return; }
              try { setCanvasKey(k => k + 1); } catch (e) {}
              timer.id = null;
            }, 350);
          } catch (e) {}
        };
        // Orientation change: suppress ALL resize/remount handlers while the browser
        // animates the rotation, then do ONE clean remount after everything settles.
        const orientTimer = { id: null };
        const orientHandler = () => {
          try {
            // Immediately block all resize and R3FResize activity
            window._chess3dOrientChanging = true;
            if (timer.id) { clearTimeout(timer.id); timer.id = null; }
            if (orientTimer.id) { clearTimeout(orientTimer.id); orientTimer.id = null; }
            orientTimer.id = setTimeout(() => {
              try {
                // Clear stale saved camera values â€” they were calibrated for the old orientation
                try { localStorage.removeItem('camPos'); } catch (e) {}
                try { localStorage.removeItem('camTarget'); } catch (e) {}
                // Compute defaults for the NOW-settled orientation
                const isMob = window.innerWidth <= 480;
                const newPos    = isMob ? [0, 7, -10] : [0, 5, -10];
                const newTarget = isMob ? [0, 3.5, 0] : [0, 1.7, 0];
                setCamPos(newPos);
                setCamTarget(newTarget);
                // Lift the suppression flag, then do ONE canvas remount.
                // R3FResize will fire on mount (50/200/500 ms timers) with correct dimensions.
                window._chess3dOrientChanging = false;
                try { setCanvasKey(k => k + 1); } catch (e) {}
              } catch (e) {}
              orientTimer.id = null;
            }, 750);
          } catch (e) {}
        };
        window.addEventListener('resize', handler);
        window.addEventListener('orientationchange', orientHandler);
        return () => {
          window.removeEventListener('resize', handler);
          window.removeEventListener('orientationchange', orientHandler);
          if (timer.id) clearTimeout(timer.id);
          if (orientTimer.id) clearTimeout(orientTimer.id);
        };
      }, []);

      // Persistence helpers
      const SAVE_KEY = 'chess3d:local_state';
      const SERVER_ID_KEY = 'chess3d:server_id';
      const SERVER_TOKEN_KEY = 'chess3d:server_token';

      // Replay all coordMoves from the initial position and return an array of
      // { piecesState, currentTurn } snapshots (one per move, taken BEFORE the move is applied).
      // Used to rebuild statesHistoryRef when loading a saved game so play-through works.
      const replayToSnapshots = (coordMoves) => {
        try {
          if (!coordMoves || coordMoves.length === 0) return [];
          const parseCoord = (s) => ({
            z: parseInt(s[0], 10) - 1,       // level 1-4 â†’ z 0-3
            y: s.charCodeAt(1) - 97,          // a-d â†’ 0-3
            x: 8 - parseInt(s[2], 10)          // rank 1-8 â†’ x 7-0
          });
          let pieces = getInitialPieces();
          const snapshots = [];
          let turn = 'white';
          for (const coordMove of coordMoves) {
            if (!coordMove || coordMove.length < 6) continue;
            const from = parseCoord(coordMove.slice(0, 3));
            const to   = parseCoord(coordMove.slice(3, 6));
            // snapshot BEFORE this move
            snapshots.push({ piecesState: pieces.map(p => ({ ...p })), currentTurn: turn });
            const mover = pieces.find(p => p.x === from.x && p.y === from.y && p.z === from.z);
            if (!mover) { turn = turn === 'white' ? 'black' : 'white'; continue; }
            let target = { ...to };
            // Castle detection: king moves â‰¥2 steps in Y or Z
            if (mover.t === 'K') {
              const dy = Math.abs(to.y - from.y);
              const dz = Math.abs(to.z - from.z);
              if (dy >= 2 || dz >= 2) {
                let rookId = null, rookTo = null;
                if (dy >= 2) {
                  const rookY = to.y > from.y ? 3 : 0;
                  const rook = pieces.find(p => p.t === 'R' && p.color === mover.color && p.x === from.x && p.y === rookY && p.z === from.z && !p.hasMoved);
                  if (rook) { rookId = rook.id; rookTo = { x: from.x, y: from.y, z: from.z }; }
                } else {
                  const rookZ = to.z > from.z ? 3 : 0;
                  const rook = pieces.find(p => p.t === 'R' && p.color === mover.color && p.x === from.x && p.y === from.y && p.z === rookZ && !p.hasMoved);
                  if (rook) { rookId = rook.id; rookTo = { x: from.x, y: from.y, z: from.z }; }
                }
                if (rookId) target = { ...to, castle: { rookId, rookTo } };
              }
            }
            // En-passant detection: pawn moves diagonally to an empty square
            if (mover.t === 'p') {
              const diagonal = Math.abs(to.y - from.y) === 1 || Math.abs(to.z - from.z) === 1;
              if (diagonal) {
                const destOcc = pieces.find(p => p.x === to.x && p.y === to.y && p.z === to.z);
                if (!destOcc) {
                  const cap = pieces.find(p => p.t === 'p' && p.color !== mover.color && p.x === from.x && p.y === to.y && p.z === to.z);
                  if (cap) target = { ...to, capturedId: cap.id };
                }
              }
            }
            pieces = simulateMove(pieces, mover.id, target);
            turn = turn === 'white' ? 'black' : 'white';
          }
          return snapshots;
        } catch (e) { console.debug('replayToSnapshots error', e); return []; }
      };

      const exportGame = () => {
        try {
          // build a human-readable move notation array for easier inspection
          const moveNotation = (moveHistory || []).map((mv, idx) => {
            const white = mv && mv.white ? mv.white : '';
            const black = mv && mv.black ? mv.black : '';
            const left = `${idx + 1}. ${white}`.trim();
            return black ? `${left} ${black}` : left;
          });
          const payload = { piecesState, moveHistory, moveNotation, coordMoveHistory, currentTurn, lastMove, aiSide, gameStarted };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `chess3d-save-${new Date().toISOString()}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (e) { console.debug('export error', e); }
      };

      const importGame = async (file) => {
        try {
          const text = await file.text();
          const obj = JSON.parse(text);
          if (obj && obj.piecesState) {
            // Calculate the move count from imported history
            const importedMoveCount = (obj.moveHistory || []).reduce((sum, entry) => {
              return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
            }, 0);
            // Set ref to current count - 1 so AI knows it should play for this position
            aiLastMoveCountRef.current = importedMoveCount - 1;
            try { console.log('importGame: Set aiLastMoveCountRef to', importedMoveCount - 1, 'for imported history with', importedMoveCount, 'moves'); } catch (e) {}
            // Update prevMoveHistoryRef immediately so duplicate detection works correctly
            prevMoveHistoryRef.current = (obj.moveHistory || []).slice();
            const importedCoord = obj.coordMoveHistory || [];
            coordMoveHistoryRef.current = importedCoord.slice();
            setPiecesState(obj.piecesState);
            setMoveHistory(obj.moveHistory || []);
            setCoordMoveHistory(importedCoord);
            setCurrentTurn(obj.currentTurn || 'white');
            setLastMove(obj.lastMove || null);
            try { setAiSide(obj.aiSide || null); } catch (e) {}
            try { setGameStarted(!!obj.gameStarted); } catch (e) {}
            // Rebuild play-through snapshots from coord move history
            statesHistoryRef.current = replayToSnapshots(importedCoord);
            // Immediately push a snapshot of the loaded state for correct take-back behavior
            try {
              const snap = {
                piecesState: obj.piecesState ? obj.piecesState.map(p => ({ ...p })) : [],
                moveHistory: (obj.moveHistory || []).slice(),
                coordMoveHistory: (importedCoord || []).slice(),
                currentTurn: obj.currentTurn || 'white',
                lastMove: obj.lastMove || null,
                aiSide: obj.aiSide || null,
                gameStarted: true, // Always true for loaded games
                halfMoveClock: obj.halfMoveClock || 0,
              };
              statesHistoryRef.current.push(snap);
              if (typeof pushDebug === 'function') pushDebug('pushedSnapshotAfterLoad', { depth: statesHistoryRef.current.length });
            } catch (e) { console.debug('pushStateSnapshot after load failed', e); }
            setViewIndex(null);
            setViewedPieces(null);
            alert('Game imported');
          } else alert('Invalid file');
        } catch (e) { alert('Import failed'); }
      };

      const loadPuzzleAt = useCallback((nextIndex, overrideSet) => {
        try {
          const puzzles = Array.isArray(overrideSet) ? overrideSet : puzzleSet;
          if (!puzzles || puzzles.length === 0) return false;
          const safeIndex = ((nextIndex % puzzles.length) + puzzles.length) % puzzles.length;
          const puzzle = puzzles[safeIndex];
          const parsed = parseFen(puzzle.fen);
          const humanSide = puzzle.solutionSide === 'b' ? 'black' : puzzle.solutionSide === 'w' ? 'white' : (parsed.currentTurn || 'white');
          const puzzleAiSide = humanSide === 'white' ? 'black' : 'white';

          if (searchStateRef.current) searchStateRef.current.cancelled = true;
          if (aiTimeoutRef.current.id) {
            clearTimeout(aiTimeoutRef.current.id);
            aiTimeoutRef.current = { id: null, moveCount: null };
          }

          aiLastMoveCountRef.current = -1;
          coordMoveHistoryRef.current = [];
          statesHistoryRef.current = [];
          prevMoveHistoryRef.current = [];
          prevPiecesRef.current = (parsed.pieces || []).map(p => ({ ...p }));

          setPiecesState(parsed.pieces || []);
          setMoveHistory([]);
          setCoordMoveHistory([]);
          setCurrentTurn(parsed.currentTurn || 'white');
          setLastMove(parsed.lastMove || null);
          setAiStrength('smarter');
          setAiSide(puzzleAiSide);
          setSelectedPieceId(null);
          setGameOver(false);
          setGameWinner(null);
          setShowGameOverModal(false);
          setStatusMessage('');
          setBoardFlipped(humanSide === 'black');
          setHalfMoveClock(parsed.halfMoveClock || 0);
          setRepetitionCount(0);
          setAiPaused(false);
          setAiThinking(false);
          setViewIndex(null);
          setViewedPieces(null);
          setGameMode('puzzle');
          setPuzzleIndex(safeIndex);
          setPuzzlePlayerSide(humanSide);
          setPuzzleAttempted(false);
          setPuzzleSolved(false);
          setPuzzleStatus('');
          setGameStarted(true);
          return true;
        } catch (e) {
          console.debug('loadPuzzleAt failed', e);
          alert(`Puzzle load failed: ${e.message || e}`);
          return false;
        }
      }, [puzzleSet]);

      const loadRandomPuzzle = useCallback(() => {
        const puzzles = puzzleSet;
        if (!puzzles || puzzles.length === 0) return false;
        if (puzzles.length === 1) return loadPuzzleAt(0);

        let nextIndex = puzzleIndex;
        while (nextIndex === puzzleIndex) {
          nextIndex = Math.floor(Math.random() * puzzles.length);
        }
        return loadPuzzleAt(nextIndex);
      }, [puzzleSet, puzzleIndex, loadPuzzleAt]);

      const getRandomPuzzleIndex = useCallback((puzzles, currentIndex = null) => {
        if (!puzzles || puzzles.length === 0) return -1;
        if (puzzles.length === 1) return 0;

        let nextIndex = currentIndex;
        while (nextIndex === currentIndex) {
          nextIndex = Math.floor(Math.random() * puzzles.length);
        }
        return nextIndex;
      }, []);

      useEffect(() => {
        const params = getQueryParams();
        if (!('matein2' in params)) return;
        if (!defaultPuzzleSet.length) return;

        setPuzzleSet(defaultPuzzleSet);

        let nextIndex;
        if (params.matein2 === '' || params.matein2 === 'random') {
          nextIndex = getRandomPuzzleIndex(defaultPuzzleSet);
        } else {
          const parsedIndex = Number(params.matein2);
          nextIndex = Number.isFinite(parsedIndex)
            ? Math.max(0, Math.min(defaultPuzzleSet.length - 1, Math.floor(parsedIndex)))
            : getRandomPuzzleIndex(defaultPuzzleSet);
        }

        loadPuzzleAt(nextIndex, defaultPuzzleSet);
      }, [defaultPuzzleSet, getRandomPuzzleIndex, loadPuzzleAt]);

      const importPuzzleFile = async (file) => {
        try {
          const text = await file.text();
          const puzzles = parsePuzzleText(text);
          if (!puzzles.length) {
            alert('No puzzles found in file');
            return;
          }
          setPuzzleSet(puzzles);
          loadPuzzleAt(getRandomPuzzleIndex(puzzles), puzzles);
          alert(`Loaded ${puzzles.length} puzzles`);
        } catch (e) {
          alert(`Puzzle import failed: ${e.message || e}`);
        }
      };

      const saveToLocal = () => {
        try {
          const payload = { piecesState, moveHistory, coordMoveHistory, currentTurn, lastMove, aiSide, gameStarted };
          localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
          alert('Saved locally');
        } catch (e) { alert('Local save failed'); }
      };

      const loadFromLocal = () => {
        try {
          const txt = localStorage.getItem(SAVE_KEY);
          if (!txt) { alert('No local save'); return; }
          const obj = JSON.parse(txt);
          // Calculate the move count from loaded history
          const loadedMoveCount = (obj.moveHistory || []).reduce((sum, entry) => {
            return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
          }, 0);
          // Set ref to current count - 1 so AI knows it should play for this position
          aiLastMoveCountRef.current = loadedMoveCount > 0 ? (loadedMoveCount - 1) : -1;
          try { 
            console.log('loadFromLocal: BEFORE setState', {
              loadedMoveCount,
              refSetTo: aiLastMoveCountRef.current,
              loadedHistory: obj.moveHistory,
              loadedTurn: obj.currentTurn,
              loadedAiSide: obj.aiSide
            }); 
          } catch (e) {}
          // Update prevMoveHistoryRef immediately so duplicate detection works correctly
          prevMoveHistoryRef.current = (obj.moveHistory || []).slice();
          const localCoord = obj.coordMoveHistory || [];
          coordMoveHistoryRef.current = localCoord.slice();
          setPiecesState(obj.piecesState || []);
          setMoveHistory(obj.moveHistory || []);
          setCoordMoveHistory(localCoord);
          setCurrentTurn(obj.currentTurn || 'white');
          setLastMove(obj.lastMove || null);
          try { setAiSide(obj.aiSide || null); } catch (e) {}
          try { setGameStarted(!!obj.gameStarted); } catch (e) {}
          // Rebuild play-through snapshots
          statesHistoryRef.current = replayToSnapshots(localCoord);
          setViewIndex(null);
          setViewedPieces(null);
        } catch (e) { alert('Local load failed'); }
      };

      const saveToServer = async () => {
        try {
          const payload = { state: { piecesState, moveHistory, coordMoveHistory, currentTurn, lastMove, aiSide, gameStarted } };
          const existingId = localStorage.getItem(SERVER_ID_KEY);
          const ownerToken = localStorage.getItem(SERVER_TOKEN_KEY);
          if (existingId) {
            // update
            const resp = await fetch(`${API_BASE_URL}/api/games/${existingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: payload.state, ownerToken }) });
            if (!resp.ok) {
              if (resp.status === 404) {
                // Game not found, clear localStorage and create new
                console.log('Game not found, creating new game');
                localStorage.removeItem(SERVER_ID_KEY);
                localStorage.removeItem(SERVER_TOKEN_KEY);
                // Fall through to create new game
              } else {
                throw new Error('update failed');
              }
            } else {
              console.log('Saved to server (updated)');
              return;
            }
          }
          const resp = await fetch(`${API_BASE_URL}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: payload.state }) });
          if (!resp.ok) {
            const errorText = await resp.text();
            console.error('Server save failed:', resp.status, errorText);
            throw new Error('save failed');
          }
          const j = await resp.json();
          if (j.id && j.ownerToken) {
            localStorage.setItem(SERVER_ID_KEY, j.id);
            localStorage.setItem(SERVER_TOKEN_KEY, j.ownerToken);
            console.log(`Saved to server. ID: ${j.id}`);
          }
        } catch (e) { 
          console.error('Server save error:', e.message, e);
          alert(`Server save failed: ${e.message}`); 
        }
      };

      // immediate save helper that accepts an explicit state object to avoid races
      async function saveToServerImmediate(explicitState) {
        try {
          const payloadState = explicitState || { piecesState, moveHistory, currentTurn, lastMove, aiSide, gameStarted };
          try { console.log('saveToServerImmediate payloadState', payloadState); } catch (e) {}
          const existingId = localStorage.getItem(SERVER_ID_KEY);
          const ownerToken = localStorage.getItem(SERVER_TOKEN_KEY);
          if (existingId) {
            const resp = await fetch(`${API_BASE_URL}/api/games/${existingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: payloadState, ownerToken }) });
            if (!resp.ok) {
              if (resp.status === 404) {
                // Game not found, clear localStorage and create new
                console.log('Game not found, creating new game');
                localStorage.removeItem(SERVER_ID_KEY);
                localStorage.removeItem(SERVER_TOKEN_KEY);
                // Fall through to create new game
              } else {
                throw new Error('update failed');
              }
            } else {
              console.log('Saved to server (updated)');
              return;
            }
          }
          const resp = await fetch(`${API_BASE_URL}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: payloadState }) });
          if (!resp.ok) throw new Error('save failed');
          const j = await resp.json();
          if (j.id && j.ownerToken) {
            localStorage.setItem(SERVER_ID_KEY, j.id);
            localStorage.setItem(SERVER_TOKEN_KEY, j.ownerToken);
            console.log(`Saved to server. ID: ${j.id}`);
          }
        } catch (e) { console.debug('server immediate save failed', e); }
      }

      

      // debug: log moveHistory whenever it changes
      useEffect(() => {
        try { console.log('moveHistory state now', moveHistory); } catch (e) {}
      }, [moveHistory]);

      const loadFromServer = async (idPrompt) => {
        try {
          const id = idPrompt || prompt('Enter game id to load:');
          if (!id) return;
          const resp = await fetch(`${API_BASE_URL}/api/games/${id}`);
          if (!resp.ok) { 
            console.log(`Load failed: ${resp.status} ${resp.statusText}`);
            if (resp.status === 404) {
              // Game not found - clear localStorage
              localStorage.removeItem(SERVER_ID_KEY);
              localStorage.removeItem(SERVER_TOKEN_KEY);
              console.log('Game not found, cleared localStorage');
              return;
            }
            alert(`Load failed: ${resp.status}`); 
            return; 
          }
          const j = await resp.json();
          if (j && (j.state || j.stateJson)) {
            // Parse stateJson if present (new API), otherwise use state (legacy)
            const s = j.stateJson ? JSON.parse(j.stateJson) : j.state;
            // Calculate the move count from loaded history
            const loadedMoveCount = (s.moveHistory || []).reduce((sum, entry) => {
              return sum + (entry.white ? 1 : 0) + (entry.black ? 1 : 0);
            }, 0);
            // Set ref to current count - 1 so AI knows it should play for this position
            // IMPORTANT: Use -1 for empty history so AI can play first move
            aiLastMoveCountRef.current = loadedMoveCount > 0 ? (loadedMoveCount - 1) : -1;
            try { 
              console.log('loadFromServer: BEFORE setState', {
                loadedMoveCount,
                refSetTo: aiLastMoveCountRef.current,
                loadedHistory: s.moveHistory,
                loadedTurn: s.currentTurn,
                loadedAiSide: s.aiSide
              }); 
            } catch (e) {}
            // Update prevMoveHistoryRef immediately so duplicate detection works correctly
            prevMoveHistoryRef.current = (s.moveHistory || []).slice();
            const serverCoord = s.coordMoveHistory || [];
            coordMoveHistoryRef.current = serverCoord.slice();
            setPiecesState(s.piecesState || []);
            setMoveHistory(s.moveHistory || []);
            setCoordMoveHistory(serverCoord);
            setCurrentTurn(s.currentTurn || 'white');
            setLastMove(s.lastMove || null);
            try { setAiSide(s.aiSide || null); } catch (e) {}
            try { setGameStarted(!!s.gameStarted); } catch (e) {}
            // store id/token for future updates
            if (j.id && j.ownerToken) {
              localStorage.setItem(SERVER_ID_KEY, j.id);
              localStorage.setItem(SERVER_TOKEN_KEY, j.ownerToken);
            }
            // Rebuild play-through snapshots from coord move history
            statesHistoryRef.current = replayToSnapshots(serverCoord);
            setViewIndex(null);
            setViewedPieces(null);
            try { 
              console.log('loadFromServer: AFTER setState calls (async, may not be applied yet)', {
                refNow: aiLastMoveCountRef.current
              }); 
            } catch (e) {}
            alert('Loaded from server');
          }
        } catch (e) { alert('Server load failed'); }
      };

      // auto-load server save if present
      // Query-string override: ?autoplay[&strength=smart|smarter|dumb][&delay=1500]
      // Starts an AI-vs-AI game immediately, skipping any server-saved state.
      const suppressAutoSaveRef = useRef(false);
      useEffect(() => {
        (async () => {
          try {
            const params = new URLSearchParams(window.location.search);
            if (params.has('autoplay')) {
              // Apply optional overrides from query string
              const qs = params.get('strength');
              const qd = params.get('delay');
              if (qs && ['smart','smarter','dumb'].includes(qs)) setAiStrength(qs);
              if (qd && !isNaN(Number(qd))) setAiDelay(Number(qd));
              // Start a fresh AI vs AI game â€” do NOT load from server
              resetGame();
              setAiSide('both');
              setGameStarted(true);
              return;
            }
            if (params.has('matein2')) {
              return;
            }
            const id = localStorage.getItem(SERVER_ID_KEY);
            if (id) {
              suppressAutoSaveRef.current = true;
              await loadFromServer(id);
              // allow a short grace period before auto-saving again
              setTimeout(() => { suppressAutoSaveRef.current = false; }, 100);
            }
          } catch (e) {}
        })();
      }, []);

      // autosave to server after moves/pieces change (debounced)
      // Skipped entirely in AI-vs-AI mode to avoid hammering the server every move.
      useEffect(() => {
        if (suppressAutoSaveRef.current) return;
        if (aiSide === 'both') return; // autoplay: no server saves
        if (gameMode === 'puzzle') return;
        const timer = setTimeout(() => {
          try { saveToServer(); } catch (e) { console.debug('autosave failed', e); }
        }, 500);
        return () => clearTimeout(timer);
      }, [piecesState, moveHistory, currentTurn, lastMove, aiSide, gameStarted, gameMode]);

      useAiOrchestration({
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
      });

      // keep OrbitControls enabled state in sync with pointer interaction/dragging
      useEffect(() => {
        try {
          if (controlsRef.current) {
            controlsRef.current.enabled = !pointerActive && !isDragging;
          }
        } catch (e) {}
      }, [pointerActive, isDragging, controlsRef]);

      // handle browser resize: update camera aspect and controls so canvas reflows correctly
      useEffect(() => {
        const onResize = () => {
          try {
            const canvas = document.querySelector('canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            // update camera aspect if available
            try {
              const cam = controlsRef && controlsRef.current && controlsRef.current.object;
              if (cam && typeof cam.aspect === 'number') {
                const w = Math.max(1, rect.width);
                const h = Math.max(1, rect.height);
                cam.aspect = w / h;
                if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
                // reapply saved camera position/target to avoid visual shift
                try {
                  if (Array.isArray(camPos) && camPos.length === 3) {
                    cam.position.set(camPos[0], camPos[1], camPos[2]);
                  }
                  const c = controlsRef && controlsRef.current;
                  if (c && c.target && Array.isArray(camTarget) && camTarget.length === 3) {
                    c.target.set(camTarget[0], camTarget[1], camTarget[2]);
                  }
                } catch (e) {}
              }
            } catch (e) {}
            // force controls update and dispatch a single resize event
            try { if (controlsRef && controlsRef.current && typeof controlsRef.current.update === 'function') controlsRef.current.update(); } catch (e) {}
            try { window.dispatchEvent(new Event('chess3d:resize')); } catch (e) {}
          } catch (e) {}
        };
        window.addEventListener('resize', onResize);
        // call once shortly after mount to settle layout
        setTimeout(onResize, 100);
        return () => window.removeEventListener('resize', onResize);
      }, [controlsRef, camPos, camTarget]);



      // â”€â”€ Play-through derived state (used in both sidebar header and desktop overlay) â”€â”€
      const ptSnapLen = statesHistoryRef.current.length;
      const ptCanPlay = gameStarted && (aiSide !== 'both' || aiPaused || gameOver);
      const ptAtLive = viewIndex === null;
      const ptAtBeginning = viewIndex === 0;
      const ptShowBack = ptCanPlay && ptSnapLen > 0 && !ptAtBeginning;
      const ptShowForward = ptCanPlay && !ptAtLive;
      const ptBtnBase = {
        background: 'rgba(30,30,30,0.85)', color: '#fff',
        border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: '50%',
        width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
        userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation',
        flexShrink: 0,
      };
      const ptGoBack1 = () => navigatePlayThrough(ptAtLive ? ptSnapLen - 1 : viewIndex - 1);
      const ptGoBackAll = () => navigatePlayThrough(0);
      const ptGoFwd1 = () => navigatePlayThrough(viewIndex + 1 >= ptSnapLen ? null : viewIndex + 1);
      const ptGoFwdAll = () => navigatePlayThrough(null);

      return (
        <>
        <div className="layout">
                <aside className="sidebar" ref={sidebarRef}>
            <div className="sidebar-header">
              <h2 className="title">Quadlevel 3D Chess</h2>
              {isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* Play-through nav buttons â€” live in header bar on mobile */}
                  {ptShowBack && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <button onClick={ptGoBackAll} title="First move" style={ptBtnBase}>&#9198;</button>
                      <button onClick={ptGoBack1}   title="Previous move" style={ptBtnBase}>&#9664;</button>
                    </div>
                  )}
                  {ptShowForward && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <button onClick={ptGoFwd1}   title="Next move"  style={ptBtnBase}>&#9654;</button>
                      <button onClick={ptGoFwdAll} title="Live (end)" style={ptBtnBase}>&#9197;</button>
                    </div>
                  )}
                  {(ptShowBack || ptShowForward) && <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)', margin: '0 2px' }} />}
                  <button
                    onClick={toggleFullscreen}
                    aria-label="Toggle fullscreen"
                    title={isIOS ? 'Add to Home Screen for full-screen' : (isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen')}
                    style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', padding: '4px 6px', lineHeight: 1, opacity: 0.85 }}
                  >
                    {isIOS ? <>&#x2922;</> : (isFullscreen ? <>&#x2921;</> : <>&#x2922;</>)}
                  </button>
                  <button 
                    className="hamburger-button" 
                    onClick={() => {
                      // flag that the menu is animating (0.3s CSS transition + buffer)
                      // so resize handlers triggered by the layout shift don't remount the canvas
                      window._chess3dMenuAnimating = true;
                      if (window._chess3dMenuAnimTimer) clearTimeout(window._chess3dMenuAnimTimer);
                      window._chess3dMenuAnimTimer = setTimeout(() => { window._chess3dMenuAnimating = false; }, 450);
                      setMobileMenuOpen(!mobileMenuOpen);
                    }}
                    aria-label="Toggle menu"
                  >
                    <span className="hamburger-icon">{mobileMenuOpen ? <>&#10005;</> : <>&#9776;</>}</span>
                  </button>
                </div>
              )}
            </div>
            <div className={`menu ${isMobile && !mobileMenuOpen ? 'menu-collapsed' : ''}`}>
              {!gameStarted && isMobile && !mobileMenuOpen ? setMobileMenuOpen(true) : null}
              {!gameStarted ? (
                <>
                  <button className="menu-button" onClick={() => { resetGame(); setGameMode('standard'); setAiSide(null); setGameStarted(true); setMobileMenuOpen(false); }}>
                    Play 2-Player
                  </button>
                  <button className="menu-button" onClick={() => { resetGame(); setGameMode('standard'); setAiSide('white'); setBoardFlipped(true); setGameStarted(true); setMobileMenuOpen(false); }}>
                    Play AI White
                  </button>
                  <button className="menu-button" onClick={() => { resetGame(); setGameMode('standard'); setAiSide('black'); setGameStarted(true); setMobileMenuOpen(false); }}>
                    Play AI Black
                  </button>
                  <button className="menu-button" onClick={() => { resetGame(); setGameMode('standard'); setAiSide('both'); setGameStarted(true); setMobileMenuOpen(false); }}>
                    Watch AI vs AI
                  </button>
                  <button className="menu-button" onClick={() => { setPuzzleSet(defaultPuzzleSet); loadPuzzleAt(getRandomPuzzleIndex(defaultPuzzleSet), defaultPuzzleSet); setMobileMenuOpen(false); }}>
                    Mate in two puzzles
                  </button>
                  <hr />
                  <input ref={importInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files[0]) { importGame(e.target.files[0]); setGameStarted(true); } e.target.value = null; }} />
                  <input ref={puzzleInputRef} type="file" accept=".txt,.fen,.puzzles,text/plain" style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files[0]) importPuzzleFile(e.target.files[0]); e.target.value = null; }} />
                  <button className="menu-button" onClick={() => { importInputRef.current && importInputRef.current.click(); setMobileMenuOpen(false); }}>Import Game</button>
                  <hr />
                  {aiSide && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
                      AI: 
                      <select value={aiStrength} onChange={e => setAiStrength(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="smart">Smart AI</option>
                        <option value="smarter">Smarter AI</option>
                        <option value="dumb">Dumb AI</option>
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <>
                <button className="menu-button" onClick={() => { resetGame(); setGameMode('standard'); setAiSide(null); setGameStarted(false); if (isMobile) setMobileMenuOpen(true); else setMobileMenuOpen(false); }}>
                  Start a new game
                </button>
              {gameMode === 'puzzle' && activePuzzle && (
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, marginBottom: 2 }}>
                  Puzzle {puzzleIndex + 1} / {puzzleSet.length} - Mate in 2
                </div>
              )}
              {aiSide && gameMode !== 'puzzle' && (
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, marginBottom: 2 }}>
                  Mode: {aiSide === 'both' ? 'AI vs AI' : `You vs AI (${aiSide})`}
                </div>
              )}
              <hr />
              {gameMode === 'puzzle' ? (
                <>
                  <button className="menu-button" onClick={() => { loadPuzzleAt(puzzleIndex); setMobileMenuOpen(false); }}>
                    Restart Puzzle
                  </button>
                  <ShowPuzzleAnswer activePuzzle={activePuzzle} />
                  <button className="menu-button" style={{ marginTop: 6 }} onClick={() => { loadRandomPuzzle(); setMobileMenuOpen(false); }}>
                    Next Puzzle
                  </button>
                </>
              ) : (
                <>
                  <button className="menu-button" onClick={() => { exportGame(); setMobileMenuOpen(false); }}>Export</button>
                  <input ref={importInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files && e.target.files[0]) { importGame(e.target.files[0]); setGameStarted(true); } e.target.value = null; }} />
                  {moveHistory.length === 0 && (
                    <button className="menu-button" style={{ marginTop: 6 }} onClick={() => { importInputRef.current && importInputRef.current.click(); setMobileMenuOpen(false); }}>Import</button>
                  )}
                  <button 
                    className="menu-button" 
                    style={{ marginTop: 6, fontSize: 12 }}
                    onClick={() => { takeBack(); setMobileMenuOpen(false); }} 
                    disabled={!(statesHistoryRef && statesHistoryRef.current && statesHistoryRef.current.length > 0) || (aiTimeoutRef.current && aiTimeoutRef.current.id)}
                    title={(aiTimeoutRef.current && aiTimeoutRef.current.id) ? "Cannot undo while AI is thinking" : ""}
                  >
                    Take Back
                  </button>
                </>
              )}
              <button
                className="menu-button"
                style={{ marginTop: 6, fontSize: 12 }}
                title="Reset camera to default position"
                onClick={() => {
                  try {
                    ['camPos','camTarget','camDefaultPos','camDefaultTarget'].forEach(k => localStorage.removeItem(k));
                    const isMob = window.innerWidth <= 480;
                    const newPos = isMob ? [0, 6.5, -10] : [0, 5, -10];  // matches initial camPos default
                    const newTarget = isMob ? [0, 3.5, 0] : [0, 1.7, 0];
                    setCamPos(newPos);
                    setCamTarget(newTarget);
                    if (controlsRef.current) {
                      const c = controlsRef.current;
                      if (c.object) c.object.position.set(...newPos);
                      if (c.target) c.target.set(...newTarget);
                      c.update();
                    }
                    window.dispatchEvent(new Event('chess3d:resize'));
                  } catch(e) {}
                  setMobileMenuOpen(false);
                }}
              >
                Reset Camera
              </button>
              {/* Resign button â€” available in active games (not AI vs AI, not already over) */}
              {gameMode !== 'puzzle' && aiSide !== 'both' && !gameOver && (
                <button
                  className="menu-button"
                  style={{ marginTop: 6, color: '#f87171', fontWeight: 'bold' }}
                  onClick={() => {
                    const resigningSide = aiSide === 'white' ? 'black' : aiSide === 'black' ? 'white' : currentTurn;
                    const winner = resigningSide === 'white' ? 'black' : 'white';
                    setGameOver(true);
                    setGameWinner(winner);
                    setStatusMessage(`${resigningSide.charAt(0).toUpperCase() + resigningSide.slice(1)} resigns. ${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`);
                    setMobileMenuOpen(false);
                  }}
                >
                  Resign
                </button>
              )}
              {/* Claim Draw (threefold repetition) â€” 2-player only, visible when same position has occurred 3 times */}
              {gameMode !== 'puzzle' && !aiSide && repetitionCount >= 3 && !gameOver && (
                <button
                  className="menu-button"
                  style={{ marginTop: 6, color: '#c8a000', fontWeight: 'bold' }}
                  onClick={() => { setGameOver(true); setGameWinner(null); setStatusMessage('Draw: threefold repetition (claimed)'); setMobileMenuOpen(false); }}
                >
                  Claim Draw (repetition)
                </button>
              )}
              {/* Declare Draw â€” 2-player only, visible when 50-move rule threshold reached */}
              {gameMode !== 'puzzle' && !aiSide && halfMoveClock >= 100 && !gameOver && (
                <button
                  className="menu-button"
                  style={{ marginTop: 6, color: '#c8a000', fontWeight: 'bold' }}
                  onClick={() => { setGameOver(true); setGameWinner(null); setStatusMessage('Draw: 50-move rule (declared)'); setMobileMenuOpen(false); }}
                >
                  Declare Draw (50-move)
                </button>
              )}
              <hr />
              {aiSide && gameMode !== 'puzzle' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
                  AI: 
                  <select value={aiStrength} onChange={e => setAiStrength(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="smart">Smart AI</option>
                    <option value="smarter">Smarter AI</option>
                    <option value="dumb">Dumb AI</option>
                  </select>
                </label>
              )}
              {aiSide === 'both' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginTop: 4 }}>
                  Delay:&nbsp;
                  <select value={aiDelay} onChange={e => setAiDelay(Number(e.target.value))} style={{ fontSize: 12 }}>
                    <option value={500}>0.5s</option>
                    <option value={1000}>1s</option>
                    <option value={1500}>1.5s</option>
                    <option value={3000}>3s</option>
                    <option value={5000}>5s</option>
                    <option value={10000}>10s</option>
                  </select>
                </label>
              )}
              {aiSide === 'both' && !gameOver && (
                <button
                  className="menu-button"
                  style={{ marginTop: 6, fontWeight: 'bold', color: aiPaused ? '#4ade80' : '#f59e0b' }}
                  onClick={() => {
                    if (aiPaused) {
                      // Resume: reset ref so AI re-triggers for the current position
                      aiLastMoveCountRef.current = -1;
                      setAiPaused(false);
                    } else {
                      // Pause: cancel any pending timeout
                      if (aiTimeoutRef.current.id) {
                        clearTimeout(aiTimeoutRef.current.id);
                        aiTimeoutRef.current = { id: null, moveCount: null };
                        // Reset ref so AI can replay this position when resumed
                        aiLastMoveCountRef.current = -1;
                      }
                      setAiPaused(true);
                    }
                  }}
                >
                  {aiPaused ? 'Resume' : 'Pause'}
                </button>
              )}
              </>
              )
            }
            </div>
            {/* CHECK / CHECKMATE / DRAW indicator â€” always rendered at fixed height on mobile so
                the sidebar never resizes (which would repaint the canvas). */}
            <div style={isMobile ? { height: '28px', overflow: 'hidden', marginTop: '4px' } : {}}>
              {gameMode === 'puzzle' ? (
                <div style={{ color: puzzleSolved ? '#4ade80' : (puzzleStatus ? '#fbbf24' : '#93c5fd'), fontWeight: 'bold' }}>
                  {puzzleStatus || `MATE IN 2 - ${currentTurn === 'white' ? 'WHITE' : 'BLACK'} TO MOVE`}
                </div>
              ) : gameOver && statusMessage && statusMessage.toLowerCase().includes('checkmate') ? (
                <div style={{ color: 'red', fontWeight: 'bold' }}>CHECKMATE Winner: {gameWinner ? (gameWinner.charAt(0).toUpperCase() + gameWinner.slice(1)) : 'Unknown'}</div>
              ) : gameOver && statusMessage && statusMessage.toLowerCase().includes('draw') ? (
                <div style={{ color: '#c8a000', fontWeight: 'bold' }}>{statusMessage.toUpperCase()}</div>
              ) : gameOver && statusMessage && statusMessage.toLowerCase().includes('stalemate') ? (
                <div style={{ color: '#c8a000', fontWeight: 'bold' }}>STALEMATE â€” Draw</div>
              ) : gameOver && statusMessage && statusMessage.toLowerCase().includes('resign') ? (
                <div style={{ color: '#c8a000', fontWeight: 'bold' }}>RESIGNED</div>
              ) : gameOver ? (
                <div style={{ color: '#c8a000', fontWeight: 'bold' }}>GAME OVER</div>
              ) : (statusMessage && statusMessage.toLowerCase().includes('check') ? (
                <div style={{ color: 'red', fontWeight: 'bold' }}>CHECK</div>
              ) : null)}
            </div>

            <div style={{ marginTop: '10px', width: isMobile ? '100%' : 'auto', ...(isMobile ? {} : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }) }}>
              <div style={{ fontWeight: 'bold', marginBottom: '6px', flexShrink: 0 }}>Moves</div>
              <div ref={!isMobile ? moveListRef : null} style={{ fontFamily: 'monospace', fontSize: '13px', ...(isMobile ? { height: '72px', overflowY: 'hidden', overflowX: 'hidden' } : { overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }) }}>
                {moveHistory.length === 0 ? <div style={{ color: '#888' }}>no moves</div> : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {(isMobile ? moveHistory.slice(-2) : moveHistory).map((mv, idx) => {
                          const actualIdx = isMobile ? moveHistory.length - 2 + idx : idx;
                          if (actualIdx < 0) return null;
                          return (
                            <tr key={`mh-${actualIdx}`}>
                              <td style={{ width: '34px', paddingRight: '4px' }}>{actualIdx + 1}:</td>
                              <td style={{ width: '50%', paddingRight: '4px' }}>{moveHistory[actualIdx].white || ''}</td>
                              <td>{moveHistory[actualIdx].black || ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {isMobile && moveHistory.length > 2 && (
                      <button 
                        className="show-all-moves" 
                        onClick={() => setShowAllMoves(true)}
                      >
                        {`All (${moveHistory.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Mobile moves overlay â€” fixed panel over canvas, like the hamburger menu */}
            {isMobile && showAllMoves && (
              <div className="moves-overlay" onClick={() => setShowAllMoves(false)}>
                <div className="moves-overlay-panel" onClick={e => e.stopPropagation()}>
                  <div className="moves-overlay-header">
                    <span style={{ fontWeight: 'bold', fontSize: 14 }}>All Moves ({moveHistory.length})</span>
                    <button className="moves-overlay-close" onClick={() => setShowAllMoves(false)}>X</button>
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, fontFamily: 'monospace', fontSize: 13, padding: '0 4px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {moveHistory.map((mv, idx) => (
                          <tr key={`mh-all-${idx}`}>
                            <td style={{ width: '34px', paddingRight: '4px', color: '#aaa' }}>{idx + 1}:</td>
                            <td style={{ width: '50%', paddingRight: '4px' }}>{mv.white || ''}</td>
                            <td>{mv.black || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </aside>
          <main className="main">
            {/* â”€â”€ AI Thinking indicator â”€â”€ */}
            {aiThinking && aiSide !== 'both' && (
              <div style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 30,
                background: 'rgba(20, 20, 40, 0.72)',
                border: '1px solid rgba(150, 150, 220, 0.35)',
                borderRadius: 10,
                padding: '7px 22px',
                color: 'rgba(210, 210, 255, 0.85)',
                fontSize: 13,
                fontFamily: 'sans-serif',
                letterSpacing: '0.05em',
                pointerEvents: 'none',
                backdropFilter: 'blur(4px)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
              }}>
                Thinking&hellip;
              </div>
            )}
            {/* Play-through navigation overlay (desktop only; mobile uses sidebar header) */}
            {!isMobile && (ptShowBack || ptShowForward) && (
              <>
                {ptShowBack && (
                  <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
                    <button onClick={ptGoBackAll} title="First move" style={{ ...ptBtnBase, width: 36, height: 36, fontSize: 17, boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>&#9198;</button>
                    <button onClick={ptGoBack1}   title="Previous move" style={{ ...ptBtnBase, width: 36, height: 36, fontSize: 17, boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>&#9664;</button>
                  </div>
                )}
                {ptShowForward && (
                  <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
                    <button onClick={ptGoFwd1}   title="Next move" style={{ ...ptBtnBase, width: 36, height: 36, fontSize: 17, boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>&#9654;</button>
                    <button onClick={ptGoFwdAll} title="Live (end)" style={{ ...ptBtnBase, width: 36, height: 36, fontSize: 17, boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>&#9197;</button>
                  </div>
                )}
              </>
            )}
            <Canvas
              key={canvasKey}
              className="canvas"
              orthographic={true}
              camera={{ position: camPos, zoom: calcZoom(
                (() => { try { const r = document.querySelector('.main')?.getBoundingClientRect(); return r && r.width > 10 ? r.width : window.innerWidth; } catch(e) { return window.innerWidth; } })(),
                (() => { try { const r = document.querySelector('.main')?.getBoundingClientRect(); return r && r.height > 10 ? r.height : window.innerHeight; } catch(e) { return window.innerHeight; } })()
              ) }}
              onPointerMove={(e) => {
                try { pointerLastScreenRef.current = { x: e.clientX, y: e.clientY }; } catch {}
                // if pointer was pressed on a piece and user moved enough (screen-space), start dragging
                if (pointerDownRef.current && !isDragging && selectedPieceId != null && pointerStartScreenRef.current) {
                  const dx = e.clientX - pointerStartScreenRef.current.x;
                  const dy = e.clientY - pointerStartScreenRef.current.y;
                  const dist = Math.hypot(dx, dy);
                  // pixel threshold for consistent drag start (prevents accidental drags on clicks)
                  if (dist > DRAG_PIXEL_THRESHOLD) {
                    setIsDragging(true);
                    // clear pending click-on-same-piece because we've started a drag
                    try { pointerDownPieceRef.current = null; } catch {}
                    try { if (controlsRef.current) controlsRef.current.enabled = false; } catch {}
                  }
                }
                // update drag point while pointer is down (so piece follows cursor immediately) or when dragging
                // CRITICAL: Only update drag point if a piece is actually selected to avoid camera drags triggering moves
                if ((pointerDownRef.current || isDragging) && selectedPieceId != null) {
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
                // CRITICAL: Only process drop if we were actually dragging a selected piece
                if (isDragging && dragPointWorld && selectedPieceId != null) {
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
              {/* Diagnostic: log Canvas mount/unmount via a proper component */}
              <CanvasLogger canvasKey={canvasKey} />
              <ambientLight intensity={0.6} />
              <R3FResize />
              <BoardBoundsGuard />
              <directionalLight position={[5, 12, 5]} intensity={0.9} />
              <group ref={groupRef} scale={sceneScale} position={window.innerWidth <= 480 ? [-0.05, -0.4, 0] : [0, 0, 0]}>
                <QuadLevelBoard flipBoard={boardFlipped || ((currentTurn === 'black') && !aiSide)} lastMove={lastMove} />
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
                  showCastlePrompt={showCastlePrompt}
                  showPromotionPrompt={showPromotionPrompt}
                   kingGltf={kingGltf}
                   pawnGltf={pawnGltf}
                   knightGltf={knightGltf}
                   bishopGltf={bishopGltf}
                   rookGltf={rookGltf}
                   queenGltf={queenGltf}
                   clones={clones}
                  pointerDownPieceRef={pointerDownPieceRef}
                  pointerStartScreenRef={pointerStartScreenRef}
                  pointerLastScreenRef={pointerLastScreenRef}
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
                    setMoveHistory={setMoveHistory}
                    moveHistory={moveHistory}
                    gameOver={gameOver}
                    generateMoveNotation={generateMoveNotation}
                    moveLockRef={moveLockRef}
                    aiSide={aiSide}
                    pushStateSnapshot={pushStateSnapshot}
                    boardFlipped={boardFlipped}
                    coordMoveHistoryRef={coordMoveHistoryRef}
                    setCoordMoveHistory={setCoordMoveHistory}
                    onPuzzleHumanMove={handlePuzzleHumanMove}
                    inHistoryView={viewIndex !== null}
                    displayPiecesOverride={viewedPieces}
                />
                <Ghost dragPoint={dragPoint} dragPointWorld={dragPointWorld} selectedPieceId={selectedPieceId} piecesState={piecesState} isDragging={isDragging} pointerDownRef={pointerDownRef} kingGltf={kingGltf} pawnGltf={pawnGltf} knightGltf={knightGltf} bishopGltf={bishopGltf} rookGltf={rookGltf} queenGltf={queenGltf} clones={clones} currentTurn={currentTurn} />
                
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
                onStart={() => {
                  // Clear drag state when user starts camera interaction to prevent accidental moves
                  try {
                    setIsDragging(false);
                    setDragPointWorld(null);
                    pointerDownRef.current = false;
                  } catch {}
                }}
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
        {castlePrompt ? (
          <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ background: 'rgba(0,0,0,0.6)', position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <div style={{ zIndex: 9999, background: '#fff', padding: 20, borderRadius: 8, minWidth: 260, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', textAlign: 'center' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{castlePrompt.title || 'Confirm'}</div>
              <div style={{ marginBottom: 12, color: '#333' }}>Do you want to perform the castle-type move?</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => { try { castlePrompt.onYes && castlePrompt.onYes(); } catch (e) {} setCastlePrompt(null); }} style={{ padding: '6px 12px' }}>Yes</button>
                <button onClick={() => { try { castlePrompt.onNo && castlePrompt.onNo(); } catch (e) {} setCastlePrompt(null); }} style={{ padding: '6px 12px' }}>No</button>
              </div>
            </div>
          </div>
        ) : null}
        
        {promotionPrompt ? (
          <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', zIndex: 10000 }}>
            <div style={{ background: 'rgba(0,0,0,0.6)', position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <div style={{ zIndex: 10001, background: '#fff', padding: 20, borderRadius: 8, minWidth: 260, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', textAlign: 'center' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Promote Pawn</div>
              <div style={{ marginBottom: 12, color: '#333' }}>Choose a piece:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => { try { promotionPrompt.onSelect && promotionPrompt.onSelect('Q'); } catch (e) {} setPromotionPrompt(null); }} style={{ padding: '8px 12px', fontSize: '14px' }}>Queen</button>
                <button onClick={() => { try { promotionPrompt.onSelect && promotionPrompt.onSelect('N'); } catch (e) {} setPromotionPrompt(null); }} style={{ padding: '8px 12px', fontSize: '14px' }}>Knight</button>
                <button onClick={() => { try { promotionPrompt.onSelect && promotionPrompt.onSelect('R'); } catch (e) {} setPromotionPrompt(null); }} style={{ padding: '8px 12px', fontSize: '14px' }}>Rook</button>
                <button onClick={() => { try { promotionPrompt.onSelect && promotionPrompt.onSelect('B'); } catch (e) {} setPromotionPrompt(null); }} style={{ padding: '8px 12px', fontSize: '14px' }}>Bishop</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Game Over modal â€” appears on checkmate, stalemate, draw, or resignation */}
        {showGameOverModal && gameOver && (() => {
          let heading, sub, color;
          const msg = (statusMessage || '').toLowerCase();
          if (msg.includes('checkmate')) {
            heading = 'Checkmate!';
            sub = gameWinner ? `${gameWinner.charAt(0).toUpperCase() + gameWinner.slice(1)} wins!` : '';
            color = '#dc2626';
          } else if (msg.includes('resign')) {
            heading = 'Game Over';
            sub = statusMessage;
            color = '#b45309';
          } else if (msg.includes('stalemate')) {
            heading = 'Stalemate';
            sub = 'The game is a draw.';
            color = '#b45309';
          } else if (msg.includes('draw')) {
            heading = 'Draw';
            sub = statusMessage;
            color = '#b45309';
          } else {
            heading = 'Game Over';
            sub = statusMessage || '';
            color = '#374151';
          }
          return (
            <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', zIndex: 10002 }}>
              <div style={{ background: 'rgba(0,0,0,0.55)', position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onClick={() => {}} />
              <div style={{ zIndex: 10003, background: '#1f2937', color: '#fff', padding: '28px 24px', borderRadius: 12, minWidth: 280, maxWidth: '88vw', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', textAlign: 'center', position: 'relative' }}>
                <div style={{ fontSize: 26, fontWeight: 'bold', color, marginBottom: 8 }}>{heading}</div>
                {sub && <div style={{ fontSize: 15, color: '#d1d5db', marginBottom: 20 }}>{sub}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    onClick={() => {
                      if (gameMode === 'puzzle') {
                        loadRandomPuzzle();
                        setShowGameOverModal(false);
                        setMobileMenuOpen(false);
                      } else {
                        resetGame();
                        setGameMode('standard');
                        setAiSide(null);
                        setGameStarted(false);
                        setShowGameOverModal(false);
                        setMobileMenuOpen(false);
                      }
                    }}
                    style={{ padding: '10px 20px', borderRadius: 6, background: '#e5e7eb', color: '#111', border: 'none', fontWeight: 'bold', fontSize: 14, cursor: 'pointer' }}
                  >{gameMode === 'puzzle' ? 'Next Puzzle' : 'New Game'}</button>
                  <button
                    onClick={() => setShowGameOverModal(false)}
                    style={{ padding: '10px 20px', borderRadius: 6, background: '#374151', color: '#fff', border: 'none', fontWeight: 'bold', fontSize: 14, cursor: 'pointer' }}
                  >Dismiss</button>
                </div>
              </div>
            </div>
          );
        })()}


        </>
      );
    }
  //);
//}

