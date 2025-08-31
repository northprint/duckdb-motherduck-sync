# Test App Directory

このディレクトリには、DuckDB-MotherDuck Syncのデモアプリケーションが含まれています。

## 現在のデモ

### 📱 メインページ (`index.html`)
- ライブラリの概要とクイックスタートガイド
- デモへのリンク
- 主要機能の紹介

### 🚀 シンプル同期デモ (`simple-sync-demo.html`)
- MotherDuckトークンを設定して使用開始
- ユーザーの追加・表示
- 自動同期とマニュアル同期
- DuckDB-MotherDuck Syncライブラリの実装例

## 必要なファイル

デモを実行するには以下のファイルが必要です：

1. `/src/duckdb-sync.js` - メインライブラリ
2. `/public/duckdb-sync-worker.js` - Web Worker（同期処理用）
3. `/node_modules/@duckdb/duckdb-wasm/` - DuckDB WASMライブラリ

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ブラウザでアクセス
http://localhost:5173/
```

## アーカイブ

以前のデモファイルは `archive/` ディレクトリに移動されています。
これらは開発履歴として保存されていますが、現在はメンテナンスされていません。

## トラブルシューティング

### CORS エラー
ローカル開発時は `npm run dev` で Vite 開発サーバーを使用してください。

### MotherDuck トークン
デモを使用するには有効なMotherDuckトークンが必要です。
[MotherDuck](https://motherduck.com) でアカウントを作成して取得してください。