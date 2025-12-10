# Demo DevOps Agent - DynamoDB Throttling Scenario

AWS DevOps Agent検証用のCDKプロジェクトです。Lambda + DynamoDB構成でスロットリングを発生させ、DevOps Agentの検知能力を検証します。

## アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   EventBridge   │────▶│     Lambda      │────▶│    DynamoDB     │
│   (1分間隔)     │     │    (Writer)     │     │  (WCU=5/RCU=5)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               │ スロットリング発生時
                               ▼
                        ┌─────────────────┐
                        │ CloudWatch Alarm│
                        │ (WriteThrottle) │
                        └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │     Lambda      │────▶│  DevOps Agent   │
                        │(WebhookNotifier)│     │    Webhook      │
                        └─────────────────┘     └─────────────────┘
```

## リソース

- **DynamoDB Table**: `demo-devops-agent-table`
  - パーティションキー: `pk` (String)
  - ソートキー: `sk` (String)
  - 初期キャパシティ: WCU=5, RCU=5

- **Lambda Functions**:
  - `demo-devops-agent-writer`: DynamoDBに50件/回の書き込みを実行
  - `demo-devops-agent-webhook-notifier`: CloudWatch AlarmからDevOps Agentに通知

- **EventBridge Rule**: 1分間隔でWriterを実行

- **CloudWatch Alarms**:
  - `demo-devops-agent-dynamodb-write-throttle`: DynamoDBスロットリング検知
  - `demo-devops-agent-lambda-errors`: Lambdaエラー検知

## デプロイ

### 前提条件

- Node.js 20+
- AWS CLI設定済み
- CDKブートストラップ済み

### ローカルからデプロイ

```bash
# 依存関係インストール
npm install

# CDKブートストラップ（初回のみ）
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1

# デプロイ
npx cdk deploy
```

### GitHub Actionsからデプロイ

1. AWS ConsoleでGitHub OIDC Providerを作成
2. GitHub Actions用IAMロールを作成
3. `.github/workflows/deploy.yml`の`ROLE_ARN`を更新
4. コードをpush

## スロットリング発生シナリオ

### Phase 1: 正常動作確認

初期状態（WCU=5）では正常に動作します。

### Phase 2: 障害発生

`bin/app.ts`で`writeCapacity: 1`に変更してデプロイすると、スロットリングが発生します：

```typescript
new DynamoDBThrottleStack(app, 'DemoDevOpsAgentStack', {
  writeCapacity: 1,  // ← 5から1に変更
  readCapacity: 1,
});
```

### Phase 3: DevOps Agent調査

CloudWatch Alarmがトリガーされ、Webhook NotifierがDevOps Agentに通知します。

## Webhook設定

Webhook機能は初期状態で**無効**です。有効にするには：

1. AWS Lambda ConsoleでWebhook Notifier関数を開く
2. 環境変数を設定：
   - `WEBHOOK_ENABLED`: `true`
   - `WEBHOOK_URL`: DevOps Agent WebhookのURL
   - `WEBHOOK_SECRET`: Webhookシークレット
   - `SERVICE_NAME`: サービス名（デフォルト: `DemoDevOpsAgent`）

## クリーンアップ

```bash
npx cdk destroy
```
