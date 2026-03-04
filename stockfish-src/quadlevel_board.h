/*
  QuadLevel 3D Chess — Board representation & attack generation
  All diagonal movement enforces CID via step tables (only X-Y and Y-Z planes).
*/

#ifndef QUADLEVEL_BOARD_H_INCLUDED
#define QUADLEVEL_BOARD_H_INCLUDED

#include <array>
#include <cstdio>
#include <sstream>
#include <string>
#include <vector>

#include "quadlevel_types.h"

namespace QuadLevel {

// ─────────────────────────────────────────────
//  Bitboard128 platform-specific methods
// ─────────────────────────────────────────────

#if defined(_MSC_VER)
#include <intrin.h>

#if defined(_M_X64)
// x64 MSVC — native 64-bit intrinsics
inline int Bitboard128::popcount() const {
    return int(__popcnt64(lo)) + int(__popcnt64(hi));
}

inline Square Bitboard128::lsb() const {
    unsigned long idx;
    if (lo) { _BitScanForward64(&idx, lo); return Square(idx); }
    if (hi) { _BitScanForward64(&idx, hi); return Square(idx + 64); }
    return SQ_NONE;
}
#else
// x86 MSVC — split into 32-bit halves
inline int Bitboard128::popcount() const {
    return int(__popcnt(unsigned(lo))) + int(__popcnt(unsigned(lo >> 32)))
         + int(__popcnt(unsigned(hi))) + int(__popcnt(unsigned(hi >> 32)));
}

inline Square Bitboard128::lsb() const {
    unsigned long idx;
    if (unsigned(lo))        { _BitScanForward(&idx, unsigned(lo));        return Square(idx); }
    if (unsigned(lo >> 32))  { _BitScanForward(&idx, unsigned(lo >> 32));  return Square(idx + 32); }
    if (unsigned(hi))        { _BitScanForward(&idx, unsigned(hi));        return Square(idx + 64); }
    if (unsigned(hi >> 32))  { _BitScanForward(&idx, unsigned(hi >> 32));  return Square(idx + 96); }
    return SQ_NONE;
}
#endif // _M_X64
#else
inline int Bitboard128::popcount() const {
    return __builtin_popcountll(lo) + __builtin_popcountll(hi);
}

inline Square Bitboard128::lsb() const {
    if (lo) return Square(__builtin_ctzll(lo));
    if (hi) return Square(__builtin_ctzll(hi) + 64);
    return SQ_NONE;
}
#endif

inline Square Bitboard128::pop_lsb() {
    Square s = lsb();
    if (s < 64)          lo &= lo - 1;
    else if (s != SQ_NONE) hi &= hi - 1;
    return s;
}

// ─────────────────────────────────────────────
//  Position3D
// ─────────────────────────────────────────────

struct StateInfo3D {
    uint64_t     key;
    int          castlingRights;
    Square       epSquare;
    int          rule50;
    int          pliesFromNull;
    Piece        capturedPiece;
    StateInfo3D* previous;
};

class Position3D {
   public:
    Position3D();

    // Setup
    void clear();
    void set_startpos();
    void put_piece(Piece pc, Square s);
    void remove_piece(Square s);

    // Queries
    Piece       piece_on(Square s) const { return board[s]; }
    bool        empty(Square s) const { return board[s] == NO_PIECE; }
    Bitboard128 pieces() const { return byTypeBB[ALL_PIECES]; }
    Bitboard128 pieces(Color c) const { return byColorBB[c]; }
    Bitboard128 pieces(PieceType pt) const { return byTypeBB[pt]; }
    Bitboard128 pieces(Color c, PieceType pt) const { return byColorBB[c] & byTypeBB[pt]; }
    Color       side_to_move() const { return sideToMove; }
    Square      ep_square() const { return st.epSquare; }
    int         castling_rights() const { return st.castlingRights; }
    void        set_castling_rights(int rights) { st.castlingRights = rights; }
    int         count(Piece pc) const { return pieceCount[pc]; }
    int         count(Color c, PieceType pt) const { return pieceCount[make_piece(c, pt)]; }
    int         game_ply() const { return gamePly; }
    int         rule50_count() const { return st.rule50; }
    Square      king_square(Color c, int idx) const { return kingSquares[c][idx]; }
    int         king_count(Color c) const { return kingCount[c]; }

    // Attack generation — all diagonals are CID-safe by construction
    Bitboard128 sliding_attacks(Square s, const Step* steps, int count, Bitboard128 occ) const;
    Bitboard128 rook_attacks(Square s, Bitboard128 occ) const;
    Bitboard128 bishop_attacks(Square s, Bitboard128 occ) const;
    Bitboard128 queen_attacks(Square s, Bitboard128 occ) const;
    Bitboard128 knight_attacks(Square s) const;
    Bitboard128 king_attacks(Square s) const;
    Bitboard128 pawn_attacks(Color c, Square s) const;

    // Check detection
    bool is_attacked(Square s, Color by) const;
    bool in_check(Color c) const;

    // Move generation
    std::vector<Move3D> generate_pseudo_legal(Color c) const;
    std::vector<Move3D> generate_legal_moves() const;

    // Notation — QuadLevel algebraic
    //   Output: "B1c4", "2O-O1", "1c8=Q", "N2a3x3a5+"
    //   Input:  parses the same back into a Move3D
    std::string move_to_algebraic(Move3D m) const;
    Move3D      parse_algebraic(const std::string& notation) const;

    // Display
    std::string display() const;
    std::string fen() const;
    bool        set_fen(const std::string& fen);

    // Do/Undo — returns en passant state for undo
    struct UndoInfo {
        Piece  captured;
        Square prevEp;
        int    prevRule50;
        int    prevCastling;
    };
    UndoInfo do_move(Move3D m);
    void     undo_move(Move3D m, const UndoInfo& undo);

    // Null move — just flips side to move (for null-move pruning)
    struct NullUndo { Square prevEp; int prevRule50; };
    NullUndo do_null_move();
    void     undo_null_move(const NullUndo& nu);

   private:
    std::array<Piece, SQUARE_NB> board;
    Bitboard128 byTypeBB[PIECE_TYPE_NB];
    Bitboard128 byColorBB[COLOR_NB];
    Color       sideToMove;
    int         gamePly;
    StateInfo3D st;

    // Two Kings per side
    Square kingSquares[COLOR_NB][2];
    int    kingCount[COLOR_NB];
    int    pieceCount[PIECE_NB];
};

// ─────────────────────────────────────────────
//  Position3D implementation
// ─────────────────────────────────────────────

inline Position3D::Position3D() { clear(); }

inline void Position3D::clear() {
    board.fill(NO_PIECE);
    for (auto& bb : byTypeBB)  bb = BB_ZERO;
    for (auto& bb : byColorBB) bb = BB_ZERO;
    sideToMove = WHITE;
    gamePly = 0;
    st = {};
    st.epSquare = SQ_NONE;
    for (auto& ks : kingSquares) ks[0] = ks[1] = SQ_NONE;
    for (auto& kc : kingCount) kc = 0;
    for (auto& pc : pieceCount) pc = 0;
}

inline void Position3D::set_startpos() {
    clear();

    // sq3(x=rank, y=file, z=level)

    // White non-pawn pieces — rank 1 (x=0)
    //   Level 1 (z=0): R  N  B  R
    //   Level 2 (z=1): B  K  Q  N
    //   Level 3 (z=2): N  Q  K  B
    //   Level 4 (z=3): R  B  N  R
    put_piece(W_ROOK,   sq3(0,0,0));
    put_piece(W_KNIGHT, sq3(0,1,0));
    put_piece(W_BISHOP, sq3(0,2,0));
    put_piece(W_ROOK,   sq3(0,3,0));
    put_piece(W_BISHOP, sq3(0,0,1));
    put_piece(W_KING,   sq3(0,1,1));
    put_piece(W_QUEEN,  sq3(0,2,1));
    put_piece(W_KNIGHT, sq3(0,3,1));
    put_piece(W_KNIGHT, sq3(0,0,2));
    put_piece(W_QUEEN,  sq3(0,1,2));
    put_piece(W_KING,   sq3(0,2,2));
    put_piece(W_BISHOP, sq3(0,3,2));
    put_piece(W_ROOK,   sq3(0,0,3));
    put_piece(W_BISHOP, sq3(0,1,3));
    put_piece(W_KNIGHT, sq3(0,2,3));
    put_piece(W_ROOK,   sq3(0,3,3));

    // White pawns — rank 2 (x=1), all files and levels
    for (int f = 0; f < NUM_FILES; ++f)
        for (int l = 0; l < NUM_LEVELS; ++l)
            put_piece(W_PAWN, sq3(1, f, l));

    // Black non-pawn pieces — rank 8 (x=7), mirrors White
    put_piece(B_ROOK,   sq3(7,0,0));
    put_piece(B_KNIGHT, sq3(7,1,0));
    put_piece(B_BISHOP, sq3(7,2,0));
    put_piece(B_ROOK,   sq3(7,3,0));
    put_piece(B_BISHOP, sq3(7,0,1));
    put_piece(B_KING,   sq3(7,1,1));
    put_piece(B_QUEEN,  sq3(7,2,1));
    put_piece(B_KNIGHT, sq3(7,3,1));
    put_piece(B_KNIGHT, sq3(7,0,2));
    put_piece(B_QUEEN,  sq3(7,1,2));
    put_piece(B_KING,   sq3(7,2,2));
    put_piece(B_BISHOP, sq3(7,3,2));
    put_piece(B_ROOK,   sq3(7,0,3));
    put_piece(B_BISHOP, sq3(7,1,3));
    put_piece(B_KNIGHT, sq3(7,2,3));
    put_piece(B_ROOK,   sq3(7,3,3));

    // Black pawns — rank 7 (x=6), all files and levels
    for (int f = 0; f < NUM_FILES; ++f)
        for (int l = 0; l < NUM_LEVELS; ++l)
            put_piece(B_PAWN, sq3(6, f, l));

    sideToMove = WHITE;
    st.castlingRights = CASTLING_ALL;
}

inline void Position3D::put_piece(Piece pc, Square s) {
    assert(is_ok(s) && pc != NO_PIECE);
    board[s] = pc;
    Bitboard128 sq_bb = Bitboard128::from_square(s);
    byTypeBB[ALL_PIECES]  |= sq_bb;
    byTypeBB[type_of(pc)] |= sq_bb;
    byColorBB[color_of(pc)] |= sq_bb;
    pieceCount[pc]++;
    if (type_of(pc) == KING) {
        Color c = color_of(pc);
        assert(kingCount[c] < 2);
        kingSquares[c][kingCount[c]++] = s;
    }
}

inline void Position3D::remove_piece(Square s) {
    Piece pc = board[s];
    assert(pc != NO_PIECE);
    Bitboard128 sq_bb = Bitboard128::from_square(s);
    board[s] = NO_PIECE;
    byTypeBB[ALL_PIECES]  ^= sq_bb;
    byTypeBB[type_of(pc)] ^= sq_bb;
    byColorBB[color_of(pc)] ^= sq_bb;
    pieceCount[pc]--;
    if (type_of(pc) == KING) {
        Color c = color_of(pc);
        for (int i = 0; i < kingCount[c]; ++i) {
            if (kingSquares[c][i] == s) {
                kingSquares[c][i] = kingSquares[c][--kingCount[c]];
                break;
            }
        }
    }
}

// ─────────────────────────────────────────────
//  Sliding attacks (coordinate-based, no wrap bugs)
// ─────────────────────────────────────────────

inline Bitboard128 Position3D::sliding_attacks(Square s, const Step* steps, int count,
                                               Bitboard128 occ) const {
    Bitboard128 attacks = BB_ZERO;
    for (int i = 0; i < count; ++i) {
        int dl = steps[i].dl, df = steps[i].df, dr = steps[i].dr;
        Square cur = s;
        while (true) {
            Square next = step(cur, dl, df, dr);
            if (next == SQ_NONE)
                break;
            attacks.set(next);
            if (occ.test(next))
                break;  // blocked
            cur = next;
        }
    }
    return attacks;
}

inline Bitboard128 Position3D::rook_attacks(Square s, Bitboard128 occ) const {
    return sliding_attacks(s, RookSteps, NUM_ROOK_STEPS, occ);
}

inline Bitboard128 Position3D::bishop_attacks(Square s, Bitboard128 occ) const {
    return sliding_attacks(s, BishopSteps, NUM_BISHOP_STEPS, occ);
}

inline Bitboard128 Position3D::queen_attacks(Square s, Bitboard128 occ) const {
    return sliding_attacks(s, QueenSteps, NUM_QUEEN_STEPS, occ);
}

inline Bitboard128 Position3D::knight_attacks(Square s) const {
    Bitboard128 atk = BB_ZERO;
    for (int i = 0; i < NUM_KNIGHT_JUMPS; ++i) {
        int dl = KnightJumps[i].dl, df = KnightJumps[i].df, dr = KnightJumps[i].dr;
        Square to = step(s, dl, df, dr);
        if (to != SQ_NONE)
            atk.set(to);
    }
    return atk;
}

inline Bitboard128 Position3D::king_attacks(Square s) const {
    Bitboard128 atk = BB_ZERO;
    for (int i = 0; i < NUM_KING_STEPS; ++i) {
        int dl = KingSteps[i].dl, df = KingSteps[i].df, dr = KingSteps[i].dr;
        Square to = step(s, dl, df, dr);
        if (to != SQ_NONE)
            atk.set(to);
    }
    return atk;
}

inline Bitboard128 Position3D::pawn_attacks(Color c, Square s) const {
    Bitboard128 atk = BB_ZERO;
    const auto* caps = (c == WHITE) ? WhitePawnCaptures : BlackPawnCaptures;
    for (int i = 0; i < NUM_PAWN_CAPTURES; ++i) {
        Square to = step(s, caps[i].dl, caps[i].df, caps[i].dr);
        if (to != SQ_NONE)
            atk.set(to);
    }
    return atk;
}

// ─────────────────────────────────────────────
//  Check detection
// ─────────────────────────────────────────────

inline bool Position3D::is_attacked(Square s, Color by) const {
    Bitboard128 occ = pieces();
    if ((pawn_attacks(~by, s) & pieces(by, PAWN)).any())     return true;
    if ((knight_attacks(s)    & pieces(by, KNIGHT)).any())   return true;
    if ((bishop_attacks(s, occ) & pieces(by, BISHOP)).any()) return true;
    if ((rook_attacks(s, occ)   & pieces(by, ROOK)).any())   return true;
    if ((queen_attacks(s, occ)  & pieces(by, QUEEN)).any())  return true;
    if ((king_attacks(s)        & pieces(by, KING)).any())   return true;
    return false;
}

inline bool Position3D::in_check(Color c) const {
    for (int i = 0; i < kingCount[c]; ++i) {
        if (kingSquares[c][i] != SQ_NONE && is_attacked(kingSquares[c][i], ~c))
            return true;
    }
    return false;
}

// ─────────────────────────────────────────────
//  Pseudo-legal move generation
// ─────────────────────────────────────────────

inline std::vector<Move3D> Position3D::generate_pseudo_legal(Color us) const {
    std::vector<Move3D> moves;
    moves.reserve(MAX_MOVES_3D);

    Bitboard128 occ     = pieces();
    Bitboard128 friends = pieces(us);
    Bitboard128 enemies = pieces(~us);

    // --- Pawns ---
    // RULE: Pawns can ONLY change boards (levels) when capturing.
    //   Push (single/double): same level, same file, rank changes only.
    //   Capture: diagonal in X-Y plane (same level) or Y-Z plane (cross-level).
    //   En passant: same diagonal capture directions, cross-level allowed.
    {
        Bitboard128 pawns = pieces(us, PAWN);
        Rank promoRank = (us == WHITE) ? RANK_8 : RANK_1;

        while (pawns.any()) {
            Square from = pawns.pop_lsb();
            int dr_push = (us == WHITE) ? 1 : -1;
            Level from_level = level_of(from);

            // Single push — MUST stay on same level
            Square to = step(from, 0, 0, dr_push);
            if (to != SQ_NONE && !occ.test(to) && level_of(to) == from_level) {
                if (rank_of(to) == promoRank) {
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, to, QUEEN));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, to, ROOK));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, to, BISHOP));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, to, KNIGHT));
                } else {
                    moves.emplace_back(from, to);

                    // Double push from starting rank — MUST stay on same level
                    Rank startRank = (us == WHITE) ? RANK_2 : RANK_7;
                    if (rank_of(from) == startRank) {
                        Square to2 = step(from, 0, 0, dr_push * 2);
                        if (to2 != SQ_NONE && !occ.test(to2) && level_of(to2) == from_level)
                            moves.emplace_back(from, to2);
                    }
                }
            }

            // Captures — diagonal moves, level change IS allowed here
            // X-Y plane: same level, file ± 1, rank ± 1
            // Y-Z plane: level ± 1, same file, rank ± 1 (cross-level capture)
            Bitboard128 atk = pawn_attacks(us, from) & enemies;
            while (atk.any()) {
                Square cap = atk.pop_lsb();
                if (rank_of(cap) == promoRank) {
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, cap, QUEEN));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, cap, ROOK));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, cap, BISHOP));
                    moves.push_back(Move3D::make<PROMOTION_3D>(from, cap, KNIGHT));
                } else {
                    moves.emplace_back(from, cap);
                }
            }

            // En passant — capturing pawn must be on the 5th rank (White)
            // or 4th rank (Black), adjacent to the double-pushed pawn,
            // and on the SAME level (no cross-board en passant).
            if (st.epSquare != SQ_NONE) {
                Rank epRank = (us == WHITE) ? RANK_5 : RANK_4;
                if (rank_of(from) == epRank
                    && level_of(from) == level_of(st.epSquare)) {
                    Bitboard128 ep_bb = Bitboard128::from_square(st.epSquare);
                    Bitboard128 ep_atk = pawn_attacks(us, from) & ep_bb;
                    if (ep_atk.any())
                        moves.push_back(Move3D::make<EN_PASSANT_3D>(from, st.epSquare));
                }
            }
        }
    }

    // --- Knights ---
    {
        Bitboard128 knights = pieces(us, KNIGHT);
        while (knights.any()) {
            Square from = knights.pop_lsb();
            Bitboard128 atk = knight_attacks(from) & ~friends;
            while (atk.any())
                moves.emplace_back(from, atk.pop_lsb());
        }
    }

    // --- Bishops ---
    {
        Bitboard128 bishops = pieces(us, BISHOP);
        while (bishops.any()) {
            Square from = bishops.pop_lsb();
            Bitboard128 atk = bishop_attacks(from, occ) & ~friends;
            while (atk.any())
                moves.emplace_back(from, atk.pop_lsb());
        }
    }

    // --- Rooks ---
    {
        Bitboard128 rooks = pieces(us, ROOK);
        while (rooks.any()) {
            Square from = rooks.pop_lsb();
            Bitboard128 atk = rook_attacks(from, occ) & ~friends;
            while (atk.any())
                moves.emplace_back(from, atk.pop_lsb());
        }
    }

    // --- Queens ---
    {
        Bitboard128 queens = pieces(us, QUEEN);
        while (queens.any()) {
            Square from = queens.pop_lsb();
            Bitboard128 atk = queen_attacks(from, occ) & ~friends;
            while (atk.any())
                moves.emplace_back(from, atk.pop_lsb());
        }
    }

    // --- Kings ---
    for (int ki = 0; ki < kingCount[us]; ++ki) {
        Square from = kingSquares[us][ki];
        if (from == SQ_NONE) continue;
        Bitboard128 atk = king_attacks(from) & ~friends;

        // Suppress normal king moves to king-side castle destinations
        // when the matching rook is still on its starting square.
        // Board-state check — immune to FEN castling-rights inaccuracy.
        // Once the rook moves or is captured, the king moves freely.
        const CastleEntry* ce = (us == WHITE) ? WhiteCastles : BlackCastles;
        for (int ci = 0; ci < NUM_CASTLE_ENTRIES; ++ci) {
            if (!ce[ci].is_queen_side
                && ce[ci].king_from == from
                && board[ce[ci].rook_from] == make_piece(us, ROOK))
                atk.clear(ce[ci].king_to);
        }

        while (atk.any())
            moves.emplace_back(from, atk.pop_lsb());
    }

    // --- Castling ---
    {
        const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
        for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
            int bit = int(us) * NUM_CASTLE_ENTRIES + i;
            if (!(st.castlingRights & (1 << bit)))
                continue;

            const CastleEntry& ce = entries[i];

            // Pieces must still be on their starting squares
            if (board[ce.king_from] != make_piece(us, KING)) continue;
            if (board[ce.rook_from] != make_piece(us, ROOK)) continue;

            // Destination squares must be empty (king-side: rook_to == king_from, skip since king is there)
            if (!empty(ce.king_to))  continue;
            if (!empty(ce.rook_to) && ce.rook_to != ce.king_from)  continue;

            // Queen-side: pass-through must also be empty
            if (ce.pass_through != SQ_NONE && !empty(ce.pass_through))
                continue;

            // KING_BLOCK_MAP / QUEEN_BLOCK_MAP: rook-path intermediate must be empty
            if (ce.block_sq != SQ_NONE && !empty(ce.block_sq))
                continue;

            // Can't castle out of check
            if (is_attacked(ce.king_from, ~us)) continue;

            // Can't castle into check
            if (is_attacked(ce.king_to, ~us)) continue;

            // Queen-side: can't castle through check
            if (ce.pass_through != SQ_NONE && is_attacked(ce.pass_through, ~us))
                continue;

            moves.push_back(Move3D::make<CASTLING_3D>(ce.king_from, ce.king_to));
        }
    }

    return moves;
}

// Filter pseudo-legal down to legal (king not left in check)
inline std::vector<Move3D> Position3D::generate_legal_moves() const {
    auto pseudo = generate_pseudo_legal(sideToMove);
    std::vector<Move3D> legal;
    legal.reserve(pseudo.size());

    for (const auto& m : pseudo) {
        // Belt-and-suspenders: reject NORMAL king moves to king-side castle
        // destinations when the matching rook is still on its starting square.
        // Board-state check — immune to FEN castling-rights inaccuracy.
        if (m.type_of() == NORMAL_3D) {
            Piece pc = piece_on(m.from_sq());
            if (pc != NO_PIECE && type_of(pc) == KING) {
                const CastleEntry* ce = (sideToMove == WHITE) ? WhiteCastles : BlackCastles;
                bool suppress = false;
                for (int ci = 0; ci < NUM_CASTLE_ENTRIES; ++ci) {
                    if (!ce[ci].is_queen_side
                        && ce[ci].king_from == m.from_sq()
                        && ce[ci].king_to   == m.to_sq()
                        && piece_on(ce[ci].rook_from) == make_piece(sideToMove, ROOK)) {
                        suppress = true;
                        break;
                    }
                }
                if (suppress)
                    continue;
            }
        }

        // Make move on a copy and test legality
        Position3D tmp = *this;
        tmp.do_move(m);
        // After do_move, sideToMove has flipped — check if the side that just
        // moved left its own king in check
        if (!tmp.in_check(sideToMove))
            legal.push_back(m);
    }
    return legal;
}

// ─────────────────────────────────────────────
//  Do / Undo move (en passant + castling)
// ─────────────────────────────────────────────

inline Position3D::UndoInfo Position3D::do_move(Move3D m) {
    UndoInfo undo;
    undo.prevEp       = st.epSquare;
    undo.prevRule50   = st.rule50;
    undo.prevCastling = st.castlingRights;
    undo.captured     = NO_PIECE;

    Square from = m.from_sq();
    Square to   = m.to_sq();
    Piece  pc   = board[from];
    Color  us   = sideToMove;
    Square rookFrom = SQ_NONE;  // set only for castling

    st.rule50++;
    st.epSquare = SQ_NONE;

    if (m.type_of() == CASTLING_3D) {
        const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
        for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
            if (entries[i].king_from == from && entries[i].king_to == to) {
                rookFrom = entries[i].rook_from;
                Piece rookPc = board[rookFrom];
                remove_piece(from);
                put_piece(pc, to);
                remove_piece(rookFrom);
                put_piece(rookPc, entries[i].rook_to);
                break;
            }
        }
    } else {
        if (type_of(pc) == PAWN) {
            st.rule50 = 0;

            if (m.type_of() == EN_PASSANT_3D) {
                Square captured_sq = step(to, 0, 0, pawn_push(~us));
                assert(captured_sq != SQ_NONE);
                assert(board[captured_sq] != NO_PIECE);
                assert(type_of(board[captured_sq]) == PAWN);
                undo.captured = board[captured_sq];
                remove_piece(captured_sq);
            }

            int rank_diff = int(rank_of(to)) - int(rank_of(from));
            if (rank_diff == 2 || rank_diff == -2) {
                Square ep_target = step(from, 0, 0, pawn_push(us));
                if (ep_target != SQ_NONE)
                    st.epSquare = ep_target;
            }
        }

        if (m.type_of() != EN_PASSANT_3D && board[to] != NO_PIECE) {
            st.rule50 = 0;
            undo.captured = board[to];
            remove_piece(to);
        }

        remove_piece(from);

        if (m.type_of() == PROMOTION_3D) {
            put_piece(make_piece(us, m.promotion_type()), to);
        } else {
            put_piece(pc, to);
        }
    }

    // Update castling rights: invalidate entries where king/rook moved or rook captured
    {
        int rights = st.castlingRights;
        for (int c = 0; c < COLOR_NB; ++c) {
            const CastleEntry* ce = (c == WHITE) ? WhiteCastles : BlackCastles;
            for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
                int bit = c * NUM_CASTLE_ENTRIES + i;
                if (!(rights & (1 << bit)))
                    continue;
                if (from == ce[i].king_from || from == ce[i].rook_from ||
                    to == ce[i].rook_from ||
                    (rookFrom != SQ_NONE && rookFrom == ce[i].rook_from))
                    rights &= ~(1 << bit);
            }
        }
        st.castlingRights = rights;
    }

    sideToMove = ~sideToMove;
    gamePly++;

    return undo;
}

inline void Position3D::undo_move(Move3D m, const UndoInfo& undo) {
    sideToMove = ~sideToMove;
    gamePly--;

    Square from = m.from_sq();
    Square to   = m.to_sq();
    Color  us   = sideToMove;  // side that made the move

    if (m.type_of() == CASTLING_3D) {
        const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
        for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
            if (entries[i].king_from == from && entries[i].king_to == to) {
                Piece kingPc = board[to];
                Piece rookPc = board[entries[i].rook_to];
                // Remove rook first — rook_to may equal king_from (king-side)
                remove_piece(entries[i].rook_to);
                remove_piece(to);
                put_piece(kingPc, from);
                put_piece(rookPc, entries[i].rook_from);
                break;
            }
        }
    } else {
        Piece pc = board[to];
        remove_piece(to);

        if (m.type_of() == PROMOTION_3D) {
            // Restore the pawn, not the promoted piece
            put_piece(make_piece(us, PAWN), from);
        } else {
            put_piece(pc, from);
        }

        if (m.type_of() == EN_PASSANT_3D) {
            Square captured_sq = step(to, 0, 0, pawn_push(~us));
            assert(captured_sq != SQ_NONE);
            put_piece(undo.captured, captured_sq);
        } else if (undo.captured != NO_PIECE) {
            put_piece(undo.captured, to);
        }
    }

    st.epSquare       = undo.prevEp;
    st.rule50         = undo.prevRule50;
    st.castlingRights = undo.prevCastling;
}

// ─────────────────────────────────────────────
//  Null move — flip side only (no piece moves)
// ─────────────────────────────────────────────

inline Position3D::NullUndo Position3D::do_null_move() {
    NullUndo nu;
    nu.prevEp     = st.epSquare;
    nu.prevRule50 = st.rule50;
    st.epSquare = SQ_NONE;
    st.rule50++;
    sideToMove = ~sideToMove;
    gamePly++;
    return nu;
}

inline void Position3D::undo_null_move(const NullUndo& nu) {
    sideToMove = ~sideToMove;
    gamePly--;
    st.epSquare = nu.prevEp;
    st.rule50   = nu.prevRule50;
}

// ─────────────────────────────────────────────
//  QuadLevel algebraic notation
//
//  Format mirrors standard chess with 3-char squares:
//    Piece moves:  {Piece}{disambiguation}{x}{to}  e.g. "B1c4", "R1ax2a5"
//    Pawn push:    {to}  e.g. "1c4", or "1c8=Q" (promotion)
//    Pawn capture: {from-file}x{to}  e.g. "cx1d5", or "cx1d8=Q"
//    Castling:     {from-level}O-O{to-level}   (king-side)
//                  {from-level}O-O-O{to-level}  (queen-side)
//    Check: + suffix,  Checkmate: # suffix
// ─────────────────────────────────────────────

inline std::string Position3D::move_to_algebraic(Move3D m) const {
    if (!m.is_ok())
        return "??";

    std::string result;
    Square from = m.from_sq();
    Square to   = m.to_sq();
    Piece  pc   = board[from];
    Color  us   = sideToMove;

    // --- Castling ---
    if (m.type_of() == CASTLING_3D) {
        const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
        bool queen_side = false;
        for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
            if (entries[i].king_from == from && entries[i].king_to == to) {
                queen_side = entries[i].is_queen_side;
                break;
            }
        }
        // {from-level}O-O{to-level} or {from-level}O-O-O{to-level}
        int from_lv = int(level_of(from)) + 1;
        int to_lv   = int(level_of(to)) + 1;
        if (queen_side)
            result = std::to_string(from_lv) + "O-O-O" + std::to_string(to_lv);
        else
            result = std::to_string(from_lv) + "O-O" + std::to_string(to_lv);
    }
    // --- Pawn ---
    else if (type_of(pc) == PAWN) {
        bool is_capture = (m.type_of() == EN_PASSANT_3D) || (board[to] != NO_PIECE);

        if (is_capture) {
            // File letter of origin + "x" + destination
            result += char('a' + file_of(from));
            result += 'x';
        }
        result += square_to_string(to);

        // Promotion suffix
        if (m.type_of() == PROMOTION_3D) {
            constexpr const char* promo_chars = " NBRQK";
            result += '=';
            result += promo_chars[m.promotion_type()];
        }
    }
    // --- Piece (N, B, R, Q, K) ---
    else {
        constexpr const char* piece_chars = " PNBRQK";
        PieceType pt = type_of(pc);
        result += piece_chars[pt];

        // Disambiguation: check if other same-type same-color pieces
        // can also legally reach the target square
        auto legal = generate_legal_moves();
        bool ambig_file  = false;
        bool ambig_rank  = false;
        bool ambig_level = false;
        bool ambiguous   = false;

        for (const auto& lm : legal) {
            if (lm == m)           continue;
            if (lm.to_sq() != to) continue;
            Square other_from = lm.from_sq();
            if (other_from == from) continue;
            Piece other_pc = board[other_from];
            if (other_pc != pc) continue;
            // There's another piece of same type that can reach 'to'
            ambiguous = true;
            if (file_of(other_from)  == file_of(from))  ambig_file  = true;
            if (rank_of(other_from)  == rank_of(from))  ambig_rank  = true;
            if (level_of(other_from) == level_of(from)) ambig_level = true;
        }

        if (ambiguous) {
            // Use the minimum disambiguation needed
            bool need_level = ambig_file && ambig_rank;   // file+rank same? add level
            bool need_file  = true;                        // file is cheapest disambiguator
            bool need_rank  = ambig_file;                  // file same? add rank

            // If level alone is unique, prefer it (common in 3D)
            if (!ambig_level) {
                result += char('1' + level_of(from));
            } else if (!ambig_file && !ambig_rank) {
                // Just file is enough
                result += char('a' + file_of(from));
            } else if (need_level) {
                // Full square for total ambiguity
                result += square_to_string(from);
            } else if (need_rank) {
                result += char('a' + file_of(from));
                result += char('1' + rank_of(from));
            } else {
                result += char('a' + file_of(from));
            }
        }

        // Capture marker
        if (board[to] != NO_PIECE)
            result += 'x';

        result += square_to_string(to);
    }

    // Check / Checkmate suffix
    {
        Position3D tmp = *this;
        tmp.do_move(m);
        if (tmp.in_check(~us)) {
            auto opp_legal = tmp.generate_legal_moves();
            result += opp_legal.empty() ? '#' : '+';
        }
    }

    return result;
}

// ─────────────────────────────────────────────
//  Parse QuadLevel algebraic notation → Move3D
//
//  Accepts:  "B1c4", "cx1d5", "1c4", "1c8=Q",
//            "2O-O1", "3O-O-O1", "N2a3", etc.
//  Also still accepts coordinate form: "2c22c4"
//
//  Matching is done against the legal move list.
// ─────────────────────────────────────────────

inline Move3D Position3D::parse_algebraic(const std::string& input) const {
    if (input.empty())
        return Move3D::none();

    // Strip whitespace and check/mate suffixes
    std::string s;
    for (char ch : input) {
        if (ch != ' ' && ch != '+' && ch != '#')
            s += ch;
    }
    if (s.empty())
        return Move3D::none();

    auto legal = generate_legal_moves();

    // --- Try coordinate notation first: "2c22c4" or "2c22c4q" ---
    if (s.size() >= 6) {
        Square from_sq = string_to_square(s.substr(0, 3));
        Square to_sq   = string_to_square(s.substr(3, 3));
        if (is_ok(from_sq) && is_ok(to_sq)) {
            PieceType promo_pt = NO_PIECE_TYPE;
            if (s.size() >= 7) {
                char pc = s[6];
                if (pc == 'q' || pc == 'Q') promo_pt = QUEEN;
                else if (pc == 'r' || pc == 'R') promo_pt = ROOK;
                else if (pc == 'b' || pc == 'B') promo_pt = BISHOP;
                else if (pc == 'n' || pc == 'N') promo_pt = KNIGHT;
            }
            for (const auto& lm : legal) {
                if (lm.from_sq() == from_sq && lm.to_sq() == to_sq) {
                    if (lm.type_of() == PROMOTION_3D) {
                        if (promo_pt != NO_PIECE_TYPE && lm.promotion_type() == promo_pt)
                            return lm;
                    } else {
                        return lm;
                    }
                }
            }
            // If promotion square but no piece specified, default to Queen
            for (const auto& lm : legal) {
                if (lm.from_sq() == from_sq && lm.to_sq() == to_sq
                    && lm.type_of() == PROMOTION_3D && lm.promotion_type() == QUEEN)
                    return lm;
            }
        }
    }

    // --- Castling: {level}O-O{level} or {level}O-O-O{level} ---
    {
        // Normalize 0/o → O
        std::string upper;
        for (char ch : s) {
            if (ch == '0' || ch == 'o') upper += 'O';
            else upper += ch;
        }

        bool is_queen_side = false;
        int from_lv = -1, to_lv = -1;

        // Queen-side: {d}O-O-O{d}  (length 7) or {d}OOO{d} (length 5)
        if (upper.size() >= 5) {
            // Try "{d}O-O-O{d}"
            if (upper.size() == 7 && upper.substr(1, 5) == "O-O-O") {
                from_lv = upper[0] - '1';
                to_lv   = upper[6] - '1';
                is_queen_side = true;
            }
            // Try "{d}OOO{d}"
            else if (upper.size() == 5 && upper.substr(1, 3) == "OOO") {
                from_lv = upper[0] - '1';
                to_lv   = upper[4] - '1';
                is_queen_side = true;
            }
            // Try "{d}O-O{d}"
            else if (upper.size() == 5 && upper.substr(1, 3) == "O-O") {
                from_lv = upper[0] - '1';
                to_lv   = upper[4] - '1';
                is_queen_side = false;
            }
            // Try "{d}OO{d}"
            else if (upper.size() == 4 && upper.substr(1, 2) == "OO") {
                from_lv = upper[0] - '1';
                to_lv   = upper[3] - '1';
                is_queen_side = false;
            }
        }

        if (from_lv >= 0 && from_lv < NUM_LEVELS && to_lv >= 0 && to_lv < NUM_LEVELS) {
            for (const auto& lm : legal) {
                if (lm.type_of() != CASTLING_3D) continue;
                int lm_from_lv = int(level_of(lm.from_sq()));
                int lm_to_lv   = int(level_of(lm.to_sq()));
                if (lm_from_lv != from_lv || lm_to_lv != to_lv) continue;

                // Check queen-side vs king-side
                Color us = sideToMove;
                const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
                for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
                    if (entries[i].king_from == lm.from_sq() &&
                        entries[i].king_to == lm.to_sq() &&
                        entries[i].is_queen_side == is_queen_side)
                        return lm;
                }
            }
        }
    }

    // --- Piece move: {P}{disambig}{x?}{square} ---
    //     Pawn move:  {square} or {file}x{square} or {square}={Promo}
    {
        size_t pos = 0;
        PieceType pt = NO_PIECE_TYPE;
        char piece_ch = s[0];

        // Identify piece letter
        if      (piece_ch == 'K') { pt = KING;   pos = 1; }
        else if (piece_ch == 'Q') { pt = QUEEN;  pos = 1; }
        else if (piece_ch == 'R') { pt = ROOK;   pos = 1; }
        else if (piece_ch == 'B') { pt = BISHOP; pos = 1; }
        else if (piece_ch == 'N') { pt = KNIGHT; pos = 1; }
        else                      { pt = PAWN;   pos = 0; }

        // Strip 'x', '(', ')' and collect remaining tokens
        std::string rest = s.substr(pos);
        // Remove 'x' and parentheses (frontend wraps disambiguation in parens)
        std::string clean;
        for (char ch : rest) {
            if (ch != 'x' && ch != 'X' && ch != '(' && ch != ')')
                clean += ch;
        }

        // Check for promotion suffix: "=Q", "=R", "=B", "=N"
        PieceType promo_pt = NO_PIECE_TYPE;
        if (clean.size() >= 2 && clean[clean.size() - 2] == '=') {
            char promo_ch = clean.back();
            if      (promo_ch == 'Q' || promo_ch == 'q') promo_pt = QUEEN;
            else if (promo_ch == 'R' || promo_ch == 'r') promo_pt = ROOK;
            else if (promo_ch == 'B' || promo_ch == 'b') promo_pt = BISHOP;
            else if (promo_ch == 'N' || promo_ch == 'n') promo_pt = KNIGHT;
            clean.erase(clean.size() - 2);
        }

        // The destination square is always the last 3 characters
        if (clean.size() < 3)
            return Move3D::none();

        std::string to_str = clean.substr(clean.size() - 3);
        Square to_sq = string_to_square(to_str);
        if (!is_ok(to_sq))
            return Move3D::none();

        // Everything before the destination is disambiguation
        std::string disambig = clean.substr(0, clean.size() - 3);

        // Parse disambiguation: could be level(digit), file(letter),
        // rank(digit), or full square (3 chars)
        int disambig_level = -1;
        int disambig_file  = -1;
        int disambig_rank  = -1;

        if (disambig.size() == 3) {
            // Full square disambiguation
            Square ds = string_to_square(disambig);
            if (is_ok(ds)) {
                disambig_level = level_of(ds);
                disambig_file  = file_of(ds);
                disambig_rank  = rank_of(ds);
            }
        } else if (disambig.size() == 2) {
            // Could be file+rank like "a3" or level+file like "1a"
            if (disambig[0] >= 'a' && disambig[0] <= 'd' &&
                disambig[1] >= '1' && disambig[1] <= '8') {
                disambig_file = disambig[0] - 'a';
                disambig_rank = disambig[1] - '1';
            } else if (disambig[0] >= '1' && disambig[0] <= '4' &&
                       disambig[1] >= 'a' && disambig[1] <= 'd') {
                disambig_level = disambig[0] - '1';
                disambig_file  = disambig[1] - 'a';
            }
        } else if (disambig.size() == 1) {
            char c = disambig[0];
            if (c >= 'a' && c <= 'd')
                disambig_file = c - 'a';
            else if (c >= '1' && c <= '4')
                disambig_level = c - '1';
            else if (c >= '1' && c <= '8')
                disambig_rank = c - '1';
        }

        // Match against legal moves
        Move3D best = Move3D::none();
        int matches = 0;

        for (const auto& lm : legal) {
            if (lm.to_sq() != to_sq) continue;

            Piece lm_pc = board[lm.from_sq()];
            if (type_of(lm_pc) != pt) continue;

            // Check disambiguation
            Square lm_from = lm.from_sq();
            if (disambig_level >= 0 && int(level_of(lm_from)) != disambig_level) continue;
            if (disambig_file  >= 0 && int(file_of(lm_from))  != disambig_file)  continue;
            if (disambig_rank  >= 0 && int(rank_of(lm_from))  != disambig_rank)  continue;

            // Check promotion
            if (promo_pt != NO_PIECE_TYPE) {
                if (lm.type_of() != PROMOTION_3D) continue;
                if (lm.promotion_type() != promo_pt) continue;
            } else if (lm.type_of() == PROMOTION_3D) {
                // No promo specified — default to Queen
                if (lm.promotion_type() != QUEEN) continue;
            }

            best = lm;
            matches++;
        }

        if (matches >= 1)
            return best;
    }

    return Move3D::none();
}

// ─────────────────────────────────────────────
//  Pretty-print (all 4 levels, top to bottom)
// ─────────────────────────────────────────────

inline std::string Position3D::display() const {
    constexpr const char* pc_chars = ".PNBRQKx.pnbrqk";
    std::ostringstream os;

    for (int lv = NUM_LEVELS - 1; lv >= 0; --lv) {
        os << "  Level " << (lv + 1) << "\n";
        os << "  +---+---+---+---+\n";
        for (int r = NUM_RANKS - 1; r >= 0; --r) {
            os << (r + 1) << " ";
            for (int f = 0; f < NUM_FILES; ++f) {
                Square sq = make_square(Level(lv), File(f), Rank(r));
                os << "| " << pc_chars[board[sq]] << " ";
            }
            os << "|\n  +---+---+---+---+\n";
        }
        os << "    a   b   c   d\n\n";
    }
    os << (sideToMove == WHITE ? "White" : "Black") << " to move\n";
    return os.str();
}

// ─────────────────────────────────────────────
//  FEN — Forsyth-Edwards Notation for QuadLevel
//
//  Format:  {board} {side} {castling} {ep} {halfmove} {fullmove}
//
//  Board:   levels 1–4 separated by '|'
//           within each level, ranks 8→1 separated by '/'
//           pieces: PNBRQKpnbrqk, empty runs as digits (1-4)
//  Side:    'w' or 'b'
//  Castling: hex bitmask of castlingRights (e.g. "ffff"), or "-"
//  EP:      square notation (e.g. "2c3") or "-"
//  Halfmove: rule50 counter
//  Fullmove: 1 + gamePly / 2
// ─────────────────────────────────────────────

inline std::string Position3D::fen() const {
    constexpr const char* pc_char = " PNBRQKx.pnbrqk";
    std::ostringstream os;

    // --- Board ---
    for (int lv = 0; lv < NUM_LEVELS; ++lv) {
        if (lv > 0)
            os << '|';
        for (int r = NUM_RANKS - 1; r >= 0; --r) {
            if (r < NUM_RANKS - 1)
                os << '/';
            int empty_count = 0;
            for (int f = 0; f < NUM_FILES; ++f) {
                Square sq = make_square(Level(lv), File(f), Rank(r));
                Piece  pc = board[sq];
                if (pc == NO_PIECE) {
                    ++empty_count;
                } else {
                    if (empty_count > 0) {
                        os << empty_count;
                        empty_count = 0;
                    }
                    os << pc_char[pc];
                }
            }
            if (empty_count > 0)
                os << empty_count;
        }
    }

    // --- Side to move ---
    os << (sideToMove == WHITE ? " w " : " b ");

    // --- Castling rights ---
    if (st.castlingRights == 0) {
        os << '-';
    } else {
        // Emit as lowercase hex (e.g. "ffff" when all 16 bits set)
        auto flags = os.flags();
        os << std::hex << st.castlingRights;
        os.flags(flags);
    }

    // --- En passant ---
    os << ' ';
    if (st.epSquare == SQ_NONE || !is_ok(st.epSquare)) {
        os << '-';
    } else {
        os << square_to_string(st.epSquare);
    }

    // --- Half-move clock & full-move number ---
    os << ' ' << st.rule50;
    os << ' ' << (1 + gamePly / 2);

    return os.str();
}

// ─────────────────────────────────────────────
//  Parse QuadLevel FEN → set up Position3D
// ─────────────────────────────────────────────

inline bool Position3D::set_fen(const std::string& fen) {
    clear();

    // Tokenize: board side castling ep halfmove fullmove
    std::istringstream ss(fen);
    std::string board_str, side_str, castle_str, ep_str;
    int halfmove = 0, fullmove = 1;

    if (!(ss >> board_str >> side_str >> castle_str >> ep_str))
        return false;
    ss >> halfmove >> fullmove;  // optional — default 0 / 1

    // --- Board: levels separated by '|', ranks by '/', pieces PNBRQKpnbrqk ---
    auto char_to_piece = [](char ch) -> Piece {
        switch (ch) {
            case 'P': return W_PAWN;   case 'N': return W_KNIGHT;
            case 'B': return W_BISHOP; case 'R': return W_ROOK;
            case 'Q': return W_QUEEN;  case 'K': return W_KING;
            case 'p': return B_PAWN;   case 'n': return B_KNIGHT;
            case 'b': return B_BISHOP; case 'r': return B_ROOK;
            case 'q': return B_QUEEN;  case 'k': return B_KING;
            default:  return NO_PIECE;
        }
    };

    int lv = 0, rank = NUM_RANKS - 1, file = 0;
    for (size_t i = 0; i < board_str.size(); ++i) {
        char ch = board_str[i];
        if (ch == '|') {
            ++lv;
            rank = NUM_RANKS - 1;
            file = 0;
        } else if (ch == '/') {
            --rank;
            file = 0;
        } else if (ch >= '1' && ch <= '8') {
            file += ch - '0';
        } else {
            Piece pc = char_to_piece(ch);
            if (pc == NO_PIECE) return false;
            if (lv >= NUM_LEVELS || rank < 0 || file >= NUM_FILES) return false;
            put_piece(pc, make_square(Level(lv), File(file), Rank(rank)));
            ++file;
        }
    }

    // --- Side to move ---
    if (side_str == "w" || side_str == "W")
        sideToMove = WHITE;
    else if (side_str == "b" || side_str == "B")
        sideToMove = BLACK;
    else
        return false;

    // --- Castling rights (hex bitmask or "-") ---
    if (castle_str == "-") {
        st.castlingRights = 0;
    } else {
        unsigned long val = std::stoul(castle_str, nullptr, 16);
        st.castlingRights = int(val);
    }

    // --- En passant square ---
    if (ep_str == "-") {
        st.epSquare = SQ_NONE;
    } else {
        st.epSquare = string_to_square(ep_str);
    }

    // --- Clocks ---
    st.rule50 = halfmove;
    gamePly = (fullmove - 1) * 2 + (sideToMove == BLACK ? 1 : 0);

    return true;
}

}  // namespace QuadLevel

#endif  // QUADLEVEL_BOARD_H_INCLUDED