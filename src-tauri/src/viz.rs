use crate::audio::{read_wave, resolve_channel_mode, Channel};
use crate::dsp::binary::freq_bins_hz;
use crate::dsp::prepare_channel;
use crate::dsp::spectrogram::{
    compute_spectrogram, to_dbfs_matrix, SpectroOptions, window_length_from_freq_res,
};
use crate::indices::{
    adi_band_proportions, adi_band_ranges_hz, adi_from_db_spec, aei_band_proportions,
    aei_from_db_spec, bbai_channel_detail,
};
use crate::types::{BandViz, FciBandViz, SpectrogramViz, SpectrogramVizRequest};
use std::path::Path;

const MAX_VIZ_ROWS: usize = 220;
const MAX_VIZ_COLS: usize = 480;

pub fn compute_spectrogram_viz(req: &SpectrogramVizRequest) -> Result<SpectrogramViz, String> {
    let path = Path::new(&req.file_path);
    if !path.is_file() {
        return Err(format!("file not found: {}", req.file_path));
    }

    let wave_raw = read_wave(path).map_err(|e| e.to_string())?;
    let (wave_cow, _channels_label) = resolve_channel_mode(&wave_raw, &req.params.channel_mode);
    let wave = wave_cow.as_ref();

    let samples = prepare_channel(wave, Channel::Left, req.params.rm_offset);
    let params = &req.params;
    let wl = window_length_from_freq_res(wave.sample_rate, params.freq_res);
    let spec = compute_spectrogram(
        &samples,
        wave.sample_rate,
        &SpectroOptions {
            wl,
            win_fun: params.win_fun.clone(),
            normalized: params.norm_spec,
            amplitude_correction: !params.norm_spec,
            noise_red: params.noise_red,
            ..Default::default()
        },
    );

    let db_full = if params.norm_spec {
        spec.as_matrix()
    } else if params.db_fs {
        to_dbfs_matrix(&spec, wave.amp_max())
    } else {
        let mut m = spec.as_matrix();
        crate::dsp::to_power_db(&mut m);
        m
    };

    let n_rows = db_full.len();
    let n_cols = db_full.first().map(|r| r.len()).unwrap_or(0);
    let freq_bins = freq_bins_hz(n_rows, wave.sample_rate);
    let times_full = frame_times(&spec);

    let db_matrix = downsample_matrix(&db_full, MAX_VIZ_ROWS, MAX_VIZ_COLS);
    let times_sec = downsample_axis(&times_full, n_cols, db_matrix[0].len());
    let frequencies_hz = downsample_axis(&freq_bins, n_rows, db_matrix.len());

    let binary_full: Vec<Vec<u8>> = db_full
        .iter()
        .map(|row| {
            row.iter()
                .map(|&v| if v > params.cutoff { 1 } else { 0 })
                .collect()
        })
        .collect();
    let binary_matrix = downsample_matrix_u8(&binary_full, MAX_VIZ_ROWS, MAX_VIZ_COLS);

    let nyquist = wave.nyquist();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| req.file_path.clone());

    let mut viz = SpectrogramViz {
        file_name,
        file_path: req.file_path.clone(),
        duration: wave.duration(),
        sample_rate: wave.sample_rate,
        cutoff: params.cutoff,
        frequencies_hz,
        times_sec,
        db_matrix,
        binary_matrix,
        adi_value: None,
        aei_value: None,
        adi_bands: None,
        aei_bands: None,
        fci_bands: None,
        bbai_value: None,
        bbai_click_matrix: None,
    };

    if req.include_adi {
        viz.adi_value = Some(adi_from_db_spec(&db_full, params, nyquist));
        let props = adi_band_proportions(&db_full, params, nyquist);
        let ranges = adi_band_ranges_hz(n_rows, params, nyquist, &freq_bins);
        viz.adi_bands = Some(bands_from_props(&ranges, &props, "Band"));
    }

    if req.include_aei {
        viz.aei_value = Some(aei_from_db_spec(&db_full, params, nyquist));
        let props = aei_band_proportions(&db_full, params, nyquist);
        let ranges = adi_band_ranges_hz(n_rows, params, nyquist, &freq_bins);
        viz.aei_bands = Some(bands_from_props(&ranges, &props, "Band"));
    }

    if req.include_fci {
        viz.fci_bands = Some(fci_band_viz(wave, &samples, params));
    }

    if req.include_bbai {
        let detail = bbai_channel_detail(&samples, wave, params);
        viz.bbai_value = Some(detail.values.value);
        if !detail.click_matrix.is_empty() {
            viz.bbai_click_matrix = Some(downsample_matrix_u8(
                &detail
                    .click_matrix
                    .iter()
                    .map(|row| row.iter().map(|&b| if b { 1u8 } else { 0u8 }).collect())
                    .collect::<Vec<_>>(),
                MAX_VIZ_ROWS,
                MAX_VIZ_COLS,
            ));
        }
    }

    Ok(viz)
}

fn bands_from_props(ranges: &[(f64, f64)], props: &[f64], prefix: &str) -> Vec<BandViz> {
    ranges
        .iter()
        .zip(props.iter())
        .enumerate()
        .map(|(i, (&(min_hz, max_hz), &proportion))| BandViz {
            label: format!("{prefix} {}", i + 1),
            min_hz,
            max_hz,
            proportion,
        })
        .collect()
}

fn fci_band_viz(wave: &crate::audio::Wave, samples: &[f64], params: &crate::types::IndexParams) -> Vec<FciBandViz> {
    use crate::dsp::binary::{band_row_indices, spectrogram_binary};

    let binary = spectrogram_binary(samples, wave.sample_rate, wave, params.freq_res, params.cutoff);
    let n_rows = binary.len();
    let n_cols = binary.first().map(|r| r.len()).unwrap_or(0);
    if n_rows == 0 || n_cols == 0 {
        return Vec::new();
    }

    let mut uf_max = params.uf_max;
    if uf_max > wave.nyquist() {
        uf_max = wave.nyquist();
    }
    let freq_bins = freq_bins_hz(n_rows, wave.sample_rate);
    let total = (n_cols as f64).max(1.0);

    let cover = |indices: &[usize]| -> f64 {
        if indices.is_empty() {
            return 0.0;
        }
        let active: usize = indices
            .iter()
            .map(|&r| binary[r].iter().filter(|&&b| b).count())
            .sum();
        ((active as f64 / (indices.len() as f64 * total)) * 1_000_000.0).round() / 1_000_000.0
    };

    let bands = [
        ("LFC", params.lf_min, params.lf_max, true),
        ("MFC", params.mf_min, params.mf_max, false),
        ("HFC", params.hf_min, params.hf_max, false),
        ("UFC", params.uf_min, uf_max, false),
    ];

    bands
        .into_iter()
        .map(|(label, min_hz, max_hz, inclusive_min)| {
            let indices = band_row_indices(&freq_bins, min_hz, max_hz, inclusive_min);
            FciBandViz {
                label: label.into(),
                min_hz,
                max_hz,
                cover: cover(&indices),
            }
        })
        .collect()
}

fn frame_times(spec: &crate::dsp::spectrogram::Spectrogram) -> Vec<f64> {
    let overlap_pct = 87.5;
    let step = ((spec.wl as f64) * (1.0 - overlap_pct / 100.0)).max(1.0);
    (0..spec.n_frames)
        .map(|i| i as f64 * step / spec.sample_rate as f64)
        .collect()
}

fn downsample_matrix(mat: &[Vec<f64>], max_rows: usize, max_cols: usize) -> Vec<Vec<f64>> {
    if mat.is_empty() {
        return Vec::new();
    }
    let row_step = (mat.len() as f64 / max_rows as f64).ceil() as usize;
    let col_step = (mat[0].len() as f64 / max_cols as f64).ceil() as usize;
    mat.iter()
        .step_by(row_step.max(1))
        .map(|row| row.iter().step_by(col_step.max(1)).copied().collect())
        .collect()
}

fn downsample_matrix_u8(mat: &[Vec<u8>], max_rows: usize, max_cols: usize) -> Vec<Vec<u8>> {
    if mat.is_empty() {
        return Vec::new();
    }
    let row_step = (mat.len() as f64 / max_rows as f64).ceil() as usize;
    let col_step = (mat[0].len() as f64 / max_cols as f64).ceil() as usize;
    mat.iter()
        .step_by(row_step.max(1))
        .map(|row| row.iter().step_by(col_step.max(1)).copied().collect())
        .collect()
}

fn downsample_axis(axis: &[f64], orig_len: usize, target_len: usize) -> Vec<f64> {
    if orig_len == 0 || target_len == 0 {
        return Vec::new();
    }
    if orig_len <= target_len {
        return axis.to_vec();
    }
    let step = (orig_len as f64 / target_len as f64).ceil() as usize;
    axis.iter().step_by(step.max(1)).copied().collect()
}
