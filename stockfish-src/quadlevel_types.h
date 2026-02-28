/*
  QuadLevel 3D Chess — Core types
  Board geometry: 4 levels × 4 files × 8 ranks = 128 squares

  Axes:
    X = file  (a–d, 4 files)
    Y = rank  (1–8, distance axis between players)
    Z = level (1–4, vertical boards)

  Notation: {Level}{File}{Rank}  e.g. "2c4"

  CID (Change In Distance) — applies to ALL pieces on diagonal moves:
    • Diagonal moves must change Y (rank) — advance or retreat.
    • When changing Z (level), X (file) must be preserved.
    • Valid diagonal planes: X-Y (same level) and Y-Z (same file).
    • X-Z plane diagonals and full 3D diagonals are NEVER valid.
    • Rook-like straight moves (single axis) are always exempt.

  Rules reference: https://www.chess3d.com/rules.html
  Copyright © 1970 Robert Koernke Sr — engine adaptation
*/

#ifndef QUADLEVEL_TYPES_H_INCLUDED
#define QUADLEVEL_TYPES_H_INCLUDED

#include <cassert>
#include <cstdint>
#include <optional>
#include <string>

namespace QuadLevel {

// ─────────────────────────────────────────────
//  Board dimensions
// ─────────────────────────────────────────────

constexpr int NUM_LEVELS = 4;   // Z-axis: boards 1–4
constexpr int NUM_FILES  = 4;   // X-axis: a, b, c, d (half-board)
constexpr int NUM_RANKS  = 8;   // Y-axis: 1–8 (distance axis)
constexpr int SQUARE_NB  = NUM_LEVELS * NUM_FILES * NUM_RANKS;  // 128

static_assert(SQUARE_NB == 128);

constexpr int MAX_MOVES_3D = 512;
constexpr int MAX_PLY_3D   = 246;

// ─────────────────────────────────────────────
//  Enums
// ─────────────────────────────────────────────

enum Color : uint8_t { WHITE, BLACK, COLOR_NB = 2 };

constexpr Color operator~(Color c) { return Color(c ^ BLACK); }

enum Level : uint8_t { LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_NB = 4 };
enum File  : uint8_t { FILE_A, FILE_B, FILE_C, FILE_D, FILE_NB = 4 };
enum Rank  : uint8_t {
    RANK_1, RANK_2, RANK_3, RANK_4,
    RANK_5, RANK_6, RANK_7, RANK_8,
    RANK_NB = 8
};

// clang-format off
enum PieceType : uint8_t {
    NO_PIECE_TYPE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    ALL_PIECES    = 0,
    PIECE_TYPE_NB = 8
};

enum Piece : uint8_t {
    NO_PIECE,
    W_PAWN = PAWN,     W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN, W_KING,
    B_PAWN = PAWN + 8, B_KNIGHT, B_BISHOP, B_ROOK, B_QUEEN, B_KING,
    PIECE_NB = 16
};
// clang-format on

constexpr PieceType type_of(Piece pc) { return PieceType(pc & 7); }
constexpr Color     color_of(Piece pc) { assert(pc != NO_PIECE); return Color(pc >> 3); }
constexpr Piece     make_piece(Color c, PieceType pt) { return Piece((c << 3) + pt); }

// ─────────────────────────────────────────────
//  Piece values (QuadLevel estimated power, ×100)
//  Pawn 1 · Knight 2.85 · Bishop 2.85 · Rook 4 · Queen 8
// ─────────────────────────────────────────────

using Value = int;

constexpr Value VALUE_ZERO = 0;
constexpr Value VALUE_NONE = 32002;
constexpr Value VALUE_MATE = 32000;

constexpr Value PawnValue3D   = 100;
constexpr Value KnightValue3D = 285;
constexpr Value BishopValue3D = 285;
constexpr Value RookValue3D   = 400;
constexpr Value QueenValue3D  = 800;

constexpr Value PieceValue3D[PIECE_NB] = {
    VALUE_ZERO, PawnValue3D, KnightValue3D, BishopValue3D,
    RookValue3D, QueenValue3D, VALUE_ZERO, VALUE_ZERO,
    VALUE_ZERO, PawnValue3D, KnightValue3D, BishopValue3D,
    RookValue3D, QueenValue3D, VALUE_ZERO, VALUE_ZERO
};

// ─────────────────────────────────────────────
//  Square (0–127, SQ_NONE = 128)
//  Encoding: level*32 + rank*4 + file
// ─────────────────────────────────────────────

enum Square : uint8_t {
    // Level 1 (0–31)
    SQ_1A1, SQ_1B1, SQ_1C1, SQ_1D1,  SQ_1A2, SQ_1B2, SQ_1C2, SQ_1D2,
    SQ_1A3, SQ_1B3, SQ_1C3, SQ_1D3,  SQ_1A4, SQ_1B4, SQ_1C4, SQ_1D4,
    SQ_1A5, SQ_1B5, SQ_1C5, SQ_1D5,  SQ_1A6, SQ_1B6, SQ_1C6, SQ_1D6,
    SQ_1A7, SQ_1B7, SQ_1C7, SQ_1D7,  SQ_1A8, SQ_1B8, SQ_1C8, SQ_1D8,
    // Level 2 (32–63)
    SQ_2A1, SQ_2B1, SQ_2C1, SQ_2D1,  SQ_2A2, SQ_2B2, SQ_2C2, SQ_2D2,
    SQ_2A3, SQ_2B3, SQ_2C3, SQ_2D3,  SQ_2A4, SQ_2B4, SQ_2C4, SQ_2D4,
    SQ_2A5, SQ_2B5, SQ_2C5, SQ_2D5,  SQ_2A6, SQ_2B6, SQ_2C6, SQ_2D6,
    SQ_2A7, SQ_2B7, SQ_2C7, SQ_2D7,  SQ_2A8, SQ_2B8, SQ_2C8, SQ_2D8,
    // Level 3 (64–95)
    SQ_3A1, SQ_3B1, SQ_3C1, SQ_3D1,  SQ_3A2, SQ_3B2, SQ_3C2, SQ_3D2,
    SQ_3A3, SQ_3B3, SQ_3C3, SQ_3D3,  SQ_3A4, SQ_3B4, SQ_3C4, SQ_3D4,
    SQ_3A5, SQ_3B5, SQ_3C5, SQ_3D5,  SQ_3A6, SQ_3B6, SQ_3C6, SQ_3D6,
    SQ_3A7, SQ_3B7, SQ_3C7, SQ_3D7,  SQ_3A8, SQ_3B8, SQ_3C8, SQ_3D8,
    // Level 4 (96–127)
    SQ_4A1, SQ_4B1, SQ_4C1, SQ_4D1,  SQ_4A2, SQ_4B2, SQ_4C2, SQ_4D2,
    SQ_4A3, SQ_4B3, SQ_4C3, SQ_4D3,  SQ_4A4, SQ_4B4, SQ_4C4, SQ_4D4,
    SQ_4A5, SQ_4B5, SQ_4C5, SQ_4D5,  SQ_4A6, SQ_4B6, SQ_4C6, SQ_4D6,
    SQ_4A7, SQ_4B7, SQ_4C7, SQ_4D7,  SQ_4A8, SQ_4B8, SQ_4C8, SQ_4D8,

    SQ_NONE     = 128,
    SQUARE_ZERO = 0
};

constexpr bool is_ok(Square s) { return s < SQUARE_NB; }

// ─────────────────────────────────────────────
//  Coordinate decomposition (safe axis access)
// ─────────────────────────────────────────────

struct Coord {
    int level, file, rank;
};

constexpr Square make_square(Level l, File f, Rank r) {
    return Square(l * 32 + r * 4 + f);
}

constexpr Level level_of(Square s) { return Level(s / 32); }
constexpr File  file_of(Square s)  { return File(s % 4); }
constexpr Rank  rank_of(Square s)  { return Rank((s % 32) / 4); }

constexpr Coord decompose(Square s) {
    return { s / 32, s % 4, (s % 32) / 4 };
}

constexpr bool in_bounds(int level, int file, int rank) {
    return level >= 0 && level < NUM_LEVELS
        && file  >= 0 && file  < NUM_FILES
        && rank  >= 0 && rank  < NUM_RANKS;
}

// Step by axis deltas — returns SQ_NONE if out of bounds
constexpr Square step(Square s, int dl, int df, int dr) {
    Coord c = decompose(s);
    int nl = c.level + dl;
    int nf = c.file  + df;
    int nr = c.rank  + dr;
    if (!in_bounds(nl, nf, nr))
        return SQ_NONE;
    return make_square(Level(nl), File(nf), Rank(nr));
}

constexpr int pawn_push(Color c) { return c == WHITE ? 1 : -1; }  // rank delta (+1 north, -1 south)

// ─────────────────────────────────────────────
//  CID (Change In Distance) — CORRECTED
//
//  Applies to ALL pieces on diagonal moves.
//  A move is "diagonal" if more than one axis changes.
//
//  Rules:
//  1) Rank (Y) must change — advance or retreat.
//  2) When level (Z) changes, file (X) must be preserved.
//
//  Valid diagonal planes:
//    X-Y  (file + rank change, same level)
//    Y-Z  (rank + level change, same file)
//
//  INVALID diagonal planes:
//    X-Z  (file + level change, same rank)  ← no distance change
//    X-Y-Z (all three change)               ← file changes with level
//
//  Rook-like moves (single-axis) are always exempt.
// ─────────────────────────────────────────────

struct AxisDelta {
    int dl, df, dr;  // level, file, rank deltas

    constexpr int axes_changed() const {
        return (dl != 0) + (df != 0) + (dr != 0);
    }

    constexpr bool is_straight() const { return axes_changed() == 1; }
    constexpr bool is_diagonal() const { return axes_changed() >= 2; }

    // The two valid diagonal planes
    constexpr bool is_xy_diagonal() const { return dl == 0 && df != 0 && dr != 0; }
    constexpr bool is_yz_diagonal() const { return df == 0 && dl != 0 && dr != 0; }
};

constexpr AxisDelta compute_delta(Square from, Square to) {
    Coord fc = decompose(from);
    Coord tc = decompose(to);
    return { tc.level - fc.level, tc.file - fc.file, tc.rank - fc.rank };
}

// Full CID check — applies to ALL pieces
constexpr bool cid_valid(Square from, Square to) {
    AxisDelta d = compute_delta(from, to);

    // Single-axis (rook-like) moves: always OK
    if (d.is_straight())
        return true;

    // Diagonal move — must be in a valid plane:
    //   X-Y (same level): rank changes ✓, file changes ✓, level constant
    //   Y-Z (same file):  rank changes ✓, level changes ✓, file constant
    //
    // X-Z (rank constant) and X-Y-Z (all three) are NEVER valid.
    return d.is_xy_diagonal() || d.is_yz_diagonal();
}

// ─────────────────────────────────────────────
//  128-bit Bitboard for 128 squares
//  lo = levels 1–2 (bits 0–63)
//  hi = levels 3–4 (bits 0–63)
// ─────────────────────────────────────────────

struct Bitboard128 {
    uint64_t lo;
    uint64_t hi;

    constexpr Bitboard128() : lo(0), hi(0) {}
    constexpr Bitboard128(uint64_t l, uint64_t h) : lo(l), hi(h) {}

    static constexpr Bitboard128 from_square(Square s) {
        return (s < 64) ? Bitboard128(1ULL << s, 0)
                        : Bitboard128(0, 1ULL << (s - 64));
    }

    constexpr bool empty() const { return lo == 0 && hi == 0; }
    constexpr bool any()   const { return lo != 0 || hi != 0; }

    constexpr bool test(Square s) const {
        return (s < 64) ? (lo >> s) & 1 : (hi >> (s - 64)) & 1;
    }

    constexpr void set(Square s) {
        if (s < 64) lo |= (1ULL << s);
        else        hi |= (1ULL << (s - 64));
    }

    constexpr void clear(Square s) {
        if (s < 64) lo &= ~(1ULL << s);
        else        hi &= ~(1ULL << (s - 64));
    }

    constexpr void toggle(Square s) {
        if (s < 64) lo ^= (1ULL << s);
        else        hi ^= (1ULL << (s - 64));
    }

    constexpr Bitboard128  operator&(const Bitboard128& b) const { return {lo & b.lo, hi & b.hi}; }
    constexpr Bitboard128  operator|(const Bitboard128& b) const { return {lo | b.lo, hi | b.hi}; }
    constexpr Bitboard128  operator^(const Bitboard128& b) const { return {lo ^ b.lo, hi ^ b.hi}; }
    constexpr Bitboard128  operator~() const { return {~lo, ~hi}; }
    constexpr Bitboard128& operator&=(const Bitboard128& b) { lo &= b.lo; hi &= b.hi; return *this; }
    constexpr Bitboard128& operator|=(const Bitboard128& b) { lo |= b.lo; hi |= b.hi; return *this; }
    constexpr Bitboard128& operator^=(const Bitboard128& b) { lo ^= b.lo; hi ^= b.hi; return *this; }
    constexpr bool         operator==(const Bitboard128& b) const { return lo == b.lo && hi == b.hi; }
    constexpr bool         operator!=(const Bitboard128& b) const { return !(*this == b); }
    constexpr Bitboard128  operator|(Square s) const { auto r = *this; r.set(s); return r; }
    constexpr Bitboard128& operator|=(Square s) { set(s); return *this; }

    constexpr bool more_than_one() const {
        if (lo && hi) return true;
        if (lo) return lo & (lo - 1);
        return hi & (hi - 1);
    }

    int    popcount() const;
    Square lsb() const;
    Square pop_lsb();
};

constexpr Bitboard128 BB_ZERO = Bitboard128(0, 0);

// ─────────────────────────────────────────────
//  Move encoding (32-bit)
//
//  bit  0– 6: destination square (0–127)
//  bit  7–13: origin square (0–127)
//  bit 14–15: promotion piece type - 2
//  bit 16–17: move type flag
// ─────────────────────────────────────────────

enum MoveType3D : uint32_t {
    NORMAL_3D     = 0,
    PROMOTION_3D  = 1 << 16,
    EN_PASSANT_3D = 2 << 16,
    CASTLING_3D   = 3 << 16
};

class Move3D {
   public:
    Move3D() = default;
    constexpr explicit Move3D(uint32_t d) : data(d) {}

    constexpr Move3D(Square from, Square to) :
        data((uint32_t(from) << 7) | uint32_t(to)) {}

    template<MoveType3D T>
    static constexpr Move3D make(Square from, Square to, PieceType pt = KNIGHT) {
        return Move3D(T | ((uint32_t(pt) - KNIGHT) << 14) | (uint32_t(from) << 7) | uint32_t(to));
    }

    constexpr Square     from_sq() const { return Square((data >> 7) & 0x7F); }
    constexpr Square     to_sq()   const { return Square(data & 0x7F); }
    constexpr MoveType3D type_of() const { return MoveType3D(data & (3 << 16)); }
    constexpr PieceType  promotion_type() const { return PieceType(((data >> 14) & 3) + KNIGHT); }
    constexpr bool       is_ok() const { return data != 0 && from_sq() != to_sq(); }

    static constexpr Move3D null() { return Move3D(129); }
    static constexpr Move3D none() { return Move3D(0); }

    constexpr bool     operator==(const Move3D& m) const { return data == m.data; }
    constexpr bool     operator!=(const Move3D& m) const { return data != m.data; }
    constexpr explicit operator bool() const { return data != 0; }
    constexpr uint32_t raw() const { return data; }

   private:
    uint32_t data = 0;
};

// ─────────────────────────────────────────────
//  Sliding step definitions (axis deltas: dl, df, dr)
//
//  Rook:   single-axis straight lines (6 directions)
//  Bishop: X-Y diagonals + Y-Z diagonals (8 directions)
//  Queen:  Rook + Bishop = 14 directions
//  King:   one step in any valid direction
//  ALL diagonal moves enforce CID automatically
//  because only X-Y and Y-Z steps are defined.
// ─────────────────────────────────────────────

struct Step {
    int dl, df, dr;  // level, file, rank deltas per step
};

// Rook: straight lines, one axis at a time (CID-exempt)
constexpr Step RookSteps[] = {
    { 0,  0,  1}, // NORTH  (+rank)
    { 0,  0, -1}, // SOUTH  (-rank)
    { 0,  1,  0}, // EAST   (+file)
    { 0, -1,  0}, // WEST   (-file)
    { 1,  0,  0}, // UP     (+level)
    {-1,  0,  0}, // DOWN   (-level)
};
constexpr int NUM_ROOK_STEPS = 6;

// Bishop: diagonals in X-Y plane and Y-Z plane ONLY
//   X-Y: file ± 1, rank ± 1, level constant   → CID valid ✓
//   Y-Z: level ± 1, rank ± 1, file constant   → CID valid ✓
//   X-Z: EXCLUDED (rank doesn't change)        → CID invalid ✗
//   X-Y-Z: EXCLUDED (file changes with level)  → CID invalid ✗
constexpr Step BishopSteps[] = {
    // X-Y plane (same level, file+rank change)
    { 0,  1,  1},  // NE
    { 0, -1,  1},  // NW
    { 0,  1, -1},  // SE
    { 0, -1, -1},  // SW
    // Y-Z plane (same file, rank+level change)
    { 1,  0,  1},  // UP-NORTH
    { 1,  0, -1},  // UP-SOUTH
    {-1,  0,  1},  // DOWN-NORTH
    {-1,  0, -1},  // DOWN-SOUTH
};
constexpr int NUM_BISHOP_STEPS = 8;

// Queen: Rook + Bishop combined (14 directions)
constexpr Step QueenSteps[] = {
    // Rook-like (6)
    { 0,  0,  1}, { 0,  0, -1}, { 0,  1,  0}, { 0, -1,  0}, { 1,  0,  0}, {-1,  0,  0},
    // Bishop-like (8)
    { 0,  1,  1}, { 0, -1,  1}, { 0,  1, -1}, { 0, -1, -1},
    { 1,  0,  1}, { 1,  0, -1}, {-1,  0,  1}, {-1,  0, -1},
};
constexpr int NUM_QUEEN_STEPS = 14;

// King: one step in any CID-valid direction (same 14 as Queen)
constexpr Step KingSteps[] = {
    // Rook-like (6)
    { 0,  0,  1}, { 0,  0, -1}, { 0,  1,  0}, { 0, -1,  0}, { 1,  0,  0}, {-1,  0,  0},
    // Bishop-like (8)
    { 0,  1,  1}, { 0, -1,  1}, { 0,  1, -1}, { 0, -1, -1},
    { 1,  0,  1}, { 1,  0, -1}, {-1,  0,  1}, {-1,  0, -1},
};
constexpr int NUM_KING_STEPS = 14;

// Knight: L-shape (2+1) in valid planes only
//   X-Y plane: (±2 file, ±1 rank) or (±1 file, ±2 rank)  → rank changes ✓
//   Y-Z plane: (±2 level, ±1 rank) or (±1 level, ±2 rank) → rank changes, file constant ✓
//   X-Z plane: EXCLUDED — rank doesn't change              → CID invalid ✗
constexpr Step KnightJumps[] = {
    // X-Y plane (same level)
    { 0,  1,  2}, { 0, -1,  2}, { 0,  1, -2}, { 0, -1, -2},  // ±1 file, ±2 rank
    { 0,  2,  1}, { 0, -2,  1}, { 0,  2, -1}, { 0, -2, -1},  // ±2 file, ±1 rank

    // Y-Z plane (same file)
    { 1,  0,  2}, {-1,  0,  2}, { 1,  0, -2}, {-1,  0, -2},  // ±1 level, ±2 rank
    { 2,  0,  1}, {-2,  0,  1}, { 2,  0, -1}, {-2,  0, -1},  // ±2 level, ±1 rank
};
constexpr int NUM_KNIGHT_JUMPS = 16;

// ─────────────────────────────────────────────
//  Pawn movement
//
//  RULE: Pawns can ONLY change boards (levels) when capturing.
//
//  Push: forward 1 rank (or 2 on first move), same file, SAME LEVEL.
//        Pawns NEVER push to a different board.
//  Capture: diagonal ahead in X-Y or Y-Z plane (requires enemy piece)
//    X-Y: forward 1 rank ± 1 file (same level)
//    Y-Z: forward 1 rank ± 1 level (same file) ← cross-level capture
//    X-Z / X-Y-Z: EXCLUDED by CID
// ─────────────────────────────────────────────

struct PawnCapture {
    int dl, df, dr;
};

// White pawn captures (rank increases toward opponent)
constexpr PawnCapture WhitePawnCaptures[] = {
    { 0,  1,  1},  // NE on same level
    { 0, -1,  1},  // NW on same level
    { 1,  0,  1},  // UP + NORTH (cross-level, same file)
    {-1,  0,  1},  // DOWN + NORTH (cross-level, same file)
};

// Black pawn captures (rank decreases toward opponent)
constexpr PawnCapture BlackPawnCaptures[] = {
    { 0,  1, -1},  // SE on same level
    { 0, -1, -1},  // SW on same level
    { 1,  0, -1},  // UP + SOUTH (cross-level, same file)
    {-1,  0, -1},  // DOWN + SOUTH (cross-level, same file)
};
constexpr int NUM_PAWN_CAPTURES = 4;

// ─────────────────────────────────────────────
//  Castling
//
//  Each side has 2 Kings with 4 castle options each (8 total):
//    King-side:  1-square king move (2 directions per king)
//    Queen-side: 2-square king move (2 directions per king)
//
//  rook_to = block square (must be empty before castling)
//  pass_through = king's intermediate sq (queen-side only,
//                 must be empty and not attacked)
//
//  Coordinate maps defined for White, rank-flipped for Black.
//  Can't castle out of / through / into check.
//  King and associated rook must not have previously moved.
// ─────────────────────────────────────────────

struct CastleEntry {
    Square king_from;
    Square king_to;
    Square rook_from;
    Square rook_to;       // king-side: king_from (rook replaces king); queen-side: pass_through
    Square pass_through;  // SQ_NONE for king-side; intermediate for queen-side
    Square block_sq;      // KING_BLOCK_MAP (king-side) / QUEEN_BLOCK_MAP (queen-side) — must be empty
    bool   is_queen_side;
};

constexpr int NUM_CASTLE_ENTRIES = 8;  // per side

// Helper: square from user's 0-based coords (x=rank, y=file, z=level)
constexpr Square sq3(int x, int y, int z) {
    return make_square(Level(z), File(y), Rank(x));
}

// White entries — back rank (rank 1, x=0) across all levels
// King-side: rook_to = king_from; block_sq from KING_BLOCK_MAP
// Queen-side: rook_to = pass_through; block_sq from QUEEN_BLOCK_MAP
constexpr CastleEntry WhiteCastles[NUM_CASTLE_ENTRIES] = {
    // King-side — king at 3c1 (0,2,2)
    //   block_sq = rook's level at king's file (orthogonal intermediate)
    { sq3(0,2,2), sq3(0,3,2), sq3(0,3,3), sq3(0,2,2), SQ_NONE,    sq3(0,2,3), false },
    { sq3(0,2,2), sq3(0,2,3), sq3(0,3,3), sq3(0,2,2), SQ_NONE,    sq3(0,3,2), false },
    // King-side — king at 2b1 (0,1,1)
    { sq3(0,1,1), sq3(0,1,0), sq3(0,0,0), sq3(0,1,1), SQ_NONE,    sq3(0,0,1), false },
    { sq3(0,1,1), sq3(0,0,1), sq3(0,0,0), sq3(0,1,1), SQ_NONE,    sq3(0,1,0), false },
    // Queen-side — king at 2b1 (0,1,1), 2-square move
    //   block_sq = rook-path intermediate beyond pass_through
    { sq3(0,1,1), sq3(0,3,1), sq3(0,3,0), sq3(0,2,1), sq3(0,2,1), sq3(0,2,0), true  },
    { sq3(0,1,1), sq3(0,1,3), sq3(0,0,3), sq3(0,1,2), sq3(0,1,2), sq3(0,0,2), true  },
    // Queen-side — king at 3c1 (0,2,2), 2-square move
    { sq3(0,2,2), sq3(0,0,2), sq3(0,0,3), sq3(0,1,2), sq3(0,1,2), sq3(0,1,3), true  },
    { sq3(0,2,2), sq3(0,2,0), sq3(0,3,0), sq3(0,2,1), sq3(0,2,1), sq3(0,3,1), true  },
};

// Black entries — back rank (rank 8, x=7), rank-flipped from White
// King-side: rook_to = king_from; block_sq from KING_BLOCK_MAP
// Queen-side: rook_to = pass_through; block_sq from QUEEN_BLOCK_MAP
constexpr CastleEntry BlackCastles[NUM_CASTLE_ENTRIES] = {
    // King-side — king at 3c8 (7,2,2)
    { sq3(7,2,2), sq3(7,3,2), sq3(7,3,3), sq3(7,2,2), SQ_NONE,    sq3(7,2,3), false },
    { sq3(7,2,2), sq3(7,2,3), sq3(7,3,3), sq3(7,2,2), SQ_NONE,    sq3(7,3,2), false },
    // King-side — king at 2b8 (7,1,1)
    { sq3(7,1,1), sq3(7,1,0), sq3(7,0,0), sq3(7,1,1), SQ_NONE,    sq3(7,0,1), false },
    { sq3(7,1,1), sq3(7,0,1), sq3(7,0,0), sq3(7,1,1), SQ_NONE,    sq3(7,1,0), false },
    // Queen-side — king at 2b8 (7,1,1), 2-square move
    { sq3(7,1,1), sq3(7,3,1), sq3(7,3,0), sq3(7,2,1), sq3(7,2,1), sq3(7,2,0), true  },
    { sq3(7,1,1), sq3(7,1,3), sq3(7,0,3), sq3(7,1,2), sq3(7,1,2), sq3(7,0,2), true  },
    // Queen-side — king at 3c8 (7,2,2), 2-square move
    { sq3(7,2,2), sq3(7,0,2), sq3(7,0,3), sq3(7,1,2), sq3(7,1,2), sq3(7,1,3), true  },
    { sq3(7,2,2), sq3(7,2,0), sq3(7,3,0), sq3(7,2,1), sq3(7,2,1), sq3(7,3,1), true  },
};

constexpr int CASTLING_ALL = 0xFFFF;  // all 16 entries available

// ─────────────────────────────────────────────
//  Notation helpers
//  Format: {Level}{File}{Rank}  e.g. "2c4"
// ─────────────────────────────────────────────

inline std::string square_to_string(Square s) {
    if (!is_ok(s))
        return "none";
    return { char('1' + level_of(s)), char('a' + file_of(s)), char('1' + rank_of(s)) };
}

inline Square string_to_square(const std::string& str) {
    if (str.size() < 3)
        return SQ_NONE;
    int l = str[0] - '1';
    int f = str[1] - 'a';
    int r = str[2] - '1';
    if (!in_bounds(l, f, r))
        return SQ_NONE;
    return make_square(Level(l), File(f), Rank(r));
}

inline std::string move_to_string(Move3D m) {
    if (!m.is_ok())
        return "0000";
    std::string s = square_to_string(m.from_sq()) + square_to_string(m.to_sq());
    if (m.type_of() == PROMOTION_3D) {
        constexpr char promo[] = " nbrq";
        s += promo[m.promotion_type()];
    }
    return s;
}

}  // namespace QuadLevel

#endif  // QUADLEVEL_TYPES_H_INCLUDED