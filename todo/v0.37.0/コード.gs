/**
 * ToDoアプリ v0.26.0（Web版）サーバー側
 * スプレッドシートの「拡張機能 → Apps Script」の「コード.gs」に貼り付ける。
 * 画面は同じプロジェクトの HTML ファイル「index」、更新（⚙ の ⟳）はスクリプト「更新」、
 * 権限などは appsscript.json に入れる。v0.12.0 からは ⚙ の ⟳ で新しい版に入れ替えられる。
 */
const APP_VERSION = '0.37.0';
const APP_SEQ = 3700; // 版の通し番号（X×10000＋Y×100＋Z）。⚙の⟳は、これより大きい版にしか更新しない
const TZ = 'Asia/Tokyo';
const SHEET_TASKS = 'タスク';
const SHEET_LISTS = 'リスト';
const INBOX_NAME = 'Inbox'; // とりあえずタスクを入れておくフォルダ（v0.15.0）
const SHEET_SETTINGS = '設定';
const SHEET_TEMPLATES = 'テンプレート';
// doDate＝実行日の開始、doEnd＝実行日の終了。日付だけ（yyyy-MM-dd）か日時（yyyy-MM-ddTHH:mm）
const TASK_COLS = ['id', 'title', 'listId', 'due', 'doDate', 'repeat', 'notifyAt', 'notified',
  'memo', 'done', 'doneAt', 'createdAt', 'updatedAt', 'repeatBase', 'repeatCount', 'nextId', 'doEnd', 'attachments', 'parentTaskId', 'doneWith', 'checklist',
  'order', 'reminders', 'wontDo', 'gcalId', 'estimate', 'dayOrder', 'isSomeday', 'priority', 'isPinned', 'dueEnd'];
// v0.25.0：dueEnd＝期限の終わり（期限に期間を付けたとき。due より後。アプリだけで TickTick には送らない）
// v0.23.0：isSomeday＝期限を「いつか」にした（1。このとき due は空）。priority＝優先度（TickTick と同じ数：0 なし・1 低・3 中・5 高）。
// isPinned＝フォルダの一番上に固定（1。TickTick とは同期しない）
// parentTaskId＝親タスクのID（子タスクのとき）。子タスクは親と同じフォルダに入る
// checklist＝タスクの中の項目（[{t:'文字', d:済みなら true}] の JSON）
// doneWith＝完了の操作ごとの目印。押したタスクは「*目印」、一緒に完了した子・孫は「目印」。取り消すときに一緒に戻す
// order＝フォルダの中で手で並べた順（小さいほど上。空なら日付の順で後ろに並ぶ）
// reminders＝「◯分前」の通知（do:-30＝実行日の30分前、due:0＝期限の時刻ちょうど。時刻のない日は9:00を基準）を , でつなぐ
// notified＝もう送った通知の日時を , でつなぐ（v0.4 までの「1」は notifyAt を送り済み）
// wontDo＝「やらない」で終えた（done も 1 にする）
// gcalId＝Googleカレンダーに書き込んだ予定のIDと、書き込んだ中身の目印（ID|目印）
// estimate＝所要時間（分の整数。空は「まだ決めていない」で、0分とは別）。繰り返しの次の回へ引き継ぐ
// dayOrder＝その日だけの並び順（「日付:数」。例 2026-11-02:3）。朝の段取りで並べた今日の順。フォルダの中の順（order）とは別
// リストは画面では「フォルダ」。parentId で入れ子にする（isWork は v0.1 の名残で使わない）
// color＝フォルダの色（Googleカレンダーの予定の色の番号 1〜11。空なら上のフォルダの色）
const LIST_COLS = ['id', 'name', 'isWork', 'order', 'parentId', 'color', 'icon', 'closed', 'keyword', 'calId'];
// v0.27.0（18番）：calId＝このフォルダの予定を入れるカレンダー（空ならいつもの）。フォルダから入れた予定には見えない印（todoFolder）を付ける
// v0.27.0（18番）：keyword＝目印の言葉（空白・読点で区切って複数）。予定の名前にどれかを含めば、そのフォルダの予定として出す。アプリだけ
// v0.25.0：closed＝済のフォルダ（1）。アプリだけで TickTick とは同期しない。中のタスクは今日・7日間・カレンダー・通知に出さない
const TEMPLATE_COLS = ['id', 'name', 'data', 'createdAt'];
const SETTING_COLS = ['key', 'value'];
// v0.23.0：スマートリスト（条件で集める一覧）。1リスト1行。cond＝条件の JSON（fmt＝その書式の版）、rev＝更新番号（古い上書きを防ぐ）
const SHEET_SMART = 'スマートリスト';
const SMART_COLS = ['id', 'name', 'order', 'cond', 'fmt', 'rev', 'icon'];
// freeWeekday・freeHoliday＝1日にタスクへ使える時間（分。平日用と、土日・祝日用。空なら出さない）
const DEFAULT_SETTINGS = { theme: '', notifyMethod: 'none', ntfyTopic: '', mailTo: '', calendarIds: '', weekStart: 'sun', calSync: '',
  freeWeekday: '', freeHoliday: '', accent: '', appIcon: '', evDone: '', evTent: '', ui: '' }; // v0.36.0（受付1）：ui＝表示の状態 {"鍵": [値, 変えた時刻ms]}（Web・Android・どの端末でも同じに） // v0.35.0：evTent＝仮の予定の印（同じ形） // v0.35.0（受付5）：evDone＝予定のアーカイブの印 {"カレンダー|予定のid": "終わりの日"} // v0.33.0：appIcon＝アイコンの色（テーマ色と同じ8色の名前、空は青）
// 繰り返しは「頻度/間隔/決め方」で保存する（例 weekly/2/2,5＝2週ごとの火・金、monthly/1/nth＝毎月 第N◯曜日、
// monthly/3/day＝3か月ごとの同じ日）。最後に /nh を付けると祝日に当たる回を飛ばす（weekly/1/1,2,3,4,5/nh＝祝日を除く平日）。
// /until=yyyy-MM-dd を付けると、その日より後の回は作らない（v0.15.0。TickTick の UNTIL と同じ）。
// v0.3 までの名前もそのまま読める
const OLD_REPEATS = { daily: 'daily/1', weekdays: 'weekly/1/1,2,3,4,5', weekly: 'weekly/1', monthly: 'monthly/1/day',
  monthlyNth: 'monthly/1/nth', monthlyLast: 'monthly/1/last', yearly: 'yearly/1' };
const ATTACH_FOLDER = 'ToDoアプリ_添付';
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const SYNC_CAL_NAME = 'ToDoアプリ';
// 祝日はGoogleカレンダーの「日本の祝日」から読む（読めない年は、法律の決まりから計算する）
const HOLIDAY_CAL_ID = 'ja.japanese#holiday@group.v.calendar.google.com';
const MAX_ESTIMATE = 1440; // 所要時間の上限（24時間）

// ---- 画面を出す ----

function doGet(e) {
  // TickTick の許可の画面から戻ってきたとき（?code=…&state=…）
  const q = (e && e.parameter) || {};
  if (q.code || q.error) return ttCallback_(q);
  const out = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('To Cal v' + APP_VERSION)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // v0.18.0：Google サイトなどに埋め込めるようにする（上の「Google Apps Script のユーザーが作成」の帯を出さないため。2026-11-05 ユーザーがカードで選択）
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // v0.32.1：タブのアイコン（案1 カレンダーの中に ✓）。受け付けられなくても画面は出す
  // v0.33.0：画像をそのまま文字にした形（data:）は受け付けられなかったので、ドライブに置いた PNG のアドレスを渡す。
  // 色は ⚙ › 表示 の「アイコンの色」（開くたびに表を読まないよう、スクリプトのプロパティに写しておく）
  try {
    const c = PropertiesService.getScriptProperties().getProperty('APP_ICON') || '';
    const id = APP_ICON_IDS_[c] || APP_ICON_IDS_[''];
    out.setFaviconUrl('https://drive.google.com/uc?export=view&id=' + id + '&type=.png');
  } catch (err) { console.log('タブのアイコンを付けられませんでした：' + err); }
  return out;
}
// アイコンの色 → ドライブ「To Cal アイコン」フォルダの PNG（64×64）。まだ置いていない色は青
const APP_ICON_IDS_ = { '': '1oWEdlp_OjMUGVH2M8iNCycXKsOBLVt6p', green: '11lkSB5aji45VIVkvs4WXVKmM5RKn1XHR', teal: '16rbraVerAa8iIjFugWzeivRp2oPVnHHa',
  purple: '10_6J1YOwJq2EI0c5g6nGR8RSjtsVjwLE', pink: '1aiCj-y4kuQTRe092GlDA7iVVAON4Axsw', orange: '1Qk_YmF1X1tTA8vb5nWnkkuwqhi6jHEv2',
  brown: '1hEZiaGX91NtcjzADio-Lgdpg-UYG2_cL', gray: '1u-3bqDvfiTJb1tzzRSt0syt4mIpeh102' };

// スプレッドシートを開いたとき、上のメニューに「ToDo」を出す（仮想ブラウザでURLを覚えていなくても開ける）
function onOpen() {
  try { ss_(); } catch (e) { /* 単純トリガーでは保存できないことがある */ }
  SpreadsheetApp.getUi().createMenu('ToDo').addItem('アプリを開く', 'showAppLink').addToUi();
}

function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  const html = HtmlService.createHtmlOutput(
    url ? '<p style="font-family:sans-serif"><a href="' + url + '" target="_blank">ToDoアプリを開く</a></p>'
      : '<p style="font-family:sans-serif">まだウェブアプリとして公開されていません（設置手順の3を参照）。</p>')
    .setWidth(280).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'ToDoアプリ');
}

// ---- 画面から呼ばれる処理 ----

// v0.40.0（6）：フォルダの目印に選べる絵文字の一覧（分類ごと・日本語の探す言葉つき）。画面は初めて開いたときだけ読み、端末に覚える
function getEmojiData() {
  return HtmlService.createHtmlOutputFromFile('絵文字').getContent();
}

function getAll() {
  // v0.18.0：開くたびに鍵を待たない（同期が鍵を持っていると、開くのが数秒止まっていた）。準備は版が変わったときだけ鍵を取って行う
  const sp = PropertiesService.getScriptProperties();
  if (sp.getProperty('SETUP_SEQ') !== String(APP_SEQ)) withLock_(function () { ensureSetup_(); sp.setProperty('SETUP_SEQ', String(APP_SEQ)); });
  return {
    version: APP_VERSION,
    lists: lists_(),
    tasks: allTasks_(),
    settings: settings_(),
    templates: templates_(),
    smart: smart_(), // v0.23.0：スマートリスト
    holidays: holidaysNear_(), // 今年と来年の祝日（日付 → 名前）。画面とAndroid版はこれを使う
    ttConflicts: ttConflictCount_(), // TickTick との確認待ちの数（v0.15.0）
    once: true, // once で送れる（Android版 v0.11.0 から使う）
    restoring: sp.getProperty('RESTORING') || '', // v0.26.0：戻す途中で止まったら知らせる
    restoreGen: sp.getProperty('RESTORE_GEN') || '' // v0.26.0：バックアップから戻した印。変わったら Android は未送信の操作を捨てる
  };
}

// Android版の書き込みを、目印（key）ごとに1回だけ行う。電波の切れ目で答えだけ届かずに送り直しても、
// 2回目は行わずに { dup: true } を返す（端末は最新を読み直す）。行ったら { result: 答え }
const ONCE_ = { setDone: setDone, saveTask: saveTask, deleteTask: deleteTask, bulkTasks: bulkTasks, copyTasks: copyTasks,
  patchTasks: patchTasks, saveList: saveList, moveLists: moveLists, deleteList: deleteList, saveSettings: saveSettings, saveTemplate: saveTemplate,
  deleteTemplate: deleteTemplate, useTemplate: useTemplate, addAttachment: addAttachment, removeAttachment: removeAttachment,
  restoreRows: restoreRows, undoable: undoable, bulkGroups: bulkGroups,
  deleteLists: deleteLists, restoreLists: restoreLists, saveSmart: saveSmart, deleteSmart: deleteSmart,
  patchLists: patchLists, restoreListValues: restoreListValues, convertTaskToFolder: convertTaskToFolder,
  convertFolderToTask: convertFolderToTask, undoConvert: undoConvert, backupNow: backupNow, undoPatchLists: undoPatchLists };
// 元に戻せる操作（undoable）の戻し方は、6時間だけ覚えておく。答えだけ届かずに送り直したとき（dup）も、
// 戻し方を返せるようにするため（{ dup: true, undo: 戻し方 }）
function once(key, fn, args, gen) {
  if (!Object.prototype.hasOwnProperty.call(ONCE_, fn)) throw new Error('知らない操作です：' + fn);
  const cid = 'o:' + String(key || '').slice(0, 80);
  return withLock_(function () {
    // v0.26.0：戻す前に端末にたまっていた操作は行わない（戻した中身を古い操作で上書きしないため）。鍵を取ってから、重複の判定より前に比べる。
    // 世代を送らない古い版の書き込みは、一度でも戻したあとは断る（Codex の指摘）
    const rg = PropertiesService.getScriptProperties().getProperty('RESTORE_GEN') || '';
    if ((gen == null && rg) || (gen != null && String(gen) !== rg)) return { restored: true, gen: rg };
    if (PropertiesService.getScriptProperties().getProperty('RESTORING')) throw new Error('バックアップから戻している途中です。少し待ってから開き直してください。');
    if (key && clientIdTask_(cid)) {
      const dup = { dup: true };
      const u = fn === 'undoable' ? keptUndo_(cid) : null;
      if (u) dup.undo = u;
      return dup;
    }
    const result = ONCE_[fn].apply(null, args || []);
    if (key) rememberClientId_(cid, '1');
    if (key && fn === 'undoable' && result && result.undo) keepUndo_(cid, result.undo);
    return { result: result };
  });
}
function keepUndo_(cid, undo) {
  try {
    const s = JSON.stringify(undo);
    if (s.length < 90000) CacheService.getScriptCache().put('U:' + cid, s, 21600);
  } catch (e) { /* 覚えられなくても、操作そのものは成功 */ }
}
function keptUndo_(cid) {
  try {
    const s = CacheService.getScriptCache().get('U:' + cid);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

function saveTask(t) {
  return withLock_(function () {
    // Android版が電波の切れ目で同じ追加を送り直したときは、前に作ったタスクを返す（2つ作らない）
    const cid = t && !t.id && t.clientId ? String(t.clientId).slice(0, 80) : '';
    if (t) delete t.clientId;
    if (cid) {
      const made = clientIdTask_(cid);
      const hit = made ? rows_(SHEET_TASKS, TASK_COLS).filter(function (x) { return x.id === made; })[0] : null;
      if (hit) return toTask_(hit);
    }
    const out = saveTask_(t);
    if (cid) rememberClientId_(cid, out.id);
    laterCal_();
    return out;
  });
}

// 端末の仮ID → 作ったタスクのID。1件ずつ別のプロパティに置き（1件9KBの上限に当たらない）、30日で消す
function clientIdTask_(cid) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty('CID:' + cid);
    return v ? JSON.parse(v)[0] : '';
  } catch (e) { return ''; }
}
function rememberClientId_(cid, id) {
  // 覚えられなくても、追加そのものは成功として返す
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    props.setProperty('CID:' + cid, JSON.stringify([id, now]));
    const all = props.getProperties();
    const keys = Object.keys(all).filter(function (k) { return k.indexOf('CID:') === 0; });
    const age = function (k) { try { return JSON.parse(all[k])[1] || 0; } catch (e) { return 0; } };
    keys.sort(function (x, y) { return age(y) - age(x); });
    keys.forEach(function (k, i) { if (i >= 2000 || now - age(k) > 30 * 86400000) props.deleteProperty(k); });
  } catch (e) { /* 何もしない */ }
}

function saveTask_(t) {
  const sh = sheet_(SHEET_TASKS, TASK_COLS);
  const all = rows_(SHEET_TASKS, TASK_COLS);
  const old = t.id ? pick_(all, t.id) : null;
  const now = nowStr_();
  const notifyAt = t.notifyAt || '';
  const id = old ? old.id : newId_();
  // 親タスクを渡されなければ、今の親のまま
  const parentTaskId = 'parentTaskId' in t ? t.parentTaskId || '' : old ? old.parentTaskId : '';
  const parent = parentTaskId ? all.filter(function (x) { return x.id === parentTaskId; })[0] : null;
  if (parentTaskId && !parent) throw new Error('親タスクが見つかりません（別の画面で消された可能性があります）。↻で読み直してください。');
  // 自分自身や自分の子・孫の下には入れられない
  for (let p = parent, i = 0; p && i < 100; i++) {
    if (p.id === id) throw new Error('自分の子タスクの下には入れられません');
    const pid = p.parentTaskId;
    p = pid ? all.filter(function (x) { return x.id === pid; })[0] : null;
  }
  const rec = {
    id: id,
    title: String(t.title || '').trim() || '(名前なし)',
    // 子タスクは親と同じフォルダ
    listId: parent ? parent.listId : t.listId || '',
    parentTaskId: parent ? parent.id : '',
    due: t.due || '',
    dueEnd: dueEndOf_(t, old),
    doDate: t.doDate || '',
    doEnd: t.doDate && t.doEnd && t.doEnd > t.doDate ? t.doEnd : '',
    repeat: cleanRepeat_(t.repeat),
    notifyAt: notifyAt,
    // 通知と並び順は、渡されなければ今のまま
    reminders: 'reminders' in t ? remList_(t.reminders).join(',') : old ? old.reminders : '',
    order: 'order' in t ? cleanOrder_(t.order) : old ? old.order : '',
    // 所要時間・その日の並び順も、渡されなければ今のまま（古い版の画面やAndroid版で直しても消えない）
    estimate: 'estimate' in t ? cleanEstimate_(t.estimate) : old ? old.estimate : '',
    dayOrder: 'dayOrder' in t ? cleanDayOrder_(t.dayOrder) : old ? old.dayOrder : '',
    // v0.23.0：いつか・優先度・ピン留めも、渡されなければ今のまま（古い画面・Android版で直しても消えない）
    isSomeday: 'isSomeday' in t ? (isOn_(t.isSomeday) ? '1' : '') : old ? old.isSomeday : '',
    priority: 'priority' in t ? cleanPriority_(t.priority) : old ? old.priority : '',
    isPinned: 'isPinned' in t ? (isOn_(t.isPinned) ? '1' : '') : old ? old.isPinned : '',
    memo: t.memo || '',
    // チェックリストを渡されなければ、今のまま
    checklist: 'checklist' in t ? cleanChecklist_(t.checklist) : old ? old.checklist : '',
    done: t.done ? '1' : '',
    // 同期で TickTick の完了済みを取り込むときは、TickTick で完了した日時（_doneAt）を使う（v0.16.0）
    doneAt: t.done ? (old && old.doneAt) || (!old && t._doneAt) || now : '',
    doneWith: t.done && old ? old.doneWith : '',
    wontDo: t.done && old ? old.wontDo : '',
    createdAt: old ? old.createdAt : now,
    updatedAt: now,
    // 繰り返しで作った次の回（完了を取り消すときに使う）
    nextId: old ? old.nextId : '',
    // 添付は addAttachment / removeAttachment だけで変える
    attachments: old ? old.attachments : '',
    gcalId: old ? old.gcalId : ''
  };
  // 「いつか」は期限を持たない。期限が入ったら（TickTick で期限を付けたときも）「いつか」を外す
  if (rec.due) rec.isSomeday = '';
  if (!rec.due) rec.dueEnd = '';
  // 繰り返しは日付を起点に次の回を作るので、日付が無ければ通知の日か今日を実行日にする
  if (rec.repeat !== 'none' && !rec.doDate && !rec.due) {
    rec.doDate = rec.notifyAt ? rec.notifyAt.slice(0, 10) : fmt_(new Date(), 'yyyy-MM-dd');
  }
  // 通知：変わらない日時の「送った」印は残す。新しく決めた日時がもう過ぎていれば送らない
  // （前からある日時は、過ぎていてもまだ送っていなければ送る）
  const sent = old ? sentList_(old) : [];
  const had = old ? fireTimes_(old) : [];
  rec.notified = fireTimes_(rec).filter(function (x) {
    return sent.indexOf(x) >= 0 || (x < now && had.indexOf(x) < 0);
  }).join(',');
  // 日付や繰り返しを変えなければ、繰り返しの起点（最初の回の日付）を引き継ぐ
  const same = old && old.repeat === rec.repeat && old.doDate === rec.doDate && old.doEnd === rec.doEnd
    && old.due === rec.due && old.notifyAt === rec.notifyAt && (old.dueEnd || '') === rec.dueEnd;
  rec.repeatBase = same ? old.repeatBase : '';
  rec.repeatCount = same ? old.repeatCount : '';
  // 同期で日付の持ち方だけを変えた（やる日 → 期限）：直した起点と回数を残す（以後の予定日を変えない。v0.17.0）
  if (old && t._keepRepeat && old.repeat === rec.repeat) { rec.repeatBase = t.repeatBase || ''; rec.repeatCount = old.repeatCount; }
  writeTask_(sh, old ? old._row : sh.getLastRow() + 1, rec);
  const also = [];
  // フォルダを移したら、子・孫も一緒に移す（画面が読み直さずに直せるように also にも入れる）
  if (old && old.listId !== rec.listId) {
    descendants_(all, rec.id).forEach(function (c) {
      c.listId = rec.listId;
      c.updatedAt = c.updatedAt ? now : ''; // 繰り返しの次の回の「手を加えていない」目印は残す
      writeTask_(sh, c._row, c);
      also.push(toTask_(c));
    });
  }
  // 未完了のタスクを完了した親の下に置いたら（子の追加など）、親・祖父母も未完了に戻す
  const drops = [];
  if (!rec.done) {
    ancestors_(all, rec).forEach(function (a) { if (isOn_(a.done)) markUndone_(sh, all, a, now, false, also, drops); });
  }
  dropRows_(sh, drops, also);
  const out = toTask_(rec);
  if (also.length) out.also = also;
  return out;
}

// v0.25.0：期限の終わり。渡されたらそれ（期限より後のときだけ）。渡されなければ（同期・古い画面）今のまま。
// 期限の日が変わったら同じ日数ずらし、期限が消えたら終わりも消す（Codex の指摘：期間が逆にならないように）
function dueEndOf_(t, old) {
  const due = t.due || '';
  if (!due) return '';
  if ('dueEnd' in t) return t.dueEnd && String(t.dueEnd) > due ? String(t.dueEnd) : '';
  const oe = old ? old.dueEnd || '' : '';
  if (!oe || !old.due) return '';
  if (old.due.slice(0, 10) === due.slice(0, 10)) return oe > due ? oe : '';
  const moved = addDaysStr_(oe, daysBetween_(old.due.slice(0, 10), due.slice(0, 10)));
  return moved > due ? moved : '';
}

// 完了・未完了を切り替える。繰り返しのタスクを完了したら、次の回を新しく作る。
// 親を完了すると子・孫も完了し、取り消すと一緒に完了した子・孫と、完了していた親も戻す。
// wont なら「やらない」で終える（子・孫も「やらない」になる。繰り返しは次の回を作る）
// day：完了した日（Android版が電波のない間にためた完了を、日をまたいで送るとき。次の回をこの日から数える）
function setDone(id, done, wont, day) {
  return withLock_(function () {
    const out = setDone_(id, done, wont, day);
    laterCal_();
    return out;
  });
}

function setDone_(id, done, wont, day) {
  const sh = sheet_(SHEET_TASKS, TASK_COLS);
  const all = rows_(SHEET_TASKS, TASK_COLS);
  const old = pick_(all, id);
  // もうその状態なら何もしない（Android版が答えの届かなかった操作を送り直したとき、完了の目印を書き換えない）
  if (done ? isOn_(old.done) && isOn_(old.wontDo) === !!wont : !isOn_(old.done)) return [toTask_(old)];
  const now = nowStr_();
  const out = [];
  const drops = [];
  if (done) {
    const kids = descendants_(all, id).filter(function (c) { return !isOn_(c.done); });
    // 親も子も繰り返しで次の回ができたら、子の次の回は親の次の回の下に付ける（moved: 元のID→次の回のID）
    const moved = {};
    const op = newId_();
    markDone_(sh, Object.assign({}, old), now, '*' + op, out, moved, wont, day);
    // 子・孫も完了にし、どの操作で完了したかを doneWith に残す（取り消すときの目印）。近い順に処理する
    kids.forEach(function (c) { markDone_(sh, c, now, op, out, moved, wont, day); });
  } else {
    // 同じ完了の操作で完了した子・孫だけを戻す
    const op = String(old.doneWith || '').replace(/^\*/, '');
    const kids = op ? descendants_(all, id).filter(function (c) { return isOn_(c.done) && c.doneWith === op; }) : [];
    // 子・孫を先に（深い順に）戻す。子の次の回が親の次の回の下にあっても、一緒に取り消せるように
    const kidOut = [];
    kids.reverse().forEach(function (c) { markUndone_(sh, all, c, now, false, kidOut, drops); });
    markUndone_(sh, all, Object.assign({}, old), now, true, out, drops);
    kidOut.reverse().forEach(function (x) { out.push(x); });
    // 完了した親の下で子だけ未完了にはしないので、親も未完了に戻す
    ancestors_(all, old).forEach(function (a) { if (isOn_(a.done)) markUndone_(sh, all, a, now, false, out, drops); });
  }
  dropRows_(sh, drops, out);
  return out;
}

// 行を消すのは最後に、下の行から（上の行の番号がずれないように）
function dropRows_(sh, drops, out) {
  drops.sort(function (x, y) { return y._row - x._row; }).forEach(function (d) {
    goneEvent_(d);
    sh.deleteRow(d._row); dirty_();
    out.push({ id: d.id, removed: true });
  });
}

// 1件を完了にする。繰り返しなら次の回を作る。
// mark は完了の操作の目印（押したタスクは * 付き）。親と一緒に完了したときは、
// 次の回の「手を加えていない」目印（updatedAt が空）を残す
function markDone_(sh, r, now, mark, out, moved, wont, day) {
  const row = r._row;
  delete r._row;
  r.done = '1';
  r.doneAt = now;
  r.doneWith = mark;
  r.wontDo = wont ? '1' : '';
  const own = mark.charAt(0) === '*';
  r.updatedAt = own || r.updatedAt ? now : '';
  let next = null;
  // 親と一緒に完了した子・孫は、親にも次の回ができたときだけ次の回を作る（親が終わったら子の繰り返しも終える。
  // 取り消せば繰り返しの設定はそのまま戻る）
  if (parseRepeat_(r.repeat) && (r.doDate || r.due) && (own || moved[r.parentTaskId])) {
    // 添付は完了した回に残し、次の回には引き継がない。チェックリストは全部未チェックに戻す。
    // updatedAt を空にして、手を加えたかどうかの目印にする
    next = Object.assign({}, r, { id: newId_(), done: '', doneAt: '', notified: '', createdAt: now, updatedAt: '', attachments: '', nextId: '', doneWith: '',
      wontDo: '', gcalId: '', dayOrder: '', checklist: cleanChecklist_(parseList_(r.checklist).map(function (x) { return { t: x.t, d: false }; })) });
    if (!advance_(next, day)) next = null;
  }
  if (next) {
    // 次の回の通知のうち、もう過ぎた時刻のものは送らない
    next.notified = fireTimes_(next).filter(function (x) { return x < now; }).join(',');
    if (moved[r.parentTaskId]) next.parentTaskId = moved[r.parentTaskId];
    moved[r.id] = next.id;
    r.repeat = 'none'; // 完了の記録として残す側は、もう繰り返さない
    r.nextId = next.id;
    writeTask_(sh, sh.getLastRow() + 1, next);
  }
  writeTask_(sh, row, r);
  out.push(toTask_(r));
  if (next) out.push(toTask_(next));
}

// 1件を未完了に戻す。繰り返しの完了を取り消すときは、作った次の回を消して繰り返しを元に戻す。
// 次の回に手を加えていたら（完了・編集・添付・子タスクの追加）、消さずに残す
function markUndone_(sh, all, r, now, self, out, drops) {
  const row = r._row;
  delete r._row;
  r.done = '';
  r.doneAt = '';
  r.doneWith = '';
  r.wontDo = '';
  r.updatedAt = self || r.updatedAt ? now : '';
  if (r.nextId) {
    const nx = all.filter(function (x) { return x.id === r.nextId; })[0];
    // 次の回に子が付いていたら残す（同じ操作で消す子の次の回は数えない）
    const hasKids = nx && all.some(function (x) { return x.parentTaskId === nx.id && drops.indexOf(x) < 0; });
    if (nx && !isOn_(nx.done) && !nx.updatedAt && !nx.attachments && !hasKids && drops.indexOf(nx) < 0) {
      r.repeat = nx.repeat;
      drops.push(nx);
    }
    r.nextId = '';
  }
  writeTask_(sh, row, r);
  out.push(toTask_(r));
}

// 消したタスク（子・孫も）の id を返す
function deleteTask(id) {
  return withLock_(function () {
    const ids = deleteTask_(id);
    laterCal_();
    return { ids: ids };
  });
}

function deleteTask_(id) {
  const all = rows_(SHEET_TASKS, TASK_COLS);
  const old = pick_(all, id);
  // 子・孫も一緒に消す。下の行から消すと、上の行の番号がずれない
  const gone = [old].concat(descendants_(all, id));
  const sh = sheet_(SHEET_TASKS, TASK_COLS);
  gone.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) {
    // 添付ファイルはドライブのゴミ箱へ（30日以内なら戻せる）
    parseAttach_(r.attachments).forEach(function (a) { trashFile_(a.id); });
    goneEvent_(r);
    sh.deleteRow(r._row); dirty_();
  });
  return gone.map(function (r) { return r.id; });
}

// 一覧のドラッグで、並び順・フォルダ・親タスク・日付をまとめて変える。終わったら全部のタスクを返す
// （所要時間 estimate・その日の並び順 dayOrder も変えられる）
function patchTasks(items) {
  return withLock_(function () {
    const KEYS = ['listId', 'parentTaskId', 'doDate', 'doEnd', 'due', 'dueEnd', 'estimate', 'isSomeday', 'priority', 'isPinned'];
    (items || []).forEach(function (it) {
      if (!KEYS.some(function (k) { return k in it; })) return;
      const t = toTask_(pick_(rows_(SHEET_TASKS, TASK_COLS), it.id));
      KEYS.forEach(function (k) { if (k in it) t[k] = it[k]; });
      if ('due' in it && !('dueEnd' in it)) delete t.dueEnd; // v0.25.0：期限だけ動かしたら、期限の終わりは同じ日数ずらす（dueEndOf_）
      saveTask_(t);
    });
    // 並び順だけなら、その行の順番だけを書き換える（更新日時などは変えない）
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const all = rows_(SHEET_TASKS, TASK_COLS);
    (items || []).forEach(function (it) {
      if (!('order' in it) && !('dayOrder' in it)) return;
      const r = all.filter(function (x) { return x.id === it.id; })[0];
      if (!r) return;
      if ('order' in it) r.order = cleanOrder_(it.order);
      if ('dayOrder' in it) r.dayOrder = cleanDayOrder_(it.dayOrder);
      writeRow_(sh, r._row, TASK_COLS, r);
    });
    laterCal_();
    return allTasks_();
  });
}

// 選んだタスクをまとめて変える。action: done（完了）・wont（やらない）・delete（削除）・move（フォルダへ移す）・
// date（実行日を value の日に。期間の長さと時刻はそのまま）・clearDate（実行日を外す）
function bulkTasks(ids, action, value, day) {
  return withLock_(function () {
    const r = bulk_(ids, action, value, day);
    laterCal_();
    return { tasks: allTasks_(), failed: r.failed.length, failedIds: r.failed, gone: r.gone };
  });
}
// できなかったタスク（failed）と、もう無かったタスク（gone）の id を返す。できた分はそのまま残る
function bulk_(ids, action, value, day) {
  const failed = [];
  const gone = [];
  const picked = {};
  (ids || []).forEach(function (id) { picked[id] = true; });
  (ids || []).forEach(function (id) {
    try {
      const all = rows_(SHEET_TASKS, TASK_COLS);
      const r = all.filter(function (x) { return x.id === id; })[0];
      if (!r) { gone.push(id); return; } // 別の画面で消された・親と一緒に消えたなど
      // 親も選んでいれば、子・孫は親と一緒に変わる
      const withParent = ancestors_(all, r).some(function (a) { return picked[a.id]; });
      if (action === 'done' || action === 'wont') {
        // 選んだ順に関係なく、未完了の親を選んでいれば子は親と一緒に終える
        const byParent = ancestors_(all, r).some(function (a) { return picked[a.id] && !isOn_(a.done); });
        if (!isOn_(r.done) && !byParent) setDone_(id, true, action === 'wont', day);
      } else if (action === 'delete') {
        if (!withParent) deleteTask_(id);
      } else {
        const t = toTask_(r);
        if (action === 'move') {
          if (withParent || t.listId === value) return;
          t.listId = value;
          t.parentTaskId = ''; // 子タスクは親と同じフォルダなので、別のフォルダへ移すと親から外れる
        } else if (action === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日付が読めません');
          if (t.doDate) {
            const n = daysBetween_(t.doDate.slice(0, 10), value);
            t.doDate = addDaysStr_(t.doDate, n);
            t.doEnd = t.doEnd ? addDaysStr_(t.doEnd, n) : '';
          } else {
            t.doDate = value;
          }
        } else if (action === 'clearDate') {
          t.doDate = '';
          t.doEnd = '';
        } else if (action === 'priority') {
          t.priority = cleanPriority_(value);
        } else if (action === 'pin') {
          t.isPinned = isOn_(value);
        } else if (action === 'estimate') {
          t.estimate = cleanEstimate_(value); // v0.25.0（9番）
        } else if (action === 'repeat') {
          t.repeat = cleanRepeat_(value);
        } else if (action === 'reminders') {
          t.reminders = remList_(value);
        } else {
          throw new Error('知らない操作です：' + action);
        }
        saveTask_(t);
      }
    } catch (e) {
      failed.push(id);
    }
  });
  return { failed: failed, gone: gone };
}

// 朝の段取りの「振り分け」：別々の日付への移動などを、1回の操作（1回で元に戻せる）にまとめる。
// groups は [{ ids, action, value }]（action は bulkTasks と同じ）
function bulkGroups(groups, day) {
  return withLock_(function () {
    const failed = [];
    const gone = [];
    (groups || []).slice(0, 50).forEach(function (g) {
      if (!g || !Array.isArray(g.ids)) return;
      const r = bulk_(g.ids.slice(0, 500), String(g.action || ''), g.value == null ? '' : String(g.value), day);
      r.failed.forEach(function (id) { failed.push(id); });
      r.gone.forEach(function (id) { gone.push(id); });
    });
    laterCal_();
    return { tasks: allTasks_(), failed: failed.length, failedIds: failed, gone: gone };
  });
}

// ---- 元に戻す ----
// 画面から「元に戻せる操作」をするときは、ここを通す。操作の前と後のタスクの行を比べて、
// 変わった行の前の中身（rows）と、新しくできた行の id（created）を返す。restoreRows に渡すと前の状態に戻る
// （一緒に変わった親・子、完了の目印、繰り返しの次の回もまとめて戻る）
const UNDOABLE_ = { saveTask: saveTask, setDone: setDone, patchTasks: patchTasks, bulkTasks: bulkTasks,
  deleteTask: deleteTask, addTasks: addTasks, copyTasks: copyTasks, bulkGroups: bulkGroups, patchLists: function (a, b, c) { return patchLists(a, b, c); } };
function undoable(fn, args) {
  if (!Object.prototype.hasOwnProperty.call(UNDOABLE_, fn)) throw new Error('知らない操作です：' + fn);
  return withLock_(function () {
    // Android版の新しいタスクの追加（clientId 付き）は once を通らないので、戻し方を clientId で覚えておく。
    // 答えだけ届かずに送り直したときは、前に作ったタスクが返るだけで戻し方が空になるため、覚えていた戻し方を返す（6時間）
    const t0 = fn === 'saveTask' && args && args[0];
    const newCid = t0 && !t0.id && t0.clientId ? 'C:' + String(t0.clientId).slice(0, 80) : '';
    const before = taskMap_();
    const result = UNDOABLE_[fn].apply(null, args || []);
    const after = taskMap_();
    const rows = [];
    const created = [];
    const was = {}; // 操作の直後の中身（戻すときに、別の画面で変えられていないかを見る）
    Object.keys(before).forEach(function (id) {
      if (after[id] && after[id].key === before[id].key) return;
      rows.push(before[id].rec);
      if (after[id]) was[id] = after[id].mine;
    });
    Object.keys(after).forEach(function (id) { if (!before[id]) { created.push(id); was[id] = after[id].mine; } });
    let undo = { rows: rows, created: created, was: was };
    if (newCid) {
      if (created.length) keepUndo_(newCid, undo);
      else if (!rows.length) undo = keptUndo_(newCid) || undo;
    }
    return { result: result, undo: undo };
  });
}
// 操作とは別に変わる列（カレンダーの予定・送った通知・添付と、そのときの更新日時）。別の画面での変更とは見なさない
const OUTSIDE_COLS_ = { gcalId: true, notified: true, attachments: true, updatedAt: true };
// id → 行の中身（rec）と、比べるための文字（key＝全部の列、mine＝操作で変わる列だけ）
function taskMap_() {
  const out = {};
  rows_(SHEET_TASKS, TASK_COLS).forEach(function (r) {
    const rec = {};
    TASK_COLS.forEach(function (c) { rec[c] = r[c] == null ? '' : String(r[c]); });
    out[r.id] = { rec: rec, key: JSON.stringify(TASK_COLS.map(function (c) { return rec[c]; })), mine: mine_(rec) };
  });
  return out;
}
function mine_(r) {
  return JSON.stringify(TASK_COLS.filter(function (c) { return !OUTSIDE_COLS_[c]; })
    .map(function (c) { return r[c] == null ? '' : String(r[c]); }));
}
// undoable が返した undo で、操作の前に戻す
function restoreRows(undo) {
  return withLock_(function () {
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const ok = function (id) { return /^[0-9a-zA-Z]{6,40}$/.test(String(id || '')); };
    const rows = ((undo && undo.rows) || []).slice(0, 5000).filter(function (o) { return o && ok(o.id); });
    const created = {};
    ((undo && undo.created) || []).slice(0, 5000).forEach(function (id) { if (ok(id)) created[id] = true; });
    const now = {};
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (r) { now[r.id] = r; });
    // 0. 操作のあとに別の画面（スマホなど）で変えられた行があれば、その変更を消さないように何もしない
    //    （できた行があとで消されたのは、戻しても同じなのでそのまま進める）
    const was = (undo && undo.was) || {};
    Object.keys(was).forEach(function (id) {
      const gone = !now[id];
      if (gone ? !created[id] : mine_(now[id]) !== String(was[id])) {
        throw new Error('別の画面であとから変更されたので、元に戻せませんでした');
      }
    });
    //    消す行の下に、あとから子が足されていても止める（子だけが残らないように）
    Object.keys(now).forEach(function (id) {
      if (!created[id] && created[now[id].parentTaskId]) throw new Error('別の画面であとから変更されたので、元に戻せませんでした');
    });
    //    戻す行の親タスクとフォルダが、戻したあとにもあるかを見る（別の画面で消されていたら止める）
    //    親子が輪にならないか、子が親と同じフォルダにいるか、完了の親の下に未完了の子がないかも、戻したあとの形で見る。
    //    戻す行だけでなく全部の行を見る（あとから足された子が、戻す親とずれることもあるため）。
    //    ただし前からずれていた行（消したフォルダに残った完了タスクなど）では止めない
    const shape = function (r) { return { p: String(r.parentTaskId || ''), l: String(r.listId || ''), d: isOn_(r.done) }; };
    const cur = {};
    const left = {}; // id → 戻したあとの親とフォルダ
    Object.keys(now).forEach(function (id) { cur[id] = shape(now[id]); if (!created[id]) left[id] = cur[id]; });
    rows.forEach(function (o) { left[o.id] = shape(o); });
    const folders = {};
    lists_().forEach(function (l) { folders[l.id] = true; });
    const broken = function (map, start) {
      if (!folders[map[start].l]) return true;
      const seen = {};
      for (let id = start; map[id].p; id = map[id].p) {
        const up = map[map[id].p];
        seen[id] = true;
        if (!up || seen[map[id].p] || up.l !== map[id].l || (up.d && !map[id].d)) return true;
      }
      return false;
    };
    Object.keys(left).forEach(function (id) {
      if (broken(left, id) && !(cur[id] && broken(cur, id))) throw new Error('別の画面であとから変更されたので、元に戻せませんでした');
    });
    const clean = function (o) {
      const rec = {};
      TASK_COLS.forEach(function (c) { rec[c] = o[c] == null ? '' : String(o[c]).slice(0, 50000); });
      return rec;
    };
    // 1. 今もある行は、前の中身で書き直す。カレンダーの予定は今のものを使って直す。
    //    添付は元に戻せる操作では変わらないので、あとから付けた・外した添付を消さないように今のものを残す。
    //    送った通知の記録は、前と今の両方を残す（あとから送った通知をもう一度送らないように）
    const append = [];
    rows.forEach(function (o) {
      const rec = clean(o);
      const cur = now[rec.id];
      if (!cur) { append.push(rec); return; }
      rec.gcalId = cur.gcalId;
      rec.attachments = cur.attachments;
      const sent = {};
      String(rec.notified || '').split(',').concat(String(cur.notified || '').split(',')).forEach(function (x) { if (x) sent[x] = true; });
      rec.notified = Object.keys(sent).join(',');
      writeTask_(sh, cur._row, rec);
    });
    // 2. 操作でできた行を消す（下の行から）
    Object.keys(created).map(function (id) { return now[id]; }).filter(Boolean)
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (r) {
        parseAttach_(r.attachments).forEach(function (a) { trashFile_(a.id); }); // あとから付けた添付もごみ箱へ
        goneEvent_(r);
        sh.deleteRow(r._row); dirty_();
      });
    // 3. 消えた行を書き足す（添付はごみ箱から戻す。予定は消えているので書き込み直す）
    append.forEach(function (rec) {
      rec.gcalId = '';
      parseAttach_(rec.attachments).forEach(function (a) {
        try { DriveApp.getFileById(a.id).setTrashed(false); } catch (e) { /* 戻せなければそのまま */ }
      });
      writeTask_(sh, sh.getLastRow() + 1, rec);
    });
    laterCal_();
    return allTasks_();
  });
}

// 選んだタスクを、子・孫ごと複製する（コピー・貼り付け）。listId があればそのフォルダへ、なければ元と同じフォルダへ。
// 完了・添付は写さない。作ったタスクの id（親から順）も返す
function copyTasks(ids, listId) {
  return withLock_(function () {
    const all = rows_(SHEET_TASKS, TASK_COLS);
    const picked = {};
    (ids || []).forEach(function (id) { picked[id] = true; });
    const made = [];
    const copy = function (r, parentId, target, depth) {
      const t = toTask_(r);
      const sameList = !target || target === t.listId;
      const rec = saveTask_({ title: t.title, memo: t.memo, checklist: t.checklist, repeat: t.repeat, reminders: t.reminders,
        doDate: t.doDate, doEnd: t.doEnd, due: t.due, notifyAt: t.notifyAt, estimate: t.estimate, isSomeday: t.isSomeday, priority: t.priority,
        listId: target || t.listId, parentTaskId: parentId || (depth === 0 && sameList ? t.parentTaskId : ''),
        order: depth === 0 && sameList && t.order !== '' ? t.order + 0.5 : t.order });
      made.push(rec.id);
      if (depth < 20) all.filter(function (x) { return x.parentTaskId === r.id && !isOn_(x.done); })
        .forEach(function (k) { copy(k, rec.id, '', depth + 1); });
    };
    (ids || []).slice(0, 200).forEach(function (id) {
      const r = all.filter(function (x) { return x.id === id; })[0];
      if (!r || ancestors_(all, r).some(function (a) { return picked[a.id]; })) return;
      copy(r, '', listId || '', 0);
    });
    laterCal_();
    return { tasks: allTasks_(), ids: made };
  });
}

// 何行かの文字を貼ったとき：1行ずつタスクにする（items は {title, listId, doDate, parentTaskId} の並び）
function addTasks(items) {
  return withLock_(function () {
    const made = [];
    (items || []).slice(0, 200).forEach(function (it) {
      if (!String(it && it.title || '').trim()) return;
      made.push(saveTask_({ title: it.title, listId: it.listId || '', doDate: it.doDate || '', parentTaskId: it.parentTaskId || '' }).id);
    });
    laterCal_();
    return { tasks: allTasks_(), ids: made };
  });
}

// ---- テンプレート ----

// data は画面で作る（{title, memo, checklist, repeat, reminders, kids:[...]}）
function saveTemplate(name, data) {
  return withLock_(function () {
    const sh = sheet_(SHEET_TEMPLATES, TEMPLATE_COLS);
    const d = cleanTpl_(data, 0);
    writeRow_(sh, sh.getLastRow() + 1, TEMPLATE_COLS,
      { id: newId_(), name: String(name || '').trim().slice(0, 100) || d.title, data: JSON.stringify(d), createdAt: nowStr_() });
    return templates_();
  });
}

function deleteTemplate(id) {
  return withLock_(function () {
    const r = pick_(rows_(SHEET_TEMPLATES, TEMPLATE_COLS), id);
    sheet_(SHEET_TEMPLATES, TEMPLATE_COLS).deleteRow(r._row); dirty_();
    return templates_();
  });
}

// テンプレートからタスクを作る（子タスクも）。base は {listId, doDate}。終わったら全部のタスクを返す
function useTemplate(id, base) {
  return withLock_(function () {
    const r = pick_(rows_(SHEET_TEMPLATES, TEMPLATE_COLS), id);
    let d;
    try { d = JSON.parse(r.data); } catch (e) { throw new Error('テンプレートが壊れています'); }
    const b = base || {};
    const make = function (o, parentId, depth) {
      const made = saveTask_({ title: o.title, memo: o.memo, checklist: o.checklist, repeat: o.repeat, reminders: o.reminders,
        estimate: o.estimate, listId: b.listId || '', parentTaskId: parentId, doDate: depth ? '' : b.doDate || '' });
      if (depth < 20) (o.kids || []).forEach(function (k) { make(k, made.id, depth + 1); });
    };
    make(cleanTpl_(d, 0), '', 0);
    laterCal_();
    return allTasks_();
  });
}

function cleanTpl_(o, depth) {
  o = o || {};
  return {
    title: String(o.title || '').trim().slice(0, 500) || '(名前なし)',
    memo: String(o.memo || '').slice(0, 5000),
    checklist: parseList_(o.checklist).map(function (x) { return { t: x.t, d: false }; }),
    repeat: cleanRepeat_(o.repeat),
    reminders: remList_(o.reminders),
    estimate: safeEstimate_(o.estimate),
    kids: depth < 20 && Array.isArray(o.kids) ? o.kids.slice(0, 100).map(function (k) { return cleanTpl_(k, depth + 1); }) : []
  };
}

function templates_() {
  return rows_(SHEET_TEMPLATES, TEMPLATE_COLS).map(function (r) {
    let d = {};
    try { d = JSON.parse(r.data); } catch (e) { /* 壊れていても名前は出す */ }
    return { id: r.id, name: r.name, title: d.title || '', kids: (d.kids || []).length };
  });
}

// 添付ファイルをドライブの「ToDoアプリ_添付」フォルダに保存して、タスクに付ける
function addAttachment(taskId, name, mimeType, base64, key) {
  // Android版が電波の切れ目で同じ添付を送り直したときは、前に付けた分を返す（2つ付けない）
  const cid = key ? 'a:' + String(key).slice(0, 80) : '';
  if (cid) {
    const fileId = clientIdTask_(cid);
    const row = fileId ? rows_(SHEET_TASKS, TASK_COLS).filter(function (x) { return x.id === taskId; })[0] : null;
    if (row && parseAttach_(row.attachments).some(function (a) { return a.id === fileId; })) return toTask_(row);
  }
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > MAX_ATTACH_BYTES) throw new Error('10MBより大きいファイルは添付できません');
  const file = attachFolder_().createFile(Utilities.newBlob(bytes, mimeType || 'application/octet-stream', name));
  try {
    const out = attachTo_(taskId, file, name);
    if (cid) rememberClientId_(cid, file.getId());
    return out;
  } catch (e) {
    trashFile_(file.getId()); // タスクが見つからなければ、置いたファイルも片付ける
    throw e;
  }
}

function attachTo_(taskId, file, name) {
  return withLock_(function () {
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const old = findRow_(SHEET_TASKS, TASK_COLS, taskId);
    const list = parseAttach_(old.attachments);
    list.push({ id: file.getId(), name: name, url: file.getUrl() });
    old.attachments = JSON.stringify(list);
    old.updatedAt = nowStr_();
    writeRow_(sh, old._row, TASK_COLS, old);
    return toTask_(old);
  });
}

function removeAttachment(taskId, fileId) {
  return withLock_(function () {
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const old = findRow_(SHEET_TASKS, TASK_COLS, taskId);
    old.attachments = JSON.stringify(parseAttach_(old.attachments).filter(function (a) { return a.id !== fileId; }));
    old.updatedAt = nowStr_();
    writeRow_(sh, old._row, TASK_COLS, old);
    trashFile_(fileId);
    return toTask_(old);
  });
}

function saveList(l) {
  return withLock_(function () {
    const sh = sheet_(SHEET_LISTS, LIST_COLS);
    const all = rows_(SHEET_LISTS, LIST_COLS);
    const old = l.id ? findRow_(SHEET_LISTS, LIST_COLS, l.id) : null;
    const parentId = l.parentId || '';
    if (old && parentId) {
      // 自分自身や自分の下のフォルダの中には移せない
      let p = parentId;
      for (let i = 0; p && i < 100; i++) {
        if (p === old.id) throw new Error('自分の中のフォルダには移せません');
        const hit = all.filter(function (x) { return x.id === p; })[0];
        p = hit ? hit.parentId : '';
      }
    }
    const maxOrder = all.reduce(function (m, x) { return Math.max(m, Number(x.order) || 0); }, 0);
    const rec = {
      id: old ? old.id : newId_(),
      name: String(l.name || '').trim() || '(名前なし)',
      isWork: old ? old.isWork : '',
      order: old ? old.order : String(maxOrder + 1),
      parentId: parentId,
      color: 'color' in l ? cleanColor_(l.color) : old ? old.color : '',
      icon: 'icon' in l ? cleanIcon_(l.icon) : old ? old.icon : '',
      closed: 'closed' in l ? (isOn_(l.closed) ? '1' : '') : old ? old.closed || '' : '',
      keyword: 'keyword' in l ? cleanKeyword_(l.keyword) : old ? old.keyword || '' : '',
      calId: 'calId' in l ? String(l.calId || '').slice(0, 200) : old ? old.calId || '' : ''
    };
    writeRow_(sh, old ? old._row : sh.getLastRow() + 1, LIST_COLS, rec);
    // 色や場所が変わったら、中のタスクのカレンダーの予定の色も変える
    if (old && (old.color !== rec.color || old.parentId !== rec.parentId) && calSyncOn_()) {
      const lists = rows_(SHEET_LISTS, LIST_COLS);
      rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) {
        if (t.gcalId && underList_(lists, t.listId, rec.id)) TOUCHED_[t.id] = true;
      });
      laterCal_();
    }
    return toList_(rec);
  });
}

// v0.18.0：フォルダをドラッグで動かす（並べ替え・別のフォルダの下へ）。items＝[{id, order, parentId}]（変わるものだけ）
// 自分や自分の下のフォルダの中には入れない。答えは並べ直したフォルダの一覧
function moveLists(items) {
  return withLock_(function () {
    const sh = sheet_(SHEET_LISTS, LIST_COLS);
    const all = rows_(SHEET_LISTS, LIST_COLS);
    const byId = {};
    all.forEach(function (x) { byId[x.id] = x; });
    const moved = {};
    (items || []).forEach(function (it) {
      const r = byId[it && it.id];
      if (!r) return;
      if ('parentId' in it) {
        const pid = it.parentId && byId[it.parentId] ? String(it.parentId) : '';
        for (let p = pid, i = 0; p && i < 100; i++) {
          if (p === r.id) throw new Error('自分の中のフォルダには移せません');
          p = byId[p] ? byId[p].parentId : '';
        }
        if (r.parentId !== pid) { r.parentId = pid; moved[r.id] = true; }
      }
      if ('order' in it && isFinite(Number(it.order))) r.order = String(Number(it.order));
      writeRow_(sh, r._row, LIST_COLS, r);
    });
    // 場所が変わったら、中のタスクのカレンダーの予定の色も変える（saveList と同じ）
    if (Object.keys(moved).length && calSyncOn_()) {
      const lists = rows_(SHEET_LISTS, LIST_COLS);
      rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) {
        if (t.gcalId && Object.keys(moved).some(function (id) { return underList_(lists, t.listId, id); })) TOUCHED_[t.id] = true;
      });
      laterCal_();
    }
    return lists_();
  });
}

function deleteList(id) {
  return withLock_(function () {
    const kids = rows_(SHEET_LISTS, LIST_COLS).filter(function (x) { return x.parentId === id; });
    if (kids.length) throw new Error('中にフォルダが ' + kids.length + ' 個あるので消せません。先に中のフォルダを移すか消してください。');
    const left = rows_(SHEET_TASKS, TASK_COLS).filter(function (t) { return t.listId === id && !isOn_(t.done); });
    if (left.length) throw new Error('このフォルダには未完了のタスクが ' + left.length + ' 件あるので消せません。先に移すか完了にしてください。');
    const old = findRow_(SHEET_LISTS, LIST_COLS, id);
    // v0.23.0：古い Android 版からでも Inbox は消さない（deleteLists と同じ。Codex の指摘）
    if (old.name === INBOX_NAME && !old.parentId) throw new Error(INBOX_NAME + ' は TickTick の受信箱とつながっているので消せません');
    sheet_(SHEET_LISTS, LIST_COLS).deleteRow(old._row); dirty_();
    return id;
  });
}

// v0.23.0：フォルダをまとめて消す（中のフォルダ・中のタスクも一緒に。2026-11-07 本人がカードで決定）。
// 答えの undo を restoreLists に渡すと、消したフォルダとタスクを元に戻せる（6時間以内などの決まりはなく、画面が持っている間）
// 一番上の Inbox は TickTick の受信箱とつながっているので消さない
function deleteLists(ids) {
  return withLock_(function () {
    const lists = rows_(SHEET_LISTS, LIST_COLS);
    const byId = {};
    lists.forEach(function (l) { byId[l.id] = l; });
    const gone = {};
    const add = function (id, depth) {
      if (!byId[id] || gone[id] || depth > 100) return;
      gone[id] = true;
      lists.forEach(function (l) { if (l.parentId === id) add(l.id, depth + 1); });
    };
    (ids || []).slice(0, 500).forEach(function (id) {
      const l = byId[id];
      if (!l) return;
      if (l.name === INBOX_NAME && !l.parentId) throw new Error(INBOX_NAME + ' は TickTick の受信箱とつながっているので消せません');
      add(id, 0);
    });
    const goneLists = lists.filter(function (l) { return gone[l.id]; });
    if (!goneLists.length) return { lists: lists_(), tasks: allTasks_(), undo: { lists: [], rows: [] }, nLists: 0, nTasks: 0 };
    const all = rows_(SHEET_TASKS, TASK_COLS);
    const pick = {};
    all.forEach(function (t) { if (gone[t.listId]) { pick[t.id] = true; descendants_(all, t.id).forEach(function (c) { pick[c.id] = true; }); } });
    const goneTasks = all.filter(function (t) { return pick[t.id]; });
    const recOf = function (r, cols) { const o = {}; cols.forEach(function (c) { o[c] = r[c] == null ? '' : String(r[c]); }); return o; };
    const undo = { lists: goneLists.map(function (l) { return recOf(l, LIST_COLS); }), rows: goneTasks.map(function (t) { return recOf(t, TASK_COLS); }) };
    const tsh = sheet_(SHEET_TASKS, TASK_COLS);
    goneTasks.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) {
      parseAttach_(r.attachments).forEach(function (a) { trashFile_(a.id); }); // 添付はごみ箱へ（元に戻すと戻る）
      goneEvent_(r);
      tsh.deleteRow(r._row); dirty_();
    });
    const lsh = sheet_(SHEET_LISTS, LIST_COLS);
    goneLists.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { lsh.deleteRow(r._row); dirty_(); });
    ttMarkGoneLists_(gone, true);
    laterCal_();
    return { lists: lists_(), tasks: allTasks_(), undo: undo, nLists: goneLists.length, nTasks: goneTasks.length };
  });
}

// deleteLists の undo で、消したフォルダとタスクを戻す。もうある id はそのまま（2回押しても増えない）
function restoreLists(undo) {
  return withLock_(function () {
    const ok = function (id) { return /^[0-9a-zA-Z]{6,40}$/.test(String(id || '')); };
    const lsh = sheet_(SHEET_LISTS, LIST_COLS);
    const have = {};
    rows_(SHEET_LISTS, LIST_COLS).forEach(function (l) { have[l.id] = true; });
    // 件数で打ち切らない（消せた分は全部戻す。戻せなかった行は short で知らせる。Codex の指摘）
    const wantLists = (undo && undo.lists) || [];
    const wantRows = (undo && undo.rows) || [];
    let short = 0;
    const back = wantLists.filter(function (o) { if (o && ok(o.id)) return !have[o.id]; short++; return false; });
    const coming = {};
    back.forEach(function (o) { coming[o.id] = true; });
    back.forEach(function (o) {
      const rec = {};
      LIST_COLS.forEach(function (c) { rec[c] = o[c] == null ? '' : String(o[c]).slice(0, 1000); });
      if (rec.parentId && !have[rec.parentId] && !coming[rec.parentId]) rec.parentId = ''; // 上のフォルダがもう無ければ一番上へ
      writeRow_(lsh, lsh.getLastRow() + 1, LIST_COLS, rec);
      have[rec.id] = true;
    });
    const tsh = sheet_(SHEET_TASKS, TASK_COLS);
    const tHave = {};
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) { tHave[t.id] = true; });
    let nTasks = 0;
    wantRows.forEach(function (o) {
      if (!o || !ok(o.id)) { short++; return; }
      if (tHave[o.id]) return;
      const rec = {};
      TASK_COLS.forEach(function (c) { rec[c] = o[c] == null ? '' : String(o[c]).slice(0, 50000); });
      rec.gcalId = '';
      parseAttach_(rec.attachments).forEach(function (a) {
        try { DriveApp.getFileById(a.id).setTrashed(false); } catch (e) { /* 戻せなければそのまま */ }
      });
      writeTask_(tsh, tsh.getLastRow() + 1, rec);
      tHave[rec.id] = true;
      nTasks++;
    });
    ttMarkGoneLists_(coming, false);
    laterCal_();
    return { lists: lists_(), tasks: allTasks_(), nLists: back.length, nTasks: nTasks, short: short };
  });
}

// v0.23.0：アプリで消したフォルダに、TickTick の対応表で「消した」印を付ける（次の同期で作り直さない。Codex の指摘）。
// 元に戻したら印を外す（同じ id のフォルダが戻るので、対応はそのまま使える）。TickTick のリストそのものは消さない
function ttMarkGoneLists_(ids, on) {
  if (!Object.keys(ids).length) return;
  if (!ss_().getSheetByName(SHEET_TT)) return;
  const msh = sheet_(SHEET_TT, TT_COLS);
  ttMapRows_().forEach(function (m) {
    if ((m.kind !== 'list' && m.kind !== 'group') || !ids[m.appId]) return;
    const snap = Object.assign({}, m.snapObj || {});
    if (on === !!snap.gone) return;
    if (on) snap.gone = true; else delete snap.gone;
    m.snapObj = snap;
    ttWriteMap_(msh, m);
  });
}

// ---- スマートリスト（v0.23.0） ----
// 条件（cond）：{ lists: [フォルダの id]（空ならすべて。中のフォルダも含む）, due: 期限の条件, doDate: 実行日の条件, pri: [優先度の数]（空ならどれでも） }
// 日付の条件は相対：'' どれでも・'over' 過ぎた・'today' 今日まで・'tomorrow' 明日まで・'week' 7日以内・'none' なし・'any' あり・'someday' いつか（期限だけ）
const SMART_DATES_ = ['', 'over', 'today', 'tomorrow', 'week', 'none', 'any', 'someday'];
function cleanSmartCond_(c) {
  c = c || {};
  const date = function (v, someday) { v = String(v || ''); return SMART_DATES_.indexOf(v) >= 0 && (someday || v !== 'someday') ? v : ''; };
  return {
    lists: (Array.isArray(c.lists) ? c.lists : []).map(String).filter(function (x) { return /^[0-9a-zA-Z]{1,40}$/.test(x); }).slice(0, 100),
    due: date(c.due, true),
    doDate: date(c.doDate, false),
    pri: (Array.isArray(c.pri) ? c.pri : []).map(Number).filter(function (n, i, a) { return [0, 1, 3, 5].indexOf(n) >= 0 && a.indexOf(n) === i; })
  };
}
function smart_() {
  return rows_(SHEET_SMART, SMART_COLS).map(function (r) {
    let c = {};
    try { c = JSON.parse(r.cond || '{}'); } catch (e) { /* 壊れていたら条件なし */ }
    return { id: r.id, name: r.name, order: Number(r.order) || 0, cond: cleanSmartCond_(c), rev: Number(r.rev) || 0, icon: cleanIcon_(r.icon) };
  }).sort(function (a, b) { return a.order - b.order; });
}
// 作る・直す。直すときは画面が持っている rev が今のものと同じときだけ（別の画面で直したあとに古い中身で上書きしない）
function saveSmart(o) {
  return withLock_(function () {
    o = o || {};
    const sh = sheet_(SHEET_SMART, SMART_COLS);
    const all = rows_(SHEET_SMART, SMART_COLS);
    const old = o.id ? all.filter(function (r) { return r.id === o.id; })[0] : null;
    if (o.id && !old) throw new Error('スマートリストが見つかりません（別の画面で消された可能性があります）。↻で読み直してください。');
    if (old && 'rev' in o && Number(o.rev) !== (Number(old.rev) || 0)) throw new Error('別の画面でこのスマートリストが直されました。↻で読み直してから、もう一度どうぞ。');
    const maxOrder = all.reduce(function (m, x) { return Math.max(m, Number(x.order) || 0); }, 0);
    const rec = {
      id: old ? old.id : newId_(),
      name: String(o.name == null ? (old ? old.name : '') : o.name).trim().slice(0, 100) || '(名前なし)',
      order: 'order' in o && isFinite(Number(o.order)) ? String(Number(o.order)) : old ? old.order : String(maxOrder + 1),
      cond: JSON.stringify(cleanSmartCond_('cond' in o ? o.cond : old ? JSON.parse(old.cond || '{}') : {})),
      fmt: '1',
      rev: String((old ? Number(old.rev) || 0 : 0) + 1),
      icon: 'icon' in o ? cleanIcon_(o.icon) : old ? old.icon : ''
    };
    writeRow_(sh, old ? old._row : sh.getLastRow() + 1, SMART_COLS, rec);
    return smart_();
  });
}
function deleteSmart(id) {
  return withLock_(function () {
    const r = rows_(SHEET_SMART, SMART_COLS).filter(function (x) { return x.id === id; })[0];
    if (r) { sheet_(SHEET_SMART, SMART_COLS).deleteRow(r._row); dirty_(); }
    return smart_();
  });
}

function saveSettings(obj) {
  return withLock_(function () {
    const sh = sheet_(SHEET_SETTINGS, SETTING_COLS);
    const rows = rows_(SHEET_SETTINGS, SETTING_COLS, 'key');
    Object.keys(obj || {}).forEach(function (k) {
      if (!(k in DEFAULT_SETTINGS)) return;
      const hit = rows.filter(function (r) { return r.key === k; })[0];
      const row = hit ? hit._row : sh.getLastRow() + 1;
      writeRow_(sh, row, SETTING_COLS, { key: k, value: String(obj[k] == null ? '' : obj[k]) });
      if (k === 'appIcon') { try { PropertiesService.getScriptProperties().setProperty('APP_ICON', String(obj[k] || '')); } catch (e) { /* タブの色が次に変わらないだけ */ } }
      if (!hit) rows.push({ key: k, _row: row });
    });
    return settings_();
  });
}

// v0.36.0（受付1・本人「カレンダーに限らず表示の状態は端末・Web/Android をまたいで保存」）：
// 表示の状態（隠すフォルダ・カレンダー、まとまり、開け閉め、並べ方、カレンダーの表示、文字の大きさ など）を設定の ui に持つ。
// 鍵ごとに、サーバーが受け取った時刻を持つ（Web と Android が同時に書いても他の鍵を消さない。端末は届いた時刻より新しいものだけ入れる）
const UI_MAX = 45000;
function uiMap_(s) { try { const m = JSON.parse(String((s || settings_()).ui || '') || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch (e) { return {}; } }
function setUi(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('表示の状態が分かりません');
  return withLock_(function () {
    const m = uiMap_(settings_());
    Object.keys(patch).slice(0, 200).forEach(function (k) {
      const v = patch[k];
      if (!/^[\w:.\-@|]{1,120}$/.test(k) || !Array.isArray(v) || v.length !== 2) return;
      // 時刻はサーバーの時計で付ける（Codex の指摘：端末の時計がずれていても、届いた順に新しい）。端末の時刻 v[1] は使わない
      const at = Math.max(Date.now(), m[k] ? (Number(m[k][1]) || 0) + 1 : 0);
      m[k] = [v[0] == null ? null : v[0], at];
    });
    // 大きくなりすぎたら、古い並べ方から捨てる（1つのセルに入る大きさまで）
    let txt = JSON.stringify(m);
    if (txt.length > UI_MAX) {
      const ks = Object.keys(m).sort(function (a, b) { return (Number(m[a][1]) || 0) - (Number(m[b][1]) || 0); });
      for (let i = 0; i < ks.length && txt.length > UI_MAX; i++) { if (/^sort:/.test(ks[i]) || m[ks[i]][0] == null) { delete m[ks[i]]; txt = JSON.stringify(m); } }
      if (txt.length > UI_MAX) throw new Error('表示の状態が大きすぎます');
    }
    return saveSettings({ ui: txt });
  });
}

// v0.35.0（受付5）：予定のアーカイブ（終わった印）。印は Google カレンダーではなくアプリの表（設定の evDone）に持つ
// （Codex：extendedProperties.private は予定の写しに付き「その人だけの印」にならない）。鍵は カレンダー|予定のid（繰り返しはその回の id）。
// 1つずつ足し外しして、Web と Android が同時に書いても他の印を消さない。終わりの日から400日たった印と、500件を超えた古い印は捨てる
const EV_DONE_MAX = 500;
function evDoneMap_(s, kind) { try { const m = JSON.parse(String(s[kind || 'evDone'] || '') || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch (e) { return {}; } }
function setEvDone(key, on, endDay) { return setEvMark('evDone', key, on, endDay); }
// v0.35.0（受付4・本人「チェックを付けるかどうかで決めて」）：仮の予定の印も同じ表に持つ（kind＝evDone／evTent）
function setEvMark(kind, key, on, endDay) {
  if (kind !== 'evDone' && kind !== 'evTent') throw new Error('印の種類が違います');
  key = String(key || '').slice(0, 300);
  if (!/^[^|]+\|[^|]+$/.test(key)) throw new Error('予定が分かりません');
  return withLock_(function () {
    const m = evDoneMap_(settings_(), kind);
    if (isOn_(on)) m[key] = /^\d{4}-\d{2}-\d{2}$/.test(String(endDay || '')) ? String(endDay) : fmt_(new Date(), 'yyyy-MM-dd');
    else delete m[key];
    const old = fmt_(new Date(Date.now() - 400 * 864e5), 'yyyy-MM-dd');
    let ks = Object.keys(m).filter(function (k) { return m[k] >= old; }).sort(function (a, b) { return m[b] < m[a] ? -1 : m[b] > m[a] ? 1 : 0; });
    ks = ks.slice(0, EV_DONE_MAX);
    const out = {};
    ks.forEach(function (k) { out[k] = m[k]; });
    const o = {}; o[kind] = JSON.stringify(out);
    return saveSettings(o);
  });
}

// Googleカレンダーの予定を読む（start〜end の前日まで。日付は yyyy-MM-dd）
// v0.26.0（25番）：カレンダー×期間ごとに5分だけサーバーに覚える（同じ月を何度も読まない）。予定に id・カレンダーの id と名前を足す（v0.27.0 の編集の下準備）
const EVENT_CACHE_SEC = 300;
// v0.29.0（10番の4）：予定の色（Googleカレンダーの予定の色 1〜11）。空＝カレンダーの色
const EV_COLORS = { '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000' };
function evColorHex_(id) { return EV_COLORS[String(id || '')] || ''; }
// v0.28.0：フォルダの「予定を入れるカレンダー」も読む（設定で選んでいなくても、フォルダの帯・カレンダーに出す。入れた予定が消えて見えた）
function calendarIdsOf_(s) {
  let fc = [];
  try { fc = rows_(SHEET_LISTS, LIST_COLS).map(function (l) { return String(l.calId || ''); }).filter(String); } catch (e) { fc = []; }
  return ['primary'].concat(String(s.calendarIds || '').split(/[,\s、，;；]+/).filter(String), fc).filter(function (x, i, a) { return a.indexOf(x) === i; });
}
function getEvents(start, end) {
  const s = settings_();
  const ids = calendarIdsOf_(s);
  // タスクを書き込んでいるカレンダーは読まない（タスクと二重に出るので）
  const syncId = PropertiesService.getScriptProperties().getProperty('SYNC_CAL_ID');
  const from = new Date(start + 'T00:00:00+09:00');
  const to = new Date(end + 'T00:00:00+09:00');
  const cache = CacheService.getScriptCache();
  let out = [];
  let primaryId = '';
  try { primaryId = CalendarApp.getDefaultCalendar().getId(); } catch (e) { primaryId = ''; }
  ids.forEach(function (id) {
    if (id !== 'primary' && id === primaryId) return; // いつものカレンダーを二重に読まない
    // v0.27.0：書いたらそのカレンダーの世代（EVV:）を変えて、覚えた分を使わない
    const ck = 'EV2:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, id + '|' + start + '|' + end + '|' + (cache.get('EVV:' + id) || '')));
    let hit = null;
    try { const c = cache.get(ck); if (c) hit = JSON.parse(c); } catch (e) { hit = null; }
    if (hit) { out = out.concat(hit); return; }
    let cal = null;
    try { cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id); } catch (e) { cal = null; }
    if (!cal || (syncId && cal.getId() === syncId)) return;
    const color = cal.getColor();
    const calId = id === 'primary' ? 'primary' : cal.getId();
    const calName = cal.getName();
    const writable = calWritable_(calId);
    const got = cal.getEvents(from, to).map(function (e) {
      const allDay = e.isAllDayEvent();
      let ec = '';
      try { ec = evColorHex_(e.getColor()); } catch (x) { ec = ''; }
      return {
        id: e.getId(),
        calendarId: calId,
        calendar: calName,
        title: e.getTitle() || '(予定)',
        allDay: allDay,
        start: allDay ? fmt_(e.getAllDayStartDate(), 'yyyy-MM-dd') : fmt_(e.getStartTime(), "yyyy-MM-dd'T'HH:mm"),
        end: allDay ? fmt_(e.getAllDayEndDate(), 'yyyy-MM-dd') : fmt_(e.getEndTime(), "yyyy-MM-dd'T'HH:mm"),
        color: ec || color,
        colorId: ec ? Object.keys(EV_COLORS).filter(function (k) { return EV_COLORS[k] === ec; })[0] : '',
        writable: writable,
        recurring: e.isRecurringEvent(),
        folder: evFolderTag_(e)
      };
    });
    // 覚えるのは 100KB（バイト）未満のときだけ。超えたら全部返し、覚えるのだけやめる
    try { const j = JSON.stringify(got); if (Utilities.newBlob(j).getBytes().length < 95000) cache.put(ck, j, EVENT_CACHE_SEC); } catch (e) { /* 覚えられなくても読めている */ }
    out = out.concat(got);
  });
  return out;
}

// ---- v0.27.0（17番）：アプリの中で予定を作る・直す・消す ----
// 書けるのは権限が owner・writer のカレンダーだけ（祝日・人のカレンダーは見るだけ）。権限は Advanced Calendar で調べ、6時間覚える
// 予定の見分けは calendarId＋id（iCalUID）＋開始。書くときはその日の前後から、その1回（instance）を探して、その回の id で書く
function evFolderTag_(e) { try { return e.getTag('todoFolder') || ''; } catch (x) { return ''; } }
// v0.29.0（2番）：業務（タスク）に結びつけた予定の見えない印
function evTaskTag_(e) { try { return e.getTag('todoTask') || ''; } catch (x) { return ''; } }
function evPriv_(it, k) { return (it.extendedProperties && it.extendedProperties.private && it.extendedProperties.private[k]) || ''; }
// v0.28.0（5番）：調べるのに失敗したら覚えない（前は失敗を「見るだけ」として6時間覚え、書けるカレンダーにも書けなかった）。
// 自分のカレンダーは CalendarApp だけで「書ける」と分かる。人のカレンダーは Advanced Calendar の権限で見る。
// 返す値：'w'＝書ける、'r'＝見るだけ（はっきり分かったときだけ）、''＝分からない（書いてみて、本当の失敗の理由を出す）
let CAL_ROLE_ERR_ = '';
function calRole_(calId) {
  if (!calId) return '';
  const cache = CacheService.getScriptCache();
  const k = 'CA2:' + calId; // 前の版の覚え（CA:）は使わない
  const hit = cache.get(k);
  if (hit === 'w' || hit === 'r') return hit;
  let role = '';
  try {
    const cal = calId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calId);
    if (cal && (calId === 'primary' || cal.isOwnedByMe())) role = 'w';
  } catch (e) { /* 次で調べる */ }
  if (!role) {
    try {
      const a = Calendar.CalendarList.get(calId).accessRole || '';
      role = a === 'owner' || a === 'writer' ? 'w' : a ? 'r' : '';
    } catch (e) { CAL_ROLE_ERR_ = String(e && e.message || e); role = ''; }
  }
  if (role) { try { cache.put(k, role, 21600); } catch (e) { /* なし */ } }
  return role;
}
function calWritable_(calId) { return calRole_(calId) !== 'r'; }
function needWritable_(calId) {
  if (!calId) throw new Error('書き込むカレンダーが決まっていません');
  if (calRole_(calId) === 'r') throw new Error('このカレンダーには書き込めません（見るだけのカレンダーです）');
}
// 書けるカレンダーを一度にまとめて調べる（失敗したら空。覚えるのは分かった分だけ）
function writableIds_() {
  const out = {};
  try {
    const cache = CacheService.getScriptCache();
    let tok = null;
    do {
      const r = Calendar.CalendarList.list({ minAccessRole: 'writer', maxResults: 250, pageToken: tok || undefined });
      (r.items || []).forEach(function (c) { out[c.id] = true; try { cache.put('CA2:' + c.id, 'w', 21600); } catch (e) { /* なし */ } });
      tok = r.nextPageToken;
    } while (tok);
  } catch (e) { CAL_ROLE_ERR_ = String(e && e.message || e); }
  return out;
}
// 書いたら、そのカレンダーの覚えた予定を使わない（primary と本当の ID の両方）
function evTouched_(calId) {
  const cache = CacheService.getScriptCache();
  const v = String(Date.now());
  const ids = [calId];
  try { const p = CalendarApp.getDefaultCalendar().getId(); if (calId === 'primary') ids.push(p); else if (calId === p) ids.push('primary'); } catch (e) { /* なし */ }
  ids.forEach(function (id) { cache.put('EVV:' + id, v, 21600); });
}
function evStartStr_(t) {
  if (!t) return '';
  if (t.date) return t.date;
  return fmt_(new Date(t.dateTime), "yyyy-MM-dd'T'HH:mm");
}
// 画面と同じ形（終日の終わりは次の日＝含まない）
function evOut_(it, calId) {
  const allDay = !!(it.start && it.start.date);
  return {
    id: it.iCalUID, calendarId: calId, title: it.summary || '(予定)', allDay: allDay,
    start: evStartStr_(it.start), end: evStartStr_(it.end), writable: true,
    recurring: !!(it.recurringEventId || (it.recurrence && it.recurrence.length)), desc: it.description || '',
    folder: evPriv_(it, 'todoFolder'), task: evPriv_(it, 'todoTask'),
    colorId: it.colorId || '', color: evColorHex_(it.colorId) || undefined, location: it.location || '', apiId: it.id || ''
  };
}
function evTimes_(o) {
  const allDay = isOn_(o.allDay);
  let st = String(o.start || ''), en = String(o.end || '');
  if (allDay) {
    st = st.slice(0, 10); en = en.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st)) throw new Error('日付が読めません');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(en) || en <= st) en = fmt_(new Date(new Date(st + 'T00:00:00+09:00').getTime() + 864e5), 'yyyy-MM-dd');
    return { start: { date: st, dateTime: null }, end: { date: en, dateTime: null } };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(st)) throw new Error('日時が読めません');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(en) || en <= st) en = fmt_(new Date(new Date(st + ':00+09:00').getTime() + 30 * 6e4), "yyyy-MM-dd'T'HH:mm");
  return { start: { dateTime: st + ':00+09:00', timeZone: TZ, date: null }, end: { dateTime: en + ':00+09:00', timeZone: TZ, date: null } };
}
function evBody_(o) {
  const b = evTimes_(o);
  if ('title' in o) b.summary = String(o.title || '').trim() || '(予定)';
  if ('desc' in o) b.description = String(o.desc || '');
  // v0.29.0（10番）：場所・色・通知
  if ('location' in o) { b.location = String(o.location || ''); rememberPlace_(b.location); }
  if ('colorId' in o) b.colorId = EV_COLORS[String(o.colorId || '')] ? String(o.colorId) : null;
  if ('remind' in o) b.reminders = evRemind_(o.remind);
  return b;
}
// 通知：'def'＝カレンダーの既定、'none'＝なし、数字＝何分前（いくつか並べるときは配列）。アプリの通知ではなく Googleカレンダーの通知
function evRemind_(v) {
  if (v === 'def' || v === '' || v == null) return { useDefault: true };
  // 元に戻す用：Googleの形のまま（メール通知などの種類も残す。Codex の指摘）
  if (typeof v === 'object' && !Array.isArray(v)) return v.useDefault ? { useDefault: true } : { useDefault: false, overrides: (v.overrides || []).filter(function (x) {
    return x && (x.method === 'popup' || x.method === 'email') && Number.isInteger(Number(x.minutes)) && x.minutes >= 0 && x.minutes <= 40320; }).slice(0, 5).map(function (x) { return { method: x.method, minutes: Number(x.minutes) }; }) };
  const list = (Array.isArray(v) ? v : [v]).map(Number).filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 40320; }).slice(0, 5);
  return { useDefault: false, overrides: list.map(function (n) { return { method: 'popup', minutes: n }; }) };
}
function evRemindOut_(r) {
  if (!r || r.useDefault) return 'def';
  const o = (r.overrides || []).map(function (x) { return x.minutes; });
  return o.length ? o : 'none';
}
// 繰り返しの決まり（RRULE を1行）。画面が作る形だけ通す
function evRule_(v) {
  const r = String(v || '').trim();
  if (!r) return '';
  if (!/^RRULE:[A-Z0-9=;,+\-]+$/.test(r) || !/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.test(r)) throw new Error('繰り返しの決まりが読めません');
  return r;
}
// ref＝{calendarId, id, start}。その1回を探す（見つからなければ、ほかの画面で直された・消された）
function evInstance_(ref) {
  const st = String(ref.start || '');
  const t0 = new Date((st.length === 10 ? st + 'T00:00:00' : st + ':00') + '+09:00');
  if (isNaN(t0.getTime())) throw new Error('予定の日時が読めません');
  const r = Calendar.Events.list(ref.calendarId, { singleEvents: true, timeMin: new Date(t0.getTime() - 864e5).toISOString(), timeMax: new Date(t0.getTime() + 2 * 864e5).toISOString(), maxResults: 2500 });
  // 候補が0件・2件以上なら書かない（同じ系列の2回を同じ時刻へ動かした等。取り違えを防ぐ。Codex の答え）
  const hits = (r.items || []).filter(function (it) { return it.iCalUID === ref.id && it.status !== 'cancelled' && evStartStr_(it.start) === st; });
  if (!hits.length) throw new Error('予定が見つかりません（Googleカレンダーで直された・消された可能性があります）。読み直してください');
  if (hits.length > 1) throw new Error('同じ時刻に同じ予定が2つあり、どちらか決められません。Googleカレンダーで直してください');
  return hits[0];
}
// 予定のメモなど（押して窓を開くときだけ読む）
function getEventDetail(ref) {
  const it = evInstance_(ref);
  let rule = '';
  if (it.recurringEventId) {
    try { rule = ((Calendar.Events.get(ref.calendarId, it.recurringEventId).recurrence || []).filter(function (r) { return /^RRULE:/i.test(r); })[0]) || ''; } catch (e) { rule = ''; }
  }
  return {
    desc: it.description || '', location: it.location || '', recurring: !!it.recurringEventId, link: it.htmlLink || '',
    colorId: it.colorId || '', remind: evRemindOut_(it.reminders), repeat: rule, files: evFiles_(it),
    remindRaw: it.reminders && !it.reminders.useDefault ? { useDefault: false, overrides: (it.reminders.overrides || []).slice(0, 5) } : null // v0.30.0：複製でメール通知などの種類も写す
  };
}
// ---- v0.29.0（10番の8）：予定の添付ファイル ----
// 今はドライブ（タスクの添付と同じ「ToDoアプリ_添付」フォルダ）に置き、Googleカレンダーの予定の添付として結ぶ。
// 画面に渡す形は {id, name, url, mime} だけにして、置き場を変えても（将来アプリの中で持つ）画面は変えなくてよいようにする
function evFiles_(it) {
  return (it.attachments || []).map(function (a) { return { id: a.fileId || '', name: a.title || 'ファイル', url: a.fileUrl || '', mime: a.mimeType || '' }; });
}
function evFilePut_(name, mime, base64) {
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > MAX_ATTACH_BYTES) throw new Error('10MBより大きいファイルは添付できません');
  const f = attachFolder_().createFile(Utilities.newBlob(bytes, mime || 'application/octet-stream', name));
  return { fileId: f.getId(), fileUrl: f.getUrl(), title: name, mimeType: mime || 'application/octet-stream' };
}
// 読んでから書くまでを鍵で1つずつにする（同時に足すと先の添付を落とすため。Codex の指摘）
function addEventFile(ref, name, mime, base64) {
  needWritable_(ref.calendarId);
  const a = evFilePut_(String(name || 'ファイル'), mime, base64);
  let out;
  try {
    out = withLock_(function () {
      const it = evInstance_(ref);
      const list = (it.attachments || []).concat([a]);
      if (list.length > 25) throw new Error('添付は1つの予定に25個までです');
      return Calendar.Events.patch({ attachments: list }, ref.calendarId, it.id, { supportsAttachments: true });
    });
  } catch (e) {
    // 書けたか分からないときは読み直し、付いていなければファイルを片付ける
    let on = false;
    try { on = (evInstance_(ref).attachments || []).some(function (x) { return x.fileId === a.fileId; }); } catch (e2) { on = true; }
    if (!on) trashFile_(a.fileId);
    throw e;
  }
  try { evTouched_(ref.calendarId); } catch (e) { /* 覚えの更新に失敗しても添付はできている */ }
  return evFiles_(out);
}
// 予定から外すだけ（ドライブのファイルは消さない。複製した予定などがまだ使っているかもしれないため。Codex の指摘）
function removeEventFile(ref, fileId) {
  needWritable_(ref.calendarId);
  const out = withLock_(function () {
    const it = evInstance_(ref);
    const list = (it.attachments || []).filter(function (a) { return a.fileId !== fileId; });
    if (list.length === (it.attachments || []).length) throw new Error('その添付はこの予定に付いていません。読み直してください');
    return Calendar.Events.patch({ attachments: list }, ref.calendarId, it.id, { supportsAttachments: true });
  });
  try { evTouched_(ref.calendarId); } catch (e) { /* なし */ }
  return evFiles_(out);
}
// 5：繰り返しの予定を作ったのを元に戻す（作った系列をまるごと消す。apiId は作ったときに返した Google の id）
function undoCreateEvent(calId, apiId) {
  needWritable_(calId);
  if (!apiId) throw new Error('元に戻す予定が分かりません');
  Calendar.Events.remove(calId, apiId);
  evTouched_(calId);
  return true;
}
// ---- v0.29.0（10番の7）：別のカレンダーへ移す。繰り返しの予定は系列ごと移す ----
function moveEvent(ref, dest) {
  if (!dest || dest === ref.calendarId) throw new Error('移す先のカレンダーを選んでください');
  needWritable_(ref.calendarId);
  needWritable_(dest);
  const it = evInstance_(ref);
  const out = Calendar.Events.move(ref.calendarId, it.recurringEventId || it.id, dest);
  evTouched_(ref.calendarId);
  evTouched_(dest);
  const r = evOut_(out, dest);
  if (it.recurringEventId) r.start = ref.start; // 系列の最初の回ではなく、押した回を返す
  return r;
}
// ---- v0.30.0：予定の場所を地図から選ぶ・今いる場所（Apps Script の Maps。鍵は要らない） ----
// 地図の画像（中心・ズーム・大きさ）。画面はこの画像の上で押した所から緯度経度を計算する
function placeMap(lat, lng, zoom, w, hgt) {
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('場所が正しくありません');
  lat = Math.max(-85.0511, Math.min(85.0511, lat)); lng = ((lng + 180) % 360 + 360) % 360 - 180; // 範囲の外は直す（Codex の指摘）
  const z = Math.max(3, Math.min(19, Math.round(Number(zoom) || 15)));
  const W = Math.max(100, Math.min(640, Math.round(Number(w) || 400))), H = Math.max(100, Math.min(640, Math.round(Number(hgt) || 400)));
  // v0.31.0（受付4）：速くする。JPEG で小さくし、同じ場所・同じ大きさは6時間覚えておく
  const key = 'PM1:' + lat.toFixed(5) + ',' + lng.toFixed(5) + ',' + z + ',' + W + 'x' + H;
  const cache = CacheService.getScriptCache();
  let url = cache.get(key);
  if (!url) {
    const b = Maps.newStaticMap().setSize(W, H).setCenter(lat, lng).setZoom(z).setLanguage('ja').setFormat(Maps.StaticMap.Format.JPG).getBlob();
    url = 'data:image/jpeg;base64,' + Utilities.base64Encode(b.getBytes());
    if (url.length < 95000) { try { cache.put(key, url, 21600); } catch (e) { /* 覚えられなくてもよい */ } }
  }
  return { url: url, lat: lat, lng: lng, zoom: z, w: W, h: H };
}
// 緯度経度 → 住所（日本語、「日本、〒」は外す）
function placeName(lat, lng) {
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90) throw new Error('場所が正しくありません');
  lng = ((lng + 180) % 360 + 360) % 360 - 180;
  const r = Maps.newGeocoder().setLanguage('ja').reverseGeocode(lat, lng);
  const x = r && r.results && r.results[0];
  const name = x ? placeTidy_(x.formatted_address) : '';
  return { name: name || (lat.toFixed(6) + ',' + lng.toFixed(6)), lat: lat, lng: lng };
}
// 場所の文字 → 緯度経度（地図を開くときの中心。見つからなければ null）
function placeFind(q) {
  q = String(q || '').trim();
  if (!q) return null;
  const r = Maps.newGeocoder().setLanguage('ja').setRegion('jp').geocode(q);
  const x = r && r.results && r.results[0];
  return x ? { lat: x.geometry.location.lat, lng: x.geometry.location.lng, name: placeTidy_(x.formatted_address) } : null;
}
function placeTidy_(s) { return String(s || '').replace(/^日本、\s*/, '').replace(/^〒\d{3}-\d{4}\s*/, '').trim(); }
// ---- v0.31.0（受付3・5）：場所の欄に打つと候補を出す ----
// ①前に使った場所（予定に入れた場所を30件まで覚える）②名前の候補（Places API。鍵は本人が ⚙ で入れる。サーバーだけに置く）
// 鍵がない・失敗したときは Google の住所検索（Geocoder）の候補にする
function placesKey_() { return PropertiesService.getScriptProperties().getProperty('PLACES_KEY') || ''; }
function recentPlaces_() { try { return JSON.parse(PropertiesService.getUserProperties().getProperty('RECENT_PLACES') || '[]'); } catch (e) { return []; } }
function rememberPlace_(loc) {
  loc = String(loc || '').trim();
  if (!loc || loc.length > 200) return;
  try {
    const list = [loc].concat(recentPlaces_().filter(function (x) { return x !== loc; })).slice(0, 30);
    PropertiesService.getUserProperties().setProperty('RECENT_PLACES', JSON.stringify(list));
  } catch (e) { /* 覚えられなくてもよい */ }
}
// Places の名前の候補（1回＝1リクエストの課金。家族の利用なら毎月の無料の範囲）。同じ言葉は10分覚える・1日300回まで・失敗したら10分休む（Codex の指摘）
function placesFetch_(q, key) {
  const body = { input: q, languageCode: 'ja', regionCode: 'jp', includedRegionCodes: ['jp'],
    locationBias: { circle: { center: { latitude: 33.8392, longitude: 132.7657 }, radius: 50000 } } };
  const r = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:autocomplete', { method: 'post', contentType: 'application/json',
    headers: { 'X-Goog-Api-Key': key }, payload: JSON.stringify(body), muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() !== 200) throw new Error((j.error && j.error.message) || ('HTTP ' + r.getResponseCode()));
  return (j.suggestions || []).map(function (x) { return x.placePrediction; }).filter(Boolean).slice(0, 5).map(function (p) {
    const f = p.structuredFormat || {};
    return { name: (f.mainText && f.mainText.text) || (p.text && p.text.text) || '', sub: placeTidy_(f.secondaryText && f.secondaryText.text) };
  }).filter(function (x) { return x.name; });
}
const PLACES_DAY_MAX = 300;
function placeSuggest(q) {
  q = String(q || '').trim().slice(0, 100);
  const key = placesKey_();
  const out = { past: [], items: [], places: !!key, err: '' };
  if (!q) { out.past = recentPlaces_().slice(0, 5); return out; }
  const ql = q.toLowerCase();
  out.past = recentPlaces_().filter(function (x) { return x.toLowerCase().indexOf(ql) >= 0; }).slice(0, 3);
  if (q.length < 2) return out;
  const cache = CacheService.getScriptCache();
  const ck = 'PS1:' + (key ? 'p:' : 'g:') + Utilities.base64EncodeWebSafe(q).slice(0, 200);
  const hit = cache.get(ck);
  if (hit) { try { out.items = JSON.parse(hit); return out; } catch (e) { /* 読み直す */ } }
  if (key && !cache.get('PS_FAIL')) {
    const dk = 'PS_N:' + fmt_(new Date(), 'yyyy-MM-dd');
    const n = Number(cache.get(dk) || 0);
    if (n < PLACES_DAY_MAX) {
      cache.put(dk, String(n + 1), 90000);
      try { out.items = placesFetch_(q, key); } catch (e) { out.err = String(e.message || e).slice(0, 200); cache.put('PS_FAIL', '1', 600); }
    } else out.err = '今日の候補の回数（' + PLACES_DAY_MAX + '回）を超えたので、住所の候補だけにしています';
  }
  if (!out.items.length) {
    try {
      // v0.35.0（受付6）：住所の候補は、そのままと「愛媛県」を前に付けた2回を合わせて最大3つ（1つしか出ないことが多かった）
      const geo = Maps.newGeocoder().setLanguage('ja').setRegion('jp');
      const seen = {};
      [q].concat(/愛媛|松山/.test(q) ? [] : ['愛媛県 ' + q]).forEach(function (qq) {
        if (out.items.length >= 3) return;
        let g = null;
        try { g = geo.geocode(qq); } catch (e) { g = null; }
        ((g && g.results) || []).forEach(function (x) {
          const n = placeTidy_(x.formatted_address);
          if (!n || seen[n] || out.items.length >= 3) return;
          seen[n] = 1;
          out.items.push({ name: n, sub: '' });
        });
      });
      out.places = out.places && !out.err;
    } catch (e) { /* 候補なし */ }
  }
  if (out.items.length && !out.err) { try { cache.put(ck, JSON.stringify(out.items), 600); } catch (e) { /* 覚えなくてもよい */ } }
  return out;
}
// ⚙ から鍵を入れる・消す（空で消す）。保存の前に新しい鍵で1回試し、だめなら今までの鍵はそのまま（Codex の指摘）
function setPlacesKey(k) {
  k = String(k || '').trim();
  const p = PropertiesService.getScriptProperties();
  if (!k) { p.deleteProperty('PLACES_KEY'); return { places: false }; }
  if (!/^[\w-]{20,100}$/.test(k)) throw new Error('鍵の形が違います。Google Cloud の「API キー」をそのまま貼ってください。');
  try { placesFetch_('松山市役所', k); } catch (e) { throw new Error('鍵で試しましたが使えませんでした（今までの設定はそのままです）：' + String(e.message || e).slice(0, 200)); }
  p.setProperty('PLACES_KEY', k);
  CacheService.getScriptCache().remove('PS_FAIL');
  return { places: true };
}
function placesStatus() { return { places: !!placesKey_() }; }
// v0.32.0（A6）：設定の「接続」に出す、つながりの様子（Web・Android 共通）
function connStatus() {
  let t = {};
  try { t = ttStatus(); } catch (e) { t = {}; }
  // 実際に読めるカレンダーの数（権限切れ・消されたものは数えない。Codex の指摘）
  let cals = 0, want = 0;
  try {
    const ids = calendarIdsOf_(settings_());
    want = ids.length;
    ids.forEach(function (id) { try { if (id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id)) cals++; } catch (e) {} });
  } catch (e) { cals = -1; }
  return { tt: { keys: t.hasKeys, connected: t.connected, sync: t.sync, at: (t.status && t.status.at) || '' }, places: !!placesKey_(), cals: cals, want: want, at: new Date().toISOString() };
}
// ---- v0.29.0（10番の9）：予定の検索（表示しているカレンダー、1年前〜2年先、名前・メモ・場所） ----
function searchEvents(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const s = settings_();
  const syncId = PropertiesService.getScriptProperties().getProperty('SYNC_CAL_ID');
  let primaryId = '';
  try { primaryId = CalendarApp.getDefaultCalendar().getId(); } catch (e) { primaryId = ''; }
  const now = Date.now();
  let out = [];
  calendarIdsOf_(s).forEach(function (id) {
    if (id !== 'primary' && id === primaryId) return;
    if (syncId && id === syncId) return;
    let r, cal;
    try {
      cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
      if (!cal) return;
      r = Calendar.Events.list(id, { q: q, singleEvents: true, orderBy: 'startTime', maxResults: 50, timeMin: new Date(now - 365 * 864e5).toISOString(), timeMax: new Date(now + 730 * 864e5).toISOString() });
    } catch (e) { return; }
    const color = cal.getColor(), name = cal.getName(), w = calWritable_(id);
    (r.items || []).forEach(function (it) {
      if (it.status === 'cancelled') return;
      const e = evOut_(it, id);
      e.calendar = name; e.color = e.color || color; e.writable = w;
      out.push(e);
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out.slice(0, 100);
}
function createEvent(o) {
  const calId = o.calendarId || 'primary';
  needWritable_(calId);
  const body = evBody_(Object.assign({ title: '' }, o));
  const priv = {};
  if (o.folderId) priv.todoFolder = String(o.folderId);
  if (o.taskId) priv.todoTask = String(o.taskId);
  if (Object.keys(priv).length) body.extendedProperties = { private: priv };
  const rule = evRule_(o.repeat);
  if (rule) body.recurrence = [rule];
  // 複製：元の予定の添付（ドライブのファイル）もそのまま結ぶ
  if (Array.isArray(o.files) && o.files.length) body.attachments = o.files.filter(function (f) { return f && f.id && f.url; }).slice(0, 25).map(function (f) { return { fileId: f.id, fileUrl: f.url, title: f.name || 'ファイル', mimeType: f.mime || '' }; });
  const it = Calendar.Events.insert(body, calId, body.attachments ? { supportsAttachments: true } : {});
  // v0.28.1：読み直し（getEvents）は CalendarApp の getTag で印を読む。同じ道具でも印を付けておく（付けないと読み直したとき帯から消えた）
  if (Object.keys(priv).length) {
    try {
      const cal = calId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calId);
      const ce = cal && cal.getEventById(it.iCalUID || it.id);
      if (ce) Object.keys(priv).forEach(function (k) { ce.setTag(k, priv[k]); });
    } catch (e) { console.warn('フォルダの印を付けられませんでした: ' + e); }
  }
  evTouched_(calId);
  return evOut_(it, calId);
}
// scope：'one'（この回だけ・繰り返しでない予定）か 'after'（この回から後の繰り返しすべて）。答え＝{ev, before}（before は元に戻す用、'after' はなし）
function updateEvent(ref, o, scope) {
  needWritable_(ref.calendarId);
  const it = evInstance_(ref);
  const before = { title: it.summary || '', allDay: !!it.start.date, start: evStartStr_(it.start), end: evStartStr_(it.end), desc: it.description || '',
    location: it.location || '', colorId: it.colorId || '', remind: it.reminders || { useDefault: true } };
  let out, noUndo = scope === 'after' && it.recurringEventId;
  if (noUndo) out = evSplit_(ref.calendarId, it, o);
  else {
    const body = evBody_(o);
    // v0.29.0：繰り返しでない予定に繰り返しを付ける（元に戻すはなし）。繰り返しの1回だけを直すときは決まりは変えない
    if ('repeat' in o && !it.recurringEventId) {
      const rule = evRule_(o.repeat);
      if (rule) { body.recurrence = [rule]; noUndo = true; }
    }
    out = Calendar.Events.patch(body, ref.calendarId, it.id);
  }
  evTouched_(ref.calendarId);
  return { ev: evOut_(out, ref.calendarId), before: noUndo ? null : before };
}
function deleteEvent(ref, scope) {
  needWritable_(ref.calendarId);
  const it = evInstance_(ref);
  const before = { calendarId: ref.calendarId, title: it.summary || '', allDay: !!it.start.date, start: evStartStr_(it.start), end: evStartStr_(it.end), desc: it.description || '', folderId: evPriv_(it, 'todoFolder'), taskId: evPriv_(it, 'todoTask'),
    location: it.location || '', colorId: it.colorId || '', remind: it.reminders || { useDefault: true }, files: evFiles_(it) };
  if (scope === 'after' && it.recurringEventId) {
    const master = Calendar.Events.get(ref.calendarId, it.recurringEventId);
    evSimple_(ref.calendarId, master, it);
    if (sameStart_(it.originalStartTime, master.start)) Calendar.Events.remove(ref.calendarId, master.id);
    else Calendar.Events.patch({ recurrence: evCut_(ref.calendarId, master, it.originalStartTime).old }, ref.calendarId, master.id);
  } else Calendar.Events.remove(ref.calendarId, it.id);
  evTouched_(ref.calendarId);
  return { before: it.recurringEventId ? null : before };
}
function sameStart_(a, b) {
  return !!a && !!b && (a.date ? a.date === b.date : new Date(a.dateTime).getTime() === new Date(b.dateTime).getTime());
}
// 繰り返しを orig（この回のもとの開始）の前で終わらせる RRULE と、この回から続ける RRULE を作る
// UNTIL は終日なら前の日（YYYYMMDD）、時刻ありなら1秒前の UTC。COUNT は前の回の数と残りに分ける
function evCut_(calId, master, orig) {
  const rules = master.recurrence || [];
  const i = rules.findIndex(function (r) { return /^RRULE:/i.test(r); });
  if (i < 0) throw new Error('繰り返しの決まりが読めません');
  const rr = rules[i];
  let until;
  if (orig.date) until = fmt_(new Date(new Date(orig.date + 'T00:00:00+09:00').getTime() - 864e5), 'yyyyMMdd');
  else until = Utilities.formatDate(new Date(new Date(orig.dateTime).getTime() - 1000), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const strip = function (r) { return r.replace(/;?(UNTIL|COUNT)=[^;]*/gi, '').replace(/^RRULE:;/i, 'RRULE:'); };
  let oldR = strip(rr) + ';UNTIL=' + until;
  let newR = rr;
  const cm = rr.match(/COUNT=(\d+)/i);
  if (cm) {
    const total = Number(cm[1]);
    // 消した回・動かした回も、もとの位置で数える（showDeleted、originalStartTime）
    const before = evAllInstances_(calId, master.id)
      .filter(function (x) { return evAbs_(x.originalStartTime || x.start) < evAbs_(orig); }).length;
    oldR = strip(rr) + ';COUNT=' + Math.max(1, before);
    newR = strip(rr) + ';COUNT=' + Math.max(1, total - before);
  }
  const oldRules = rules.slice(); oldRules[i] = oldR;
  const newRules = rules.slice(); newRules[i] = newR;
  return { old: oldRules, nu: newRules };
}
function evAbs_(t) { return t.date ? new Date(t.date + 'T00:00:00+09:00').getTime() : new Date(t.dateTime).getTime(); }
function evAllInstances_(calId, masterId) {
  let out = [], tok = null;
  for (let i = 0; i < 10; i++) {
    const r = Calendar.Events.instances(calId, masterId, { showDeleted: true, maxResults: 2500, pageToken: tok || undefined });
    out = out.concat(r.items || []);
    tok = r.nextPageToken;
    if (!tok) break;
  }
  return out;
}
// 以降すべてを扱えるのは、単純な繰り返しだけ（Codex の答え）：RRULE が1つで RDATE・EXDATE なし、参加者なし、
// この回より後に個別に直した回・消した回がない（分けると Google でも例外が消えるため）。それ以外は Googleカレンダーで
function evSimple_(calId, master, it) {
  const rules = master.recurrence || [];
  if (rules.filter(function (r) { return /^RRULE:/i.test(r); }).length !== 1 || rules.some(function (r) { return /^(RDATE|EXDATE)/i.test(r); }))
    throw new Error('この繰り返しは決まりが複雑なので「以降すべて」は Googleカレンダーで直してください');
  if ((master.attendees || []).length) throw new Error('参加者がいる予定の「以降すべて」は Googleカレンダーで直してください');
  const b = evAbs_(it.originalStartTime);
  const odd = evAllInstances_(calId, master.id).some(function (x) {
    if (x.id === it.id || !x.originalStartTime || evAbs_(x.originalStartTime) <= b) return false;
    return x.status === 'cancelled' || evAbs_(x.start) !== evAbs_(x.originalStartTime) || (x.summary || '') !== (master.summary || '');
  });
  if (odd) throw new Error('この後に個別に直した回・消した回があるので「以降すべて」は Googleカレンダーで直してください');
}
// 以降すべてを直す：最初の回なら系列そのものを直す。途中の回なら、新しい系列を先に作ってから元の系列をこの回の前で終わらせる
function evSplit_(calId, it, o) {
  const master = Calendar.Events.get(calId, it.recurringEventId);
  evSimple_(calId, master, it);
  // 日付・終日を変えると曜日などの決まりと食い違うので、以降すべては同じ日のまま（時刻・名前・メモ）だけ
  const t = evTimes_(o);
  const origDay = evStartStr_(it.originalStartTime).slice(0, 10);
  if (!!t.start.date !== !!it.originalStartTime.date || evStartStr_(t.start).slice(0, 10) !== origDay)
    throw new Error('「以降すべて」では日付と終日は変えられません（時刻・名前・メモだけ）。日付を変えるのは「この回だけ」で');
  // v0.29.0：「以降すべて」で繰り返しの決まりも変えられる（空＝この回から後は繰り返さない＝1回だけの予定にする）
  const hasRule = 'repeat' in o;
  const rule = hasRule ? evRule_(o.repeat) : '';
  if (sameStart_(it.originalStartTime, master.start)) {
    const b0 = evBody_(o);
    if (hasRule) b0.recurrence = rule ? [rule] : [];
    return Calendar.Events.patch(b0, calId, master.id);
  }
  const cut = evCut_(calId, master, it.originalStartTime);
  if (hasRule) cut.nu = rule ? [rule] : [];
  // 時刻を遅らせたとき、もとの UNTIL のままだと最後の回がはみ出すので、ずらした分だけ延ばす
  const shift = evAbs_(t.start) - evAbs_(it.originalStartTime);
  cut.nu = cut.nu.map(function (r) {
    const m = r.match(/UNTIL=(\d{8}T\d{6}Z)/i);
    if (!m || shift <= 0) return r;
    const u = m[1];
    const d = new Date(Date.UTC(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), +u.slice(9, 11), +u.slice(11, 13), +u.slice(13, 15)) + shift);
    return r.replace(m[1], Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"));
  });
  const body = evBody_(Object.assign({ title: master.summary || '', desc: master.description || '' }, o));
  if (cut.nu.length) body.recurrence = cut.nu;
  if (master.location && !('location' in o)) body.location = master.location;
  if (master.colorId && !('colorId' in o)) body.colorId = master.colorId;
  if (master.reminders && !('remind' in o)) body.reminders = master.reminders;
  if (master.extendedProperties) body.extendedProperties = master.extendedProperties;
  // 添付も新しい系列へ引き継ぐ（Codex の指摘：分けると以降の予定から添付が消えた）
  if ((master.attachments || []).length) body.attachments = master.attachments;
  const made = Calendar.Events.insert(body, calId, body.attachments ? { supportsAttachments: true } : {});
  try { Calendar.Events.patch({ recurrence: cut.old }, calId, master.id); } catch (e) {
    try { Calendar.Events.remove(calId, made.id); } catch (e2) { /* なし */ }
    throw e;
  }
  return made;
}

// v0.26.0（16番）：このアカウントで見られるカレンダーの一覧（設定でチェックして選ぶ）。
// selected＝今選んでいる ID（primary を除く）、missing＝選んであるのに読めない ID（消された・権限がない・打ち間違い）
function listCalendars() {
  const s = settings_();
  const chosen = calendarIdsOf_(s).filter(function (x) { return x !== 'primary'; });
  const syncId = PropertiesService.getScriptProperties().getProperty('SYNC_CAL_ID');
  const primaryId = CalendarApp.getDefaultCalendar().getId();
  const seen = {};
  const wids = writableIds_();
  const items = CalendarApp.getAllCalendars().filter(function (c) { return !(syncId && c.getId() === syncId); }).map(function (c) {
    const id = c.getId();
    seen[id] = true;
    const on = id === primaryId || chosen.indexOf(id) >= 0;
    // v0.27.0：w＝予定を書けるカレンダー（選んでいるものだけ調べる）
    // v0.28.0（5番）：w＝予定を書けるカレンダー。表示していないカレンダーも、書けるなら書き込み先に選べる
    const own = c.isOwnedByMe();
    const w = own || id === primaryId || !!wids[id] || (on ? calWritable_(id) : false);
    return { id: id, name: c.getName(), color: c.getColor(), own: own, primary: id === primaryId, on: on, w: w };
  }).sort(function (a, b) { return (b.primary - a.primary) || (b.own - a.own) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  const missing = chosen.filter(function (id) { return !seen[id] && id !== primaryId; });
  return { items: items, missing: missing, roleErr: CAL_ROLE_ERR_ };
}

// v0.22.0：Web版の通知（ntfy・メール）はやめた（通知は Android だけ）。前の版の Android・画面から呼ばれても壊れないよう、名前だけ残す。
// 設定の notifyMethod・ntfyTopic・mailTo の値と、タスクの notified の列はそのまま残す（消すのは別の段階）
function enableNotify() {
  return 'Web版の通知は v0.22.0 でやめました。通知は Android 版で受け取れます';
}

function testNotify() {
  throw new Error('Web版の通知は v0.22.0 でやめました。通知は Android 版で受け取れます');
}

// 前の版で入れた5分ごとのトリガーから呼ばれる。もう要らないので、自分のトリガーを外して終わる
function checkNotifications() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'checkNotifications') ScriptApp.deleteTrigger(tr);
  });
}

// v0.22.0：Googleカレンダーへの書き込みはやめた（設定の calSync・タスクの gcalId は残す。書いてあった予定はそのまま）。
// 保存のたびに設定を読む手間もなくなる
function calSyncOn_() { return false; }

// ---- Googleカレンダーに書き込む ----

// 今あるタスク（実行日のあるもの）を、まとめてカレンダーに書き込む
function syncAllToCalendar() {
  return withLock_(function () {
    if (!calSyncOn_()) throw new Error('Googleカレンダーへの書き込みは v0.22.0 でやめました');
    // 後回しにした分（消した予定など）も一緒に書き込む
    const pend = PropertiesService.getScriptProperties().getProperty('CAL_PENDING');
    if (pend) { PropertiesService.getScriptProperties().deleteProperty('CAL_PENDING'); (JSON.parse(pend).gone || []).forEach(function (id) { GONE_EVENTS_.push(id); }); }
    let n = 0;
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) {
      if (t.doDate || t.gcalId) { TOUCHED_[t.id] = true; n++; }
    });
    const err = flushCal_();
    if (err) throw new Error('書き込めませんでした：' + err);
    return n + ' 件のタスクを確かめて、カレンダーに書き込みました';
  });
}

// 1回の呼び出しの中で変えたタスクと、消したタスクの予定。最後に flushCal_ でカレンダーに書き込む
const TOUCHED_ = {};
const GONE_EVENTS_ = [];

function writeTask_(sh, row, rec) {
  TOUCHED_[rec.id] = true;
  writeRow_(sh, row, TASK_COLS, rec);
}

function goneEvent_(r) {
  if (r.gcalId) GONE_EVENTS_.push(String(r.gcalId).split('|')[0]);
}

// 保存の答えを先に返すため、カレンダーへの書き込みは数秒あとに回す（v0.10.0）。
// 変えたタスクと消した予定を覚えておき、1回だけ動くトリガーで書き込む。
// トリガーが動かなかったときは、5分ごとの通知の確認でも書き込む
function laterCal_() {
  const ids = Object.keys(TOUCHED_);
  ids.forEach(function (k) { delete TOUCHED_[k]; });
  const gone = GONE_EVENTS_.splice(0);
  if (!calSyncOn_() || (!ids.length && !gone.length)) return;
  const props = PropertiesService.getScriptProperties();
  const p = JSON.parse(props.getProperty('CAL_PENDING') || '{"ids":[],"gone":[]}');
  ids.forEach(function (id) { if (p.ids.indexOf(id) < 0) p.ids.push(id); });
  gone.forEach(function (id) { if (p.gone.indexOf(id) < 0) p.gone.push(id); });
  const text = JSON.stringify(p);
  // 覚えておける大きさ（1項目9KB）を超えそうなら、いま書き込む
  if (text.length > 8000) { props.deleteProperty('CAL_PENDING'); return flushPendingNow_(p); }
  props.setProperty('CAL_PENDING', text);
  const at = Number(props.getProperty('CAL_TRIGGER') || 0);
  if (at && Date.now() - at < 10 * 60 * 1000) return; // もう頼んである
  try {
    ScriptApp.newTrigger('flushCalLater').timeBased().after(3000).create();
    props.setProperty('CAL_TRIGGER', String(Date.now()));
  } catch (e) {
    // トリガーを作れないときは、これまでどおり今書き込む
    flushPending_();
  }
}

// 覚えておいた分をカレンダーに書き込む（鍵を持っている中で呼ぶ）
function flushPending_() {
  const props = PropertiesService.getScriptProperties();
  const text = props.getProperty('CAL_PENDING');
  if (!text) return '';
  // 連携がオフの間は残しておく（消したタスクの予定を、オンに戻して書き込むときに片付けるため）
  if (!calSyncOn_()) return '';
  props.deleteProperty('CAL_PENDING');
  return flushPendingNow_(JSON.parse(text));
}

function flushPendingNow_(p) {
  (p.ids || []).forEach(function (id) { TOUCHED_[id] = true; });
  (p.gone || []).forEach(function (id) { GONE_EVENTS_.push(id); });
  return flushCal_();
}

// 1回だけ動くトリガーから呼ばれる
function flushCalLater() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'flushCalLater') ScriptApp.deleteTrigger(tr);
  });
  withLock_(function () {
    PropertiesService.getScriptProperties().deleteProperty('CAL_TRIGGER');
    flushPending_();
  });
}

// 変えたタスクをカレンダーに書き込む。うまくいかなくてもタスクの保存は済んでいるので、止めずに理由を返す
function flushCal_() {
  const ids = Object.keys(TOUCHED_);
  ids.forEach(function (k) { delete TOUCHED_[k]; });
  const gone = GONE_EVENTS_.splice(0);
  if (!calSyncOn_() || (!ids.length && !gone.length)) return '';
  try {
    const cal = syncCalendar_();
    gone.forEach(function (id) { const ev = eventById_(cal, id); if (ev) ev.deleteEvent(); });
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const lists = rows_(SHEET_LISTS, LIST_COLS);
    const want = {};
    ids.forEach(function (id) { want[id] = true; });
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (r) { if (want[r.id]) syncOne_(cal, sh, r, lists); });
    return '';
  } catch (e) {
    console.warn('カレンダーに書き込めませんでした: ' + e);
    return String(e && e.message || e);
  }
}

// 書き込む先のカレンダー「ToDoアプリ」（なければ作る）
function syncCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SYNC_CAL_ID');
  const cal = id ? CalendarApp.getCalendarById(id) : null;
  if (cal) return cal;
  const made = CalendarApp.createCalendar(SYNC_CAL_NAME);
  props.setProperty('SYNC_CAL_ID', made.getId());
  return made;
}

function eventById_(cal, id) {
  try { return id ? cal.getEventById(id) : null; } catch (e) { return null; }
}

// タスク1件の予定を、今の中身に合わせる（中身が前と同じなら何もしない）
function syncOne_(cal, sh, r, lists) {
  const spec = eventSpec_(r, lists);
  const p = String(r.gcalId || '').split('|');
  const mark = spec ? digest_(JSON.stringify(spec)) : '';
  let ev = eventById_(cal, p[0]);
  // 中身が同じでも、予定が消えていれば（カレンダーごと消したときなど）作り直す
  if (spec && ev && p[1] === mark) return;
  if (!spec) {
    if (ev) ev.deleteEvent();
    if (r.gcalId) { r.gcalId = ''; writeRow_(sh, r._row, TASK_COLS, r); }
    return;
  }
  const start = jst_(spec.start);
  const end = jst_(spec.end);
  // 色を外したときは、予定を作り直してカレンダーの色に戻す（色を「なし」に戻す書き方がないため）
  if (ev && !spec.color && ev.getColor()) { ev.deleteEvent(); ev = null; }
  if (ev && ev.isAllDayEvent() === !spec.timed) {
    ev.setTitle(spec.title);
    ev.setDescription(spec.desc);
    if (spec.timed) ev.setTime(start, end); else ev.setAllDayDates(start, end);
  } else {
    if (ev) ev.deleteEvent();
    ev = spec.timed ? cal.createEvent(spec.title, start, end, { description: spec.desc })
      : cal.createAllDayEvent(spec.title, start, end, { description: spec.desc });
  }
  if (spec.color) ev.setColor(spec.color);
  r.gcalId = ev.getId() + '|' + mark;
  writeRow_(sh, r._row, TASK_COLS, r);
}

// タスクから予定の中身を決める。実行日がない・やらないにしたときは予定を消す（null）
function eventSpec_(r, lists) {
  if (!r.doDate || isOn_(r.wontDo)) return null;
  const title = (isOn_(r.done) ? '✓ ' : '') + r.title;
  const desc = (r.memo ? r.memo + '\n\n' : '') + '（ToDoアプリから書き込み）';
  const color = colorOf_(lists, r.listId);
  if (r.doDate.length > 10) {
    // 時刻つき：終わりがなければ30分
    let end = r.doEnd ? (r.doEnd.length > 10 ? r.doEnd : r.doEnd + 'T23:59') : '';
    if (!end || end <= r.doDate) end = addMinStr_(r.doDate, 30);
    return { title: title, timed: true, start: r.doDate, end: end, color: color, desc: desc };
  }
  // 終日：終わりの日の翌日まで（カレンダーの終日の予定は、終わりの日を含まない）
  const last = (r.doEnd || r.doDate).slice(0, 10);
  return { title: title, timed: false, start: r.doDate, end: addDaysStr_(last, 1), color: color, desc: desc };
}

function jst_(s) {
  return new Date((s.length > 10 ? s.slice(0, 16) : s + 'T00:00') + ':00+09:00');
}

function digest_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)).slice(0, 12);
}

// フォルダの色（なければ上のフォルダの色）
function colorOf_(lists, listId) {
  for (let id = listId, i = 0; id && i < 50; i++) {
    const l = lists.filter(function (x) { return x.id === id; })[0];
    if (!l) break;
    if (cleanColor_(l.color)) return l.color;
    id = l.parentId;
  }
  return '';
}

// listId が rootId か、その中のフォルダか
function underList_(lists, listId, rootId) {
  for (let id = listId, i = 0; id && i < 50; i++) {
    if (id === rootId) return true;
    const l = lists.filter(function (x) { return x.id === id; })[0];
    id = l ? l.parentId : '';
  }
  return false;
}

// フォルダの目印の絵文字（なしは空）。1つ分だけ（肌の色や旗などの組み合わせも含めて8文字まで）
function cleanIcon_(v) {
  const t = String(v == null ? '' : v).replace(/[\s<>&"']/g, '');
  return Array.from(t).slice(0, 8).join('');
}

function cleanColor_(c) {
  const n = parseInt(c, 10);
  return n >= 1 && n <= 11 && String(n) === String(c) ? String(n) : '';
}

// ---- 内部の処理 ----

// 10/28 や 10/28 9:00 の形にする
function mdt_(s) {
  const p = s.slice(0, 10).split('-');
  return Number(p[1]) + '/' + Number(p[2]) + (s.length > 10 ? ' ' + Number(s.slice(11, 13)) + ':' + s.slice(14, 16) : '');
}

// 繰り返しの次の回：実行日・期限・通知を同じだけ進め、今日より後になるまで進める。
// 最初の回の日付（repeatBase）から何回目か（repeatCount）で計算するので、
// 毎月31日が2月に28日になっても、3月には31日に戻る
function advance_(t, day) {
  const now = fmt_(new Date(), 'yyyy-MM-dd');
  // 完了した日を渡されたら、その日より後の回にする（今日より後の日は使わない）
  const today = /^\d{4}-\d{2}-\d{2}$/.test(day || '') && day < now ? day : now;
  const p = t.repeatBase ? t.repeatBase.split('|') : [t.doDate, t.due, t.notifyAt, t.doEnd, t.dueEnd];
  const base = { doDate: p[0] || '', due: p[1] || '', notifyAt: p[2] || '', doEnd: p[3] || '', dueEnd: p[4] || '' };
  const start = t.repeatBase ? Number(t.repeatCount) || 0 : 0;
  const r = parseRepeat_(t.repeat);
  // 「祝日を飛ばす」なら、祝日に当たる回は使わずに次の回へ。ただし続けて10回祝日に当たるとき
  // （毎年同じ祝日の繰り返しなど）は飛ばし続けず、今日より後の最初の回を使う
  let first = 0;
  for (let n = start + 1; n <= start + 1000; n++) {
    Object.assign(t, nextDates_(base, t.repeat, n));
    t.repeatCount = String(n);
    const d = (t.doDate || t.due).slice(0, 10);
    if (d <= today) continue;
    if (!(r && r.nh && isHoliday_(d))) break;
    if (!first) first = n;
    if (n - first >= 9) {
      Object.assign(t, nextDates_(base, t.repeat, first));
      t.repeatCount = String(first);
      break;
    }
  }
  t.repeatBase = [base.doDate, base.due, base.notifyAt, base.doEnd].join('|') + (base.dueEnd ? '|' + base.dueEnd : '');
  // 終わりの日より後になったら、次の回は作らない（false を返す）
  return !(r && r.until && (t.doDate || t.due).slice(0, 10) > r.until);
}

// 起点から n 回目の日付。実行日（なければ期限）を基準に決め、ほかの日付は同じ日数だけずらす
// （期間の長さや期限との間隔を保つ）
function nextDates_(base, repeat, n) {
  const anchor = (base.doDate || base.due).slice(0, 10);
  const delta = daysBetween_(anchor, occurrence_(anchor, parseRepeat_(repeat), n));
  const out = {};
  ['doDate', 'due', 'notifyAt', 'doEnd', 'dueEnd'].forEach(function (k) { out[k] = base[k] ? addDaysStr_(base[k], delta) : ''; });
  return out;
}

// anchor（yyyy-MM-dd）から数えて n 回目の日付
function occurrence_(anchor, r, n) {
  if (r.freq === 'daily') return addDaysStr_(anchor, n * r.interval);
  if (r.freq === 'weekly') {
    const wd = weekday_(anchor);
    const days = r.days.length ? r.days : [wd];
    // 起点の週で、起点より後の曜日を先に使い、そのあとは「間隔」週ごとに曜日を順に使う
    const after = days.filter(function (d) { return d > wd; });
    if (n <= after.length) return addDaysStr_(anchor, after[n - 1] - wd);
    const k = n - after.length - 1;
    return addDaysStr_(anchor, (1 + Math.floor(k / days.length)) * 7 * r.interval + days[k % days.length] - wd);
  }
  // 毎月・毎年の第◯◯曜日・最終◯曜日（毎年は12か月ごと。v0.15.0）
  if ((r.freq === 'monthly' || r.freq === 'yearly') && r.by !== 'day') return nthWeekday_(anchor, n * r.interval * (r.freq === 'yearly' ? 12 : 1), r.by === 'last');
  // 毎月・毎年の同じ日（月末を超えるときはその月の最終日）
  const p = anchor.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  addMonths_(dt, (r.freq === 'yearly' ? 12 : 1) * n * r.interval, p[2]);
  return dt.toISOString().slice(0, 10);
}

function weekday_(d) {
  const p = d.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

// 繰り返しを読む。繰り返さないときは null
function parseRepeat_(s) {
  if (!s || s === 'none') return null;
  const p = String(OLD_REPEATS[s] || s).split('/');
  if (['daily', 'weekly', 'monthly', 'yearly'].indexOf(p[0]) < 0) return null;
  const r = { freq: p[0], interval: Math.min(Math.max(parseInt(p[1], 10) || 1, 1), 99), days: [], by: 'day',
    nh: p.slice(2).indexOf('nh') >= 0, until: '' };
  p.slice(2).forEach(function (x) { const m = /^until=(\d{4}-\d{2}-\d{2})$/.exec(x); if (m) r.until = m[1]; });
  if (r.freq === 'weekly') {
    r.days = (p[2] || '').split(',').filter(function (d, i, a) { return /^[0-6]$/.test(d) && a.indexOf(d) === i; })
      .map(Number).sort(function (x, y) { return x - y; });
  }
  if ((r.freq === 'monthly' || r.freq === 'yearly') && (p[2] === 'nth' || p[2] === 'last')) r.by = p[2];
  return r;
}

function cleanRepeat_(s) {
  const r = parseRepeat_(s);
  if (!r) return 'none';
  if (OLD_REPEATS[s]) return s;
  return r.freq + '/' + r.interval + (r.freq === 'weekly' && r.days.length ? '/' + r.days.join(',') : r.freq === 'monthly' || (r.freq === 'yearly' && r.by !== 'day') ? '/' + r.by : '')
    + (r.nh ? '/nh' : '') + (r.until ? '/until=' + r.until : '');
}

// ---- 日本の祝日（画面の holidaysOf と同じ計算。外のサービスは使わない） ----
// 2020〜2099年。祝日法の決まり（ハッピーマンデー・春分／秋分の式・振替休日・国民の休日）で求める。
// 法律が変わったら、ここと画面の両方を直す
const HOLIDAY_CACHE_ = {};
// その年の祝日（日付 → 名前）。Googleカレンダーの「日本の祝日」から読み、読めないときや載っていない年は計算する
function holidaysOf_(y) {
  if (HOLIDAY_CACHE_[y]) return HOLIDAY_CACHE_[y];
  // v0.22.0：Googleカレンダーから祝日を読むのは遅い（開くたびに読んでいた）ので、読めた分は6時間覚えておく
  const cache = CacheService.getScriptCache();
  const hit = cache.get('HOL_' + y);
  if (hit) { try { return (HOLIDAY_CACHE_[y] = JSON.parse(hit)); } catch (e) { /* 読み直す */ } }
  const cal = calHolidays_(y);
  if (cal) { try { cache.put('HOL_' + y, JSON.stringify(cal), 21600); } catch (e) { /* 覚えられなくても動く */ } }
  return (HOLIDAY_CACHE_[y] = cal || calcHolidays_(y));
}
// 今年と来年の祝日をまとめて（getAll で画面へ渡す）
function holidaysNear_() {
  const y = Number(fmt_(new Date(), 'yyyy'));
  return Object.assign({}, holidaysOf_(y), holidaysOf_(y + 1));
}
// Googleカレンダーの「日本の祝日」から読む。説明が「祝日」のもの（振替休日・国民の休日を含む）だけを使い、
// 「祭日」（節分・七夕など、休みでない行事）は使わない。6時間覚えておく。読めなければ null
function calHolidays_(y) {
  const key = 'HOL:' + y;
  try {
    const hit = CacheService.getScriptCache().get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* 読み直す */ }
  try {
    const cal = CalendarApp.getCalendarById(HOLIDAY_CAL_ID);
    if (!cal) return null;
    const out = {};
    cal.getEvents(new Date(y + '-01-01T00:00:00+09:00'), new Date((y + 1) + '-01-01T00:00:00+09:00')).forEach(function (e) {
      if (!e.isAllDayEvent() || String(e.getDescription() || '').split('\n')[0].trim() !== '祝日') return;
      const d = fmt_(e.getAllDayStartDate(), 'yyyy-MM-dd');
      if (d.slice(0, 4) === String(y)) out[d] = e.getTitle();
    });
    // まだ載っていない先の年（数件しかない）は、計算に任せる
    if (Object.keys(out).length < 10) return null;
    try { CacheService.getScriptCache().put(key, JSON.stringify(out), 21600); } catch (e) { /* なし */ }
    return out;
  } catch (e) { return null; }
}
// 祝日法の決まりから計算する（カレンダーが読めないときの予備）
function calcHolidays_(y) {
  const out = {};
  if (y < 2020 || y > 2099) return out;
  const key = function (m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; };
  const add = function (m, d, name) { out[key(m, d)] = name; };
  // m月の第n月曜日
  const monday = function (m, n) { return 1 + (8 - new Date(Date.UTC(y, m - 1, 1)).getUTCDay()) % 7 + (n - 1) * 7; };
  const k = y - 1980;
  add(1, 1, '元日');
  add(1, monday(1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, Math.floor(20.8431 + 0.242194 * k) - Math.floor(k / 4), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  // 2020・2021年はオリンピックで海の日・スポーツの日・山の日が動いた
  const moved = { 2020: [23, 24, 10], 2021: [22, 23, 8] }[y];
  add(7, moved ? moved[0] : monday(7, 3), '海の日');
  add(moved ? 7 : 10, moved ? moved[1] : monday(10, 2), 'スポーツの日');
  add(8, moved ? moved[2] : 11, '山の日');
  add(9, monday(9, 3), '敬老の日');
  add(9, Math.floor(23.2488 + 0.242194 * k) - Math.floor(k / 4), '秋分の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  const base = Object.keys(out).sort();
  const shift = function (s, n) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
  // 国民の休日：前の日と次の日がどちらも祝日にはさまれた平日
  base.forEach(function (s) {
    const mid = shift(s, 1);
    if (!out[mid] && out[shift(s, 2)] && weekday_(mid) !== 0) out[mid] = '国民の休日';
  });
  // 振替休日：祝日が日曜日なら、そのあと最初の祝日でない日
  base.forEach(function (s) {
    if (weekday_(s) !== 0) return;
    let d = shift(s, 1);
    while (out[d]) d = shift(d, 1);
    out[d] = '振替休日';
  });
  return out;
}
function isHoliday_(d) { return !!holidaysOf_(Number(d.slice(0, 4)))[d.slice(0, 10)]; }

// チェックリストを読む／整える（空の項目は捨てる）
function parseList_(v) {
  let a = v;
  if (typeof a === 'string') { try { a = a ? JSON.parse(a) : []; } catch (e) { a = []; } }
  if (!Array.isArray(a)) return [];
  return a.map(function (x) { return { t: String((x && x.t) || '').slice(0, 500), d: !!(x && x.d) }; })
    .filter(function (x) { return x.t.trim(); });
}

function cleanChecklist_(v) {
  const a = parseList_(v);
  return a.length ? JSON.stringify(a) : '';
}

// 「◯分前」の通知を読む／整える（配列でも , でつないだ文字でもよい。同じものは1つに）
function remList_(v) {
  const a = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  a.forEach(function (x) {
    const m = String(x).trim().match(/^(do|due):(-?\d+)$/);
    if (!m) return;
    const min = Math.max(Math.min(parseInt(m[2], 10), 0), -60 * 24 * 365);
    const k = m[1] + ':' + min;
    if (out.indexOf(k) < 0 && out.length < 20) out.push(k);
  });
  return out;
}

// 優先度：TickTick と同じ数（0 なし・1 低・3 中・5 高）だけ受け付ける。ほかは「なし」
function cleanPriority_(v) {
  const n = Number(v);
  return n === 1 || n === 3 || n === 5 ? String(n) : '';
}

function cleanOrder_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
}

// 所要時間：空は「決めていない」。0〜1440分の整数だけ受け付ける（負・小数・大きすぎる数は断る）
function cleanEstimate_(v) {
  if (v === '' || v == null) return '';
  const s = String(v).trim();
  if (!/^\d+$/.test(s) || Number(s) > MAX_ESTIMATE) throw new Error('所要時間は0〜' + MAX_ESTIMATE + '分の整数で入れてください');
  return String(Number(s));
}
// 読むとき：壊れた値は「決めていない」として扱う（数えない）
function safeEstimate_(v) {
  try { const s = cleanEstimate_(v); return s === '' ? '' : Number(s); } catch (e) { return ''; }
}
// その日の並び順：「yyyy-MM-dd:数」だけ受け付ける（それ以外は外す）
function cleanDayOrder_(v) {
  const s = String(v == null ? '' : v).trim();
  const m = /^(\d{4}-\d{2}-\d{2}):(-?\d+(?:\.\d+)?)$/.exec(s);
  return m ? m[1] + ':' + String(Math.round(Number(m[2]) * 1000) / 1000) : '';
}

// 通知する日時（yyyy-MM-ddTHH:mm）の一覧。時刻のない日は 9:00 を基準にする
function fireTimes_(t) {
  const out = [];
  const at = function (s) { return s.length > 10 ? s.slice(0, 16) : s + 'T09:00'; };
  if (t.notifyAt) out.push(at(t.notifyAt));
  remList_(t.reminders).forEach(function (r) {
    const p = r.split(':');
    const base = p[0] === 'due' ? t.due || t.doEnd : t.doDate; // 期限がなく期間なら、期間の終わりを期限とみなす（TickTick の期間の終わり＝期限。v0.17.0）
    if (base) out.push(addMinStr_(at(base), Number(p[1])));
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; }).sort();
}

// もう送った通知の日時（v0.4 までの「1」は、日時の通知を送り済み）
function sentList_(t) {
  const v = String(t.notified || '');
  if (isOn_(v)) return t.notifyAt ? [t.notifyAt.length > 10 ? t.notifyAt.slice(0, 16) : t.notifyAt + 'T09:00'] : [];
  return v ? v.split(',') : [];
}

function addMinStr_(s, min) {
  const p = s.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
  return new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5] + min)).toISOString().slice(0, 16);
}

// anchor と同じ「第N◯曜日」（last なら「最終◯曜日」）の、n か月後の日付
function nthWeekday_(anchor, n, last) {
  const p = anchor.split('-').map(Number);
  const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const nth = Math.ceil(p[2] / 7);
  const first = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let day;
  if (last) {
    const lastWd = new Date(Date.UTC(y, m, days)).getUTCDay();
    day = days - ((lastWd - wd + 7) % 7);
  } else {
    day = 1 + ((wd - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
    // 第5◯曜日がない月は、その月の最終◯曜日にする
    while (day > days) day -= 7;
  }
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function addDaysStr_(s, days) {
  const p = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10) + s.slice(10);
}

// 月末を超えないように月を進める（1/31 の翌月は 2/28 など）
function addMonths_(dt, n, day) {
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
}

// 子・孫のタスク（行の情報つき）
function descendants_(all, id) {
  const out = [];
  const seen = {};
  seen[id] = true;
  for (let q = [id]; q.length;) {
    const pid = q.shift();
    all.forEach(function (r) {
      if (r.parentTaskId === pid && !seen[r.id]) { seen[r.id] = true; out.push(r); q.push(r.id); }
    });
  }
  return out;
}

// 親・祖父母のタスク（近い順）
function ancestors_(all, t) {
  const out = [];
  for (let pid = t.parentTaskId, i = 0; pid && i < 100; i++) {
    const p = all.filter(function (r) { return r.id === pid; })[0];
    if (!p) break;
    out.push(p);
    pid = p.parentTaskId;
  }
  return out;
}

function parseAttach_(s) {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function attachFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ATTACH_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 消されていたら作り直す */ }
  }
  const f = DriveApp.createFolder(ATTACH_FOLDER);
  props.setProperty('ATTACH_FOLDER_ID', f.getId());
  return f;
}

function trashFile_(id) {
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* すでに無ければそのまま */ }
}

function ensureSetup_() {
  // v0.33.0：見出しは版が変わったときにまとめて確かめる
  HDR_CHECK_ = true;
  Object.keys(SHEET_CACHE_).forEach(function (k) { delete SHEET_CACHE_[k]; });
  try { ensureSetupBody_(); } finally { HDR_CHECK_ = false; }
}
function ensureSetupBody_() {
  sheet_(SHEET_TASKS, TASK_COLS);
  sheet_(SHEET_TEMPLATES, TEMPLATE_COLS);
  sheet_(SHEET_SMART, SMART_COLS);
  if (ss_().getSheetByName(SHEET_TT)) sheet_(SHEET_TT, TT_COLS);
  try { ensureBackupTrigger_(); } catch (e) { /* きっかけを作れなくても開けるように */ }
  sheet_(SHEET_SETTINGS, SETTING_COLS);
  const sh = sheet_(SHEET_LISTS, LIST_COLS);
  const lists = rows_(SHEET_LISTS, LIST_COLS);
  if (!lists.length) {
    writeRow_(sh, 2, LIST_COLS, { id: newId_(), name: 'Work', isWork: '', order: '1', parentId: '' });
    writeRow_(sh, 3, LIST_COLS, { id: newId_(), name: 'Private', isWork: '', order: '2', parentId: '' });
    writeRow_(sh, 4, LIST_COLS, { id: newId_(), name: INBOX_NAME, isWork: '', order: '0', parentId: '' });
    PropertiesService.getScriptProperties().setProperty('INBOX_015', '1');
    return;
  }
  // v0.15.0：とりあえず入れておく「受信箱」を、一覧のいちばん上に1回だけ作る（TickTick の受信箱とつながる）
  const p15 = PropertiesService.getScriptProperties();
  if (!p15.getProperty('INBOX_015')) {
    if (!lists.some(function (l) { return l.name === INBOX_NAME && !l.parentId; })) {
      const min = lists.reduce(function (m, x) { return Math.min(m, Number(x.order) || 0); }, 1);
      writeRow_(sh, sh.getLastRow() + 1, LIST_COLS, { id: newId_(), name: INBOX_NAME, isWork: '', order: String(min - 1), parentId: '' });
    }
    p15.setProperty('INBOX_015', '1');
  }
  // v0.1 の初期の名前を、v0.2.0 の呼び方に1回だけ変える
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RENAMED_020')) {
    const names = { '仕事': 'Work', '私用': 'Private' };
    lists.forEach(function (l) {
      if (names[l.name]) { l.name = names[l.name]; writeRow_(sh, l._row, LIST_COLS, l); }
    });
    props.setProperty('RENAMED_020', '1');
  }
}

// 保存先のスプレッドシート。紐付いたシートが取れないときに備えて、IDも覚えておく
function ss_() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    if (props.getProperty('SPREADSHEET_ID') !== ss.getId()) props.setProperty('SPREADSHEET_ID', ss.getId());
    return ss;
  }
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('保存先のスプレッドシートが分かりません。スプレッドシートを一度開き直してから、もう一度試してください。');
  return SpreadsheetApp.openById(id);
}

// 1回の呼び出しの中では、シートと見出しの確認は1度だけにする（軽くするため）
const SHEET_CACHE_ = {};
let HDR_CHECK_ = false;
function sheet_(name, cols) {
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  let made = false;
  if (!sh) {
    made = true;
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  // 1行目の見出しが足りなければ書き直す（版が上がって列が増えたとき）。
  // v0.33.0：毎回は確かめない（呼び出しのたびに表ごとに1回読んでいた）。新しく作った表・版が変わったときの準備・バックアップから戻すときだけ。
  // 読み書きは列の位置で行うので、見出しは人が表を見るときの目印
  if ((made || HDR_CHECK_) && sh.getRange(1, cols.length).getValue() !== cols[cols.length - 1]) {
    writeRow_(sh, 1, cols, cols.reduce(function (o, c) { o[c] = c; return o; }, {}));
  }
  SHEET_CACHE_[name] = sh;
  return sh;
}

// v0.20.0：1回の呼び出しの中で同じ表を何度も読まないように、書くまでは読んだ値を使い回す（書いたら dirty_ で捨てる）。
// 保存1回で表全体を3回読んでいたのを2回にする。返す行はいつも新しく作る（呼んだ側が書き換えても、使い回す値は変わらない）
let ROWS_MEMO_ = {};
function dirty_() { ROWS_MEMO_ = {}; }
function rows_(name, cols, keyCol) {
  const sh = sheet_(name, cols);
  const mk = name + '|' + cols.length;
  let vals = ROWS_MEMO_[mk];
  if (!vals) {
    const last = sh.getLastRow();
    vals = last < 2 ? [] : sh.getRange(2, 1, last - 1, cols.length).getValues();
    ROWS_MEMO_[mk] = vals;
  }
  const key = keyCol || 'id';
  return vals.map(function (r, i) {
    const o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = norm_(r[j]); });
    return o;
  }).filter(function (o) { return o[key]; });
}

function findRow_(name, cols, id) {
  return pick_(rows_(name, cols), id);
}

// 読んだ行の中から id の行を取る
function pick_(all, id) {
  const hit = all.filter(function (r) { return r.id === id; })[0];
  if (!hit) throw new Error('見つかりません（別の画面で消された可能性があります）。↻で読み直してください。');
  return hit;
}

// すべて文字として書く（日付が勝手に変換されないように）
function writeRow_(sh, row, cols, obj) {
  const range = sh.getRange(row, 1, 1, cols.length);
  range.setNumberFormat('@');
  range.setValues([cols.map(function (c) { return obj[c] == null ? '' : String(obj[c]); })]);
  dirty_();
}

function norm_(v) {
  if (v instanceof Date) {
    return fmt_(v, v.getHours() || v.getMinutes() ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
  }
  if (v === true) return '1';
  if (v === false) return '';
  return String(v);
}

function isOn_(v) {
  return v === true || v === '1' || v === 'TRUE' || v === 'true';
}

function toTask_(o) {
  return {
    id: o.id, title: o.title, listId: o.listId, due: o.due, doDate: o.doDate, doEnd: o.doEnd || '',
    repeat: o.repeat || 'none', notifyAt: o.notifyAt,
    memo: o.memo, done: isOn_(o.done), doneAt: o.doneAt, createdAt: o.createdAt, updatedAt: o.updatedAt,
    attachments: parseAttach_(o.attachments), parentTaskId: o.parentTaskId || '', checklist: parseList_(o.checklist),
    order: o.order === '' || o.order == null ? '' : Number(o.order), reminders: remList_(o.reminders), wontDo: isOn_(o.wontDo), doneWith: o.doneWith || '',
    nextId: o.nextId || '', repeatBase: o.repeatBase || '', repeatCount: o.repeatCount === '' || o.repeatCount == null ? '' : String(o.repeatCount),
    estimate: safeEstimate_(o.estimate), dayOrder: o.dayOrder || '',
    isSomeday: isOn_(o.isSomeday) && !o.due, priority: Number(cleanPriority_(o.priority)) || 0, isPinned: isOn_(o.isPinned),
    dueEnd: o.due && o.dueEnd && String(o.dueEnd) > String(o.due) ? String(o.dueEnd) : ''
  };
}

function allTasks_() {
  return rows_(SHEET_TASKS, TASK_COLS).map(toTask_);
}

function cleanKeyword_(v) {
  return String(v || '').split(/[\s,、，;；]+/).filter(String).join(' ').slice(0, 100);
}
function toList_(o) {
  return { id: o.id, name: o.name, order: Number(o.order) || 0, parentId: o.parentId || '', color: cleanColor_(o.color), icon: cleanIcon_(o.icon), closed: isOn_(o.closed), keyword: cleanKeyword_(o.keyword), calId: o.calId || '' };
}

function lists_() {
  return rows_(SHEET_LISTS, LIST_COLS).map(toList_).sort(function (a, b) { return a.order - b.order; });
}

function settings_() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  rows_(SHEET_SETTINGS, SETTING_COLS, 'key').forEach(function (r) {
    if (r.key in s) s[r.key] = r.value;
  });
  return s;
}

let LOCKED_ = false;
function withLock_(fn) {
  if (LOCKED_) return fn(); // undoable の中から呼ばれたときは、もう鍵を持っている
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    throw new Error('ほかの処理（同期など）が動いています。少し待ってから、もう一度どうぞ。'); // v0.17.1：「ロックのタイムアウト」をわかる言葉に
  }
  LOCKED_ = true;
  dirty_(); // 鍵を待つ間にほかの処理が書いたかもしれないので、鍵を取ったら読み直す
  try {
    return fn();
  } finally {
    LOCKED_ = false;
    lock.releaseLock();
  }
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function nowStr_() {
  return fmt_(new Date(), "yyyy-MM-dd'T'HH:mm");
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, TZ, pattern);
}

// ---- TickTick との同期（v0.14.0 は「つなぐ」と「取り込みの下見」だけ。TickTick にもシートにも、まだ書かない） ----
// 決めたこと（projects/todo-app/2026-11-02_TickTick同期の意図メモ.md）：
// ・同期するのはタスクとフォルダ構成だけ（TickTick のリスト＝フォルダ、TickTick のフォルダ＝上のフォルダ）
// ・やる日 ↔ 開始日（startDate）、期限 ↔ 期限（dueDate）。開始日と期限が同じなら、やる日だけにする
// ・繰り返し・子タスク・チェックリストも写す。写せない決め方（祝日を飛ばす、完了してから次の回など）は写さず、印を出す
// ・鍵はスクリプトのプロパティにだけ置く（TT_CLIENT_ID・TT_CLIENT_SECRET・TT_TOKEN）
const TT_API = 'https://api.ticktick.com/open/v1';
const TT_AUTH_URL = 'https://ticktick.com/oauth/authorize';
const TT_TOKEN_URL = 'https://ticktick.com/oauth/token';
const TT_SCOPE = 'tasks:read tasks:write';
const TT_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function ttProps_() { return PropertiesService.getScriptProperties(); }
function ttRedirect_() { return ScriptApp.getService().getUrl() || ''; }

function ttStatus() {
  const p = ttProps_();
  return { hasKeys: !!(p.getProperty('TT_CLIENT_ID') && p.getProperty('TT_CLIENT_SECRET')),
    connected: !!p.getProperty('TT_TOKEN'), redirectUri: ttRedirect_(),
    imported: p.getProperty('TT_IMPORTED') || '', sync: p.getProperty('TT_SYNC') === '1', restored: p.getProperty('TT_RESTORED') || '', backup: p.getProperty('TT_BACKUP') || '',
    status: ttJson_(p.getProperty('TT_STATUS')), stage: (function (x) { return x ? { tasks: x.tasks, at: x.at } : null; })(ttJson_(p.getProperty('TT_STAGE'))) };
}
function ttJson_(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
// 確認待ちの数（getAll で画面へ。前回の同期のときの数）
function ttConflictCount_() {
  const p = ttProps_();
  if (!p.getProperty('TT_IMPORTED')) return 0;
  const st = ttJson_(p.getProperty('TT_STATUS'));
  return (st && Number(st.conflicts)) || 0;
}

function ttSaveKeys(clientId, secret) {
  const id = String(clientId || '').trim();
  const sec = String(secret || '').trim();
  if (!/^[\w.-]{4,100}$/.test(id)) throw new Error('Client ID の形が違います。開発者サイトの表示をそのまま貼ってください。');
  if (!/^\S{4,200}$/.test(sec)) throw new Error('Client Secret の形が違います。開発者サイトの表示をそのまま貼ってください。');
  const p = ttProps_();
  p.setProperty('TT_CLIENT_ID', id);
  p.setProperty('TT_CLIENT_SECRET', sec);
  p.deleteProperty('TT_TOKEN'); // 鍵を変えたら、つなぎ直す
  return ttStatus();
}

// 許可の画面のアドレス。確かめの印（state）は10分だけ覚える
function ttAuthUrl() {
  const p = ttProps_();
  const id = p.getProperty('TT_CLIENT_ID');
  if (!id || !p.getProperty('TT_CLIENT_SECRET')) throw new Error('先に Client ID と Client Secret を保存してください。');
  const redirect = ttRedirect_();
  if (!redirect) throw new Error('ウェブアプリのアドレスが分かりません。');
  const state = Utilities.getUuid();
  CacheService.getScriptCache().put('TT_STATE', state, 600);
  return TT_AUTH_URL + '?' + ttQuery_({ client_id: id, scope: TT_SCOPE, state: state, redirect_uri: redirect, response_type: 'code' });
}

function ttQuery_(o) {
  return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
}

// 許可の画面から戻ってきたとき（doGet から）
function ttCallback_(q) {
  let msg;
  try {
    if (q.error) throw new Error('許可されませんでした（' + String(q.error).slice(0, 50) + '）');
    const cache = CacheService.getScriptCache();
    const want = cache.get('TT_STATE');
    if (!want || want !== q.state) throw new Error('確かめの印が合いません。⚙ からもう一度つないでください（10分以内に許可します）。');
    cache.remove('TT_STATE');
    ttExchange_({ grant_type: 'authorization_code', code: String(q.code), scope: TT_SCOPE, redirect_uri: ttRedirect_() });
    msg = '✓ TickTick とつながりました。この画面を閉じて、ToDoアプリの ⚙ に戻ってください。';
  } catch (err) {
    msg = 'つなげませんでした：' + err.message;
  }
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;font-size:16px;padding:16px">' + ttEsc_(msg) + '</p>')
    .setTitle('To Cal と TickTick').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ttEsc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

// 鍵（アクセストークン）を受け取って覚える（OAuth 2.0 の決まりどおり）
function ttExchange_(payload) {
  const p = ttProps_();
  const res = UrlFetchApp.fetch(TT_TOKEN_URL, {
    method: 'post', muteHttpExceptions: true, payload: payload,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(p.getProperty('TT_CLIENT_ID') + ':' + p.getProperty('TT_CLIENT_SECRET')) }
  });
  const code = res.getResponseCode();
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (e) { /* 下で失敗にする */ }
  if (code !== 200 || !j || !j.access_token) {
    throw new Error('鍵を受け取れませんでした（' + code + '）。Client ID・Secret と、開発者サイトの戻り先 URL を確かめてください。');
  }
  const old = ttToken_();
  p.setProperty('TT_TOKEN', JSON.stringify({ access: j.access_token, refresh: j.refresh_token || (old && old.refresh) || '',
    exp: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : 0 }));
}

function ttToken_() {
  try { return JSON.parse(ttProps_().getProperty('TT_TOKEN') || 'null'); } catch (e) { return null; }
}

function ttDisconnect() {
  ttProps_().deleteProperty('TT_TOKEN');
  return ttStatus();
}

// 使える鍵。期限が近く、取り替え用の鍵（refresh）があれば取り替える
function ttAccess_() {
  let t = ttToken_();
  if (!t || !t.access) throw new Error('TickTick とつながっていません。⚙ の「TickTick と同期」からつないでください。');
  if (t.exp && t.exp < Date.now() + 60000 && t.refresh) {
    ttExchange_({ grant_type: 'refresh_token', refresh_token: t.refresh, scope: TT_SCOPE });
    t = ttToken_();
  }
  return t.access;
}

function ttOpts_(access) {
  return { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + access } };
}

function ttParse_(res, what) {
  const code = res.getResponseCode();
  if (code === 401) throw new Error('TickTick の鍵が切れています。⚙ でつなぎ直してください。');
  if (code !== 200) throw new Error('読めませんでした（' + code + '）');
  try { return JSON.parse(res.getContentText() || 'null'); } catch (e) { throw new Error('答えが読めませんでした：' + what); }
}

// TickTick の中身を全部読む（読むだけ）。1つでも読めなければ ok:false。読めなかったものを「消えた」とは扱わない
function ttReadAll_() {
  const access = ttAccess_();
  const projects = (ttParse_(UrlFetchApp.fetch(TT_API + '/project', ttOpts_(access)), 'リストの一覧') || [])
    .filter(function (pr) { return pr && pr.id && !pr.closed && (pr.kind || 'TASK') === 'TASK'; });
  const reads = [{ id: 'inbox', name: INBOX_NAME, inbox: true }].concat(projects);
  const res = UrlFetchApp.fetchAll(reads.map(function (pr) {
    return Object.assign({ url: TT_API + '/project/' + encodeURIComponent(pr.id) + '/data' }, ttOpts_(access));
  }));
  const data = [];
  const errors = [];
  reads.forEach(function (pr, i) {
    try {
      const d = ttParse_(res[i], pr.name);
      data.push({ project: pr, tasks: ((d && d.tasks) || []).filter(function (t) { return t && t.id; }) });
    } catch (e) {
      errors.push(pr.name + '：' + e.message);
    }
  });
  // フォルダ（リストのまとまり）の名前。公開の説明に窓口が載っていないので、読めなければ null
  let groups = null;
  try {
    const g = ttParse_(UrlFetchApp.fetch(TT_API + '/project/group', ttOpts_(access)), 'フォルダ');
    if (Array.isArray(g)) groups = g;
  } catch (e) { groups = null; }
  // v0.16.0：完了済み（直近 TT_DONE_DAYS 日）。読めなくても同期は続ける（完了済みの取り込みだけ見送る）
  let completed = null;
  let doneErr = '';
  if (!errors.length) {
    try { completed = ttReadDone_(access, projects, data); } catch (e) { doneErr = e.message; }
  }
  return { projects: projects, groups: groups, data: data, errors: errors, ok: !errors.length, completed: completed, doneErr: doneErr };
}
// 完了済みのタスクを読む（POST /task/completed。受信箱の id は読んだタスクか、前に覚えた id から）
function ttReadDone_(access, projects, data) {
  const ids = projects.map(function (pr) { return String(pr.id); });
  let inbox = ttProps_().getProperty('TT_INBOX_ID') || '';
  data.forEach(function (d) { if (d.project.inbox) d.tasks.forEach(function (t) { if (t.projectId) inbox = String(t.projectId); }); });
  if (inbox) ids.push(inbox);
  const now = Date.now();
  const from = ttProps_().getProperty('TT_DONE_FROM');
  let start = now - TT_DONE_DAYS * 86400000;
  if (from && Number(from) > start) start = Number(from);
  const body = { projectIds: ids, startDate: new Date(start).toISOString().replace(/Z$/, '+0000'), endDate: new Date(now + 86400000).toISOString().replace(/Z$/, '+0000') };
  const o = ttOpts_(access);
  o.method = 'post'; o.contentType = 'application/json'; o.payload = JSON.stringify(body);
  const list = ttParse_(UrlFetchApp.fetch(TT_API + '/task/completed', o), '完了済み');
  return (Array.isArray(list) ? list : []).filter(function (t) { return t && t.id && Number(t.status) === 2; });
}

// TickTick の日時（2026-11-02T15:00:00.000+0000）→ アプリの形。終日なら日付だけ（タスクの時間帯で読む）
function ttDateIn_(iso, allDay, tz) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  if (isNaN(d.getTime())) return '';
  if (allDay) return Utilities.formatDate(d, tz || TZ, 'yyyy-MM-dd');
  return fmt_(d, "yyyy-MM-dd'T'HH:mm");
}

// アプリの形（日本時間）→ TickTick の日時
function ttDateOut_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?$/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) - 9 * 3600000;
  return new Date(ms).toISOString().replace(/Z$/, '+0000');
}

// 開始日・期限 → やる日・期限（開始日と期限が同じなら、やる日だけ）
// v0.17.0 の決まり（2026-11-04 ユーザー）：TickTick の期間 → やる日（期間のまま）、終日の1日 → 期限、時刻つきの1日 → やる日
function ttDatesIn_(t) {
  const all = !!t.isAllDay;
  const s = ttDateIn_(t.startDate, all, t.timeZone);
  const d = ttDateIn_(t.dueDate, all, t.timeZone);
  if (s && d && s !== d) return { doDate: s, doEnd: d, due: '' };
  const one = s || d;
  if (!one) return { doDate: '', doEnd: '', due: '' };
  if (one.length === 10) return { doDate: '', doEnd: '', due: one };
  return { doDate: one, doEnd: '', due: '' };
}
// 前の決まり（v0.16.0 まで）。今あるタスクを新しい決まりに移すときだけ使う
function ttDatesInOld_(t) {
  const all = !!t.isAllDay;
  const s = ttDateIn_(t.startDate, all, t.timeZone);
  const d = ttDateIn_(t.dueDate, all, t.timeZone);
  if (s && d && s !== d) return { doDate: s, due: d };
  if (s) return { doDate: s, due: '' };
  return { doDate: '', due: d };
}
// アプリの日付 → TickTick に送って読み戻したときの形（写し）。アプリの日付はこの形で TickTick と比べる（v0.17.0）
//  期限がある → 期限だけ（日付だけの終日。やる日・期間・期限の時刻はアプリだけに残す）
//  期間のやる日 → 期間／時刻つきのやる日 → 時刻つきの1日／日付だけのやる日 → 期限（終日）
function ttProjDates_(rec) {
  const D = rec.doDate || '', E = rec.doEnd || '', U = rec.due || '';
  if (U) return { doDate: '', doEnd: '', due: U.slice(0, 10) };
  if (D && E && E > D) return { doDate: D, doEnd: E, due: '' };
  if (D && D.length > 10) return { doDate: D, doEnd: '', due: '' };
  // v0.23.0：期限を「いつか」にしたら TickTick 側の期限は消す（2026-11-07 本人がカードで決定）。
  // 日付だけの実行日は TickTick では期限（終日）に見えるので送らない（期間・時刻つきの実行日は予定として送る。Codex の指摘）
  if (D && isOn_(rec.isSomeday)) return { doDate: '', doEnd: '', due: '' };
  if (D) return { doDate: '', doEnd: '', due: D.slice(0, 10) };
  return { doDate: '', doEnd: '', due: '' };
}
// TickTick の日付（写しの形 n）をアプリのタスク a に書くときの日付。アプリだけに残しているものは消さない
//  TickTick が期限だけ：アプリに期限があれば、やる日・期間はアプリのまま。期限の日が同じなら時刻も残す
//  TickTick がやる日（期間・時刻つき）や日付なし：その形にする（アプリだけのやる日は置き換わる）
function ttMergeDates_(a, n, keepDo) {
  const D = a.doDate || '', E = a.doEnd || '', U = a.due || '';
  if (n.due) {
    // v0.20.0：アプリが「日付だけの実行日（期限なし）」なら、TickTick の終日の日付も実行日として受ける（期限に移さない。2026-11-06 ユーザーがカードで決定）
    if (keepDo && !U && D && D.length === 10 && !E && (!a.repeat || a.repeat === 'none')) return { doDate: n.due, doEnd: '', due: '' };
    const due = U && U.slice(0, 10) === n.due ? U : n.due;
    return U ? { doDate: D, doEnd: E, due: due } : { doDate: '', doEnd: '', due: due };
  }
  return { doDate: n.doDate || '', doEnd: n.doEnd || '', due: '' };
}
// v0.17.0：今つながっているタスクを新しい日付の決まりに移す。前回値に doEnd が無い行（前の決まりの行）だけを見て、1件ずつ確定する
// （途中で止まっても、残りは次の回に移す）。日付以外の前回値はそのまま（ほかの変更を取りこぼさない）
//  移す前にアプリだけで日付を変えていた → アプリの日付を送る。TickTick だけで変えていた → TickTick の日付を写す
//  両方で変えていた → ふつうの確認待ちの決まりに任せる。どちらも変えていない → TickTick の日付を新しい決まりでアプリに写す
//  （前の決まりの「やる日〜期限」＝TickTick の期間は、やる日の期間になる。2026-11-04 ユーザーがカードで決定）
//  答え：時間切れで移せなかった行の appId の集まり（この回はその行に触らない。次の回に移す）
function ttMigrateDates_(tmaps, appById, tt, ttDone, normA, msh) {
  const later = {};
  tmaps.forEach(function (m) {
    const t = m.ttId ? tt[m.ttId] || ttDone[m.ttId] : null;
    if (!t) return; // 一覧にないもの（古い完了済みなど）は、個別に読んだときに移す
    const S = m.snapObj;
    const old = S && S.a && S.t && !('doEnd' in S.a && 'doEnd' in S.t);
    if (old && ttOverBudget_()) { later[m.appId] = true; return; }
    ttMigrateRow_(m, appById[m.appId], t, normA, msh);
  });
  return later;
}
// 1件を移す（移したら true）。t が null のとき（TickTick で消えていた）は、アプリ側の前回値だけをその場で移す（対応表には書かない）
function ttMigrateRow_(m, a, t, normA, msh) {
  const X = '\u0000';
  const mark = { doDate: X, doEnd: X, due: X, raw: X };
  const pick = function (o) { return { doDate: o.doDate, doEnd: o.doEnd, due: o.due, raw: o.raw }; }; // raw：アプリの日付そのもの（アプリだけの編集を見分ける）
  const S = m.snapObj;
  if (!m.ttId || !S || !S.a || !S.t || ('doEnd' in S.a && 'doEnd' in S.t)) return false;
  if (!a) {
    // アプリで消していた：TickTick 側の前回値だけをその場で移す（消すかどうかの判定用。対応表には書かない）
    if (!t) return false;
    const oT = ttDatesInOld_(t);
    const tMoved = oT.doDate !== String(S.t.doDate || '') || oT.due !== String(S.t.due || '');
    m.snapObj = { a: S.a, t: Object.assign({}, S.t, tMoved ? mark : pick(ttNormTt_(t))) };
    return true;
  }
  const appMoved = String(a.doDate || '') !== String(S.a.doDate || '') || String(a.due || '') !== String(S.a.due || '');
  const an = normA(a);
  if (!t) { m.snapObj = { a: Object.assign({}, S.a, appMoved ? mark : pick(an)), t: S.t }; return true; }
  const oldT = ttDatesInOld_(t);
  const ttMoved = oldT.doDate !== String(S.t.doDate || '') || oldT.due !== String(S.t.due || '');
  const tn = ttNormTt_(t);
  let aD, tD;
  if (appMoved && ttMoved) { aD = mark; tD = mark; }
  else if (appMoved) { aD = mark; tD = pick(tn); }
  else if (an.doDate === tn.doDate && an.doEnd === tn.doEnd && an.due === tn.due) { aD = pick(an); tD = pick(tn); } // 写しがもう同じ：書き換えなくてよい（v0.17.1：最初の同期を軽く）
  else { aD = pick(an); tD = mark; } // TickTick だけで変えていた・どちらも変えていない → TickTick の日付を写す
  m.snapObj = { a: Object.assign({}, S.a, aD), t: Object.assign({}, S.t, tD) };
  ttWriteMap_(msh, m);
  TT_WORK_++;
  return true;
}
// やる日がなくなり期限に移ったとき、通知の「やる日の◯分前」を「期限の◯分前」に、繰り返しの起点（日付だけのやる日）を期限に直す
function ttRemsDoToDue_(rems) {
  return remList_(rems).map(function (r) { return r.replace(/^do:/, 'due:'); });
}
function ttBaseDoToDue_(base) {
  if (!base) return base || '';
  const p = String(base).split('|');
  if (p[0] && p[0].length === 10 && !p[1] && !p[3]) { p[1] = p[0]; p[0] = ''; return p.join('|'); }
  return base;
}
// v0.17.0：つながっていて同期の済んだタスクの「日付だけのやる日（期間でない・期限なし）」を、アプリでも期限にする
// （TickTick には終日＝期限として出ているため）。通知の「やる日の◯分前」は「期限の◯分前」に、繰り返しの起点も同じように直す
function ttCanonDates_(tmaps, appById, normA, msh) {
  const sh = sheet_(SHEET_TASKS, TASK_COLS);
  let n = 0;
  tmaps.forEach(function (m) {
    const a = appById[m.appId];
    const S = m.snapObj;
    if (!a || !m.ttId || m.state || m.conflictObj || !S || !S.a || !('doEnd' in S.a)) return;
    if (ttOverBudget_()) return; // 時間切れ：次の回に直す（v0.17.1）
    const D = String(a.doDate || '');
    if (!D || D.length !== 10 || a.doEnd || a.due) return;
    if (!a.repeat || a.repeat === 'none') return; // v0.20.0：繰り返さないタスクは実行日のまま
    if (ttDiff_(normA(a), S.a).length) return; // まだ送っていない変更がある（送れた回に直す）
    a.due = D; a.doDate = ''; a.doEnd = '';
    a.reminders = ttRemsDoToDue_(a.reminders).join(',');
    a.repeatBase = ttBaseDoToDue_(a.repeatBase);
    writeTask_(sh, a._row, a);
    TT_WORK_++;
    m.snapObj.a = Object.assign({}, S.a, { raw: normA(a).raw }); // 書き換えた日付を前回値にも（直したことにしない）
    ttWriteMap_(msh, m);
    n++;
  });
  return n;
}

// v0.18.0：前回値のアプリ側と TickTick 側で日付が食い違ったまま止まった行を直す
// （前の決まりの「時刻つきのやる日〜期限」が、アプリでは期限つきのまま残り、写しが期限だけになって TickTick の期間と比べられなくなっていた）
//  どちらも前回から直していないのに食い違う → TickTick の日付（前回値）をアプリに写す。完了済みの行も直す
function ttRepairStuck_(tmaps, appById, normA, msh) {
  const sh = sheet_(SHEET_TASKS, TASK_COLS);
  let n = 0;
  tmaps.forEach(function (m) {
    const a = appById[m.appId];
    const S = m.snapObj;
    if (!a || !m.ttId || m.state || m.conflictObj || !S || !S.a || !S.t || !('doEnd' in S.a) || !('doEnd' in S.t)) return;
    if (TT_DATES.every(function (k) { return String(S.a[k] || '') === String(S.t[k] || ''); })) return;
    // v0.18.1：前回値が「空き印」（\u0000＝次の同期で写す印）の行は直さない。印をそのまま日付としてアプリに写してしまい、
    // Web版で NaN・Android版が開けなくなった（2026-11-05）。印の行はふつうの同期に任せる
    if (TT_DATES.concat(['raw']).some(function (k) { return String(S.a[k] || '').indexOf('\u0000') >= 0 || String(S.t[k] || '').indexOf('\u0000') >= 0; })) return;
    if (ttAppEdited_(normA(a), S.a)) return; // アプリで直した分は、ふつうの同期に任せる
    if (ttOverBudget_()) return;
    const md = ttMergeDates_(a, { doDate: S.t.doDate || '', doEnd: S.t.doEnd || '', due: S.t.due || '' });
    if (md.doDate === (a.doDate || '') && md.doEnd === (a.doEnd || '') && md.due === (a.due || '')) return;
    // 前の決まりの「やる日〜期限」が期間に移る：繰り返しの起点も期限の置き場を期間の終わりへ（ふつうの同期の writeApp と同じ。Codex の指摘）
    if (a.due && !a.doEnd && md.doEnd && !md.due && a.repeatBase) {
      const bp = String(a.repeatBase).split('|');
      if (bp[0] && bp[1] && !bp[3]) { bp[3] = bp[1]; bp[1] = ''; a.repeatBase = bp.join('|'); }
    }
    a.doDate = md.doDate; a.doEnd = md.doEnd; a.due = md.due;
    writeTask_(sh, a._row, a);
    TT_WORK_++;
    const an = normA(a);
    m.snapObj.a = Object.assign({}, S.a, { doDate: an.doDate, doEnd: an.doEnd, due: an.due, raw: an.raw });
    ttWriteMap_(msh, m);
    n++;
  });
  // 対応から外れた古い完了済みの回（繰り返しで次の回に対応を移したもの）も、前の決まりの形なら期間に直す
  //  TickTick から来た回だと確かめられるものだけ：次の回をたどった先が TickTick とつながっていて、
  //  TickTick 側（前回値）が同じ時刻の期間（例：9:00〜9:15）のとき。アプリだけの繰り返しの期限は変えない（Codex の意見）
  const byApp = {};
  tmaps.forEach(function (m) { if (m.ttId) byApp[m.appId] = m; });
  const hm = function (x) { return String(x || '').slice(11, 16); };
  Object.keys(appById).forEach(function (id) {
    const a = appById[id];
    if (byApp[id] || !isOn_(a.done) || !a.nextId || a.doEnd) return;
    const D = String(a.doDate || ''), U = String(a.due || '');
    if (D.length <= 10 || U.length <= 10 || D.slice(0, 10) !== U.slice(0, 10) || U <= D) return;
    let m = null;
    for (let nx = a.nextId, i = 0; nx && i < 30 && !m; i++) { m = byApp[nx] || null; nx = appById[nx] ? appById[nx].nextId : ''; }
    const T = m && m.snapObj && m.snapObj.t;
    if (!T || !T.doEnd || hm(T.doDate) !== hm(D) || hm(T.doEnd) !== hm(U)) return;
    if (ttOverBudget_()) return;
    a.doEnd = U; a.due = '';
    writeTask_(sh, a._row, a);
    TT_WORK_++;
    n++;
  });
  return n;
}

// やる日・期限 → 開始日・期限（期限だけなら、開始日も期限にする。TickTick は期限だけを持てないため）
function ttDatesOut_(rec) {
  const p = ttProjDates_(rec);
  const s = p.doDate || p.due;
  const d = p.doEnd || p.doDate || p.due;
  if (!s) return { startDate: null, dueDate: null, isAllDay: null };
  const allDay = s.length === 10 && d.length === 10;
  return { startDate: ttDateOut_(s), dueDate: ttDateOut_(d), isAllDay: allDay, timeZone: TZ };
}

function ttRule_(flag) {
  const o = {};
  flag.replace(/^RRULE:/, '').split(';').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) o[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).toUpperCase();
  });
  return o;
}

// TickTick の繰り返し（RRULE）→ アプリの決め方。写せないときは repeat:'none' と、その理由（mark）
function ttRepeatIn_(t, anchor) {
  const flag = String(t.repeatFlag || '').trim();
  const no = function (why) { return { repeat: 'none', mark: why }; };
  if (!flag) return { repeat: 'none', mark: '' };
  if (String(t.repeatFrom) === '1') return no('完了した日から次の回を決める繰り返し');
  if (!/^RRULE:/i.test(flag)) return no('決まった日だけの繰り返し');
  const day = String(anchor || '').slice(0, 10);
  if (!day) return no('日付のない繰り返し');
  const o = ttRule_(flag);
  const known = { FREQ: 1, INTERVAL: 1, BYDAY: 1, BYMONTHDAY: 1, BYMONTH: 1, BYSETPOS: 1, WKST: 1, UNTIL: 1, TT_SKIP: 1 };
  const extra = Object.keys(o).filter(function (k) { return !known[k]; });
  if (extra.length) return no('アプリにない繰り返しの決め方（' + extra.join('・') + '）');
  // 終わりの日（UNTIL=20261231 か 20261231T145959Z）→ /until=2026-12-31（日本の日付）
  let until = '';
  if (o.UNTIL) {
    const u = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(o.UNTIL);
    if (!u) return no('読めない終わりの日');
    until = u[4] && u[7] ? fmt_(new Date(Date.UTC(+u[1], +u[2] - 1, +u[3], +u[4], +u[5], +u[6])), 'yyyy-MM-dd') : u[1] + '-' + u[2] + '-' + u[3];
    if (until < day) return no('もう終わった繰り返し');
  }
  // 飛ばす日（TT_SKIP）：祝日 → アプリの「祝日を除く」、週末 → 毎日なら平日の繰り返しに
  const skip = o.TT_SKIP ? o.TT_SKIP.split(',') : [];
  if (skip.some(function (x) { return x !== 'HOLIDAY' && x !== 'WEEKEND'; })) return no('アプリにない飛ばし方（' + o.TT_SKIP + '）');
  const tail = (skip.indexOf('HOLIDAY') >= 0 ? '/nh' : '') + (until ? '/until=' + until : '');
  const done = function (rule) { return { repeat: cleanRepeat_(rule + tail), mark: '' }; };
  const skipWeekend = skip.indexOf('WEEKEND') >= 0;
  const n = o.INTERVAL ? Number(o.INTERVAL) : 1;
  if (!(n >= 1 && n <= 99 && Math.floor(n) === n)) return no('間隔が大きすぎる繰り返し');
  const p = day.split('-').map(Number);
  const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const nth = Math.ceil(p[2] / 7);
  const lastWeek = p[2] + 7 > new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  if (o.FREQ === 'DAILY') {
    if (o.BYDAY || o.BYMONTHDAY || o.BYMONTH || o.BYSETPOS) return no('アプリにない毎日の繰り返し');
    if (skipWeekend) {
      if (n !== 1) return no('週末を飛ばす◯日ごとの繰り返し');
      if (wd === 0 || wd === 6) return no('やる日が週末の「週末を飛ばす」繰り返し');
      return done('weekly/1/1,2,3,4,5');
    }
    return done('daily/' + n);
  }
  if (o.FREQ === 'WEEKLY') {
    if (o.BYMONTHDAY || o.BYMONTH || o.BYSETPOS) return no('アプリにない毎週の繰り返し');
    const ds = o.BYDAY ? o.BYDAY.split(',') : [];
    if (ds.some(function (x) { return TT_DAYS.indexOf(x) < 0; })) return no('アプリにない毎週の繰り返し');
    const idx = ds.map(function (x) { return TT_DAYS.indexOf(x); }).sort(function (a, b) { return a - b; })
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (idx.length && idx.indexOf(wd) < 0) return no('やる日の曜日が入っていない毎週の繰り返し');
    // アプリは週を日曜から数える。2週以上の間隔で日曜とほかの曜日を選ぶと、週の始まり（WKST、決まりがなければ月曜）で日が変わる
    if (n > 1 && idx.length > 1 && idx[0] === 0 && o.WKST !== 'SU') return no('週の始まりが日曜でない隔週の繰り返し');
    // 週末を飛ばすのは、週末の曜日を選んでいなければ意味が同じ
    if (skipWeekend && (idx.length ? idx : [wd]).some(function (x) { return x === 0 || x === 6; })) return no('週末を飛ばす毎週の繰り返し');
    return done('weekly/' + n + (idx.length ? '/' + idx.join(',') : ''));
  }
  if (skipWeekend) return no('週末を飛ばす繰り返し');
  if (o.FREQ === 'MONTHLY') {
    // 条件を重ねた決め方（曜日と日にちの両方など）は、アプリの1つの決め方では表せない
    if (o.BYMONTH || (o.BYDAY && o.BYMONTHDAY) || (o.BYSETPOS && o.BYMONTHDAY)) return no('アプリにない毎月の繰り返し');
    let by = o.BYDAY || '';
    if (by && o.BYSETPOS && /^[A-Z]{2}$/.test(by)) by = o.BYSETPOS + by;
    else if (o.BYSETPOS) return no('アプリにない毎月の繰り返し');
    if (by) {
      const m = by.match(/^(-1|[1-4])([A-Z]{2})$/);
      if (!m || TT_DAYS.indexOf(m[2]) !== wd) return no('やる日と曜日が合わない毎月の繰り返し');
      if (m[1] === '-1') return lastWeek ? done('monthly/' + n + '/last') : no('やる日と合わない「最終◯曜日」の繰り返し');
      return Number(m[1]) === nth ? done('monthly/' + n + '/nth') : no('やる日と合わない「第◯◯曜日」の繰り返し');
    }
    if (o.BYMONTHDAY && Number(o.BYMONTHDAY) < 0) return no('月末から数える毎月の繰り返し');
    if (o.BYMONTHDAY && Number(o.BYMONTHDAY) !== p[2]) return no('やる日と日にちが合わない毎月の繰り返し');
    if (p[2] > 28) return no('29日〜31日の毎月の繰り返し（短い月の扱いが違う）');
    return done('monthly/' + n + '/day');
  }
  if (o.FREQ === 'YEARLY') {
    // 月を決めずに日にちだけ決めると、毎年でも毎月その日になる（RFC 5545）
    // 毎年◯月の第◯◯曜日・最終◯曜日
    if (o.BYDAY && o.BYMONTH && !o.BYMONTHDAY) {
      if (Number(o.BYMONTH) !== p[1]) return no('やる日と合わない毎年の繰り返し');
      let yb = o.BYDAY;
      if (o.BYSETPOS && /^[A-Z]{2}$/.test(yb)) yb = o.BYSETPOS + yb;
      else if (o.BYSETPOS) return no('アプリにない毎年の繰り返し');
      const ym = yb.match(/^(-1|[1-4])([A-Z]{2})$/);
      if (!ym || TT_DAYS.indexOf(ym[2]) !== wd) return no('やる日と曜日が合わない毎年の繰り返し');
      if (ym[1] === '-1') return lastWeek ? done('yearly/' + n + '/last') : no('やる日と合わない「最終◯曜日」の繰り返し');
      return Number(ym[1]) === nth ? done('yearly/' + n + '/nth') : no('やる日と合わない「第◯◯曜日」の繰り返し');
    }
    if (o.BYDAY || o.BYSETPOS || (o.BYMONTHDAY && !o.BYMONTH)) return no('アプリにない毎年の繰り返し');
    if ((o.BYMONTH && Number(o.BYMONTH) !== p[1]) || (o.BYMONTHDAY && Number(o.BYMONTHDAY) !== p[2])) return no('やる日と合わない毎年の繰り返し');
    if (p[1] === 2 && p[2] === 29) return no('2月29日の毎年の繰り返し');
    return done('yearly/' + n);
  }
  return no('アプリにない繰り返し');
}

// アプリの決め方 → TickTick の繰り返し（RRULE）。写せないときは flag:null と理由
function ttRepeatOut_(repeat, anchor) {
  const r = parseRepeat_(repeat);
  if (!r) return { flag: '', mark: '' };
  const no = function (why) { return { flag: null, mark: why }; };
  const iv = r.interval > 1 ? ';INTERVAL=' + r.interval : '';
  // 終わりの日と、祝日を飛ばす（TT_SKIP=HOLIDAY）は最後に付ける
  const tail = (r.until ? ';UNTIL=' + r.until.replace(/-/g, '') : '') + (r.nh ? ';TT_SKIP=HOLIDAY' : '');
  const ok = function (f) { return { flag: f + tail, mark: '' }; };
  const day = String(anchor || '').slice(0, 10);
  if (r.freq === 'daily') return ok('RRULE:FREQ=DAILY' + iv);
  if (r.freq === 'weekly') {
    const wkst = r.interval > 1 && r.days.length > 1 && r.days[0] === 0 ? ';WKST=SU' : ''; // アプリと同じく週を日曜から数える
    return ok('RRULE:FREQ=WEEKLY' + iv + wkst + (r.days.length ? ';BYDAY=' + r.days.map(function (d) { return TT_DAYS[d]; }).join(',') : ''));
  }
  if (r.freq === 'yearly' && r.by !== 'day') {
    if (!day) return no('日付のない繰り返し');
    const yp = day.split('-').map(Number);
    const ywd = TT_DAYS[new Date(Date.UTC(yp[0], yp[1] - 1, yp[2])).getUTCDay()];
    if (r.by === 'last') return ok('RRULE:FREQ=YEARLY' + iv + ';BYMONTH=' + yp[1] + ';BYDAY=-1' + ywd);
    if (Math.ceil(yp[2] / 7) > 4) return no('第5◯曜日の繰り返し（ない年の扱いが違う）');
    return ok('RRULE:FREQ=YEARLY' + iv + ';BYMONTH=' + yp[1] + ';BYDAY=' + Math.ceil(yp[2] / 7) + ywd);
  }
  if (r.freq === 'yearly') {
    if (day.slice(5) === '02-29') return no('2月29日の毎年の繰り返し');
    return ok('RRULE:FREQ=YEARLY' + iv);
  }
  if (!day) return no('日付のない繰り返し');
  const p = day.split('-').map(Number);
  const wd = TT_DAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  if (r.by === 'last') return ok('RRULE:FREQ=MONTHLY' + iv + ';BYDAY=-1' + wd);
  if (r.by === 'nth') {
    const nth = Math.ceil(p[2] / 7);
    if (nth > 4) return no('第5◯曜日の繰り返し（ない月の扱いが違う）');
    return ok('RRULE:FREQ=MONTHLY' + iv + ';BYDAY=' + nth + wd);
  }
  if (p[2] > 28) return no('29日〜31日の毎月の繰り返し（短い月の扱いが違う）');
  return ok('RRULE:FREQ=MONTHLY' + iv + ';BYMONTHDAY=' + p[2]);
}

// TickTick のタスク → アプリのタスクの中身（id・フォルダ・親はあとで決める）と、写せなかったことの印
function ttTaskIn_(t) {
  const marks = [];
  const dates = ttDatesIn_(t);
  const rep = ttRepeatIn_(t, dates.doDate || dates.due);
  if (rep.mark) marks.push(rep.mark);
  // メモ（ノート）の形は、日付のない普通のタスクとして取り込む（TickTick 側はノートのまま）
  const items = (t.items || []).slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  const checklist = parseList_(items.map(function (x) { return { t: x.title || '', d: Number(x.status) === 1 }; }));
  const memo = String((t.kind === 'CHECKLIST' ? t.desc : t.content) || t.content || t.desc || '');
  return {
    rec: { title: String(t.title || '').trim() || '（名前なし）', memo: memo, doDate: dates.doDate, doEnd: dates.doEnd, due: dates.due,
      repeat: rep.repeat, checklist: checklist, ttId: String(t.id), ttParent: t.parentId ? String(t.parentId) : '', priority: Number(cleanPriority_(t.priority)) || 0 },
    marks: marks
  };
}

// 取り込みの下見（読むだけ）。TickTick の未完了のタスクを、アプリにどう写すかの一覧を返す
function ttPreview() {
  const r = ttReadAll_();
  const appLists = lists_();
  const appNames = {};
  appLists.forEach(function (l) { appNames[l.name] = (appNames[l.name] || 0) + 1; });
  const groupName = {};
  (r.groups || []).forEach(function (g) { if (g && g.id) groupName[g.id] = String(g.name || ''); });
  const all = {};
  r.data.forEach(function (d) { d.tasks.forEach(function (t) { all[String(t.id)] = t; }); });
  const lists = [];
  const tasks = [];
  const counts = { tasks: 0, sub: 0, checklist: 0, repeat: 0, marked: 0 };
  let unnamed = 0;
  r.data.forEach(function (d) {
    const pr = d.project;
    // 名前を読めないフォルダは、まとまりごとに「名前を読めないフォルダ1・2…」と仮の名前を付ける
    if (pr.groupId && !groupName[pr.groupId]) groupName[pr.groupId] = '（名前を読めないフォルダ' + (++unnamed) + '）';
    const group = pr.groupId ? groupName[pr.groupId] : '';
    lists.push({ name: pr.name, group: group, count: d.tasks.length, inApp: !!appNames[pr.name], inbox: !!pr.inbox });
    d.tasks.forEach(function (t) {
      const x = ttTaskIn_(t);
      if (x.rec.ttParent && !all[x.rec.ttParent]) x.marks.push('親のタスクが見つからない（子タスクにしない）');
      counts.tasks++;
      if (x.rec.ttParent && all[x.rec.ttParent]) counts.sub++;
      if (x.rec.checklist.length) counts.checklist++;
      if (x.rec.repeat !== 'none') counts.repeat++;
      if (x.marks.length) counts.marked++;
      tasks.push({ title: x.rec.title, list: pr.name, doDate: x.rec.doDate, due: x.rec.due, repeat: x.rec.repeat,
        checklist: x.rec.checklist.length, parent: x.rec.ttParent && all[x.rec.ttParent] ? String(all[x.rec.ttParent].title || '') : '',
        marks: x.marks });
    });
  });
  const mine = allTasks_();
  return { ok: r.ok, errors: r.errors, groupsRead: !!r.groups, lists: lists, tasks: tasks, counts: counts,
    app: { all: mine.length, open: mine.filter(function (t) { return !t.done; }).length, lists: appLists.length } };
}

// ---- TickTick との同期（v0.15.0：最初の取り込みと、両方向の同期） ----
// 対応表（シート「TickTick対応」）：kind（task・list・group）、appId、ttId、ttProject、snap（前回同期したときの共通の中身）、
// state（pending＝TickTick に作りかけ）、conflict（両方で同じところを直したときの、両方の中身）
// 同期は「前回の中身（snap）」と比べて、変わった側の中身をもう片方へ写す。両方で同じところが違う値になったら、
// どちらも書き換えずに「確認待ち」にする（⚙ で選ぶ）。読めなかったものを「消えた」とは扱わない
const SHEET_TT = 'TickTick対応';
// prevApp：繰り返しの完了で対応を次の回へ移したときの、ひとつ前の回の id（完了を取り消したら、そちらへ対応を戻す）
const TT_COLS = ['kind', 'appId', 'ttId', 'ttProject', 'snap', 'state', 'conflict', 'updatedAt', 'prevApp'];
const TT_DATES = ['doDate', 'doEnd', 'due'];
const TT_FIELDS = ['title', 'memo', 'doDate', 'doEnd', 'due', 'repeat', 'checklist', 'list', 'parent', 'done', 'priority'];
// v0.16.0：TickTick の完了済みを読む範囲（日）。この範囲で見つかった完了済みは、追加・更新にだけ使う（載っていないことを削除の根拠にしない）
const TT_DONE_DAYS = 30;
const TT_DONE_CHECK = 3; // 1回の同期で読み直す、両側で完了済みのタスクの数（TickTick だけの編集を拾うため）
// v0.17.1：1回の同期で鍵を持つ時間のめやす（ミリ秒）。書き込みを始めてからこれを過ぎたら、残りは次の回に回す
// （画面の操作は鍵を10秒しか待たないため。最初の移し替えなど、書くものが多い回でも長く止めない）
let TT_BUDGET_MS_ = 6000;
let TT_T0_ = 0;     // この回の同期を始めた時刻
let TT_WORK_ = 0;   // この段で、重い書き込み（アプリの行・移し替え）をした回数。0 のうちは時間を過ぎても止めない（必ず少しは進める）
function ttOverBudget_() { return TT_WORK_ > 0 && Date.now() - TT_T0_ > TT_BUDGET_MS_; }
const TT_MAX_WRITES = 10; // 1回の同期で TickTick に書く回数の上限（画面の操作を長く待たせない。残りは次の回）
const TT_INBOX = 'inbox';

function ttProjKey_(pid) { return /^inbox/.test(String(pid || '')) ? TT_INBOX : String(pid || ''); }

// 共通の中身（アプリの形にそろえる）
function ttNormApp_(a, listTt, taskTt) {
  const p = ttProjDates_(a);
  // raw：アプリの日付そのもの（送る中身の比べ方には使わない。TickTick で消されたとき、アプリだけの日付の編集を守るのに使う）
  return { title: String(a.title || ''), memo: String(a.memo || ''), doDate: p.doDate, doEnd: p.doEnd, due: p.due,
    raw: [a.doDate || '', a.doEnd || '', a.due || ''].join('|') + (a.dueEnd ? '|' + a.dueEnd : ''), repeat: cleanRepeat_(a.repeat),
    checklist: JSON.stringify(parseList_(a.checklist)), list: listTt[a.listId] || '', parent: a.parentTaskId ? taskTt[a.parentTaskId] || '' : '',
    done: isOn_(a.done), priority: Number(cleanPriority_(a.priority)) || 0 };
}
// 写せない繰り返しは「tt:」で始まる目印にする（アプリでは繰り返しなし。TickTick の決め方はそのまま残す）
const TT_KEEP = 'tt:';
function ttNormTt_(t) {
  const x = ttTaskIn_(t).rec;
  const rp = ttRepeatIn_(t, x.doDate || x.due);
  const repeat = rp.mark ? TT_KEEP + String(t.repeatFlag || '') + (String(t.repeatFrom) === '1' ? '|1' : '') : x.repeat;
  return { title: x.title, memo: x.memo, doDate: x.doDate, doEnd: x.doEnd || '', due: x.due, repeat: repeat, checklist: JSON.stringify(x.checklist),
    list: ttProjKey_(t.projectId), parent: x.ttParent, done: Number(t.status) === 2, priority: Number(cleanPriority_(t.priority)) || 0 };
}
function ttDiff_(a, b) {
  return TT_FIELDS.filter(function (f) { return String(a[f]) !== String(b[f]); });
}
// アプリを前回から直したか（アプリだけに残す日付の編集も含める。前の版の前回値で raw が無ければ、送る中身だけで見る）
//  前の決まり（v0.16.0 まで）の前回値（doEnd が無い）なら、日付はアプリの日付そのもの（やる日・期限）で比べる
function ttAppEdited_(an, Sa) {
  if (!('doEnd' in Sa)) {
    const r = String(an.raw || '').split('|');
    if (String(r[0] || '') !== String(Sa.doDate || '') || String(r[2] || '') !== String(Sa.due || '') || r[1]) return true;
    return ttDiff_(an, Sa).some(function (f) { return TT_DATES.indexOf(f) < 0; });
  }
  return ttDiff_(an, Sa).length > 0 || (Sa.raw !== undefined && String(an.raw) !== String(Sa.raw));
}

function ttMapRows_() {
  return rows_(SHEET_TT, TT_COLS, 'kind').map(function (r) {
    r.snapObj = r.snap ? JSON.parse(r.snap) : null;
    r.conflictObj = r.conflict ? JSON.parse(r.conflict) : null;
    // v0.23.0：優先度を同期に足した。前の版の前回値には優先度がないので「どちらも なし だった」とみなす
    // （TickTick で付けていた優先度は、TickTick 側の変更としてアプリに写る）
    if (r.kind === 'task' && r.snapObj) ['a', 't'].forEach(function (k) { if (r.snapObj[k] && !('priority' in r.snapObj[k])) r.snapObj[k].priority = 0; });
    return r;
  });
}
function ttWriteMap_(sh, r) {
  TT_TOUCHED_ = true;
  const o = {};
  TT_COLS.forEach(function (c) { o[c] = r[c]; });
  o.snap = r.snapObj ? JSON.stringify(r.snapObj) : '';
  o.conflict = r.conflictObj ? JSON.stringify(r.conflictObj) : '';
  o.updatedAt = nowStr_();
  if (!r._row) r._row = sh.getLastRow() + 1;
  writeRow_(sh, r._row, TT_COLS, o);
}
// 対応表の行を消す（下の行から）
function ttDropMaps_(sh, rows) {
  if (rows.some(function (r) { return r._row; })) TT_TOUCHED_ = true;
  rows.filter(function (r) { return r._row; }).sort(function (a, b) { return b._row - a._row; })
    .forEach(function (r) { sh.deleteRow(r._row); dirty_(); r._row = 0; });
}

// TickTick へ書く（POST / DELETE）。書けなければ例外
function ttSend_(method, path, body) {
  const o = ttOpts_(ttAccess_());
  o.method = method;
  if (String(method).toLowerCase() !== 'get') TT_TOUCHED_ = true;
  if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(TT_API + path, o);
  const code = res.getResponseCode();
  if (code === 401) throw new Error('TickTick の鍵が切れています。⚙ でつなぎ直してください。');
  if (code === 404) return { notFound: true };
  if (code < 200 || code >= 300) throw new Error('TickTick に書けませんでした（' + code + '）');
  const txt = res.getContentText();
  try { return txt ? JSON.parse(txt) : {}; } catch (e) { return {}; }
}

// アプリの中身 → TickTick のタスク（base に重ねる。base にある通知・タグ・優先度などはそのまま残す）
// keepRepeat：TickTick の写せない繰り返しを、そのまま残す
function ttTaskOut_(n, base, projectId, parentTt, keepRepeat) {
  const t = Object.assign({}, base || {});
  t.title = n.title;
  if (t.kind === 'CHECKLIST') t.desc = n.memo; else t.content = n.memo;
  const d = ttDatesOut_({ doDate: n.doDate, doEnd: n.doEnd, due: n.due });
  t.startDate = d.startDate; t.dueDate = d.dueDate;
  if (d.startDate) { t.isAllDay = d.isAllDay; t.timeZone = TZ; }
  const anchor = (n.doDate || n.due || '').slice(0, 10);
  const rep = keepRepeat || String(n.repeat).indexOf(TT_KEEP) === 0 ? { flag: null } : ttRepeatOut_(n.repeat, anchor);
  if (rep.flag !== null) { t.repeatFlag = rep.flag || ''; if (!rep.flag) delete t.repeatFrom; }
  const items = JSON.parse(n.checklist || '[]');
  // チェックリストは、名前と済みが同じ項目の id を引き継ぐ
  const old = (base && base.items) || [];
  t.items = items.map(function (x, i) {
    const hit = old.filter(function (o) { return o.title === x.t; })[0];
    return Object.assign({}, hit || {}, { title: x.t, status: x.d ? 1 : 0, sortOrder: i });
  });
  if (projectId && projectId !== TT_INBOX) t.projectId = projectId; else if (!base) delete t.projectId;
  t.parentId = parentTt || null;
  if ('priority' in n) t.priority = Number(cleanPriority_(n.priority)) || 0; // v0.23.0
  return t;
}

// 同期のスイッチ。入れると5分ごとに同期する
function ttSetSync(on) { return withLock_(function () { return ttSetSync_(on); }); }
function ttSetSync_(on) {
  const p = ttProps_();
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'ttSyncTrigger') ScriptApp.deleteTrigger(tr);
  });
  if (on) {
    if (!p.getProperty('TT_IMPORTED')) throw new Error('先に「最初の取り込み」をしてください。');
    ttAccess_();
    p.deleteProperty('TT_RESTORED'); // v0.26.0：戻したあとの再開
    p.setProperty('TT_SYNC', '1');
    ScriptApp.newTrigger('ttSyncTrigger').timeBased().everyMinutes(5).create();
  } else {
    p.deleteProperty('TT_SYNC');
  }
  return ttStatus();
}

function ttSyncTrigger() {
  if (ttProps_().getProperty('TT_SYNC') !== '1') return;
  try { ttSyncRun_(false); } catch (e) { /* ttSyncRun_ が状態に書く */ }
}

// 対応表を変えたしるし（同期の読み取りが古くなっていないかを確かめるため）
function ttBumpGen_() { ttProps_().setProperty('TT_GEN', String(Date.now()) + Math.random().toString(36).slice(2, 6)); }

function ttSaveStatus_(o) {
  o.at = nowStr_();
  ttProps_().setProperty('TT_STATUS', JSON.stringify(o));
}

// 今すぐ同期する（画面の ⟳ から。スイッチが切れていても1回だけ同期する）。答え：{ ok, msg, toApp, toTt, conflicts, more }
function ttSyncNow() { return ttSyncRun_(true); }
function ttSyncRun_(manual) {
  const p = ttProps_();
  // v0.26.0：バックアップから戻したあとは、本人が「同期を入れる」で再開するまで同期しない
  if (p.getProperty('TT_RESTORED')) throw new Error('バックアップから戻したので同期を止めています。中身を確かめてから「同期を入れる」で再開してください。');
  try {
    // 読み取りのあいだに別の同期（や確認待ちの片付け・取り込み）が対応表を変えていたら、古い読み取りでは書かずに読み直す
    let out = null;
    for (let tries = 0; tries < 3 && !out; tries++) {
      if (!p.getProperty('TT_IMPORTED')) throw new Error('先に「最初の取り込み」をしてください。');
      const gen = p.getProperty('TT_GEN') || '';
      const r = ttReadAll_();
      if (!r.ok) throw new Error('TickTick の一部を読めませんでした（' + r.errors.join('／') + '）。今回は何も書き換えません。');
      out = withLock_(function () {
        if ((p.getProperty('TT_GEN') || '') !== gen) return null;
        if (!p.getProperty('TT_IMPORTED')) throw new Error('先に「最初の取り込み」をしてください。');
        if (p.getProperty('TT_RESTORED')) throw new Error('バックアップから戻したので同期を止めています。中身を確かめてから「同期を入れる」で再開してください。');
        TT_MANUAL_ = !!manual;
        try { return ttSyncApply_(r); } finally { TT_MANUAL_ = false; }
      });
    }
    if (!out) throw new Error('ほかの同期と重なったので、今回は見送りました。少しあとでもう一度どうぞ。');
    if (out.stopped) return { ok: true, msg: '同期は止めてあります', toApp: 0, toTt: 0, conflicts: 0 };
    out.ok = true;
    out.msg = '同期しました（アプリへ ' + out.toApp + '・TickTick へ ' + out.toTt + (out.conflicts ? '・確認待ち ' + out.conflicts : '') + (out.more ? '・残りは次の回' : '') + '）';
    ttSaveStatus_(out);
    return out;
  } catch (e) {
    ttSaveStatus_({ ok: false, msg: e.message });
    throw e;
  }
}

// 読んだ TickTick の中身と、アプリ・対応表を突き合わせて、両方へ書く（鍵を持って呼ぶ）
// 対応表の「前回」（snap）は両側の形で持つ：{ a: アプリの形, t: TickTick の形 }。
// 片方にしかない書き方（期限だけ・写せない繰り返しなど）でも、変わったかどうかを取り違えない
// v0.16.0：途中で例外になっても、対応表か TickTick を1回でも書いていたら世代を上げる（古い読み取りの同期に書かせない）
let TT_TOUCHED_ = false;
function ttSyncApply_(r) {
  TT_TOUCHED_ = false;
  try { return ttSyncApplyBody_(r); }
  finally { if (TT_TOUCHED_) ttBumpGen_(); TT_TOUCHED_ = false; }
}
function ttSyncApplyBody_(r) {
  if (ttProps_().getProperty('TT_SYNC') !== '1' && !TT_MANUAL_) {
    // スイッチを切った直後に動き出した回は、何も書かない
    return { toApp: 0, toTt: 0, conflicts: 0, more: false, stopped: true };
  }
  const st = { toApp: 0, toTt: 0, conflicts: 0, more: false, writes: 0 };
  TT_T0_ = Date.now(); TT_WORK_ = 0;
  if (!ttProps_().getProperty('TT_DONE_SINCE')) ttProps_().setProperty('TT_DONE_SINCE', nowStr_());
  // 最初の取り込みでは TickTick に何も書かない
  const can = function () {
    if (TT_IMPORTING_) return false;
    if (st.writes >= TT_MAX_WRITES) { st.more = true; return false; }
    st.writes++;
    return true;
  };
  const msh = sheet_(SHEET_TT, TT_COLS);
  let maps = ttMapRows_();
  const drop = [];
  let holdList_ = false;
  const isDate = function (f) { return TT_DATES.indexOf(f) >= 0; };
  // ---- フォルダ（TickTick のフォルダ → 上のフォルダ、リスト → フォルダ） ----
  ttSyncLists_(r, maps, msh, st, can);
  maps = ttMapRows_();
  const listTt = {};
  const listApp = {};
  maps.filter(function (m) { return m.kind === 'list'; }).forEach(function (m) { listTt[m.appId] = m.ttId; listApp[m.ttId] = m.appId; });
  const projOk = {};
  r.data.forEach(function (d) { projOk[d.project.inbox ? TT_INBOX : d.project.id] = true; });
  const realProj = {}; // 受信箱の本当の id（タスクの projectId から分かる）
  const tt = {};
  r.data.forEach(function (d) {
    d.tasks.forEach(function (t) { tt[String(t.id)] = t; if (d.project.inbox && t.projectId) realProj[TT_INBOX] = t.projectId; });
  });
  // v0.16.0：TickTick の完了済み（読めた回だけ。未完了の一覧にもあるものは除く）
  const ttDone = {};
  (r.completed || []).forEach(function (t) { if (!tt[String(t.id)]) ttDone[String(t.id)] = t; });
  // 受信箱の本当の id は覚えておく（受信箱が空の回でも、受信箱へ移せるように）
  const props = ttProps_();
  if (realProj[TT_INBOX] && props.getProperty('TT_INBOX_ID') !== realProj[TT_INBOX]) props.setProperty('TT_INBOX_ID', realProj[TT_INBOX]);
  const inboxId = function () { return realProj[TT_INBOX] || props.getProperty('TT_INBOX_ID') || ''; };
  // 送り先のリストの id。受信箱の id が分からなければ ''（受信箱への移動は、分かるまで待つ）
  const projOf = function (key) { return key === TT_INBOX ? inboxId() : key; };
  const taskPath = function (t) { return '/project/' + encodeURIComponent(t.projectId) + '/task/' + encodeURIComponent(t.id); };
  // ---- タスク ----
  const tmaps = maps.filter(function (m) { return m.kind === 'task'; });
  const taskTt = {};
  const taskApp = {};
  tmaps.forEach(function (m) { if (m.ttId) { taskTt[m.appId] = m.ttId; taskApp[m.ttId] = m.appId; } });
  let appAll = [];
  let appById = {};
  const reload = function () { appAll = rows_(SHEET_TASKS, TASK_COLS); appById = {}; appAll.forEach(function (a) { appById[a.id] = a; }); };
  reload();
  const normA = function (a) { return ttNormApp_(a, listTt, taskTt); };
  TT_WORK_ = 0; // 段ごとに、少なくとも1件は進める
  const migLater = ttMigrateDates_(tmaps, appById, tt, ttDone, normA, msh);
  const toAppFields = function (n) {
    return { title: n.title, memo: n.memo, doDate: n.doDate, doEnd: n.doEnd || '', due: n.due,
      repeat: String(n.repeat).indexOf(TT_KEEP) === 0 ? 'none' : n.repeat, checklist: JSON.parse(n.checklist),
      listId: listApp[n.list] || '', parentTaskId: n.parent ? taskApp[n.parent] || '' : '', priority: n.priority || 0 };
  };
  // アプリのタスクを TickTick の中身で書き換える（完了は setDone_ で。繰り返し・子の決まりを守る）
  const writeApp = function (a, n, fields) {
    TT_WORK_++;
    const rest = fields.filter(function (f) { return f !== 'done'; });
    if (rest.length) {
      const f = toAppFields(n);
      // 親子の入れ替え（TickTick で B を A から外し、A を B の下へ）：新しい親がまだアプリでこのタスクの子・孫なら、
      // 先にその親を TickTick での所属へ移して、循環しないようにする
      if (rest.indexOf('parent') >= 0 && f.parentTaskId) {
        const desc = descendants_(appAll, a.id);
        const hit = desc.filter(function (d) { return d.id === f.parentTaskId; })[0];
        if (hit) {
          const ttP = tt[taskTt[hit.id]];
          let np = ttP && ttP.parentId ? taskApp[String(ttP.parentId)] || '' : '';
          if (np === a.id || descendants_(appAll, hit.id).some(function (d) { return d.id === np; })) np = '';
          const th = toTask_(hit);
          th.parentTaskId = np;
          saveTask_(th);
          reload();
          a = appById[a.id] || a;
        }
      }
      const t = toTask_(a);
      // 日付は3つをまとめて写す。アプリだけに残しているやる日・期限の時刻は消さない（v0.17.0）
      if (rest.indexOf('doDate') >= 0 || rest.indexOf('doEnd') >= 0 || rest.indexOf('due') >= 0) {
        const md = ttMergeDates_(a, n, true);
        t.doDate = md.doDate; t.doEnd = md.doEnd; t.due = md.due;
        delete t.dueEnd; // v0.25.0：期限の終わりは saveTask_ が今の値から決める（日が変われば同じ日数ずらす・期限が消えれば消す）
        // やる日だけだったタスクが期限に移る（今あるタスクの移し替え・TickTick で終日にした）：通知と繰り返しの起点も期限に
        if (a.doDate && !a.due && !md.doDate && md.due) {
          t.reminders = ttRemsDoToDue_(t.reminders);
          if (t.repeatBase && md.due === a.doDate.slice(0, 10) && rest.indexOf('repeat') < 0) { // 同じ日のまま期限に移っただけ（起点を期限の形に直せたときだけ残す。時刻つきの起点などはふつうどおり起点から作り直す）
            const nb = ttBaseDoToDue_(t.repeatBase);
            if (nb !== t.repeatBase) { t.repeatBase = nb; t._keepRepeat = true; }
          }
        }
        // 前の決まりの「やる日〜期限」が、同じ日付のまま「やる日の期間」に移る：繰り返しの起点も期限の置き場を期間の終わりへ
        if (a.doDate && a.due && !a.doEnd && md.doDate === a.doDate && md.doEnd === a.due && !md.due && t.repeatBase && rest.indexOf('repeat') < 0) {
          const bp = String(t.repeatBase).split('|');
          if (bp[0] && bp[1] && !bp[3]) { bp[3] = bp[1]; bp[1] = ''; t.repeatBase = bp.join('|'); t._keepRepeat = true; }
        }
      }
      rest.forEach(function (k) {
        if (k === 'list') t.listId = f.listId || t.listId;
        else if (k === 'parent') t.parentTaskId = f.parentTaskId;
        else if (k !== 'doDate' && k !== 'doEnd' && k !== 'due') t[k] = f[k];
      });
      if (rest.indexOf('parent') < 0) delete t.parentTaskId;
      t.done = isOn_(a.done);
      saveTask_(t);
    }
    if (fields.indexOf('done') >= 0) setDone_(a.id, n.done, false);
    st.toApp++;
    reload();
  };
  // 両側で完了済みのタスクは、TickTick の未完了の一覧に出てこない。TickTick だけの編集も拾えるよう、毎回いくつかずつ順番に読み直す
  const mapByApp = {};
  tmaps.forEach(function (m) { mapByApp[m.appId] = m; });
  const doneCheck = {};
  (function () {
    const ids = tmaps.filter(function (m) { const a0 = appById[m.appId]; return m.ttId && !tt[m.ttId] && a0 && isOn_(a0.done) && m.snapObj && m.snapObj.a && m.snapObj.a.done; })
      .map(function (m) { return m.appId; }).sort();
    if (!ids.length) return;
    const last = props.getProperty('TT_DONE_CURSOR') || '';
    let i = ids.findIndex(function (x) { return x > last; });
    if (i < 0) i = 0;
    let pick = '';
    for (let k = 0; k < Math.min(TT_DONE_CHECK, ids.length); k++) { pick = ids[(i + k) % ids.length]; doneCheck[pick] = true; }
    props.setProperty('TT_DONE_CURSOR', pick);
  })();
  TT_WORK_ = 0;
  tmaps.forEach(function (m) {
    if (!st.more && ttOverBudget_()) st.more = true; // 時間切れ：残りは次の回（v0.17.1）
    if (st.more || migLater[m.appId]) return;
    let S = m.snapObj;
    let a = appById[m.appId];
    // 繰り返しの完了を取り消した（次の回が消え、ひとつ前の回が未完了に戻った）：対応をその回へ戻す。
    // TickTick の同じタスクを、戻した回の中身（日付など）で直す（消して作り直すと、タグ・優先度・通知が消えるため）
    const pv = m.prevApp ? appById[m.prevApp] : null;
    if (!a && m.ttId && pv && !isOn_(pv.done) && !taskTt[pv.id]) {
      delete taskTt[m.appId];
      m.appId = pv.id; m.prevApp = '';
      taskTt[pv.id] = m.ttId; taskApp[m.ttId] = pv.id;
      a = pv;
    }
    // 作りかけ（TickTick に送ったが id が残っていない）：同じ名前・同じリストで、まだ対応のないものがあれば、それを使う
    if (m.state === 'pending' && !m.ttId) {
      const hit = Object.keys(tt).concat(Object.keys(ttDone)).filter(function (id) {
        const t = tt[id] || ttDone[id];
        // 照合は送ったときの名前で（そのあとアプリで名前を変えても見つけられる。変えた名前は次の回に写る）
        return !taskApp[id] && S && S.a && String(t.title || '').trim() === String(S.a.title || '').trim() && ttProjKey_(t.projectId) === S.a.list;
      })[0];
      if (hit) {
        const ht = tt[hit] || ttDone[hit];
        m.ttId = hit; m.state = ''; m.ttProject = String(ht.projectId || '');
        taskApp[hit] = m.appId; taskTt[m.appId] = hit;
        m.snapObj = { a: S.a, t: S.t || ttNormTt_(ht) };
        ttWriteMap_(msh, m);
      } else {
        drop.push(m); // 届いていなかった。次の回にもう一度作る
      }
      return;
    }
    const t = tt[m.ttId];
    if (!S) { if (!a && !t) drop.push(m); return; }
    // TickTick で新しく作った親の下へ移した：親はこの回のあとでアプリに作るので、このタスクは次の回に回す（前回値も変えない）
    if (t && t.parentId && tt[String(t.parentId)] && !taskApp[String(t.parentId)]) return;
    if (!a && !t) {
      // アプリで消した。TickTick の未完了の一覧にないのは、完了済みだからかもしれない：確かめて、直していなければ TickTick も消す
      if (!projOk[S.t.list]) return;
      if (!can()) return;
      const gp = projOf(S.t.list) || m.ttProject;
      const g0 = gp ? ttSend_('get', '/project/' + encodeURIComponent(gp) + '/task/' + encodeURIComponent(m.ttId)) : { notFound: true };
      if (!g0.notFound && g0.id && ttMigrateRow_(m, null, g0, normA, msh)) S = m.snapObj; // 前の決まりの前回値なら、比べる前に移す
      if (!g0.notFound && g0.id && !ttDiff_(ttNormTt_(g0), S.t).length) {
        ttSend_('delete', '/project/' + encodeURIComponent(g0.projectId || gp) + '/task/' + encodeURIComponent(m.ttId));
        st.toTt++;
      }
      drop.push(m); // TickTick で直していた完了済みのタスクは残す（完了済みは取り込まない）
      return;
    }
    if (!a) {
      // アプリで消した。TickTick を直していなければ TickTick も消す。直していたら、TickTick の中身をアプリに作り直す
      if (!projOk[S.t.list]) return;
      const tn = ttNormTt_(t);
      if (!ttDiff_(tn, S.t).length) {
        if (!can()) return;
        ttSend_('delete', taskPath(t));
        st.toTt++;
        drop.push(m);
      } else {
        drop.push(m); // あとの「対応のない TickTick のタスク」の処理でアプリに作る
        delete taskApp[m.ttId];
      }
      return;
    }
    if (!t) {
      // TickTick の未完了の一覧にない：完了・やらない・削除のどれかを確かめる（リストを読めなかったときは何もしない）
      if (!projOk[S.t.list]) return;
      const dn = ttDone[m.ttId];
      const dnChanged = !!dn && ttDiff_(ttNormTt_(dn), S.t).length > 0; // 完了済みの一覧で、TickTick だけの編集が見えた（v0.16.0）
      if (isOn_(a.done) && S.a.done && !ttDiff_(normA(a), S.a).length && !doneCheck[a.id] && !dnChanged) return; // どちらも完了済みで、アプリも直していない（読み直す番でもない）
      if (m.conflictObj) return; // 確認待ち（⚙ で選ぶまで待つ。書き込み枠は使わない）
      if (!can()) return;
      const pid = projOf(S.t.list) || m.ttProject;
      const got = pid ? ttSend_('get', '/project/' + encodeURIComponent(pid) + '/task/' + encodeURIComponent(m.ttId)) : { notFound: true };
      // 一覧になかった前の決まりの行（30日より前に完了など）も、比べる前に新しい日付の決まりへ移す（v0.17.0）
      if (ttMigrateRow_(m, a, got.notFound ? null : got, normA, msh)) S = m.snapObj;
      let an = normA(a);
      // アプリで前回から変えた欄を、TickTick の中身 got に重ねて送る（status は渡した値）。答え：{ t: 送ったあとの TickTick の形, hold }
      const pushEdits = function (gn, status) {
        let edits = ttDiff_(an, S.a).filter(function (f) { return f !== 'done'; });
        if (edits.some(isDate)) edits = edits.concat(TT_DATES);
        const hold = edits.indexOf('list') >= 0 && ((an.list === TT_INBOX && !projOf(TT_INBOX)) || !an.list);
        if (hold) edits = edits.filter(function (f) { return f !== 'list'; });
        if (!edits.length && Number(got.status) === status) return { t: gn, hold: hold };
        const merged = Object.assign({}, gn);
        edits.forEach(function (f) { merged[f] = an[f]; });
        const body = edits.length ? ttTaskOut_(merged, got, projOf(merged.list), merged.parent, edits.indexOf('repeat') < 0 && String(gn.repeat).indexOf(TT_KEEP) === 0) : Object.assign({}, got);
        body.id = got.id; body.status = status;
        if (!body.projectId) body.projectId = got.projectId;
        const res = ttSend_('post', '/task/' + encodeURIComponent(m.ttId), body);
        st.toTt++;
        return { t: ttNormTt_(res && res.id ? Object.assign({}, body, res) : body), hold: hold };
      };
      // 両側の編集を突き合わせる：同じ欄を両方で変えていたら確認待ち（true）、TickTick だけの編集はアプリに写す
      const mergeTt = function (gn) {
        let ce = ttDiff_(an, S.a).filter(function (f) { return f !== 'done'; });
        let ctt = ttDiff_(gn, S.t).filter(function (f) { return f !== 'done'; });
        if (ce.some(isDate) && ctt.some(isDate)) { ce = ce.concat(TT_DATES); ctt = ctt.concat(TT_DATES); }
        const clash = ce.filter(function (f, i) { return ce.indexOf(f) === i && ctt.indexOf(f) >= 0 && String(an[f]) !== String(gn[f]); });
        if (clash.length) { m.conflictObj = { fields: clash, app: an, tt: gn }; ttWriteMap_(msh, m); return true; }
        const ttOnly = ctt.filter(function (f, i) { return ctt.indexOf(f) === i && ce.indexOf(f) < 0; });
        if (ttOnly.length) { writeApp(appById[m.appId], gn, ttOnly); an = normA(appById[m.appId]); }
        return false;
      };
      if (!got.notFound && (Number(got.status) === 2 || Number(got.status) === -1) && S.a.done && !isOn_(a.done)) {
        // 両方で完了したあと、アプリで完了を取り消した：TickTick も未完了に戻す（同時にした編集も両方に写す）
        const gn0 = ttNormTt_(got);
        if (mergeTt(gn0)) return;
        const out0 = pushEdits(gn0, 0);
        m.snapObj = { a: out0.hold ? Object.assign({}, an, { list: S.a.list }) : an, t: out0.t };
        ttWriteMap_(msh, m);
        return;
      }
      if (!got.notFound && (Number(got.status) === 2 || Number(got.status) === -1)) {
        // TickTick で完了した。その前の編集も両方に写す（同じ欄を両方で変えていたら確認待ち）
        const gn = ttNormTt_(got);
        if (mergeTt(gn)) return;
        const out1 = pushEdits(gn, Number(got.status));
        const a1 = appById[m.appId];
        if (a1 && !isOn_(a1.done)) { setDone_(a1.id, true, Number(got.status) === -1); st.toApp++; reload(); }
        const a2 = appById[m.appId];
        const na = Object.assign(a2 ? normA(a2) : an, { done: true });
        m.snapObj = { a: out1.hold ? Object.assign(na, { list: S.a.list }) : na, t: Object.assign({}, out1.t, { done: true }) };
        ttWriteMap_(msh, m);
        return;
      }
      if (got.notFound) {
        // TickTick で消した。アプリを直していなければアプリも消す。直していたら、対応を外して TickTick へ作り直す
        // アプリを消すと子・孫もまとめて消える：子・孫に同期していない変更や追加があれば、消さずに残す（このタスクも TickTick へ作り直す）
        const dirtyKid = descendants_(appAll, a.id).some(function (k) {
          const km = mapByApp[k.id];
          return !km || !km.snapObj || !km.snapObj.a || ttAppEdited_(normA(k), km.snapObj.a);
        });
        if (!ttAppEdited_(an, S.a) && !dirtyKid) { deleteTask_(a.id); st.toApp++; reload(); }
        drop.push(m);
        delete taskTt[m.appId];
        return;
      }
      return; // 未完了なのに一覧にない（読めなかった別のリストへ移したなど）：次の回に任せる
    }
    // 両方にある
    const an = normA(a);
    const tn = ttNormTt_(t);
    const ca = ttDiff_(an, S.a);
    const ct = ttDiff_(tn, S.t);
    // 実行日と期限はひと組で扱う（片側で実行日、もう片側で期限を変えても、組が食い違えば確認待ち）
    if (ca.some(isDate) && ct.some(isDate) && (an.doDate !== tn.doDate || an.doEnd !== tn.doEnd || an.due !== tn.due)) {
      TT_DATES.forEach(function (f) { if (ca.indexOf(f) < 0) ca.push(f); if (ct.indexOf(f) < 0) ct.push(f); });
    }
    if (!ca.length && !ct.length) {
      // 写しが変わらない編集（期限があるときのやる日など）も、両側を確かめられた正常な同期として raw の前回値を進める
      const rawOld = String(an.raw) !== String(S.a.raw);
      if (rawOld) m.snapObj = { a: Object.assign({}, S.a, { raw: an.raw }), t: S.t };
      if (m.conflictObj || rawOld) { m.conflictObj = null; ttWriteMap_(msh, m); }
      return;
    }
    const both = ca.filter(function (f) { return ct.indexOf(f) >= 0 && String(an[f]) !== String(tn[f]); });
    if (m.conflictObj || both.length) {
      // 確認待ち：どちらも書き換えない（両方が同じ中身になったら片付ける）
      if (!ttDiff_(an, tn).length) { m.snapObj = { a: an, t: tn }; m.conflictObj = null; ttWriteMap_(msh, m); return; }
      m.conflictObj = { fields: both.length ? both : m.conflictObj.fields, app: an, tt: tn };
      ttWriteMap_(msh, m);
      return;
    }
    // 繰り返しのタスクを TickTick で完了すると、同じタスクの日付が次の回に進む。アプリでは完了にして次の回を作る
    const pr = parseRepeat_(S.a.repeat);
    const dateMoved = ct.some(isDate);
    // アプリ側に日付以外の編集があっても取り込む（編集は次の回に引き継がれ、TickTick へも送る）
    if (pr && dateMoved && !ca.some(isDate) && ca.indexOf('done') < 0 && ttNextOf_(S.a, tn)) {
      const appEdits = ca.slice();
      let tAfter0 = tn;
      // 受信箱の id が分からない間は、受信箱への移動は送らず、前回値も移動前のまま（次の回にもう一度）
      const holdIn = appEdits.indexOf('list') >= 0 && ((an.list === TT_INBOX && !inboxId()) || !an.list);
      if (appEdits.length) {
        if (!can()) return;
        const merged = Object.assign({}, tn);
        appEdits.forEach(function (f) { merged[f] = an[f]; });
        const hold = holdIn;
        if (hold) merged.list = tn.list;
        const body = ttTaskOut_(merged, t, projOf(merged.list), merged.parent, appEdits.indexOf('repeat') < 0 && String(tn.repeat).indexOf(TT_KEEP) === 0);
        body.id = t.id;
        if (!body.projectId) body.projectId = t.projectId;
        const res = ttSend_('post', '/task/' + encodeURIComponent(t.id), body);
        tAfter0 = ttNormTt_(res && res.id ? Object.assign({}, body, res) : body);
        st.toTt++;
      }
      setDone_(a.id, true, false);
      reload();
      const a1 = appById[a.id];
      const nx = a1 && a1.nextId ? appById[a1.nextId] : null;
      if (nx) {
        m.prevApp = a.id;
        m.appId = nx.id;
        delete taskTt[a.id];
        taskTt[nx.id] = m.ttId;
        taskApp[m.ttId] = nx.id;
        // TickTick で変わった欄（進んだ日付など）だけを次の回に写す。アプリの編集は残す
        const left = ct.filter(function (f) { return f !== 'done' && appEdits.indexOf(f) < 0; });
        if (left.length) writeApp(nx, tn, left);
      }
      st.toApp++;
      const a2 = appById[m.appId];
      m.snapObj = { a: a2 ? normA(a2) : an, t: tAfter0 };
      if (holdIn) m.snapObj.a.list = S.a.list;
      ttWriteMap_(msh, m);
      return;
    }
    // アプリで繰り返しのタスクを完了した（次の回ができた）：TickTick で完了にし、対応を次の回へ移す
    if (ca.indexOf('done') >= 0 && an.done && a.nextId && appById[a.nextId]) {
      if (!can()) return;
      // 同期までに何回か続けて完了していたら、nextId をたどって末尾（まだ完了していない回）まで進む
      let tailId = a.nextId;
      let prevId = a.id; // 末尾のひとつ前の回（完了を取り消したら、対応をここへ戻す）
      let steps = 1;
      while (steps < 50 && isOn_(appById[tailId].done) && appById[tailId].nextId && appById[appById[tailId].nextId]) { prevId = tailId; tailId = appById[tailId].nextId; steps++; }
      // 末尾も完了済みで次の回がない（終わりの日まで済んだ）：その完了も数え、最後は TickTick でも繰り返しを終えて完了にする
      const tailDone = isOn_(appById[tailId].done);
      if (tailDone) steps++;
      // 完了の前にした編集（名前・メモなど）を先に送る。次の回（nextId）の中身で比べる
      // （完了した回は繰り返しが外れ、次の回はチェックリストの✓が外れるので、日付・完了・✓だけの違いは送らない）
      const nxA = normA(appById[tailId]);
      const nxRow = appById[tailId];
      const unchk = function (c) { return JSON.stringify(JSON.parse(c || '[]').map(function (x) { return x.t; })); };
      const ckey = function (c) { return JSON.stringify(JSON.parse(c || '[]').map(function (x) { return [x.t, !!x.d]; })); };
      // 次の回が自動でできたときの中身（✓は全部外れる・日付は完了した回から steps 回先）。これと違えば、利用者が変えた
      const autoCl = JSON.stringify(JSON.parse(S.a.checklist || '[]').map(function (x) { return { t: x.t, d: false }; }));
      const clUser = !!(nxRow && nxRow.updatedAt) && ckey(nxA.checklist) !== ckey(autoCl);
      const autoD = nextDates_({ doDate: an.doDate || '', due: an.due || '', notifyAt: '', doEnd: '' }, S.a.repeat, steps);
      // 実行日・期限の両方を時刻まで比べる（期限だけ・時刻だけの変更も、利用者の編集として扱う）
      const dateUser = !!(nxRow && nxRow.updatedAt) && (String(nxA.doDate || '') !== String(autoD.doDate || '') || String(nxA.due || '') !== String(autoD.due || ''));
      // TickTick の✓の違いも、TickTick で完了して自動で外れただけなら変更に数えない
      const ttSteps0 = ct.some(isDate) ? ttNextOf_(S.a, tn) : 0;
      const ctx = ct.filter(function (f) { return !(f === 'checklist' && ttSteps0 > 0 && ckey(tn.checklist) === ckey(autoCl)); });
      const edits0 = ttDiff_(nxA, S.a).filter(function (f) {
        return f !== 'done' && !isDate(f) && !(tailDone && f === 'repeat') && !(f === 'checklist' && !clUser && unchk(nxA.checklist) === unchk(S.a.checklist))
          && !(f === 'list' && nxA.list === TT_INBOX && !inboxId()); // 受信箱の id が分かるまで移動は待つ
      });
      // 同じ欄を TickTick でも変えていたら、その欄はどちらにも書かず確認待ちにする（完了と、ほかの欄は進める）
      const clash = edits0.filter(function (f) { return ctx.indexOf(f) >= 0 && nxA[f] !== tn[f]; });
      const edits = edits0.filter(function (f) { return clash.indexOf(f) < 0; });
      // 完了した回の日付を完了の前に変えていたら（11/2 → 11/5 など）、その日付も先に送る（TickTick の次の回もそこから進む）
      const dateEdit = !ct.some(isDate) && (an.doDate !== S.a.doDate || String(an.doEnd || '') !== String(S.a.doEnd || '') || an.due !== S.a.due);
      let cur = t;
      if (edits.length || dateEdit) {
        const merged = Object.assign({}, tn);
        edits.forEach(function (f) { merged[f] = nxA[f]; });
        if (dateEdit) { merged.doDate = an.doDate; merged.doEnd = an.doEnd; merged.due = an.due; }
        const body = ttTaskOut_(merged, t, projOf(merged.list, m), merged.parent, edits.indexOf('repeat') < 0 && String(tn.repeat).indexOf(TT_KEEP) === 0);
        body.id = t.id;
        if (!body.projectId) body.projectId = t.projectId;
        const res = ttSend_('post', '/task/' + encodeURIComponent(t.id), body);
        cur = res && res.id ? Object.assign({}, body, res) : body;
      }
      // 同じ回を TickTick でも完了していたら（日付がもう何回か先に進んでいる）、その回数分は送らない（余分に完了させない）
      const ttSteps = ttSteps0;
      const ttAdvanced = ttSteps > 0;
      const from = Math.min(ttSteps, steps);
      // 送り先は更新したあとのリスト（同じ回で別のリストへ移していても届くように）。届かなければ対応は進めず、次の回にもう一度
      for (let k = from; k < steps - (tailDone ? 1 : 0); k++) {
        if (k > from) st.writes++;
        const done0 = ttSend_('post', taskPath({ id: t.id, projectId: cur.projectId || t.projectId }) + '/complete');
        if (done0 && done0.notFound) return;
      }
      // 完了のあと、できた次の回にアプリで手を加えていたら（次の回は手を加えると updatedAt が付く）、変えた日付とチェックリスト（✓も）を送る
      // 日付を変えていなければ、TickTick の日付は動かさない（TickTick のほうが先に進んでいたら、その日付をアプリに写す）
      const ttAhead = ttSteps > steps && !dateUser;
      // v0.16.0：期日を過ぎた回を完了すると、アプリは今日より後の回まで飛ばす（TickTick は1回分しか進まないことがある）。
      // そのときもアプリの次の回の日付を送る（送らないと、次の同期で TickTick の過去の日付がアプリに戻ってくる）
      const appSkip = !tailDone && !ttAhead && !!nxRow && (String(nxA.doDate || '') !== String(autoD.doDate || '') || String(nxA.due || '') !== String(autoD.due || ''));
      if (((nxRow && nxRow.updatedAt) || appSkip) && !(ct.some(isDate) && !ttAdvanced)) {
        const keepCl = ctx.indexOf('checklist') >= 0 && clash.indexOf('checklist') < 0 && edits.indexOf('checklist') < 0; // TickTick だけがチェックリストを変えた
        const over = ttAhead ? { doDate: tn.doDate, doEnd: tn.doEnd, due: tn.due } : { doDate: nxA.doDate, doEnd: nxA.doEnd, due: nxA.due };
        if (!keepCl && clash.indexOf('checklist') < 0) over.checklist = nxA.checklist;
        const body2 = ttTaskOut_(Object.assign({}, ttNormTt_(cur), over), cur, cur.projectId || t.projectId, null, true);
        body2.id = t.id;
        body2.parentId = cur.parentId || null;
        const res2 = ttSend_('post', '/task/' + encodeURIComponent(t.id), body2);
        cur = res2 && res2.id ? Object.assign({}, body2, res2) : body2;
      }
      if (tailDone && from < steps) {
        // 最後の回：繰り返しを外して完了にする（TickTick に次の回を作らせない）
        st.writes++;
        const body3 = Object.assign({}, cur, { id: t.id, status: 2, repeatFlag: '', projectId: cur.projectId || t.projectId });
        delete body3.repeatFrom;
        const res3 = ttSend_('post', '/task/' + encodeURIComponent(t.id), body3);
        if (res3 && res3.notFound) return;
        cur = res3 && res3.id ? Object.assign({}, body3, res3) : body3;
      }
      st.toTt++;
      const nx0 = appById[tailId];
      // TickTick 側だけの変更（日付以外）は、次の回に写す
      const ttOnly = ctx.filter(function (f) { return f !== 'done' && !isDate(f) && clash.indexOf(f) < 0; }).concat(ttAhead ? TT_DATES : []);
      if (ttOnly.length) writeApp(nx0, tn, ttOnly);
      const nx = appById[tailId] || nx0;
      m.prevApp = prevId;
      m.appId = nx.id;
      delete taskTt[a.id];
      taskTt[nx.id] = m.ttId;
      taskApp[m.ttId] = nx.id;
      // TickTick の次の回はアプリと同じ日になるはず（同じ意味の決め方だけを写している）。ずれたら次の回に TickTick の日付が写る
      const nn = normA(nx);
      m.snapObj = { a: nn, t: Object.assign({}, ttNormTt_(cur), { doDate: nn.doDate, doEnd: nn.doEnd, due: nn.due, checklist: nn.checklist, done: tailDone }, tailDone ? { repeat: nn.repeat } : {}) };
      if (nn.list === TT_INBOX && !inboxId() && m.snapObj.t.list !== TT_INBOX) m.snapObj.a = Object.assign({}, nn, { list: S.a.list });
      if (clash.length) {
        // 前回値はその欄だけ変える前のままにして、両側で変わったことを残す
        clash.forEach(function (f) { m.snapObj.a[f] = S.a[f]; m.snapObj.t[f] = S.t[f]; });
        m.conflictObj = { fields: clash, app: nn, tt: Object.assign({}, ttNormTt_(cur), { doDate: nn.doDate, doEnd: nn.doEnd, due: nn.due, done: false }) };
      }
      ttWriteMap_(msh, m);
      return;
    }
    // TickTick の変更 → アプリ
    if (ct.length) writeApp(a, tn, ct);
    // アプリの変更 → TickTick
    let tAfter = tn;
    if (ca.length) {
      if (!can()) return;
      let cur = t;
      if (ca.indexOf('done') >= 0) {
        if (an.done) ttSend_('post', taskPath(t) + '/complete');
        else ttSend_('post', '/task/' + encodeURIComponent(t.id), Object.assign({}, t, { status: 0 }));
        cur = Object.assign({}, t, { status: an.done ? 2 : 0 });
      }
      let rest = ca.filter(function (f) { return f !== 'done'; });
      // 受信箱の id がまだ分からない：受信箱への移動だけは送らず、次の回にもう一度確かめる
      // v0.25.0：移した先のフォルダがまだ TickTick にできていない（タスク→フォルダの直後など）ときも、移動は次の回に送る（Codex の指摘）
      const holdList = rest.indexOf('list') >= 0 && ((an.list === TT_INBOX && !inboxId()) || !an.list);
      if (holdList) rest = rest.filter(function (f) { return f !== 'list'; });
      if (rest.length) {
        const merged = Object.assign({}, tn);
        rest.forEach(function (f) { merged[f] = an[f]; });
        if (rest.some(isDate)) { merged.doDate = an.doDate; merged.doEnd = an.doEnd; merged.due = an.due; }
        const body = ttTaskOut_(merged, cur, projOf(merged.list, m), merged.parent, rest.indexOf('repeat') < 0 && String(tn.repeat).indexOf(TT_KEEP) === 0);
        body.id = t.id;
        if (!body.projectId) body.projectId = t.projectId;
        const res = ttSend_('post', '/task/' + encodeURIComponent(t.id), body);
        cur = res && res.id ? Object.assign({}, body, res) : body;
      }
      tAfter = ttNormTt_(cur);
      st.toTt++;
      if (holdList) holdList_ = true;
    }
    reload();
    const a2 = appById[m.appId];
    m.snapObj = { a: a2 ? normA(a2) : an, t: tAfter };
    if (holdList_) { m.snapObj.a.list = S.a.list; holdList_ = false; }
    ttWriteMap_(msh, m);
  });
  ttDropMaps_(msh, drop);
  // ---- TickTick にだけあるタスク → アプリに作る（親から先に） ----
  const newTt = Object.keys(tt).filter(function (id) { return !taskApp[id]; });
  for (let pass = 0; pass < 10 && newTt.length; pass++) {
    for (let i = newTt.length - 1; i >= 0; i--) {
      const t = tt[newTt[i]];
      if (t.parentId && tt[t.parentId] && !taskApp[t.parentId]) continue; // 親がまだ
      const tn = ttNormTt_(t);
      const f = toAppFields(tn);
      if (!f.listId) continue; // フォルダの対応がまだ（次の回）
      const made = saveTask_(f);
      taskApp[t.id] = made.id;
      taskTt[made.id] = String(t.id);
      reload();
      ttWriteMap_(msh, { kind: 'task', appId: made.id, ttId: String(t.id), ttProject: String(t.projectId || ''), snapObj: { a: normA(appById[made.id]), t: tn }, state: '' });
      st.toApp++;
      newTt.splice(i, 1);
    }
  }
  reload();
  ttSyncDone_(ttDone, tt, taskApp, taskTt, appAll, listTt, listApp, normA, msh, st, can, projOf, inboxId, props);
  reload();
  // ---- アプリにだけある未完了のタスク → TickTick に作る（親から先に） ----
  const mapped = {};
  ttMapRows_().forEach(function (m) { if (m.kind === 'task') mapped[m.appId] = true; });
  let fresh = appAll.filter(function (a) { return !mapped[a.id] && !isOn_(a.done) && listTt[a.listId]; });
  for (let pass = 0; pass < 10 && fresh.length && !st.more; pass++) {
    fresh = fresh.filter(function (a) {
      if (st.more) return true;
      if (a.parentTaskId && !taskTt[a.parentTaskId]) return true; // 親がまだ
      if (!can()) return true;
      const an = normA(a);
      const body = ttTaskOut_(an, null, projOf(an.list), an.parent);
      // 送る中身を TickTick 側の前回値として残す（答えが届かず、あとで照合したときも、その間の TickTick の編集を変更として拾える）
      const sentT = Object.assign(ttNormTt_(body), { list: an.list });
      const m = { kind: 'task', appId: a.id, ttId: '', ttProject: '', snapObj: { a: an, t: sentT }, state: 'pending' };
      ttWriteMap_(msh, m); // 先に「作りかけ」を残す（答えが届かなくても、次の回に2つ作らない）
      const res = ttSend_('post', '/task', body);
      if (res && res.id) {
        if (an.list === TT_INBOX && res.projectId && !inboxId()) props.setProperty('TT_INBOX_ID', String(res.projectId));
        m.ttId = String(res.id);
        m.ttProject = String(res.projectId || '');
        m.state = '';
        m.snapObj = { a: an, t: ttNormTt_(Object.assign({}, body, res)) };
        ttWriteMap_(msh, m);
        taskTt[a.id] = m.ttId;
        taskApp[m.ttId] = a.id;
      }
      st.toTt++;
      return false;
    });
  }
  // v0.17.0：送れたタスクの「日付だけのやる日」をアプリでも期限にする。
  // v0.20.0：繰り返さないタスクはやめた（入れた実行日はそのまま残す。2026-11-06 ユーザーがカードで決定）。
  // 繰り返すタスクは TickTick の次の回の日付（終日＝期限）と食い違わないよう、今までどおり期限にする
  reload();
  if (!TT_IMPORTING_) ttCanonDates_(ttMapRows_().filter(function (m) { return m.kind === 'task'; }), appById, normA, msh);
  if (!TT_IMPORTING_) { ttRepairStuck_(ttMapRows_().filter(function (m) { return m.kind === 'task'; }), appById, normA, msh); }
  laterCal_();
  st.conflicts = ttMapRows_().filter(function (m) { return m.conflictObj; }).length;
  if (Object.keys(migLater).length) st.more = true; // 移し替えの残りは次の回（ほかの行はこの回にふつうに同期する）
  delete st.writes;
  TT_TOUCHED_ = true; // 書かなかった回も、読み終えたしるしに世代を上げる（今までどおり）
  return st;
}
// v0.16.0：終わったタスクの同期（対応のない完了済みどうし）
//  - TickTick の完了済み（直近 TT_DONE_DAYS 日）でアプリにないもの → アプリに完了済みで作る
//  - アプリで作ってすぐ完了したもの（対応がない・繰り返しでない）→ TickTick に作って完了にする
//  - 同じ名前・同じフォルダ・同じ日の完了済みが両方にあれば、作らずに結び付ける（二重にしない）
//  - 一覧に載っていないことは、削除の根拠にしない
function ttSyncDone_(ttDone, tt, taskApp, taskTt, appAll, listTt, listApp, normA, msh, st, can, projOf, inboxId, props) {
  const mappedApp = {};
  ttMapRows_().forEach(function (m) { if (m.kind === 'task') mappedApp[m.appId] = true; });
  const dayOf = function (n) { return String(n.doDate || n.due || '').slice(0, 10); };
  const keyOf = function (title, list, d) { return String(title || '').trim() + '\u0001' + list + '\u0001' + d; };
  // アプリの対応のない完了済み（「やらない」は除く）
  const appDone = {};
  appAll.forEach(function (a) {
    if (mappedApp[a.id] || !isOn_(a.done) || isOn_(a.wontDo) || !listTt[a.listId]) return;
    const n = normA(a);
    const k = keyOf(n.title, n.list, dayOf(n));
    (appDone[k] = appDone[k] || []).push(a);
  });
  // 繰り返しのタスク（アプリで繰り返しを持つ・持っていた行）の名前とフォルダ。TickTick が完了の写しを別の id で残していても取り込まない
  // 名前だけでは別の単発タスクと見分けられないので、「繰り返しの印がある」か「アプリにその日の完了した回がある」ときだけ写しと見る
  const repKey = {};
  appAll.forEach(function (a) {
    if ((a.repeat && a.repeat !== 'none') || a.nextId) repKey[String(a.title || '').trim() + '\u0001' + (listTt[a.listId] || '')] = true;
  });
  const doneDay = {};
  appAll.forEach(function (a) {
    if (!isOn_(a.done)) return;
    const n = normA(a);
    doneDay[keyOf(n.title, n.list, dayOf(n))] = true;
  });
  const isRepCopy = function (t, tn) {
    if (t.repeatTaskId) return true;
    if (!repKey[String(tn.title || '').trim() + '\u0001' + tn.list]) return false;
    return !!t.repeatFlag || !!doneDay[keyOf(tn.title, tn.list, dayOf(tn))];
  };
  const ids = Object.keys(ttDone).filter(function (id) { return !taskApp[id]; });
  for (let pass = 0; pass < 10 && ids.length; pass++) {
    for (let i = ids.length - 1; i >= 0; i--) {
      const t = ttDone[ids[i]];
      const pid = t.parentId ? String(t.parentId) : '';
      if (pid && (tt[pid] || ttDone[pid]) && !taskApp[pid]) continue; // 親がまだ
      const tn = ttNormTt_(t);
      const listId = listApp[tn.list] || '';
      ids.splice(i, 1);
      if (!listId) continue; // フォルダの対応がまだ
      const k = keyOf(tn.title, tn.list, dayOf(tn));
      const same = appDone[k] && appDone[k].shift();
      let appId;
      if (same) {
        appId = same.id; // アプリにも同じ完了済みがある：結び付けるだけ
      } else {
        if (isRepCopy(t, tn)) continue; // 繰り返しの完了の写し（アプリでは完了した回として残っている）
        const made = saveTask_({ title: tn.title, memo: tn.memo, doDate: tn.doDate, doEnd: tn.doEnd, due: tn.due, repeat: 'none', checklist: JSON.parse(tn.checklist),
          listId: listId, parentTaskId: pid ? taskApp[pid] || '' : '', priority: tn.priority || 0, done: true, _doneAt: ttDateIn_(t.completedTime, false) || '' });
        appId = made.id;
        st.toApp++;
      }
      taskApp[String(t.id)] = appId;
      taskTt[appId] = String(t.id);
      mappedApp[appId] = true;
      const row = rows_(SHEET_TASKS, TASK_COLS).filter(function (x) { return x.id === appId; })[0];
      ttWriteMap_(msh, { kind: 'task', appId: appId, ttId: String(t.id), ttProject: String(t.projectId || ''),
        snapObj: { a: row ? normA(row) : Object.assign({}, tn, { list: tn.list }), t: tn }, state: '' });
    }
  }
  if (TT_IMPORTING_) return;
  // アプリだけの完了済み（作ってすぐ完了した・同期の前に完了した）→ TickTick に作って完了にする。繰り返しの回は除く
  const since = props.getProperty('TT_DONE_SINCE') || '';
  const fresh = [];
  Object.keys(appDone).forEach(function (k) { appDone[k].forEach(function (a) { fresh.push(a); }); });
  fresh.sort(function (a, b) { return (a.parentTaskId ? 1 : 0) - (b.parentTaskId ? 1 : 0); });
  fresh.forEach(function (a) {
    if (st.more) return;
    if ((a.repeat && a.repeat !== 'none') || a.nextId || a.repeatBase) return;
    if (a.parentTaskId && !taskTt[a.parentTaskId]) return; // 親がまだ（次の回）
    // v0.16.0 を入れて最初に同期した日時（TT_DONE_SINCE）より前に完了したものは送らない（最初の取り込みの前の古い完了を TickTick に増やさない）
    if (!since || String(a.doneAt || '') < since) return;
    if (!can()) return;
    const an = normA(a);
    const body = ttTaskOut_(Object.assign({}, an, { done: false }), null, projOf(an.list), an.parent);
    if (!body.projectId && an.list !== TT_INBOX) return; // 受信箱は projectId なしで作れる（作った答えの projectId を残す）
    // 作りかけの前回値は「両方とも未完了」にしておく。作った答えが届かず、あとで照合で見つかったときも、
    // 次の同期は「アプリで完了した」と見て完了を送る（TickTick で取り消したとは見ない）
    const pendT = Object.assign(ttNormTt_(body), { list: an.list, done: false });
    const m = { kind: 'task', appId: a.id, ttId: '', ttProject: '', snapObj: { a: Object.assign({}, an, { done: false }), t: pendT }, state: 'pending' };
    ttWriteMap_(msh, m);
    const res = ttSend_('post', '/task', body);
    if (!res || !res.id) return;
    if (an.list === TT_INBOX && res.projectId && !inboxId()) props.setProperty('TT_INBOX_ID', String(res.projectId));
    st.writes++;
    // 作れた時点で、TickTick の id と「両方とも未完了」を前回値として残す。
    // 続く完了の送信が失敗しても、次の同期は「アプリで完了した」と見て完了を送り直す（TickTick で取り消したとは見ない）
    m.ttId = String(res.id); m.ttProject = String(res.projectId || body.projectId || inboxId() || ''); m.state = '';
    const tUndone = Object.assign(ttNormTt_(Object.assign({}, body, res)), { done: false });
    m.snapObj = { a: Object.assign({}, an, { done: false }), t: tUndone };
    ttWriteMap_(msh, m);
    taskTt[a.id] = m.ttId; taskApp[m.ttId] = a.id;
    ttSend_('post', '/project/' + encodeURIComponent(m.ttProject) + '/task/' + encodeURIComponent(m.ttId) + '/complete');
    m.snapObj = { a: an, t: Object.assign({}, tUndone, { done: true }) };
    ttWriteMap_(msh, m);
    st.toTt++;
  });
}
let TT_IMPORTING_ = false;
let TT_MANUAL_ = false;

// S（前回）から見て、tn の日付が繰り返しの次の回のどれかか（TickTick で完了して日付が進んだか）
function ttNextOf_(S, tn) {
  const base = { doDate: S.doDate, due: S.due, notifyAt: '', doEnd: '' };
  const want = (tn.doDate || tn.due || '').slice(0, 10);
  if (!want || !(base.doDate || base.due)) return 0;
  for (let n = 1; n <= 400; n++) {
    const d = nextDates_(base, S.repeat, n);
    const x = (d.doDate || d.due).slice(0, 10);
    if (x === want) return n; // 何回先か（1以上）
    if (x > want) return 0;
  }
  return 0;
}

// フォルダの対応（TickTick のフォルダ → 上のフォルダ、TickTick のリスト → フォルダ）。名前の変更は両方向
function ttSyncLists_(r, maps, msh, st, can) {
  const lists = rows_(SHEET_LISTS, LIST_COLS);
  const byId = {};
  lists.forEach(function (l) { byId[l.id] = l; });
  const gmap = {};
  maps.filter(function (m) { return m.kind === 'group'; }).forEach(function (m) { gmap[m.ttId] = m; });
  const lmap = {};
  maps.filter(function (m) { return m.kind === 'list'; }).forEach(function (m) { lmap[m.ttId] = m; });
  // 最初の取り込みでは、今あるアプリのフォルダを名前で TickTick のフォルダ・リストに結び付ける（同じものを2つ作らない）
  const used = {};
  maps.forEach(function (m) { used[m.appId] = true; });
  const adopt = function (name, parent) {
    if (!TT_IMPORTING_) return null;
    const hit = lists.filter(function (l) { return !used[l.id] && String(l.name).trim() === name && (l.parentId || '') === parent; })[0];
    if (hit) used[hit.id] = true;
    return hit || null;
  };
  const rename = function (appId, name) { const l = byId[appId]; if (l && l.name !== name) { saveList({ id: l.id, name: name, parentId: l.parentId }); l.name = name; st.toApp++; } };
  (r.groups || []).forEach(function (g) {
    const m = gmap[g.id];
    const name = String(g.name || '').trim() || '(名前なし)';
    if (m && m.snapObj && m.snapObj.gone && !byId[m.appId]) return; // v0.23.0：アプリで消したフォルダは作り直さない
    if (m && m.snapObj && m.snapObj.gone) { delete m.snapObj.gone; ttWriteMap_(msh, m); }
    if (!m || !byId[m.appId]) {
      const made = adopt(name, '') || saveList({ name: name, parentId: '' });
      byId[made.id] = { id: made.id, name: made.name, parentId: '' };
      used[made.id] = true;
      ttWriteMap_(msh, Object.assign(m || { kind: 'group', ttId: String(g.id), ttProject: '' }, { appId: made.id, snapObj: { name: name } }));
      st.toApp++;
      gmap[g.id] = { appId: made.id };
      return;
    }
    if (m.snapObj && m.snapObj.name !== name) { rename(m.appId, name); m.snapObj = { name: name }; ttWriteMap_(msh, m); }
    // アプリで変えたフォルダの名前は、TickTick の窓口がないので写さない
  });
  const groupApp = function (gid) { return gid && gmap[gid] ? gmap[gid].appId : ''; };
  // v0.33.1：TickTick のフォルダは2段まで（フォルダ › リスト）。アプリの3段目（例 Work › 計画個別 › 和気地区）は、
  // TickTick では近い2段目のフォルダ（Work）に入れて表す。TickTick から来る親は、近い2段目と比べる（3段目の親を上書きしない）
  const groupOfApp = {};
  Object.keys(gmap).forEach(function (gid) { if (gmap[gid].appId) groupOfApp[gmap[gid].appId] = gid; });
  const nearGroup = function (pid) {
    for (let p = pid, i = 0; p && i < 20; i++) {
      if (groupOfApp[p]) return p;
      p = byId[p] ? byId[p].parentId || '' : '';
    }
    return '';
  };
  r.data.forEach(function (d) {
    const pr = d.project;
    const key = pr.inbox ? TT_INBOX : String(pr.id);
    const name = pr.inbox ? INBOX_NAME : String(pr.name || '').trim() || '(名前なし)';
    const parent = pr.inbox ? '' : groupApp(pr.groupId);
    const m = lmap[key];
    if (m && m.snapObj && m.snapObj.gone && !byId[m.appId]) return; // v0.23.0：アプリで消したフォルダは作り直さない
    if (m && m.snapObj && m.snapObj.gone) { delete m.snapObj.gone; ttWriteMap_(msh, m); }
    if (!m || !byId[m.appId]) {
      const made = adopt(name, parent) || saveList({ name: name, parentId: parent });
      byId[made.id] = { id: made.id, name: made.name, parentId: parent };
      used[made.id] = true;
      ttWriteMap_(msh, Object.assign(m || { kind: 'list', ttId: key, ttProject: pr.inbox ? '' : String(pr.id) }, { appId: made.id, snapObj: { name: name, parent: parent } }));
      st.toApp++;
      return;
    }
    const l = byId[m.appId];
    const S = m.snapObj || { name: l.name, parent: l.parentId };
    const ttName = name !== S.name;
    const appName = l.name !== S.name;
    let sent = false;
    if (ttName) rename(l.id, name);
    else if (appName && !pr.inbox && can()) { ttSend_('post', '/project/' + encodeURIComponent(pr.id), { name: l.name }); st.toTt++; sent = true; }
    // TickTick でフォルダを動かしたときだけ写す。アプリの近い2段目が同じなら、アプリの親（3段目の入れ子）はそのまま
    const near = nearGroup(l.parentId);
    if (parent !== S.parent && near !== parent) { saveList({ id: l.id, name: byId[l.id].name, parentId: parent }); byId[l.id].parentId = parent; st.toApp++; }
    // アプリの近い2段目と TickTick の置き場がずれていたら（v0.33.0 までに一番上に作った3段目など）、TickTick のフォルダに入れ直す。
    // 同じ入れ直しは1回だけ送る（TickTick が受け付けなくても、毎回送り続けない）
    let moved = S.moved || '';
    if (parent === S.parent && near && near !== parent && moved !== near && !pr.inbox && can()) {
      ttSend_('post', '/project/' + encodeURIComponent(pr.id), { name: sent ? l.name : name, groupId: groupOfApp[near] }); st.toTt++; moved = near;
    }
    // 送れなかった名前（書く回数の上限）は前回のままにして、次の回に送り直す。受信箱はアプリで名前を変えても TickTick に送らない
    const now = { name: ttName ? name : sent ? l.name : S.name, parent: parent };
    if (moved && moved !== parent) now.moved = moved;
    if (JSON.stringify(now) !== JSON.stringify(m.snapObj)) { m.snapObj = now; ttWriteMap_(msh, m); }
  });
  // アプリで作ったフォルダ（対応のないもの）→ TickTick にリストを作る（上のフォルダが TickTick のフォルダなら、その中に）
  const known = {};
  maps.forEach(function (m) { if (m.kind !== 'task') known[m.appId] = true; });
  ttMapRows_().forEach(function (m) { if (m.kind !== 'task') known[m.appId] = true; });
  rows_(SHEET_LISTS, LIST_COLS).forEach(function (l) {
    if (known[l.id] || !ttProps_().getProperty('TT_IMPORTED')) return;
    if (TT_IMPORTING_) {
      // 取り込みの前からあって TickTick にないフォルダは、アプリだけのフォルダとして残す（TickTick には作らない）
      ttWriteMap_(msh, { kind: 'local', appId: l.id, ttId: '', ttProject: '', snapObj: null });
      return;
    }
    if (!can()) return;
    const body = { name: l.name };
    // 3段目は近い2段目のフォルダに作る。前回の親は TickTick に入れた先（近い2段目）として覚える
    if (!byId[l.id]) byId[l.id] = { id: l.id, name: l.name, parentId: l.parentId };
    const near = nearGroup(l.parentId);
    if (near) body.groupId = groupOfApp[near];
    const res = ttSend_('post', '/project', body);
    if (res && res.id) {
      ttWriteMap_(msh, { kind: 'list', appId: l.id, ttId: String(res.id), ttProject: String(res.id), snapObj: { name: l.name, parent: near } });
      st.toTt++;
    }
  });
}

// 確認待ちを片付ける。side：'app'＝アプリの中身を残す、'tt'＝TickTick の中身を残す（次の同期で写る）
function ttResolve(appId, side) {
  return withLock_(function () {
    const msh = sheet_(SHEET_TT, TT_COLS);
    const m = ttMapRows_().filter(function (x) { return x.kind === 'task' && x.appId === appId && x.conflictObj; })[0];
    if (!m) throw new Error('確認待ちが見つかりません。↻ で読み直してください。');
    // 残す側の「前回」の確認待ちの欄を空き印にすると、次の同期で残す側だけが変わったことになる
    // 確認待ちでない欄は前回のままにして、その間の片側だけの変更も次の同期で写す
    const c = m.conflictObj;
    const S = m.snapObj || { a: c.app, t: c.tt };
    // 日付（やる日・期限）はひと組で選ぶ（片方だけ片付けると、次の同期でまた確認待ちになる）
    const fields = c.fields.some(function (f) { return TT_DATES.indexOf(f) >= 0; })
      ? c.fields.filter(function (f) { return TT_DATES.indexOf(f) < 0; }).concat(TT_DATES) : c.fields;
    const mark = function (o) { const x = Object.assign({}, o); fields.forEach(function (f) { x[f] = '\u0000'; }); return x; };
    const now = function (o, cur) { const x = Object.assign({}, o); fields.forEach(function (f) { x[f] = cur[f]; }); return x; };
    m.snapObj = side === 'app' ? { a: mark(S.a), t: now(S.t, c.tt) } : { a: now(S.a, c.app), t: mark(S.t) };
    m.conflictObj = null;
    ttWriteMap_(msh, m);
    ttBumpGen_();
    const list = ttConflicts();
    const st = ttJson_(ttProps_().getProperty('TT_STATUS')) || {};
    st.conflicts = list.length;
    ttProps_().setProperty('TT_STATUS', JSON.stringify(st));
    return list;
  });
}

// 確認待ちの一覧（画面用）
function ttConflicts() {
  const names = { title: '名前', memo: 'メモ', doDate: 'やる日', doEnd: 'やる日の終わり', due: '期限', repeat: '繰り返し', checklist: 'チェックリスト', list: 'フォルダ', parent: '親', done: '完了', priority: '優先度' };
  return ttMapRows_().filter(function (m) { return m.kind === 'task' && m.conflictObj; }).map(function (m) {
    const c = m.conflictObj;
    return { appId: m.appId, title: c.app.title || c.tt.title, fields: c.fields.map(function (f) {
      return { name: names[f] || f, app: String(c.app[f]), tt: String(c.tt[f]) };
    }) };
  });
}

// ---- 最初の取り込み ----
// 準備：TickTick を読み、取り込む中身をシート「TickTick取り込み（確認用）」に書く（アプリのタスクはまだ変えない）
const SHEET_TT_STAGE = 'TickTick取り込み（確認用）';
function ttImportPrepare() {
  const r = ttReadAll_();
  if (!r.ok) throw new Error('TickTick の一部を読めませんでした（' + r.errors.join('／') + '）。もう一度試してください。');
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET_TT_STAGE);
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(SHEET_TT_STAGE);
  const head = ['リスト', 'タスク', '親', 'やる日', '期限', '繰り返し', 'チェックリスト', 'メモ', '写せない設定'];
  const rows = [head];
  const all = {};
  r.data.forEach(function (d) { d.tasks.forEach(function (t) { all[String(t.id)] = t; }); });
  let n = 0;
  r.data.forEach(function (d) {
    d.tasks.forEach(function (t) {
      const x = ttTaskIn_(t);
      n++;
      rows.push([d.project.inbox ? INBOX_NAME : d.project.name, x.rec.title, x.rec.ttParent && all[x.rec.ttParent] ? all[x.rec.ttParent].title : '',
        x.rec.doDate, x.rec.due, x.rec.repeat === 'none' ? '' : x.rec.repeat, x.rec.checklist.map(function (c) { return (c.d ? '✓' : '・') + c.t; }).join('\n'),
        x.rec.memo, x.marks.join('／')]);
    });
  });
  const range = sh.getRange(1, 1, rows.length, head.length);
  range.setNumberFormat('@');
  range.setValues(rows); dirty_();
  sh.setFrozenRows(1);
  const sig = ttImportSig_(r);
  ttProps_().setProperty('TT_STAGE', JSON.stringify({ sig: sig, tasks: n, at: nowStr_() }));
  return { tasks: n, lists: r.data.length, sheetUrl: ss.getUrl ? ss.getUrl() + '#gid=' + sh.getSheetId() : '', app: allTasks_().length };
}

// 取り込む中身の目印（準備のあと TickTick が変わったら、入れ替えを止める）
function ttImportSig_(r) {
  const ids = [];
  r.data.forEach(function (d) { d.tasks.forEach(function (t) { ids.push(t.id + ':' + (t.etag || t.modifiedTime || '') + ':' + t.title); }); });
  return digest_(ids.sort().join('|'));
}

// 入れ替え：今のタスクのシートを写しに残し、アプリのタスクを全部消して、TickTick の中身を入れる
function ttImportApply(expectTasks) {
  const stage = JSON.parse(ttProps_().getProperty('TT_STAGE') || 'null');
  if (!stage) throw new Error('先に「取り込みの準備」をしてください。');
  const r = ttReadAll_();
  if (!r.ok) throw new Error('TickTick の一部を読めませんでした（' + r.errors.join('／') + '）。何も変えていません。');
  if (ttImportSig_(r) !== stage.sig || Number(expectTasks) !== stage.tasks) {
    throw new Error('準備のあと TickTick が変わりました。もう一度「取り込みの準備」をして、確かめてから入れ替えてください。');
  }
  return withLock_(function () {
    const ss = ss_();
    const src = sheet_(SHEET_TASKS, TASK_COLS);
    const name = 'タスク_取り込み前_' + fmt_(new Date(), 'yyyyMMdd_HHmm');
    const copy = src.copyTo(ss);
    copy.setName(name);
    const old = rows_(SHEET_TASKS, TASK_COLS);
    old.forEach(function (a) { goneEvent_(a); });
    if (src.getLastRow() > 1) src.deleteRows(2, src.getLastRow() - 1), dirty_();
    // 対応表を作り直す
    const ms = ss.getSheetByName(SHEET_TT);
    if (ms) ss.deleteSheet(ms);
    delete SHEET_CACHE_[SHEET_TT];
    const props = ttProps_();
    props.setProperty('TT_IMPORTED', nowStr_());
    props.setProperty('TT_BACKUP', name);
    props.deleteProperty('TT_STAGE');
    TT_MANUAL_ = true;
    TT_IMPORTING_ = true;
    let out;
    try {
      // 対応表が空なので、同期の処理が全部を「TickTick にだけあるもの」として作る（TickTick には何も書かない）
      out = ttSyncApply_(r);
    } finally { TT_MANUAL_ = false; TT_IMPORTING_ = false; }
    laterCal_();
    ttSaveStatus_({ ok: true, msg: '最初の取り込みをしました（' + allTasks_().length + '件）', toApp: out.toApp, toTt: 0, conflicts: 0 });
    return { tasks: allTasks_().length, removed: old.length, backup: name, toApp: out.toApp };
  });
}

// 取り込みの前に戻す（写しのシートから戻し、対応表を消す。同期も止める）
function ttImportUndo() {
  return withLock_(function () {
    const props = ttProps_();
    const name = props.getProperty('TT_BACKUP');
    const ss = ss_();
    const bak = name ? ss.getSheetByName(name) : null;
    if (!bak) throw new Error('取り込み前の写しが見つかりません。');
    ttSetSync(false);
    const src = sheet_(SHEET_TASKS, TASK_COLS);
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (a) { goneEvent_(a); });
    if (src.getLastRow() > 1) src.deleteRows(2, src.getLastRow() - 1), dirty_();
    const n = bak.getLastRow();
    if (n > 1) {
      const w = bak.getLastColumn();
      const v = bak.getRange(2, 1, n - 1, w).getValues();
      const range = src.getRange(2, 1, n - 1, w);
      range.setNumberFormat('@');
      range.setValues(v.map(function (row) { return row.map(norm_); })); dirty_();
    }
    const ms = ss.getSheetByName(SHEET_TT);
    if (ms) ss.deleteSheet(ms);
    delete SHEET_CACHE_[SHEET_TT];
    props.deleteProperty('TT_IMPORTED');
    props.deleteProperty('TT_STATUS');
    ttBumpGen_();
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) { if (t.gcalId) TOUCHED_[t.id] = true; });
    laterCal_();
    return { tasks: allTasks_().length };
  });
}

// ==== v0.25.0 ====

// ---- フォルダをまとめて変える（色・済）。答えはフォルダの一覧と、元に戻すための前の値 ----
// field：'color'（Googleカレンダーの色の番号・空で色なし）か 'closed'（'1' で済・空で稼働中）。Inbox は済にできない
function patchLists(ids, field, value) {
  return withLock_(function () {
    if (field !== 'color' && field !== 'closed') throw new Error('知らない操作です：' + field);
    const sh = sheet_(SHEET_LISTS, LIST_COLS);
    const all = rows_(SHEET_LISTS, LIST_COLS);
    const want = {};
    (ids || []).slice(0, 500).forEach(function (id) { want[id] = true; });
    const before = [];
    all.forEach(function (l) {
      if (!want[l.id]) return;
      if (field === 'closed' && l.name === INBOX_NAME && !l.parentId) return;
      const v = field === 'color' ? cleanColor_(value) : (isOn_(value) ? '1' : '');
      if (String(l[field] || '') === v) return;
      before.push({ id: l.id, value: String(l[field] || '') });
      l[field] = v;
      writeRow_(sh, l._row, LIST_COLS, l);
    });
    // 済にしたら、中（中のフォルダも）の未完了タスクをまとめて完了にする（2026-11-07 本人のカード）。繰り返しは次の回ができる
    if (field === 'closed' && isOn_(value) && before.length) {
      const under = {};
      before.forEach(function (b) { under[b.id] = true; });
      for (let k = 0, grew = true; grew && k < 100; k++) {
        grew = false;
        all.forEach(function (l) { if (!under[l.id] && under[l.parentId]) { under[l.id] = true; grew = true; } });
      }
      const ids = rows_(SHEET_TASKS, TASK_COLS).filter(function (t) { return under[t.listId] && !isOn_(t.done) && !t.parentTaskId; }).map(function (t) { return t.id; });
      if (ids.length) bulk_(ids, 'done', '', '');
    }
    return { lists: lists_(), before: before, tasks: allTasks_() };
  });
}
// patchLists の before を戻す（フォルダごとに前の値へ）
function restoreListValues(field, before) {
  return withLock_(function () {
    if (field !== 'color' && field !== 'closed') throw new Error('知らない操作です：' + field);
    const sh = sheet_(SHEET_LISTS, LIST_COLS);
    const all = rows_(SHEET_LISTS, LIST_COLS);
    (before || []).slice(0, 500).forEach(function (b) {
      const l = all.filter(function (x) { return x.id === (b && b.id); })[0];
      if (!l) return;
      l[field] = field === 'color' ? cleanColor_(b.value) : (isOn_(b.value) ? '1' : '');
      writeRow_(sh, l._row, LIST_COLS, l);
    });
    return { lists: lists_() };
  });
}

// undoable('patchLists') の戻し：タスク（済にしてまとめて完了したもの）を戻してから、フォルダの値を戻す（Android版が1回で呼ぶ）
function undoPatchLists(field, before, undo) {
  return withLock_(function () {
    if (undo && ((undo.rows || []).length || (undo.created || []).length)) restoreRows(undo);
    restoreListValues(field, before);
    return { lists: lists_(), tasks: allTasks_() };
  });
}

// ---- タスク⇔フォルダ（12番。2026-11-07 本人のカード：消えるものを確認の窓で見せてから全部消す。元に戻すで戻せる） ----
const recOf_ = function (r, cols) { const o = {}; cols.forEach(function (c) { o[c] = r[c] == null ? '' : String(r[c]); }); return o; };

// タスク → フォルダ。いちばん上のタスク（親のないもの）だけ。
// 同じ名前のフォルダを、元のタスクのフォルダの中に作り、子タスクを新しいフォルダのタスクにする（子の子はそのまま子）。
// 期限・実行日・繰り返し・通知・所要時間・メモ・チェックリスト・添付（ドライブのゴミ箱へ）などは消える。元に戻すと添付もゴミ箱から戻す。
// 子の移動→元のタスクを消す、を1つの鍵の中で行う（deleteTask_ は子孫も消すので、子を移してから消す。Codex の指摘）
function convertTaskToFolder(id) {
  return withLock_(function () {
    const all = rows_(SHEET_TASKS, TASK_COLS);
    const t = all.filter(function (x) { return x.id === id; })[0];
    if (!t) throw new Error('タスクが見つかりません（別の画面で消された可能性があります）。↻で読み直してください。');
    if (t.parentTaskId) throw new Error('子タスクはフォルダにできません。先に親から外してください。');
    const kids = all.filter(function (x) { return x.parentTaskId === id; });
    const undo = { kind: 't2f', task: recOf_(t, TASK_COLS), kids: kids.map(function (k) { return recOf_(k, TASK_COLS); }), moved: descendants_(all, id).map(function (d) { return d.id; }) };
    // フォルダを作る（元のタスクのフォルダの中。フォルダが無ければいちばん上）
    const lsh = sheet_(SHEET_LISTS, LIST_COLS);
    const lists = rows_(SHEET_LISTS, LIST_COLS);
    const parent = lists.filter(function (l) { return l.id === t.listId; })[0];
    const maxOrder = lists.reduce(function (m, x) { return Math.max(m, Number(x.order) || 0); }, 0);
    const folder = { id: newId_(), name: String(t.title || '').trim() || '(名前なし)', isWork: '', order: String(maxOrder + 1), parentId: parent ? parent.id : '', color: '', icon: '', closed: '' };
    writeRow_(lsh, lsh.getLastRow() + 1, LIST_COLS, folder);
    undo.listId = folder.id;
    // 子タスクを新しいフォルダへ（孫は saveTask_ が一緒に移す）
    kids.forEach(function (k) { const c = toTask_(k); c.parentTaskId = ''; c.listId = folder.id; saveTask_(c); dirty_(); });
    dirty_();
    deleteTask_(id);
    laterCal_();
    return { lists: lists_(), tasks: allTasks_(), undo: undo, listId: folder.id };
  });
}

// フォルダ → タスク。中にフォルダがあるとき・Inbox は変えられない。新しいタスクは上のフォルダに入る（いちばん上なら Inbox）。
// 中のタスク（親のないもの）は新しいタスクの子になる。TickTick のリストそのものは消さず、対応表に「消した」印を付ける
function convertFolderToTask(id) {
  return withLock_(function () {
    const lists = rows_(SHEET_LISTS, LIST_COLS);
    const l = lists.filter(function (x) { return x.id === id; })[0];
    if (!l) throw new Error('フォルダが見つかりません。↻で読み直してください。');
    if (l.name === INBOX_NAME && !l.parentId) throw new Error(INBOX_NAME + ' はタスクにできません');
    if (lists.some(function (x) { return x.parentId === id; })) throw new Error('中にフォルダがあるフォルダはタスクにできません。先に中のフォルダを移してください。');
    let dest = l.parentId;
    if (!dest) { const inbox = lists.filter(function (x) { return x.name === INBOX_NAME && !x.parentId; })[0]; dest = inbox ? inbox.id : ''; }
    if (!dest) throw new Error(INBOX_NAME + ' が見つかりません');
    const all = rows_(SHEET_TASKS, TASK_COLS);
    const inside = all.filter(function (x) { return x.listId === id; });
    const tops = inside.filter(function (x) { return !x.parentTaskId; });
    const undo = { kind: 'f2t', list: recOf_(l, LIST_COLS), rows: inside.map(function (x) { return recOf_(x, TASK_COLS); }) };
    const made = saveTask_({ title: l.name, listId: dest, repeat: 'none' });
    undo.taskId = made.id;
    tops.forEach(function (k) { const c = toTask_(k); c.parentTaskId = made.id; saveTask_(c); dirty_(); });
    dirty_();
    const lsh = sheet_(SHEET_LISTS, LIST_COLS);
    const row = rows_(SHEET_LISTS, LIST_COLS).filter(function (x) { return x.id === id; })[0];
    if (row) { lsh.deleteRow(row._row); dirty_(); }
    const g = {}; g[id] = true;
    ttMarkGoneLists_(g, true);
    laterCal_();
    return { lists: lists_(), tasks: allTasks_(), undo: undo, taskId: made.id };
  });
}

// v0.28.0（1番）：まとめて変える。1つずつ変え、変えられなかったものは理由を返す（ほかは続ける）。元に戻すは undoConvertMany で逆の順に
function convertManyTasksToFolders(ids) {
  const undos = [], skipped = [];
  (ids || []).forEach(function (id) { try { undos.push(convertTaskToFolder(id).undo); } catch (e) { skipped.push(String(e && e.message || e)); } });
  return { lists: lists_(), tasks: allTasks_(), undos: undos, skipped: skipped };
}
function convertManyFoldersToTasks(ids) {
  const undos = [], skipped = [];
  (ids || []).forEach(function (id) { try { undos.push(convertFolderToTask(id).undo); } catch (e) { skipped.push(String(e && e.message || e)); } });
  return { lists: lists_(), tasks: allTasks_(), undos: undos, skipped: skipped };
}
function undoConvertMany(undos) {
  let r = null;
  (undos || []).slice().reverse().forEach(function (u) { r = undoConvert(u); });
  return r || { lists: lists_(), tasks: allTasks_() };
}

// 変換を元に戻す。変換のあとに別の画面で手を入れていたら（新しいフォルダにほかのタスクが入った・新しいタスクに別の子が付いたなど）戻さない
function undoConvert(undo) {
  return withLock_(function () {
    if (!undo || (undo.kind !== 't2f' && undo.kind !== 'f2t')) throw new Error('戻し方が読めません');
    const tsh = sheet_(SHEET_TASKS, TASK_COLS);
    const lsh = sheet_(SHEET_LISTS, LIST_COLS);
    const put = function (o) {
      const rec = {};
      TASK_COLS.forEach(function (c) { rec[c] = o[c] == null ? '' : String(o[c]).slice(0, 50000); });
      const cur = rows_(SHEET_TASKS, TASK_COLS).filter(function (x) { return x.id === rec.id; })[0];
      if (!cur) {
        rec.gcalId = '';
        parseAttach_(rec.attachments).forEach(function (a) { try { DriveApp.getFileById(a.id).setTrashed(false); } catch (e) { /* 戻せなければそのまま */ } });
      }
      writeTask_(tsh, cur ? cur._row : tsh.getLastRow() + 1, rec);
      dirty_();
    };
    const rowOf = function (name, cols, id) { return rows_(name, cols).filter(function (x) { return x.id === id; })[0]; };
    const dropTask = function (tid) { const r = rowOf(SHEET_TASKS, TASK_COLS, tid); if (r) { goneEvent_(r); tsh.deleteRow(r._row); dirty_(); } };
    if (undo.kind === 't2f') {
      const lists = rows_(SHEET_LISTS, LIST_COLS);
      if (!lists.some(function (x) { return x.id === undo.listId; })) throw new Error('作ったフォルダがもう無いので戻せません');
      if (lists.some(function (x) { return x.parentId === undo.listId; })) throw new Error('作ったフォルダの中にフォルダができているので戻せません');
      const ok = {}; (undo.moved || []).forEach(function (x) { ok[x] = true; });
      if (rows_(SHEET_TASKS, TASK_COLS).some(function (x) { return x.listId === undo.listId && !ok[x.id]; })) throw new Error('作ったフォルダにほかのタスクが入っているので戻せません');
      put(undo.task);
      (undo.kids || []).forEach(put);
      // 孫も元のフォルダへ
      const all = rows_(SHEET_TASKS, TASK_COLS);
      descendants_(all, undo.task.id).forEach(function (d) {
        if (d.listId !== undo.task.listId) { d.listId = undo.task.listId; writeTask_(tsh, d._row, d); }
      });
      dirty_();
      const row = rowOf(SHEET_LISTS, LIST_COLS, undo.listId);
      if (row) { lsh.deleteRow(row._row); dirty_(); }
      const g = {}; g[undo.listId] = true;
      ttMarkGoneLists_(g, true);
    } else {
      const all = rows_(SHEET_TASKS, TASK_COLS);
      if (!all.some(function (x) { return x.id === undo.taskId; })) throw new Error('作ったタスクがもう無いので戻せません');
      const ok = {}; (undo.rows || []).forEach(function (x) { ok[x.id] = true; });
      if (all.some(function (x) { return x.parentTaskId === undo.taskId && !ok[x.id]; })) throw new Error('作ったタスクにほかの子タスクが付いているので戻せません');
      if (!rowOf(SHEET_LISTS, LIST_COLS, undo.list.id)) {
        const rec = {};
        LIST_COLS.forEach(function (c) { rec[c] = undo.list[c] == null ? '' : String(undo.list[c]).slice(0, 1000); });
        if (rec.parentId && !rowOf(SHEET_LISTS, LIST_COLS, rec.parentId)) rec.parentId = '';
        writeRow_(lsh, lsh.getLastRow() + 1, LIST_COLS, rec);
        dirty_();
      }
      const g = {}; g[undo.list.id] = true;
      ttMarkGoneLists_(g, false);
      (undo.rows || []).forEach(put);
      dropTask(undo.taskId);
    }
    laterCal_();
    return { lists: lists_(), tasks: allTasks_() };
  });
}

// ---- バックアップ（27番。2026-11-07 本人のカード：取るだけ先に。戻すは v0.26.0） ----
// スプレッドシートの全部のシート（タスク・フォルダ・スマートリスト・テンプレート・設定・TickTick対応）を、
// ドライブの「ToDoアプリ_バックアップ」フォルダに新しいスプレッドシートとして写す。毎日3時ごろ自動＋設定の「今すぐ」。
// 写しは BACKUP_KEEP 個まで。写しを確かめてから古いものをゴミ箱へ（Codex の指摘）。
// スプレッドシートを丸ごと makeCopy すると、くっついているスクリプト（TickTick の鍵などの入れ物）まで写るので、シートだけを写す。
// 添付のファイルは写さない（タスクを消すと添付もゴミ箱へ移るため、戻せるのは30日以内）
const BACKUP_FOLDER = 'ToDoアプリ_バックアップ';
const BACKUP_KEEP = 30;
const BACKUP_FMT = 1;
function backupNow() { return backup_('手動'); }
function backupTrigger() { try { backup_('自動'); } catch (e) { ttProps_().setProperty('BACKUP_ERR', fmt_(new Date(), 'yyyy-MM-dd HH:mm') + ' ' + String(e && e.message || e).slice(0, 200)); } }
function backupFolder_() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}
function backup_(why, keepIds) {
  const src = ss_();
  const name = 'ToDoアプリ_バックアップ_' + fmt_(new Date(), 'yyyy-MM-dd_HHmm');
  let dst = null, counts = {};
  withLock_(function () {
    SpreadsheetApp.flush();
    dst = SpreadsheetApp.create(name);
    src.getSheets().forEach(function (sh) {
      const c = sh.copyTo(dst);
      c.setName(sh.getName());
      counts[sh.getName()] = Math.max(0, sh.getLastRow() - 1);
    });
  });
  dst.getSheets().forEach(function (sh) { if (!(sh.getName() in counts) && dst.getSheets().length > 1) dst.deleteSheet(sh); });
  const file = DriveApp.getFileById(dst.getId());
  file.moveTo(backupFolder_());
  // 確かめる：タスクの行の数が同じなら、できたとみなす
  const chk = SpreadsheetApp.openById(dst.getId()).getSheetByName(SHEET_TASKS);
  const nTasks = counts[SHEET_TASKS] || 0;
  if (!chk || Math.max(0, chk.getLastRow() - 1) !== nTasks) throw new Error('バックアップの写しを確かめられませんでした。もう一度どうぞ。');
  file.setDescription(JSON.stringify({ fmt: BACKUP_FMT, version: APP_VERSION, why: why, tasks: nTasks, lists: counts[SHEET_LISTS] || 0 }));
  const p = ttProps_();
  p.setProperty('BACKUP_LAST', nowStr_());
  p.deleteProperty('BACKUP_ERR');
  pruneBackups_(keepIds);
  const out = listBackups();
  out.made = dst.getId();
  return out;
}
function pruneBackups_(keepIds) {
  const keep = keepIds || [];
  const files = backupFiles_().filter(function (f) { return keep.indexOf(f.file.getId()) < 0; });
  files.slice(Math.max(0, BACKUP_KEEP - keep.length)).forEach(function (f) { try { f.file.setTrashed(true); } catch (e) { /* 消せなければ次の回 */ } });
}
function backupFiles_() {
  const out = [];
  const it = backupFolder_().getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    const f = it.next();
    if (String(f.getName()).indexOf('ToDoアプリ_バックアップ_') !== 0) continue;
    out.push({ file: f, at: f.getDateCreated().getTime() });
  }
  return out.sort(function (a, b) { return b.at - a.at; });
}
// 設定の「バックアップ」に出す一覧（新しい順）と、最後に取れた日時・自動で失敗したときの知らせ
function listBackups() {
  const p = ttProps_();
  return {
    last: p.getProperty('BACKUP_LAST') || '',
    error: p.getProperty('BACKUP_ERR') || '',
    keep: BACKUP_KEEP,
    items: backupFiles_().slice(0, BACKUP_KEEP).map(function (f) {
      let d = {};
      try { d = JSON.parse(f.file.getDescription() || '{}') || {}; } catch (e) { d = {}; }
      return { id: f.file.getId(), name: f.file.getName(), at: fmt_(new Date(f.at), 'yyyy-MM-dd HH:mm'), url: f.file.getUrl(), why: d.why || '', tasks: d.tasks == null ? '' : d.tasks, lists: d.lists == null ? '' : d.lists };
    })
  };
}
// 毎日3時ごろの自動バックアップのきっかけ（版が変わって準備するときに1つだけ作る）
function ensureBackupTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupTrigger'; });
  if (!has) ScriptApp.newTrigger('backupTrigger').timeBased().everyDays(1).atHour(3).create();
}

// ==== v0.26.0 ====

// ---- バックアップから戻す ----
// 稼働中のシートはそのままにして、中身（2行目から下）を写しの中身に入れ替える。列は見出しの名前で合わせる（古い版の写しも読める）。
// スクリプトのプロパティ（TickTick の鍵・バックアップの記録など）は戻さない。
// 戻す前に今の状態をバックアップする（＝戻すのを取り消せる）。TickTick 同期は止め、本人が「同期を入れる」で再開する（2026-11-07 本人カード）
const RESTORE_SHEETS_ = function () {
  return [[SHEET_TASKS, TASK_COLS, 'id'], [SHEET_LISTS, LIST_COLS, 'id'], [SHEET_SMART, SMART_COLS, 'id'], [SHEET_TEMPLATES, TEMPLATE_COLS, 'id'],
    [SHEET_SETTINGS, SETTING_COLS, 'key'], [SHEET_TT, TT_COLS, 'kind']];
};
function backupFileChecked_(fileId) {
  const f = DriveApp.getFileById(String(fileId || ''));
  const folderId = backupFolder_().getId();
  let inFolder = false;
  const ps = f.getParents();
  while (ps.hasNext()) if (ps.next().getId() === folderId) inFolder = true;
  if (!inFolder || String(f.getName()).indexOf('ToDoアプリ_バックアップ_') !== 0 || f.isTrashed()) throw new Error('このアプリのバックアップではありません。');
  return f;
}
// 写しのシートを「見出し → 値」の行に読む。見出しに id（設定は key）が無いシートは使えない
function backupRows_(ss, name, key) {
  const sh = ss.getSheetByName(name);
  if (!sh) return null;
  const last = sh.getLastRow(), w = sh.getLastColumn();
  if (last < 1 || w < 1) return { head: [], rows: [] };
  const vals = sh.getRange(1, 1, last, w).getValues();
  const head = vals[0].map(String);
  if (head.indexOf(key) < 0) throw new Error('バックアップの「' + name + '」の見出しが読めません。');
  return { head: head, rows: vals.slice(1).filter(function (r) { return String(r[head.indexOf(key)] || '') !== ''; }) };
}
// 戻す前に見せる中身の件数
function backupInfo(fileId) {
  const f = backupFileChecked_(fileId);
  const ss = SpreadsheetApp.openById(f.getId());
  const t = backupRows_(ss, SHEET_TASKS, 'id');
  if (!t) throw new Error('バックアップにタスクのシートがありません。');
  const l = backupRows_(ss, SHEET_LISTS, 'id');
  const di = t.head.indexOf('done');
  return { id: f.getId(), name: f.getName(), at: fmt_(f.getDateCreated(), 'yyyy-MM-dd HH:mm'), tasks: t.rows.length,
    open: di < 0 ? t.rows.length : t.rows.filter(function (r) { return String(r[di]) !== '1' && r[di] !== true; }).length,
    lists: l ? l.rows.length : 0, now: { tasks: allTasks_().length, lists: lists_().length } };
}
function restoreBackup(fileId) {
  const f = backupFileChecked_(fileId);
  const src = SpreadsheetApp.openById(f.getId());
  // 先に全部読んで確かめる（途中で読めないものがあれば何も変えない）
  const data = RESTORE_SHEETS_().map(function (x) { return { name: x[0], cols: x[1], key: x[2], rows: backupRows_(src, x[0], x[2]) }; });
  if (!data[0].rows) throw new Error('バックアップにタスクのシートがありません。');
  data.forEach(function (d) {
    if (!d.rows || d.key === 'kind') return;
    const ki = d.rows.head.indexOf(d.key), seen = {};
    d.rows.rows.forEach(function (r) { const k = String(r[ki]); if (seen[k]) throw new Error('バックアップの「' + d.name + '」に同じ ID が2つあります。戻しません。'); seen[k] = true; });
  });
  const sp = PropertiesService.getScriptProperties();
  return withLock_(function () {
    // 戻す前の今の状態を写して確かめる（できなければ戻さない）。選んだ写しは30個から押し出さない
    const before = backup_('戻す前', [f.getId()]);
    const p = ttProps_();
    const wasSync = p.getProperty('TT_SYNC') === '1';
    ttSetSync_(false);
    const imported = !!p.getProperty('TT_IMPORTED');
    if (imported) p.setProperty('TT_RESTORED', nowStr_());
    p.deleteProperty('TT_STAGE');
    p.deleteProperty('TT_STATUS');
    ttBumpGen_();
    sp.setProperty('RESTORE_GEN', String(Date.now()));
    sp.setProperty('RESTORING', nowStr_() + '|' + f.getName());
    HDR_CHECK_ = true; // v0.33.0：戻すときは見出しも確かめる
    data.forEach(function (d) {
      delete SHEET_CACHE_[d.name];
      const sh = sheet_(d.name, d.cols);
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), d.cols.length)).clearContent();
      const b = d.rows || { head: [], rows: [] };
      if (!b.rows.length) return;
      const idx = d.cols.map(function (c) { return b.head.indexOf(c); });
      const vals = b.rows.map(function (r) { return idx.map(function (i) { return i < 0 ? '' : norm_(r[i]); }); });
      const range = sh.getRange(2, 1, vals.length, d.cols.length);
      range.setNumberFormat('@');
      range.setValues(vals);
    });
    HDR_CHECK_ = false;
    SpreadsheetApp.flush();
    dirty_();
    // 確かめる：タスクとフォルダの数が写しと同じ
    const nT = allTasks_().length, nL = lists_().length;
    if (nT !== data[0].rows.rows.length || (data[1].rows && nL !== data[1].rows.rows.length)) {
      throw new Error('戻した中身を確かめられませんでした（タスク ' + nT + '件）。設定のバックアップから「戻す前」を選んで戻し直してください。');
    }
    // v0.33.0（Codex）：タブのアイコンの色も、戻した設定に合わせる
    try { PropertiesService.getScriptProperties().setProperty('APP_ICON', String(settings_().appIcon || '')); } catch (e) { /* タブの色が次に変わらないだけ */ }
    sp.deleteProperty('RESTORING');
    // 戻したタスクの添付がゴミ箱にあれば戻す（完全に消えたものは戻せない）
    let attLost = 0;
    allTasks_().forEach(function (t) {
      (t.attachments || []).forEach(function (a) {
        try { const af = DriveApp.getFileById(a.id); if (af.isTrashed()) af.setTrashed(false); } catch (e) { attLost++; }
      });
    });
    return { tasks: nT, lists: nL, at: fmt_(f.getDateCreated(), 'yyyy-MM-dd HH:mm'), attLost: attLost,
      beforeName: (before.items.filter(function (x) { return x.id === before.made; })[0] || {}).name || '', ttStopped: imported, wasSync: wasSync };
  });
}
