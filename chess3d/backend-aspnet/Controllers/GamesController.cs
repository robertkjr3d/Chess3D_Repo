using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Chess3DBackend.Data;
using Chess3DBackend.Models;
using System.Text.Json;

namespace Chess3DBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GamesController : ControllerBase
{
    private readonly GameDbContext _context;
    private readonly ILogger<GamesController> _logger;
    private readonly IWebHostEnvironment _env;

    public GamesController(GameDbContext context, ILogger<GamesController> logger, IWebHostEnvironment env)
    {
        _context = context;
        _logger = logger;
        _env = env;
    }

    /// Sets (or refreshes) the HttpOnly owner token cookie.
    private void SetOwnerTokenCookie(string token)
    {
        Response.Cookies.Append("chess3d_owner_token", token, new CookieOptions
        {
            HttpOnly  = true,
            Secure    = _env.IsProduction(),
            SameSite  = _env.IsProduction() ? SameSiteMode.Strict : SameSiteMode.Lax,
            Expires   = DateTimeOffset.UtcNow.AddDays(90),
            Path      = "/"
        });
    }

    /// Resolves the owner token: cookie takes priority; falls back to request body for backward compat.
    private string? ResolveOwnerToken(string? bodyToken) =>
        Request.Cookies.TryGetValue("chess3d_owner_token", out var cookie) && !string.IsNullOrWhiteSpace(cookie)
            ? cookie
            : bodyToken;

    // POST: api/games - Create new game or update existing
    [HttpPost]
    public async Task<ActionResult<GameResponse>> CreateOrUpdateGame([FromBody] GameRequest request)
    {
        try
        {
            _logger.LogInformation($"POST /api/games - ID: {request.Id}");
            var now = DateTime.UtcNow;

            // Update existing game
            if (!string.IsNullOrEmpty(request.Id))
            {
                var existingGame = await _context.Games.FindAsync(request.Id);
                if (existingGame == null)
                {
                    return NotFound(new { error = "not found" });
                }

                var ownerToken = ResolveOwnerToken(request.OwnerToken);

                // Require a valid owner token for all updates
                if (string.IsNullOrWhiteSpace(ownerToken))
                {
                    return Unauthorized(new { error = "owner token required" });
                }

                if (string.IsNullOrWhiteSpace(existingGame.OwnerToken) ||
                    existingGame.OwnerToken != ownerToken)
                {
                    return StatusCode(403, new { error = "forbidden" });
                }

                existingGame.State = JsonSerializer.Serialize(request.State);
                existingGame.UpdatedAt = now;

                await _context.SaveChangesAsync();
                SetOwnerTokenCookie(existingGame.OwnerToken);

                return Ok(new GameResponse
                {
                    Id = existingGame.Id,
                    UpdatedAt = existingGame.UpdatedAt
                });
            }

            // Create new game
            var newGame = new Game
            {
                Id = Guid.NewGuid().ToString(),
                State = JsonSerializer.Serialize(request.State ?? new { }),
                Status = "active",
                OwnerToken = Guid.NewGuid().ToString(),
                CreatedAt = now,
                UpdatedAt = now
            };

            _context.Games.Add(newGame);
            await _context.SaveChangesAsync();
            SetOwnerTokenCookie(newGame.OwnerToken);

            return Ok(new GameResponse
            {
                Id = newGame.Id
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in CreateOrUpdateGame");
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }

    // GET: api/games/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetGame(string id)
    {
        Console.WriteLine($"=== GET START: {id} ===");
        
        try
        {
            _logger.LogInformation($"GET /api/games/{id}");
            Console.WriteLine("Step 1: Query DB");
            
            var game = await _context.Games.FindAsync(id);
            
            Console.WriteLine($"Step 2: Found={game != null}");
            if (game == null)
            {
                return NotFound(new { error = "not found" });
            }

            Console.WriteLine($"Step 3: State len={game.State?.Length ?? 0}");
            Console.WriteLine($"Step 4: Building response with raw state string");
            
            // Return state as raw JSON string - client will parse
            var result = new
            {
                id = game.Id,
                stateJson = game.State ?? "{}",  // Raw JSON string
                status = game.Status ?? "active",
                createdAt = game.CreatedAt,
                updatedAt = game.UpdatedAt
            };
            
            Console.WriteLine("Step 5: Returning OK");
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in GetGame: {Id}", id);
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }

    // PUT: api/games/{id}
    [HttpPut("{id}")]
    public async Task<ActionResult<GameResponse>> UpdateGame(string id, [FromBody] GameRequest request)
    {
        try
        {
            Console.WriteLine($"=== PUT /api/games/{id} STARTED ===");
            _logger.LogInformation($"PUT /api/games/{id}");
            
            // Log request details
            Console.WriteLine($"Request - OwnerToken present: {!string.IsNullOrEmpty(request.OwnerToken)}");
            Console.WriteLine($"Request - State present: {request.State != null}");
            Console.WriteLine($"Request - Status: {request.Status}");
            
            var game = await _context.Games.FindAsync(id);
            Console.WriteLine($"Game found in DB: {game != null}");

            if (game == null)
            {
                Console.WriteLine($"PUT /api/games/{id} - Game not found");
                _logger.LogWarning($"PUT /api/games/{id} - Game not found");
                return NotFound(new { error = "not found" });
            }

            Console.WriteLine($"Game OwnerToken present: {!string.IsNullOrEmpty(game.OwnerToken)}");

            var ownerToken = ResolveOwnerToken(request.OwnerToken);

            // Require a valid owner token for all updates
            if (string.IsNullOrWhiteSpace(ownerToken))
            {
                Console.WriteLine($"PUT /api/games/{id} - Unauthorized: missing owner token");
                _logger.LogWarning($"PUT /api/games/{id} - Unauthorized: missing owner token");
                return Unauthorized(new { error = "owner token required" });
            }

            if (string.IsNullOrWhiteSpace(game.OwnerToken) ||
                game.OwnerToken != ownerToken)
            {
                Console.WriteLine($"PUT /api/games/{id} - Forbidden: token mismatch");
                _logger.LogWarning($"PUT /api/games/{id} - Forbidden: token mismatch");
                return StatusCode(403, new { error = "forbidden" });
            }

            Console.WriteLine("Token verification passed");
            game.State = JsonSerializer.Serialize(request.State ?? new { });
            if (!string.IsNullOrEmpty(request.Status))
            {
                game.Status = request.Status;
            }
            game.UpdatedAt = DateTime.UtcNow;

            Console.WriteLine("Saving changes to database...");
            await _context.SaveChangesAsync();
            SetOwnerTokenCookie(game.OwnerToken);
            Console.WriteLine($"PUT /api/games/{id} - SUCCESS");

            return Ok(new GameResponse
            {
                Id = game.Id,
                UpdatedAt = game.UpdatedAt
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in UpdateGame: {Id}", id);
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }
}
