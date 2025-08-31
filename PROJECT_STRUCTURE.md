# プロジェクト構造

## ディレクトリ構成

```
duckdb-sync/
├── docs/                   # ドキュメント
│   ├── architecture/       # アーキテクチャ関連
│   └── development/        # 開発関連
│
├── src/                    # メインライブラリのソースコード
│   ├── index.js           # メインエントリーポイント（関数型APIラッパー）
│   ├── duckdb-sync.js     # クラスベースの実装
│   ├── duckdb-sync-functional.js  # fp-tsを使用した関数型実装
│   ├── adapters/          # TypeScript: 各種アダプター
│   ├── core/              # TypeScript: コア機能
│   ├── errors/            # TypeScript: エラー処理
│   ├── sync/              # TypeScript: 同期エンジン
│   ├── types/             # TypeScript: 型定義
│   └── utils/             # TypeScript: ユーティリティ
│
├── public/                 # 公開リソース
│   ├── duckdb-sync-worker.js         # MotherDuck同期用Worker
│   └── duckdb-sync-worker-module.js  # ESモジュール版Worker
│
├── test/                   # テストファイル
│   ├── *.test.ts          # TypeScriptテスト
│   ├── test-cli.js        # CLIテスト
│   └── test-node.mjs      # Node.jsテスト
│
├── test-app/              # デモアプリケーション（独立プロジェクト）
│   ├── index.html         # ランディングページ
│   ├── simple-demo-v2.html # シンプルな同期デモ
│   ├── class-demo.html    # ローカルDBデモ
│   ├── test-wasm.html     # WASM読み込みテスト
│   └── package.json       # test-app用の依存関係
│
├── server/                # サーバー実装（独立プロジェクト）
│   ├── index.ts          # Express サーバー
│   └── package.json      # server用の依存関係
│
├── dist/                  # ビルド出力（gitignore）
├── docs/                  # 生成されたドキュメント（gitignore）
└── node_modules/          # 依存関係（gitignore）
```

## ファイルの役割

### メインライブラリ (`/src`)
- **index.js**: 両方のAPIを提供するメインエントリーポイント
- **duckdb-sync.js**: シンプルなクラスベースAPI（現在動作中）
- **duckdb-sync-functional.js**: fp-tsを使用した関数型API（実験的）

### 公開リソース (`/public`)
- **duckdb-sync-worker.js**: MotherDuck同期をWeb Workerで実行
- **duckdb-sync-worker-module.js**: ESモジュール版（実験的）

### デモアプリ (`/test-app`)
独立したViteプロジェクトとして、ライブラリの使用例を提供

### サーバー (`/server`)
オプションのバックエンドサーバー実装（現在は未使用）

## 言語の混在について

現在、TypeScriptとJavaScriptが混在していますが、これは意図的です：
- **TypeScript**: 複雑な型安全性が必要な内部実装
- **JavaScript**: シンプルなAPIと互換性のためのエントリーポイント

将来的には完全なTypeScript化を検討していますが、現在は段階的な移行中です。