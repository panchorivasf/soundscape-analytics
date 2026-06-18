use arrow::array::{Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use rust_xlsxwriter::Workbook;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

pub fn write_csv_table(path: &Path, columns: &[String], rows: &[Vec<String>]) -> Result<(), String> {
    let mut wtr = csv::Writer::from_path(path).map_err(|e| e.to_string())?;
    wtr.write_record(columns).map_err(|e| e.to_string())?;
    for row in rows {
        wtr.write_record(row).map_err(|e| e.to_string())?;
    }
    wtr.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn write_xlsx_table(path: &Path, columns: &[String], rows: &[Vec<String>]) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    for (col, header) in columns.iter().enumerate() {
        worksheet
            .write_string(0, col as u16, header)
            .map_err(|e| e.to_string())?;
    }
    for (row_idx, row) in rows.iter().enumerate() {
        for (col_idx, val) in row.iter().enumerate() {
            worksheet
                .write_string((row_idx + 1) as u32, col_idx as u16, val)
                .map_err(|e| e.to_string())?;
        }
    }
    workbook.save(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn write_parquet_table(path: &Path, columns: &[String], rows: &[Vec<String>]) -> Result<(), String> {
    let fields: Vec<Field> = columns
        .iter()
        .map(|name| Field::new(name, DataType::Utf8, true))
        .collect();
    let schema = Arc::new(Schema::new(fields));

    let arrays: Vec<Arc<dyn Array>> = columns
        .iter()
        .enumerate()
        .map(|(col_idx, _)| {
            let values: Vec<Option<String>> = rows
                .iter()
                .map(|row| row.get(col_idx).cloned().filter(|s| !s.is_empty()))
                .collect();
            Arc::new(StringArray::from(values)) as Arc<dyn Array>
        })
        .collect();

    let batch = RecordBatch::try_new(schema.clone(), arrays).map_err(|e| e.to_string())?;
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut writer = ArrowWriter::try_new(file, schema, None).map_err(|e| e.to_string())?;
    writer.write(&batch).map_err(|e| e.to_string())?;
    writer.close().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn export_table(path: &str, format: &str, columns: &[String], rows: &[Vec<String>]) -> Result<(), String> {
    let path = Path::new(path);
    match format.to_lowercase().as_str() {
        "csv" => write_csv_table(path, columns, rows),
        "xlsx" => write_xlsx_table(path, columns, rows),
        "parquet" | "parq" => write_parquet_table(path, columns, rows),
        _ => Err(format!("unsupported table format: {format}")),
    }
}
