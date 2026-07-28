import sys
import json
import random

# コマンドライン引数から対象CSVのパスを受け取る (Tauriから渡される想定)
csv_path = sys.argv[1] if len(sys.argv) > 1 else ""

# 実際はここでPandas等を用いて高度なRFM分析・機械学習を行う
# 今回はPythonプラグインが動いていることを示すためのダミー出力

results = {
    "rules": [
        {
            "item_a": "最終来店から1年経過したVIP顧客",
            "item_b": "特別なカムバックオファーを案内",
            "support": 45,
            "confidence": 0.88,
            "lift": 2.1
        },
        {
            "item_a": "月1回必ず来店する優良リピーター",
            "item_b": "新商品のテストモニターを依頼",
            "support": 120,
            "confidence": 0.95,
            "lift": 1.5
        },
        {
            "item_a": "購入単価が低い新規顧客",
            "item_b": "まとめ買い割引キャンペーンを案内",
            "support": 300,
            "confidence": 0.62,
            "lift": 1.2
        }
    ],
    "skipped_rows": random.randint(0, 10),
    "total_rows": random.randint(1000, 5000)
}

# 分析結果をJSON文字列として標準出力に書き出す（Tauri側がこれを受け取る）
print(json.dumps(results))
