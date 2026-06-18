# SoundscapeAnalytics

Lightweight Tauri desktop application for computing acoustic indices from WAV recordings. Built on the SoundEcology2 index implementations.

## Features

- **Rust FFT engine** — `rustfft` + `realfft` for fast spectrogram and Welch PSD computation
- **Parallel batch processing** — `rayon` parallelizes folder/batch runs across CPU cores
- **Indices implemented:** ACI, ADI, AEI, BI, NDSI, FADI, FCI (LFC/MFC/HFC/UFC), NBAI, BBAI, TAI
- **CSV export** of results

## Requirements

- Node.js 18+
- Rust 1.77+
- Platform build tools (MSVC on Windows)

## Development

```bash
cd soundecology-app
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The installer/binary will be in `src-tauri/target/release/bundle/`.
