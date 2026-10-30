/* ============================================================================
   flashcard.js — "Flashcard" cho Website Ôn thi Cao học NEU
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng cuối <body> của index.html (sau tailieu.js):
       <script src="flashcard.js"></script>
   Không sửa file nào khác. Module tự chèn nút Sidebar "Flashcard" + view mới,
   tự "wrap" UIManager.navigate và CloudSync.teardown (cùng kỹ thuật tailieu.js).

   DỮ LIỆU (riêng từng tài khoản):
     users/{uid}/flashDecks/{deckId}            { name, subject, topic, total, mastered, createdAt, updatedAt }
     users/{uid}/flashDecks/{deckId}/cards/{id} { q, a, lv, rv, lt, ca }
       lv: 0 mới · 1 chưa thuộc · 2 hơi nhớ · 3 đã thuộc

   ‼️ CẦN THÊM FIRESTORE RULES (trong khối match /databases/.../documents):
     match /users/{uid}/flashDecks/{deckId} {
       allow read, write: if isAllowed() && request.auth.uid == uid;
       match /cards/{cardId} {
         allow read, write: if isAllowed() && request.auth.uid == uid;
       }
     }
   ========================================================================== */
(function () {
  'use strict';
  if (window.Flashcard) return;

  /* ---------- tiện ích ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); };
  var debounce = function (fn, w) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, w); }; };
  var uniq = function (a) { var o = {}; a.forEach(function (x) { if (x) o[x] = 1; }); return Object.keys(o).sort(function (x, y) { return x.localeCompare(y, 'vi'); }); };
  var shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

  // Biến const của index.html không nằm trên window → đọc bằng typeof.
  var Env = {
    db: function () { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; },
    auth: function () { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; },
    ui: function () { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; },
    user: function () { var a = this.auth(); return (a && a.currentUser) || null; }
  };
  var FV = function () { return firebase.firestore.FieldValue; };
  function toast(type, t, m) { var u = Env.ui(); if (u && u.toast) u.toast(type, t, m || ''); }
  function confirmBox(t, m, ok) { var u = Env.ui(); if (u && u.confirm) u.confirm(t, m, ok); else if (confirm(t + '\n' + m)) ok(); }

  var LV = { 0: ['Mới', '#8fa9c4'], 1: ['Chưa thuộc', 'var(--danger,#ef4444)'], 2: ['Hơi nhớ', 'var(--warning,#f59e0b)'], 3: ['Đã thuộc', 'var(--success,#16c784)'] };

  /* ---------- state ---------- */
  var S = {
    started: false, uid: null, decks: new Map(), cards: [], unsubs: [], unCards: null,
    view: 'list', deckId: null, f: { q: '', subject: '', topic: '' }, cq: '', sess: null, shuffle: true, pending: null
  };
  var dRef = function () { return Env.db().collection('users').doc(S.uid).collection('flashDecks'); };
  var cRef = function (id) { return dRef().doc(id).collection('cards'); };
  function onErr(err) {
    console.error('[Flashcard]', err);
    var r = $('#fcRoot');
    if (err && err.code === 'permission-denied' && r && !$('#fcPerm')) r.insertAdjacentHTML('afterbegin', '<div id="fcPerm" class="fc-banner"><b><i class="fa-solid fa-triangle-exclamation"></i> Firestore từ chối quyền truy cập.</b> Hãy thêm Rules cho users/{uid}/flashDecks (xem đầu file flashcard.js) rồi tải lại trang.</div>');
  }

  function start() {
    if (S.started) return;
    var u = Env.user(); if (!u || !Env.db()) return;
    S.started = true; S.uid = u.uid;
    S.unsubs.push(dRef().onSnapshot(function (s) {
      S.decks = new Map(s.docs.map(function (d) { return [d.id, Object.assign({ id: d.id }, d.data())]; }));
      schedule();
    }, onErr));
  }
  function stop() {
    S.unsubs.forEach(function (f) { try { f(); } catch (e) { } }); S.unsubs = [];
    if (S.unCards) { S.unCards(); S.unCards = null; }
    S.started = false; S.decks = new Map(); S.cards = []; S.view = 'list'; S.deckId = null; S.sess = null;
  }

  /* ---------- thao tác dữ liệu ---------- */
  function saveDeck(m, id) {
    var d = { name: m.name, subject: m.subject, topic: m.topic, updatedAt: Date.now() };
    if (id) return dRef().doc(id).update(d).then(function () { return id; });
    d.createdAt = Date.now(); d.total = 0; d.mastered = 0;
    var ref = dRef().doc(); return ref.set(d).then(function () { return ref.id; });
  }
  async function deleteDeck(id) {
    for (;;) {
      var sn = await cRef(id).limit(400).get(); if (sn.empty) break;
      var b = Env.db().batch(); sn.docs.forEach(function (d) { b.delete(d.ref); }); await b.commit();
    }
    await dRef().doc(id).delete();
  }
  function addCard(id, q, a) { return cRef(id).add({ q: q, a: a, lv: 0, rv: 0, lt: 0, ca: Date.now() }); }
  async function importRows(id, rows, onProg) {
    var base = Date.now();
    for (var i = 0; i < rows.length; i += 400) {
      var b = Env.db().batch();
      rows.slice(i, i + 400).forEach(function (r, k) { b.set(cRef(id).doc(), { q: r[0], a: r[1], lv: 0, rv: 0, lt: 0, ca: base + i + k }); });
      await b.commit(); if (onProg) onProg(Math.min(rows.length, i + 400));
    }
  }
  // Đồng bộ bộ đếm của bộ thẻ theo dữ liệu thật mỗi khi mở bộ thẻ
  function syncCounters() {
    var d = S.decks.get(S.deckId); if (!d) return;
    var m = S.cards.filter(function (c) { return c.lv === 3; }).length;
    if (d.total !== S.cards.length || d.mastered !== m) dRef().doc(d.id).update({ total: S.cards.length, mastered: m }).catch(function () { });
  }
  function openDeck(id, thenStudy) {
    if (S.unCards) { S.unCards(); S.unCards = null; }
    S.view = 'deck'; S.deckId = id; S.cards = []; S.cq = ''; S.pending = thenStudy || null; S.sess = null;
    render();
    S.unCards = cRef(id).orderBy('ca', 'asc').onSnapshot(function (s) {
      S.cards = s.docs.map(function (d) { var x = d.data(); x.id = d.id; x.lv = x.lv || 0; return x; });
      syncCounters();
      if (S.pending) { var m = S.pending; S.pending = null; startStudy(m); return; }
      if (S.view === 'deck') paintDeck();
    }, onErr);
  }
  function goList() {
    if (S.unCards) { S.unCards(); S.unCards = null; }
    S.view = 'list'; S.deckId = null; S.cards = []; S.sess = null; render();
  }

  /* ---------- CSS ---------- */
  function css() {
    if ($('#fcStyles')) return;
    var s = document.createElement('style'); s.id = 'fcStyles';
    s.textContent = [
      '.fc-banner{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:var(--danger);border-radius:12px;padding:12px 16px;font-size:13px;margin-bottom:14px;line-height:1.5}',
      '.fc-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}',
      '.fc-search{flex:1 1 220px;display:flex;align-items:center;gap:8px;background:var(--card-bg);border:1.5px solid var(--card-border);border-radius:12px;padding:9px 14px}',
      '.fc-search input{border:0;background:transparent;outline:0;width:100%;font-size:13.5px;color:var(--text-main)}.fc-search i{color:var(--text-muted)}',
      '.fc-stats{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--text-muted);margin-bottom:14px}.fc-stats b{color:var(--text-main);font-size:15px}',
      '.fc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}',
      '.fc-deck{padding:16px;display:flex;flex-direction:column;gap:9px;cursor:pointer}',
      '.fc-deck h4{font-size:15px;font-weight:800;word-break:break-word}.fc-path{font-size:12px;color:var(--text-muted)}',
      '.fc-meta{display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)}',
      '.fc-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:8px}',
      '.fc-head{padding:18px;margin-bottom:14px}.fc-head h3{font-size:18px;font-weight:800}',
      '.fc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.fc-item{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;margin-bottom:8px}.fc-item .t{flex:1;min-width:0;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.fc-item .t b{display:block;margin-bottom:3px}.fc-item .t span{color:var(--text-muted)}',
      '.fc-tag{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:20px;color:#fff;white-space:nowrap;flex-shrink:0}',
      '.fc-study{max-width:680px;margin:0 auto}.fc-scene{perspective:1400px;margin:16px 0}',
      '.fc-card{position:relative;height:320px;transform-style:preserve-3d;transition:transform .5s cubic-bezier(.4,0,.2,1);cursor:pointer}.fc-card.flip{transform:rotateY(180deg)}',
      '.fc-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:var(--radius-lg,22px);border:1.5px solid var(--card-border);background:var(--card-bg-solid);box-shadow:var(--shadow-md);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;overflow:auto}',
      '.fc-back{transform:rotateY(180deg);background:linear-gradient(135deg,rgba(20,120,212,.12),rgba(6,182,212,.12)),var(--card-bg-solid)}',
      '.fc-lbl{position:absolute;top:14px;left:18px;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--accent)}',
      '.fc-txt{font-size:20px;font-weight:700;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:100%}',
      '.fc-hint{position:absolute;bottom:12px;font-size:11.5px;color:var(--text-muted)}',
      '.fc-rate{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;opacity:.35;pointer-events:none;transition:.2s}.fc-rate.on{opacity:1;pointer-events:auto}',
      '.fc-rate button{padding:12px 6px;border-radius:14px;font-weight:800;font-size:13.5px;color:#fff}.fc-rate small{display:block;font-weight:600;opacity:.85;font-size:10.5px}',
      '.fc-sum{text-align:center;padding:34px 20px}.fc-sum .big{font-size:42px;margin-bottom:6px}.fc-sum .row{display:flex;justify-content:center;gap:22px;margin:16px 0;font-size:13px;color:var(--text-muted)}.fc-sum .row b{display:block;font-size:22px}',
      '.fc-ov{position:fixed;inset:0;z-index:9000;background:rgba(3,19,36,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.fc-modal{background:var(--card-bg-solid);color:var(--text-main);border:1px solid var(--card-border);border-radius:20px;box-shadow:var(--shadow-lg);width:100%;max-width:520px;max-height:90vh;overflow:auto;padding:24px}.fc-modal.wide{max-width:680px}',
      '.fc-modal h3{font-size:17px;font-weight:800;margin-bottom:14px}',
      '.fc-f{margin-bottom:12px}.fc-f label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:5px}',
      '.fc-f input[type=text],.fc-f textarea,.fc-f select{width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.04);color:var(--text-main);font:inherit;font-size:13.5px}.fc-f textarea{resize:vertical;min-height:90px}',
      '.fc-note{font-size:12.5px;line-height:1.6;background:rgba(20,120,212,.07);border-radius:10px;padding:10px 12px;margin-bottom:12px;color:var(--text-main)}',
      '.fc-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
      '.fc-prev{max-height:230px;overflow:auto;margin-top:10px;font-size:12.5px}.fc-prev table{width:100%;border-collapse:collapse}.fc-prev td,.fc-prev th{border-bottom:1px solid var(--card-border);padding:6px 8px;text-align:left;vertical-align:top}.fc-prev th{color:var(--text-muted);font-size:11px;text-transform:uppercase}',
      '@media(max-width:560px){.fc-card{height:280px}.fc-txt{font-size:17px}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- DOM ---------- */
  function injectDom() {
    if (!$('.nav-item[data-view="flashcard"]')) {
      var anchor = $('.nav-item[data-view="tailieu"]') || $('.nav-item[data-view="parts"]') || $('.nav-item[data-view="quiz"]');
      var btn = document.createElement('button'); btn.className = 'nav-item'; btn.dataset.view = 'flashcard';
      btn.innerHTML = '<i class="fa-solid fa-clone"></i> Flashcard';
      if (anchor) anchor.insertAdjacentElement('afterend', btn); else { var nav = $('.sidebar-nav'); if (nav) nav.appendChild(btn); }
      // UIManager.init() (sau đăng nhập) tự gắn click cho nút này; chỉ gắn tay nếu app đã khởi tạo xong.
      if (window.__appInitialized) btn.addEventListener('click', function () { var u = Env.ui(); if (u) u.navigate('flashcard'); });
    }
    if (!$('#view-flashcard')) {
      var main = $('main.content'); if (!main) return;
      var sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-flashcard';
      sec.innerHTML = '<div id="fcRoot"></div>'; main.appendChild(sec);
    }
  }

  var rt;
  function schedule() {
    clearTimeout(rt);
    rt = setTimeout(function () {
      var v = $('#view-flashcard'); if (!v || !v.classList.contains('active')) return;
      if (S.view === 'list') { if (document.activeElement && document.activeElement.id === 'fcQ') drawGrid(); else renderList(); }
      else if (S.view === 'deck') paintDeck();
    }, 100);
  }
  function render() {
    if (!$('#fcRoot')) return;
    if (S.view === 'list') renderList(); else if (S.view === 'deck') renderDeck(); else renderStudy();
    window.scrollTo({ top: 0 });
  }
  var opts = function (list, cur, first) { return '<option value="">' + first + '</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); };
  var pctOf = function (d) { return d.total ? Math.round((d.mastered || 0) / d.total * 100) : 0; };

  /* ---------- DANH SÁCH BỘ THẺ ---------- */
  function renderList() {
    var root = $('#fcRoot'), f = S.f, decks = Array.from(S.decks.values());
    var subjects = uniq(decks.map(function (d) { return d.subject; }));
    var topics = uniq(decks.filter(function (d) { return !f.subject || d.subject === f.subject; }).map(function (d) { return d.topic; }));
    var perm = $('#fcPerm') ? $('#fcPerm').outerHTML : '';
    root.innerHTML = perm +
      '<div class="section-head"><div><h2><i class="fa-solid fa-clone"></i> Flashcard</h2><p>Tạo thẻ ghi nhớ, lật thẻ và ôn lại những thẻ chưa thuộc</p></div>' +
      '<div class="fc-row"><button class="btn btn-outline btn-sm" data-act="importnew"><i class="fa-solid fa-file-import"></i> Nhập từ file</button><button class="btn btn-primary btn-sm" data-act="newdeck"><i class="fa-solid fa-plus"></i> Bộ thẻ mới</button></div></div>' +
      '<div id="fcStats" class="fc-stats"></div>' +
      '<div class="fc-bar"><div class="fc-search"><i class="fa-solid fa-magnifying-glass"></i><input id="fcQ" type="text" placeholder="Tìm bộ thẻ..." value="' + esc(f.q) + '" autocomplete="off"></div>' +
      '<select class="select-box" id="fcSubj">' + opts(subjects, f.subject, 'Tất cả môn học') + '</select><select class="select-box" id="fcTopic">' + opts(topics, f.topic, 'Tất cả chủ đề') + '</select></div><div id="fcGrid"></div>';
    drawGrid();
  }
  function drawGrid() {
    var grid = $('#fcGrid'); if (!grid) return;
    var f = S.f, q = norm(f.q), all = Array.from(S.decks.values());
    var tc = all.reduce(function (s, d) { return s + (d.total || 0); }, 0), tm = all.reduce(function (s, d) { return s + (d.mastered || 0); }, 0);
    $('#fcStats').innerHTML = '<span><b>' + all.length + '</b> bộ thẻ</span><span><b>' + tc + '</b> thẻ</span><span><b>' + tm + '</b> đã thuộc' + (tc ? ' (' + Math.round(tm / tc * 100) + '%)' : '') + '</span>';
    var list = all.filter(function (d) {
      return (!f.subject || d.subject === f.subject) && (!f.topic || d.topic === f.topic) &&
        (!q || norm([d.name, d.subject, d.topic].join(' ')).indexOf(q) > -1);
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    grid.innerHTML = list.length ? '<div class="fc-grid">' + list.map(function (d) {
      var p = pctOf(d), path = [d.subject, d.topic].filter(Boolean).map(esc).join(' › ') || '<i>Chưa phân loại</i>';
      return '<div class="card fc-deck" data-open="' + d.id + '"><h4>' + esc(d.name) + '</h4><div class="fc-path">' + path + '</div>' +
        '<div><div class="fc-meta"><span>' + (d.total || 0) + ' thẻ</span><span>' + p + '% đã thuộc</span></div><div class="progress-track" style="margin-top:6px"><div class="progress-fill" style="width:' + p + '%"></div></div></div>' +
        '<div class="fc-acts"><button class="btn btn-primary btn-sm" data-study="' + d.id + '"' + (d.total ? '' : ' disabled') + '><i class="fa-solid fa-play"></i> Học</button>' +
        '<button class="btn btn-outline btn-sm" data-dedit="' + d.id + '"><i class="fa-solid fa-pen"></i></button><button class="btn btn-ghost btn-sm" data-ddel="' + d.id + '"><i class="fa-solid fa-trash"></i></button></div></div>';
    }).join('') + '</div>' : '<div class="empty-state"><i class="fa-solid fa-clone"></i><p>' + (S.decks.size ? 'Không có bộ thẻ phù hợp' : 'Chưa có bộ thẻ nào. Bấm "Bộ thẻ mới" hoặc "Nhập từ file" để bắt đầu.') + '</p></div>';
  }

  /* ---------- CHI TIẾT BỘ THẺ ---------- */
  function renderDeck() {
    var perm = $('#fcPerm') ? $('#fcPerm').outerHTML : '';
    $('#fcRoot').innerHTML = perm + '<div id="fcHead"></div>' +
      '<div class="fc-bar"><div class="fc-search"><i class="fa-solid fa-magnifying-glass"></i><input id="fcCQ" type="text" placeholder="Tìm trong bộ thẻ..." value="' + esc(S.cq) + '" autocomplete="off"></div></div><div id="fcCards"></div>';
    paintDeck();
  }
  function paintDeck() {
    var d = S.decks.get(S.deckId), head = $('#fcHead'); if (!head) return;
    if (!d) { if (S.decks.size || S.started) goList(); return; }
    var total = S.cards.length, m = S.cards.filter(function (c) { return c.lv === 3; }).length, weak = total - m, p = total ? Math.round(m / total * 100) : 0;
    head.innerHTML = '<div class="card fc-head"><button class="btn btn-outline btn-sm" data-act="back" style="margin-bottom:10px"><i class="fa-solid fa-arrow-left"></i> Danh sách bộ thẻ</button>' +
      '<h3>' + esc(d.name) + '</h3><div class="fc-path">' + ([d.subject, d.topic].filter(Boolean).map(esc).join(' › ') || '<i>Chưa phân loại</i>') + '</div>' +
      '<div class="fc-meta" style="margin:12px 0 6px"><span>' + total + ' thẻ · ' + m + ' đã thuộc · ' + weak + ' chưa thuộc</span><span>' + p + '%</span></div><div class="progress-track"><div class="progress-fill" style="width:' + p + '%"></div></div>' +
      '<div class="fc-row" style="margin-top:14px"><button class="btn btn-primary btn-sm" data-mode="weak"' + (weak ? '' : ' disabled') + '><i class="fa-solid fa-rotate-left"></i> Ôn thẻ chưa thuộc (' + weak + ')</button>' +
      '<button class="btn btn-outline btn-sm" data-mode="all"' + (total ? '' : ' disabled') + '><i class="fa-solid fa-play"></i> Học tất cả</button>' +
      '<button class="btn btn-outline btn-sm" data-act="addcard"><i class="fa-solid fa-plus"></i> Thêm thẻ</button><button class="btn btn-outline btn-sm" data-act="importdeck"><i class="fa-solid fa-file-import"></i> Nhập file</button>' +
      '<button class="btn btn-ghost btn-sm" data-dedit="' + d.id + '"><i class="fa-solid fa-pen"></i> Sửa bộ thẻ</button></div></div>';
    var q = norm(S.cq), list = S.cards.filter(function (c) { return !q || norm(c.q + ' ' + c.a).indexOf(q) > -1; }), box = $('#fcCards');
    var shown = list.slice(0, 200);
    box.innerHTML = shown.length ? shown.map(function (c) {
      var l = LV[c.lv] || LV[0];
      return '<div class="card fc-item"><span class="fc-tag" style="background:' + l[1] + '">' + l[0] + '</span><div class="t"><b>' + esc(c.q) + '</b><span>' + esc(c.a) + '</span></div>' +
        '<button class="btn btn-outline btn-sm" data-cedit="' + c.id + '"><i class="fa-solid fa-pen"></i></button><button class="btn btn-ghost btn-sm" data-cdel="' + c.id + '"><i class="fa-solid fa-trash"></i></button></div>';
    }).join('') + (list.length > 200 ? '<div class="fc-path" style="text-align:center">Hiển thị 200/' + list.length + ' thẻ — dùng ô tìm kiếm để lọc.</div>' : '')
      : '<div class="empty-state"><i class="fa-solid fa-clone"></i><p>' + (S.cards.length ? 'Không tìm thấy thẻ nào' : 'Bộ thẻ còn trống. Bấm "Thêm thẻ" hoặc "Nhập file".') + '</p></div>';
  }

  /* ---------- HỌC TẬP ---------- */
  function startStudy(mode) {
    var cards = S.cards.filter(function (c) { return mode === 'all' || c.lv < 3; });
    if (!cards.length) { S.view = 'deck'; render(); return toast('warn', 'Không có thẻ để học', 'Tất cả thẻ đã thuộc hoặc bộ thẻ trống'); }
    var q = S.shuffle ? shuffle(cards) : cards;
    S.sess = { mode: mode, queue: q.map(function (c) { return c.id; }), total: q.length, done: 0, flipped: false, stats: { 1: 0, 2: 0, 3: 0 } };
    S.view = 'study'; render();
  }
  function cardById(id) { return S.cards.filter(function (c) { return c.id === id; })[0]; }
  function renderStudy() {
    var s = S.sess, root = $('#fcRoot'), d = S.decks.get(S.deckId);
    if (!s || !s.queue.length) return renderSummary();
    var c = cardById(s.queue[0]);
    if (!c) { s.queue.shift(); return renderStudy(); }
    var p = Math.round(s.done / s.total * 100);
    root.innerHTML = '<div class="fc-study"><div class="fc-row" style="justify-content:space-between"><button class="btn btn-outline btn-sm" data-act="exit"><i class="fa-solid fa-xmark"></i> Thoát</button>' +
      '<b style="font-size:13px">' + esc(d ? d.name : '') + '</b><label class="fc-path" style="cursor:pointer"><input type="checkbox" id="fcShuf"' + (S.shuffle ? ' checked' : '') + '> Xáo trộn</label></div>' +
      '<div class="fc-meta" style="margin:14px 0 6px"><span>Còn ' + s.queue.length + ' thẻ</span><span>' + s.done + '/' + s.total + '</span></div><div class="progress-track"><div class="progress-fill" style="width:' + p + '%"></div></div>' +
      '<div class="fc-scene"><div class="fc-card" data-act="flip"><div class="fc-face"><span class="fc-lbl">Câu hỏi</span><div class="fc-txt">' + esc(c.q) + '</div><span class="fc-hint">Bấm hoặc nhấn Space để lật</span></div>' +
      '<div class="fc-face fc-back"><span class="fc-lbl">Đáp án</span><div class="fc-txt">' + esc(c.a) + '</div></div></div></div>' +
      '<div class="fc-rate" id="fcRate"><button style="background:var(--danger,#ef4444)" data-lv="1">Chưa thuộc<small>phím 1 · học lại sớm</small></button>' +
      '<button style="background:var(--warning,#f59e0b)" data-lv="2">Hơi nhớ<small>phím 2</small></button><button style="background:var(--success,#16c784)" data-lv="3">Đã thuộc<small>phím 3</small></button></div></div>';
    s.flipped = false;
  }
  function flip() {
    var s = S.sess; if (!s || S.view !== 'study') return;
    s.flipped = !s.flipped; var c = $('.fc-card'), r = $('#fcRate');
    if (c) c.classList.toggle('flip', s.flipped); if (r) r.classList.toggle('on', s.flipped);
  }
  function rate(lv) {
    var s = S.sess; if (!s || !s.flipped) return;
    var id = s.queue.shift(), c = cardById(id); if (!c) return renderStudy();
    c.lv = lv; s.stats[lv]++;
    cRef(S.deckId).doc(id).update({ lv: lv, rv: FV().increment(1), lt: Date.now() }).catch(onErr);
    if (lv === 1) s.queue.splice(Math.min(3, s.queue.length), 0, id); else s.done++;
    renderStudy();
  }
  function renderSummary() {
    var s = S.sess, st = s ? s.stats : { 1: 0, 2: 0, 3: 0 }, weak = S.cards.filter(function (c) { return c.lv < 3; }).length;
    $('#fcRoot').innerHTML = '<div class="card fc-sum fc-study"><div class="big">🎉</div><h3>Hoàn thành lượt học!</h3>' +
      '<div class="row"><span><b style="color:var(--success)">' + st[3] + '</b>Đã thuộc</span><span><b style="color:var(--warning)">' + st[2] + '</b>Hơi nhớ</span><span><b style="color:var(--danger)">' + st[1] + '</b>Lượt chưa thuộc</span></div>' +
      '<div class="fc-row" style="justify-content:center"><button class="btn btn-primary" data-mode="weak"' + (weak ? '' : ' disabled') + '><i class="fa-solid fa-rotate-left"></i> Ôn thẻ chưa thuộc (' + weak + ')</button>' +
      '<button class="btn btn-outline" data-mode="all"><i class="fa-solid fa-play"></i> Học lại tất cả</button><button class="btn btn-outline" data-act="exit">Về bộ thẻ</button></div></div>';
    S.sess = null;
  }

  /* ---------- MODAL + FORM ---------- */
  function modal(html, wide) {
    var ov = document.createElement('div'); ov.className = 'fc-ov';
    ov.innerHTML = '<div class="fc-modal' + (wide ? ' wide' : '') + '">' + html + '</div>'; document.body.appendChild(ov);
    var k = function (e) { if (e.key === 'Escape') close(); }, close = function () { document.removeEventListener('keydown', k); ov.remove(); };
    document.addEventListener('keydown', k); ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    return { el: ov, close: close };
  }
  var dl = function (id, arr) { return '<datalist id="' + id + '">' + arr.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; };
  function deckFields(d) {
    d = d || {}; var decks = Array.from(S.decks.values());
    return '<div class="fc-f"><label>Tên bộ thẻ *</label><input type="text" id="fcdName" maxlength="120" value="' + esc(d.name || '') + '" placeholder="VD: Thuật ngữ Kinh tế vi mô"></div>' +
      '<div class="fc-f"><label>Môn học</label><input type="text" id="fcdSubj" list="fcDlS" maxlength="80" value="' + esc(d.subject || '') + '" placeholder="VD: Kinh tế vi mô"></div>' +
      '<div class="fc-f"><label>Chủ đề</label><input type="text" id="fcdTopic" list="fcDlT" maxlength="80" value="' + esc(d.topic || '') + '" placeholder="VD: Cung - cầu"></div>' +
      dl('fcDlS', uniq(decks.map(function (x) { return x.subject; }))) + dl('fcDlT', uniq(decks.map(function (x) { return x.topic; })));
  }
  function readDeck(el) { return { name: $('#fcdName', el).value.trim(), subject: $('#fcdSubj', el).value.trim(), topic: $('#fcdTopic', el).value.trim() }; }

  function openDeckForm(id) {
    var d = id ? S.decks.get(id) : null;
    var m = modal('<h3>' + (d ? 'Sửa bộ thẻ' : 'Bộ thẻ mới') + '</h3>' + deckFields(d) + '<div class="fc-actions"><button class="btn btn-outline" id="fcNo">Hủy</button><button class="btn btn-primary" id="fcOk"><i class="fa-solid fa-check"></i> Lưu</button></div>');
    $('#fcNo', m.el).onclick = m.close; $('#fcdName', m.el).focus();
    $('#fcOk', m.el).onclick = async function () {
      var v = readDeck(m.el); if (!v.name) return toast('warn', 'Thiếu tên bộ thẻ');
      this.disabled = true;
      try { var nid = await saveDeck(v, id); m.close(); toast('success', 'Đã lưu', v.name); if (!d) openDeck(nid); }
      catch (e) { toast('error', 'Lưu thất bại', e.message); this.disabled = false; }
    };
  }
  function openCardForm(cid) {
    var c = cid ? cardById(cid) : null;
    var m = modal('<h3>' + (c ? 'Sửa thẻ' : 'Thêm thẻ') + '</h3><div class="fc-f"><label>Câu hỏi (mặt trước) *</label><textarea id="fcQin" maxlength="1000">' + esc(c ? c.q : '') + '</textarea></div>' +
      '<div class="fc-f"><label>Đáp án (mặt sau) *</label><textarea id="fcAin" maxlength="2000">' + esc(c ? c.a : '') + '</textarea></div>' +
      '<div class="fc-path">Mẹo: Ctrl + Enter để lưu nhanh.</div><div class="fc-actions"><button class="btn btn-outline" id="fcNo">Đóng</button>' +
      (c ? '' : '<button class="btn btn-outline" id="fcNext"><i class="fa-solid fa-plus"></i> Lưu & thêm tiếp</button>') + '<button class="btn btn-primary" id="fcOk"><i class="fa-solid fa-check"></i> Lưu</button></div>');
    var q = $('#fcQin', m.el), a = $('#fcAin', m.el); q.focus(); $('#fcNo', m.el).onclick = m.close;
    var save = async function (more) {
      var qv = q.value.trim(), av = a.value.trim(); if (!qv || !av) return toast('warn', 'Thiếu nội dung', 'Cần nhập cả câu hỏi và đáp án');
      try {
        if (c) await cRef(S.deckId).doc(c.id).update({ q: qv, a: av }); else await addCard(S.deckId, qv, av);
        if (more) { q.value = ''; a.value = ''; q.focus(); toast('success', 'Đã thêm thẻ'); } else { m.close(); toast('success', 'Đã lưu thẻ'); }
      } catch (e) { toast('error', 'Lưu thất bại', e.message); }
    };
    $('#fcOk', m.el).onclick = function () { save(false); }; var nx = $('#fcNext', m.el); if (nx) nx.onclick = function () { save(true); };
    m.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(!c); } });
  }

  /* ---------- NHẬP FILE ---------- */
  var TPL = [['Câu hỏi', 'Đáp án'], ['GDP là viết tắt của cụm từ nào?', 'Gross Domestic Product (Tổng sản phẩm quốc nội)'], ['Thủ đô của Việt Nam là gì?', 'Hà Nội']];
  function downloadTpl(type) {
    if (type === 'xlsx') {
      if (typeof XLSX === 'undefined') return toast('error', 'Thiếu thư viện Excel');
      var ws = XLSX.utils.aoa_to_sheet(TPL); ws['!cols'] = [{ wch: 50 }, { wch: 60 }];
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Flashcard'); XLSX.writeFile(wb, 'mau-flashcard.xlsx');
    } else {
      var csv = '\uFEFF' + TPL.map(function (r) { return r.map(function (v) { return '"' + v.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'mau-flashcard.csv'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    }
  }
  function parseFile(file) {
    return new Promise(function (res, rej) {
      if (typeof XLSX === 'undefined') return rej(new Error('Thiếu thư viện đọc Excel (SheetJS)'));
      var csv = /\.(csv|txt)$/i.test(file.name);
      if (!csv && !/\.xlsx?$/i.test(file.name)) return rej(new Error('Chỉ hỗ trợ file .xlsx, .xls hoặc .csv'));
      if (file.size > 5 * 1048576) return rej(new Error('File quá lớn (tối đa 5MB)'));
      var r = new FileReader(); r.onerror = function () { rej(new Error('Không đọc được file')); };
      r.onload = function () {
        try {
          var wb = csv ? XLSX.read(r.result, { type: 'string' }) : XLSX.read(new Uint8Array(r.result), { type: 'array' });
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
          if (rows.length && /câu hỏi|cau hoi|question|mặt trước|front/i.test(String(rows[0][0]))) rows.shift();
          var ok = [], bad = 0;
          rows.forEach(function (x) {
            var q = String(x[0] == null ? '' : x[0]).trim(), a = String(x[1] == null ? '' : x[1]).trim();
            if (!q && !a) return; if (!q || !a) { bad++; return; } ok.push([q.slice(0, 1000), a.slice(0, 2000)]);
          });
          if (ok.length > 2000) { bad += ok.length - 2000; ok = ok.slice(0, 2000); }
          res({ rows: ok, bad: bad });
        } catch (e) { rej(new Error('File không đúng định dạng: ' + e.message)); }
      };
      csv ? r.readAsText(file, 'UTF-8') : r.readAsArrayBuffer(file);
    });
  }
  function openImport(deckId) {
    var d = deckId ? S.decks.get(deckId) : null, parsed = null, fname = '';
    var m = modal('<h3><i class="fa-solid fa-file-import"></i> Nhập hàng loạt</h3>' +
      '<div class="fc-note"><b>Cách làm:</b> ① Tải file mẫu → ② điền <b>Câu hỏi</b> (cột A) và <b>Đáp án</b> (cột B), mỗi dòng 1 thẻ → ③ chọn file bên dưới và xem trước. Tối đa 2000 thẻ/lần.</div>' +
      '<div class="fc-row" style="margin-bottom:12px"><button class="btn btn-outline btn-sm" id="fcTx"><i class="fa-solid fa-file-excel"></i> Tải mẫu Excel</button><button class="btn btn-outline btn-sm" id="fcTc"><i class="fa-solid fa-file-csv"></i> Tải mẫu CSV</button></div>' +
      (d ? '<div class="fc-f"><label>Nhập vào bộ thẻ</label><b>' + esc(d.name) + '</b></div>' : deckFields()) +
      '<div class="fc-f"><label>Chọn file đã điền (.xlsx, .xls, .csv)</label><input type="file" id="fcFile" accept=".xlsx,.xls,.csv"></div><div id="fcPrev"></div>' +
      '<div class="fc-actions"><button class="btn btn-outline" id="fcNo">Hủy</button><button class="btn btn-primary" id="fcGo" disabled><i class="fa-solid fa-cloud-arrow-up"></i> Nhập</button></div>', true);
    $('#fcNo', m.el).onclick = m.close; $('#fcTx', m.el).onclick = function () { downloadTpl('xlsx'); }; $('#fcTc', m.el).onclick = function () { downloadTpl('csv'); };
    var prev = $('#fcPrev', m.el), go = $('#fcGo', m.el);
    $('#fcFile', m.el).onchange = async function () {
      var f = this.files[0]; parsed = null; go.disabled = true; if (!f) return;
      fname = f.name.replace(/\.[^.]+$/, ''); prev.innerHTML = '<div class="fc-path"><i class="fa-solid fa-spinner fa-spin"></i> Đang đọc file...</div>';
      try {
        parsed = await parseFile(f);
        if (!parsed.rows.length) { prev.innerHTML = '<div class="fc-banner">Không tìm thấy dòng hợp lệ nào. Kiểm tra lại cột A (câu hỏi) và cột B (đáp án).</div>'; return; }
        prev.innerHTML = '<div class="fc-note" style="margin:0 0 6px"><b>' + parsed.rows.length + '</b> thẻ hợp lệ' + (parsed.bad ? ' · bỏ qua <b>' + parsed.bad + '</b> dòng thiếu dữ liệu' : '') + '. Xem trước ' + Math.min(8, parsed.rows.length) + ' thẻ đầu:</div>' +
          '<div class="fc-prev"><table><tr><th>#</th><th>Câu hỏi</th><th>Đáp án</th></tr>' + parsed.rows.slice(0, 8).map(function (r, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></div>';
        go.disabled = false;
      } catch (e) { prev.innerHTML = '<div class="fc-banner">' + esc(e.message) + '</div>'; }
    };
    go.onclick = async function () {
      if (!parsed) return; var id = deckId;
      var v = d ? null : readDeck(m.el); if (v && !v.name) v.name = fname || 'Bộ thẻ nhập từ file';
      go.disabled = true;
      try {
        if (!id) id = await saveDeck(v);
        await importRows(id, parsed.rows, function (n) { go.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + n + '/' + parsed.rows.length; });
        m.close(); toast('success', 'Đã nhập ' + parsed.rows.length + ' thẻ'); if (!deckId) openDeck(id);
      } catch (e) { toast('error', 'Nhập thất bại', e.message); go.disabled = false; go.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Nhập'; }
    };
  }

  /* ---------- SỰ KIỆN ---------- */
  function wireRoot() {
    var root = $('#fcRoot'); if (!root || root.__wired) return; root.__wired = true;
    root.addEventListener('click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('[data-lv]'))) return rate(+el.dataset.lv);
      if ((el = t.closest('[data-mode]'))) { if (el.disabled) return; return S.view === 'study' || !S.sess ? startStudy(el.dataset.mode) : startStudy(el.dataset.mode); }
      if ((el = t.closest('[data-study]'))) { e.stopPropagation(); return openDeck(el.dataset.study, 'weak'); }
      if ((el = t.closest('[data-dedit]'))) { e.stopPropagation(); return openDeckForm(el.dataset.dedit); }
      if ((el = t.closest('[data-ddel]'))) {
        e.stopPropagation(); var d = S.decks.get(el.dataset.ddel); if (!d) return;
        return confirmBox('Xóa bộ thẻ?', '"' + d.name + '" và toàn bộ thẻ bên trong sẽ bị xóa vĩnh viễn.', function () { deleteDeck(d.id).then(function () { toast('success', 'Đã xóa', d.name); }).catch(function (er) { toast('error', 'Xóa thất bại', er.message); }); });
      }
      if ((el = t.closest('[data-cedit]'))) return openCardForm(el.dataset.cedit);
      if ((el = t.closest('[data-cdel]'))) { var id = el.dataset.cdel; return confirmBox('Xóa thẻ?', 'Thẻ này sẽ bị xóa vĩnh viễn.', function () { cRef(S.deckId).doc(id).delete().catch(function (er) { toast('error', 'Xóa thất bại', er.message); }); }); }
      if ((el = t.closest('[data-open]'))) return openDeck(el.dataset.open);
      if ((el = t.closest('[data-act]'))) {
        var a = el.dataset.act;
        if (a === 'flip') flip(); else if (a === 'back') goList();
        else if (a === 'newdeck') openDeckForm(); else if (a === 'importnew') openImport(null);
        else if (a === 'importdeck') openImport(S.deckId); else if (a === 'addcard') openCardForm();
        else if (a === 'exit') { S.view = 'deck'; S.sess = null; render(); }
      }
    });
    root.addEventListener('input', function (e) {
      if (e.target.id === 'fcQ') { S.f.q = e.target.value; drawGrid(); }
      else if (e.target.id === 'fcCQ') { S.cq = e.target.value; paintDeck(); }
    });
    root.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'fcSubj') { S.f.subject = e.target.value; S.f.topic = ''; renderList(); }
      else if (id === 'fcTopic') { S.f.topic = e.target.value; renderList(); }
      else if (id === 'fcShuf') S.shuffle = e.target.checked;
    });
  }
  // Phím tắt khi học: Space/Enter lật · 1/2/3 đánh giá
  document.addEventListener('keydown', function (e) {
    if (!S.sess || S.view !== 'study') return;
    var v = $('#view-flashcard'); if (!v || !v.classList.contains('active')) return;
    var t = e.target; if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === ' ' || e.key === 'Enter') { if (t && t.tagName === 'BUTTON') return; e.preventDefault(); flip(); }
    else if (S.sess.flipped && (e.key === '1' || e.key === '2' || e.key === '3')) { e.preventDefault(); rate(+e.key); }
  });

  /* ---------- MÓC VÀO VÒNG ĐỜI CÓ SẴN ---------- */
  function hook() {
    var ui = Env.ui();
    if (ui && !ui.__fcWrapped) {
      ui.__fcWrapped = true; ui.titles = ui.titles || {};
      ui.titles.flashcard = ['Flashcard', 'Tạo thẻ ghi nhớ, lật thẻ và ôn tập theo mức độ nhớ'];
      var orig = ui.navigate.bind(ui);
      ui.navigate = function (view) {
        var r = orig(view);
        if (view === 'flashcard') { start(); wireRoot(); render(); }
        return r;
      };
    }
    try {
      if (typeof CloudSync !== 'undefined' && CloudSync && !CloudSync.__fcWrapped) {
        CloudSync.__fcWrapped = true; var t = CloudSync.teardown.bind(CloudSync);
        CloudSync.teardown = function () { stop(); return t(); };
      }
    } catch (e) { }
  }

  function init() { css(); injectDom(); wireRoot(); hook(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Flashcard = { open: function () { var u = Env.ui(); if (u) u.navigate('flashcard'); } };
})();
