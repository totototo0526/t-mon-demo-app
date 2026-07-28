# Action Auto-Bot (t-mon_demo)

**本アプリは「任意のAnalyzer（分析エンジン）を実行し、その結果を現場で使えるAction（カンペ）へ変換する」ためのデスクトップ実行環境（プラットフォーム）です。**

店舗のPOSレジやECサイトから出力される「トランザクションCSVデータ」と「商品マスターCSV」を入力として受け取り、バックグラウンドでAnalyzerプラグインを実行し、翌日の営業担当者や販売員がそのまま使える行動指示を瞬時に生成します。

![デモ画面のイメージ](docs/screenshots/demo.png) *(※必要に応じてスクリーンショットを配置してください)*

## ✨ Analyzer実行基盤としての特徴

1. **完全ローカル・オフライン動作**
   - クラウドにデータをアップロードすることなく、セキュアなローカル環境で完結します。機密性の高い購買データの分析に最適です。
2. **高速・堅牢なTauriベースのUI**
   - バックエンドにはTauriを採用し、洗練されたGlassmorphismデザインのUIを提供します。
3. **言語非依存のアドオン（プラグイン）アーキテクチャ**
   - 本アプリの最大の特徴は、**Analyzer（分析ロジック）を任意の言語で実装し、プラグインとして容易に追加できる**ことです。

## 🧩 プラグインの責務とインターフェース (Contract)

プラグイン（Analyzer）の責務は非常にシンプルです。
**「CSVパスを受け取り、Action候補をJSONで返す」**ことだけに特化しています。

```text
Input (CSV)  --->  [ Plugin (Analyzer) ]  --->  Output (Action JSON)  --->  UI
```

### Plugin Contract

- **Input**: コマンドライン引数として「対象のCSVファイルパス」が渡されます。（将来的にマスターCSV等も追加可能）
- **Output**: 以下の構造を持つJSONを標準出力（stdout）に返却します。
  - `rules`: 抽出されたアクション（アイテムAを買った人にアイテムBを勧める、など）の配列
  - `skipped_rows`: 処理時にスキップしたエラー行数（UIでの警告用）
  - `total_rows`: 全処理行数

このシンプルなインターフェースにより、**AnalyzerはRust、Python、Go、Node.jsなど任意の言語で実装可能**です。

## 💡 ユースケースと拡張性

現在、標準のプラグインとして「Rustによる高速なBasket Analyzer（Apriori併売分析）」と「PythonによるRFM分析（サンプル）」を搭載しています。

しかし、これは「MLプラットフォーム」を作りたいわけではありません。あくまで**「Analyzerの実行基盤」**であり、PythonによるMLはその一実装例に過ぎません。

### 今後の拡張構想 (Planned Analyzers)
今後、以下のような様々なAnalyzerを並列にプラグインとして追加していく構想です。

- [x] **Basket Analyzer** (Rust) - 併売分析
- [x] **RFM Analyzer** (Python/Rust) - 優良顧客分析
- [ ] **Trend Analyzer** (Rust/Python) - トレンド検知
- [ ] **Anomaly Detection** (Python) - 異常検知
- [ ] **Demand Forecast** (Python) - 需要予測
- [ ] **Custom Solver** - 現場独自のルールエンジン

現場の要件（独自のバスケット定義や、独自の顧客セグメント）が発生した場合は、本体を改修するのではなく、**専用のAnalyzerプラグインを開発して追加する**というアプローチで解決します。

## 🚀 開発環境のセットアップ

### 前提条件
- Node.js (v18+)
- Rust (cargo)

### 起動方法
```bash
cd app
npm install
npm run tauri dev
```

### パッケージング（ビルド）
Zorin OS (Debian系) 等で単体動作するインストーラーを生成する場合：
```bash
npm run tauri build
```
これにより `app/src-tauri/target/release/bundle/` 配下に実行ファイルや `.deb` ファイルが出力されます。
