# DuckDB-MotherDuck Sync

オフラインファーストのアプリケーションを実現する、DuckDB WASMとMotherDuckクラウドストレージの同期ミドルウェア。

A middleware for synchronizing DuckDB WASM with MotherDuck cloud storage, enabling offline-first applications with automatic data synchronization.

## 特徴 / Features

- 🔄 **自動同期**: ローカルとクラウドの双方向同期
- 📱 **オフラインファースト**: ネットワークなしでも完全動作
- 🚀 **シンプルなAPI**: MotherDuckトークンだけで開始可能
- 🔒 **セキュア**: トークンベースの認証
- 📦 **軽量**: 最小限の依存関係

## インストール / Installation

```bash
npm install duckdb-motherduck-sync
```

## クイックスタート / Quick Start

### シンプルなクラスベースAPI（推奨）

```javascript
import { DuckDBSync } from 'duckdb-motherduck-sync';

// 初期化
const sync = new DuckDBSync({
  motherduckToken: 'your-token-here',
  autoSync: true  // 自動同期を有効化
});

await sync.initialize();

// テーブルを同期対象に追加
await sync.trackTable('users');

// 通常通りDuckDBを使用
const conn = sync.getConnection();
await conn.query("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')");

// データは自動的にMotherDuckに同期されます！
```

### 関数型API（実験的）

```javascript
import { DuckDBSync } from 'duckdb-motherduck-sync';

// 関数型APIラッパーを使用
const sync = await DuckDBSync.create({
  motherduckToken: 'your-token-here',
  syncInterval: 30000,
  autoSync: true
});

// イベントリスナー
sync.on('sync-complete', (result) => {
  console.log(`Synced: ${result.pushed} pushed, ${result.pulled} pulled`);
});

// 手動同期
await sync.sync();
```

## デモ / Demo

```bash
# デモアプリを起動
cd test-app
npm install
npm run dev
```

`http://localhost:5173` でデモアプリケーションにアクセスできます。

## プロジェクト構造 / Project Structure

```text
duckdb-sync/
├── src/           # ライブラリのソースコード
├── public/        # Worker ファイル
├── test-app/      # デモアプリケーション
└── server/        # オプションのサーバー実装
```

詳細は [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) を参照してください。

## 開発 / Development

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# テスト
npm test

# 型チェック
npm run typecheck
```

## 要件 / Requirements

- Node.js >= 18.0.0
- ブラウザ: Chrome, Firefox, Safari, Edge の最新版
- MotherDuck アカウントとトークン

## 制限事項 / Limitations

- ブラウザ環境での動作が前提
- DuckDB WASMとMotherDuck WASMクライアントの同時実行にはWeb Workerが必要
- 大規模なデータセットの同期にはメモリ制限あり

## ライセンス / License

MIT

## コントリビューション / Contributing

プルリクエストを歓迎します！詳細は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 関連リンク / Links

- [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview)
- [MotherDuck](https://motherduck.com/)
- [GitHub Repository](https://github.com/northprint/duckdb-motherduck-sync)
