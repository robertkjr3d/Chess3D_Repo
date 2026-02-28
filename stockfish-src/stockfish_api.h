#ifndef STOCKFISH_API_H_INCLUDED
#define STOCKFISH_API_H_INCLUDED

#ifdef STOCKFISH_DLL_EXPORTS
    #define STOCKFISH_API __declspec(dllexport)
#else
    #define STOCKFISH_API __declspec(dllimport)
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Lifetime
STOCKFISH_API void*       ql_create(void);
STOCKFISH_API void        ql_destroy(void* ctx);

// Position
STOCKFISH_API void        ql_set_startpos(void* ctx);
STOCKFISH_API int         ql_set_fen(void* ctx, const char* fen);
STOCKFISH_API const char* ql_get_display(void* ctx);
STOCKFISH_API const char* ql_get_fen(void* ctx);

// Moves — coordinate notation: "2c22c4" or algebraic: "B1c4", "2O-O1"
STOCKFISH_API int         ql_make_move(void* ctx, const char* move);
STOCKFISH_API const char* ql_get_legal_moves(void* ctx);
STOCKFISH_API const char* ql_get_legal_moves_algebraic(void* ctx);
STOCKFISH_API const char* ql_move_to_algebraic(void* ctx, const char* coord_move);

// Query
STOCKFISH_API int         ql_is_check(void* ctx);
STOCKFISH_API int         ql_side_to_move(void* ctx);
STOCKFISH_API const char* ql_square_name(int square);

// Search — returns best move in coordinate notation
//   depth: search depth (1–64); time_ms: time limit in ms (0 = unlimited)
STOCKFISH_API const char* ql_best_move(void* ctx, int depth, int time_ms);
STOCKFISH_API const char* ql_best_move_algebraic(void* ctx, int depth, int time_ms);
STOCKFISH_API int         ql_evaluate(void* ctx);
STOCKFISH_API void        ql_set_tt_size(void* ctx, int size_mb);

// Memory
STOCKFISH_API void        ql_free_string(const char* str);

#ifdef __cplusplus
}
#endif

#endif // STOCKFISH_API_H_INCLUDED