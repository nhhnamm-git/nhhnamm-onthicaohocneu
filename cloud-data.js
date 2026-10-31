/* ============================================================================
   cloud-data.js — ĐỒNG BỘ DỮ LIỆU HỌC TẬP LÊN FIRESTORE
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng CUỐI <body> của index.html (sau forest.js):
       <script src="cloud-data.js"></script>
   Không sửa file nào khác.

   ĐỒNG BỘ NHỮNG GÌ (localStorage "examMasterPro_*"  <->  Firestore)
     history        Lịch sử làm bài
     partScores     Điểm từng phần (best / last / attempts)
     wrongBank      Câu sai
     starBank       Câu yêu thích / câu khó
     correctBank    Câu đã làm đúng lần đầu
     dailyLog       Nhật ký ngày (heatmap, streak, mục tiêu ngày)
     studyTimeSec   Tổng thời gian học
     sessionsCount  Số phiên học
     lastSession    Phiên học gần nhất
   Lưu tại: users/{uid}/appData/{tên}   (mỗi loại 1 document, field "json")

   CƠ CHẾ
   - Mọi thay đổi (qua StorageManager.set) được đánh dấu "dirty" rồi tự đẩy lên
     sau ~1,5 giây (gộp nhiều thay đổi). Dirty được lưu trong localStorage nên
     không mất khi tải lại trang; mất mạng thì tự thử lại khi có mạng.
   - Lắng nghe realtime: học trên máy A, máy B cập nhật ngay không cần tải lại.
   - Ghi bằng TRANSACTION: nếu thiết bị khác đã ghi trước, dữ liệu được GỘP
     (không ghi đè mất dữ liệu): lịch sử = hợp nhất theo bản ghi, điểm = lấy cao
     nhất, nhật ký ngày / thời gian học = lấy lớn nhất, câu sai/yêu thích = hợp.
   - Lần đầu đăng nhập trên 1 thiết bị: dữ liệu cũ trong trình duyệt được GỘP với
     dữ liệu trên cloud rồi đẩy lên — không mất dữ liệu đã học trước đây.
   - Dùng chung 1 trình duyệt cho nhiều tài khoản: dữ liệu cục bộ của tài khoản
     trước bị xoá khỏi máy khi tài khoản khác đăng nhập (không trộn lẫn / lộ).
   - Nút "Reset dữ liệu" giờ xoá cả trên cloud, nhưng GIỮ 1 BẢN SAO LƯU; có nút
     "Khôi phục bản sao lưu" trong Cài đặt nếu bấm nhầm.
   - Thêm biểu tượng đám mây trên topbar (trạng thái đồng bộ, bấm để đồng bộ ngay)
     và thẻ "Đồng bộ đám mây" trong Cài đặt.

   ‼️ CẦN THÊM 1 RULE VÀO FIRESTORE (trong khối match /databases/.../documents):
     match /users/{uid}/appData/{docId} {
       allow read, write: if isAllowed() && request.auth.uid == uid;
     }
   (Chưa thêm thì app vẫn chạy bình thường bằng localStorage, và hiện cảnh báo
    "Thiếu quyền Firestore" ở biểu tượng đám mây.)

   API: CloudData.syncNow() · CloudData.restoreBackup() · CloudData.status()
   ========================================================================== */
(function () {
  'use strict';
  if (window.CloudData) return;
  if (typeof StorageManager === 'undefined' || typeof BankManager === 'undefined') {
    console.warn('[CloudData] Không tìm thấy StorageManager/BankManager — hãy đặt script SAU các script của index.html.');
    return;
  }

  /* ---------- hằng số ---------- */
  var K = StorageManager.KEYS;
  var META_KEY = 'examMasterPro_cloudMeta_v1';
  var DEVICE_KEY = 'examMasterPro_deviceId';
  var PUSH_DELAY = 1500, RETRY_MS = 30000, MAX_HISTORY = 2000, MAX_DOC_CHARS = 850000;

  /* ---------- tiện ích ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var isObj = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };
  var tms = function (s) { var t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };
  function DB() { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; }
  function AU() { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; }
  function UIM() { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return null; }
  function toast(type, title, msg) { var u = UIM(); if (u && u.toast) u.toast(type, title, msg || ''); }
  function FV() { return firebase.firestore.FieldValue; }
  function lsRaw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var DEVICE = lsRaw(DEVICE_KEY);
  if (!DEVICE) { DEVICE = 'd' + Math.random().toString(36).slice(2, 10); try { localStorage.setItem(DEVICE_KEY, DEVICE); } catch (e) { } }

  /* ==========================================================================
     1) HÀM GỘP DỮ LIỆU (idempotent: gộp nhiều lần ra cùng kết quả)
     ======================================================================== */
  function mergeHistory(a, b) {
    var m = new Map();
    [].concat(Array.isArray(b) ? b : [], Array.isArray(a) ? a : []).forEach(function (h) {
      if (!h) return;
      var key = (h.timestamp || '') + '|' + (h.partName || '') + '|' + h.score + '|' + h.timeSec;
      if (!m.has(key)) m.set(key, h);
    });
    return Array.from(m.values()).sort(function (x, y) { return tms(y.timestamp) - tms(x.timestamp); }).slice(0, MAX_HISTORY);
  }
  function mergeWrong(a, b) {
    var out = {}; a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (id) {
      var x = a[id], y = b[id];
      if (x && y) out[id] = Object.assign({}, x, y, { count: Math.max(x.count || 0, y.count || 0), lastDate: tms(x.lastDate) >= tms(y.lastDate) ? x.lastDate : y.lastDate });
      else out[id] = x || y;
    });
    return out;
  }
  function mergeUnion(a, b) { return Object.assign({}, isObj(b) ? b : {}, isObj(a) ? a : {}); }
  function mergeScores(a, b) {
    var out = {}; a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (id) {
      var x = a[id], y = b[id];
      if (x && y) {
        var latest = tms(x.date) >= tms(y.date) ? x : y;
        out[id] = { best: Math.max(x.best || 0, y.best || 0), last: latest.last, attempts: Math.max(x.attempts || 0, y.attempts || 0), date: latest.date };
      } else out[id] = x || y;
    });
    return out;
  }
  function mergeDaily(a, b) {
    var out = {}; a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (d) {
      var x = a[d] || {}, y = b[d] || {};
      out[d] = { count: Math.max(x.count || 0, y.count || 0), correct: Math.max(x.correct || 0, y.correct || 0), wrong: Math.max(x.wrong || 0, y.wrong || 0), timeSec: Math.max(x.timeSec || 0, y.timeSec || 0) };
    });
    return out;
  }
  function mergeMax(a, b) { return Math.max(Number(a) || 0, Number(b) || 0); }
  function mergeLatest(a, b) { return tms(a) >= tms(b) ? a : b; }

  var SYNC = {
    history: { ls: K.HISTORY, def: [], merge: mergeHistory },
    partScores: { ls: K.PART_SCORES, def: {}, merge: mergeScores },
    wrongBank: { ls: K.WRONG_BANK, def: {}, merge: mergeWrong },
    starBank: { ls: K.STAR_BANK, def: {}, merge: mergeUnion },
    correctBank: { ls: K.CORRECT_BANK, def: {}, merge: mergeUnion },
    dailyLog: { ls: K.DAILY_LOG, def: {}, merge: mergeDaily },
    studyTimeSec: { ls: K.STUDY_TIME, def: 0, merge: mergeMax },
    sessionsCount: { ls: K.SESSIONS_COUNT, def: 0, merge: mergeMax },
    lastSession: { ls: K.LAST_SESSION, def: null, merge: mergeLatest }
  };
  var NAME_BY_LS = {}; Object.keys(SYNC).forEach(function (n) { NAME_BY_LS[SYNC[n].ls] = n; });
  var NAMES = Object.keys(SYNC);

  /* ==========================================================================
     2) STATE + META (lưu trong localStorage để sống qua lần tải lại trang)
     ======================================================================== */
  var meta = (function () {
    try { var m = JSON.parse(lsRaw(META_KEY) || 'null'); if (m && typeof m === 'object') return { owner: m.owner || null, synced: m.synced || {}, dirty: m.dirty || {} }; } catch (e) { }
    return { owner: null, synced: {}, dirty: {} };
  })();
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { } }

  var S = { uid: null, started: false, firstDone: false, unsub: null, pushing: false, ver: {}, pushT: null, rt: null, status: 'idle', msg: '', lastSync: 0, needRefresh: false };

  var origSet = StorageManager.set; // bản gốc: ghi mà KHÔNG đánh dấu dirty
  var col = function () { return DB().collection('users').doc(S.uid).collection('appData'); };
  function readLocal(cfg) { return StorageManager.get(cfg.ls, cfg.def); }
  function hasLocal(cfg) { return lsRaw(cfg.ls) !== null; }
  function parse(json, def) { try { return JSON.parse(json); } catch (e) { return def; } }

  /* ==========================================================================
     3) ĐÁNH DẤU DIRTY — bọc StorageManager.set (không sửa code gốc)
     ======================================================================== */
  function markDirty(name) {
    meta.dirty[name] = 1; S.ver[name] = (S.ver[name] || 0) + 1; saveMeta();
    if (S.started) { setStatus('pending'); schedulePush(); }
  }
  StorageManager.set = function (key, val) {
    var ok = origSet.call(StorageManager, key, val);
    if (ok && NAME_BY_LS[key]) markDirty(NAME_BY_LS[key]);
    return ok;
  };

  /* ==========================================================================
     4) TRẠNG THÁI + GIAO DIỆN (biểu tượng topbar + thẻ trong Cài đặt)
     ======================================================================== */
  var STATUS_UI = {
    idle: ['fa-cloud', 'Chưa đồng bộ'], syncing: ['fa-cloud-arrow-up fa-beat', 'Đang đồng bộ...'], pending: ['fa-cloud-arrow-up', 'Có thay đổi chưa đồng bộ'],
    ok: ['fa-cloud-check', 'Đã đồng bộ'], offline: ['fa-cloud-bolt', 'Offline — sẽ đồng bộ khi có mạng'], error: ['fa-triangle-exclamation', 'Lỗi đồng bộ'],
    perm: ['fa-triangle-exclamation', 'Thiếu quyền Firestore']
  };
  function setStatus(st, msg) {
    S.status = st; S.msg = msg || '';
    var u = STATUS_UI[st] || STATUS_UI.idle, label = u[1];
    if (st === 'ok' && S.lastSync) label = 'Đã đồng bộ lúc ' + new Date(S.lastSync).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (st === 'perm') label = 'Thiếu quyền Firestore: hãy thêm rule users/{uid}/appData (xem đầu file cloud-data.js) rồi tải lại trang';
    if (st === 'error' && msg) label += ': ' + msg;
    var btn = $('#cdSyncBtn');
    if (btn) {
      btn.setAttribute('data-tip', st === 'perm' ? 'Thiếu quyền Firestore (xem Cài đặt)' : label);
      btn.style.color = (st === 'error' || st === 'perm') ? 'var(--danger)' : (st === 'ok' ? 'var(--success)' : '');
      var i = btn.querySelector('i'); if (i) i.className = 'fa-solid ' + u[0];
    }
    var t = $('#cdStatusText'); if (t) t.textContent = label;
  }
  function injectUI() {
    var right = $('.topbar-right');
    if (right && !$('#cdSyncBtn')) {
      var b = document.createElement('button'); b.className = 'icon-btn'; b.id = 'cdSyncBtn'; b.innerHTML = '<i class="fa-solid fa-cloud"></i>';
      var dark = $('#darkToggleBtn'); if (dark && dark.parentNode === right) right.insertBefore(b, dark); else right.insertBefore(b, right.firstChild);
      b.addEventListener('click', function () { syncNow(true); });
    }
    var grid = $('#view-settings .settings-grid');
    if (grid && !$('#cdCard')) {
      var c = document.createElement('div'); c.className = 'card settings-card'; c.id = 'cdCard';
      c.innerHTML = '<h4><i class="fa-solid fa-cloud"></i> Đồng bộ đám mây</h4>' +
        '<p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;line-height:1.55">Lịch sử, điểm, câu sai, câu yêu thích và nhật ký học được lưu theo tài khoản Google — đổi máy hay xoá cache vẫn còn.</p>' +
        '<p id="cdStatusText" style="font-size:13px;font-weight:700;margin-bottom:12px"></p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="cdSyncNowBtn"><i class="fa-solid fa-rotate"></i> Đồng bộ ngay</button>' +
        '<button class="btn btn-outline btn-sm" id="cdRestoreBtn"><i class="fa-solid fa-clock-rotate-left"></i> Khôi phục bản sao lưu</button></div>';
      grid.appendChild(c);
      $('#cdSyncNowBtn').addEventListener('click', function () { syncNow(true); });
      $('#cdRestoreBtn').addEventListener('click', function () {
        var u = UIM(); var run = function () { restoreBackup(); };
        if (u && u.confirm) u.confirm('Khôi phục bản sao lưu?', 'Dữ liệu học trước lần Reset gần nhất sẽ được gộp lại vào tài khoản của bạn.', run); else if (confirm('Khôi phục bản sao lưu gần nhất?')) run();
      });
    }
    setStatus(S.status, S.msg);
  }

  /* làm mới màn hình đang mở sau khi dữ liệu thay đổi từ cloud */
  function refreshUI() {
    clearTimeout(S.rt);
    S.rt = setTimeout(function () {
      S.needRefresh = false;
      try {
        var w = $('#badgeWrong'); if (w) w.textContent = Object.keys(BankManager.getWrong()).length;
        var s = $('#badgeStar'); if (s) s.textContent = Object.keys(BankManager.getStar()).length;
        var act = $('.view.active'), id = act ? act.id.replace('view-', '') : '';
        if (id === 'dashboard' && typeof DashboardUI !== 'undefined') DashboardUI.render();
        else if (id === 'parts' && typeof PartsUI !== 'undefined') PartsUI.render();
        else if (id === 'history') HistoryManager.render();
        else if (id === 'statistics' && typeof StatUI !== 'undefined') StatUI.render();
        else if (id === 'reviewWrong' && typeof ReviewUI !== 'undefined') ReviewUI.renderWrongList();
        else if (id === 'reviewStar' && typeof ReviewUI !== 'undefined') ReviewUI.renderStarList();
      } catch (e) { console.warn('[CloudData] refreshUI', e); }
    }, 300);
  }

  /* ==========================================================================
     5) NHẬN DỮ LIỆU TỪ CLOUD
     ======================================================================== */
  function reconcile(name, d) {
    var cfg = SYNC[name], cu = d.updatedAt || 0;
    if (meta.synced[name] !== undefined && cu <= meta.synced[name]) return; // đã có phiên bản này (gồm cả bản do chính mình vừa ghi)
    var cloud = parse(d.json, cfg.def), first = meta.synced[name] === undefined;
    var result = (first || meta.dirty[name]) && hasLocal(cfg) ? cfg.merge(readLocal(cfg), cloud) : cloud;
    var changed = JSON.stringify(result) !== JSON.stringify(readLocal(cfg));
    origSet.call(StorageManager, cfg.ls, result);
    meta.synced[name] = cu;
    if (JSON.stringify(result) === JSON.stringify(cloud)) delete meta.dirty[name]; else meta.dirty[name] = 1;
    saveMeta();
    if (changed) { S.needRefresh = true; if (!first || S.firstDone) S.remoteChanged = true; }
  }

  /* ==========================================================================
     6) ĐẨY DỮ LIỆU LÊN CLOUD (transaction + gộp)
     ======================================================================== */
  function fit(value) {
    if (!Array.isArray(value)) return value;
    var v = value;
    while (JSON.stringify(v).length > MAX_DOC_CHARS && v.length > 50) v = v.slice(0, Math.floor(v.length * 0.8));
    return v;
  }
  async function pushOne(name) {
    var cfg = SYNC[name], ref = col().doc(name), merged = false, value, updatedAt;
    await DB().runTransaction(async function (tx) {
      merged = false;
      var snap = await tx.get(ref), prev = 0;
      value = readLocal(cfg);
      if (snap.exists) {
        var d = snap.data(); prev = d.updatedAt || 0;
        if (prev > (meta.synced[name] || 0)) { value = cfg.merge(value, parse(d.json, cfg.def)); merged = true; } // thiết bị khác đã ghi trước → gộp
      }
      value = fit(value);
      updatedAt = Math.max(Date.now(), prev + 1);
      tx.set(ref, { name: name, json: JSON.stringify(value), updatedAt: updatedAt, serverAt: FV().serverTimestamp(), device: DEVICE, schema: 1 });
    });
    return { merged: merged, value: value, updatedAt: updatedAt };
  }
  function schedulePush() { clearTimeout(S.pushT); S.pushT = setTimeout(pushAll, PUSH_DELAY); }
  function handleErr(e) {
    console.warn('[CloudData]', e);
    if (e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''))) setStatus('perm');
    else if (!navigator.onLine) setStatus('offline');
    else setStatus('error', (e && e.message ? e.message : '').slice(0, 80));
  }
  async function pushAll() {
    if (!S.started || S.pushing) return;
    var names = Object.keys(meta.dirty).filter(function (n) { return SYNC[n]; });
    if (!names.length) { if (S.status !== 'perm' && S.status !== 'error') setStatus('ok'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    S.pushing = true; setStatus('syncing');
    var failed = false;
    for (var i = 0; i < names.length; i++) {
      var name = names[i], ver = S.ver[name] || 0;
      try {
        var r = await pushOne(name);
        meta.synced[name] = r.updatedAt;
        if ((S.ver[name] || 0) === ver) delete meta.dirty[name];
        if (r.merged) { origSet.call(StorageManager, SYNC[name].ls, SYNC[name].merge(readLocal(SYNC[name]), r.value)); S.needRefresh = true; }
      } catch (e) { failed = true; handleErr(e); break; }
    }
    saveMeta(); S.pushing = false;
    if (S.needRefresh) refreshUI();
    if (failed) return;
    if (Object.keys(meta.dirty).length) schedulePush();
    else { S.lastSync = Date.now(); setStatus('ok'); }
  }
  function syncNow(manual) {
    if (!S.started) { if (manual) toast('warn', 'Đồng bộ', 'Chưa đăng nhập hoặc chưa sẵn sàng'); return Promise.resolve(); }
    NAMES.forEach(function (n) { if (hasLocal(SYNC[n])) { meta.dirty[n] = 1; S.ver[n] = (S.ver[n] || 0) + 1; } });
    saveMeta(); clearTimeout(S.pushT);
    return pushAll().then(function () { if (manual && S.status === 'ok') toast('success', 'Đã đồng bộ', 'Dữ liệu học đã được lưu lên đám mây'); });
  }

  /* ==========================================================================
     7) BACKUP / RESET / KHÔI PHỤC
     ======================================================================== */
  async function backupAndClear() {
    await pushAll(); // đảm bảo bản sao lưu chứa dữ liệu mới nhất
    var snap = await col().get(), batch = DB().batch();
    snap.docs.forEach(function (d) {
      if (d.id.indexOf('_bk_') === 0) return;
      batch.set(col().doc('_bk_' + d.id), Object.assign({}, d.data(), { backedUpAt: Date.now() }));
      batch.delete(d.ref);
    });
    await batch.commit();
  }
  async function restoreBackup() {
    if (!S.started) return toast('warn', 'Khôi phục', 'Chưa đăng nhập hoặc chưa sẵn sàng');
    try {
      var snap = await col().get(), bks = snap.docs.filter(function (d) { return d.id.indexOf('_bk_') === 0 && SYNC[d.id.slice(4)]; });
      if (!bks.length) return toast('warn', 'Không có bản sao lưu', 'Chưa có lần Reset nào được sao lưu');
      var batch = DB().batch(), now = Date.now();
      bks.forEach(function (d) { var n = d.id.slice(4); batch.set(col().doc(n), { name: n, json: d.data().json, updatedAt: now, serverAt: FV().serverTimestamp(), device: DEVICE, schema: 1 }); });
      await batch.commit();
      toast('success', 'Đã khôi phục', 'Dữ liệu học từ bản sao lưu đang được nạp lại');
    } catch (e) { toast('error', 'Khôi phục thất bại', e.message); handleErr(e); }
  }
  // Thay thế hộp thoại Reset gốc: xoá cả cloud (có sao lưu) rồi mới xoá local và tải lại
  if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.confirmReset === 'function') {
    var origConfirmReset = SettingsUI.confirmReset.bind(SettingsUI);
    SettingsUI.confirmReset = function () {
      var u = UIM();
      if (!S.started || !u || !u.confirm) return origConfirmReset();
      u.confirm('Reset toàn bộ dữ liệu?', 'Xoá điểm số, lịch sử, câu sai, câu yêu thích trên TẤT CẢ thiết bị (kể cả đám mây). Hệ thống giữ 1 bản sao lưu — bạn có thể khôi phục trong Cài đặt → Đồng bộ đám mây.', async function () {
        try { clearTimeout(S.pushT); await backupAndClear(); }
        catch (e) { handleErr(e); return toast('error', 'Không reset được', 'Không xoá được dữ liệu trên đám mây: ' + (e.message || '') + '. Dữ liệu chưa bị xoá.'); }
        var qb = QuestionManager.all;
        StorageManager.clearAllAppData();
        origSet.call(StorageManager, K.QUESTIONS, qb);
        meta.synced = {}; meta.dirty = {}; saveMeta();
        location.reload();
      });
    };
  }

  /* ==========================================================================
     8) VÒNG ĐỜI: bắt đầu sau đăng nhập, dừng khi đăng xuất
     ======================================================================== */
  function wipeLocal() {
    NAMES.forEach(function (n) { try { localStorage.removeItem(SYNC[n].ls); } catch (e) { } });
    try { localStorage.removeItem(K.PROGRESS); } catch (e) { }
  }
  function start(user) {
    S.uid = user.uid; S.started = true; S.firstDone = false; S.remoteChanged = false;
    injectUI();
    if (meta.owner && meta.owner !== user.uid) { // trình duyệt đang giữ dữ liệu của tài khoản KHÁC
      wipeLocal(); meta = { owner: user.uid, synced: {}, dirty: {} }; S.ver = {}; S.needRefresh = true;
    } else if (!meta.owner) meta.owner = user.uid; // dữ liệu cũ trước khi có tính năng này → coi là của tài khoản hiện tại
    saveMeta(); setStatus('syncing');
    S.unsub = col().onSnapshot(function (snap) {
      snap.docChanges().forEach(function (c) { if (c.type !== 'removed' && SYNC[c.doc.id]) reconcile(c.doc.id, c.doc.data()); });
      if (!S.firstDone) {
        S.firstDone = true;
        var have = {}; snap.docs.forEach(function (d) { have[d.id] = 1; });
        NAMES.forEach(function (n) { if (!have[n] && hasLocal(SYNC[n]) && meta.synced[n] === undefined) { meta.dirty[n] = 1; S.ver[n] = (S.ver[n] || 0) + 1; } });
        saveMeta();
        if (S.needRefresh) toast('success', 'Đã đồng bộ dữ liệu học', 'Dữ liệu từ đám mây đã được nạp vào thiết bị này');
      } else if (S.remoteChanged) { S.remoteChanged = false; }
      if (S.needRefresh) refreshUI();
      schedulePush();
      if (!Object.keys(meta.dirty).length && S.status !== 'perm') { S.lastSync = S.lastSync || Date.now(); setStatus('ok'); }
    }, function (err) { handleErr(err); });
  }
  function stop() {
    if (S.unsub) { try { S.unsub(); } catch (e) { } S.unsub = null; }
    clearTimeout(S.pushT); S.started = false; S.uid = null; setStatus('idle');
  }
  function boot() {
    var a = AU(), ok = !!(window.__appInitialized && a && a.currentUser && DB());
    injectUI();
    if (ok && (!S.started || S.uid !== a.currentUser.uid)) { if (S.started) stop(); start(a.currentUser); }
    else if (!ok && S.started) stop();
  }
  setInterval(boot, 1000); boot();

  // thử lại khi có mạng + định kỳ khi còn dữ liệu chưa đẩy
  window.addEventListener('online', function () { if (S.started) schedulePush(); });
  window.addEventListener('offline', function () { if (S.started && Object.keys(meta.dirty).length) setStatus('offline'); });
  setInterval(function () { if (S.started && Object.keys(meta.dirty).length && !S.pushing) schedulePush(); }, RETRY_MS);
  // cố gắng đẩy trước khi rời trang / ẩn tab (dirty vẫn được giữ trong localStorage nếu chưa kịp)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.started && Object.keys(meta.dirty).length) pushAll(); });
  window.addEventListener('pagehide', function () { if (S.started && Object.keys(meta.dirty).length) pushAll(); });

  // Đăng xuất: đẩy nốt dữ liệu chưa đồng bộ (tối đa 3 giây) rồi mới đăng xuất
  try {
    if (typeof AuthManager !== 'undefined' && AuthManager && typeof AuthManager.doSignOut === 'function' && !AuthManager.__cdWrapped) {
      AuthManager.__cdWrapped = true;
      var prevSignOut = AuthManager.doSignOut.bind(AuthManager);
      AuthManager.doSignOut = async function () {
        try { await Promise.race([pushAll(), new Promise(function (r) { setTimeout(r, 3000); })]); } catch (e) { }
        stop();
        return prevSignOut();
      };
    }
  } catch (e) { }
  try {
    if (typeof CloudSync !== 'undefined' && CloudSync && !CloudSync.__cdWrapped) {
      CloudSync.__cdWrapped = true;
      var prevTeardown = CloudSync.teardown.bind(CloudSync);
      CloudSync.teardown = function () { stop(); return prevTeardown(); };
    }
  } catch (e) { }

  window.CloudData = {
    syncNow: function () { return syncNow(true); },
    restoreBackup: restoreBackup,
    status: function () { return { status: S.status, dirty: Object.keys(meta.dirty), lastSync: S.lastSync, uid: S.uid }; }
  };
})();

/* ============================================================================
   cloud-data-addon — BỔ SUNG ICON + TOOLTIP + CHỜ ĐỒNG BỘ TRƯỚC ĐĂNG XUẤT
   ----------------------------------------------------------------------------
   Phần bổ sung độc lập. Không sửa/xóa logic cũ, không thay đổi Firebase/Rules.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__cloudDataVisualLogoutAddon) return;
  window.__cloudDataVisualLogoutAddon = true;

  var STYLE_ID = 'cd-sync-addon-style';
  var ICON = '<svg class="cd-sync-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.35 10.04A7.49 7.49 0 0 0 5.1 8.1 5.5 5.5 0 0 0 5.5 19h13a4.5 4.5 0 0 0 .85-8.96Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path class="cd-sync-arrow" d="M9 14.2a3.6 3.6 0 0 1 6.1-2.55M15.1 9.8v2.2h-2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#cdSyncBtn{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;visibility:visible!important;opacity:1!important;min-width:38px;min-height:38px;overflow:visible!important;color:var(--text-muted,#64748b);cursor:pointer}',
      '#cdSyncBtn .cd-sync-svg{display:block!important;width:20px!important;height:20px!important;flex:0 0 20px}',
      '#cdSyncBtn[data-cd-state="syncing"] .cd-sync-svg,#cdSyncBtn[data-cd-state="pending"] .cd-sync-svg{animation:cdSyncPulse 1.15s ease-in-out infinite}',
      '#cdSyncBtn[data-cd-state="ok"]{color:var(--success,#16a34a)!important}',
      '#cdSyncBtn[data-cd-state="error"],#cdSyncBtn[data-cd-state="perm"]{color:var(--danger,#dc2626)!important}',
      '#cdSyncBtn[data-cd-state="offline"]{color:var(--text-muted,#64748b)!important}',
      '#cdSyncBtn[data-tip]:hover:after,#cdSyncBtn[data-tip]:focus-visible:after{content:attr(data-tip);position:absolute;z-index:99999;top:calc(100% + 9px);right:0;min-width:150px;max-width:260px;width:max-content;padding:8px 11px;border-radius:8px;background:#172033;color:#fff;font:500 12px/1.45 system-ui,sans-serif;white-space:normal;text-align:center;box-shadow:0 5px 18px rgba(0,0,0,.2);pointer-events:none}',
      '#cdSyncBtn[data-tip]:hover:before,#cdSyncBtn[data-tip]:focus-visible:before{content:"";position:absolute;z-index:100000;top:calc(100% + 3px);right:13px;border:6px solid transparent;border-bottom-color:#172033;pointer-events:none}',
      '@keyframes cdSyncPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.9)}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function currentStatus() {
    try { return window.CloudData && typeof window.CloudData.status === 'function' ? window.CloudData.status() : null; }
    catch (e) { return null; }
  }

  function installIcon() {
    addStyle();
    var btn = document.getElementById('cdSyncBtn');
    var right = document.querySelector('.topbar-right');
    if (!btn && right) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'cdSyncBtn';
      btn.className = 'icon-btn';
      btn.addEventListener('click', function () {
        if (window.CloudData && typeof window.CloudData.syncNow === 'function') {
          btn.setAttribute('data-tip', 'Đang yêu cầu đồng bộ...');
          window.CloudData.syncNow().catch(function (e) { console.warn('[CloudData] Sync click:', e); });
        }
      });
      var dark = document.getElementById('darkToggleBtn');
      if (dark && dark.parentNode === right) right.insertBefore(btn, dark);
      else right.insertBefore(btn, right.firstChild);
    }
    if (!btn) return;

    // Thay icon Font Awesome bằng SVG độc lập, tránh mất icon khi phiên bản FA không hỗ trợ.
    if (!btn.querySelector('.cd-sync-svg')) btn.innerHTML = ICON;
    btn.setAttribute('aria-label', 'Trạng thái đồng bộ dữ liệu');
    btn.setAttribute('title', btn.getAttribute('data-tip') || 'Trạng thái đồng bộ dữ liệu');
    btn.style.display = 'inline-flex';
    btn.style.visibility = 'visible';
    btn.style.opacity = '1';

    var s = currentStatus();
    if (!s) return;
    var labels = {
      idle: 'Chưa đồng bộ',
      syncing: 'Đang đồng bộ dữ liệu...',
      pending: 'Có thay đổi chưa đồng bộ',
      ok: 'Đã đồng bộ thành công',
      offline: 'Đang ngoại tuyến — dữ liệu sẽ được đồng bộ khi có mạng',
      error: 'Đồng bộ gặp lỗi — rê chuột để xem trạng thái',
      perm: 'Không có quyền truy cập Firestore'
    };
    var label = labels[s.status] || 'Trạng thái đồng bộ';
    if (s.status === 'ok' && s.lastSync) {
      label = 'Đã đồng bộ lúc ' + new Date(s.lastSync).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    if (s.status === 'error') label += s.message ? ': ' + s.message : '';
    btn.setAttribute('data-cd-state', s.status || 'idle');
    btn.setAttribute('data-tip', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function flushBeforeLogout() {
    var api = window.CloudData;
    if (!api || typeof api.syncNow !== 'function' || typeof api.status !== 'function') return;
    var initial = api.status();
    if (!initial || !initial.uid) return; // chưa đăng nhập / đồng bộ chưa khởi động

    var deadline = Date.now() + 20000;
    var lastError = '';
    while (Date.now() < deadline) {
      var state = api.status();
      if (!state || !state.uid || state.uid !== initial.uid) {
        throw new Error('Phiên đồng bộ đã thay đổi. Vui lòng thử đăng xuất lại.');
      }
      if (!state.dirty || state.dirty.length === 0) {
        if (state.status === 'error' || state.status === 'perm' || state.status === 'offline') {
          throw new Error('Không thể xác nhận dữ liệu đã đồng bộ (' + state.status + ').');
        }
        return;
      }
      if (!navigator.onLine) throw new Error('Thiết bị đang ngoại tuyến. Hãy kết nối mạng rồi đăng xuất lại.');
      if (state.status === 'error' || state.status === 'perm') {
        throw new Error('Đồng bộ thất bại: ' + state.status + '. Dữ liệu chưa được xác nhận đã lưu lên cloud.');
      }

      try { await api.syncNow(); }
      catch (e) { lastError = e && e.message ? e.message : String(e); }
      await wait(250);
    }
    var finalState = api.status();
    if (finalState && finalState.dirty && finalState.dirty.length) {
      throw new Error('Hết thời gian chờ đồng bộ. Còn ' + finalState.dirty.length + ' mục chưa đồng bộ.' + (lastError ? ' ' + lastError : ''));
    }
  }

  function showLogoutError(err) {
    var msg = err && err.message ? err.message : 'Không thể đồng bộ dữ liệu trước khi đăng xuất.';
    try {
      if (window.UIManager && typeof window.UIManager.toast === 'function') {
        window.UIManager.toast('error', 'Chưa thể đăng xuất', msg);
        return;
      }
    } catch (e) { }
    window.alert('Chưa thể đăng xuất vì dữ liệu chưa được đồng bộ.\n' + msg);
  }

  function wrapLogout() {
    try {
      var auth = window.AuthManager;
      if (!auth || typeof auth.doSignOut !== 'function' || auth.__cdLogoutFlushAddon) return;
      var original = auth.doSignOut;
      auth.doSignOut = async function () {
        if (window.__cdLogoutFlushInProgress) return original.apply(this, arguments);
        window.__cdLogoutFlushInProgress = true;
        try {
          await flushBeforeLogout();
          return await original.apply(this, arguments);
        } catch (err) {
          showLogoutError(err);
          throw err; // Không đăng xuất nếu chưa xác nhận đồng bộ xong.
        } finally {
          window.__cdLogoutFlushInProgress = false;
        }
      };
      auth.__cdLogoutFlushAddon = true;
    } catch (e) { console.warn('[CloudData] Không thể bọc hàm đăng xuất:', e); }
  }

  function bootAddon() {
    installIcon();
    wrapLogout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAddon, { once: true });
  else bootAddon();

  // Topbar có thể được dựng lại sau khi đăng nhập/chuyển giao diện; tự khôi phục icon.
  if (window.MutationObserver && document.documentElement) {
    var queued = false;
    var observer = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      Promise.resolve().then(function () { queued = false; installIcon(); wrapLogout(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.setInterval(bootAddon, 1200);
})();
