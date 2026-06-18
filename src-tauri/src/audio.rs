use hound::{SampleFormat, WavReader, WavSpec};
use std::borrow::Cow;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("failed to read WAV: {0}")]
    Io(#[from] hound::Error),
    #[error("unsupported bit depth: {bits}")]
    UnsupportedBitDepth { bits: u16 },
    #[error("unsupported sample format")]
    UnsupportedFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleScale {
    /// Integer PCM stored as f64 in native bit-depth range (matches tuneR/seewave).
    Integer,
    /// Float PCM in [-1, 1].
    Float,
}

#[derive(Debug, Clone)]
pub struct Wave {
    pub left: Vec<f64>,
    pub right: Option<Vec<f64>>,
    pub sample_rate: u32,
    pub bits: u16,
    pub scale: SampleScale,
}

impl Wave {
    pub fn is_stereo(&self) -> bool {
        self.right.is_some()
    }

    pub fn duration(&self) -> f64 {
        self.left.len() as f64 / self.sample_rate as f64
    }

    pub fn nyquist(&self) -> f64 {
        self.sample_rate as f64 / 2.0
    }

    /// Full-scale reference for dBFS (ADI/AEI), from this file's bit depth.
    pub fn amp_max(&self) -> f64 {
        match self.scale {
            SampleScale::Float => 1.0,
            SampleScale::Integer => integer_full_scale(self.bits, FullScaleKind::Adi),
        }
    }

    /// Full-scale reference for BI / binary spectrogram paths in R.
    pub fn amp_max_bi(&self) -> f64 {
        match self.scale {
            SampleScale::Float => 1.0,
            SampleScale::Integer => integer_full_scale(self.bits, FullScaleKind::Bi),
        }
    }

    pub fn channel(&self, which: Channel) -> Vec<f64> {
        match which {
            Channel::Left => self.left.clone(),
            Channel::Right => self
                .right
                .clone()
                .unwrap_or_else(|| self.left.clone()),
            Channel::Mix => {
                if let Some(ref r) = self.right {
                    self.left
                        .iter()
                        .zip(r.iter())
                        .map(|(l, ri)| (l + ri) / 2.0)
                        .collect()
                } else {
                    self.left.clone()
                }
            }
        }
    }

    pub fn channel_ref(&self, which: Channel) -> &[f64] {
        match which {
            Channel::Left => &self.left,
            Channel::Right => self.right.as_deref().unwrap_or(&self.left),
            Channel::Mix => &self.left, // mix requires allocation; callers use channel()
        }
    }
}

#[derive(Clone, Copy)]
enum FullScaleKind {
    Adi,
    Bi,
}

/// Matches SoundEcology2 / tuneR bit-depth lookup for dBFS.
fn integer_full_scale(bits: u16, kind: FullScaleKind) -> f64 {
    match (bits, kind) {
        (16, FullScaleKind::Adi) => 32768.0,
        (16, FullScaleKind::Bi) => 32767.0,
        (24, _) => 8_388_607.0,
        (32, _) => 2_147_483_647.0,
        _ => 32768.0, // unreachable if validate_spec passed
    }
}

fn validate_integer_bit_depth(bits: u16) -> Result<(), AudioError> {
    match bits {
        16 | 24 | 32 => Ok(()),
        _ => Err(AudioError::UnsupportedBitDepth { bits }),
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Channel {
    Left,
    Right,
    Mix,
}

/// Apply stereo channel mode before index computation.
/// Mono files are unchanged. `"each"` keeps stereo as-is.
pub fn resolve_channel_mode<'a>(wave: &'a Wave, mode: &str) -> (Cow<'a, Wave>, &'static str) {
    if !wave.is_stereo() {
        return (Cow::Borrowed(wave), "mono");
    }
    match mode.to_lowercase().as_str() {
        "left" => (Cow::Owned(to_mono(wave, Channel::Left)), "mono (left)"),
        "right" => (Cow::Owned(to_mono(wave, Channel::Right)), "mono (right)"),
        "mix" | "average" => (Cow::Owned(to_mono(wave, Channel::Mix)), "mono (average)"),
        _ => (Cow::Borrowed(wave), "stereo"),
    }
}

fn to_mono(wave: &Wave, which: Channel) -> Wave {
    Wave {
        left: wave.channel(which),
        right: None,
        sample_rate: wave.sample_rate,
        bits: wave.bits,
        scale: wave.scale,
    }
}

pub fn read_wave(path: &Path) -> Result<Wave, AudioError> {
    let reader = WavReader::open(path)?;
    let spec = reader.spec();
    validate_spec(&spec)?;

    let scale = match spec.sample_format {
        SampleFormat::Float => SampleScale::Float,
        SampleFormat::Int => SampleScale::Integer,
    };

    let samples = read_samples(reader, &spec, scale)?;
    let (left, right) = if spec.channels == 1 {
        (samples, None)
    } else {
        let mut l = Vec::with_capacity(samples.len() / 2);
        let mut r = Vec::with_capacity(samples.len() / 2);
        for chunk in samples.chunks(2) {
            l.push(chunk[0]);
            r.push(chunk.get(1).copied().unwrap_or(chunk[0]));
        }
        (l, Some(r))
    };

    Ok(Wave {
        left,
        right,
        sample_rate: spec.sample_rate,
        bits: spec.bits_per_sample,
        scale,
    })
}

/// Read WAV duration from the header without decoding samples.
pub fn wav_duration_secs(path: &Path) -> Result<f64, AudioError> {
    let reader = WavReader::open(path)?;
    let spec = reader.spec();
    let frames = reader.len() as u64 / spec.channels as u64;
    Ok(frames as f64 / spec.sample_rate as f64)
}

fn validate_spec(spec: &WavSpec) -> Result<(), AudioError> {
    match spec.sample_format {
        SampleFormat::Int => validate_integer_bit_depth(spec.bits_per_sample),
        SampleFormat::Float => Ok(()),
    }
}

fn read_samples(
    mut reader: WavReader<std::io::BufReader<std::fs::File>>,
    spec: &WavSpec,
    scale: SampleScale,
) -> Result<Vec<f64>, AudioError> {
    let n = reader.len() as usize;
    let mut out = Vec::with_capacity(n);

    match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Int, 16) => {
            for s in reader.samples::<i16>() {
                // Keep integer scale — seewave/tuneR operate on raw PCM values.
                out.push(s? as f64);
            }
        }
        (SampleFormat::Int, 32) => {
            for s in reader.samples::<i32>() {
                out.push(s? as f64);
            }
        }
        (SampleFormat::Int, 24) => {
            for s in reader.samples::<i32>() {
                out.push(s? as f64);
            }
        }
        (SampleFormat::Float, _) => {
            for s in reader.samples::<f32>() {
                out.push(s? as f64);
            }
        }
        _ => return Err(AudioError::UnsupportedFormat),
    }

    if scale == SampleScale::Integer && out.is_empty() {
        return Ok(out);
    }

    Ok(out)
}

pub fn list_wav_files(folder: &Path) -> Result<Vec<String>, std::io::Error> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("wav") {
                    files.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }
    files.sort();
    Ok(files)
}
