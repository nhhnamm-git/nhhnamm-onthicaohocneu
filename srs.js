/* ============================================================================
   srs.js — LẶP LẠI NGẮT QUÃNG (SM-2) + HÀNG ĐỢI ÔN TẬP HẰNG NGÀY
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng vào CUỐI <body> của index.html, đặt TRƯỚC flashcard.js:
       <script src="srs.js"></script>
       <script src="flashcard.js"></script>
   Không cần thêm Firestore rules mới (dùng lại users/{uid}/appData đã có).

   NÓ LÀM GÌ
   - Thay hẳn kiểu gợi ý "cách 1-3 ngày" bằng thuật toán SM-2: mỗi mục (câu sai
     hoặc flashcard) có hệ số dễ nhớ EF, khoảng cách ôn (iv, ngày), số lần nhớ
     liên tiếp (rp) và ngày đến hạn (due).
         nhớ lần 1 → 1 ngày · lần 2 → 6 ngày · các lần sau → iv × EF
         quên (q < 3) → về lại từ đầu: mai ôn lại, EF giữ nguyên (đúng SM-2 gốc)
         EF' = EF + 0.1 − (5−q)·(0.08 + (5−q)·0.02), tối thiểu 1.3
     Nút chấm: Quên = 1 · Khó = 3 · Tốt = 4 · Dễ = 5
   - HÀNG ĐỢI CHUNG: câu sai + flashcard đến hạn hôm nay gộp thành 1 phiên ôn,
     hiển thị ngay trong mục "Ôn câu sai". Mục quên sẽ được hỏi lại trong phiên
     (sau ~4 mục) cho tới khi nhớ — lần hỏi lại KHÔNG đổi lịch.
   - Giới hạn mỗi ngày (chỉnh trong ⚙): thẻ mới, câu sai cũ "nhỏ giọt", tổng/ngày,
     khoảng cách tối đa — tránh bị ngợp khi có hàng trăm mục tồn.
   - Không sửa code cũ: chỉ "bọc" BankManager.addWrong (tự đưa câu vừa sai vào
     lịch SM-2) và ReviewUI.renderWrongList (để vẽ khung hàng đợi).
     Câu sai cũ trong wrongBank được nạp vào SM-2 tự động ở lần đầu.
   - Một câu sai được gỡ khỏi danh sách "Ôn câu sai" khi đã nhớ 2 lần liên tiếp
     (khoảng cách ≥ 6 ngày) nhưng vẫn nằm trong lịch SM-2 để giữ trí nhớ lâu dài.
   - Lịch của câu sai đồng bộ theo tài khoản: users/{uid}/appData/srsQ
     (gộp theo từng câu, bản mới nhất thắng). Flashcard lưu ngay trên thẻ.

   API (cho flashcard.js & module khác):
     SRS.sm2(state, q, maxIv) · SRS.preview(state, q) · SRS.levelOf(state, isNew)
     SRS.registerProvider(name, {label, fetchDue(opts), save(item, newState, q)})
     SRS.load(force) · SRS.start({extra}) · SRS.invalidate() · SRS.noteDone(...)
     SRS.dueCount()  → số mục đến hạn (đồng bộ, dùng cho badge/thông báo)
     sự kiện window 'srs:change' mỗi khi hàng đợi thay đổi
   ========================================================================== */
(function () {
  'use strict';
  if (window.SRS) return;
  if (typeof StorageManager === 'undefined' || typeof BankManager === 'undefined' || typeof QuestionManager === 'undefined') {
    console.warn('[SRS] Không thấy StorageManager/BankManager/QuestionManager — hãy đặt script SAU các script của index.html.');
    return;
  }

  /* ---------- tiện ích ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var Env = {
    db: function () { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; },
    auth: function () { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; },
    ui: function () { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; },
    user: function () { var a = this.auth(); return (a && a.currentUser) || null; }
  };
  function toast(type, t, m) { var u = Env.ui(); if (u && u.toast) u.toast(type, t, m || ''); }

  /* ---------- ngày (chỉ số ngày theo giờ địa phương) ---------- */
  var DAY = 864e5;
  function dayOf(ms) { var d = new Date(ms); return Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / DAY); }
  function today() { return dayOf(Date.now()); }
  function dueLabel(day) {
    var t = today();
    if (day < t) return 'Quá hạn ' + (t - day) + ' ngày';
    if (day === t) return 'Hôm nay';
    if (day === t + 1) return 'Ngày mai';
    var d = new Date(day * DAY + new Date().getTimezoneOffset() * 6e4);
    return d.getDate() + '/' + (d.getMonth() + 1);
  }
  function fmtIv(d) {
    d = Math.max(1, Math.round(d));
    if (d < 30) return d + ' ngày';
    if (d < 365) return Math.round(d / 30) + ' tháng';
    return (Math.round(d / 36.5) / 10) + ' năm';
  }

  /* ==========================================================================
     1) THUẬT TOÁN SM-2
     ======================================================================== */
  function sm2(st, q, maxIv) {
    var ef = st.ef || 2.5, iv = st.iv || 0, rp = st.rp || 0;
    if (q < 3) { rp = 0; iv = 1; }                       // quên: học lại từ đầu, EF giữ nguyên
    else {
      iv = rp === 0 ? 1 : rp === 1 ? 6 : Math.round(iv * ef);
      rp++;
      ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    }
    return { ef: Math.round(ef * 100) / 100, iv: Math.min(iv, maxIv || 365), rp: rp };
  }
  function preview(st, q) { return sm2(st, q, cfg().maxIv); }
  // 0 mới · 1 đang quên · 2 đang học · 3 đã thuộc chắc (khoảng cách ≥ 21 ngày)
  function levelOf(st, isNew) { if (isNew) return 0; if (!st.rp) return 1; return st.iv >= 21 ? 3 : 2; }

  /* ==========================================================================
     2) CÀI ĐẶT + BỘ ĐẾM NGÀY (lưu trong localStorage của thiết bị)
     ======================================================================== */
  var SKEY = 'examMasterPro_srsSettings', QKEY = 'examMasterPro_srsQ', MKEY = 'examMasterPro_srsMeta';
  var DEF = { newCards: 10, newSeed: 10, maxDaily: 60, maxIv: 365 };
  function cfg() {
    var s = StorageManager.get(SKEY, {}) || {}, o = {};
    Object.keys(DEF).forEach(function (k) { var v = Number(s[k]); o[k] = isFinite(v) && v >= 0 ? Math.floor(v) : DEF[k]; });
    if (!o.maxIv) o.maxIv = DEF.maxIv;
    return o;
  }
  function meta() { var m = StorageManager.get(MKEY, null) || {}; m.daily = m.daily || {}; return m; }
  function saveMeta(m) { StorageManager.set(MKEY, m); }
  function freshDaily(t) { return { d: t, done: 0, seed: 0, n: {} }; }
  function daily() { var m = meta(), t = today(); if (m.daily.d !== t) return freshDaily(t); m.daily.n = m.daily.n || {}; return m.daily; }
  function noteDone(kind, isNew, isSeed) {
    var m = meta(), t = today(); if (m.daily.d !== t) m.daily = freshDaily(t); m.daily.n = m.daily.n || {};
    m.daily.done++; if (isNew) m.daily.n[kind] = (m.daily.n[kind] || 0) + 1; if (isSeed) m.daily.seed++;
    saveMeta(m);
  }

  /* ==========================================================================
     3) LỊCH SM-2 CỦA CÂU SAI   { [qid]: {ef, iv, rp, due, lps, n, lr, lw, lu, seed} }
        due/lr/lw = chỉ số ngày · lps = số lần quên · n = số lần đã ôn · lu = lần sửa cuối (ms)
     ======================================================================== */
  var internal = false, ver = 0, cache = null, cacheAt = 0, inflight = null;
  function qAll() { var m = StorageManager.get(QKEY, {}); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; }
  function qSave(map) { StorageManager.set(QKEY, map); if (Sync.uid) schedulePush(); invalidate(); }
  function newRec(due, seed) { return { ef: 2.5, iv: seed ? 0 : 1, rp: 0, due: due, lps: 0, n: 0, lu: Date.now(), seed: seed ? 1 : 0 }; }
  function invalidate() { ver++; cache = null; inflight = null; }
  function fire() { try { window.dispatchEvent(new CustomEvent('srs:change')); } catch (e) { } }

  // Nạp câu sai cũ (chưa có lịch) vào SM-2: đến hạn từ ngày sau lần sai gần nhất.
  function seedFromWrong() {
    var map = qAll(), wb = BankManager.getWrong() || {}, ch = false, t = today();
    Object.keys(wb).forEach(function (id) {
      if (map[id]) return;
      var ms = Date.parse((wb[id] && wb[id].lastDate) || ''), d = isNaN(ms) ? t : dayOf(ms);
      map[id] = newRec(d + 1, true); ch = true;
    });
    if (ch) { StorageManager.set(QKEY, map); if (Sync.uid) schedulePush(); }
    return map;
  }
  // Câu vừa trả lời sai ở phần làm bài → vào / quay lại lịch: mai ôn lại.
  function onWrong(id) {
    if (internal) return;
    var map = qAll(), t = today(), k = String(id), r = map[k];
    if (!r) { r = newRec(t + 1, false); r.lw = t; }
    else if (r.lw !== t) { r.rp = 0; r.iv = 1; r.due = t + 1; r.lps = (r.lps || 0) + 1; r.lw = t; r.seed = 0; r.lu = Date.now(); }
    else return;
    map[k] = r; qSave(map);
  }
  function dueQuestions() {
    var map = seedFromWrong(), t = today(), c = cfg(), dl = daily(), out = [], seeds = [];
    Object.keys(map).forEach(function (id) {
      var r = map[id]; if (!r || r.due > t) return;
      var q = QuestionManager.getById(Number(id)); if (!q) return;
      var seed = !!r.seed && !r.n;
      var it = { kind: 'q', key: 'q:' + id, id: id, st: { ef: r.ef, iv: r.iv, rp: r.rp }, due: r.due, isNew: false, seed: seed, lps: r.lps || 0, q: q };
      (seed ? seeds : out).push(it);
    });
    seeds.sort(function (a, b) { return a.due - b.due; });
    return out.concat(seeds.slice(0, Math.max(0, c.newSeed - (dl.seed || 0))));
  }

  /* ==========================================================================
     4) HÀNG ĐỢI CHUNG (câu sai + các provider như flashcard)
     ======================================================================== */
  var providers = {};
  function registerProvider(name, p) { providers[name] = p; invalidate(); }
  var KIND_LABEL = function (k) { return k === 'q' ? 'câu sai' : ((providers[k] && providers[k].label) || k).toLowerCase(); };

  function load(force) {
    if (!force && cache && Date.now() - cacheAt < 30000) return Promise.resolve(cache);
    if (!force && inflight) return inflight;
    var my = ver, c = cfg(), dl = daily(), t = today();
    var jobs = Object.keys(providers).map(function (n) {
      var left = Math.max(0, c.newCards - ((dl.n || {})[n] || 0));
      return Promise.resolve().then(function () { return providers[n].fetchDue({ today: t, newLimit: left }); })
        .then(function (a) { a = a || []; a.forEach(function (i) { i.kind = n; }); return a; }, function (e) { console.warn('[SRS] provider ' + n, e); return []; });
    });
    var p = Promise.all(jobs).then(function (res) {
      var items = dueQuestions();
      res.forEach(function (a) { items = items.concat(a); });
      items.forEach(function (i) { i.low = !!(i.isNew || i.seed); i._k = (i.low ? 1e7 : 0) + (i.due > 0 ? i.due : 0) + Math.random() * 0.9; });
      items.sort(function (a, b) { return a._k - b._k; });
      var cap = Math.max(0, c.maxDaily - dl.done), r = { items: items.slice(0, cap), rest: items.slice(cap), all: items.length, cap: cap, done: dl.done, max: c.maxDaily, byKind: {}, tracked: Object.keys(qAll()).length };
      r.items.forEach(function (i) { r.byKind[i.kind] = (r.byKind[i.kind] || 0) + 1; });
      if (my === ver) { cache = r; cacheAt = Date.now(); }
      return r;
    });
    if (!force) inflight = p;
    return p;
  }
  // Đếm đồng bộ (không gọi mạng) cho badge/thông báo.
  function dueCount() {
    if (cache) return cache.all;
    var map = qAll(), wb = BankManager.getWrong() || {}, t = today(), n = 0;
    Object.keys(map).forEach(function (id) { if (map[id] && map[id].due <= t) n++; });
    Object.keys(wb).forEach(function (id) { if (!map[id]) n++; });
    return n;
  }

  /* ==========================================================================
     5) PHIÊN ÔN TẬP (overlay)
     ======================================================================== */
  var SS = null, OV = null;
  function css() {
    if ($('#srsStyles')) return;
    var s = document.createElement('style'); s.id = 'srsStyles';
    s.textContent = [
      '#srsPanel{margin-bottom:16px}.srs-card{padding:18px}',
      '.srs-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.srs-h h3{font-size:16px;font-weight:800}.srs-sub{font-size:12.5px;color:var(--text-muted);line-height:1.55}',
      '.srs-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.srs-big{font-size:38px;font-weight:800;line-height:1;margin:12px 0 4px}.srs-big small{font-size:13px;font-weight:600;color:var(--text-muted)}',
      '.srs-pill{font-size:12px;font-weight:700;padding:4px 11px;border-radius:20px;background:rgba(20,120,212,.1);color:var(--accent)}',
      '.srs-bar{height:7px;border-radius:7px;background:rgba(20,120,212,.12);overflow:hidden;margin:10px 0 4px}.srs-bar i{display:block;height:100%;background:linear-gradient(90deg,#1478d4,#22d3ee)}',
      '.srs-ov{position:fixed;inset:0;z-index:9500;background:rgba(3,19,36,.6);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:14px}',
      '.srs-box{background:var(--card-bg-solid);color:var(--text-main);border:1px solid var(--card-border);border-radius:20px;box-shadow:var(--shadow-lg);width:100%;max-width:700px;max-height:94vh;overflow:auto;padding:20px}',
      '.srs-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.srs-cnt{font-size:12.5px;color:var(--text-muted);font-weight:700}',
      '.srs-chip{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--accent);margin:16px 0 8px}',
      '.srs-qtext{font-size:18px;font-weight:700;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-bottom:14px}',
      '.srs-ans{font-size:16.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,rgba(20,120,212,.12),rgba(6,182,212,.12));margin-bottom:14px}',
      '.srs-opts{display:grid;gap:9px;margin-bottom:14px}',
      '.srs-opt{display:flex;gap:11px;align-items:flex-start;text-align:left;padding:11px 14px;border-radius:13px;border:1.5px solid var(--card-border);background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.5;cursor:pointer;transition:.15s}',
      '.srs-opt:not([disabled]):hover{border-color:var(--accent);background:rgba(20,120,212,.06)}.srs-opt b{flex-shrink:0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;background:rgba(20,120,212,.12)}',
      '.srs-opt.ok{border-color:var(--success,#16c784);background:rgba(22,199,132,.12)}.srs-opt.bad{border-color:var(--danger,#ef4444);background:rgba(239,68,68,.1)}',
      '.srs-opt[disabled]{cursor:default}',
      '.srs-wrong{font-size:13.5px;line-height:1.6;margin-bottom:12px;padding:10px 13px;border-radius:12px;background:rgba(239,68,68,.08)}',
      '.srs-show{width:100%;padding:13px;font-size:14.5px}.srs-show small{opacity:.75;font-weight:600}',
      '.srs-rate{display:grid;gap:9px}.srs-rate.c1{grid-template-columns:1fr}.srs-rate.c2{grid-template-columns:repeat(2,1fr)}.srs-rate.c3{grid-template-columns:repeat(3,1fr)}.srs-rate.c4{grid-template-columns:repeat(4,1fr)}',
      '.srs-r{padding:11px 6px;border-radius:13px;color:#fff;font:inherit;font-size:13.5px;border:0;cursor:pointer}.srs-r b{display:block;font-weight:800}.srs-r small{display:block;font-size:10.5px;opacity:.9;margin-top:2px}',
      '.srs-r.d{background:var(--danger,#ef4444)}.srs-r.w{background:var(--warning,#f59e0b)}.srs-r.g{background:var(--success,#16c784)}.srs-r.e{background:var(--accent,#1478d4)}',
      '.srs-sum{text-align:center;padding:24px 6px}.srs-nums{display:flex;justify-content:center;gap:22px;flex-wrap:wrap;margin:16px 0;font-size:12.5px;color:var(--text-muted)}.srs-nums b{display:block;font-size:22px;color:var(--text-main)}',
      '.srs-f{margin-bottom:12px}.srs-f label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:5px}.srs-f input{width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.04);color:var(--text-main);font:inherit;font-size:13.5px}',
      '@media(max-width:560px){.srs-rate.c4{grid-template-columns:repeat(2,1fr)}.srs-qtext{font-size:16px}}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function openOverlay() {
    closeOverlay(true);
    OV = document.createElement('div'); OV.className = 'srs-ov'; OV.innerHTML = '<div class="srs-box" id="srsBox"></div>';
    document.body.appendChild(OV); document.body.style.overflow = 'hidden'; OV.addEventListener('click', onOv);
  }
  function closeOverlay(silent) {
    if (OV) { OV.remove(); OV = null; document.body.style.overflow = ''; }
    if (!silent) { SS = null; invalidate(); refreshLists(); paintPanel(); fire(); }
  }
  function refreshLists() {
    try {
      var b = $('#badgeWrong'); if (b) b.textContent = Object.keys(BankManager.getWrong()).length;
      if (typeof ReviewUI !== 'undefined') ReviewUI.renderWrongList();
    } catch (e) { }
  }

  function start(opts) {
    opts = opts || {};
    return load(true).then(function (c) {
      var items = opts.extra ? c.items.concat(c.rest).slice(0, opts.extra) : c.items.slice();
      if (!items.length) { toast('success', 'Hôm nay không còn mục nào đến hạn', 'Quay lại vào ngày mai nhé 🎉'); paintPanel(); return; }
      SS = { queue: items, total: items.length, done: 0, stats: { fail: 0, hard: 0, good: 0, easy: 0 }, step: 'ask', picked: null, flipped: false, keys: [] };
      openOverlay(); paint();
    });
  }

  function rateRow(it, arr) {
    SS.keys = arr.map(function (x) { return x[0]; });
    return '<div class="srs-rate c' + arr.length + '">' + arr.map(function (x, i) {
      var sub = it.relearn ? 'học lại · phím ' + (i + 1) : fmtIv(preview(it.st, x[0]).iv) + ' · phím ' + (i + 1);
      return '<button class="srs-r ' + x[2] + '" data-q="' + x[0] + '"><b>' + x[1] + '</b><small>' + sub + '</small></button>';
    }).join('') + '</div>';
  }
  function qKeys(q) { return Object.keys((q && q.options) || {}).sort(); }
  function bodyQ(it) {
    var q = it.q, keys = qKeys(q), fb = SS.step === 'fb', ok = fb && SS.picked === q.answer;
    var chip = '<div class="srs-chip"><i class="fa-solid fa-rotate-left"></i> Câu sai #' + esc(q.id) + (it.lps ? ' · đã quên ' + it.lps + ' lần' : '') + (it.relearn ? ' · hỏi lại' : '') + '</div>';
    var opts = keys.map(function (k) {
      var cl = 'srs-opt'; if (fb) { if (k === q.answer) cl += ' ok'; else if (k === SS.picked) cl += ' bad'; }
      return '<button class="' + cl + '" data-k="' + esc(k) + '"' + (fb ? ' disabled' : '') + '><b>' + esc(k) + '</b><span>' + esc(q.options[k]) + '</span></button>';
    }).join('');
    var foot = '';
    SS.keys = [];
    if (fb) {
      if (ok) foot = rateRow(it, it.relearn ? [[4, 'Đã nhớ', 'g']] : [[3, 'Khó', 'w'], [4, 'Tốt', 'g'], [5, 'Dễ', 'e']]);
      else foot = '<div class="srs-wrong">❌ Bạn chọn <b>' + esc(SS.picked) + '</b>. Đáp án đúng: <b>' + esc(q.answer) + '. ' + esc(q.options[q.answer]) + '</b> — câu này sẽ được hỏi lại sau ít phút và mai ôn tiếp.</div>' + rateRow(it, [[1, 'Tiếp tục', 'd']]);
    }
    return chip + '<div class="srs-qtext">' + esc(q.question) + '</div><div class="srs-opts">' + opts + '</div>' + foot;
  }
  function bodyCard(it) {
    var d = it.data || {};
    var chip = '<div class="srs-chip"><i class="fa-solid fa-clone"></i> Flashcard' + (d.deckName ? ' · ' + esc(d.deckName) : '') + (it.isNew ? ' · thẻ mới' : '') + (it.relearn ? ' · hỏi lại' : '') + '</div>';
    var foot;
    SS.keys = [];
    if (SS.flipped) foot = '<div class="srs-ans">' + esc(d.a) + '</div>' + rateRow(it, it.relearn ? [[1, 'Quên', 'd'], [4, 'Nhớ rồi', 'g']] : [[1, 'Quên', 'd'], [3, 'Khó', 'w'], [4, 'Tốt', 'g'], [5, 'Dễ', 'e']]);
    else foot = '<button class="btn btn-primary srs-show" data-a="show">Hiện đáp án <small>(Space)</small></button>';
    return chip + '<div class="srs-qtext">' + esc(d.q) + '</div>' + foot;
  }
  function paint() {
    var box = $('#srsBox'); if (!box || !SS) return;
    var it = SS.queue[0]; if (!it) return summary(box);
    var p = Math.round(SS.done / SS.total * 100);
    box.innerHTML = '<div class="srs-top"><button class="btn btn-outline btn-sm" data-a="exit"><i class="fa-solid fa-xmark"></i> Thoát</button><span class="srs-cnt">' + SS.done + '/' + SS.total + ' · còn ' + SS.queue.length + '</span></div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + p + '%"></div></div>' + (it.kind === 'q' ? bodyQ(it) : bodyCard(it));
    box.scrollTop = 0;
  }
  function summary(box) {
    var st = SS.stats, n = st.fail + st.hard + st.good + st.easy, ok = st.hard + st.good + st.easy, pct = n ? Math.round(ok / n * 100) : 0;
    box.innerHTML = '<div class="srs-sum"><div style="font-size:42px">🎉</div><h3>Xong hàng đợi!</h3>' +
      '<div class="srs-nums"><span><b>' + n + '</b>Đã ôn</span><span><b style="color:var(--success)">' + ok + '</b>Nhớ</span><span><b style="color:var(--danger)">' + st.fail + '</b>Quên</span><span><b>' + pct + '%</b>Tỷ lệ nhớ</span></div>' +
      '<div class="srs-sub" id="srsMore" style="margin-bottom:14px"></div><div class="srs-row" style="justify-content:center"><button class="btn btn-primary" data-a="done">Xong</button></div></div>';
    load(true).then(function (c) {
      var m = $('#srsMore'); if (!m || !SS) return;
      var left = c.items.length + c.rest.length;
      if (left) m.innerHTML = 'Còn <b>' + left + '</b> mục đến hạn' + (c.cap ? '' : ' (đã đạt giới hạn ngày)') + '. <button class="btn btn-outline btn-sm" data-a="more">Ôn thêm ' + Math.min(20, left) + '</button>';
      else m.textContent = 'Hôm nay không còn mục nào đến hạn. Hẹn bạn ngày mai!';
    });
  }
  function onOv(e) {
    var t = e.target, el;
    if ((el = t.closest('[data-a]'))) {
      var a = el.dataset.a;
      if (a === 'exit' || a === 'done') return closeOverlay();
      if (a === 'show') return flipC();
      if (a === 'more') { closeOverlay(); return start({ extra: 20 }); }
    }
    if ((el = t.closest('[data-k]'))) return pick(el.dataset.k);
    if ((el = t.closest('[data-q]'))) return rate(+el.dataset.q);
  }
  function pick(k) { if (!SS || SS.step !== 'ask') return; var it = SS.queue[0]; if (!it || it.kind !== 'q') return; SS.picked = k; SS.step = 'fb'; paint(); }
  function flipC() { if (!SS) return; var it = SS.queue[0]; if (!it || it.kind === 'q' || SS.flipped) return; SS.flipped = true; paint(); }
  function requeue(it) { SS.queue.splice(Math.min(4, SS.queue.length), 0, it); }
  function rate(qv) {
    if (!SS) return; var it = SS.queue[0]; if (!it) return;
    if (it.kind === 'q' ? SS.step !== 'fb' : !SS.flipped) return;
    SS.queue.shift();
    if (!it.relearn) {
      commit(it, qv);
      SS.stats[qv < 3 ? 'fail' : qv === 3 ? 'hard' : qv === 4 ? 'good' : 'easy']++;
      if (qv < 3) { it.relearn = true; requeue(it); } else SS.done++;
    } else if (qv >= 3) SS.done++; else requeue(it);
    SS.step = 'ask'; SS.picked = null; SS.flipped = false; paint();
  }
  // Ghi lịch SM-2 cho mục vừa chấm (chỉ ở lần chấm đầu tiên trong phiên).
  function commit(it, qv) {
    var t = today(), st = sm2(it.st, qv, cfg().maxIv), lapse = qv < 3 && (it.st.rp || 0) > 0;
    var ns = { ef: st.ef, iv: st.iv, rp: st.rp, due: t + st.iv, lps: (it.lps || 0) + (lapse ? 1 : 0) };
    noteDone(it.kind, it.isNew, it.seed);
    if (it.kind === 'q') return commitQ(it, ns, qv, t);
    var p = providers[it.kind];
    if (p && p.save) Promise.resolve(p.save(it, ns, qv)).then(invalidate).catch(function (e) { console.error('[SRS]', e); toast('error', 'Không lưu được lịch ôn', (e && e.message) || ''); });
  }
  function commitQ(it, ns, qv, t) {
    var map = qAll(), k = String(it.id), r = map[k] || newRec(t, false);
    r.ef = ns.ef; r.iv = ns.iv; r.rp = ns.rp; r.due = ns.due; r.lps = ns.lps; r.n = (r.n || 0) + 1; r.lr = t; r.lu = Date.now(); r.seed = 0;
    if (qv < 3) r.lw = t;
    map[k] = r; qSave(map);
    // đồng bộ danh sách "Ôn câu sai": quên → vào/ở lại danh sách; nhớ 2 lần liên tiếp → gỡ khỏi danh sách (lịch SM-2 vẫn giữ)
    internal = true;
    try { if (qv < 3) BankManager.addWrong(it.q.id); else if (ns.rp >= 2) BankManager.removeWrong(it.q.id); } catch (e) { }
    internal = false;
  }
  document.addEventListener('keydown', function (e) {
    if (!SS || !OV || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') return closeOverlay();
    var it = SS.queue[0]; if (!it) return;
    var n = parseInt(e.key, 10);
    if (it.kind === 'q' && SS.step === 'ask') {
      var ks = qKeys(it.q); if (n >= 1 && n <= ks.length) { e.preventDefault(); pick(ks[n - 1]); } return;
    }
    if (it.kind !== 'q' && !SS.flipped) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipC(); } return; }
    if (n >= 1 && n <= SS.keys.length) { e.preventDefault(); rate(SS.keys[n - 1]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rate(SS.keys.indexOf(4) > -1 ? 4 : SS.keys[0]); }
  });

  /* ==========================================================================
     6) KHUNG "HÀNG ĐỢI HÔM NAY" trong mục Ôn câu sai + CÀI ĐẶT
     ======================================================================== */
  function injectPanel() {
    if ($('#srsPanel')) return;
    var head = $('#view-reviewWrong .section-head'); if (!head) return;
    var box = document.createElement('div'); box.id = 'srsPanel'; box.className = 'card srs-card';
    head.insertAdjacentElement('afterend', box);
    box.addEventListener('click', function (e) {
      var el = e.target.closest('[data-a]'); if (!el) return;
      if (el.dataset.a === 'start') start(); else if (el.dataset.a === 'more') start({ extra: 20 }); else if (el.dataset.a === 'cfg') openSettings();
    });
  }
  var panelTk = 0;
  function panelHtml(c) {
    var head = '<div class="srs-h"><div><h3><i class="fa-solid fa-layer-group"></i> Hàng đợi ôn tập hôm nay</h3><div class="srs-sub">Câu sai và flashcard dùng chung một lịch SM-2: nhớ → lần sau cách xa hơn (1 → 6 → ×EF ngày), quên → mai ôn lại.</div></div>' +
      '<button class="btn btn-outline btn-sm" data-a="cfg" title="Cài đặt giới hạn mỗi ngày"><i class="fa-solid fa-gear"></i></button></div>';
    if (!c) return head + '<div class="srs-sub" style="margin-top:12px"><i class="fa-solid fa-spinner fa-spin"></i> Đang tính hàng đợi...</div>';
    var tot = c.items.length, pills = Object.keys(c.byKind).map(function (k) { return '<span class="srs-pill">' + c.byKind[k] + ' ' + esc(KIND_LABEL(k)) + '</span>'; }).join('');
    var pct = c.max ? Math.min(100, Math.round(c.done / c.max * 100)) : 0, act;
    if (tot) act = '<button class="btn btn-primary" data-a="start"><i class="fa-solid fa-play"></i> Bắt đầu ôn (' + tot + ')</button>';
    else if (c.rest.length) act = '<span class="srs-sub">Đã đạt giới hạn ' + c.max + ' mục/ngày — còn ' + c.rest.length + ' mục đến hạn.</span> <button class="btn btn-outline btn-sm" data-a="more">Ôn thêm 20</button>';
    else act = '<span class="srs-sub">🎉 Hôm nay không còn mục nào đến hạn.' + (c.tracked ? ' Đang theo dõi ' + c.tracked + ' câu sai.' : '') + '</span>';
    return head + '<div class="srs-big">' + tot + ' <small>mục đến hạn</small></div><div class="srs-row" style="margin-bottom:6px">' + pills + '</div>' +
      '<div class="srs-bar"><i style="width:' + pct + '%"></i></div><div class="srs-sub" style="margin-bottom:12px">Đã ôn hôm nay: ' + c.done + '/' + c.max + '</div><div class="srs-row">' + act + '</div>';
  }
  function paintPanel() {
    var host = $('#srsPanel'); if (!host) return;
    var tk = ++panelTk, draw = function (c) { if (tk === panelTk) host.innerHTML = panelHtml(c); };
    draw(cache);
    load().then(draw).catch(function (e) { console.warn('[SRS]', e); });
  }
  function modal(html) {
    var ov = document.createElement('div'); ov.className = 'srs-ov'; ov.style.zIndex = 9600;
    ov.innerHTML = '<div class="srs-box" style="max-width:440px">' + html + '</div>'; document.body.appendChild(ov);
    var close = function () { ov.remove(); }; ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    return { el: ov, close: close };
  }
  function openSettings() {
    var c = cfg();
    var f = function (id, label, v, hint) { return '<div class="srs-f"><label>' + label + '</label><input type="number" min="0" max="9999" id="' + id + '" value="' + v + '"><div class="srs-sub">' + hint + '</div></div>'; };
    var m = modal('<h3 style="margin-bottom:12px"><i class="fa-solid fa-gear"></i> Giới hạn ôn mỗi ngày</h3>' +
      f('srsNew', 'Flashcard mới / ngày', c.newCards, 'Số thẻ chưa học được đưa vào hàng đợi mỗi ngày.') +
      f('srsSeed', 'Câu sai cũ chưa có lịch / ngày', c.newSeed, 'Câu sai tồn từ trước được "nhỏ giọt" vào lịch SM-2 để không bị ngợp.') +
      f('srsMax', 'Tổng số mục / ngày', c.maxDaily, 'Tối đa câu sai + flashcard trong hàng đợi một ngày (bấm "Ôn thêm" nếu muốn học nhiều hơn).') +
      f('srsIv', 'Khoảng cách ôn tối đa (ngày)', c.maxIv, 'Một mục nhớ chắc sẽ không bị hẹn xa hơn mức này.') +
      '<div class="srs-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-outline" id="srsNo">Hủy</button><button class="btn btn-primary" id="srsOk">Lưu</button></div>');
    $('#srsNo', m.el).onclick = m.close;
    $('#srsOk', m.el).onclick = function () {
      var v = function (id, d) { var n = parseInt($('#' + id, m.el).value, 10); return isFinite(n) && n >= 0 ? n : d; };
      StorageManager.set(SKEY, { newCards: v('srsNew', DEF.newCards), newSeed: v('srsSeed', DEF.newSeed), maxDaily: Math.max(1, v('srsMax', DEF.maxDaily)), maxIv: Math.max(7, v('srsIv', DEF.maxIv)) });
      m.close(); invalidate(); paintPanel(); fire(); toast('success', 'Đã lưu cài đặt ôn tập');
    };
  }

  /* ==========================================================================
     7) ĐỒNG BỘ LỊCH CÂU SAI THEO TÀI KHOẢN  users/{uid}/appData/srsQ
     ======================================================================== */
  var Sync = { uid: null, unsub: null, pt: null };
  function sref() { return Env.db().collection('users').doc(Sync.uid).collection('appData').doc('srsQ'); }
  function mergeMaps(a, b, resetAt) {
    var out = {};
    [b, a].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) {
        var r = m[k]; if (!r || (r.lu || 0) < (resetAt || 0)) return;
        var o = out[k]; if (!o || (r.lu || 0) >= (o.lu || 0)) out[k] = r;
      });
    });
    return out;
  }
  function sameMap(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return b[k] && (a[k].lu || 0) === (b[k].lu || 0); });
  }
  function parseJson(s) { try { var o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function applyRemote(doc) {
    var rm = parseJson(doc.json), m = meta();
    if ((doc.resetAt || 0) > (m.resetAt || 0)) { m.resetAt = doc.resetAt; saveMeta(m); }
    var local = qAll(), merged = mergeMaps(local, rm, m.resetAt || 0);
    if (!sameMap(local, merged)) { StorageManager.set(QKEY, merged); invalidate(); paintPanel(); fire(); }
    if (!sameMap(rm, merged)) schedulePush();
  }
  function schedulePush() { clearTimeout(Sync.pt); Sync.pt = setTimeout(push, 2000); }
  function push() {
    if (!Sync.uid || !Env.db()) return;
    var r = sref();
    Env.db().runTransaction(function (tx) {
      return tx.get(r).then(function (s) {
        var rem = s.exists ? s.data() : {}, m = meta(), rs = Math.max(m.resetAt || 0, rem.resetAt || 0);
        var merged = mergeMaps(qAll(), parseJson(rem.json), rs);
        tx.set(r, { json: JSON.stringify(merged), resetAt: rs, v: Date.now() });
        return merged;
      });
    }).then(function (merged) { if (!sameMap(qAll(), merged)) { StorageManager.set(QKEY, merged); invalidate(); } })
      .catch(function (e) { if (!e || e.code !== 'permission-denied') { clearTimeout(Sync.pt); Sync.pt = setTimeout(push, 30000); } else console.warn('[SRS] Thiếu quyền users/{uid}/appData — lịch câu sai chỉ lưu trên máy này.'); });
  }
  function syncStart(u) {
    if (Sync.uid === u.uid) return;
    syncStop();
    var m = meta();
    if (m.owner && m.owner !== u.uid) { StorageManager.remove(QKEY); m = { daily: {} }; }   // máy dùng chung: không trộn dữ liệu 2 tài khoản
    m.owner = u.uid; saveMeta(m);
    Sync.uid = u.uid; invalidate();
    try { Sync.unsub = sref().onSnapshot(function (s) { if (s.metadata && s.metadata.hasPendingWrites) return; applyRemote(s.exists ? s.data() : {}); }, function (e) { console.warn('[SRS] sync', e && e.code); }); } catch (e) { }
  }
  function syncStop() { if (Sync.unsub) { try { Sync.unsub(); } catch (e) { } } Sync.unsub = null; Sync.uid = null; clearTimeout(Sync.pt); }

  /* ==========================================================================
     8) MÓC VÀO CODE CÓ SẴN (chỉ "bọc", không sửa)
     ======================================================================== */
  function hook() {
    if (!BankManager.__srsWrapped) {
      BankManager.__srsWrapped = true;
      var oa = BankManager.addWrong;
      BankManager.addWrong = function (id) { var r = oa.apply(this, arguments); try { onWrong(id); } catch (e) { console.warn('[SRS]', e); } return r; };
    }
    try {
      if (typeof ReviewUI !== 'undefined' && ReviewUI && !ReviewUI.__srsWrapped) {
        ReviewUI.__srsWrapped = true; var or = ReviewUI.renderWrongList.bind(ReviewUI);
        ReviewUI.renderWrongList = function () { var r = or.apply(null, arguments); paintPanel(); return r; };
      }
    } catch (e) { }
    if (!StorageManager.__srsWrapped) {   // "Reset dữ liệu": xoá luôn lịch SM-2 (kể cả bản trên cloud)
      StorageManager.__srsWrapped = true; var oc = StorageManager.clearAllAppData;
      StorageManager.clearAllAppData = function () {
        var r = oc.apply(this, arguments);
        try { StorageManager.remove(QKEY); var m = meta(); m.resetAt = Date.now(); m.daily = {}; saveMeta(m); invalidate(); if (Sync.uid) schedulePush(); } catch (e) { }
        return r;
      };
    }
  }

  function boot() {
    css(); injectPanel(); hook();
    var a = Env.auth();
    if (a && a.onAuthStateChanged) a.onAuthStateChanged(function (u) { if (u) syncStart(u); else syncStop(); });
    else { var n = 0, iv = setInterval(function () { var u = Env.user(); if (u) { clearInterval(iv); syncStart(u); } else if (++n > 60) clearInterval(iv); }, 1000); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.SRS = {
    sm2: sm2, preview: preview, levelOf: levelOf, today: today, dayOf: dayOf, dueLabel: dueLabel, fmtIv: fmtIv, cfg: cfg,
    registerProvider: registerProvider, load: load, start: start, invalidate: invalidate, noteDone: noteDone, dueCount: dueCount,
    refreshPanel: paintPanel
  };
})();
