/* ============================================================================
   hightlight.js — Bút viết / Tô sáng / Giấy note / Tẩy / Hoàn tác cho "Tài liệu"
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng cuối <body> của index.html (sau tailieu.js):
       <script src="hightlight.js"></script>

   Cách hoạt động
   - Khi bạn mở 1 tài liệu trong mục "Tài liệu" (tailieu.js), file này phủ 1 lớp
     trong suốt (canvas + giấy note) lên khung xem tài liệu và hiện thanh công cụ nhỏ.
   - Tài liệu PDF/DOCX/XLSX nằm trong iframe nên không thể chọn chữ để tô trực tiếp;
     vì vậy "Tô sáng" là nét bút to, bán trong suốt. Lớp ghi chú đứng yên so với khung
     xem, dùng nút ‹ › để chuyển "trang ghi chú" (nên dùng cùng số trang đang đọc).
   - Chế độ "Cuộn" (bàn tay) cho phép cuộn/đọc tài liệu bình thường.

   Lưu trữ: localStorage (tức thì) + Firestore  users/{uid}/studyNotes/{docId}
   (tự lưu sau ~1,5 giây). Mỗi tài khoản & mỗi tài liệu có ghi chú riêng.

   ‼️ CẦN THÊM FIRESTORE RULES (trong khối match /databases/.../documents):
     match /users/{uid}/studyNotes/{id} {
       allow read, write: if request.auth != null && request.auth.uid == uid;
     }
   (Chưa thêm rule thì ghi chú vẫn lưu được trên trình duyệt này, chỉ chưa đồng bộ.)
   ========================================================================== */
(function () {
  'use strict';
  if (window.StudyHighlight) return;

  var COLORS = {
    pen: ['#111827', '#ef4444', '#2563eb', '#16a34a'],
    hl: ['#fde047', '#4ade80', '#60a5fa', '#f472b6']
  };
  var PEN_PX = 2.5, HL_PX = 18, ERASE_PX = 12, MAX_UNDO = 40, SAVE_DELAY = 1500, MAX_BYTES = 900000;

  var S = {
    key: null, uid: null, view: null, layer: null, canvas: null, ctx: null, notesBox: null,
    obs: null, ro: null, pages: {}, page: 1, tool: 'none', color: { pen: COLORS.pen[1], hl: COLORS.hl[0] },
    undo: [], cur: null, snapDone: false, timer: null, updatedAt: 0, raf: 0
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Môi trường (biến const của index.html không nằm trên window) ---------- */
  function DB() { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; }
  function AU() { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; }
  function toast(type, t, m) { try { if (typeof UIManager !== 'undefined' && UIManager.toast) UIManager.toast(type, t, m || ''); } catch (e) { } }
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return 'h_' + Math.abs(h).toString(36); }
  function docKey() {
    if (window.TaiLieu && typeof TaiLieu.current === 'function') { var id = TaiLieu.current(); if (id) return id; }
    var h = $('#tdRoot .section-head h2'); return h ? hash(h.textContent.trim()) : null; // dự phòng
  }

  /* ---------- CSS ---------- */
  function css() {
    if ($('#hlStyles')) return;
    var s = document.createElement('style'); s.id = 'hlStyles';
    s.textContent = [
      '.hl-layer{position:absolute;inset:0;z-index:5;pointer-events:none;overflow:hidden}',
      '.hl-cv{position:absolute;inset:0;width:100%;height:100%;touch-action:none;pointer-events:none}',
      '.hl-notes{position:absolute;inset:0;pointer-events:none}',
      '.hl-note{position:absolute;width:160px;background:#fff7b0;color:#1f2937;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.28);pointer-events:auto;display:flex;flex-direction:column}',
      '.hl-nh{display:flex;align-items:center;justify-content:space-between;padding:3px 6px;background:#fde047;border-radius:8px 8px 0 0;cursor:grab;touch-action:none;font-size:11px;color:#854d0e}',
      '.hl-nx{width:22px;height:22px;border-radius:50%;font-size:15px;line-height:1;color:#854d0e}.hl-nx:hover{background:rgba(0,0,0,.12)}',
      '.hl-note textarea{border:0;background:transparent;resize:none;outline:0;height:84px;padding:6px 8px;font:inherit;font-size:13px;color:#1f2937;user-select:text;-webkit-user-select:text}',
      '.hl-bar{position:fixed;left:calc(var(--sidebar-w,272px) + 16px);bottom:14px;z-index:850;display:flex;align-items:center;gap:4px;padding:5px 6px;max-width:calc(100vw - var(--sidebar-w,272px) - 110px);overflow-x:auto;background:var(--card-bg-solid,#fff);color:var(--text-main,#0b2540);border:1px solid var(--card-border,rgba(20,120,212,.2));border-radius:14px;box-shadow:var(--shadow-lg,0 10px 30px rgba(4,32,63,.25))}',
      '.hl-bar[hidden]{display:none}',
      '.hl-bar button{flex-shrink:0;width:36px;height:36px;border-radius:10px;font-size:15px;color:var(--text-muted,#5b7894);display:inline-flex;align-items:center;justify-content:center}',
      '.hl-bar button:hover{background:rgba(20,120,212,.12)}.hl-bar button.on{background:var(--accent,#1478d4);color:#fff}.hl-bar button:disabled{opacity:.35}',
      '.hl-sep{width:1px;height:22px;background:var(--card-border,rgba(20,120,212,.2));margin:0 3px;flex-shrink:0}',
      '.hl-sw{display:flex;gap:5px;align-items:center;padding:0 3px}.hl-sw i{width:20px;height:20px;border-radius:50%;border:2px solid transparent;box-shadow:0 0 0 1px rgba(0,0,0,.25);cursor:pointer;flex-shrink:0}.hl-sw i.on{border-color:var(--card-bg-solid,#fff);box-shadow:0 0 0 2px var(--accent,#1478d4)}',
      '.hl-pg{display:flex;align-items:center;gap:0;font-size:12.5px;font-weight:800;flex-shrink:0}.hl-pg button{width:26px}.hl-pg b{min-width:18px;text-align:center}',
      '.hl-st{font-size:11px;color:var(--text-muted,#5b7894);white-space:nowrap;padding:0 6px;flex-shrink:0}',
      '.hl-bar.min>*:not(#hlTog){display:none}',
      '@media(max-width:860px){.hl-bar{left:8px;max-width:calc(100vw - 92px);bottom:10px}}',
      '@media(pointer:coarse){.hl-bar button{width:40px;height:40px}.hl-sw i{width:24px;height:24px}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- Thanh công cụ ---------- */
  function buildBar() {
    if ($('#hlBar')) return;
    var b = document.createElement('div'); b.id = 'hlBar'; b.className = 'hl-bar'; b.hidden = true;
    b.innerHTML =
      '<button id="hlTog" title="Thu gọn / mở thanh công cụ"><i class="fa-solid fa-pen-ruler"></i></button>' +
      '<button data-t="none" title="Cuộn / xem tài liệu"><i class="fa-solid fa-hand"></i></button>' +
      '<button data-t="pen" title="Bút viết"><i class="fa-solid fa-pen"></i></button>' +
      '<button data-t="hl" title="Tô sáng"><i class="fa-solid fa-highlighter"></i></button>' +
      '<button data-t="note" title="Giấy note (chạm vào tài liệu để đặt)"><i class="fa-solid fa-note-sticky"></i></button>' +
      '<button data-t="eraser" title="Tẩy"><i class="fa-solid fa-eraser"></i></button>' +
      '<span class="hl-sep"></span><span class="hl-sw" id="hlSw"></span><span class="hl-sep"></span>' +
      '<button id="hlUndo" title="Hoàn tác (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>' +
      '<span class="hl-pg" title="Trang ghi chú"><button id="hlPrev"><i class="fa-solid fa-chevron-left"></i></button><b id="hlPgN">1</b><button id="hlNext"><i class="fa-solid fa-chevron-right"></i></button></span>' +
      '<span class="hl-st" id="hlSt"></span>';
    document.body.appendChild(b);
    b.addEventListener('click', function (e) {
      var t = e.target.closest('[data-t]'); if (t) { setTool(t.dataset.t); return; }
      var c = e.target.closest('[data-c]'); if (c) { S.color[S.tool] = c.dataset.c; drawSwatches(); return; }
      if (e.target.closest('#hlUndo')) undo();
      else if (e.target.closest('#hlPrev')) gotoPage(S.page - 1);
      else if (e.target.closest('#hlNext')) gotoPage(S.page + 1);
      else if (e.target.closest('#hlTog')) b.classList.toggle('min');
    });
    document.addEventListener('keydown', function (e) {
      if (!S.key || !(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key !== 'z' && e.key !== 'Z')) return;
      var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); undo();
    });
  }
  function drawSwatches() {
    var box = $('#hlSw'); if (!box) return;
    var list = COLORS[S.tool];
    box.style.display = list ? 'flex' : 'none';
    box.innerHTML = list ? list.map(function (c) { return '<i data-c="' + c + '" class="' + (S.color[S.tool] === c ? 'on' : '') + '" style="background:' + c + '"></i>'; }).join('') : '';
  }
  function setTool(t) {
    S.tool = t;
    $$('#hlBar [data-t]').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    if (S.canvas) { S.canvas.style.pointerEvents = t === 'none' ? 'none' : 'auto'; S.canvas.style.cursor = t === 'note' ? 'copy' : t === 'eraser' ? 'cell' : t === 'none' ? '' : 'crosshair'; }
    drawSwatches();
  }
  function status(t) { var s = $('#hlSt'); if (s) s.textContent = t || ''; }
  function updateUndoBtn() { var u = $('#hlUndo'); if (u) u.disabled = !S.undo.length; var n = $('#hlPgN'); if (n) n.textContent = S.page; var p = $('#hlPrev'); if (p) p.disabled = S.page <= 1; }

  /* ---------- Dữ liệu trang ---------- */
  function P(pg) { pg = String(pg || S.page); return S.pages[pg] || (S.pages[pg] = { s: [], n: [] }); }
  function snapshot() { S.undo.push({ pg: S.page, js: JSON.stringify(P()) }); if (S.undo.length > MAX_UNDO) S.undo.shift(); updateUndoBtn(); }
  function undo() {
    var a = S.undo.pop(); if (!a) return;
    S.pages[String(a.pg)] = JSON.parse(a.js); S.page = a.pg;
    redraw(); renderNotes(); updateUndoBtn(); scheduleSave();
  }
  function gotoPage(n) {
    n = Math.max(1, Math.min(999, n)); if (n === S.page) return;
    S.page = n; redraw(); renderNotes(); updateUndoBtn();
  }

  /* ---------- Canvas ---------- */
  function W() { return (S.layer && S.layer.clientWidth) || 1; }
  function resize() {
    if (!S.canvas || !S.layer) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = S.layer.clientWidth, h = S.layer.clientHeight;
    S.canvas.width = Math.round(w * dpr); S.canvas.height = Math.round(h * dpr);
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(); renderNotes(true);
  }
  function drawStroke(s) {
    var c = S.ctx, p = s.p, w = W(), i; if (!p.length) return;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = s.c; c.lineWidth = s.w * w; c.globalAlpha = s.t === 'hl' ? 0.4 : 1;
    c.beginPath(); c.moveTo(p[0] * w, p[1] * w);
    if (p.length <= 2) c.lineTo(p[0] * w + 0.01, p[1] * w);
    else {
      for (i = 2; i < p.length - 2; i += 2) c.quadraticCurveTo(p[i] * w, p[i + 1] * w, (p[i] + p[i + 2]) / 2 * w, (p[i + 1] + p[i + 3]) / 2 * w);
      c.lineTo(p[p.length - 2] * w, p[p.length - 1] * w);
    }
    c.stroke(); c.restore();
  }
  function redraw() {
    if (!S.ctx) return;
    S.ctx.clearRect(0, 0, S.layer.clientWidth, S.layer.clientHeight);
    P().s.forEach(drawStroke); if (S.cur) drawStroke(S.cur);
  }
  function redrawSoon() { if (!S.raf) S.raf = requestAnimationFrame(function () { S.raf = 0; redraw(); }); }
  function pos(e) { var r = S.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width, px: e.clientX - r.left, py: e.clientY - r.top }; }
  var r4 = function (v) { return Math.round(v * 10000) / 10000; };

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    var x = ax + t * dx - px, y = ay + t * dy - py; return Math.sqrt(x * x + y * y);
  }
  function hit(s, x, y, r) {
    var p = s.p, rr = r + s.w / 2;
    if (p.length <= 2) return Math.hypot(p[0] - x, p[1] - y) <= rr;
    for (var i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true;
    return false;
  }
  function eraseAt(x, y) {
    var r = ERASE_PX / W(), pg = P(), keep = pg.s.filter(function (s) { return !hit(s, x, y, r); });
    if (keep.length === pg.s.length) return;
    if (!S.snapDone) { snapshot(); S.snapDone = true; }
    pg.s = keep; redrawSoon(); scheduleSave();
  }

  function onDown(e) {
    if (S.tool === 'none' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); var p = pos(e);
    if (S.tool === 'note') { addNote(p); return; }
    try { S.canvas.setPointerCapture(e.pointerId); } catch (er) { }
    if (S.tool === 'eraser') { S.snapDone = false; S.erasing = true; eraseAt(p.x, p.y); return; }
    var w = S.tool === 'hl' ? HL_PX : PEN_PX;
    S.cur = { t: S.tool, c: S.color[S.tool], w: r4(w / W()), p: [r4(p.x), r4(p.y)], lx: p.px, ly: p.py };
    redrawSoon();
  }
  function onMove(e) {
    if (S.erasing) { var q = pos(e); eraseAt(q.x, q.y); return; }
    if (!S.cur) return; e.preventDefault();
    var p = pos(e);
    if (Math.hypot(p.px - S.cur.lx, p.py - S.cur.ly) < 1.5) return;
    S.cur.p.push(r4(p.x), r4(p.y)); S.cur.lx = p.px; S.cur.ly = p.py; redrawSoon();
  }
  function onUp() {
    S.erasing = false;
    if (!S.cur) return;
    var s = S.cur; S.cur = null; delete s.lx; delete s.ly;
    snapshot(); P().s.push(s); redraw(); scheduleSave();
  }

  /* ---------- Giấy note ---------- */
  function addNote(p) {
    snapshot();
    var w = W(), n = { id: 'n' + Date.now().toString(36), x: r4(Math.max(0, Math.min(p.px, w - 164)) / w), y: r4(Math.max(0, p.py - 14) / w), text: '' };
    P().n.push(n); renderNotes(); scheduleSave(); setTool('none');
    var ta = $('[data-id="' + n.id + '"] textarea', S.notesBox); if (ta) ta.focus();
  }
  function renderNotes() {
    if (!S.notesBox) return;
    var w = W(); S.notesBox.innerHTML = '';
    P().n.forEach(function (n) {
      var el = document.createElement('div'); el.className = 'hl-note'; el.dataset.id = n.id;
      el.style.left = n.x * w + 'px'; el.style.top = n.y * w + 'px';
      el.innerHTML = '<div class="hl-nh"><i class="fa-solid fa-grip"></i><button class="hl-nx" title="Xóa note">×</button></div><textarea placeholder="Nhập ghi chú..." maxlength="1000"></textarea>';
      var ta = $('textarea', el), hd = $('.hl-nh', el); ta.value = n.text || '';
      ta.addEventListener('input', function () { n.text = ta.value; scheduleSave(); });
      $('.hl-nx', el).addEventListener('click', function (ev) {
        ev.stopPropagation(); snapshot(); var pg = P(); pg.n = pg.n.filter(function (x) { return x.id !== n.id; }); renderNotes(); scheduleSave();
      });
      var drag = null;
      hd.addEventListener('pointerdown', function (ev) {
        if (ev.target.closest('.hl-nx')) return;
        ev.preventDefault(); try { hd.setPointerCapture(ev.pointerId); } catch (er) { }
        drag = { sx: ev.clientX, sy: ev.clientY, l: parseFloat(el.style.left), t: parseFloat(el.style.top), moved: false };
      });
      hd.addEventListener('pointermove', function (ev) {
        if (!drag) return;
        if (!drag.moved) { snapshot(); drag.moved = true; }
        var ww = W(), l = Math.max(0, Math.min(drag.l + ev.clientX - drag.sx, ww - el.offsetWidth)), t = Math.max(0, Math.min(drag.t + ev.clientY - drag.sy, S.layer.clientHeight - 30));
        el.style.left = l + 'px'; el.style.top = t + 'px'; n.x = r4(l / ww); n.y = r4(t / ww);
      });
      var end = function () { if (drag && drag.moved) scheduleSave(); drag = null; };
      hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
      S.notesBox.appendChild(el);
    });
  }

  /* ---------- Lưu / tải ---------- */
  function lsKey() { return 'examMasterPro_hl_' + (S.uid || 'guest') + '_' + S.key; }
  function payload() {
    var o = {}; Object.keys(S.pages).forEach(function (k) { var p = S.pages[k]; if (p.s.length || p.n.length) o[k] = p; });
    return JSON.stringify(o);
  }
  function scheduleSave() {
    if (!S.key) return;
    S.updatedAt = Date.now(); status('Đang lưu…');
    try { localStorage.setItem(lsKey(), JSON.stringify({ data: payload(), updatedAt: S.updatedAt })); } catch (e) { }
    clearTimeout(S.timer); S.timer = setTimeout(flush, SAVE_DELAY);
  }
  function flush() {
    clearTimeout(S.timer); S.timer = null;
    var db = DB(), key = S.key, uid = S.uid; if (!key) return;
    if (!db || !uid) { status('Đã lưu trên máy'); return; }
    var data = payload();
    if (data.length > MAX_BYTES) { status('Quá lớn'); toast('error', 'Ghi chú quá lớn', 'Hãy xóa bớt nét vẽ — dữ liệu chỉ lưu trên máy này.'); return; }
    db.collection('users').doc(uid).collection('studyNotes').doc(key).set({ docId: key, data: data, updatedAt: S.updatedAt || Date.now() })
      .then(function () { if (S.key === key) status('Đã lưu ✓'); })
      .catch(function (e) { console.warn('[Highlight] Không lưu được lên Firestore:', e); if (S.key === key) status('Đã lưu trên máy'); });
  }
  function apply(obj) {
    try { var o = JSON.parse(obj.data || '{}'); S.pages = o && typeof o === 'object' ? o : {}; } catch (e) { S.pages = {}; }
    Object.keys(S.pages).forEach(function (k) { var p = S.pages[k]; p.s = p.s || []; p.n = p.n || []; });
    S.updatedAt = obj.updatedAt || 0; redraw(); renderNotes();
  }
  function load() {
    var key = S.key, local = null;
    try { local = JSON.parse(localStorage.getItem(lsKey()) || 'null'); } catch (e) { }
    if (local) apply(local);
    var db = DB(); if (!db || !S.uid) return;
    db.collection('users').doc(S.uid).collection('studyNotes').doc(key).get().then(function (snap) {
      if (S.key !== key || !snap.exists) return;
      var d = snap.data(); if ((d.updatedAt || 0) > S.updatedAt) { apply(d); try { localStorage.setItem(lsKey(), JSON.stringify({ data: d.data, updatedAt: d.updatedAt })); } catch (e) { } }
    }).catch(function (e) { console.warn('[Highlight] Không tải được từ Firestore:', e); });
  }

  /* ---------- Gắn / gỡ lớp phủ ---------- */
  function attach(view, key) {
    var a = AU(); S.uid = a && a.currentUser ? a.currentUser.uid : null;
    S.key = key; S.pages = {}; S.page = 1; S.undo = []; S.cur = null; status('');
    mountLayer(view); load(); setTool('none'); $('#hlBar').hidden = false; updateUndoBtn();
  }
  function mountLayer(view) {
    detachLayer(); S.view = view; view.style.position = 'relative';
    var layer = document.createElement('div'); layer.className = 'hl-layer';
    layer.innerHTML = '<canvas class="hl-cv"></canvas><div class="hl-notes"></div>';
    view.appendChild(layer);
    S.layer = layer; S.canvas = $('canvas', layer); S.notesBox = $('.hl-notes', layer); S.ctx = S.canvas.getContext('2d');
    S.canvas.addEventListener('pointerdown', onDown); S.canvas.addEventListener('pointermove', onMove);
    S.canvas.addEventListener('pointerup', onUp); S.canvas.addEventListener('pointercancel', onUp);
    S.obs = new MutationObserver(function () { if (!view.contains(layer)) view.appendChild(layer); }); // tailieu.js ghi đè innerHTML khi tải xong
    S.obs.observe(view, { childList: true });
    if (window.ResizeObserver) { S.ro = new ResizeObserver(resize); S.ro.observe(view); }
    resize();
  }
  function detachLayer() {
    if (S.obs) { S.obs.disconnect(); S.obs = null; }
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    if (S.layer) { S.layer.remove(); }
    S.layer = S.canvas = S.ctx = S.notesBox = S.view = null;
  }
  function detach() {
    if (S.timer) flush();
    detachLayer(); S.key = null; S.undo = []; S.pages = {};
    var b = $('#hlBar'); if (b) b.hidden = true;
  }

  function tick() {
    var view = $('#tdView'), root = $('#view-tailieu'), active = view && root && root.classList.contains('active');
    if (!active) { if (S.key) detach(); return; }
    var key = docKey(); if (!key) return;
    if (S.key !== key) { if (S.key) detach(); attach(view, key); }
    else if (S.view !== view) { mountLayer(view); setTool(S.tool); }
  }

  function init() { css(); buildBar(); setInterval(tick, 500); window.addEventListener('beforeunload', function () { if (S.timer) flush(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.StudyHighlight = { undo: undo, setTool: setTool };
})();
