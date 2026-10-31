/* ============================================================================
   noti.js — TRUNG TÂM THÔNG BÁO TẬP TRUNG cho Website Ôn thi Cao học NEU
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng cuối <body> của index.html (SAU forest.js, flashcard.js,
   social.js, schedule.js... vì file này đọc API/dữ liệu của các module đó):
       <script src="noti.js"></script>
   Không sửa file nào khác. Module tự chèn nút chuông vào topbar, bảng thông báo,
   toast, và tự "wrap" (không ghi đè) QuizManager.finishQuiz, PdfExamManager.submit,
   UIManager.navigate, CloudSync.teardown — cùng kỹ thuật với các module hiện có.

   NGUỒN THÔNG BÁO (đã rà soát từ source)
   LỊCH HỌC   : trước giờ bắt đầu 30 / 15 / 5 phút (đọc localStorage "learningSchedule",
                tự bung lịch lặp + ngoại lệ); deadline hôm nay / ngày mai.
   FOREST     : đủ giờ học cũ để đổi Linh Quang; đủ Linh Quang mua cây / vật phẩm /
                mở đất; nhiệm vụ ngày/tuần có thể nhận thưởng; cây lên giai đoạn; rừng lên cấp.
   HỌC TẬP    : hoàn thành bài học / chuyên đề (course.js), lượt học flashcard (flashcard.js),
                bài trắc nghiệm & đề PDF, phiên Pomodoro, mục tiêu ngày, chuỗi ngày học,
                chuỗi sắp đứt (sau 20h), câu sai đến hạn ôn, đếm ngược ngày thi.
   CHẤM LUẬN  : bài luận được giáo viên chấm / có nhận xét mới (essaySubmissions).
   CỘNG ĐỒNG  : thông báo social_* (thích, bình luận, trả lời, kết bạn, theo dõi, chia sẻ,
                câu trả lời hay nhất), tin nhắn riêng mới, lên cấp / huy hiệu cộng đồng, bị khoá chat.
   THÀNH TÍCH : đổi thứ hạng bảng xếp hạng, vào Top 3, lên cấp (Lv), thêm thành tích / huy hiệu.
   TÀI KHOẢN  : được duyệt, đổi vai trò; thông báo + cập nhật hệ thống do Admin đăng;
                phiên bản mới của giao diện.
   NỘI DUNG   : bài giảng mới, tài liệu mới, đề cộng đồng mới, đề dùng chung mới,
                ngân hàng 300 câu gốc được cập nhật (kể cả khi bạn offline lúc đó).
   HỆ THỐNG   : mất / có lại mạng; sắp tự đăng xuất do không thao tác.
   ADMIN      : bài luận chờ chấm, yêu cầu đăng nhập chờ duyệt, báo cáo vi phạm mới.

   LƯU TRỮ: localStorage theo từng tài khoản (examMasterPro_noti_*_<uid>) — tối đa
   200 thông báo, có chống trùng. Admin đăng thông báo vào Firestore: adminAnnouncements.

   ‼️ CẦN THÊM 1 RULE VÀO FIRESTORE (các collection còn lại đã có rule sẵn):
     match /adminAnnouncements/{id} {
       allow read: if isAllowed();
       allow write: if isAdmin();
     }
   (Chưa thêm thì mọi thứ khác vẫn chạy; chỉ phần "thông báo từ Admin" chưa hoạt động.)

   API công khai: Noti.push({cat,title,body,action,level,key}) · Noti.open() ·
   Noti.markAllRead() · Noti.unread() · Noti.list()
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.Noti) return;

  var APP_VERSION = '2026.10.31';
  var CHANGELOG = {
    title: 'Trung tâm thông báo mới',
    body: 'Chuông thông báo ở góc trên gom lịch học, Linh Quang, bài luận, cộng đồng, thành tích và tin từ Admin. Bấm ⚙ để tuỳ chỉnh từng loại.'
  };
  var MAX_LIST = 200, SEEN_MAX = 1000, SEEN_TTL = 60 * 864e5;

  /* ---------- tiện ích ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var dayKey = function (d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  var pk = function (k) { var p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  var clip = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var uid8 = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); };
  function hash(str) { var h = 0; str = String(str || ''); for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }
  function tsMs(t) {
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t === 'number') return t;
    if (typeof t === 'string') { var p = Date.parse(t); return isNaN(p) ? 0 : p; }
    if (t.seconds) return t.seconds * 1000;
    return 0;
  }
  function timeAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'Vừa xong';
    var m = Math.floor(s / 60); if (m < 60) return m + ' phút trước';
    var h = Math.floor(m / 60); if (h < 24) return h + ' giờ trước';
    var d = Math.floor(h / 24); if (d < 7) return d + ' ngày trước';
    return new Date(ts).toLocaleDateString('vi-VN');
  }
  function lsRaw(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  // Biến const của index.html không nằm trên window → đọc bằng typeof.
  function DB() { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; }
  function AU() { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; }
  function UIM() { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; }
  function AM() { try { if (typeof AuthManager !== 'undefined' && AuthManager) return AuthManager; } catch (e) { } return window.AuthManager || null; }
  function isAdmin() { try { var a = AM(); return !!(a && typeof a.isAdmin === 'function' && a.isAdmin()); } catch (e) { return false; } }
  function idleLimit() { try { if (typeof IDLE_TIMEOUT_MINUTES !== 'undefined') return IDLE_TIMEOUT_MINUTES; } catch (e) { } return 10; }
  function FV() { return firebase.firestore.FieldValue; }
  function safe(fn, tag) { try { fn(); } catch (e) { console.warn('[Noti] ' + (tag || 'lỗi'), e); } }

  /* ---------- nhóm thông báo ---------- */
  var CATS = {
    schedule: { label: 'Lịch học', icon: 'fa-calendar-check', color: '#1478d4' },
    forest: { label: 'Study Forest', icon: 'fa-tree', color: '#16c784' },
    learning: { label: 'Học tập', icon: 'fa-graduation-cap', color: '#06b6d4' },
    essay: { label: 'Chấm luận', icon: 'fa-pen-nib', color: '#8b5cf6' },
    social: { label: 'Cộng đồng', icon: 'fa-comments', color: '#f59e0b' },
    achievement: { label: 'Thành tích', icon: 'fa-trophy', color: '#e0a800' },
    account: { label: 'Tài khoản', icon: 'fa-user-shield', color: '#0d5fb3' },
    admin: { label: 'Từ Admin', icon: 'fa-bullhorn', color: '#ef4444' },
    content: { label: 'Nội dung mới', icon: 'fa-folder-plus', color: '#22d3ee' },
    adminwork: { label: 'Quản trị', icon: 'fa-user-gear', color: '#f97316' },
    system: { label: 'Hệ thống', icon: 'fa-gear', color: '#5c7590' }
  };

  var DEFAULTS = { toast: true, sound: true, desktop: false, cats: {} };

  /* ---------- state ---------- */
  var S = {
    uid: null, email: '', started: false, admin: false, list: [], seen: {}, st: {}, settings: null,
    open: false, tab: 'list', filter: 'all', unsubs: [], timers: [], warned: false, lastAct: Date.now(),
    fcSum: false, ann: [], errTags: {}, lastRank: 0
  };
  function K(n) { return 'examMasterPro_noti_' + n + '_' + (S.uid || 'guest'); }
  function loadAll() {
    S.list = lsRaw(K('list'), []); S.seen = lsRaw(K('seen'), {}); S.st = lsRaw(K('state'), {});
    var set = lsRaw('examMasterPro_noti_settings', {});
    S.settings = { toast: set.toast !== false, sound: set.sound !== false, desktop: !!set.desktop, cats: set.cats || {} };
    S.st.cts = S.st.cts || {};
  }
  function saveList() { if (S.list.length > MAX_LIST) S.list.length = MAX_LIST; lsSet(K('list'), S.list); }
  function saveSt() { lsSet(K('state'), S.st); }
  function saveSet() { lsSet('examMasterPro_noti_settings', S.settings); }
  function saveSeen() {
    var keys = Object.keys(S.seen), now = Date.now();
    if (keys.length > SEEN_MAX) {
      keys.sort(function (a, b) { return S.seen[a] - S.seen[b]; }).slice(0, keys.length - SEEN_MAX + 100).forEach(function (k) { delete S.seen[k]; });
    }
    keys.forEach(function (k) { if (now - S.seen[k] > SEEN_TTL) delete S.seen[k]; });
    lsSet(K('seen'), S.seen);
  }
  function markSeen(key) { if (key) { S.seen[key] = Date.now(); saveSeen(); } }
  function unread() { return S.list.filter(function (n) { return !n.read; }).length; }

  /* ==========================================================================
     1) PUSH — cửa vào duy nhất để tạo thông báo
     n: { key, cat, title, body, icon, action, level:'normal'|'high', silent, read, group, ts }
     key   : chống trùng vĩnh viễn (đã thấy rồi thì bỏ qua)
     group : gộp vào thông báo CHƯA ĐỌC cùng group thay vì tạo mới (vd tin nhắn)
     silent: chỉ vào trung tâm thông báo, không toast / âm thanh
     ======================================================================== */
  function push(n) {
    if (!S.started || !n || !n.title) return null;
    if (n.key) { if (S.seen[n.key]) return null; S.seen[n.key] = Date.now(); saveSeen(); }
    var cat = CATS[n.cat] ? n.cat : 'system';
    if (S.settings.cats[cat] === false) return null;
    var item;
    if (n.group) {
      item = S.list.filter(function (x) { return x.group === n.group && !x.read; })[0];
      if (item) {
        item.title = n.title; item.body = n.body || ''; item.ts = n.ts || Date.now(); item.action = n.action || item.action;
        S.list.splice(S.list.indexOf(item), 1); S.list.unshift(item);
        saveList(); renderBadge(); if (S.open) renderPanel(); bell();
        return item;
      }
    }
    item = {
      id: uid8(), key: n.key || '', group: n.group || '', cat: cat, title: n.title, body: n.body || '',
      icon: n.icon || CATS[cat].icon, ts: n.ts || Date.now(), read: !!n.read, action: n.action || null, level: n.level || 'normal'
    };
    S.list.unshift(item); saveList(); renderBadge(); if (S.open) renderPanel();
    if (!n.silent) {
      bell();
      if (S.settings.toast) showToast(item);
      if (item.level === 'high' && S.settings.sound) beep();
      desktop(item);
    }
    return item;
  }

  /* ---------- âm thanh / thông báo trình duyệt ---------- */
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ctx = new AC();
      [0, 0.2].forEach(function (d, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + d;
        o.type = 'sine'; o.frequency.value = i ? 1046 : 784; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.start(t); o.stop(t + 0.28);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) { } }, 900);
    } catch (e) { }
  }
  function desktop(item) {
    try {
      if (!S.settings.desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
      if (!document.hidden && item.level !== 'high') return;
      var n = new Notification(item.title, { body: item.body, tag: item.id, icon: 'logo.png' });
      n.onclick = function () { window.focus(); go(item.action); n.close(); };
    } catch (e) { }
  }

  /* ---------- điều hướng khi bấm thông báo ---------- */
  function go(a) {
    if (!a) return;
    closePanel();
    var ui = UIM();
    safe(function () {
      if (a.doc && window.TaiLieu && TaiLieu.open) { TaiLieu.open(a.doc); return; }
      if (a.hash) location.hash = a.hash;
      if (a.view && ui) ui.navigate(a.view);
      setTimeout(function () {
        safe(function () {
          if (a.tab && window.SocialApp && SocialApp.setTab) SocialApp.setTab(a.tab);
          if (a.lesson && window.CourseUI && CourseUI.openLesson) CourseUI.openLesson(a.lesson);
          if (a.sub) { var el = $(a.sub); if (el) el.click(); }
        }, 'go');
      }, 450);
    }, 'go');
  }
  var A_ESSAY_MINE = { view: 'essayGrader', sub: '.eg-maintab[data-maintab="mine"]' };
  var A_ESSAY_ADMIN = { view: 'essayGrader', sub: '.eg-maintab[data-maintab="admin"]' };

  /* ==========================================================================
     2) GIAO DIỆN: chuông, bảng thông báo, toast
     ======================================================================== */
  function css() {
    if ($('#ntStyles')) return;
    var s = document.createElement('style'); s.id = 'ntStyles';
    s.textContent = [
      '.nt-bell{display:none}.nt-bell.on{display:flex}',
      '.nt-bell .nt-badge{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--danger,#ef4444);color:#fff;font-size:10.5px;font-weight:800;display:none;align-items:center;justify-content:center;border:2px solid var(--card-bg-solid,#fff)}',
      '.nt-bell.ring i{animation:ntRing .8s ease}',
      '@keyframes ntRing{0%,100%{transform:rotate(0)}15%{transform:rotate(18deg)}30%{transform:rotate(-16deg)}45%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}75%{transform:rotate(4deg)}}',
      '.nt-panel{position:fixed;top:calc(var(--topbar-h,68px) + 6px);right:16px;width:410px;max-width:calc(100vw - 16px);max-height:min(640px,calc(100vh - 90px));display:none;flex-direction:column;z-index:2500;background:var(--card-bg-solid,#fff);color:var(--text-main,#0b1f33);border:1px solid var(--card-border);border-radius:18px;box-shadow:var(--shadow-lg);overflow:hidden;transform-origin:top right}',
      '.nt-panel.show{display:flex;animation:ntPop .18s ease}',
      '@keyframes ntPop{from{opacity:0;transform:scale(.96) translateY(-6px)}to{opacity:1;transform:none}}',
      '.nt-head{display:flex;align-items:center;gap:6px;padding:14px 14px 10px}.nt-head b{font-size:16px;font-weight:800}.nt-sp{flex:1}',
      '.nt-hb{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--accent);background:rgba(20,120,212,.08);font-size:13px}.nt-hb:hover{background:rgba(20,120,212,.18)}',
      '.nt-tabs{display:flex;gap:6px;padding:0 14px 10px;overflow-x:auto;flex-shrink:0}.nt-tabs::-webkit-scrollbar{height:0}',
      '.nt-chip{white-space:nowrap;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;background:rgba(20,120,212,.07);color:var(--text-muted)}.nt-chip.on{background:var(--accent);color:#fff}',
      '.nt-body{flex:1;overflow-y:auto;padding:0 8px 8px;min-height:120px}',
      '.nt-item{position:relative;display:flex;gap:11px;padding:11px 10px;border-radius:12px;cursor:pointer;align-items:flex-start}.nt-item:hover{background:rgba(20,120,212,.07)}',
      '.nt-item.unread{background:rgba(20,120,212,.09)}.nt-item.unread::after{content:"";position:absolute;right:10px;top:16px;width:8px;height:8px;border-radius:50%;background:var(--accent)}',
      '.nt-ic{width:38px;height:38px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;background:var(--c,var(--accent))}',
      '.nt-tx{flex:1;min-width:0;padding-right:16px}.nt-tx b{display:block;font-size:13.5px;line-height:1.35;word-break:break-word}.nt-tx span{display:block;font-size:12.5px;color:var(--text-muted);line-height:1.45;margin-top:2px;word-break:break-word}',
      '.nt-tx em{display:block;font-style:normal;font-size:11px;color:var(--text-muted);margin-top:4px}.nt-tx em i{margin-right:4px;color:var(--c)}',
      '.nt-del{position:absolute;right:6px;bottom:8px;width:24px;height:24px;border-radius:7px;color:var(--text-muted);font-size:11px;opacity:0}.nt-item:hover .nt-del{opacity:1}.nt-del:hover{color:var(--danger);background:rgba(239,68,68,.1)}',
      '.nt-empty{text-align:center;padding:44px 20px;color:var(--text-muted);font-size:13px}.nt-empty i{display:block;font-size:34px;margin-bottom:10px;color:var(--blue-300,#6fb6f2)}',
      '.nt-foot{display:flex;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--card-border);font-size:11.5px;color:var(--text-muted);flex-shrink:0}.nt-foot button{font-weight:700;color:var(--danger);font-size:11.5px}',
      '.nt-set{padding:4px 10px 10px}.nt-set h4{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:12px 0 6px;font-weight:800}',
      '.nt-row{display:flex;align-items:center;gap:10px;padding:8px 4px;font-size:13px;border-bottom:1px dashed var(--card-border)}.nt-row label{flex:1;display:flex;gap:9px;align-items:center;cursor:pointer;margin:0}.nt-row .dot{width:10px;height:10px;border-radius:50%;background:var(--c)}',
      '.nt-row input[type=checkbox]{width:17px;height:17px;cursor:pointer}',
      '.nt-btn{padding:8px 14px;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(20,120,212,.1);color:var(--accent);display:inline-flex;gap:6px;align-items:center}.nt-btn:hover{background:rgba(20,120,212,.2)}.nt-btn.pri{background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--cyan-500,#06b6d4));color:#fff}.nt-btn.dng{background:rgba(239,68,68,.1);color:var(--danger)}',
      '.nt-f{margin-bottom:10px}.nt-f label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px}',
      '.nt-f input[type=text],.nt-f textarea,.nt-f select{width:100%;padding:9px 11px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.04);color:var(--text-main);font:inherit;font-size:13px}.nt-f textarea{min-height:90px;resize:vertical}',
      '.nt-toasts{position:fixed;right:16px;bottom:124px;z-index:2600;display:flex;flex-direction:column;gap:10px;width:340px;max-width:calc(100vw - 24px);pointer-events:none}',
      '.nt-toast{pointer-events:auto;display:flex;gap:11px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:var(--card-bg-solid,#fff);color:var(--text-main);border:1px solid var(--card-border);border-left:4px solid var(--c);box-shadow:var(--shadow-lg);cursor:pointer;opacity:0;transform:translateX(30px);transition:.3s}',
      '.nt-toast.in{opacity:1;transform:none}.nt-toast.high{box-shadow:0 0 0 2px var(--c),var(--shadow-lg)}',
      '.nt-toast .nt-ic{width:34px;height:34px;font-size:14px}.nt-toast .nt-tx{padding-right:0}.nt-x{color:var(--text-muted);font-size:16px;line-height:1;padding:0 2px}',
      '@media(max-width:560px){.nt-panel{right:8px;left:8px;width:auto;max-width:none}.nt-toasts{right:8px;left:8px;width:auto;bottom:100px}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function injectDom() {
    css();
    if (!$('#notiBellBtn')) {
      var right = $('.topbar-right'); if (!right) return;
      var b = document.createElement('button');
      b.className = 'icon-btn nt-bell'; b.id = 'notiBellBtn'; b.setAttribute('data-tip', 'Thông báo');
      b.innerHTML = '<i class="fa-regular fa-bell"></i><span class="nt-badge" id="ntBadge">0</span>';
      var dark = $('#darkToggleBtn');
      if (dark && dark.parentNode === right) right.insertBefore(b, dark); else right.insertBefore(b, right.firstChild);
      b.addEventListener('click', function (e) { e.stopPropagation(); S.open ? closePanel() : openPanel(); });
    }
    if (!$('#ntPanel')) {
      var p = document.createElement('div'); p.className = 'nt-panel'; p.id = 'ntPanel';
      p.innerHTML = '<div class="nt-head"><b id="ntTitle">Thông báo</b><span class="nt-sp"></span>' +
        '<button class="nt-hb" data-a="compose" id="ntCompose" title="Đăng thông báo (Admin)" style="display:none"><i class="fa-solid fa-bullhorn"></i></button>' +
        '<button class="nt-hb" data-a="readall" title="Đánh dấu tất cả đã đọc"><i class="fa-solid fa-check-double"></i></button>' +
        '<button class="nt-hb" data-a="settings" id="ntGear" title="Cài đặt thông báo"><i class="fa-solid fa-gear"></i></button>' +
        '<button class="nt-hb" data-a="close" title="Đóng"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="nt-tabs" id="ntTabs"></div><div class="nt-body" id="ntBody"></div><div class="nt-foot" id="ntFoot"></div>';
      document.body.appendChild(p);
      p.addEventListener('click', onPanelClick);
      p.addEventListener('change', onPanelChange);
      document.addEventListener('mousedown', function (e) { if (S.open && !p.contains(e.target) && !$('#notiBellBtn').contains(e.target)) closePanel(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) closePanel(); });
    }
    if (!$('#ntToasts')) { var t = document.createElement('div'); t.className = 'nt-toasts'; t.id = 'ntToasts'; document.body.appendChild(t); }
  }

  function renderBadge() {
    var n = unread(), b = $('#ntBadge'); if (!b) return;
    b.textContent = n > 99 ? '99+' : n; b.style.display = n > 0 ? 'flex' : 'none';
    var i = $('#notiBellBtn i'); if (i) i.className = n > 0 ? 'fa-solid fa-bell' : 'fa-regular fa-bell';
  }
  function bell() {
    var b = $('#notiBellBtn'); if (!b) return;
    b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring');
  }
  function openPanel() { S.open = true; S.tab = 'list'; var p = $('#ntPanel'); if (p) p.classList.add('show'); renderPanel(); }
  function closePanel() { S.open = false; var p = $('#ntPanel'); if (p) p.classList.remove('show'); }

  function renderPanel() {
    var body = $('#ntBody'), tabs = $('#ntTabs'), foot = $('#ntFoot'), title = $('#ntTitle'); if (!body) return;
    var cm = $('#ntCompose'); if (cm) cm.style.display = S.admin ? '' : 'none';
    var gear = $('#ntGear'); if (gear) gear.innerHTML = S.tab === 'list' ? '<i class="fa-solid fa-gear"></i>' : '<i class="fa-solid fa-arrow-left"></i>';
    if (S.tab === 'settings') { title.textContent = 'Cài đặt thông báo'; tabs.innerHTML = ''; foot.innerHTML = ''; return renderSettings(body); }
    if (S.tab === 'compose') { title.textContent = 'Đăng thông báo'; tabs.innerHTML = ''; foot.innerHTML = ''; return renderCompose(body); }
    title.textContent = 'Thông báo';
    var cats = {}; S.list.forEach(function (n) { cats[n.cat] = 1; });
    var chip = function (id, label) { return '<button class="nt-chip ' + (S.filter === id ? 'on' : '') + '" data-f="' + id + '">' + esc(label) + '</button>'; };
    tabs.innerHTML = chip('all', 'Tất cả') + chip('unread', 'Chưa đọc (' + unread() + ')') +
      Object.keys(cats).map(function (c) { return chip('c:' + c, CATS[c].label); }).join('');
    var items = S.list.filter(function (n) {
      if (S.filter === 'unread') return !n.read;
      if (S.filter.indexOf('c:') === 0) return n.cat === S.filter.slice(2);
      return true;
    });
    body.innerHTML = items.length ? items.map(itemHtml).join('') :
      '<div class="nt-empty"><i class="fa-regular fa-bell-slash"></i>' + (S.filter === 'unread' ? 'Bạn đã đọc hết thông báo 🎉' : 'Chưa có thông báo nào') + '</div>';
    foot.innerHTML = '<span>' + S.list.length + ' thông báo</span>' + (S.list.length ? '<button data-a="clear">Xoá tất cả</button>' : '');
  }
  function itemHtml(n) {
    var c = CATS[n.cat] || CATS.system;
    return '<div class="nt-item ' + (n.read ? '' : 'unread') + '" data-id="' + n.id + '" style="--c:' + c.color + '"><div class="nt-ic"><i class="fa-solid ' + esc(n.icon) + '"></i></div>' +
      '<div class="nt-tx"><b>' + esc(n.title) + '</b>' + (n.body ? '<span>' + esc(n.body) + '</span>' : '') + '<em><i class="fa-solid ' + c.icon + '"></i>' + esc(c.label) + ' · ' + timeAgo(n.ts) + '</em></div>' +
      '<button class="nt-del" data-del="' + n.id + '" title="Xoá"><i class="fa-solid fa-trash"></i></button></div>';
  }
  function renderSettings(body) {
    var st = S.settings;
    body.innerHTML = '<div class="nt-set"><h4>Chung</h4>' +
      row('toast', 'Hiện thông báo nổi (toast)', st.toast) + row('sound', 'Phát âm thanh với thông báo quan trọng', st.sound) +
      row('desktop', 'Thông báo trình duyệt khi đang ở tab khác', st.desktop) +
      '<h4>Loại thông báo</h4>' + Object.keys(CATS).filter(function (c) { return S.admin || c !== 'adminwork'; }).map(function (c) {
        return '<div class="nt-row" style="--c:' + CATS[c].color + '"><label><span class="dot"></span><i class="fa-solid ' + CATS[c].icon + '" style="width:16px;color:' + CATS[c].color + '"></i> ' + esc(CATS[c].label) +
          '<span style="flex:1"></span><input type="checkbox" data-cat="' + c + '" ' + (st.cats[c] === false ? '' : 'checked') + '></label></div>';
      }).join('') +
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="nt-btn" data-a="test"><i class="fa-solid fa-paper-plane"></i> Gửi thử</button><button class="nt-btn dng" data-a="clear"><i class="fa-solid fa-trash"></i> Xoá tất cả thông báo</button></div></div>';
    function row(k, label, v) { return '<div class="nt-row"><label>' + esc(label) + '<span style="flex:1"></span><input type="checkbox" data-set="' + k + '" ' + (v ? 'checked' : '') + '></label></div>'; }
  }
  function renderCompose(body) {
    var recent = S.ann.slice(0, 5);
    body.innerHTML = '<div class="nt-set"><div class="nt-f"><label>Tiêu đề *</label><input type="text" id="ntcT" maxlength="120" placeholder="VD: Lịch bảo trì hệ thống"></div>' +
      '<div class="nt-f"><label>Nội dung</label><textarea id="ntcB" maxlength="600" placeholder="Nội dung gửi tới TẤT CẢ học viên..."></textarea></div>' +
      '<div class="nt-f"><label>Loại</label><select id="ntcType"><option value="announcement">Thông báo từ Admin</option><option value="update">Cập nhật hệ thống</option></select></div>' +
      '<div class="nt-row"><label>Đánh dấu quan trọng (hiện toast + âm thanh)<span style="flex:1"></span><input type="checkbox" id="ntcPin"></label></div>' +
      '<div style="margin-top:12px"><button class="nt-btn pri" data-a="send"><i class="fa-solid fa-paper-plane"></i> Gửi tới mọi người</button></div>' +
      '<h4>Đã đăng gần đây</h4>' + (recent.length ? recent.map(function (a) {
        return '<div class="nt-row"><span style="flex:1"><b>' + esc(a.title) + '</b><br><span style="color:var(--text-muted);font-size:11.5px">' + timeAgo(a.ms) + '</span></span><button class="nt-btn dng" data-annd="' + a.id + '"><i class="fa-solid fa-trash"></i></button></div>';
      }).join('') : '<div class="nt-empty" style="padding:16px">Chưa có thông báo nào</div>') + '</div>';
  }

  function onPanelClick(e) {
    var t = e.target, el;
    if ((el = t.closest('[data-del]'))) { e.stopPropagation(); S.list = S.list.filter(function (n) { return n.id !== el.dataset.del; }); saveList(); renderBadge(); renderPanel(); return; }
    if ((el = t.closest('[data-annd]'))) { delAnnouncement(el.dataset.annd); return; }
    if ((el = t.closest('.nt-item'))) { var n = S.list.filter(function (x) { return x.id === el.dataset.id; })[0]; if (n) { n.read = true; saveList(); renderBadge(); go(n.action); } return; }
    if ((el = t.closest('[data-f]'))) { S.filter = el.dataset.f; renderPanel(); return; }
    if ((el = t.closest('[data-a]'))) {
      var a = el.dataset.a;
      if (a === 'close') closePanel();
      else if (a === 'readall') markAllRead();
      else if (a === 'settings') { S.tab = S.tab === 'list' ? 'settings' : 'list'; renderPanel(); }
      else if (a === 'compose') { S.tab = S.tab === 'compose' ? 'list' : 'compose'; renderPanel(); }
      else if (a === 'clear') { if (confirm('Xoá toàn bộ thông báo?')) { S.list = []; saveList(); renderBadge(); S.tab = 'list'; renderPanel(); } }
      else if (a === 'test') push({ cat: 'system', title: 'Thông báo thử nghiệm', body: 'Mọi thứ đang hoạt động tốt 🎉', level: 'high' });
      else if (a === 'send') sendAnnouncement();
    }
  }
  function onPanelChange(e) {
    var t = e.target;
    if (t.dataset.cat) { S.settings.cats[t.dataset.cat] = t.checked; saveSet(); }
    else if (t.dataset.set) {
      var k = t.dataset.set;
      if (k === 'desktop' && t.checked) {
        if (!('Notification' in window)) { t.checked = false; return alert('Trình duyệt không hỗ trợ thông báo.'); }
        Notification.requestPermission().then(function (p) { S.settings.desktop = p === 'granted'; t.checked = S.settings.desktop; saveSet(); });
        return;
      }
      S.settings[k] = t.checked; saveSet();
    }
  }
  function markAllRead() { S.list.forEach(function (n) { n.read = true; }); saveList(); renderBadge(); if (S.open) renderPanel(); }

  function showToast(item) {
    var box = $('#ntToasts'); if (!box) return;
    var c = CATS[item.cat] || CATS.system, el = document.createElement('div');
    el.className = 'nt-toast' + (item.level === 'high' ? ' high' : ''); el.style.setProperty('--c', c.color);
    el.innerHTML = '<div class="nt-ic"><i class="fa-solid ' + esc(item.icon) + '"></i></div><div class="nt-tx"><b>' + esc(item.title) + '</b>' + (item.body ? '<span>' + esc(clip(item.body, 120)) + '</span>' : '') + '</div><button class="nt-x" aria-label="Đóng">×</button>';
    var kill = function () { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 300); };
    el.addEventListener('click', function (e) {
      if (e.target.closest('.nt-x')) return kill();
      item.read = true; saveList(); renderBadge(); if (S.open) renderPanel(); kill(); go(item.action);
    });
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(el); requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(kill, item.level === 'high' ? 12000 : 7000);
  }

  /* ==========================================================================
     3) LỊCH HỌC — 30 / 15 / 5 phút + deadline
     ======================================================================== */
  function startWeek(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); }
  function occursOn(ev, key) {
    var rep = ev.repeat || { freq: 'none' }, a = ev.date; if (!a || key < a) return false;
    if (rep.until && key > rep.until) return false;
    var d = pk(key), an = pk(a), f = rep.freq || 'none', step = Math.max(1, rep.interval || 1);
    if (f === 'none') return key === a;
    if (f === 'daily') return Math.round((d - an) / 864e5) % step === 0;
    if (f === 'weekly' || f === 'custom') {
      var by = (rep.byDay && rep.byDay.length) ? rep.byDay : [an.getDay()];
      var wk = Math.round((startWeek(d) - startWeek(an)) / (7 * 864e5));
      return wk % step === 0 && by.indexOf(d.getDay()) > -1;
    }
    if (f === 'monthly') {
      var mo = (d.getFullYear() - an.getFullYear()) * 12 + d.getMonth() - an.getMonth();
      if (mo % step) return false;
      return d.getDate() === Math.min(an.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    }
    if (f === 'yearly') return (d.getFullYear() - an.getFullYear()) % step === 0 && d.getMonth() === an.getMonth() && d.getDate() === an.getDate();
    return false;
  }
  // Trả về các lần học (occurrence) có ngày gốc trong [-1, +1] ngày quanh hôm nay
  function nearOccurrences() {
    var data = lsRaw('learningSchedule', null), out = [];
    if (!data || !Array.isArray(data.events)) return out;
    var now = new Date();
    data.events.forEach(function (ev) {
      [-1, 0, 1].forEach(function (o) {
        var orig = dayKey(addDays(now, o));
        if (!occursOn(ev, orig)) return;
        var ex = (ev.exceptions || {})[orig] || null;
        if (ex && ex.deleted) return;
        var done = ex && 'completed' in ex ? !!ex.completed : !!ev.completed;
        out.push({ ev: ev, orig: orig, date: (ex && ex.date) || orig, start: (ex && ex.startTime) || ev.startTime || '08:00', done: done });
      });
    });
    return out;
  }
  function checkSchedule() {
    var now = Date.now(), TH = [5, 15, 30];
    nearOccurrences().forEach(function (o) {
      if (o.done) return;
      var p = o.start.split(':'), dt = pk(o.date); dt.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
      var rem = (dt.getTime() - now) / 60000;
      if (rem < -1 || rem > 30) return;
      var thr = TH.filter(function (t) { return rem <= t; })[0]; if (!thr) return;
      TH.forEach(function (t) { if (t > thr) markSeen('sch:' + o.ev.id + ':' + o.date + ':' + t); });
      var mins = Math.max(1, Math.ceil(rem));
      push({
        key: 'sch:' + o.ev.id + ':' + o.date + ':' + thr, cat: 'schedule', level: 'high',
        title: 'Sắp đến giờ học: ' + o.ev.title,
        body: 'Còn khoảng ' + mins + ' phút (' + o.start + (o.ev.endTime ? ' - ' + o.ev.endTime : '') + '). Chuẩn bị sẵn sàng nhé!',
        action: { view: 'schedule' }
      });
    });
  }
  function checkDeadlines() {
    var today = dayKey(), tomorrow = dayKey(addDays(new Date(), 1));
    nearOccurrences().forEach(function (o) {
      if (o.done || !o.ev.deadline || (o.date !== today && o.date !== tomorrow)) return;
      push({
        key: 'ddl:' + o.ev.id + ':' + o.date, cat: 'schedule', level: o.date === today ? 'high' : 'normal',
        title: 'Deadline ' + (o.date === today ? 'hôm nay' : 'ngày mai') + ': ' + o.ev.title,
        body: 'Hạn lúc ' + o.start + '. Hoàn thành rồi nhớ đánh dấu ✓ trong Kế hoạch học.', action: { view: 'schedule' }
      });
    });
  }

  /* ==========================================================================
     4) STUDY FOREST — giờ học cũ, Linh Quang, nhiệm vụ, cây, cấp rừng
     ======================================================================== */
  function checkForest() {
    if (!window.Forest || !Forest.getState || !Forest._core) return;
    var d = Forest.getState(); if (!d) return;
    var C = Forest._core, act = { view: 'forest' };
    // (a) đủ giờ học cũ để đổi Linh Quang
    var L = d.legacy || {}, avail = Math.max(0, (L.baseSec || 0) - (L.convertedSec || 0));
    var units = Math.floor(avail / C.LEGACY.SEC_PER_SPARK), last = S.st.lgUnits || 0;
    if (units < last) { S.st.lgUnits = units; saveSt(); }
    else if (units >= 1 && units > last) {
      S.st.lgUnits = units; saveSt();
      push({
        key: 'lg:' + L.baseSec + ':' + L.convertedSec, cat: 'forest', level: 'high', icon: 'fa-hourglass-half',
        title: 'Bạn có thể đổi giờ học thành Linh Quang!',
        body: 'Còn ' + C.durText(avail) + ' học cũ chưa quy đổi ≈ ' + units + ' Linh Quang. Vào Study Forest để đổi.', action: act
      });
    }
    // (b) đủ Linh Quang để mua cây / vật phẩm / mở đất
    var bal = C.balance(d), lv = C.level(C.earned(d)), aff = {}, names = { t: [], d: [], land: false };
    C.SPECIES.forEach(function (s) { var R = C.RARITY[s.r]; if (lv >= R.minLevel && bal >= R.cost && d.trees.length < C.MAX_TREES) aff['t:' + s.id] = s.name; });
    C.DECOS.forEach(function (x) { if (lv >= x.lv && bal >= x.cost) aff['d:' + x.id] = x.name; });
    var nx = C.LAND[d.landLevel]; if (nx && lv >= nx.lv && bal >= nx.cost) aff.land = 'Mở rộng đất';
    var prev = S.st.aff, keys = Object.keys(aff);
    if (prev === undefined) {
      S.st.aff = keys; saveSt();
      if (keys.length) push({ key: 'aff-first', cat: 'forest', icon: 'fa-wand-sparkles', title: 'Bạn đang có ' + bal + ' Linh Quang', body: 'Đủ để mua cây hoặc vật phẩm trang trí cho khu rừng. Ghé Study Forest nhé!', action: act });
    } else {
      var fresh = keys.filter(function (k) { return prev.indexOf(k) < 0; });
      S.st.aff = keys; saveSt();
      if (fresh.length) {
        fresh.forEach(function (k) { if (k === 'land') names.land = true; else names[k[0]].push(aff[k]); });
        var parts = [];
        if (names.t.length) parts.push('Cây: ' + names.t.slice(0, 3).join(', ') + (names.t.length > 3 ? ' +' + (names.t.length - 3) : ''));
        if (names.d.length) parts.push('Vật phẩm: ' + names.d.slice(0, 3).join(', ') + (names.d.length > 3 ? ' +' + (names.d.length - 3) : ''));
        if (names.land) parts.push('Mở rộng đất');
        push({ cat: 'forest', icon: 'fa-wand-sparkles', title: 'Đủ ' + bal + ' Linh Quang để mua thêm!', body: parts.join(' · '), action: act });
      }
    }
    // (c) nhiệm vụ đã hoàn thành, chờ nhận thưởng
    C.QUESTS.forEach(function (q) {
      var b = q.scope === 'daily' ? d.day : d.week;
      if (!b || (b.claimed && b.claimed[q.id])) return;
      if (q.get(d) >= q.need) push({ key: 'q:' + q.id + ':' + b.k, cat: 'forest', icon: 'fa-list-check', title: 'Nhiệm vụ hoàn thành: ' + q.t, body: 'Nhận ngay +' + q.reward + ' Linh Quang trong tab Nhiệm vụ.', action: act });
    });
    // (d) cây lên giai đoạn, rừng lên cấp (Forest đã có toast riêng nên chỉ ghi vào trung tâm)
    var stg = S.st.stg, ns = {};
    d.trees.forEach(function (t) {
      var s = C.stageOf(t); ns[t.id] = s;
      if (stg && stg[t.id] !== undefined && s > stg[t.id] && s >= 2) push({ key: 'stg:' + t.id + ':' + s, cat: 'forest', silent: true, icon: 'fa-seedling', title: '"' + t.name + '" đã lên giai đoạn ' + C.STAGES[s], body: s >= 5 ? 'Cổ thụ phát sáng — thành quả tuyệt vời!' : 'Tiếp tục học để cây lớn thêm.', action: act });
    });
    S.st.stg = ns;
    if (S.st.flv !== undefined && lv > S.st.flv) push({ key: 'flv:' + lv, cat: 'forest', silent: true, icon: 'fa-ranking-star', title: 'Khu rừng lên cấp ' + lv, body: 'Có thể đã mở khoá thêm loài cây và vật phẩm mới.', action: act });
    S.st.flv = lv; saveSt();
  }

  /* ==========================================================================
     5) HỌC TẬP — bài giảng, chuyên đề, flashcard, quiz, pomodoro, mục tiêu, chuỗi...
     ======================================================================== */
  function checkCourse() {
    var prog = lsRaw('courseModule_progress', {}), lessons = lsRaw('courseModule_lessons', []), cats = lsRaw('courseModule_categories', []);
    var done = {}; Object.keys(prog).forEach(function (id) { if (prog[id] && prog[id].completed) done[id] = 1; });
    var catDone = {};
    cats.forEach(function (c) {
      var ls = lessons.filter(function (l) { return l.categoryId === c.id && l.visible !== false; });
      if (ls.length && ls.every(function (l) { return done[l.id]; })) catDone[c.id] = 1;
    });
    if (!S.st.cdone) { S.st.cdone = done; S.st.ccat = catDone; saveSt(); return; }
    Object.keys(done).forEach(function (id) {
      if (S.st.cdone[id]) return;
      var l = lessons.filter(function (x) { return x.id === id; })[0];
      push({ key: 'les:' + id, cat: 'learning', icon: 'fa-circle-check', title: 'Hoàn thành bài học', body: l ? l.title : 'Bạn vừa hoàn thành một bài giảng.', action: { view: 'course', lesson: id } });
    });
    Object.keys(catDone).forEach(function (id) {
      if (S.st.ccat[id]) return;
      var c = cats.filter(function (x) { return x.id === id; })[0];
      push({ key: 'crs:' + id, cat: 'learning', level: 'high', icon: 'fa-graduation-cap', title: '🎓 Hoàn thành chuyên đề!', body: c ? c.name : 'Bạn đã học xong toàn bộ bài trong chuyên đề.', action: { view: 'course' } });
      push({ key: 'crsach:' + id, cat: 'achievement', silent: true, icon: 'fa-award', title: 'Thành tích mới: hoàn thành chuyên đề', body: c ? c.name : '', action: { view: 'course' } });
    });
    S.st.cdone = done; S.st.ccat = catDone; saveSt();
  }
  // flashcard.js không phát sự kiện → nhận biết màn "Hoàn thành lượt học" trên DOM
  function checkFlash() {
    var sum = $('#fcRoot .fc-sum');
    if (sum && !S.fcSum) {
      S.fcSum = true;
      var nums = $$('.row b', sum).map(function (b) { return b.textContent; });
      var weak = $('[data-mode="weak"]', sum);
      var all = weak && weak.disabled;
      push({
        cat: 'learning', icon: 'fa-clone', level: all ? 'high' : 'normal',
        title: all ? '🎉 Bạn đã thuộc toàn bộ bộ thẻ!' : 'Hoàn thành lượt học flashcard',
        body: nums.length >= 3 ? 'Đã thuộc ' + nums[0] + ' · Hơi nhớ ' + nums[1] + ' · Chưa thuộc ' + nums[2] + ' lượt' : 'Tiếp tục ôn thẻ chưa thuộc để nhớ lâu hơn.', action: { view: 'flashcard' }
      });
    } else if (!sum) S.fcSum = false;
  }
  function streakOf(log) {
    var d = new Date(), n = 0;
    if (!(log[dayKey(d)] && log[dayKey(d)].count > 0)) d.setDate(d.getDate() - 1);
    while (log[dayKey(d)] && log[dayKey(d)].count > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  var MILES = [3, 5, 7, 10, 14, 21, 30, 50, 60, 100, 150, 200, 365];
  function checkStudy() {
    var pomo = lsRaw('examMasterPro_tools_pomo', null);
    if (pomo && typeof pomo.done === 'number') {
      if (S.st.pomo === undefined || pomo.done < S.st.pomo) { S.st.pomo = pomo.done; saveSt(); }
      else if (pomo.done > S.st.pomo) {
        push({ cat: 'learning', icon: 'fa-stopwatch', title: 'Hoàn thành phiên Pomodoro 🍅', body: 'Hôm nay bạn đã xong ' + (pomo.done - S.st.pomo) + ' phiên mới. Nghỉ ngơi một chút nhé!', action: null });
        S.st.pomo = pomo.done; saveSt();
      }
    }
    var log = lsRaw('examMasterPro_dailyLog', {}), today = dayKey(), t = log[today] || {};
    var goal = lsRaw('examMasterPro_tools_goal', 30);
    if (goal > 0 && (t.correct || 0) + (t.wrong || 0) >= goal)
      push({ key: 'goal:' + today, cat: 'learning', level: 'high', icon: 'fa-bullseye', title: '🎯 Đạt mục tiêu hôm nay!', body: 'Bạn đã làm ' + ((t.correct || 0) + (t.wrong || 0)) + '/' + goal + ' câu. Giỏi lắm!', action: { view: 'dashboard' } });
    var st = streakOf(log);
    if (!S.st.streakBase) { MILES.forEach(function (m) { if (m <= st) markSeen('streak:' + m + ':' + dayKey(addDays(new Date(), -(st - 1)))); }); S.st.streakBase = 1; saveSt(); return; }
    var hit = MILES.filter(function (m) { return m <= st; }).pop();
    if (hit) {
      var start = dayKey(addDays(new Date(), -(st - 1)));
      MILES.forEach(function (m) { if (m < hit) markSeen('streak:' + m + ':' + start); });
      push({ key: 'streak:' + hit + ':' + start, cat: 'achievement', level: 'high', icon: 'fa-fire', title: '🔥 Chuỗi ' + hit + ' ngày học liên tiếp!', body: 'Duy trì phong độ này nhé — đừng để đứt chuỗi.', action: { view: 'dashboard' } });
    }
  }
  function daily() {
    var now = new Date(), today = dayKey(now), log = lsRaw('examMasterPro_dailyLog', {});
    // đếm ngược ngày thi
    var exam = lsRaw('examMasterPro_tools_exam', '');
    if (exam) {
      var days = Math.round((pk(exam) - pk(today)) / 864e5);
      if ([30, 14, 7, 3, 2, 1, 0].indexOf(days) > -1)
        push({ key: 'exam:' + exam + ':' + days, cat: 'learning', level: days <= 3 ? 'high' : 'normal', icon: 'fa-hourglass-half', title: days === 0 ? '📝 Hôm nay là ngày thi — chúc bạn may mắn!' : 'Còn ' + days + ' ngày nữa là đến ngày thi', body: days === 0 ? 'Bình tĩnh, tự tin và làm hết sức mình nhé.' : 'Rà lại câu sai và các phần còn yếu.', action: { view: 'reviewWrong' } });
    }
    // chuỗi sắp đứt
    var st = streakOf(log), studied = log[today] && log[today].count > 0;
    if (now.getHours() >= 20 && st > 0 && !studied)
      push({ key: 'risk:' + today, cat: 'learning', level: 'high', icon: 'fa-fire-flame-curved', title: 'Chuỗi ' + st + ' ngày sắp bị đứt!', body: 'Hôm nay bạn chưa học. Chỉ cần 1 phần nhỏ là giữ được chuỗi.', action: { view: 'parts' } });
    // câu sai đến hạn ôn (cách quãng 1-3 ngày)
    var bank = lsRaw('examMasterPro_wrongBank', {}), gaps = [3, 2, 1], due = 0, total = 0;
    Object.keys(bank).forEach(function (id) {
      total++; var r = bank[id] || {}, tm = Date.parse(r.lastDate || '');
      if (!tm || (Date.now() - tm) / 864e5 >= gaps[Math.min(Math.max(r.count || 1, 1), 3) - 1]) due++;
    });
    if (due > 0) push({ key: 'due:' + today, cat: 'learning', icon: 'fa-rotate-left', title: 'Có ' + due + ' câu sai đến hạn ôn lại', body: 'Ôn đúng lúc giúp nhớ lâu hơn (tổng ' + total + ' câu sai).', action: { view: 'reviewWrong' } });
    checkDeadlines();
  }

  /* ==========================================================================
     6) FIRESTORE LISTENERS
     ======================================================================== */
  function listen(q, onSnap, tag) {
    var un = q.onSnapshot(onSnap, function (err) {
      if (!S.errTags[tag]) { S.errTags[tag] = 1; console.warn('[Noti] Không nghe được "' + tag + '":', err && err.code ? err.code : err); }
    });
    S.unsubs.push(un);
  }
  // Theo dõi nội dung mới bằng mốc createdAt đã lưu → bắt được cả nội dung đăng lúc bạn offline
  function watchNew(name, q, mk) {
    listen(q, function (snap) {
      var max = S.st.cts[name], first = max === undefined, nm = max || 0, fresh = [];
      snap.docs.forEach(function (d) {
        var x = d.data(), m = tsMs(x.createdAt) || 0;
        if (m > nm) nm = m;
        if (!first && m > max) fresh.push({ id: d.id, d: x, m: m });
      });
      S.st.cts[name] = nm; saveSt();
      fresh.sort(function (a, b) { return a.m - b.m; }).slice(-5).forEach(function (f) {
        var n = mk(f.id, f.d); if (n) { n.key = name + ':' + f.id; push(n); }
      });
    }, name);
  }

  function startListeners(db, uid) {
    // --- hồ sơ tài khoản: được duyệt / đổi vai trò ---
    listen(db.collection('users').doc(uid), function (s) {
      if (!s.exists) return; var d = s.data(), prev = S.st.acc, cur = { role: d.role || 'user', status: d.status || '' };
      var am = tsMs(d.approvedAt);
      if (am && Date.now() - am < 30 * 864e5)
        push({ key: 'appr:' + uid + ':' + am, cat: 'account', level: 'high', icon: 'fa-user-check', title: '🎉 Tài khoản đã được duyệt', body: 'Chào mừng bạn' + (d.approvedBy ? ' (duyệt bởi ' + d.approvedBy + ')' : '') + '! Bạn có thể dùng toàn bộ tính năng.', action: { view: 'dashboard' } });
      if (prev && prev.role !== cur.role)
        push({ cat: 'account', level: 'high', icon: 'fa-user-shield', title: cur.role === 'admin' ? 'Bạn được cấp quyền Admin' : 'Quyền Admin đã được thu hồi', body: 'Tải lại trang để áp dụng đầy đủ quyền mới.', action: null });
      S.st.acc = cur; saveSt();
    }, 'users');

    // --- thông báo / cập nhật hệ thống do Admin đăng ---
    listen(db.collection('adminAnnouncements').orderBy('createdAt', 'desc').limit(30), function (snap) {
      S.ann = snap.docs.map(function (d) { var x = d.data(); return { id: d.id, title: x.title || '', ms: tsMs(x.createdAt) || Date.now() }; });
      if (S.open && S.tab === 'compose') renderPanel();
      snap.docChanges().forEach(function (c) {
        if (c.type !== 'added') return;
        var x = c.doc.data(), ms = tsMs(x.createdAt) || Date.now(), key = 'ann:' + c.doc.id;
        if (x.createdByUid === uid || Date.now() - ms > 7 * 864e5) { markSeen(key); return; }
        push({ key: key, cat: x.type === 'update' ? 'system' : 'admin', level: x.pinned ? 'high' : 'normal', icon: x.type === 'update' ? 'fa-rotate' : 'fa-bullhorn', ts: ms, title: x.title || 'Thông báo mới', body: x.body || '', action: null });
      });
    }, 'adminAnnouncements');

    // --- bài luận: được chấm / nhận xét mới ---
    listen(db.collection('essaySubmissions').where('studentUid', '==', uid), function (snap) {
      snap.docChanges().forEach(function (c) {
        if (c.type === 'removed') return; var x = c.doc.data(); if (x.status !== 'reviewed') return;
        var rm = tsMs(x.reviewedAt) || 0, name = (x.studentEssay && x.studentEssay.name) || 'Bài luận', key = 'essay:' + c.doc.id + ':' + rm + ':' + hash(x.teacherComment);
        if (rm && Date.now() - rm > 3 * 864e5) { markSeen(key); return; }
        push({ key: key, cat: 'essay', level: 'high', icon: 'fa-pen-nib', title: 'Bài luận "' + clip(name, 40) + '" đã được chấm', body: (x.reviewedBy || 'Giáo viên') + (x.teacherScore != null ? ' chấm ' + x.teacherScore + ' điểm' : ' đã nhận xét') + (x.teacherComment ? ': ' + clip(x.teacherComment, 90) : '.'), action: A_ESSAY_MINE });
      });
    }, 'essay-mine');

    // --- cộng đồng: thông báo, tin nhắn, hồ sơ ---
    var SOC = {
      like: ['fa-thumbs-up', 'đã bày tỏ cảm xúc về bài viết của bạn'], comment: ['fa-comment', 'đã bình luận bài viết của bạn'],
      reply: ['fa-reply', 'đã trả lời bình luận của bạn'], friend_request: ['fa-user-plus', 'đã gửi lời mời kết bạn'],
      friend_accept: ['fa-user-check', 'đã chấp nhận lời mời kết bạn'], follow: ['fa-user-plus', 'đã theo dõi bạn'],
      best_answer: ['fa-award', 'đã chọn câu trả lời của bạn là hay nhất'], share: ['fa-share', 'đã chia sẻ bài viết của bạn']
    };
    listen(db.collection('social_notifications').where('uid', '==', uid), function (snap) {
      var first = !S.socFirst; S.socFirst = true;
      var docs = snap.docChanges().filter(function (c) { return c.type === 'added' && !c.doc.metadata.hasPendingWrites; }).map(function (c) { return c.doc; });
      if (first) docs = docs.filter(function (d) { return d.data().read === false; }).sort(function (a, b) { return tsMs(b.data().createdAt) - tsMs(a.data().createdAt); }).slice(0, 15);
      docs.forEach(function (d) {
        var x = d.data(), m = SOC[x.type] || ['fa-bell', 'có hoạt động mới'];
        push({
          key: 'soc:' + d.id, cat: 'social', silent: true, icon: m[0], ts: tsMs(x.createdAt) || Date.now(),
          title: (x.fromName || 'Ai đó') + ' ' + m[1], body: x.excerpt ? '"' + x.excerpt + '"' : '',
          action: x.type === 'friend_request' || x.type === 'friend_accept' ? { view: 'social', tab: 'friends' } : x.postId ? { view: 'social', hash: '#social-post-' + x.postId } : { view: 'social', tab: 'notifications' }
        });
      });
    }, 'social-notifs');
    listen(db.collection('social_conversations').where('members', 'array-contains', uid), function (snap) {
      snap.docChanges().forEach(function (c) {
        if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) return;
        var v = c.doc.data(), um = tsMs(v.updatedAt);
        if (!v.lastFrom || v.lastFrom === uid || ((v.seen || {})[uid] || 0) >= um) return;
        push({ cat: 'social', silent: true, icon: 'fa-message', group: 'dm:' + c.doc.id, ts: um || Date.now(), title: 'Tin nhắn mới từ ' + ((v.names || {})[v.lastFrom] || 'ai đó'), body: clip(v.lastMessage || '', 90), action: { view: 'social', tab: 'messages' } });
      });
    }, 'social-convs');
    var SLV = [['Bronze', 0], ['Silver', 300], ['Gold', 1200], ['Diamond', 4000], ['Master', 10000], ['Legend', 25000]];
    var SBD = [['Bài viết đầu tiên', function (p) { return (p.postCount || 0) >= 1; }], ['50 bài viết', function (p) { return (p.postCount || 0) >= 50; }],
      ['100 bình luận', function (p) { return (p.commentCount || 0) >= 100; }], ['Người hay giúp đỡ', function (p) { return (p.bestAnswerCount || 0) >= 1; }], ['Top Contributor', function (p) { return (p.exp || 0) >= 5000; }]];
    listen(db.collection('social_profiles').doc(uid), function (s) {
      if (!s.exists) return; var p = s.data(), exp = p.exp || 0, lv = 0;
      SLV.forEach(function (l, i) { if (exp >= l[1]) lv = i; });
      var bd = SBD.filter(function (b) { return b[1](p); }).map(function (b) { return b[0]; });
      if (S.st.slv !== undefined && lv > S.st.slv) push({ key: 'slv:' + lv, cat: 'achievement', level: 'high', icon: 'fa-ranking-star', title: 'Lên hạng cộng đồng: ' + SLV[lv][0], body: 'Bạn đã đạt ' + exp + ' EXP trong cộng đồng.', action: { view: 'social', tab: 'leaderboard' } });
      if (S.st.sbd) bd.forEach(function (b) { if (S.st.sbd.indexOf(b) < 0) push({ key: 'sbd:' + b, cat: 'achievement', icon: 'fa-medal', title: 'Huy hiệu mới: ' + b, body: 'Xem trong hồ sơ cộng đồng của bạn.', action: { view: 'social' } }); });
      if (S.st.banned !== undefined && !!p.banned !== S.st.banned) push({ cat: 'account', level: 'high', icon: p.banned ? 'fa-ban' : 'fa-lock-open', title: p.banned ? 'Bạn đang bị khoá đăng bài / chat' : 'Bạn đã được mở khoá cộng đồng', body: p.banned ? 'Liên hệ Admin nếu bạn cho rằng đây là nhầm lẫn.' : 'Bạn có thể đăng bài và trò chuyện bình thường.', action: null });
      S.st.slv = lv; S.st.sbd = bd; S.st.banned = !!p.banned; saveSt();
    }, 'social-profile');

    // --- nội dung mới ---
    watchNew('courseLessons', db.collection('courseLessons'), function (id, d) { return d.visible === false ? null : { cat: 'content', icon: 'fa-clapperboard', title: 'Bài giảng mới', body: d.title || '', action: { view: 'course', lesson: id } }; });
    watchNew('communityExams', db.collection('communityExams').orderBy('createdAt', 'desc').limit(20), function (id, d) { return d.createdByUid === uid ? null : { cat: 'content', icon: 'fa-users', title: 'Đề cộng đồng mới', body: (d.name || 'Đề mới') + ' — bởi ' + (d.createdByEmail || 'thành viên'), action: { view: 'community' } }; });
    if (!S.admin) {
      watchNew('sharedCustomExams', db.collection('sharedCustomExams').orderBy('createdAt', 'desc').limit(20), function (id, d) { return { cat: 'content', icon: 'fa-file-circle-plus', title: 'Admin vừa thêm đề mới', body: d.name || '', action: { view: 'customExam' } }; });
      var docMk = function (id, d) { return { cat: 'content', icon: 'fa-book-bookmark', title: 'Tài liệu mới', body: d.title || d.fileName || '', action: { doc: id } }; };
      watchNew('studyDocs', db.collection('studyDocs').where('visibility', '==', 'all'), docMk);
      if (S.email) watchNew('studyDocsG', db.collection('studyDocs').where('allowedEmails', 'array-contains', S.email), docMk);
    }
    listen(db.collection('sharedQuestionBank').doc('main'), function (s) {
      if (!s.exists) return; var m = tsMs(s.data().updatedAt) || 0, prev = S.st.bank;
      if (prev !== undefined && m > prev) push({ key: 'bank:' + m, cat: 'system', level: 'high', icon: 'fa-database', title: 'Ngân hàng câu hỏi đã được cập nhật', body: 'Admin vừa cập nhật ' + (s.data().totalQuestions || '') + ' câu gốc. Danh sách phần có thể đã thay đổi.', action: { view: 'parts' } });
      S.st.bank = Math.max(m, prev || 0); saveSt();
    }, 'questionBank');

    // --- riêng Admin ---
    if (S.admin) {
      listen(db.collection('essaySubmissions').orderBy('submittedAt', 'desc'), function (snap) {
        var first = !S.admEssay; S.admEssay = true;
        if (first) {
          var n = snap.docs.filter(function (d) { return d.data().status !== 'reviewed'; }).length;
          if (n) push({ key: 'pend-essay:' + dayKey(), cat: 'adminwork', icon: 'fa-pen-nib', title: 'Có ' + n + ' bài luận đang chờ chấm', body: 'Vào "Chấm bài luận AI" → Quản lý bài nộp để xem.', action: A_ESSAY_ADMIN });
          return;
        }
        snap.docChanges().forEach(function (c) {
          if (c.type !== 'added' || c.doc.metadata.hasPendingWrites) return; var x = c.doc.data();
          if (x.status === 'reviewed' || x.studentUid === uid) return;
          push({ key: 'sub:' + c.doc.id, cat: 'adminwork', level: 'high', icon: 'fa-inbox', title: 'Bài luận mới cần chấm', body: (x.studentName || x.studentEmail || 'Học viên') + ' vừa nộp "' + clip((x.studentEssay && x.studentEssay.name) || 'bài làm', 40) + '"', action: A_ESSAY_ADMIN });
        });
      }, 'essay-admin');
      listen(db.collection('loginRequests').where('status', '==', 'pending'), function (snap) {
        var first = !S.admLogin; S.admLogin = true;
        if (first) { if (snap.size) push({ key: 'pend-login:' + dayKey(), cat: 'adminwork', icon: 'fa-user-clock', title: snap.size + ' yêu cầu đăng nhập đang chờ duyệt', body: 'Vào "Quản lý đăng nhập" để phê duyệt.', action: { view: 'signinManager' } }); return; }
        snap.docChanges().forEach(function (c) {
          if (c.type !== 'added') return; var x = c.doc.data();
          push({ key: 'lr:' + c.doc.id, cat: 'adminwork', level: 'high', icon: 'fa-user-plus', title: 'Yêu cầu đăng nhập mới', body: (x.displayName || '') + ' (' + (x.email || '') + ') đang chờ duyệt.', action: { view: 'signinManager' } });
        });
      }, 'login-requests');
      listen(db.collection('social_reports').where('status', '==', 'open'), function (snap) {
        var first = !S.admRep; S.admRep = true;
        if (first) { if (snap.size) push({ key: 'pend-rep:' + dayKey(), cat: 'adminwork', icon: 'fa-flag', title: snap.size + ' báo cáo vi phạm chưa xử lý', body: 'Xem trong Thảo luận → Quản trị.', action: { view: 'social', tab: 'admin' } }); return; }
        snap.docChanges().forEach(function (c) {
          if (c.type !== 'added') return; var x = c.doc.data();
          push({ key: 'rep:' + c.doc.id, cat: 'adminwork', level: 'high', icon: 'fa-flag', title: 'Báo cáo vi phạm mới', body: (x.reason || '') + ' — bởi ' + (x.reporterName || 'người dùng'), action: { view: 'social', tab: 'admin' } });
        });
      }, 'reports');
    }
  }

  /* ==========================================================================
     7) THÀNH TÍCH / THỨ HẠNG (bảng xếp hạng — kiểm tra định kỳ để tiết kiệm lượt đọc)
     ======================================================================== */
  function checkRank(force) {
    var db = DB(); if (!db || !S.uid) return;
    if (!force && Date.now() - S.lastRank < 60000) return; S.lastRank = Date.now();
    db.collection('leaderboard').get().then(function (snap) {
      if (!S.started) return;
      var arr = snap.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); });
      var i = arr.findIndex(function (x) { return x.uid === S.uid; }); if (i < 0) return;
      var rank = i + 1, me = arr[i], prev = S.st.rank, act = { view: 'halloffame' };
      if (prev != null && rank !== prev) {
        var up = rank < prev;
        push({ cat: 'achievement', level: up ? 'high' : 'normal', icon: up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', title: up ? '📈 Bạn thăng hạng #' + prev + ' → #' + rank : 'Thứ hạng thay đổi #' + prev + ' → #' + rank, body: up ? 'Tiếp tục luyện đề để vượt thêm người dẫn đầu!' : 'Có người vừa vượt qua bạn. Luyện thêm để lấy lại vị trí nhé.', action: act });
      }
      if (rank <= 3 && (prev == null || prev > 3)) push({ key: 'top3:' + rank + ':' + dayKey(), cat: 'achievement', level: 'high', icon: 'fa-crown', title: '👑 Bạn đang ở Top ' + rank + ' bảng xếp hạng!', body: 'Tổng ' + arr.length + ' học viên — thành tích tuyệt vời.', action: act });
      var a = S.st.lb;
      if (a) {
        if ((me.level || 1) > a.level) push({ key: 'lv:' + me.level, cat: 'achievement', level: 'high', icon: 'fa-layer-group', title: 'Lên cấp độ Lv.' + me.level, body: 'Điểm kinh nghiệm: ' + (me.xp || 0) + ' XP.', action: act });
        if ((me.achievementCount || 0) > a.ach) push({ key: 'ach:' + me.achievementCount, cat: 'achievement', icon: 'fa-trophy', title: 'Mở khoá thành tích mới', body: 'Tổng ' + me.achievementCount + ' thành tích.', action: act });
        if ((me.badgeCount || 0) > a.bd) push({ key: 'bd:' + me.badgeCount, cat: 'achievement', icon: 'fa-medal', title: 'Nhận huy hiệu mới', body: 'Bạn có ' + me.badgeCount + ' huy hiệu.', action: act });
      }
      S.st.rank = rank; S.st.lb = { level: me.level || 1, ach: me.achievementCount || 0, bd: me.badgeCount || 0 }; saveSt();
    }).catch(function (e) { if (!S.errTags.lb) { S.errTags.lb = 1; console.warn('[Noti] leaderboard:', e); } });
  }

  /* ==========================================================================
     8) HỆ THỐNG: mạng, tự đăng xuất, hook vào quiz / đề PDF
     ======================================================================== */
  function onAct() { S.lastAct = Date.now(); S.warned = false; }
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (ev) { document.addEventListener(ev, onAct, { passive: true, capture: true }); });
  function checkIdle() {
    var lim = idleLimit(), idle = (Date.now() - S.lastAct) / 60000;
    if (!S.warned && idle >= lim - 2 && idle < lim) {
      S.warned = true;
      push({ cat: 'system', level: 'high', icon: 'fa-clock', title: 'Sắp tự động đăng xuất', body: 'Bạn không thao tác trong ' + Math.floor(idle) + ' phút. Hệ thống sẽ đăng xuất sau khoảng 2 phút nữa.', action: null });
    }
  }
  window.addEventListener('offline', function () { push({ cat: 'system', level: 'high', icon: 'fa-wifi', title: 'Mất kết nối Internet', body: 'Đồng bộ, cộng đồng và chấm luận AI tạm dừng. Dữ liệu học vẫn được lưu trên máy.', action: null }); });
  window.addEventListener('online', function () { push({ cat: 'system', icon: 'fa-wifi', title: 'Đã kết nối lại', body: 'Dữ liệu sẽ tự động đồng bộ.', action: null }); });

  function hookApp() {
    safe(function () {
      var ui = UIM();
      if (ui && !ui.__notiWrapped && typeof ui.navigate === 'function') {
        ui.__notiWrapped = true; var nav = ui.navigate.bind(ui);
        ui.navigate = function (v) { var r = nav(v); if (S.open) closePanel(); return r; };
      }
    }, 'hook-nav');
    safe(function () {
      if (typeof QuizManager !== 'undefined' && QuizManager && !QuizManager.__notiWrapped) {
        QuizManager.__notiWrapped = true; var fq = QuizManager.finishQuiz.bind(QuizManager);
        QuizManager.finishQuiz = function () {
          var st = QuizManager.state, r = fq();
          safe(function () {
            if (!st) return;
            var rec = (typeof ScoreManager !== 'undefined' && ScoreManager.getFor) ? ScoreManager.getFor(st.partId) : null;
            var sc = rec && !st.isPureReview ? rec.last : null, tot = st.totalOriginal || 0, ok = st.firstTryCorrectIds ? st.firstTryCorrectIds.size : 0;
            push({ cat: 'learning', level: sc != null && sc >= 8 ? 'high' : 'normal', icon: 'fa-flag-checkered', title: (st.isPureReview ? 'Hoàn thành ôn tập: ' : 'Hoàn thành: ') + st.partName, body: sc != null ? 'Điểm ' + sc.toFixed(2) + '/10 — đúng ' + ok + '/' + tot + ' câu ngay lần đầu.' : 'Bạn đã xong lượt ôn tập này.', action: { view: 'history' } });
            setTimeout(function () { checkForest(); checkStudy(); checkRank(); }, 2500);
          }, 'quiz');
          return r;
        };
      }
    }, 'hook-quiz');
    safe(function () {
      if (typeof PdfExamManager !== 'undefined' && PdfExamManager && !PdfExamManager.__notiWrapped) {
        PdfExamManager.__notiWrapped = true; var fp = PdfExamManager.submit.bind(PdfExamManager);
        PdfExamManager.submit = function () {
          var was = PdfExamManager.state && !PdfExamManager.state.finished, r = fp();
          safe(function () {
            if (!was || !PdfExamManager.state || !PdfExamManager.state.finished) return;
            var e = PdfExamManager.state.exam, sc = ($('#peResultScoreVal') || {}).textContent;
            push({ cat: 'learning', icon: 'fa-file-pdf', title: 'Đã nộp đề PDF: ' + e.name, body: 'Điểm ' + (sc || '—') + '/10. Xem chi tiết từng câu ở bảng kết quả.', action: { view: 'history' } });
            setTimeout(function () { checkStudy(); checkRank(); }, 2500);
          }, 'pdf');
          return r;
        };
      }
    }, 'hook-pdf');
    safe(function () {
      if (typeof CloudSync !== 'undefined' && CloudSync && !CloudSync.__notiWrapped) {
        CloudSync.__notiWrapped = true; var t = CloudSync.teardown.bind(CloudSync);
        CloudSync.teardown = function () { stop(); return t(); };
      }
    }, 'hook-teardown');
  }

  /* ==========================================================================
     9) ADMIN: đăng / xoá thông báo
     ======================================================================== */
  function sendAnnouncement() {
    var title = ($('#ntcT') || {}).value, body = ($('#ntcB') || {}).value, type = ($('#ntcType') || {}).value, pin = ($('#ntcPin') || {}).checked;
    title = (title || '').trim(); if (!title) return alert('Vui lòng nhập tiêu đề.');
    var u = AU().currentUser;
    DB().collection('adminAnnouncements').add({
      title: title.slice(0, 120), body: (body || '').trim().slice(0, 600), type: type === 'update' ? 'update' : 'announcement', pinned: !!pin,
      createdAt: FV().serverTimestamp(), createdByUid: u.uid, createdByEmail: (u.email || '').toLowerCase()
    }).then(function () {
      push({ cat: 'system', icon: 'fa-check', title: 'Đã gửi thông báo tới mọi người', body: title, action: null });
      S.tab = 'list'; renderPanel();
    }).catch(function (e) { alert('Không gửi được: ' + (e.code === 'permission-denied' ? 'thiếu Firestore Rules cho adminAnnouncements (xem đầu file noti.js).' : e.message)); });
  }
  function delAnnouncement(id) {
    if (!confirm('Xoá thông báo này? Người dùng sẽ không thấy nó ở lần tải sau (bản đã nhận vẫn còn trong máy họ).')) return;
    DB().collection('adminAnnouncements').doc(id).delete().catch(function (e) { alert('Không xoá được: ' + e.message); });
  }

  /* ==========================================================================
     10) VÒNG ĐỜI
     ======================================================================== */
  function start(user) {
    var db = DB(); if (!db) return;
    S.uid = user.uid; S.email = String(user.email || '').toLowerCase(); S.admin = isAdmin();
    loadAll(); S.started = true; S.errTags = {}; S.socFirst = S.admEssay = S.admLogin = S.admRep = false; S.lastAct = Date.now();
    injectDom(); var b = $('#notiBellBtn'); if (b) b.classList.add('on');
    renderBadge(); if (S.open) renderPanel();
    if (S.st.ver !== APP_VERSION) {
      var firstEver = !S.st.ver; S.st.ver = APP_VERSION; saveSt();
      push({ key: 'ver:' + APP_VERSION, cat: 'system', level: 'high', icon: 'fa-wand-magic-sparkles', title: firstEver ? 'Chào mừng đến Trung tâm thông báo' : 'Cập nhật: ' + CHANGELOG.title, body: CHANGELOG.body, action: null });
    }
    startListeners(db, user.uid);
    var fast = function () { safe(checkSchedule, 'schedule'); safe(checkIdle, 'idle'); };
    var mid = function () { safe(checkForest, 'forest'); safe(checkCourse, 'course'); safe(checkStudy, 'study'); };
    S.timers.push(setInterval(fast, 15000), setInterval(mid, 10000), setInterval(function () { safe(checkFlash, 'flash'); }, 1500),
      setInterval(function () { safe(daily, 'daily'); }, 300000), setInterval(function () { checkRank(); }, 600000),
      setInterval(function () { if (S.open) renderPanel(); }, 60000));
    setTimeout(function () { if (!S.started) return; fast(); mid(); safe(daily, 'daily'); }, 3000);
    setTimeout(function () { if (S.started) checkRank(true); }, 12000);
  }
  function stop() {
    S.started = false;
    S.unsubs.forEach(function (f) { try { f(); } catch (e) { } }); S.unsubs = [];
    S.timers.forEach(function (t) { clearInterval(t); }); S.timers = [];
    S.uid = null; S.list = []; S.ann = []; S.fcSum = false;
    var b = $('#notiBellBtn'); if (b) b.classList.remove('on');
    closePanel(); var t = $('#ntToasts'); if (t) t.innerHTML = '';
  }
  function boot() {
    safe(function () {
      injectDom(); hookApp();
      var a = AU(), ok = !!(window.__appInitialized && a && a.currentUser && DB());
      if (ok && !S.started) start(a.currentUser);
      else if (ok && S.started && a.currentUser.uid !== S.uid) { stop(); start(a.currentUser); }
      else if (!ok && S.started) stop();
    }, 'boot');
  }
  document.addEventListener('DOMContentLoaded', function () { injectDom(); hookApp(); });
  setInterval(boot, 1500); boot();

  window.Noti = {
    push: push, open: openPanel, close: closePanel, markAllRead: markAllRead,
    unread: unread, list: function () { return S.list.slice(); },
    clear: function () { S.list = []; saveList(); renderBadge(); if (S.open) renderPanel(); }
  };
})();
