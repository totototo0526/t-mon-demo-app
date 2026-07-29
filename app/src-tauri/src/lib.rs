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

#[derive(Debug, Serialize, Deserialize)]
struct AbcItem {
    item_id: String,
    item_name: String,
    count: usize,
    percentage: f64,
    cumulative_percentage: f64,
    rank: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AbcAnalysisResult {
    items: Vec<AbcItem>,
    skipped_rows: usize,
    total_rows: usize,
}

#[derive(Debug, Deserialize)]
struct RfmRow {
    customer_id: String,
    purchase_date: String,
    amount: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RfmSegment {
    segment_name: String,
    customer_count: usize,
    average_monetary: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct RfmAnalysisResult {
    segments: Vec<RfmSegment>,
    skipped_rows: usize,
    total_rows: usize,
}

#[derive(Debug, Deserialize)]
struct TrendRow {
    purchase_date: String,
    item_id: String,
    amount: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct TrendItem {
    item_id: String,
    item_name: String,
    recent_amount: f64,
    past_amount: f64,
    growth_rate: f64, // (recent - past) / past
    trend_type: String, // "up", "stable", "down"
}

#[derive(Debug, Serialize, Deserialize)]
struct TrendAnalysisResult {
    items: Vec<TrendItem>,
    skipped_rows: usize,
    total_rows: usize,
}
#[derive(Debug, Deserialize)]
struct AnomalyRow {
    customer_id: String,
    purchase_date: String,
    amount: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnomalyItem {
    customer_id: String,
    purchase_date: String,
    amount: f64,
    average_amount: f64,
    anomaly_type: String, // "over", "under"
}

#[derive(Debug, Serialize, Deserialize)]
struct AnomalyAnalysisResult {
    items: Vec<AnomalyItem>,
    skipped_rows: usize,
    total_rows: usize,
}

#[derive(Debug, Deserialize)]
struct ClusterRow {
    customer_id: String,
    age: u8,
    region: String,
    industry: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClusterGroup {
    cluster_name: String,
    size: usize,
    traits: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClusterAnalysisResult {
    groups: Vec<ClusterGroup>,
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

#[tauri::command]
fn analyze_abc(path: String, master_path: Option<String>) -> Result<AbcAnalysisResult, String> {
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

    let mut item_counts: HashMap<String, usize> = HashMap::new();
    let mut skipped_rows = 0;
    let mut total_rows = 0;

    for result in rdr.deserialize() {
        total_rows += 1;
        match result {
            Ok(record) => {
                let CsvRow { item_id, .. } = record;
                *item_counts.entry(item_id).or_insert(0) += 1;
            },
            Err(_) => {
                skipped_rows += 1;
            }
        }
    }

    let mut items_vec: Vec<(String, usize)> = item_counts.into_iter().collect();
    // 降順ソート
    items_vec.sort_by(|a, b| b.1.cmp(&a.1));

    let total_count: usize = items_vec.iter().map(|x| x.1).sum();
    let total_count_f64 = total_count as f64;

    let mut cumulative_count = 0;
    let mut abc_items = Vec::new();

    for (item_id, count) in items_vec {
        cumulative_count += count;
        let percentage = (count as f64 / total_count_f64) * 100.0;
        let cumulative_percentage = (cumulative_count as f64 / total_count_f64) * 100.0;
        
        let rank = if cumulative_percentage <= 70.0 {
            "A"
        } else if cumulative_percentage <= 90.0 {
            "B"
        } else {
            "C"
        };

        abc_items.push(AbcItem {
            item_id: item_id.clone(),
            item_name: get_name(&item_id),
            count,
            percentage,
            cumulative_percentage,
            rank: rank.to_string(),
        });
    }

    Ok(AbcAnalysisResult {
        items: abc_items,
        skipped_rows,
        total_rows,
    })
}

#[derive(Debug)]
struct CustomerAgg {
    id: String,
    max_date: String,
    frequency: usize,
    monetary: f64,
    r_score: usize,
    f_score: usize,
    m_score: usize,
}

#[tauri::command]
fn analyze_rfm(path: String) -> Result<RfmAnalysisResult, String> {
    let file = File::open(&path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut rdr = csv::Reader::from_reader(file);

    let mut agg_map: HashMap<String, CustomerAgg> = HashMap::new();
    let mut skipped_rows = 0;
    let mut total_rows = 0;

    for result in rdr.deserialize() {
        total_rows += 1;
        match result {
            Ok(record) => {
                let row: RfmRow = record;
                let entry = agg_map.entry(row.customer_id.clone()).or_insert(CustomerAgg {
                    id: row.customer_id,
                    max_date: "".to_string(),
                    frequency: 0,
                    monetary: 0.0,
                    r_score: 0,
                    f_score: 0,
                    m_score: 0,
                });
                if row.purchase_date > entry.max_date {
                    entry.max_date = row.purchase_date;
                }
                entry.frequency += 1;
                entry.monetary += row.amount;
            },
            Err(_) => {
                skipped_rows += 1;
            }
        }
    }

    let mut customers: Vec<CustomerAgg> = agg_map.into_values().collect();
    if customers.is_empty() {
        return Ok(RfmAnalysisResult { segments: vec![], skipped_rows, total_rows });
    }

    let len = customers.len();
    let t1 = len / 3;
    let t2 = (len * 2) / 3;

    // R-Score
    customers.sort_by(|a, b| b.max_date.cmp(&a.max_date));
    for (i, c) in customers.iter_mut().enumerate() {
        c.r_score = if i < t1 { 3 } else if i < t2 { 2 } else { 1 };
    }

    // F-Score
    customers.sort_by(|a, b| b.frequency.cmp(&a.frequency));
    for (i, c) in customers.iter_mut().enumerate() {
        c.f_score = if i < t1 { 3 } else if i < t2 { 2 } else { 1 };
    }

    // M-Score
    customers.sort_by(|a, b| b.monetary.partial_cmp(&a.monetary).unwrap_or(std::cmp::Ordering::Equal));
    for (i, c) in customers.iter_mut().enumerate() {
        c.m_score = if i < t1 { 3 } else if i < t2 { 2 } else { 1 };
    }

    let mut segments = HashMap::new();

    for c in customers {
        let total_score = c.r_score + c.f_score + c.m_score;
        let segment_name = if total_score >= 8 {
            "優良顧客 (Loyal)"
        } else if total_score >= 6 {
            "安定顧客 (Stable)"
        } else if total_score >= 4 {
            "離反注意 (At Risk)"
        } else {
            "休眠顧客 (Hibernating)"
        };

        let entry = segments.entry(segment_name.to_string()).or_insert((0usize, 0.0f64));
        entry.0 += 1;
        entry.1 += c.monetary;
    }

    let mut result_segments = Vec::new();
    for (name, (count, total_monetary)) in segments {
        result_segments.push(RfmSegment {
            segment_name: name,
            customer_count: count,
            average_monetary: if count > 0 { total_monetary / count as f64 } else { 0.0 },
        });
    }

    // Sort by average monetary descending
    result_segments.sort_by(|a, b| b.average_monetary.partial_cmp(&a.average_monetary).unwrap_or(std::cmp::Ordering::Equal));

    Ok(RfmAnalysisResult {
        segments: result_segments,
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
#[tauri::command]
fn analyze_trend(path: String, master_path: Option<String>) -> Result<TrendAnalysisResult, String> {
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

    let mut rows: Vec<TrendRow> = Vec::new();
    let mut skipped = 0;
    let mut total = 0;

    for result in rdr.deserialize() {
        total += 1;
        match result {
            Ok(row) => rows.push(row),
            Err(_) => {
                skipped += 1;
            }
        }
    }

    if rows.is_empty() {
        return Ok(TrendAnalysisResult {
            items: vec![],
            skipped_rows: skipped,
            total_rows: total,
        });
    }

    rows.sort_by(|a, b| a.purchase_date.cmp(&b.purchase_date));
    
    let mid = rows.len() / 2;
    let past_rows = &rows[0..mid];
    let recent_rows = &rows[mid..];

    let mut past_amounts: HashMap<String, f64> = HashMap::new();
    for r in past_rows {
        *past_amounts.entry(r.item_id.clone()).or_insert(0.0) += r.amount;
    }

    let mut recent_amounts: HashMap<String, f64> = HashMap::new();
    for r in recent_rows {
        *recent_amounts.entry(r.item_id.clone()).or_insert(0.0) += r.amount;
    }

    let mut all_items: HashSet<String> = HashSet::new();
    for id in past_amounts.keys() { all_items.insert(id.clone()); }
    for id in recent_amounts.keys() { all_items.insert(id.clone()); }

    let mut items: Vec<TrendItem> = Vec::new();
    for item_id in all_items {
        let past = *past_amounts.get(&item_id).unwrap_or(&0.0);
        let recent = *recent_amounts.get(&item_id).unwrap_or(&0.0);
        
        let growth_rate = if past > 0.0 {
            (recent - past) / past
        } else if recent > 0.0 {
            1.0
        } else {
            0.0
        };

        let trend_type = if growth_rate > 0.1 {
            "up".to_string()
        } else if growth_rate < -0.1 {
            "down".to_string()
        } else {
            "stable".to_string()
        };

        items.push(TrendItem {
            item_id: item_id.clone(),
            item_name: get_name(&item_id),
            recent_amount: recent,
            past_amount: past,
            growth_rate,
            trend_type,
        });
    }

    items.sort_by(|a, b| b.growth_rate.partial_cmp(&a.growth_rate).unwrap_or(std::cmp::Ordering::Equal));

    Ok(TrendAnalysisResult {
        items,
        skipped_rows: skipped,
        total_rows: total,
    })
}

#[tauri::command]
fn analyze_anomaly(path: String) -> Result<AnomalyAnalysisResult, String> {
    let file = File::open(&path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut rdr = csv::Reader::from_reader(file);

    let mut rows: Vec<AnomalyRow> = Vec::new();
    let mut skipped = 0;
    let mut total = 0;

    for result in rdr.deserialize() {
        total += 1;
        match result {
            Ok(row) => rows.push(row),
            Err(_) => { skipped += 1; }
        }
    }

    let mut sums: HashMap<String, f64> = HashMap::new();
    let mut counts: HashMap<String, f64> = HashMap::new();
    
    for r in &rows {
        *sums.entry(r.customer_id.clone()).or_insert(0.0) += r.amount;
        *counts.entry(r.customer_id.clone()).or_insert(0.0) += 1.0;
    }

    let mut averages: HashMap<String, f64> = HashMap::new();
    for (id, sum) in sums {
        let count = counts.get(&id).unwrap();
        averages.insert(id, sum / count);
    }

    let mut items = Vec::new();
    for r in rows {
        if let Some(&avg) = averages.get(&r.customer_id) {
            if avg > 0.0 {
                if r.amount >= avg * 5.0 {
                    items.push(AnomalyItem {
                        customer_id: r.customer_id.clone(),
                        purchase_date: r.purchase_date.clone(),
                        amount: r.amount,
                        average_amount: avg,
                        anomaly_type: "over".to_string(),
                    });
                } else if r.amount <= avg * 0.1 {
                    items.push(AnomalyItem {
                        customer_id: r.customer_id.clone(),
                        purchase_date: r.purchase_date.clone(),
                        amount: r.amount,
                        average_amount: avg,
                        anomaly_type: "under".to_string(),
                    });
                }
            }
        }
    }

    // 最新の異常から表示
    items.sort_by(|a, b| b.purchase_date.cmp(&a.purchase_date));

    Ok(AnomalyAnalysisResult {
        items,
        skipped_rows: skipped,
        total_rows: total,
    })
}

#[tauri::command]
fn analyze_cluster(path: String) -> Result<ClusterAnalysisResult, String> {
    let file = File::open(&path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let mut rdr = csv::Reader::from_reader(file);

    let mut rows: Vec<ClusterRow> = Vec::new();
    let mut skipped = 0;
    let mut total = 0;

    for result in rdr.deserialize() {
        total += 1;
        match result {
            Ok(row) => rows.push(row),
            Err(_) => { skipped += 1; }
        }
    }

    let mut clusters: HashMap<String, usize> = HashMap::new();
    for r in &rows {
        let age_group = if r.age < 30 { "若年層" } else if r.age < 50 { "ミドル層" } else { "シニア層" };
        let key = format!("{}・{}", r.region, age_group);
        *clusters.entry(key).or_insert(0) += 1;
    }

    let mut groups = Vec::new();
    for (name, size) in clusters {
        let traits = if name.contains("若年層") {
            "最新トレンドに敏感です。SNSでの短期キャンペーン告知が有効です📱".to_string()
        } else if name.contains("シニア層") {
            "単価が高くリピート率が安定しています。カタログやDMでの丁寧なアプローチを続けましょう📮".to_string()
        } else {
            "中核となる顧客層です。定期的なメルマガと、定番商品のセット提案が有効です✉️".to_string()
        };
        
        groups.push(ClusterGroup {
            cluster_name: name,
            size,
            traits,
        });
    }

    // 大きいクラスター順
    groups.sort_by(|a, b| b.size.cmp(&a.size));

    Ok(ClusterAnalysisResult {
        groups,
        skipped_rows: skipped,
        total_rows: total,
    })
}
const SAMPLE_SALES: &str = include_str!("../../sample_sales.csv");
const SAMPLE_MASTER: &str = include_str!("../../sample_master.csv");
const SAMPLE_RFM: &str = include_str!("../sample_rfm.csv");
const SAMPLE_TREND: &str = include_str!("../sample_trend.csv");
const SAMPLE_ANOMALY: &str = include_str!("../sample_anomaly.csv");
const SAMPLE_CLUSTER: &str = include_str!("../sample_cluster.csv");

#[tauri::command]
fn save_sample_csv(path: String, kind: String) -> Result<(), String> {
    let content = match kind.as_str() {
        "sales" => SAMPLE_SALES,
        "master" => SAMPLE_MASTER,
        "rfm" => SAMPLE_RFM,
        "trend" => SAMPLE_TREND,
        "anomaly" => SAMPLE_ANOMALY,
        "cluster" => SAMPLE_CLUSTER,
        _ => SAMPLE_SALES,
    };
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_sample_paths() -> Result<(String, String, String, String, String, String), String> {
    let temp_dir = std::env::temp_dir();
    let sales_path = temp_dir.join("sample_sales.csv");
    let master_path = temp_dir.join("sample_master.csv");
    let rfm_path = temp_dir.join("sample_rfm.csv");
    let trend_path = temp_dir.join("sample_trend.csv");
    let anomaly_path = temp_dir.join("sample_anomaly.csv");
    let cluster_path = temp_dir.join("sample_cluster.csv");

    std::fs::write(&sales_path, SAMPLE_SALES).map_err(|e| e.to_string())?;
    std::fs::write(&master_path, SAMPLE_MASTER).map_err(|e| e.to_string())?;
    std::fs::write(&rfm_path, SAMPLE_RFM).map_err(|e| e.to_string())?;
    std::fs::write(&trend_path, SAMPLE_TREND).map_err(|e| e.to_string())?;
    std::fs::write(&anomaly_path, SAMPLE_ANOMALY).map_err(|e| e.to_string())?;
    std::fs::write(&cluster_path, SAMPLE_CLUSTER).map_err(|e| e.to_string())?;

    Ok((
        sales_path.to_string_lossy().to_string(),
        master_path.to_string_lossy().to_string(),
        rfm_path.to_string_lossy().to_string(),
        trend_path.to_string_lossy().to_string(),
        anomaly_path.to_string_lossy().to_string(),
        cluster_path.to_string_lossy().to_string(),
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![analyze_csv, analyze_abc, analyze_rfm, analyze_trend, analyze_anomaly, analyze_cluster, get_plugins, run_plugin, save_sample_csv, get_sample_paths])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
