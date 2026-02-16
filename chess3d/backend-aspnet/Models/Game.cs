using System.ComponentModel.DataAnnotations;

namespace Chess3DBackend.Models;

public class Game
{
    [Key]
    public string Id { get; set; } = Guid.NewGuid().ToString();
    
    public string State { get; set; } = "{}";
    
    public string Status { get; set; } = "active";
    
    public string OwnerToken { get; set; } = Guid.NewGuid().ToString();
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GameRequest
{
    public string? Id { get; set; }
    public object? State { get; set; }
    public string? OwnerToken { get; set; }
    public string? Status { get; set; }
}

public class GameResponse
{
    public string Id { get; set; } = string.Empty;
    public string? OwnerToken { get; set; }
    public object? State { get; set; }
    public string? Status { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
