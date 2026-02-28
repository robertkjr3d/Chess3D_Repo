/*
  QuadLevel 3D Chess — Search & Evaluation
  Self-contained alpha-beta search for Position3D.

  Features:
    • Material + piece-square table evaluation
    • Mobility bonus (number of legal moves per piece)
    • King safety (attacks near king squares)
    • Alpha-beta with iterative deepening
    • Quiescence search (captures only)
    • Move ordering: TT move ? MVV-LVA captures ? killer moves ? history
    • Simple transposition table (hash ? best move + score + depth)
    • Null-move pruning
    • Late-move reduction (LMR)
*/

#ifndef QUADLEVEL_SEARCH_H_INCLUDED
#define QUADLEVEL_SEARCH_H_INCLUDED

#include <algorithm>
#include <chrono>
#include <cstring>
#include <functional>
#include <random>
#include <vector>

#include "quadlevel_board.h"

namespace QuadLevel {

// ?????????????????????????????????????????????
//  Piece-Square Tables (3D: 128 entries each)
//
//  Values from WHITE's perspective.
//  Index = square (level*32 + rank*4 + file).
//  Encourages central control, advancement,
//  and multi-level presence.
// ?????????????????????????????????????????????

// Pawn: advance toward promotion, prefer center files
constexpr int PST_PAWN[SQUARE_NB] = {
    // Level 1 — ranks 1-8 (4 files each)
     0,  0,  0,  0,    5,  5,  5,  5,   10, 10, 10, 10,   15, 20, 20, 15,
    20, 25, 25, 20,   25, 30, 30, 25,   35, 40, 40, 35,    0,  0,  0,  0,
    // Level 2
     0,  0,  0,  0,    7,  7,  7,  7,   12, 14, 14, 12,   17, 22, 22, 17,
    22, 27, 27, 22,   27, 32, 32, 27,   37, 42, 42, 37,    0,  0,  0,  0,
    // Level 3
     0,  0,  0,  0,    7,  7,  7,  7,   12, 14, 14, 12,   17, 22, 22, 17,
    22, 27, 27, 22,   27, 32, 32, 27,   37, 42, 42, 37,    0,  0,  0,  0,
    // Level 4
     0,  0,  0,  0,    5,  5,  5,  5,   10, 10, 10, 10,   15, 20, 20, 15,
    20, 25, 25, 20,   25, 30, 30, 25,   35, 40, 40, 35,    0,  0,  0,  0,
};

// Knight: center of board, inner levels preferred
constexpr int PST_KNIGHT[SQUARE_NB] = {
    // Level 1
    -20,-10,-10,-20,  -10,  0,  5,-10,  -10,  5, 10,-10,  -10,  5, 10,-10,
    -10,  5, 10,-10,  -10,  5,  5,-10,  -10,  0,  0,-10,  -20,-10,-10,-20,
    // Level 2 (inner — bonus)
    -15, -5, -5,-15,   -5,  5, 10, -5,   -5, 10, 15, -5,   -5, 10, 15, -5,
     -5, 10, 15, -5,   -5, 10, 10, -5,   -5,  5,  5, -5,  -15, -5, -5,-15,
    // Level 3 (inner — bonus)
    -15, -5, -5,-15,   -5,  5, 10, -5,   -5, 10, 15, -5,   -5, 10, 15, -5,
     -5, 10, 15, -5,   -5, 10, 10, -5,   -5,  5,  5, -5,  -15, -5, -5,-15,
    // Level 4
    -20,-10,-10,-20,  -10,  0,  5,-10,  -10,  5, 10,-10,  -10,  5, 10,-10,
    -10,  5, 10,-10,  -10,  5,  5,-10,  -10,  0,  0,-10,  -20,-10,-10,-20,
};

// Bishop: diagonals + cross-level reach, inner levels better
constexpr int PST_BISHOP[SQUARE_NB] = {
    // Level 1
    -10, -5, -5,-10,   -5,  5,  5, -5,   -5,  5, 10, -5,   -5, 10, 10, -5,
     -5, 10, 10, -5,   -5,  5,  5, -5,   -5,  0,  0, -5,  -10, -5, -5,-10,
    // Level 2
     -5,  0,  0, -5,    0, 10, 10,  0,    0, 10, 15,  0,    0, 15, 15,  0,
      0, 15, 15,  0,    0, 10, 10,  0,    0,  5,  5,  0,   -5,  0,  0, -5,
    // Level 3
     -5,  0,  0, -5,    0, 10, 10,  0,    0, 10, 15,  0,    0, 15, 15,  0,
      0, 15, 15,  0,    0, 10, 10,  0,    0,  5,  5,  0,   -5,  0,  0, -5,
    // Level 4
    -10, -5, -5,-10,   -5,  5,  5, -5,   -5,  5, 10, -5,   -5, 10, 10, -5,
     -5, 10, 10, -5,   -5,  5,  5, -5,   -5,  0,  0, -5,  -10, -5, -5,-10,
};

// Rook: 6-axis reach; 7th/8th rank bonus, open file bonus encoded in eval
constexpr int PST_ROOK[SQUARE_NB] = {
    // Level 1
      0,  0,  5,  0,    0,  0,  5,  0,    0,  0,  5,  0,    0,  0,  5,  0,
      0,  0,  5,  0,    5,  5, 10,  5,   10, 10, 15, 10,    0,  0,  5,  0,
    // Level 2
      5,  5, 10,  5,    5,  5, 10,  5,    5,  5, 10,  5,    5,  5, 10,  5,
      5,  5, 10,  5,   10, 10, 15, 10,   15, 15, 20, 15,    5,  5, 10,  5,
    // Level 3
      5,  5, 10,  5,    5,  5, 10,  5,    5,  5, 10,  5,    5,  5, 10,  5,
      5,  5, 10,  5,   10, 10, 15, 10,   15, 15, 20, 15,    5,  5, 10,  5,
    // Level 4
      0,  0,  5,  0,    0,  0,  5,  0,    0,  0,  5,  0,    0,  0,  5,  0,
      0,  0,  5,  0,    5,  5, 10,  5,   10, 10, 15, 10,    0,  0,  5,  0,
};

// Queen: combine rook + bishop patterns
constexpr int PST_QUEEN[SQUARE_NB] = {
    // Level 1
    -10, -5, -5,-10,   -5,  0,  0, -5,   -5,  0,  5, -5,    0,  5,  5,  0,
      0,  5,  5,  0,   -5,  0,  5, -5,   -5,  0,  0, -5,  -10, -5, -5,-10,
    // Level 2
     -5,  0,  0, -5,    0,  5,  5,  0,    0,  5, 10,  0,    5, 10, 10,  5,
      5, 10, 10,  5,    0,  5, 10,  0,    0,  5,  5,  0,   -5,  0,  0, -5,
    // Level 3
     -5,  0,  0, -5,    0,  5,  5,  0,    0,  5, 10,  0,    5, 10, 10,  5,
      5, 10, 10,  5,    0,  5, 10,  0,    0,  5,  5,  0,   -5,  0,  0, -5,
    // Level 4
    -10, -5, -5,-10,   -5,  0,  0, -5,   -5,  0,  5, -5,    0,  5,  5,  0,
      0,  5,  5,  0,   -5,  0,  5, -5,   -5,  0,  0, -5,  -10, -5, -5,-10,
};

// King: stay on back rank early, avoid center
constexpr int PST_KING[SQUARE_NB] = {
    // Level 1
     20, 20, 10, 20,   10,  0,  0, 10,  -10,-10,-20,-10,  -20,-20,-30,-20,
    -30,-30,-40,-30,  -40,-40,-50,-40,  -50,-50,-60,-50,  -60,-60,-70,-60,
    // Level 2
     25, 25, 15, 25,   15,  5,  5, 15,   -5, -5,-15, -5,  -15,-15,-25,-15,
    -25,-25,-35,-25,  -35,-35,-45,-35,  -45,-45,-55,-45,  -55,-55,-65,-55,
    // Level 3
     25, 25, 15, 25,   15,  5,  5, 15,   -5, -5,-15, -5,  -15,-15,-25,-15,
    -25,-25,-35,-25,  -35,-35,-45,-35,  -45,-45,-55,-45,  -55,-55,-65,-55,
    // Level 4
     20, 20, 10, 20,   10,  0,  0, 10,  -10,-10,-20,-10,  -20,-20,-30,-20,
    -30,-30,-40,-30,  -40,-40,-50,-40,  -50,-50,-60,-50,  -60,-60,-70,-60,
};

inline int pst_value(PieceType pt, Square s) {
    switch (pt) {
        case PAWN:   return PST_PAWN[s];
        case KNIGHT: return PST_KNIGHT[s];
        case BISHOP: return PST_BISHOP[s];
        case ROOK:   return PST_ROOK[s];
        case QUEEN:  return PST_QUEEN[s];
        case KING:   return PST_KING[s];
        default:     return 0;
    }
}

// Mirror a square for Black's PST lookup (flip rank: r ? 7-r)
constexpr Square flip_rank(Square s) {
    int lv = s / 32;
    int f  = s % 4;
    int r  = (s % 32) / 4;
    return Square(lv * 32 + (7 - r) * 4 + f);
}

// ?????????????????????????????????????????????
//  Static Evaluation — Enhanced Hand-Crafted
//
//  Features:
//    1. Material (QuadLevel piece values)
//    2. Piece-square tables (tapered: MG + EG)
//    3. Mobility (per-piece-type weights)
//    4. Bishop pair bonus
//    5. Pawn structure (passed, doubled, isolated)
//    6. Rook on open / semi-open file
//    7. Pawn shield for kings
//    8. Level dominance (3D-specific: multi-level presence)
//    9. King tropism (attacker proximity to enemy kings)
//   10. Tempo bonus
//
//  All values in centipawns.  Positive = White advantage.
// ?????????????????????????????????????????????

// --- Weights ---
constexpr Value MOBILITY_KNIGHT    = 4;
constexpr Value MOBILITY_BISHOP    = 5;
constexpr Value MOBILITY_ROOK      = 3;
constexpr Value MOBILITY_QUEEN     = 2;
constexpr Value BISHOP_PAIR_BONUS  = 35;
constexpr Value ROOK_OPEN_FILE     = 20;
constexpr Value ROOK_SEMI_OPEN     = 10;
constexpr Value PASSED_PAWN_BASE   = 15;   // + rank bonus
constexpr Value DOUBLED_PAWN       = -12;
constexpr Value ISOLATED_PAWN      = -15;
constexpr Value CONNECTED_PAWN     = 8;
constexpr Value PAWN_SHIELD_BONUS  = 10;   // per shield pawn
constexpr Value KING_ATTACK_WEIGHT = 10;
constexpr Value KING_TROPISM_WEIGHT= 2;    // per distance-unit closer
constexpr Value LEVEL_SPREAD_BONUS = 8;    // per extra level occupied by pieces
constexpr Value TEMPO_BONUS        = 14;
constexpr Value PAWN_THREAT_QUEEN  = 60;   // queen on square attacked by enemy pawn
constexpr Value PAWN_THREAT_ROOK   = 25;   // rook on square attacked by enemy pawn
constexpr Value PAWN_THREAT_MINOR  = 15;   // bishop/knight attacked by enemy pawn
constexpr Value EARLY_QUEEN_PENALTY= 40;   // queen developed too early (first 8 moves)

// Game phase — used for tapered eval
constexpr int PHASE_TOTAL = 4 * KnightValue3D + 4 * BishopValue3D
                          + 4 * RookValue3D   + 2 * QueenValue3D;  // ~4560

// --- Helper: Manhattan distance on 3D board (file + rank + level) ---
inline int manhattan_3d(Square a, Square b) {
    Coord ca = decompose(a);
    Coord cb = decompose(b);
    return std::abs(ca.level - cb.level) + std::abs(ca.file - cb.file) + std::abs(ca.rank - cb.rank);
}

inline Value evaluate(const Position3D& pos) {
    Value mg_score = 0;  // middlegame
    Value eg_score = 0;  // endgame
    int   phase    = 0;  // for taper
    Color us = pos.side_to_move();

    // ??? 1. Material + PST ???
    for (int sq = 0; sq < SQUARE_NB; ++sq) {
        Piece pc = pos.piece_on(Square(sq));
        if (pc == NO_PIECE) continue;

        Color     c  = color_of(pc);
        PieceType pt = type_of(pc);
        int sign = (c == WHITE) ? 1 : -1;

        // Material (same for MG/EG)
        mg_score += sign * PieceValue3D[pc];
        eg_score += sign * PieceValue3D[pc];

        // PST (flip for Black)
        Square pst_sq = (c == WHITE) ? Square(sq) : flip_rank(Square(sq));
        int pst = pst_value(pt, pst_sq);
        mg_score += sign * pst;
        eg_score += sign * (pst * 3 / 4);  // EG: PST slightly dampened

        // Accumulate phase (non-pawn, non-king material)
        if (pt != PAWN && pt != KING)
            phase += PieceValue3D[pc];
    }

    // ??? 2. Bishop pair ???
    if (pos.count(WHITE, BISHOP) >= 2) { mg_score += BISHOP_PAIR_BONUS; eg_score += BISHOP_PAIR_BONUS + 10; }
    if (pos.count(BLACK, BISHOP) >= 2) { mg_score -= BISHOP_PAIR_BONUS; eg_score -= (BISHOP_PAIR_BONUS + 10); }

    Bitboard128 occ = pos.pieces();

    // ??? 3. Mobility + 6. Rook open file + 9. King tropism ???
    for (int c = 0; c < COLOR_NB; ++c) {
        Color col = Color(c);
        Color enemy = ~col;
        int sign = (col == WHITE) ? 1 : -1;
        int mob_mg = 0, mob_eg = 0;
        int tropism = 0;

        // Find closest enemy king for tropism
        Square enemy_kings[2] = { SQ_NONE, SQ_NONE };
        for (int ki = 0; ki < pos.king_count(enemy); ++ki)
            enemy_kings[ki] = pos.king_square(enemy, ki);

        // Knights
        Bitboard128 bb = pos.pieces(col, KNIGHT);
        while (bb.any()) {
            Square s = bb.pop_lsb();
            int m = (pos.knight_attacks(s) & ~pos.pieces(col)).popcount();
            mob_mg += MOBILITY_KNIGHT * m;
            mob_eg += MOBILITY_KNIGHT * m;
            for (int ki = 0; ki < 2; ++ki)
                if (enemy_kings[ki] != SQ_NONE)
                    tropism += std::max(0, 7 - manhattan_3d(s, enemy_kings[ki]));
        }
        // Bishops
        bb = pos.pieces(col, BISHOP);
        while (bb.any()) {
            Square s = bb.pop_lsb();
            int m = (pos.bishop_attacks(s, occ) & ~pos.pieces(col)).popcount();
            mob_mg += MOBILITY_BISHOP * m;
            mob_eg += MOBILITY_BISHOP * m;
            for (int ki = 0; ki < 2; ++ki)
                if (enemy_kings[ki] != SQ_NONE)
                    tropism += std::max(0, 7 - manhattan_3d(s, enemy_kings[ki]));
        }
        // Rooks
        bb = pos.pieces(col, ROOK);
        while (bb.any()) {
            Square s = bb.pop_lsb();
            int m = (pos.rook_attacks(s, occ) & ~pos.pieces(col)).popcount();
            mob_mg += MOBILITY_ROOK * m;
            mob_eg += (MOBILITY_ROOK + 1) * m;  // rooks gain value in endgame
            for (int ki = 0; ki < 2; ++ki)
                if (enemy_kings[ki] != SQ_NONE)
                    tropism += std::max(0, 7 - manhattan_3d(s, enemy_kings[ki]));

            // Open / semi-open file (check file+level column for pawns)
            int f = file_of(s);
            int lv = level_of(s);
            bool own_pawn = false, enemy_pawn = false;
            for (int r = 0; r < NUM_RANKS; ++r) {
                Square col_sq = make_square(Level(lv), File(f), Rank(r));
                Piece p = pos.piece_on(col_sq);
                if (type_of(p) == PAWN) {
                    if (color_of(p) == col) own_pawn = true;
                    else                    enemy_pawn = true;
                }
            }
            if (!own_pawn && !enemy_pawn) {
                mob_mg += ROOK_OPEN_FILE;
                mob_eg += ROOK_OPEN_FILE;
            } else if (!own_pawn) {
                mob_mg += ROOK_SEMI_OPEN;
                mob_eg += ROOK_SEMI_OPEN;
            }
        }
        // Queens
        bb = pos.pieces(col, QUEEN);
        while (bb.any()) {
            Square s = bb.pop_lsb();
            int m = (pos.queen_attacks(s, occ) & ~pos.pieces(col)).popcount();
            mob_mg += MOBILITY_QUEEN * m;
            mob_eg += MOBILITY_QUEEN * m;
            for (int ki = 0; ki < 2; ++ki)
                if (enemy_kings[ki] != SQ_NONE)
                    tropism += std::max(0, 7 - manhattan_3d(s, enemy_kings[ki])) * 2;
        }

        mg_score += sign * mob_mg;
        eg_score += sign * mob_eg;
        mg_score += sign * KING_TROPISM_WEIGHT * tropism;
    }

    // ??? 4. Pawn structure ???
    for (int c = 0; c < COLOR_NB; ++c) {
        Color col = Color(c);
        int sign = (col == WHITE) ? 1 : -1;
        int push = pawn_push(col);
        int promo_rank = (col == WHITE) ? 7 : 0;

        Bitboard128 own_pawns   = pos.pieces(col, PAWN);
        Bitboard128 enemy_pawns = pos.pieces(~col, PAWN);

        Bitboard128 bb = own_pawns;
        while (bb.any()) {
            Square s = bb.pop_lsb();
            int f  = file_of(s);
            int r  = rank_of(s);
            int lv = level_of(s);

            // Passed pawn: no enemy pawns on same file+level ahead
            {
                bool passed = true;
                for (int rr = r + push; rr >= 0 && rr < NUM_RANKS; rr += push) {
                    // Check same file and adjacent files on same level
                    for (int df = -1; df <= 1; ++df) {
                        int ff = f + df;
                        if (ff < 0 || ff >= NUM_FILES) continue;
                        Square sq = make_square(Level(lv), File(ff), Rank(rr));
                        Piece p = pos.piece_on(sq);
                        if (p != NO_PIECE && type_of(p) == PAWN && color_of(p) == ~col) {
                            passed = false;
                            break;
                        }
                    }
                    if (!passed) break;
                }
                if (passed) {
                    int dist_to_promo = std::abs(promo_rank - r);
                    int bonus = PASSED_PAWN_BASE + (7 - dist_to_promo) * 6;
                    mg_score += sign * (bonus / 2);
                    eg_score += sign * bonus;  // passed pawns much more valuable in EG
                }
            }

            // Doubled pawn: another own pawn on same file+level
            {
                for (int rr = r + push; rr >= 0 && rr < NUM_RANKS; rr += push) {
                    Square sq = make_square(Level(lv), File(f), Rank(rr));
                    Piece p = pos.piece_on(sq);
                    if (p != NO_PIECE && type_of(p) == PAWN && color_of(p) == col) {
                        mg_score += sign * DOUBLED_PAWN;
                        eg_score += sign * DOUBLED_PAWN;
                        break;
                    }
                }
            }

            // Isolated pawn: no friendly pawns on adjacent files (same level)
            {
                bool has_neighbor = false;
                for (int df = -1; df <= 1; df += 2) {
                    int ff = f + df;
                    if (ff < 0 || ff >= NUM_FILES) continue;
                    for (int rr = 0; rr < NUM_RANKS; ++rr) {
                        Square sq = make_square(Level(lv), File(ff), Rank(rr));
                        Piece p = pos.piece_on(sq);
                        if (p != NO_PIECE && type_of(p) == PAWN && color_of(p) == col) {
                            has_neighbor = true;
                            break;
                        }
                    }
                    if (has_neighbor) break;
                }
                if (!has_neighbor) {
                    mg_score += sign * ISOLATED_PAWN;
                    eg_score += sign * (ISOLATED_PAWN - 5);
                }
            }

            // Connected pawn: friendly pawn on adjacent file, same or adjacent rank (same level)
            {
                bool connected = false;
                for (int df = -1; df <= 1; df += 2) {
                    int ff = f + df;
                    if (ff < 0 || ff >= NUM_FILES) continue;
                    for (int dr = -1; dr <= 1; ++dr) {
                        int rr = r + dr;
                        if (rr < 0 || rr >= NUM_RANKS) continue;
                        Square sq = make_square(Level(lv), File(ff), Rank(rr));
                        Piece p = pos.piece_on(sq);
                        if (p != NO_PIECE && type_of(p) == PAWN && color_of(p) == col) {
                            connected = true;
                            break;
                        }
                    }
                    if (connected) break;
                }
                if (connected) {
                    mg_score += sign * CONNECTED_PAWN;
                    eg_score += sign * CONNECTED_PAWN;
                }
            }
        }
    }

    // ??? 5. King safety — attacker count + pawn shield ???
    for (int c = 0; c < COLOR_NB; ++c) {
        Color col = Color(c);
        Color enemy = ~col;
        int sign = (col == WHITE) ? 1 : -1;
        int danger = 0;
        int shield = 0;

        for (int ki = 0; ki < pos.king_count(col); ++ki) {
            Square ksq = pos.king_square(col, ki);
            if (ksq == SQ_NONE) continue;

            // King zone = king attacks + king square itself
            Bitboard128 king_zone = pos.king_attacks(ksq);
            king_zone.set(ksq);

            // Count enemy pieces attacking king zone
            Bitboard128 enemy_knights = pos.pieces(enemy, KNIGHT);
            while (enemy_knights.any()) {
                Square s = enemy_knights.pop_lsb();
                if ((pos.knight_attacks(s) & king_zone).any()) danger++;
            }
            Bitboard128 enemy_bishops = pos.pieces(enemy, BISHOP);
            while (enemy_bishops.any()) {
                Square s = enemy_bishops.pop_lsb();
                if ((pos.bishop_attacks(s, occ) & king_zone).any()) danger++;
            }
            Bitboard128 enemy_rooks = pos.pieces(enemy, ROOK);
            while (enemy_rooks.any()) {
                Square s = enemy_rooks.pop_lsb();
                if ((pos.rook_attacks(s, occ) & king_zone).any()) danger++;
            }
            Bitboard128 enemy_queens = pos.pieces(enemy, QUEEN);
            while (enemy_queens.any()) {
                Square s = enemy_queens.pop_lsb();
                if ((pos.queen_attacks(s, occ) & king_zone).any()) danger += 2;
            }

            // Pawn shield: count friendly pawns in king zone
            Bitboard128 shield_pawns = pos.pieces(col, PAWN) & king_zone;
            shield += shield_pawns.popcount();
        }

        mg_score -= sign * KING_ATTACK_WEIGHT * danger;
        mg_score += sign * PAWN_SHIELD_BONUS * shield;
        eg_score -= sign * (KING_ATTACK_WEIGHT / 2) * danger;  // less important in EG
    }

    // ??? 7. Level dominance (3D-specific) ???
    for (int c = 0; c < COLOR_NB; ++c) {
        Color col = Color(c);
        int sign = (col == WHITE) ? 1 : -1;
        int levels_occupied = 0;
        for (int lv = 0; lv < NUM_LEVELS; ++lv) {
            // Check if this side has any non-pawn piece on this level
            for (int r = 0; r < NUM_RANKS; ++r) {
                bool found = false;
                for (int f = 0; f < NUM_FILES; ++f) {
                    Square sq = make_square(Level(lv), File(f), Rank(r));
                    Piece p = pos.piece_on(sq);
                    if (p != NO_PIECE && color_of(p) == col && type_of(p) != PAWN) {
                        levels_occupied++;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }
        // Bonus for occupying more than 1 level with pieces
        if (levels_occupied > 1) {
            int bonus = (levels_occupied - 1) * LEVEL_SPREAD_BONUS;
            mg_score += sign * bonus;
            eg_score += sign * bonus;
        }
    }

    // ??? 8. Pawn threats to pieces (cross-level aware) ???
    //   Penalise pieces sitting on squares attacked by enemy pawns.
    //   This catches cross-level (Y-Z plane) pawn forks that the
    //   search might not see at shallow depths.
    for (int c = 0; c < COLOR_NB; ++c) {
        Color col   = Color(c);
        Color enemy  = ~col;
        int   sign   = (col == WHITE) ? 1 : -1;

        // Build a bitboard of all squares attacked by enemy pawns
        Bitboard128 enemy_pawn_atk = BB_ZERO;
        Bitboard128 ep = pos.pieces(enemy, PAWN);
        while (ep.any()) {
            Square ps = ep.pop_lsb();
            enemy_pawn_atk |= pos.pawn_attacks(enemy, ps);
        }

        // Queens
        Bitboard128 q = pos.pieces(col, QUEEN);
        while (q.any()) {
            Square s = q.pop_lsb();
            if (enemy_pawn_atk.test(s)) {
                mg_score -= sign * PAWN_THREAT_QUEEN;
                eg_score -= sign * PAWN_THREAT_QUEEN;
            }
        }
        // Rooks
        Bitboard128 r = pos.pieces(col, ROOK);
        while (r.any()) {
            Square s = r.pop_lsb();
            if (enemy_pawn_atk.test(s)) {
                mg_score -= sign * PAWN_THREAT_ROOK;
                eg_score -= sign * PAWN_THREAT_ROOK;
            }
        }
        // Bishops & Knights
        Bitboard128 bn = pos.pieces(col, BISHOP) | pos.pieces(col, KNIGHT);
        while (bn.any()) {
            Square s = bn.pop_lsb();
            if (enemy_pawn_atk.test(s)) {
                mg_score -= sign * PAWN_THREAT_MINOR;
                eg_score -= sign * PAWN_THREAT_MINOR;
            }
        }
    }

    // ??? 9. Early Queen development penalty ???
    //   Discourage moving Queens past rank 3 (White) or rank 6 (Black)
    //   in the first ~8 full moves (16 plies).  Applies only in MG.
    if (pos.game_ply() < 16) {
        for (int c = 0; c < COLOR_NB; ++c) {
            Color col  = Color(c);
            int   sign = (col == WHITE) ? 1 : -1;
            Rank  limit = (col == WHITE) ? RANK_3 : RANK_6;

            Bitboard128 q = pos.pieces(col, QUEEN);
            while (q.any()) {
                Square s = q.pop_lsb();
                Rank r = rank_of(s);
                bool too_far = (col == WHITE) ? (r > limit) : (r < limit);
                if (too_far) {
                    int dist = (col == WHITE) ? (int(r) - int(limit))
                                              : (int(limit) - int(r));
                    mg_score -= sign * EARLY_QUEEN_PENALTY * dist;
                }
            }
        }
    }

    // ??? 10. Tempo ???
    mg_score += (us == WHITE) ? TEMPO_BONUS : -TEMPO_BONUS;

    // ??? Tapered eval: interpolate between MG and EG ???
    // phase = total non-pawn/king material still on board
    if (phase > PHASE_TOTAL) phase = PHASE_TOTAL;
    // MG weight = phase / PHASE_TOTAL, EG weight = 1 - that
    Value score = (mg_score * phase + eg_score * (PHASE_TOTAL - phase)) / PHASE_TOTAL;

    // Return from side-to-move's perspective
    return (us == WHITE) ? score : -score;
}

// ?????????????????????????????????????????????
//  Transposition Table
// ?????????????????????????????????????????????

enum TTFlag : uint8_t { TT_EXACT, TT_ALPHA, TT_BETA };

struct TTEntry {
    uint64_t key   = 0;
    int      depth = -1;
    Value    score = VALUE_NONE;
    TTFlag   flag  = TT_ALPHA;
    Move3D   best  = Move3D::none();
};

class TransTable {
   public:
    TransTable(size_t size_mb = 64) { resize(size_mb); }

    void resize(size_t size_mb) {
        size_t count = (size_mb * 1024 * 1024) / sizeof(TTEntry);
        if (count < 1024) count = 1024;
        table.assign(count, TTEntry{});
        mask = count - 1;
        // Round down to power of 2 for fast masking
        while (mask & (mask + 1))
            mask |= (mask >> 1);
        table.resize(mask + 1);
    }

    void clear() {
        for (auto& e : table) e = TTEntry{};
    }

    TTEntry* probe(uint64_t key) {
        TTEntry& e = table[key & mask];
        return (e.key == key) ? &e : nullptr;
    }

    void store(uint64_t key, int depth, Value score, TTFlag flag, Move3D best) {
        TTEntry& e = table[key & mask];
        // Always-replace or deeper
        if (e.key != key || depth >= e.depth) {
            e.key   = key;
            e.depth = depth;
            e.score = score;
            e.flag  = flag;
            e.best  = best;
        }
    }

   private:
    std::vector<TTEntry> table;
    size_t mask = 0;
};

// ?????????????????????????????????????????????
//  Simple Zobrist hashing for Position3D
// ?????????????????????????????????????????????

namespace Zobrist3D {

// Deterministic pseudo-random keys
constexpr uint64_t seed_mix(uint64_t x) {
    x ^= x >> 33;
    x *= 0xff51afd7ed558ccdULL;
    x ^= x >> 33;
    x *= 0xc4ceb9fe1a85ec53ULL;
    x ^= x >> 33;
    return x;
}

inline uint64_t piece_key(Piece pc, Square sq) {
    return seed_mix(uint64_t(pc) * 131 + uint64_t(sq) * 7919 + 0xDEADBEEFCAFE0001ULL);
}

inline uint64_t side_key() {
    return seed_mix(0xA5A5A5A5A5A5A5A5ULL);
}

inline uint64_t ep_key(Square sq) {
    return seed_mix(uint64_t(sq) * 6271 + 0x123456789ABCDEF0ULL);
}

inline uint64_t castling_key(int rights) {
    return seed_mix(uint64_t(rights) * 9973 + 0xFEDCBA9876543210ULL);
}

inline uint64_t compute_hash(const Position3D& pos) {
    uint64_t h = 0;
    for (int sq = 0; sq < SQUARE_NB; ++sq) {
        Piece pc = pos.piece_on(Square(sq));
        if (pc != NO_PIECE)
            h ^= piece_key(pc, Square(sq));
    }
    if (pos.side_to_move() == BLACK)
        h ^= side_key();
    if (pos.ep_square() != SQ_NONE)
        h ^= ep_key(pos.ep_square());
    h ^= castling_key(pos.castling_rights());
    return h;
}

}  // namespace Zobrist3D

// ?????????????????????????????????????????????
//  Move ordering
// ?????????????????????????????????????????????

struct ScoredMove {
    Move3D move;
    int    score;
};

inline void score_moves(const Position3D& pos,
                         std::vector<ScoredMove>& scored,
                         const std::vector<Move3D>& moves,
                         Move3D tt_move,
                         Move3D killer1,
                         Move3D killer2,
                         const int history[PIECE_NB][SQUARE_NB]) {
    scored.clear();
    scored.reserve(moves.size());

    for (const auto& m : moves) {
        int sc = 0;

        if (m == tt_move) {
            sc = 100000;
        } else if (pos.piece_on(m.to_sq()) != NO_PIECE || m.type_of() == EN_PASSANT_3D) {
            // MVV-LVA: victim value - attacker value / 100
            Piece victim = pos.piece_on(m.to_sq());
            if (m.type_of() == EN_PASSANT_3D)
                sc = 10000 + PawnValue3D;
            else
                sc = 10000 + PieceValue3D[victim] - PieceValue3D[pos.piece_on(m.from_sq())] / 100;
        } else if (m.type_of() == PROMOTION_3D) {
            sc = 9000 + PieceValue3D[make_piece(WHITE, m.promotion_type())];
        } else if (m == killer1) {
            sc = 8000;
        } else if (m == killer2) {
            sc = 7000;
        } else {
            // History heuristic
            Piece pc = pos.piece_on(m.from_sq());
            sc = history[pc][m.to_sq()];
        }

        scored.push_back({m, sc});
    }

    // Sort descending by score
    std::sort(scored.begin(), scored.end(),
              [](const ScoredMove& a, const ScoredMove& b) { return a.score > b.score; });
}

// ?????????????????????????????????????????????
//  Search3D — iterative deepening alpha-beta
// ?????????????????????????????????????????????

struct SearchResult {
    Move3D best_move  = Move3D::none();
    Value  score      = VALUE_ZERO;
    int    depth      = 0;
    int    nodes      = 0;
    int    time_ms    = 0;
    std::vector<Move3D> pv;
};

// Callback for info output (optional)
using InfoCallback = std::function<void(const SearchResult&)>;

class Search3D {
   public:
    Search3D() { clear(); }

    void clear() {
        tt.clear();
        std::memset(history, 0, sizeof(history));
        std::memset(killers, 0, sizeof(killers));
        nodes_searched = 0;
        stop_flag = false;
    }

    void set_tt_size(size_t mb) { tt.resize(mb); }

    // Search the position to the given depth (or within time limit)
    SearchResult search(Position3D& pos, int max_depth,
                        int time_limit_ms = 0,
                        InfoCallback info_cb = nullptr) {
        clear();
        stop_flag = false;
        time_limit = time_limit_ms;
        start_time = std::chrono::steady_clock::now();

        // --- Opening book: return a book move for the first move ---
        Move3D book = probe_opening_book(pos);
        if (book.is_ok()) {
            SearchResult result;
            result.best_move = book;
            result.score     = VALUE_ZERO;
            result.depth     = 0;
            result.nodes     = 0;
            result.pv        = { book };
            return result;
        }

        SearchResult result;
        std::vector<Move3D> pv;

        // Iterative deepening
        for (int depth = 1; depth <= max_depth; ++depth) {
            nodes_searched = 0;
            pv.clear();

            Value score = alpha_beta(pos, depth, -VALUE_MATE - 1, VALUE_MATE + 1, 0, pv, true);

            if (stop_flag && depth > 1)
                break;  // Use previous iteration's result

            result.best_move = pv.empty() ? Move3D::none() : pv[0];
            result.score     = score;
            result.depth     = depth;
            result.nodes     = nodes_searched;
            result.pv        = pv;

            auto now = std::chrono::steady_clock::now();
            result.time_ms = int(std::chrono::duration_cast<std::chrono::milliseconds>(
                                     now - start_time).count());

            if (info_cb)
                info_cb(result);

            // If we found a mate, stop
            if (score >= VALUE_MATE - MAX_PLY_3D || score <= -VALUE_MATE + MAX_PLY_3D)
                break;

            // Time check — if we've used more than half our time, don't start next iteration
            if (time_limit > 0 && result.time_ms > time_limit / 2)
                break;
        }

        return result;
    }

   private:
    TransTable tt;
    int        history[PIECE_NB][SQUARE_NB];
    Move3D     killers[MAX_PLY_3D + 1][2];
    int        nodes_searched;
    bool       stop_flag;
    int        time_limit;
    std::chrono::steady_clock::time_point start_time;

    // --- Opening book ---
    // White move 1: random from 4 central pawn double-pushes
    // Black move 1: lookup based on what White played, default 3c5
    Move3D probe_opening_book(Position3D& pos) const {
        Color us = pos.side_to_move();
        int ply  = pos.game_ply();

        if (ply == 0 && us == WHITE) {
            // White's first move: randomly pick one of 4 openings
            // Coordinate moves: from?to (level,file,rank encoded)
            //   "2c22c4" = sq3(1,2,1) ? sq3(3,2,1)   (level 2, file c, rank 2?4)
            //   "2b22b4" = sq3(1,1,1) ? sq3(3,1,1)   (level 2, file b, rank 2?4)
            //   "3c23c4" = sq3(1,2,2) ? sq3(3,2,2)   (level 3, file c, rank 2?4)
            //   "3b23b4" = sq3(1,1,2) ? sq3(3,1,2)   (level 3, file b, rank 2?4)
            struct BookEntry { Square from; Square to; };
            const BookEntry white_openings[4] = {
                { sq3(1, 2, 1), sq3(3, 2, 1) },  // 2c22c4
                { sq3(1, 1, 1), sq3(3, 1, 1) },  // 2b22b4
                { sq3(1, 2, 2), sq3(3, 2, 2) },  // 3c23c4
                { sq3(1, 1, 2), sq3(3, 1, 2) },  // 3b23b4
            };

            // Seed RNG from high-resolution clock for varied play
            auto seed = static_cast<unsigned>(
                std::chrono::steady_clock::now().time_since_epoch().count());
            std::mt19937 rng(seed);
            int idx = std::uniform_int_distribution<int>(0, 3)(rng);

            const auto& entry = white_openings[idx];
            // Verify the move is legal
            auto legal = pos.generate_legal_moves();
            for (const auto& lm : legal) {
                if (lm.from_sq() == entry.from && lm.to_sq() == entry.to)
                    return lm;
            }
        }

        if (ply == 1 && us == BLACK) {
            // Black's first move: detect what White played by scanning
            // the board for deviations from the start position.
            //
            // Strategy: check each of the known White opening destinations
            // and see if a White pawn is there (it wouldn't be at startpos).
            // Also check for knight moves to rank 3.
            //
            // Response map (destination square ? Black's reply as from?to):
            struct ResponseEntry {
                Square detect;       // White piece destination to detect
                PieceType detect_pt; // expected piece type at destination
                Square resp_from;    // Black's response from
                Square resp_to;      // Black's response to
            };

            // sq3(rank, file, level) per the codebase convention
            const ResponseEntry black_responses[] = {
                // Pawn openings — White pawn at rank 4 (index 3)
                { sq3(3, 2, 2), PAWN,   sq3(6, 2, 2), sq3(4, 2, 2) },  // 3c4 ? 3c73c5 (3c5)
                { sq3(3, 1, 2), PAWN,   sq3(6, 1, 2), sq3(4, 1, 2) },  // 3b4 ? 3b73b5 (3b5)
                { sq3(3, 1, 1), PAWN,   sq3(6, 1, 1), sq3(4, 1, 1) },  // 2b4 ? 2b72b5 (2b5)
                { sq3(3, 2, 1), PAWN,   sq3(6, 2, 1), sq3(4, 2, 1) },  // 2c4 ? 2c72c5 (2c5)
                { sq3(3, 0, 1), PAWN,   sq3(6, 2, 1), sq3(4, 2, 1) },  // 2a4 ? 2c5
                { sq3(3, 3, 1), PAWN,   sq3(6, 1, 1), sq3(4, 1, 1) },  // 2d4 ? 2b5
                { sq3(3, 0, 2), PAWN,   sq3(6, 2, 2), sq3(4, 2, 2) },  // 3a4 ? 3c5
                { sq3(3, 3, 2), PAWN,   sq3(6, 1, 2), sq3(4, 1, 2) },  // 3d4 ? 3b5
                // Knight openings — White knight at rank 3 (index 2)
                { sq3(2, 2, 0), KNIGHT, sq3(6, 2, 1), sq3(4, 2, 1) },  // N1c3 ? 2c5
                { sq3(2, 1, 1), KNIGHT, sq3(6, 2, 1), sq3(4, 2, 1) },  // N2b3 ? 2c5
                { sq3(2, 2, 1), KNIGHT, sq3(6, 2, 1), sq3(4, 2, 1) },  // N2c3 ? 2c5
                { sq3(2, 3, 2), KNIGHT, sq3(6, 1, 1), sq3(4, 1, 1) },  // N3d3 ? 2b5
                { sq3(2, 1, 3), KNIGHT, sq3(6, 1, 2), sq3(4, 1, 2) },  // N4b3 ? 3b5
                { sq3(2, 2, 2), KNIGHT, sq3(6, 1, 2), sq3(4, 1, 2) },  // N3c3 ? 3b5
            };

            // Scan for what White played
            for (const auto& re : black_responses) {
                Piece p = pos.piece_on(re.detect);
                if (p != NO_PIECE && color_of(p) == WHITE && type_of(p) == re.detect_pt) {
                    // Verify the response move is legal
                    auto legal = pos.generate_legal_moves();
                    for (const auto& lm : legal) {
                        if (lm.from_sq() == re.resp_from && lm.to_sq() == re.resp_to)
                            return lm;
                    }
                }
            }

            // Default: 3c73c5 (level 3, file c, rank 7?5)
            Square def_from = sq3(6, 2, 2);
            Square def_to   = sq3(4, 2, 2);
            auto legal = pos.generate_legal_moves();
            for (const auto& lm : legal) {
                if (lm.from_sq() == def_from && lm.to_sq() == def_to)
                    return lm;
            }
        }

        return Move3D::none();  // Not in opening book
    }

    bool time_up() const {
        if (time_limit <= 0) return false;
        auto now = std::chrono::steady_clock::now();
        int elapsed = int(std::chrono::duration_cast<std::chrono::milliseconds>(
                              now - start_time).count());
        return elapsed >= time_limit;
    }

    // Quiescence search — only captures and promotions
    Value quiesce(Position3D& pos, Value alpha, Value beta, int ply) {
        nodes_searched++;

        // Time check every 4096 nodes
        if ((nodes_searched & 4095) == 0 && time_up()) {
            stop_flag = true;
            return VALUE_ZERO;
        }

        Value stand_pat = evaluate(pos);

        if (stand_pat >= beta)
            return beta;
        if (stand_pat > alpha)
            alpha = stand_pat;

        auto moves = pos.generate_legal_moves();

        // Filter to captures and promotions only
        std::vector<Move3D> captures;
        for (const auto& m : moves) {
            if (pos.piece_on(m.to_sq()) != NO_PIECE
                || m.type_of() == EN_PASSANT_3D
                || m.type_of() == PROMOTION_3D)
                captures.push_back(m);
        }

        // Score and sort captures
        std::vector<ScoredMove> scored;
        score_moves(pos, scored, captures, Move3D::none(), Move3D::none(), Move3D::none(), history);

        for (const auto& sm : scored) {
            auto undo = pos.do_move(sm.move);
            Value score = -quiesce(pos, -beta, -alpha, ply + 1);
            pos.undo_move(sm.move, undo);

            if (stop_flag)
                return VALUE_ZERO;

            if (score >= beta)
                return beta;
            if (score > alpha)
                alpha = score;
        }

        return alpha;
    }

    Value alpha_beta(Position3D& pos, int depth, Value alpha, Value beta,
                     int ply, std::vector<Move3D>& pv, bool do_null) {
        nodes_searched++;
        pv.clear();

        // Time check every 4096 nodes
        if ((nodes_searched & 4095) == 0 && time_up()) {
            stop_flag = true;
            return VALUE_ZERO;
        }

        bool in_check = pos.in_check(pos.side_to_move());

        // Check extension
        if (in_check)
            depth++;

        // Leaf node — quiescence
        if (depth <= 0)
            return quiesce(pos, alpha, beta, ply);

        // Draw by 50-move rule
        if (pos.rule50_count() >= 100)
            return VALUE_ZERO;

        bool is_pv = (beta - alpha > 1);

        // --- Transposition table probe ---
        uint64_t hash = Zobrist3D::compute_hash(pos);
        Move3D tt_move = Move3D::none();
        TTEntry* tte = tt.probe(hash);
        if (tte) {
            tt_move = tte->best;
            if (tte->depth >= depth && !is_pv) {
                if (tte->flag == TT_EXACT)
                    return tte->score;
                if (tte->flag == TT_ALPHA && tte->score <= alpha)
                    return alpha;
                if (tte->flag == TT_BETA && tte->score >= beta)
                    return beta;
            }
        }

        Value static_eval = evaluate(pos);

        // --- Null-move pruning ---
        if (do_null && !in_check && !is_pv && depth >= 3 && static_eval >= beta) {
            int R = 2 + depth / 6;
            auto null_undo = pos.do_null_move();
            std::vector<Move3D> null_pv;
            Value null_score = -alpha_beta(pos, depth - 1 - R, -beta, -beta + 1,
                                            ply + 1, null_pv, false);
            pos.undo_null_move(null_undo);

            if (stop_flag)
                return VALUE_ZERO;

            if (null_score >= beta) {
                // Don't return mate scores from null-move search
                if (null_score >= VALUE_MATE - MAX_PLY_3D)
                    null_score = beta;
                return null_score;
            }
        }

        // --- Generate and order moves ---
        auto moves = pos.generate_legal_moves();

        // Checkmate or stalemate
        if (moves.empty()) {
            if (in_check) {
                // Checkmate — we lost (from our perspective)
                return -VALUE_MATE + ply;
            }
            return VALUE_ZERO;  // Stalemate
        }

        std::vector<ScoredMove> scored;
        score_moves(pos, scored, moves, tt_move,
                    killers[ply][0], killers[ply][1], history);

        Move3D best_move = Move3D::none();
        Value best_score = -VALUE_MATE - 1;
        TTFlag tt_flag = TT_ALPHA;
        std::vector<Move3D> child_pv;

        for (int i = 0; i < (int)scored.size(); ++i) {
            const Move3D& m = scored[i].move;

            auto undo = pos.do_move(m);
            Value score;

            // --- Late Move Reduction (LMR) ---
            bool is_capture = (undo.captured != NO_PIECE) || m.type_of() == EN_PASSANT_3D;
            bool is_promo   = m.type_of() == PROMOTION_3D;

            if (i >= 4 && depth >= 3 && !in_check && !is_capture && !is_promo) {
                // Reduced search
                int reduction = 1 + i / 8;
                if (reduction > depth - 2)
                    reduction = depth - 2;

                score = -alpha_beta(pos, depth - 1 - reduction, -(alpha + 1), -alpha,
                                     ply + 1, child_pv, true);

                // Re-search at full depth if it beats alpha
                if (score > alpha)
                    score = -alpha_beta(pos, depth - 1, -beta, -alpha,
                                         ply + 1, child_pv, true);
            }
            // PVS: first move at full window, rest with null window
            else if (i > 0 && is_pv) {
                score = -alpha_beta(pos, depth - 1, -(alpha + 1), -alpha,
                                     ply + 1, child_pv, true);
                if (score > alpha && score < beta)
                    score = -alpha_beta(pos, depth - 1, -beta, -alpha,
                                         ply + 1, child_pv, true);
            } else {
                score = -alpha_beta(pos, depth - 1, -beta, -alpha,
                                     ply + 1, child_pv, true);
            }

            pos.undo_move(m, undo);

            if (stop_flag)
                return VALUE_ZERO;

            if (score > best_score) {
                best_score = score;
                best_move  = m;

                if (score > alpha) {
                    alpha = score;
                    tt_flag = TT_EXACT;

                    // Build PV
                    pv.clear();
                    pv.push_back(m);
                    pv.insert(pv.end(), child_pv.begin(), child_pv.end());

                    if (score >= beta) {
                        tt_flag = TT_BETA;

                        // Update killers and history for quiet moves
                        if (!is_capture && !is_promo) {
                            if (killers[ply][0] != m) {
                                killers[ply][1] = killers[ply][0];
                                killers[ply][0] = m;
                            }

                            Piece pc = pos.piece_on(m.from_sq());
                            if (pc != NO_PIECE)
                                history[pc][m.to_sq()] += depth * depth;
                        }
                        break;  // Beta cutoff
                    }
                }
            }
        }

        // Store to TT
        tt.store(hash, depth, best_score, tt_flag, best_move);

        return best_score;
    }
};

}  // namespace QuadLevel

#endif  // QUADLEVEL_SEARCH_H_INCLUDED
