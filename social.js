/* ============================================================================
   social.js  v2 — "Thảo luận / Cộng đồng" (viết lại hoàn toàn, 1 file duy nhất)
   ----------------------------------------------------------------------------
   Thêm vào cuối index.html (sau các script khác):  <script src="social.js"></script>

   TẠI SAO BẢN CŨ KHÔNG CHẠY — và bản này sửa thế nào
   1) index.html khai báo `const fbDb / fbAuth / UIManager / AuthManager`. Biến
      const ở top-level KHÔNG nằm trên `window`, nên window.fbDb, window.fbAuth,
      window.UIManager... luôn undefined => module cũ không bao giờ kết nối được.
      => Bản này đọc chúng bằng `typeof fbDb !== 'undefined'` (xem object Env).
   2) Các query cũ kết hợp where() + orderBy() trên field khác nhau, bắt buộc phải
      tạo "composite index" thủ công, nếu không Firestore báo lỗi và UI trống.
      => Bản này chỉ dùng query 1 điều kiện / 1 orderBy rồi lọc + sắp xếp ở client.
   3) Cũ gọi RealtimeManager.detachByPrefix('chat_msg_') mỗi lần đổi tab => tắt
      mất toàn bộ chat đang mở. => đã bỏ.
   4) Tab Thông báo cũ render mảng rỗng. => dữ liệu realtime được lưu và vẽ đúng.
   5) Chưa có Firestore Rules cho các collection social_* => đọc/ghi bị từ chối.
      Nếu thiếu rules, giao diện sẽ hiện banner cảnh báo rõ ràng (không im lặng).

   TÍNH NĂNG: bảng tin realtime (đăng chữ/ảnh/file/code/link/bình chọn/câu hỏi,
   cảm xúc, bình luận đa cấp, chia sẻ lại, lưu bài, ghim, báo cáo), kết bạn /
   theo dõi / chặn, nhắn tin riêng realtime (cửa sổ nổi, đang nhập, chưa đọc),
   phòng chat chung, nhóm (bảng tin + chat nhóm), thông báo realtime, đang trực
   tuyến, tìm kiếm người/bài/#hashtag, hồ sơ + EXP + cấp + huy hiệu, bảng xếp
   hạng, xu hướng, quản trị (xoá bài, khoá tài khoản, xử lý báo cáo).

   ‼️ BẮT BUỘC: dán đoạn RULES dưới đây vào Firebase Console > Firestore > Rules
      (gộp vào khối `match /databases/{database}/documents { ... }` hiện có):

   function signedIn(){ return request.auth != null; }
   function isAdm(){ return signedIn() &&
     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'; }
   match /social_profiles/{u} {
     allow read: if signedIn();
     allow create, update: if signedIn() && (request.auth.uid == u || isAdm());
   }
   match /social_posts/{id} {
     allow read: if signedIn();
     allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
     allow update: if signedIn() && (resource.data.uid == request.auth.uid || isAdm() ||
       request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['reactions','pollVotes','commentCount','shareCount']));
     allow delete: if signedIn() && (resource.data.uid == request.auth.uid || isAdm());
   }
   match /social_comments/{id} {
     allow read: if signedIn();
     allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
     allow update: if signedIn() && (resource.data.uid == request.auth.uid || isAdm() ||
       request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions']));
     allow delete: if signedIn() && (resource.data.uid == request.auth.uid || isAdm());
   }
   match /social_friends/{id} {
     allow read, create, update, delete: if signedIn() && request.auth.uid in resource.data.members
       || signedIn() && request.auth.uid in request.resource.data.members;
   }
   match /social_follow/{id} {
     allow read: if signedIn();
     allow create, delete: if signedIn();
   }
   match /social_notifications/{id} {
     allow create: if signedIn();
     allow read, update, delete: if signedIn() && resource.data.uid == request.auth.uid;
   }
   match /social_conversations/{id} {
     allow read, write: if signedIn() && (request.auth.uid in resource.data.members ||
       request.auth.uid in request.resource.data.members);
     match /messages/{m} {
       allow read, create: if signedIn() &&
         request.auth.uid in get(/databases/$(database)/documents/social_conversations/$(id)).data.members;
     }
   }
   match /social_global_chat/{m} {
     allow read: if signedIn();
     allow create: if signedIn() && request.resource.data.from == request.auth.uid;
     allow delete: if isAdm();
   }
   match /social_groups/{g} {
     allow read, create, update: if signedIn();
     allow delete: if signedIn() && (resource.data.createdBy == request.auth.uid || isAdm());
     match /messages/{m} { allow read, create: if signedIn(); allow delete: if isAdm(); }
   }
   match /social_reports/{r} {
     allow create: if signedIn();
     allow read, update, delete: if isAdm();
   }
   match /social_presence/{u} {
     allow read: if signedIn();
     allow write: if signedIn() && request.auth.uid == u;
   }
   ========================================================================== */
(function () {
  'use strict';
  if (window.__SOCIAL_V2__) return;
  window.__SOCIAL_V2__ = true;

  /* ======================= 0) HẰNG SỐ ======================= */
  const COL = {
    POSTS: 'social_posts', COMMENTS: 'social_comments', PROFILES: 'social_profiles',
    FRIENDS: 'social_friends', FOLLOW: 'social_follow', NOTIFS: 'social_notifications',
    CONVS: 'social_conversations', GROUPS: 'social_groups', REPORTS: 'social_reports',
    PRESENCE: 'social_presence', GLOBAL: 'social_global_chat'
  };
  const REACTIONS = [
    { key: 'like', emoji: '👍', label: 'Thích', color: '#1478d4' },
    { key: 'love', emoji: '❤️', label: 'Yêu thích', color: '#ef4444' },
    { key: 'haha', emoji: '😆', label: 'Haha', color: '#f59e0b' },
    { key: 'wow', emoji: '😮', label: 'Wow', color: '#f59e0b' },
    { key: 'sad', emoji: '😢', label: 'Buồn', color: '#6fb6f2' }
  ];
  const LEVELS = [
    { name: 'Bronze', min: 0, color: '#b08d57' }, { name: 'Silver', min: 300, color: '#9aa5b1' },
    { name: 'Gold', min: 1200, color: '#f5b301' }, { name: 'Diamond', min: 4000, color: '#22d3ee' },
    { name: 'Master', min: 10000, color: '#a78bfa' }, { name: 'Legend', min: 25000, color: '#ef4444' }
  ];
  const BADGES = [
    { label: 'Thành viên mới', icon: 'fa-seedling', color: '#16c784', t: () => true },
    { label: 'Bài viết đầu tiên', icon: 'fa-pen', color: '#1478d4', t: p => (p.postCount || 0) >= 1 },
    { label: '50 bài viết', icon: 'fa-feather-pointed', color: '#1478d4', t: p => (p.postCount || 0) >= 50 },
    { label: '100 bình luận', icon: 'fa-comments', color: '#22d3ee', t: p => (p.commentCount || 0) >= 100 },
    { label: 'Người hay giúp đỡ', icon: 'fa-award', color: '#fbbf24', t: p => (p.bestAnswerCount || 0) >= 1 },
    { label: 'Top Contributor', icon: 'fa-star', color: '#fbbf24', t: p => (p.exp || 0) >= 5000 }
  ];
  const EMOJIS = ['😀', '😂', '😍', '🤔', '😢', '😡', '👍', '👏', '🔥', '🎉', '💯', '📚', '✅', '❌', '⭐', '🙏', '😴', '🤯', '🥳', '💡'];
  const HASHTAGS = ['kinhte', 'onthi', 'NEU', 'tailieu', 'caohoc', 'thongke', 'toan', 'anhvan'];
  const LIM = { IMG_DIM: 1024, IMG_CHARS: 200000, FILE_CHARS: 700000, DOC_CHARS: 900000, POST_GAP: 8000, CMT_GAP: 2500, MSG_GAP: 500, HOME: 150, PAGE: 20 };

  /* ======================= 1) ENV — đọc biến toàn cục kiểu const ======================= */
  const Env = {
    db() {
      try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { }
      if (window.fbDb) return window.fbDb;
      return (window.firebase && firebase.apps && firebase.apps.length) ? firebase.firestore() : null;
    },
    auth() {
      try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { }
      if (window.fbAuth) return window.fbAuth;
      return (window.firebase && firebase.apps && firebase.apps.length) ? firebase.auth() : null;
    },
    ui() { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; },
    am() { try { if (typeof AuthManager !== 'undefined' && AuthManager) return AuthManager; } catch (e) { } return window.AuthManager || null; },
    isAdmin() { const a = this.am(); try { return !!(a && typeof a.isAdmin === 'function' && a.isAdmin()); } catch (e) { return false; } },
    user() { const a = this.auth(); return (a && a.currentUser) || null; },
    appReady() { return !!window.__appInitialized; }
  };
  const col = n => Env.db().collection(n);
  const FV = () => firebase.firestore.FieldValue;
  const TS = () => FV().serverTimestamp();
  const docData = d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' }));

  /* ======================= 2) UTILS ======================= */
  const esc = s => (s === undefined || s === null) ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = ts => { if (!ts) return 0; if (typeof ts.toMillis === 'function') return ts.toMillis(); if (ts instanceof Date) return ts.getTime(); return typeof ts === 'number' ? ts : 0; };
  const debounce = (fn, w) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), w); }; };
  const gate = {}; // chống spam
  const rate = (k, gap) => { const n = Date.now(); if (n - (gate[k] || 0) < gap) { toast('warn', 'Thao tác quá nhanh', 'Vui lòng đợi vài giây'); return false; } gate[k] = n; return true; };

  function timeAgo(ts) {
    const t = ms(ts); if (!t) return 'Vừa xong';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 10) return 'Vừa xong'; if (s < 60) return s + ' giây trước';
    const m = Math.floor(s / 60); if (m < 60) return m + ' phút trước';
    const h = Math.floor(m / 60); if (h < 24) return h + ' giờ trước';
    const d = Math.floor(h / 24); if (d < 7) return d + ' ngày trước';
    return new Date(t).toLocaleDateString('vi-VN');
  }
  function md(raw) {
    return String(raw || '').split('```').map((seg, i) => {
      if (i % 2 === 1) return '<pre class="soc-code">' + esc(seg.replace(/^\n/, '')) + '</pre>';
      let t = esc(seg);
      t = t.replace(/`([^`\n]+)`/g, '<code class="soc-icode">$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
        .replace(/(^|[^"'>=])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$2</a>')
        .replace(/(^|\s)#([a-zA-Z0-9_À-ỹ]{2,30})/g, '$1<a href="javascript:void(0)" class="soc-tag" data-tag="$2">#$2</a>')
        .replace(/(^|\s)@([a-zA-ZÀ-ỹ0-9_.]{2,40})/g, '$1<span class="soc-mention">@$2</span>');
      return t.replace(/\n/g, '<br>');
    }).join('');
  }
  const hashtagsOf = t => [...new Set((String(t || '').match(/(?:^|\s)#([a-zA-Z0-9_À-ỹ]{2,30})/g) || []).map(x => x.trim().slice(1)))].slice(0, 15);

  function compressImage(file, dim, maxChars) {
    return new Promise((res, rej) => {
      if (!/^image\//.test(file.type)) return rej(new Error('File không phải hình ảnh'));
      const fr = new FileReader(); fr.onerror = () => rej(new Error('Không đọc được ảnh'));
      fr.onload = e => {
        const img = new Image(); img.onerror = () => rej(new Error('Ảnh bị lỗi'));
        img.onload = () => {
          let r = Math.min(1, dim / Math.max(img.width, img.height)), w = Math.round(img.width * r), h = Math.round(img.height * r);
          const c = document.createElement('canvas'), x = c.getContext('2d');
          const draw = () => { c.width = w; c.height = h; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); };
          draw(); let q = .8, url = c.toDataURL('image/jpeg', q), n = 0;
          while (url.length > maxChars && n++ < 10) { q -= .1; if (q < .35) { w = Math.round(w * .8); h = Math.round(h * .8); draw(); q = .65; } url = c.toDataURL('image/jpeg', q); }
          url.length > maxChars ? rej(new Error('Ảnh quá nặng, hãy chọn ảnh nhỏ hơn')) : res(url);
        };
        img.src = e.target.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function fileToData(file, maxChars) {
    return new Promise((res, rej) => {
      const fr = new FileReader(); fr.onerror = () => rej(new Error('Không đọc được file'));
      fr.onload = e => e.target.result.length > maxChars ? rej(new Error('File quá nặng (tối đa ~' + Math.round(maxChars * .75 / 1024) + 'KB)')) : res(e.target.result);
      fr.readAsDataURL(file);
    });
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); return Promise.resolve();
  }
  function toast(type, title, msg) {
    const ui = Env.ui();
    if (ui && typeof ui.toast === 'function') return ui.toast(type, title, msg || '');
    console.log('[Social]', title, msg || '');
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ======================= 3) REALTIME REGISTRY ======================= */
  const R = {
    m: new Map(),
    attach(k, fn) { this.detach(k); this.m.set(k, fn); },
    detach(k) { const f = this.m.get(k); if (f) { try { f(); } catch (e) { } this.m.delete(k); } },
    prefix(p) { [...this.m.keys()].filter(k => k.startsWith(p)).forEach(k => this.detach(k)); },
    all() { [...this.m.keys()].forEach(k => this.detach(k)); }
  };
  const onErr = tag => err => {
    console.error('[Social] ' + tag, err);
    if (err && err.code === 'permission-denied') { State.permError = true; Social.showBanner(); }
  };

  /* ======================= 4) STATE ======================= */
  const State = {
    myProfile: null, profiles: new Map(), friends: new Map(), blocked: new Set(), following: new Set(),
    convs: [], notifs: [], homePosts: [], presence: [], tab: 'feed', started: false, permError: false,
    openDMs: new Map(), homeSubs: new Set(), seenConvs: false, seenNotifs: false, pendingSearch: '', hb: null
  };

  /* ======================= 5) UI COMPONENTS ======================= */
  const UI = {
    avatar(url, name, size) {
      size = size || 40; const letter = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
      const fb = `<div class="soc-av soc-av-fb" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px">${letter}</div>`;
      if (!url) return fb;
      return `<span class="soc-av-wrap" style="width:${size}px;height:${size}px"><img class="soc-av" src="${esc(url)}" style="width:${size}px;height:${size}px" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=this.parentNode.dataset.fb" ></span>`.replace('<span class="soc-av-wrap"', `<span data-fb='${fb.replace(/'/g, '&#39;')}' class="soc-av-wrap"`);
    },
    levelChip(exp) { const l = P.level(exp || 0); return `<span class="soc-lvl" style="--c:${l.color}"><i class="fa-solid fa-ranking-star"></i> ${l.name}</span>`; },
    empty(icon, title, sub) { return `<div class="soc-empty"><i class="fa-solid ${icon}"></i><p>${esc(title)}</p>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`; },
    skeleton(n) { return Array(n || 2).fill('<div class="soc-card soc-skel"><div class="soc-skel-l" style="width:40%"></div><div class="soc-skel-l"></div><div class="soc-skel-l" style="width:70%"></div></div>').join(''); }
  };

  const Modal = {
    open(html, o) {
      o = o || {};
      const ov = document.createElement('div'); ov.className = 'soc-ov';
      ov.innerHTML = `<div class="soc-modal ${o.wide ? 'wide' : ''}"><button class="soc-x" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button><div>${html}</div></div>`;
      document.body.appendChild(ov); requestAnimationFrame(() => ov.classList.add('show'));
      const onKey = e => { if (e.key === 'Escape') close(); };
      const close = () => { document.removeEventListener('keydown', onKey); ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); if (o.onClose) o.onClose(); };
      $('.soc-x', ov).onclick = close; ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
      document.addEventListener('keydown', onKey);
      return { el: ov, close };
    },
    form(o) {
      const f = o.fields.map(x => `<div class="soc-field"><label>${esc(x.label)}</label>${x.type === 'textarea'
        ? `<textarea id="f_${x.id}" rows="${x.rows || 4}" maxlength="${x.max || 2000}" placeholder="${esc(x.ph || '')}">${esc(x.value || '')}</textarea>`
        : x.type === 'select'
          ? `<select id="f_${x.id}">${x.options.map(op => `<option value="${op[0]}" ${op[0] === x.value ? 'selected' : ''}>${esc(op[1])}</option>`).join('')}</select>`
          : `<input type="text" id="f_${x.id}" value="${esc(x.value || '')}" placeholder="${esc(x.ph || '')}" maxlength="${x.max || 200}">`}</div>`).join('');
      const m = this.open(`<h3>${esc(o.title)}</h3>${o.note ? `<p class="soc-muted">${esc(o.note)}</p>` : ''}${f}<button class="soc-btn primary block" id="socFormOk">${esc(o.submit || 'Lưu')}</button>`, { wide: o.wide });
      const btn = $('#socFormOk', m.el);
      btn.onclick = async () => {
        const v = {}; o.fields.forEach(x => v[x.id] = $('#f_' + x.id, m.el).value);
        btn.disabled = true;
        try { if ((await o.onSubmit(v)) !== false) m.close(); } catch (e) { toast('error', 'Lỗi', e.message); }
        btn.disabled = false;
      };
      const first = $('input,textarea', m.el); if (first) first.focus();
      return m;
    },
    confirm(title, msg, onOk, danger) {
      const m = this.open(`<h3>${esc(title)}</h3><p class="soc-muted">${esc(msg || '')}</p><div class="soc-row end"><button class="soc-btn" id="socNo">Huỷ</button><button class="soc-btn ${danger === false ? 'primary' : 'danger'}" id="socYes">Xác nhận</button></div>`);
      $('#socNo', m.el).onclick = m.close; $('#socYes', m.el).onclick = () => { m.close(); onOk(); };
    }
  };

  function dropdown(anchor, items) {
    $$('.soc-menu').forEach(x => x.remove());
    const menu = document.createElement('div'); menu.className = 'soc-menu';
    menu.innerHTML = items.map((it, i) => it.div ? '<div class="soc-menu-div"></div>' : `<button class="soc-menu-i ${it.danger ? 'danger' : ''}" data-i="${i}"><i class="fa-solid ${it.icon}"></i> ${esc(it.label)}</button>`).join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)) + 'px';
    let top = r.bottom + 6; if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
    menu.style.top = top + 'px';
    $$('.soc-menu-i', menu).forEach(b => b.onclick = () => { menu.remove(); items[+b.dataset.i].on(); });
    const closer = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', closer, true); } };
    setTimeout(() => document.addEventListener('mousedown', closer, true), 0);
  }

  /* ======================= 6) PROFILES ======================= */
  const P = {
    get: uid => State.profiles.get(uid) || null,
    async fetch(uid) {
      if (State.profiles.has(uid)) return State.profiles.get(uid);
      const s = await col(COL.PROFILES).doc(uid).get();
      if (!s.exists) return null;
      const d = Object.assign({ id: uid, uid }, s.data()); State.profiles.set(uid, d); return d;
    },
    level(exp) { let c = LEVELS[0]; LEVELS.forEach(l => { if (exp >= l.min) c = l; }); return c; },
    next(exp) {
      const i = LEVELS.findIndex(l => l.name === P.level(exp).name), n = LEVELS[i + 1];
      return n ? { n, pct: Math.min(100, Math.round((exp - LEVELS[i].min) / (n.min - LEVELS[i].min) * 100)) } : { n: null, pct: 100 };
    },
    async ensure(u) {
      const ref = col(COL.PROFILES).doc(u.uid), s = await ref.get();
      const name = u.displayName || (u.email || 'Người dùng').split('@')[0];
      if (!s.exists) {
        await ref.set({ uid: u.uid, displayName: name, nameLower: name.toLowerCase(), photoURL: u.photoURL || '', bio: '', exp: 0, postCount: 0, commentCount: 0, likeGiven: 0, bestAnswerCount: 0, savedIds: [], banned: false, role: Env.isAdmin() ? 'admin' : 'member', joinedAt: TS(), lastActive: TS() });
      } else {
        const d = s.data(), patch = { lastActive: TS(), role: Env.isAdmin() ? 'admin' : (d.role === 'admin' ? 'member' : (d.role || 'member')) };
        if (name !== d.displayName) { patch.displayName = name; patch.nameLower = name.toLowerCase(); }
        if (u.photoURL && u.photoURL !== d.photoURL) patch.photoURL = u.photoURL;
        await ref.update(patch).catch(() => { });
      }
    },
    addExp(n, counter) {
      const u = Env.user(); if (!u) return;
      const patch = { exp: FV().increment(n) }; if (counter) patch[counter] = FV().increment(n < 0 ? -1 : 1);
      col(COL.PROFILES).doc(u.uid).update(patch).catch(() => { });
    },
    badges: p => BADGES.filter(b => { try { return b.t(p); } catch (e) { return false; } }),

    async openModal(uid) {
      const me = Env.user(), p = await P.fetch(uid);
      if (!p) return toast('error', 'Không tìm thấy hồ sơ');
      const isMe = uid === me.uid, l = P.level(p.exp || 0), nx = P.next(p.exp || 0);
      let followers = 0; try { followers = (await col(COL.FOLLOW).where('followingUid', '==', uid).get()).size; } catch (e) { }
      const fr = Friends.status(uid), following = State.following.has(uid);
      const m = Modal.open(`
        <div class="soc-prof-head" style="--c:${l.color}">
          ${UI.avatar(p.photoURL, p.displayName, 84)}
          <h3>${esc(p.displayName)} ${p.role === 'admin' ? '<i class="fa-solid fa-shield-halved soc-adm" title="Quản trị viên"></i>' : ''}</h3>
          <p class="soc-muted">${esc(p.bio || 'Chưa có tiểu sử')}</p>
          ${UI.levelChip(p.exp)}
          <div class="soc-bar"><i style="width:${nx.pct}%"></i></div>
          <span class="soc-muted sm">${p.exp || 0} EXP ${nx.n ? '· còn ' + (nx.n.min - (p.exp || 0)) + ' tới ' + nx.n.name : '· cấp tối đa'}</span>
        </div>
        <div class="soc-stats"><div><b>${p.postCount || 0}</b><span>Bài viết</span></div><div><b>${p.commentCount || 0}</b><span>Bình luận</span></div><div><b>${followers}</b><span>Người theo dõi</span></div></div>
        <div class="soc-badges">${P.badges(p).map(b => `<span class="soc-badge" style="--c:${b.color}"><i class="fa-solid ${b.icon}"></i> ${b.label}</span>`).join('')}</div>
        ${isMe ? `<div class="soc-field"><label>Tiểu sử</label><textarea id="socBio" maxlength="160" rows="3">${esc(p.bio || '')}</textarea></div><button class="soc-btn primary" id="socSaveBio"><i class="fa-solid fa-floppy-disk"></i> Lưu tiểu sử</button>`
          : `<div class="soc-row wrap"><button class="soc-btn primary" data-a="dm"><i class="fa-solid fa-comment-dots"></i> Nhắn tin</button>
              <button class="soc-btn" data-a="friend">${Friends.label(fr)}</button>
              <button class="soc-btn" data-a="follow">${following ? '<i class="fa-solid fa-user-check"></i> Đang theo dõi' : '<i class="fa-solid fa-user-plus"></i> Theo dõi'}</button>
              <button class="soc-btn danger" data-a="block"><i class="fa-solid fa-ban"></i> ${State.blocked.has(uid) ? 'Bỏ chặn' : 'Chặn'}</button>
              ${Env.isAdmin() ? `<button class="soc-btn danger" data-a="ban"><i class="fa-solid fa-user-lock"></i> ${p.banned ? 'Bỏ khoá' : 'Khoá tài khoản'}</button>` : ''}</div>`}`, { wide: true });
      const reopen = () => { m.close(); setTimeout(() => P.openModal(uid), 250); };
      if (isMe) $('#socSaveBio', m.el).onclick = async () => { await col(COL.PROFILES).doc(me.uid).update({ bio: $('#socBio', m.el).value.trim().slice(0, 160) }); toast('success', 'Đã lưu'); };
      else $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
        const a = b.dataset.a;
        try {
          if (a === 'dm') { m.close(); Chat.openDM(uid); }
          else if (a === 'friend') { await Friends.click(uid); reopen(); }
          else if (a === 'follow') { following ? await Friends.unfollow(uid) : await Friends.follow(uid); reopen(); }
          else if (a === 'block') { State.blocked.has(uid) ? await Friends.unblock(uid) : await Friends.block(uid); reopen(); }
          else if (a === 'ban') { await col(COL.PROFILES).doc(uid).update({ banned: !p.banned }); p.banned = !p.banned; toast('success', 'Đã cập nhật'); reopen(); }
        } catch (e) { toast('error', 'Lỗi', e.message); }
      });
    }
  };

  /* ======================= 7) NOTIFICATIONS ======================= */
  const Notify = {
    meta: {
      like: ['fa-thumbs-up', 'đã bày tỏ cảm xúc về bài viết của bạn', '#1478d4'],
      comment: ['fa-comment', 'đã bình luận bài viết của bạn', '#22d3ee'],
      reply: ['fa-reply', 'đã trả lời bình luận của bạn', '#22d3ee'],
      friend_request: ['fa-user-plus', 'đã gửi lời mời kết bạn', '#16c784'],
      friend_accept: ['fa-user-check', 'đã chấp nhận lời mời kết bạn', '#16c784'],
      follow: ['fa-user-plus', 'đã theo dõi bạn', '#a78bfa'],
      best_answer: ['fa-award', 'đã chọn câu trả lời của bạn là hay nhất', '#fbbf24'],
      share: ['fa-share', 'đã chia sẻ bài viết của bạn', '#1478d4']
    },
    send(toUid, type, extra) {
      const me = Env.user(); if (!me || !toUid || toUid === me.uid) return;
      col(COL.NOTIFS).add(Object.assign({ uid: toUid, type, fromUid: me.uid, fromName: me.displayName || 'Ai đó', fromPhoto: me.photoURL || '', read: false, createdAt: TS() }, extra || {})).catch(() => { });
    },
    render(box) {
      const list = State.notifs;
      if (!list.length) return box.innerHTML = UI.empty('fa-bell-slash', 'Chưa có thông báo nào', 'Hoạt động của mọi người sẽ hiện ở đây');
      box.innerHTML = `<div class="soc-row end"><button class="soc-btn sm" id="socReadAll"><i class="fa-solid fa-check-double"></i> Đánh dấu đã đọc tất cả</button></div>` +
        list.slice(0, 80).map(n => { const mt = Notify.meta[n.type] || ['fa-bell', 'có thông báo mới', '#1478d4']; return `
        <div class="soc-notif ${n.read ? '' : 'unread'}" data-id="${n.id}" data-post="${esc(n.postId || '')}" data-from="${esc(n.fromUid)}">
          ${UI.avatar(n.fromPhoto, n.fromName, 40)}<span class="soc-nic" style="background:${mt[2]}"><i class="fa-solid ${mt[0]}"></i></span>
          <div><b>${esc(n.fromName)}</b> ${mt[1]} ${n.excerpt ? `<span class="soc-muted">"${esc(n.excerpt)}"</span>` : ''}<div class="soc-muted sm">${timeAgo(n.createdAt)}</div></div></div>`; }).join('');
      $$('.soc-notif', box).forEach(el => el.onclick = () => {
        col(COL.NOTIFS).doc(el.dataset.id).update({ read: true }).catch(() => { });
        el.dataset.post ? Posts.openSingle(el.dataset.post) : P.openModal(el.dataset.from);
      });
      const ra = $('#socReadAll', box);
      if (ra) ra.onclick = async () => { const b = Env.db().batch(); State.notifs.filter(n => !n.read).forEach(n => b.update(col(COL.NOTIFS).doc(n.id), { read: true })); await b.commit().catch(() => { }); };
    }
  };

  /* ======================= 8) FRIENDS / FOLLOW / BLOCK ======================= */
  const Friends = {
    pid: (a, b) => [a, b].sort().join('_'),
    status: o => State.friends.get(o) || null,
    label(s) {
      if (!s) return '<i class="fa-solid fa-user-plus"></i> Kết bạn';
      if (s.status === 'accepted') return '<i class="fa-solid fa-user-check"></i> Bạn bè';
      if (s.status === 'pending') return s.requestedBy === Env.user().uid ? '<i class="fa-solid fa-clock"></i> Đã gửi lời mời' : '<i class="fa-solid fa-user-clock"></i> Chấp nhận lời mời';
      return '<i class="fa-solid fa-ban"></i> Đã chặn';
    },
    async click(o) {
      const me = Env.user().uid, s = this.status(o);
      if (!s) return this.request(o);
      if (s.status === 'pending' && s.requestedBy !== me) return this.accept(o);
      if (s.status === 'pending') return this.remove(o, 'Đã huỷ lời mời');
      if (s.status === 'accepted') return new Promise(r => Modal.confirm('Huỷ kết bạn?', '', async () => { await this.remove(o, 'Đã huỷ kết bạn'); r(); }));
    },
    async request(o) {
      const me = Env.user().uid;
      await col(COL.FRIENDS).doc(this.pid(me, o)).set({ members: [me, o], status: 'pending', requestedBy: me, createdAt: TS() });
      Notify.send(o, 'friend_request'); toast('success', 'Đã gửi lời mời kết bạn');
    },
    async accept(o) {
      const me = Env.user().uid;
      await col(COL.FRIENDS).doc(this.pid(me, o)).update({ status: 'accepted' });
      Notify.send(o, 'friend_accept'); toast('success', 'Đã là bạn bè!');
    },
    async remove(o, msg) { await col(COL.FRIENDS).doc(this.pid(Env.user().uid, o)).delete(); toast('success', msg || 'Đã xoá'); },
    async block(o) {
      const me = Env.user().uid;
      await col(COL.FRIENDS).doc(this.pid(me, o)).set({ members: [me, o], status: 'blocked', blockedBy: me, createdAt: TS() });
      toast('success', 'Đã chặn', 'Bạn sẽ không thấy bài viết của người này');
    },
    unblock(o) { return this.remove(o, 'Đã bỏ chặn'); },
    async follow(o) { const me = Env.user().uid; await col(COL.FOLLOW).doc(me + '_' + o).set({ followerUid: me, followingUid: o, createdAt: TS() }); Notify.send(o, 'follow'); toast('success', 'Đã theo dõi'); },
    async unfollow(o) { await col(COL.FOLLOW).doc(Env.user().uid + '_' + o).delete(); toast('success', 'Đã bỏ theo dõi'); },

    personCard(p, extra) {
      return `<div class="soc-person" data-uid="${p.uid}">${UI.avatar(p.photoURL, p.displayName, 56)}<b>${esc(p.displayName)}</b>${UI.levelChip(p.exp)}${extra || ''}</div>`;
    },
    wirePeople(box) {
      $$('.soc-person', box).forEach(c => c.onclick = e => {
        const b = e.target.closest('[data-act]');
        if (!b) return P.openModal(c.dataset.uid);
        e.stopPropagation(); const u = c.dataset.uid, a = b.dataset.act;
        (async () => {
          try {
            if (a === 'dm') Chat.openDM(u); else if (a === 'add') await this.request(u); else if (a === 'accept') await this.accept(u);
            else if (a === 'reject' || a === 'cancel') await this.remove(u, 'Đã xử lý'); else if (a === 'unfriend') await new Promise(r => Modal.confirm('Huỷ kết bạn?', '', async () => { await this.remove(u, 'Đã huỷ kết bạn'); r(); }));
            Social.renderTab();
          } catch (er) { toast('error', 'Lỗi', er.message); }
        })();
      });
    },
    render(box, sub) {
      sub = sub || 'friends';
      const me = Env.user().uid, entries = [...State.friends.entries()];
      const mk = st => entries.filter(([, s]) => s.status === st).map(([u]) => P.get(u)).filter(Boolean);
      const friends = mk('accepted'), incoming = entries.filter(([, s]) => s.status === 'pending' && s.requestedBy !== me).map(([u]) => P.get(u)).filter(Boolean),
        outgoing = entries.filter(([, s]) => s.status === 'pending' && s.requestedBy === me).map(([u]) => P.get(u)).filter(Boolean);
      box.innerHTML = `<div class="soc-subtabs"><button data-s="friends" class="${sub === 'friends' ? 'on' : ''}">Bạn bè (${friends.length})</button><button data-s="req" class="${sub === 'req' ? 'on' : ''}">Lời mời (${incoming.length + outgoing.length})</button></div><div id="socFr"></div>`;
      const inner = $('#socFr', box);
      if (sub === 'friends') inner.innerHTML = friends.length ? `<div class="soc-grid">${friends.map(p => this.personCard(p, '<div class="soc-row"><button class="soc-btn sm primary" data-act="dm"><i class="fa-solid fa-comment-dots"></i></button><button class="soc-btn sm danger" data-act="unfriend"><i class="fa-solid fa-user-minus"></i></button></div>')).join('')}</div>` : UI.empty('fa-user-group', 'Chưa có bạn bè', 'Vào tab "Mọi người" để kết bạn');
      else inner.innerHTML = (incoming.length ? `<h4 class="soc-h">Đã nhận</h4><div class="soc-grid">${incoming.map(p => this.personCard(p, '<div class="soc-row"><button class="soc-btn sm primary" data-act="accept"><i class="fa-solid fa-check"></i></button><button class="soc-btn sm" data-act="reject"><i class="fa-solid fa-xmark"></i></button></div>')).join('')}</div>` : '') +
        (outgoing.length ? `<h4 class="soc-h">Đã gửi</h4><div class="soc-grid">${outgoing.map(p => this.personCard(p, '<button class="soc-btn sm danger" data-act="cancel">Huỷ lời mời</button>')).join('')}</div>` : '') || UI.empty('fa-user-clock', 'Không có lời mời nào');
      this.wirePeople(inner);
      $$('.soc-subtabs button', box).forEach(b => b.onclick = () => this.render(box, b.dataset.s));
    },
    renderPeople(box) {
      const me = Env.user().uid;
      box.innerHTML = `<div class="soc-field"><input type="text" id="socPpl" placeholder="Tìm theo tên..."></div><div id="socPplList"></div>`;
      const draw = () => {
        const t = $('#socPpl', box).value.trim().toLowerCase();
        const list = [...State.profiles.values()].filter(p => p.uid !== me && !State.blocked.has(p.uid) && (!t || (p.displayName || '').toLowerCase().includes(t))).sort((a, b) => (b.exp || 0) - (a.exp || 0)).slice(0, 60);
        const l = $('#socPplList', box);
        l.innerHTML = list.length ? `<div class="soc-grid">${list.map(p => { const s = this.status(p.uid); return this.personCard(p, `<div class="soc-row"><button class="soc-btn sm primary" data-act="dm"><i class="fa-solid fa-comment-dots"></i></button>${!s ? '<button class="soc-btn sm" data-act="add"><i class="fa-solid fa-user-plus"></i></button>' : s.status === 'accepted' ? '<span class="soc-muted sm">Bạn bè</span>' : ''}</div>`); }).join('')}</div>` : UI.empty('fa-users', 'Chưa có ai khác trong cộng đồng', 'Hãy mời bạn bè cùng tham gia!');
        this.wirePeople(l);
      };
      $('#socPpl', box).oninput = debounce(draw, 200); draw();
    }
  };

  /* ======================= 9) CHAT (dùng chung: DM, phòng chung, nhóm) ======================= */
  const Chat = {
    cid: (a, b) => [a, b].sort().join('__'),
    unread() {
      const me = Env.user(); if (!me) return 0;
      return State.convs.filter(c => c.lastFrom && c.lastFrom !== me.uid && ((c.seen || {})[me.uid] || 0) < ms(c.updatedAt)).length;
    },
    // o: {ref, key, metaRef, otherUid, compact, showNames, afterSend, onMessages}
    mount(el, o) {
      const me = Env.user();
      el.innerHTML = `<div class="soc-msgs"></div><div class="soc-typing" hidden>đang nhập…</div>
        <div class="soc-emo" hidden>${EMOJIS.map(e => `<button type="button">${e}</button>`).join('')}</div>
        <div class="soc-inrow"><button type="button" class="soc-ib" data-a="emo" title="Emoji"><i class="fa-regular fa-face-smile"></i></button>
        <button type="button" class="soc-ib" data-a="img" title="Gửi ảnh"><i class="fa-solid fa-image"></i></button><input type="file" accept="image/*" hidden>
        <input type="text" class="soc-txt" placeholder="Nhắn tin..." maxlength="1000"><button type="button" class="soc-ib pri" data-a="send"><i class="fa-solid fa-paper-plane"></i></button></div>`;
      const body = $('.soc-msgs', el), input = $('.soc-txt', el), emo = $('.soc-emo', el), typing = $('.soc-typing', el);
      const send = async payload => {
        if (State.myProfile && State.myProfile.banned) return toast('error', 'Tài khoản đang bị khoá chat');
        if (!rate('msg' + o.key, LIM.MSG_GAP)) return;
        const data = Object.assign({ from: me.uid, fromName: me.displayName || 'Ẩn danh', fromPhoto: me.photoURL || '', text: '', image: null, createdAt: TS() }, payload);
        try { await o.ref.add(data); if (o.afterSend) o.afterSend(data); } catch (e) { toast('error', 'Không gửi được', e.message); }
      };
      const doSend = () => { const t = input.value.trim(); if (!t) return; input.value = ''; send({ text: t }); };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } };
      $('[data-a=send]', el).onclick = doSend;
      $('[data-a=emo]', el).onclick = () => emo.hidden = !emo.hidden;
      $$('button', emo).forEach(b => b.onclick = () => { input.value += b.textContent; input.focus(); });
      const fi = $('input[type=file]', el);
      $('[data-a=img]', el).onclick = () => fi.click();
      fi.onchange = async () => { const f = fi.files[0]; fi.value = ''; if (!f) return; try { send({ image: await compressImage(f, 700, 160000) }); } catch (e) { toast('error', 'Lỗi ảnh', e.message); } };

      let lastTyping = 0;
      if (o.metaRef) input.addEventListener('input', () => { const n = Date.now(); if (n - lastTyping > 2500) { lastTyping = n; o.metaRef.set({ typing: { [me.uid]: n } }, { merge: true }).catch(() => { }); } });

      const un1 = o.ref.orderBy('createdAt', 'asc').limitToLast(100).onSnapshot(snap => {
        const msgs = snap.docs.map(docData), stick = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
        body.innerHTML = msgs.length ? msgs.map(m => {
          const mine = m.from === me.uid;
          return `<div class="soc-m ${mine ? 'me' : ''}">${!mine && o.showNames ? `<span class="soc-m-n" data-uid="${esc(m.from)}">${esc(m.fromName)}</span>` : ''}${m.image ? `<img src="${m.image}" class="soc-m-img">` : ''}${m.text ? `<div class="soc-m-b">${md(m.text)}</div>` : ''}<span class="soc-m-t">${timeAgo(m.createdAt)}</span></div>`;
        }).join('') : '<div class="soc-muted soc-center">Hãy bắt đầu cuộc trò chuyện 👋</div>';
        if (stick || !body.dataset.init) body.scrollTop = body.scrollHeight; body.dataset.init = '1';
        $$('.soc-m-n', body).forEach(n => n.onclick = () => P.openModal(n.dataset.uid));
        $$('.soc-m-img', body).forEach(i => i.onclick = () => Modal.open(`<img src="${i.src}" style="max-width:100%;border-radius:10px">`, { wide: true }));
        if (o.onMessages) o.onMessages(msgs);
      }, onErr('chat'));
      let un2 = null, tm = null;
      if (o.metaRef) un2 = o.metaRef.onSnapshot(s => {
        const t = ((s.data() || {}).typing || {})[o.otherUid]; const on = t && Date.now() - t < 4500;
        typing.hidden = !on; clearTimeout(tm); if (on) tm = setTimeout(() => typing.hidden = true, 4600);
      }, () => { });
      R.attach(o.key, () => { un1(); if (un2) un2(); clearTimeout(tm); });
    },

    async openDM(other) {
      const me = Env.user(); if (!other || other === me.uid) return;
      const id = this.cid(me.uid, other);
      if (State.openDMs.has(id)) { const w = State.openDMs.get(id); w.classList.remove('min'); const i = $('.soc-txt', w); if (i) i.focus(); return; }
      const op = await P.fetch(other), cref = col(COL.CONVS).doc(id);
      try {
        await cref.set({ members: [me.uid, other], names: { [me.uid]: me.displayName || '', [other]: (op && op.displayName) || '' }, photos: { [me.uid]: me.photoURL || '', [other]: (op && op.photoURL) || '' } }, { merge: true });
      } catch (e) { return toast('error', 'Không mở được cuộc trò chuyện', e.message); }
      let dock = $('#socDock'); if (!dock) { dock = document.createElement('div'); dock.id = 'socDock'; document.body.appendChild(dock); }
      const w = document.createElement('div'); w.className = 'soc-win';
      w.innerHTML = `<div class="soc-win-h">${UI.avatar(op && op.photoURL, op && op.displayName, 30)}<b>${esc((op && op.displayName) || 'Người dùng')}</b><button class="soc-ib sm" data-a="min"><i class="fa-solid fa-minus"></i></button><button class="soc-ib sm" data-a="x"><i class="fa-solid fa-xmark"></i></button></div><div class="soc-win-b"></div>`;
      dock.appendChild(w); State.openDMs.set(id, w);
      const markSeen = () => cref.set({ seen: { [me.uid]: Date.now() } }, { merge: true }).catch(() => { });
      $('.soc-win-h', w).onclick = e => { if (e.target.closest('[data-a=x]')) { R.detach('dm_' + id); State.openDMs.delete(id); w.remove(); return; } w.classList.toggle('min'); if (!w.classList.contains('min')) markSeen(); };
      this.mount($('.soc-win-b', w), {
        ref: cref.collection('messages'), key: 'dm_' + id, metaRef: cref, otherUid: other, compact: true,
        afterSend: d => cref.set({ members: [me.uid, other], lastMessage: d.text || '[Hình ảnh]', lastFrom: me.uid, updatedAt: TS(), seen: { [me.uid]: Date.now() } }, { merge: true }).catch(() => { }),
        onMessages: msgs => { const l = msgs[msgs.length - 1]; if (l && l.from !== me.uid && !w.classList.contains('min')) markSeen(); }
      });
      const i = $('.soc-txt', w); if (i) i.focus();
    },
    renderList(box) {
      const me = Env.user().uid;
      if (!State.convs.length) return box.innerHTML = UI.empty('fa-comment-dots', 'Chưa có cuộc trò chuyện nào', 'Vào "Mọi người" hoặc hồ sơ ai đó để nhắn tin');
      box.innerHTML = State.convs.map(c => {
        const o = (c.members || []).find(x => x !== me), unread = c.lastFrom && c.lastFrom !== me && ((c.seen || {})[me] || 0) < ms(c.updatedAt);
        return `<div class="soc-conv ${unread ? 'unread' : ''}" data-uid="${esc(o)}">${UI.avatar((c.photos || {})[o], (c.names || {})[o], 46)}<div><b>${esc((c.names || {})[o] || 'Người dùng')}</b><span>${c.lastFrom === me ? 'Bạn: ' : ''}${esc((c.lastMessage || '').slice(0, 50))}</span></div><em>${timeAgo(c.updatedAt)}</em></div>`;
      }).join('');
      $$('.soc-conv', box).forEach(c => c.onclick = () => Chat.openDM(c.dataset.uid));
    }
  };

  /* ======================= 10) BÀI VIẾT ======================= */
  const Posts = {
    link: id => location.origin + location.pathname + '#social-post-' + id,
    async react(p, key) {
      const me = Env.user().uid, my = (p.reactions || {})[me], ref = col(COL.POSTS).doc(p.id);
      if (my === key) return ref.update({ ['reactions.' + me]: FV().delete() });
      await ref.update({ ['reactions.' + me]: key });
      if (!my) { P.addExp(1, 'likeGiven'); Notify.send(p.uid, 'like', { postId: p.id, excerpt: (p.content || '').slice(0, 60) }); }
    },
    async toggleSave(p) {
      const me = Env.user().uid, saved = (State.myProfile && State.myProfile.savedIds || []).includes(p.id);
      await col(COL.PROFILES).doc(me).update({ savedIds: saved ? FV().arrayRemove(p.id) : FV().arrayUnion(p.id) });
      toast('success', saved ? 'Đã bỏ lưu' : 'Đã lưu bài viết');
    },
    async remove(p) {
      await col(COL.POSTS).doc(p.id).delete();
      if (p.uid === Env.user().uid) P.addExp(-10, 'postCount');
      try { const s = await col(COL.COMMENTS).where('postId', '==', p.id).get(); const b = Env.db().batch(); s.docs.slice(0, 400).forEach(d => b.delete(d.ref)); await b.commit(); } catch (e) { }
      toast('success', 'Đã xoá bài viết');
    },
    report(type, id) {
      Modal.form({
        title: 'Báo cáo nội dung', submit: 'Gửi báo cáo',
        fields: [{ id: 'r', label: 'Lý do', type: 'select', options: ['Spam', 'Nội dung nhạy cảm', 'Sai sự thật / gây hiểu lầm', 'Quấy rối', 'Khác'].map(x => [x, x]) }, { id: 'd', label: 'Mô tả thêm (không bắt buộc)', type: 'textarea', rows: 3, max: 300 }],
        onSubmit: async v => { const u = Env.user(); await col(COL.REPORTS).add({ targetType: type, targetId: id, reason: v.r, detail: v.d, reporterUid: u.uid, reporterName: u.displayName || '', status: 'open', createdAt: TS() }); toast('success', 'Đã gửi báo cáo', 'Quản trị viên sẽ xem xét'); }
      });
    },
    edit(p) {
      Modal.form({ title: 'Chỉnh sửa bài viết', fields: [{ id: 'c', label: 'Nội dung', type: 'textarea', rows: 6, max: 5000, value: p.content }], onSubmit: async v => { await col(COL.POSTS).doc(p.id).update({ content: v.c.slice(0, 5000), hashtags: hashtagsOf(v.c), edited: true, updatedAt: TS() }); toast('success', 'Đã cập nhật'); } });
    },
    share(p) {
      Modal.open(`<h3><i class="fa-solid fa-share"></i> Chia sẻ bài viết</h3><div class="soc-col"><button class="soc-btn block" id="shCopy"><i class="fa-solid fa-link"></i> Sao chép liên kết</button><button class="soc-btn primary block" id="shFeed"><i class="fa-solid fa-retweet"></i> Chia sẻ lại lên bảng tin</button></div>`);
      $('#shCopy').onclick = async () => { await copy(Posts.link(p.id)); toast('success', 'Đã sao chép liên kết'); };
      $('#shFeed').onclick = () => { $$('.soc-ov').forEach(x => x.remove()); Modal.form({ title: 'Chia sẻ lại', submit: 'Đăng', fields: [{ id: 'c', label: 'Bạn nghĩ gì về bài này? (không bắt buộc)', type: 'textarea', rows: 3 }], onSubmit: async v => { await Posts.create(v.c.trim(), { shared: { postId: p.id, uid: p.uid, name: p.displayName, content: (p.content || '').slice(0, 300), image: (p.images || [])[0] || null } }, {}); col(COL.POSTS).doc(p.id).update({ shareCount: FV().increment(1) }).catch(() => { }); Notify.send(p.uid, 'share', { postId: p.id }); toast('success', 'Đã chia sẻ'); } }); };
    },
    async create(content, st, ctx) {
      const u = Env.user();
      if (State.myProfile && State.myProfile.banned) throw new Error('Tài khoản của bạn đang bị khoá đăng bài');
      const imgs = st.images || [], file = st.file || null;
      if (JSON.stringify([imgs, file]).length > LIM.DOC_CHARS) throw new Error('Tổng dung lượng ảnh/file quá lớn (~900KB). Hãy bớt ảnh/file.');
      const data = {
        uid: u.uid, displayName: u.displayName || 'Ẩn danh', photoURL: u.photoURL || '', content: (content || '').slice(0, 5000),
        images: imgs, file, code: st.code || '', link: st.link || '', poll: st.poll || null, pollVotes: {}, shared: st.shared || null,
        hashtags: hashtagsOf(content), groupId: (ctx && ctx.groupId) || null, type: st.question ? 'discussion' : 'post',
        reactions: {}, commentCount: 0, shareCount: 0, pinned: false, bestAnswerId: null, edited: false, createdAt: TS(), updatedAt: TS()
      };
      const ref = await col(COL.POSTS).add(data);
      P.addExp(10, 'postCount');
      if (data.groupId) col(COL.GROUPS).doc(data.groupId).update({ postCount: FV().increment(1) }).catch(() => { });
      return ref.id;
    },
    async openSingle(id) {
      const s = await col(COL.POSTS).doc(id).get();
      if (!s.exists) return toast('error', 'Bài viết không tồn tại hoặc đã bị xoá');
      const m = Modal.open('<div id="socSingle"></div>', { wide: true, onClose: () => R.detach('tab_single') });
      Feed.create($('#socSingle', m.el), { mode: 'single', postId: id });
    },

    html(p) {
      const me = Env.user().uid, rx = p.reactions || {}, my = rx[me] || null, counts = {};
      Object.values(rx).forEach(k => counts[k] = (counts[k] || 0) + 1);
      const total = Object.values(counts).reduce((a, b) => a + b, 0), md_ = REACTIONS.find(r => r.key === my);
      const top = REACTIONS.filter(r => counts[r.key]).sort((a, b) => counts[b.key] - counts[a.key]).slice(0, 3);
      const saved = (State.myProfile && State.myProfile.savedIds || []).includes(p.id);
      const prof = P.get(p.uid), isDis = p.type === 'discussion';
      let media = '';
      if (p.shared) media += `<div class="soc-shared" data-open="${esc(p.shared.postId)}"><b>${esc(p.shared.name)}</b><div>${md(p.shared.content)}</div>${p.shared.image ? `<img src="${p.shared.image}" loading="lazy">` : ''}</div>`;
      if (p.images && p.images.length) media += `<div class="soc-imgs g${Math.min(p.images.length, 4)}">${p.images.slice(0, 4).map((s, i) => `<div class="soc-img" data-i="${i}"><img src="${s}" loading="lazy">${i === 3 && p.images.length > 4 ? `<span>+${p.images.length - 4}</span>` : ''}</div>`).join('')}</div>`;
      if (p.code) media += `<pre class="soc-code">${esc(p.code)}</pre>`;
      if (p.file) media += `<a class="soc-chip" href="${p.file.dataUrl}" download="${esc(p.file.name)}"><i class="fa-solid fa-file-arrow-down"></i> ${esc(p.file.name)} <span class="soc-muted sm">(${Math.round((p.file.size || 0) / 1024)} KB)</span></a>`;
      if (p.link) media += `<a class="soc-chip" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer nofollow"><i class="fa-solid fa-link"></i> ${esc(p.link)}</a>`;
      if (p.poll) {
        const votes = p.pollVotes || {}, tv = Object.keys(votes).length, mine = votes[me];
        media += `<div class="soc-poll"><b>${esc(p.poll.question)}</b>${p.poll.options.map((o, i) => { const n = Object.values(votes).filter(v => v === i).length, pc = tv ? Math.round(n / tv * 100) : 0; return `<button class="soc-po ${mine === i ? 'on' : ''}" data-v="${i}"><i style="width:${pc}%"></i><span>${esc(o)}</span><em>${pc}% (${n})</em></button>`; }).join('')}<span class="soc-muted sm">${tv} lượt bình chọn</span></div>`;
      }
      return `<article class="soc-card soc-post" data-id="${p.id}">
        ${p.pinned ? '<div class="soc-pin"><i class="fa-solid fa-thumbtack"></i> Đã ghim</div>' : ''}
        <div class="soc-ph"><div class="soc-pu" data-uid="${p.uid}">${UI.avatar((prof && prof.photoURL) || p.photoURL, (prof && prof.displayName) || p.displayName, 44)}
          <div><b>${esc((prof && prof.displayName) || p.displayName)}</b>${prof && prof.role === 'admin' ? ' <i class="fa-solid fa-shield-halved soc-adm"></i>' : ''}<div class="soc-muted sm">${timeAgo(p.createdAt)}${p.edited ? ' · đã sửa' : ''}${isDis ? ' · <span class="soc-q"><i class="fa-solid fa-circle-question"></i> Câu hỏi thảo luận</span>' : ''}${p.groupId ? ' · <i class="fa-solid fa-people-group"></i>' : ''}</div></div></div>
          <button class="soc-ib" data-a="menu"><i class="fa-solid fa-ellipsis"></i></button></div>
        ${p.content ? `<div class="soc-pc">${md(p.content)}</div>` : ''}${media}
        <div class="soc-pstat"><span>${total ? top.map(r => r.emoji).join('') + ' ' + total : 'Chưa có lượt tương tác'}</span><span data-a="cm" class="lnk">${p.commentCount || 0} bình luận · ${p.shareCount || 0} chia sẻ</span></div>
        <div class="soc-pact">
          <div class="soc-rx"><button class="soc-act ${my ? 'on' : ''}" data-a="like" style="${md_ ? 'color:' + md_.color : ''}">${md_ ? md_.emoji + ' ' + md_.label : '<i class="fa-regular fa-thumbs-up"></i> Thích'}</button>
            <div class="soc-rxp">${REACTIONS.map(r => `<button data-r="${r.key}" title="${r.label}">${r.emoji}</button>`).join('')}</div></div>
          <button class="soc-act" data-a="cm"><i class="fa-regular fa-comment"></i> Bình luận</button>
          <button class="soc-act" data-a="share"><i class="fa-solid fa-share"></i> Chia sẻ</button>
          <button class="soc-act ${saved ? 'on' : ''}" data-a="save"><i class="fa-${saved ? 'solid' : 'regular'} fa-bookmark"></i> Lưu</button>
        </div>
        <div class="soc-cms" hidden></div></article>`;
    },
    wire(el, p, inst) {
      const me = Env.user().uid, owner = p.uid === me, admin = Env.isAdmin();
      $('.soc-pu', el).onclick = () => P.openModal(p.uid);
      $$('.soc-tag', el).forEach(a => a.onclick = () => Social.searchTag(a.dataset.tag));
      $$('.soc-img', el).forEach(i => i.onclick = () => Posts.lightbox(p.images, +i.dataset.i));
      $$('[data-open]', el).forEach(s => s.onclick = () => Posts.openSingle(s.dataset.open));
      $$('.soc-po', el).forEach(b => b.onclick = () => col(COL.POSTS).doc(p.id).update({ ['pollVotes.' + me]: +b.dataset.v }).catch(e => toast('error', 'Lỗi', e.message)));
      const act = {
        like: () => Posts.react(p, 'like'), share: () => Posts.share(p), save: () => Posts.toggleSave(p),
        cm: () => Comments.toggle(el, p, inst),
        menu: () => {
          const it = [{ label: 'Sao chép liên kết', icon: 'fa-link', on: async () => { await copy(Posts.link(p.id)); toast('success', 'Đã sao chép liên kết'); } }];
          if (owner) it.push({ label: 'Chỉnh sửa', icon: 'fa-pen', on: () => Posts.edit(p) });
          if (owner || admin) it.push({ label: p.pinned ? 'Bỏ ghim' : 'Ghim bài viết', icon: 'fa-thumbtack', on: () => col(COL.POSTS).doc(p.id).update({ pinned: !p.pinned }) });
          if (!owner) { it.push({ label: 'Báo cáo', icon: 'fa-flag', danger: true, on: () => Posts.report('post', p.id) }); it.push({ label: 'Chặn người này', icon: 'fa-ban', danger: true, on: () => Modal.confirm('Chặn người này?', 'Bạn sẽ không còn thấy bài viết của họ.', () => Friends.block(p.uid)) }); }
          if (owner || admin) { it.push({ div: true }); it.push({ label: admin && !owner ? '[Admin] Xoá bài viết' : 'Xoá bài viết', icon: 'fa-trash', danger: true, on: () => Modal.confirm('Xoá bài viết?', 'Không thể hoàn tác.', () => Posts.remove(p)) }); }
          dropdown($('[data-a=menu]', el), it);
        }
      };
      const touch = window.matchMedia && matchMedia('(hover:none)').matches, pop = $('.soc-rxp', el);
      $$('[data-a]', el).forEach(b => {
        if (b.closest('.soc-cms') || !act[b.dataset.a]) return;
        b.onclick = e => {
          e.stopPropagation();
          if (b.dataset.a === 'like' && touch) { pop.classList.toggle('show'); return; }
          Promise.resolve(act[b.dataset.a]()).catch(er => toast('error', 'Lỗi', er.message));
        };
      });
      $$('[data-r]', el).forEach(b => b.onclick = e => { e.stopPropagation(); pop.classList.remove('show'); Posts.react(p, b.dataset.r).catch(er => toast('error', 'Lỗi', er.message)); });
    },
    lightbox(imgs, i) {
      const m = Modal.open(''); const body = $('.soc-modal > div', m.el);
      const draw = () => { body.innerHTML = `<div class="soc-lb"><img src="${imgs[i]}">${imgs.length > 1 ? '<button class="soc-lbn l"><i class="fa-solid fa-chevron-left"></i></button><button class="soc-lbn r"><i class="fa-solid fa-chevron-right"></i></button>' : ''}</div>`; const l = $('.l', body), r = $('.r', body); if (l) l.onclick = () => { i = (i - 1 + imgs.length) % imgs.length; draw(); }; if (r) r.onclick = () => { i = (i + 1) % imgs.length; draw(); }; };
      draw();
    }
  };

  /* ======================= 11) COMMENTS ======================= */
  const Comments = {
    toggle(el, p, inst) {
      const sec = $('.soc-cms', el);
      if (!sec.hidden) { sec.hidden = true; inst.open.delete(p.id); R.detach('tab_cm_' + p.id); return; }
      this.open(el, p, inst);
    },
    open(el, p, inst) {
      const sec = $('.soc-cms', el); sec.hidden = false; inst.open.add(p.id);
      sec.innerHTML = UI.skeleton(1);
      const un = col(COL.COMMENTS).where('postId', '==', p.id).onSnapshot(snap => {
        const f = sec.querySelector('input:focus');
        if (f && f.value) return; // đang gõ dở thì không vẽ lại
        this.render(sec, p, snap.docs.map(docData));
      }, onErr('comments'));
      R.attach('tab_cm_' + p.id, un);
    },
    tree(list) {
      const map = {}, roots = []; list.forEach(c => { c.kids = []; map[c.id] = c; });
      list.forEach(c => (c.parentId && map[c.parentId]) ? map[c.parentId].kids.push(c) : roots.push(c));
      const sort = a => { a.sort((x, y) => (x.id === this._best ? -1 : y.id === this._best ? 1 : ms(x.createdAt) - ms(y.createdAt))); a.forEach(c => sort(c.kids)); };
      sort(roots); return roots;
    },
    node(c, p, depth) {
      const me = Env.user().uid, mine = c.uid === me, rx = c.reactions || {}, n = Object.keys(rx).length, best = p.bestAnswerId === c.id;
      return `<div class="soc-cn" style="--d:${Math.min(depth, 4)}" data-id="${c.id}"><div class="soc-cr">${UI.avatar(c.photoURL, c.displayName, 32)}
        <div class="soc-cb ${best ? 'best' : ''}">${best ? '<div class="soc-bestf"><i class="fa-solid fa-circle-check"></i> Câu trả lời hay nhất</div>' : ''}
          <b class="soc-cu" data-uid="${esc(c.uid)}">${esc(c.displayName)}</b><div class="soc-ct">${c.deleted ? '<i>[Bình luận đã bị xoá]</i>' : md(c.content)}</div>
          <div class="soc-cm"><span>${timeAgo(c.createdAt)}${c.edited ? ' · đã sửa' : ''}</span>
            ${c.deleted ? '' : `<button data-c="like" class="${rx[me] ? 'on' : ''}"><i class="fa-${rx[me] ? 'solid' : 'regular'} fa-thumbs-up"></i> ${n || ''}</button><button data-c="reply">Trả lời</button>
            ${p.type === 'discussion' && p.uid === me ? `<button data-c="best">${best ? 'Bỏ hay nhất' : 'Chọn hay nhất'}</button>` : ''}
            ${mine ? '<button data-c="edit">Sửa</button>' : '<button data-c="report">Báo cáo</button>'}
            ${(mine || Env.isAdmin()) ? '<button data-c="del">Xoá</button>' : ''}`}</div>
          <div class="soc-rb" hidden></div></div></div>
        ${c.kids.length ? `<div>${c.kids.map(k => this.node(k, p, depth + 1)).join('')}</div>` : ''}</div>`;
    },
    render(sec, p, list) {
      this._best = p.bestAnswerId; const tree = this.tree(list), u = Env.user();
      sec.innerHTML = `<div class="soc-cin">${UI.avatar(u.photoURL, u.displayName, 32)}<input type="text" class="soc-ci" placeholder="${p.type === 'discussion' ? 'Viết câu trả lời...' : 'Viết bình luận...'}" maxlength="2000"><button class="soc-btn sm primary" data-c="send"><i class="fa-solid fa-paper-plane"></i></button></div>
        <div>${tree.length ? tree.map(c => this.node(c, p, 0)).join('') : '<div class="soc-muted sm">Chưa có bình luận nào. Hãy là người đầu tiên!</div>'}</div>`;
      const byId = {}; list.forEach(c => byId[c.id] = c);
      const post = async (parent, input) => { const v = input.value.trim(); if (!v) return; input.disabled = true; try { await this.add(p, parent, v); input.value = ''; } catch (e) { toast('error', 'Không gửi được', e.message); } input.disabled = false; input.focus(); };
      const top = $('.soc-ci', sec); top.onkeydown = e => { if (e.key === 'Enter') post(null, top); }; $('[data-c=send]', sec).onclick = () => post(null, top);
      $$('.soc-cu', sec).forEach(x => x.onclick = () => P.openModal(x.dataset.uid));
      $$('[data-c]', sec).forEach(b => {
        const id = b.closest('.soc-cn') && b.closest('.soc-cn').dataset.id, c = byId[id]; if (!c) return;
        const a = b.dataset.c;
        b.onclick = async e => {
          e.stopPropagation(); const me = Env.user().uid;
          try {
            if (a === 'like') await col(COL.COMMENTS).doc(id).update({ ['reactions.' + me]: (c.reactions || {})[me] ? FV().delete() : 'like' });
            else if (a === 'reply') {
              const box = $('.soc-rb', b.closest('.soc-cb')); box.hidden = !box.hidden;
              if (!box.hidden) { box.innerHTML = `<div class="soc-cin"><input type="text" class="soc-ci" placeholder="Trả lời ${esc(c.displayName)}..." maxlength="2000"><button class="soc-btn sm primary">Gửi</button></div>`; const inp = $('input', box); inp.focus(); inp.onkeydown = ev => { if (ev.key === 'Enter') post(c, inp); }; $('button', box).onclick = () => post(c, inp); }
            }
            else if (a === 'edit') Modal.form({ title: 'Sửa bình luận', fields: [{ id: 'c', label: 'Nội dung', type: 'textarea', rows: 3, value: c.content }], onSubmit: v => col(COL.COMMENTS).doc(id).update({ content: v.c.trim().slice(0, 2000), edited: true }) });
            else if (a === 'del') Modal.confirm('Xoá bình luận?', '', async () => { await col(COL.COMMENTS).doc(id).update({ deleted: true, content: '' }); col(COL.POSTS).doc(p.id).update({ commentCount: FV().increment(-1) }).catch(() => { }); });
            else if (a === 'report') Posts.report('comment', id);
            else if (a === 'best') {
              const unset = p.bestAnswerId === id;
              await col(COL.POSTS).doc(p.id).update({ bestAnswerId: unset ? null : id });
              if (!unset) Notify.send(c.uid, 'best_answer', { postId: p.id });
            }
          } catch (er) { toast('error', 'Lỗi', er.message); }
        };
      });
    },
    async add(p, parent, text) {
      const u = Env.user();
      if (State.myProfile && State.myProfile.banned) throw new Error('Tài khoản đang bị khoá bình luận');
      if (!rate('cm', LIM.CMT_GAP)) throw new Error('Vui lòng đợi vài giây');
      await col(COL.COMMENTS).add({ postId: p.id, parentId: parent ? parent.id : null, uid: u.uid, displayName: u.displayName || 'Ẩn danh', photoURL: u.photoURL || '', content: text.slice(0, 2000), reactions: {}, deleted: false, edited: false, createdAt: TS() });
      col(COL.POSTS).doc(p.id).update({ commentCount: FV().increment(1) }).catch(() => { });
      P.addExp(4, 'commentCount');
      if (parent) Notify.send(parent.uid, 'reply', { postId: p.id, excerpt: text.slice(0, 60) });
      if (!parent || parent.uid !== p.uid) Notify.send(p.uid, 'comment', { postId: p.id, excerpt: text.slice(0, 60) });
    }
  };

  /* ======================= 12) COMPOSER ======================= */
  const Composer = {
    html() {
      const u = Env.user();
      return `<div class="soc-card soc-comp"><div class="soc-row top">${UI.avatar(u.photoURL, u.displayName, 42)}<textarea class="soc-ta" rows="3" maxlength="5000" placeholder="Bạn đang nghĩ gì? Hỗ trợ **đậm**, *nghiêng*, \`code\`, #hashtag"></textarea></div>
        <div class="soc-prev"></div>
        <div class="soc-row wrap tools"><button class="soc-ib" data-t="img" title="Ảnh"><i class="fa-solid fa-image"></i></button><button class="soc-ib" data-t="file" title="Tệp"><i class="fa-solid fa-paperclip"></i></button>
          <button class="soc-ib" data-t="code" title="Code"><i class="fa-solid fa-code"></i></button><button class="soc-ib" data-t="poll" title="Bình chọn"><i class="fa-solid fa-square-poll-vertical"></i></button>
          <button class="soc-ib" data-t="link" title="Liên kết"><i class="fa-solid fa-link"></i></button><button class="soc-ib" data-t="emo" title="Emoji"><i class="fa-regular fa-face-smile"></i></button>
          <label class="soc-qlabel"><input type="checkbox" class="soc-qchk"> Đăng dưới dạng câu hỏi</label>
          <input type="file" accept="image/*" multiple hidden data-f="img"><input type="file" hidden data-f="file" accept=".pdf,.doc,.docx,.zip,.rar,.txt,.xlsx,.pptx"></div>
        <div class="soc-emo" hidden>${EMOJIS.map(e => `<button type="button">${e}</button>`).join('')}</div>
        <div class="soc-row between wrap"><div class="soc-row wrap">${HASHTAGS.map(h => `<button class="soc-pill" data-h="${h}">#${h}</button>`).join('')}</div><button class="soc-btn primary" data-t="post"><i class="fa-solid fa-paper-plane"></i> Đăng bài</button></div></div>`;
    },
    wire(box, ctx) {
      const st = { images: [], file: null, code: '', link: '', poll: null }, ta = $('.soc-ta', box), prev = $('.soc-prev', box), emo = $('.soc-emo', box);
      const draw = () => {
        prev.innerHTML = (st.images.length ? `<div class="soc-pimgs">${st.images.map((s, i) => `<div><img src="${s}"><button data-x="img" data-i="${i}">×</button></div>`).join('')}</div>` : '') +
          (st.file ? `<div class="soc-pchip"><i class="fa-solid fa-file"></i> ${esc(st.file.name)}<button data-x="file">×</button></div>` : '') +
          (st.code ? `<div class="soc-pchip"><i class="fa-solid fa-code"></i> Code (${st.code.length} ký tự)<button data-x="code">×</button></div>` : '') +
          (st.poll ? `<div class="soc-pchip"><i class="fa-solid fa-square-poll-vertical"></i> ${esc(st.poll.question)} (${st.poll.options.length} lựa chọn)<button data-x="poll">×</button></div>` : '') +
          (st.link ? `<div class="soc-pchip"><i class="fa-solid fa-link"></i> ${esc(st.link)}<button data-x="link">×</button></div>` : '');
        $$('[data-x]', prev).forEach(b => b.onclick = () => { const k = b.dataset.x; if (k === 'img') st.images.splice(+b.dataset.i, 1); else st[k] = (k === 'code' || k === 'link') ? '' : null; draw(); });
      };
      $$('.soc-emo button', box).forEach(b => b.onclick = () => { ta.value += b.textContent; ta.focus(); });
      $$('[data-h]', box).forEach(b => b.onclick = () => { ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '#' + b.dataset.h + ' '; ta.focus(); });
      $$('.tools [data-t]', box).forEach(b => b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'img') $('[data-f=img]', box).click(); else if (t === 'file') $('[data-f=file]', box).click(); else if (t === 'emo') emo.hidden = !emo.hidden;
        else if (t === 'code') Modal.form({ title: 'Thêm đoạn code', fields: [{ id: 'c', label: 'Code', type: 'textarea', rows: 8, max: 4000 }], onSubmit: v => { st.code = v.c; draw(); } });
        else if (t === 'link') Modal.form({ title: 'Đính kèm liên kết', fields: [{ id: 'u', label: 'URL (http/https)', ph: 'https://...' }], onSubmit: v => { if (!/^https?:\/\//i.test(v.u.trim())) { toast('error', 'URL không hợp lệ', 'Phải bắt đầu bằng http:// hoặc https://'); return false; } st.link = v.u.trim().slice(0, 500); draw(); } });
        else if (t === 'poll') Modal.form({ title: 'Tạo bình chọn', fields: [{ id: 'q', label: 'Câu hỏi', max: 200 }, { id: 'o', label: 'Các lựa chọn (mỗi dòng 1 lựa chọn, 2–8)', type: 'textarea', rows: 5, max: 600 }], onSubmit: v => { const o = v.o.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8); if (!v.q.trim() || o.length < 2) { toast('error', 'Cần câu hỏi và ít nhất 2 lựa chọn'); return false; } st.poll = { question: v.q.trim(), options: o }; draw(); } });
      });
      $('[data-f=img]', box).onchange = async e => {
        for (const f of Array.from(e.target.files).slice(0, 4 - st.images.length)) { try { st.images.push(await compressImage(f, LIM.IMG_DIM, LIM.IMG_CHARS)); } catch (er) { toast('error', 'Lỗi ảnh', er.message); } }
        e.target.value = ''; draw();
      };
      $('[data-f=file]', box).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { st.file = { name: f.name, size: f.size, dataUrl: await fileToData(f, LIM.FILE_CHARS) }; draw(); } catch (er) { toast('error', 'Lỗi tệp', er.message); } };
      const btn = $('[data-t=post]', box);
      btn.onclick = async () => {
        const text = ta.value.trim();
        if (!text && !st.images.length && !st.file && !st.code && !st.poll && !st.link) return toast('error', 'Bài viết trống', 'Hãy nhập nội dung hoặc đính kèm gì đó');
        if (!rate('post', LIM.POST_GAP)) return;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đăng...';
        try {
          await Posts.create(text, Object.assign({}, st, { question: $('.soc-qchk', box).checked }), ctx);
          ta.value = ''; st.images = []; st.file = null; st.code = ''; st.link = ''; st.poll = null; $('.soc-qchk', box).checked = false; draw();
          toast('success', 'Đã đăng bài', 'Bài viết của bạn đã lên bảng tin');
        } catch (e) { console.error(e); toast('error', 'Đăng bài thất bại', e.message); }
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Đăng bài';
      };
    }
  };

  /* ======================= 13) FEED (home / group / saved / single) ======================= */
  const Feed = {
    create(box, ctx) {
      const inst = { ctx, shown: LIM.PAGE, filter: ctx.mode === 'home' && State.pendingSearch === '' && ctx.filter ? ctx.filter : 'newest', search: '', cards: new Map(), open: new Set(), groupPosts: [], single: null, extra: new Map() };
      if (State.pendingSearch) { inst.search = State.pendingSearch; State.pendingSearch = ''; }
      const tools = ctx.mode === 'home' || ctx.mode === 'group';
      box.innerHTML = (tools ? Composer.html() : '') + (tools ? `<div class="soc-filters"><input type="text" class="soc-fs" placeholder="Lọc bài viết hoặc #hashtag..." value="${esc(inst.search)}">
        ${[['newest', 'fa-clock', 'Mới nhất'], ['mostLiked', 'fa-fire', 'Nhiều tương tác'], ['mostComment', 'fa-comments', 'Nhiều bình luận'], ['following', 'fa-user-check', 'Đang theo dõi'], ['question', 'fa-circle-question', 'Câu hỏi'], ['hasImage', 'fa-image', 'Có ảnh'], ['mine', 'fa-user', 'Của tôi']].map(f => `<button class="soc-fchip ${inst.filter === f[0] ? 'on' : ''}" data-f="${f[0]}"><i class="fa-solid ${f[1]}"></i> ${f[2]}</button>`).join('')}</div>` : '') +
        `<div class="soc-list"></div><div class="soc-emp"></div><div class="soc-center"><button class="soc-btn more" hidden>Xem thêm bài viết</button></div>`;
      const list = $('.soc-list', box), emp = $('.soc-emp', box), more = $('.more', box);
      if (tools) { const cb = $('.soc-comp', box); if (cb) Composer.wire(cb, ctx); }
      const me = Env.user().uid;

      const getPosts = () => {
        if (ctx.mode === 'home') return State.homePosts.filter(p => !p.groupId);
        if (ctx.mode === 'group') return inst.groupPosts;
        if (ctx.mode === 'single') return inst.single ? [inst.single] : [];
        const ids = (State.myProfile && State.myProfile.savedIds) || [];
        return ids.map(id => State.homePosts.find(p => p.id === id) || inst.extra.get(id)).filter(Boolean);
      };
      const sig = p => JSON.stringify([p.content, p.edited, p.pinned, p.reactions, p.pollVotes, p.commentCount, p.shareCount, p.bestAnswerId, (State.myProfile && State.myProfile.savedIds || []).includes(p.id), (P.get(p.uid) || {}).displayName, (P.get(p.uid) || {}).photoURL, Math.floor(Date.now() / 600000)]);
      const rxN = p => Object.keys(p.reactions || {}).length;

      const render = () => {
        let l = getPosts().filter(p => !State.blocked.has(p.uid));
        const f = inst.filter;
        if (f === 'following') l = l.filter(p => State.following.has(p.uid) || p.uid === me);
        else if (f === 'question') l = l.filter(p => p.type === 'discussion'); else if (f === 'hasImage') l = l.filter(p => p.images && p.images.length);
        else if (f === 'mine') l = l.filter(p => p.uid === me);
        const t = inst.search.trim().toLowerCase();
        if (t) l = t[0] === '#' ? l.filter(p => (p.hashtags || []).some(h => h.toLowerCase() === t.slice(1))) : l.filter(p => ((p.content || '') + ' ' + (p.displayName || '')).toLowerCase().includes(t));
        l = l.slice();
        if (f === 'mostLiked') l.sort((a, b) => rxN(b) - rxN(a)); else if (f === 'mostComment') l.sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
        else l.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ms(b.createdAt) - ms(a.createdAt));
        const vis = ctx.mode === 'single' ? l : l.slice(0, inst.shown), keep = new Set();
        let cursor = list.firstElementChild;
        vis.forEach(p => {
          const s = sig(p); let c = inst.cards.get(p.id);
          if (!c || c.sig !== s) {
            const w = document.createElement('div'); w.innerHTML = Posts.html(p); const el = w.firstElementChild;
            Posts.wire(el, p, inst); if (c) c.el.remove();
            c = { el, sig: s }; inst.cards.set(p.id, c);
            if (inst.open.has(p.id)) Comments.open(el, p, inst);
          }
          keep.add(p.id);
          if (c.el === cursor) cursor = cursor.nextElementSibling; else list.insertBefore(c.el, cursor);
        });
        [...inst.cards.keys()].forEach(id => { if (!keep.has(id)) { inst.cards.get(id).el.remove(); inst.cards.delete(id); R.detach('tab_cm_' + id); inst.open.delete(id); } });
        more.hidden = !(ctx.mode !== 'single' && l.length > inst.shown);
        emp.innerHTML = vis.length ? '' : (ctx.loaded === false ? UI.skeleton(2) : UI.empty('fa-comments', ctx.mode === 'saved' ? 'Chưa lưu bài viết nào' : 'Chưa có bài viết nào', ctx.mode === 'saved' ? 'Bấm "Lưu" trên bài viết để xem lại sau' : 'Hãy là người đầu tiên chia sẻ điều gì đó!'));
      };
      inst.render = render;
      more.onclick = () => { inst.shown += LIM.PAGE; render(); };
      if (tools) {
        const fs = $('.soc-fs', box); fs.oninput = debounce(() => { inst.search = fs.value; render(); }, 200);
        $$('.soc-fchip', box).forEach(b => b.onclick = () => { $$('.soc-fchip', box).forEach(x => x.classList.remove('on')); b.classList.add('on'); inst.filter = b.dataset.f; inst.shown = LIM.PAGE; render(); });
      }
      if (ctx.mode === 'home') { State.homeSubs.add(render); R.attach('tab_feed', () => State.homeSubs.delete(render)); ctx.loaded = true; }
      else if (ctx.mode === 'group') {
        ctx.loaded = false;
        R.attach('tab_gposts', col(COL.POSTS).where('groupId', '==', ctx.groupId).onSnapshot(s => { inst.groupPosts = s.docs.map(docData); ctx.loaded = true; render(); }, onErr('group posts')));
      } else if (ctx.mode === 'single') {
        R.attach('tab_single', col(COL.POSTS).doc(ctx.postId).onSnapshot(s => { inst.single = s.exists ? docData(s) : null; ctx.loaded = true; render(); }, onErr('post')));
      } else if (ctx.mode === 'saved') {
        const ids = (State.myProfile && State.myProfile.savedIds) || [];
        ids.filter(id => !State.homePosts.find(p => p.id === id)).forEach(id => col(COL.POSTS).doc(id).get().then(s => { if (s.exists) { inst.extra.set(id, docData(s)); render(); } }).catch(() => { }));
        R.attach('tab_saved', () => State.homeSubs.delete(render)); State.homeSubs.add(render);
      }
      render(); return inst;
    }
  };

  /* ======================= 14) NHÓM ======================= */
  const Groups = {
    colors: ['#1478d4', '#16c784', '#f59e0b', '#ef4444', '#a78bfa', '#22d3ee'],
    card(g, me) {
      const mem = (g.members || []).includes(me);
      return `<div class="soc-gcard" data-id="${g.id}"><div class="soc-gcov" style="background:${g.cover || '#1478d4'}"><i class="fa-solid fa-people-group"></i></div><div class="soc-gb"><b>${esc(g.name)}</b><span class="soc-muted sm">${esc((g.description || '').slice(0, 80))}</span><span class="soc-muted sm"><i class="fa-solid fa-user-group"></i> ${(g.members || []).length} thành viên · ${g.postCount || 0} bài viết</span>
        <button class="soc-btn sm ${mem ? '' : 'primary'}" data-j="${g.id}">${mem ? 'Rời nhóm' : '<i class="fa-solid fa-plus"></i> Tham gia'}</button></div></div>`;
    },
    async renderList(box) {
      const me = Env.user().uid;
      box.innerHTML = `<div class="soc-row"><button class="soc-btn primary" id="socNewG"><i class="fa-solid fa-plus"></i> Tạo nhóm mới</button></div><div id="socGL">${UI.skeleton(1)}</div>`;
      $('#socNewG', box).onclick = () => Modal.form({
        title: 'Tạo nhóm mới', submit: 'Tạo nhóm',
        fields: [{ id: 'n', label: 'Tên nhóm', max: 80, ph: 'VD: Ôn thi Kinh tế lượng' }, { id: 'd', label: 'Mô tả', type: 'textarea', rows: 3, max: 300 }],
        onSubmit: async v => { if (!v.n.trim()) { toast('error', 'Thiếu tên nhóm'); return false; } const u = Env.user(); const r = await col(COL.GROUPS).add({ name: v.n.trim().slice(0, 80), description: v.d.trim(), cover: Groups.colors[Math.floor(Math.random() * 6)], members: [u.uid], createdBy: u.uid, postCount: 0, createdAt: TS() }); toast('success', 'Đã tạo nhóm'); Groups.open(r.id); }
      });
      try {
        const snap = await col(COL.GROUPS).limit(100).get(); const gs = snap.docs.map(docData);
        const mine = gs.filter(g => (g.members || []).includes(me)), others = gs.filter(g => !(g.members || []).includes(me));
        const gl = $('#socGL', box);
        gl.innerHTML = `<h4 class="soc-h">Nhóm của tôi</h4>${mine.length ? `<div class="soc-grid">${mine.map(g => this.card(g, me)).join('')}</div>` : UI.empty('fa-people-group', 'Bạn chưa tham gia nhóm nào')}<h4 class="soc-h">Khám phá</h4>${others.length ? `<div class="soc-grid">${others.map(g => this.card(g, me)).join('')}</div>` : UI.empty('fa-compass', 'Chưa có nhóm nào khác')}`;
        $$('.soc-gcard', gl).forEach(c => c.onclick = async e => {
          const j = e.target.closest('[data-j]');
          if (!j) return Groups.open(c.dataset.id);
          const g = gs.find(x => x.id === j.dataset.j), mem = (g.members || []).includes(me);
          await col(COL.GROUPS).doc(g.id).update({ members: mem ? FV().arrayRemove(me) : FV().arrayUnion(me) }).catch(er => toast('error', 'Lỗi', er.message));
          Groups.renderList(box);
        });
      } catch (e) { onErr('groups')(e); $('#socGL', box).innerHTML = UI.empty('fa-triangle-exclamation', 'Không tải được nhóm', e.message); }
    },
    async open(id, sub) {
      const box = $('#socTab'); R.prefix('tab_'); sub = sub || 'posts';
      const s = await col(COL.GROUPS).doc(id).get(); if (!s.exists) { toast('error', 'Nhóm không tồn tại'); return Social.renderTab(); }
      const g = docData(s), me = Env.user().uid, mem = (g.members || []).includes(me);
      box.innerHTML = `<button class="soc-btn sm" id="socGB"><i class="fa-solid fa-arrow-left"></i> Tất cả nhóm</button>
        <div class="soc-card"><div class="soc-gcov lg" style="background:${g.cover}"><i class="fa-solid fa-people-group"></i></div><h3>${esc(g.name)}</h3><p class="soc-muted">${esc(g.description || '')}</p>
        <div class="soc-muted sm">${(g.members || []).length} thành viên · ${g.postCount || 0} bài viết</div><div class="soc-row" style="margin-top:10px"><button class="soc-btn ${mem ? 'danger' : 'primary'}" id="socGJ">${mem ? 'Rời nhóm' : 'Tham gia nhóm'}</button>${Env.isAdmin() || g.createdBy === me ? '<button class="soc-btn danger" id="socGD"><i class="fa-solid fa-trash"></i> Xoá nhóm</button>' : ''}</div></div>
        ${mem ? `<div class="soc-subtabs"><button data-s="posts" class="${sub === 'posts' ? 'on' : ''}">Bảng tin</button><button data-s="chat" class="${sub === 'chat' ? 'on' : ''}">Trò chuyện nhóm</button><button data-s="members" class="${sub === 'members' ? 'on' : ''}">Thành viên</button></div><div id="socGBody"></div>` : UI.empty('fa-lock', 'Hãy tham gia nhóm để xem bảng tin và trò chuyện')}`;
      $('#socGB', box).onclick = () => Social.renderTab();
      $('#socGJ', box).onclick = async () => { await col(COL.GROUPS).doc(id).update({ members: mem ? FV().arrayRemove(me) : FV().arrayUnion(me) }).catch(e => toast('error', 'Lỗi', e.message)); Groups.open(id); };
      const gd = $('#socGD', box); if (gd) gd.onclick = () => Modal.confirm('Xoá nhóm?', 'Không thể hoàn tác.', async () => { await col(COL.GROUPS).doc(id).delete(); Social.renderTab(); });
      if (!mem) return;
      $$('.soc-subtabs button', box).forEach(b => b.onclick = () => Groups.open(id, b.dataset.s));
      const body = $('#socGBody', box);
      if (sub === 'posts') Feed.create(body, { mode: 'group', groupId: id });
      else if (sub === 'chat') { body.innerHTML = '<div class="soc-card soc-room" id="socGR"></div>'; Chat.mount($('#socGR', body), { ref: col(COL.GROUPS).doc(id).collection('messages'), key: 'tab_gchat', showNames: true }); }
      else { const ps = await Promise.all((g.members || []).map(u => P.fetch(u).catch(() => null))); body.innerHTML = `<div class="soc-grid">${ps.filter(Boolean).map(p => Friends.personCard(p)).join('')}</div>`; Friends.wirePeople(body); }
    }
  };

  /* ======================= 15) TAB PHỤ: leaderboard / trending / admin ======================= */
  const Misc = {
    leaderboard(box, metric) {
      metric = metric || 'exp';
      const labels = { exp: 'EXP', postCount: 'bài viết', commentCount: 'bình luận' };
      const list = [...State.profiles.values()].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 30);
      box.innerHTML = `<div class="soc-subtabs">${Object.keys(labels).map(k => `<button data-s="${k}" class="${k === metric ? 'on' : ''}">${k === 'exp' ? 'EXP' : k === 'postCount' ? 'Bài viết' : 'Bình luận'}</button>`).join('')}</div>` +
        (list.length ? list.map((p, i) => `<div class="soc-lrow ${i < 3 ? 'top' : ''}" data-uid="${p.uid}"><span class="soc-rk">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${UI.avatar(p.photoURL, p.displayName, 40)}<div><b>${esc(p.displayName)}</b>${UI.levelChip(p.exp)}</div><strong>${p[metric] || 0} ${labels[metric]}</strong></div>`).join('') : UI.empty('fa-ranking-star', 'Chưa có dữ liệu'));
      $$('.soc-lrow', box).forEach(r => r.onclick = () => P.openModal(r.dataset.uid));
      $$('.soc-subtabs button', box).forEach(b => b.onclick = () => Misc.leaderboard(box, b.dataset.s));
    },
    tags() {
      const c = {}; State.homePosts.forEach(p => (p.hashtags || []).forEach(h => { const k = h.toLowerCase(); c[k] = c[k] || { tag: h, n: 0 }; c[k].n++; }));
      return Object.values(c).sort((a, b) => b.n - a.n);
    },
    trending(box) {
      const t = this.tags().slice(0, 30);
      box.innerHTML = t.length ? `<div class="soc-grid">${t.map(x => `<button class="soc-trend" data-tag="${esc(x.tag)}"><b>#${esc(x.tag)}</b><span class="soc-muted sm">${x.n} bài viết</span></button>`).join('')}</div>` : UI.empty('fa-hashtag', 'Chưa có xu hướng nào', 'Thêm #hashtag vào bài viết để tạo xu hướng');
      $$('.soc-trend', box).forEach(b => b.onclick = () => Social.searchTag(b.dataset.tag));
    },
    admin(box) {
      if (!Env.isAdmin()) return box.innerHTML = UI.empty('fa-lock', 'Chỉ dành cho quản trị viên');
      box.innerHTML = UI.skeleton(1);
      R.attach('tab_admin', col(COL.REPORTS).onSnapshot(s => {
        const l = s.docs.map(docData).filter(r => r.status === 'open').sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
        box.innerHTML = l.length ? l.map(r => `<div class="soc-card" data-id="${r.id}"><b><i class="fa-solid fa-flag"></i> ${esc(r.reason)}</b> <span class="soc-muted sm">— ${r.targetType === 'post' ? 'bài viết' : 'bình luận'} · bởi ${esc(r.reporterName)} · ${timeAgo(r.createdAt)}</span><p>${esc(r.detail || '')}</p>
          <div class="soc-row wrap">${r.targetType === 'post' ? `<button class="soc-btn sm" data-a="view" data-t="${r.targetId}">Xem bài</button>` : ''}<button class="soc-btn sm danger" data-a="del" data-tt="${r.targetType}" data-t="${r.targetId}">Xoá nội dung</button><button class="soc-btn sm" data-a="ok">Bỏ qua báo cáo</button></div></div>`).join('') : UI.empty('fa-shield-check', 'Không có báo cáo nào đang chờ');
        $$('[data-a]', box).forEach(b => b.onclick = async () => {
          const id = b.closest('[data-id]').dataset.id;
          try {
            if (b.dataset.a === 'view') Posts.openSingle(b.dataset.t);
            else if (b.dataset.a === 'ok') await col(COL.REPORTS).doc(id).update({ status: 'dismissed' });
            else { await col(b.dataset.tt === 'post' ? COL.POSTS : COL.COMMENTS).doc(b.dataset.t).delete(); await col(COL.REPORTS).doc(id).update({ status: 'resolved' }); toast('success', 'Đã xoá nội dung vi phạm'); }
          } catch (e) { toast('error', 'Lỗi', e.message); }
        });
      }, onErr('reports')));
    }
  };

  /* ======================= 16) SOCIAL APP (inject, tabs, listeners) ======================= */
  const TABS = [
    ['feed', 'fa-house', 'Bảng tin'], ['people', 'fa-users', 'Mọi người'], ['friends', 'fa-user-group', 'Bạn bè'], ['groups', 'fa-people-group', 'Nhóm'],
    ['chat', 'fa-comments', 'Phòng chat chung'], ['messages', 'fa-message', 'Tin nhắn'], ['notifications', 'fa-bell', 'Thông báo'],
    ['saved', 'fa-bookmark', 'Đã lưu'], ['leaderboard', 'fa-ranking-star', 'Xếp hạng'], ['trending', 'fa-hashtag', 'Xu hướng']
  ];

  const Social = {
    css() {
      if ($('#socStyles')) return;
      const s = document.createElement('style'); s.id = 'socStyles';
      s.textContent = `
#view-social .soc-shell{max-width:1400px;margin:0 auto}
.soc-banner{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:var(--danger);border-radius:12px;padding:12px 16px;font-size:13px;margin-bottom:14px;line-height:1.5}
.soc-search{position:relative;display:flex;align-items:center;gap:10px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-md);padding:8px 14px;margin-bottom:14px}
.soc-search>i{color:var(--text-muted)}.soc-search input{flex:1;border:0;background:transparent;outline:0;color:var(--text-main);font-size:14px;min-width:0}
.soc-sres{position:absolute;left:0;right:0;top:100%;margin-top:6px;z-index:60;background:var(--card-bg-solid);border:1px solid var(--card-border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);max-height:340px;overflow:auto}
.soc-sres .it{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:13px}.soc-sres .it:hover{background:rgba(20,120,212,.08)}.soc-sres .lb{padding:8px 14px;font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase}
.soc-3{display:grid;grid-template-columns:230px minmax(0,1fr) 280px;gap:18px;align-items:start}
.soc-lcol,.soc-rcol{position:sticky;top:84px}
.soc-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);backdrop-filter:var(--glass-blur);padding:16px;margin-bottom:14px}
.soc-menu-l{display:flex;flex-direction:column;gap:2px}
.soc-mi{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:12px;font-size:13.5px;font-weight:600;color:var(--text-main);text-align:left;width:100%}
.soc-mi i{width:18px;text-align:center;color:var(--accent)}.soc-mi:hover{background:rgba(20,120,212,.08)}.soc-mi.on{background:linear-gradient(90deg,rgba(20,120,212,.18),rgba(6,182,212,.06));color:var(--accent)}
.soc-mi .b{margin-left:auto;background:var(--danger);color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:20px;display:none}
.soc-h{font-size:14px;font-weight:800;margin:14px 0 10px}.soc-wt{font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);font-weight:800;margin-bottom:10px}
.soc-muted{color:var(--text-muted)}.sm{font-size:12px}.soc-center{text-align:center}.soc-col{display:flex;flex-direction:column;gap:10px}
.soc-row{display:flex;gap:8px;align-items:center}.soc-row.wrap{flex-wrap:wrap}.soc-row.end{justify-content:flex-end}.soc-row.between{justify-content:space-between}.soc-row.top{align-items:flex-start}
.soc-av{border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--blue-200);display:block}.soc-av-wrap{display:inline-block;flex-shrink:0}
.soc-av-fb{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--blue-400),var(--cyan-400));color:#00263f;font-weight:800}
.soc-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 16px;border-radius:12px;background:rgba(20,120,212,.09);color:var(--accent);font-weight:700;font-size:13px;transition:var(--trans)}
.soc-btn:hover{background:rgba(20,120,212,.17)}.soc-btn.primary{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500));color:#fff;box-shadow:0 6px 16px rgba(20,120,212,.25)}
.soc-btn.danger{background:rgba(239,68,68,.1);color:var(--danger)}.soc-btn.sm{padding:6px 12px;font-size:12px}.soc-btn.block{width:100%}.soc-btn:disabled{opacity:.55;cursor:not-allowed}
.soc-ib{width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:rgba(20,120,212,.09);color:var(--accent);flex-shrink:0}.soc-ib:hover{background:rgba(20,120,212,.18)}.soc-ib.sm{width:28px;height:28px;font-size:12px}.soc-ib.pri{background:var(--accent);color:#fff}
.soc-pill{background:rgba(20,120,212,.08);color:var(--accent);border-radius:20px;padding:4px 11px;font-size:12px;font-weight:700}
.soc-field{margin-bottom:12px}.soc-field label{display:block;font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:5px}
.soc-field input,.soc-field textarea,.soc-field select,.soc-ta{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--card-border);background:rgba(20,120,212,.04);color:var(--text-main);font:inherit;font-size:14px;resize:vertical}
.soc-comp .soc-ta{flex:1}.soc-prev{margin:8px 0 0 54px}.soc-comp .tools{margin:8px 0 8px 54px}.soc-comp .soc-emo{margin-left:54px}
.soc-qlabel{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--text-muted);display:flex;gap:6px;align-items:center;cursor:pointer}
.soc-pimgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}.soc-pimgs>div{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden}.soc-pimgs img{width:100%;height:100%;object-fit:cover}
.soc-pimgs button,.soc-pchip button{width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:13px;line-height:1}.soc-pimgs button{position:absolute;top:4px;right:4px}
.soc-pchip{display:flex;align-items:center;gap:8px;background:rgba(20,120,212,.07);border-radius:10px;padding:8px 10px;margin-top:6px;font-size:13px}.soc-pchip button{margin-left:auto}
.soc-emo{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;padding:8px;background:rgba(20,120,212,.06);border-radius:12px;margin-bottom:8px}.soc-emo[hidden]{display:none}.soc-emo button{font-size:18px;border-radius:8px;padding:3px}.soc-emo button:hover{background:rgba(20,120,212,.15)}
.soc-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center}.soc-fs{flex:1 1 180px;padding:8px 14px;border-radius:20px;border:1px solid var(--card-border);background:var(--card-bg);color:var(--text-main);font-size:13px}
.soc-fchip{background:rgba(20,120,212,.07);color:var(--text-muted);border-radius:20px;padding:7px 13px;font-size:12px;font-weight:700;display:inline-flex;gap:6px;align-items:center}.soc-fchip.on,.soc-fchip:hover{background:var(--accent);color:#fff}
.soc-ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.soc-pu{display:flex;gap:11px;align-items:center;cursor:pointer}.soc-adm{color:var(--accent);font-size:12px}.soc-q{color:var(--accent);font-weight:700}
.soc-pin{color:var(--accent);font-size:12px;font-weight:700;margin-bottom:8px}.soc-pc{font-size:14.5px;line-height:1.6;word-break:break-word}.soc-tag,.soc-mention{color:var(--accent);font-weight:700}
.soc-code{background:rgba(4,32,63,.07);border-radius:10px;padding:12px;overflow:auto;font-family:'Courier New',monospace;font-size:12.5px;margin:8px 0;white-space:pre-wrap}[data-theme=dark] .soc-code{background:rgba(255,255,255,.07)}
.soc-icode{background:rgba(20,120,212,.1);padding:1px 6px;border-radius:6px;font-family:monospace;font-size:12.5px}
.soc-imgs{display:grid;gap:4px;margin-top:10px;border-radius:14px;overflow:hidden}.soc-imgs.g1{grid-template-columns:1fr}.soc-imgs.g2,.soc-imgs.g4{grid-template-columns:1fr 1fr}.soc-imgs.g3{grid-template-columns:2fr 1fr}.soc-imgs.g3 .soc-img:first-child{grid-row:span 2}
.soc-img{position:relative;cursor:pointer;overflow:hidden;max-height:340px}.soc-img img{width:100%;height:100%;object-fit:cover;display:block}.soc-img span{position:absolute;inset:0;background:rgba(0,0,0,.5);color:#fff;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center}
.soc-chip{display:flex;align-items:center;gap:8px;background:rgba(20,120,212,.07);border-radius:10px;padding:10px 13px;margin-top:10px;font-size:13px;color:var(--text-main);word-break:break-all}
.soc-shared{border:1px solid var(--card-border);border-radius:12px;padding:10px 12px;margin-top:10px;cursor:pointer;font-size:13px}.soc-shared img{max-width:100%;max-height:180px;border-radius:8px;margin-top:6px}
.soc-poll{margin-top:10px;background:rgba(20,120,212,.05);border-radius:12px;padding:12px}.soc-poll>b{display:block;margin-bottom:8px;font-size:13.5px}
.soc-po{position:relative;display:flex;justify-content:space-between;width:100%;padding:9px 12px;border-radius:9px;background:rgba(20,120,212,.07);margin-bottom:6px;overflow:hidden;font-size:13px;font-weight:700}.soc-po i{position:absolute;left:0;top:0;bottom:0;background:rgba(20,120,212,.2);transition:width .4s}.soc-po span,.soc-po em{position:relative;font-style:normal}.soc-po.on{outline:2px solid var(--accent)}
.soc-pstat{display:flex;justify-content:space-between;margin-top:12px;font-size:12.5px;color:var(--text-muted)}.lnk{cursor:pointer}.lnk:hover{text-decoration:underline}
.soc-pact{display:flex;gap:4px;border-top:1px solid var(--card-border);border-bottom:1px solid var(--card-border);margin-top:10px;padding:5px 0}
.soc-act{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 4px;border-radius:10px;font-size:13px;font-weight:700;color:var(--text-muted);white-space:nowrap}.soc-act:hover{background:rgba(20,120,212,.08);color:var(--accent)}.soc-act.on{color:var(--accent)}
.soc-rx{position:relative;flex:1;display:flex}.soc-rx .soc-act{width:100%}.soc-rxp{position:absolute;bottom:calc(100% + 4px);left:0;display:flex;gap:2px;background:var(--card-bg-solid);border:1px solid var(--card-border);box-shadow:var(--shadow-md);border-radius:30px;padding:5px 8px;opacity:0;pointer-events:none;transform:translateY(6px);transition:.15s;z-index:5}
.soc-rx:hover .soc-rxp,.soc-rxp.show{opacity:1;pointer-events:auto;transform:none}.soc-rxp button{font-size:22px;transition:transform .12s}.soc-rxp button:hover{transform:scale(1.35) translateY(-4px)}
.soc-cms{margin-top:12px}.soc-cin{display:flex;gap:8px;align-items:center;margin-bottom:10px}.soc-ci{flex:1;border:1px solid var(--card-border);border-radius:20px;padding:8px 14px;background:rgba(20,120,212,.05);color:var(--text-main);font-size:13px;min-width:0}
.soc-cn{margin-left:calc(var(--d,0)*22px);margin-bottom:8px}.soc-cr{display:flex;gap:9px}.soc-cb{background:rgba(20,120,212,.06);border-radius:14px;padding:8px 13px;flex:1;min-width:0}.soc-cb.best{background:rgba(22,199,132,.1);border:1px solid rgba(22,199,132,.35)}
.soc-bestf{color:var(--success);font-size:11px;font-weight:800;margin-bottom:3px}.soc-cu{font-size:13px;cursor:pointer}.soc-ct{font-size:13.5px;line-height:1.5;word-break:break-word}
.soc-cm{display:flex;gap:12px;flex-wrap:wrap;margin-top:5px;font-size:11.5px;color:var(--text-muted)}.soc-cm button{font-weight:700;font-size:11.5px}.soc-cm button:hover,.soc-cm button.on{color:var(--accent)}.soc-rb{margin-top:6px}
.soc-ov{position:fixed;inset:0;background:rgba(3,19,36,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity .2s;padding:16px}.soc-ov.show{opacity:1}
.soc-modal{background:var(--card-bg-solid);border-radius:var(--radius-lg);max-width:480px;width:100%;max-height:90vh;overflow:auto;padding:24px;position:relative;box-shadow:var(--shadow-lg)}.soc-modal.wide{max-width:660px}.soc-modal h3{margin-bottom:12px;font-size:17px}
.soc-x{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;background:rgba(20,120,212,.08);color:var(--text-muted);z-index:2}.soc-x:hover{color:var(--danger)}
.soc-prof-head{text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:12px;border-bottom:1px solid var(--card-border)}.soc-lvl{display:inline-flex;align-items:center;gap:5px;background:var(--c,var(--accent));color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800}
.soc-bar{width:220px;height:8px;background:rgba(20,120,212,.12);border-radius:10px;overflow:hidden}.soc-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue-500),var(--cyan-500))}
.soc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px 0;text-align:center}.soc-stats b{display:block;font-size:17px}.soc-stats span{font-size:11px;color:var(--text-muted)}
.soc-badges{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.soc-badge{display:inline-flex;gap:6px;align-items:center;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c);padding:5px 11px;border-radius:20px;font-size:11.5px;font-weight:800}
.soc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.soc-person,.soc-gcard,.soc-trend{background:var(--card-bg);border:1px solid var(--card-border);border-radius:14px;cursor:pointer;transition:var(--trans)}.soc-person:hover,.soc-gcard:hover,.soc-trend:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
.soc-person{padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:7px}.soc-person b{font-size:13.5px}.soc-trend{padding:12px;text-align:left}.soc-trend b{display:block;color:var(--accent)}
.soc-gcov{height:70px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px}.soc-gcov.lg{height:100px;border-radius:14px;margin-bottom:10px}.soc-gcard{overflow:hidden}.soc-gb{padding:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.soc-subtabs{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}.soc-subtabs button{padding:8px 15px;border-radius:20px;background:rgba(20,120,212,.07);font-weight:700;font-size:13px;color:var(--text-muted)}.soc-subtabs button.on{background:var(--accent);color:#fff}
.soc-notif{display:flex;gap:10px;padding:12px;border-radius:12px;cursor:pointer;position:relative;align-items:flex-start;font-size:13px;line-height:1.4}.soc-notif:hover{background:rgba(20,120,212,.06)}.soc-notif.unread{background:rgba(20,120,212,.1)}
.soc-nic{width:22px;height:22px;border-radius:50%;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;margin:0 -22px 0 -8px;align-self:flex-end;position:relative;left:-4px}
.soc-lrow{display:flex;align-items:center;gap:12px;padding:10px;border-radius:12px;cursor:pointer}.soc-lrow:hover{background:rgba(20,120,212,.06)}.soc-lrow.top{background:rgba(251,191,36,.09)}.soc-lrow div{flex:1}.soc-lrow div b{display:block;font-size:13.5px}.soc-lrow strong{color:var(--accent);font-size:13px}.soc-rk{width:28px;text-align:center;font-weight:800}
.soc-conv{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;cursor:pointer}.soc-conv:hover{background:rgba(20,120,212,.06)}.soc-conv div{flex:1;min-width:0}.soc-conv b{display:block;font-size:13.5px}.soc-conv span{font-size:12px;color:var(--text-muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.soc-conv em{font-size:11px;color:var(--text-muted);font-style:normal}.soc-conv.unread b,.soc-conv.unread span{color:var(--text-main);font-weight:800}
.soc-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}.soc-m{display:flex;flex-direction:column;max-width:80%;align-self:flex-start;align-items:flex-start}.soc-m.me{align-self:flex-end;align-items:flex-end}
.soc-m-b{background:rgba(20,120,212,.1);padding:8px 12px;border-radius:14px;font-size:13px;word-break:break-word}.soc-m.me .soc-m-b{background:var(--accent);color:#fff}.soc-m.me .soc-m-b a,.soc-m.me .soc-tag{color:#fff}
.soc-m-n{font-size:11px;font-weight:800;color:var(--accent);margin:0 4px 2px;cursor:pointer}.soc-m-t{font-size:10px;color:var(--text-muted);margin-top:2px}.soc-m-img{max-width:200px;border-radius:12px;margin-bottom:2px;cursor:zoom-in}
.soc-typing{font-size:11px;color:var(--accent);font-style:italic;padding:0 14px 4px}.soc-typing[hidden]{display:none}
.soc-inrow{display:flex;align-items:center;gap:6px;padding:8px;border-top:1px solid var(--card-border)}.soc-txt{flex:1;border:1px solid var(--card-border);border-radius:20px;padding:8px 14px;background:rgba(20,120,212,.05);color:var(--text-main);font-size:13px;min-width:0}
.soc-room{display:flex;flex-direction:column;height:min(620px,72vh);padding:0;overflow:hidden}.soc-room .soc-msgs{min-height:0}
#socDock{position:fixed;bottom:0;right:16px;display:flex;gap:12px;align-items:flex-end;z-index:500;max-width:calc(100vw - 32px)}
.soc-win{width:310px;height:420px;background:var(--card-bg-solid);border:1px solid var(--card-border);border-radius:14px 14px 0 0;box-shadow:var(--shadow-lg);display:flex;flex-direction:column}.soc-win.min{height:46px;overflow:hidden}
.soc-win-h{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--card-border);cursor:pointer;flex-shrink:0}.soc-win-h b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.soc-win-b{flex:1;display:flex;flex-direction:column;min-height:0}
.soc-menu{position:fixed;z-index:10000;background:var(--card-bg-solid);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-lg);padding:6px;min-width:210px}.soc-menu-i{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:13px;color:var(--text-main)}.soc-menu-i:hover{background:rgba(20,120,212,.09)}.soc-menu-i.danger{color:var(--danger)}.soc-menu-div{height:1px;background:var(--card-border);margin:5px 0}
.soc-lb{position:relative;display:flex;justify-content:center}.soc-lb img{max-width:100%;max-height:74vh;border-radius:10px}.soc-lbn{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff}.soc-lbn.l{left:0}.soc-lbn.r{right:0}
.soc-empty{text-align:center;padding:44px 16px;color:var(--text-muted)}.soc-empty i{font-size:36px;margin-bottom:10px;color:var(--blue-300)}.soc-empty p{font-weight:700;color:var(--text-main);margin-bottom:4px}
.soc-skel-l{height:12px;border-radius:6px;background:rgba(20,120,212,.12);margin-bottom:10px;animation:socPulse 1.3s infinite}@keyframes socPulse{50%{opacity:.4}}
.soc-wl{display:flex;flex-direction:column;gap:9px}.soc-on{display:flex;align-items:center;gap:9px;font-size:12.5px;cursor:pointer;font-weight:600}.soc-dot{width:9px;height:9px;border-radius:50%;background:var(--success);flex-shrink:0}
@media(max-width:1180px){.soc-3{grid-template-columns:210px minmax(0,1fr)}.soc-rcol{display:none}}
@media(max-width:860px){.soc-3{grid-template-columns:1fr}.soc-lcol{position:static}.soc-menu-l{flex-direction:row;overflow-x:auto;gap:6px}.soc-mi{flex-shrink:0;white-space:nowrap;width:auto}.soc-comp .tools,.soc-prev,.soc-comp .soc-emo{margin-left:0}.soc-win{width:88vw;max-width:330px}}
@media(max-width:520px){.soc-modal{padding:18px}.soc-act{font-size:11.5px}.soc-act i{display:none}.soc-emo{grid-template-columns:repeat(5,1fr)}}`;
      document.head.appendChild(s);
    },
    injectNav() {
      if ($('.nav-item[data-view="social"]')) return;
      const nav = $('.sidebar-nav'); if (!nav) return;
      const lb = document.createElement('div'); lb.className = 'nav-section-label'; lb.textContent = 'Cộng đồng';
      const b = document.createElement('button'); b.className = 'nav-item'; b.dataset.view = 'social';
      b.innerHTML = '<i class="fa-solid fa-comments"></i> Thảo luận <span class="badge" id="socNavBadge" style="display:none">0</span>';
      nav.appendChild(lb); nav.appendChild(b);
      b.addEventListener('click', () => { const ui = Env.ui(); if (ui) ui.navigate('social'); });
    },
    injectView() {
      if ($('#view-social')) return;
      const main = $('main.content'); if (!main) return;
      const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-social';
      sec.innerHTML = `<div class="soc-shell"><div id="socBanner"></div>
        <div class="soc-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="socQ" placeholder="Tìm người, bài viết, #hashtag..." autocomplete="off"><div class="soc-sres" id="socSres" hidden></div></div>
        <div class="soc-3"><div class="soc-lcol"><div class="soc-card"><nav class="soc-menu-l" id="socMenu">${TABS.map(t => `<button class="soc-mi" data-t="${t[0]}"><i class="fa-solid ${t[1]}"></i> ${t[2]}<span class="b" id="socB_${t[0]}"></span></button>`).join('')}<button class="soc-mi" data-t="admin" id="socAdminMi" style="display:none"><i class="fa-solid fa-shield-halved"></i> Quản trị</button></nav></div></div>
        <div><div id="socTab"></div></div>
        <div class="soc-rcol"><div class="soc-card" id="wOn"></div><div class="soc-card" id="wTop"></div><div class="soc-card" id="wTag"></div></div></div></div>`;
      main.appendChild(sec);
      $$('#socMenu .soc-mi').forEach(b => b.onclick = () => Social.setTab(b.dataset.t));
      const q = $('#socQ'), res = $('#socSres');
      const run = debounce(() => {
        const t = q.value.trim(), tl = t.toLowerCase(); if (!t) { res.hidden = true; return; }
        const me = Env.user().uid, users = [...State.profiles.values()].filter(p => p.uid !== me && (p.displayName || '').toLowerCase().includes(tl.replace(/^#/, ''))).slice(0, 6);
        const tags = Misc.tags().filter(x => x.tag.toLowerCase().includes(tl.replace(/^#/, ''))).slice(0, 5);
        res.innerHTML = (users.length ? '<div class="lb">Người dùng</div>' + users.map(u => `<div class="it" data-u="${u.uid}">${UI.avatar(u.photoURL, u.displayName, 28)} ${esc(u.displayName)}</div>`).join('') : '') +
          (tags.length ? '<div class="lb">Hashtag</div>' + tags.map(x => `<div class="it" data-tag="${esc(x.tag)}"><i class="fa-solid fa-hashtag"></i> ${esc(x.tag)} (${x.n})</div>`).join('') : '') +
          `<div class="it" data-q="${esc(t)}"><i class="fa-solid fa-magnifying-glass"></i> Tìm bài viết chứa "${esc(t)}"</div>`;
        res.hidden = false;
        $$('[data-u]', res).forEach(e => e.onclick = () => { res.hidden = true; q.value = ''; P.openModal(e.dataset.u); });
        $$('[data-tag]', res).forEach(e => e.onclick = () => { res.hidden = true; q.value = ''; Social.searchTag(e.dataset.tag); });
        $$('[data-q]', res).forEach(e => e.onclick = () => { res.hidden = true; q.value = ''; State.pendingSearch = e.dataset.q; Social.setTab('feed'); });
      }, 250);
      q.oninput = run; q.onkeydown = e => { if (e.key === 'Enter' && q.value.trim()) { State.pendingSearch = q.value.trim(); res.hidden = true; q.value = ''; Social.setTab('feed'); } };
      document.addEventListener('mousedown', e => { if (!e.target.closest('.soc-search')) res.hidden = true; });
      this.showBanner();
    },
    showBanner() {
      const b = $('#socBanner'); if (!b) return;
      b.innerHTML = State.permError ? `<div class="soc-banner"><b><i class="fa-solid fa-triangle-exclamation"></i> Firestore từ chối quyền truy cập.</b> Hãy thêm Rules cho các collection <code>social_*</code> (xem đoạn RULES ở đầu file social.js) rồi bấm "Publish" trong Firebase Console, sau đó tải lại trang.</div>` : '';
    },
    searchTag(tag) { State.pendingSearch = '#' + tag; this.setTab('feed'); },
    setTab(t) { State.tab = t; $$('#socMenu .soc-mi').forEach(b => b.classList.toggle('on', b.dataset.t === t)); this.renderTab(); },
    renderTab() {
      const box = $('#socTab'); if (!box || !State.started) return;
      R.prefix('tab_'); const t = State.tab;
      $$('#socMenu .soc-mi').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      switch (t) {
        case 'feed': Feed.create(box, { mode: 'home' }); break;
        case 'people': Friends.renderPeople(box); break;
        case 'friends': Friends.render(box); break;
        case 'groups': Groups.renderList(box); break;
        case 'chat': box.innerHTML = '<div class="soc-card soc-room" id="socGlobal"></div>'; Chat.mount($('#socGlobal', box), { ref: col(COL.GLOBAL), key: 'tab_global', showNames: true }); break;
        case 'messages': Chat.renderList(box); break;
        case 'notifications': Notify.render(box); break;
        case 'saved': Feed.create(box, { mode: 'saved' }); break;
        case 'leaderboard': Misc.leaderboard(box); break;
        case 'trending': Misc.trending(box); break;
        case 'admin': Misc.admin(box); break;
      }
    },
    badges() {
      const n = State.notifs.filter(x => !x.read).length, m = Chat.unread(), set = (id, v) => { const e = $(id); if (e) { e.textContent = v > 99 ? '99+' : v; e.style.display = v > 0 ? 'inline-block' : 'none'; } };
      set('#socNavBadge', n + m); set('#socB_notifications', n); set('#socB_messages', m);
      const fr = [...State.friends.values()].filter(s => s.status === 'pending' && s.requestedBy !== (Env.user() || {}).uid).length; set('#socB_friends', fr);
    },
    widgets: debounce(() => {
      if (!State.started || !$('#wOn')) return;
      const me = Env.user().uid, now = Date.now();
      const on = State.presence.filter(p => p.uid !== me && now - ms(p.lastActive) < 150000 && !State.blocked.has(p.uid)).slice(0, 10);
      $('#wOn').innerHTML = `<div class="soc-wt"><i class="fa-solid fa-circle" style="color:var(--success);font-size:9px"></i> Đang trực tuyến (${on.length})</div><div class="soc-wl">${on.length ? on.map(p => `<div class="soc-on" data-uid="${p.uid}">${UI.avatar(p.photoURL, p.displayName, 30)}<span style="flex:1">${esc(p.displayName)}</span><button class="soc-ib sm" data-dm="${p.uid}" title="Nhắn tin"><i class="fa-solid fa-comment-dots"></i></button></div>`).join('') : '<span class="soc-muted sm">Chưa có ai khác trực tuyến</span>'}</div>`;
      $$('#wOn .soc-on').forEach(e => e.onclick = ev => { const d = ev.target.closest('[data-dm]'); d ? Chat.openDM(d.dataset.dm) : P.openModal(e.dataset.uid); });
      const top = [...State.profiles.values()].sort((a, b) => (b.exp || 0) - (a.exp || 0)).slice(0, 5);
      $('#wTop').innerHTML = `<div class="soc-wt"><i class="fa-solid fa-crown"></i> Top đóng góp</div><div class="soc-wl">${top.map((p, i) => `<div class="soc-on" data-uid="${p.uid}"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span>${UI.avatar(p.photoURL, p.displayName, 28)}<span style="flex:1">${esc(p.displayName)}</span><span class="soc-muted sm">${p.exp || 0}</span></div>`).join('') || '<span class="soc-muted sm">Chưa có dữ liệu</span>'}</div>`;
      $$('#wTop .soc-on').forEach(e => e.onclick = () => P.openModal(e.dataset.uid));
      const tg = Misc.tags().slice(0, 8);
      $('#wTag').innerHTML = `<div class="soc-wt"><i class="fa-solid fa-hashtag"></i> Hashtag nổi bật</div><div class="soc-row wrap">${tg.map(x => `<button class="soc-pill" data-tag="${esc(x.tag)}">#${esc(x.tag)} · ${x.n}</button>`).join('') || '<span class="soc-muted sm">Chưa có dữ liệu</span>'}</div>`;
      $$('#wTag [data-tag]').forEach(e => e.onclick = () => Social.searchTag(e.dataset.tag));
    }, 400),

    async start() {
      if (State.started) return;
      const u = Env.user(); if (!u || !Env.db()) return;
      State.started = true;
      try { await P.ensure(u); } catch (e) { onErr('profile')(e); }
      const me = u.uid;
      R.attach('b_me', col(COL.PROFILES).doc(me).onSnapshot(s => { if (!s.exists) return; State.myProfile = Object.assign({ uid: me }, s.data()); State.profiles.set(me, State.myProfile); State.homeSubs.forEach(f => f()); }, onErr('me')));
      R.attach('b_profiles', col(COL.PROFILES).limit(500).onSnapshot(s => { s.docs.forEach(d => State.profiles.set(d.id, Object.assign({ uid: d.id }, d.data()))); Social.widgets(); if (['friends', 'people', 'leaderboard'].includes(State.tab)) Social.renderTab(); else State.homeSubs.forEach(f => f()); }, onErr('profiles')));
      R.attach('b_home', col(COL.POSTS).orderBy('createdAt', 'desc').limit(LIM.HOME).onSnapshot(s => { State.homePosts = s.docs.map(docData); State.homeSubs.forEach(f => f()); Social.widgets(); }, onErr('posts')));
      R.attach('b_notifs', col(COL.NOTIFS).where('uid', '==', me).onSnapshot(s => {
        if (State.seenNotifs) s.docChanges().forEach(c => { if (c.type === 'added' && !c.doc.metadata.hasPendingWrites) { const n = c.doc.data(), mt = Notify.meta[n.type]; toast('success', n.fromName || 'Thông báo', mt ? mt[1] : 'có thông báo mới'); } });
        State.seenNotifs = true; State.notifs = s.docs.map(docData).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)); Social.badges();
        if (State.tab === 'notifications') Notify.render($('#socTab'));
      }, onErr('notifs')));
      R.attach('b_friends', col(COL.FRIENDS).where('members', 'array-contains', me).onSnapshot(s => {
        State.friends = new Map(); State.blocked = new Set();
        s.docs.forEach(d => { const v = d.data(), o = (v.members || []).find(x => x !== me); if (!o) return; State.friends.set(o, v); if (v.status === 'blocked' && v.blockedBy === me) State.blocked.add(o); });
        Social.badges(); State.homeSubs.forEach(f => f()); if (['friends', 'people'].includes(State.tab)) Social.renderTab();
      }, onErr('friends')));
      R.attach('b_follow', col(COL.FOLLOW).where('followerUid', '==', me).onSnapshot(s => { State.following = new Set(s.docs.map(d => d.data().followingUid)); State.homeSubs.forEach(f => f()); }, onErr('follow')));
      R.attach('b_convs', col(COL.CONVS).where('members', 'array-contains', me).onSnapshot(s => {
        if (State.seenConvs) s.docChanges().forEach(c => {
          if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) return; const v = c.doc.data();
          if (v.lastFrom && v.lastFrom !== me && !State.openDMs.has(c.doc.id) && ((v.seen || {})[me] || 0) < ms(v.updatedAt)) toast('success', 'Tin nhắn mới từ ' + ((v.names || {})[v.lastFrom] || 'ai đó'), (v.lastMessage || '').slice(0, 60));
        });
        State.seenConvs = true; State.convs = s.docs.map(docData).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)); Social.badges(); if (State.tab === 'messages') Chat.renderList($('#socTab'));
      }, onErr('convs')));
      R.attach('b_presence', col(COL.PRESENCE).orderBy('lastActive', 'desc').limit(40).onSnapshot(s => { State.presence = s.docs.map(docData); Social.widgets(); }, onErr('presence')));
      const beat = () => col(COL.PRESENCE).doc(me).set({ uid: me, displayName: u.displayName || '', photoURL: u.photoURL || '', lastActive: TS() }, { merge: true }).catch(() => { });
      beat(); State.hb = setInterval(beat, 45000);
      const adm = $('#socAdminMi'); if (adm) adm.style.display = Env.isAdmin() ? 'flex' : 'none';
      this.badges();
      if (State.permError) this.showBanner();
    },
    stop() {
      R.all(); clearInterval(State.hb); State.hb = null;
      State.started = false; State.myProfile = null; State.homePosts = []; State.notifs = []; State.convs = []; State.friends = new Map(); State.openDMs.clear();
      State.seenConvs = State.seenNotifs = false; State.homeSubs.clear();
      const d = $('#socDock'); if (d) d.remove();
    },
    async show() {
      this.injectView(); await this.start();
      const adm = $('#socAdminMi'); if (adm) adm.style.display = Env.isAdmin() ? 'flex' : 'none';
      this.showBanner(); this.setTab(State.tab || 'feed');
      const m = location.hash.match(/^#social-post-(.+)$/); if (m) { history.replaceState(null, '', location.pathname + location.search); Posts.openSingle(m[1]); }
    },

    init() {
      try {
        this.css(); this.injectNav(); this.injectView();
        const ui = Env.ui();
        if (ui && !ui.__socV2) {
          ui.titles = ui.titles || {}; ui.titles.social = ['Thảo luận', 'Cộng đồng học tập — chia sẻ, hỏi đáp, trò chuyện cùng ôn thi'];
          const orig = ui.navigate.bind(ui);
          ui.navigate = function (v) { const r = orig(v); if (v === 'social') Social.show(); return r; };
          ui.__socV2 = true;
        }
        const auth = Env.auth();
        if (auth && !window.__socAuthHook) {
          window.__socAuthHook = true;
          auth.onAuthStateChanged(user => {
            if (!user) { Social.stop(); return; }
            // chỉ khởi động nền sau khi app đã được cấp quyền & khởi tạo (tránh tạo hồ sơ cho tài khoản chưa duyệt)
            let tries = 0; const t = setInterval(() => { tries++; if (Env.appReady()) { clearInterval(t); Social.start(); if (/^#social-post-/.test(location.hash)) { const x = Env.ui(); if (x) x.navigate('social'); } } else if (tries > 240) clearInterval(t); }, 700);
          });
        }
      } catch (e) { console.error('[Social] init error', e); }
    }
  };

  window.initSocial = () => Social.init();
  window.SocialApp = Social;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Social.init()); else Social.init();
})();
