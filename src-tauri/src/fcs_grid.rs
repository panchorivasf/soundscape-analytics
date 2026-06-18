use ab_glyph::{FontArc, PxScale};
use chrono::NaiveDate;
use image::imageops::FilterType;
use image::{Rgba, RgbaImage};
use imageproc::drawing::{draw_line_segment_mut, draw_text_mut};
use std::fs;
use std::path::{Path, PathBuf};

/// Output size matching falsecoloR / ggplot ggsave(13.33, 7.5, dpi = 300).
const OUT_W: u32 = 4000;
const OUT_H: u32 = 2250;
const MARGIN_LEFT: u32 = 155;
const MARGIN_RIGHT: u32 = 55;
const MARGIN_TOP: u32 = 95;
const MARGIN_BOTTOM: u32 = 145;

const PLOT_X_HOURS: f32 = 24.0;
const PLOT_Y_KHZ: f32 = 20.0;

const GRID_COLOR: Rgba<u8> = Rgba([51, 51, 51, 255]);
const AXIS_COLOR: Rgba<u8> = Rgba([0, 0, 0, 255]);
const TEXT_COLOR: Rgba<u8> = Rgba([0, 0, 0, 255]);

fn load_font() -> Result<FontArc, String> {
    let candidates = if cfg!(windows) {
        vec![
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeui.ttf",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
        ]
    } else {
        vec![
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    };
    for path in candidates {
        if let Ok(data) = fs::read(path) {
            if let Ok(font) = FontArc::try_from_vec(data) {
                return Ok(font);
            }
        }
    }
    Err("Could not load a system font for fcs_grid axis labels (need Arial/DejaVu)".into())
}

fn extract_date_label(path: &Path) -> String {
    let name = path.to_string_lossy();
    for part in name.split(|c| c == '_' || c == '.' || c == '\\' || c == '/') {
        if part.len() == 8 && part.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(d) = NaiveDate::parse_from_str(part, "%Y%m%d") {
                return d.format("%Y %b %d").to_string();
            }
        }
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown date")
        .to_string()
}

fn plot_rect() -> (u32, u32, u32, u32) {
    let pw = OUT_W - MARGIN_LEFT - MARGIN_RIGHT;
    let ph = OUT_H - MARGIN_TOP - MARGIN_BOTTOM;
    (MARGIN_LEFT, MARGIN_TOP, pw, ph)
}

fn data_to_px(x_hours: f32, y_khz: f32, pl: u32, pt: u32, pw: u32, ph: u32) -> (i32, i32) {
    let px = pl as f32 + (x_hours / PLOT_X_HOURS) * pw as f32;
    let py = pt as f32 + ph as f32 - (y_khz / PLOT_Y_KHZ) * ph as f32;
    (px.round() as i32, py.round() as i32)
}

fn draw_dashed_hline(img: &mut RgbaImage, x0: i32, x1: i32, y: i32, color: Rgba<u8>) {
    let dash = 14;
    let gap = 10;
    let mut x = x0.min(x1);
    let x_end = x0.max(x1);
    while x < x_end {
        let x2 = (x + dash).min(x_end);
        draw_line_segment_mut(img, (x as f32, y as f32), (x2 as f32, y as f32), color);
        x += dash + gap;
    }
}

fn draw_dashed_vline(img: &mut RgbaImage, x: i32, y0: i32, y1: i32, color: Rgba<u8>) {
    let dash = 14;
    let gap = 10;
    let mut y = y0.min(y1);
    let y_end = y0.max(y1);
    while y < y_end {
        let y2 = (y + dash).min(y_end);
        draw_line_segment_mut(img, (x as f32, y as f32), (x as f32, y2 as f32), color);
        y += dash + gap;
    }
}

fn approx_text_width(text: &str, size: f32) -> i32 {
    (text.chars().count() as f32 * size * 0.55).ceil() as i32
}

fn draw_label(
    img: &mut RgbaImage,
    font: &FontArc,
    text: &str,
    size: f32,
    x: i32,
    y: i32,
) {
    draw_text_mut(
        img,
        TEXT_COLOR,
        x,
        y,
        PxScale::from(size),
        font,
        text,
    );
}

/// Add time/frequency axes, dashed grid, title, and date (falsecoloR fcs_grid).
pub fn fcs_grid_one(input: &Path, output: &Path) -> Result<(), String> {
    let font = load_font()?;
    let src = image::open(input).map_err(|e| format!("read {}: {e}", input.display()))?;
    let (pl, pt, pw, ph) = plot_rect();

    let mut canvas = RgbaImage::from_pixel(OUT_W, OUT_H, Rgba([255, 255, 255, 255]));
    let resized = image::imageops::resize(&src.to_rgba8(), pw, ph, FilterType::Lanczos3);
    image::imageops::overlay(&mut canvas, &resized, pl as i64, pt as i64);

    // Major grid: hours 1–23, kHz 5/10/15/20
    for hour in 1..=23 {
        let (x, _) = data_to_px(hour as f32, 0.0, pl, pt, pw, ph);
        draw_dashed_vline(&mut canvas, x, pt as i32, (pt + ph) as i32, GRID_COLOR);
    }
    for khz in [5, 10, 15, 20] {
        let (_, y) = data_to_px(0.0, khz as f32, pl, pt, pw, ph);
        draw_dashed_hline(&mut canvas, pl as i32, (pl + pw) as i32, y, GRID_COLOR);
    }

    // Axis box
    let (x0, y0) = (pl as i32, pt as i32);
    let (x1, y1) = ((pl + pw) as i32, (pt + ph) as i32);
    draw_line_segment_mut(&mut canvas, (x0 as f32, y1 as f32), (x1 as f32, y1 as f32), AXIS_COLOR);
    draw_line_segment_mut(&mut canvas, (x0 as f32, y0 as f32), (x0 as f32, y1 as f32), AXIS_COLOR);

    // Tick labels
    for hour in 1..=23 {
        let (x, y_base) = data_to_px(hour as f32, 0.0, pl, pt, pw, ph);
        draw_label(&mut canvas, &font, &hour.to_string(), 28.0, x - 8, y_base + 12);
    }
    for khz in [5, 10, 15, 20] {
        let (x_base, y) = data_to_px(0.0, khz as f32, pl, pt, pw, ph);
        draw_label(
            &mut canvas,
            &font,
            &khz.to_string(),
            28.0,
            x_base - 42,
            y - 14,
        );
    }

    draw_label(
        &mut canvas,
        &font,
        "Time (hours)",
        34.0,
        (pl + pw / 2 - 90) as i32,
        (OUT_H - 55) as i32,
    );
    draw_label(
        &mut canvas,
        &font,
        "Frequency (kHz)",
        34.0,
        18,
        (pt + ph / 2) as i32,
    );

    // Header row above the spectrogram: indices (left) and date (right).
    const HEADER_Y: i32 = 32;
    draw_label(
        &mut canvas,
        &font,
        "RGB = ACI-ENT-EVN",
        36.0,
        18,
        HEADER_Y,
    );

    let date_label = extract_date_label(input);
    let date_w = approx_text_width(&date_label, 42.0);
    let date_x = (OUT_W - MARGIN_RIGHT).saturating_sub(date_w as u32) as i32;
    draw_label(&mut canvas, &font, &date_label, 42.0, date_x, HEADER_Y);

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    canvas.save(output).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn fcs_grid_folder(input_dir: &Path, output_dir: &Path) -> Result<Vec<PathBuf>, String> {
    fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;
    let mut written = Vec::new();
    for entry in fs::read_dir(input_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.to_ascii_lowercase().ends_with(".png") {
            continue;
        }
        if name.contains("ACI-ENT-EVN") && name.contains('_') {
            continue;
        }
        let dest = output_dir.join(name);
        fcs_grid_one(&path, &dest)?;
        written.push(dest);
    }
    written.sort();
    Ok(written)
}
