# GYM-NEXT-5 Deploy

1. Supabaseで `GYM-NEXT-5.sql` を実行
2. 正式Worker `dpro-gym-line-api` のコードを `worker.js` に全部差し替えてDeploy
3. 確認URL:
   `https://dpro-gym-line-api.dpromstk2000.workers.dev/api/health`
4. 正常時バージョン:
   `GYM-NEXT-5-WORKER-20260725`
5. 次に `STEP GYM-NEXT-5-VERIFY`

今回、新しいWorkerは作りません。
既存の正式Worker `dpro-gym-line-api` を更新します。
