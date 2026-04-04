function normalizeCoordMove(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNotation(value) {
  return String(value || '').trim();
}

function normalizeSide(value) {
  const side = String(value || '').trim().toLowerCase();
  return side === 'w' || side === 'b' ? side : '';
}

export function parsePuzzleLine(line, index = 0) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  const match = raw.match(/^(.+?\s[wbWB]\s(?:-|[0-9a-fA-F]+)\s(?:-|[1-4][a-d][1-8])\s\d+\s\d+)(?:\|(.*))?$/);
  if (!match) {
    throw new Error(`Invalid puzzle format on line ${index + 1}`);
  }

  const fen = match[1].trim();
  const trailing = match[2] ? match[2].split('|').map(part => part.trim()) : [];

  const answerCoord = normalizeCoordMove(trailing[0]);
  let answerNotation = '';
  let solutionSide = '';

  if (trailing.length >= 3) {
    answerNotation = normalizeNotation(trailing[1]);
    solutionSide = normalizeSide(trailing[2]);
  } else if (trailing.length === 2) {
    if (normalizeSide(trailing[1])) solutionSide = normalizeSide(trailing[1]);
    else answerNotation = normalizeNotation(trailing[1]);
  }

  if (!answerCoord && !answerNotation) {
    throw new Error(`Puzzle line ${index + 1} is missing an answer move`);
  }

  return {
    id: index + 1,
    fen,
    answerCoord,
    answerNotation,
    solutionSide,
    raw,
  };
}

export function parsePuzzleText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));

  return lines.map((line, index) => parsePuzzleLine(line, index));
}

export function puzzleMoveMatches(puzzle, coordMove, notation) {
  if (!puzzle) return false;
  const normalizedCoord = normalizeCoordMove(coordMove);
  const normalizedNotation = normalizeNotation(notation);

  if (puzzle.answerCoord && normalizedCoord === puzzle.answerCoord) return true;
  if (puzzle.answerNotation && normalizedNotation === puzzle.answerNotation) return true;
  return false;
}