use crate::fcs_grid::fcs_grid_folder;
use crate::fcs_naming::FcsNamingConfig;
use crate::fcs_postprocess::{
    fcs_bind, fcs_edit_composites, fcs_fill_all, fcs_organize, is_fcs_segment,
    list_fcs_segment_paths, FcsBindOptions, DIEL_FCS_PLOTS_DIR, DIEL_RIBBONS_DIR, EDIT_TEMP_DIR,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsPostprocessRequest {
    pub segments_directory: String,
    pub audio_directory: Option<String>,
    pub naming: FcsNamingConfig,
    pub organize: bool,
    pub fill: bool,
    pub bind: bool,
    pub grid: bool,
    pub edit_top_crop: u32,
    pub edit_bottom_crop: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsPostprocessResult {
    pub success: bool,
    pub message: String,
    pub segments_directory: String,
    pub preview_directory: String,
    pub preview_paths: Vec<String>,
    pub step_log: Vec<String>,
    pub segment_count: u32,
}

pub fn count_fcs_segments(directory: &Path) -> Result<u32, String> {
    Ok(list_fcs_segment_paths(directory, true)?.len() as u32)
}

pub fn run_fcs_postprocess(request: FcsPostprocessRequest) -> Result<FcsPostprocessResult, String> {
    let base = PathBuf::from(&request.segments_directory);
    if !base.is_dir() {
        return Err("segments folder not found".into());
    }

    let segment_count = count_fcs_segments(&base)?;
    if segment_count == 0 && !request.organize {
        return Err(
            "No *_ACI-ENT-EVN.png segment files found. Run AP compute first or pick the folder with raw FCS tiles.".into(),
        );
    }

    let mut step_log = Vec::new();
    let ribbons_dir = base.join(DIEL_RIBBONS_DIR);
    let plots_dir = base.join(DIEL_FCS_PLOTS_DIR);
    let edit_temp_dir = base.join(EDIT_TEMP_DIR);

    let bind_options = FcsBindOptions {
        naming: request.naming.clone(),
        audio_directory: request
            .audio_directory
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| p.is_dir()),
    };

    if request.fill {
        let n = fcs_fill_all(&base, &request.naming)?;
        step_log.push(format!(
            "fcs_fill (legacy 10-min grid): {n} blank segment(s)"
        ));
    }
    if request.organize {
        let n = fcs_organize(&base, &request.naming)?;
        step_log.push(format!("fcs_organize: moved {n} segment(s)"));
    }

    if request.bind {
        let (ribbon_paths, warnings) = fcs_bind(&base, &bind_options)?;
        step_log.push(format!(
            "fcs_bind: {} diel ribbon(s) on 24 h timeline → {}/",
            ribbon_paths.len(),
            ribbons_dir.display()
        ));
        for w in warnings {
            step_log.push(format!("  warning: {w}"));
        }
        if ribbon_paths.is_empty() {
            return Err("fcs_bind found no segment PNGs to place.".into());
        }
    }

    let mut preview_dir = if request.bind {
        ribbons_dir.clone()
    } else {
        base.clone()
    };

    if request.grid {
        if !ribbons_dir.is_dir() {
            return Err("fcs_grid requires fcs_bind first (diel_ribbons/ missing).".into());
        }
        if edit_temp_dir.exists() {
            fs::remove_dir_all(&edit_temp_dir).map_err(|e| e.to_string())?;
        }
        let n = fcs_edit_composites(
            &ribbons_dir,
            &edit_temp_dir,
            request.edit_top_crop,
            request.edit_bottom_crop,
        )?;
        step_log.push(format!("fcs_edit: resized {n} ribbon(s) (temporary)"));

        let gridded = fcs_grid_folder(&edit_temp_dir, &plots_dir)?;
        step_log.push(format!(
            "fcs_grid: {} diel plot(s) → {}/",
            gridded.len(),
            plots_dir.display()
        ));

        if edit_temp_dir.exists() {
            fs::remove_dir_all(&edit_temp_dir).map_err(|e| e.to_string())?;
            step_log.push("Removed temporary edit folder.".into());
        }

        if gridded.is_empty() {
            return Err("fcs_grid produced no plots.".into());
        }
        preview_dir = plots_dir.clone();
    }

    let preview_paths: Vec<String> = list_preview_pngs(&preview_dir)?
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    let message = if preview_paths.is_empty() {
        "Post-processing finished but no preview images were produced.".to_string()
    } else {
        format!(
            "falsecoloR complete — {} daily plot(s) in {}",
            preview_paths.len(),
            preview_dir.display()
        )
    };

    Ok(FcsPostprocessResult {
        success: !preview_paths.is_empty(),
        message,
        segments_directory: base.to_string_lossy().into_owned(),
        preview_directory: preview_dir.to_string_lossy().into_owned(),
        preview_paths,
        step_log,
        segment_count,
    })
}

fn list_preview_pngs(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.to_ascii_lowercase().ends_with(".png") && !is_fcs_segment(name) {
                out.push(path);
            }
        }
    }
    out.sort();
    Ok(out)
}
