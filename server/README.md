# DuckDB Sync Server

Node.js APIサーバーで、クライアントのDuckDB WASMとMotherDuckの同期を仲介します。

## セットアップ

### 1. 依存関係のインストール

```bash
cd server
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env`ファイルを編集して、MotherDuckトークンを設定：

```
MOTHERDUCK_TOKEN=your_actual_motherduck_token_here
PORT=3001
```

### 3. サーバーの起動

```bash
npm start
```

開発時（ファイル変更時に自動再起動）:
```bash
npm run dev
```

## API エンドポイント

### Health Check
```
GET /health
```

### 同期 - プッシュ
```
POST /api/sync/push
Body: {
  users: [...],
  lastSyncTime: "2024-01-01T00:00:00Z"
}
```

### 同期 - プル
```
POST /api/sync/pull
Body: {
  lastSyncTime: "2024-01-01T00:00:00Z"
}
```

### フル同期
```
POST /api/sync/full
Body: {
  users: [...],
  lastSyncTime: "2024-01-01T00:00:00Z"
}
```

### ユーザー一覧
```
GET /api/users
```

### ユーザー削除（ソフトデリート）
```
DELETE /api/users/:id
```

## アーキテクチャ

```
Client (PWA)
    ↓
Service Worker
    ↓
Sync API Server (このサーバー)
    ↓
MotherDuck Cloud
```

## 特徴

- **競合検出**: タイムスタンプベースの競合検出
- **ソフトデリート**: データの完全削除を避ける
- **双方向同期**: プッシュとプルの両方をサポート
- **エラーハンドリング**: 個別レコードのエラー処理

## 本番環境へのデプロイ

### 1. Heroku
```bash
heroku create your-app-name
heroku config:set MOTHERDUCK_TOKEN=your_token
git push heroku main
```

### 2. Railway
```bash
railway login
railway init
railway add
railway up
```

### 3. Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```