using Microsoft.EntityFrameworkCore;
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

// Configure MySQL connection
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
var useMySql = !string.IsNullOrEmpty(connectionString) && connectionString != "DISABLED";

Console.WriteLine($"=== DATABASE CONFIGURATION ===");
Console.WriteLine($"Connection string present: {!string.IsNullOrEmpty(connectionString)}");
Console.WriteLine($"Connection string: {connectionString}");
Console.WriteLine($"Use MySQL: {useMySql}");

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

// Configure CORS to allow frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
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
        await context.Response.WriteAsJsonAsync(new { error = ex.Message, type = ex.GetType().Name });
    }
});

app.UseCors("AllowAll");
app.UseAuthorization();
app.MapControllers();

Console.WriteLine("✓ CORS configured (AllowAll)");
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
