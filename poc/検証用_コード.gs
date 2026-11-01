// 更新ボタンの検証用プロジェクト（ToDoアプリ v0.12.0 の前に試す）
// 試すこと：配布リポから新しい版を取り、署名とハッシュ値を確かめ、自分のコードを書き替え、
// 2つのデプロイ（Web アプリと API 実行可能）を新しいバージョンに切り替える。途中で失敗・強制終了しても元に戻せること。
//
// 戻し方の考え方：書き替える前に「今の中身」をバージョン（変えられない控え）として作り、その番号を
// スクリプトのプロパティ（次に開いたときも読める場所）に残す。戻すときは、その控えの中身とデプロイ先に戻す。

const APP_ID = 'todo-update-poc';
const APP_VERSION = '0.0.2';
const APP_SEQ = 2; // 版の通し番号。これより大きい版にしか更新しない（古い版の出し直しを防ぐ）
// 配布リポ（公開）。latest.json と、その署名 latest.json.sig を置く
const RELEASE_BASE = 'https://raw.githubusercontent.com/shin672253/todo-app-releases/main/poc/';
// 署名を確かめる公開鍵（Ed25519、base64）。秘密鍵はここには無い
const RELEASE_PUBLIC_KEY = '7l6ttXj+yihEVYhJTAc7zJEx59I5I6ISQuYy7jz6E6E='; // 検証用の鍵（本番では別の鍵にする）
const STATE_KEY = 'UPD_STATE';
const API = 'https://script.googleapis.com/v1/projects/';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('検証用_画面').setTitle('更新の検証 v' + APP_VERSION);
}

// 画面から呼ぶ：今の版と、途中で止まった更新があるか
function updateInfo() {
  return { version: APP_VERSION, seq: APP_SEQ, pending: readState_() };
}

// 最初に1回、デプロイ（Web アプリと API 実行可能）を作ったあとでエディタから実行する：
// 持ち主と、切り替えるデプロイ（バージョンを指しているもの全部）を覚える
function setupUpdate() {
  const me = Session.getEffectiveUser().getEmail();
  if (!me) throw new Error('持ち主のメールが分かりません');
  const list = api_('get', ScriptApp.getScriptId() + '/deployments').deployments || [];
  // 「最新のコード」を指すテスト用のデプロイ（versionNumber が無い）は切り替えない
  const ids = list.filter(function (d) { return d.deploymentConfig && d.deploymentConfig.versionNumber; }).map(function (d) { return d.deploymentId; });
  if (!ids.length) throw new Error('切り替えるデプロイがありません。先に「デプロイ」→「新しいデプロイ」で Web アプリと API 実行可能を作ってください。');
  PropertiesService.getScriptProperties().setProperties({ UPD_OWNER: me, UPD_DEPLOYMENTS: JSON.stringify(ids) });
  Logger.log('準備できました。持ち主：' + me + '、切り替えるデプロイ：' + ids.length + '個');
  return { owner: me, deployments: ids };
}

// 新しい版があるかだけを見る（書き替えない）
function checkUpdate() {
  ownerOnly_();
  const m = fetchManifest_();
  return { current: APP_VERSION, latest: m.version, newer: m.seq > APP_SEQ };
}

// ⟳ 更新：新しい版に書き替えて、2つのデプロイを切り替える
function selfUpdate() {
  ownerOnly_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('ほかの更新が動いています。少し待ってからもう一度押してください。');
  try {
    // 前の更新が途中で止まっていたら、元に戻すだけにする。いま動いているコードは途中の版かもしれないので、
    // ここでは更新の要否を決めない（開き直すと、戻した版のコードで判断できる）
    if (readState_()) {
      const r = rollback_('前の更新が途中で止まっていたので元に戻しました。ページを開き直してから、もう一度 ⟳ を押してください。');
      r.reload = true;
      return r;
    }
    const m = fetchManifest_();
    if (m.seq <= APP_SEQ) return { updated: false, message: 'もう最新です（v' + APP_VERSION + '）' };
    if (m.minSeq && APP_SEQ < m.minSeq) throw new Error('この版からは直接更新できません。手で貼り替えてください。');
    const files = fetchFiles_(m);
    return applyUpdate_(m, files);
  } finally {
    lock.releaseLock();
  }
}

// 戻す：途中で止まった更新を元に戻す。エディタからも実行できる
function recoverUpdate() {
  ownerOnly_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('ほかの更新が動いています');
  try {
    if (!readState_()) return { recovered: false, message: '戻すものはありません' };
    return rollback_('元に戻しました');
  } finally {
    lock.releaseLock();
  }
}

// ---- 中身 ----

function applyUpdate_(m, files) {
  const sid = ScriptApp.getScriptId();
  const managed = managedDeployments_();
  // 1. 今の中身を控えのバージョンにし、各デプロイの今のバージョンを覚える（ここまで何も変えていない）
  const backup = api_('post', sid + '/versions', { description: '更新前の控え v' + APP_VERSION + ' → v' + m.version });
  const before = managed.map(function (id) {
    const d = api_('get', sid + '/deployments/' + id);
    return { id: id, versionNumber: d.deploymentConfig.versionNumber || null, description: d.deploymentConfig.description || '' };
  });
  const state = { stage: 'backed-up', at: new Date().toISOString(), from: APP_VERSION, to: m.version, backupVersion: backup.versionNumber, before: before, switched: [] };
  writeState_(state);
  try {
    // 2. 中身を全部置き換える（updateContent はプロジェクト全体の置き換え。latest.json に全ファイルが入っている）
    stage_(state, 'content');
    api_('put', sid + '/content', { files: files });
    // 3. 新しいバージョンを作る
    stage_(state, 'version');
    const v = api_('post', sid + '/versions', { description: 'v' + m.version });
    state.newVersion = v.versionNumber;
    writeState_(state);
    // 4. 2つのデプロイを1つずつ切り替える（一度には切り替わらない。切り替えたものを覚えておく）
    stage_(state, 'deploy');
    before.forEach(function (b) {
      api_('put', sid + '/deployments/' + b.id, { deploymentConfig: { scriptId: sid, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'v' + m.version } });
      state.switched.push(b.id);
      writeState_(state);
    });
    // 5. 確かめる：各デプロイが新しいバージョンを指し、そのバージョンの中身が latest.json のハッシュ値と合う
    stage_(state, 'verify');
    before.forEach(function (b) {
      const d = api_('get', sid + '/deployments/' + b.id);
      if (d.deploymentConfig.versionNumber !== v.versionNumber) throw new Error('デプロイが切り替わっていません：' + b.id);
    });
    const got = api_('get', sid + '/content?versionNumber=' + v.versionNumber);
    checkSameFiles_(files, got.files || []);
    clearState_();
    return { updated: true, message: 'v' + m.version + ' に更新しました', version: m.version };
  } catch (e) {
    const r = rollback_('更新できなかったので元に戻しました');
    r.error = String(e && e.message || e);
    return r;
  }
}

// 控えの中身とデプロイ先に戻す。応答が途切れたときのため、今の状態を読み直してから直す
function rollback_(message) {
  const s = readState_();
  if (!s) return { recovered: false, message: '戻すものはありません' };
  const sid = ScriptApp.getScriptId();
  const errors = [];
  // デプロイ：控えのときのバージョンに戻す（切り替わっていないものはそのまま）
  (s.before || []).forEach(function (b) {
    try {
      const d = api_('get', sid + '/deployments/' + b.id);
      if (b.versionNumber && d.deploymentConfig.versionNumber !== b.versionNumber) {
        api_('put', sid + '/deployments/' + b.id, { deploymentConfig: { scriptId: sid, versionNumber: b.versionNumber, manifestFileName: 'appsscript', description: b.description } });
      }
    } catch (e) { errors.push(b.id + '：' + (e && e.message || e)); }
  });
  // 中身：控えのバージョンの中身に戻す（書き替える前なら何もしない）
  if (s.stage !== 'backed-up') {
    try {
      const old = api_('get', sid + '/content?versionNumber=' + s.backupVersion);
      api_('put', sid + '/content', { files: (old.files || []).map(fileOf_) });
    } catch (e) { errors.push('中身：' + (e && e.message || e)); }
  }
  if (errors.length) {
    // 戻しきれなかったら、状態を残しておく（もう一度「戻す」を押せる）
    s.rollbackErrors = errors;
    writeState_(s);
    throw new Error('元に戻しきれませんでした。もう一度「戻す」を押すか、エディタの「デプロイを管理」でバージョン ' + s.backupVersion + ' を選んでください。\n' + errors.join('\n'));
  }
  clearState_();
  return { recovered: true, message: message, backupVersion: s.backupVersion };
}

function fetchManifest_() {
  const body = fetchBytes_(RELEASE_BASE + 'latest.json');
  const sigText = bytesToString_(fetchBytes_(RELEASE_BASE + 'latest.json.sig')).trim();
  // 署名は、取得した latest.json のバイト列そのものに対して確かめる（読み直して作り直さない）
  if (!verifySignature_(body, sigText, RELEASE_PUBLIC_KEY)) throw new Error('配布物の署名が合いません。更新を中止しました。');
  const m = JSON.parse(bytesToString_(body));
  if (m.app !== APP_ID) throw new Error('別のアプリの配布物です。更新を中止しました。');
  if (typeof m.seq !== 'number' || !Array.isArray(m.files) || !m.files.length) throw new Error('配布物の中身が読めません。更新を中止しました。');
  return m;
}

// latest.json の各ファイルを取り、ハッシュ値が合うか確かめる。updateContent に渡す形にする
function fetchFiles_(m) {
  const names = {};
  m.files.forEach(function (f) { names[f.name] = (names[f.name] || 0) + 1; });
  if (!names.appsscript) throw new Error('appsscript.json が入っていません');
  return m.files.map(function (f) {
    if (!/^https:\/\/raw\.githubusercontent\.com\/shin672253\/todo-app-releases\//.test(f.url)) throw new Error('配布リポ以外のURLです：' + f.url);
    if (['SERVER_JS', 'HTML', 'JSON'].indexOf(f.type) < 0) throw new Error('知らない種類のファイルです：' + f.type);
    if (names[f.name] > 1) throw new Error('同じ名前のファイルが2つあります：' + f.name);
    const bytes = fetchBytes_(f.url);
    if (sha256Hex_(bytes) !== String(f.sha256).toLowerCase()) throw new Error('ファイルが壊れているか、書き替えられています：' + f.name);
    return { name: f.name, type: f.type, source: bytesToString_(bytes) };
  });
}

function checkSameFiles_(want, got) {
  const byName = {};
  got.forEach(function (f) { byName[f.name] = f; });
  want.forEach(function (f) {
    const g = byName[f.name];
    if (!g || g.type !== f.type) throw new Error('書き替えたあとのファイルが足りません：' + f.name);
    // appsscript.json は Google 側で並べ直されることがあるので、中身の意味で比べる
    if (f.type === 'JSON' ? canonical_(JSON.parse(g.source)) !== canonical_(JSON.parse(f.source)) : g.source !== f.source) {
      throw new Error('書き替えたあとの中身が違います：' + f.name);
    }
  });
  if (got.length !== want.length) throw new Error('書き替えたあとのファイルの数が違います');
}

// キーの順番によらない JSON の文字列（配列の順番はそのまま）
function canonical_(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical_(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}

function fileOf_(f) { return { name: f.name, type: f.type, source: f.source }; }

function ownerOnly_() {
  const owner = PropertiesService.getScriptProperties().getProperty('UPD_OWNER');
  const me = Session.getActiveUser().getEmail();
  if (!owner) throw new Error('まだ準備ができていません。エディタから setupUpdate を実行してください。');
  if (!me || me !== owner) throw new Error('更新できるのは持ち主だけです');
}

function managedDeployments_() {
  const ids = JSON.parse(PropertiesService.getScriptProperties().getProperty('UPD_DEPLOYMENTS') || '[]');
  if (!ids.length) throw new Error('切り替えるデプロイが決まっていません。setupUpdate を実行してください。');
  return ids;
}

function stage_(s, name) { s.stage = name; s.at = new Date().toISOString(); writeState_(s); }
function readState_() { const v = PropertiesService.getScriptProperties().getProperty(STATE_KEY); return v ? JSON.parse(v) : null; }
function writeState_(s) { PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(s)); }
function clearState_() { PropertiesService.getScriptProperties().deleteProperty(STATE_KEY); }

function api_(method, path, body) {
  const opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(API + path, opt);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('Apps Script API ' + method.toUpperCase() + ' ' + path.split('?')[0] + '：' + code + ' ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

function fetchBytes_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('配布物を取れません（' + res.getResponseCode() + '）：' + url);
  return res.getContent();
}

// Java のバイト（-128〜127）を 0〜255 に直す
function u8_(bytes) { const a = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i++) a[i] = bytes[i] & 255; return a; }

function verifySignature_(bodyBytes, sigBase64, pubBase64) {
  try {
    const sig = u8_(Utilities.base64Decode(sigBase64));
    const pub = u8_(Utilities.base64Decode(pubBase64));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return TweetNaCl_.sign.detached.verify(u8_(bodyBytes), sig, pub);
  } catch (e) {
    return false; // 確かめられないときは通さない
  }
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function bytesToString_(bytes) { return Utilities.newBlob(bytes).getDataAsString('UTF-8'); }
