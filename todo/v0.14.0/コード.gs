/**
 * ToDoアプリ v0.14.0（Web版）サーバー側
 * スプレッドシートの「拡張機能 → Apps Script」の「コード.gs」に貼り付ける。
 * 画面は同じプロジェクトの HTML ファイル「index」、更新（⚙ の ⟳）はスクリプト「更新」、
 * 権限などは appsscript.json に入れる。v0.12.0 からは ⚙ の ⟳ で新しい版に入れ替えられる。
 */
const APP_VERSION = '0.14.0';
const APP_SEQ = 1400; // 版の通し番号（X×10000＋Y×100＋Z）。⚙の⟳は、これより大きい版にしか更新しない
const TZ = 'Asia/Tokyo';
const SHEET_TASKS = 'タスク';
const SHEET_LISTS = 'リスト';
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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
  withLock_(ensureSetup_);
  return {
    version: APP_VERSION,
    lists: lists_(),
    tasks: allTasks_(),
    settings: settings_(),
    templates: templates_(),
    holidays: holidaysNear_(), // 今年と来年の祝日（日付 → 名前）。画面とAndroid版はこれを使う
    once: true // once で送れる（Android版 v0.11.0 から使う）
  };
}

// Android版の書き込みを、目印（key）ごとに1回だけ行う。電波の切れ目で答えだけ届かずに送り直しても、
// 2回目は行わずに { dup: true } を返す（端末は最新を読み直す）。行ったら { result: 答え }
const ONCE_ = { setDone: setDone, saveTask: saveTask, deleteTask: deleteTask, bulkTasks: bulkTasks, copyTasks: copyTasks,
  patchTasks: patchTasks, saveList: saveList, deleteList: deleteList, saveSettings: saveSettings, saveTemplate: saveTemplate,
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
    doneAt: t.done ? (old && old.doneAt) || now : '',
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
    sh.deleteRow(d._row);
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
    advance_(next, day);
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
    sh.deleteRow(r._row);
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
        sh.deleteRow(r._row);
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
    sheet_(SHEET_TEMPLATES, TEMPLATE_COLS).deleteRow(r._row);
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

function deleteList(id) {
  return withLock_(function () {
    const kids = rows_(SHEET_LISTS, LIST_COLS).filter(function (x) { return x.parentId === id; });
    if (kids.length) throw new Error('中にフォルダが ' + kids.length + ' 個あるので消せません。先に中のフォルダを移すか消してください。');
    const left = rows_(SHEET_TASKS, TASK_COLS).filter(function (t) { return t.listId === id && !isOn_(t.done); });
    if (left.length) throw new Error('このフォルダには未完了のタスクが ' + left.length + ' 件あるので消せません。先に移すか完了にしてください。');
    const old = findRow_(SHEET_LISTS, LIST_COLS, id);
    sheet_(SHEET_LISTS, LIST_COLS).deleteRow(old._row);
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
  if (r.freq === 'monthly' && r.by !== 'day') return nthWeekday_(anchor, n * r.interval, r.by === 'last');
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
    nh: p.slice(2).indexOf('nh') >= 0 };
  if (r.freq === 'weekly') {
    r.days = (p[2] || '').split(',').filter(function (d, i, a) { return /^[0-6]$/.test(d) && a.indexOf(d) === i; })
      .map(Number).sort(function (x, y) { return x - y; });
  }
  if (r.freq === 'monthly' && (p[2] === 'nth' || p[2] === 'last')) r.by = p[2];
  return r;
}

function cleanRepeat_(s) {
  const r = parseRepeat_(s);
  if (!r) return 'none';
  if (OLD_REPEATS[s]) return s;
  return r.freq + '/' + r.interval + (r.freq === 'weekly' && r.days.length ? '/' + r.days.join(',') : r.freq === 'monthly' ? '/' + r.by : '')
    + (r.nh ? '/nh' : '');
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
    const base = p[0] === 'due' ? t.due : t.doDate;
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
    return;
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

function rows_(name, cols, keyCol) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const key = keyCol || 'id';
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r, i) {
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
  lock.waitLock(10000);
  LOCKED_ = true;
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
    connected: !!p.getProperty('TT_TOKEN'), redirectUri: ttRedirect_() };
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
  const reads = [{ id: 'inbox', name: '受信箱', inbox: true }].concat(projects);
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
  return { projects: projects, groups: groups, data: data, errors: errors, ok: !errors.length };
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
function ttDatesIn_(t) {
  const all = !!t.isAllDay;
  const s = ttDateIn_(t.startDate, all, t.timeZone);
  const d = ttDateIn_(t.dueDate, all, t.timeZone);
  if (s && d && s !== d) return { doDate: s, due: d };
  if (s) return { doDate: s, due: '' };
  return { doDate: '', due: d };
}

// やる日・期限 → 開始日・期限（期限だけなら、開始日も期限にする。TickTick は期限だけを持てないため）
function ttDatesOut_(rec) {
  const s = rec.doDate || rec.due || '';
  const d = rec.due || rec.doDate || '';
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
  const known = { FREQ: 1, INTERVAL: 1, BYDAY: 1, BYMONTHDAY: 1, BYMONTH: 1, BYSETPOS: 1, WKST: 1 };
  const extra = Object.keys(o).filter(function (k) { return !known[k]; });
  if (extra.length) return no('アプリにない繰り返しの決め方（' + extra.join('・') + '）');
  const n = o.INTERVAL ? Number(o.INTERVAL) : 1;
  if (!(n >= 1 && n <= 99 && Math.floor(n) === n)) return no('間隔が大きすぎる繰り返し');
  const p = day.split('-').map(Number);
  const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  const nth = Math.ceil(p[2] / 7);
  const lastWeek = p[2] + 7 > new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  if (o.FREQ === 'DAILY') {
    if (o.BYDAY || o.BYMONTHDAY || o.BYMONTH || o.BYSETPOS) return no('アプリにない毎日の繰り返し');
    return { repeat: 'daily/' + n, mark: '' };
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
    return { repeat: cleanRepeat_('weekly/' + n + (idx.length ? '/' + idx.join(',') : '')), mark: '' };
  }
  if (o.FREQ === 'MONTHLY') {
    // 条件を重ねた決め方（曜日と日にちの両方など）は、アプリの1つの決め方では表せない
    if (o.BYMONTH || (o.BYDAY && o.BYMONTHDAY) || (o.BYSETPOS && o.BYMONTHDAY)) return no('アプリにない毎月の繰り返し');
    let by = o.BYDAY || '';
    if (by && o.BYSETPOS && /^[A-Z]{2}$/.test(by)) by = o.BYSETPOS + by;
    else if (o.BYSETPOS) return no('アプリにない毎月の繰り返し');
    if (by) {
      const m = by.match(/^(-1|[1-4])([A-Z]{2})$/);
      if (!m || TT_DAYS.indexOf(m[2]) !== wd) return no('やる日と曜日が合わない毎月の繰り返し');
      if (m[1] === '-1') return lastWeek ? { repeat: 'monthly/' + n + '/last', mark: '' } : no('やる日と合わない「最終◯曜日」の繰り返し');
      return Number(m[1]) === nth ? { repeat: 'monthly/' + n + '/nth', mark: '' } : no('やる日と合わない「第◯◯曜日」の繰り返し');
    }
    if (o.BYMONTHDAY && Number(o.BYMONTHDAY) < 0) return no('月末から数える毎月の繰り返し');
    if (o.BYMONTHDAY && Number(o.BYMONTHDAY) !== p[2]) return no('やる日と日にちが合わない毎月の繰り返し');
    if (p[2] > 28) return no('29日〜31日の毎月の繰り返し（短い月の扱いが違う）');
    return { repeat: 'monthly/' + n + '/day', mark: '' };
  }
  if (o.FREQ === 'YEARLY') {
    // 月を決めずに日にちだけ決めると、毎年でも毎月その日になる（RFC 5545）
    if (o.BYDAY || o.BYSETPOS || (o.BYMONTHDAY && !o.BYMONTH)) return no('アプリにない毎年の繰り返し');
    if ((o.BYMONTH && Number(o.BYMONTH) !== p[1]) || (o.BYMONTHDAY && Number(o.BYMONTHDAY) !== p[2])) return no('やる日と合わない毎年の繰り返し');
    if (p[1] === 2 && p[2] === 29) return no('2月29日の毎年の繰り返し');
    return { repeat: 'yearly/' + n, mark: '' };
  }
  return no('アプリにない繰り返し');
}

// アプリの決め方 → TickTick の繰り返し（RRULE）。写せないときは flag:null と理由
function ttRepeatOut_(repeat, anchor) {
  const r = parseRepeat_(repeat);
  if (!r) return { flag: '', mark: '' };
  const no = function (why) { return { flag: null, mark: why }; };
  if (r.nh) return no('祝日を飛ばす繰り返し');
  const iv = r.interval > 1 ? ';INTERVAL=' + r.interval : '';
  const day = String(anchor || '').slice(0, 10);
  if (r.freq === 'daily') return { flag: 'RRULE:FREQ=DAILY' + iv, mark: '' };
  if (r.freq === 'weekly') {
    const wkst = r.interval > 1 && r.days.length > 1 && r.days[0] === 0 ? ';WKST=SU' : ''; // アプリと同じく週を日曜から数える
    return { flag: 'RRULE:FREQ=WEEKLY' + iv + wkst + (r.days.length ? ';BYDAY=' + r.days.map(function (d) { return TT_DAYS[d]; }).join(',') : ''), mark: '' };
  }
  if (r.freq === 'yearly') {
    if (day.slice(5) === '02-29') return no('2月29日の毎年の繰り返し');
    return { flag: 'RRULE:FREQ=YEARLY' + iv, mark: '' };
  }
  if (!day) return no('日付のない繰り返し');
  const p = day.split('-').map(Number);
  const wd = TT_DAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  if (r.by === 'last') return { flag: 'RRULE:FREQ=MONTHLY' + iv + ';BYDAY=-1' + wd, mark: '' };
  if (r.by === 'nth') {
    const nth = Math.ceil(p[2] / 7);
    if (nth > 4) return no('第5◯曜日の繰り返し（ない月の扱いが違う）');
    return { flag: 'RRULE:FREQ=MONTHLY' + iv + ';BYDAY=' + nth + wd, mark: '' };
  }
  if (p[2] > 28) return no('29日〜31日の毎月の繰り返し（短い月の扱いが違う）');
  return { flag: 'RRULE:FREQ=MONTHLY' + iv + ';BYMONTHDAY=' + p[2], mark: '' };
}

// TickTick のタスク → アプリのタスクの中身（id・フォルダ・親はあとで決める）と、写せなかったことの印
function ttTaskIn_(t) {
  const marks = [];
  const dates = ttDatesIn_(t);
  const rep = ttRepeatIn_(t, dates.doDate || dates.due);
  if (rep.mark) marks.push(rep.mark);
  if (t.kind === 'NOTE') marks.push('メモ（ノート）の形');
  const items = (t.items || []).slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  const checklist = parseList_(items.map(function (x) { return { t: x.title || '', d: Number(x.status) === 1 }; }));
  const memo = String((t.kind === 'CHECKLIST' ? t.desc : t.content) || t.content || t.desc || '');
  return {
    rec: { title: String(t.title || '').trim() || '（名前なし）', memo: memo, doDate: dates.doDate, due: dates.due,
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
