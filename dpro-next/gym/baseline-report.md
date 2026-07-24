# DPRO パーソナルジム LINE｜GYM-NEXT-1-R2 現状基準台帳

- STEP: GYM-NEXT-1
- 結果: OK
- 基準コミット: d6306daed290cb2abac8603d425885cbeeb40a4f
- バックアップタグ: backup-gym-before-next-20260725
- 設定バージョン: GYM-6-R2-CONFIG-RESTORE-URL-HEADER-FIX-20260717
- 施設コード: dpro_gym_demo
- 完了日時: 2026-07-25T08:50:15+0900
- Actions: https://github.com/dpromstk2000-lab/liff-gym-demo/actions/runs/30134810072
- R2修正: バックアップタグ作成前にGit作成者情報を設定
- R2安全対策: 過去のYMLのみの修正コミットを除外して正常アプリ版を保護

## 保護対象

config.js index.html member.html dashboard.html owner-ipad.html reserve.html system-check.html

## 自動検査

- 公開URL・Worker疎通: OK
- YAML構文: OK
- HTML基本構造: OK
- JavaScript構文: OK
- HTML ID重複: OK
- 必須ファイル: OK
- 既存機能維持: OK
- パーソナルジム業務ロジック: OK
- 30分枠: OK
- 電話番号正規化検査の存在: OK
- 重複予約防止検査の存在: OK
- 管理コード削除ボタン: OK
- Worker変更: false
- Supabase変更: false
- APIソース変更: false

## 次のSTEP

GYM-NEXT-2
