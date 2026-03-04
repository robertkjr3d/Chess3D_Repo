/*
  QuadLevel Debug Harness — step through castle generation & search
  
  Build (from stockfish-src directory):
    cl /std:c++20 /EHsc /Zi /Od /I. debug_castle.cpp /Fe:debug_castle.exe

  Usage:
    debug_castle.exe                          ← starts from initial position
    debug_castle.exe "<FEN string>"           ← loads a specific position
    debug_castle.exe interactive              ← interactive FEN + move loop

  To debug in Visual Studio:
    1) Open Stockfish_3D_Port.vcxproj
    2) Switch to Debug|Win32 (already configured as Console App)
    3) Exclude main.cpp, stockfish_api.cpp from that config (right-click → Properties → Excluded From Build = Yes)
    4) Include this file in the project
    5) Set breakpoints in quadlevel_board.h castle generation (~line 503)
    6) Project → Properties → Debugging → Command Arguments → paste your FEN in quotes
    7) F5
*/

// Only QuadLevel headers — no Stockfish dependencies needed
#define STOCKFISH_DLL_EXPORTS  // prevent dllimport linkage issues
#include "quadlevel_board.h"
#include "quadlevel_search.h"

#include <cstdio>
#include <iostream>
#include <string>
#include <sstream>

using namespace QuadLevel;

// ── Pretty-print helpers ──────────────────────────────────────

static const char* piece_char(Piece p) {
    static const char* names[] = {
        ".", "P", "N", "B", "R", "Q", "K", "?",
        ".", "p", "n", "b", "r", "q", "k", "?"
    };
    return (p < PIECE_NB) ? names[p] : "?";
}

static void print_board(const Position3D& pos) {
    std::printf("\n");
    for (int lv = 0; lv < NUM_LEVELS; ++lv) {
        std::printf("  ── Level %d ──\n", lv + 1);
        std::printf("    a b c d\n");
        for (int r = NUM_RANKS - 1; r >= 0; --r) {
            std::printf("  %d ", r + 1);
            for (int f = 0; f < NUM_FILES; ++f) {
                Square sq = make_square(Level(lv), File(f), Rank(r));
                Piece pc = pos.piece_on(sq);
                std::printf("%s ", piece_char(pc));
            }
            std::printf("\n");
        }
        std::printf("\n");
    }
}

static void print_legal_moves(const Position3D& pos) {
    auto moves = pos.generate_legal_moves();
    std::printf("Legal moves (%zu):\n", moves.size());

    int castles = 0, normals = 0, promos = 0, eps = 0;
    for (const auto& m : moves) {
        const char* tag = "";
        switch (m.type_of()) {
            case CASTLING_3D:   tag = " [CASTLE]"; castles++; break;
            case PROMOTION_3D:  tag = " [PROMO]";  promos++;  break;
            case EN_PASSANT_3D: tag = " [EP]";     eps++;     break;
            default:            normals++;                     break;
        }

        Piece pc = pos.piece_on(m.from_sq());
        std::printf("  %s  %s → %s%s",
            piece_char(pc),
            square_to_string(m.from_sq()).c_str(),
            square_to_string(m.to_sq()).c_str(),
            tag);

        // For castle moves, show the full entry details
        if (m.type_of() == CASTLING_3D) {
            Color us = pos.side_to_move();
            const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
            for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
                if (entries[i].king_from == m.from_sq() && entries[i].king_to == m.to_sq()) {
                    std::printf("\n       rook %s→%s  block_sq=%s (piece=%s)  pass=%s",
                        square_to_string(entries[i].rook_from).c_str(),
                        square_to_string(entries[i].rook_to).c_str(),
                        entries[i].block_sq != SQ_NONE
                            ? square_to_string(entries[i].block_sq).c_str() : "--",
                        entries[i].block_sq != SQ_NONE
                            ? piece_char(pos.piece_on(entries[i].block_sq)) : ".",
                        entries[i].pass_through != SQ_NONE
                            ? square_to_string(entries[i].pass_through).c_str() : "--");
                    break;
                }
            }
        }
        std::printf("\n");
    }
    std::printf("\nSummary: %d normal, %d castle, %d promo, %d ep  (total %zu)\n",
                normals, castles, promos, eps, moves.size());
}

static void dump_castle_squares(const Position3D& pos) {
    Color us = pos.side_to_move();
    const CastleEntry* entries = (us == WHITE) ? WhiteCastles : BlackCastles;
    std::printf("\n── Castle entry diagnostics for %s ──\n", us == WHITE ? "White" : "Black");
    std::printf("  castlingRights = 0x%x\n", pos.castling_rights());

    for (int i = 0; i < NUM_CASTLE_ENTRIES; ++i) {
        const auto& ce = entries[i];
        int bit = int(us) * NUM_CASTLE_ENTRIES + i;
        bool hasRight = (pos.castling_rights() & (1 << bit)) != 0;

        std::printf("\n  Entry %d (%s-side) %s\n", i,
            ce.is_queen_side ? "queen" : "king",
            hasRight ? "RIGHT=YES" : "right=no");
        std::printf("    king_from=%s (piece=%s)  king_to=%s (piece=%s)\n",
            square_to_string(ce.king_from).c_str(),
            piece_char(pos.piece_on(ce.king_from)),
            square_to_string(ce.king_to).c_str(),
            piece_char(pos.piece_on(ce.king_to)));
        std::printf("    rook_from=%s (piece=%s)  rook_to=%s (piece=%s)\n",
            square_to_string(ce.rook_from).c_str(),
            piece_char(pos.piece_on(ce.rook_from)),
            square_to_string(ce.rook_to).c_str(),
            piece_char(pos.piece_on(ce.rook_to)));
        if (ce.pass_through != SQ_NONE)
            std::printf("    pass_through=%s (piece=%s)\n",
                square_to_string(ce.pass_through).c_str(),
                piece_char(pos.piece_on(ce.pass_through)));
        if (ce.block_sq != SQ_NONE)
            std::printf("    block_sq=%s (piece=%s)  ← %s\n",
                square_to_string(ce.block_sq).c_str(),
                piece_char(pos.piece_on(ce.block_sq)),
                pos.piece_on(ce.block_sq) == NO_PIECE ? "CLEAR" : "*** BLOCKED ***");

        // Would this castle be generated?
        bool ok = true;
        std::string reason;
        if (!hasRight) { ok = false; reason = "no castling right"; }
        else if (pos.piece_on(ce.king_from) != make_piece(us, KING)) { ok = false; reason = "king not on king_from"; }
        else if (pos.piece_on(ce.rook_from) != make_piece(us, ROOK)) { ok = false; reason = "rook not on rook_from"; }
        else if (pos.piece_on(ce.king_to) != NO_PIECE) { ok = false; reason = "king_to occupied"; }
        else if (pos.piece_on(ce.rook_to) != NO_PIECE && ce.rook_to != ce.king_from) { ok = false; reason = "rook_to occupied"; }
        else if (ce.pass_through != SQ_NONE && pos.piece_on(ce.pass_through) != NO_PIECE) { ok = false; reason = "pass_through occupied"; }
        else if (ce.block_sq != SQ_NONE && pos.piece_on(ce.block_sq) != NO_PIECE) { ok = false; reason = "block_sq occupied"; }

        std::printf("    verdict: %s%s\n", ok ? "WOULD GENERATE" : "BLOCKED — ",
                    ok ? "" : reason.c_str());
    }
}

static void run_search(Position3D& pos, int depth, int timeMs = 5000) {
    std::printf("\n\xe2\x94\x80\xe2\x94\x80 Searching depth %d  time %dms \xe2\x94\x80\xe2\x94\x80\n", depth, timeMs);
    Search3D search;
    // Track king moves per iteration -- only log when the move changes
    std::string lastKingMoveStr;

    auto info_cb = [&](const SearchResult& r) {
        if (!r.best_move.is_ok()) return;
        Piece pc = pos.piece_on(r.best_move.from_sq());
        if (pc != NO_PIECE && type_of(pc) == KING) {
            std::string moveStr = move_to_string(r.best_move);
            if (moveStr != lastKingMoveStr) {
                lastKingMoveStr = moveStr;
                std::printf("  [KING MOVE] depth=%d  %s (%s)  score=%d\n",
                    r.depth, moveStr.c_str(),
                    pos.move_to_algebraic(r.best_move).c_str(),
                    r.score);
            }
        }
    };

    auto result = search.search(pos, depth, timeMs, info_cb);
    if (result.best_move.is_ok()) {
        std::printf("Best move: %s (%s)  score=%d  depth=%d  time=%dms  nodes=%llu\n",
            move_to_string(result.best_move).c_str(),
            pos.move_to_algebraic(result.best_move).c_str(),
            result.score, result.depth, result.time_ms,
            (unsigned long long)result.nodes);
        if (result.depth < depth) {
            std::printf("  *** WARNING: only reached depth %d of %d (time limit hit!) ***\n",
                result.depth, depth);
            std::printf("  *** Try: --time 0  to disable time limit ***\n");
        }
        if (result.best_move.type_of() == CASTLING_3D) {
            std::printf("  *** CASTLE MOVE CHOSEN ***\n");
        }
    } else {
        std::printf("No legal move found.\n");
    }
}

// ── Interactive mode ──────────────────────────────────────────

static void interactive_loop() {
    Position3D pos;
    pos.set_startpos();

    std::printf("QuadLevel Debug Shell\n");
    std::printf("Commands:\n");
    std::printf("  fen <FEN>       — load position from FEN\n");
    std::printf("  startpos        — reset to starting position\n");
    std::printf("  board           — show board\n");
    std::printf("  moves           — list legal moves\n");
    std::printf("  castles         — detailed castle entry diagnostics\n");
    std::printf("  search <depth>  — run search (default depth 6)\n");
    std::printf("  move <coord>    — make a move (e.g. '2c22c4')\n");
    std::printf("  getfen          — print current FEN\n");
    std::printf("  quit            — exit\n\n");

    std::string line;
    while (true) {
        std::printf("%s> ", pos.side_to_move() == WHITE ? "W" : "B");
        std::fflush(stdout);
        if (!std::getline(std::cin, line))
            break;
        if (line.empty())
            continue;

        std::istringstream iss(line);
        std::string cmd;
        iss >> cmd;

        if (cmd == "quit" || cmd == "exit" || cmd == "q") {
            break;
        } else if (cmd == "startpos") {
            pos.set_startpos();
            std::printf("Reset to starting position.\n");
        } else if (cmd == "fen") {
            std::string rest;
            std::getline(iss >> std::ws, rest);
            if (rest.empty()) {
                std::printf("Usage: fen <FEN string>\n");
            } else {
                if (pos.set_fen(rest))
                    std::printf("FEN loaded. Side to move: %s  Rights: 0x%x\n",
                        pos.side_to_move() == WHITE ? "White" : "Black",
                        pos.castling_rights());
                else
                    std::printf("ERROR: invalid FEN\n");
            }
        } else if (cmd == "board" || cmd == "b") {
            print_board(pos);
        } else if (cmd == "moves" || cmd == "m") {
            print_legal_moves(pos);
        } else if (cmd == "castles" || cmd == "c") {
            dump_castle_squares(pos);
        } else if (cmd == "search" || cmd == "s") {
            int depth = 6;
            iss >> depth;
            run_search(pos, depth);
        } else if (cmd == "move") {
            std::string mv;
            iss >> mv;
            if (mv.empty()) {
                std::printf("Usage: move <coord>  e.g. move 2c22c4\n");
            } else {
                Move3D parsed = pos.parse_algebraic(mv);
                if (parsed.is_ok()) {
                    pos.do_move(parsed);
                    std::printf("Played: %s (%s)\n",
                        move_to_string(parsed).c_str(), mv.c_str());
                } else {
                    std::printf("ERROR: cannot parse or illegal move '%s'\n", mv.c_str());
                }
            }
        } else if (cmd == "getfen") {
            std::printf("FEN: %s\n", pos.fen().c_str());
        } else {
            std::printf("Unknown command: %s\n", cmd.c_str());
        }
    }
}

// ── Main ──────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    std::printf("=== QuadLevel Castle Debug Harness ===\n\n");

    if (argc >= 2 && std::string(argv[1]) == "interactive") {
        interactive_loop();
        return 0;
    }

    // Parse optional --depth N and --time Ms (can appear anywhere)
    int searchDepth = 8;
    int searchTime  = 5000;  // match frontend default
    std::vector<std::string> fenParts;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "--depth" || arg == "-d") && i + 1 < argc) {
            searchDepth = std::atoi(argv[++i]);
            if (searchDepth < 1) searchDepth = 1;
            if (searchDepth > 64) searchDepth = 64;
        } else if ((arg == "--time" || arg == "-t") && i + 1 < argc) {
            searchTime = std::atoi(argv[++i]);
            if (searchTime < 0) searchTime = 0;  // 0 = unlimited
        } else {
            fenParts.push_back(arg);
        }
    }

    Position3D pos;

    if (!fenParts.empty()) {
        // Join remaining args into FEN string
        std::string fen;
        for (size_t i = 0; i < fenParts.size(); ++i) {
            if (i > 0) fen += ' ';
            fen += fenParts[i];
        }
        std::printf("Loading FEN: %s\n", fen.c_str());
        if (!pos.set_fen(fen)) {
            std::fprintf(stderr, "ERROR: invalid FEN\n");
            return 1;
        }
    } else {
        pos.set_startpos();
        std::printf("Using starting position.\n");
    }

    std::printf("Side to move: %s\n", pos.side_to_move() == WHITE ? "White" : "Black");
    std::printf("Castling rights: 0x%x\n", pos.castling_rights());

    // Print the board
    print_board(pos);

    // Detailed castle analysis
    dump_castle_squares(pos);

    // Show all legal moves
    print_legal_moves(pos);

    // Run search at requested depth and time
    run_search(pos, searchDepth, searchTime);

    return 0;
}
