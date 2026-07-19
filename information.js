/* ==========================================================================
   information.js
   ------------------------------------------------------------------------
   Module ĐỘC LẬP (standalone) — Hồ sơ người dùng (User Profile).
   Chỉ cần thêm 1 dòng:
       <script src="information.js"></script>
   vào cuối index.html (sau các script hiện có). KHÔNG cần sửa gì thêm.

   Module tự động:
     - Inject CSS (không tạo file .css riêng)
     - Tạo Dropdown khi click vào #userBadge / #userBadgeAvatar / #userBadgeName
     - Tạo Profile Modal (toàn bộ HTML sinh bằng JS, inject vào <body>)
     - Đọc / tạo document Firestore tại users/{uid}
     - Cache dữ liệu vào localStorage (key: "user_profile")
     - Đồng bộ Topbar (avatar, tên, badge role, level, xp) không cần reload
     - Cho phép chỉnh sửa, validate, upload avatar (nén ảnh, lưu base64
       trong Firestore vì project không dùng Firebase Storage)

   Yêu cầu: Firebase v10 compat (firebase.auth() / firebase.firestore())
   đã được khởi tạo ở nơi khác trong trang (biến toàn cục `fbAuth`, `fbDb`
   nếu có, hoặc sẽ tự lấy qua firebase.auth()/firebase.firestore()).
   ========================================================================== */

(function () {
  "use strict";

  /* ========================================================================
     0. HẰNG SỐ & TIỆN ÍCH DÙNG CHUNG
     ======================================================================== */

  const LS_KEY = "user_profile";
  const DEFAULT_XP_REQUIRED = 100;
  const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;

  const DEFAULT_FIELDS = {
    displayName: "",
    photoURL: "",
    email: "",
    phone: "",
    birthday: "",
    gender: "",
    address: "",
    company: "",
    position: "",
    createdAt: null,
    role: "user",
    level: 1,
    xp: 0,
    xpRequired: DEFAULT_XP_REQUIRED,
  };

  // Escape HTML để tránh XSS khi render dữ liệu người dùng ra DOM.
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  /* ========================================================================
     MODULE CHÍNH
     ======================================================================== */
  const Information = {
    // ---- state nội bộ ----
    _fbAuth: null,
    _fbDb: null,
    _uid: null,
    _profile: null, // dữ liệu profile hiện tại (đã merge Firestore)
    _isEditing: false,
    _editBackup: null,
    _dropdownOpen: false,
    _modalOpen: false,
    _avatarPendingFile: null, // base64 mới chọn (chưa lưu)
    _authUnsub: null,

    /* ----------------------------------------------------------------------
       init() — điểm khởi động duy nhất, được gọi tự động khi DOM sẵn sàng.
       ---------------------------------------------------------------------- */
    init() {
      try {
        this._resolveFirebase();
        this.injectCSS();
        this.createDropdown();
        this.createProfileModal();
        this.bindEvents();

        // Nếu Firebase Auth đã sẵn sàng, lắng nghe trạng thái đăng nhập để
        // tự đọc / tạo profile và đồng bộ Topbar — không cần gọi gì thêm.
        if (this._fbAuth) {
          this._authUnsub = this._fbAuth.onAuthStateChanged((user) => {
            if (user) {
              this._uid = user.uid;
              this.loadProfile(user);
            } else {
              this._uid = null;
              this._profile = null;
              this.closeDropdown();
              this.closeProfile();
            }
          });
        }
      } catch (err) {
        console.error("[information.js] Lỗi khởi tạo:", err);
      }
    },

    // Cố gắng lấy fbAuth / fbDb đã tồn tại trong trang (nếu có), nếu không
    // thì tự khởi tạo qua firebase.auth() / firebase.firestore() (v10 compat).
    _resolveFirebase() {
      try {
        if (typeof fbAuth !== "undefined" && fbAuth) this._fbAuth = fbAuth;
        else if (window.firebase && firebase.apps && firebase.apps.length) {
          this._fbAuth = firebase.auth();
        }
      } catch (e) { /* fbAuth chưa tồn tại — bỏ qua */ }

      try {
        if (typeof fbDb !== "undefined" && fbDb) this._fbDb = fbDb;
        else if (window.firebase && firebase.apps && firebase.apps.length) {
          this._fbDb = firebase.firestore();
        }
      } catch (e) { /* fbDb chưa tồn tại — bỏ qua */ }
    },

    /* ========================================================================
       1. CSS — TOÀN BỘ INJECT BẰNG JS (prefix: profile- / info-)
       ======================================================================== */
    injectCSS() {
      const style = document.createElement("style");
      style.setAttribute("data-module", "information.js");
      style.innerHTML = `
/* ===================== information.js — injected CSS ===================== */
.profile-dropdown{
  position:absolute; top:calc(100% + 10px); right:0; min-width:220px;
  background:var(--card-bg-solid,#fff); border:1px solid var(--card-border,rgba(0,0,0,.08));
  border-radius:var(--radius-md,16px); box-shadow:var(--shadow-lg,0 20px 48px rgba(4,32,63,.18));
  backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px);
  padding:8px; z-index:2000; opacity:0; transform:scale(.92) translateY(-6px);
  transform-origin:top right; pointer-events:none;
  transition:opacity .18s cubic-bezier(.4,0,.2,1), transform .18s cubic-bezier(.4,0,.2,1);
}
.profile-dropdown.profile-open{opacity:1; transform:scale(1) translateY(0); pointer-events:auto;}
.profile-dropdown-item{
  display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px;
  border-radius:10px; background:transparent; border:none; cursor:pointer;
  font-size:13.5px; font-weight:600; color:var(--text-main,#0b1f33); text-align:left;
  transition:background .15s ease, color .15s ease; font-family:inherit;
}
.profile-dropdown-item:hover{background:rgba(20,120,212,.1); color:var(--accent,#1478d4);}
.profile-dropdown-item.profile-danger:hover{background:rgba(239,68,68,.1); color:var(--danger,#ef4444);}
.profile-dropdown-divider{height:1px; margin:6px 4px; background:var(--card-border,rgba(0,0,0,.08));}
.profile-badge-anchor{position:relative;}

.profile-overlay{
  position:fixed; inset:0; background:rgba(4,20,40,.55); backdrop-filter:blur(3px);
  display:flex; align-items:center; justify-content:center; z-index:3000;
  opacity:0; pointer-events:none; transition:opacity .22s ease;
}
.profile-overlay.profile-open{opacity:1; pointer-events:auto;}
.profile-modal{
  width:100%; max-width:460px; max-height:88vh; overflow-y:auto;
  background:var(--card-bg-solid,#fff); border-radius:var(--radius-lg,22px);
  box-shadow:var(--shadow-lg,0 20px 48px rgba(4,32,63,.18));
  transform:scale(.9) translateY(14px); opacity:0;
  transition:transform .24s cubic-bezier(.34,1.56,.64,1), opacity .2s ease;
  margin:16px;
}
.profile-overlay.profile-open .profile-modal{transform:scale(1) translateY(0); opacity:1;}
.profile-modal-header{
  position:relative; padding:30px 24px 20px; text-align:center;
  background:linear-gradient(160deg, var(--blue-600,#0d5fb3), var(--blue-800,#063563));
  border-radius:var(--radius-lg,22px) var(--radius-lg,22px) 0 0; color:#eaf4ff;
}
.profile-modal-close{
  position:absolute; top:14px; right:14px; width:32px; height:32px; border-radius:50%;
  border:none; background:rgba(255,255,255,.15); color:#fff; font-size:14px; cursor:pointer;
  display:flex; align-items:center; justify-content:center; transition:background .15s ease;
}
.profile-modal-close:hover{background:rgba(255,255,255,.3);}
.profile-avatar-wrap{position:relative; width:88px; height:88px; margin:0 auto 12px; cursor:pointer;}
.profile-avatar-img{
  width:88px; height:88px; border-radius:50%; object-fit:cover; border:3px solid rgba(255,255,255,.85);
  box-shadow:0 6px 18px rgba(0,0,0,.25); background:#dcedfd;
}
.profile-avatar-edit-badge{
  position:absolute; bottom:0; right:0; width:28px; height:28px; border-radius:50%;
  background:var(--accent-2,#06b6d4); color:#fff; display:none; align-items:center; justify-content:center;
  font-size:12px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.3);
}
.profile-modal.profile-editing .profile-avatar-edit-badge{display:flex;}
.profile-modal-name{font-size:17.5px; font-weight:800; margin-bottom:6px;}
.profile-role-badge{
  display:inline-flex; align-items:center; gap:6px; padding:3px 12px; border-radius:20px;
  font-size:10.5px; font-weight:800; letter-spacing:.4px;
}
.profile-role-badge.profile-role-admin{background:linear-gradient(135deg,#f59e0b,#f97316); color:#fff;}
.profile-role-badge.profile-role-user{background:rgba(255,255,255,.2); color:#eaf4ff;}

.profile-modal-body{padding:20px 24px 4px;}
.profile-level-box{
  display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:14px;
  background:rgba(20,120,212,.07); margin-bottom:18px;
}
.profile-level-num{
  width:40px; height:40px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--cyan-500,#06b6d4)); color:#fff; font-weight:800; font-size:14px;
}
.profile-level-info{flex:1; min-width:0;}
.profile-level-label{font-size:11px; font-weight:700; color:var(--text-muted,#5c7590); margin-bottom:5px; display:flex; justify-content:space-between;}
.profile-progress-track{height:8px; border-radius:6px; background:rgba(20,120,212,.15); overflow:hidden;}
.profile-progress-fill{
  height:100%; border-radius:6px; width:0%;
  background:linear-gradient(90deg,var(--blue-500,#1478d4),var(--cyan-400,#22d3ee));
  transition:width .6s cubic-bezier(.4,0,.2,1);
}
.profile-field{margin-bottom:14px;}
.profile-field label{display:block; font-size:11.5px; font-weight:700; color:var(--text-muted,#5c7590); margin-bottom:6px;}
.profile-field input, .profile-field select{
  width:100%; padding:10px 13px; border-radius:10px; border:1.5px solid var(--card-border,rgba(0,0,0,.1));
  background:rgba(120,150,190,.06); font-size:13.5px; font-family:inherit; color:var(--text-main,#0b1f33);
  transition:border-color .2s ease, box-shadow .2s ease, background .2s ease;
}
.profile-field input:disabled, .profile-field select:disabled{opacity:.7; cursor:not-allowed;}
.profile-field input:not(:disabled):focus, .profile-field select:not(:disabled):focus{
  outline:none; border-color:var(--accent,#1478d4); box-shadow:0 0 0 3px rgba(20,120,212,.14); background:#fff;
}
.profile-modal.profile-editing .profile-field input:not([readonly]),
.profile-modal.profile-editing .profile-field select{background:#fff;}
.profile-field-error{font-size:11px; color:var(--danger,#ef4444); margin-top:5px; display:none; font-weight:600;}
.profile-field.profile-invalid input, .profile-field.profile-invalid select{border-color:var(--danger,#ef4444);}
.profile-field.profile-invalid .profile-field-error{display:block;}
.profile-field-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
@media (max-width:480px){ .profile-field-row{grid-template-columns:1fr;} }
.profile-meta{font-size:11px; color:var(--text-muted,#5c7590); text-align:center; margin:6px 0 14px;}

.profile-modal-footer{
  display:flex; gap:10px; padding:16px 24px 24px; position:sticky; bottom:0;
  background:var(--card-bg-solid,#fff);
}
.profile-btn{
  position:relative; overflow:hidden; flex:1; padding:11px 16px; border-radius:12px; border:none;
  font-size:13.5px; font-weight:700; cursor:pointer; font-family:inherit;
  display:flex; align-items:center; justify-content:center; gap:8px; transition:transform .15s ease, box-shadow .15s ease;
}
.profile-btn:active{transform:scale(.97);}
.profile-btn-primary{background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--blue-600,#0d5fb3)); color:#fff; box-shadow:0 6px 16px rgba(20,120,212,.3);}
.profile-btn-ghost{background:rgba(20,120,212,.1); color:var(--accent,#1478d4);}
.profile-btn-danger{background:rgba(239,68,68,.12); color:var(--danger,#ef4444);}
.profile-btn:disabled{opacity:.6; cursor:not-allowed;}
.profile-ripple{position:absolute; border-radius:50%; background:rgba(255,255,255,.55); transform:scale(0); animation:profile-ripple-anim .55s ease-out; pointer-events:none;}
@keyframes profile-ripple-anim{ to{ transform:scale(2.6); opacity:0; } }

.profile-modal-loading{
  position:absolute; inset:0; background:rgba(255,255,255,.75); display:none; align-items:center; justify-content:center;
  border-radius:var(--radius-lg,22px); z-index:5; flex-direction:column; gap:10px;
}
[data-theme="dark"] .profile-modal-loading{background:rgba(4,32,63,.75);}
.profile-modal-loading.profile-show{display:flex;}
.profile-spinner{
  width:34px; height:34px; border-radius:50%; border:3px solid rgba(20,120,212,.2);
  border-top-color:var(--accent,#1478d4); animation:profile-spin .7s linear infinite;
}
@keyframes profile-spin{ to{ transform:rotate(360deg); } }

.profile-toast-wrap{position:fixed; top:18px; right:18px; z-index:6000; display:flex; flex-direction:column; gap:10px;}
.profile-toast{
  min-width:220px; max-width:320px; padding:12px 16px; border-radius:12px; color:#fff; font-size:13px; font-weight:600;
  box-shadow:var(--shadow-lg,0 20px 48px rgba(4,32,63,.18)); display:flex; align-items:center; gap:10px;
  transform:translateX(120%); opacity:0; transition:transform .3s cubic-bezier(.34,1.56,.64,1), opacity .3s ease;
}
.profile-toast.profile-show{transform:translateX(0); opacity:1;}
.profile-toast-success{background:linear-gradient(135deg,#16c784,#0e9d68);}
.profile-toast-error{background:linear-gradient(135deg,#ef4444,#dc2626);}
.profile-toast-info{background:linear-gradient(135deg,var(--blue-500,#1478d4),var(--blue-600,#0d5fb3));}

[data-theme="dark"] .profile-dropdown,
[data-theme="dark"] .profile-modal,
[data-theme="dark"] .profile-modal-footer{background:var(--blue-900,#04203f); color:var(--text-inverse,#eaf4ff);}
[data-theme="dark"] .profile-dropdown-item{color:var(--text-inverse,#eaf4ff);}
[data-theme="dark"] .profile-field label{color:var(--blue-200,#a7d3f7);}
[data-theme="dark"] .profile-field input, [data-theme="dark"] .profile-field select{
  background:rgba(255,255,255,.06); color:var(--text-inverse,#eaf4ff); border-color:rgba(255,255,255,.14);
}
[data-theme="dark"] .profile-modal.profile-editing .profile-field input:not([readonly]),
[data-theme="dark"] .profile-modal.profile-editing .profile-field select{background:rgba(255,255,255,.1);}

@media (max-width:520px){
  .profile-modal{max-width:100%; border-radius:18px 18px 0 0; margin:0; position:fixed; bottom:0; left:0; right:0; max-height:92vh;}
  .profile-overlay{align-items:flex-end;}
}
`;
      document.head.appendChild(style);
    },

    /* ========================================================================
       2. DROPDOWN USER
       ======================================================================== */
    createDropdown() {
      const badge = document.getElementById("userBadge");
      if (!badge) return; // Topbar chưa có userBadge — bỏ qua an toàn.
      badge.classList.add("profile-badge-anchor");

      const dropdown = document.createElement("div");
      dropdown.id = "profileDropdown";
      dropdown.className = "profile-dropdown";
      dropdown.innerHTML = `
        <button type="button" class="profile-dropdown-item" data-action="open-profile">
          <i class="fa-solid fa-id-card"></i> Thông tin cá nhân
        </button>
        <button type="button" class="profile-dropdown-item" data-action="open-settings">
          <i class="fa-solid fa-gear"></i> Cài đặt
        </button>
        <div class="profile-dropdown-divider"></div>
        <button type="button" class="profile-dropdown-item profile-danger" data-action="logout">
          <i class="fa-solid fa-right-from-bracket"></i> Đăng xuất
        </button>`;
      badge.appendChild(dropdown);
      this._dropdownEl = dropdown;
    },

    openDropdown() {
      if (!this._dropdownEl) return;
      this._dropdownEl.classList.add("profile-open");
      this._dropdownOpen = true;
    },
    closeDropdown() {
      if (!this._dropdownEl) return;
      this._dropdownEl.classList.remove("profile-open");
      this._dropdownOpen = false;
    },
    toggleDropdown() {
      this._dropdownOpen ? this.closeDropdown() : this.openDropdown();
    },

    /* ========================================================================
       3. PROFILE MODAL — TOÀN BỘ HTML SINH BẰNG JS
       ======================================================================== */
    createProfileModal() {
      const overlay = document.createElement("div");
      overlay.id = "profileOverlay";
      overlay.className = "profile-overlay";
      overlay.innerHTML = `
        <div class="profile-modal" id="profileModalBox">
          <div class="profile-modal-loading" id="profileModalLoading">
            <div class="profile-spinner"></div>
          </div>
          <div class="profile-modal-header">
            <button type="button" class="profile-modal-close" id="profileCloseBtn" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
            <div class="profile-avatar-wrap" id="profileAvatarWrap">
              <img class="profile-avatar-img" id="profileAvatarImg" src="" alt="avatar">
              <div class="profile-avatar-edit-badge"><i class="fa-solid fa-camera"></i></div>
              <input type="file" id="profileAvatarInput" accept="image/*" style="display:none;">
            </div>
            <div class="profile-modal-name" id="profileNameDisplay">-</div>
            <span class="profile-role-badge profile-role-user" id="profileRoleBadge">Người dùng</span>
          </div>

          <div class="profile-modal-body">
            <div class="profile-level-box">
              <div class="profile-level-num" id="profileLevelNum">1</div>
              <div class="profile-level-info">
                <div class="profile-level-label"><span>Cấp độ</span><span id="profileXpText">0 / 100 XP</span></div>
                <div class="profile-progress-track"><div class="profile-progress-fill" id="profileXpFill"></div></div>
              </div>
            </div>

            <div class="profile-field">
              <label for="profileFieldName">Họ và tên</label>
              <input type="text" id="profileFieldName" disabled maxlength="50">
              <div class="profile-field-error" id="profileErrName">Tên phải từ 2–50 ký tự.</div>
            </div>

            <div class="profile-field">
              <label for="profileFieldEmail">Email</label>
              <input type="email" id="profileFieldEmail" readonly disabled>
            </div>

            <div class="profile-field-row">
              <div class="profile-field">
                <label for="profileFieldPhone">Số điện thoại</label>
                <input type="text" id="profileFieldPhone" disabled placeholder="09xxxxxxxx">
                <div class="profile-field-error" id="profileErrPhone">Số điện thoại không hợp lệ.</div>
              </div>
              <div class="profile-field">
                <label for="profileFieldBirthday">Ngày sinh</label>
                <input type="date" id="profileFieldBirthday" disabled>
                <div class="profile-field-error" id="profileErrBirthday">Ngày sinh không hợp lệ.</div>
              </div>
            </div>

            <div class="profile-field">
              <label for="profileFieldGender">Giới tính</label>
              <select id="profileFieldGender" disabled>
                <option value="">-- Chưa chọn --</option>
                <option value="male">Nam</option>
                <option value="female">Nữ</option>
                <option value="other">Khác</option>
              </select>
            </div>

            <div class="profile-field">
              <label for="profileFieldAddress">Địa chỉ</label>
              <input type="text" id="profileFieldAddress" disabled maxlength="120">
            </div>

            <div class="profile-field-row">
              <div class="profile-field">
                <label for="profileFieldCompany">Công ty</label>
                <input type="text" id="profileFieldCompany" disabled maxlength="80">
              </div>
              <div class="profile-field">
                <label for="profileFieldPosition">Chức vụ</label>
                <input type="text" id="profileFieldPosition" disabled maxlength="80">
              </div>
            </div>

            <div class="profile-meta" id="profileCreatedAt"></div>
          </div>

          <div class="profile-modal-footer" id="profileFooterView">
            <button type="button" class="profile-btn profile-btn-primary" id="profileEditBtn">
              <i class="fa-solid fa-pen"></i> Chỉnh sửa
            </button>
          </div>
          <div class="profile-modal-footer" id="profileFooterEdit" style="display:none;">
            <button type="button" class="profile-btn profile-btn-ghost" id="profileCancelBtn">Hủy</button>
            <button type="button" class="profile-btn profile-btn-primary" id="profileSaveBtn">
              <i class="fa-solid fa-check"></i> Lưu
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const toastWrap = document.createElement("div");
      toastWrap.id = "profileToastWrap";
      toastWrap.className = "profile-toast-wrap";
      document.body.appendChild(toastWrap);

      this._overlayEl = overlay;
      this._toastWrap = toastWrap;
    },

    /* ========================================================================
       4. EVENT — đăng ký toàn bộ sự kiện của module
       ======================================================================== */
    bindEvents() {
      const badge = document.getElementById("userBadge");
      if (badge) {
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleDropdown();
        });
      }

      // Click ra ngoài -> đóng dropdown
      document.addEventListener("click", (e) => {
        if (this._dropdownOpen && this._dropdownEl && !this._dropdownEl.contains(e.target)) {
          this.closeDropdown();
        }
      });

      // Click các mục trong dropdown
      if (this._dropdownEl) {
        this._dropdownEl.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-action]");
          if (!btn) return;
          e.stopPropagation();
          const action = btn.getAttribute("data-action");
          this.closeDropdown();
          if (action === "open-profile") this.openProfile();
          else if (action === "open-settings") this._goToSettings();
          else if (action === "logout") this._triggerLogout();
        });
      }

      // ESC — đóng modal trước, sau đó mới đóng dropdown
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (this._modalOpen) this.closeProfile();
          else if (this._dropdownOpen) this.closeDropdown();
        }
      });

      // Click overlay (ngoài modal) -> đóng modal
      if (this._overlayEl) {
        this._overlayEl.addEventListener("click", (e) => {
          if (e.target === this._overlayEl) this.closeProfile();
        });
      }

      const closeBtn = document.getElementById("profileCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", () => this.closeProfile());

      const editBtn = document.getElementById("profileEditBtn");
      if (editBtn) editBtn.addEventListener("click", (e) => { this._ripple(e, editBtn); this.enableEdit(); });

      const cancelBtn = document.getElementById("profileCancelBtn");
      if (cancelBtn) cancelBtn.addEventListener("click", (e) => { this._ripple(e, cancelBtn); this.cancelEdit(); });

      const saveBtn = document.getElementById("profileSaveBtn");
      if (saveBtn) saveBtn.addEventListener("click", (e) => { this._ripple(e, saveBtn); this.saveProfile(); });

      const avatarWrap = document.getElementById("profileAvatarWrap");
      const avatarInput = document.getElementById("profileAvatarInput");
      if (avatarWrap && avatarInput) {
        avatarWrap.addEventListener("click", () => {
          if (this._isEditing) avatarInput.click();
        });
        avatarInput.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) this.uploadAvatar(file);
          avatarInput.value = "";
        });
      }

      // Resize window — không cần logic phức tạp, CSS responsive đã xử lý;
      // đóng dropdown khi resize để tránh lệch vị trí.
      window.addEventListener("resize", () => {
        if (this._dropdownOpen) this.closeDropdown();
      });

      // Dark mode — theo dõi thay đổi data-theme trên <html> để cập nhật UI
      // (CSS đã dùng biến toàn cục nên tự động đổi màu, không cần thao tác thêm).
      try {
        const observer = new MutationObserver(() => {});
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        this._themeObserver = observer;
      } catch (e) { /* MutationObserver không khả dụng — bỏ qua an toàn */ }
    },

    _goToSettings() {
      try {
        if (window.UIManager && typeof UIManager.navigate === "function") {
          UIManager.navigate("settings");
          return;
        }
      } catch (e) { /* fallback bên dưới */ }
      const navBtn = document.querySelector('.nav-item[data-view="settings"]');
      if (navBtn) navBtn.click();
    },

    _triggerLogout() {
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) { logoutBtn.click(); return; }
      try {
        if (this._fbAuth) this._fbAuth.signOut().then(() => location.reload());
      } catch (e) { console.error("[information.js] Lỗi đăng xuất:", e); }
    },

    // Hiệu ứng ripple cho nút bấm
    _ripple(evt, btn) {
      try {
        const rect = btn.getBoundingClientRect();
        const circle = document.createElement("span");
        const size = Math.max(rect.width, rect.height);
        circle.className = "profile-ripple";
        circle.style.width = circle.style.height = size + "px";
        circle.style.left = (evt.clientX - rect.left - size / 2) + "px";
        circle.style.top = (evt.clientY - rect.top - size / 2) + "px";
        btn.appendChild(circle);
        setTimeout(() => circle.remove(), 550);
      } catch (e) { /* hiệu ứng phụ — bỏ qua lỗi nếu có */ }
    },

    /* ========================================================================
       5. OPEN / CLOSE MODAL
       ======================================================================== */
    openProfile() {
      if (!this._overlayEl) return;
      if (!this._profile) this.showToast("Đang tải dữ liệu, vui lòng thử lại sau giây lát.", "info");
      this.renderProfile();
      this._overlayEl.classList.add("profile-open");
      this._modalOpen = true;
      document.body.style.overflow = "hidden";
    },
    closeProfile() {
      if (!this._overlayEl) return;
      if (this._isEditing) this.cancelEdit();
      this._overlayEl.classList.remove("profile-open");
      this._modalOpen = false;
      document.body.style.overflow = "";
    },

    /* ========================================================================
       6. FIREBASE — ĐỌC / TẠO users/{uid}
       ======================================================================== */
    async loadProfile(user) {
      const uid = user.uid;

      // BƯỚC 1: load cache localStorage, render ngay lập tức
      try {
        const cachedRaw = localStorage.getItem(LS_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.uid === uid) {
            this._profile = Object.assign({}, DEFAULT_FIELDS, cached.data);
            // BƯỚC 2: render ngay giao diện
            this.renderProfile();
            this.updateTopbar();
          }
        }
      } catch (e) {
        console.warn("[information.js] Không đọc được cache localStorage:", e);
      }

      if (!this._fbDb) {
        console.warn("[information.js] Không tìm thấy Firestore (fbDb). Chỉ dùng dữ liệu cache/local.");
        if (!this._profile) {
          this._profile = Object.assign({}, DEFAULT_FIELDS, {
            displayName: user.displayName || "",
            photoURL: user.photoURL || "",
            email: user.email || "",
          });
          this.renderProfile();
          this.updateTopbar();
        }
        return;
      }

      // BƯỚC 3: đọc Firestore
      try {
        const ref = this._fbDb.collection("users").doc(uid);
        const snap = await ref.get();
        let data;

        if (!snap.exists) {
          // Chưa có document -> tự tạo
          data = Object.assign({}, DEFAULT_FIELDS, {
            displayName: user.displayName || "",
            photoURL: user.photoURL || "",
            email: user.email || "",
            role: this._resolveRole(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          await ref.set(data);
          // Đọc lại để lấy timestamp thực tế đã ghi
          const freshSnap = await ref.get();
          data = Object.assign({}, DEFAULT_FIELDS, freshSnap.data());
        } else {
          data = snap.data() || {};
          // Nếu thiếu field nào -> tự bổ sung
          const missing = {};
          Object.keys(DEFAULT_FIELDS).forEach((key) => {
            if (!(key in data)) missing[key] = DEFAULT_FIELDS[key];
          });
          if (Object.keys(missing).length > 0) {
            await ref.set(missing, { merge: true });
            data = Object.assign({}, data, missing);
          }
          data = Object.assign({}, DEFAULT_FIELDS, data);
        }

        // BƯỚC 4/5: nếu Firestore mới hơn cache -> render lại
        const changed = !this._profile || JSON.stringify(this._normalizeForCompare(this._profile)) !== JSON.stringify(this._normalizeForCompare(data));
        this._profile = data;
        if (changed) this.renderProfile();
        this.updateTopbar();

        // BƯỚC 6: cập nhật cache
        this.syncLocalCache();
      } catch (err) {
        console.error("[information.js] Lỗi đọc Firestore users/{uid}:", err);
        this.showToast("Không thể tải hồ sơ từ máy chủ. Đang dùng dữ liệu đã lưu.", "error");
      }
    },

    _normalizeForCompare(data) {
      const clone = Object.assign({}, data);
      delete clone.createdAt; // Timestamp Firestore không so sánh trực tiếp được
      return clone;
    },

    _resolveRole() {
      try {
        if (typeof AuthManager !== "undefined" && AuthManager && AuthManager.currentRole) {
          return AuthManager.currentRole === "admin" ? "admin" : "user";
        }
      } catch (e) { /* AuthManager chưa tồn tại */ }
      return "user";
    },

    /* ========================================================================
       7. CACHE — localStorage (key: user_profile)
       ======================================================================== */
    syncLocalCache() {
      if (!this._uid || !this._profile) return;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ uid: this._uid, data: this._profile, savedAt: Date.now() }));
      } catch (e) {
        console.warn("[information.js] Không thể ghi cache localStorage:", e);
      }
    },

    /* ========================================================================
       8. RENDER PROFILE — đổ dữ liệu vào Modal + Dropdown
       ======================================================================== */
    renderProfile() {
      if (!this._profile) return;
      const p = this._profile;

      const nameEl = document.getElementById("profileNameDisplay");
      if (nameEl) nameEl.textContent = p.displayName || p.email || "Người dùng";

      const avatarImg = document.getElementById("profileAvatarImg");
      if (avatarImg) avatarImg.src = p.photoURL || "https://ui-avatars.com/api/?name=" + encodeURIComponent(p.displayName || "U");

      // Badge vai trò — admin (vàng) / user (xanh)
      const roleBadge = document.getElementById("profileRoleBadge");
      if (roleBadge) {
        const isAdmin = p.role === "admin";
        roleBadge.className = "profile-role-badge " + (isAdmin ? "profile-role-admin" : "profile-role-user");
        roleBadge.innerHTML = isAdmin
          ? '<i class="fa-solid fa-crown"></i> Quản trị viên'
          : '<i class="fa-solid fa-user"></i> Người dùng';
      }

      // Level / XP
      const level = Number(p.level) || 1;
      const xp = Number(p.xp) || 0;
      const xpReq = Number(p.xpRequired) || DEFAULT_XP_REQUIRED;
      const levelNum = document.getElementById("profileLevelNum");
      if (levelNum) levelNum.textContent = String(level);
      const xpText = document.getElementById("profileXpText");
      if (xpText) xpText.textContent = `${xp} / ${xpReq} XP`;
      const xpFill = document.getElementById("profileXpFill");
      if (xpFill) {
        const pct = xpReq > 0 ? Math.min(100, Math.round((xp / xpReq) * 100)) : 0;
        requestAnimationFrame(() => { xpFill.style.width = pct + "%"; });
      }

      // Form fields
      this._setFieldValue("profileFieldName", p.displayName);
      this._setFieldValue("profileFieldEmail", p.email);
      this._setFieldValue("profileFieldPhone", p.phone);
      this._setFieldValue("profileFieldBirthday", p.birthday);
      this._setFieldValue("profileFieldGender", p.gender);
      this._setFieldValue("profileFieldAddress", p.address);
      this._setFieldValue("profileFieldCompany", p.company);
      this._setFieldValue("profileFieldPosition", p.position);

      const createdAtEl = document.getElementById("profileCreatedAt");
      if (createdAtEl) {
        const dateStr = this._formatCreatedAt(p.createdAt);
        createdAtEl.textContent = dateStr ? `Thành viên từ ${dateStr}` : "";
      }

      this._clearAllFieldErrors();
    },

    _formatCreatedAt(createdAt) {
      try {
        if (!createdAt) return "";
        let d;
        if (typeof createdAt.toDate === "function") d = createdAt.toDate();
        else if (createdAt instanceof Date) d = createdAt;
        else d = new Date(createdAt);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleDateString("vi-VN");
      } catch (e) { return ""; }
    },

    _setFieldValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value || "";
    },

    /* ========================================================================
       9. ĐỒNG BỘ TOPBAR — avatar, tên, badge role, level, xp (không reload)
       ======================================================================== */
    updateTopbar() {
      if (!this._profile) return;
      const p = this._profile;

      const avatarEl = document.getElementById("userBadgeAvatar");
      if (avatarEl && p.photoURL) avatarEl.src = p.photoURL;

      const nameEl = document.getElementById("userBadgeName");
      if (nameEl) nameEl.textContent = p.displayName || p.email || "-";

      const adminBadge = document.getElementById("adminBadge");
      const userRoleBadge = document.getElementById("userRoleBadge");
      const isAdmin = p.role === "admin";
      if (adminBadge) adminBadge.style.display = isAdmin ? "inline-flex" : "none";
      if (userRoleBadge) userRoleBadge.style.display = isAdmin ? "none" : "inline-flex";
    },

    /* ========================================================================
       10. EDIT MODE
       ======================================================================== */
    enableEdit() {
      if (!this._profile) return;
      this._isEditing = true;
      this._editBackup = Object.assign({}, this._profile);

      const editableIds = [
        "profileFieldName", "profileFieldPhone", "profileFieldBirthday",
        "profileFieldGender", "profileFieldAddress", "profileFieldCompany", "profileFieldPosition",
      ];
      editableIds.forEach((id) => { const el = document.getElementById(id); if (el) el.disabled = false; });

      const modalBox = document.getElementById("profileModalBox");
      if (modalBox) modalBox.classList.add("profile-editing");

      document.getElementById("profileFooterView").style.display = "none";
      document.getElementById("profileFooterEdit").style.display = "flex";
    },

    disableEdit() {
      this._isEditing = false;
      const editableIds = [
        "profileFieldName", "profileFieldPhone", "profileFieldBirthday",
        "profileFieldGender", "profileFieldAddress", "profileFieldCompany", "profileFieldPosition",
      ];
      editableIds.forEach((id) => { const el = document.getElementById(id); if (el) el.disabled = true; });

      const modalBox = document.getElementById("profileModalBox");
      if (modalBox) modalBox.classList.remove("profile-editing");

      document.getElementById("profileFooterView").style.display = "flex";
      document.getElementById("profileFooterEdit").style.display = "none";
      this._clearAllFieldErrors();
    },

    cancelEdit() {
      if (this._editBackup) {
        this._profile = this._editBackup;
        this._editBackup = null;
        this._avatarPendingFile = null;
        this.renderProfile();
      }
      this.disableEdit();
    },

    /* ========================================================================
       11. VALIDATE
       ======================================================================== */
    _clearAllFieldErrors() {
      ["profileFieldName", "profileFieldPhone", "profileFieldBirthday"].forEach((id) => {
        const field = document.getElementById(id);
        if (field && field.closest(".profile-field")) field.closest(".profile-field").classList.remove("profile-invalid");
      });
    },

    _setFieldError(inputId, hasError) {
      const field = document.getElementById(inputId);
      if (field && field.closest(".profile-field")) {
        field.closest(".profile-field").classList.toggle("profile-invalid", !!hasError);
      }
    },

    validateProfile() {
      let valid = true;

      const name = (document.getElementById("profileFieldName").value || "").trim();
      const nameOk = name.length >= 2 && name.length <= 50;
      this._setFieldError("profileFieldName", !nameOk);
      if (!nameOk) valid = false;

      const phone = (document.getElementById("profileFieldPhone").value || "").trim();
      const phoneOk = phone === "" || VN_PHONE_REGEX.test(phone);
      this._setFieldError("profileFieldPhone", !phoneOk);
      if (!phoneOk) valid = false;

      const birthday = document.getElementById("profileFieldBirthday").value;
      let birthdayOk = true;
      if (birthday) {
        const d = new Date(birthday);
        const now = new Date();
        const minDate = new Date("1900-01-01");
        if (isNaN(d.getTime()) || d > now || d < minDate) birthdayOk = false;
      }
      this._setFieldError("profileFieldBirthday", !birthdayOk);
      if (!birthdayOk) valid = false;

      return valid;
    },

    /* ========================================================================
       12. SAVE PROFILE
       ======================================================================== */
    async saveProfile() {
      if (!this.validateProfile()) {
        this.showToast("Vui lòng kiểm tra lại thông tin.", "error");
        return;
      }
      if (!this._uid) {
        this.showToast("Bạn cần đăng nhập để lưu hồ sơ.", "error");
        return;
      }

      const updated = Object.assign({}, this._profile, {
        displayName: (document.getElementById("profileFieldName").value || "").trim(),
        phone: (document.getElementById("profileFieldPhone").value || "").trim(),
        birthday: document.getElementById("profileFieldBirthday").value || "",
        gender: document.getElementById("profileFieldGender").value || "",
        address: (document.getElementById("profileFieldAddress").value || "").trim(),
        company: (document.getElementById("profileFieldCompany").value || "").trim(),
        position: (document.getElementById("profileFieldPosition").value || "").trim(),
      });

      this.showLoading();
      try {
        if (this._fbDb) {
          await this._fbDb.collection("users").doc(this._uid).set(updated, { merge: true });
        }
        this._profile = updated;
        this.syncLocalCache();
        this.renderProfile();
        this.updateTopbar();
        this.disableEdit();
        this.showToast("Cập nhật hồ sơ thành công!", "success");
      } catch (err) {
        console.error("[information.js] Lỗi lưu hồ sơ:", err);
        this.showToast("Lưu hồ sơ thất bại: " + (err.message || "Lỗi không xác định"), "error");
      } finally {
        this.hideLoading();
      }
    },

    /* ========================================================================
       13. UPLOAD AVATAR — preview, resize/compress, upload, cập nhật Firestore
       ======================================================================== */
    async uploadAvatar(file) {
      if (!file || !file.type.startsWith("image/")) {
        this.showToast("Vui lòng chọn một file ảnh hợp lệ.", "error");
        return;
      }
      const oldPhotoURL = this._profile ? this._profile.photoURL : "";
      const avatarImg = document.getElementById("profileAvatarImg");

      this.showLoading();
      try {
        const compressedDataUrl = await this._compressImage(file, 320, 320, 0.75);

        // Preview ngay lập tức
        if (avatarImg) avatarImg.src = compressedDataUrl;

        if (!this._uid) throw new Error("Chưa đăng nhập.");

        if (this._fbDb) {
          await this._fbDb.collection("users").doc(this._uid).set({ photoURL: compressedDataUrl }, { merge: true });
        }

        this._profile = Object.assign({}, this._profile, { photoURL: compressedDataUrl });
        this.syncLocalCache();
        this.updateTopbar();
        this.showToast("Cập nhật ảnh đại diện thành công!", "success");
      } catch (err) {
        console.error("[information.js] Lỗi upload avatar:", err);
        // Khôi phục ảnh cũ nếu upload thất bại
        if (avatarImg) avatarImg.src = oldPhotoURL || "";
        this.showToast("Tải ảnh đại diện thất bại. Đã khôi phục ảnh cũ.", "error");
      } finally {
        this.hideLoading();
      }
    },

    // Resize + nén ảnh bằng canvas, trả về base64 (dataURL JPEG)
    _compressImage(file, maxW, maxH, quality) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Không đọc được file ảnh."));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("File ảnh không hợp lệ."));
          img.onload = () => {
            try {
              let { width, height } = img;
              const ratio = Math.min(maxW / width, maxH / height, 1);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);

              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL("image/jpeg", quality));
            } catch (e) { reject(e); }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },

    /* ========================================================================
       14. TOAST / LOADING
       ======================================================================== */
    showToast(message, type) {
      if (!this._toastWrap) return;
      const toast = document.createElement("div");
      const kind = type === "success" || type === "error" ? type : "info";
      toast.className = `profile-toast profile-toast-${kind}`;
      const icon = kind === "success" ? "fa-circle-check" : kind === "error" ? "fa-circle-exclamation" : "fa-circle-info";
      toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
      this._toastWrap.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("profile-show"));
      setTimeout(() => {
        toast.classList.remove("profile-show");
        setTimeout(() => toast.remove(), 320);
      }, 3200);
    },

    showLoading() {
      const el = document.getElementById("profileModalLoading");
      if (el) el.classList.add("profile-show");
    },
    hideLoading() {
      const el = document.getElementById("profileModalLoading");
      if (el) el.classList.remove("profile-show");
    },
  };

  /* ========================================================================
     KHỞI ĐỘNG TỰ ĐỘNG — không cần gọi thêm bất kỳ hàm nào từ bên ngoài.
     ======================================================================== */
  function bootstrap() {
    Information.init();
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  // Expose có kiểm soát để debug / gọi thủ công nếu thật sự cần thiết.
  window.information = Information;
})();
