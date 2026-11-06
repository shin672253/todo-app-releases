/**
 * ToDoアプリ v0.16.0（Web版）サーバー側
 * スプレッドシートの「拡張機能 → Apps Script」の「コード.gs」に貼り付ける。
 * 画面は同じプロジェクトの HTML ファイル「index」、更新（⚙ の ⟳）はスクリプト「更新」、
 * 権限などは appsscript.json に入れる。v0.12.0 からは ⚙ の ⟳ で新しい版に入れ替えられる。
 */
const APP_VERSION = '0.20.0';
const APP_SEQ = 1801; // 版の通し番号（X×10000＋Y×100＋Z）。⚙の⟳は、これより大きい版にしか更新しない
const TZ = 'Asia/Tokyo';
const SHEET_TASKS = 'タスク';
const SHEET_LISTS = 'リスト';
const INBOX_NAME = 'Inbox'; // とりあえずタスクを入れておくフォルダ（v0.15.0）
const SHEET_SETTINGS = '設定';
const SHEET_TEMPLATES = 'テンプレート';
// doDate＝実行日の開始、doEnd＝実行日の終了。日付だけ（yyyy-MM-dd）か日時（yyyy-MM-ddTHH:mm）
const TASK_COLS = ['id', 'title', 'listId', 'due', 'doDate', 'repeat', 'notifyAt', 'notified',
  'memo', 'done', 'doneAt', 'createdAt', 'updatedAt', 'repeatBase', 'repeatCount', 'nextId', 'doEnd', 'attachments', 'parentTaskId', 'doneWith', 'checklist',
  'order', 'reminders', 'wontDo', 'gcalId', 'estimate', 'dayOrder'];
// parentTaskId＝親タスクのID（子タスクのとき）。子タスクは親と同じフォルダに入る
// checklist＝タスクの中の項目（[{t:'文字', d:済みなら true}] の JSON）
// doneWith＝完了の操作ごとの目印。押したタスクは「*目印」、一緒に完了した子・孫は「目印」。取り消すときに一緒に戻す
// order＝フォルダの中で手で並べた順（小さいほど上。空なら日付の順で後ろに並ぶ）
// reminders＝「◯分前」の通知（do:-30＝実行日の30分前、due:0＝期限の時刻ちょうど。時刻のない日は9:00を基準）を , でつなぐ
// notified＝もう送った通知の日時を , でつなぐ（v0.4 までの「1」は notifyAt を送り済み）
// wontDo＝「やらない」で終えた（done も 1 にする）
// gcalId＝Googleカレンダーに書き込んだ予定のIDと、書き込んだ中身の目印（ID|目印）
// estimate＝かかる時間（分の整数。空は「まだ決めていない」で、0分とは別）。繰り返しの次の回へ引き継ぐ
// dayOrder＝その日だけの並び順（「日付:数」。例 2026-11-02:3）。朝の段取りで並べた今日の順。フォルダの中の順（order）とは別
// リストは画面では「フォルダ」。parentId で入れ子にする（isWork は v0.1 の名残で使わない）
// color＝フォルダの色（Googleカレンダーの予定の色の番号 1〜11。空なら上のフォルダの色）
const LIST_COLS = ['id', 'name', 'isWork', 'order', 'parentId', 'color', 'icon'];
const TEMPLATE_COLS = ['id', 'name', 'data', 'createdAt'];
const SETTING_COLS = ['key', 'value'];
// freeWeekday・freeHoliday＝1日にタスクへ使える時間（分。平日用と、土日・祝日用。空なら出さない）
const DEFAULT_SETTINGS = { theme: '', notifyMethod: 'none', ntfyTopic: '', mailTo: '', calendarIds: '', weekStart: 'sun', calSync: '',
  freeWeekday: '', freeHoliday: '' };
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
const MAX_ESTIMATE = 1440; // かかる時間の上限（24時間）

// ---- 画面を出す ----

function doGet(e) {
  // TickTick の許可の画面から戻ってきたとき（?code=…&state=…）
  const q = (e && e.parameter) || {};
  if (q.code || q.error) return ttCallback_(q);
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ToDoアプリ v' + APP_VERSION)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // v0.18.0：Google サイトなどに埋め込めるようにする（上の「Google Apps Script のユーザーが作成」の帯を出さないため。2026-11-05 ユーザーがカードで選択）
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

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
    holidays: holidaysNear_(), // 今年と来年の祝日（日付 → 名前）。画面とAndroid版はこれを使う
    ttConflicts: ttConflictCount_(), // TickTick との確認待ちの数（v0.15.0）
    once: true // once で送れる（Android版 v0.11.0 から使う）
  };
}

// Android版の書き込みを、目印（key）ごとに1回だけ行う。電波の切れ目で答えだけ届かずに送り直しても、
// 2回目は行わずに { dup: true } を返す（端末は最新を読み直す）。行ったら { result: 答え }
const ONCE_ = { setDone: setDone, saveTask: saveTask, deleteTask: deleteTask, bulkTasks: bulkTasks, copyTasks: copyTasks,
  patchTasks: patchTasks, saveList: saveList, moveLists: moveLists, deleteList: deleteList, saveSettings: saveSettings, saveTemplate: saveTemplate,
  deleteTemplate: deleteTemplate, useTemplate: useTemplate, addAttachment: addAttachment, removeAttachment: removeAttachment,
  restoreRows: restoreRows, undoable: undoable, bulkGroups: bulkGroups };
// 元に戻せる操作（undoable）の戻し方は、6時間だけ覚えておく。答えだけ届かずに送り直したとき（dup）も、
// 戻し方を返せるようにするため（{ dup: true, undo: 戻し方 }）
function once(key, fn, args) {
  if (!Object.prototype.hasOwnProperty.call(ONCE_, fn)) throw new Error('知らない操作です：' + fn);
  const cid = 'o:' + String(key || '').slice(0, 80);
  return withLock_(function () {
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
    doDate: t.doDate || '',
    doEnd: t.doDate && t.doEnd && t.doEnd > t.doDate ? t.doEnd : '',
    repeat: cleanRepeat_(t.repeat),
    notifyAt: notifyAt,
    // 通知と並び順は、渡されなければ今のまま
    reminders: 'reminders' in t ? remList_(t.reminders).join(',') : old ? old.reminders : '',
    order: 'order' in t ? cleanOrder_(t.order) : old ? old.order : '',
    // かかる時間・その日の並び順も、渡されなければ今のまま（古い版の画面やAndroid版で直しても消えない）
    estimate: 'estimate' in t ? cleanEstimate_(t.estimate) : old ? old.estimate : '',
    dayOrder: 'dayOrder' in t ? cleanDayOrder_(t.dayOrder) : old ? old.dayOrder : '',
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
    && old.due === rec.due && old.notifyAt === rec.notifyAt;
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
// （かかる時間 estimate・その日の並び順 dayOrder も変えられる）
function patchTasks(items) {
  return withLock_(function () {
    const KEYS = ['listId', 'parentTaskId', 'doDate', 'doEnd', 'due', 'estimate'];
    (items || []).forEach(function (it) {
      if (!KEYS.some(function (k) { return k in it; })) return;
      const t = toTask_(pick_(rows_(SHEET_TASKS, TASK_COLS), it.id));
      KEYS.forEach(function (k) { if (k in it) t[k] = it[k]; });
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
  deleteTask: deleteTask, addTasks: addTasks, copyTasks: copyTasks, bulkGroups: bulkGroups };
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
        doDate: t.doDate, doEnd: t.doEnd, due: t.due, notifyAt: t.notifyAt, estimate: t.estimate,
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
      icon: 'icon' in l ? cleanIcon_(l.icon) : old ? old.icon : ''
    };
    writeRow_(sh, old ? old._row : sh.getLastRow() + 1, LIST_COLS, rec);
    // 色や場所が変わったら、中のタスクのカレンダーの予定の色も変える
    if (old && (old.color !== rec.color || old.parentId !== rec.parentId) && settings_().calSync === '1') {
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
    if (Object.keys(moved).length && settings_().calSync === '1') {
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
    sheet_(SHEET_LISTS, LIST_COLS).deleteRow(old._row); dirty_();
    return id;
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
      if (!hit) rows.push({ key: k, _row: row });
    });
    return settings_();
  });
}

// Googleカレンダーの予定を読む（start〜end の前日まで。日付は yyyy-MM-dd）
function getEvents(start, end) {
  const s = settings_();
  const ids = ['primary'].concat(s.calendarIds.split(/[,\s、]+/).filter(String));
  // タスクを書き込んでいるカレンダーは読まない（タスクと二重に出るので）
  const syncId = PropertiesService.getScriptProperties().getProperty('SYNC_CAL_ID');
  const from = new Date(start + 'T00:00:00+09:00');
  const to = new Date(end + 'T00:00:00+09:00');
  const out = [];
  ids.forEach(function (id) {
    const cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
    if (!cal || (syncId && cal.getId() === syncId)) return;
    const color = cal.getColor();
    cal.getEvents(from, to).forEach(function (e) {
      const allDay = e.isAllDayEvent();
      out.push({
        title: e.getTitle() || '(予定)',
        allDay: allDay,
        start: allDay ? fmt_(e.getAllDayStartDate(), 'yyyy-MM-dd') : fmt_(e.getStartTime(), "yyyy-MM-dd'T'HH:mm"),
        end: allDay ? fmt_(e.getAllDayEndDate(), 'yyyy-MM-dd') : fmt_(e.getEndTime(), "yyyy-MM-dd'T'HH:mm"),
        color: color
      });
    });
  });
  return out;
}

// 5分ごとに通知を調べる仕組み（トリガー）を入れ直す
function enableNotify() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'checkNotifications') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('checkNotifications').timeBased().everyMinutes(5).create();
  return '通知を開始しました（5分ごとに確認します）';
}

function testNotify() {
  const s = settings_();
  if (s.notifyMethod === 'none') throw new Error('届け方が「通知しない」になっています');
  send_(s, 'テスト通知', 'ToDoアプリからのテストです');
  return 'テスト通知を送りました';
}

// トリガーから呼ばれる。通知の時刻が来た未完了タスクを届ける（日時の通知と「◯分前」の通知）
function checkNotifications() {
  // 後回しにしたカレンダーの書き込みが残っていれば、ここでも書き込む
  withLock_(flushPending_);
  const s = settings_();
  if (s.notifyMethod === 'none') return;
  withLock_(function () {
    const sh = sheet_(SHEET_TASKS, TASK_COLS);
    const now = nowStr_();
    const tooOld = fmt_(new Date(Date.now() - 24 * 3600 * 1000), "yyyy-MM-dd'T'HH:mm");
    const lists = lists_();
    rows_(SHEET_TASKS, TASK_COLS).forEach(function (t) {
      if (isOn_(t.done)) return;
      const times = fireTimes_(t);
      const sent = sentList_(t);
      let changed = false;
      times.forEach(function (x) {
        if (x > now || sent.indexOf(x) >= 0) return;
        // 1日以上前の通知は、まとめて届くと困るので送らずに済ませる
        if (x >= tooOld) send_(s, t.title, detail_(t, lists));
        sent.push(x);
        changed = true;
      });
      if (!changed) return;
      t.notified = sent.filter(function (x) { return times.indexOf(x) >= 0; }).join(',');
      writeRow_(sh, t._row, TASK_COLS, t);
    });
  });
}

// ---- Googleカレンダーに書き込む ----

// 今あるタスク（実行日のあるもの）を、まとめてカレンダーに書き込む
function syncAllToCalendar() {
  return withLock_(function () {
    if (settings_().calSync !== '1') throw new Error('先に「Googleカレンダーに書き込む」をオンにして保存してください');
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
  if (settings_().calSync !== '1' || (!ids.length && !gone.length)) return;
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
  if (settings_().calSync !== '1') return '';
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
  if (settings_().calSync !== '1' || (!ids.length && !gone.length)) return '';
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

function send_(s, title, message) {
  const m = s.notifyMethod;
  // 受け取り名が空のまま「送った」ことにすると、そのタスクは二度と通知されないので止める
  if ((m === 'ntfy' || m === 'both') && !s.ntfyTopic) throw new Error('ntfyの受け取り名が空です。設定で入れてください');
  if (m === 'ntfy' || m === 'both') {
    const res = UrlFetchApp.fetch('https://ntfy.sh/', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ topic: s.ntfyTopic, title: title, message: message || ' ', tags: ['memo'] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 400) throw new Error('ntfyに送れませんでした（' + res.getResponseCode() + '）');
  }
  if (m === 'mail' || m === 'both') {
    MailApp.sendEmail(s.mailTo || Session.getEffectiveUser().getEmail(), '[ToDo] ' + title, message || title);
  }
}

function detail_(t, lists) {
  const l = lists.filter(function (x) { return x.id === t.listId; })[0];
  const parts = [];
  if (l) parts.push(l.name);
  if (t.doDate) parts.push('実行日 ' + mdt_(t.doDate) + (t.doEnd ? '〜' + mdt_(t.doEnd) : ''));
  if (t.due) parts.push('期限 ' + mdt_(t.due));
  return parts.join('・');
}

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
  const p = t.repeatBase ? t.repeatBase.split('|') : [t.doDate, t.due, t.notifyAt, t.doEnd];
  const base = { doDate: p[0] || '', due: p[1] || '', notifyAt: p[2] || '', doEnd: p[3] || '' };
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
  t.repeatBase = [base.doDate, base.due, base.notifyAt, base.doEnd].join('|');
  // 終わりの日より後になったら、次の回は作らない（false を返す）
  return !(r && r.until && (t.doDate || t.due).slice(0, 10) > r.until);
}

// 起点から n 回目の日付。実行日（なければ期限）を基準に決め、ほかの日付は同じ日数だけずらす
// （期間の長さや期限との間隔を保つ）
function nextDates_(base, repeat, n) {
  const anchor = (base.doDate || base.due).slice(0, 10);
  const delta = daysBetween_(anchor, occurrence_(anchor, parseRepeat_(repeat), n));
  const out = {};
  ['doDate', 'due', 'notifyAt', 'doEnd'].forEach(function (k) { out[k] = base[k] ? addDaysStr_(base[k], delta) : ''; });
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
  return (HOLIDAY_CACHE_[y] = calHolidays_(y) || calcHolidays_(y));
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

function cleanOrder_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
}

// かかる時間：空は「決めていない」。0〜1440分の整数だけ受け付ける（負・小数・大きすぎる数は断る）
function cleanEstimate_(v) {
  if (v === '' || v == null) return '';
  const s = String(v).trim();
  if (!/^\d+$/.test(s) || Number(s) > MAX_ESTIMATE) throw new Error('かかる時間は0〜' + MAX_ESTIMATE + '分の整数で入れてください');
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
  sheet_(SHEET_TASKS, TASK_COLS);
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
function sheet_(name, cols) {
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  // 1行目の見出しが足りなければ書き直す（版が上がって列が増えたとき）
  if (sh.getRange(1, cols.length).getValue() !== cols[cols.length - 1]) {
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
    estimate: safeEstimate_(o.estimate), dayOrder: o.dayOrder || ''
  };
}

function allTasks_() {
  return rows_(SHEET_TASKS, TASK_COLS).map(toTask_);
}

function toList_(o) {
  return { id: o.id, name: o.name, order: Number(o.order) || 0, parentId: o.parentId || '', color: cleanColor_(o.color), icon: cleanIcon_(o.icon) };
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
    imported: p.getProperty('TT_IMPORTED') || '', sync: p.getProperty('TT_SYNC') === '1', backup: p.getProperty('TT_BACKUP') || '',
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
    .setTitle('ToDoアプリ と TickTick').addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      repeat: rep.repeat, checklist: checklist, ttId: String(t.id), ttParent: t.parentId ? String(t.parentId) : '' },
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
const TT_FIELDS = ['title', 'memo', 'doDate', 'doEnd', 'due', 'repeat', 'checklist', 'list', 'parent', 'done'];
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
    raw: [a.doDate || '', a.doEnd || '', a.due || ''].join('|'), repeat: cleanRepeat_(a.repeat),
    checklist: JSON.stringify(parseList_(a.checklist)), list: listTt[a.listId] || '', parent: a.parentTaskId ? taskTt[a.parentTaskId] || '' : '',
    done: isOn_(a.done) };
}
// 写せない繰り返しは「tt:」で始まる目印にする（アプリでは繰り返しなし。TickTick の決め方はそのまま残す）
const TT_KEEP = 'tt:';
function ttNormTt_(t) {
  const x = ttTaskIn_(t).rec;
  const rp = ttRepeatIn_(t, x.doDate || x.due);
  const repeat = rp.mark ? TT_KEEP + String(t.repeatFlag || '') + (String(t.repeatFrom) === '1' ? '|1' : '') : x.repeat;
  return { title: x.title, memo: x.memo, doDate: x.doDate, doEnd: x.doEnd || '', due: x.due, repeat: repeat, checklist: JSON.stringify(x.checklist),
    list: ttProjKey_(t.projectId), parent: x.ttParent, done: Number(t.status) === 2 };
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
  return t;
}

// 同期のスイッチ。入れると5分ごとに同期する
function ttSetSync(on) {
  const p = ttProps_();
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'ttSyncTrigger') ScriptApp.deleteTrigger(tr);
  });
  if (on) {
    if (!p.getProperty('TT_IMPORTED')) throw new Error('先に「最初の取り込み」をしてください。');
    ttAccess_();
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
      listId: listApp[n.list] || '', parentTaskId: n.parent ? taskApp[n.parent] || '' : '' };
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
        const hold = edits.indexOf('list') >= 0 && an.list === TT_INBOX && !projOf(TT_INBOX);
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
      const holdIn = appEdits.indexOf('list') >= 0 && an.list === TT_INBOX && !inboxId();
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
      const holdList = rest.indexOf('list') >= 0 && an.list === TT_INBOX && !inboxId();
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
          listId: listId, parentTaskId: pid ? taskApp[pid] || '' : '', done: true, _doneAt: ttDateIn_(t.completedTime, false) || '' });
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
  r.data.forEach(function (d) {
    const pr = d.project;
    const key = pr.inbox ? TT_INBOX : String(pr.id);
    const name = pr.inbox ? INBOX_NAME : String(pr.name || '').trim() || '(名前なし)';
    const parent = pr.inbox ? '' : groupApp(pr.groupId);
    const m = lmap[key];
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
    if (parent !== S.parent && l.parentId !== parent) { saveList({ id: l.id, name: byId[l.id].name, parentId: parent }); st.toApp++; }
    // 送れなかった名前（書く回数の上限）は前回のままにして、次の回に送り直す。受信箱はアプリで名前を変えても TickTick に送らない
    const now = { name: ttName ? name : sent ? l.name : S.name, parent: parent };
    if (JSON.stringify(now) !== JSON.stringify(m.snapObj)) { m.snapObj = now; ttWriteMap_(msh, m); }
  });
  // アプリで作ったフォルダ（対応のないもの）→ TickTick にリストを作る（上のフォルダが TickTick のフォルダなら、その中に）
  const known = {};
  maps.forEach(function (m) { if (m.kind !== 'task') known[m.appId] = true; });
  ttMapRows_().forEach(function (m) { if (m.kind !== 'task') known[m.appId] = true; });
  const groupOfApp = {};
  Object.keys(gmap).forEach(function (gid) { groupOfApp[gmap[gid].appId] = gid; });
  rows_(SHEET_LISTS, LIST_COLS).forEach(function (l) {
    if (known[l.id] || !ttProps_().getProperty('TT_IMPORTED')) return;
    if (TT_IMPORTING_) {
      // 取り込みの前からあって TickTick にないフォルダは、アプリだけのフォルダとして残す（TickTick には作らない）
      ttWriteMap_(msh, { kind: 'local', appId: l.id, ttId: '', ttProject: '', snapObj: null });
      return;
    }
    if (!can()) return;
    const body = { name: l.name };
    if (groupOfApp[l.parentId]) body.groupId = groupOfApp[l.parentId];
    const res = ttSend_('post', '/project', body);
    if (res && res.id) {
      ttWriteMap_(msh, { kind: 'list', appId: l.id, ttId: String(res.id), ttProject: String(res.id), snapObj: { name: l.name, parent: l.parentId } });
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
  const names = { title: '名前', memo: 'メモ', doDate: 'やる日', doEnd: 'やる日の終わり', due: '期限', repeat: '繰り返し', checklist: 'チェックリスト', list: 'フォルダ', parent: '親', done: '完了' };
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
