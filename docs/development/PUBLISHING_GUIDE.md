# DuckDB-MotherDuck Sync パッケージ公開ガイド

## パッケージ公開の利点

1. **CDN経由での簡単な利用**
   ```html
   <script type="module">
     import { DuckDBSync } from 'https://cdn.jsdelivr.net/npm/duckdb-motherduck-sync@latest/+esm';
   </script>
   ```

2. **依存関係の自動解決**
   - DuckDB WASM
   - MotherDuck WASMクライアント
   - その他の依存関係

3. **Worker問題の解決**
   - バンドルされたWorkerファイル
   - CDNからの安定した読み込み

## 公開前の準備

### 1. ビルド設定の最適化

```javascript
// vite.config.js の更新
export default {
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'DuckDBSync',
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['@duckdb/duckdb-wasm', '@motherduck/wasm-client'],
      output: {
        globals: {
          '@duckdb/duckdb-wasm': 'DuckDB',
          '@motherduck/wasm-client': 'MotherDuckClient'
        }
      }
    }
  }
}
```

### 2. Worker のバンドル

```javascript
// 別のWorkerビルド設定
// vite.config.worker.js
export default {
  build: {
    lib: {
      entry: 'public/duckdb-sync-worker.js',
      name: 'DuckDBSyncWorker',
      formats: ['iife']
    },
    outDir: 'dist',
    emptyOutDir: false
  }
}
```

### 3. package.json の更新

```json
{
  "name": "duckdb-motherduck-sync",
  "version": "1.0.0",
  "description": "Offline-first sync middleware for DuckDB WASM and MotherDuck",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./worker": "./dist/duckdb-sync-worker.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "duckdb",
    "motherduck",
    "sync",
    "offline-first",
    "wasm"
  ]
}
```

## 公開後の使用例

### CDN経由（最も簡単）

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module">
    import { DuckDBSync } from 'https://cdn.jsdelivr.net/npm/duckdb-motherduck-sync@latest/+esm';
    
    const sync = await DuckDBSync.create({
      motherduckToken: 'your-token',
      // WorkerもCDNから自動的に読み込まれる
    });
    
    await sync.trackTable('users');
    // 使用開始！
  </script>
</head>
</html>
```

### npm経由

```bash
npm install duckdb-motherduck-sync
```

```javascript
import { DuckDBSync } from 'duckdb-motherduck-sync';

const sync = await DuckDBSync.create({
  motherduckToken: process.env.MOTHERDUCK_TOKEN
});
```

## バックエンドが不要な理由

1. **MotherDuckの設計**
   - ブラウザから直接接続可能
   - WebAssemblyベースのクライアント
   - トークンベースの認証

2. **オフラインファースト**
   - ローカルDuckDB WASMで完全動作
   - ネットワーク接続時のみ同期

3. **セキュリティ**
   - トークンはクライアント側で管理
   - HTTPSによる暗号化通信

## 公開手順

1. **ビルド**
   ```bash
   npm run build
   npm run build:worker
   ```

2. **テスト**
   ```bash
   npm test
   npm run test:integration
   ```

3. **公開**
   ```bash
   npm login
   npm publish
   ```

## まとめ

パッケージを公開することで：
- ✅ CDNからの簡単な利用
- ✅ 依存関係の問題解決
- ✅ Worker読み込みの問題解決
- ❌ バックエンドは不要

公開により、現在のローカル開発での問題の多くが解決され、より多くの開発者が簡単に利用できるようになります。