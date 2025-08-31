# Production Architecture for DuckDB-MotherDuck Sync

## 推奨アーキテクチャ

### 1. サーバープロキシ方式（推奨）

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Browser        │────▶│  Node.js Server  │────▶│  MotherDuck     │
│  (DuckDB WASM)  │     │  (Proxy)         │     │  (Native)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**利点:**
- WASM競合なし
- セキュアなトークン管理
- 完全な機能サポート
- エラーハンドリングが容易

**実装例:**
```javascript
// Server (Node.js + Express)
app.post('/api/sync', authenticate, async (req, res) => {
  const { sql, data } = req.body;
  const db = new duckdb.Database(`md:?motherduck_token=${process.env.MD_TOKEN}`);
  
  try {
    const result = await db.all(sql);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Client
async function syncToMotherDuck(sql) {
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql })
  });
  return response.json();
}
```

### 2. Web Worker分離方式

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Main Thread    │────▶│  Worker 1        │     │  Worker 2       │
│  (UI)           │     │  (DuckDB WASM)   │     │  (MD WASM)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**利点:**
- 完全にクライアントサイド
- リアルタイム同期可能
- サーバー不要

**課題:**
- 複雑な実装
- デバッグが困難
- ブラウザ制限

### 3. SQL Export/Import方式（シンプル）

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  DuckDB Local   │────▶│  SQL Scripts     │────▶│  MotherDuck UI  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**利点:**
- 実装が簡単
- 確実に動作
- デバッグが容易

**課題:**
- 手動操作が必要
- リアルタイム同期不可

## セキュリティベストプラクティス

### 1. トークン管理

```javascript
// ❌ 悪い例
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// ✅ 良い例
const token = process.env.MOTHERDUCK_TOKEN;
```

### 2. CORS設定

```javascript
// Server
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
```

### 3. 認証フロー

```javascript
// 1. クライアントがサーバーに認証
// 2. サーバーがセッショントークン発行
// 3. サーバーがMotherDuckトークンを保持
// 4. クライアントはセッショントークンのみ使用
```

## パフォーマンス最適化

### 1. バッチ処理

```javascript
// 個別挿入の代わりにバッチ挿入
const batchInsert = async (records) => {
  const chunks = chunk(records, 1000);
  for (const batch of chunks) {
    const values = batch.map(r => `(${r.id}, '${r.name}')`).join(',');
    await execute(`INSERT INTO users VALUES ${values}`);
  }
};
```

### 2. 差分同期

```javascript
// タイムスタンプベースの差分同期
const syncChanges = async (lastSync) => {
  const changes = await db.all(
    'SELECT * FROM _changes WHERE timestamp > ?',
    [lastSync]
  );
  return changes;
};
```

### 3. 圧縮

```javascript
// 大量データの圧縮転送
import pako from 'pako';

const compressedData = pako.gzip(JSON.stringify(data));
const decompressedData = JSON.parse(pako.ungzip(compressedData, { to: 'string' }));
```

## 監視とログ

### 1. エラー追跡

```javascript
// Sentryなどのエラー追跡サービス
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### 2. メトリクス

```javascript
// 同期パフォーマンスの追跡
const metrics = {
  syncDuration: 0,
  recordsSynced: 0,
  errors: 0,
  lastSync: null,
};
```

### 3. ヘルスチェック

```javascript
// 定期的な接続確認
setInterval(async () => {
  try {
    await motherduck.query('SELECT 1');
    updateStatus('healthy');
  } catch (error) {
    updateStatus('unhealthy');
    notifyOps(error);
  }
}, 60000);
```

## デプロイメント

### 1. 環境変数

```env
# .env.production
MOTHERDUCK_TOKEN=your-production-token
MOTHERDUCK_DATABASE=production_db
SYNC_INTERVAL=300000
BATCH_SIZE=1000
ENABLE_COMPRESSION=true
```

### 2. Docker構成

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### 3. CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production
        env:
          MOTHERDUCK_TOKEN: ${{ secrets.MOTHERDUCK_TOKEN }}
        run: |
          npm run build
          npm run deploy
```

## まとめ

本番環境では、以下の組み合わせを推奨：

1. **サーバープロキシ方式**でMotherDuck接続を管理
2. **SQL Export/Import**をバックアップ手段として用意
3. **バッチ処理と差分同期**でパフォーマンス最適化
4. **適切な監視とログ**で問題を早期発見

これにより、安全で信頼性の高い同期システムを構築できます。