use crate::fcs_naming::FcsNamingConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const MANIFEST_NAME: &str = "fcs_manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsManifestEntry {
    pub segment_png: String,
    pub audio_file: String,
    pub duration_secs: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsManifest {
    pub version: u32,
    pub audio_directory: String,
    pub naming: FcsNamingConfig,
    pub segments: Vec<FcsManifestEntry>,
}

impl FcsManifest {
    pub fn new(audio_directory: &Path, naming: FcsNamingConfig) -> Self {
        Self {
            version: 1,
            audio_directory: audio_directory.to_string_lossy().into_owned(),
            naming,
            segments: Vec::new(),
        }
    }

    pub fn path_in(segments_dir: &Path) -> PathBuf {
        segments_dir.join(MANIFEST_NAME)
    }

    pub fn load(segments_dir: &Path) -> Option<Self> {
        let path = Self::path_in(segments_dir);
        let text = fs::read_to_string(path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn save(&self, segments_dir: &Path) -> Result<(), String> {
        let path = Self::path_in(segments_dir);
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn entry_for_png(&self, png_name: &str) -> Option<&FcsManifestEntry> {
        self.segments
            .iter()
            .find(|e| e.segment_png.eq_ignore_ascii_case(png_name))
    }
}
