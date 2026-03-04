#define STOCKFISH_DLL_EXPORTS

#include "stockfish_api.h"
#include "quadlevel_board.h"
#include "quadlevel_search.h"

#include <cstdio>
#include <cstring>
#include <sstream>
#include <string>

using namespace QuadLevel;

struct QLContext {
    Position3D pos;
    Search3D   search;
    int        lastSearchDepth = 0;
};

static QLContext* ctx_of(void* p) { return static_cast<QLContext*>(p); }

static const char* to_c_str(const std::string& s) {
    char* buf = new char[s.size() + 1];
    std::memcpy(buf, s.c_str(), s.size() + 1);
    return buf;
}

extern "C" {

STOCKFISH_API const char* ql_version(void) {
    return "castle-fix-v4-verified-2026-03-03T10";
}

STOCKFISH_API void* ql_create(void) {
    std::fprintf(stderr, "[DLL-VERSION] %s\n", ql_version());
    auto* c = new QLContext();
    c->pos.set_startpos();
    return static_cast<void*>(c);
}

STOCKFISH_API void ql_destroy(void* ctx) {
    delete ctx_of(ctx);
}

STOCKFISH_API void ql_set_startpos(void* ctx) {
    ctx_of(ctx)->pos.set_startpos();
    ctx_of(ctx)->search.new_game();
}

STOCKFISH_API void ql_new_game(void* ctx) {
    ctx_of(ctx)->search.new_game();
}

STOCKFISH_API const char* ql_get_display(void* ctx) {
    return to_c_str(ctx_of(ctx)->pos.display());
}

STOCKFISH_API const char* ql_get_fen(void* ctx) {
    return to_c_str(ctx_of(ctx)->pos.fen());
}

STOCKFISH_API int ql_set_fen(void* ctx, const char* fen) {
    if (!fen)
        return 0;
    auto* c = ctx_of(ctx);
    bool ok = c->pos.set_fen(fen);
    if (ok) {
        std::fprintf(stderr, "[SET-FEN] castlingRights=0x%x  fen=%s\n",
                     c->pos.castling_rights(), fen);
        c->search.clear();  // clear search tables only, preserve game history
        // Push this position into game history for repetition detection
        c->search.push_game_position(Zobrist3D::compute_hash(c->pos));
    }
    return ok ? 1 : 0;
}

STOCKFISH_API int ql_make_move(void* ctx, const char* move_str) {
    if (!move_str)
        return 0;

    auto* c = ctx_of(ctx);

    // Strip spaces
    std::string clean;
    for (const char* p = move_str; *p; ++p)
        if (*p != ' ')
            clean += *p;

    if (clean.empty())
        return 0;

    Move3D matched = c->pos.parse_algebraic(clean);

    if (!matched.is_ok())
        return 0;

    c->pos.do_move(matched);
    // Push new position hash for repetition detection
    c->search.push_game_position(Zobrist3D::compute_hash(c->pos));
    return 1;
}

STOCKFISH_API const char* ql_get_legal_moves(void* ctx) {
    auto& pos = ctx_of(ctx)->pos;
    auto  moves = pos.generate_legal_moves();

    std::ostringstream oss;
    for (size_t i = 0; i < moves.size(); ++i) {
        if (i > 0)
            oss << ' ';
        oss << move_to_string(moves[i]);
    }
    return to_c_str(oss.str());
}

STOCKFISH_API const char* ql_get_legal_moves_algebraic(void* ctx) {
    auto& pos = ctx_of(ctx)->pos;
    auto  moves = pos.generate_legal_moves();

    std::ostringstream oss;
    for (size_t i = 0; i < moves.size(); ++i) {
        if (i > 0)
            oss << ' ';
        oss << pos.move_to_algebraic(moves[i]);
    }
    return to_c_str(oss.str());
}

STOCKFISH_API const char* ql_move_to_algebraic(void* ctx, const char* coord_move) {
    if (!coord_move)
        return to_c_str("??");

    auto& pos = ctx_of(ctx)->pos;
    Move3D m = pos.parse_algebraic(coord_move);
    if (!m.is_ok())
        return to_c_str("??");
    return to_c_str(pos.move_to_algebraic(m));
}

STOCKFISH_API int ql_is_check(void* ctx) {
    auto& pos = ctx_of(ctx)->pos;
    return pos.in_check(pos.side_to_move()) ? 1 : 0;
}

STOCKFISH_API int ql_side_to_move(void* ctx) {
    return ctx_of(ctx)->pos.side_to_move();
}

STOCKFISH_API const char* ql_square_name(int square) {
    return to_c_str(square_to_string(Square(square)));
}

STOCKFISH_API const char* ql_best_move(void* ctx, int depth, int time_ms) {
    auto* c = ctx_of(ctx);
    if (depth < 1) depth = 1;
    if (depth > 64) depth = 64;

    auto result = c->search.search(c->pos, depth, time_ms);
    c->lastSearchDepth = result.depth;

    if (!result.best_move.is_ok())
        return to_c_str("0000");

    // Diagnostic: log when the chosen best-move is a castling move
    if (result.best_move.type_of() == CASTLING_3D) {
        std::fprintf(stderr,
            "[CASTLE-BESTMOVE] chosen=%s  castlingRights=0x%x\n",
            move_to_string(result.best_move).c_str(),
            c->pos.castling_rights());
    }

    return to_c_str(move_to_string(result.best_move));
}

STOCKFISH_API const char* ql_best_move_algebraic(void* ctx, int depth, int time_ms) {
    auto* c = ctx_of(ctx);
    if (depth < 1) depth = 1;
    if (depth > 64) depth = 64;

    auto result = c->search.search(c->pos, depth, time_ms);

    if (!result.best_move.is_ok())
        return to_c_str("??");
    return to_c_str(c->pos.move_to_algebraic(result.best_move));
}

STOCKFISH_API int ql_evaluate(void* ctx) {
    return evaluate(ctx_of(ctx)->pos);
}

STOCKFISH_API void ql_set_tt_size(void* ctx, int size_mb) {
    if (size_mb < 1) size_mb = 1;
    if (size_mb > 4096) size_mb = 4096;
    ctx_of(ctx)->search.set_tt_size(size_t(size_mb));
}

STOCKFISH_API void ql_free_string(const char* str) {
    delete[] str;
}

STOCKFISH_API int ql_last_search_depth(void* ctx) {
    return ctx_of(ctx)->lastSearchDepth;
}

}  // extern "C"