use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};

pub const FCS_SUFFIX: &str = "__ACI-ENT-EVN";

/// How date/time tokens are read from segment (or audio) filenames.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsNamingConfig {
    pub delimiter: String,
    pub date_token_index: usize,
    pub date_format: String,
    pub time_token_index: usize,
    pub time_format: String,
}

impl Default for FcsNamingConfig {
    fn default() -> Self {
        Self {
            delimiter: "_".to_string(),
            date_token_index: 1,
            date_format: "%Y%m%d".to_string(),
            time_token_index: 2,
            time_format: "%H%M%S".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsNamingProbe {
    pub example_filename: String,
    pub tokens: Vec<String>,
    pub config: FcsNamingConfig,
    pub parsed_example: Option<String>,
    pub previews: Vec<FcsNamingPreview>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsNamingPreview {
    pub filename: String,
    pub parsed: Option<String>,
    pub error: Option<String>,
}

/// Strip `.png` and the false-colour suffix to get the naming stem.
pub fn segment_stem(name: &str) -> String {
    let without_png = name
        .strip_suffix(".png")
        .or_else(|| name.strip_suffix(".PNG"))
        .unwrap_or(name);
    without_png
        .strip_suffix(FCS_SUFFIX)
        .unwrap_or(without_png)
        .to_string()
}

pub fn split_tokens(stem: &str, delimiter: &str) -> Vec<String> {
    if delimiter.is_empty() {
        vec![stem.to_string()]
    } else {
        stem.split(delimiter).map(|s| s.to_string()).collect()
    }
}

pub fn parse_datetime_from_name(name: &str, config: &FcsNamingConfig) -> Result<NaiveDateTime, String> {
    let stem = segment_stem(name);
    let tokens = split_tokens(&stem, &config.delimiter);
    let date_str = tokens
        .get(config.date_token_index)
        .ok_or_else(|| format!("no token at date index {}", config.date_token_index))?;
    let time_str = tokens
        .get(config.time_token_index)
        .ok_or_else(|| format!("no token at time index {}", config.time_token_index))?;
    let date = NaiveDate::parse_from_str(date_str, &config.date_format)
        .map_err(|e| format!("date '{date_str}' with format '{}': {e}", config.date_format))?;
    let time = NaiveTime::parse_from_str(time_str, &config.time_format)
        .map_err(|e| format!("time '{time_str}' with format '{}': {e}", config.time_format))?;
    Ok(NaiveDateTime::new(date, time))
}

pub fn extract_date_token(name: &str, config: &FcsNamingConfig) -> Option<String> {
    parse_datetime_from_name(name, config)
        .ok()
        .map(|dt| dt.format("%Y%m%d").to_string())
}

/// Guess date/time token indices from an example filename.
pub fn suggest_config(example: &str) -> FcsNamingConfig {
    let stem = segment_stem(example);
    let tokens = split_tokens(&stem, "_");
    let mut config = FcsNamingConfig::default();

    for (i, tok) in tokens.iter().enumerate() {
        if tok.len() == 8 && tok.chars().all(|c| c.is_ascii_digit()) {
            if NaiveDate::parse_from_str(tok, "%Y%m%d").is_ok() {
                config.date_token_index = i;
                config.date_format = "%Y%m%d".to_string();
            }
        }
        if tok.len() == 6 && tok.chars().all(|c| c.is_ascii_digit()) {
            if NaiveTime::parse_from_str(tok, "%H%M%S").is_ok() {
                config.time_token_index = i;
                config.time_format = "%H%M%S".to_string();
            }
        }
        if tok.len() == 10 && tok.chars().filter(|c| *c == '-').count() == 2 {
            if NaiveDate::parse_from_str(tok, "%Y-%m-%d").is_ok() {
                config.date_token_index = i;
                config.date_format = "%Y-%m-%d".to_string();
            }
        }
        if tok.len() == 8 && tok.contains('-') {
            if NaiveTime::parse_from_str(tok, "%H-%M-%S").is_ok() {
                config.time_token_index = i;
                config.time_format = "%H-%M-%S".to_string();
            }
        }
    }
    config
}

pub fn probe_naming(filenames: &[String], config: &FcsNamingConfig) -> FcsNamingProbe {
    let example = filenames.first().cloned().unwrap_or_default();
    let tokens = split_tokens(&segment_stem(&example), &config.delimiter);
    let parsed_example = parse_datetime_from_name(&example, config)
        .ok()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());

    let previews = filenames
        .iter()
        .take(5)
        .map(|name| match parse_datetime_from_name(name, config) {
            Ok(dt) => FcsNamingPreview {
                filename: name.clone(),
                parsed: Some(dt.format("%Y-%m-%d %H:%M:%S").to_string()),
                error: None,
            },
            Err(e) => FcsNamingPreview {
                filename: name.clone(),
                parsed: None,
                error: Some(e),
            },
        })
        .collect();

    FcsNamingProbe {
        example_filename: example,
        tokens,
        config: config.clone(),
        parsed_example,
        previews,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_pattern() {
        let cfg = FcsNamingConfig::default();
        let dt = parse_datetime_from_name("rec_20240726_100000__ACI-ENT-EVN.png", &cfg).unwrap();
        assert_eq!(dt.format("%Y%m%d %H%M%S").to_string(), "20240726 100000");
    }
}
