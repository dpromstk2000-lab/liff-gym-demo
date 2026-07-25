# GYM-NEXT-4｜SQL・Worker Deploy手順

## 今回の方式

既存の `dpro-gym-line-api` は変更しません。

新しいWorkerとして次を作成します。

```text
dpro-gym-line-api-next
```

新Workerは、NEXT-4で追加するAPIだけを処理します。それ以外の既存APIは、現在稼働中のWorkerへ安全に転送します。

## 1. Supabase SQL

`GYM-NEXT-4.sql` をSupabase SQL Editorで実行します。

最後に次のJSONが返ることを確認してください。

```text
"ok": true
"session_records": true
"completion_guard": true
"ticket_completion_unique_guard": true
```

## 2. Cloudflare Worker

1. Cloudflare Workers & Pagesを開く
2. 新しいWorker `dpro-gym-line-api-next` を作成
3. `worker.js` の内容へ差し替える
4. 次のSecretsを現在のWorkerと同じ値で登録する

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_TOKEN
```

5. 次のVariablesを登録する

```text
LEGACY_WORKER_URL=https://dpro-gym-line-api.dpromstk2000.workers.dev
DEMO_FACILITY_CODE=dpro_gym_demo
```

6. Deployする

## 3. Deploy直後の確認URL

```text
https://dpro-gym-line-api-next.dpromstk2000.workers.dev/api/health
```

確認項目：

```text
ok: true
version: GYM-NEXT-4-GATEWAY-20260725
legacy_version: GYM-6-R2-WORKER-DEMO-BULK-INSERT-FIX-20260717
persistent_session_records: true
atomic_session_completion: true
ticket_completion_unique_guard: true
```

## 4. まだconfig.jsは変更しない

SQLと新Workerの確認が終わるまでは、公開画面は従来Workerを使用します。

確認後、次の `STEP GYM-NEXT-4-VERIFY` で次を自動反映します。

- `config.js` を新Worker URLへ変更
- PC管理画面へセッション記録を追加
- iPad画面へ完了・記録を追加
- 公開画面と旧API互換性を検査
- NEXT-4完成台帳を保存
