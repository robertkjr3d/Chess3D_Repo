using System.ComponentModel.DataAnnotations;

namespace Chess3DBackend.Models;

public class ZoomCalibration
{
    [Key]
    public int Id { get; set; }

    /// <summary>Screen width in CSS pixels (window.innerWidth)</summary>
    public int ScreenWidth { get; set; }

    /// <summary>Screen height in CSS pixels (window.innerHeight)</summary>
    public int ScreenHeight { get; set; }

    /// <summary>The zoom value that was saved for this resolution</summary>
    public double ZoomLevel { get; set; }

    /// <summary>True when the left-side menu was NOT active (mobile UA or narrow viewport)</summary>
    public bool IsMobile { get; set; }

    /// <summary>Raw User-Agent string from the browser (sent by client)</summary>
    public string UserAgent { get; set; } = string.Empty;

    /// <summary>Device pixel ratio (window.devicePixelRatio)</summary>
    public double DevicePixelRatio { get; set; } = 1;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ZoomCalibrationRequest
{
    public int ScreenWidth { get; set; }
    public int ScreenHeight { get; set; }
    public double ZoomLevel { get; set; }
    public bool IsMobile { get; set; }
    public string? UserAgent { get; set; }
    public double DevicePixelRatio { get; set; } = 1;
}
