/* ============================================================================
   tailieu.js — "Ngân hàng đề cương & tài liệu học tập"
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng vào cuối <body> của index.html (sau course.js, signin.js):
       <script src="tailieu.js"></script>

   Module tự chèn nút Sidebar "Tài liệu" + view mới, tự "wrap" UIManager.navigate
   và CloudSync.teardown (cùng kỹ thuật với course.js / schedule.js) — KHÔNG sửa
   bất kỳ file nào khác.

   TÍNH NĂNG
   1) Admin upload PDF / DOCX / XLSX / PPTX (nhiều file một lúc). File được mã hoá
      base64 và chia "chunk" lưu trong Firestore (giống Đề PDF) — không cần Storage.
   2) Phân loại: Môn học → Chương → Chuyên đề (có lọc theo từng cấp + lọc loại file).
   3) Xem trực tiếp: PDF (trình xem của trình duyệt), DOCX (chuyển sang HTML),
      XLSX (từng trang tính), PPTX (hiển thị nội dung chữ theo từng slide).
   4) Tìm kiếm theo tên/môn/chương/chuyên đề/mô tả và (tuỳ chọn) theo NỘI DUNG —
      nội dung được trích xuất lúc upload (PDF scan ảnh không có chữ sẽ không tìm được).
   5) Bookmark tài liệu (đồng bộ theo tài khoản).
   6) Lịch sử đọc: số lần mở, tổng thời gian đọc, lần đọc gần nhất.
   7) Liên kết tài liệu với bài giảng video (module Khóa học) và câu hỏi trong ngân hàng.
   8) Phân quyền theo NHÓM học viên: Admin tạo nhóm (danh sách email), mỗi tài liệu
      chọn "Công khai" hoặc "Chỉ các nhóm được chọn". Quyền được ghi sẵn vào tài liệu
      (allowedEmails) nên Firestore Rules chặn được ở phía máy chủ.

   ‼️ CẦN THÊM FIRESTORE SECURITY RULES (Firebase Console > Firestore > Rules):

   function tlAdmin() {
     return request.auth != null &&
       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
   }
   function tlCanRead(docId) {
     let d = get(/databases/$(database)/documents/studyDocs/$(docId)).data;
     return request.auth != null && (d.visibility == 'all' || tlAdmin() ||
       request.auth.token.email.lower() in d.allowedEmails);
   }
   match /studyDocs/{docId} {
     allow read: if request.auth != null && (resource.data.visibility == 'all' || tlAdmin() ||
       request.auth.token.email.lower() in resource.data.allowedEmails);
     allow write: if tlAdmin();
     match /chunks/{chunkId} { allow read: if tlCanRead(docId); allow write: if tlAdmin(); }
   }
   match /studyDocTexts/{docId} { allow read: if tlCanRead(docId); allow write: if tlAdmin(); }
   match /studyGroups/{gid} {
     allow read: if tlAdmin() || (request.auth != null && request.auth.token.email.lower() in resource.data.members);
     allow write: if tlAdmin();
   }
   match /users/{uid}/studyBookmarks/{id} { allow read, write: if request.auth != null && request.auth.uid == uid; }
   match /users/{uid}/studyHistory/{id}   { allow read, write: if request.auth != null && request.auth.uid == uid; }
   (collectionGroup/users rules sẵn có của bạn giữ nguyên.)
   ========================================================================== */
(function () {
  'use strict';
  if (window.TaiLieu) return;

  /* ============================ 0) HẰNG SỐ ============================ */
  var COL = { DOCS: 'studyDocs', TEXTS: 'studyDocTexts', GROUPS: 'studyGroups', BM: 'studyBookmarks', HIS: 'studyHistory' };
  var MAX_BYTES = 20 * 1024 * 1024;   // ~20MB / file
  var CHUNK = 640 * 1024;             // ~640KB gốc / chunk (base64 hoá < 1MB/document)
  var MAX_TEXT = 200000;              // tối đa ký tự nội dung lưu để tìm kiếm
  var TYPES = {
    pdf: { icon: 'fa-file-pdf', color: '#ef4444', label: 'PDF', mime: 'application/pdf' },
    docx: { icon: 'fa-file-word', color: '#1478d4', label: 'DOCX', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    xlsx: { icon: 'fa-file-excel', color: '#16c784', label: 'XLSX', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    pptx: { icon: 'fa-file-powerpoint', color: '#f59e0b', label: 'PPTX', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
  };
  var LIBS = {
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };

  /* ============================ 1) TIỆN ÍCH / ENV ============================ */
  // Các biến const của index.html (fbDb, UIManager...) KHÔNG nằm trên window → đọc bằng typeof.
  var Env = {
    db: function () { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; },
    auth: function () { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; },
    ui: function () { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; },
    am: function () { try { if (typeof AuthManager !== 'undefined' && AuthManager) return AuthManager; } catch (e) { } return window.AuthManager || null; },
    qm: function () { try { if (typeof QuestionManager !== 'undefined' && QuestionManager) return QuestionManager; } catch (e) { } return null; },
    quiz: function () { try { if (typeof QuizManager !== 'undefined' && QuizManager) return QuizManager; } catch (e) { } return null; },
    isAdmin: function () { var a = this.am(); try { return !!(a && typeof a.isAdmin === 'function' && a.isAdmin()); } catch (e) { return false; } },
    user: function () { var a = this.auth(); return (a && a.currentUser) || null; },
    email: function () { var u = this.user(); return u ? String(u.email || '').toLowerCase() : ''; }
  };
  var FV = function () { return firebase.firestore.FieldValue; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); };
  var debounce = function (fn, w) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, w); }; };
  var fmtSize = function (b) { b = b || 0; return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; };
  var fmtDate = function (iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('vi-VN'); };
  var fmtDur = function (s) { s = s || 0; if (s < 60) return s + ' giây'; var m = Math.floor(s / 60); return m < 60 ? m + ' phút' : Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút'; };
  var extOf = function (n) { var p = String(n || '').split('.'); return p.length > 1 ? p.pop().toLowerCase() : ''; };
  var typeOf = function (n) { var e = extOf(n); return e === 'xls' ? 'xlsx' : TYPES[e] ? e : null; };
  function toast(type, title, msg) { var u = Env.ui(); if (u && u.toast) u.toast(type, title, msg || ''); else console.log('[TaiLieu]', title, msg || ''); }
  function confirmBox(title, msg, ok) { var u = Env.ui(); if (u && u.confirm) u.confirm(title, msg, ok); else if (confirm(title + '\n' + msg)) ok(); }

  var libCache = {};
  function loadScript(url) {
    if (libCache[url]) return libCache[url];
    libCache[url] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = url;
      s.onload = function () { res(); };
      s.onerror = function () { delete libCache[url]; rej(new Error('Không tải được thư viện cần thiết (kiểm tra kết nối mạng)')); };
      document.head.appendChild(s);
    });
    return libCache[url];
  }
  function ensurePdf() { return window.pdfjsLib ? Promise.resolve() : loadScript(LIBS.pdf).then(function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker; }); }
  function ensureMammoth() { return window.mammoth ? Promise.resolve() : loadScript(LIBS.mammoth); }
  function ensureZip() { return window.JSZip ? Promise.resolve() : loadScript(LIBS.jszip); }
  function ensureXlsx() { return window.XLSX ? Promise.resolve() : loadScript(LIBS.xlsx); }

  function readBuf(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Không đọc được file')); }; r.readAsArrayBuffer(blob); });
  }
  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = r.result || ''; var i = s.indexOf(','); res(i >= 0 ? s.slice(i + 1) : s); };
      r.onerror = function () { rej(new Error('Không đọc được file')); };
      r.readAsDataURL(blob);
    });
  }
  function b64ToBytes(b64) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

  /* ============================ 2) STATE ============================ */
  var S = {
    started: false, uid: null, docs: new Map(), docSrc: { a: new Map(), b: new Map() }, groups: [],
    bookmarks: new Map(), history: new Map(), tab: 'all', f: { subject: '', chapter: '', topic: '', type: '', q: '', content: false },
    texts: new Map(), lessons: null, reader: null, unsubs: [], blobCache: new Map()
  };
  var db = function () { return Env.db(); };

  /* ============================ 3) TRÍCH XUẤT NỘI DUNG (để tìm kiếm) ============================ */
  async function extractText(blob, type) {
    var out = '';
    if (type === 'pdf') {
      await ensurePdf();
      var pdf = await window.pdfjsLib.getDocument({ data: await readBuf(blob) }).promise;
      var n = Math.min(pdf.numPages, 400);
      for (var i = 1; i <= n && out.length < MAX_TEXT; i++) {
        var pg = await pdf.getPage(i), c = await pg.getTextContent();
        out += c.items.map(function (it) { return it.str; }).join(' ') + '\n';
      }
    } else if (type === 'docx') {
      await ensureMammoth();
      out = (await window.mammoth.extractRawText({ arrayBuffer: await readBuf(blob) })).value || '';
    } else if (type === 'xlsx') {
      await ensureXlsx();
      var wb = window.XLSX.read(new Uint8Array(await readBuf(blob)), { type: 'array' });
      wb.SheetNames.forEach(function (nm) { if (out.length < MAX_TEXT) out += nm + '\n' + window.XLSX.utils.sheet_to_csv(wb.Sheets[nm]) + '\n'; });
    } else if (type === 'pptx') {
      out = (await pptxSlides(blob)).map(function (s) { return s.join(' '); }).join('\n');
    }
    return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  }
  async function pptxSlides(blob) {
    await ensureZip();
    var zip = await window.JSZip.loadAsync(await readBuf(blob));
    var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10); });
    var slides = [];
    for (var i = 0; i < names.length; i++) {
      var xml = await zip.files[names[i]].async('string'), paras = [];
      (xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || []).forEach(function (p) {
        var t = (p.match(/<a:t[^>]*>[\s\S]*?<\/a:t>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); }).join('');
        t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
        if (t) paras.push(t);
      });
      slides.push(paras);
    }
    return slides;
  }

  /* ============================ 4) DỮ LIỆU: LISTENERS ============================ */
  function rebuildDocs() {
    var m = new Map(); S.docSrc.a.forEach(function (v, k) { m.set(k, v); }); S.docSrc.b.forEach(function (v, k) { m.set(k, v); });
    S.docs = m; scheduleRender();
  }
  function onErr(tag) {
    return function (err) {
      console.error('[TaiLieu] ' + tag, err);
      if (err && err.code === 'permission-denied') {
        var r = $('#tdRoot'); if (r && !$('#tdPermBanner')) r.insertAdjacentHTML('afterbegin', '<div id="tdPermBanner" class="td-banner"><b><i class="fa-solid fa-triangle-exclamation"></i> Firestore từ chối quyền truy cập.</b> Hãy thêm Rules cho studyDocs / studyDocTexts / studyGroups / users/{uid}/studyBookmarks / studyHistory (xem phần ghi chú đầu file tailieu.js) rồi tải lại trang.</div>');
      }
    };
  }
  function docFrom(d) { return Object.assign({ id: d.id }, d.data()); }

  function start() {
    if (S.started) return;
    var u = Env.user(); if (!u || !db()) return;
    S.started = true; S.uid = u.uid;
    var mail = Env.email(), D = db();
    if (Env.isAdmin()) {
      S.unsubs.push(D.collection(COL.DOCS).onSnapshot(function (s) { S.docSrc.a = new Map(s.docs.map(function (d) { return [d.id, docFrom(d)]; })); rebuildDocs(); }, onErr('docs')));
      S.unsubs.push(D.collection(COL.GROUPS).onSnapshot(function (s) { S.groups = s.docs.map(docFrom); scheduleRender(); }, onErr('groups')));
    } else {
      S.unsubs.push(D.collection(COL.DOCS).where('visibility', '==', 'all').onSnapshot(function (s) { S.docSrc.a = new Map(s.docs.map(function (d) { return [d.id, docFrom(d)]; })); rebuildDocs(); }, onErr('docs-public')));
      S.unsubs.push(D.collection(COL.DOCS).where('allowedEmails', 'array-contains', mail).onSnapshot(function (s) { S.docSrc.b = new Map(s.docs.map(function (d) { return [d.id, docFrom(d)]; })); rebuildDocs(); }, onErr('docs-groups')));
    }
    S.unsubs.push(D.collection('users').doc(u.uid).collection(COL.BM).onSnapshot(function (s) { S.bookmarks = new Map(s.docs.map(function (d) { return [d.id, d.data()]; })); scheduleRender(); }, onErr('bookmarks')));
    S.unsubs.push(D.collection('users').doc(u.uid).collection(COL.HIS).onSnapshot(function (s) { S.history = new Map(s.docs.map(function (d) { return [d.id, d.data()]; })); scheduleRender(); }, onErr('history')));
  }
  function stop() {
    leaveReader(true);
    S.unsubs.forEach(function (f) { try { f(); } catch (e) { } });
    S.unsubs = []; S.started = false; S.docs = new Map(); S.docSrc = { a: new Map(), b: new Map() }; S.groups = [];
    S.bookmarks = new Map(); S.history = new Map(); S.texts = new Map(); S.blobCache = new Map(); S.lessons = null;
  }

  /* ============================ 5) FIRESTORE: GHI DỮ LIỆU ============================ */
  function allowedFor(groupIds) {
    var set = {}; (groupIds || []).forEach(function (gid) {
      var g = S.groups.filter(function (x) { return x.id === gid; })[0];
      if (g) (g.members || []).forEach(function (m) { set[m] = 1; });
    });
    return Object.keys(set);
  }
  function requireAdmin() { if (!Env.isAdmin()) throw new Error('Chỉ Admin mới thực hiện được thao tác này'); }

  async function uploadOne(file, meta, progress) {
    requireAdmin();
    var type = typeOf(file.name);
    if (!type) throw new Error('"' + file.name + '": chỉ hỗ trợ PDF, DOCX, XLSX, PPTX');
    if (file.size > MAX_BYTES) throw new Error('"' + file.name + '" quá lớn (' + fmtSize(file.size) + '). Tối đa ' + fmtSize(MAX_BYTES) + ' vì không dùng Firebase Storage.');
    var ref = db().collection(COL.DOCS).doc();
    progress('Đang trích xuất nội dung: ' + file.name);
    var text = ''; try { text = await extractText(file, type); } catch (e) { console.warn('[TaiLieu] Không trích xuất được nội dung', e); }
    var n = Math.max(1, Math.ceil(file.size / CHUNK)), done = 0;
    try {
      for (var i = 0; i < n; i += 4) {
        var batch = [];
        for (var j = i; j < Math.min(n, i + 4); j++) {
          (function (idx) {
            batch.push(toB64(file.slice(idx * CHUNK, Math.min(file.size, (idx + 1) * CHUNK))).then(function (data) {
              return ref.collection('chunks').doc(String(idx)).set({ index: idx, data: data }).then(function () { done++; progress('Đang tải lên ' + file.name + ' (' + done + '/' + n + ')'); });
            }));
          })(j);
        }
        await Promise.all(batch);
      }
    } catch (err) {
      try { var sn = await ref.collection('chunks').get(); await Promise.all(sn.docs.map(function (d) { return d.ref.delete(); })); } catch (e) { }
      throw err;
    }
    var groupIds = meta.visibility === 'groups' ? meta.groupIds : [];
    await ref.set({
      title: meta.title || file.name.replace(/\.[^.]+$/, ''), fileName: file.name, type: type, size: file.size,
      subject: meta.subject, chapter: meta.chapter, topic: meta.topic, description: meta.description,
      visibility: meta.visibility, groupIds: groupIds, allowedEmails: allowedFor(groupIds),
      lessonIds: meta.lessonIds, questionIds: meta.questionIds, chunkCount: n, hasText: !!text,
      createdAt: new Date().toISOString(), createdByEmail: Env.email()
    });
    if (text) await db().collection(COL.TEXTS).doc(ref.id).set({ docId: ref.id, text: text });
    return ref.id;
  }
  async function updateMeta(id, meta) {
    requireAdmin();
    var groupIds = meta.visibility === 'groups' ? meta.groupIds : [];
    await db().collection(COL.DOCS).doc(id).update({
      title: meta.title, subject: meta.subject, chapter: meta.chapter, topic: meta.topic, description: meta.description,
      visibility: meta.visibility, groupIds: groupIds, allowedEmails: allowedFor(groupIds),
      lessonIds: meta.lessonIds, questionIds: meta.questionIds, updatedAt: new Date().toISOString()
    });
  }
  async function deleteDoc(d) {
    requireAdmin();
    var ref = db().collection(COL.DOCS).doc(d.id);
    try { var sn = await ref.collection('chunks').get(); await Promise.all(sn.docs.map(function (x) { return x.ref.delete(); })); } catch (e) { console.error(e); }
    try { await db().collection(COL.TEXTS).doc(d.id).delete(); } catch (e) { }
    await ref.delete();
    S.texts.delete(d.id); S.blobCache.delete(d.id);
  }
  // Khi thành viên nhóm thay đổi / nhóm bị xoá → cập nhật lại allowedEmails của mọi tài liệu dùng nhóm đó
  async function syncDocsForGroup(gid, removed) {
    var sn = await db().collection(COL.DOCS).where('groupIds', 'array-contains', gid).get();
    if (sn.empty) return;
    var b = db().batch();
    sn.docs.forEach(function (d) {
      var ids = (d.data().groupIds || []).filter(function (x) { return !(removed && x === gid); });
      var patch = { groupIds: ids, allowedEmails: allowedFor(ids) };
      if (!ids.length && d.data().visibility === 'groups') patch.visibility = 'groups'; // không nhóm nào → chỉ Admin thấy
      b.update(d.ref, patch);
    });
    await b.commit();
  }
  function toggleBookmark(id) {
    var ref = db().collection('users').doc(S.uid).collection(COL.BM).doc(id);
    var p = S.bookmarks.has(id) ? ref.delete() : ref.set({ docId: id, createdAt: new Date().toISOString() });
    return p.catch(function (e) { toast('error', 'Không lưu được bookmark', e.message); });
  }

  /* ============================ 6) CSS ============================ */
  function css() {
    if ($('#tdStyles')) return;
    var s = document.createElement('style'); s.id = 'tdStyles';
    s.textContent = [
      '#view-tailieu .td-banner{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:var(--danger);border-radius:12px;padding:12px 16px;font-size:13px;margin-bottom:14px;line-height:1.5}',
      '.td-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}',
      '.td-search{flex:1 1 260px;display:flex;align-items:center;gap:8px;background:var(--card-bg);border:1.5px solid var(--card-border);border-radius:12px;padding:9px 14px}',
      '.td-search input{border:0;background:transparent;outline:0;width:100%;font-size:13.5px;color:var(--text-main)}.td-search i{color:var(--text-muted)}',
      '.td-check{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--text-muted);cursor:pointer;white-space:nowrap}',
      '.td-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.td-tabs button{padding:8px 15px;border-radius:20px;border:1.5px solid var(--card-border);background:var(--card-bg);font-size:12.5px;font-weight:700;color:var(--text-muted)}',
      '.td-tabs button.on{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500));color:#fff;border-color:transparent}',
      '.td-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}',
      '.td-card{padding:16px;display:flex;flex-direction:column;gap:9px;cursor:pointer}',
      '.td-top{display:flex;gap:12px;align-items:flex-start}.td-ic{width:44px;height:50px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:21px;color:#fff;flex-shrink:0}',
      '.td-ttl{font-weight:800;font-size:14px;line-height:1.35;word-break:break-word}.td-path{font-size:11.5px;color:var(--text-muted);margin-top:3px}',
      '.td-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11.5px;color:var(--text-muted)}.td-meta span{display:inline-flex;gap:5px;align-items:center}',
      '.td-snip{font-size:12px;background:rgba(245,158,11,.12);border-radius:8px;padding:7px 10px;line-height:1.5;color:var(--text-main)}.td-snip mark{background:rgba(245,158,11,.45);color:inherit;border-radius:3px;padding:0 2px}',
      '.td-badge{padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:800}.td-b-pub{background:rgba(22,199,132,.15);color:var(--success-dark)}.td-b-grp{background:rgba(245,158,11,.16);color:var(--warning)}.td-b-lnk{background:rgba(20,120,212,.12);color:var(--accent)}',
      '.td-acts{display:flex;gap:6px;margin-top:auto;padding-top:9px;border-top:1px solid var(--card-border);flex-wrap:wrap}',
      '.td-bm{margin-left:auto;font-size:18px;color:var(--text-muted);width:32px;height:32px;border-radius:9px}.td-bm.on{color:var(--star)}.td-bm:hover{background:rgba(251,191,36,.15)}',
      '.td-reader{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}@media(max-width:980px){.td-reader{grid-template-columns:1fr}}',
      '.td-view{overflow:hidden;padding:0;min-height:420px}.td-view iframe{width:100%;height:76vh;min-height:420px;border:0;display:block;background:#fff}',
      '.td-loading{padding:60px 20px;text-align:center;color:var(--text-muted)}.td-loading i{font-size:26px;margin-bottom:10px;display:block}',
      '.td-side{padding:16px;display:flex;flex-direction:column;gap:14px}.td-side h5{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);font-weight:800;margin-bottom:7px}',
      '.td-link{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;background:rgba(20,120,212,.07);font-size:13px;font-weight:600;cursor:pointer;margin-bottom:6px;text-align:left;width:100%}.td-link:hover{background:rgba(20,120,212,.16)}.td-link i{color:var(--accent)}',
      '.td-sheets{display:flex;gap:6px;flex-wrap:wrap;padding:10px;border-bottom:1px solid var(--card-border)}.td-sheets button{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;background:rgba(20,120,212,.08);color:var(--text-muted)}.td-sheets button.on{background:var(--accent);color:#fff}',
      '.td-slides{padding:14px;max-height:76vh;overflow:auto;display:flex;flex-direction:column;gap:12px}.td-slide{border:1px solid var(--card-border);border-radius:12px;padding:14px 16px;background:var(--card-bg-solid)}.td-slide b{display:block;color:var(--accent);font-size:11.5px;margin-bottom:6px}.td-slide p{font-size:13.5px;line-height:1.6;margin-bottom:4px}',
      '.td-ov{position:fixed;inset:0;z-index:9000;background:rgba(3,19,36,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.td-modal{background:var(--card-bg-solid);color:var(--text-main);border:1px solid var(--card-border);border-radius:20px;box-shadow:var(--shadow-lg);width:100%;max-width:560px;max-height:90vh;overflow:auto;padding:24px}.td-modal.wide{max-width:700px}',
      '.td-modal h3{font-size:17px;font-weight:800;margin-bottom:14px;display:flex;gap:9px;align-items:center}.td-modal h3 i{color:var(--accent)}',
      '.td-f{margin-bottom:12px}.td-f label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:5px}',
      '.td-f input[type=text],.td-f textarea,.td-f select{width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.04);color:var(--text-main);font:inherit;font-size:13.5px}.td-f textarea{resize:vertical;min-height:60px}',
      '.td-row2{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}@media(max-width:560px){.td-row2{grid-template-columns:1fr}}',
      '.td-pick{max-height:170px;overflow:auto;border:1.5px solid var(--card-border);border-radius:10px;padding:6px}',
      '.td-pick label{display:flex;gap:8px;align-items:flex-start;padding:5px 6px;border-radius:7px;font-size:12.5px;color:var(--text-main);font-weight:500;margin:0;cursor:pointer}.td-pick label:hover{background:rgba(20,120,212,.08)}.td-pick .grp{font-size:11px;font-weight:800;color:var(--text-muted);padding:6px 6px 2px;text-transform:uppercase}',
      '.td-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
      '.td-q{border:1px solid var(--card-border);border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:13.5px}.td-q .o{padding:5px 9px;border-radius:8px;margin-top:5px;font-size:13px}.td-q .o.ok{background:rgba(22,199,132,.14);font-weight:700}',
      '.td-prog{font-size:12.5px;color:var(--text-muted);margin-top:10px;min-height:18px}',
      '.td-grow{flex:1}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ============================ 7) DOM: NAV + VIEW ============================ */
  function injectDom() {
    var anchor = $('.nav-item[data-view="parts"]') || $('.nav-item[data-view="quiz"]');
    if (!$('.nav-item[data-view="tailieu"]')) {
      var btn = document.createElement('button'); btn.className = 'nav-item'; btn.dataset.view = 'tailieu';
      btn.innerHTML = '<i class="fa-solid fa-book-bookmark"></i> Tài liệu';
      if (anchor) anchor.insertAdjacentElement('afterend', btn); else { var nav = $('.sidebar-nav'); if (nav) nav.appendChild(btn); }
      // UIManager.init() (chạy sau đăng nhập) sẽ tự gắn click cho nút này; chỉ gắn tay nếu app đã khởi tạo xong.
      if (window.__appInitialized) btn.addEventListener('click', function () { var u = Env.ui(); if (u) u.navigate('tailieu'); });
    }
    if (!$('#view-tailieu')) {
      var main = $('main.content'); if (!main) return;
      var sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-tailieu';
      sec.innerHTML = '<div id="tdRoot"></div>'; main.appendChild(sec);
    }
  }

  /* ============================ 8) RENDER DANH SÁCH ============================ */
  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      var v = $('#view-tailieu'); if (!v || !v.classList.contains('active')) return;
      if (S.reader) { refreshReaderSide(); return; }
      var a = document.activeElement;
      if (a && a.id === 'tdQ') { updateGrid(); return; }
      render();
    }, 120);
  }
  function render() { if (S.reader) return; renderList(); }

  function uniq(arr) { var o = {}; arr.forEach(function (x) { if (x) o[x] = 1; }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'vi', { numeric: true }); }); }
  function opts(list, cur, first) { return '<option value="">' + first + '</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }

  function renderList() {
    var root = $('#tdRoot'); if (!root) return;
    var admin = Env.isAdmin(), docs = Array.from(S.docs.values()), f = S.f;
    var subjects = uniq(docs.map(function (d) { return d.subject; }));
    var chapters = uniq(docs.filter(function (d) { return !f.subject || d.subject === f.subject; }).map(function (d) { return d.chapter; }));
    var topics = uniq(docs.filter(function (d) { return (!f.subject || d.subject === f.subject) && (!f.chapter || d.chapter === f.chapter); }).map(function (d) { return d.topic; }));
    var banner = $('#tdPermBanner') ? $('#tdPermBanner').outerHTML : '';
    root.innerHTML = banner +
      '<div class="section-head"><div><h2><i class="fa-solid fa-book-bookmark"></i> Tài liệu &amp; đề cương</h2><p>Ngân hàng tài liệu học tập theo môn học, chương và chuyên đề</p></div>' +
      (admin ? '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" data-act="groups"><i class="fa-solid fa-users-gear"></i> Nhóm học viên</button><button class="btn btn-primary btn-sm" data-act="upload"><i class="fa-solid fa-cloud-arrow-up"></i> Upload tài liệu</button></div>' : '') + '</div>' +
      '<div class="td-tabs">' + [['all', 'fa-folder-open', 'Tất cả'], ['saved', 'fa-bookmark', 'Đã lưu (' + S.bookmarks.size + ')'], ['history', 'fa-clock-rotate-left', 'Lịch sử đọc']].map(function (t) {
        return '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '"><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + '</button>';
      }).join('') + '</div>' +
      (S.tab === 'history' ? '<div id="tdGrid"></div>' :
        '<div class="td-toolbar"><div class="td-search"><i class="fa-solid fa-magnifying-glass"></i><input id="tdQ" type="text" placeholder="Tìm theo tên, môn, chương, chuyên đề..." value="' + esc(f.q) + '" autocomplete="off"></div>' +
        '<label class="td-check"><input type="checkbox" id="tdContent"' + (f.content ? ' checked' : '') + '> Tìm cả nội dung</label></div>' +
        '<div class="td-toolbar"><select class="select-box" id="tdSubj">' + opts(subjects, f.subject, 'Tất cả môn học') + '</select>' +
        '<select class="select-box" id="tdChap">' + opts(chapters, f.chapter, 'Tất cả chương') + '</select>' +
        '<select class="select-box" id="tdTopic">' + opts(topics, f.topic, 'Tất cả chuyên đề') + '</select>' +
        '<select class="select-box" id="tdType"><option value="">Mọi loại file</option>' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + TYPES[k].label + '</option>'; }).join('') + '</select>' +
        '<span class="td-grow"></span><span class="td-check" id="tdCount"></span></div><div id="tdGrid"></div>');
    updateGrid();
  }

  function haystack(d) { return norm([d.title, d.fileName, d.subject, d.chapter, d.topic, d.description].join(' ')); }
  function snippet(text, words) {
    var n = norm(text), best = -1;
    for (var i = 0; i < words.length; i++) { var p = n.indexOf(words[i]); if (p > -1 && (best < 0 || p < best)) best = p; }
    if (best < 0) return '';
    // norm() giữ nguyên độ dài (NFD+bỏ dấu có thể lệch) → lấy lân cận theo vị trí ước lượng
    var a = Math.max(0, best - 60), b = Math.min(text.length, best + 140), s = text.slice(a, b).replace(/\s+/g, ' ');
    var h = esc(s);
    words.forEach(function (w) { if (w.length > 1) { try { h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); } catch (e) { } } });
    return (a > 0 ? '…' : '') + h + (b < text.length ? '…' : '');
  }

  function filtered() {
    var f = S.f, words = norm(f.q).split(/\s+/).filter(Boolean), out = [];
    S.docs.forEach(function (d) {
      if (S.tab === 'saved' && !S.bookmarks.has(d.id)) return;
      if (f.subject && d.subject !== f.subject) return;
      if (f.chapter && d.chapter !== f.chapter) return;
      if (f.topic && d.topic !== f.topic) return;
      if (f.type && d.type !== f.type) return;
      var snip = '';
      if (words.length) {
        var h = haystack(d), metaOk = words.every(function (w) { return h.indexOf(w) > -1; }), txt = f.content ? S.texts.get(d.id) : null, txtOk = false;
        if (txt) { var nt = norm(txt); txtOk = words.every(function (w) { return nt.indexOf(w) > -1; }); if (txtOk) snip = snippet(txt, words); }
        if (!metaOk && !txtOk) return;
      }
      out.push({ d: d, snip: snip });
    });
    out.sort(function (a, b) { return String(b.d.createdAt || '').localeCompare(String(a.d.createdAt || '')); });
    return out;
  }

  function cardHtml(d, snip) {
    var t = TYPES[d.type] || TYPES.pdf, admin = Env.isAdmin(), bm = S.bookmarks.has(d.id), h = S.history.get(d.id);
    var path = [d.subject, d.chapter, d.topic].filter(Boolean).map(esc).join(' › ') || '<i>Chưa phân loại</i>';
    var links = (d.lessonIds || []).length + (d.questionIds || []).length;
    return '<div class="card td-card" data-open="' + d.id + '"><div class="td-top"><div class="td-ic" style="background:' + t.color + '"><i class="fa-solid ' + t.icon + '"></i></div>' +
      '<div style="min-width:0;flex:1"><div class="td-ttl">' + esc(d.title) + '</div><div class="td-path">' + path + '</div></div>' +
      '<button class="td-bm ' + (bm ? 'on' : '') + '" data-bm="' + d.id + '" title="' + (bm ? 'Bỏ bookmark' : 'Lưu bookmark') + '"><i class="fa-' + (bm ? 'solid' : 'regular') + ' fa-bookmark"></i></button></div>' +
      (d.description ? '<div class="td-path" style="font-size:12.5px">' + esc(String(d.description).slice(0, 110)) + (d.description.length > 110 ? '…' : '') + '</div>' : '') +
      (snip ? '<div class="td-snip">' + snip + '</div>' : '') +
      '<div class="td-meta"><span class="td-badge" style="background:' + t.color + '22;color:' + t.color + '">' + t.label + '</span><span><i class="fa-regular fa-hard-drive"></i> ' + fmtSize(d.size) + '</span><span><i class="fa-regular fa-calendar"></i> ' + fmtDate(d.createdAt) + '</span>' +
      (links ? '<span class="td-badge td-b-lnk"><i class="fa-solid fa-link"></i> ' + links + ' liên kết</span>' : '') +
      (admin ? (d.visibility === 'all' ? '<span class="td-badge td-b-pub"><i class="fa-solid fa-globe"></i> Công khai</span>' : '<span class="td-badge td-b-grp"><i class="fa-solid fa-lock"></i> ' + ((d.groupIds || []).length) + ' nhóm</span>') : '') +
      (h ? '<span><i class="fa-solid fa-eye"></i> Đã đọc ' + (h.count || 1) + ' lần</span>' : '') + '</div>' +
      (admin ? '<div class="td-acts"><button class="btn btn-outline btn-sm" data-edit="' + d.id + '"><i class="fa-solid fa-pen"></i> Sửa</button><button class="btn btn-ghost btn-sm" data-del="' + d.id + '"><i class="fa-solid fa-trash"></i> Xóa</button></div>' : '') + '</div>';
  }

  function updateGrid() {
    var grid = $('#tdGrid'); if (!grid) return;
    if (S.tab === 'history') { renderHistory(grid); return; }
    var list = filtered(), cnt = $('#tdCount'); if (cnt) cnt.textContent = list.length + ' tài liệu';
    var loading = S.f.content && S.f.q && S.docs.size && Array.from(S.docs.keys()).some(function (id) { return !S.texts.has(id); });
    grid.innerHTML = list.length ? '<div class="td-grid">' + list.map(function (x) { return cardHtml(x.d, x.snip); }).join('') + '</div>' + (loading ? '<div class="td-prog"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải nội dung tài liệu để tìm kiếm...</div>' : '') :
      '<div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>' + (S.docs.size ? 'Không có tài liệu nào phù hợp' : (Env.isAdmin() ? 'Chưa có tài liệu nào. Bấm "Upload tài liệu" để bắt đầu.' : 'Chưa có tài liệu nào dành cho bạn.')) + '</p></div>';
  }

  var ensureTexts = debounce(async function () {
    if (!S.f.content || !S.f.q) return;
    var ids = Array.from(S.docs.keys()).filter(function (id) { return !S.texts.has(id); });
    for (var i = 0; i < ids.length; i += 6) {
      await Promise.all(ids.slice(i, i + 6).map(function (id) {
        return db().collection(COL.TEXTS).doc(id).get().then(function (s) { S.texts.set(id, s.exists ? (s.data().text || '') : ''); }).catch(function () { S.texts.set(id, ''); });
      }));
      if ($('#tdGrid') && !S.reader && S.tab !== 'history') updateGrid();
    }
  }, 350);

  function renderHistory(grid) {
    var items = Array.from(S.history.entries()).map(function (e) { return { d: S.docs.get(e[0]), h: e[1] }; }).filter(function (x) { return x.d; })
      .sort(function (a, b) { return String(b.h.lastReadAt || '').localeCompare(String(a.h.lastReadAt || '')); });
    if (!items.length) { grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>Bạn chưa đọc tài liệu nào</p></div>'; return; }
    grid.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-outline btn-sm" data-act="clearhist"><i class="fa-solid fa-broom"></i> Xóa lịch sử đọc</button></div><div class="card table-wrap"><table class="data-table"><thead><tr><th>Tài liệu</th><th>Phân loại</th><th>Lần đọc gần nhất</th><th>Số lần</th><th>Tổng thời gian</th></tr></thead><tbody>' +
      items.map(function (x) {
        var t = TYPES[x.d.type] || TYPES.pdf, last = x.h.lastReadAt ? new Date(x.h.lastReadAt).toLocaleString('vi-VN') : '';
        return '<tr style="cursor:pointer" data-open="' + x.d.id + '"><td><i class="fa-solid ' + t.icon + '" style="color:' + t.color + '"></i> <b>' + esc(x.d.title) + '</b></td><td>' + (esc([x.d.subject, x.d.chapter].filter(Boolean).join(' › ')) || '—') + '</td><td>' + last + '</td><td>' + (x.h.count || 1) + '</td><td>' + fmtDur(x.h.totalSec) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ============================ 9) EVENTS (ủy quyền) ============================ */
  function wireRoot() {
    var root = $('#tdRoot'); if (!root || root.__wired) return; root.__wired = true;
    root.addEventListener('click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('[data-bm]'))) { e.stopPropagation(); toggleBookmark(el.dataset.bm); return; }
      if ((el = t.closest('[data-edit]'))) { e.stopPropagation(); openEdit(el.dataset.edit); return; }
      if ((el = t.closest('[data-del]'))) {
        e.stopPropagation(); var d = S.docs.get(el.dataset.del); if (!d) return;
        confirmBox('Xóa tài liệu?', '"' + d.title + '" sẽ bị xóa vĩnh viễn cho tất cả học viên.', function () { deleteDoc(d).then(function () { toast('success', 'Đã xóa', d.title); }).catch(function (er) { toast('error', 'Xóa thất bại', er.message); }); });
        return;
      }
      if ((el = t.closest('[data-tab]'))) { S.tab = el.dataset.tab; render(); return; }
      if ((el = t.closest('[data-act]'))) {
        var a = el.dataset.act;
        if (a === 'upload') openUpload();
        else if (a === 'groups') openGroups();
        else if (a === 'clearhist') confirmBox('Xóa lịch sử đọc?', 'Toàn bộ lịch sử đọc của bạn sẽ bị xóa.', function () {
          var b = db().batch(); S.history.forEach(function (v, id) { b.delete(db().collection('users').doc(S.uid).collection(COL.HIS).doc(id)); }); b.commit().catch(function (er) { toast('error', 'Lỗi', er.message); });
        });
        else if (a === 'back') leaveReader();
        else if (a === 'rbm') toggleBookmark(S.reader.id);
        return;
      }
      if ((el = t.closest('[data-open]'))) { openReader(el.dataset.open); return; }
    });
    root.addEventListener('input', function (e) {
      if (e.target.id === 'tdQ') { S.f.q = e.target.value; updateGrid(); ensureTexts(); }
    });
    root.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'tdContent') { S.f.content = e.target.checked; updateGrid(); ensureTexts(); }
      else if (id === 'tdSubj') { S.f.subject = e.target.value; S.f.chapter = ''; S.f.topic = ''; renderList(); }
      else if (id === 'tdChap') { S.f.chapter = e.target.value; S.f.topic = ''; renderList(); }
      else if (id === 'tdTopic') { S.f.topic = e.target.value; renderList(); }
      else if (id === 'tdType') { S.f.type = e.target.value; renderList(); }
    });
  }

  /* ============================ 10) MODAL CHUNG ============================ */
  function modal(html, wide) {
    var ov = document.createElement('div'); ov.className = 'td-ov';
    ov.innerHTML = '<div class="td-modal' + (wide ? ' wide' : '') + '">' + html + '</div>';
    document.body.appendChild(ov);
    var close = function () { document.removeEventListener('keydown', k); ov.remove(); };
    var k = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', k);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    return { el: ov, close: close };
  }

  /* ============================ 11) FORM METADATA (upload + sửa) ============================ */
  async function loadLessons() {
    if (S.lessons) return S.lessons;
    var out = { cats: {}, list: [] };
    try {
      var c = await db().collection('courseCategories').get(); c.docs.forEach(function (d) { out.cats[d.id] = d.data().name || ''; });
      var l = await db().collection('courseLessons').get();
      out.list = l.docs.map(function (d) { return { id: d.id, title: d.data().title || '(không tên)', cat: d.data().categoryId, order: d.data().order || 0 }; });
    } catch (e) { console.warn('[TaiLieu] Không tải được bài giảng', e); }
    S.lessons = out; return out;
  }
  function parseIds(str) {
    var set = {};
    String(str || '').split(/[,;\s]+/).forEach(function (p) {
      var m = p.match(/^(\d+)-(\d+)$/);
      if (m) { var a = +m[1], b = +m[2]; if (b - a <= 500) for (var i = Math.min(a, b); i <= Math.max(a, b); i++) set[i] = 1; }
      else if (/^\d+$/.test(p)) set[+p] = 1;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function metaForm(d) {
    d = d || {};
    var docs = Array.from(S.docs.values());
    var dl = function (id, arr) { return '<datalist id="' + id + '">' + arr.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; };
    var vis = d.visibility === 'groups' ? 'groups' : 'all';
    return '<div class="td-f"><label>Tên tài liệu' + (d.id ? '' : ' (để trống = lấy tên file)') + '</label><input type="text" id="tdmTitle" maxlength="200" value="' + esc(d.title || '') + '"></div>' +
      '<div class="td-row2"><div class="td-f"><label>Môn học</label><input type="text" id="tdmSubj" list="tdDlS" maxlength="80" value="' + esc(d.subject || '') + '" placeholder="VD: Kinh tế vi mô"></div>' +
      '<div class="td-f"><label>Chương</label><input type="text" id="tdmChap" list="tdDlC" maxlength="80" value="' + esc(d.chapter || '') + '" placeholder="VD: Chương 2"></div>' +
      '<div class="td-f"><label>Chuyên đề</label><input type="text" id="tdmTopic" list="tdDlT" maxlength="80" value="' + esc(d.topic || '') + '" placeholder="VD: Cung - cầu"></div></div>' +
      dl('tdDlS', uniq(docs.map(function (x) { return x.subject; }))) + dl('tdDlC', uniq(docs.map(function (x) { return x.chapter; }))) + dl('tdDlT', uniq(docs.map(function (x) { return x.topic; }))) +
      '<div class="td-f"><label>Mô tả</label><textarea id="tdmDesc" maxlength="600">' + esc(d.description || '') + '</textarea></div>' +
      '<div class="td-f"><label>Quyền xem</label><div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px"><label style="display:flex;gap:6px;align-items:center;margin:0;color:var(--text-main)"><input type="radio" name="tdmVis" value="all"' + (vis === 'all' ? ' checked' : '') + '> Công khai (mọi học viên)</label>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:0;color:var(--text-main)"><input type="radio" name="tdmVis" value="groups"' + (vis === 'groups' ? ' checked' : '') + '> Chỉ các nhóm được chọn</label></div>' +
      '<div class="td-pick" id="tdmGroups" style="margin-top:8px;' + (vis === 'groups' ? '' : 'display:none') + '">' + (S.groups.length ? S.groups.map(function (g) {
        return '<label><input type="checkbox" class="tdmG" value="' + g.id + '"' + ((d.groupIds || []).indexOf(g.id) > -1 ? ' checked' : '') + '> <span>' + esc(g.name) + ' <i style="color:var(--text-muted)">(' + (g.members || []).length + ' học viên)</i></span></label>';
      }).join('') : '<div class="td-path" style="padding:8px">Chưa có nhóm nào — bấm "Nhóm học viên" để tạo.</div>') + '</div></div>' +
      '<div class="td-f"><label><i class="fa-solid fa-video"></i> Liên kết bài giảng video</label><input type="text" id="tdmLQ" placeholder="Lọc bài giảng..." style="margin-bottom:6px"><div class="td-pick" id="tdmLessons"><div class="td-path" style="padding:8px"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</div></div></div>' +
      '<div class="td-f"><label><i class="fa-solid fa-circle-question"></i> Liên kết câu hỏi (nhập ID, hỗ trợ khoảng: 1-10, 25, 40-45)</label><input type="text" id="tdmQ" value="' + esc((d.questionIds || []).join(', ')) + '" placeholder="VD: 1-10, 25">' +
      '<div class="td-path" id="tdmQInfo" style="margin-top:4px"></div><input type="text" id="tdmQS" placeholder="Hoặc tìm câu hỏi theo từ khóa để thêm..." style="margin-top:8px"><div class="td-pick" id="tdmQRes" style="margin-top:6px;display:none"></div></div>';
  }
  function wireMetaForm(box, d) {
    d = d || {};
    $$('input[name=tdmVis]', box).forEach(function (r) { r.onchange = function () { $('#tdmGroups', box).style.display = r.value === 'groups' && r.checked ? '' : 'none'; }; });
    var sel = {}; (d.lessonIds || []).forEach(function (id) { sel[id] = 1; });
    var drawL = function (q) {
      var L = S.lessons; if (!L) return; var nq = norm(q || ''), h = '', cats = {};
      L.list.filter(function (x) { return !nq || norm(x.title).indexOf(nq) > -1; }).forEach(function (x) { (cats[x.cat] = cats[x.cat] || []).push(x); });
      Object.keys(cats).forEach(function (c) {
        h += '<div class="grp">' + esc(L.cats[c] || 'Khác') + '</div>';
        cats[c].sort(function (a, b) { return a.order - b.order; }).forEach(function (x) { h += '<label><input type="checkbox" class="tdmL" value="' + x.id + '"' + (sel[x.id] ? ' checked' : '') + '> <span>' + esc(x.title) + '</span></label>'; });
      });
      $('#tdmLessons', box).innerHTML = h || '<div class="td-path" style="padding:8px">Không có bài giảng nào' + (nq ? ' khớp bộ lọc' : ' (hãy tạo ở mục Khóa học)') + '.</div>';
      $$('.tdmL', box).forEach(function (c) { c.onchange = function () { if (c.checked) sel[c.value] = 1; else delete sel[c.value]; }; });
    };
    loadLessons().then(function () { drawL(''); });
    $('#tdmLQ', box).oninput = debounce(function () { drawL($('#tdmLQ', box).value); }, 200);
    box.__lessons = sel;
    var qIn = $('#tdmQ', box), info = $('#tdmQInfo', box), qm = Env.qm();
    var upd = function () {
      var ids = parseIds(qIn.value), miss = 0;
      if (qm && qm.getById) ids.forEach(function (i) { if (!qm.getById(i)) miss++; });
      info.innerHTML = ids.length + ' câu hỏi' + (miss ? ' · <span style="color:var(--danger)">' + miss + ' ID không tồn tại trong ngân hàng</span>' : '');
    };
    qIn.oninput = upd; upd();
    $('#tdmQS', box).oninput = debounce(function () {
      var res = $('#tdmQRes', box), nq = norm($('#tdmQS', box).value.trim()), words = nq.split(/\s+/).filter(Boolean);
      if (!qm || !qm.all || !words.length) { res.style.display = 'none'; return; }
      var hits = []; for (var i = 0; i < qm.all.length && hits.length < 8; i++) { var h = norm(qm.all[i].question); if (words.every(function (w) { return h.indexOf(w) > -1; })) hits.push(qm.all[i]); }
      res.style.display = ''; res.innerHTML = hits.length ? hits.map(function (q) { return '<label data-qid="' + q.id + '" style="cursor:pointer"><i class="fa-solid fa-plus" style="color:var(--accent)"></i> <span><b>#' + q.id + '</b> ' + esc(q.question.slice(0, 100)) + '</span></label>'; }).join('') : '<div class="td-path" style="padding:8px">Không tìm thấy</div>';
      $$('[data-qid]', res).forEach(function (el) { el.onclick = function () { var ids = parseIds(qIn.value); if (ids.indexOf(+el.dataset.qid) < 0) ids.push(+el.dataset.qid); qIn.value = ids.join(', '); upd(); }; });
    }, 250);
  }
  function readMetaForm(box) {
    var vis = ($('input[name=tdmVis]:checked', box) || {}).value || 'all';
    var groupIds = $$('.tdmG', box).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    if (vis === 'groups' && !groupIds.length && !confirm('Bạn chưa chọn nhóm nào — chỉ Admin sẽ xem được tài liệu này. Tiếp tục?')) return null;
    return {
      title: $('#tdmTitle', box).value.trim(), subject: $('#tdmSubj', box).value.trim(), chapter: $('#tdmChap', box).value.trim(), topic: $('#tdmTopic', box).value.trim(),
      description: $('#tdmDesc', box).value.trim(), visibility: vis, groupIds: groupIds,
      lessonIds: Object.keys(box.__lessons || {}), questionIds: parseIds($('#tdmQ', box).value)
    };
  }

  function openUpload() {
    if (!Env.isAdmin()) return toast('error', 'Không có quyền', 'Chỉ Admin mới upload được tài liệu');
    var m = modal('<h3><i class="fa-solid fa-cloud-arrow-up"></i> Upload tài liệu</h3>' +
      '<div class="td-f"><label>Chọn file (PDF, DOCX, XLSX, PPTX — tối đa ' + fmtSize(MAX_BYTES) + '/file, có thể chọn nhiều file)</label><input type="file" id="tdmFiles" multiple accept=".pdf,.docx,.xlsx,.xls,.pptx"></div>' +
      '<div id="tdmForm">' + metaForm() + '</div><div class="td-prog" id="tdmProg"></div>' +
      '<div class="td-actions"><button class="btn btn-outline" id="tdmCancel">Hủy</button><button class="btn btn-primary" id="tdmOk"><i class="fa-solid fa-cloud-arrow-up"></i> Upload</button></div>', true);
    var box = $('#tdmForm', m.el); wireMetaForm(box);
    $('#tdmCancel', m.el).onclick = m.close;
    $('#tdmOk', m.el).onclick = async function () {
      var files = Array.prototype.slice.call($('#tdmFiles', m.el).files || []);
      if (!files.length) return toast('warn', 'Chưa chọn file', 'Hãy chọn ít nhất 1 file');
      var meta = readMetaForm(box); if (!meta) return;
      var btn = this, prog = $('#tdmProg', m.el); btn.disabled = true;
      var ok = 0, errs = [];
      for (var i = 0; i < files.length; i++) {
        var mm = Object.assign({}, meta); if (files.length > 1) mm.title = '';
        try { await uploadOne(files[i], mm, function (t) { prog.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> [' + (i + 1) + '/' + files.length + '] ' + esc(t); }); ok++; }
        catch (er) { errs.push(er.message); }
      }
      btn.disabled = false;
      if (ok) toast('success', 'Upload thành công', ok + ' tài liệu đã được thêm');
      if (errs.length) { prog.innerHTML = '<span style="color:var(--danger)">' + errs.map(esc).join('<br>') + '</span>'; if (!ok) return; }
      m.close();
    };
  }
  function openEdit(id) {
    var d = S.docs.get(id); if (!d) return;
    if (!Env.isAdmin()) return toast('error', 'Không có quyền', 'Chỉ Admin mới sửa được tài liệu');
    var m = modal('<h3><i class="fa-solid fa-pen"></i> Sửa thông tin tài liệu</h3><div class="td-path" style="margin-bottom:12px"><i class="fa-solid ' + (TYPES[d.type] || TYPES.pdf).icon + '"></i> ' + esc(d.fileName) + ' · ' + fmtSize(d.size) + '</div><div id="tdmForm">' + metaForm(d) + '</div>' +
      '<div class="td-actions"><button class="btn btn-outline" id="tdmCancel">Hủy</button><button class="btn btn-primary" id="tdmOk"><i class="fa-solid fa-check"></i> Lưu</button></div>', true);
    var box = $('#tdmForm', m.el); wireMetaForm(box, d);
    $('#tdmCancel', m.el).onclick = m.close;
    $('#tdmOk', m.el).onclick = async function () {
      var meta = readMetaForm(box); if (!meta) return; if (!meta.title) meta.title = d.title;
      this.disabled = true;
      try { await updateMeta(id, meta); toast('success', 'Đã lưu', meta.title); m.close(); }
      catch (er) { toast('error', 'Lưu thất bại', er.message); this.disabled = false; }
    };
  }

  /* ============================ 12) NHÓM HỌC VIÊN ============================ */
  function openGroups() {
    if (!Env.isAdmin()) return;
    var m = modal('<h3><i class="fa-solid fa-users-gear"></i> Nhóm học viên</h3><div id="tdgList"></div><div class="td-actions"><button class="btn btn-outline" id="tdgClose">Đóng</button><button class="btn btn-primary" id="tdgNew"><i class="fa-solid fa-plus"></i> Tạo nhóm</button></div>', true);
    var draw = function () {
      $('#tdgList', m.el).innerHTML = S.groups.length ? S.groups.map(function (g) {
        return '<div class="td-q" style="display:flex;gap:10px;align-items:center"><div class="td-grow"><b>' + esc(g.name) + '</b><div class="td-path">' + (g.members || []).length + ' học viên</div></div><button class="btn btn-outline btn-sm" data-ge="' + g.id + '"><i class="fa-solid fa-pen"></i></button><button class="btn btn-ghost btn-sm" data-gd="' + g.id + '"><i class="fa-solid fa-trash"></i></button></div>';
      }).join('') : '<div class="td-path" style="padding:10px 0">Chưa có nhóm nào. Tạo nhóm rồi thêm email học viên để phân quyền tài liệu.</div>';
      $$('[data-ge]', m.el).forEach(function (b) { b.onclick = function () { groupForm(S.groups.filter(function (g) { return g.id === b.dataset.ge; })[0]); }; });
      $$('[data-gd]', m.el).forEach(function (b) {
        b.onclick = function () {
          var g = S.groups.filter(function (x) { return x.id === b.dataset.gd; })[0]; if (!g) return;
          confirmBox('Xóa nhóm?', 'Nhóm "' + g.name + '" sẽ bị xóa và gỡ khỏi mọi tài liệu đang dùng.', async function () {
            try { S.groups = S.groups.filter(function (x) { return x.id !== g.id; }); await syncDocsForGroup(g.id, true); await db().collection(COL.GROUPS).doc(g.id).delete(); toast('success', 'Đã xóa nhóm', g.name); }
            catch (er) { toast('error', 'Lỗi', er.message); }
          });
        };
      });
    };
    draw();
    var iv = setInterval(function () { if (!document.body.contains(m.el)) { clearInterval(iv); return; } if (!$('#tdgForm', m.el)) draw(); }, 600);
    $('#tdgClose', m.el).onclick = m.close;
    $('#tdgNew', m.el).onclick = function () { groupForm(null); };
  }
  function groupForm(g) {
    var m = modal('<h3><i class="fa-solid fa-users"></i> ' + (g ? 'Sửa nhóm' : 'Tạo nhóm') + '</h3><div id="tdgForm"><div class="td-f"><label>Tên nhóm</label><input type="text" id="tdgName" maxlength="80" value="' + esc(g ? g.name : '') + '" placeholder="VD: Lớp ôn thi K32"></div>' +
      '<div class="td-f"><label>Email học viên (mỗi dòng 1 email, hoặc ngăn cách bằng dấu phẩy)</label><textarea id="tdgMem" style="min-height:170px" placeholder="hocvien1@gmail.com&#10;hocvien2@gmail.com">' + esc(g ? (g.members || []).join('\n') : '') + '</textarea></div></div>' +
      '<div class="td-actions"><button class="btn btn-outline" id="tdgCancel">Hủy</button><button class="btn btn-primary" id="tdgSave"><i class="fa-solid fa-check"></i> Lưu</button></div>');
    $('#tdgCancel', m.el).onclick = m.close;
    $('#tdgSave', m.el).onclick = async function () {
      var name = $('#tdgName', m.el).value.trim(); if (!name) return toast('warn', 'Thiếu tên nhóm', '');
      var raw = $('#tdgMem', m.el).value.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
      var bad = raw.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
      if (bad.length) return toast('error', 'Email không hợp lệ', bad.slice(0, 3).join(', '));
      var members = Array.from(new Set(raw)); this.disabled = true;
      try {
        var ref = g ? db().collection(COL.GROUPS).doc(g.id) : db().collection(COL.GROUPS).doc();
        await ref.set({ name: name, members: members, updatedAt: new Date().toISOString() }, { merge: true });
        var ex = S.groups.filter(function (x) { return x.id === ref.id; })[0];
        if (ex) { ex.name = name; ex.members = members; } else S.groups.push({ id: ref.id, name: name, members: members });
        if (g) await syncDocsForGroup(ref.id, false);
        toast('success', 'Đã lưu nhóm', name); m.close();
      } catch (er) { toast('error', 'Lưu thất bại', er.message); this.disabled = false; }
    };
  }

  /* ============================ 13) READER ============================ */
  async function loadBlob(d) {
    if (S.blobCache.has(d.id)) return S.blobCache.get(d.id);
    var sn = await db().collection(COL.DOCS).doc(d.id).collection('chunks').orderBy('index', 'asc').get();
    if (sn.empty) throw new Error('Không tìm thấy dữ liệu file (chunks) trong Firestore');
    var blob = new Blob(sn.docs.map(function (x) { return b64ToBytes(x.data().data); }), { type: (TYPES[d.type] || TYPES.pdf).mime });
    if (S.blobCache.size >= 3) S.blobCache.delete(S.blobCache.keys().next().value);
    S.blobCache.set(d.id, blob); return blob;
  }
  function paperHtml(inner) {
    return '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,"Times New Roman",serif;font-size:15px;line-height:1.7;color:#111;background:#fff;margin:0;padding:28px 36px;word-wrap:break-word}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #bbb;padding:4px 8px;font-size:13px;vertical-align:top}th{background:#f1f5f9}h1,h2,h3{line-height:1.3}</style></head><body>' + inner + '</body></html>';
  }

  async function openReader(id) {
    var d = S.docs.get(id); if (!d) return;
    S.reader = { id: id, t0: Date.now() };
    var root = $('#tdRoot'), t = TYPES[d.type] || TYPES.pdf;
    root.innerHTML = '<div class="section-head"><div><button class="btn btn-outline btn-sm" data-act="back" style="margin-bottom:8px"><i class="fa-solid fa-arrow-left"></i> Quay lại danh sách</button><h2 style="display:flex;gap:10px;align-items:center"><i class="fa-solid ' + t.icon + '" style="color:' + t.color + '"></i> ' + esc(d.title) + '</h2><p>' + (esc([d.subject, d.chapter, d.topic].filter(Boolean).join(' › ')) || esc(d.fileName)) + '</p></div>' +
      '<div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm" data-act="rbm" id="tdRBm"></button><button class="btn btn-primary btn-sm" id="tdDl" disabled><i class="fa-solid fa-download"></i> Tải về</button></div></div>' +
      '<div class="td-reader"><div class="card td-view" id="tdView"><div class="td-loading"><i class="fa-solid fa-spinner fa-spin"></i>Đang tải tài liệu...</div></div><div class="card td-side" id="tdSide"></div></div>';
    refreshReaderSide();
    window.scrollTo({ top: 0 });
    // Ghi lịch sử
    db().collection('users').doc(S.uid).collection(COL.HIS).doc(id).set({ docId: id, lastReadAt: new Date().toISOString(), count: FV().increment(1) }, { merge: true }).catch(function () { });
    try {
      var blob = await loadBlob(d); if (!S.reader || S.reader.id !== id) return;
      var dl = $('#tdDl'); if (dl) { dl.disabled = false; dl.onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = d.fileName || d.title; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }; }
      var view = $('#tdView');
      if (d.type === 'pdf') {
        if (S.reader.url) URL.revokeObjectURL(S.reader.url);
        S.reader.url = URL.createObjectURL(blob);
        view.innerHTML = '<iframe src="' + S.reader.url + '" title="' + esc(d.title) + '"></iframe>';
      } else if (d.type === 'docx') {
        await ensureMammoth();
        var r = await window.mammoth.convertToHtml({ arrayBuffer: await readBuf(blob) }); if (!S.reader || S.reader.id !== id) return;
        view.innerHTML = '<iframe sandbox="" id="tdFrame"></iframe>'; $('#tdFrame').srcdoc = paperHtml(r.value || '<p>(Tài liệu trống)</p>');
      } else if (d.type === 'xlsx') {
        await ensureXlsx();
        var wb = window.XLSX.read(new Uint8Array(await readBuf(blob)), { type: 'array' }); if (!S.reader || S.reader.id !== id) return;
        var show = function (i) {
          $$('.td-sheets button', view).forEach(function (b, k) { b.classList.toggle('on', k === i); });
          $('#tdFrame').srcdoc = paperHtml(window.XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[i]], { header: '', footer: '' }));
        };
        view.innerHTML = '<div class="td-sheets">' + wb.SheetNames.map(function (n, i) { return '<button data-s="' + i + '">' + esc(n) + '</button>'; }).join('') + '</div><iframe sandbox="" id="tdFrame"></iframe>';
        $$('.td-sheets button', view).forEach(function (b) { b.onclick = function () { show(+b.dataset.s); }; }); show(0);
      } else if (d.type === 'pptx') {
        var slides = await pptxSlides(blob); if (!S.reader || S.reader.id !== id) return;
        view.innerHTML = '<div class="td-slides"><div class="td-path"><i class="fa-solid fa-circle-info"></i> Hiển thị nội dung chữ của từng slide. Tải về để xem đầy đủ hình ảnh và định dạng gốc.</div>' +
          (slides.length ? slides.map(function (s, i) { return '<div class="td-slide"><b>Slide ' + (i + 1) + '</b>' + (s.length ? s.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '<p style="color:var(--text-muted)"><i>(Không có nội dung chữ)</i></p>') + '</div>'; }).join('') : '<div class="td-loading">Không đọc được slide nào</div>') + '</div>';
      }
    } catch (err) {
      var v = $('#tdView'); if (v) v.innerHTML = '<div class="td-loading" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i>' + esc(err.message) + '</div>';
    }
  }

  async function refreshReaderSide() {
    if (!S.reader) return;
    var d = S.docs.get(S.reader.id), side = $('#tdSide'); if (!d) { leaveReader(); return; }
    var bm = $('#tdRBm'); if (bm) { var on = S.bookmarks.has(d.id); bm.innerHTML = '<i class="fa-' + (on ? 'solid' : 'regular') + ' fa-bookmark"' + (on ? ' style="color:var(--star)"' : '') + '></i> ' + (on ? 'Đã lưu' : 'Lưu'); }
    if (!side) return;
    var h = S.history.get(d.id), lids = d.lessonIds || [], qids = d.questionIds || [];
    var html = '<div><h5>Thông tin</h5><div style="font-size:13px;line-height:1.7"><div><b>File:</b> ' + esc(d.fileName) + ' (' + fmtSize(d.size) + ')</div><div><b>Ngày thêm:</b> ' + fmtDate(d.createdAt) + '</div>' +
      (h ? '<div><b>Đã đọc:</b> ' + (h.count || 1) + ' lần · ' + fmtDur(h.totalSec) + '</div>' : '') + (d.description ? '<div style="margin-top:6px;color:var(--text-muted)">' + esc(d.description) + '</div>' : '') + '</div></div>';
    if (lids.length) {
      var L = S.lessons || await loadLessons(); if (!S.reader || S.reader.id !== d.id) return;
      html += '<div><h5><i class="fa-solid fa-video"></i> Bài giảng liên quan</h5>' + lids.map(function (id) {
        var x = L.list.filter(function (l) { return l.id === id; })[0];
        return x ? '<button class="td-link" data-lesson="' + id + '"><i class="fa-solid fa-circle-play"></i><span>' + esc(x.title) + '</span></button>' : '';
      }).join('') + '</div>';
    }
    if (qids.length) {
      html += '<div><h5><i class="fa-solid fa-circle-question"></i> Câu hỏi liên quan (' + qids.length + ')</h5><button class="td-link" data-qview><i class="fa-solid fa-eye"></i><span>Xem câu hỏi &amp; đáp án</span></button>' +
        (Env.quiz() ? '<button class="td-link" data-qpractice><i class="fa-solid fa-pen-to-square"></i><span>Luyện tập các câu này</span></button>' : '') + '</div>';
    }
    if (!lids.length && !qids.length) html += '<div class="td-path">Tài liệu chưa được liên kết với bài giảng hay câu hỏi nào.</div>';
    side.innerHTML = html;
    $$('[data-lesson]', side).forEach(function (b) { b.onclick = function () { var id = b.dataset.lesson; leaveReader(true); var u = Env.ui(); if (u) u.navigate('course'); setTimeout(function () { if (window.CourseUI && CourseUI.openLesson) CourseUI.openLesson(id); }, 80); }; });
    var qv = $('[data-qview]', side); if (qv) qv.onclick = function () { showQuestions(d); };
    var qp = $('[data-qpractice]', side); if (qp) qp.onclick = function () {
      var qs = linkedQuestions(d); if (!qs.length) return toast('warn', 'Không có câu hỏi', 'Các ID liên kết không còn trong ngân hàng');
      leaveReader(true); Env.quiz().startCustomReview(qs, 'Câu hỏi: ' + d.title);
    };
  }
  function linkedQuestions(d) { var qm = Env.qm(); if (!qm || !qm.getById) return []; return (d.questionIds || []).map(function (i) { return qm.getById(i); }).filter(Boolean); }
  function showQuestions(d) {
    var qs = linkedQuestions(d);
    var m = modal('<h3><i class="fa-solid fa-circle-question"></i> Câu hỏi liên quan</h3>' + (qs.length ? qs.map(function (q) {
      return '<div class="td-q"><b>Câu ' + esc(q.id) + ':</b> ' + esc(q.question) + Object.keys(q.options || {}).map(function (k) { return '<div class="o' + (k === q.answer ? ' ok' : '') + '"><b>' + esc(k) + '.</b> ' + esc(q.options[k]) + (k === q.answer ? ' <i class="fa-solid fa-check"></i>' : '') + '</div>'; }).join('') + '</div>';
    }).join('') : '<div class="td-path">Các câu hỏi liên kết không còn trong ngân hàng.</div>') + '<div class="td-actions"><button class="btn btn-primary" id="tdqOk">Đóng</button></div>', true);
    $('#tdqOk', m.el).onclick = m.close;
  }

  // silent=true: không vẽ lại danh sách (dùng khi chuyển sang view khác)
  function leaveReader(silent) {
    if (!S.reader) return;
    var r = S.reader, sec = Math.round((Date.now() - r.t0) / 1000);
    if (r.url) { try { URL.revokeObjectURL(r.url); } catch (e) { } }
    S.reader = null;
    if (sec >= 3 && S.uid && db()) db().collection('users').doc(S.uid).collection(COL.HIS).doc(r.id).set({ totalSec: FV().increment(sec) }, { merge: true }).catch(function () { });
    if (!silent) render();
  }

  /* ============================ 14) MÓC VÀO VÒNG ĐỜI CÓ SẴN ============================ */
  function hook() {
    var ui = Env.ui();
    if (ui && !ui.__tailieuWrapped) {
      ui.__tailieuWrapped = true;
      ui.titles = ui.titles || {}; ui.titles.tailieu = ['Tài liệu & đề cương', 'Ngân hàng tài liệu học tập theo môn học, chương và chuyên đề'];
      var orig = ui.navigate.bind(ui);
      ui.navigate = function (view) {
        if (view !== 'tailieu' && S.reader) leaveReader(true);
        var r = orig(view);
        if (view === 'tailieu') { start(); wireRoot(); S.reader ? refreshReaderSide() : render(); }
        return r;
      };
    }
    try {
      if (typeof CloudSync !== 'undefined' && CloudSync && !CloudSync.__tailieuWrapped) {
        CloudSync.__tailieuWrapped = true;
        var t = CloudSync.teardown.bind(CloudSync);
        CloudSync.teardown = function () { stop(); return t(); };
      }
    } catch (e) { }
  }
  window.addEventListener('beforeunload', function () { leaveReader(true); });

  function init() { css(); injectDom(); wireRoot(); hook(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.TaiLieu = {
    open: function (id) { var u = Env.ui(); if (u) u.navigate('tailieu'); setTimeout(function () { openReader(id); }, 150); },
    refresh: function () { render(); }
  };
})();
