# DuckDB-MotherDuck同期の最終推奨事項

## 現状の課題

1. **WASM競合**: DuckDB WASMとMotherDuck WASMクライアントを同じコンテキストで実行すると`_setThrew`エラーが発生
2. **CORS制限**: ブラウザのセキュリティ制限により、直接的なMotherDuck接続が困難
3. **パラメータバインディング**: DuckDB WASMでのパラメータバインディングに不安定性がある

## 推奨される本番環境アーキテクチャ

### 1. ハイブリッドアプローチ（最も実用的）

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Browser        │────▶│  Local Storage   │────▶│  Export/Import  │
│  (DuckDB WASM)  │     │  (SQL/JSON)      │     │  (Manual/Auto)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │  Node.js Script  │
                        │  or Server API   │
                        └──────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │   MotherDuck     │
                        │   (Native)       │
                        └──────────────────┘
```

### 2. 実装手順

#### Step 1: ブラウザでのローカル操作
```javascript
// DuckDB WASMでローカル操作
const localDB = new duckdb.AsyncDuckDB(...);
await localDB.query('INSERT INTO users VALUES ...');

// 変更を追跡
const changes = await trackChanges();

// SQLエクスポート
const syncSQL = generateSyncSQL(changes);
```

#### Step 2: 同期スクリプト（Node.js）
```javascript
// sync-to-motherduck.mjs
import duckdb from 'duckdb';
import { readFile } from 'fs/promises';

const motherduck = new duckdb.Database(`md:?motherduck_token=${token}`);
const sql = await readFile('sync.sql', 'utf8');
await motherduck.exec(sql);
```

#### Step 3: 自動化（オプション）
```javascript
// server.js - Express API
app.post('/api/sync', authenticate, async (req, res) => {
  const { sql } = req.body;
  const result = await executeSqlOnMotherDuck(sql);
  res.json({ success: true, result });
});
```

## 実装済みの機能

1. ✅ **ローカルDuckDB操作** - `simple-fixed-test.html`
2. ✅ **変更追跡** - `simple-tracker.js`
3. ✅ **SQLエクスポート** - 各テストアプリに実装
4. ✅ **Node.js同期スクリプト** - `test-node.mjs`
5. ✅ **関数型プログラミング** - fp-tsベースの実装

## 本番環境でのベストプラクティス

### セキュリティ
- MotherDuckトークンは環境変数で管理
- クライアントサイドにトークンを露出しない
- SQLインジェクション対策を実装

### パフォーマンス
- バッチ処理で大量データを効率的に同期
- 差分同期で転送量を削減
- 圧縮を使用してネットワーク帯域を節約

### 信頼性
- トランザクション管理で一貫性を保証
- エラーハンドリングとリトライロジック
- 同期状態の永続化

## 今すぐ使える実装

### 1. ブラウザアプリ
```bash
# テストアプリを起動
cd test-app
npm run dev

# アクセス
http://localhost:5173/simple-fixed-test.html
```

### 2. Node.js同期
```bash
# MotherDuckトークンを設定
export MOTHERDUCK_TOKEN="your-token"

# 同期実行
node test-node.mjs
```

### 3. 手動同期
1. ブラウザアプリでデータを操作
2. "Generate SQL Export"でSQLを生成
3. MotherDuck UIでSQLを実行

## まとめ

現在のブラウザ技術の制限により、DuckDB WASMとMotherDuck WASMの直接統合は困難ですが、以下のアプローチで実用的な同期システムを構築できます：

1. **開発/テスト**: SQL Export/Import方式
2. **本番環境**: サーバーAPIプロキシ方式
3. **将来**: MotherDuck公式REST APIの登場を待つ

提供されたコードベースとツールを使用して、すぐに同期システムの構築を開始できます。