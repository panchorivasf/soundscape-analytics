mod audio;
mod batch;
mod birdnet_analyzer;
mod commands;
mod dsp;
mod falsecolor;
mod fcs_grid;
mod fcs_manifest;
mod fcs_naming;
mod fcs_pipeline;
mod fcs_postprocess;
mod indices;
mod table_export;
mod types;
mod viz;

#[cfg(test)]
mod tests {
    use crate::audio::{SampleScale, Wave};
    use crate::dsp::spectrogram::{compute_spectrogram, to_dbfs_matrix, SpectroOptions};
    use crate::indices::{adi_from_db_spec, aei_from_db_spec};
    use crate::types::IndexParams;

    fn sine_wave_int(sr: u32, secs: f64, freq: f64, amp: f64) -> Wave {
        let n = (sr as f64 * secs) as usize;
        let left: Vec<f64> = (0..n)
            .map(|i| amp * (2.0 * std::f64::consts::PI * freq * i as f64 / sr as f64).sin())
            .collect();
        Wave {
            left,
            right: None,
            sample_rate: sr,
            bits: 16,
            scale: SampleScale::Integer,
        }
    }

    #[test]
    fn adi_nonzero_for_loud_sine() {
        let wave = sine_wave_int(48_000, 10.0, 3000.0, 20_000.0);
        let params = IndexParams::default();
        let wl =
            crate::dsp::spectrogram::window_length_from_freq_res(wave.sample_rate, params.freq_res);
        let spec = compute_spectrogram(
            &wave.left,
            wave.sample_rate,
            &SpectroOptions {
                wl,
                win_fun: params.win_fun.clone(),
                amplitude_correction: true,
                ..Default::default()
            },
        );
        let db = to_dbfs_matrix(&spec, wave.amp_max());
        let max_db = db
            .iter()
            .flat_map(|r| r.iter())
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(max_db > params.cutoff, "max dBFS {max_db} should exceed cutoff");

        let adi = adi_from_db_spec(&db, &params, wave.nyquist());
        assert!(adi > 0.0, "ADI should be > 0, got {adi}");

        let aei = aei_from_db_spec(&db, &params, wave.nyquist());
        assert!(aei > 0.0, "AEI should be > 0, got {aei}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::compute_indices,
            commands::list_wav_in_folder,
            commands::list_birdnet_in_folder,
            commands::read_text_files,
            commands::detect_birdnet_analyzer,
            commands::run_birdnet_analyze,
            commands::cancel_birdnet_analyze,
            commands::birdnet_analyze_running,
            commands::install_birdnet_analyzer,
            commands::detect_analysis_programs,
            commands::install_analysis_programs,
            commands::run_fcs_compute,
            commands::cancel_fcs_compute,
            commands::fcs_compute_running,
            commands::run_fcs_postprocess,
            commands::count_fcs_segments,
            commands::probe_fcs_naming,
            commands::available_indices,
            commands::default_params,
            commands::export_csv,
            commands::export_table,
            commands::write_text_file,
            commands::spectrogram_viz,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
