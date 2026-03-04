// QuadLevelInterop.cs � .NET 8.0 P/Invoke wrapper for Stockfish_3D_Port.dll
//
// Usage:
//   using var engine = new QuadLevelEngine();
//   engine.SetStartPos();
//   Console.WriteLine(engine.GetDisplay());
//   Console.WriteLine(engine.GetLegalMovesAlgebraic());
//   engine.MakeMove("1b2");          // coordinate notation
//   engine.MakeMove("N1c3");         // algebraic notation
//   string best = engine.BestMove(depth: 8, timeMs: 5000);
//
// Copy Stockfish_3D_Port.dll to your output directory,
// or set <Content Include="path\to\Stockfish_3D_Port.dll"> CopyToOutputDirectory=PreserveNewest.

using System;
using System.Runtime.InteropServices;

/// <summary>
/// Raw P/Invoke declarations for the QuadLevel 3D Chess DLL.
/// All const char* returns are heap-allocated and must be freed with ql_free_string.
/// </summary>
internal static partial class QuadLevelNative
{
    private const string DllName = "Stockfish_3D_Port";

    // Lifetime
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_create();

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void ql_destroy(IntPtr ctx);

    // Position
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void ql_set_startpos(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void ql_new_game(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_get_display(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_get_fen(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int ql_set_fen(IntPtr ctx, string fen);

    // Moves
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int ql_make_move(IntPtr ctx, string move);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_get_legal_moves(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_get_legal_moves_algebraic(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern IntPtr ql_move_to_algebraic(IntPtr ctx, string coordMove);

    // Query
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int ql_is_check(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int ql_side_to_move(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_square_name(int square);

    // Search
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_best_move(IntPtr ctx, int depth, int timeMs);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr ql_best_move_algebraic(IntPtr ctx, int depth, int timeMs);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int ql_evaluate(IntPtr ctx);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void ql_set_tt_size(IntPtr ctx, int sizeMb);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int ql_last_search_depth(IntPtr ctx);

    // Memory
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void ql_free_string(IntPtr str);

    /// <summary>
    /// Read the native C string, then free it with ql_free_string.
    /// </summary>
    public static string ReadAndFree(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero)
            return string.Empty;
        string result = Marshal.PtrToStringAnsi(ptr) ?? string.Empty;
        ql_free_string(ptr);
        return result;
    }
}

/// <summary>
/// High-level managed wrapper for the QuadLevel 3D Chess engine.
/// Implements IDisposable � use with 'using' to ensure ql_destroy is called.
/// </summary>
public sealed class QuadLevelEngine : IDisposable
{
    private IntPtr _ctx;
    private bool _disposed;

    public QuadLevelEngine()
    {
        _ctx = QuadLevelNative.ql_create();
        if (_ctx == IntPtr.Zero)
            throw new InvalidOperationException("Failed to create QuadLevel engine context.");
    }

    /// <summary>Reset to the standard starting position.</summary>
    public void SetStartPos()
        => QuadLevelNative.ql_set_startpos(Ctx);

    /// <summary>Clear game history for repetition detection (call when starting a new game).</summary>
    public void NewGame()
        => QuadLevelNative.ql_new_game(Ctx);

    /// <summary>Pretty-printed 4-level board display.</summary>
    public string GetDisplay()
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_get_display(Ctx));

    /// <summary>FEN string for the current position.</summary>
    public string GetFen()
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_get_fen(Ctx));

    /// <summary>Set the position from a FEN string. Returns true on success.</summary>
    public bool SetFen(string fen)
        => QuadLevelNative.ql_set_fen(Ctx, fen) != 0;

    /// <summary>
    /// Make a move. Accepts coordinate ("2c22c4") or algebraic ("B1c4") notation.
    /// Returns true if the move was legal and applied.
    /// </summary>
    public bool MakeMove(string move)
        => QuadLevelNative.ql_make_move(Ctx, move) != 0;

    /// <summary>Space-separated legal moves in coordinate notation.</summary>
    public string GetLegalMoves()
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_get_legal_moves(Ctx));

    /// <summary>Space-separated legal moves in algebraic notation.</summary>
    public string GetLegalMovesAlgebraic()
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_get_legal_moves_algebraic(Ctx));

    /// <summary>Convert a coordinate move to algebraic notation.</summary>
    public string MoveToAlgebraic(string coordMove)
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_move_to_algebraic(Ctx, coordMove));

    /// <summary>True if the side to move is in check.</summary>
    public bool IsCheck
        => QuadLevelNative.ql_is_check(Ctx) != 0;

    /// <summary>0 = White, 1 = Black.</summary>
    public int SideToMove
        => QuadLevelNative.ql_side_to_move(Ctx);

    /// <summary>Human-readable name for a square index (0�127).</summary>
    public static string SquareName(int square)
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_square_name(square));

    /// <summary>Search for the best move (coordinate notation).</summary>
    /// <param name="depth">Search depth (1�64).</param>
    /// <param name="timeMs">Time limit in ms (0 = unlimited).</param>
    public string BestMove(int depth = 8, int timeMs = 0)
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_best_move(Ctx, depth, timeMs));

    /// <summary>Search for the best move (algebraic notation).</summary>
    public string BestMoveAlgebraic(int depth = 8, int timeMs = 0)
        => QuadLevelNative.ReadAndFree(QuadLevelNative.ql_best_move_algebraic(Ctx, depth, timeMs));

    /// <summary>Static evaluation of the current position (centipawns, from side-to-move's view).</summary>
    public int Evaluate()
        => QuadLevelNative.ql_evaluate(Ctx);

    /// <summary>Resize the transposition table (1�4096 MB).</summary>
    public void SetTranspositionTableSize(int sizeMb)
        => QuadLevelNative.ql_set_tt_size(Ctx, sizeMb);

    /// <summary>Depth actually reached by the last search.</summary>
    public int LastSearchDepth()
        => QuadLevelNative.ql_last_search_depth(Ctx);

    // ?? IDisposable ??

    private IntPtr Ctx
    {
        get
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return _ctx;
        }
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;
            QuadLevelNative.ql_destroy(_ctx);
            _ctx = IntPtr.Zero;
        }
    }
}
