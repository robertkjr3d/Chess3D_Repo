
#ifndef QUADLEVEL_API_H_INCLUDED
#define QUADLEVEL_API_H_INCLUDED

#ifdef QUADLEVEL_DLL_EXPORTS
    #define QUADLEVEL_API __declspec(dllexport)
#else
    #define QUADLEVEL_API __declspec(dllimport)
#endif

#ifdef __cplusplus
extern "C" {
#endif


// Lifetime
QUADLEVEL_API void*       ql_create(void);
QUADLEVEL_API void        ql_destroy(void* ctx);

// Position
QUADLEVEL_API void        ql_set_startpos(void* ctx);
QUADLEVEL_API void        ql_new_game(void* ctx);
QUADLEVEL_API int         ql_set_fen(void* ctx, const char* fen);
QUADLEVEL_API const char* ql_get_display(void* ctx);
QUADLEVEL_API const char* ql_get_fen(void* ctx);

// Moves — coordinate notation: "2c22c4" or algebraic: "B1c4", "2O-O1"
QUADLEVEL_API int         ql_make_move(void* ctx, const char* move);
QUADLEVEL_API const char* ql_get_legal_moves(void* ctx);
QUADLEVEL_API const char* ql_get_legal_moves_algebraic(void* ctx);
QUADLEVEL_API const char* ql_move_to_algebraic(void* ctx, const char* coord_move);

// Query
QUADLEVEL_API int         ql_is_check(void* ctx);
QUADLEVEL_API int         ql_side_to_move(void* ctx);
QUADLEVEL_API const char* ql_square_name(int square);

// Search — returns best move in coordinate notation
//   depth: search depth (1–64); time_ms: time limit in ms (0 = unlimited)
QUADLEVEL_API const char* ql_best_move(void* ctx, int depth, int time_ms);
QUADLEVEL_API const char* ql_best_move_algebraic(void* ctx, int depth, int time_ms);
QUADLEVEL_API int         ql_evaluate(void* ctx);
QUADLEVEL_API void        ql_set_tt_size(void* ctx, int size_mb);
QUADLEVEL_API int         ql_last_search_depth(void* ctx);

// Memory
QUADLEVEL_API void        ql_free_string(const char* str);

#ifdef __cplusplus
}
#endif

#endif // QUADLEVEL_API_H_INCLUDED
