# DuckDB-MotherDuck同期ワークフロー

## 問題と解決策

### 問題: WASM競合
DuckDB WASMとMotherDuck WASMクライアントを同じページで実行すると`_setThrew`エラーが発生します。

### 解決策: 分離アプローチ
1. **ローカル専用ページ** (`local-only-demo.html`)
2. **MotherDuck専用ページ** (`motherduck-direct.html`)
3. **SQLエクスポート/インポート**による同期

## 推奨ワークフロー

### 1. オフライン作業（ローカル）
```
http://localhost:5173/local-only-demo.html
```
- ユーザーを追加
- 変更を追跡
- SQLをエクスポート

### 2. オンライン同期（MotherDuck）
```
http://localhost:5173/motherduck-direct.html
```
- MotherDuckに接続
- エクスポートしたSQLを実行
- データを確認

### 3. 自動化オプション

#### A. サーバーAPI経由
```javascript
// server.js
app.post('/api/sync', async (req, res) => {
  const { sql } = req.body;
  // MotherDuck Node.js SDKで実行
  await executeSQLOnMotherDuck(sql);
  res.json({ success: true });
});
```

#### B. Web Workers分離
```javascript
// main.js
const localWorker = new Worker('local-worker.js');
const mdWorker = new Worker('motherduck-worker.js');

// 各ワーカーで独立して実行
```

## 使用手順

### ステップ1: ローカルでデータ作成
1. `local-only-demo.html`を開く
2. "Initialize Database"をクリック
3. ユーザーを追加
4. "Export Unsynced Changes"をクリック
5. SQLをコピー

### ステップ2: MotherDuckに同期
1. `motherduck-direct.html`を開く
2. MotherDuckトークンを入力して接続
3. ブラウザのコンソールでSQLを実行:
```javascript
await connection.evaluateQuery(`[ここにコピーしたSQL]`);
```

### ステップ3: 同期完了を記録
1. `local-only-demo.html`に戻る
2. "Mark All as Synced"をクリック
3. ペンディング変更が0になることを確認

## 将来の改善案

1. **Electron App**: ネイティブDuckDBとMotherDuck SDKを使用
2. **Progressive Web App**: Service Workerで同期管理
3. **REST API**: MotherDuckが公式REST APIを提供した場合の直接統合

## まとめ

現在のブラウザ技術の制限により、完全自動の同期は困難ですが、このワークフローにより：
- ✅ オフラインでの作業が可能
- ✅ 変更の追跡が可能
- ✅ 手動でのデータ同期が可能
- ✅ データの一貫性を保持

これで実用的なオフライン対応アプリケーションを構築できます。