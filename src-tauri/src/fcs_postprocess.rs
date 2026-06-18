use crate::audio::wav_duration_secs;
use crate::fcs_manifest::FcsManifest;
use crate::fcs_naming::{extract_date_token, parse_datetime_from_name, segment_stem, FcsNamingConfig};
use chrono::{NaiveDateTime, Timelike};
use image::codecs::png::PngEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, ImageEncoder, Rgba, RgbaImage};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const DIEL_RIBBONS_DIR: &str = "diel_ribbons";
pub const DIEL_FCS_PLOTS_DIR: &str = "diel_fcs_plots";
/// Internal scratch space for 1280×720 resizes before fcs_grid; removed after plots are saved.
pub const EDIT_TEMP_DIR: &str = ".fcs_edit_tmp";

const BLANK_HEIGHT: u32 = 3;
const BLANK_WIDTH: u32 = 316;
const DAY_CANVAS_WIDTH: u32 = 8640;
const SECONDS_PER_DAY: f64 = 86_400.0;

const SKIP_DIRS: &[&str] = &[
    "Indices",
    "HiRes",
    DIEL_RIBBONS_DIR,
    DIEL_FCS_PLOTS_DIR,
    EDIT_TEMP_DIR,
    // legacy output folder names
    "Composites",
    "Edited",
    "Final",
];

const BLANK_PIXEL: Rgba<u8> = Rgba([200, 200, 200, 255]);

#[derive(Debug, Clone)]
pub struct FcsBindOptions {
    pub naming: FcsNamingConfig,
    pub audio_directory: Option<PathBuf>,
}

struct SegmentMeta {
    path: PathBuf,
    start: NaiveDateTime,
    duration_secs: f64,
}

/// True for per-segment false-colour PNGs from AP (not daily composites).
pub fn is_fcs_segment(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".png")
        && name.contains("ACI-ENT-EVN")
        && !is_daily_composite_name(name)
}

pub fn list_fcs_segment_paths(dir: &Path, recursive: bool) -> Result<Vec<PathBuf>, String> {
    list_fcs_segments(dir, recursive)
}

pub fn list_fcs_segment_names(dir: &Path, recursive: bool) -> Result<Vec<String>, String> {
    Ok(list_fcs_segment_paths(dir, recursive)?
        .into_iter()
        .filter_map(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
        })
        .collect())
}

fn is_daily_composite_name(name: &str) -> bool {
    let stem = name.strip_suffix(".png").unwrap_or(name);
    stem.len() == 8 && stem.chars().all(|c| c.is_ascii_digit())
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
}

/// Move segment PNGs into `Date_YYYYMMDD/` subfolders (output root only).
pub fn fcs_organize(directory: &Path, naming: &FcsNamingConfig) -> Result<usize, String> {
    let mut moved = 0usize;
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_fcs_segment(name) {
            continue;
        }
        let Some(date) = extract_date_token(name, naming) else {
            continue;
        };
        let folder = directory.join(format!("Date_{date}"));
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let dest = folder.join(name);
        fs::rename(&path, &dest).map_err(|e| e.to_string())?;
        moved += 1;
    }
    Ok(moved)
}

/// Legacy falsecoloR helper: fill every 10-minute slot from 00:00–23:50 for continuous recorders.
pub fn fcs_fill_all(directory: &Path, naming: &FcsNamingConfig) -> Result<usize, String> {
    let mut created = fcs_fill(directory, naming)?;
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("Date_") {
            created += fcs_fill(&path, naming)?;
        }
    }
    Ok(created)
}

fn fcs_fill(directory: &Path, naming: &FcsNamingConfig) -> Result<usize, String> {
    let mut created = 0usize;
    let files = list_fcs_segments(directory, false)?;
    if files.is_empty() {
        return Ok(0);
    }

    let mut by_day: BTreeMap<String, Vec<(String, NaiveDateTime, String)>> = BTreeMap::new();

    for path in files {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let Ok(ts) = parse_datetime_from_name(&name, naming) else {
            continue;
        };
        let prefix = segment_stem(&name)
            .split(&naming.delimiter)
            .next()
            .unwrap_or("recording")
            .to_string();
        let day = ts.format("%Y%m%d").to_string();
        by_day.entry(day).or_default().push((name, ts, prefix));
    }

    for (_day, mut entries) in by_day {
        if entries.is_empty() {
            continue;
        }
        entries.sort_by_key(|(_, ts, _)| *ts);
        let prefix = entries[0].2.clone();
        let day = entries[0].1.date();
        let mut expected = day.and_hms_opt(0, 0, 0).unwrap();
        let end = day.and_hms_opt(23, 50, 0).unwrap();

        let existing: std::collections::HashSet<String> =
            entries.iter().map(|(n, _, _)| n.clone()).collect();

        while expected <= end {
            let stamp = expected.format("%Y%m%d_%H%M%S").to_string();
            let fname = format!("{prefix}_{stamp}__ACI-ENT-EVN.png");
            if !existing.contains(&fname) {
                let out = directory.join(&fname);
                write_blank_png(&out)?;
                created += 1;
            }
            expected += chrono::Duration::minutes(10);
        }
    }
    Ok(created)
}

/// Place each segment on a 24-hour timeline using start time + recording duration.
pub fn fcs_bind(
    directory: &Path,
    options: &FcsBindOptions,
) -> Result<(Vec<PathBuf>, Vec<String>), String> {
    let manifest = FcsManifest::load(directory);
    let files = list_fcs_segments(directory, true)?;
    let mut warnings = Vec::new();
    let mut by_date: BTreeMap<String, Vec<SegmentMeta>> = BTreeMap::new();

    for path in files {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        match resolve_segment_meta(&path, &name, options, manifest.as_ref()) {
            Ok(meta) => {
                let day = meta.start.format("%Y%m%d").to_string();
                by_date.entry(day).or_default().push(meta);
            }
            Err(e) => warnings.push(format!("{name}: {e}")),
        }
    }

    if by_date.is_empty() {
        return Err(
            "No segments could be placed on the timeline. Check filename date/time settings and audio folder for durations.".into(),
        );
    }

    let composites_dir = directory.join(DIEL_RIBBONS_DIR);
    fs::create_dir_all(&composites_dir).map_err(|e| e.to_string())?;

    let mut written = Vec::new();
    for (date, mut segments) in by_date {
        segments.sort_by_key(|s| s.start);
        let height = segments
            .iter()
            .filter_map(|s| image::open(&s.path).ok().map(|i| i.height()))
            .max()
            .unwrap_or(BLANK_HEIGHT)
            .max(BLANK_HEIGHT);

        let mut canvas = RgbaImage::from_pixel(DAY_CANVAS_WIDTH, height, BLANK_PIXEL);

        for seg in &segments {
            let img = image::open(&seg.path)
                .map_err(|e| format!("read {}: {e}", seg.path.display()))?
                .to_rgba8();
            let x0 = time_to_x(seg.start);
            let width = duration_to_width(seg.duration_secs);
            let resized = image::imageops::resize(&img, width, height, FilterType::Nearest);
            blit_rgba(&mut canvas, &resized, x0, 0);
        }

        let dest = composites_dir.join(format!("{date}.png"));
        canvas.save(&dest).map_err(|e| e.to_string())?;
        written.push(dest);
    }

    Ok((written, warnings))
}

fn time_to_x(start: NaiveDateTime) -> u32 {
    let secs = start.time().num_seconds_from_midnight() as f64;
    ((secs / SECONDS_PER_DAY) * DAY_CANVAS_WIDTH as f64).round() as u32
}

fn duration_to_width(duration_secs: f64) -> u32 {
    let w = ((duration_secs / SECONDS_PER_DAY) * DAY_CANVAS_WIDTH as f64).round() as u32;
    w.max(1).min(DAY_CANVAS_WIDTH)
}

fn blit_rgba(canvas: &mut RgbaImage, src: &RgbaImage, x0: u32, y0: u32) {
    let (cw, ch) = canvas.dimensions();
    for (x, y, pixel) in src.enumerate_pixels() {
        let dx = x0 + x;
        let dy = y0 + y;
        if dx < cw && dy < ch {
            canvas.put_pixel(dx, dy, *pixel);
        }
    }
}

fn resolve_segment_meta(
    path: &Path,
    name: &str,
    options: &FcsBindOptions,
    manifest: Option<&FcsManifest>,
) -> Result<SegmentMeta, String> {
    let naming = manifest
        .map(|m| &m.naming)
        .unwrap_or(&options.naming);
    let start = parse_datetime_from_name(name, naming)?;

    if let Some(m) = manifest {
        if let Some(entry) = m.entry_for_png(name) {
            if entry.duration_secs > 0.0 {
                return Ok(SegmentMeta {
                    path: path.to_path_buf(),
                    start,
                    duration_secs: entry.duration_secs,
                });
            }
            let audio = PathBuf::from(&entry.audio_file);
            if audio.is_file() {
                if let Ok(d) = audio_duration_secs(&audio) {
                    return Ok(SegmentMeta {
                        path: path.to_path_buf(),
                        start,
                        duration_secs: d,
                    });
                }
            }
        }
    }

    let duration_secs = lookup_duration_secs(name, options, manifest)?;
    Ok(SegmentMeta {
        path: path.to_path_buf(),
        start,
        duration_secs,
    })
}

fn lookup_duration_secs(
    png_name: &str,
    options: &FcsBindOptions,
    manifest: Option<&FcsManifest>,
) -> Result<f64, String> {
    if let Some(m) = manifest {
        if let Some(entry) = m.entry_for_png(png_name) {
            if entry.duration_secs > 0.0 {
                return Ok(entry.duration_secs);
            }
            let audio = PathBuf::from(&entry.audio_file);
            if audio.is_file() {
                return audio_duration_secs(&audio);
            }
        }
    }

    let stem = segment_stem(png_name);
    if let Some(ref audio_dir) = options.audio_directory {
        if let Some(audio) = find_audio_for_stem(audio_dir, &stem) {
            return audio_duration_secs(&audio);
        }
    }

    if let Some(m) = manifest {
        let audio_dir = PathBuf::from(&m.audio_directory);
        if audio_dir.is_dir() {
            if let Some(audio) = find_audio_for_stem(&audio_dir, &stem) {
                return audio_duration_secs(&audio);
            }
        }
    }

    Err("no matching audio file for duration".into())
}

fn find_audio_for_stem(audio_dir: &Path, stem: &str) -> Option<PathBuf> {
    for ext in ["wav", "WAV", "flac", "FLAC", "mp3", "MP3", "ogg", "wma"] {
        let p = audio_dir.join(format!("{stem}.{ext}"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn audio_duration_secs(path: &Path) -> Result<f64, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "wav" {
        wav_duration_secs(path).map_err(|e| e.to_string())
    } else {
        Err(format!(
            "duration lookup for .{ext} not supported yet — use WAV or run AP compute to build fcs_manifest.json"
        ))
    }
}

pub fn fcs_edit_composites(
    composites_dir: &Path,
    output_folder: &Path,
    top_crop: u32,
    bottom_crop: u32,
) -> Result<usize, String> {
    fs::create_dir_all(output_folder).map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for entry in fs::read_dir(composites_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.to_ascii_lowercase().ends_with(".png") || is_fcs_segment(name) {
            continue;
        }
        let img = image::open(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let (w, h) = (img.width(), img.height());
        let resized = if top_crop + bottom_crop < h {
            let cropped = img.crop_imm(0, top_crop, w, h - top_crop - bottom_crop);
            cropped.resize_exact(1280, 720, FilterType::Lanczos3)
        } else {
            img.resize_exact(1280, 720, FilterType::Lanczos3)
        };
        let dest = output_folder.join(name);
        resized.save(&dest).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}

fn list_fcs_segments(dir: &Path, recursive: bool) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    collect_fcs_segments(dir, recursive, &mut out)?;
    out.sort();
    Ok(out)
}

fn collect_fcs_segments(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if is_fcs_segment(name) {
                out.push(path);
            }
        } else if recursive && path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !should_skip_dir(name) {
                collect_fcs_segments(&path, true, out)?;
            }
        }
    }
    Ok(())
}

fn write_blank_png(path: &Path) -> Result<(), String> {
    let mut img = RgbaImage::new(BLANK_WIDTH, BLANK_HEIGHT);
    for pixel in img.pixels_mut() {
        *pixel = BLANK_PIXEL;
    }
    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(img.as_raw(), BLANK_WIDTH, BLANK_HEIGHT, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    fs::write(path, buf).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_fcs_segment_names() {
        assert!(is_fcs_segment("rec_20240726_100000__ACI-ENT-EVN.png"));
        assert!(!is_fcs_segment("20240726.png"));
    }

    #[test]
    fn duration_width_scales_with_recording_length() {
        assert_eq!(duration_to_width(600.0), 60);
        assert_eq!(duration_to_width(86_400.0), DAY_CANVAS_WIDTH);
    }
}
