using Microsoft.EntityFrameworkCore;
using Chess3DBackend.Models;

namespace Chess3DBackend.Data;

public class GameDbContext : DbContext
{
    public GameDbContext(DbContextOptions<GameDbContext> options) : base(options)
    {
    }

    public DbSet<Game> Games { get; set; }
    public DbSet<ZoomCalibration> ZoomCalibrations { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        
        modelBuilder.Entity<Game>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.State).HasColumnType("TEXT");
            entity.Property(e => e.Status).HasMaxLength(50);
            entity.Property(e => e.OwnerToken).HasMaxLength(255);
        });

        modelBuilder.Entity<ZoomCalibration>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.UserAgent).HasColumnType("TEXT");
        });
    }
}
