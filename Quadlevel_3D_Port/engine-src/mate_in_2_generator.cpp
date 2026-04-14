#include "mate_in_2_generator.h"
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iterator>

namespace QuadLevel {

namespace {

static bool is_mate_score(Value score, int pliesTolerance = 4) {
    return score >= VALUE_MATE - pliesTolerance;
}

static bool move_forces_mate_in_two(Position3D& root, const Move3D& first, int time_limit_ms) {
    Position3D afterFirst = root;
    afterFirst.do_move(first); // defender to move

    auto replies = afterFirst.generate_legal_moves();
    if (replies.empty())
        return false; // mate-in-1 or stalemate, not mate-in-2

    // For every defender reply, attacker must have mate-in-1.
    const int verifyMs = std::clamp(time_limit_ms, 100, 500);
    for (const auto& r : replies) {
        Position3D afterReply = afterFirst;
        afterReply.do_move(r); // attacker to move

        Search3D local;
        SearchResult rr = local.search(afterReply, 3, verifyMs);
        if (!rr.best_move.is_ok() || !is_mate_score(rr.score, 2))
            return false;
    }

    return true;
}

} // namespace

MateInTwoGenerator::MateInTwoGenerator(size_t cache_limit)
    : max_cache_size(cache_limit),
      rng([&]() {
          const auto tick64 = static_cast<std::uint64_t>(
              std::chrono::steady_clock::now().time_since_epoch().count());
          std::seed_seq seed {
              static_cast<std::uint32_t>(tick64 & 0xFFFFFFFFull),
              static_cast<std::uint32_t>((tick64 >> 32) & 0xFFFFFFFFull)
          };
          return std::mt19937(seed);
      }()) {
    verifier.set_tt_size(128);  // 128 MB for verification
}

MateInTwoPuzzle MateInTwoGenerator::generate_puzzle(int max_attempts, int time_limit_ms) {
    MateInTwoPuzzle result;

    if (max_attempts < 1)
        return result;

    const int per_attempt_ms = std::clamp(time_limit_ms, 100, 750);
    const int total_budget_ms = std::clamp(max_attempts * 40, 3000, 30000);
    const auto start = std::chrono::steady_clock::now();

    // Try to generate valid puzzles
    for (int attempt = 0; attempt < max_attempts; ++attempt) {
        const auto now = std::chrono::steady_clock::now();
        const int elapsed_ms = int(std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count());
        if (elapsed_ms >= total_budget_ms)
            break;

        // Generate a random position
        Position3D candidate = generate_random_position(
            std::uniform_int_distribution<int>(3, 8)(rng)
        );

        Move3D first_move = Move3D::none();

        // Verify it's mate in 2
        if (verify_mate_in_two(candidate, first_move, per_attempt_ms)) {
            result.fen = candidate.fen();
            result.first_move = candidate.move_to_algebraic(first_move);
            result.side_to_move = candidate.side_to_move();
            result.mating_line = "Mate in 2 verified";

            // Add to cache if not at limit
            if (puzzle_cache.size() < max_cache_size) {
                puzzle_cache.push_back(result);
            }

            return result;
        }
    }

    return result;  // Return empty puzzle if all attempts failed
}

bool MateInTwoGenerator::is_mate_in_two(const Position3D& pos, int time_limit_ms) {
    Move3D dummy = Move3D::none();
    return verify_mate_in_two(pos, dummy, time_limit_ms);
}

const MateInTwoPuzzle* MateInTwoGenerator::get_cached_puzzle(size_t idx) const {
    if (idx >= puzzle_cache.size())
        return nullptr;
    return &puzzle_cache[idx];
}

Position3D MateInTwoGenerator::generate_random_position(int depth) {
    (void)depth;

    auto kings_too_close = [](Square a, Square b) {
        Coord ca = decompose(a);
        Coord cb = decompose(b);
        return std::abs(ca.level - cb.level) <= 1
            && std::abs(ca.file  - cb.file)  <= 1
            && std::abs(ca.rank  - cb.rank)  <= 1;
    };

    auto random_square_for = [&](Color c, bool pawn_only) -> Square {
        std::uniform_int_distribution<int> lvDist(0, NUM_LEVELS - 1);
        std::uniform_int_distribution<int> fileDist(0, NUM_FILES - 1);

        int rMin = (c == WHITE) ? 0 : 4;
        int rMax = (c == WHITE) ? 3 : 7;
        if (pawn_only) {
            // Keep pawns away from immediate promotion ranks and still side-oriented
            rMin = (c == WHITE) ? 1 : 4;
            rMax = (c == WHITE) ? 5 : 6;
        }
        std::uniform_int_distribution<int> rankDist(rMin, rMax);

        for (int tries = 0; tries < 128; ++tries) {
            Square s = make_square(Level(lvDist(rng)), File(fileDist(rng)), Rank(rankDist(rng)));
            return s;
        }
        return SQ_NONE;
    };

    // Try several construction attempts before falling back
    for (int buildAttempt = 0; buildAttempt < 128; ++buildAttempt) {
        Position3D pos;
        pos.clear();
        pos.set_castling_rights(0);

        std::vector<Square> wKings;
        std::vector<Square> bKings;

        auto place_two_kings = [&](Color c, std::vector<Square>& outKings, const std::vector<Square>& enemyKings) {
            Piece k = make_piece(c, KING);
            for (int placed = 0; placed < 2; ) {
                Square s = random_square_for(c, false);
                if (s == SQ_NONE || pos.piece_on(s) != NO_PIECE)
                    continue;

                bool bad = false;
                for (Square own : outKings) {
                    if (kings_too_close(own, s)) { bad = true; break; }
                }
                if (!bad) {
                    for (Square enemy : enemyKings) {
                        if (kings_too_close(enemy, s)) { bad = true; break; }
                    }
                }
                if (bad)
                    continue;

                pos.put_piece(k, s);
                outKings.push_back(s);
                ++placed;
            }
        };

        place_two_kings(WHITE, wKings, bKings);
        place_two_kings(BLACK, bKings, wKings);

        // Add a small number of puzzle-like tactical pieces
        std::uniform_int_distribution<int> extraDist(2, 5);
        int whiteExtras = extraDist(rng);
        int blackExtras = extraDist(rng);

        auto add_random_piece = [&](Color c) {
            // Weight toward puzzle-relevant tactical pieces
            static const PieceType pool[] = {
                QUEEN, ROOK, KNIGHT, BISHOP, PAWN, ROOK, KNIGHT
            };
            std::uniform_int_distribution<int> typeDist(0, int(std::size(pool)) - 1);

            for (int tries = 0; tries < 256; ++tries) {
                PieceType pt = pool[typeDist(rng)];
                Square s = random_square_for(c, pt == PAWN);
                if (s == SQ_NONE || pos.piece_on(s) != NO_PIECE)
                    continue;

                // Keep pawns off terminal ranks
                if (pt == PAWN) {
                    Rank r = rank_of(s);
                    if (r == RANK_1 || r == RANK_8)
                        continue;
                }

                pos.put_piece(make_piece(c, pt), s);
                return true;
            }
            return false;
        };

        for (int i = 0; i < whiteExtras; ++i)
            add_random_piece(WHITE);
        for (int i = 0; i < blackExtras; ++i)
            add_random_piece(BLACK);

        // Random side to move
        if (std::uniform_int_distribution<int>(0, 1)(rng) == 1)
            pos.do_null_move();

        // Sanity checks: avoid pathological or already-illegal setups
        if (pos.in_check(WHITE) || pos.in_check(BLACK))
            continue;

        auto legal = pos.generate_legal_moves();
        if (legal.empty())
            continue;

        return pos;
    }

    // Fallback: return start position if construction repeatedly fails
    Position3D fallback;
    fallback.set_startpos();
    fallback.set_castling_rights(0);
    return fallback;
}

bool MateInTwoGenerator::verify_mate_in_two(const Position3D& pos, Move3D& out_first_move,
                                           int time_limit_ms) {
    // Reject puzzles where side to move is already in check.
    if (pos.in_check(pos.side_to_move()))
        return false;

    // Quick gate: position should evaluate as mate-in-2 candidate first.
    Position3D work_pos = pos;
    SearchResult result = verifier.search(work_pos, 5, time_limit_ms);

    if (!result.best_move.is_ok())
        return false;

    constexpr Value MATE_THRESHOLD = VALUE_MATE - 4;
    if (result.score < MATE_THRESHOLD)
        return false;

    // Unique solution requirement:
    // exactly one legal first move must force mate-in-2.
    auto legal = pos.generate_legal_moves();
    int winningFirstMoves = 0;
    Move3D unique = Move3D::none();

    for (const auto& m : legal) {
        Position3D rootCopy = pos;
        if (move_forces_mate_in_two(rootCopy, m, time_limit_ms)) {
            ++winningFirstMoves;
            unique = m;
            if (winningFirstMoves > 1)
                return false;
        }
    }

    if (winningFirstMoves != 1)
        return false;

    out_first_move = unique;
    return true;
}

std::string MateInTwoGenerator::pv_to_string(const Position3D& pos,
                                            const std::vector<Move3D>& pv) const {
    std::string result;
    Position3D work_pos = pos;

    for (size_t i = 0; i < pv.size() && i < 4; ++i) {
        if (i > 0)
            result += " ";
        result += work_pos.move_to_algebraic(pv[i]);
        work_pos.do_move(pv[i]);
    }

    return result;
}

}  // namespace QuadLevel