use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use rayon::prelude::*;

#[derive(Debug, Deserialize)]
struct CsvRow {
    transaction_id: String,
    item_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Rule {
    item_a: String,
    item_b: String,
    support: usize,
    confidence: f64,
    lift: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnalysisResult {
    rules: Vec<Rule>,
    skipped_rows: usize,
    total_rows: usize,
}

#[tauri::command]
fn analyze_csv(path: String, master_path: Option<String>) -> Result<AnalysisResult, String> {
    let master = if let Some(p) = master_path {
        if !p.is_empty() {
            let file = File::open(&p).map_err(|e| format!("マスターを開けません: {}", e))?;
            let mut rdr = csv::Reader::from_reader(file);
            let mut m = HashMap::new();
            for result in rdr.records() {
                if let Ok(record) = result {
                    if record.len() >= 2 {
                        m.insert(record[0].to_string(), record[1].to_string());
                    }
                }
            }
            Some(m)
        } else {
            None
        }
    } else {
        None
    };

    let get_name = |id: &String| -> String {
        if let Some(m) = &master {
            m.get(id).cloned().unwrap_or_else(|| id.clone())
        } else {
            id.clone()
        }
    };

    let file = File::open(&path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut rdr = csv::Reader::from_reader(file);

    let mut transactions: HashMap<String, HashSet<String>> = HashMap::new();
    let mut item_counts: HashMap<String, usize> = HashMap::new();
    
    let mut skipped_rows = 0;
    let mut total_rows = 0;

    for result in rdr.deserialize() {
        total_rows += 1;
        match result {
            Ok(record) => {
                let CsvRow { transaction_id, item_id } = record;
                transactions
                    .entry(transaction_id)
                    .or_insert_with(HashSet::new)
                    .insert(item_id);
            },
            Err(_) => {
                // エラー行（フォーマット異常等）はスキップする
                skipped_rows += 1;
            }
        }
    }

    let total_transactions = transactions.len() as f64;

    for items in transactions.values() {
        for item in items {
            *item_counts.entry(item.clone()).or_insert(0) += 1;
        }
    }

    // トランザクションごとのアイテムリストをベクターに変換
    let transaction_items: Vec<Vec<String>> = transactions
        .into_values()
        .map(|set| set.into_iter().collect())
        .collect();

    // Rayonを利用して総当たりペアの集計をマルチスレッド化
    let pair_counts: HashMap<(String, String), usize> = transaction_items
        .par_iter()
        .fold(
            || HashMap::new(),
            |mut acc: HashMap<(String, String), usize>, items| {
                for i in 0..items.len() {
                    for j in (i + 1)..items.len() {
                        let mut a = items[i].clone();
                        let mut b = items[j].clone();
                        if a > b {
                            std::mem::swap(&mut a, &mut b);
                        }
                        *acc.entry((a, b)).or_insert(0) += 1;
                    }
                }
                acc
            }
        )
        .reduce(
            || HashMap::new(),
            |mut a, b| {
                for (k, v) in b {
                    *a.entry(k).or_insert(0) += v;
                }
                a
            }
        );

    let mut rules = Vec::new();
    for ((a, b), support) in pair_counts {
        if support < 2 { continue; } // minimum support
        
        let count_a = *item_counts.get(&a).unwrap_or(&0) as f64;
        let count_b = *item_counts.get(&b).unwrap_or(&0) as f64;
        
        let conf_a_b = support as f64 / count_a;
        let conf_b_a = support as f64 / count_b;
        
        let lift = (support as f64 / total_transactions) / ((count_a / total_transactions) * (count_b / total_transactions));

        if conf_a_b >= conf_b_a {
            rules.push(Rule { item_a: get_name(&a), item_b: get_name(&b), support, confidence: conf_a_b, lift });
        } else {
            rules.push(Rule { item_a: get_name(&b), item_b: get_name(&a), support, confidence: conf_b_a, lift });
        }
    }

    rules.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    let top_rules = rules.into_iter().take(10).collect();

    Ok(AnalysisResult {
        rules: top_rules,
        skipped_rows,
        total_rows,
    })
}

use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
struct PluginManifest {
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
}

#[tauri::command]
fn get_plugins() -> Vec<PluginManifest> {
    let mut plugins = Vec::new();
    let mut plugins_dir = PathBuf::from("plugins");
    if !plugins_dir.exists() {
        plugins_dir = PathBuf::from("../plugins");
    }
    
    if let Ok(entries) = fs::read_dir(plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("plugin.json");
                if let Ok(content) = fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                        plugins.push(manifest);
                    }
                }
            }
        }
    }
    plugins
}

#[tauri::command]
fn run_plugin(plugin_id: String, csv_path: String) -> Result<AnalysisResult, String> {
    let mut plugins_dir = PathBuf::from("plugins");
    if !plugins_dir.exists() {
        plugins_dir = PathBuf::from("../plugins");
    }
    let plugin_dir = plugins_dir.join(&plugin_id);
    let manifest_path = plugin_dir.join("plugin.json");
    
    let content = fs::read_to_string(&manifest_path).map_err(|e| format!("プラグイン読み込みエラー: {}", e))?;
    let manifest = serde_json::from_str::<PluginManifest>(&content).map_err(|e| format!("マニフェストパースエラー: {}", e))?;
    
    let mut cmd = Command::new(&manifest.command);
    cmd.current_dir(&plugin_dir);
    for arg in &manifest.args {
        cmd.arg(arg);
    }
    cmd.arg(&csv_path);
    
    let output = cmd.output().map_err(|e| format!("プラグイン実行エラー: {}", e))?;
    if output.status.success() {
        let out_str = String::from_utf8_lossy(&output.stdout);
        let result: AnalysisResult = serde_json::from_str(&out_str).map_err(|e| format!("JSONパースエラー: {}\n\n出力:\n{}", e, out_str))?;
        Ok(result)
    } else {
        let err_str = String::from_utf8_lossy(&output.stderr);
        Err(format!("プラグイン内部エラー: {}", err_str))
    }
}

const SAMPLE_SALES: &str = include_str!("../../sample_sales.csv");
const SAMPLE_MASTER: &str = include_str!("../../sample_master.csv");

#[tauri::command]
fn save_sample_csv(path: String, kind: String) -> Result<(), String> {
    let content = if kind == "sales" { SAMPLE_SALES } else { SAMPLE_MASTER };
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![analyze_csv, get_plugins, run_plugin, save_sample_csv])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
