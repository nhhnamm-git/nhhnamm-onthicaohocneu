/* ============================================================================
   SIGNIN.JS — ENTERPRISE ACCESS CONTROL & USER MANAGEMENT
   ----------------------------------------------------------------------------
   File này TỰ ĐỘNG mở rộng website (index.html) mà KHÔNG sửa bất kỳ dòng nào
   trong index.html. Toàn bộ giao diện, logic được inject bằng JavaScript.

   Cách hoạt động:
   - Ghi đè (monkey-patch) AuthManager.checkAccess / doSignOut ngay khi file
     này chạy (chạy đồng bộ, trước khi AuthManager.init() được gọi ở sự kiện
     DOMContentLoaded) để chuyển toàn bộ luồng đăng nhập/kiểm tra quyền từ
     collection "allowedUsers" cũ sang kiến trúc 3 collection mới:
       users        — hồ sơ đầy đủ của từng người dùng (doc id = uid)
       loginRequests— yêu cầu đăng nhập / phê duyệt
       auditLogs    — nhật ký thao tác của admin
   - Khi là admin, tự động chèn thêm mục menu "Quản lý đăng nhập" vào sidebar
     và một view mới vào <main class="content"> (id="view-signinManager"),
     đồng thời "wrap" UIManager.navigate (đúng kỹ thuật mà chính index.html
     đã dùng cho tính năng "Đề cộng đồng") để điều hướng tới view này.
   - Cung cấp API public: window.SignInManager.updateStudyProgress(...),
     .updateQuiz(...), .updateVideo(...), .addStudyMinutes(...) và các hook
     video (videoStarted/videoPaused/videoFinished/watchSeconds/watchCount)
     để các module học tập sau này gọi vào, tự động ghi lên Firestore.

   ⚠️ GHI CHÚ VỀ FIRESTORE SECURITY RULES (không thể nhúng trong file .js —
   cần cấu hình riêng trong Firebase Console > Firestore > Rules):

   match /databases/{database}/documents {
     function myDoc() {
       return get(/databases/$(database)/documents/users/$(request.auth.uid));
     }
     function isAdmin() {
       return request.auth != null && myDoc().data.role == 'admin'
              && myDoc().data.approved == true && myDoc().data.status == 'active';
     }
     match /users/{uid} {
       allow read: if request.auth != null && (request.auth.uid == uid || isAdmin());
       allow create: if request.auth != null && request.auth.uid == uid;
       allow update: if request.auth != null && (request.auth.uid == uid || isAdmin());
       allow delete: if false;
       match /loginHistory/{docId} {
         allow read: if request.auth != null && (request.auth.uid == uid || isAdmin());
         allow create: if request.auth != null;
       }
     }
     match /loginRequests/{docId} {
       allow read: if isAdmin();
       allow create: if request.auth != null;
       allow update: if isAdmin();
     }
     match /auditLogs/{docId} {
       allow read: if isAdmin();
       allow create: if request.auth != null;
     }
   }
   ========================================================================== */

(function () {
  'use strict';

  /* ==========================================================================
     0. HẰNG SỐ / TIỆN ÍCH CHUNG
     ========================================================================== */
  const COL_USERS = 'users';
  const COL_REQUESTS = 'loginRequests';
  const COL_AUDIT = 'auditLogs';
  const SUB_HISTORY = 'loginHistory';

  const ONLINE_WINDOW_MS = 3 * 60 * 1000;      // coi là online nếu hoạt động trong 3 phút gần nhất
  const HEARTBEAT_MS = 60 * 1000;              // cập nhật lastActive mỗi 60s
  const REALTIME_REPAINT_MS = 30 * 1000;       // vẽ lại online/offline mỗi 30s
  const PATCH_DEBOUNCE_MS = 1200;              // gộp ghi Firestore cho API học tập

  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const inc = (n) => firebase.firestore.FieldValue.increment(n);

  function escapeHtml(s) {
    if (window.Utils && typeof Utils.escapeHtml === 'function') return Utils.escapeHtml(String(s ?? ''));
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function fmtDate(v) {
    if (!v) return '-';
    let d;
    if (v && typeof v.toDate === 'function') d = v.toDate();
    else if (v instanceof Date) d = v;
    else if (typeof v === 'number') d = new Date(v);
    else return '-';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtMinutes(m) {
    m = Number(m) || 0;
    const h = Math.floor(m / 60), mm = Math.round(m % 60);
    return h > 0 ? `${h}h ${mm}p` : `${mm}p`;
  }

  function detectBrowser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    return 'Unknown';
  }
  function detectDevice() {
    const ua = navigator.userAgent;
    if (/iPad|Tablet/i.test(ua)) return 'Tablet';
    if (/Mobi|Android/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }
  function detectOS() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown';
  }

  let _clientMetaPromise = null;
  function getClientMeta() {
    if (_clientMetaPromise) return _clientMetaPromise;
    _clientMetaPromise = (async () => {
      const browser = detectBrowser(), device = detectDevice(), os = detectOS();
      let ip = 'N/A';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) { const j = await res.json(); ip = j.ip || 'N/A'; }
      } catch (e) { /* offline / bị chặn -> giữ 'N/A' */ }
      return { browser, device, os, ip };
    })();
    return _clientMetaPromise;
  }

  function isOnline(u) {
    if (!u || !u.lastActive) return false;
    const d = (u.lastActive && typeof u.lastActive.toDate === 'function') ? u.lastActive.toDate() : new Date(u.lastActive);
    return (Date.now() - d.getTime()) < ONLINE_WINDOW_MS;
  }

  /* ==========================================================================
     1. STYLE INJECTION — chỉ thêm class mới (prefix "sim-"), tái sử dụng biến
        CSS + class có sẵn (.card, .btn, .data-table, .modal-overlay, .pill,
        .filter-chip, .search-box, .select-box, .toolbar, .stat-card...)
     ========================================================================== */
  function injectStyles() {
    if (document.getElementById('simStyles')) return;
    const css = `
      .sim-modal-lg .modal-box{max-width:660px; width:94%; text-align:left; max-height:86vh; overflow-y:auto;}
      .sim-modal-lg .modal-actions{justify-content:flex-end;}
      .sim-avatar{width:34px; height:34px; border-radius:50%; object-fit:cover; background:var(--card-border); flex-shrink:0;}
      .sim-pill{padding:3px 10px; border-radius:20px; font-size:10.5px; font-weight:700; white-space:nowrap; display:inline-block;}
      .sim-pill.role-admin{background:rgba(245,158,11,.15); color:var(--warning);}
      .sim-pill.role-user{background:rgba(20,120,212,.14); color:var(--accent);}
      .sim-pill.st-active{background:rgba(22,199,132,.15); color:var(--success-dark);}
      .sim-pill.st-pending{background:rgba(245,158,11,.15); color:var(--warning);}
      .sim-pill.st-locked{background:rgba(239,68,68,.15); color:var(--danger-dark);}
      .sim-pill.st-deleted{background:rgba(140,160,180,.20); color:var(--text-muted);}
      .sim-dot{width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:5px;}
      .sim-dot.on{background:var(--success); box-shadow:0 0 0 3px rgba(22,199,132,.18);}
      .sim-dot.off{background:var(--text-muted);}
      .sim-status-cell{display:flex; flex-direction:column; gap:4px; align-items:flex-start;}
      .sim-online-txt{font-size:11px; color:var(--text-muted); display:flex; align-items:center;}
      .sim-kebab{position:relative; display:inline-block;}
      .sim-kebab-btn{width:32px; height:32px; border-radius:9px; display:flex; align-items:center; justify-content:center; background:rgba(20,120,212,.08); color:var(--accent);}
      .sim-kebab-btn:hover{background:rgba(20,120,212,.16);}
      .sim-kebab-menu{position:absolute; right:0; top:38px; min-width:200px; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:12px; box-shadow:var(--shadow-lg); z-index:250; padding:6px; display:none;}
      .sim-kebab-menu.show{display:block; animation:fadeIn .15s ease;}
      .sim-kebab-menu button{width:100%; text-align:left; padding:9px 11px; border-radius:8px; font-size:12.5px; font-weight:600; display:flex; align-items:center; gap:9px; color:var(--text-main);}
      .sim-kebab-menu button:hover{background:rgba(20,120,212,.08);}
      .sim-kebab-menu button.danger{color:var(--danger);}
      .sim-kebab-menu button:disabled{opacity:.38; cursor:not-allowed;}
      .sim-kebab-menu hr{border:none; border-top:1px solid var(--card-border); margin:5px 0;}
      .sim-pagination{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:14px; font-size:12.5px; color:var(--text-muted);}
      .sim-pagebtns{display:flex; gap:6px; flex-wrap:wrap;}
      .sim-pagebtns button{min-width:32px; height:32px; padding:0 8px; border-radius:9px; background:var(--card-bg); border:1.5px solid var(--card-border); font-weight:700; font-size:12px;}
      .sim-pagebtns button.active{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; border-color:transparent;}
      .sim-pagebtns button:disabled{opacity:.4; cursor:not-allowed;}
      .sim-progress-mini{width:88px;}
      .sim-empty{padding:46px 20px; text-align:center; color:var(--text-muted);}
      .sim-empty i{font-size:30px; margin-bottom:10px; display:block; opacity:.5;}
      .sim-profile-head{display:flex; align-items:center; gap:14px; margin-bottom:6px;}
      .sim-profile-head img{width:64px; height:64px; border-radius:50%;}
      .sim-profile-head b{font-size:16px; display:block;}
      .sim-profile-head span{font-size:12.5px; color:var(--text-muted);}
      .sim-profile-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px 20px; margin-top:16px;}
      .sim-pf-item{font-size:11.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;}
      .sim-pf-item b{display:block; font-size:13.5px; color:var(--text-main); margin-top:3px; font-weight:700; text-transform:none; letter-spacing:0;}
      .sim-loading{padding:50px; text-align:center; color:var(--text-muted);}
      .sim-loading i{font-size:26px; margin-bottom:10px; display:block;}
      @media (max-width:720px){ .sim-profile-grid{grid-template-columns:1fr;} }
    `;
    const styleEl = document.createElement('style');
    styleEl.id = 'simStyles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  /* ==========================================================================
     2. SIGNIN MANAGER — LÕI QUẢN LÝ
     ========================================================================== */
  const SignInManager = {
    state: {
      users: [],
      usersLoaded: false,
      search: '',
      filterRole: 'all',
      filterStatus: 'all',
      sortBy: 'createdAt',
      sortDir: 'desc',
      page: 1,
      pageSize: 20
    },
    _uiInjected: false,
    _usersUnsub: null,
    _heartbeatTimer: null,
    _repaintTimer: null,
    _myDocUnsub: null,
    _myDoc: null,
    _pendingPatch: {},
    _pendingTimer: null,

    /* ---------------------- 2.1 ĐĂNG NHẬP / KIỂM TRA QUYỀN ---------------------- */

    async handleCheckAccess(user) {
      const statusEl = document.getElementById('loginStatusText');
      if (statusEl) { statusEl.classList.remove('error'); statusEl.textContent = 'Đang kiểm tra quyền truy cập...'; }
      try {
        const ref = fbDb.collection(COL_USERS).doc(user.uid);
        const snap = await ref.get();

        if (!snap.exists) {
          await this.createPendingUser(user);
          this.showDenied(user, 'pending');
          setTimeout(() => { fbAuth.signOut().catch(() => {}); }, 900);
          return;
        }

        const d = snap.data();

        if (d.deleted === true) { this.showDenied(user, 'deleted'); return; }
        if (d.status === 'locked') { this.showDenied(user, 'locked'); return; }
        if (d.status === 'rejected') { this.showDenied(user, 'rejected'); return; }
        if (!(d.approved === true && d.status === 'active')) { this.showDenied(user, 'pending'); return; }

        // ---- Được phép vào hệ thống ----
        AuthManager.currentRole = (d.role === 'admin') ? 'admin' : 'user';

        this.injectAdminUI(AuthManager.isAdmin());
        this.listenOwnDoc(user.uid);
        await this.recordLogin(user);
        AuthManager.grantAccess(user);
        this.startHeartbeat(user.uid);
        if (AuthManager.isAdmin()) this.startUsersListener();
      } catch (err) {
        if (statusEl) { statusEl.classList.add('error'); statusEl.textContent = 'Lỗi kiểm tra quyền: ' + err.message; }
      }
    },

    async createPendingUser(user) {
      const meta = await getClientMeta();
      const uid = user.uid;
      await fbDb.collection(COL_USERS).doc(uid).set({
        uid, email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '',
        role: 'user', status: 'pending', approved: false,
        createdAt: ts(), approvedAt: null, approvedBy: null,
        lastLogin: null, loginCount: 0,
        lastIP: meta.ip, browser: meta.browser, device: meta.device, platform: navigator.platform || '', os: meta.os,
        deleted: false, deletedAt: null, lastActive: ts(), lastLogout: null,
        studyProgress: 0, totalVideos: 0, completedVideos: 0, quizCompleted: 0,
        averageScore: 0, highestScore: 0, wrongQuestions: [], favoriteQuestions: [],
        totalStudyMinutes: 0, updatedAt: ts()
      });
      const reqRef = await fbDb.collection(COL_REQUESTS).add({
        uid, email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '',
        requestTime: ts(), status: 'pending',
        browser: meta.browser, device: meta.device, ip: meta.ip,
        approvedBy: null, approvedTime: null
      });
      reqRef.update({ requestId: reqRef.id }).catch(() => {});
    },

    async recordLogin(user) {
      const meta = await getClientMeta();
      const uid = user.uid;
      try {
        await fbDb.collection(COL_USERS).doc(uid).set({
          email: user.email || '', displayName: user.displayName || '', photoURL: user.photoURL || '',
          lastLogin: ts(), loginCount: inc(1),
          lastIP: meta.ip, browser: meta.browser, device: meta.device, platform: navigator.platform || '', os: meta.os,
          lastActive: ts(), updatedAt: ts()
        }, { merge: true });
        await fbDb.collection(COL_USERS).doc(uid).collection(SUB_HISTORY).add({
          time: ts(), ip: meta.ip, browser: meta.browser, device: meta.device, os: meta.os
        });
        await fbDb.collection(COL_AUDIT).add({
          timestamp: ts(), adminUid: uid, adminEmail: user.email || '', targetUid: uid, targetEmail: user.email || '',
          action: 'LOGIN', oldValue: null, newValue: null, ip: meta.ip, browser: meta.browser, device: meta.device
        });
      } catch (e) { console.error('SignInManager.recordLogin', e); }
    },

    async recordLogout(uid, email) {
      try {
        const meta = await getClientMeta();
        await fbDb.collection(COL_USERS).doc(uid).set({ lastLogout: ts(), updatedAt: ts() }, { merge: true });
        await fbDb.collection(COL_AUDIT).add({
          timestamp: ts(), adminUid: uid, adminEmail: email || '', targetUid: uid, targetEmail: email || '',
          action: 'LOGOUT', oldValue: null, newValue: null, ip: meta.ip, browser: meta.browser, device: meta.device
        });
      } catch (e) { /* best-effort */ }
    },

    // Thông báo tuỳ theo lý do bị từ chối truy cập — cập nhật DOM động,
    // KHÔNG sửa nội dung gốc trong index.html.
    showDenied(user, reasonKey) {
      const messages = {
        pending: ['Tài khoản đang chờ phê duyệt', 'Yêu cầu đăng nhập của bạn đã được gửi tới quản trị viên. Vui lòng chờ được phê duyệt.'],
        locked: ['Tài khoản đã bị khóa', 'Tài khoản của bạn đã bị quản trị viên khóa truy cập. Vui lòng liên hệ quản trị viên.'],
        deleted: ['Tài khoản không tồn tại', 'Tài khoản này đã bị xóa khỏi hệ thống. Vui lòng liên hệ quản trị viên.'],
        rejected: ['Yêu cầu đã bị từ chối', 'Yêu cầu truy cập của bạn đã bị quản trị viên từ chối.']
      };
      const [title, desc] = messages[reasonKey] || messages.pending;
      AuthManager.stopIdleWatcher();
      const guest = document.getElementById('loginStateGuest');
      const denied = document.getElementById('loginStateDenied');
      if (guest) guest.style.display = 'none';
      if (denied) {
        const h2 = denied.querySelector('h2');
        const p = denied.querySelector('p');
        if (h2) h2.textContent = title;
        if (p) p.textContent = desc;
        denied.classList.add('show');
      }
      const chip = document.getElementById('deniedUserChip');
      if (chip) chip.innerHTML = `<img src="${user.photoURL || ''}" alt="avatar"><div><b>${escapeHtml(user.displayName || '')}</b><span>${escapeHtml(user.email || '')}</span></div>`;
      const overlay = document.getElementById('loginOverlay');
      if (overlay) overlay.classList.add('show');
    },

    /* ---------------------- 2.2 PRESENCE (ONLINE/OFFLINE) ---------------------- */

    startHeartbeat(uid) {
      this.stopHeartbeat();
      const beat = () => { fbDb.collection(COL_USERS).doc(uid).set({ lastActive: ts() }, { merge: true }).catch(() => {}); };
      beat();
      this._heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
    },
    stopHeartbeat() {
      if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    },

    // Theo dõi hồ sơ của CHÍNH người dùng đang đăng nhập (mọi role) để các API
    // học tập (updateQuiz...) có dữ liệu nền tảng chính xác khi tính trung bình.
    listenOwnDoc(uid) {
      if (this._myDocUnsub) this._myDocUnsub();
      this._myDocUnsub = fbDb.collection(COL_USERS).doc(uid).onSnapshot(snap => {
        this._myDoc = snap.exists ? snap.data() : null;
      });
    },

    /* ---------------------- 2.3 GIAO DIỆN ADMIN (SIDEBAR + VIEW) ---------------------- */

    injectAdminUI(isAdmin) {
      injectStyles();
      this.buildModals();
      if (!isAdmin || this._uiInjected) return;
      this._uiInjected = true;

      const nav = document.querySelector('.sidebar-nav');
      if (nav) {
        const label = document.createElement('div');
        label.className = 'nav-section-label';
        label.textContent = 'Quản trị';
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.dataset.view = 'signinManager';
        btn.innerHTML = '<i class="fa-solid fa-users-gear"></i> Quản lý đăng nhập';
        nav.appendChild(label);
        nav.appendChild(btn);
      }

      const main = document.querySelector('main.content');
      if (main && !document.getElementById('view-signinManager')) {
        const section = document.createElement('section');
        section.className = 'view';
        section.id = 'view-signinManager';
        section.innerHTML = this.buildViewHTML();
        main.appendChild(section);
      }

      if (UIManager.titles) {
        UIManager.titles.signinManager = ['Quản lý đăng nhập', 'Quản lý người dùng, phê duyệt và phân quyền hệ thống'];
      }

      this.wrapNavigate();
      this.wireViewEvents();
    },

    wrapNavigate() {
      if (UIManager.__simWrapped) return;
      UIManager.__simWrapped = true;
      const orig = UIManager.navigate.bind(UIManager);
      UIManager.navigate = function (view) {
        const result = orig(view);
        if (view === 'signinManager') SignInManager.renderView();
        return result;
      };
    },

    buildViewHTML() {
      return `
        <div class="section-head">
          <div>
            <h2><i class="fa-solid fa-users-gear"></i> Quản lý đăng nhập</h2>
            <p>Phê duyệt, phân quyền và theo dõi hoạt động của người dùng theo thời gian thực</p>
          </div>
          <button class="btn btn-outline btn-sm" id="simRefreshBtn"><i class="fa-solid fa-rotate"></i> Làm mới</button>
        </div>

        <div class="stat-grid" id="simStatsGrid"></div>

        <div class="card" style="padding:18px 20px;">
          <div class="toolbar">
            <div class="search-box">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="simSearchInput" placeholder="Tìm theo tên, email hoặc UID...">
            </div>
            <select class="select-box" id="simRoleFilter">
              <option value="all">Tất cả vai trò</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
            <select class="select-box" id="simSortSelect">
              <option value="createdAt">Sắp xếp: Ngày tạo</option>
              <option value="displayName">Sắp xếp: Tên</option>
              <option value="lastLogin">Sắp xếp: Login gần nhất</option>
              <option value="averageScore">Sắp xếp: Điểm TB</option>
              <option value="studyProgress">Sắp xếp: Tiến trình</option>
              <option value="loginCount">Sắp xếp: Số lần login</option>
            </select>
            <select class="select-box" id="simPageSizeSelect">
              <option value="10">10 / trang</option>
              <option value="20" selected>20 / trang</option>
              <option value="50">50 / trang</option>
              <option value="100">100 / trang</option>
            </select>
          </div>
          <div class="toolbar" id="simFilterChips" style="margin-bottom:6px;">
            <button class="filter-chip active" data-status="all">Tất cả</button>
            <button class="filter-chip" data-status="admin">Admin</button>
            <button class="filter-chip" data-status="user">User</button>
            <button class="filter-chip" data-status="approved">Đã duyệt</button>
            <button class="filter-chip" data-status="pending">Chưa duyệt</button>
            <button class="filter-chip" data-status="locked">Đang khóa</button>
            <button class="filter-chip" data-status="deleted">Đã xóa</button>
            <button class="filter-chip" data-status="online">Online</button>
            <button class="filter-chip" data-status="offline">Offline</button>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th></th><th>Tên</th><th>Email</th><th>Vai trò</th><th>Browser</th><th>Device</th>
                  <th>Ngày tạo</th><th>Login gần nhất</th><th>Login Count</th><th>Tiến trình</th>
                  <th>Điểm TB</th><th>Thời gian học</th><th>Trạng thái</th><th></th>
                </tr>
              </thead>
              <tbody id="simUsersTbody"><tr><td colspan="14" class="sim-loading"><i class="fa-solid fa-spinner fa-spin"></i>Đang tải danh sách người dùng...</td></tr></tbody>
            </table>
          </div>

          <div class="sim-pagination" id="simPagination"></div>
        </div>
      `;
    },

    buildModals() {
      if (document.getElementById('simProfileModal')) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="modal-overlay sim-modal-lg" id="simProfileModal">
          <div class="modal-box">
            <div id="simProfileBody"></div>
            <div class="modal-actions"><button class="btn btn-outline" id="simProfileCloseBtn">Đóng</button></div>
          </div>
        </div>
        <div class="modal-overlay sim-modal-lg" id="simHistoryModal">
          <div class="modal-box">
            <h3><i class="fa-solid fa-clock-rotate-left"></i> Lịch sử đăng nhập</h3>
            <div id="simHistoryBody" style="margin-top:10px;"></div>
            <div class="modal-actions"><button class="btn btn-outline" id="simHistoryCloseBtn">Đóng</button></div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      document.getElementById('simProfileCloseBtn').addEventListener('click', () => document.getElementById('simProfileModal').classList.remove('show'));
      document.getElementById('simHistoryCloseBtn').addEventListener('click', () => document.getElementById('simHistoryModal').classList.remove('show'));
    },

    wireViewEvents() {
      const view = document.getElementById('view-signinManager');
      if (!view || view.__wired) return;
      view.__wired = true;

      view.addEventListener('input', debounce((e) => {
        if (e.target.id === 'simSearchInput') {
          this.state.search = e.target.value.trim().toLowerCase();
          this.state.page = 1;
          this.renderTableArea();
        }
      }, 250));

      view.addEventListener('change', (e) => {
        if (e.target.id === 'simRoleFilter') { this.state.filterRole = e.target.value; this.state.page = 1; this.renderTableArea(); }
        if (e.target.id === 'simSortSelect') { this.state.sortBy = e.target.value; this.state.page = 1; this.renderTableArea(); }
        if (e.target.id === 'simPageSizeSelect') { this.state.pageSize = parseInt(e.target.value, 10) || 20; this.state.page = 1; this.renderTableArea(); }
      });

      view.addEventListener('click', (e) => {
        const chip = e.target.closest('#simFilterChips .filter-chip');
        if (chip) {
          view.querySelectorAll('#simFilterChips .filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.state.filterStatus = chip.dataset.status;
          this.state.page = 1;
          this.renderTableArea();
          return;
        }
        const kebabBtn = e.target.closest('.sim-kebab-btn');
        if (kebabBtn) {
          const menu = kebabBtn.nextElementSibling;
          document.querySelectorAll('.sim-kebab-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
          menu.classList.toggle('show');
          return;
        }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
          document.querySelectorAll('.sim-kebab-menu.show').forEach(m => m.classList.remove('show'));
          this.handleAction(actionBtn.dataset.action, actionBtn.dataset.uid);
          return;
        }
        const pageBtn = e.target.closest('[data-page]');
        if (pageBtn && !pageBtn.disabled) {
          this.state.page = parseInt(pageBtn.dataset.page, 10) || 1;
          this.renderTableArea();
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.sim-kebab')) document.querySelectorAll('.sim-kebab-menu.show').forEach(m => m.classList.remove('show'));
      });

      const refreshBtn = document.getElementById('simRefreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', () => this.renderView());

      // Vẽ lại trạng thái online/offline định kỳ mà không cần snapshot mới
      if (!this._repaintTimer) {
        this._repaintTimer = setInterval(() => { if (this.isViewActive()) this.renderView(); }, REALTIME_REPAINT_MS);
      }
    },

    isViewActive() {
      const v = document.getElementById('view-signinManager');
      return !!(v && v.classList.contains('active'));
    },

    /* ---------------------- 2.4 DỮ LIỆU REALTIME ---------------------- */

    startUsersListener() {
      if (this._usersUnsub) return;
      this._usersUnsub = fbDb.collection(COL_USERS).onSnapshot(snap => {
        this.state.users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        this.state.usersLoaded = true;
        if (this.isViewActive()) this.renderView();
      }, err => { console.error('SignInManager users listener', err); });
    },
    stopUsersListener() {
      if (this._usersUnsub) { this._usersUnsub(); this._usersUnsub = null; }
    },

    computeFiltered() {
      const s = this.state;
      let list = s.users.slice();
      const kw = s.search;
      if (kw) {
        list = list.filter(u =>
          (u.displayName || '').toLowerCase().includes(kw) ||
          (u.email || '').toLowerCase().includes(kw) ||
          (u.uid || '').toLowerCase().includes(kw)
        );
      }
      if (s.filterRole !== 'all') list = list.filter(u => u.role === s.filterRole);
      switch (s.filterStatus) {
        case 'admin': list = list.filter(u => u.role === 'admin'); break;
        case 'user': list = list.filter(u => u.role !== 'admin'); break;
        case 'approved': list = list.filter(u => u.approved === true && u.status === 'active' && !u.deleted); break;
        case 'pending': list = list.filter(u => (u.status === 'pending' || u.approved !== true) && !u.deleted); break;
        case 'locked': list = list.filter(u => u.status === 'locked' && !u.deleted); break;
        case 'deleted': list = list.filter(u => u.deleted === true); break;
        case 'online': list = list.filter(u => isOnline(u)); break;
        case 'offline': list = list.filter(u => !isOnline(u)); break;
      }
      const dir = s.sortDir === 'asc' ? 1 : -1;
      const val = (u, key) => {
        if (key === 'createdAt' || key === 'lastLogin') {
          const v = u[key];
          return v && v.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0);
        }
        if (key === 'displayName') return (u.displayName || '').toLowerCase();
        return Number(u[key]) || 0;
      };
      list.sort((a, b) => {
        const va = val(a, s.sortBy), vb = val(b, s.sortBy);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
      return list;
    },

    computeStats(list) {
      const alive = list.filter(u => !u.deleted);
      return {
        total: alive.length,
        admin: alive.filter(u => u.role === 'admin').length,
        user: alive.filter(u => u.role !== 'admin').length,
        approved: alive.filter(u => u.approved === true && u.status === 'active').length,
        pending: alive.filter(u => u.status === 'pending' || u.approved !== true).length,
        locked: alive.filter(u => u.status === 'locked').length,
        online: alive.filter(u => isOnline(u)).length,
        offline: alive.filter(u => !isOnline(u)).length
      };
    },

    renderView() {
      if (!this.isViewActive() && !document.getElementById('simStatsGrid')) return;
      this.renderStats();
      this.renderTableArea();
    },

    renderStats() {
      const grid = document.getElementById('simStatsGrid');
      if (!grid) return;
      const st = this.computeStats(this.state.users);
      const cards = [
        { icon: 'fa-users', color: 'linear-gradient(135deg,#1478d4,#22d3ee)', val: st.total, label: 'Tổng User' },
        { icon: 'fa-crown', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)', val: st.admin, label: 'Admin' },
        { icon: 'fa-user', color: 'linear-gradient(135deg,#0d5fb3,#3b96e8)', val: st.user, label: 'User' },
        { icon: 'fa-circle-check', color: 'linear-gradient(135deg,#16c784,#0e9d68)', val: st.approved, label: 'Đã duyệt' },
        { icon: 'fa-hourglass-half', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)', val: st.pending, label: 'Chưa duyệt' },
        { icon: 'fa-lock', color: 'linear-gradient(135deg,#ef4444,#dc2626)', val: st.locked, label: 'Đang khóa' },
        { icon: 'fa-signal', color: 'linear-gradient(135deg,#16c784,#0e9d68)', val: st.online, label: 'Online' },
        { icon: 'fa-power-off', color: 'linear-gradient(135deg,#5c7590,#8fa9c4)', val: st.offline, label: 'Offline' }
      ];
      grid.innerHTML = cards.map(c => `
        <div class="card stat-card">
          <div class="stat-top">
            <div class="stat-icon" style="background:${c.color}"><i class="fa-solid ${c.icon}"></i></div>
          </div>
          <div class="stat-val">${c.val}</div>
          <div class="stat-label">${c.label}</div>
        </div>
      `).join('');
    },

    renderTableArea() {
      const tbody = document.getElementById('simUsersTbody');
      if (!tbody) return;
      if (!this.state.usersLoaded) {
        tbody.innerHTML = `<tr><td colspan="14" class="sim-loading"><i class="fa-solid fa-spinner fa-spin"></i>Đang tải danh sách người dùng...</td></tr>`;
        return;
      }
      const filtered = this.computeFiltered();
      const total = filtered.length;
      const pageSize = this.state.pageSize;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (this.state.page > totalPages) this.state.page = totalPages;
      const start = (this.state.page - 1) * pageSize;
      // Ghi chú hiệu năng: chỉ render đúng 1 trang (tối đa 100 dòng) ra DOM bất
      // kể tổng số user trong hệ thống lớn tới đâu (>1000) — đây là chiến lược
      // "virtual/windowed render" đơn giản, tránh render hàng nghìn <tr> cùng lúc.
      const pageItems = filtered.slice(start, start + pageSize);

      if (!pageItems.length) {
        tbody.innerHTML = `<tr><td colspan="14"><div class="sim-empty"><i class="fa-solid fa-inbox"></i>Không tìm thấy người dùng phù hợp</div></td></tr>`;
      } else {
        tbody.innerHTML = pageItems.map(u => this.renderRow(u)).join('');
      }

      this.renderPagination(total, totalPages);
    },

    statusPillHTML(u) {
      if (u.deleted) return `<span class="sim-pill st-deleted">Đã xóa</span>`;
      if (u.status === 'locked') return `<span class="sim-pill st-locked">Đang khóa</span>`;
      if (u.status !== 'active' || u.approved !== true) return `<span class="sim-pill st-pending">Chưa duyệt</span>`;
      return `<span class="sim-pill st-active">Đã duyệt</span>`;
    },

    kebabHTML(u) {
      const self = AuthManager.currentUser && AuthManager.currentUser.uid === u.uid;
      const isPending = (u.status === 'pending' || u.approved !== true) && !u.deleted;
      const isLocked = u.status === 'locked';
      const isDeleted = !!u.deleted;
      const isAdminRole = u.role === 'admin';
      let items = '';
      if (isPending) {
        items += `<button data-action="approve" data-uid="${u.uid}"><i class="fa-solid fa-check"></i> Approve</button>`;
        items += `<button data-action="reject" data-uid="${u.uid}" class="danger"><i class="fa-solid fa-xmark"></i> Reject</button>`;
        items += `<hr>`;
      }
      if (!isDeleted && !isPending) {
        items += isLocked
          ? `<button data-action="unlock" data-uid="${u.uid}"><i class="fa-solid fa-lock-open"></i> Unlock</button>`
          : `<button data-action="lock" data-uid="${u.uid}" ${self ? 'disabled' : ''}><i class="fa-solid fa-lock"></i> Lock</button>`;
        items += isAdminRole
          ? `<button data-action="demote" data-uid="${u.uid}" ${self ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i> Demote User</button>`
          : `<button data-action="promote" data-uid="${u.uid}"><i class="fa-solid fa-arrow-up"></i> Promote Admin</button>`;
        items += `<hr>`;
        items += `<button data-action="resetProgress" data-uid="${u.uid}"><i class="fa-solid fa-rotate-left"></i> Reset Progress</button>`;
        items += `<button data-action="resetLogin" data-uid="${u.uid}"><i class="fa-solid fa-clock-rotate-left"></i> Reset Login Count</button>`;
        items += `<hr>`;
      }
      items += `<button data-action="profile" data-uid="${u.uid}"><i class="fa-solid fa-id-card"></i> Xem hồ sơ</button>`;
      items += `<button data-action="history" data-uid="${u.uid}"><i class="fa-solid fa-clock-rotate-left"></i> Lịch sử đăng nhập</button>`;
      items += `<hr>`;
      items += isDeleted
        ? `<button data-action="restore" data-uid="${u.uid}"><i class="fa-solid fa-trash-arrow-up"></i> Restore</button>`
        : `<button data-action="delete" data-uid="${u.uid}" class="danger" ${self ? 'disabled' : ''}><i class="fa-solid fa-trash"></i> Delete</button>`;

      return `
        <div class="sim-kebab">
          <button class="sim-kebab-btn"><i class="fa-solid fa-ellipsis-vertical"></i></button>
          <div class="sim-kebab-menu">${items}</div>
        </div>`;
    },

    renderRow(u) {
      const online = isOnline(u);
      const avatar = u.photoURL || 'https://ui-avatars.com/api/?background=1478d4&color=fff&name=' + encodeURIComponent(u.displayName || u.email || '?');
      const avg = typeof u.averageScore === 'number' ? u.averageScore.toFixed(1) : (Number(u.averageScore) || 0);
      return `
        <tr data-uid="${u.uid}">
          <td><img class="sim-avatar" src="${avatar}" alt="" onerror="this.style.visibility='hidden'"></td>
          <td><b>${escapeHtml(u.displayName || '(Chưa đặt tên)')}</b></td>
          <td>${escapeHtml(u.email || '')}</td>
          <td><span class="sim-pill role-${u.role === 'admin' ? 'admin' : 'user'}">${u.role === 'admin' ? 'Admin' : 'User'}</span></td>
          <td>${escapeHtml(u.browser || '-')}</td>
          <td>${escapeHtml(u.device || '-')}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>${fmtDate(u.lastLogin)}</td>
          <td style="text-align:center;">${u.loginCount || 0}</td>
          <td>
            <div class="progress-track sim-progress-mini"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, u.studyProgress || 0))}%"></div></div>
          </td>
          <td>${avg}</td>
          <td>${fmtMinutes(u.totalStudyMinutes)}</td>
          <td>
            <div class="sim-status-cell">
              ${this.statusPillHTML(u)}
              <span class="sim-online-txt"><span class="sim-dot ${online ? 'on' : 'off'}"></span>${online ? 'Online' : 'Offline'}</span>
            </div>
          </td>
          <td>${this.kebabHTML(u)}</td>
        </tr>`;
    },

    renderPagination(total, totalPages) {
      const el = document.getElementById('simPagination');
      if (!el) return;
      const p = this.state.page;
      const windowSize = 5;
      let startP = Math.max(1, p - Math.floor(windowSize / 2));
      let endP = Math.min(totalPages, startP + windowSize - 1);
      startP = Math.max(1, endP - windowSize + 1);
      let pageBtns = '';
      for (let i = startP; i <= endP; i++) {
        pageBtns += `<button data-page="${i}" class="${i === p ? 'active' : ''}">${i}</button>`;
      }
      el.innerHTML = `
        <div>Tổng <b>${total}</b> người dùng — Trang ${p}/${totalPages}</div>
        <div class="sim-pagebtns">
          <button data-page="1" ${p <= 1 ? 'disabled' : ''}><i class="fa-solid fa-angles-left"></i></button>
          <button data-page="${Math.max(1, p - 1)}" ${p <= 1 ? 'disabled' : ''}><i class="fa-solid fa-angle-left"></i></button>
          ${pageBtns}
          <button data-page="${Math.min(totalPages, p + 1)}" ${p >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-angle-right"></i></button>
          <button data-page="${totalPages}" ${p >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-angles-right"></i></button>
        </div>`;
    },

    /* ---------------------- 2.5 HÀNH ĐỘNG ADMIN (VỚI SECURITY RE-CHECK) ---------------------- */

    // Không tin dữ liệu client: luôn đọc lại hồ sơ chính admin từ Firestore
    // trước khi cho phép thực hiện thao tác.
    async assertAdmin() {
      const cur = AuthManager.currentUser;
      if (!cur) throw new Error('Bạn chưa đăng nhập');
      const doc = await fbDb.collection(COL_USERS).doc(cur.uid).get();
      if (!doc.exists) throw new Error('Không tìm thấy hồ sơ của bạn');
      const d = doc.data();
      if (d.deleted === true) throw new Error('Tài khoản của bạn đã bị xóa');
      if (d.status === 'locked') throw new Error('Tài khoản của bạn đang bị khóa');
      if (!(d.role === 'admin' && d.approved === true && d.status === 'active')) throw new Error('Bạn không có quyền admin để thực hiện thao tác này');
      return d;
    },

    async writeAudit(action, target, oldValue, newValue) {
      try {
        const admin = AuthManager.currentUser;
        const meta = await getClientMeta();
        await fbDb.collection(COL_AUDIT).add({
          timestamp: ts(), adminUid: admin.uid, adminEmail: admin.email || '',
          targetUid: target.uid || null, targetEmail: target.email || null,
          action, oldValue: oldValue || null, newValue: newValue || null,
          ip: meta.ip, browser: meta.browser, device: meta.device
        });
      } catch (e) { console.error('SignInManager.writeAudit', e); }
    },

    async updateLoginRequestStatus(uid, status) {
      try {
        const q = await fbDb.collection(COL_REQUESTS).where('uid', '==', uid).orderBy('requestTime', 'desc').limit(1).get();
        if (!q.empty) {
          const admin = AuthManager.currentUser;
          await q.docs[0].ref.update({ status, approvedBy: admin ? admin.email : null, approvedTime: ts() });
        }
      } catch (e) { /* index có thể chưa tạo — bỏ qua, không chặn luồng chính */ }
    },

    confirmThen(title, msg, fn) {
      if (window.UIManager && typeof UIManager.confirm === 'function') UIManager.confirm(title, msg, fn);
      else if (confirm(msg)) fn();
    },

    toast(type, title, msg) {
      if (window.UIManager && typeof UIManager.toast === 'function') UIManager.toast(type, title, msg);
    },

    handleAction(action, uid) {
      const u = this.state.users.find(x => x.uid === uid);
      if (!u) return;
      const self = AuthManager.currentUser && AuthManager.currentUser.uid === uid;
      const routes = {
        approve: () => this.approveUser(u),
        reject: () => this.confirmThen('Từ chối yêu cầu?', `${u.email} sẽ không thể truy cập hệ thống.`, () => this.rejectUser(u)),
        lock: () => { if (self) return this.toast('warn', 'Không thể tự khóa', 'Bạn không thể tự khóa chính mình.'); this.confirmThen('Khóa tài khoản?', `${u.email} sẽ không thể đăng nhập cho tới khi được mở khóa.`, () => this.setLocked(u, true)); },
        unlock: () => this.confirmThen('Mở khóa tài khoản?', `${u.email} sẽ có thể đăng nhập lại bình thường.`, () => this.setLocked(u, false)),
        delete: () => { if (self) return this.toast('warn', 'Không thể tự xóa', 'Bạn không thể xóa chính mình.'); this.confirmThen('Xóa người dùng?', `${u.email} sẽ bị vô hiệu hóa (soft delete), có thể khôi phục sau.`, () => this.setDeleted(u, true)); },
        restore: () => this.confirmThen('Khôi phục người dùng?', `${u.email} sẽ được khôi phục quyền truy cập trước đó.`, () => this.setDeleted(u, false)),
        promote: () => this.confirmThen('Cấp quyền Admin?', `${u.email} sẽ có toàn quyền quản trị hệ thống.`, () => this.setRole(u, 'admin')),
        demote: () => { if (self) return this.toast('warn', 'Không thể tự bỏ quyền', 'Bạn không thể tự bỏ quyền admin của chính mình.'); this.confirmThen('Bỏ quyền Admin?', `${u.email} sẽ trở về quyền User thông thường.`, () => this.setRole(u, 'user')); },
        resetProgress: () => this.confirmThen('Reset tiến trình học?', `Toàn bộ tiến trình, điểm số, câu sai/yêu thích của ${u.email} sẽ bị xóa.`, () => this.resetProgress(u)),
        resetLogin: () => this.confirmThen('Reset số lần đăng nhập?', `Login Count của ${u.email} sẽ được đưa về 0.`, () => this.resetLoginCount(u)),
        profile: () => this.openProfile(u),
        history: () => this.openHistory(u)
      };
      (routes[action] || (() => {}))();
    },

    async approveUser(u) {
      try {
        await this.assertAdmin();
        const admin = AuthManager.currentUser;
        await fbDb.collection(COL_USERS).doc(u.uid).set({ approved: true, status: 'active', approvedAt: ts(), approvedBy: admin.email, updatedAt: ts() }, { merge: true });
        await this.updateLoginRequestStatus(u.uid, 'approved');
        await this.writeAudit('APPROVE_USER', u, { approved: false }, { approved: true });
        this.toast('success', 'Đã duyệt', `${u.email} đã được cấp quyền truy cập.`);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async rejectUser(u) {
      try {
        await this.assertAdmin();
        await fbDb.collection(COL_USERS).doc(u.uid).set({ approved: false, status: 'rejected', updatedAt: ts() }, { merge: true });
        await this.updateLoginRequestStatus(u.uid, 'rejected');
        await this.writeAudit('REJECT', u, { status: u.status }, { status: 'rejected' });
        this.toast('success', 'Đã từ chối', `Yêu cầu của ${u.email} đã bị từ chối.`);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async setLocked(u, lock) {
      try {
        await this.assertAdmin();
        await fbDb.collection(COL_USERS).doc(u.uid).set({ status: lock ? 'locked' : 'active', updatedAt: ts() }, { merge: true });
        await this.writeAudit(lock ? 'LOCK_USER' : 'UNLOCK_USER', u, { status: u.status }, { status: lock ? 'locked' : 'active' });
        this.toast('success', lock ? 'Đã khóa' : 'Đã mở khóa', u.email);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async setDeleted(u, del) {
      try {
        await this.assertAdmin();
        await fbDb.collection(COL_USERS).doc(u.uid).set({ deleted: del, deletedAt: del ? ts() : null, updatedAt: ts() }, { merge: true });
        await this.writeAudit('DELETE_USER', u, { deleted: !del }, { deleted: del });
        this.toast('success', del ? 'Đã xóa' : 'Đã khôi phục', u.email);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async setRole(u, role) {
      try {
        await this.assertAdmin();
        await fbDb.collection(COL_USERS).doc(u.uid).set({ role, updatedAt: ts() }, { merge: true });
        await this.writeAudit('CHANGE_ROLE', u, { role: u.role }, { role });
        this.toast('success', 'Đã đổi quyền', `${u.email} → ${role === 'admin' ? 'Admin' : 'User'}`);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async resetProgress(u) {
      try {
        await this.assertAdmin();
        const patch = { studyProgress: 0, totalVideos: 0, completedVideos: 0, quizCompleted: 0, averageScore: 0, highestScore: 0, wrongQuestions: [], favoriteQuestions: [], totalStudyMinutes: 0, updatedAt: ts() };
        await fbDb.collection(COL_USERS).doc(u.uid).set(patch, { merge: true });
        await this.writeAudit('UPDATE_PROFILE', u, { progressReset: false }, { progressReset: true });
        this.toast('success', 'Đã reset tiến trình', u.email);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },
    async resetLoginCount(u) {
      try {
        await this.assertAdmin();
        await fbDb.collection(COL_USERS).doc(u.uid).set({ loginCount: 0, updatedAt: ts() }, { merge: true });
        await this.writeAudit('UPDATE_PROFILE', u, { loginCount: u.loginCount || 0 }, { loginCount: 0 });
        this.toast('success', 'Đã reset Login Count', u.email);
      } catch (err) { this.toast('error', 'Lỗi', err.message); }
    },

    /* ---------------------- 2.6 MODAL: HỒ SƠ / LỊCH SỬ ---------------------- */

    openProfile(u) {
      this.buildModals();
      const body = document.getElementById('simProfileBody');
      const avatar = u.photoURL || 'https://ui-avatars.com/api/?background=1478d4&color=fff&name=' + encodeURIComponent(u.displayName || u.email || '?');
      body.innerHTML = `
        <div class="sim-profile-head">
          <img src="${avatar}" alt="">
          <div>
            <b>${escapeHtml(u.displayName || '(Chưa đặt tên)')}</b>
            <span>${escapeHtml(u.email || '')}</span>
          </div>
        </div>
        <div class="sim-profile-grid">
          <div class="sim-pf-item">UID<b>${escapeHtml(u.uid)}</b></div>
          <div class="sim-pf-item">Vai trò<b>${u.role === 'admin' ? 'Admin' : 'User'}</b></div>
          <div class="sim-pf-item">Ngày tạo<b>${fmtDate(u.createdAt)}</b></div>
          <div class="sim-pf-item">Ngày duyệt<b>${fmtDate(u.approvedAt)}</b></div>
          <div class="sim-pf-item">Admin duyệt<b>${escapeHtml(u.approvedBy || '-')}</b></div>
          <div class="sim-pf-item">Trạng thái<b>${this.statusPillHTML(u)}</b></div>
          <div class="sim-pf-item">Điểm TB<b>${(Number(u.averageScore) || 0).toFixed(1)}</b></div>
          <div class="sim-pf-item">Điểm cao nhất<b>${(Number(u.highestScore) || 0).toFixed(1)}</b></div>
          <div class="sim-pf-item">Video đã học<b>${u.completedVideos || 0} / ${u.totalVideos || 0}</b></div>
          <div class="sim-pf-item">Quiz đã làm<b>${u.quizCompleted || 0}</b></div>
          <div class="sim-pf-item">Tiến trình<b>${u.studyProgress || 0}%</b></div>
          <div class="sim-pf-item">Thời gian học<b>${fmtMinutes(u.totalStudyMinutes)}</b></div>
          <div class="sim-pf-item">Login Count<b>${u.loginCount || 0}</b></div>
          <div class="sim-pf-item">Login gần nhất<b>${fmtDate(u.lastLogin)}</b></div>
        </div>`;
      document.getElementById('simProfileModal').classList.add('show');
    },

    async openHistory(u) {
      this.buildModals();
      const body = document.getElementById('simHistoryBody');
      body.innerHTML = `<div class="sim-loading"><i class="fa-solid fa-spinner fa-spin"></i>Đang tải lịch sử...</div>`;
      document.getElementById('simHistoryModal').classList.add('show');
      try {
        const snap = await fbDb.collection(COL_USERS).doc(u.uid).collection(SUB_HISTORY).orderBy('time', 'desc').limit(50).get();
        if (snap.empty) { body.innerHTML = `<div class="sim-empty"><i class="fa-solid fa-inbox"></i>Chưa có lịch sử đăng nhập</div>`; return; }
        const rows = snap.docs.map(d => {
          const h = d.data();
          return `<tr><td>${fmtDate(h.time)}</td><td>${escapeHtml(h.ip || '-')}</td><td>${escapeHtml(h.browser || '-')}</td><td>${escapeHtml(h.device || '-')}</td><td>${escapeHtml(h.os || '-')}</td></tr>`;
        }).join('');
        body.innerHTML = `
          <div class="table-wrap">
            <table class="data-table sim-hist-table">
              <thead><tr><th>Thời gian</th><th>IP</th><th>Browser</th><th>Device</th><th>OS</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      } catch (err) {
        body.innerHTML = `<div class="sim-empty"><i class="fa-solid fa-triangle-exclamation"></i>Lỗi tải lịch sử: ${escapeHtml(err.message)}</div>`;
      }
    },

    /* ---------------------- 2.7 API HỌC TẬP CHO CÁC MODULE SAU NÀY ---------------------- */

    _directWrite(patch) {
      const uid = AuthManager.currentUser && AuthManager.currentUser.uid;
      if (!uid) return;
      fbDb.collection(COL_USERS).doc(uid).set({ ...patch, updatedAt: ts() }, { merge: true }).catch(e => console.error('SignInManager write error', e));
    },
    _schedulePatch(patch) {
      Object.assign(this._pendingPatch, patch);
      clearTimeout(this._pendingTimer);
      this._pendingTimer = setTimeout(() => this._flushPatch(), PATCH_DEBOUNCE_MS);
    },
    _flushPatch() {
      const uid = AuthManager.currentUser && AuthManager.currentUser.uid;
      if (!uid || !Object.keys(this._pendingPatch).length) return;
      const patch = { ...this._pendingPatch, updatedAt: ts() };
      this._pendingPatch = {};
      fbDb.collection(COL_USERS).doc(uid).set(patch, { merge: true }).catch(e => console.error('SignInManager flush error', e));
    },

    // % tiến trình học tổng thể (0-100) — ghi debounce để tránh spam Firestore
    updateStudyProgress(percent) {
      const v = Math.max(0, Math.min(100, Number(percent) || 0));
      this._schedulePatch({ studyProgress: v });
    },

    // Gọi khi user hoàn thành 1 bài quiz: {correct, total, score}
    updateQuiz({ score = null, wrongIds = null, starIds = null } = {}) {
      const cur = this._myDoc || {};
      const prevCount = cur.quizCompleted || 0;
      const newCount = prevCount + 1;
      const patch = { quizCompleted: newCount };
      if (typeof score === 'number') {
        const prevAvg = Number(cur.averageScore) || 0;
        const newAvg = ((prevAvg * prevCount) + score) / newCount;
        patch.averageScore = Math.round(newAvg * 100) / 100;
        patch.highestScore = Math.max(Number(cur.highestScore) || 0, score);
      }
      if (Array.isArray(wrongIds) && wrongIds.length) patch.wrongQuestions = firebase.firestore.FieldValue.arrayUnion(...wrongIds);
      if (Array.isArray(starIds) && starIds.length) patch.favoriteQuestions = firebase.firestore.FieldValue.arrayUnion(...starIds);
      this._directWrite(patch);
      if (this._myDoc) this._myDoc.quizCompleted = newCount;
    },

    // Cộng dồn thời gian học (phút)
    addStudyMinutes(minutes) {
      const m = Number(minutes) || 0;
      if (!m) return;
      this._directWrite({ totalStudyMinutes: inc(m) });
    },

    // Video tổng quát: {started:true} hoặc {completed:true}
    updateVideo({ started = false, completed = false } = {}) {
      const patch = {};
      if (started) patch.totalVideos = inc(1);
      if (completed) patch.completedVideos = inc(1);
      if (Object.keys(patch).length) this._directWrite(patch);
    },

    // ---- Hook API dành riêng cho module Video/Khóa học phát triển sau này ----
    videoStarted(videoId) { this.updateVideo({ started: true }); },
    videoPaused(videoId, atSeconds) { /* hook cho tương lai — không có field riêng, chỉ log */ },
    videoFinished(videoId) { this.updateVideo({ completed: true }); },
    watchSeconds(videoId, seconds) { this.addStudyMinutes((Number(seconds) || 0) / 60); },
    watchCount(videoId) { /* hook cho tương lai */ }
  };

  /* ==========================================================================
     3. MÓC VÀO VÒNG ĐỜI CÓ SẴN — chỉ ghi đè (wrap), không sửa hàm gốc
     ========================================================================== */

  // Ghi đè checkAccess ngay lập tức (đồng bộ, chạy trước khi AuthManager.init()
  // được gọi ở DOMContentLoaded) — kỹ thuật tương tự cách index.html tự wrap
  // CloudSync.init / UIManager.navigate ở phần "Đề cộng đồng".
  if (window.AuthManager) {
    AuthManager.checkAccess = function (user) { return SignInManager.handleCheckAccess(user); };

    const _origDoSignOut = AuthManager.doSignOut.bind(AuthManager);
    AuthManager.doSignOut = async function () {
      const cur = AuthManager.currentUser;
      SignInManager.stopHeartbeat();
      SignInManager.stopUsersListener();
      if (SignInManager._myDocUnsub) { SignInManager._myDocUnsub(); SignInManager._myDocUnsub = null; }
      if (cur) { try { await Promise.race([SignInManager.recordLogout(cur.uid, cur.email), new Promise(r => setTimeout(r, 1500))]); } catch (e) {} }
      return _origDoSignOut();
    };
  }

  window.SignInManager = SignInManager;

})();
