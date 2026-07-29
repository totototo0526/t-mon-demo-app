import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

declare var Chart: any;

interface Rule {
  item_a: string;
  item_b: string;
  support: number;
  confidence: number;
  lift: number;
}

interface AnalysisResult {
  rules: Rule[];
  skipped_rows: number;
  total_rows: number;
}

interface AbcItem {
  item_id: string;
  item_name: string;
  count: number;
  percentage: number;
  cumulative_percentage: number;
  rank: string;
}

interface AbcAnalysisResult {
  items: AbcItem[];
  skipped_rows: number;
  total_rows: number;
}

interface RfmSegment {
  segment_name: string;
  customer_count: number;
  average_monetary: number;
}

interface RfmAnalysisResult {
  segments: RfmSegment[];
  skipped_rows: number;
  total_rows: number;
}

interface TrendItem {
  item_id: string;
  item_name: string;
  recent_amount: number;
  past_amount: number;
  growth_rate: number;
  trend_type: string;
}

interface TrendAnalysisResult {
  items: TrendItem[];
  skipped_rows: number;
  total_rows: number;
}

interface AnomalyItem {
  customer_id: string;
  purchase_date: string;
  amount: number;
  average_amount: number;
  anomaly_type: string;
}

interface AnomalyAnalysisResult {
  items: AnomalyItem[];
  skipped_rows: number;
  total_rows: number;
}

interface ClusterGroup {
  cluster_name: string;
  size: number;
  traits: string;
}

interface ClusterAnalysisResult {
  groups: ClusterGroup[];
  skipped_rows: number;
  total_rows: number;
}
interface PluginManifest {
  id: string;
  name: string;
  command: string;
  args: string[];
}

let analyzeBtn: HTMLButtonElement | null;
let selectMasterBtn: HTMLButtonElement | null;
let selectTargetBtn: HTMLButtonElement | null;
let masterPathInput: HTMLInputElement | null;
let targetPathDisplay: HTMLElement | null;
let presetSelect: HTMLSelectElement | null;
let resultContainer: HTMLElement | null;
let warningContainer: HTMLElement | null;
let sortSelect: HTMLSelectElement | null;

let currentTargetPath: string = "";
let loadedPlugins: PluginManifest[] = [];
let currentRules: Rule[] = [];
let currentAbcItems: AbcItem[] = [];
let currentRfmSegments: RfmSegment[] = [];
let currentTrendItems: TrendItem[] = [];
let currentAnomalyItems: AnomalyItem[] = [];
let currentClusterGroups: ClusterGroup[] = [];
let currentChart: any = null;

function destroyChart() {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }
}

function setChartVisibility(visible: boolean) {
  const chartDetails = document.getElementById("chart-details");
  if (chartDetails) {
    chartDetails.style.display = visible ? "block" : "none";
  }
}

// 印刷用プラグイン
const printBgPlugin = {
  id: 'printBg',
  beforeDraw: (chart: any) => {
    if (chart.config.options.plugins?.printBg?.isPrinting) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  }
};
Chart.register(printBgPlugin);

function setChartTheme(isPrint: boolean) {
  if (!currentChart) return;
  const textColor = isPrint ? '#000000' : '#ffffff';
  const gridColor = isPrint ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)';

  currentChart.options.color = textColor;
  if (currentChart.options.scales) {
    if (currentChart.options.scales.x) {
      currentChart.options.scales.x.ticks.color = textColor;
      currentChart.options.scales.x.grid.color = gridColor;
    }
    if (currentChart.options.scales.y) {
      currentChart.options.scales.y.ticks.color = textColor;
      currentChart.options.scales.y.grid.color = gridColor;
    }
  }
  if (currentChart.options.plugins && currentChart.options.plugins.legend) {
    currentChart.options.plugins.legend.labels.color = textColor;
  }
  
  // フラグをセットしてプラグインに白背景を描画させる
  if (!currentChart.options.plugins) currentChart.options.plugins = {};
  if (!currentChart.options.plugins.printBg) currentChart.options.plugins.printBg = {};
  currentChart.options.plugins.printBg.isPrinting = isPrint;
  
  // アニメーションなしで即時描画
  currentChart.update('none');
}

window.addEventListener("beforeprint", () => setChartTheme(true));
window.addEventListener("afterprint", () => setChartTheme(false));

const CHART_COLORS = {
  blue: 'rgba(54, 162, 235, 0.7)',
  red: 'rgba(255, 99, 132, 0.7)',
  green: 'rgba(75, 192, 192, 0.7)',
  yellow: 'rgba(255, 206, 86, 0.7)',
  purple: 'rgba(153, 102, 255, 0.7)',
  orange: 'rgba(255, 159, 64, 0.7)',
  border: 'rgba(255, 255, 255, 0.2)',
  text: '#ffffff'
};

function getChartContext(): CanvasRenderingContext2D | null {
  const canvas = document.getElementById("summary-chart") as HTMLCanvasElement;
  if (!canvas) return null;
  return canvas.getContext("2d");
}

function drawSimpleBarChart(labels: string[], data: number[], label: string) {
  destroyChart();
  setChartVisibility(true);
  const ctx = getChartContext();
  if (!ctx) return;
  
  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        backgroundColor: CHART_COLORS.blue,
        borderColor: CHART_COLORS.blue,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      color: CHART_COLORS.text,
      scales: {
        x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.border } },
        y: { beginAtZero: true, ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.border } }
      },
      plugins: {
        legend: { labels: { color: CHART_COLORS.text } }
      }
    }
  });
}

function drawComparisonBarChart(labels: string[], data1: number[], label1: string, data2: number[], label2: string) {
  destroyChart();
  setChartVisibility(true);
  const ctx = getChartContext();
  if (!ctx) return;

  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: label1,
          data: data1,
          backgroundColor: CHART_COLORS.blue,
        },
        {
          label: label2,
          data: data2,
          backgroundColor: CHART_COLORS.green,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      color: CHART_COLORS.text,
      scales: {
        x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.border } },
        y: { beginAtZero: true, ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.border } }
      },
      plugins: {
        legend: { labels: { color: CHART_COLORS.text } }
      }
    }
  });
}

function drawDoughnutChart(labels: string[], data: number[]) {
  destroyChart();
  setChartVisibility(true);
  const ctx = getChartContext();
  if (!ctx) return;

  // 各データの割合（%）を計算してラベルに付与する
  const total = data.reduce((a, b) => a + b, 0);
  const labelsWithPercent = labels.map((label, i) => {
    const percent = total > 0 ? ((data[i] / total) * 100).toFixed(1) : "0";
    return `${label} (${percent}%)`;
  });

  currentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labelsWithPercent,
      datasets: [{
        data: data,
        backgroundColor: [
          CHART_COLORS.red, CHART_COLORS.blue, CHART_COLORS.yellow, CHART_COLORS.green, CHART_COLORS.purple, CHART_COLORS.orange
        ],
        borderColor: '#2d3748',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      color: CHART_COLORS.text,
      plugins: {
        legend: { position: 'right', labels: { color: CHART_COLORS.text } }
      }
    }
  });
}

// テンプレートエンジン（JSON -> 自然言語カンペ変換）
function generateKanpe(rule: Rule, preset: string): string {
  const confPercent = (rule.confidence * 100).toFixed(0);
  
  if (preset === "sales") {
    return `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #10b981;">🎯 アクション:</span><br>
        <strong>${rule.item_a}</strong> をお買い上げのお客様に、<strong>${rule.item_b}</strong> もご提案してください。
      </div>
      <div style="font-size: 0.9rem; color: #cbd5e1; background: rgba(255,255,255,0.05); padding: 0.5rem; border-radius: 4px;">
        <span style="font-weight: bold;">💡 なぜ？（解説）</span><br>
        過去のデータ上、${rule.item_a} を買ったお客様の <strong>${confPercent}%</strong> が ${rule.item_b} もセットで購入しているため、非常に刺さりやすい提案です。
      </div>
    `;
  } else if (preset === "warehouse") {
    return `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #3b82f6;">🎯 アクション:</span><br>
        <strong>${rule.item_a}</strong> と <strong>${rule.item_b}</strong> は隣接した棚に配置してください。
      </div>
      <div style="font-size: 0.9rem; color: #cbd5e1; background: rgba(255,255,255,0.05); padding: 0.5rem; border-radius: 4px;">
        <span style="font-weight: bold;">💡 なぜ？（解説）</span><br>
        これら2つの商品は、同時に出荷される確率が <strong>${confPercent}%</strong> と高いため、ピッキング動線を大幅に短縮できます。
      </div>
    `;
  } else if (preset.startsWith("plugin:")) {
    return `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #a855f7;">✨ アドオンからのアクション:</span><br>
        <strong>${rule.item_a}</strong> の場合、<strong>${rule.item_b}</strong>
      </div>
      <div style="font-size: 0.9rem; color: #cbd5e1; background: rgba(255,255,255,0.05); padding: 0.5rem; border-radius: 4px;">
        <span style="font-weight: bold;">💡 なぜ？（解説）</span><br>
        外部モジュール（Python等）の推論結果（確度: <strong>${confPercent}%</strong>）
      </div>
    `;
  }
  
  return `相関関係を発見: ${rule.item_a} と ${rule.item_b}`;
}

// カンペカードの描画
function renderCards(rules: Rule[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  const preset = presetSelect?.value || "sales";

  if (rules.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  if (preset === "sales") {
    // 棒グラフ（同時購入数トップ10）
    const topRules = rules.slice(0, 10);
    drawSimpleBarChart(
      topRules.map(r => `${r.item_a} + ${r.item_b}`),
      topRules.map(r => r.support),
      "同時購入数 (回)"
    );
  } else {
    setChartVisibility(false);
  }

  rules.forEach((rule, index) => {
    const card = document.createElement("div");
    const isHighConfidence = rule.confidence >= 0.8;
    card.className = `kanpe-card ${isHighConfidence ? 'high-confidence' : ''}`;
    card.style.animationDelay = `${index * 0.1}s`;

    const kanpeText = generateKanpe(rule, preset);
    card.innerHTML = `
      <p>${kanpeText}</p>
      <div class="meta">
        <span class="badge" title="この組み合わせで同時に買われた回数">🎯 同時購入: ${rule.support}件</span>
        <span class="badge" title="単独で買うより何倍売れやすいか">📈 併売効果: ${rule.lift.toFixed(2)}倍</span>
      </div>
    `;
    if (resultContainer) {
      resultContainer.appendChild(card);
    }
  });
}

function renderAbcCards(items: AbcItem[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  if (items.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  // 棒グラフ（売上/頻度 トップ10）
  const topItems = items.slice(0, 10);
  drawSimpleBarChart(
    topItems.map(i => i.item_name),
    topItems.map(i => i.count),
    "売上/販売回数"
  );

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `kanpe-card`;
    card.style.animationDelay = `${(index * 0.05).toFixed(2)}s`;

    let advice = "";
    let rankClass = "";
    let icon = "";
    if (item.rank === "A") {
      advice = "売上の大黒柱です。絶対に欠品させないよう在庫を厚めに持ち、目立つ場所に陳列しましょう。";
      rankClass = "rank-a";
      icon = "🔥";
    } else if (item.rank === "B") {
      advice = "安定した売れ筋です。定期的な発注と、Aランク商品のついで買いを狙った陳列を検討しましょう。";
      rankClass = "rank-b";
      icon = "👍";
    } else {
      advice = "売上貢献が低いです。売り場からの撤去や、セット販売への切り替えを検討しましょう。";
      rankClass = "rank-c";
      icon = "⚠️";
    }

    card.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #3b82f6;">${icon} ランク${item.rank}: ${item.item_name}</span><br>
        <strong>🎯 アクション:</strong> ${advice}
      </div>
      <div class="meta">
        <span class="badge ${rankClass}">ランク ${item.rank}</span>
        <span class="badge">数量: ${item.count}件</span>
        <span class="badge">構成比: ${item.percentage.toFixed(1)}%</span>
        <span class="badge">累積構成比: ${item.cumulative_percentage.toFixed(1)}%</span>
      </div>
    `;
    if (resultContainer) {
      resultContainer.appendChild(card);
    }
  });
}

function renderRfmCards(segments: RfmSegment[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  if (segments.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  // ドーナツグラフ（セグメント構成比）
  drawDoughnutChart(
    segments.map(s => s.segment_name),
    segments.map(s => s.customer_count)
  );

  segments.forEach((segment, index) => {
    const card = document.createElement("div");
    card.className = `kanpe-card`;
    card.style.animationDelay = `${(index * 0.05).toFixed(2)}s`;

    let advice = "";
    let rankClass = "";
    let icon = "";
    if (segment.segment_name.includes("優良")) {
      advice = "売上の中心となる層です。特別優待や新商品の先行案内を実施し、ロイヤルティを高めましょう。";
      rankClass = "rank-a";
      icon = "👑";
    } else if (segment.segment_name.includes("安定")) {
      advice = "定期的に購入してくれている層です。クロスセル提案等でさらなる単価アップを狙いましょう。";
      rankClass = "rank-b";
      icon = "👍";
    } else if (segment.segment_name.includes("離反")) {
      advice = "最近足が遠のいています。引き戻し用のクーポンやDMを送り、再来店を促しましょう。";
      rankClass = "rank-c";
      icon = "⚠️";
    } else {
      advice = "長期間購入がない層です。コストをかけすぎず、一斉メール等での掘り起こしに留めましょう。";
      rankClass = "rank-c";
      icon = "💤";
    }

    card.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #8b5cf6;">${icon} ${segment.segment_name}</span><br>
        <strong>🎯 アクション:</strong> ${advice}
      </div>
      <div class="meta">
        <span class="badge ${rankClass}">顧客数: ${segment.customer_count}人</span>
        <span class="badge">平均購入金額: ${Math.round(segment.average_monetary).toLocaleString()}円</span>
      </div>
    `;
    if (resultContainer) {
      resultContainer.appendChild(card);
    }
  });
}

function renderTrendCards(items: TrendItem[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  if (items.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  // 比較棒グラフ（過去 vs 直近）※成長率上位トップ5
  const topTrends = items.slice(0, 5);
  drawComparisonBarChart(
    topTrends.map(i => i.item_name),
    topTrends.map(i => i.past_amount),
    "過去の売上",
    topTrends.map(i => i.recent_amount),
    "直近の売上"
  );

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `kanpe-card`;
    card.style.animationDelay = `${(index * 0.05).toFixed(2)}s`;

    let advice = "";
    let rankClass = "";
    let icon = "";
    let label = "";

    if (item.trend_type === "up") {
      advice = "直近で売上が急増しています！在庫を積み増し、目立つ場所に展開して機会損失を防ぎましょう。";
      rankClass = "rank-a";
      icon = "🔥";
      label = "急上昇トレンド";
    } else if (item.trend_type === "down") {
      advice = "売上が落ち込んでいます。季節要因でない場合は、陳列スペースを縮小するか、テコ入れの販促を検討しましょう。";
      rankClass = "rank-c";
      icon = "⚠️";
      label = "下降トレンド";
    } else {
      advice = "安定して売れています。現在の発注ペースと売り場を維持しましょう。";
      rankClass = "rank-b";
      icon = "📈";
      label = "安定・微増";
    }

    const growthPercent = (item.growth_rate * 100).toFixed(1);
    const sign = item.growth_rate > 0 ? "+" : "";

    card.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #10b981;">${icon} ${label}: ${item.item_name}</span><br>
        <strong>🎯 アクション:</strong> ${advice}
      </div>
      <div class="meta">
        <span class="badge ${rankClass}">成長率: ${sign}${growthPercent}%</span>
        <span class="badge">直近: ${item.recent_amount}</span>
        <span class="badge">過去: ${item.past_amount}</span>
      </div>
    `;
    if (resultContainer) {
      resultContainer.appendChild(card);
    }
  });
}

function renderAnomalyCards(items: AnomalyItem[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  if (items.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  // 比較棒グラフ（平均 vs 今回）トップ5
  const topAnomalies = items.slice(0, 5);
  drawComparisonBarChart(
    topAnomalies.map(i => `顧客 ${i.customer_id}`),
    topAnomalies.map(i => i.average_amount),
    "平均注文量",
    topAnomalies.map(i => i.amount),
    "今回の注文量"
  );

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `kanpe-card`;
    card.style.animationDelay = `${(index * 0.05).toFixed(2)}s`;

    let advice = "";
    let rankClass = "";
    let icon = "";
    let label = "";

    if (item.anomaly_type === "over") {
      advice = "普段の5倍以上の注文です。桁間違いの可能性があるため、発送前に確認の電話を入れましょう。";
      rankClass = "rank-a";
      icon = "⚠️";
      label = "過大発注の疑い";
    } else {
      advice = "普段の10%以下の極端に少ない注文です。他社製品へ乗り換えた可能性があるため、早急にヒアリングを行いましょう。";
      rankClass = "rank-c";
      icon = "📉";
      label = "過少発注（離反兆候）";
    }

    card.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #10b981;">${icon} ${label}: 顧客 ${item.customer_id}</span><br>
        <strong>🎯 アクション:</strong> ${advice}
      </div>
      <div class="meta">
        <span class="badge ${rankClass}">今回注文: ${item.amount}</span>
        <span class="badge">平均注文: ${item.average_amount.toFixed(1)}</span>
        <span class="badge">日付: ${item.purchase_date}</span>
      </div>
    `;
    resultContainer?.appendChild(card);
  });
}

function renderClusterCards(groups: ClusterGroup[]) {
  if (!resultContainer) return;
  resultContainer.innerHTML = "";

  if (groups.length === 0) {
    resultContainer.innerHTML = `<div class="empty-state">分析結果が見つかりませんでした。</div>`;
    setChartVisibility(false);
    return;
  }

  // ドーナツグラフ（クラスターボリューム）
  drawDoughnutChart(
    groups.map(g => g.cluster_name),
    groups.map(g => g.size)
  );

  groups.forEach((group, index) => {
    const card = document.createElement("div");
    card.className = `kanpe-card`;
    card.style.animationDelay = `${(index * 0.05).toFixed(2)}s`;

    card.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <span style="font-size: 1.1rem; font-weight: bold; color: #10b981;">🎯 クラスター: ${group.cluster_name}</span><br>
        <strong>🎯 アクション:</strong> ${group.traits}
      </div>
      <div class="meta">
        <span class="badge rank-a">ボリューム: ${group.size}人</span>
      </div>
    `;
    resultContainer?.appendChild(card);
  });
}

// マスターCSVを選択
async function selectMaster() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (selected && typeof selected === 'string') {
    if (masterPathInput) masterPathInput.value = selected;
  } else if (selected && typeof selected === 'object' && 'path' in selected) {
    if (masterPathInput) masterPathInput.value = (selected as any).path;
  }
}

// 対象CSVを選択
async function selectTarget() {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  
  let path = "";
  if (selected && typeof selected === 'string') {
    path = selected;
  } else if (selected && typeof selected === 'object' && 'path' in selected) {
    path = (selected as any).path;
  }

  if (path) {
    currentTargetPath = path;
    if (targetPathDisplay) targetPathDisplay.textContent = `選択中: ${path}`;
    analyze(false);
  }
}

// ソート適用と再描画
function applySortAndRender() {
  const preset = presetSelect?.value || "sales";
    if (preset === "sales" || preset === "warehouse") {
      if (sortSelect && sortSelect.parentElement) sortSelect.parentElement.style.display = "flex";
    } else {
      if (sortSelect && sortSelect.parentElement) sortSelect.parentElement.style.display = "none";
    }

  if (preset === "abc") {
    renderAbcCards(currentAbcItems);
    return;
  } else if (preset === "rfm") {
    renderRfmCards(currentRfmSegments);
    return;
  } else if (preset === "trend") {
    renderTrendCards(currentTrendItems);
    return;
  } else if (preset === "anomaly") {
    renderAnomalyCards(currentAnomalyItems);
    return;
  } else if (preset === "cluster") {
    renderClusterCards(currentClusterGroups);
    return;
  }

  const sortBy = sortSelect?.value || "support";
  const sortedRules = [...currentRules].sort((a, b) => {
    if (sortBy === "lift") {
      return b.lift - a.lift;
    } else {
      return b.support - a.support;
    }
  });
  renderCards(sortedRules);
}

// 分析実行
async function analyze(isSample: boolean = false) {
  if (resultContainer) {
    resultContainer.innerHTML = `<div class="empty-state">分析中... AIより速く計算しています...</div>`;
    if (warningContainer) warningContainer.style.display = "none";
    
    try {
      const presetValue = presetSelect?.value || "";
      let path = currentTargetPath;
      let masterPath = masterPathInput?.value || null;

      if (isSample) {
        try {
          const paths: [string, string, string, string, string, string] = await invoke("get_sample_paths");
          if (presetValue === "rfm") {
            path = paths[2];
          } else if (presetValue === "trend") {
            path = paths[3];
          } else if (presetValue === "anomaly") {
            path = paths[4];
          } else if (presetValue === "cluster") {
            path = paths[5];
          } else {
            path = paths[0];
          }
          masterPath = paths[1];
        } catch (e) {
          resultContainer.innerHTML = `<div class="empty-state" style="color: #ef4444;">サンプルデータの準備に失敗しました: ${e}</div>`;
          return;
        }
      }

      if (!path) {
        resultContainer.innerHTML = `<div class="empty-state">対象のCSVファイルを選択してください。</div>`;
        return;
      }
      
      let skipped = 0;
      let total = 0;

      if (presetValue === "abc") {
        const result: AbcAnalysisResult = await invoke("analyze_abc", {
          path: path,
          masterPath: masterPath,
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentAbcItems = result.items;
      } else if (presetValue === "rfm") {
        const result: RfmAnalysisResult = await invoke("analyze_rfm", {
          path: path,
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentRfmSegments = result.segments;
      } else if (presetValue === "trend") {
        const result: TrendAnalysisResult = await invoke("analyze_trend", {
          path: path,
          masterPath: masterPath,
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentTrendItems = result.items;
      } else if (presetValue === "anomaly") {
        const result: AnomalyAnalysisResult = await invoke("analyze_anomaly", {
          path: path
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentAnomalyItems = result.items;
      } else if (presetValue === "cluster") {
        const result: ClusterAnalysisResult = await invoke("analyze_cluster", {
          path: path
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentClusterGroups = result.groups;
      } else if (presetValue.startsWith("plugin:")) {
        const pluginId = presetValue.replace("plugin:", "");
        const result: AnalysisResult = await invoke("run_plugin", {
          pluginId: pluginId,
          csvPath: path,
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentRules = result.rules;
      } else {
        const result: AnalysisResult = await invoke("analyze_csv", {
          path: path,
          masterPath: masterPath,
        });
        skipped = result.skipped_rows;
        total = result.total_rows;
        currentRules = result.rules;
      }

      if (warningContainer) {
        if (skipped > 0) {
          warningContainer.style.display = "block";
          warningContainer.innerHTML = `<strong>⚠️ 警告:</strong> 全 ${total} 行中、フォーマット異常等で <strong>${skipped}行</strong> をスキップして計算しました。`;
        } else {
          warningContainer.style.display = "none";
        }
      }

      applySortAndRender();
    } catch (e) {
      resultContainer.innerHTML = `<div class="empty-state" style="color: #ef4444;">エラーが発生しました: ${e}</div>`;
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  analyzeBtn = document.querySelector("#analyze-btn");
  selectMasterBtn = document.querySelector("#select-master-btn");
  selectTargetBtn = document.querySelector("#select-target-btn");
  masterPathInput = document.querySelector("#master-path-input");
  targetPathDisplay = document.querySelector("#target-path-display");
  presetSelect = document.querySelector("#preset-select");
  resultContainer = document.querySelector("#result-container");
  warningContainer = document.querySelector("#warning-container");
  sortSelect = document.querySelector("#sort-select");

  try {
    loadedPlugins = await invoke("get_plugins");
    if (presetSelect && loadedPlugins.length > 0) {
      const optGroup = document.createElement("optgroup");
      optGroup.label = "拡張プラグイン（外部スクリプト）";
      
      loadedPlugins.forEach(p => {
        const opt = document.createElement("option");
        opt.value = "plugin:" + p.id;
        opt.textContent = p.name;
        optGroup.appendChild(opt);
      });
      presetSelect.appendChild(optGroup);
    }
  } catch (e) {
    console.error("Failed to load plugins:", e);
  }

  analyzeBtn?.addEventListener("click", () => analyze(true));
  selectMasterBtn?.addEventListener("click", selectMaster);
  selectTargetBtn?.addEventListener("click", selectTarget);
  
  presetSelect?.addEventListener("change", () => {
    if (resultContainer?.children.length && !resultContainer.querySelector('.empty-state')) {
      analyze(currentTargetPath === "");
    }
  });
  
  sortSelect?.addEventListener("change", () => {
    applySortAndRender();
  });

  document.getElementById("download-template-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      // 売上データ
      const salesPath = await save({
        title: '分析対象CSV（売上データ）のサンプルを保存',
        defaultPath: 'sample_sales.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (salesPath) {
        await invoke("save_sample_csv", { path: salesPath, kind: "sales" });
      }

      // マスターデータ
      const masterPath = await save({
        title: '商品マスターCSVのサンプルを保存',
        defaultPath: 'sample_master.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (masterPath) {
        await invoke("save_sample_csv", { path: masterPath, kind: "master" });
      }

      // RFMデータ
      const rfmPath = await save({
        title: 'RFM分析用CSVのサンプルを保存',
        defaultPath: 'sample_rfm.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (rfmPath) {
        await invoke("save_sample_csv", { path: rfmPath, kind: "rfm" });
      }

      // トレンドデータ
      const trendPath = await save({
        title: 'トレンド分析用CSVのサンプルを保存',
        defaultPath: 'sample_trend.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (trendPath) {
        await invoke("save_sample_csv", { path: trendPath, kind: "trend" });
      }

      // 異常検知データ
      const anomalyPath = await save({
        title: '異常検知用CSVのサンプルを保存',
        defaultPath: 'sample_anomaly.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (anomalyPath) {
        await invoke("save_sample_csv", { path: anomalyPath, kind: "anomaly" });
      }

      // クラスタリングデータ
      const clusterPath = await save({
        title: 'クラスタリング用CSVのサンプルを保存',
        defaultPath: 'sample_cluster.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (clusterPath) {
        await invoke("save_sample_csv", { path: clusterPath, kind: "cluster" });
      }

      if (salesPath || masterPath || rfmPath || trendPath || anomalyPath || clusterPath) {
        alert("サンプルのCSVファイルを保存しました！");
      }
    } catch (err) {
      alert("保存に失敗しました: " + err);
    }
  });

  // 印刷（PDF出力）ボタン - グラフあり
  document.querySelector("#print-with-graph-btn")?.addEventListener("click", () => {
    const details = document.getElementById("chart-details") as HTMLDetailsElement;
    if (details) details.open = true;
    
    document.body.classList.remove("hide-chart-for-print");

    const canvas = document.getElementById("summary-chart") as HTMLCanvasElement;
    let img: HTMLImageElement | null = null;

    if (canvas && currentChart) {
      // 元のサイズを退避
      const origWidth = canvas.style.width;
      const origHeight = canvas.style.height;

      // 印刷用に見栄えのする高解像度（アスペクト比2:1）に強制リサイズ
      currentChart.resize(900, 450);

      // 印刷用テーマ（文字黒・背景白）に切り替え
      setChartTheme(true);

      // WebKitのcanvas印刷真っ黒バグを確実に回避するため、白背景のテンポラリCanvasを作成して画像化する
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const ctx = tempCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(canvas, 0, 0);
      }

      img = document.createElement("img");
      img.id = "print-chart-img";
      img.src = tempCanvas.toDataURL("image/png");
      img.style.maxWidth = "800px";
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.margin = "0 auto";
      img.style.display = "block";
      
      canvas.style.display = "none";
      canvas.parentElement?.appendChild(img);

      // 少し待ってから印刷（画像のレンダリング待ち）
      setTimeout(() => {
        window.print();
        
        // 印刷が終わったら元に戻す
        if (img) img.remove();
        if (canvas) {
          canvas.style.display = "block";
          canvas.style.width = origWidth;
          canvas.style.height = origHeight;
          currentChart.resize();
        }
        setChartTheme(false);
      }, 100);
    } else {
      window.print();
    }
  });

  // 印刷（PDF出力）ボタン - グラフなし（カンペのみ）
  document.querySelector("#print-no-graph-btn")?.addEventListener("click", () => {
    document.body.classList.add("hide-chart-for-print");
    window.print();
    // 印刷ダイアログを閉じた後にクラスを戻す (setTimeoutで遅延実行)
    setTimeout(() => {
      document.body.classList.remove("hide-chart-for-print");
    }, 1000);
  });
});
