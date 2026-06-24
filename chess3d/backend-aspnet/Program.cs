using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
using Chess3DBackend.Models;
using Chess3DBackend.Data;

// Ensure logs directory exists
var logsPath = Path.Combine(AppContext.BaseDirectory, "logs");
Directory.CreateDirectory(logsPath);
Console.WriteLine($"Logs directory: {logsPath}");

Console.WriteLine("=== Chess3D Backend Starting ===");
Console.WriteLine($"Environment: {Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")}");

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register QuadLevel Stockfish engine as singleton (optional — null if DLL unavailable at startup)
try
{
    var engine = new QuadLevelEngine();
    builder.Services.AddSingleton(engine);
    Console.WriteLine("✓ QuadLevelEngine created successfully");
}
catch (Exception ex)
{
    Console.WriteLine($"⚠ QuadLevelEngine unavailable (Stockfish disabled): {ex.Message}");
    // Not registered — AiController resolves via GetService<> which returns null safely
}

// Configure MySQL connection
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
var useMySql = !string.IsNullOrEmpty(connectionString) && connectionString != "DISABLED";

Console.WriteLine($"=== DATABASE CONFIGURATION ===");
Console.WriteLine($"Connection string present: {!string.IsNullOrEmpty(connectionString)}");
Console.WriteLine($"Use MySQL: {useMySql}");

if (builder.Environment.IsProduction() && !useMySql)
{
    throw new InvalidOperationException(
        "Production requires ConnectionStrings:DefaultConnection via environment variable or secret store.");
}

if (useMySql)
{
    Console.WriteLine("Configuring MySQL database...");
    try
    {
        builder.Services.AddDbContext<GameDbContext>(options =>
            options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));
        Console.WriteLine("✓ MySQL DbContext configured successfully");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"✗ MySQL configuration error: {ex.Message}");
        Console.WriteLine($"Stack trace: {ex.StackTrace}");
        if (ex.InnerException != null)
        {
            Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
            Console.WriteLine($"Inner stack trace: {ex.InnerException.StackTrace}");
        }
        throw;
    }
}
else
{
    Console.WriteLine("MySQL disabled - using in-memory database for testing");
    builder.Services.AddDbContext<GameDbContext>(options =>
        options.UseInMemoryDatabase("Chess3D"));
}

// Configure CORS to allow specific frontend origins
var allowedOrigins = builder.Configuration["CORS_AllowedOrigins"]
    ?? (builder.Environment.IsDevelopment() 
        ? "http://localhost:3000;http://localhost:3001" 
        : "https://chess3d.com");

var originArray = allowedOrigins.Split(';', StringSplitOptions.RemoveEmptyEntries);
Console.WriteLine($"CORS allowed origins: {string.Join(", ", originArray)}");

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowSpecificOrigins", policy =>
    {
        policy.WithOrigins(originArray)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

// Rate limiting — per-IP sliding windows
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.OnRejected = async (context, _) =>
    {
        context.HttpContext.Response.ContentType = "application/json";
        await context.HttpContext.Response.WriteAsync(
            "{\"error\":\"Too many requests. Please slow down.\"}");
    };

    // AI endpoint: 10 requests per minute per IP
    options.AddSlidingWindowLimiter("ai", limiterOptions =>
    {
        limiterOptions.Window           = TimeSpan.FromMinutes(1);
        limiterOptions.SegmentsPerWindow = 6;  // check every 10 s
        limiterOptions.PermitLimit      = 10;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit        = 0;
    });

    // General API: 60 requests per minute per IP
    options.AddSlidingWindowLimiter("general", limiterOptions =>
    {
        limiterOptions.Window            = TimeSpan.FromMinutes(1);
        limiterOptions.SegmentsPerWindow = 6;
        limiterOptions.PermitLimit       = 60;
        limiterOptions.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit        = 0;
    });
});

var app = builder.Build();

// Ensure database is created
Console.WriteLine("=== DATABASE INITIALIZATION ===");
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<GameDbContext>();
    try
    {
        if (useMySql)
        {
            Console.WriteLine("Testing MySQL connection...");
            db.Database.EnsureCreated();
            Console.WriteLine("✓ MySQL database initialized successfully");

            // EnsureCreated won't add new tables to an existing DB — create new tables explicitly
            try
            {
                db.Database.ExecuteSqlRaw(@"
                    CREATE TABLE IF NOT EXISTS `ZoomCalibrations` (
                        `Id`               INT             NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        `ScreenWidth`      INT             NOT NULL,
                        `ScreenHeight`     INT             NOT NULL,
                        `ZoomLevel`        DOUBLE          NOT NULL,
                        `IsMobile`         TINYINT(1)      NOT NULL DEFAULT 0,
                        `UserAgent`        TEXT            NOT NULL,
                        `DevicePixelRatio` DOUBLE          NOT NULL DEFAULT 1,
                        `CreatedAt`        DATETIME(6)     NOT NULL
                    ) CHARACTER SET utf8mb4;
                ");
                Console.WriteLine("✓ ZoomCalibrations table ensured");
            }
            catch (Exception exTbl)
            {
                Console.WriteLine($"⚠ ZoomCalibrations table creation warning: {exTbl.Message}");
            }

            // Test query
            var count = db.Games.Count();
            Console.WriteLine($"✓ Database query test passed. Current games count: {count}");
        }
        else
        {
            db.Database.EnsureCreated();
            Console.WriteLine("✓ In-memory database initialized (data will be lost on restart)");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"✗ Database initialization error: {ex.Message}");
        Console.WriteLine($"Stack trace: {ex.StackTrace}");
        if (ex.InnerException != null)
        {
            Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
            Console.WriteLine($"Inner stack trace: {ex.InnerException.StackTrace}");
        }
        Console.WriteLine("⚠ Application will continue but database operations will fail!");
    }
}

Console.WriteLine("=== HTTP PIPELINE CONFIGURATION ===");

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    Console.WriteLine("✓ Swagger enabled (Development mode)");
}
// Temporarily disable exception handler to diagnose issues
Console.WriteLine("⚠ Exception handler disabled for debugging");

// Add request logging middleware with error handling
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    var path = context.Request.Path;
    Console.WriteLine($">>> REQUEST: {method} {path}");
    
    try
    {
        await next();
        Console.WriteLine($"<<< RESPONSE: {method} {path} - Status {context.Response.StatusCode}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"!!! MIDDLEWARE ERROR: {ex.GetType().Name}: {ex.Message}");
        Console.WriteLine($"Stack: {ex.StackTrace}");
        context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = "An unexpected error occurred." });
    }
});

app.UseCors("AllowSpecificOrigins");
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers().RequireRateLimiting("general");

Console.WriteLine("✓ CORS configured (specific origins only)");
Console.WriteLine("✓ Controllers mapped");

// Root endpoint
app.MapGet("/", () => {
    Console.WriteLine("Root endpoint hit");
    return new
    {
        status = "running",
        message = "Chess3D Backend API",
        version = "2026-02-15-v2-FIXED",  // VERSION MARKER
        codeUpdate = "JSON deserialization fix deployed",
        environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
        timestamp = DateTime.UtcNow,
        endpoints = new
        {
            health = "/health",
            games = "/api/games"
        }
    };
});

app.MapGet("/health", () => {
    Console.WriteLine("Health endpoint hit");
    return "OK";
});

app.MapGet("/error", () => Results.Problem("An error occurred"));

Console.WriteLine("=== Application Ready ===");
Console.WriteLine("Listening for requests...");

try
{
    app.Run();
}
catch (Exception ex)
{
    Console.WriteLine($"FATAL ERROR: Application terminated: {ex.Message}");
    Console.WriteLine($"Stack trace: {ex.StackTrace}");
    throw;
}
