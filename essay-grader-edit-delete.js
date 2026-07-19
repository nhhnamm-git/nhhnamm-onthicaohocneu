/**
 * essay-grader-edit-delete.js
 * ============================================================================
 * MODULE BỔ SUNG cho "essay-grader.js" — KHÔNG sửa bất kỳ dòng nào của file
 * gốc. File này tự "gắn thêm" (mount lên trên DOM đã có sẵn) 2 tính năng mới
 * vào tab "Lịch sử bài nộp" (phần dành cho học viên):
 *
 *   1. SỬA BÀI NỘP  — học viên có thể sửa lại "Bài làm" (tên file + nội dung)
 *      của 1 bài đã nộp, vì có thể đổi ý sau khi đã bấm "Nộp bài". Mỗi lần
 *      sửa, bản NỘI DUNG CŨ được lưu lại vào mảng "editHistory" ngay trong
 *      cùng document Firestore — không mất lịch sử sửa đổi.
 *   2. XÓA BÀI NỘP  — học viên có thể xóa hẳn 1 bài đã nộp (có xác nhận).
 *
 * CÁCH DÙNG
 * ----------------------------------------------------------------------------
 * Thêm đúng 1 dòng vào cuối <body>, NGAY SAU dòng đang gọi essay-grader.js
 * (thứ tự bắt buộc: essay-grader.js phải chạy TRƯỚC file này):
 *
 *   <script src="essay-grader.js"></script>
 *   <script src="essay-grader-edit-delete.js"></script>
 *
 * File này không cần essay-grader.js "cho phép" gì cả — nó tự dò tìm các
 * phần tử giao diện (#essay-grader-widget, #eg-mine-list, #eg-mine-detail)
 * đã được essay-grader.js dựng lên, rồi gắn thêm nút "Sửa" / "Xóa" / "Lịch sử
 * sửa đổi" vào mỗi bài nộp của CHÍNH học viên đang đăng nhập. Vì vậy nó hoạt
 * động độc lập, không cần chỉnh sửa gì trong essay-grader.js.
 *
 * YÊU CẦU BẮT BUỘC PHẢI CẬP NHẬT LẠI FIRESTORE SECURITY RULES
 * ----------------------------------------------------------------------------
 * Rule mặc định đi kèm essay-grader.js chỉ cho phép học viên "create" +
 * "read" (KHÔNG update/delete bài của chính mình — cố tình chặn để "lịch sử
 * chấm phải được giữ vĩnh viễn"). Vì module này bổ sung tính năng sửa/xóa
 * THEO YÊU CẦU, bạn cần nới lại đúng 2 rule "update" và "delete" để CHÍNH CHỦ
 * (studentUid == request.auth.uid) được phép, còn người khác thì không:
 *
 *   match /essaySubmissions/{submissionId} {
 *     function isSignedIn() { return request.auth != null; }
 *     function isOwner() { return isSignedIn() && resource.data.studentUid == request.auth.uid; }
 *     function isAdmin() {
 *       return isSignedIn() &&
 *         get(/databases/$(database)/documents/allowedUsers/$(request.auth.token.email.lower())).data.role == 'admin';
 *     }
 *     allow create: if isSignedIn() && request.resource.data.studentUid == request.auth.uid;
 *     allow read:   if isSignedIn() && (resource.data.studentUid == request.auth.uid || isAdmin());
 *
 *     // MỚI: cho phép chính học viên SỬA bài của mình (không được đổi chủ
 *     // sở hữu studentUid), và vẫn giữ nguyên quyền Admin cập nhật (chấm điểm).
 *     allow update: if isSignedIn() && (
 *         isAdmin() ||
 *         (isOwner() && request.resource.data.studentUid == resource.data.studentUid)
 *     );
 *
 *     // MỚI: cho phép chính học viên XÓA bài của mình. Admin/người khác
 *     // không được xóa.
 *     allow delete: if isOwner();
 *   }
 *
 * Nếu chưa cập nhật rule này, nút "Sửa"/"Xóa" vẫn hiện nhưng thao tác sẽ báo
 * lỗi quyền truy cập (permission-denied) khi lưu.
 *
 * GHI CHÚ VỀ "LỊCH SỬ SỬA ĐỔI"
 * ----------------------------------------------------------------------------
 * Mỗi lần học viên bấm "Lưu thay đổi", module KHÔNG ghi đè mất bản cũ mà:
 *   - Đọc lại document mới nhất từ Firestore.
 *   - Đẩy {thời điểm sửa, người sửa, ghi chú, TOÀN BỘ bài làm CŨ} vào cuối
 *     mảng "editHistory" của document.
 *   - Chỉ sau đó mới ghi đè trường "studentEssay" bằng nội dung MỚI.
 * Nhờ vậy, bấm "Xem lịch sử sửa đổi" sẽ thấy đầy đủ mọi phiên bản cũ, mới
 * nhất lên đầu.
 * ============================================================================
 */
(function (global, document) {
  "use strict";

  if (global.__essayGraderEditDeleteMounted) return;
  global.__essayGraderEditDeleteMounted = true;

  const CONFIG = {
    firestoreCollection: "essaySubmissions",
  };

  // ==========================================================================
  // 0. TIỆN ÍCH DÙNG CHUNG (bản độc lập, không phụ thuộc essay-grader.js)
  // ==========================================================================
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function formatDate(ts) {
    try {
      const d = ts && typeof ts.toDate === "function" ? ts.toDate()
        : ts instanceof Date ? ts
        : typeof ts === "number" ? new Date(ts)
        : null;
      if (!d) return "-";
      return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "-";
    }
  }

  function truncate(str, n) {
    const s = String(str || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // --------------------------------------------------------------------
  // Nhận diện Firestore DB / User đăng nhập — dò tương tự essay-grader.js,
  // viết lại độc lập ở đây vì các hàm gốc nằm trong closure riêng, không
  // "export" ra ngoài để tái sử dụng được.
  // --------------------------------------------------------------------
  function resolveDb() {
    if (global.fbDb && typeof global.fbDb.collection === "function") return global.fbDb;
    try {
      if (typeof fbDb !== "undefined" && fbDb && typeof fbDb.collection === "function") return fbDb;
    } catch (e) { /* bỏ qua */ }
    if (global.db && typeof global.db.collection === "function") return global.db;
    if (global.firestore && typeof global.firestore.collection === "function") return global.firestore;
    if (global.firebase && typeof global.firebase.firestore === "function") {
      try {
        const inst = global.firebase.firestore();
        if (inst && typeof inst.collection === "function") return inst;
      } catch (e) { /* bỏ qua */ }
    }
    return null;
  }

  function resolveServerTimestamp() {
    if (global.firebase && global.firebase.firestore && global.firebase.firestore.FieldValue) {
      return global.firebase.firestore.FieldValue.serverTimestamp();
    }
    return new Date();
  }

  function resolveAuthUser() {
    let AM = global.AuthManager;
    if (!AM) {
      try { if (typeof AuthManager !== "undefined" && AuthManager) AM = AuthManager; } catch (e) { /* bỏ qua */ }
    }
    if (AM) {
      if (AM.currentUser) return AM.currentUser;
      if (typeof AM.getCurrentUser === "function") {
        const u = AM.getCurrentUser();
        if (u) return u;
      }
      if (AM.user) return AM.user;
    }
    if (global.fbAuth && global.fbAuth.currentUser) return global.fbAuth.currentUser;
    try {
      if (typeof fbAuth !== "undefined" && fbAuth && fbAuth.currentUser) return fbAuth.currentUser;
    } catch (e) { /* bỏ qua */ }
    if (global.firebase && typeof global.firebase.auth === "function") {
      try {
        const u = global.firebase.auth().currentUser;
        if (u) return u;
      } catch (e) { /* bỏ qua */ }
    }
    if (global.currentUser) return global.currentUser;
    return null;
  }

  function currentAuthUser() {
    return resolveAuthUser();
  }

  function firestoreReady() {
    return !!resolveDb();
  }

  // ==========================================================================
  // 1. THAO TÁC FIRESTORE: SỬA (kèm lưu lịch sử) / XÓA
  // ==========================================================================
  // Sửa bài nộp: đọc lại bản mới nhất, đẩy TOÀN BỘ "studentEssay" hiện tại
  // vào cuối mảng editHistory (không mất dữ liệu cũ), rồi mới ghi đè bằng
  // nội dung mới. Không dùng FieldValue.arrayUnion() vì Firestore không cho
  // phép serverTimestamp() nằm bên trong phần tử của arrayUnion — nên thời
  // điểm sửa trong mỗi entry lịch sử dùng giờ máy khách (new Date()).
  async function updateSubmissionWithHistory(id, newStudentEssay, note) {
    if (!firestoreReady()) throw new Error("Chưa kết nối được Firestore.");
    const user = currentAuthUser();
    if (!user) throw new Error("Bạn cần đăng nhập để sửa bài.");

    const docRef = resolveDb().collection(CONFIG.firestoreCollection).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error("Bài nộp này không còn tồn tại (có thể đã bị xóa).");
    const data = snap.data();
    if (data.studentUid !== user.uid) throw new Error("Bạn chỉ được sửa bài nộp của chính mình.");

    const historyEntry = {
      editedAt: new Date(),
      editedByUid: user.uid,
      editedByName: user.displayName || user.email || "Học viên",
      note: (note || "").trim(),
      previousStudentEssay: data.studentEssay || null,
    };
    const existingHistory = Array.isArray(data.editHistory) ? data.editHistory : [];
    const now = resolveServerTimestamp();

    await docRef.update({
      studentEssay: newStudentEssay,
      editHistory: existingHistory.concat([historyEntry]),
      editCount: (Number(data.editCount) || 0) + 1,
      lastEditedAt: now,
      updatedAt: now,
    });
  }

  async function deleteSubmission(id) {
    if (!firestoreReady()) throw new Error("Chưa kết nối được Firestore.");
    const user = currentAuthUser();
    if (!user) throw new Error("Bạn cần đăng nhập để xóa bài.");

    const docRef = resolveDb().collection(CONFIG.firestoreCollection).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return; // đã bị xóa từ trước, coi như thành công
    if (snap.data().studentUid !== user.uid) throw new Error("Bạn chỉ được xóa bài nộp của chính mình.");

    await docRef.delete();
  }

  // Danh sách bài nộp CỦA CHÍNH học viên đang đăng nhập — nghe realtime độc
  // lập với essay-grader.js (cùng 1 query, nhưng cache riêng của module này)
  // để có sẵn dữ liệu đầy đủ (studentEssay, editHistory...) mà không cần gọi
  // .get() thêm mỗi lần người dùng bấm "Sửa".
  let myItemsCache = new Map();
  let myItemsUnsub = null;
  const onItemsChangeCallbacks = [];

  function startMyItemsListener() {
    if (myItemsUnsub) return;
    if (!firestoreReady()) return;
    const user = currentAuthUser();
    if (!user) return;
    myItemsUnsub = resolveDb().collection(CONFIG.firestoreCollection)
      .where("studentUid", "==", user.uid)
      .onSnapshot(
        (snap) => {
          myItemsCache = new Map();
          snap.docs.forEach((d) => myItemsCache.set(d.id, { id: d.id, ...d.data() }));
          onItemsChangeCallbacks.forEach((cb) => { try { cb(); } catch (e) { /* bỏ qua */ } });
        },
        (err) => console.error("[essay-grader-edit-delete] Không nghe được danh sách bài nộp:", err)
      );
  }

  // ==========================================================================
  // 2. CSS RIÊNG CHO CÁC THÀNH PHẦN MỚI (dùng lại biến màu --eg-* đã có sẵn
  //    từ essay-grader.js vì các phần tử mới đều được chèn NẰM BÊN TRONG
  //    #essay-grader-widget, nên vẫn thừa hưởng đúng bộ biến CSS đó)
  // ==========================================================================
  function injectStyle() {
    if (document.getElementById("egx-style")) return;
    const style = document.createElement("style");
    style.id = "egx-style";
    style.textContent = `
    #essay-grader-widget .egx-actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
    #essay-grader-widget .egx-btn {
      display:inline-flex; align-items:center; gap:6px; border:1.5px solid var(--eg-card-border);
      background: transparent; border-radius: var(--eg-radius-sm); padding:7px 12px;
      font-size:12px; font-weight:700; cursor:pointer; transition:.15s; color: var(--eg-text);
    }
    #essay-grader-widget .egx-btn:hover { transform: translateY(-1px); }
    #essay-grader-widget .egx-btn-edit { color: var(--eg-accent); border-color: rgba(20,120,212,.35); }
    #essay-grader-widget .egx-btn-edit:hover { background: rgba(20,120,212,.08); }
    #essay-grader-widget .egx-btn-delete { color: var(--eg-danger); border-color: rgba(239,68,68,.35); }
    #essay-grader-widget .egx-btn-delete:hover { background: rgba(239,68,68,.08); }
    #essay-grader-widget .egx-btn-history { color: var(--eg-text-muted); }
    #essay-grader-widget .egx-btn-history:hover { background: rgba(92,117,144,.1); }
    #essay-grader-widget .egx-btn:disabled { opacity:.5; cursor:not-allowed; transform:none; }
    #essay-grader-widget .egx-badge {
      display:inline-block; margin-left:8px; font-size:10.5px; font-weight:700;
      color: var(--eg-warning); background: rgba(245,158,11,.12); border-radius:20px; padding:2px 8px;
    }
    #essay-grader-widget .egx-overlay {
      position:fixed; inset:0; background: rgba(11,31,51,.55); z-index:999999;
      display:flex; align-items:center; justify-content:center; padding:20px;
    }
    #essay-grader-widget .egx-modal {
      background: var(--eg-card-bg); border-radius: var(--eg-radius-md); box-shadow: var(--eg-shadow);
      width:100%; max-width:640px; max-height:88vh; overflow-y:auto; padding:22px; color: var(--eg-text);
    }
    #essay-grader-widget .egx-modal h3 { margin:0 0 4px; font-size:16px; font-weight:800; display:flex; align-items:center; gap:8px; }
    #essay-grader-widget .egx-modal .egx-sub { font-size:12px; color: var(--eg-text-muted); margin:0 0 16px; }
    #essay-grader-widget .egx-field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
    #essay-grader-widget .egx-field label { font-size:11.5px; font-weight:700; color: var(--eg-text-muted); text-transform:uppercase; letter-spacing:.4px; }
    #essay-grader-widget .egx-field input, #essay-grader-widget .egx-field textarea {
      border:1.5px solid var(--eg-card-border); border-radius: var(--eg-radius-sm); padding:9px 12px;
      font-size:13px; font-family:inherit; color: var(--eg-text); background:transparent; width:100%;
    }
    #essay-grader-widget .egx-field textarea { resize:vertical; min-height:160px; line-height:1.6; }
    #essay-grader-widget .egx-field input:focus, #essay-grader-widget .egx-field textarea:focus {
      outline:none; border-color: var(--eg-accent); box-shadow: 0 0 0 3px rgba(20,120,212,.15);
    }
    #essay-grader-widget .egx-modal-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:6px; }
    #essay-grader-widget .egx-modal-footer .egx-btn { padding:10px 18px; font-size:13px; }
    #essay-grader-widget .egx-btn-primary { background: linear-gradient(135deg, var(--eg-accent), var(--eg-accent-2)); color:#fff; border:none; }
    #essay-grader-widget .egx-btn-danger-solid { background: linear-gradient(135deg, var(--eg-danger), #b91c1c); color:#fff; border:none; }
    #essay-grader-widget .egx-btn-plain { background: rgba(92,117,144,.1); color: var(--eg-text); border:none; }
    #essay-grader-widget .egx-error { margin-top:10px; font-size:12px; color: var(--eg-danger); display:none; }
    #essay-grader-widget .egx-error.egx-active { display:block; }
    #essay-grader-widget .egx-warn-banner {
      font-size:12px; background: rgba(245,158,11,.1); color:#92620a; border:1px solid rgba(245,158,11,.3);
      border-radius: var(--eg-radius-sm); padding:8px 12px; margin-bottom:14px;
    }
    #essay-grader-widget .egx-history-item {
      border:1px solid var(--eg-card-border); border-radius: var(--eg-radius-sm); padding:12px; margin-bottom:10px;
    }
    #essay-grader-widget .egx-history-item:last-child { margin-bottom:0; }
    #essay-grader-widget .egx-history-meta { font-size:11.5px; color: var(--eg-text-muted); margin-bottom:6px; }
    #essay-grader-widget .egx-history-content {
      font-size:12.5px; white-space:pre-wrap; max-height:140px; overflow-y:auto;
      background: rgba(20,120,212,.04); border-radius:8px; padding:8px 10px;
    }
    #essay-grader-widget .egx-empty { font-size:12.5px; color: var(--eg-text-muted); text-align:center; padding:20px 0; }
    `;
    document.head.appendChild(style);
  }

  // ==========================================================================
  // 3. MODAL (dùng chung cho Sửa bài / Xem lịch sử / Xác nhận xóa)
  // ==========================================================================
  function openModal(wrapper, innerHTML) {
    closeModal(wrapper);
    const overlay = document.createElement("div");
    overlay.className = "egx-overlay";
    overlay.id = "egx-overlay";
    overlay.innerHTML = `<div class="egx-modal">${innerHTML}</div>`;
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeModal(wrapper);
    });
    wrapper.appendChild(overlay);
    return overlay;
  }

  function closeModal(wrapper) {
    const existing = wrapper.querySelector("#egx-overlay");
    if (existing) existing.remove();
  }

  function showToastNear(el, text) {
    // Thông báo nhỏ, tự ẩn — chèn tạm trên đầu danh sách bài nộp.
    const toast = document.createElement("div");
    toast.className = "egx-warn-banner";
    toast.style.cssText = "background:rgba(22,199,132,.12);color:#0a8a5a;border-color:rgba(22,199,132,.3);";
    toast.textContent = text;
    el.prepend(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ==========================================================================
  // 4. GIAO DIỆN: SỬA BÀI
  // ==========================================================================
  function openEditModal(wrapper, listEl, id) {
    const item = myItemsCache.get(id);
    if (!item) { alert("Không tìm thấy dữ liệu bài nộp này. Hãy tải lại trang rồi thử lại."); return; }

    const essay = item.studentEssay || {};
    const overlay = openModal(wrapper, `
      <h3><i class="fa-solid fa-pen"></i> Sửa bài nộp</h3>
      <p class="egx-sub">Bạn có thể sửa lại nội dung bài làm đã nộp. Bản cũ sẽ được lưu vào "Lịch sử sửa đổi", không bị mất.</p>
      ${item.status === "reviewed" ? `<div class="egx-warn-banner"><i class="fa-solid fa-triangle-exclamation"></i> Giáo viên đã chấm bài này. Sửa lại sẽ không tự động gửi thông báo lại cho giáo viên.</div>` : ""}
      <div class="egx-field">
        <label>Tên file bài làm</label>
        <input type="text" id="egx-edit-name" value="${escapeHtml(essay.name || "")}" placeholder="VD: bailam.docx" />
      </div>
      <div class="egx-field">
        <label>Nội dung bài làm</label>
        <textarea id="egx-edit-content" placeholder="Nội dung bài làm...">${escapeHtml(essay.content || "")}</textarea>
      </div>
      <div class="egx-field">
        <label>Ghi chú lý do sửa (tuỳ chọn)</label>
        <input type="text" id="egx-edit-note" placeholder="VD: sửa lại đoạn kết luận cho rõ ý hơn" />
      </div>
      <div class="egx-error" id="egx-edit-error"></div>
      <div class="egx-modal-footer">
        <button type="button" class="egx-btn egx-btn-plain" id="egx-edit-cancel">Hủy</button>
        <button type="button" class="egx-btn egx-btn-primary" id="egx-edit-save"><i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi</button>
      </div>
    `);

    overlay.querySelector("#egx-edit-cancel").addEventListener("click", () => closeModal(wrapper));
    overlay.querySelector("#egx-edit-save").addEventListener("click", async () => {
      const saveBtn = overlay.querySelector("#egx-edit-save");
      const errorEl = overlay.querySelector("#egx-edit-error");
      errorEl.classList.remove("egx-active");

      const newName = overlay.querySelector("#egx-edit-name").value.trim();
      const newContent = overlay.querySelector("#egx-edit-content").value;
      const note = overlay.querySelector("#egx-edit-note").value;

      if (!newContent.trim()) {
        errorEl.textContent = "Nội dung bài làm không được để trống.";
        errorEl.classList.add("egx-active");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;
      try {
        await updateSubmissionWithHistory(id, { name: newName || essay.name || "Bài làm", content: newContent }, note);
        closeModal(wrapper);
        showToastNear(listEl, "Đã lưu thay đổi. Bản cũ đã được lưu vào lịch sử sửa đổi.");
      } catch (err) {
        errorEl.textContent = err && err.message ? err.message : String(err);
        errorEl.classList.add("egx-active");
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi`;
      }
    });
  }

  // ==========================================================================
  // 5. GIAO DIỆN: LỊCH SỬ SỬA ĐỔI
  // ==========================================================================
  function openHistoryModal(wrapper, id) {
    const item = myItemsCache.get(id);
    if (!item) { alert("Không tìm thấy dữ liệu bài nộp này. Hãy tải lại trang rồi thử lại."); return; }

    const history = Array.isArray(item.editHistory) ? item.editHistory.slice().reverse() : [];
    const bodyHTML = history.length
      ? history.map((h, idx) => `
        <div class="egx-history-item">
          <div class="egx-history-meta">
            <strong>Phiên bản trước lần sửa thứ ${history.length - idx}</strong> — sửa lúc ${formatDate(h.editedAt)} bởi ${escapeHtml(h.editedByName || "Học viên")}
            ${h.note ? `<br/>Ghi chú: ${escapeHtml(h.note)}` : ""}
          </div>
          <div class="egx-history-meta" style="margin-bottom:4px;">${escapeHtml(h.previousStudentEssay?.name || "Bài làm")}</div>
          <div class="egx-history-content">${escapeHtml(truncate(h.previousStudentEssay?.content || "(trống)", 2000))}</div>
        </div>
      `).join("")
      : `<div class="egx-empty">Bài nộp này chưa từng được sửa lần nào.</div>`;

    const overlay = openModal(wrapper, `
      <h3><i class="fa-solid fa-clock-rotate-left"></i> Lịch sử sửa đổi</h3>
      <p class="egx-sub">Toàn bộ các phiên bản CŨ của bài làm này (mới nhất ở trên).</p>
      ${bodyHTML}
      <div class="egx-modal-footer">
        <button type="button" class="egx-btn egx-btn-plain" id="egx-history-close">Đóng</button>
      </div>
    `);
    overlay.querySelector("#egx-history-close").addEventListener("click", () => closeModal(wrapper));
  }

  // ==========================================================================
  // 6. GIAO DIỆN: XÁC NHẬN XÓA
  // ==========================================================================
  function openDeleteConfirm(wrapper, listEl, id) {
    const item = myItemsCache.get(id);
    const title = item ? (item.studentEssay?.name || "Bài làm") : "bài nộp này";

    const overlay = openModal(wrapper, `
      <h3><i class="fa-solid fa-trash"></i> Xóa bài nộp?</h3>
      <p class="egx-sub">Bạn sắp xóa vĩnh viễn bài nộp "${escapeHtml(title)}" — bao gồm toàn bộ tài liệu đã upload, kết quả AI đã chấm và nhận xét của giáo viên (nếu có). Hành động này KHÔNG thể hoàn tác.</p>
      <div class="egx-error" id="egx-delete-error"></div>
      <div class="egx-modal-footer">
        <button type="button" class="egx-btn egx-btn-plain" id="egx-delete-cancel">Hủy</button>
        <button type="button" class="egx-btn egx-btn-danger-solid" id="egx-delete-confirm"><i class="fa-solid fa-trash"></i> Xóa vĩnh viễn</button>
      </div>
    `);
    overlay.querySelector("#egx-delete-cancel").addEventListener("click", () => closeModal(wrapper));
    overlay.querySelector("#egx-delete-confirm").addEventListener("click", async () => {
      const btn = overlay.querySelector("#egx-delete-confirm");
      const errorEl = overlay.querySelector("#egx-delete-error");
      errorEl.classList.remove("egx-active");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang xóa...`;
      try {
        await deleteSubmission(id);
        closeModal(wrapper);
        showToastNear(listEl, "Đã xóa bài nộp.");
      } catch (err) {
        errorEl.textContent = err && err.message ? err.message : String(err);
        errorEl.classList.add("egx-active");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-trash"></i> Xóa vĩnh viễn`;
      }
    });
  }

  // ==========================================================================
  // 7. GẮN NÚT "SỬA / XÓA / LỊCH SỬ" VÀO DOM ĐÃ ĐƯỢC essay-grader.js DỰNG SẴN
  // ==========================================================================
  function buildActionsHTML(item) {
    const editCount = Number(item.editCount) || 0;
    return `
      <div class="egx-actions" data-egx-actions>
        <button type="button" class="egx-btn egx-btn-edit" data-egx-edit="${item.id}"><i class="fa-solid fa-pen"></i> Sửa bài</button>
        <button type="button" class="egx-btn egx-btn-delete" data-egx-delete="${item.id}"><i class="fa-solid fa-trash"></i> Xóa bài</button>
        ${editCount > 0 ? `<button type="button" class="egx-btn egx-btn-history" data-egx-history="${item.id}"><i class="fa-solid fa-clock-rotate-left"></i> Lịch sử sửa đổi</button>
        <span class="egx-badge">Đã sửa ${editCount} lần</span>` : ""}
      </div>`;
    }

  function enhanceListCards(wrapper, listEl) {
    listEl.querySelectorAll(".eg-submission-card").forEach((card) => {
      const id = card.dataset.id;
      const item = myItemsCache.get(id);
      if (!item) return; // dữ liệu của module này chưa kịp tải — sẽ tự chèn ở lần snapshot kế tiếp
      let actions = card.querySelector("[data-egx-actions]");
      const html = buildActionsHTML(item);
      if (!actions) {
        card.insertAdjacentHTML("beforeend", html);
      } else {
        // Cập nhật lại (vd sau khi sửa xong, số lần sửa thay đổi) mà không tạo trùng nút
        actions.outerHTML = html;
      }
    });
  }

  // Thanh hành động chèn vào trang CHI TIẾT 1 bài nộp (sau khi bấm mở từ danh sách)
  function enhanceDetailView(wrapper, detailEl, lastOpenedIdRef) {
    if (detailEl.querySelector("[data-egx-detail-actions]")) return;
    const id = lastOpenedIdRef.id;
    if (!id) return;
    const item = myItemsCache.get(id);
    if (!item) return;
    const backBtn = detailEl.querySelector(".eg-back-btn");
    const bar = document.createElement("div");
    bar.setAttribute("data-egx-detail-actions", "1");
    bar.innerHTML = buildActionsHTML(item);
    bar.style.marginBottom = "14px";
    if (backBtn && backBtn.nextSibling) backBtn.parentNode.insertBefore(bar, backBtn.nextSibling);
    else detailEl.prepend(bar);
  }

  function wireActionClicks(wrapper, containerEl, listElForToast) {
    containerEl.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-egx-edit]");
      const delBtn = e.target.closest("[data-egx-delete]");
      const histBtn = e.target.closest("[data-egx-history]");
      if (!editBtn && !delBtn && !histBtn) return;
      e.preventDefault();
      e.stopPropagation();
      if (editBtn) openEditModal(wrapper, listElForToast, editBtn.dataset.egxEdit);
      else if (delBtn) openDeleteConfirm(wrapper, listElForToast, delBtn.dataset.egxDelete);
      else if (histBtn) openHistoryModal(wrapper, histBtn.dataset.egxHistory);
    }, true); // capture=true: chặn trước khi listener gốc (mở trang chi tiết) của essay-grader.js kịp chạy
  }

  // ==========================================================================
  // 8. KHỞI ĐỘNG: chờ essay-grader.js dựng xong DOM rồi mới gắn thêm
  // ==========================================================================
  function waitForWidget(cb) {
    const existing = document.getElementById("essay-grader-widget");
    if (existing) { cb(existing); return; }
    const mo = new MutationObserver(() => {
      const el = document.getElementById("essay-grader-widget");
      if (el) { mo.disconnect(); cb(el); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function init(wrapper) {
    injectStyle();

    const mineListEl = wrapper.querySelector("#eg-mine-list");
    const mineDetailEl = wrapper.querySelector("#eg-mine-detail");
    if (!mineListEl || !mineDetailEl) return; // cấu trúc HTML không như mong đợi — không gắn gì cả để an toàn

    const lastOpenedIdRef = { id: null };

    // Ghi nhớ id bài nộp vừa được mở xem chi tiết (để gắn thanh hành động
    // đúng bài trong #eg-mine-detail sau khi essay-grader.js render xong).
    mineListEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-egx-edit],[data-egx-delete],[data-egx-history]")) return;
      const card = e.target.closest(".eg-submission-card");
      if (card) lastOpenedIdRef.id = card.dataset.id;
    });

    wireActionClicks(wrapper, mineListEl, mineListEl);
    wireActionClicks(wrapper, mineDetailEl, mineListEl);

    // essay-grader.js render lại TOÀN BỘ innerHTML của #eg-mine-list /
    // #eg-mine-detail mỗi khi có dữ liệu mới (onSnapshot) hoặc khi người
    // dùng mở/đóng 1 bài — dùng MutationObserver để tự chèn lại nút mỗi lần.
    const listObserver = new MutationObserver(() => enhanceListCards(wrapper, mineListEl));
    listObserver.observe(mineListEl, { childList: true });

    const detailObserver = new MutationObserver(() => enhanceDetailView(wrapper, mineDetailEl, lastOpenedIdRef));
    detailObserver.observe(mineDetailEl, { childList: true });

    onItemsChangeCallbacks.push(() => {
      enhanceListCards(wrapper, mineListEl);
      enhanceDetailView(wrapper, mineDetailEl, lastOpenedIdRef);
    });

    // Đăng nhập có thể hoàn tất SAU khi widget đã mount xong, nên cần thử lại
    // định kỳ trong ~30s cho tới khi bắt được user (giống cách essay-grader.js
    // tự poll quyền Admin).
    let tries = 0;
    startMyItemsListener();
    const timer = setInterval(() => {
      tries++;
      if (!myItemsUnsub) startMyItemsListener();
      if (myItemsUnsub || tries > 100) clearInterval(timer);
    }, 300);
  }

  waitForWidget(init);
})(typeof window !== "undefined" ? window : globalThis, document);
