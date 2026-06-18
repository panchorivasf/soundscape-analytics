use crate::audio::{list_audio_files, read_audio};
use crate::indices::compute_all_for_wave;
use crate::types::{ComputeRequest, IndexResult};
use rayon::prelude::*;
use std::path::Path;

pub fn process_files(request: &ComputeRequest) -> Vec<IndexResult> {
    if let Some(n) = request.num_threads {
        if n > 0 {
            rayon::ThreadPoolBuilder::new()
                .num_threads(n)
                .build_global()
                .ok();
        }
    }

    let files = if request.files.len() == 1 {
        let p = Path::new(&request.files[0]);
        if p.is_dir() {
            list_audio_files(p).unwrap_or_default()
        } else {
            request.files.clone()
        }
    } else {
        request.files.clone()
    };

    files
        .par_iter()
        .flat_map(|file_path| {
            let file_name = Path::new(file_path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| file_path.clone());

            match read_audio(Path::new(file_path)) {
                Ok(wave) => compute_all_for_wave(&wave, &file_name, &request.indices, &request.params),
                Err(e) => request
                    .indices
                    .iter()
                    .map(|idx| IndexResult {
                        file_name: file_name.clone(),
                        index: idx.clone(),
                        value: None,
                        value_l: None,
                        value_r: None,
                        value_avg: None,
                        channels: String::new(),
                        duration: 0.0,
                        sample_rate: 0,
                        error: Some(e.to_string()),
                    })
                    .collect(),
            }
        })
        .collect()
}
