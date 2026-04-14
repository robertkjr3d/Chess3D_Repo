/*
  QuadLevel Mate-in-2 Puzzle Miner

  Build (from engine-src directory):
    cl /std:c++20 /EHsc /O2 /I. puzzle_miner.cpp /Fe:puzzle_miner.exe

  Usage:
    puzzle_miner.exe
    puzzle_miner.exe <games>
    puzzle_miner.exe <games> <output_file>
    puzzle_miner.exe <games> <output_file> <selfplay_mode>
    puzzle_miner.exe <games> <output_file> <selfplay_mode> <filter_mode>

  selfplay_mode:
    randomized (default) | deterministic

  filter_mode:
    exact (default): mate-in-2 only (excludes mate-in-1)
    atmost2: allow mate-in-1 and mate-in-2

  Output format (pipe-delimited):
    fen|solution_coord|solution_algebraic|side
*/

#define QUADLEVEL_DLL_EXPORTS
#include "quadlevel_board.h"
#include "quadlevel_search.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <unordered_set>
#include <vector>

using namespace QuadLevel;

enum class FilterMode {
    ExactMate2,
    AtMostMate2
};

enum class FirstMoveMode {
    NonCheckOnly,
    NonCheckOrSacCheck
};

struct MinedPuzzle {
    std::string fen;
    Move3D      best;
    Color       side;
};

static bool is_mate_in_at_most_2(Position3D& pos, Search3D& verifier, Move3D& bestOut) {
    // Fast pass
    SearchResult fast = verifier.search(pos, 5, 700);
    if (!fast.best_move.is_ok())
        return false;

    if (fast.score < VALUE_MATE - 4)
        return false;

    // Confirm pass (time-unlimited) to avoid shallow false positives/negatives
    Position3D confirmPos = pos;
    SearchResult confirm = verifier.search(confirmPos, 5, 0);
    if (!confirm.best_move.is_ok())
        return false;

    if (confirm.score < VALUE_MATE - 4)
        return false;

    bestOut = confirm.best_move;
    return true;
}

static bool is_mate_in_1(Position3D& pos, Search3D& verifier) {
    SearchResult fast = verifier.search(pos, 3, 300);
    if (!fast.best_move.is_ok())
        return false;

    if (fast.score < VALUE_MATE - 2)
        return false;

    Position3D confirmPos = pos;
    SearchResult confirm = verifier.search(confirmPos, 3, 0);
    if (!confirm.best_move.is_ok())
        return false;

    return confirm.score >= VALUE_MATE - 2;
}

static bool detect_mate_in_2(Position3D& pos, Search3D& verifier, MinedPuzzle& out, FilterMode mode) {
    Move3D best = Move3D::none();
    if (!is_mate_in_at_most_2(pos, verifier, best))
        return false;

    if (mode == FilterMode::ExactMate2) {
        // Keep only exact mate-in-2 (exclude mate-in-1)
        if (is_mate_in_1(pos, verifier))
            return false;
    }

    out.fen  = pos.fen();
    out.best = best;
    out.side = pos.side_to_move();
    return true;
}

static bool parse_puzzle_line(const std::string& line,
                              std::string& fenOut,
                              std::string& coordOut,
                              std::string& algOut,
                              char& sideOut) {
    // Format: fen|solution_coord|solution_algebraic|side
    // Important: fen itself contains '|' separators between levels,
    // so parse from the right.
    size_t p3 = line.rfind('|');
    if (p3 == std::string::npos || p3 + 1 >= line.size())
        return false;

    size_t p2 = line.rfind('|', p3 - 1);
    if (p2 == std::string::npos)
        return false;

    size_t p1 = line.rfind('|', p2 - 1);
    if (p1 == std::string::npos)
        return false;

    fenOut   = line.substr(0, p1);
    coordOut = line.substr(p1 + 1, p2 - p1 - 1);
    algOut   = line.substr(p2 + 1, p3 - p2 - 1);
    sideOut  = line[p3 + 1];

    return !fenOut.empty() && !coordOut.empty() && !algOut.empty();
}

static void load_existing_fens(const std::string& path, std::unordered_set<std::string>& seen) {
    std::ifstream in(path);
    if (!in)
        return;

    std::string line;
    while (std::getline(in, line)) {
        if (line.empty())
            continue;

        std::string fen, coord, alg;
        char side = '?';
        if (!parse_puzzle_line(line, fen, coord, alg, side))
            continue;

        seen.insert(fen);
    }
}

static void randomize_start_position(Position3D& pos, std::mt19937& rng, int plies = 10) {
    for (int i = 0; i < plies; ++i) {
        auto legal = pos.generate_legal_moves();
        if (legal.empty())
            break;

        // 40% random move, otherwise quick shallow best move
        bool randomMove = std::uniform_real_distribution<double>(0.0, 1.0)(rng) < 0.40;
        Move3D chosen = Move3D::none();

        if (randomMove) {
            size_t idx = std::uniform_int_distribution<size_t>(0, legal.size() - 1)(rng);
            chosen = legal[idx];
        } else {
            Search3D quick;
            SearchResult r = quick.search(pos, 3, 120);
            if (r.best_move.is_ok())
                chosen = r.best_move;
            else {
                size_t idx = std::uniform_int_distribution<size_t>(0, legal.size() - 1)(rng);
                chosen = legal[idx];
            }
        }

        if (!chosen.is_ok())
            break;

        pos.do_move(chosen);
    }
}

static int count_checked_kings(const Position3D& pos, Color sideInCheck) {
    int checked = 0;
    for (int i = 0; i < pos.king_count(sideInCheck); ++i) {
        Square k = pos.king_square(sideInCheck, i);
        if (k != SQ_NONE && pos.is_attacked(k, ~sideInCheck))
            ++checked;
    }
    return checked;
}

static bool has_forced_mate_in_one_move(Position3D& attackerToMovePos, bool requireSingleKing) {
    auto legal = attackerToMovePos.generate_legal_moves();
    for (const auto& m : legal) {
        Position3D afterMateTry = attackerToMovePos;
        afterMateTry.do_move(m); // defender to move

        Color defender = afterMateTry.side_to_move();
        if (!afterMateTry.in_check(defender))
            continue;

        auto defenderLegal = afterMateTry.generate_legal_moves();
        if (!defenderLegal.empty())
            continue;

        if (requireSingleKing && count_checked_kings(afterMateTry, defender) != 1)
            continue;

        return true;
    }

    return false;
}

static bool passes_solution_move_filter(const Position3D& pos, Move3D bestMove, FirstMoveMode mode) {
    if (!bestMove.is_ok())
        return false;

    Position3D afterBest = pos;
    afterBest.do_move(bestMove); // defender to move

    Color defender = afterBest.side_to_move();
    bool givesCheck = afterBest.in_check(defender);

    if (mode == FirstMoveMode::NonCheckOnly)
        return !givesCheck;

    // Legacy mode:
    // - keep if first move is non-check,
    // - or if it's a checking sacrifice that can be captured immediately
    //   and still leaves mate-in-1.
    if (!givesCheck)
        return true;

    Square checkerSq = bestMove.to_sq();
    auto replies = afterBest.generate_legal_moves();

    for (const auto& r : replies) {
        if (r.to_sq() != checkerSq)
            continue;

        Piece target = afterBest.piece_on(checkerSq);
        if (target == NO_PIECE)
            continue;

        Position3D afterCapture = afterBest;
        afterCapture.do_move(r); // attacker to move

        if (has_forced_mate_in_one_move(afterCapture, false))
            return true;
    }

    return false;
}

static bool move_forces_mate_in_two(Position3D& root, const Move3D& first, bool requireSingleKingMate) {
    Position3D afterFirst = root;
    afterFirst.do_move(first); // defender to move

    auto replies = afterFirst.generate_legal_moves();
    if (replies.empty())
        return false;

    for (const auto& r : replies) {
        Position3D afterReply = afterFirst;
        afterReply.do_move(r); // attacker to move

        if (!has_forced_mate_in_one_move(afterReply, requireSingleKingMate))
            return false;
    }

    return true;
}

static bool find_unique_mate2_solution(Position3D& pos,
                                       Move3D& outUnique,
                                       bool requireSingleKingMate) {
    // Reject puzzle starts where side to move is already in check.
    if (pos.in_check(pos.side_to_move()))
        return false;

    auto legal = pos.generate_legal_moves();
    int winning = 0;
    Move3D candidate = Move3D::none();

    for (const auto& m : legal) {
        Position3D copy = pos;
        if (move_forces_mate_in_two(copy, m, requireSingleKingMate)) {
            ++winning;
            candidate = m;
            if (winning > 1)
                return false;
        }
    }

    if (winning == 1) {
        outUnique = candidate;
        return true;
    }

    return false;
}

static bool cull_file_for_unique_solutions(const std::string& inputPath, const std::string& outputPath) {
    std::ifstream in(inputPath);
    if (!in)
        return false;

    std::ofstream out(outputPath, std::ios::trunc);
    if (!out)
        return false;

    Search3D verifier;

    std::string line;
    int total = 0;
    int kept = 0;
    int dropped = 0;
    int badFormat = 0;
    int badFen = 0;

    while (std::getline(in, line)) {
        if (line.empty())
            continue;

        ++total;

        std::string fen, coord, alg;
        char side = '?';
        if (!parse_puzzle_line(line, fen, coord, alg, side)) {
            ++dropped;
            ++badFormat;
            continue;
        }

        Position3D pos;
        if (!pos.set_fen(fen)) {
            ++dropped;
            ++badFen;
            continue;
        }

        Move3D unique = Move3D::none();
        if (!find_unique_mate2_solution(pos, unique, false)) {
            ++dropped;
            continue;
        }
        unique = Move3D::none();
        if (!find_unique_mate2_solution(pos, unique, false)) {
            ++dropped;
            continue;
        }

        out << fen << '|'
            << move_to_string(unique) << '|'
            << pos.move_to_algebraic(unique) << '|'
            << (pos.side_to_move() == WHITE ? 'w' : 'b')
            << '\n';
        ++kept;
    }

    out.flush();
    std::printf("[CULL] total=%d kept=%d dropped=%d badFormat=%d badFen=%d output=%s\n",
                total, kept, dropped, badFormat, badFen, outputPath.c_str());
    return true;
}

int main(int argc, char* argv[]) {
    // Culling mode: re-validate an existing puzzle file and keep only
    // positions with a unique mate-in-2 first move.
    if (argc >= 2 && std::string(argv[1]) == "cull") {
        std::string inPath = (argc >= 3) ? argv[2] : "mate2_puzzles.txt";
        std::string outPath = (argc >= 4) ? argv[3] : "mate2_puzzles.culled.txt";

        std::printf("=== QuadLevel Mate-in-2 Culler ===\n");
        std::printf("Input:  %s\n", inPath.c_str());
        std::printf("Output: %s\n", outPath.c_str());

        if (!cull_file_for_unique_solutions(inPath, outPath)) {
            std::fprintf(stderr, "ERROR: cull failed.\n");
            return 1;
        }

        return 0;
    }

    int games = 200;
    std::string outPath = "mate2_puzzles.txt";
    bool randomizedSelfplay = true;
    FilterMode filterMode = FilterMode::ExactMate2;
    FirstMoveMode firstMoveMode = FirstMoveMode::NonCheckOnly;
    bool requireSingleKingMate = false;

    if (argc >= 2) {
        games = std::atoi(argv[1]);
        if (games < 1) games = 1;
    }
    if (argc >= 3)
        outPath = argv[2];
    if (argc >= 4) {
        std::string mode = argv[3];
        if (mode == "deterministic" || mode == "fixed" || mode == "off")
            randomizedSelfplay = false;
    }
    if (argc >= 5) {
        std::string fm = argv[4];
        if (fm == "atmost2" || fm == "at-most-2")
            filterMode = FilterMode::AtMostMate2;
        else
            filterMode = FilterMode::ExactMate2;
    }
    if (argc >= 6) {
        std::string fmm = argv[5];
        if (fmm == "saccheck" || fmm == "sac-check")
            firstMoveMode = FirstMoveMode::NonCheckOrSacCheck;
        else
            firstMoveMode = FirstMoveMode::NonCheckOnly;
    }
    if (argc >= 7) {
        std::string km = argv[6];
        if (km == "singleking" || km == "single-king" || km == "single")
            requireSingleKingMate = true;
    }

    const auto tick64 = static_cast<std::uint64_t>(
        std::chrono::steady_clock::now().time_since_epoch().count());
    std::seed_seq seed {
        static_cast<std::uint32_t>(tick64 & 0xFFFFFFFFull),
        static_cast<std::uint32_t>((tick64 >> 32) & 0xFFFFFFFFull)
    };
    std::mt19937 rng(seed);

    const std::filesystem::path resolvedOut = std::filesystem::absolute(std::filesystem::path(outPath));

    std::unordered_set<std::string> seenFens;
    load_existing_fens(resolvedOut.string(), seenFens);

    std::ofstream out(resolvedOut, std::ios::app);
    if (!out) {
        std::fprintf(stderr, "ERROR: cannot open output file: %s\n", resolvedOut.string().c_str());
        return 1;
    }

    Search3D selfplay;
    Search3D verifier;

    int mined = 0;
    int dupes = 0;
    unsigned long long positionsChecked = 0;
    unsigned long long candidatesMate2 = 0;
    unsigned long long candidatesMate1 = 0;

    std::printf("=== QuadLevel Mate-in-2 Miner ===\n");
    std::printf("Games: %d\n", games);
    std::printf("Output: %s\n", outPath.c_str());
    std::printf("Output (absolute): %s\n", resolvedOut.string().c_str());
    std::printf("Selfplay mode: %s\n", randomizedSelfplay ? "randomized" : "deterministic");
    std::printf("Filter mode: %s\n", filterMode == FilterMode::ExactMate2 ? "exact" : "atmost2");
    std::printf("First move mode: %s\n", firstMoveMode == FirstMoveMode::NonCheckOnly ? "non-check-only" : "allow-sac-check");
    std::printf("King mate mode: %s\n", requireSingleKingMate ? "single-king-only" : "any-king" );
    std::printf("Existing puzzles loaded: %zu\n\n", seenFens.size());

    for (int g = 1; g <= games; ++g) {
        Position3D pos;
        pos.set_startpos();

        // Seed each game into a more tactical midgame branch.
        int seedPlies = randomizedSelfplay
            ? std::uniform_int_distribution<int>(8, 16)(rng)
            : 8;
        randomize_start_position(pos, rng, seedPlies);

        selfplay.new_game();
        verifier.new_game();

        selfplay.push_game_position(Zobrist3D::compute_hash(pos));

        const int maxPlies = 100;

        for (int ply = 0; ply < maxPlies; ++ply) {
            ++positionsChecked;

            MinedPuzzle p;
            if (detect_mate_in_2(pos, verifier, p, filterMode)) {
                ++candidatesMate2;

                // Enforce unique mate-in-2 first move.
                Move3D unique = Move3D::none();
                if (!find_unique_mate2_solution(pos, unique, requireSingleKingMate)) {
                    continue;
                }
                p.best = unique;

                // Track mate-in-1 candidates for diagnostics (only meaningful in exact mode)
                if (filterMode == FilterMode::ExactMate2 && is_mate_in_1(pos, verifier)) {
                    ++candidatesMate1;
                }

                if (!passes_solution_move_filter(pos, p.best, firstMoveMode))
                    continue;

                if (seenFens.insert(p.fen).second) {
                    out << p.fen << '|'
                        << move_to_string(p.best) << '|'
                        << pos.move_to_algebraic(p.best) << '|'
                        << (p.side == WHITE ? 'w' : 'b')
                        << '\n';
                    out.flush();
                    ++mined;
                    std::printf("[MINE] game=%d ply=%d total=%d  %s\n",
                                g, ply, mined, p.fen.c_str());
                } else {
                    ++dupes;
                }
            }

            auto legal = pos.generate_legal_moves();
            if (legal.empty())
                break;

            Move3D chosen = Move3D::none();

            if (randomizedSelfplay) {
                // Inject occasional random move to diversify trajectories
                bool useRandomMove = std::uniform_real_distribution<double>(0.0, 1.0)(rng) < 0.20;
                if (useRandomMove) {
                    size_t idx = std::uniform_int_distribution<size_t>(0, legal.size() - 1)(rng);
                    chosen = legal[idx];
                }
            }

            if (!chosen.is_ok()) {
                int depth = randomizedSelfplay
                    ? std::uniform_int_distribution<int>(2, 5)(rng)
                    : 4;
                int timeMs = randomizedSelfplay
                    ? std::uniform_int_distribution<int>(100, 280)(rng)
                    : 200;

                SearchResult best = selfplay.search(pos, depth, timeMs);
                if (!best.best_move.is_ok())
                    break;
                chosen = best.best_move;
            }

            pos.do_move(chosen);
            selfplay.push_game_position(Zobrist3D::compute_hash(pos));
        }

        if ((g % 10) == 0) {
            out.flush();
            std::printf("[PROGRESS] games=%d/%d mined=%d dupes=%d checked=%llu m2cand=%llu m1cand=%llu\n",
                        g, games, mined, dupes, positionsChecked, candidatesMate2, candidatesMate1);
        }
    }

    out.flush();
    std::printf("\nDone. Mined=%d  Duplicates=%d  Checked=%llu  M2Candidates=%llu  M1Candidates=%llu  TotalKnown=%zu\n",
                mined, dupes, positionsChecked, candidatesMate2, candidatesMate1, seenFens.size());
    return 0;
}
