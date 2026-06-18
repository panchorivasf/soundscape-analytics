# SoundscapeAnalytics

Desktop app integrating several software for comprehensive soundscape analyses. It includes acoustic indices from SoundEcology2, automatic bird detections from BirdNET, visualization from BirdnetVisualizeR, and false-color spectrograms from Ecoacoustics Analysis Programs.

The source code can be found on GitHub: https://github.com/panchorivasf/soundscape-analytics

Developed by Francisco Rivas.

## Citations

If you use this app or its components in research, please cite the underlying software:

- **SoundEcology2** (acoustic indices): Rivas, F., Villanueva-Rivera, L., & Pijanowski, B. (2025). *SoundEcology2: Soundscape Ecology*. R package. https://github.com/panchorivasf/SoundEcology2
- **BirdNET** (automatic bird detections): Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET: A deep learning solution for avian diversity monitoring. *Ecological Informatics*, 61, 101236. https://doi.org/10.1016/j.ecoinf.2021.101236
- **BirdnetVisualizeR** (BirdNET visualization): Rivas, F. *BirdnetVisualizeR: Visualization tools for BirdNET outputs*. R package. https://github.com/panchorivasf/BirdnetVisualizeR
- **False-color spectrograms** — Ecoacoustics Analysis Programs & falsecoloR:
  - Towsey, M., Truskinger, A., Cottman-Fields, M., & Roe, P. (2018). Ecoacoustics Audio Analysis Software v18.03.0.41. Zenodo. https://doi.org/10.5281/zenodo.1188744
  - Brodie, S. (2021). sherynbrodie/fcs-audio-analysis-utility (Version 21.08.0). Zenodo. https://doi.org/10.5281/zenodo.5220459
  - Rivas, F. *falsecoloR: False-color spectrogram workflow for Ecoacoustics Analysis Programs*. R package. https://github.com/panchorivasf/falsecoloR

## Features

- **Rust FFT engine** — `rustfft` + `realfft` for fast spectrogram and Welch PSD computation
- **Parallel batch processing** — `rayon` parallelizes folder/batch runs across CPU cores
- **Multi-format audio** — WAV, FLAC, MP3, OGG, and other common formats for index computation
- **Indices implemented:** ACI, ADI, AEI, BI, NDSI, FADI, FCI (LFC/MFC/HFC/UFC), NBAI, BBAI, TAI
- **CSV export** of results
- **BirdNET Analyzer**, **BirdNet Visualizer**, and **False-Color Spectrograms** tabs

## Requirements

- Node.js 18+
- Rust 1.77+
- Platform build tools (MSVC on Windows)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The installer/binary will be in `src-tauri/target/release/bundle/`.
