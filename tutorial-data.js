/* DPRO TUTORIAL STANDARD V1.1 / GYM / canonical First10 */
(() => {
  'use strict';
  const steps = Object.freeze([
    {step:1,route:'demo-guide.html',target:'#primaryDemoLink',fallback:'#screenGrid',title:'まず全体の流れを確認',guidance:'予約→会員・回数券→受付/セッション→継続管理の全体像を確認します。',safety:'リンク表示のみ。Tutorialは業務データを変更しません。'},
    {step:2,route:'index.html?demo=1',target:'#serviceList',fallback:"section[data-step='1']",title:'メニューを選ぶ',guidance:'無料体験・カウンセリング等の予約メニューを確認します。',safety:'選択は画面内状態のみ。予約送信はしません。'},
    {step:3,route:'index.html?demo=1',target:'#trainerList',fallback:'.trainer-grid',title:'担当トレーナーを確認',guidance:'担当トレーナーまたはおまかせを選べることを確認します。',safety:'選択は画面内状態のみ。'},
    {step:4,route:'index.html?demo=1',target:'#dateStrip',fallback:'#slotArea',title:'30分単位の空き時間を確認',guidance:'日付と空き時間を確認します。満席は選択できません。',safety:'空き時間のGET確認まで。予約送信は絶対に実行しません。',prepare:'booking-step-2'},
    {step:5,route:'member.html?demo=1',target:'.stats',fallback:'#ticketCount',title:'会員情報と回数券を確認',guidance:'残り回数・来店回数・有効期限を確認します。',safety:'表示のみ。日時変更・キャンセル・相談送信は実行しません。'},
    {step:6,route:'member.html?demo=1',target:'#sessionHistoryList',fallback:'.session-list',title:'セッション振り返りを見る',guidance:'実施内容・次回の重点・会員向けコメントを確認します。',safety:'読み取りのみ。内部メモは表示しません。'},
    {step:7,route:'owner-ipad.html?demo=1',target:'#view-today',fallback:'.tabs',title:'iPad受付で本日の流れを確認',guidance:'予約・承認待ち・来店済み・実施中の状況を確認します。',safety:'来店受付や開始など状態変更ボタンは押しません。'},
    {step:8,route:'staff.html?demo=1',target:'#view-today',fallback:'.tabs',title:'スタッフの担当セッションを確認',guidance:'本日の担当、予約一覧、会員確認への導線を確認します。',safety:'記録保存・完了操作は実行しません。'},
    {step:9,route:'dashboard.html?demo=1',target:'#view-today',fallback:'.stats',title:'オーナーの今日やることを確認',guidance:'予約・承認待ち・相談・フォロー期限・残り回数の概要を確認します。',safety:'営業前DEMO準備、電話・店頭予約、状態変更は押しません。'},
    {step:10,route:'dashboard.html?demo=1',target:'.side',fallback:"button[data-view='trials']",title:'体験・入会・継続フォローへつなぐ',guidance:'左メニューの体験・入会、継続フォロー、相談・連絡、履歴までを確認して運用全体を締めます。',safety:'view切替の確認のみ。入会処理・回数券調整・対応済み・設定保存等は実行しません。'}
  ]);
  window.DPRO_GYM_TUTORIAL_DATA = Object.freeze({
    system:'GYM', standard:'V1.1', version:'GYM-R3-FIRST10-V1.1-20260828',
    storageKey:'dpro_tutorial_gym_v1_1', steps
  });
})();
