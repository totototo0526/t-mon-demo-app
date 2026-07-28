import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
let emptyState: HTMLElement | null;

let currentTargetPath: string = "";
let loadedPlugins: PluginManifest[] = [];

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
    return;
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
        <span class="badge">Support: ${rule.support}</span>
        <span class="badge">Lift: ${rule.lift.toFixed(2)}</span>
      </div>
    `;
    resultContainer.appendChild(card);
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

// 分析実行
async function analyze(isSample: boolean = false) {
  if (resultContainer) {
    resultContainer.innerHTML = `<div class="empty-state">分析中... AIより速く計算しています...</div>`;
    if (warningContainer) warningContainer.style.display = "none";
    
    try {
      const path = isSample 
        ? "/media/ksp-zorin-001/WORK_DISK3/workspace/t-mon_demo/app/sample_sales.csv" 
        : currentTargetPath;
      
      if (!path) {
        resultContainer.innerHTML = `<div class="empty-state">対象のCSVファイルを選択してください。</div>`;
        return;
      }

      const masterPath = masterPathInput?.value || null;
      const presetValue = presetSelect?.value || "";
      let result: AnalysisResult;

      if (presetValue.startsWith("plugin:")) {
        const pluginId = presetValue.replace("plugin:", "");
        result = await invoke("run_plugin", {
          pluginId: pluginId,
          csvPath: path,
        });
      } else {
        result = await invoke("analyze_csv", {
          path: path,
          masterPath: masterPath,
        });
      }

      if (warningContainer) {
        if (result.skipped_rows > 0) {
          warningContainer.style.display = "block";
          warningContainer.innerHTML = `<strong>⚠️ 警告:</strong> 全 ${result.total_rows} 行中、フォーマット異常等で <strong>${result.skipped_rows}行</strong> をスキップして計算しました。`;
        } else {
          warningContainer.style.display = "none";
        }
      }

      renderCards(result.rules);
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
  emptyState = document.querySelector("#empty-state");

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
});
