using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Chess3DBackend.Data;
using Chess3DBackend.Models;

namespace Chess3DBackend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ZoomCalibrationsController : ControllerBase
{
    private readonly GameDbContext _context;
    private readonly ILogger<ZoomCalibrationsController> _logger;

    public ZoomCalibrationsController(GameDbContext context, ILogger<ZoomCalibrationsController> logger)
    {
        _context = context;
        _logger = logger;
    }

    // POST: api/zoomcalibrations — upsert: update existing record if same width+height+isMobile, else insert
    [HttpPost]
    public async Task<ActionResult> SaveCalibration([FromBody] ZoomCalibrationRequest request)
    {
        try
        {
            var existing = await _context.ZoomCalibrations
                .FirstOrDefaultAsync(z =>
                    z.ScreenWidth  == request.ScreenWidth  &&
                    z.ScreenHeight == request.ScreenHeight &&
                    z.IsMobile     == request.IsMobile);

            if (existing != null)
            {
                existing.ZoomLevel        = request.ZoomLevel;
                existing.UserAgent        = request.UserAgent ?? string.Empty;
                existing.DevicePixelRatio = request.DevicePixelRatio;
                existing.CreatedAt        = DateTime.UtcNow; // updated timestamp

                _context.ZoomCalibrations.Update(existing);
                await _context.SaveChangesAsync();

                _logger.LogInformation(
                    "ZoomCalibration updated: {W}x{H} zoom={Z} mobile={M}",
                    existing.ScreenWidth, existing.ScreenHeight, existing.ZoomLevel, existing.IsMobile);

                return Ok(new { id = existing.Id, message = "Zoom calibration updated" });
            }
            else
            {
                var record = new ZoomCalibration
                {
                    ScreenWidth      = request.ScreenWidth,
                    ScreenHeight     = request.ScreenHeight,
                    ZoomLevel        = request.ZoomLevel,
                    IsMobile         = request.IsMobile,
                    UserAgent        = request.UserAgent ?? string.Empty,
                    DevicePixelRatio = request.DevicePixelRatio,
                    CreatedAt        = DateTime.UtcNow
                };

                _context.ZoomCalibrations.Add(record);
                await _context.SaveChangesAsync();

                _logger.LogInformation(
                    "ZoomCalibration inserted: {W}x{H} zoom={Z} mobile={M}",
                    record.ScreenWidth, record.ScreenHeight, record.ZoomLevel, record.IsMobile);

                return Ok(new { id = record.Id, message = "Zoom calibration saved" });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving zoom calibration");
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }

    // GET: api/zoomcalibrations — retrieve all records (for analysis)
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ZoomCalibration>>> GetAll()
    {
        try
        {
            var records = await _context.ZoomCalibrations
                .OrderByDescending(z => z.CreatedAt)
                .ToListAsync();
            return Ok(records);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving zoom calibrations");
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }
}
