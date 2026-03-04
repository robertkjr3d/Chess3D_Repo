using Microsoft.AspNetCore.Mvc;

namespace Chess3DBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AiController : ControllerBase
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<AiController> _logger;

    // One search at a time — the DLL is not thread-safe
    private static readonly SemaphoreSlim _semaphore = new(1, 1);

    public AiController(IServiceProvider sp, ILogger<AiController> logger)
    {
        _sp = sp;
        _logger = logger;
    }

    private QuadLevelEngine? Engine => _sp.GetService<QuadLevelEngine>();

    public class BestMoveRequest
    {
        /// <summary>
        /// Ordered list of all moves played so far in the game, in the same algebraic
        /// notation used by the frontend (e.g. "1a4", "N1c3", "1O-O1").
        /// The engine replays them from the start position before searching.
        /// </summary>
        public List<string> Moves { get; set; } = new();

        /// <summary>Search depth (1–64). Default 6.</summary>
        public int Depth { get; set; } = 8;

        /// <summary>Time limit in milliseconds (0 = unlimited). Default 3000.</summary>
        public int TimeMs { get; set; } = 5000;

        /// <summary>
        /// Optional FEN string describing the current board position.
        /// If provided, the engine sets the position directly from FEN
        /// instead of replaying the move list, avoiding desync issues.
        /// </summary>
        public string? Fen { get; set; }
    }

    public class BestMoveResponse
    {
        /// <summary>Raw string returned by the engine (e.g. "1a2-1a4").</summary>
        public string? Raw { get; set; }

        /// <summary>Source square in LfileRank notation (e.g. "1a2"), or null if not parsed.</summary>
        public string? FromNotation { get; set; }

        /// <summary>Destination square in LfileRank notation (e.g. "1a4").</summary>
        public string? ToNotation { get; set; }

        /// <summary>True when the engine's best move is a castling move.</summary>
        public bool IsCastling { get; set; }

        public string? Error { get; set; }

        /// <summary>Actual depth reached by the engine search.</summary>
        public int SearchDepth { get; set; }
    }

    /// <summary>
    /// POST /api/ai/bestmove
    /// Replay the supplied move list from the start position and return the engine's best move.
    /// </summary>
    [HttpPost("bestmove")]
    public async Task<ActionResult<BestMoveResponse>> GetBestMove([FromBody] BestMoveRequest request)
    {
        var engine = Engine;
        if (engine == null)
            return StatusCode(503, new BestMoveResponse { Error = "QuadLevel engine not loaded — check Stockfish_3D_Port.dll is present." });

        // Wait at most 60 s for any in-progress search to finish
        bool acquired = await _semaphore.WaitAsync(TimeSpan.FromSeconds(60));
        if (!acquired)
            return StatusCode(503, new BestMoveResponse { Error = "Engine busy — try again." });

        try
        {
            int replayed = 0;

            if (!string.IsNullOrWhiteSpace(request.Fen))
            {
                if (!engine.SetFen(request.Fen))
                {
                    _logger.LogError("Engine could not parse FEN: '{Fen}'", request.Fen);
                    return BadRequest(new BestMoveResponse
                    {
                        Error = $"Engine could not parse FEN: '{request.Fen}'"
                    });
                }
                _logger.LogInformation("Position set from FEN: {Fen}", request.Fen);
            }
            else
            {
                engine.SetStartPos();

                foreach (var move in request.Moves ?? [])
                {
                    if (string.IsNullOrWhiteSpace(move)) continue;
                    if (!engine.MakeMove(move))
                    {
                        _logger.LogError("Engine rejected move #{N}: '{Move}' — aborting replay (board desynced)", replayed + 1, move);
                        return BadRequest(new BestMoveResponse
                        {
                            Error = $"Engine could not parse move #{replayed + 1}: '{move}'. Board state would be corrupted — aborting."
                        });
                    }
                    replayed++;
                }
            }

            _logger.LogInformation("Searching: depth={D} time={T}ms, {N} moves replayed successfully",
                request.Depth, request.TimeMs, replayed);

            var raw = engine.BestMove(request.Depth, request.TimeMs);
            var searchDepth = engine.LastSearchDepth();
            _logger.LogInformation("BestMove raw result: {Raw}  searchDepth={Depth}", raw, searchDepth);

            if (string.IsNullOrEmpty(raw))
                return NotFound(new BestMoveResponse { Error = "Engine returned no move." });

            // Detect castling suffix 'C' appended by the engine
            bool isCastling = raw.EndsWith('C');
            string coordRaw = isCastling ? raw[..^1] : raw;

            // Parse the raw coordinate result into from/to squares.
            // Common formats: "1a2-1a4"  |  "1a21a4"  |  just "1a4" (dest only)
            string? fromN = null, toN = null;
            var dashParts = coordRaw.Split('-', StringSplitOptions.RemoveEmptyEntries);
            if (dashParts.Length >= 2)
            {
                fromN = dashParts[0].Trim();
                toN   = dashParts[1].Trim();
            }
            else if (coordRaw.Length >= 6)
            {
                // Try splitting at midpoint (3 chars each: level + file + rank)
                fromN = coordRaw[..3];
                toN   = coordRaw[3..];
            }
            else
            {
                // Destination only — frontend will use fallback lookup
                toN = coordRaw.Trim();
            }

            return Ok(new BestMoveResponse { Raw = raw, FromNotation = fromN, ToNotation = toN, IsCastling = isCastling, SearchDepth = searchDepth });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "BestMove search threw an exception");
            return StatusCode(500, new BestMoveResponse { Error = ex.Message });
        }
        finally
        {
            _semaphore.Release();
        }
    }

    /// <summary>GET /api/ai/status — quick health-check for the engine.</summary>
    [HttpGet("status")]
    public ActionResult GetStatus()
    {
        if (Engine == null)
            return Ok(new { available = false, message = "DLL not loaded" });

        try
        {
            using var probe = new QuadLevelEngine();
            probe.SetStartPos();
            var legal = probe.GetLegalMoves();
            return Ok(new { available = true, startposLegalMoves = legal.Split(' ').Length });
        }
        catch (Exception ex)
        {
            return Ok(new { available = false, message = ex.Message });
        }
    }
}
