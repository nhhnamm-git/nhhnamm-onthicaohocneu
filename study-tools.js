/* ============================================================================
   study-tools.js — "Bộ công cụ học tập" cho Website Ôn thi Cao học NEU
   ----------------------------------------------------------------------------
   CÁCH DÙNG (1 dòng, đặt cuối <body> trong index.html, SAU các script khác):
       <script src="study-tools.js"></script>

   Không sửa bất kỳ file nào khác. File tự chèn giao diện, tự đọc dữ liệu học
   tập có sẵn của app (examMasterPro_dailyLog / wrongBank, QuestionManager...)
   và chỉ hiện sau khi người dùng đã đăng nhập & được duyệt.

   TÍNH NĂNG
   1) Command Palette  — Ctrl+K (hoặc "/"): nhảy nhanh tới mọi mục, bật/tắt
      dark mode, tra cứu NGAY câu hỏi trong ngân hàng (gõ không dấu cũng tìm được).
   2) Phím tắt làm bài — 1-4 hoặc A-D chọn đáp án, ←/→ chuyển câu, S đánh dấu sao,
      ? xem bảng phím tắt.
   3) Mục tiêu hằng ngày + chuỗi ngày học (streak) + đếm ngược ngày thi.
   4) Gợi ý ôn lại thông minh — các câu sai đã "đến hạn" ôn (cách quãng 1-3 ngày
      tuỳ số lần sai), bấm là vào thẳng mục "Ôn câu sai".
   5) Đồng hồ Pomodoro — 25/5 phút tuỳ chỉnh, có chuông, thông báo trình duyệt,
      hiện thời gian còn lại trên tiêu đề tab, không mất khi tải lại trang.
   6) Sổ ghi chú nhanh — tự lưu, chèn câu hỏi đang làm, tải về .txt.
   7) Nút "Lên đầu trang" và cảnh báo mất mạng (offline).

   Dữ liệu riêng của file này lưu trong localStorage, tiền tố examMasterPro_tools_
   (chỉ trên trình duyệt hiện tại, không đồng bộ lên Firebase).
   ========================================================================== */
(function () {
  'use strict';
  if (window.StudyTools) return;

  /* ---------- tiện ích ---------- */
  var PFX = 'examMasterPro_tools_';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(PFX + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { } }
  };
  var appData = function (k, d) { try { var v = localStorage.getItem('examMasterPro_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  var dayKey = function (d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var fmtMin = function (sec) { sec = Math.max(0, sec | 0); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); };
  var debounce = function (fn, w) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, w); }; };

  // Các biến "const" của app KHÔNG nằm trên window → phải đọc bằng typeof.
  var UIM = function () { return typeof UIManager !== 'undefined' ? UIManager : null; };
  var QM = function () { return typeof QuestionManager !== 'undefined' ? QuestionManager : null; };
  var AUTH = function () { return typeof fbAuth !== 'undefined' ? fbAuth : null; };

  function go(view) {
    var u = UIM();
    if (u && typeof u.navigate === 'function') u.navigate(view);
    else { var b = $('.nav-item[data-view="' + view + '"]'); if (b) b.click(); }
    var sb = $('#sidebar'); if (sb) { sb.classList.remove('open'); var sc = $('#sidebarScrim'); if (sc) sc.classList.remove('show'); }
  }
  function toast(msg, icon) {
    var t = document.createElement('div'); t.className = 'st-toast';
    t.innerHTML = '<i class="fa-solid ' + (icon || 'fa-circle-check') + '"></i> ' + esc(msg);
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ctx = new AC();
      [0, 0.28, 0.56].forEach(function (d, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1046 : 784; o.connect(g); g.connect(ctx.destination);
        var t = ctx.currentTime + d; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.25);
      });
      setTimeout(function () { ctx.close(); }, 1200);
    } catch (e) { }
  }

  /* ---------- CSS ---------- */
  function css() {
    if ($('#stStyles')) return;
    var s = document.createElement('style'); s.id = 'stStyles';
    s.textContent = [
      '.st-handle{position:fixed;right:0;top:42%;z-index:900;display:flex;flex-direction:column;gap:8px;align-items:flex-end}',
      '.st-pill{position:relative;width:44px;height:44px;border-radius:14px 0 0 14px;background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--cyan-500,#06b6d4));color:#fff;font-size:17px;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-md,0 6px 18px rgba(20,120,212,.3));cursor:pointer;border:0;transition:width .15s}',
      '.st-pill:hover{width:52px}.st-pill .dot{position:absolute;top:-6px;left:-6px;min-width:20px;height:20px;border-radius:10px;background:var(--danger,#ef4444);color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px}',
      '.st-up{background:var(--card-bg-solid,#fff);color:var(--accent,#1478d4);border:1px solid var(--card-border,rgba(20,120,212,.2));border-right:0;display:none}',
      '.st-panel{position:fixed;right:12px;top:72px;width:min(344px,calc(100vw - 24px));max-height:calc(100vh - 96px);overflow:auto;z-index:901;background:var(--card-bg-solid,#fff);color:var(--text-main,#0b2540);border:1px solid var(--card-border,rgba(20,120,212,.2));border-radius:18px;box-shadow:var(--shadow-lg,0 20px 50px rgba(4,32,63,.25));padding:14px;transform:translateX(16px);opacity:0;pointer-events:none;transition:.18s}',
      '.st-panel.open{transform:none;opacity:1;pointer-events:auto}',
      '.st-tabs{display:flex;gap:6px;margin-bottom:12px}.st-tabs button{flex:1;padding:8px 4px;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(20,120,212,.08);color:var(--text-muted,#5b7894);border:0;cursor:pointer}.st-tabs button.on{background:var(--accent,#1478d4);color:#fff}',
      '.st-sec{background:rgba(20,120,212,.06);border-radius:14px;padding:12px;margin-bottom:10px}.st-sec h5{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted,#5b7894);margin:0 0 8px;font-weight:800}',
      '.st-row{display:flex;align-items:center;gap:10px}.st-row.between{justify-content:space-between}.st-big{font-size:26px;font-weight:900;color:var(--accent,#1478d4);line-height:1}.st-sm{font-size:12px;color:var(--text-muted,#5b7894)}',
      '.st-ring{position:relative;width:78px;height:78px;flex-shrink:0}.st-ring svg{transform:rotate(-90deg)}.st-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:var(--accent,#1478d4)}',
      '.st-in{width:100%;padding:8px 10px;border-radius:10px;border:1px solid var(--card-border,rgba(20,120,212,.25));background:rgba(20,120,212,.04);color:inherit;font:inherit;font-size:13px}',
      '.st-in.num{width:64px;text-align:center}textarea.st-in{min-height:190px;resize:vertical;line-height:1.5}',
      '.st-btn{padding:8px 13px;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(20,120,212,.1);color:var(--accent,#1478d4);border:0;cursor:pointer;display:inline-flex;gap:6px;align-items:center}.st-btn:hover{background:rgba(20,120,212,.2)}',
      '.st-btn.pri{background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--cyan-500,#06b6d4));color:#fff}.st-btn.dng{background:rgba(239,68,68,.1);color:var(--danger,#ef4444)}',
      '.st-clock{font-size:44px;font-weight:900;text-align:center;letter-spacing:2px;color:var(--accent,#1478d4);font-variant-numeric:tabular-nums}.st-mode{text-align:center;font-weight:800;font-size:13px;margin-bottom:6px}',
      '.st-pbar{height:6px;border-radius:6px;background:rgba(20,120,212,.14);overflow:hidden;margin:8px 0 12px}.st-pbar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue-500,#1478d4),var(--cyan-500,#06b6d4));transition:width .4s}',
      '.st-ov{position:fixed;inset:0;z-index:9500;background:rgba(3,19,36,.5);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:12vh 14px 14px}',
      '.st-pal{width:min(600px,100%);background:var(--card-bg-solid,#fff);color:var(--text-main,#0b2540);border:1px solid var(--card-border,rgba(20,120,212,.2));border-radius:18px;box-shadow:var(--shadow-lg,0 24px 60px rgba(4,32,63,.35));overflow:hidden}',
      '.st-pal input{width:100%;padding:16px 18px;border:0;border-bottom:1px solid var(--card-border,rgba(20,120,212,.15));background:transparent;color:inherit;font-size:16px;outline:0}',
      '.st-list{max-height:52vh;overflow:auto;padding:6px}.st-lbl{padding:8px 12px 4px;font-size:11px;font-weight:800;text-transform:uppercase;color:var(--text-muted,#5b7894)}',
      '.st-it{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:14px}.st-it i{width:18px;text-align:center;color:var(--accent,#1478d4)}.st-it.on,.st-it:hover{background:rgba(20,120,212,.12)}.st-it span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.st-it kbd{font-size:11px;background:rgba(20,120,212,.1);border-radius:6px;padding:2px 7px;color:var(--text-muted,#5b7894)}',
      '.st-foot{padding:8px 14px;border-top:1px solid var(--card-border,rgba(20,120,212,.15));font-size:11.5px;color:var(--text-muted,#5b7894);display:flex;gap:14px;flex-wrap:wrap}',
      '.st-card{width:min(560px,100%);background:var(--card-bg-solid,#fff);color:var(--text-main,#0b2540);border-radius:18px;padding:22px;box-shadow:var(--shadow-lg);max-height:80vh;overflow:auto}',
      '.st-opt{padding:10px 12px;border-radius:10px;border:1.5px solid var(--card-border,rgba(20,120,212,.2));margin-top:8px;font-size:14px}.st-opt.ok{border-color:var(--success,#16c784);background:rgba(22,199,132,.12);font-weight:700}',
      '.st-keys{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px;margin-top:12px}.st-keys kbd{background:rgba(20,120,212,.12);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;justify-self:start}',
      '.st-toast{position:fixed;left:50%;top:18px;transform:translate(-50%,-20px);opacity:0;z-index:9800;background:var(--card-bg-solid,#fff);color:var(--text-main,#0b2540);border:1px solid var(--card-border);border-left:4px solid var(--accent,#1478d4);border-radius:12px;padding:11px 18px;font-size:13.5px;font-weight:600;box-shadow:var(--shadow-lg);transition:.25s}.st-toast.show{opacity:1;transform:translate(-50%,0)}.st-toast i{color:var(--accent,#1478d4);margin-right:6px}',
      '.st-off{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9700;background:#b42318;color:#fff;border-radius:24px;padding:9px 18px;font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);display:none}',
      '@media(max-width:560px){.st-panel{top:64px}.st-clock{font-size:38px}.st-ov{padding-top:8vh}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- 1) DỮ LIỆU HỌC TẬP ---------- */
  function dailyStats() {
    var log = appData('dailyLog', {}), today = log[dayKey()] || {};
    var goal = store.get('goal', 30), done = today.count || 0;
    var streak = 0, best = 0, run = 0, d = new Date();
    if (!(log[dayKey(d)] && log[dayKey(d)].count > 0)) d.setDate(d.getDate() - 1); // hôm nay chưa học thì không mất chuỗi
    while (log[dayKey(d)] && log[dayKey(d)].count > 0) { streak++; d.setDate(d.getDate() - 1); }
    Object.keys(log).sort().forEach(function (k, i, arr) {
      if (log[k] && log[k].count > 0) {
        var prev = new Date(k); prev.setDate(prev.getDate() - 1);
        run = (i > 0 && arr[i - 1] === dayKey(prev) && log[arr[i - 1]].count > 0) ? run + 1 : 1; best = Math.max(best, run);
      }
    });
    return { goal: goal, done: done, correct: today.correct || 0, timeSec: today.timeSec || 0, streak: streak, best: Math.max(best, streak) };
  }
  function dueWrong() { // gợi ý ôn cách quãng: sai càng nhiều lần → quay lại càng sớm
    var bank = appData('wrongBank', {}), gaps = [3, 2, 1], now = Date.now(), n = 0;
    Object.keys(bank).forEach(function (id) {
      var r = bank[id] || {}, t = Date.parse(r.lastDate || r.lastWrongDate || '');
      var gap = gaps[Math.min(Math.max(r.count || 1, 1), 3) - 1];
      if (!t || (now - t) / 86400000 >= gap) n++;
    });
    return { due: n, total: Object.keys(bank).length };
  }

  /* ---------- 2) PANEL (mục tiêu / tập trung / ghi chú) ---------- */
  var panel, handle, tab = 'goal', refreshTimer = null;
  var pomo = store.get('pomo', { mode: 'focus', running: false, endAt: 0, left: 25 * 60, focus: 25, brk: 5, done: 0 });
  var origTitle = document.title;

  function pomoLeft() { return pomo.running ? Math.max(0, Math.ceil((pomo.endAt - Date.now()) / 1000)) : pomo.left; }
  function pomoTotal() { return (pomo.mode === 'focus' ? pomo.focus : pomo.brk) * 60; }
  function pomoSave() { store.set('pomo', pomo); }

  function buildPanel() {
    handle = document.createElement('div'); handle.className = 'st-handle';
    handle.innerHTML = '<button class="st-pill" id="stOpen" title="Công cụ học tập"><i class="fa-solid fa-toolbox"></i><span class="dot" id="stDot"></span></button>' +
      '<button class="st-pill st-up" id="stUp" title="Lên đầu trang"><i class="fa-solid fa-arrow-up"></i></button>';
    panel = document.createElement('div'); panel.className = 'st-panel'; panel.id = 'stPanel';
    panel.innerHTML = '<div class="st-tabs"><button data-t="goal">Mục tiêu</button><button data-t="focus">Tập trung</button><button data-t="notes">Ghi chú</button></div><div id="stBody"></div>' +
      '<div class="st-sm" style="margin-top:6px;text-align:center"><kbd style="font-size:11px">Ctrl</kbd>+<kbd style="font-size:11px">K</kbd> tìm nhanh · <kbd style="font-size:11px">?</kbd> phím tắt</div>';
    document.body.appendChild(handle); document.body.appendChild(panel);
    $('#stOpen').onclick = function () { togglePanel(); };
    $('#stUp').onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); var m = $('main.content'); if (m) m.scrollTo({ top: 0, behavior: 'smooth' }); };
    $$('.st-tabs button', panel).forEach(function (b) { b.onclick = function () { setTab(b.dataset.t); }; });
    document.addEventListener('mousedown', function (e) { if (panel.classList.contains('open') && !panel.contains(e.target) && !handle.contains(e.target)) togglePanel(false); });
  }
  function togglePanel(force) {
    var open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open); clearInterval(refreshTimer);
    if (open) { setTab(tab); refreshTimer = setInterval(function () { if (tab !== 'notes') renderBody(); }, tab === 'focus' ? 500 : 4000); }
  }
  function setTab(t) {
    tab = t; $$('.st-tabs button', panel).forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    clearInterval(refreshTimer);
    if (panel.classList.contains('open')) refreshTimer = setInterval(function () { if (tab !== 'notes') renderBody(); }, t === 'focus' ? 500 : 4000);
    renderBody(true);
  }
  function renderBody(force) {
    var b = $('#stBody'); if (!b) return;
    if (tab === 'goal') {
      // tránh vẽ lại khi người dùng đang gõ trong ô nhập
      if (!force && document.activeElement && panel.contains(document.activeElement)) return;
      var st = dailyStats(), dw = dueWrong(), pct = Math.min(100, Math.round(st.done / Math.max(1, st.goal) * 100)), C = 2 * Math.PI * 32;
      var exam = store.get('exam', ''), days = null;
      if (exam) { days = Math.ceil((new Date(exam + 'T00:00:00') - new Date(dayKey() + 'T00:00:00')) / 86400000); }
      b.innerHTML =
        '<div class="st-sec"><h5>Mục tiêu hôm nay</h5><div class="st-row"><div class="st-ring"><svg width="78" height="78"><circle cx="39" cy="39" r="32" fill="none" stroke="rgba(20,120,212,.15)" stroke-width="8"/><circle cx="39" cy="39" r="32" fill="none" stroke="var(--accent,#1478d4)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg><b>' + pct + '%</b></div>' +
        '<div style="flex:1"><div class="st-big">' + st.done + '<span class="st-sm"> / ' + st.goal + ' câu</span></div><div class="st-sm">Đúng ' + st.correct + ' · Học ' + Math.round(st.timeSec / 60) + ' phút</div></div></div>' +
        '<div class="st-row between" style="margin-top:10px"><span class="st-sm">Đặt mục tiêu mỗi ngày</span><input class="st-in num" id="stGoal" type="number" min="5" max="500" value="' + st.goal + '"></div></div>' +
        '<div class="st-sec"><div class="st-row between"><div><h5 style="margin:0">Chuỗi ngày học</h5><div class="st-big">🔥 ' + st.streak + '<span class="st-sm"> ngày</span></div></div><div class="st-sm" style="text-align:right">Kỷ lục<br><b style="font-size:17px;color:var(--text-main)">' + st.best + '</b> ngày</div></div></div>' +
        '<div class="st-sec"><h5>Đến hạn ôn lại</h5><div class="st-row between"><div><div class="st-big">' + dw.due + '<span class="st-sm"> / ' + dw.total + ' câu sai</span></div><div class="st-sm">Ôn đúng lúc để nhớ lâu hơn</div></div>' + (dw.due ? '<button class="st-btn pri" id="stReview">Ôn ngay</button>' : '') + '</div></div>' +
        '<div class="st-sec"><h5>Đếm ngược ngày thi</h5><div class="st-row"><input class="st-in" id="stExam" type="date" value="' + esc(exam) + '">' +
        (days !== null ? '<div class="st-big" style="white-space:nowrap">' + (days > 0 ? days + '<span class="st-sm"> ngày</span>' : days === 0 ? 'Hôm nay!' : 'Đã qua') + '</div>' : '') + '</div></div>';
      var g = $('#stGoal'); if (g) g.onchange = function () { store.set('goal', Math.max(5, Math.min(500, parseInt(g.value, 10) || 30))); renderBody(true); updateDot(); };
      var ex = $('#stExam'); if (ex) ex.onchange = function () { store.set('exam', ex.value); renderBody(true); };
      var rv = $('#stReview'); if (rv) rv.onclick = function () { togglePanel(false); go('reviewWrong'); };
    } else if (tab === 'focus') {
      var left = pomoLeft(), tot = pomoTotal();
      if (!force && document.activeElement && document.activeElement.tagName === 'INPUT' && panel.contains(document.activeElement)) { updClock(left, tot); return; }
      b.innerHTML = '<div class="st-sec"><div class="st-mode">' + (pomo.mode === 'focus' ? '🎯 Tập trung' : '☕ Nghỉ ngơi') + ' · đã xong ' + pomo.done + ' phiên</div>' +
        '<div class="st-clock" id="stClock">' + fmtMin(left) + '</div><div class="st-pbar"><i id="stPb" style="width:' + (100 - left / tot * 100) + '%"></i></div>' +
        '<div class="st-row" style="justify-content:center"><button class="st-btn pri" id="stGo"><i class="fa-solid ' + (pomo.running ? 'fa-pause' : 'fa-play') + '"></i> ' + (pomo.running ? 'Tạm dừng' : 'Bắt đầu') + '</button><button class="st-btn" id="stRst"><i class="fa-solid fa-rotate-left"></i> Đặt lại</button><button class="st-btn" id="stSkip"><i class="fa-solid fa-forward"></i></button></div></div>' +
        '<div class="st-sec"><h5>Tuỳ chỉnh (phút)</h5><div class="st-row between"><span class="st-sm">Tập trung</span><input class="st-in num" id="stF" type="number" min="1" max="120" value="' + pomo.focus + '"><span class="st-sm">Nghỉ</span><input class="st-in num" id="stB" type="number" min="1" max="60" value="' + pomo.brk + '"></div></div>';
      $('#stGo').onclick = pomoToggle; $('#stRst').onclick = function () { pomo.running = false; pomo.left = pomoTotal(); pomoSave(); tickTitle(); renderBody(true); };
      $('#stSkip').onclick = function () { pomoNext(false); renderBody(true); };
      $('#stF').onchange = function () { pomo.focus = Math.max(1, Math.min(120, parseInt(this.value, 10) || 25)); if (!pomo.running && pomo.mode === 'focus') pomo.left = pomo.focus * 60; pomoSave(); renderBody(true); };
      $('#stB').onchange = function () { pomo.brk = Math.max(1, Math.min(60, parseInt(this.value, 10) || 5)); if (!pomo.running && pomo.mode === 'break') pomo.left = pomo.brk * 60; pomoSave(); renderBody(true); };
    } else {
      if (!force && $('#stNote')) return;
      b.innerHTML = '<div class="st-sec"><h5>Sổ ghi chú nhanh</h5><textarea class="st-in" id="stNote" placeholder="Ghi công thức, mẹo nhớ, câu hay sai... (tự động lưu)"></textarea>' +
        '<div class="st-row" style="margin-top:8px;flex-wrap:wrap"><button class="st-btn" id="stIns"><i class="fa-solid fa-paste"></i> Chèn câu đang làm</button><button class="st-btn" id="stDl"><i class="fa-solid fa-download"></i> Tải .txt</button><button class="st-btn dng" id="stClr"><i class="fa-solid fa-trash"></i></button></div><div class="st-sm" id="stSaved" style="margin-top:6px"></div></div>';
      var ta = $('#stNote'); ta.value = store.get('note', '');
      var save = debounce(function () { store.set('note', ta.value); $('#stSaved').textContent = 'Đã lưu ' + new Date().toLocaleTimeString('vi-VN'); }, 400);
      ta.oninput = save;
      $('#stIns').onclick = function () {
        var q = $('#questionText'), card = $('#quizActiveArea');
        if (!q || !card || card.style.display === 'none') return toast('Hãy mở một câu hỏi trong "Làm bài" trước', 'fa-circle-info');
        var opts = $$('#optionsList .option-item').map(function (o, i) { return String.fromCharCode(65 + i) + '. ' + o.textContent.replace(/\s+/g, ' ').trim(); }).join('\n');
        var badge = $('#qNumBadge'); ta.value += (ta.value ? '\n\n' : '') + '[' + (badge ? badge.textContent.trim() : 'Câu') + '] ' + q.textContent.trim() + '\n' + opts + '\n→ Ghi chú: ';
        ta.focus(); save();
      };
      $('#stDl').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' })); a.download = 'ghi-chu-on-thi-' + dayKey() + '.txt'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 500); };
      $('#stClr').onclick = function () { if (ta.value && !confirm('Xoá toàn bộ ghi chú?')) return; ta.value = ''; store.set('note', ''); };
    }
  }
  function updClock(left, tot) { var c = $('#stClock'), p = $('#stPb'); if (c) c.textContent = fmtMin(left); if (p) p.style.width = (100 - left / tot * 100) + '%'; }
  function updateDot() {
    var d = $('#stDot'); if (!d) return; var n = dueWrong().due;
    d.style.display = n ? 'flex' : 'none'; d.textContent = n > 99 ? '99+' : n; d.title = n + ' câu sai đến hạn ôn lại';
  }

  /* ---------- 3) POMODORO ---------- */
  function pomoToggle() {
    if (pomo.running) { pomo.left = pomoLeft(); pomo.running = false; }
    else {
      pomo.running = true; pomo.endAt = Date.now() + pomo.left * 1000;
      if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { } }
    }
    pomoSave(); tickTitle(); renderBody(true);
  }
  function pomoNext(finished) {
    if (pomo.mode === 'focus' && finished) pomo.done++;
    pomo.mode = pomo.mode === 'focus' ? 'break' : 'focus'; pomo.running = false; pomo.left = pomoTotal(); pomoSave(); tickTitle();
  }
  function tickTitle() {
    if (pomo.running) document.title = (pomo.mode === 'focus' ? '🎯 ' : '☕ ') + fmtMin(pomoLeft()) + ' · ' + origTitle;
    else document.title = origTitle;
  }
  setInterval(function () {
    if (!pomo.running) return;
    if (pomoLeft() <= 0) {
      var wasFocus = pomo.mode === 'focus'; pomoNext(true); beep();
      var msg = wasFocus ? 'Hết phiên tập trung! Nghỉ ' + pomo.brk + ' phút nhé.' : 'Hết giờ nghỉ — vào phiên mới thôi!';
      toast(msg, 'fa-bell');
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Ôn thi cao học NEU', { body: msg }); } catch (e) { }
      if (panel && panel.classList.contains('open') && tab === 'focus') renderBody(true);
    } else { tickTitle(); if (panel && panel.classList.contains('open') && tab === 'focus') updClock(pomoLeft(), pomoTotal()); }
  }, 500);

  /* ---------- 4) COMMAND PALETTE ---------- */
  var pal = null;
  function paletteItems(q) {
    var items = [], nq = norm(q.trim()), words = nq.split(/\s+/).filter(Boolean);
    var match = function (label) { var n = norm(label); return words.every(function (w) { return n.indexOf(w) > -1; }); };
    $$('.nav-item[data-view]').forEach(function (b) {
      var c = b.cloneNode(true); $$('.badge', c).forEach(function (x) { x.remove(); });
      var label = c.textContent.replace(/\s+/g, ' ').trim(), ic = b.querySelector('i');
      if (label && match(label)) items.push({ g: 'Chuyển tới', icon: ic ? ic.className : 'fa-solid fa-arrow-right', label: label, run: function () { go(b.dataset.view); } });
    });
    [
      { label: 'Bật / tắt chế độ tối', icon: 'fa-solid fa-moon', run: function () { var d = $('#darkToggleBtn'); if (d) d.click(); } },
      { label: 'Mở bảng công cụ học tập', icon: 'fa-solid fa-toolbox', run: function () { setTab('goal'); togglePanel(true); } },
      { label: 'Bắt đầu / tạm dừng Pomodoro', icon: 'fa-solid fa-stopwatch', run: function () { setTab('focus'); togglePanel(true); pomoToggle(); } },
      { label: 'Mở sổ ghi chú', icon: 'fa-solid fa-note-sticky', run: function () { setTab('notes'); togglePanel(true); } },
      { label: 'Xem phím tắt', icon: 'fa-regular fa-keyboard', run: showKeys }
    ].forEach(function (a) { if (match(a.label)) { a.g = 'Hành động'; items.push(a); } });
    var qm = QM();
    if (qm && qm.all && words.length && nq.length >= 2) {
      var hits = 0;
      for (var i = 0; i < qm.all.length && hits < 8; i++) {
        var qq = qm.all[i], hay = norm(qq.question + ' ' + Object.keys(qq.options || {}).map(function (k) { return qq.options[k]; }).join(' '));
        if (words.every(function (w) { return hay.indexOf(w) > -1; })) { hits++; (function (x) { items.push({ g: 'Câu hỏi trong ngân hàng', icon: 'fa-regular fa-circle-question', label: 'Câu ' + x.id + ': ' + x.question, run: function () { showQuestion(x); } }); })(qq); }
      }
    }
    return items;
  }
  function openPalette() {
    if (pal) return closePalette();
    var ov = document.createElement('div'); ov.className = 'st-ov';
    ov.innerHTML = '<div class="st-pal"><input id="stQ" placeholder="Gõ để tìm mục, hành động hoặc câu hỏi (không dấu cũng được)..." autocomplete="off"><div class="st-list" id="stL"></div>' +
      '<div class="st-foot"><span><kbd>↑↓</kbd> chọn</span><span><kbd>Enter</kbd> mở</span><span><kbd>Esc</kbd> đóng</span></div></div>';
    document.body.appendChild(ov); pal = { ov: ov, items: [], idx: 0 };
    var inp = $('#stQ', ov), list = $('#stL', ov);
    var draw = function () {
      pal.items = paletteItems(inp.value); pal.idx = Math.min(pal.idx, Math.max(0, pal.items.length - 1));
      var last = '', h = '';
      pal.items.forEach(function (it, i) {
        if (it.g !== last) { h += '<div class="st-lbl">' + esc(it.g) + '</div>'; last = it.g; }
        h += '<div class="st-it' + (i === pal.idx ? ' on' : '') + '" data-i="' + i + '"><i class="' + esc(it.icon) + '"></i><span>' + esc(it.label) + '</span></div>';
      });
      list.innerHTML = h || '<div class="st-lbl" style="padding:18px 12px">Không tìm thấy kết quả</div>';
      var on = $('.st-it.on', list); if (on) on.scrollIntoView({ block: 'nearest' });
      $$('.st-it', list).forEach(function (el) { el.onclick = function () { run(+el.dataset.i); }; el.onmousemove = function () { if (pal.idx !== +el.dataset.i) { pal.idx = +el.dataset.i; $$('.st-it', list).forEach(function (x) { x.classList.toggle('on', x === el); }); } }; });
    };
    var run = function (i) { var it = pal.items[i]; if (!it) return; closePalette(); setTimeout(it.run, 30); };
    inp.oninput = function () { pal.idx = 0; draw(); };
    inp.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(pal.idx); }
    };
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closePalette(); });
    draw(); inp.focus();
  }
  function closePalette() { if (pal) { pal.ov.remove(); pal = null; } }
  function modal(html) {
    var ov = document.createElement('div'); ov.className = 'st-ov'; ov.style.alignItems = 'center'; ov.style.paddingTop = '14px';
    ov.innerHTML = '<div class="st-card">' + html + '<div style="text-align:right;margin-top:14px"><button class="st-btn pri" id="stOk">Đóng</button></div></div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); document.removeEventListener('keydown', k, true); }, k = function (e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
    $('#stOk', ov).onclick = close; ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); }); document.addEventListener('keydown', k, true);
  }
  function showQuestion(q) {
    var opts = Object.keys(q.options || {}).map(function (k) { return '<div class="st-opt' + (k === q.answer ? ' ok' : '') + '"><b>' + esc(k) + '.</b> ' + esc(q.options[k]) + (k === q.answer ? ' &nbsp;<i class="fa-solid fa-check"></i>' : '') + '</div>'; }).join('');
    modal('<div class="st-sm" style="margin-bottom:6px">Câu ' + esc(q.id) + ' · Đáp án đúng: <b>' + esc(q.answer) + '</b></div><div style="font-weight:700;font-size:15.5px;line-height:1.5">' + esc(q.question) + '</div>' + opts);
  }
  function showKeys() {
    modal('<h3 style="margin:0 0 4px">⌨️ Phím tắt</h3><div class="st-keys">' +
      [['Ctrl + K  hoặc  /', 'Mở tìm nhanh & tra cứu câu hỏi'], ['1–4  hoặc  A–D', 'Chọn đáp án (khi đang làm bài)'], ['←  /  →', 'Câu trước / câu tiếp theo'], ['S', 'Đánh dấu sao câu hỏi'], ['?', 'Mở bảng phím tắt này'], ['Esc', 'Đóng cửa sổ đang mở']]
        .map(function (r) { return '<kbd>' + r[0] + '</kbd><span>' + r[1] + '</span>'; }).join('') + '</div>');
  }

  /* ---------- 5) PHÍM TẮT ---------- */
  function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function quizActive() {
    var v = $('#view-quiz'), a = $('#quizActiveArea');
    return v && v.classList.contains('active') && a && a.style.display !== 'none';
  }
  document.addEventListener('keydown', function (e) {
    if (!ready) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { if (pal) { closePalette(); return; } if (panel && panel.classList.contains('open')) { togglePanel(false); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || pal) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }
    if (e.key === '?') { e.preventDefault(); showKeys(); return; }
    if (!quizActive()) return;
    var k = e.key.toLowerCase(), idx = '1234'.indexOf(k) > -1 && k.length === 1 ? +k - 1 : 'abcd'.indexOf(k) > -1 && k.length === 1 ? 'abcd'.indexOf(k) : -1;
    if (idx > -1) { var o = $$('#optionsList .option-item')[idx]; if (o) { e.preventDefault(); o.click(); } }
    else if (e.key === 'ArrowRight') { var n = $('#nextQBtn'); if (n && !n.disabled) { e.preventDefault(); n.click(); } }
    else if (e.key === 'ArrowLeft') { var p = $('#prevQBtn'); if (p && !p.disabled) { e.preventDefault(); p.click(); } }
    else if (k === 's') { var s = $('#starBtn'); if (s) { e.preventDefault(); s.click(); } }
  }, true);

  /* ---------- 6) LÊN ĐẦU TRANG + OFFLINE ---------- */
  function scrollWatch() {
    var up = $('#stUp'); if (!up) return;
    var y = Math.max(window.scrollY || 0, (document.scrollingElement || {}).scrollTop || 0, ($('main.content') || {}).scrollTop || 0);
    up.style.display = y > 400 ? 'flex' : 'none';
  }
  function offlineBar() {
    var o = document.createElement('div'); o.className = 'st-off'; o.innerHTML = '<i class="fa-solid fa-wifi"></i> Bạn đang offline — một số tính năng (đồng bộ, cộng đồng) tạm dừng';
    document.body.appendChild(o);
    var upd = function () { o.style.display = navigator.onLine ? 'none' : 'block'; if (navigator.onLine === true && o.dataset.was) toast('Đã kết nối lại', 'fa-wifi'); o.dataset.was = navigator.onLine ? '' : '1'; };
    window.addEventListener('online', upd); window.addEventListener('offline', upd); upd();
  }

  /* ---------- KHỞI ĐỘNG: chỉ hiện sau khi đăng nhập & app sẵn sàng ---------- */
  var ready = false, built = false;
  function loggedIn() { var a = AUTH(); return !!(window.__appInitialized && a && a.currentUser); }
  function boot() {
    var ok = loggedIn();
    if (ok && !built) {
      built = true; css(); buildPanel(); offlineBar();
      document.addEventListener('scroll', scrollWatch, { capture: true, passive: true }); scrollWatch();
      setInterval(updateDot, 8000); updateDot();
    }
    ready = ok && built;
    if (built) { handle.style.display = ok ? '' : 'none'; if (!ok) { togglePanel(false); closePalette(); } }
  }
  setInterval(boot, 800); boot();

  window.StudyTools = {
    openPalette: openPalette, openPanel: function (t) { if (t) setTab(t); togglePanel(true); },
    setGoal: function (n) { store.set('goal', n); renderBody(true); }
  };
})();
