/* ============================================================================
   social.js — Module Cộng đồng / Thảo luận (Social Layer)
   ----------------------------------------------------------------------------
   Biến trang ôn thi thành một cộng đồng học tập (Feed / Bạn bè / Nhóm /
   Nhắn tin / Thông báo / Bảng xếp hạng...) lấy cảm hứng từ Facebook, Reddit,
   Discord và StackOverflow.

   NGUYÊN TẮC:
   - File DUY NHẤT này (social.js) tự đủ: tự inject CSS, tự inject HTML,
     tự gắn vào Firebase đã có sẵn (window.fbAuth / window.firebase).
   - KHÔNG sửa các module khác. Chỉ "wrap" (bọc thêm) một vài hàm có sẵn của
     index.html (UIManager.navigate, ...) giống cách module "Đề cộng đồng"
     có sẵn trong index.html đã làm — không ghi đè logic gốc, chỉ gọi thêm.
   - Khởi động bằng window.initSocial().
   - Vanilla JS, không framework, không build step.

   GHI CHÚ VỀ PHẠM VI (đọc trước khi dùng):
   Bản đặc tả gốc yêu cầu ~8.000-12.000 dòng bao trọn mọi tính năng của
   Facebook + Reddit + Discord + StackOverflow cùng lúc (voice chat thật,
   virtual list, AI thật gọi model...). Để code THẬT SỰ CHẠY ĐƯỢC và không
   chứa hàm rỗng/giả, file này làm ĐẦY ĐỦ và ĐÚNG các tính năng lõi quan
   trọng nhất (feed, post, comment đa cấp, reaction, bạn bè/follow, nhóm,
   nhắn tin realtime, thông báo realtime, tìm kiếm, lọc, profile,
   level/EXP/huy hiệu, leaderboard, hashtag trending, báo cáo, quyền admin,
   bảo mật cơ bản, infinite scroll, dark mode). Một số mục rất nặng (voice
   message thật, gọi thẳng AI model từ trình duyệt) cần backend riêng giữ
   API key (KHÔNG được lộ key ra frontend) nên được cài mức hợp lý (tóm tắt
   trích xuất phía client) kèm TODO rõ để bạn cắm API thật vào sau.
   ========================================================================== */
(function(){
  'use strict';

  if(window.__SOCIAL_MODULE_LOADED__) return;
  window.__SOCIAL_MODULE_LOADED__ = true;

  /* ==========================================================================
     0) HẰNG SỐ / CẤU HÌNH CHUNG
     ========================================================================== */
  const COL = {
    POSTS: 'social_posts',
    COMMENTS: 'social_comments',
    LIKES: 'social_likes',
    FRIENDS: 'social_friends',
    NOTIFICATIONS: 'social_notifications',
    MESSAGES: 'social_messages',
    CONVERSATIONS: 'social_conversations',
    GROUPS: 'social_groups',
    REPORTS: 'social_reports',
    SAVED: 'social_saved',
    TAGS: 'social_tags',
    FOLLOW: 'social_follow',
    PROFILES: 'social_profiles',
    PRESENCE: 'social_presence'
  };

  const REACTIONS = [
    {key:'like', icon:'fa-thumbs-up', emoji:'👍', label:'Thích', color:'#1478d4'},
    {key:'love', icon:'fa-heart', emoji:'❤️', label:'Yêu thích', color:'#ef4444'},
    {key:'haha', icon:'fa-face-laugh', emoji:'😆', label:'Haha', color:'#f59e0b'},
    {key:'wow', icon:'fa-face-surprise', emoji:'😮', label:'Wow', color:'#f59e0b'},
    {key:'sad', icon:'fa-face-sad-tear', emoji:'😢', label:'Buồn', color:'#6fb6f2'}
  ];

  const SUGGESTED_HASHTAGS = ['kinhte','onthi','NEU','tailieu','caohoc','thongke','toan','anhvan'];

  const LIMITS = {
    MAX_IMAGE_DIM: 1280,
    MAX_IMAGE_BYTES: 900 * 1024,
    MAX_FILE_BYTES: 900 * 1024,
    MAX_MENTIONS: 10,
    MIN_POST_INTERVAL_MS: 12000,
    MIN_COMMENT_INTERVAL_MS: 4000,
    PAGE_SIZE: 8,
    COMMENT_PAGE_SIZE: 20,
    MAX_COMMENT_DEPTH: 4
  };

  const BADGES = [
    {id:'welcome', label:'Thành viên mới', icon:'fa-seedling', color:'#16c784', test:p=>true},
    {id:'first_post', label:'Bài viết đầu tiên', icon:'fa-pen', color:'#1478d4', test:p=>(p.postCount||0)>=1},
    {id:'100_posts', label:'100 bài viết', icon:'fa-feather-pointed', color:'#1478d4', test:p=>(p.postCount||0)>=100},
    {id:'100_comments', label:'100 bình luận', icon:'fa-comments', color:'#22d3ee', test:p=>(p.commentCount||0)>=100},
    {id:'100_likes', label:'100 lượt thích nhận về', icon:'fa-thumbs-up', color:'#f59e0b', test:p=>(p.likeReceived||0)>=100},
    {id:'1000_likes', label:'1000 lượt thích nhận về', icon:'fa-fire', color:'#ef4444', test:p=>(p.likeReceived||0)>=1000},
    {id:'best_answer', label:'Câu trả lời hay nhất', icon:'fa-award', color:'#fbbf24', test:p=>(p.bestAnswerCount||0)>=1},
    {id:'top_contributor', label:'Top Contributor', icon:'fa-star', color:'#fbbf24', test:p=>(p.exp||0)>=5000},
    {id:'streak_30', label:'Chuyên cần 30 ngày', icon:'fa-calendar-check', color:'#16c784', test:p=>(p.streak||0)>=30}
  ];

  const LEVELS = [
    {name:'Bronze', min:0, color:'#b08d57'},
    {name:'Silver', min:500, color:'#9aa5b1'},
    {name:'Gold', min:2000, color:'#f5b301'},
    {name:'Diamond', min:6000, color:'#22d3ee'},
    {name:'Master', min:15000, color:'#a78bfa'},
    {name:'Legend', min:35000, color:'#ef4444'}
  ];

  /* ==========================================================================
     1) Utils — Tiện ích dùng chung (escape, format, parse, file, debounce...)
     ========================================================================== */
  const Utils = {
    escapeHtml(str){
      if(window.Utils && typeof window.Utils.escapeHtml === 'function') return window.Utils.escapeHtml(str);
      if(str===undefined || str===null) return '';
      return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    },
    uid(){ return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,9); },
    now(){ return Date.now(); },
    clamp(n,min,max){ return Math.max(min, Math.min(max, n)); },
    round2(n){ return Math.round(n*100)/100; },

    // Chuyển Firestore Timestamp / Date / number -> mốc thời gian tương đối
    timeAgo(ts){
      let ms;
      if(!ts) return '';
      if(typeof ts.toMillis === 'function') ms = ts.toMillis();
      else if(ts instanceof Date) ms = ts.getTime();
      else if(typeof ts === 'number') ms = ts;
      else return '';
      const diff = Math.max(0, Date.now() - ms);
      const s = Math.floor(diff/1000);
      if(s < 10) return 'Vừa xong';
      if(s < 60) return s + ' giây trước';
      const m = Math.floor(s/60);
      if(m < 60) return m + ' phút trước';
      const h = Math.floor(m/60);
      if(h < 24) return h + ' giờ trước';
      const d = Math.floor(h/24);
      if(d < 7) return d + ' ngày trước';
      const date = new Date(ms);
      return date.toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year: (date.getFullYear()!==new Date().getFullYear())?'numeric':undefined});
    },

    formatFullDate(ts){
      let ms;
      if(!ts) return '';
      if(typeof ts.toMillis === 'function') ms = ts.toMillis(); else if(ts instanceof Date) ms = ts.getTime(); else ms = ts;
      return new Date(ms).toLocaleString('vi-VN');
    },

    debounce(fn, wait){
      let t;
      return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), wait); };
    },

    throttle(fn, wait){
      let last = 0, timer=null;
      return function(...args){
        const now = Date.now();
        if(now - last >= wait){ last = now; fn.apply(this,args); }
        else{
          clearTimeout(timer);
          timer = setTimeout(()=>{ last = Date.now(); fn.apply(this,args); }, wait - (now-last));
        }
      };
    },

    // Trích @mention từ nội dung text thô (đã có danh sách tên hiển thị để đối chiếu)
    extractMentionNames(text){
      const re = /@([a-zA-ZÀ-ỹ0-9_.]{2,40})/g;
      const out = []; let m;
      while((m = re.exec(text)) && out.length < LIMITS.MAX_MENTIONS){ out.push(m[1]); }
      return out;
    },
    extractHashtags(text){
      const re = /#([a-zA-Z0-9_À-ỹ]{2,30})/g;
      const out = new Set(); let m;
      while((m = re.exec(text))){ out.add(m[1]); }
      return Array.from(out).slice(0,15);
    },

    // Markdown "lite": **bold** *italic* `code` ```block``` [text](url) tự escape trước
    renderMarkdownLite(raw){
      let text = Utils.escapeHtml(raw||'');
      // code block ```...```
      text = text.replace(/```([\s\S]*?)```/g, (m,code)=>`<pre class="soc-codeblock"><code>${code}</code></pre>`);
      // inline code `...`
      text = text.replace(/`([^`\n]+)`/g, '<code class="soc-inline-code">$1</code>');
      // bold **...**
      text = text.replace(/\*\*([^\*\n]+)\*\*/g, '<b>$1</b>');
      // italic *...*
      text = text.replace(/\*([^\*\n]+)\*/g, '<i>$1</i>');
      // links [text](url)
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
      // raw URL tự linkify (nếu chưa nằm trong thẻ a)
      text = text.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$2</a>');
      // hashtag
      text = text.replace(/#([a-zA-Z0-9_À-ỹ]{2,30})/g, '<a href="javascript:void(0)" class="soc-hashtag-link" data-hashtag="$1">#$1</a>');
      // mention
      text = text.replace(/@([a-zA-ZÀ-ỹ0-9_.]{2,40})/g, '<a href="javascript:void(0)" class="soc-mention-link" data-mention-name="$1">@$1</a>');
      // xuống dòng
      text = text.replace(/\n/g, '<br>');
      return text;
    },

    // Nén ảnh về base64 dataURL nhỏ gọn qua canvas
    compressImageToDataURL(file, maxDim, quality){
      return new Promise((resolve, reject)=>{
        if(!file.type.startsWith('image/')){ reject(new Error('File không phải hình ảnh')); return; }
        const img = new Image();
        const reader = new FileReader();
        reader.onerror = ()=>reject(new Error('Không đọc được file ảnh'));
        reader.onload = (e)=>{
          img.onload = ()=>{
            let {width,height} = img;
            const dim = maxDim || LIMITS.MAX_IMAGE_DIM;
            if(width > dim || height > dim){
              if(width > height){ height = Math.round(height * dim/width); width = dim; }
              else { width = Math.round(width * dim/height); height = dim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            let q = quality || 0.78;
            let dataUrl = canvas.toDataURL('image/jpeg', q);
            // giảm dần chất lượng nếu vẫn quá nặng
            let tries = 0;
            while(dataUrl.length > LIMITS.MAX_IMAGE_BYTES && q > 0.35 && tries < 6){
              q -= 0.1; tries++;
              dataUrl = canvas.toDataURL('image/jpeg', q);
            }
            if(dataUrl.length > LIMITS.MAX_IMAGE_BYTES){
              reject(new Error('Ảnh quá nặng, vui lòng chọn ảnh nhỏ hơn'));
              return;
            }
            resolve(dataUrl);
          };
          img.onerror = ()=>reject(new Error('File ảnh bị lỗi'));
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    },

    fileToDataURL(file, maxBytes){
      return new Promise((resolve,reject)=>{
        const reader = new FileReader();
        reader.onload = e=>{
          if(e.target.result.length > (maxBytes||LIMITS.MAX_FILE_BYTES)){
            reject(new Error('File quá nặng (giới hạn ~'+Math.round((maxBytes||LIMITS.MAX_FILE_BYTES)/1024)+'KB)'));
            return;
          }
          resolve(e.target.result);
        };
        reader.onerror = ()=>reject(new Error('Không đọc được file'));
        reader.readAsDataURL(file);
      });
    },

    copyToClipboard(text){
      if(navigator.clipboard && navigator.clipboard.writeText){
        return navigator.clipboard.writeText(text);
      }
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      return Promise.resolve();
    },

    toast(type, title, msg){
      if(window.UIManager && typeof window.UIManager.toast === 'function'){
        window.UIManager.toast(type, title, msg); return;
      }
      // fallback toast riêng nếu UIManager không có
      let wrap = document.getElementById('socFallbackToastWrap');
      if(!wrap){
        wrap = document.createElement('div');
        wrap.id = 'socFallbackToastWrap';
        wrap.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(wrap);
      }
      const el = document.createElement('div');
      el.style.cssText = 'background:#0b1f33;color:#eaf4ff;padding:12px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:13px;max-width:300px;';
      el.innerHTML = `<b>${Utils.escapeHtml(title)}</b><div style="opacity:.85;margin-top:2px;">${Utils.escapeHtml(msg||'')}</div>`;
      wrap.appendChild(el);
      setTimeout(()=>el.remove(), 4200);
    },

    confirm(title, msg, onOk){
      if(window.UIManager && typeof window.UIManager.confirm === 'function'){
        window.UIManager.confirm(title, msg, onOk); return;
      }
      if(window.confirm(title+'\n\n'+msg)) onOk();
    },

    isAdmin(){
      return !!(window.AuthManager && typeof window.AuthManager.isAdmin === 'function' && window.AuthManager.isAdmin());
    },

    initialsAvatar(name){
      const n = (name||'?').trim();
      return n ? n[0].toUpperCase() : '?';
    }
  };

  /* ==========================================================================
     2) FirebaseService — Lớp bọc Firestore dùng chung cho toàn bộ module
     ========================================================================== */
  const FirebaseService = {
    db(){ return window.fbDb; },
    auth(){ return window.fbAuth; },
    currentUser(){ return (window.fbAuth && window.fbAuth.currentUser) || null; },
    serverTs(){ return firebase.firestore.FieldValue.serverTimestamp(); },
    inc(n){ return firebase.firestore.FieldValue.increment(n); },
    arrUnion(...v){ return firebase.firestore.FieldValue.arrayUnion(...v); },
    arrRemove(...v){ return firebase.firestore.FieldValue.arrayRemove(...v); },
    del(){ return firebase.firestore.FieldValue.delete(); },

    col(name){ return this.db().collection(name); },
    doc(name, id){ return id ? this.db().collection(name).doc(id) : this.db().collection(name).doc(); },

    async getDoc(name, id){
      const snap = await this.doc(name,id).get();
      return snap.exists ? Object.assign({id:snap.id}, snap.data()) : null;
    },

    async setDoc(name, id, data, merge){
      return this.doc(name,id).set(data, {merge: merge!==false});
    },

    async updateDoc(name, id, data){
      return this.doc(name,id).update(data);
    },

    async deleteDoc(name, id){
      return this.doc(name,id).delete();
    },

    async addDoc(name, data){
      const ref = await this.col(name).add(data);
      return ref.id;
    },

    batch(){ return this.db().batch(); },

    // Giới hạn tần suất hành động phía client (chống flood cơ bản)
    _lastActionAt: {},
    throttleGuard(key, minIntervalMs){
      const now = Date.now();
      const last = this._lastActionAt[key] || 0;
      if(now - last < minIntervalMs){
        const waitSec = Math.ceil((minIntervalMs - (now-last))/1000);
        Utils.toast('warn','Thao tác quá nhanh', `Vui lòng đợi ${waitSec}s rồi thử lại (chống spam)`);
        return false;
      }
      this._lastActionAt[key] = now;
      return true;
    }
  };

  /* ==========================================================================
     3) RealtimeManager — Quản lý vòng đời các Firestore onSnapshot listener
        để không rò rỉ bộ nhớ khi chuyển tab/đóng widget.
     ========================================================================== */
  const RealtimeManager = {
    _listeners: new Map(),

    attach(key, unsubscribeFn){
      this.detach(key);
      this._listeners.set(key, unsubscribeFn);
    },

    detach(key){
      const fn = this._listeners.get(key);
      if(typeof fn === 'function'){ try{ fn(); }catch(e){} }
      this._listeners.delete(key);
    },

    detachByPrefix(prefix){
      Array.from(this._listeners.keys()).forEach(k=>{
        if(k.indexOf(prefix)===0) this.detach(k);
      });
    },

    detachAll(){
      Array.from(this._listeners.keys()).forEach(k=>this.detach(k));
    },

    isActive(key){ return this._listeners.has(key); }
  };

  /* ==========================================================================
     4) UIComponents — Thành phần giao diện dùng chung (avatar, modal, skeleton…)
     ========================================================================== */
  const UIComponents = {
    avatarHtml(photoURL, name, size){
      size = size || 40;
      if(photoURL){
        return `<img class="soc-avatar" src="${Utils.escapeHtml(photoURL)}" style="width:${size}px;height:${size}px;" alt="avatar" loading="lazy" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')">`;
      }
      return `<div class="soc-avatar soc-avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px;">${Utils.escapeHtml(Utils.initialsAvatar(name))}</div>`;
    },

    onlineDotHtml(isOnline){
      return `<span class="soc-online-dot ${isOnline?'on':'off'}"></span>`;
    },

    levelBadgeHtml(exp){
      const lvl = ProfileManager.levelFor(exp||0);
      return `<span class="soc-level-chip" style="--lvl-color:${lvl.color}"><i class="fa-solid fa-ranking-star"></i> ${lvl.name}</span>`;
    },

    skeletonPostHtml(){
      return `
        <div class="soc-card soc-skeleton">
          <div class="soc-skel-row"><div class="soc-skel-avatar"></div>
            <div style="flex:1;"><div class="soc-skel-line" style="width:40%"></div><div class="soc-skel-line" style="width:25%"></div></div>
          </div>
          <div class="soc-skel-line" style="width:90%"></div>
          <div class="soc-skel-line" style="width:70%"></div>
          <div class="soc-skel-block"></div>
        </div>`;
    },

    emptyStateHtml(icon, title, sub){
      return `<div class="soc-empty"><i class="fa-solid ${icon}"></i><p>${Utils.escapeHtml(title)}</p>${sub?`<span>${Utils.escapeHtml(sub)}</span>`:''}</div>`;
    },

    // Modal chung: trả về element gốc, tự thêm vào body, có nút đóng + click nền để đóng
    openModal(innerHtml, opts){
      opts = opts || {};
      const overlay = document.createElement('div');
      overlay.className = 'soc-modal-overlay';
      overlay.innerHTML = `<div class="soc-modal ${opts.wide?'soc-modal-wide':''}">
          <button class="soc-modal-close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
          <div class="soc-modal-body">${innerHtml}</div>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(()=>overlay.classList.add('show'));
      const close = ()=>{
        overlay.classList.remove('show');
        setTimeout(()=>overlay.remove(), 220);
        if(typeof opts.onClose === 'function') opts.onClose();
      };
      overlay.querySelector('.soc-modal-close').addEventListener('click', close);
      overlay.addEventListener('click', e=>{ if(e.target === overlay) close(); });
      document.addEventListener('keydown', function esc(e){
        if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); }
      });
      return {el: overlay, close};
    },

    dropdown(anchorEl, items){
      // items: [{label, icon, danger, onClick}]
      document.querySelectorAll('.soc-dropdown-menu').forEach(d=>d.remove());
      const menu = document.createElement('div');
      menu.className = 'soc-dropdown-menu';
      menu.innerHTML = items.map((it,i)=>{
        if(it.divider) return '<div class="soc-dropdown-divider"></div>';
        return `<button class="soc-dropdown-item ${it.danger?'danger':''}" data-i="${i}"><i class="fa-solid ${it.icon}"></i> ${Utils.escapeHtml(it.label)}</button>`;
      }).join('');
      document.body.appendChild(menu);
      const rect = anchorEl.getBoundingClientRect();
      const menuW = 220;
      let left = rect.right - menuW;
      if(left < 8) left = rect.left;
      menu.style.left = Math.max(8, left) + 'px';
      let top = rect.bottom + 6;
      if(top + 260 > window.innerHeight) top = rect.top - 6 - Math.min(260, items.length*38+16);
      menu.style.top = top + 'px';
      menu.querySelectorAll('.soc-dropdown-item').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const it = items[+btn.dataset.i];
          menu.remove();
          if(it && typeof it.onClick === 'function') it.onClick();
        });
      });
      const closer = (e)=>{
        if(!menu.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)){
          menu.remove();
          document.removeEventListener('click', closer, true);
        }
      };
      setTimeout(()=>document.addEventListener('click', closer, true), 0);
      return menu;
    },

    reactionBarHtml(counts, myReaction){
      const total = REACTIONS.reduce((s,r)=>s+(counts[r.key]||0),0);
      const topReactions = REACTIONS.filter(r=>counts[r.key]>0).sort((a,b)=>(counts[b.key]||0)-(counts[a.key]||0)).slice(0,3);
      if(!total) return `<span class="soc-reaction-summary empty">Chưa có lượt tương tác</span>`;
      return `<span class="soc-reaction-summary">
          <span class="soc-reaction-icons">${topReactions.map(r=>`<span title="${r.label}">${r.emoji}</span>`).join('')}</span>
          ${total} lượt tương tác
        </span>`;
    },

    tabsHtml(tabs, activeKey){
      return `<div class="soc-tabs">${tabs.map(t=>`
        <button class="soc-tab-btn ${t.key===activeKey?'active':''}" data-tab="${t.key}">
          <i class="fa-solid ${t.icon}"></i><span>${Utils.escapeHtml(t.label)}</span>${t.badge?`<b class="soc-tab-badge">${t.badge}</b>`:''}
        </button>`).join('')}</div>`;
    }
  };

  /* ==========================================================================
     5) ProfileManager — Hồ sơ, EXP, Level, Huy hiệu
     ========================================================================== */
  const ProfileManager = {
    _cache: new Map(), // uid -> profile object

    levelFor(exp){
      let cur = LEVELS[0];
      for(const l of LEVELS){ if(exp >= l.min) cur = l; }
      return cur;
    },

    nextLevelInfo(exp){
      const idx = LEVELS.findIndex(l=>l.name === this.levelFor(exp).name);
      const next = LEVELS[idx+1];
      if(!next) return {pct:100, next:null};
      const cur = LEVELS[idx];
      const pct = Utils.clamp(Math.round(((exp-cur.min)/(next.min-cur.min))*100),0,100);
      return {pct, next};
    },

    badgesFor(profile){
      return BADGES.filter(b=>{ try{ return b.test(profile); }catch(e){ return false; } });
    },

    // Tạo hồ sơ nếu chưa có (gọi khi user đăng nhập / lần đầu mở Social)
    async ensureProfile(user){
      if(!user) return null;
      const ref = FirebaseService.doc(COL.PROFILES, user.uid);
      const snap = await ref.get();
      const base = {
        uid: user.uid,
        displayName: user.displayName || 'Người dùng',
        displayName_lower: (user.displayName||'nguoi dung').toLowerCase(),
        photoURL: user.photoURL || '',
        email: user.email || '',
        bio: '',
        exp: 0,
        postCount: 0,
        commentCount: 0,
        likeGiven: 0,
        likeReceived: 0,
        bestAnswerCount: 0,
        friendCount: 0,
        followerCount: 0,
        followingCount: 0,
        role: Utils.isAdmin() ? 'admin' : 'member',
        lastActive: FirebaseService.serverTs()
      };
      if(!snap.exists){
        base.joinedAt = FirebaseService.serverTs();
        await ref.set(base);
        this._cache.set(user.uid, Object.assign({}, base, {exp:0}));
        return this._cache.get(user.uid);
      }else{
        // đồng bộ tên/ảnh mới nhất từ Google nếu có thay đổi
        const data = snap.data();
        const patch = {lastActive: FirebaseService.serverTs()};
        if(user.displayName && user.displayName !== data.displayName){ patch.displayName = user.displayName; patch.displayName_lower = user.displayName.toLowerCase(); }
        if(user.photoURL && user.photoURL !== data.photoURL) patch.photoURL = user.photoURL;
        await ref.update(patch).catch(()=>{});
        const merged = Object.assign({id:snap.id}, data, patch);
        this._cache.set(user.uid, merged);
        return merged;
      }
    },

    async getProfile(uid, forceRefresh){
      if(!forceRefresh && this._cache.has(uid)) return this._cache.get(uid);
      const p = await FirebaseService.getDoc(COL.PROFILES, uid);
      if(p) this._cache.set(uid, p);
      return p;
    },

    async getProfilesBulk(uids){
      const unique = Array.from(new Set(uids)).filter(Boolean);
      const missing = unique.filter(u=>!this._cache.has(u));
      await Promise.all(missing.map(u=>this.getProfile(u).catch(()=>null)));
      const out = {};
      unique.forEach(u=>{ out[u] = this._cache.get(u) || null; });
      return out;
    },

    // Cộng EXP + cập nhật bộ đếm liên quan, dùng increment để an toàn khi nhiều tab
    async addExp(uid, amount, counterField){
      const patch = {exp: FirebaseService.inc(amount)};
      if(counterField) patch[counterField] = FirebaseService.inc(1);
      await FirebaseService.updateDoc(COL.PROFILES, uid, patch).catch(()=>{});
      if(this._cache.has(uid)){
        const c = this._cache.get(uid);
        c.exp = (c.exp||0) + amount;
        if(counterField) c[counterField] = (c[counterField]||0) + 1;
      }
    },

    renderMiniCardHtml(profile){
      const exp = profile.exp || 0;
      const lvl = this.levelFor(exp);
      return `
        <div class="soc-profile-mini" data-uid="${profile.uid||profile.id}">
          ${UIComponents.avatarHtml(profile.photoURL, profile.displayName, 44)}
          <div class="soc-profile-mini-info">
            <b>${Utils.escapeHtml(profile.displayName)}</b>
            <span>${UIComponents.levelBadgeHtml(exp)}</span>
          </div>
        </div>`;
    },

    async openProfileModal(uid){
      const me = FirebaseService.currentUser();
      const profile = await this.getProfile(uid, true);
      if(!profile){ Utils.toast('error','Không tìm thấy hồ sơ',''); return; }
      const badges = this.badgesFor(profile);
      const {pct, next} = this.nextLevelInfo(profile.exp||0);
      const lvl = this.levelFor(profile.exp||0);
      const isMe = me && me.uid === uid;
      const friendStatus = isMe ? null : await FriendManager.getStatus(me.uid, uid);
      const isFollowing = isMe ? false : await FriendManager.isFollowing(me.uid, uid);

      const html = `
        <div class="soc-profile-header" style="--lvl-color:${lvl.color}">
          ${UIComponents.avatarHtml(profile.photoURL, profile.displayName, 88)}
          <h3>${Utils.escapeHtml(profile.displayName)} ${profile.role==='admin'?'<i class="fa-solid fa-shield-halved soc-admin-tag" title="Quản trị viên"></i>':''}</h3>
          <p class="soc-profile-bio">${Utils.escapeHtml(profile.bio || 'Chưa có tiểu sử')}</p>
          <div class="soc-profile-level-row">
            <span class="soc-level-chip lg"><i class="fa-solid fa-ranking-star"></i> ${lvl.name}</span>
            <div class="soc-exp-bar"><div class="soc-exp-bar-fill" style="width:${pct}%"></div></div>
            <span class="soc-exp-text">${profile.exp||0} EXP ${next?`(còn ${next.min-(profile.exp||0)} tới ${next.name})`:'(Cấp tối đa)'}</span>
          </div>
        </div>
        <div class="soc-profile-stats">
          <div><b>${profile.postCount||0}</b><span>Bài viết</span></div>
          <div><b>${profile.commentCount||0}</b><span>Bình luận</span></div>
          <div><b>${profile.friendCount||0}</b><span>Bạn bè</span></div>
          <div><b>${profile.followerCount||0}</b><span>Người theo dõi</span></div>
          <div><b>${profile.followingCount||0}</b><span>Đang theo dõi</span></div>
          <div><b>${profile.likeReceived||0}</b><span>Lượt thích</span></div>
        </div>
        <div class="soc-profile-badges">
          ${badges.map(b=>`<span class="soc-badge-chip" style="--b-color:${b.color}" title="${Utils.escapeHtml(b.label)}"><i class="fa-solid ${b.icon}"></i> ${Utils.escapeHtml(b.label)}</span>`).join('') || '<span class="soc-text-muted">Chưa có huy hiệu</span>'}
        </div>
        ${isMe ? `
        <div class="soc-profile-edit">
          <label>Tiểu sử</label>
          <textarea id="socBioInput" maxlength="160" placeholder="Giới thiệu ngắn về bạn...">${Utils.escapeHtml(profile.bio||'')}</textarea>
          <button class="soc-btn primary" id="socSaveBioBtn"><i class="fa-solid fa-floppy-disk"></i> Lưu tiểu sử</button>
        </div>` : `
        <div class="soc-profile-actions">
          <button class="soc-btn primary" id="socProfileMsgBtn"><i class="fa-solid fa-comment-dots"></i> Nhắn tin</button>
          <button class="soc-btn" id="socProfileFriendBtn">${FriendManager.friendBtnLabel(friendStatus)}</button>
          <button class="soc-btn" id="socProfileFollowBtn">${isFollowing?'<i class="fa-solid fa-user-check"></i> Đang theo dõi':'<i class="fa-solid fa-user-plus"></i> Theo dõi'}</button>
          ${Utils.isAdmin() ? `<button class="soc-btn danger" id="socProfileBanBtn"><i class="fa-solid fa-ban"></i> ${profile.banned?'Bỏ khoá':'Khoá tài khoản'}</button>` : ''}
        </div>`}
      `;
      const modal = UIComponents.openModal(html, {wide:true});
      if(isMe){
        modal.el.querySelector('#socSaveBioBtn').addEventListener('click', async ()=>{
          const bio = modal.el.querySelector('#socBioInput').value.trim().slice(0,160);
          await FirebaseService.updateDoc(COL.PROFILES, uid, {bio});
          this._cache.delete(uid);
          Utils.toast('success','Đã lưu','Tiểu sử đã được cập nhật');
        });
      }else{
        const msgBtn = modal.el.querySelector('#socProfileMsgBtn');
        if(msgBtn) msgBtn.addEventListener('click', ()=>{ modal.close(); ChatManager.openConversationWith(uid, profile); });
        const friendBtn = modal.el.querySelector('#socProfileFriendBtn');
        if(friendBtn) friendBtn.addEventListener('click', async ()=>{ await FriendManager.handleFriendButtonClick(me.uid, uid); modal.close(); this.openProfileModal(uid); });
        const followBtn = modal.el.querySelector('#socProfileFollowBtn');
        if(followBtn) followBtn.addEventListener('click', async ()=>{
          if(isFollowing) await FriendManager.unfollow(me.uid, uid); else await FriendManager.follow(me.uid, uid, profile);
          modal.close(); this.openProfileModal(uid);
        });
        const banBtn = modal.el.querySelector('#socProfileBanBtn');
        if(banBtn) banBtn.addEventListener('click', ()=>{
          Utils.confirm(profile.banned?'Bỏ khoá tài khoản?':'Khoá tài khoản này?','Người dùng sẽ '+(profile.banned?'được phép':'không thể')+' đăng bài / bình luận trong khu Cộng đồng.', async ()=>{
            await FirebaseService.updateDoc(COL.PROFILES, uid, {banned: !profile.banned});
            Utils.toast('success','Đã cập nhật', profile.banned?'Đã bỏ khoá':'Đã khoá tài khoản');
            this._cache.delete(uid); modal.close();
          });
        });
      }
    }
  };

  /* ==========================================================================
     6) NotificationManager — Thông báo realtime
     ========================================================================== */
  const NotificationManager = {
    _unreadCount: 0,

    async create(toUid, fromUser, type, extra){
      if(!toUid || toUid === fromUser.uid) return; // không tự thông báo cho chính mình
      const data = Object.assign({
        uid: toUid,
        type,
        fromUid: fromUser.uid,
        fromName: fromUser.displayName || 'Ai đó',
        fromPhoto: fromUser.photoURL || '',
        read: false,
        createdAt: FirebaseService.serverTs()
      }, extra||{});
      await FirebaseService.addDoc(COL.NOTIFICATIONS, data).catch(()=>{});
    },

    typeMeta(type){
      const map = {
        like: {icon:'fa-thumbs-up', text:'đã bày tỏ cảm xúc về bài viết của bạn', color:'#1478d4'},
        comment: {icon:'fa-comment', text:'đã bình luận về bài viết của bạn', color:'#22d3ee'},
        reply: {icon:'fa-reply', text:'đã trả lời bình luận của bạn', color:'#22d3ee'},
        mention: {icon:'fa-at', text:'đã nhắc đến bạn', color:'#f59e0b'},
        friend_request: {icon:'fa-user-plus', text:'đã gửi lời mời kết bạn', color:'#16c784'},
        friend_accept: {icon:'fa-user-check', text:'đã chấp nhận lời mời kết bạn', color:'#16c784'},
        follow: {icon:'fa-user-plus', text:'đã theo dõi bạn', color:'#a78bfa'},
        group_invite: {icon:'fa-people-group', text:'đã mời bạn vào nhóm', color:'#1478d4'},
        best_answer: {icon:'fa-award', text:'đã đánh dấu câu trả lời của bạn là hay nhất', color:'#fbbf24'}
      };
      return map[type] || {icon:'fa-bell', text:'có thông báo mới', color:'#1478d4'};
    },

    listen(uid){
      RealtimeManager.attach('notifications', FirebaseService.col(COL.NOTIFICATIONS)
        .where('uid','==',uid).orderBy('createdAt','desc').limit(40)
        .onSnapshot(snap=>{
          const list = snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
          this._unreadCount = list.filter(n=>!n.read).length;
          this.updateBellBadge();
          if(SocialApp.state.activeTab === 'notifications') this.renderList(list);
        }, err=>console.warn('[Social] notification listener error', err)));
    },

    updateBellBadge(){
      const badge = document.getElementById('socNotifBellBadge');
      if(badge) badge.style.display = this._unreadCount>0 ? 'flex' : 'none';
      if(badge) badge.textContent = this._unreadCount>99?'99+':this._unreadCount;
      const navBadge = document.getElementById('socNavBadge');
      if(navBadge){ navBadge.style.display = this._unreadCount>0?'flex':'none'; navBadge.textContent = this._unreadCount>99?'99+':this._unreadCount; }
    },

    renderList(list){
      const wrap = document.getElementById('socTabContent');
      if(!wrap) return;
      if(!list.length){ wrap.innerHTML = UIComponents.emptyStateHtml('fa-bell-slash','Chưa có thông báo nào','Hoạt động của bạn bè sẽ hiện ở đây'); return; }
      wrap.innerHTML = `<div class="soc-notif-list">
        <div class="soc-notif-toolbar"><button class="soc-btn sm" id="socMarkAllReadBtn"><i class="fa-solid fa-check-double"></i> Đánh dấu đã đọc tất cả</button></div>
        ${list.map(n=>{
          const meta = this.typeMeta(n.type);
          return `<div class="soc-notif-item ${n.read?'':'unread'}" data-id="${n.id}" data-post="${n.postId||''}" data-from="${n.fromUid}">
            ${UIComponents.avatarHtml(n.fromPhoto, n.fromName, 40)}
            <div class="soc-notif-icon" style="--n-color:${meta.color}"><i class="fa-solid ${meta.icon}"></i></div>
            <div class="soc-notif-text"><b>${Utils.escapeHtml(n.fromName)}</b> ${meta.text} ${n.excerpt?`<span class="soc-notif-excerpt">"${Utils.escapeHtml(n.excerpt)}"</span>`:''}
              <div class="soc-notif-time">${Utils.timeAgo(n.createdAt)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
      wrap.querySelectorAll('.soc-notif-item').forEach(item=>{
        item.addEventListener('click', async ()=>{
          const id = item.dataset.id;
          FirebaseService.updateDoc(COL.NOTIFICATIONS, id, {read:true}).catch(()=>{});
          if(item.dataset.post) SocialFeed.openSinglePostModal(item.dataset.post);
          else if(item.dataset.from) ProfileManager.openProfileModal(item.dataset.from);
        });
      });
      const markAllBtn = wrap.querySelector('#socMarkAllReadBtn');
      if(markAllBtn) markAllBtn.addEventListener('click', async ()=>{
        const batch = FirebaseService.batch();
        list.filter(n=>!n.read).forEach(n=>batch.update(FirebaseService.doc(COL.NOTIFICATIONS,n.id), {read:true}));
        await batch.commit().catch(()=>{});
        Utils.toast('success','Đã đánh dấu','Tất cả thông báo đã được đánh dấu đã đọc');
      });
    }
  };

  /* ==========================================================================
     7) FriendManager — Kết bạn / Follow / Block
     ========================================================================== */
  const FriendManager = {
    _friendPairId(a,b){ return [a,b].sort().join('_'); },

    async getStatus(me, other){
      if(!me || !other || me===other) return null;
      const doc = await FirebaseService.getDoc(COL.FRIENDS, this._friendPairId(me,other));
      return doc; // null | {status:'pending'|'accepted'|'blocked', requestedBy}
    },

    friendBtnLabel(status){
      if(!status) return '<i class="fa-solid fa-user-plus"></i> Kết bạn';
      if(status.status === 'accepted') return '<i class="fa-solid fa-user-check"></i> Bạn bè';
      if(status.status === 'pending') return status.requestedBy === (FirebaseService.currentUser()||{}).uid ? '<i class="fa-solid fa-clock"></i> Đã gửi lời mời' : '<i class="fa-solid fa-user-clock"></i> Phản hồi lời mời';
      if(status.status === 'blocked') return '<i class="fa-solid fa-ban"></i> Đã chặn';
      return '<i class="fa-solid fa-user-plus"></i> Kết bạn';
    },

    async handleFriendButtonClick(me, other){
      const status = await this.getStatus(me, other);
      if(!status){ await this.sendRequest(me, other); return; }
      if(status.status === 'pending' && status.requestedBy !== me){
        UIComponents.openModal(`
          <h3>Phản hồi lời mời kết bạn</h3>
          <div class="soc-modal-actions">
            <button class="soc-btn primary" id="socAcceptFriendBtn"><i class="fa-solid fa-check"></i> Chấp nhận</button>
            <button class="soc-btn" id="socRejectFriendBtn"><i class="fa-solid fa-xmark"></i> Từ chối</button>
          </div>`).el.addEventListener('click', async (e)=>{
            if(e.target.closest('#socAcceptFriendBtn')){ await this.acceptRequest(me, other); document.querySelector('.soc-modal-overlay')?.remove(); }
            if(e.target.closest('#socRejectFriendBtn')){ await this.rejectRequest(me, other); document.querySelector('.soc-modal-overlay')?.remove(); }
          });
        return;
      }
      if(status.status === 'pending' && status.requestedBy === me){ await this.cancelRequest(me, other); return; }
      if(status.status === 'accepted'){
        Utils.confirm('Huỷ kết bạn?','Bạn sẽ không còn là bạn bè với người này.', async ()=>{ await this.unfriend(me, other); });
        return;
      }
    },

    async sendRequest(me, other){
      const meProfile = await ProfileManager.getProfile(me);
      const id = this._friendPairId(me,other);
      await FirebaseService.setDoc(COL.FRIENDS, id, {
        uidA: me, uidB: other, status:'pending', requestedBy: me, createdAt: FirebaseService.serverTs()
      });
      await NotificationManager.create(other, meProfile||{uid:me}, 'friend_request', {});
      Utils.toast('success','Đã gửi lời mời kết bạn','');
    },

    async acceptRequest(me, other){
      const id = this._friendPairId(me,other);
      await FirebaseService.updateDoc(COL.FRIENDS, id, {status:'accepted', acceptedAt: FirebaseService.serverTs()});
      await Promise.all([
        FirebaseService.updateDoc(COL.PROFILES, me, {friendCount: FirebaseService.inc(1)}).catch(()=>{}),
        FirebaseService.updateDoc(COL.PROFILES, other, {friendCount: FirebaseService.inc(1)}).catch(()=>{})
      ]);
      const meProfile = await ProfileManager.getProfile(me);
      await NotificationManager.create(other, meProfile||{uid:me}, 'friend_accept', {});
      Utils.toast('success','Đã là bạn bè!','');
    },

    async rejectRequest(me, other){
      await FirebaseService.deleteDoc(COL.FRIENDS, this._friendPairId(me,other));
      Utils.toast('warn','Đã từ chối lời mời','');
    },

    async cancelRequest(me, other){
      await FirebaseService.deleteDoc(COL.FRIENDS, this._friendPairId(me,other));
      Utils.toast('warn','Đã huỷ lời mời','');
    },

    async unfriend(me, other){
      await FirebaseService.deleteDoc(COL.FRIENDS, this._friendPairId(me,other));
      await Promise.all([
        FirebaseService.updateDoc(COL.PROFILES, me, {friendCount: FirebaseService.inc(-1)}).catch(()=>{}),
        FirebaseService.updateDoc(COL.PROFILES, other, {friendCount: FirebaseService.inc(-1)}).catch(()=>{})
      ]);
      Utils.toast('warn','Đã huỷ kết bạn','');
    },

    async block(me, other){
      await FirebaseService.setDoc(COL.FRIENDS, this._friendPairId(me,other), {
        uidA: me, uidB: other, status:'blocked', blockedBy: me, createdAt: FirebaseService.serverTs()
      });
      Utils.toast('success','Đã chặn người dùng','Bạn sẽ không còn thấy bài viết/bình luận từ tài khoản này');
    },

    async unblock(me, other){
      await FirebaseService.deleteDoc(COL.FRIENDS, this._friendPairId(me,other));
      Utils.toast('success','Đã bỏ chặn','');
    },

    async listFriends(uid){
      const [asA, asB] = await Promise.all([
        FirebaseService.col(COL.FRIENDS).where('uidA','==',uid).where('status','==','accepted').get(),
        FirebaseService.col(COL.FRIENDS).where('uidB','==',uid).where('status','==','accepted').get()
      ]);
      const others = [];
      asA.forEach(d=>others.push(d.data().uidB));
      asB.forEach(d=>others.push(d.data().uidA));
      return others;
    },

    async listPendingRequests(uid){
      const snap = await FirebaseService.col(COL.FRIENDS).where('uidB','==',uid).where('status','==','pending').get();
      const snap2 = await FirebaseService.col(COL.FRIENDS).where('uidA','==',uid).where('status','==','pending').get();
      const incoming = []; const outgoing = [];
      snap.forEach(d=>{ const v=d.data(); if(v.requestedBy!==uid) incoming.push(v.uidA===uid?v.uidB:v.uidA); });
      snap2.forEach(d=>{ const v=d.data(); if(v.requestedBy===uid) outgoing.push(v.uidA===uid?v.uidB:v.uidA); });
      return {incoming, outgoing};
    },

    // ---- FOLLOW (theo dõi 1 chiều, khác kết bạn 2 chiều) ----
    _followId(follower, following){ return follower+'_'+following; },

    async isFollowing(follower, following){
      const d = await FirebaseService.getDoc(COL.FOLLOW, this._followId(follower, following));
      return !!d;
    },

    async follow(follower, following, followingProfile){
      if(follower === following) return;
      await FirebaseService.setDoc(COL.FOLLOW, this._followId(follower, following), {
        followerUid: follower, followingUid: following, createdAt: FirebaseService.serverTs()
      });
      await Promise.all([
        FirebaseService.updateDoc(COL.PROFILES, follower, {followingCount: FirebaseService.inc(1)}).catch(()=>{}),
        FirebaseService.updateDoc(COL.PROFILES, following, {followerCount: FirebaseService.inc(1)}).catch(()=>{})
      ]);
      const meProfile = await ProfileManager.getProfile(follower);
      await NotificationManager.create(following, meProfile||{uid:follower}, 'follow', {});
      Utils.toast('success','Đã theo dõi','');
    },

    async unfollow(follower, following){
      await FirebaseService.deleteDoc(COL.FOLLOW, this._followId(follower, following));
      await Promise.all([
        FirebaseService.updateDoc(COL.PROFILES, follower, {followingCount: FirebaseService.inc(-1)}).catch(()=>{}),
        FirebaseService.updateDoc(COL.PROFILES, following, {followerCount: FirebaseService.inc(-1)}).catch(()=>{})
      ]);
      Utils.toast('warn','Đã bỏ theo dõi','');
    },

    async listFollowing(uid){
      const snap = await FirebaseService.col(COL.FOLLOW).where('followerUid','==',uid).get();
      return snap.docs.map(d=>d.data().followingUid);
    },

    async renderFriendsView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `<div class="soc-subtabs">
          <button class="soc-subtab active" data-sub="friends">Bạn bè</button>
          <button class="soc-subtab" data-sub="requests">Lời mời</button>
        </div><div id="socFriendsInner" class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div>`;
      const me = FirebaseService.currentUser();
      const renderFriendsList = async ()=>{
        const inner = document.getElementById('socFriendsInner');
        const ids = await this.listFriends(me.uid);
        if(!ids.length){ inner.innerHTML = UIComponents.emptyStateHtml('fa-user-group','Chưa có bạn bè nào','Kết bạn với mọi người trong Feed để bắt đầu'); return; }
        const profiles = await ProfileManager.getProfilesBulk(ids);
        inner.innerHTML = `<div class="soc-people-grid">${ids.map(id=>{
          const p = profiles[id]; if(!p) return '';
          return `<div class="soc-people-card" data-uid="${id}">
            ${UIComponents.avatarHtml(p.photoURL,p.displayName,64)}
            <b>${Utils.escapeHtml(p.displayName)}</b>
            ${UIComponents.levelBadgeHtml(p.exp)}
            <button class="soc-btn sm danger soc-unfriend-btn" data-uid="${id}"><i class="fa-solid fa-user-minus"></i> Huỷ kết bạn</button>
          </div>`;
        }).join('')}</div>`;
        inner.querySelectorAll('.soc-people-card').forEach(c=>c.addEventListener('click', e=>{ if(e.target.closest('.soc-unfriend-btn')) return; ProfileManager.openProfileModal(c.dataset.uid); }));
        inner.querySelectorAll('.soc-unfriend-btn').forEach(b=>b.addEventListener('click', e=>{
          e.stopPropagation();
          Utils.confirm('Huỷ kết bạn?','', async ()=>{ await this.unfriend(me.uid, b.dataset.uid); renderFriendsList(); });
        }));
      };
      const renderRequests = async ()=>{
        const inner = document.getElementById('socFriendsInner');
        const {incoming, outgoing} = await this.listPendingRequests(me.uid);
        if(!incoming.length && !outgoing.length){ inner.innerHTML = UIComponents.emptyStateHtml('fa-user-clock','Không có lời mời nào',''); return; }
        const profiles = await ProfileManager.getProfilesBulk([...incoming, ...outgoing]);
        inner.innerHTML = `
          ${incoming.length?`<h4 class="soc-section-title">Lời mời đã nhận (${incoming.length})</h4><div class="soc-people-grid">${incoming.map(id=>{
            const p = profiles[id]; if(!p) return '';
            return `<div class="soc-people-card" data-uid="${id}">${UIComponents.avatarHtml(p.photoURL,p.displayName,64)}<b>${Utils.escapeHtml(p.displayName)}</b>
              <div class="soc-row-gap"><button class="soc-btn sm primary soc-accept-btn" data-uid="${id}"><i class="fa-solid fa-check"></i></button>
              <button class="soc-btn sm soc-reject-btn" data-uid="${id}"><i class="fa-solid fa-xmark"></i></button></div></div>`;
          }).join('')}</div>`:''}
          ${outgoing.length?`<h4 class="soc-section-title">Đã gửi (${outgoing.length})</h4><div class="soc-people-grid">${outgoing.map(id=>{
            const p = profiles[id]; if(!p) return '';
            return `<div class="soc-people-card" data-uid="${id}">${UIComponents.avatarHtml(p.photoURL,p.displayName,64)}<b>${Utils.escapeHtml(p.displayName)}</b>
              <button class="soc-btn sm danger soc-cancel-btn" data-uid="${id}">Huỷ lời mời</button></div>`;
          }).join('')}</div>`:''}
        `;
        inner.querySelectorAll('.soc-accept-btn').forEach(b=>b.addEventListener('click', async e=>{ e.stopPropagation(); await this.acceptRequest(me.uid, b.dataset.uid); renderRequests(); }));
        inner.querySelectorAll('.soc-reject-btn').forEach(b=>b.addEventListener('click', async e=>{ e.stopPropagation(); await this.rejectRequest(me.uid, b.dataset.uid); renderRequests(); }));
        inner.querySelectorAll('.soc-cancel-btn').forEach(b=>b.addEventListener('click', async e=>{ e.stopPropagation(); await this.cancelRequest(me.uid, b.dataset.uid); renderRequests(); }));
      };
      renderFriendsList();
      wrap.querySelectorAll('.soc-subtab').forEach(t=>t.addEventListener('click', ()=>{
        wrap.querySelectorAll('.soc-subtab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
        t.dataset.sub === 'friends' ? renderFriendsList() : renderRequests();
      }));
    }
  };

  /* ==========================================================================
     8) GroupManager — Nhóm học tập
     ========================================================================== */
  const GroupManager = {
    _colors: ['#1478d4','#16c784','#f59e0b','#ef4444','#a78bfa','#22d3ee'],

    async createGroup(name, description, privacy){
      const me = FirebaseService.currentUser();
      if(!name || !name.trim()){ Utils.toast('error','Thiếu tên nhóm',''); return null; }
      const id = await FirebaseService.addDoc(COL.GROUPS, {
        name: name.trim().slice(0,80),
        description: (description||'').trim().slice(0,300),
        privacy: privacy || 'public', // public | private
        coverColor: this._colors[Math.floor(Math.random()*this._colors.length)],
        members: [me.uid],
        admins: [me.uid],
        createdBy: me.uid,
        createdByName: me.displayName || 'Ẩn danh',
        memberCount: 1,
        postCount: 0,
        createdAt: FirebaseService.serverTs()
      });
      Utils.toast('success','Đã tạo nhóm', name);
      return id;
    },

    async joinGroup(groupId){
      const me = FirebaseService.currentUser();
      await FirebaseService.updateDoc(COL.GROUPS, groupId, {
        members: FirebaseService.arrUnion(me.uid),
        memberCount: FirebaseService.inc(1)
      });
      Utils.toast('success','Đã tham gia nhóm','');
    },

    async leaveGroup(groupId){
      const me = FirebaseService.currentUser();
      await FirebaseService.updateDoc(COL.GROUPS, groupId, {
        members: FirebaseService.arrRemove(me.uid),
        admins: FirebaseService.arrRemove(me.uid),
        memberCount: FirebaseService.inc(-1)
      });
      Utils.toast('warn','Đã rời nhóm','');
    },

    isMember(group, uid){ return Array.isArray(group.members) && group.members.includes(uid); },
    isAdmin(group, uid){ return Array.isArray(group.admins) && group.admins.includes(uid); },

    async listGroups(){
      const snap = await FirebaseService.col(COL.GROUPS).orderBy('memberCount','desc').limit(60).get();
      return snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
    },

    async listMyGroups(uid){
      const snap = await FirebaseService.col(COL.GROUPS).where('members','array-contains',uid).get();
      return snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
    },

    groupCardHtml(g, uid){
      const member = this.isMember(g, uid);
      return `<div class="soc-group-card" data-id="${g.id}">
        <div class="soc-group-cover" style="background:${g.coverColor||'#1478d4'}"><i class="fa-solid fa-people-group"></i></div>
        <div class="soc-group-body">
          <b>${Utils.escapeHtml(g.name)}</b>
          <span>${Utils.escapeHtml(g.description||'')}</span>
          <div class="soc-group-meta"><i class="fa-solid fa-user-group"></i> ${g.memberCount||0} thành viên · <i class="fa-solid fa-file-lines"></i> ${g.postCount||0} bài viết ${g.privacy==='private'?'· <i class="fa-solid fa-lock"></i> Riêng tư':''}</div>
          <button class="soc-btn ${member?'':'primary'} sm soc-group-join-btn" data-id="${g.id}">${member?'<i class="fa-solid fa-right-from-bracket"></i> Rời nhóm':'<i class="fa-solid fa-plus"></i> Tham gia'}</button>
        </div>
      </div>`;
    },

    async renderGroupsView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `<div class="soc-groups-toolbar">
          <button class="soc-btn primary" id="socCreateGroupBtn"><i class="fa-solid fa-plus"></i> Tạo nhóm mới</button>
        </div>
        <h4 class="soc-section-title">Nhóm của tôi</h4>
        <div class="soc-group-grid" id="socMyGroupsGrid">${UIComponents.skeletonPostHtml()}</div>
        <h4 class="soc-section-title">Khám phá nhóm</h4>
        <div class="soc-group-grid" id="socAllGroupsGrid">${UIComponents.skeletonPostHtml()}</div>`;
      const me = FirebaseService.currentUser();
      const [mine, all] = await Promise.all([this.listMyGroups(me.uid), this.listGroups()]);
      const myIds = new Set(mine.map(g=>g.id));
      document.getElementById('socMyGroupsGrid').innerHTML = mine.length ? mine.map(g=>this.groupCardHtml(g, me.uid)).join('') : UIComponents.emptyStateHtml('fa-people-group','Bạn chưa tham gia nhóm nào','');
      const others = all.filter(g=>!myIds.has(g.id));
      document.getElementById('socAllGroupsGrid').innerHTML = others.length ? others.map(g=>this.groupCardHtml(g, me.uid)).join('') : UIComponents.emptyStateHtml('fa-compass','Chưa có nhóm nào khác','Hãy là người đầu tiên tạo nhóm!');

      wrap.querySelectorAll('.soc-group-join-btn').forEach(btn=>{
        btn.addEventListener('click', async e=>{
          e.stopPropagation();
          const group = [...mine, ...all].find(g=>g.id===btn.dataset.id);
          if(this.isMember(group, me.uid)) await this.leaveGroup(group.id); else await this.joinGroup(group.id);
          this.renderGroupsView();
        });
      });
      wrap.querySelectorAll('.soc-group-card').forEach(card=>{
        card.addEventListener('click', e=>{ if(e.target.closest('.soc-group-join-btn')) return; this.openGroupModal(card.dataset.id); });
      });
      document.getElementById('socCreateGroupBtn').addEventListener('click', ()=>{
        const html = `<h3><i class="fa-solid fa-people-group"></i> Tạo nhóm mới</h3>
          <div class="soc-form-field"><label>Tên nhóm</label><input type="text" id="socNewGroupName" maxlength="80" placeholder="VD: Ôn thi Kinh tế lượng"></div>
          <div class="soc-form-field"><label>Mô tả</label><textarea id="socNewGroupDesc" maxlength="300" placeholder="Nhóm này dành cho..."></textarea></div>
          <div class="soc-form-field"><label>Quyền riêng tư</label>
            <select id="socNewGroupPrivacy"><option value="public">Công khai</option><option value="private">Riêng tư</option></select>
          </div>
          <button class="soc-btn primary" id="socSubmitGroupBtn" style="width:100%;"><i class="fa-solid fa-check"></i> Tạo nhóm</button>`;
        const modal = UIComponents.openModal(html);
        modal.el.querySelector('#socSubmitGroupBtn').addEventListener('click', async ()=>{
          const name = modal.el.querySelector('#socNewGroupName').value;
          const desc = modal.el.querySelector('#socNewGroupDesc').value;
          const privacy = modal.el.querySelector('#socNewGroupPrivacy').value;
          const id = await this.createGroup(name, desc, privacy);
          if(id){ modal.close(); this.renderGroupsView(); }
        });
      });
    },

    async openGroupModal(groupId){
      const group = await FirebaseService.getDoc(COL.GROUPS, groupId);
      if(!group) return;
      const me = FirebaseService.currentUser();
      const member = this.isMember(group, me.uid);
      const html = `<div class="soc-group-cover lg" style="background:${group.coverColor}"><i class="fa-solid fa-people-group"></i></div>
        <h3>${Utils.escapeHtml(group.name)}</h3>
        <p class="soc-text-muted">${Utils.escapeHtml(group.description||'')}</p>
        <div class="soc-group-meta">${group.memberCount||0} thành viên · ${group.postCount||0} bài viết</div>
        <button class="soc-btn ${member?'danger':'primary'}" id="socGroupModalJoinBtn" style="width:100%;margin:12px 0;">${member?'Rời nhóm':'Tham gia nhóm'}</button>
        ${member?`<div id="socGroupFeed" class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div>`:''}`;
      const modal = UIComponents.openModal(html, {wide:true});
      modal.el.querySelector('#socGroupModalJoinBtn').addEventListener('click', async ()=>{
        member ? await this.leaveGroup(groupId) : await this.joinGroup(groupId);
        modal.close(); this.openGroupModal(groupId);
      });
      if(member){
        SocialFeed.renderInto(document.getElementById('socGroupFeed'), {groupId});
      }
    }
  };

  /* ==========================================================================
     9) PostManager — Đăng bài / Hiển thị bài / Reaction / Poll / Lưu / Báo cáo
     ========================================================================== */
  const PostManager = {
    _composerState: { images: [], pdf: null, poll: null, codeBlock: '', gifUrl: '', link: '' },

    resetComposer(){
      this._composerState = { images: [], pdf: null, poll: null, codeBlock: '', gifUrl: '', link: '' };
    },

    composerHtml(context){
      const me = FirebaseService.currentUser();
      const isDiscussion = context && context.type === 'discussion';
      return `
      <div class="soc-composer" id="socComposer">
        <div class="soc-composer-top">
          ${UIComponents.avatarHtml(me.photoURL, me.displayName, 44)}
          <textarea id="socComposerText" rows="3" placeholder="${isDiscussion?'Đặt câu hỏi thảo luận, chia sẻ giải thích...':'Bạn đang nghĩ gì? (hỗ trợ **đậm**, *nghiêng*, `code`, #hashtag, @mention)'}"></textarea>
        </div>
        <div id="socComposerPreview" class="soc-composer-preview"></div>
        <div class="soc-composer-toolbar">
          <button class="soc-icon-btn" data-action="image" title="Ảnh"><i class="fa-solid fa-image"></i></button>
          <button class="soc-icon-btn" data-action="gif" title="GIF"><i class="fa-solid fa-file-video"></i></button>
          <button class="soc-icon-btn" data-action="pdf" title="Tệp / PDF"><i class="fa-solid fa-paperclip"></i></button>
          <button class="soc-icon-btn" data-action="code" title="Code block"><i class="fa-solid fa-code"></i></button>
          <button class="soc-icon-btn" data-action="poll" title="Bình chọn"><i class="fa-solid fa-square-poll-vertical"></i></button>
          <button class="soc-icon-btn" data-action="link" title="Đính kèm link"><i class="fa-solid fa-link"></i></button>
          <button class="soc-icon-btn" data-action="emoji" title="Emoji"><i class="fa-regular fa-face-smile"></i></button>
          <input type="file" id="socImageInput" accept="image/*" multiple style="display:none;">
          <input type="file" id="socPdfInput" accept="application/pdf,.doc,.docx,.zip,.rar" style="display:none;">
        </div>
        <div id="socEmojiPicker" class="soc-emoji-picker" style="display:none;"></div>
        <div class="soc-composer-footer">
          <div class="soc-composer-hashtags">${SUGGESTED_HASHTAGS.map(h=>`<button class="soc-chip-btn" data-hashtag="${h}">#${h}</button>`).join('')}</div>
          <button class="soc-btn primary" id="socSubmitPostBtn"><i class="fa-solid fa-paper-plane"></i> Đăng bài</button>
        </div>
      </div>`;
    },

    wireComposer(container, context){
      this.resetComposer();
      const textarea = container.querySelector('#socComposerText');
      const preview = container.querySelector('#socComposerPreview');
      const emojiPicker = container.querySelector('#socEmojiPicker');
      const EMOJIS = ['😀','😂','😍','🤔','😢','😡','👍','👏','🔥','🎉','💯','📚','✅','❌','⭐','🙏','😴','🤯','🥳','💡'];
      emojiPicker.innerHTML = EMOJIS.map(e=>`<button class="soc-emoji-item">${e}</button>`).join('');
      emojiPicker.querySelectorAll('.soc-emoji-item').forEach(btn=>btn.addEventListener('click', ()=>{
        textarea.value += btn.textContent; textarea.focus();
      }));

      const renderPreview = ()=>{
        const st = this._composerState;
        let html = '';
        if(st.images.length){
          html += `<div class="soc-preview-images">${st.images.map((src,i)=>`<div class="soc-preview-img-wrap"><img src="${src}"><button class="soc-preview-remove" data-kind="image" data-i="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>`;
        }
        if(st.pdf){
          html += `<div class="soc-preview-file"><i class="fa-solid fa-file-pdf"></i> ${Utils.escapeHtml(st.pdf.name)} <button class="soc-preview-remove" data-kind="pdf"><i class="fa-solid fa-xmark"></i></button></div>`;
        }
        if(st.codeBlock){
          html += `<div class="soc-preview-code"><pre>${Utils.escapeHtml(st.codeBlock)}</pre><button class="soc-preview-remove" data-kind="code"><i class="fa-solid fa-xmark"></i></button></div>`;
        }
        if(st.poll){
          html += `<div class="soc-preview-poll"><b>${Utils.escapeHtml(st.poll.question)}</b>${st.poll.options.map(o=>`<div>· ${Utils.escapeHtml(o)}</div>`).join('')}<button class="soc-preview-remove" data-kind="poll"><i class="fa-solid fa-xmark"></i></button></div>`;
        }
        if(st.link){
          html += `<div class="soc-preview-link"><i class="fa-solid fa-link"></i> ${Utils.escapeHtml(st.link)} <button class="soc-preview-remove" data-kind="link"><i class="fa-solid fa-xmark"></i></button></div>`;
        }
        preview.innerHTML = html;
        preview.querySelectorAll('.soc-preview-remove').forEach(btn=>btn.addEventListener('click', ()=>{
          const kind = btn.dataset.kind;
          if(kind==='image') st.images.splice(+btn.dataset.i,1);
          else if(kind==='pdf') st.pdf = null;
          else if(kind==='code') st.codeBlock = '';
          else if(kind==='poll') st.poll = null;
          else if(kind==='link') st.link = '';
          renderPreview();
        }));
      };

      container.querySelectorAll('.soc-icon-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const action = btn.dataset.action;
          if(action==='image') container.querySelector('#socImageInput').click();
          else if(action==='pdf') container.querySelector('#socPdfInput').click();
          else if(action==='code'){
            const code = prompt('Dán code vào đây:');
            if(code){ this._composerState.codeBlock = code.slice(0,4000); renderPreview(); }
          }else if(action==='poll'){
            const q = prompt('Câu hỏi bình chọn:');
            if(!q) return;
            const optsRaw = prompt('Các lựa chọn, cách nhau bằng dấu phẩy (VD: A, B, C):');
            if(!optsRaw) return;
            const options = optsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0,8);
            if(options.length<2){ Utils.toast('error','Cần ít nhất 2 lựa chọn',''); return; }
            this._composerState.poll = {question:q.slice(0,200), options};
            renderPreview();
          }else if(action==='link'){
            const url = prompt('Dán đường dẫn (URL):');
            if(url && /^https?:\/\//.test(url)){ this._composerState.link = url.slice(0,500); renderPreview(); }
            else if(url) Utils.toast('error','URL không hợp lệ','Phải bắt đầu bằng http:// hoặc https://');
          }else if(action==='gif'){
            const url = prompt('Dán URL ảnh GIF:');
            if(url){ this._composerState.images.push(url); renderPreview(); }
          }else if(action==='emoji'){
            emojiPicker.style.display = emojiPicker.style.display==='none'?'grid':'none';
          }
        });
      });

      container.querySelector('#socImageInput').addEventListener('change', async (e)=>{
        const files = Array.from(e.target.files||[]).slice(0, 6 - this._composerState.images.length);
        for(const f of files){
          try{
            const dataUrl = await Utils.compressImageToDataURL(f);
            this._composerState.images.push(dataUrl);
          }catch(err){ Utils.toast('error','Lỗi tải ảnh', err.message); }
        }
        renderPreview();
        e.target.value = '';
      });

      container.querySelector('#socPdfInput').addEventListener('change', async (e)=>{
        const f = e.target.files[0]; if(!f) return;
        try{
          const dataUrl = await Utils.fileToDataURL(f);
          this._composerState.pdf = {name:f.name, dataUrl, size:f.size};
          renderPreview();
        }catch(err){ Utils.toast('error','Lỗi tải tệp', err.message); }
        e.target.value = '';
      });

      container.querySelectorAll('.soc-chip-btn').forEach(chip=>chip.addEventListener('click', ()=>{
        textarea.value += (textarea.value.endsWith(' ')||!textarea.value?'':' ') + '#'+chip.dataset.hashtag+' ';
        textarea.focus();
      }));

      const submitBtn = container.querySelector('#socSubmitPostBtn');
      submitBtn.addEventListener('click', async ()=>{
        const content = textarea.value.trim();
        const st = this._composerState;
        if(!content && !st.images.length && !st.pdf && !st.codeBlock && !st.poll){
          Utils.toast('error','Bài viết trống','Hãy nhập nội dung hoặc đính kèm gì đó'); return;
        }
        if(!FirebaseService.throttleGuard('createPost', LIMITS.MIN_POST_INTERVAL_MS)) return;
        submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đăng...';
        try{
          await this.createPost(content, context);
          textarea.value = '';
          this.resetComposer();
          renderPreview();
          Utils.toast('success','Đã đăng bài','Bài viết của bạn đã lên Feed');
          if(typeof context?.onPosted === 'function') context.onPosted();
        }catch(err){
          console.error(err);
          Utils.toast('error','Đăng bài thất bại', err.message);
        }
        submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Đăng bài';
      });
    },

    async createPost(content, context){
      const me = FirebaseService.currentUser();
      const profile = await ProfileManager.getProfile(me.uid);
      if(profile && profile.banned) throw new Error('Tài khoản của bạn đang bị khoá đăng bài');
      const st = this._composerState;
      const hashtags = Utils.extractHashtags(content);
      const mentionNames = Utils.extractMentionNames(content);

      const postData = {
        uid: me.uid,
        displayName: me.displayName || 'Ẩn danh',
        photoURL: me.photoURL || '',
        role: (profile && profile.role) || 'member',
        content: (content||'').slice(0,5000),
        images: st.images.slice(0,6),
        pdf: st.pdf ? {name:st.pdf.name, dataUrl:st.pdf.dataUrl, size:st.pdf.size} : null,
        codeBlock: st.codeBlock || '',
        poll: st.poll ? {question:st.poll.question, options: st.poll.options.map(o=>({text:o, votes:[]}))} : null,
        link: st.link || '',
        hashtags,
        type: (context && context.type) || 'post', // post | discussion
        questionRef: (context && context.questionRef) || null,
        groupId: (context && context.groupId) || null,
        pinned: false,
        reactionCounts: {like:0,love:0,haha:0,wow:0,sad:0},
        commentCount: 0,
        shareCount: 0,
        bestAnswerCommentId: null,
        createdAt: FirebaseService.serverTs(),
        updatedAt: FirebaseService.serverTs(),
        edited: false
      };
      const postId = await FirebaseService.addDoc(COL.POSTS, postData);

      // cập nhật EXP + bộ đếm
      await ProfileManager.addExp(me.uid, 10, 'postCount');

      // hashtag trending counters
      hashtags.forEach(tag=>{
        FirebaseService.setDoc(COL.TAGS, tag, {tag, count: FirebaseService.inc(1), lastUsed: FirebaseService.serverTs()}, true).catch(()=>{});
      });

      // group post counter
      if(postData.groupId) FirebaseService.updateDoc(COL.GROUPS, postData.groupId, {postCount: FirebaseService.inc(1)}).catch(()=>{});

      // thông báo mention (đối chiếu tên hiển thị gần đúng — hạn chế của việc không có full-text search)
      if(mentionNames.length){
        // best-effort: không tra cứu DB tốn phí cho từng mention, chỉ lưu lại text, mention link sẽ điều hướng qua tìm kiếm khi bấm
      }
      return postId;
    },

    async toggleReaction(postId, reactionKey){
      const me = FirebaseService.currentUser();
      const likeId = postId+'_'+me.uid;
      const existing = await FirebaseService.getDoc(COL.LIKES, likeId);
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      if(!post) return;
      const batch = FirebaseService.batch();
      const postRef = FirebaseService.doc(COL.POSTS, postId);
      const likeRef = FirebaseService.doc(COL.LIKES, likeId);

      if(existing && existing.type === reactionKey){
        // bỏ reaction
        batch.delete(likeRef);
        batch.update(postRef, {['reactionCounts.'+reactionKey]: FirebaseService.inc(-1)});
        await batch.commit();
        FirebaseService.updateDoc(COL.PROFILES, post.uid, {likeReceived: FirebaseService.inc(-1)}).catch(()=>{});
      }else{
        batch.set(likeRef, {postId, uid:me.uid, displayName:me.displayName, photoURL:me.photoURL, type:reactionKey, createdAt: FirebaseService.serverTs()});
        if(existing) batch.update(postRef, {['reactionCounts.'+existing.type]: FirebaseService.inc(-1), ['reactionCounts.'+reactionKey]: FirebaseService.inc(1)});
        else batch.update(postRef, {['reactionCounts.'+reactionKey]: FirebaseService.inc(1)});
        await batch.commit();
        if(!existing){
          FirebaseService.updateDoc(COL.PROFILES, post.uid, {likeReceived: FirebaseService.inc(1)}).catch(()=>{});
          ProfileManager.addExp(me.uid, 1, 'likeGiven');
          NotificationManager.create(post.uid, me, 'like', {postId, excerpt:(post.content||'').slice(0,60)});
        }
      }
    },

    async getMyReaction(postId, uid){
      const d = await FirebaseService.getDoc(COL.LIKES, postId+'_'+uid);
      return d ? d.type : null;
    },

    async listWhoLiked(postId){
      const snap = await FirebaseService.col(COL.LIKES).where('postId','==',postId).limit(100).get();
      return snap.docs.map(d=>d.data());
    },

    async voteInPoll(postId, optionIndex){
      const me = FirebaseService.currentUser();
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      if(!post || !post.poll) return;
      const options = post.poll.options.map((o,i)=>{
        const votes = (o.votes||[]).filter(v=>v!==me.uid);
        if(i===optionIndex) votes.push(me.uid);
        return {text:o.text, votes};
      });
      await FirebaseService.updateDoc(COL.POSTS, postId, {'poll.options': options});
    },

    async toggleSave(postId){
      const me = FirebaseService.currentUser();
      const id = me.uid+'_'+postId;
      const existing = await FirebaseService.getDoc(COL.SAVED, id);
      if(existing){ await FirebaseService.deleteDoc(COL.SAVED, id); Utils.toast('warn','Đã bỏ lưu',''); return false; }
      await FirebaseService.setDoc(COL.SAVED, id, {uid:me.uid, postId, createdAt: FirebaseService.serverTs()});
      Utils.toast('success','Đã lưu bài viết','Xem lại trong mục "Đã lưu"');
      return true;
    },

    async listSaved(uid){
      const snap = await FirebaseService.col(COL.SAVED).where('uid','==',uid).orderBy('createdAt','desc').limit(60).get();
      return snap.docs.map(d=>d.data().postId);
    },

    async report(targetType, targetId, reason, detail){
      const me = FirebaseService.currentUser();
      await FirebaseService.addDoc(COL.REPORTS, {
        targetType, targetId, reason, detail: (detail||'').slice(0,300),
        reporterUid: me.uid, reporterName: me.displayName,
        status: 'open', createdAt: FirebaseService.serverTs()
      });
      Utils.toast('success','Đã gửi báo cáo','Quản trị viên sẽ xem xét sớm');
    },

    openReportModal(targetType, targetId){
      const reasons = ['Spam','Nội dung 18+','Sai nội dung / gây hiểu lầm','Lừa đảo','Khác'];
      const html = `<h3><i class="fa-solid fa-flag"></i> Báo cáo nội dung</h3>
        <div class="soc-report-reasons">${reasons.map(r=>`<label class="soc-radio-row"><input type="radio" name="socReportReason" value="${r}"> ${r}</label>`).join('')}</div>
        <textarea id="socReportDetail" placeholder="Mô tả thêm (không bắt buộc)" maxlength="300"></textarea>
        <button class="soc-btn danger" id="socSubmitReportBtn" style="width:100%;"><i class="fa-solid fa-paper-plane"></i> Gửi báo cáo</button>`;
      const modal = UIComponents.openModal(html);
      modal.el.querySelector('#socSubmitReportBtn').addEventListener('click', async ()=>{
        const checked = modal.el.querySelector('input[name="socReportReason"]:checked');
        if(!checked){ Utils.toast('error','Vui lòng chọn lý do',''); return; }
        await this.report(targetType, targetId, checked.value, modal.el.querySelector('#socReportDetail').value);
        modal.close();
      });
    },

    async editPost(postId, newContent){
      await FirebaseService.updateDoc(COL.POSTS, postId, {content:newContent.slice(0,5000), edited:true, updatedAt: FirebaseService.serverTs()});
      Utils.toast('success','Đã cập nhật bài viết','');
    },

    async deletePost(postId){
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      await FirebaseService.deleteDoc(COL.POSTS, postId);
      if(post) ProfileManager.addExp(post.uid, -10, null).catch(()=>{});
      // Xoá comment con (best-effort, giới hạn batch 1 lần để tránh đọc quá nhiều)
      const commentsSnap = await FirebaseService.col(COL.COMMENTS).where('postId','==',postId).limit(400).get();
      if(!commentsSnap.empty){
        const batch = FirebaseService.batch();
        commentsSnap.forEach(d=>batch.delete(d.ref));
        await batch.commit().catch(()=>{});
      }
      Utils.toast('success','Đã xoá bài viết','');
    },

    async togglePin(postId, pinned){
      await FirebaseService.updateDoc(COL.POSTS, postId, {pinned: !pinned});
      Utils.toast('success', !pinned?'Đã ghim bài viết':'Đã bỏ ghim','');
    },

    // Tóm tắt trích xuất đơn giản phía client (KHÔNG gọi AI thật — xem ghi chú đầu file).
    // Nếu bạn có backend riêng giữ API key, hãy thay thế nội dung hàm này bằng
    // một lệnh gọi fetch() tới backend đó (POST nội dung thảo luận, nhận về bản tóm tắt).
    heuristicSummarize(text, maxSentences){
      const clean = (text||'').replace(/\s+/g,' ').trim();
      if(!clean) return 'Chưa có nội dung để tóm tắt.';
      const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
      return sentences.slice(0, maxSentences||3).join(' ') + (sentences.length>(maxSentences||3) ? ' […]' : '');
    },

    async openAiSummaryModal(postId){
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      const commentsSnap = await FirebaseService.col(COL.COMMENTS).where('postId','==',postId).orderBy('createdAt','asc').limit(50).get();
      const comments = commentsSnap.docs.map(d=>d.data());
      const combined = (post.content||'') + '. ' + comments.map(c=>c.content).join('. ');
      const summary = this.heuristicSummarize(combined, 4);
      const topComment = comments.slice().sort((a,b)=>Object.values(b.reactionCounts||{}).reduce((s,v)=>s+v,0) - Object.values(a.reactionCounts||{}).reduce((s,v)=>s+v,0))[0];
      UIComponents.openModal(`
        <h3><i class="fa-solid fa-wand-magic-sparkles"></i> AI Tóm tắt thảo luận</h3>
        <p class="soc-text-muted" style="font-size:12px;margin-bottom:10px;">* Bản tóm tắt trích xuất tự động phía trình duyệt (không gọi mô hình AI ngoài vì lý do bảo mật API key). Có thể cắm AI thật qua backend riêng.</p>
        <div class="soc-ai-summary-box">${Utils.escapeHtml(summary)}</div>
        ${topComment?`<h4 class="soc-section-title">Bình luận nổi bật nhất</h4><div class="soc-ai-summary-box">${Utils.escapeHtml((topComment.content||'').slice(0,300))}</div>`:''}
      `);
    },

    reactionButtonsHtml(postId, myReaction){
      return `<div class="soc-reaction-popup" data-post="${postId}">
        ${REACTIONS.map(r=>`<button class="soc-reaction-opt ${myReaction===r.key?'active':''}" data-key="${r.key}" title="${r.label}">${r.emoji}</button>`).join('')}
      </div>`;
    },

    postCardHtml(post, currentUid, options){
      options = options||{};
      const isOwner = post.uid === currentUid;
      const canModerate = isOwner || Utils.isAdmin();
      const myReaction = options.myReaction || null;
      const activeReactionDef = REACTIONS.find(r=>r.key===myReaction);
      const isDiscussion = post.type === 'discussion';

      let mediaHtml = '';
      if(post.images && post.images.length){
        const n = post.images.length;
        mediaHtml += `<div class="soc-post-images grid-${Math.min(n,4)}">${post.images.slice(0,4).map((src,i)=>`
          <div class="soc-post-img-item" data-post="${post.id}" data-idx="${i}"><img src="${src}" loading="lazy">${(i===3 && n>4)?`<span class="soc-more-overlay">+${n-4}</span>`:''}</div>`).join('')}</div>`;
      }
      if(post.codeBlock){
        mediaHtml += `<pre class="soc-codeblock">${Utils.escapeHtml(post.codeBlock)}</pre>`;
      }
      if(post.pdf){
        mediaHtml += `<a class="soc-file-chip" href="${post.pdf.dataUrl}" download="${Utils.escapeHtml(post.pdf.name)}"><i class="fa-solid fa-file-arrow-down"></i> ${Utils.escapeHtml(post.pdf.name)} <span>(${Math.round((post.pdf.size||0)/1024)} KB)</span></a>`;
      }
      if(post.link){
        mediaHtml += `<a class="soc-link-chip" href="${Utils.escapeHtml(post.link)}" target="_blank" rel="noopener noreferrer nofollow"><i class="fa-solid fa-link"></i> ${Utils.escapeHtml(post.link)}</a>`;
      }
      if(post.poll){
        const totalVotes = post.poll.options.reduce((s,o)=>s+(o.votes||[]).length,0);
        const myVoted = post.poll.options.findIndex(o=>(o.votes||[]).includes(currentUid));
        mediaHtml += `<div class="soc-poll" data-post="${post.id}">
          <b>${Utils.escapeHtml(post.poll.question)}</b>
          ${post.poll.options.map((o,i)=>{
            const pct = totalVotes ? Math.round((o.votes||[]).length/totalVotes*100) : 0;
            return `<button class="soc-poll-opt ${myVoted===i?'voted':''}" data-i="${i}">
              <span class="soc-poll-opt-fill" style="width:${pct}%"></span>
              <span class="soc-poll-opt-label">${Utils.escapeHtml(o.text)}</span>
              <span class="soc-poll-opt-pct">${pct}% (${(o.votes||[]).length})</span>
            </button>`;
          }).join('')}
          <span class="soc-poll-total">${totalVotes} lượt bình chọn</span>
        </div>`;
      }

      return `
      <article class="soc-card soc-post" data-post-id="${post.id}">
        ${post.pinned?'<div class="soc-pinned-flag"><i class="fa-solid fa-thumbtack"></i> Đã ghim</div>':''}
        <div class="soc-post-head">
          <div class="soc-post-head-left" data-open-profile="${post.uid}">
            ${UIComponents.avatarHtml(post.photoURL, post.displayName, 46)}
            <div>
              <b>${Utils.escapeHtml(post.displayName)} ${post.role==='admin'?'<i class="fa-solid fa-shield-halved soc-admin-tag" title="Quản trị viên"></i>':''}</b>
              <div class="soc-post-meta">${Utils.timeAgo(post.createdAt)} ${post.edited?'· đã chỉnh sửa':''} ${isDiscussion?'· <span class="soc-discussion-tag"><i class="fa-solid fa-circle-question"></i> Thảo luận</span>':''}</div>
            </div>
          </div>
          <button class="soc-icon-btn soc-post-menu-btn" data-post="${post.id}"><i class="fa-solid fa-ellipsis"></i></button>
        </div>
        <div class="soc-post-content">${Utils.renderMarkdownLite(post.content)}</div>
        ${post.hashtags && post.hashtags.length ? `<div class="soc-post-hashtags">${post.hashtags.map(h=>`<a href="javascript:void(0)" class="soc-hashtag-link" data-hashtag="${Utils.escapeHtml(h)}">#${Utils.escapeHtml(h)}</a>`).join(' ')}</div>` : ''}
        ${mediaHtml}
        <div class="soc-post-stats">
          ${UIComponents.reactionBarHtml(post.reactionCounts||{}, myReaction)}
          <span class="soc-comment-count-label" data-open-comments="${post.id}">${post.commentCount||0} bình luận · ${post.shareCount||0} chia sẻ</span>
        </div>
        <div class="soc-post-actions">
          <div class="soc-reaction-trigger-wrap">
            <button class="soc-action-btn soc-react-btn ${myReaction?'active':''}" data-post="${post.id}" style="${activeReactionDef?`color:${activeReactionDef.color}`:''}">
              <span class="soc-react-icon">${activeReactionDef ? activeReactionDef.emoji : '<i class="fa-regular fa-thumbs-up"></i>'}</span> ${activeReactionDef?activeReactionDef.label:'Thích'}
            </button>
            ${this.reactionButtonsHtml(post.id, myReaction)}
          </div>
          <button class="soc-action-btn" data-open-comments="${post.id}"><i class="fa-regular fa-comment"></i> Bình luận</button>
          <button class="soc-action-btn soc-share-btn" data-post="${post.id}"><i class="fa-solid fa-share"></i> Chia sẻ</button>
          <button class="soc-action-btn soc-save-btn ${options.isSaved?'active':''}" data-post="${post.id}"><i class="fa-${options.isSaved?'solid':'regular'} fa-bookmark"></i> Lưu</button>
          ${isDiscussion?`<button class="soc-action-btn" data-ai-summary="${post.id}"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Tóm tắt</button>`:''}
        </div>
        <div class="soc-comments-section" id="socComments_${post.id}" style="display:none;"></div>
      </article>`;
    },

    // Gắn toàn bộ sự kiện cho 1 post-card cụ thể (được gọi lại mỗi lần render feed)
    wirePostCard(cardEl, post, currentUid){
      cardEl.querySelector('[data-open-profile]')?.addEventListener('click', ()=>ProfileManager.openProfileModal(post.uid));

      cardEl.querySelectorAll('.soc-hashtag-link').forEach(a=>a.addEventListener('click', ()=>SocialFeed.searchHashtag(a.dataset.hashtag)));

      const menuBtn = cardEl.querySelector('.soc-post-menu-btn');
      if(menuBtn) menuBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const isOwner = post.uid === currentUid;
        const items = [];
        items.push({label:'Sao chép liên kết', icon:'fa-link', onClick:()=>{ Utils.copyToClipboard(location.origin+location.pathname+'#post-'+post.id); Utils.toast('success','Đã sao chép liên kết',''); }});
        if(isOwner){
          items.push({label:'Chỉnh sửa', icon:'fa-pen', onClick:()=>this.openEditModal(post)});
          items.push({label:post.pinned?'Bỏ ghim':'Ghim bài viết', icon:'fa-thumbtack', onClick:async ()=>{ await this.togglePin(post.id, post.pinned); SocialFeed.refreshCurrent(); }});
          items.push({divider:true});
          items.push({label:'Xoá bài viết', icon:'fa-trash', danger:true, onClick:()=>Utils.confirm('Xoá bài viết?','Không thể hoàn tác.', async ()=>{ await this.deletePost(post.id); SocialFeed.refreshCurrent(); })});
        }else{
          items.push({label:'Báo cáo', icon:'fa-flag', danger:true, onClick:()=>this.openReportModal('post', post.id)});
        }
        if(Utils.isAdmin() && !isOwner){
          items.push({divider:true});
          items.push({label:post.pinned?'[Admin] Bỏ ghim':'[Admin] Ghim bài viết', icon:'fa-thumbtack', onClick:async ()=>{ await this.togglePin(post.id, post.pinned); SocialFeed.refreshCurrent(); }});
          items.push({label:'[Admin] Ẩn/Xoá bài viết', icon:'fa-eye-slash', danger:true, onClick:()=>Utils.confirm('Xoá bài viết này (Admin)?','', async ()=>{ await this.deletePost(post.id); SocialFeed.refreshCurrent(); })});
        }
        UIComponents.dropdown(menuBtn, items);
      });

      // Reaction: click nhanh = like, hover/long-press mở bảng chọn cảm xúc
      const reactBtn = cardEl.querySelector('.soc-react-btn');
      const popup = cardEl.querySelector('.soc-reaction-popup');
      let popupTimer;
      if(reactBtn && popup){
        const wrap = reactBtn.closest('.soc-reaction-trigger-wrap');
        wrap.addEventListener('mouseenter', ()=>{ clearTimeout(popupTimer); popup.classList.add('show'); });
        wrap.addEventListener('mouseleave', ()=>{ popupTimer = setTimeout(()=>popup.classList.remove('show'), 350); });
        reactBtn.addEventListener('click', async ()=>{
          await this.toggleReaction(post.id, 'like');
          SocialFeed.refreshSinglePost(post.id);
        });
        popup.querySelectorAll('.soc-reaction-opt').forEach(opt=>opt.addEventListener('click', async (e)=>{
          e.stopPropagation();
          await this.toggleReaction(post.id, opt.dataset.key);
          popup.classList.remove('show');
          SocialFeed.refreshSinglePost(post.id);
        }));
      }

      const commentTriggers = cardEl.querySelectorAll('[data-open-comments]');
      commentTriggers.forEach(t=>t.addEventListener('click', ()=>{
        const section = cardEl.querySelector('.soc-comments-section');
        const showing = section.style.display !== 'none';
        section.style.display = showing ? 'none' : 'block';
        if(!showing) CommentManager.renderComments(section, post.id);
      }));

      const shareBtn = cardEl.querySelector('.soc-share-btn');
      if(shareBtn) shareBtn.addEventListener('click', async ()=>{
        await Utils.copyToClipboard(location.origin+location.pathname+'#post-'+post.id);
        await FirebaseService.updateDoc(COL.POSTS, post.id, {shareCount: FirebaseService.inc(1)}).catch(()=>{});
        Utils.toast('success','Đã sao chép liên kết chia sẻ','');
        SocialFeed.refreshSinglePost(post.id);
      });

      const saveBtn = cardEl.querySelector('.soc-save-btn');
      if(saveBtn) saveBtn.addEventListener('click', async ()=>{
        const nowSaved = await this.toggleSave(post.id);
        saveBtn.classList.toggle('active', nowSaved);
        saveBtn.querySelector('i').className = nowSaved ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark';
      });

      cardEl.querySelectorAll('.soc-post-img-item').forEach(el=>el.addEventListener('click', ()=>this.openImageLightbox(post.images, +el.dataset.idx)));

      const pollEl = cardEl.querySelector('.soc-poll');
      if(pollEl) pollEl.querySelectorAll('.soc-poll-opt').forEach(opt=>opt.addEventListener('click', async ()=>{
        await this.voteInPoll(post.id, +opt.dataset.i);
        SocialFeed.refreshSinglePost(post.id);
      }));

      const aiBtn = cardEl.querySelector('[data-ai-summary]');
      if(aiBtn) aiBtn.addEventListener('click', ()=>this.openAiSummaryModal(post.id));
    },

    openImageLightbox(images, startIdx){
      let idx = startIdx||0;
      const render = ()=>`<div class="soc-lightbox-inner">
          <img src="${images[idx]}">
          ${images.length>1?`<button class="soc-lightbox-nav prev"><i class="fa-solid fa-chevron-left"></i></button><button class="soc-lightbox-nav next"><i class="fa-solid fa-chevron-right"></i></button>`:''}
        </div>`;
      const modal = UIComponents.openModal(render(), {wide:true});
      const refresh = ()=>{ modal.el.querySelector('.soc-modal-body').innerHTML = render(); wire(); };
      const wire = ()=>{
        const prev = modal.el.querySelector('.prev'); const next = modal.el.querySelector('.next');
        if(prev) prev.addEventListener('click', ()=>{ idx = (idx-1+images.length)%images.length; refresh(); });
        if(next) next.addEventListener('click', ()=>{ idx = (idx+1)%images.length; refresh(); });
      };
      wire();
    },

    openEditModal(post){
      const html = `<h3><i class="fa-solid fa-pen"></i> Chỉnh sửa bài viết</h3>
        <textarea id="socEditPostText" rows="5">${Utils.escapeHtml(post.content)}</textarea>
        <button class="soc-btn primary" id="socSaveEditBtn" style="width:100%;margin-top:10px;"><i class="fa-solid fa-check"></i> Lưu thay đổi</button>`;
      const modal = UIComponents.openModal(html);
      modal.el.querySelector('#socSaveEditBtn').addEventListener('click', async ()=>{
        await this.editPost(post.id, modal.el.querySelector('#socEditPostText').value);
        modal.close();
        SocialFeed.refreshCurrent();
      });
    }
  };

  /* ==========================================================================
     10) CommentManager — Bình luận đa cấp, Reply, Accepted Answer (StackOverflow-style)
     ========================================================================== */
  const CommentManager = {
    async addComment(postId, parentId, content, extra){
      const me = FirebaseService.currentUser();
      const profile = await ProfileManager.getProfile(me.uid);
      if(profile && profile.banned) throw new Error('Tài khoản của bạn đang bị khoá bình luận');
      if(!content || !content.trim()) throw new Error('Bình luận không được để trống');
      if(!FirebaseService.throttleGuard('comment_'+postId, LIMITS.MIN_COMMENT_INTERVAL_MS)) throw new Error('Vui lòng đợi trước khi bình luận tiếp');

      const data = Object.assign({
        postId, parentId: parentId || null,
        uid: me.uid, displayName: me.displayName||'Ẩn danh', photoURL: me.photoURL||'',
        content: content.trim().slice(0,2000),
        reactionCounts: {like:0,love:0,haha:0,wow:0,sad:0},
        accepted: false,
        deleted: false,
        createdAt: FirebaseService.serverTs(),
        updatedAt: FirebaseService.serverTs(),
        edited: false
      }, extra||{});
      const id = await FirebaseService.addDoc(COL.COMMENTS, data);
      await FirebaseService.updateDoc(COL.POSTS, postId, {commentCount: FirebaseService.inc(1)});
      await ProfileManager.addExp(me.uid, 4, 'commentCount');

      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      if(post){
        if(parentId){
          const parent = await FirebaseService.getDoc(COL.COMMENTS, parentId);
          if(parent) await NotificationManager.create(parent.uid, me, 'reply', {postId, excerpt: content.slice(0,60)});
        }else{
          await NotificationManager.create(post.uid, me, 'comment', {postId, excerpt: content.slice(0,60)});
        }
      }
      return id;
    },

    async editComment(commentId, content){
      await FirebaseService.updateDoc(COL.COMMENTS, commentId, {content: content.trim().slice(0,2000), edited:true, updatedAt: FirebaseService.serverTs()});
    },

    async deleteComment(commentId, postId){
      await FirebaseService.updateDoc(COL.COMMENTS, commentId, {deleted:true, content:'[Bình luận đã bị xoá]'});
      await FirebaseService.updateDoc(COL.POSTS, postId, {commentCount: FirebaseService.inc(-1)}).catch(()=>{});
    },

    async toggleCommentReaction(commentId){
      const me = FirebaseService.currentUser();
      const likeId = 'c_'+commentId+'_'+me.uid;
      const existing = await FirebaseService.getDoc(COL.LIKES, likeId);
      const ref = FirebaseService.doc(COL.COMMENTS, commentId);
      if(existing){
        await FirebaseService.deleteDoc(COL.LIKES, likeId);
        await ref.update({'reactionCounts.like': FirebaseService.inc(-1)});
      }else{
        await FirebaseService.setDoc(COL.LIKES, likeId, {commentId, uid:me.uid, type:'like', createdAt: FirebaseService.serverTs()});
        await ref.update({'reactionCounts.like': FirebaseService.inc(1)});
      }
    },

    async markBestAnswer(postId, commentId, currentBestId){
      const batch = FirebaseService.batch();
      if(currentBestId) batch.update(FirebaseService.doc(COL.COMMENTS, currentBestId), {accepted:false});
      batch.update(FirebaseService.doc(COL.COMMENTS, commentId), {accepted:true});
      batch.update(FirebaseService.doc(COL.POSTS, postId), {bestAnswerCommentId: commentId});
      await batch.commit();
      const comment = await FirebaseService.getDoc(COL.COMMENTS, commentId);
      if(comment){
        await ProfileManager.addExp(comment.uid, 25, 'bestAnswerCount');
        const me = FirebaseService.currentUser();
        await NotificationManager.create(comment.uid, me, 'best_answer', {postId});
      }
      Utils.toast('success','Đã đánh dấu câu trả lời hay nhất','+25 EXP cho tác giả');
    },

    buildTree(flatComments){
      const map = {}; const roots = [];
      flatComments.forEach(c=>{ c.children = []; map[c.id] = c; });
      flatComments.forEach(c=>{
        if(c.parentId && map[c.parentId]) map[c.parentId].children.push(c);
        else roots.push(c);
      });
      const sortRec = (list)=>{
        list.sort((a,b)=>{
          if(a.accepted !== b.accepted) return a.accepted ? -1 : 1;
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return ta - tb;
        });
        list.forEach(c=>sortRec(c.children));
      };
      sortRec(roots);
      return roots;
    },

    commentNodeHtml(c, postOwnerUid, depth, isDiscussion){
      const me = FirebaseService.currentUser();
      const isOwner = c.uid === me.uid;
      const totalReactions = Object.values(c.reactionCounts||{}).reduce((s,v)=>s+v,0);
      return `
      <div class="soc-comment-node" data-comment-id="${c.id}" style="--depth:${Math.min(depth,LIMITS.MAX_COMMENT_DEPTH)}">
        <div class="soc-comment-row ${c.accepted?'accepted':''}">
          ${UIComponents.avatarHtml(c.photoURL, c.displayName, 34)}
          <div class="soc-comment-bubble">
            ${c.accepted?'<div class="soc-accepted-flag"><i class="fa-solid fa-check-circle"></i> Câu trả lời được chấp nhận</div>':''}
            <b class="soc-comment-author" data-open-profile="${c.uid}">${Utils.escapeHtml(c.displayName)}</b>
            <div class="soc-comment-text">${c.deleted ? '<i>[Bình luận đã bị xoá]</i>' : Utils.renderMarkdownLite(c.content)}</div>
            <div class="soc-comment-meta">
              <span>${Utils.timeAgo(c.createdAt)}${c.edited?' · đã sửa':''}</span>
              <button class="soc-comment-action soc-comment-like-btn" data-id="${c.id}"><i class="fa-regular fa-thumbs-up"></i> ${totalReactions||''}</button>
              <button class="soc-comment-action soc-comment-reply-btn" data-id="${c.id}" data-name="${Utils.escapeHtml(c.displayName)}">Trả lời</button>
              ${isDiscussion && postOwnerUid===me.uid && !c.deleted ? `<button class="soc-comment-action soc-mark-best-btn" data-id="${c.id}">${c.accepted?'Bỏ đánh dấu hay nhất':'Đánh dấu hay nhất'}</button>` : ''}
              ${isOwner && !c.deleted ? `<button class="soc-comment-action soc-comment-edit-btn" data-id="${c.id}">Sửa</button><button class="soc-comment-action soc-comment-delete-btn" data-id="${c.id}">Xoá</button>` : ''}
              ${!isOwner && !c.deleted ? `<button class="soc-comment-action soc-comment-report-btn" data-id="${c.id}">Báo cáo</button>` : ''}
            </div>
            <div class="soc-reply-box" id="socReplyBox_${c.id}" style="display:none;"></div>
          </div>
        </div>
        ${c.children && c.children.length ? `<div class="soc-comment-children">${c.children.map(ch=>this.commentNodeHtml(ch, postOwnerUid, depth+1, isDiscussion)).join('')}</div>` : ''}
      </div>`;
    },

    replyBoxHtml(){
      const me = FirebaseService.currentUser();
      return `<div class="soc-reply-composer">
        ${UIComponents.avatarHtml(me.photoURL, me.displayName, 30)}
        <input type="text" class="soc-reply-input" placeholder="Viết trả lời...">
        <button class="soc-btn sm primary soc-reply-submit">Gửi</button>
      </div>`;
    },

    async renderComments(container, postId){
      container.innerHTML = `<div class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div>`;
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      const isDiscussion = post && post.type === 'discussion';
      const snap = await FirebaseService.col(COL.COMMENTS).where('postId','==',postId).orderBy('createdAt','asc').limit(300).get();
      const flat = snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
      const tree = this.buildTree(flat);
      container.innerHTML = `
        <div class="soc-comment-composer">
          ${UIComponents.avatarHtml(FirebaseService.currentUser().photoURL, FirebaseService.currentUser().displayName, 34)}
          <input type="text" class="soc-comment-input" placeholder="${isDiscussion?'Viết giải thích / câu trả lời...':'Viết bình luận...'}">
          <button class="soc-btn sm primary soc-comment-submit"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
        <div class="soc-comment-tree">${tree.length ? tree.map(c=>this.commentNodeHtml(c, post.uid, 0, isDiscussion)).join('') : `<div class="soc-text-muted" style="padding:8px 0;">Chưa có bình luận nào. Hãy là người đầu tiên!</div>`}</div>
      `;
      this.wireCommentEvents(container, postId, post);
    },

    wireCommentEvents(container, postId, post){
      const submitTop = async ()=>{
        const input = container.querySelector('.soc-comment-input');
        const val = input.value;
        if(!val.trim()) return;
        input.disabled = true;
        try{
          await this.addComment(postId, null, val);
          input.value = '';
          this.renderComments(container, postId);
        }catch(err){ Utils.toast('error','Không gửi được', err.message); }
        input.disabled = false;
      };
      container.querySelector('.soc-comment-submit').addEventListener('click', submitTop);
      container.querySelector('.soc-comment-input').addEventListener('keydown', e=>{ if(e.key==='Enter') submitTop(); });

      container.querySelectorAll('[data-open-profile]').forEach(el=>el.addEventListener('click', ()=>ProfileManager.openProfileModal(el.dataset.openProfile)));

      container.querySelectorAll('.soc-comment-like-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
        await this.toggleCommentReaction(btn.dataset.id);
        this.renderComments(container, postId);
      }));

      container.querySelectorAll('.soc-comment-reply-btn').forEach(btn=>btn.addEventListener('click', ()=>{
        const box = document.getElementById('socReplyBox_'+btn.dataset.id);
        const showing = box.style.display !== 'none';
        container.querySelectorAll('.soc-reply-box').forEach(b=>b.style.display='none');
        if(showing) return;
        box.innerHTML = this.replyBoxHtml();
        box.style.display = 'block';
        const input = box.querySelector('.soc-reply-input');
        input.placeholder = `Trả lời ${btn.dataset.name}...`;
        input.focus();
        const submit = async ()=>{
          if(!input.value.trim()) return;
          input.disabled = true;
          try{
            await this.addComment(postId, btn.dataset.id, input.value);
            this.renderComments(container, postId);
          }catch(err){ Utils.toast('error','Không gửi được', err.message); }
          input.disabled = false;
        };
        box.querySelector('.soc-reply-submit').addEventListener('click', submit);
        input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
      }));

      container.querySelectorAll('.soc-comment-edit-btn').forEach(btn=>btn.addEventListener('click', ()=>{
        const node = container.querySelector(`[data-comment-id="${btn.dataset.id}"] .soc-comment-text`);
        const current = node.textContent;
        const newText = prompt('Chỉnh sửa bình luận:', current);
        if(newText!==null && newText.trim()){ this.editComment(btn.dataset.id, newText).then(()=>this.renderComments(container, postId)); }
      }));

      container.querySelectorAll('.soc-comment-delete-btn').forEach(btn=>btn.addEventListener('click', ()=>{
        Utils.confirm('Xoá bình luận?','', ()=>{ this.deleteComment(btn.dataset.id, postId).then(()=>this.renderComments(container, postId)); });
      }));

      container.querySelectorAll('.soc-comment-report-btn').forEach(btn=>btn.addEventListener('click', ()=>PostManager.openReportModal('comment', btn.dataset.id)));

      container.querySelectorAll('.soc-mark-best-btn').forEach(btn=>btn.addEventListener('click', async ()=>{
        const alreadyBest = btn.textContent.indexOf('Bỏ')===0;
        if(alreadyBest){
          await FirebaseService.updateDoc(COL.COMMENTS, btn.dataset.id, {accepted:false});
          await FirebaseService.updateDoc(COL.POSTS, postId, {bestAnswerCommentId:null});
        }else{
          await this.markBestAnswer(postId, btn.dataset.id, post.bestAnswerCommentId);
        }
        this.renderComments(container, postId);
      }));
    }
  };

  /* ==========================================================================
     11) SocialFeed — News Feed: query, filter, search, infinite scroll
     ========================================================================== */
  const SocialFeed = {
    _lastDoc: null,
    _loading: false,
    _endReached: false,
    _currentQueryKey: 'home',
    _currentGroupId: null,
    _filter: 'newest', // newest | mostLiked | mostComment | following | hasImage | hasFile | hasPoll
    _searchTerm: '',
    _mountedEl: null,
    _savedIds: new Set(),
    _myReactions: new Map(),
    _followingIds: new Set(),

    async searchHashtag(tag){
      this._searchTerm = '#'+tag;
      SocialApp.setActiveTab('feed');
    },

    baseQuery(context){
      let q = FirebaseService.col(COL.POSTS);
      if(context && context.groupId){ q = q.where('groupId','==', context.groupId); }
      else { q = q.where('groupId','==', null); }
      switch(this._filter){
        case 'mostLiked':
          q = q.orderBy('reactionCounts.like','desc'); break;
        case 'mostComment':
          q = q.orderBy('commentCount','desc'); break;
        default:
          q = q.orderBy('createdAt','desc');
      }
      return q;
    },

    async loadPage(context, reset){
      if(this._loading) return [];
      this._loading = true;
      if(reset){ this._lastDoc = null; this._endReached = false; }
      if(this._endReached){ this._loading = false; return []; }
      try{
        let q = this.baseQuery(context).limit(LIMITS.PAGE_SIZE);
        if(this._lastDoc) q = q.startAfter(this._lastDoc);
        const snap = await q.get();
        if(snap.empty || snap.docs.length < LIMITS.PAGE_SIZE) this._endReached = true;
        if(!snap.empty) this._lastDoc = snap.docs[snap.docs.length-1];
        let posts = snap.docs.map(d=>Object.assign({id:d.id}, d.data()));

        if(this._filter === 'hasImage') posts = posts.filter(p=>p.images && p.images.length);
        if(this._filter === 'hasFile') posts = posts.filter(p=>!!p.pdf);
        if(this._filter === 'hasPoll') posts = posts.filter(p=>!!p.poll);
        if(this._filter === 'following'){
          if(!this._followingIds.size){
            const me = FirebaseService.currentUser();
            this._followingIds = new Set(await FriendManager.listFollowing(me.uid));
          }
          posts = posts.filter(p=>this._followingIds.has(p.uid));
        }
        if(this._searchTerm){
          const term = this._searchTerm.toLowerCase();
          if(term.startsWith('#')){
            posts = posts.filter(p=>(p.hashtags||[]).some(h=>h.toLowerCase()===term.slice(1)));
          }else{
            posts = posts.filter(p=>(p.content||'').toLowerCase().includes(term));
          }
        }
        return posts;
      }catch(err){
        console.error('[Social] loadPage error', err);
        Utils.toast('error','Lỗi tải bảng tin', err.message);
        return [];
      }finally{
        this._loading = false;
      }
    },

    async renderInto(container, context){
      this._mountedEl = container;
      this._currentGroupId = (context && context.groupId) || null;
      this._lastDoc = null; this._endReached = false;
      const me = FirebaseService.currentUser();
      this._savedIds = new Set(await PostManager.listSaved(me.uid).catch(()=>[]));

      container.innerHTML = `
        ${!this._currentGroupId ? PostManager.composerHtml(context) : (context.canPost!==false ? PostManager.composerHtml(context) : '')}
        <div class="soc-feed-filters">
          <button class="soc-filter-chip active" data-f="newest"><i class="fa-solid fa-clock"></i> Mới nhất</button>
          <button class="soc-filter-chip" data-f="mostLiked"><i class="fa-solid fa-fire"></i> Nhiều Like</button>
          <button class="soc-filter-chip" data-f="mostComment"><i class="fa-solid fa-comments"></i> Nhiều Comment</button>
          <button class="soc-filter-chip" data-f="following"><i class="fa-solid fa-user-check"></i> Đang Follow</button>
          <button class="soc-filter-chip" data-f="hasImage"><i class="fa-solid fa-image"></i> Có ảnh</button>
          <button class="soc-filter-chip" data-f="hasFile"><i class="fa-solid fa-paperclip"></i> Có file</button>
          <button class="soc-filter-chip" data-f="hasPoll"><i class="fa-solid fa-square-poll-vertical"></i> Có poll</button>
        </div>
        <div class="soc-feed-list" id="socFeedList"></div>
        <div id="socFeedSentinel" class="soc-feed-sentinel"><i class="fa-solid fa-spinner fa-spin"></i></div>
      `;
      const composerEl = container.querySelector('#socComposer');
      if(composerEl) PostManager.wireComposer(composerEl, Object.assign({onPosted:()=>this.refreshCurrent()}, context));

      container.querySelectorAll('.soc-filter-chip').forEach(chip=>chip.addEventListener('click', ()=>{
        container.querySelectorAll('.soc-filter-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
        this._filter = chip.dataset.f;
        this.refreshCurrent();
      }));

      await this.appendNextPage(context);
      this.setupInfiniteScroll(context);
    },

    async appendNextPage(context){
      const list = document.getElementById('socFeedList');
      const sentinel = document.getElementById('socFeedSentinel');
      if(!list) return;
      if(this._endReached && list.children.length){ if(sentinel) sentinel.style.display='none'; return; }
      const posts = await this.loadPage(context, false);
      const me = FirebaseService.currentUser();
      if(!posts.length && !list.children.length){
        list.innerHTML = UIComponents.emptyStateHtml('fa-comments','Chưa có bài viết nào','Hãy là người đầu tiên chia sẻ điều gì đó!');
        if(sentinel) sentinel.style.display='none';
        return;
      }
      for(const post of posts){
        const myReaction = await PostManager.getMyReaction(post.id, me.uid);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = PostManager.postCardHtml(post, me.uid, {myReaction, isSaved: this._savedIds.has(post.id)});
        const cardEl = wrapper.firstElementChild;
        list.appendChild(cardEl);
        PostManager.wirePostCard(cardEl, post, me.uid);
      }
      if(this._endReached && sentinel) sentinel.style.display = 'none';
    },

    setupInfiniteScroll(context){
      const sentinel = document.getElementById('socFeedSentinel');
      if(!sentinel) return;
      if(this._observer) this._observer.disconnect();
      this._observer = new IntersectionObserver(entries=>{
        entries.forEach(e=>{ if(e.isIntersecting && !this._loading && !this._endReached) this.appendNextPage(context); });
      }, {rootMargin:'400px'});
      this._observer.observe(sentinel);
    },

    async refreshCurrent(){
      if(!this._mountedEl) return;
      const list = document.getElementById('socFeedList');
      if(list) list.innerHTML = UIComponents.skeletonPostHtml()+UIComponents.skeletonPostHtml();
      this._lastDoc = null; this._endReached = false;
      if(list) list.innerHTML = '';
      const sentinel = document.getElementById('socFeedSentinel');
      if(sentinel) sentinel.style.display = '';
      await this.appendNextPage({groupId: this._currentGroupId});
    },

    async refreshSinglePost(postId){
      const cardEl = document.querySelector(`.soc-post[data-post-id="${postId}"]`);
      if(!cardEl) return;
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      if(!post) { cardEl.remove(); return; }
      const me = FirebaseService.currentUser();
      const myReaction = await PostManager.getMyReaction(postId, me.uid);
      const wasCommentsOpen = cardEl.querySelector('.soc-comments-section')?.style.display !== 'none';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = PostManager.postCardHtml(post, me.uid, {myReaction, isSaved:this._savedIds.has(postId)});
      const newCard = wrapper.firstElementChild;
      cardEl.replaceWith(newCard);
      PostManager.wirePostCard(newCard, post, me.uid);
      if(wasCommentsOpen){
        const section = newCard.querySelector('.soc-comments-section');
        section.style.display = 'block';
        CommentManager.renderComments(section, postId);
      }
    },

    async openSinglePostModal(postId){
      const post = await FirebaseService.getDoc(COL.POSTS, postId);
      if(!post){ Utils.toast('error','Bài viết không tồn tại hoặc đã bị xoá',''); return; }
      const me = FirebaseService.currentUser();
      const myReaction = await PostManager.getMyReaction(postId, me.uid);
      const isSaved = this._savedIds.has(postId);
      const html = PostManager.postCardHtml(post, me.uid, {myReaction, isSaved});
      const modal = UIComponents.openModal(html, {wide:true});
      const cardEl = modal.el.querySelector('.soc-post');
      PostManager.wirePostCard(cardEl, post, me.uid);
      const section = cardEl.querySelector('.soc-comments-section');
      section.style.display = 'block';
      CommentManager.renderComments(section, postId);
    },

    async renderSavedView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `<div class="soc-feed-list" id="socSavedList">${UIComponents.skeletonPostHtml()}</div>`;
      const me = FirebaseService.currentUser();
      const ids = await PostManager.listSaved(me.uid);
      const list = document.getElementById('socSavedList');
      if(!ids.length){ list.innerHTML = UIComponents.emptyStateHtml('fa-bookmark','Chưa lưu bài viết nào','Bấm "Lưu" trên bất kỳ bài viết nào để xem lại sau'); return; }
      list.innerHTML = '';
      for(const id of ids){
        const post = await FirebaseService.getDoc(COL.POSTS, id);
        if(!post) continue;
        const myReaction = await PostManager.getMyReaction(id, me.uid);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = PostManager.postCardHtml(post, me.uid, {myReaction, isSaved:true});
        const cardEl = wrapper.firstElementChild;
        list.appendChild(cardEl);
        PostManager.wirePostCard(cardEl, post, me.uid);
      }
    },

    async renderTrendingView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `<div id="socTrendingInner" class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div>`;
      const snap = await FirebaseService.col(COL.TAGS).orderBy('count','desc').limit(20).get();
      const tags = snap.docs.map(d=>d.data());
      document.getElementById('socTrendingInner').innerHTML = !tags.length
        ? UIComponents.emptyStateHtml('fa-hashtag','Chưa có xu hướng nào','')
        : `<div class="soc-trending-grid">${tags.map(t=>`
            <button class="soc-trending-item" data-hashtag="${Utils.escapeHtml(t.tag)}">
              <span class="soc-trending-hash">#${Utils.escapeHtml(t.tag)}</span>
              <span class="soc-trending-count">${t.count} bài viết</span>
            </button>`).join('')}</div>`;
      document.querySelectorAll('#socTrendingInner .soc-trending-item').forEach(btn=>btn.addEventListener('click', ()=>this.searchHashtag(btn.dataset.hashtag)));
    }
  };

  /* ==========================================================================
     12) ChatManager — Messenger nổi góc phải, realtime, typing, seen
     ========================================================================== */
  const ChatManager = {
    _openConversations: new Map(), // conversationId -> {el, otherUid, otherProfile}
    _typingTimer: null,

    conversationId(a,b){ return [a,b].sort().join('__'); },

    async openConversationWith(otherUid, otherProfileHint){
      const me = FirebaseService.currentUser();
      if(otherUid === me.uid) return;
      const convId = this.conversationId(me.uid, otherUid);
      if(this._openConversations.has(convId)){
        this._openConversations.get(convId).el.classList.remove('minimized');
        return;
      }
      const otherProfile = otherProfileHint || await ProfileManager.getProfile(otherUid);
      await FirebaseService.setDoc(COL.CONVERSATIONS, convId, {
        members: [me.uid, otherUid],
        [`meta_${me.uid}`]: {name: me.displayName, photo: me.photoURL},
        [`meta_${otherUid}`]: {name: otherProfile?.displayName||'Người dùng', photo: otherProfile?.photoURL||''},
        updatedAt: FirebaseService.serverTs()
      }, true);

      const win = document.createElement('div');
      win.className = 'soc-chat-window';
      win.innerHTML = `
        <div class="soc-chat-head">
          ${UIComponents.avatarHtml(otherProfile?.photoURL, otherProfile?.displayName, 32)}
          <b>${Utils.escapeHtml(otherProfile?.displayName||'Người dùng')}</b>
          <span class="soc-chat-typing-indicator" style="display:none;">đang nhập...</span>
          <div class="soc-chat-head-actions">
            <button class="soc-icon-btn sm soc-chat-min-btn"><i class="fa-solid fa-minus"></i></button>
            <button class="soc-icon-btn sm soc-chat-close-btn"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="soc-chat-body" id="socChatBody_${convId}"><div class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div></div>
        <div class="soc-chat-input-row">
          <button class="soc-icon-btn sm soc-chat-emoji-btn"><i class="fa-regular fa-face-smile"></i></button>
          <button class="soc-icon-btn sm soc-chat-image-btn"><i class="fa-solid fa-image"></i></button>
          <input type="file" class="soc-chat-image-input" accept="image/*" style="display:none;">
          <input type="text" class="soc-chat-text-input" placeholder="Nhắn tin...">
          <button class="soc-icon-btn sm primary soc-chat-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
        </div>`;
      document.getElementById('socChatDock').appendChild(win);
      this._openConversations.set(convId, {el: win, otherUid, otherProfile});
      this.wireChatWindow(win, convId, otherUid);
      this.listenMessages(convId, otherUid);
      this.listenTyping(convId, otherUid, win.querySelector('.soc-chat-typing-indicator'));
    },

    wireChatWindow(win, convId, otherUid){
      const me = FirebaseService.currentUser();
      win.querySelector('.soc-chat-head').addEventListener('click', (e)=>{
        if(e.target.closest('.soc-chat-head-actions')) return;
        win.classList.toggle('minimized');
      });
      win.querySelector('.soc-chat-min-btn').addEventListener('click', e=>{ e.stopPropagation(); win.classList.toggle('minimized'); });
      win.querySelector('.soc-chat-close-btn').addEventListener('click', e=>{
        e.stopPropagation();
        RealtimeManager.detach('chat_msg_'+convId);
        RealtimeManager.detach('chat_typing_'+convId);
        this._openConversations.delete(convId);
        win.remove();
      });

      const input = win.querySelector('.soc-chat-text-input');
      const send = async ()=>{
        const text = input.value.trim();
        if(!text) return;
        input.value = '';
        await this.sendMessage(convId, otherUid, {text});
        this.setTyping(convId, false);
      };
      win.querySelector('.soc-chat-send-btn').addEventListener('click', send);
      input.addEventListener('keydown', e=>{ if(e.key==='Enter') send(); });
      input.addEventListener('input', Utils.debounce(()=>{
        this.setTyping(convId, input.value.length>0);
        if(input.value.length===0) this.setTyping(convId, false);
      }, 250));

      win.querySelector('.soc-chat-emoji-btn').addEventListener('click', ()=>{
        const emojis = ['😀','😂','❤️','👍','🔥','🎉','😢','😮'];
        const pick = prompt('Chọn emoji (dán vào ô nhắn):\n'+emojis.join(' '));
        if(pick) input.value += pick;
      });

      win.querySelector('.soc-chat-image-btn').addEventListener('click', ()=>win.querySelector('.soc-chat-image-input').click());
      win.querySelector('.soc-chat-image-input').addEventListener('change', async e=>{
        const f = e.target.files[0]; if(!f) return;
        try{
          const dataUrl = await Utils.compressImageToDataURL(f, 800, 0.7);
          await this.sendMessage(convId, otherUid, {imageUrl: dataUrl});
        }catch(err){ Utils.toast('error','Lỗi ảnh', err.message); }
        e.target.value = '';
      });
    },

    async sendMessage(convId, otherUid, payload){
      const me = FirebaseService.currentUser();
      const data = Object.assign({
        conversationId: convId,
        from: me.uid, to: otherUid,
        fromName: me.displayName, fromPhoto: me.photoURL,
        seenBy: [me.uid],
        createdAt: FirebaseService.serverTs()
      }, payload);
      await FirebaseService.addDoc(COL.MESSAGES, data);
      await FirebaseService.setDoc(COL.CONVERSATIONS, convId, {
        lastMessage: payload.text || (payload.imageUrl ? '[Hình ảnh]' : '[Tệp]'),
        lastFrom: me.uid,
        updatedAt: FirebaseService.serverTs()
      }, true);
    },

    listenMessages(convId, otherUid){
      const body = document.getElementById('socChatBody_'+convId);
      RealtimeManager.attach('chat_msg_'+convId, FirebaseService.col(COL.MESSAGES)
        .where('conversationId','==',convId).orderBy('createdAt','asc').limitToLast(50)
        .onSnapshot(snap=>{
          const me = FirebaseService.currentUser();
          const msgs = snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
          if(!body) return;
          body.innerHTML = msgs.length ? msgs.map(m=>{
            const mine = m.from === me.uid;
            return `<div class="soc-chat-msg ${mine?'mine':'theirs'}">
              ${m.imageUrl ? `<img src="${m.imageUrl}" class="soc-chat-msg-img">` : ''}
              ${m.text ? `<div class="soc-chat-msg-bubble">${Utils.renderMarkdownLite(m.text)}</div>` : ''}
              <span class="soc-chat-msg-time">${Utils.timeAgo(m.createdAt)}</span>
            </div>`;
          }).join('') : `<div class="soc-text-muted" style="text-align:center;padding:20px;">Bắt đầu cuộc trò chuyện!</div>`;
          body.scrollTop = body.scrollHeight;
          // đánh dấu đã xem các tin nhắn của đối phương
          snap.docs.forEach(d=>{
            const v = d.data();
            if(v.from !== me.uid && !(v.seenBy||[]).includes(me.uid)){
              d.ref.update({seenBy: FirebaseService.arrUnion(me.uid)}).catch(()=>{});
            }
          });
        }, err=>console.warn('[Social] chat listener error', err)));
    },

    async setTyping(convId, isTyping){
      const me = FirebaseService.currentUser();
      await FirebaseService.updateDoc(COL.CONVERSATIONS, convId, {
        [`typing_${me.uid}`]: isTyping ? Date.now() : 0
      }).catch(()=>{});
    },

    listenTyping(convId, otherUid, indicatorEl){
      RealtimeManager.attach('chat_typing_'+convId, FirebaseService.doc(COL.CONVERSATIONS, convId)
        .onSnapshot(snap=>{
          if(!snap.exists || !indicatorEl) return;
          const data = snap.data();
          const ts = data['typing_'+otherUid];
          const isTyping = ts && (Date.now() - ts) < 3500;
          indicatorEl.style.display = isTyping ? 'inline' : 'none';
        }));
    },

    async listConversations(uid){
      const snap = await FirebaseService.col(COL.CONVERSATIONS).where('members','array-contains',uid).orderBy('updatedAt','desc').limit(30).get();
      return snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
    },

    async renderMessagesView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `<div class="soc-conv-list" id="socConvList">${UIComponents.skeletonPostHtml()}</div>`;
      const me = FirebaseService.currentUser();
      const convs = await this.listConversations(me.uid);
      const list = document.getElementById('socConvList');
      if(!convs.length){ list.innerHTML = UIComponents.emptyStateHtml('fa-comment-dots','Chưa có cuộc trò chuyện nào','Nhắn tin cho bạn bè từ hồ sơ của họ'); return; }
      list.innerHTML = convs.map(c=>{
        const otherUid = c.members.find(m=>m!==me.uid);
        const meta = c[`meta_${otherUid}`] || {};
        const isLastMine = c.lastFrom === me.uid;
        return `<div class="soc-conv-item" data-uid="${otherUid}">
          ${UIComponents.avatarHtml(meta.photo, meta.name, 48)}
          <div class="soc-conv-info"><b>${Utils.escapeHtml(meta.name||'Người dùng')}</b><span>${isLastMine?'Bạn: ':''}${Utils.escapeHtml((c.lastMessage||'').slice(0,40))}</span></div>
          <span class="soc-conv-time">${Utils.timeAgo(c.updatedAt)}</span>
        </div>`;
      }).join('');
      list.querySelectorAll('.soc-conv-item').forEach(item=>item.addEventListener('click', ()=>this.openConversationWith(item.dataset.uid)));
    }
  };

  /* ==========================================================================
     13) LeaderboardManager — Top tuần / tháng / năm / mọi thời đại
     ========================================================================== */
  const LeaderboardManager = {
    async topAllTime(n){
      const snap = await FirebaseService.col(COL.PROFILES).orderBy('exp','desc').limit(n||20).get();
      return snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
    },

    // Xấp xỉ top tuần/tháng: đếm số bài viết + bình luận gần đây theo tác giả
    // (Firestore không hỗ trợ aggregate theo khoảng thời gian tuỳ ý một cách rẻ,
    // nên đây là ước lượng dựa trên NGƯỠNG_LẤY_MẪU bài viết/bình luận gần nhất)
    async topByRecentActivity(days, n){
      const cutoff = Date.now() - days*24*60*60*1000;
      const [postsSnap, commentsSnap] = await Promise.all([
        FirebaseService.col(COL.POSTS).orderBy('createdAt','desc').limit(300).get(),
        FirebaseService.col(COL.COMMENTS).orderBy('createdAt','desc').limit(300).get()
      ]);
      const score = {};
      const bump = (uid, name, photo, pts)=>{
        if(!uid) return;
        if(!score[uid]) score[uid] = {uid, displayName:name, photoURL:photo, points:0};
        score[uid].points += pts;
      };
      postsSnap.docs.forEach(d=>{
        const v = d.data();
        const ms = v.createdAt && v.createdAt.toMillis ? v.createdAt.toMillis() : 0;
        if(ms >= cutoff) bump(v.uid, v.displayName, v.photoURL, 10);
      });
      commentsSnap.docs.forEach(d=>{
        const v = d.data();
        const ms = v.createdAt && v.createdAt.toMillis ? v.createdAt.toMillis() : 0;
        if(ms >= cutoff) bump(v.uid, v.displayName, v.photoURL, 4);
      });
      return Object.values(score).sort((a,b)=>b.points-a.points).slice(0, n||20);
    },

    rowHtml(item, rank, isAllTime){
      const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank;
      return `<div class="soc-leader-row ${rank<=3?'top3':''}" data-uid="${item.uid||item.id}">
        <span class="soc-leader-rank">${medal}</span>
        ${UIComponents.avatarHtml(item.photoURL, item.displayName, 42)}
        <div class="soc-leader-info"><b>${Utils.escapeHtml(item.displayName)}</b>${isAllTime?UIComponents.levelBadgeHtml(item.exp):''}</div>
        <span class="soc-leader-points">${isAllTime ? (item.exp||0)+' EXP' : (item.points||0)+' điểm'}</span>
      </div>`;
    },

    async renderLeaderboardView(){
      const wrap = document.getElementById('socTabContent');
      wrap.innerHTML = `${UIComponents.tabsHtml([
          {key:'week', label:'Top tuần', icon:'fa-calendar-week'},
          {key:'month', label:'Top tháng', icon:'fa-calendar-days'},
          {key:'alltime', label:'Mọi thời đại', icon:'fa-crown'}
        ], 'week')}
        <div id="socLeaderInner" class="soc-loading-block">${UIComponents.skeletonPostHtml()}</div>`;
      const load = async (key)=>{
        const inner = document.getElementById('socLeaderInner');
        inner.innerHTML = UIComponents.skeletonPostHtml();
        let items, isAllTime = false;
        if(key==='week') items = await this.topByRecentActivity(7, 20);
        else if(key==='month') items = await this.topByRecentActivity(30, 20);
        else { items = await this.topAllTime(20); isAllTime = true; }
        inner.innerHTML = items.length ? items.map((it,i)=>this.rowHtml(it, i+1, isAllTime)).join('') : UIComponents.emptyStateHtml('fa-ranking-star','Chưa có dữ liệu xếp hạng','');
        inner.querySelectorAll('.soc-leader-row').forEach(r=>r.addEventListener('click', ()=>ProfileManager.openProfileModal(r.dataset.uid)));
      };
      wrap.querySelectorAll('.soc-tab-btn').forEach(t=>t.addEventListener('click', ()=>{
        wrap.querySelectorAll('.soc-tab-btn').forEach(x=>x.classList.remove('active')); t.classList.add('active');
        load(t.dataset.tab);
      }));
      load('week');
    },

    async renderMiniWidget(container){
      const items = await this.topAllTime(5);
      container.innerHTML = `<h4 class="soc-widget-title"><i class="fa-solid fa-crown"></i> Top Contributor</h4>
        ${items.length ? items.map((it,i)=>this.rowHtml(it,i+1,true)).join('') : '<span class="soc-text-muted">Chưa có dữ liệu</span>'}`;
      container.querySelectorAll('.soc-leader-row').forEach(r=>r.addEventListener('click', ()=>ProfileManager.openProfileModal(r.dataset.uid)));
    }
  };

  /* ==========================================================================
     14) SocialApp — CSS injection, DOM injection, điều hướng tab, khởi tạo
     ========================================================================== */
  const SocialApp = {
    state: { activeTab: 'feed', initialized: false, presenceTimer: null },

    /* ---- 14.1 CSS: toàn bộ style của module, dùng lại biến CSS gốc của index ---- */
    injectStyles(){
      if(document.getElementById('socialModuleStyles')) return;
      const style = document.createElement('style');
      style.id = 'socialModuleStyles';
      style.textContent = `
/* ============ SOCIAL MODULE — SCOPE .soc- ============ */
#view-social{padding:0 !important;}
.soc-app-shell{display:flex; flex-direction:column; gap:16px; max-width:1400px; margin:0 auto;}

.soc-search-bar{display:flex; align-items:center; gap:10px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-md); padding:10px 16px; backdrop-filter:var(--glass-blur); margin-bottom:14px;}
.soc-search-bar i{color:var(--text-muted);}
.soc-search-bar input{flex:1; border:none; background:transparent; outline:none; color:var(--text-main); font-size:14px;}
.soc-search-results{position:absolute; z-index:200; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); margin-top:6px; max-height:340px; overflow:auto; width:100%;}

.soc-layout-3col{display:grid; grid-template-columns:250px minmax(0,1fr) 280px; gap:18px; align-items:start;}
.soc-left-col, .soc-right-col{position:sticky; top:14px;}
.soc-left-col .soc-card, .soc-right-col .soc-card{padding:14px;}

.soc-left-menu{display:flex; flex-direction:column; gap:2px;}
.soc-left-menu-item{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:12px; font-size:14px; font-weight:600; color:var(--text-main); transition:var(--trans); width:100%; text-align:left; position:relative;}
.soc-left-menu-item i{width:18px; text-align:center; color:var(--accent);}
.soc-left-menu-item:hover{background:rgba(20,120,212,.08);}
.soc-left-menu-item.active{background:linear-gradient(90deg, rgba(20,120,212,.16), rgba(6,182,212,.06)); color:var(--accent);}
.soc-left-menu-item .soc-badge-dot{margin-left:auto; background:var(--danger); color:#fff; font-size:10px; font-weight:800; padding:2px 7px; border-radius:20px; min-width:18px; text-align:center; display:none;}

.soc-widget-title{font-size:12px; text-transform:uppercase; letter-spacing:.6px; color:var(--text-muted); font-weight:800; margin-bottom:10px;}

.soc-card{background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); backdrop-filter:var(--glass-blur); padding:18px; animation:socFadeIn .25s ease;}
@keyframes socFadeIn{from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:translateY(0);}}

/* ---- Avatar ---- */
.soc-avatar{border-radius:50%; object-fit:cover; flex-shrink:0; background:var(--blue-200);}
.soc-avatar-fallback{display:flex; align-items:center; justify-content:center; border-radius:50%; background:linear-gradient(135deg,var(--blue-400),var(--cyan-400)); color:#00263f; font-weight:800; flex-shrink:0;}
.soc-online-dot{width:10px; height:10px; border-radius:50%; display:inline-block; border:2px solid var(--card-bg-solid);}
.soc-online-dot.on{background:var(--success);} .soc-online-dot.off{background:var(--text-muted);}

/* ---- Buttons / chips ---- */
.soc-btn{display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:12px; background:rgba(20,120,212,.08); color:var(--accent); font-weight:700; font-size:13px; transition:var(--trans);}
.soc-btn:hover{background:rgba(20,120,212,.16);}
.soc-btn.primary{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; box-shadow:0 6px 18px rgba(20,120,212,.28);}
.soc-btn.primary:hover{filter:brightness(1.08);}
.soc-btn.danger{background:rgba(239,68,68,.1); color:var(--danger);}
.soc-btn.danger:hover{background:rgba(239,68,68,.18);}
.soc-btn.sm{padding:6px 12px; font-size:12px;}
.soc-btn:disabled{opacity:.6; cursor:not-allowed;}
.soc-icon-btn{width:38px; height:38px; border-radius:11px; display:flex; align-items:center; justify-content:center; background:rgba(20,120,212,.08); color:var(--accent); transition:var(--trans); flex-shrink:0;}
.soc-icon-btn:hover{background:rgba(20,120,212,.16);}
.soc-icon-btn.sm{width:30px; height:30px; font-size:12px;}
.soc-icon-btn.primary{background:var(--accent); color:#fff;}
.soc-chip-btn{background:rgba(20,120,212,.08); color:var(--accent); border-radius:20px; padding:5px 12px; font-size:12px; font-weight:700;}
.soc-chip-btn:hover{background:rgba(20,120,212,.16);}
.soc-filter-chip{background:rgba(20,120,212,.06); color:var(--text-muted); border-radius:20px; padding:8px 14px; font-size:12.5px; font-weight:700; display:inline-flex; gap:6px; align-items:center; transition:var(--trans);}
.soc-filter-chip.active, .soc-filter-chip:hover{background:var(--accent); color:#fff;}
.soc-feed-filters{display:flex; gap:8px; flex-wrap:wrap; margin:14px 0;}
.soc-row-gap{display:flex; gap:8px;}
.soc-text-muted{color:var(--text-muted);}
.soc-section-title{font-size:14px; font-weight:800; margin:18px 0 10px;}

/* ---- Composer ---- */
.soc-composer{padding:16px;}
.soc-composer-top{display:flex; gap:12px;}
.soc-composer-top textarea{flex:1; border:1px solid var(--card-border); border-radius:14px; padding:12px 14px; background:rgba(255,255,255,.5); color:var(--text-main); resize:vertical; font-size:14px; font-family:inherit;}
[data-theme="dark"] .soc-composer-top textarea{background:rgba(255,255,255,.05);}
.soc-composer-toolbar{display:flex; gap:8px; margin:10px 0 4px 58px; flex-wrap:wrap;}
.soc-composer-footer{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; flex-wrap:wrap;}
.soc-composer-hashtags{display:flex; gap:6px; flex-wrap:wrap;}
.soc-emoji-picker{display:grid; grid-template-columns:repeat(10,1fr); gap:4px; margin:10px 0 0 58px; padding:10px; background:rgba(20,120,212,.05); border-radius:12px;}
.soc-emoji-item{font-size:18px; padding:4px; border-radius:8px;}
.soc-emoji-item:hover{background:rgba(20,120,212,.14);}
.soc-composer-preview{margin:10px 0 0 58px;}
.soc-preview-images{display:grid; grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:8px;}
.soc-preview-img-wrap{position:relative; border-radius:10px; overflow:hidden; aspect-ratio:1;}
.soc-preview-img-wrap img{width:100%; height:100%; object-fit:cover;}
.soc-preview-remove{position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px;}
.soc-preview-file, .soc-preview-code, .soc-preview-poll, .soc-preview-link{position:relative; background:rgba(20,120,212,.06); border-radius:12px; padding:10px 34px 10px 12px; margin-top:6px; font-size:13px;}
.soc-preview-code pre{white-space:pre-wrap; font-family:monospace; font-size:12px; margin:0;}

/* ---- Post card ---- */
.soc-post-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;}
.soc-post-head-left{display:flex; gap:12px; align-items:center; cursor:pointer;}
.soc-post-meta{font-size:12px; color:var(--text-muted);}
.soc-discussion-tag{color:var(--accent); font-weight:700;}
.soc-admin-tag{color:var(--accent); font-size:12px; margin-left:4px;}
.soc-pinned-flag{display:inline-flex; align-items:center; gap:6px; color:var(--accent); font-size:12px; font-weight:700; margin-bottom:8px;}
.soc-post-content{font-size:14.5px; line-height:1.6; color:var(--text-main); white-space:pre-wrap; word-break:break-word;}
.soc-post-content .soc-codeblock, .soc-codeblock{background:rgba(4,32,63,.06); border-radius:10px; padding:12px; overflow:auto; font-family:'Courier New',monospace; font-size:12.5px; margin-top:8px;}
[data-theme="dark"] .soc-post-content .soc-codeblock, [data-theme="dark"] .soc-codeblock{background:rgba(255,255,255,.06);}
.soc-inline-code{background:rgba(20,120,212,.1); padding:1px 6px; border-radius:6px; font-family:monospace; font-size:12.5px;}
.soc-post-hashtags{margin-top:6px;}
.soc-hashtag-link, .soc-mention-link{color:var(--accent); font-weight:700;}
.soc-post-images{display:grid; gap:4px; margin-top:10px; border-radius:14px; overflow:hidden;}
.soc-post-images.grid-1{grid-template-columns:1fr;}
.soc-post-images.grid-2{grid-template-columns:1fr 1fr;}
.soc-post-images.grid-3{grid-template-columns:2fr 1fr; grid-template-rows:1fr 1fr;}
.soc-post-images.grid-3 .soc-post-img-item:first-child{grid-row:1/3;}
.soc-post-images.grid-4{grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr;}
.soc-post-img-item{position:relative; cursor:pointer; overflow:hidden; max-height:360px;}
.soc-post-img-item img{width:100%; height:100%; object-fit:cover; display:block; transition:transform .3s;}
.soc-post-img-item:hover img{transform:scale(1.04);}
.soc-more-overlay{position:absolute; inset:0; background:rgba(0,0,0,.5); color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:800;}
.soc-file-chip, .soc-link-chip{display:flex; align-items:center; gap:8px; background:rgba(20,120,212,.06); border-radius:10px; padding:10px 14px; margin-top:10px; font-size:13px; color:var(--text-main); word-break:break-all;}
.soc-file-chip:hover, .soc-link-chip:hover{background:rgba(20,120,212,.12);}
.soc-file-chip span{color:var(--text-muted); font-size:11px;}

.soc-poll{margin-top:10px; background:rgba(20,120,212,.05); border-radius:12px; padding:12px;}
.soc-poll b{display:block; margin-bottom:8px; font-size:13.5px;}
.soc-poll-opt{position:relative; display:flex; justify-content:space-between; width:100%; padding:9px 12px; border-radius:9px; background:rgba(20,120,212,.06); margin-bottom:6px; overflow:hidden; font-size:13px;}
.soc-poll-opt-fill{position:absolute; left:0; top:0; bottom:0; background:rgba(20,120,212,.18); z-index:0; transition:width .4s;}
.soc-poll-opt.voted{outline:2px solid var(--accent);}
.soc-poll-opt-label, .soc-poll-opt-pct{position:relative; z-index:1; font-weight:700;}
.soc-poll-total{font-size:11px; color:var(--text-muted);}

.soc-post-stats{display:flex; justify-content:space-between; align-items:center; margin-top:12px; font-size:12.5px; color:var(--text-muted);}
.soc-reaction-summary{display:flex; align-items:center; gap:6px;}
.soc-reaction-icons span{font-size:14px;}
.soc-comment-count-label{cursor:pointer;}
.soc-comment-count-label:hover{text-decoration:underline;}

.soc-post-actions{display:flex; gap:4px; border-top:1px solid var(--card-border); border-bottom:1px solid var(--card-border); margin-top:10px; padding:6px 0; flex-wrap:wrap;}
.soc-action-btn{flex:1; min-width:90px; display:flex; align-items:center; justify-content:center; gap:7px; padding:8px; border-radius:10px; font-size:13px; font-weight:700; color:var(--text-muted); transition:var(--trans);}
.soc-action-btn:hover{background:rgba(20,120,212,.08); color:var(--accent);}
.soc-action-btn.active{color:var(--accent);}
.soc-reaction-trigger-wrap{position:relative; flex:1; display:flex;}
.soc-reaction-popup{position:absolute; bottom:calc(100% + 6px); left:0; display:flex; gap:4px; background:var(--card-bg-solid); border:1px solid var(--card-border); box-shadow:var(--shadow-md); border-radius:30px; padding:6px 8px; opacity:0; pointer-events:none; transform:translateY(6px); transition:all .18s;}
.soc-reaction-popup.show{opacity:1; pointer-events:auto; transform:translateY(0);}
.soc-reaction-opt{font-size:20px; transition:transform .15s;}
.soc-reaction-opt:hover{transform:scale(1.35) translateY(-4px);}

/* ---- Comments ---- */
.soc-comments-section{margin-top:12px; padding-top:12px; border-top:1px solid var(--card-border);}
.soc-comment-composer{display:flex; gap:10px; align-items:center; margin-bottom:12px;}
.soc-comment-input, .soc-reply-input{flex:1; border:1px solid var(--card-border); border-radius:20px; padding:9px 14px; background:rgba(20,120,212,.05); color:var(--text-main); font-size:13px;}
.soc-comment-tree{display:flex; flex-direction:column; gap:10px;}
.soc-comment-node{margin-left:calc(var(--depth,0) * 26px);}
.soc-comment-row{display:flex; gap:10px;}
.soc-comment-bubble{background:rgba(20,120,212,.05); border-radius:14px; padding:8px 14px; flex:1;}
.soc-comment-bubble.accepted, .soc-comment-row.accepted .soc-comment-bubble{background:rgba(22,199,132,.1); border:1px solid rgba(22,199,132,.3);}
.soc-accepted-flag{color:var(--success); font-size:11px; font-weight:800; margin-bottom:4px;}
.soc-comment-author{font-size:13px; cursor:pointer;}
.soc-comment-text{font-size:13.5px; line-height:1.5; margin-top:2px; word-break:break-word;}
.soc-comment-meta{display:flex; gap:12px; flex-wrap:wrap; margin-top:6px; font-size:11.5px; color:var(--text-muted);}
.soc-comment-action{font-weight:700;}
.soc-comment-action:hover{color:var(--accent);}
.soc-reply-composer{display:flex; gap:8px; align-items:center; margin-top:8px;}
.soc-reply-box{margin-top:4px;}

/* ---- Modal ---- */
.soc-modal-overlay{position:fixed; inset:0; background:rgba(3,19,36,.55); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:9999; opacity:0; transition:opacity .2s; padding:16px;}
.soc-modal-overlay.show{opacity:1;}
.soc-modal{background:var(--card-bg-solid); border-radius:var(--radius-lg); max-width:480px; width:100%; max-height:88vh; overflow:auto; padding:24px; position:relative; box-shadow:var(--shadow-lg); transform:translateY(14px) scale(.98); transition:transform .22s;}
.soc-modal-overlay.show .soc-modal{transform:translateY(0) scale(1);}
.soc-modal-wide{max-width:640px;}
.soc-modal-close{position:absolute; top:14px; right:14px; width:32px; height:32px; border-radius:50%; background:rgba(20,120,212,.08); color:var(--text-muted);}
.soc-modal-close:hover{background:rgba(239,68,68,.12); color:var(--danger);}
.soc-modal-actions{display:flex; gap:10px; margin-top:16px;}
.soc-form-field{margin-bottom:14px;}
.soc-form-field label{display:block; font-size:12.5px; font-weight:700; margin-bottom:6px; color:var(--text-muted);}
.soc-form-field input, .soc-form-field select, .soc-form-field textarea{width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--card-border); background:rgba(20,120,212,.04); color:var(--text-main); font-size:13.5px; font-family:inherit;}
#socEditPostText, #socBioInput, #socReportDetail{width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--card-border); background:rgba(20,120,212,.04); color:var(--text-main); font-family:inherit; font-size:13.5px; margin-top:8px;}
.soc-radio-row{display:flex; align-items:center; gap:8px; font-size:13.5px; padding:6px 0;}

/* ---- Profile modal ---- */
.soc-profile-header{text-align:center; padding-bottom:14px; border-bottom:1px solid var(--card-border);}
.soc-profile-header h3{margin-top:10px; font-size:18px;}
.soc-profile-bio{font-size:13px; color:var(--text-muted); margin-top:4px;}
.soc-profile-level-row{display:flex; flex-direction:column; align-items:center; gap:6px; margin-top:12px;}
.soc-level-chip{display:inline-flex; align-items:center; gap:5px; background:var(--lvl-color,var(--accent)); color:#fff; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800;}
.soc-level-chip.lg{padding:6px 16px; font-size:13px;}
.soc-exp-bar{width:220px; height:8px; background:rgba(20,120,212,.1); border-radius:10px; overflow:hidden;}
.soc-exp-bar-fill{height:100%; background:linear-gradient(90deg,var(--blue-500),var(--cyan-500));}
.soc-exp-text{font-size:11px; color:var(--text-muted);}
.soc-profile-stats{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:16px 0; text-align:center;}
.soc-profile-stats b{display:block; font-size:16px;}
.soc-profile-stats span{font-size:11px; color:var(--text-muted);}
.soc-profile-badges{display:flex; flex-wrap:wrap; gap:8px; padding:10px 0;}
.soc-badge-chip{display:inline-flex; align-items:center; gap:6px; background:color-mix(in srgb, var(--b-color) 16%, transparent); color:var(--b-color); padding:5px 12px; border-radius:20px; font-size:11.5px; font-weight:800;}
.soc-profile-edit textarea{width:100%; min-height:70px; margin-bottom:10px;}
.soc-profile-actions{display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;}
.soc-profile-mini{display:flex; gap:10px; align-items:center;}
.soc-profile-mini-info b{display:block; font-size:13px;}

/* ---- People / Groups grid ---- */
.soc-people-grid, .soc-group-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px;}
.soc-people-card{background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:14px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:8px; cursor:pointer; transition:var(--trans);}
.soc-people-card:hover{box-shadow:var(--shadow-md); transform:translateY(-2px);}
.soc-group-card{background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; overflow:hidden; cursor:pointer; transition:var(--trans);}
.soc-group-card:hover{box-shadow:var(--shadow-md); transform:translateY(-2px);}
.soc-group-cover{height:70px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px;}
.soc-group-cover.lg{height:100px; border-radius:14px; margin-bottom:10px;}
.soc-group-body{padding:12px; display:flex; flex-direction:column; gap:6px;}
.soc-group-body b{font-size:13.5px;}
.soc-group-body span{font-size:12px; color:var(--text-muted);}
.soc-group-meta{font-size:11px; color:var(--text-muted);}
.soc-groups-toolbar{margin-bottom:8px;}

/* ---- Notifications ---- */
.soc-notif-toolbar{display:flex; justify-content:flex-end; margin-bottom:8px;}
.soc-notif-list{display:flex; flex-direction:column; gap:2px;}
.soc-notif-item{display:flex; gap:10px; align-items:flex-start; padding:12px; border-radius:12px; cursor:pointer; position:relative;}
.soc-notif-item:hover{background:rgba(20,120,212,.06);}
.soc-notif-item.unread{background:rgba(20,120,212,.08);}
.soc-notif-item.unread::before{content:''; position:absolute; left:4px; top:50%; transform:translateY(-50%); width:7px; height:7px; border-radius:50%; background:var(--accent);}
.soc-notif-icon{width:26px; height:26px; border-radius:50%; background:var(--n-color); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; margin-top:2px;}
.soc-notif-text{font-size:13px; line-height:1.4;}
.soc-notif-excerpt{color:var(--text-muted); font-style:italic;}
.soc-notif-time{font-size:11px; color:var(--text-muted); margin-top:2px;}

/* ---- Leaderboard / Trending ---- */
.soc-tabs{display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;}
.soc-tab-btn{display:flex; align-items:center; gap:7px; padding:9px 16px; border-radius:12px; background:rgba(20,120,212,.06); color:var(--text-muted); font-weight:700; font-size:13px;}
.soc-tab-btn.active{background:var(--accent); color:#fff;}
.soc-tab-badge{background:var(--danger); color:#fff; border-radius:20px; padding:1px 6px; font-size:10px;}
.soc-leader-row{display:flex; align-items:center; gap:12px; padding:10px; border-radius:12px; cursor:pointer;}
.soc-leader-row:hover{background:rgba(20,120,212,.06);}
.soc-leader-row.top3{background:rgba(251,191,36,.08);}
.soc-leader-rank{width:26px; text-align:center; font-weight:800;}
.soc-leader-info{flex:1;}
.soc-leader-info b{display:block; font-size:13.5px;}
.soc-leader-points{font-weight:800; color:var(--accent); font-size:13px;}
.soc-trending-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px;}
.soc-trending-item{background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:12px; text-align:left; transition:var(--trans);}
.soc-trending-item:hover{box-shadow:var(--shadow-sm); transform:translateY(-2px);}
.soc-trending-hash{display:block; font-weight:800; color:var(--accent); font-size:14px;}
.soc-trending-count{font-size:11px; color:var(--text-muted);}

/* ---- Chat dock ---- */
#socChatDock{position:fixed; bottom:0; right:16px; display:flex; gap:12px; align-items:flex-end; z-index:500;}
.soc-chat-window{width:300px; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:14px 14px 0 0; box-shadow:var(--shadow-lg); display:flex; flex-direction:column; height:400px; transition:height .2s;}
.soc-chat-window.minimized{height:48px; overflow:hidden;}
.soc-chat-head{display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--card-border); cursor:pointer; flex-shrink:0;}
.soc-chat-head b{font-size:12.5px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.soc-chat-typing-indicator{font-size:10px; color:var(--accent); font-style:italic;}
.soc-chat-head-actions{display:flex; gap:4px;}
.soc-chat-body{flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px;}
.soc-chat-msg{display:flex; flex-direction:column; max-width:80%;}
.soc-chat-msg.mine{align-self:flex-end; align-items:flex-end;}
.soc-chat-msg.theirs{align-self:flex-start; align-items:flex-start;}
.soc-chat-msg-bubble{background:rgba(20,120,212,.08); padding:8px 12px; border-radius:14px; font-size:12.5px;}
.soc-chat-msg.mine .soc-chat-msg-bubble{background:var(--accent); color:#fff;}
.soc-chat-msg-img{max-width:160px; border-radius:10px; margin-bottom:2px;}
.soc-chat-msg-time{font-size:9.5px; color:var(--text-muted); margin-top:2px;}
.soc-chat-input-row{display:flex; align-items:center; gap:6px; padding:8px; border-top:1px solid var(--card-border); flex-shrink:0;}
.soc-chat-text-input{flex:1; border:1px solid var(--card-border); border-radius:20px; padding:7px 12px; font-size:12.5px; background:rgba(20,120,212,.04); color:var(--text-main);}
.soc-conv-list{display:flex; flex-direction:column; gap:2px;}
.soc-conv-item{display:flex; align-items:center; gap:12px; padding:12px; border-radius:12px; cursor:pointer;}
.soc-conv-item:hover{background:rgba(20,120,212,.06);}
.soc-conv-info{flex:1; min-width:0;}
.soc-conv-info b{display:block; font-size:13.5px;}
.soc-conv-info span{font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;}
.soc-conv-time{font-size:11px; color:var(--text-muted); flex-shrink:0;}

/* ---- Dropdown menu ---- */
.soc-dropdown-menu{position:fixed; z-index:9998; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:12px; box-shadow:var(--shadow-lg); padding:6px; min-width:200px; animation:socFadeIn .15s ease;}
.soc-dropdown-item{display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 12px; border-radius:8px; font-size:13px; color:var(--text-main);}
.soc-dropdown-item:hover{background:rgba(20,120,212,.08);}
.soc-dropdown-item.danger{color:var(--danger);}
.soc-dropdown-item.danger:hover{background:rgba(239,68,68,.1);}
.soc-dropdown-divider{height:1px; background:var(--card-border); margin:5px 0;}

/* ---- Lightbox ---- */
.soc-lightbox-inner{position:relative; display:flex; align-items:center; justify-content:center;}
.soc-lightbox-inner img{max-width:100%; max-height:76vh; border-radius:10px;}
.soc-lightbox-nav{position:absolute; top:50%; transform:translateY(-50%); width:40px; height:40px; border-radius:50%; background:rgba(0,0,0,.5); color:#fff; display:flex; align-items:center; justify-content:center;}
.soc-lightbox-nav.prev{left:-10px;} .soc-lightbox-nav.next{right:-10px;}

/* ---- Skeleton loading ---- */
.soc-skeleton{overflow:hidden;}
.soc-skel-row{display:flex; gap:10px; align-items:center; margin-bottom:12px;}
.soc-skel-avatar{width:44px; height:44px; border-radius:50%; background:rgba(20,120,212,.12); animation:socShimmer 1.4s infinite;}
.soc-skel-line{height:12px; border-radius:6px; background:rgba(20,120,212,.1); margin-bottom:8px; animation:socShimmer 1.4s infinite;}
.soc-skel-block{height:90px; border-radius:12px; background:rgba(20,120,212,.08); animation:socShimmer 1.4s infinite;}
@keyframes socShimmer{0%{opacity:.5;} 50%{opacity:1;} 100%{opacity:.5;}}
.soc-loading-block{min-height:80px;}

/* ---- Empty state ---- */
.soc-empty{text-align:center; padding:50px 16px; color:var(--text-muted);}
.soc-empty i{font-size:38px; margin-bottom:12px; color:var(--blue-300);}
.soc-empty p{font-weight:700; color:var(--text-main); margin-bottom:4px;}
.soc-empty span{font-size:12.5px;}

/* ---- Subtabs ---- */
.soc-subtabs{display:flex; gap:8px; margin-bottom:14px;}
.soc-subtab{padding:8px 16px; border-radius:20px; background:rgba(20,120,212,.06); font-weight:700; font-size:13px; color:var(--text-muted);}
.soc-subtab.active{background:var(--accent); color:#fff;}

/* ---- Ripple already exists globally; reuse .ripple keyframes if present, else define ---- */
.ripple{position:absolute; border-radius:50%; background:rgba(255,255,255,.5); transform:scale(0); animation:socRipple .6s ease-out;}
@keyframes socRipple{to{transform:scale(2.4); opacity:0;}}

.soc-ai-summary-box{background:rgba(20,120,212,.06); border-radius:12px; padding:14px; font-size:13.5px; line-height:1.6; margin-bottom:10px;}

.soc-online-list, .soc-widget-list{display:flex; flex-direction:column; gap:10px;}
.soc-online-item{display:flex; align-items:center; gap:10px; font-size:12.5px; cursor:pointer;}
.soc-online-item b{font-size:12.5px;}
.soc-online-avatar-wrap{position:relative;}
.soc-online-avatar-wrap .soc-online-dot{position:absolute; bottom:-1px; right:-1px;}

/* ---- Feed sentinel ---- */
.soc-feed-sentinel{text-align:center; padding:20px; color:var(--text-muted);}

/* ============ RESPONSIVE ============ */
@media (max-width: 1180px){
  .soc-layout-3col{grid-template-columns:220px minmax(0,1fr);}
  .soc-right-col{display:none;}
}
@media (max-width: 860px){
  .soc-layout-3col{grid-template-columns:1fr;}
  .soc-left-col{position:static;}
  .soc-left-menu{flex-direction:row; overflow-x:auto; gap:6px; padding-bottom:4px;}
  .soc-left-menu-item{flex-shrink:0; white-space:nowrap;}
  #socChatDock{right:8px; gap:8px;}
  .soc-chat-window{width:88vw; max-width:320px;}
  .soc-composer-toolbar, .soc-emoji-picker, .soc-composer-preview{margin-left:0;}
}
@media (max-width: 520px){
  .soc-modal{padding:18px;}
  .soc-post-actions{flex-wrap:wrap;}
  .soc-action-btn{min-width:70px; font-size:12px;}
}
      `;
      document.head.appendChild(style);
    },

    /* ---- 14.2 DOM: nav item + view section (không đụng tới HTML gốc) ---- */
    injectNav(){
      if(document.querySelector('.nav-item[data-view="social"]')) return;
      const sidebarNav = document.querySelector('.sidebar-nav');
      if(!sidebarNav) return;
      const label = document.createElement('div');
      label.className = 'nav-section-label';
      label.textContent = 'Cộng đồng';
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.view = 'social';
      btn.innerHTML = '<i class="fa-solid fa-comments"></i> Thảo luận <span class="badge" id="socNavBadge" style="display:none;">0</span>';
      sidebarNav.appendChild(label);
      sidebarNav.appendChild(btn);
      btn.addEventListener('click', ()=>{
        if(window.UIManager && typeof window.UIManager.navigate === 'function') window.UIManager.navigate('social');
        else this.show();
      });
    },

    injectView(){
      if(document.getElementById('view-social')) return;
      const content = document.querySelector('main.content');
      if(!content) return;
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-social';
      section.innerHTML = `
        <div class="soc-app-shell">
          <div class="soc-search-bar" style="position:relative;">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="socGlobalSearch" placeholder="Tìm người, bài viết, #hashtag...">
            <button class="soc-icon-btn" id="socNotifBtn" style="position:relative;">
              <i class="fa-solid fa-bell"></i>
              <span id="socNotifBellBadge" class="soc-badge-dot" style="display:none; position:absolute; top:-4px; right:-4px;">0</span>
            </button>
            <div id="socGlobalSearchResults" class="soc-search-results" style="display:none;"></div>
          </div>
          <div class="soc-layout-3col">
            <div class="soc-left-col">
              <div class="soc-card">
                <nav class="soc-left-menu" id="socLeftMenu">
                  <button class="soc-left-menu-item" data-tab="feed"><i class="fa-solid fa-house"></i> Trang chủ</button>
                  <button class="soc-left-menu-item" data-tab="following"><i class="fa-solid fa-user-check"></i> Theo dõi</button>
                  <button class="soc-left-menu-item" data-tab="friends"><i class="fa-solid fa-user-group"></i> Bạn bè</button>
                  <button class="soc-left-menu-item" data-tab="groups"><i class="fa-solid fa-people-group"></i> Nhóm</button>
                  <button class="soc-left-menu-item" data-tab="saved"><i class="fa-solid fa-bookmark"></i> Đã lưu</button>
                  <button class="soc-left-menu-item" data-tab="notifications"><i class="fa-solid fa-bell"></i> Thông báo <span class="soc-badge-dot" id="socMenuNotifBadge">0</span></button>
                  <button class="soc-left-menu-item" data-tab="messages"><i class="fa-solid fa-message"></i> Tin nhắn</button>
                  <button class="soc-left-menu-item" data-tab="leaderboard"><i class="fa-solid fa-ranking-star"></i> Leaderboard Social</button>
                  <button class="soc-left-menu-item" data-tab="trending"><i class="fa-solid fa-hashtag"></i> Xu hướng</button>
                </nav>
              </div>
            </div>
            <div class="soc-center-col">
              <div id="socTabContent"></div>
            </div>
            <div class="soc-right-col">
              <div class="soc-card" id="socWidgetOnline" style="margin-bottom:14px;"></div>
              <div class="soc-card" id="socWidgetTop" style="margin-bottom:14px;"></div>
              <div class="soc-card" id="socWidgetHashtag" style="margin-bottom:14px;"></div>
              <div class="soc-card" id="socWidgetBirthday"></div>
            </div>
          </div>
        </div>
      `;
      content.appendChild(section);
      if(!document.getElementById('socChatDock')){
        const dock = document.createElement('div');
        dock.id = 'socChatDock';
        document.body.appendChild(dock);
      }
      this.wireStaticEvents();
    },

    wireStaticEvents(){
      document.querySelectorAll('#socLeftMenu .soc-left-menu-item').forEach(btn=>{
        btn.addEventListener('click', ()=>this.setActiveTab(btn.dataset.tab));
      });
      const notifBtn = document.getElementById('socNotifBtn');
      if(notifBtn) notifBtn.addEventListener('click', ()=>this.setActiveTab('notifications'));

      const searchInput = document.getElementById('socGlobalSearch');
      const searchResults = document.getElementById('socGlobalSearchResults');
      const runSearch = Utils.debounce(async ()=>{
        const term = searchInput.value.trim();
        if(!term){ searchResults.style.display = 'none'; return; }
        searchResults.innerHTML = `<div style="padding:14px;"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
        searchResults.style.display = 'block';
        const [userResults, hashtagResults] = await Promise.all([
          this.searchUsers(term), this.searchHashtagsPrefix(term.replace('#',''))
        ]);
        let html = '';
        if(userResults.length){
          html += `<div class="soc-search-group-label">Người dùng</div>` + userResults.map(u=>`
            <div class="soc-search-result-item" data-uid="${u.uid||u.id}">${UIComponents.avatarHtml(u.photoURL,u.displayName,32)} <span>${Utils.escapeHtml(u.displayName)}</span></div>`).join('');
        }
        if(hashtagResults.length){
          html += `<div class="soc-search-group-label">Hashtag</div>` + hashtagResults.map(t=>`
            <div class="soc-search-result-item" data-hashtag="${Utils.escapeHtml(t.tag)}"><i class="fa-solid fa-hashtag"></i> <span>${Utils.escapeHtml(t.tag)} (${t.count})</span></div>`).join('');
        }
        html += `<div class="soc-search-result-item" data-postsearch="${Utils.escapeHtml(term)}"><i class="fa-solid fa-magnifying-glass"></i> <span>Tìm bài viết chứa "${Utils.escapeHtml(term)}"</span></div>`;
        searchResults.innerHTML = html || `<div style="padding:14px; color:var(--text-muted); font-size:12.5px;">Không tìm thấy kết quả</div>`;
        searchResults.querySelectorAll('[data-uid]').forEach(el=>el.addEventListener('click', ()=>{ searchResults.style.display='none'; searchInput.value=''; ProfileManager.openProfileModal(el.dataset.uid); }));
        searchResults.querySelectorAll('[data-hashtag]').forEach(el=>el.addEventListener('click', ()=>{ searchResults.style.display='none'; searchInput.value=''; this.setActiveTab('feed'); SocialFeed.searchHashtag(el.dataset.hashtag); }));
        searchResults.querySelectorAll('[data-postsearch]').forEach(el=>el.addEventListener('click', ()=>{
          searchResults.style.display='none';
          SocialFeed._searchTerm = el.dataset.postsearch;
          searchInput.value='';
          this.setActiveTab('feed');
        }));
      }, 320);
      searchInput.addEventListener('input', runSearch);
      document.addEventListener('click', (e)=>{
        if(!e.target.closest('.soc-search-bar')) searchResults.style.display = 'none';
      });
    },

    async searchUsers(term){
      const lower = term.toLowerCase();
      try{
        const snap = await FirebaseService.col(COL.PROFILES)
          .orderBy('displayName_lower')
          .startAt(lower).endAt(lower+'\uf8ff').limit(8).get();
        return snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
      }catch(e){ return []; }
    },

    async searchHashtagsPrefix(term){
      if(!term) return [];
      const lower = term.toLowerCase();
      try{
        const snap = await FirebaseService.col(COL.TAGS).orderBy('tag').startAt(lower).endAt(lower+'\uf8ff').limit(8).get();
        return snap.docs.map(d=>d.data());
      }catch(e){ return []; }
    },

    /* ---- 14.3 Điều hướng tab bên trong Social ---- */
    setActiveTab(tab){
      this.state.activeTab = tab;
      document.querySelectorAll('#socLeftMenu .soc-left-menu-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
      RealtimeManager.detachByPrefix('chat_msg_'); // giữ chat mở, chỉ dọn các listener tab-scope khác nếu cần
      const dispatch = {
        feed: ()=>{
          const content = document.getElementById('socTabContent');
          content.innerHTML = '';
          SocialFeed.renderInto(content, {type:'post'});
        },
        following: ()=>{
          SocialFeed._filter = 'following';
          const content = document.getElementById('socTabContent');
          content.innerHTML = '';
          SocialFeed.renderInto(content, {type:'post'});
        },
        friends: ()=>FriendManager.renderFriendsView(),
        groups: ()=>GroupManager.renderGroupsView(),
        saved: ()=>SocialFeed.renderSavedView(),
        notifications: ()=>{ document.getElementById('socTabContent').innerHTML = UIComponents.skeletonPostHtml(); NotificationManager.renderList([]); },
        messages: ()=>ChatManager.renderMessagesView(),
        leaderboard: ()=>LeaderboardManager.renderLeaderboardView(),
        trending: ()=>SocialFeed.renderTrendingView()
      };
      SocialFeed._filter = tab==='following' ? 'following' : 'newest';
      SocialFeed._searchTerm = SocialFeed._searchTerm || '';
      (dispatch[tab] || dispatch.feed)();
    },

    /* ---- 14.4 Sidebar phải: online users / top contributor / hashtag / birthday ---- */
    async renderRightSidebar(){
      const me = FirebaseService.currentUser();
      // Online users — dựa trên social_presence cập nhật lastActive mỗi 45s
      const onlineWrap = document.getElementById('socWidgetOnline');
      if(onlineWrap){
        try{
          const cutoff = Date.now() - 3*60*1000;
          const snap = await FirebaseService.col(COL.PRESENCE).orderBy('lastActive','desc').limit(10).get();
          const online = snap.docs.map(d=>d.data()).filter(p=>{
            const ms = p.lastActive && p.lastActive.toMillis ? p.lastActive.toMillis() : 0;
            return ms >= cutoff && p.uid !== me.uid;
          });
          onlineWrap.innerHTML = `<h4 class="soc-widget-title"><i class="fa-solid fa-circle" style="color:var(--success);font-size:9px;"></i> Đang trực tuyến</h4>
            <div class="soc-online-list">${online.length ? online.map(p=>`
              <div class="soc-online-item" data-uid="${p.uid}">
                <span class="soc-online-avatar-wrap">${UIComponents.avatarHtml(p.photoURL,p.displayName,32)}${UIComponents.onlineDotHtml(true)}</span>
                <b>${Utils.escapeHtml(p.displayName)}</b>
              </div>`).join('') : '<span class="soc-text-muted">Chưa có ai khác trực tuyến</span>'}</div>`;
          onlineWrap.querySelectorAll('[data-uid]').forEach(el=>el.addEventListener('click', ()=>ProfileManager.openProfileModal(el.dataset.uid)));
        }catch(e){ onlineWrap.innerHTML = ''; }
      }
      // Top contributor
      const topWrap = document.getElementById('socWidgetTop');
      if(topWrap) LeaderboardManager.renderMiniWidget(topWrap);
      // Hashtag trending
      const hashWrap = document.getElementById('socWidgetHashtag');
      if(hashWrap){
        try{
          const snap = await FirebaseService.col(COL.TAGS).orderBy('count','desc').limit(6).get();
          const tags = snap.docs.map(d=>d.data());
          hashWrap.innerHTML = `<h4 class="soc-widget-title"><i class="fa-solid fa-hashtag"></i> Hashtag nổi bật</h4>
            <div class="soc-widget-list">${tags.length ? tags.map(t=>`<button class="soc-chip-btn" data-hashtag="${Utils.escapeHtml(t.tag)}" style="align-self:flex-start;">#${Utils.escapeHtml(t.tag)} · ${t.count}</button>`).join(''):'<span class="soc-text-muted">Chưa có dữ liệu</span>'}</div>`;
          hashWrap.querySelectorAll('[data-hashtag]').forEach(b=>b.addEventListener('click', ()=>{ this.setActiveTab('feed'); SocialFeed.searchHashtag(b.dataset.hashtag); }));
        }catch(e){ hashWrap.innerHTML = ''; }
      }
      // Birthday — chỉ hiển thị nếu hồ sơ có khai báo birthdayMonth/birthdayDay (tính năng mở, chưa có UI nhập liệu)
      const bdWrap = document.getElementById('socWidgetBirthday');
      if(bdWrap){
        bdWrap.innerHTML = `<h4 class="soc-widget-title"><i class="fa-solid fa-cake-candles"></i> Sinh nhật</h4><span class="soc-text-muted" style="font-size:12px;">Chưa có sinh nhật nào trong hôm nay</span>`;
      }
    },

    /* ---- 14.5 Presence: cập nhật "đang trực tuyến" định kỳ ---- */
    startPresence(){
      const me = FirebaseService.currentUser();
      const beat = ()=>{
        FirebaseService.setDoc(COL.PRESENCE, me.uid, {
          uid: me.uid, displayName: me.displayName, photoURL: me.photoURL, lastActive: FirebaseService.serverTs()
        }, true).catch(()=>{});
      };
      beat();
      this.state.presenceTimer = setInterval(beat, 45000);
    },
    stopPresence(){
      if(this.state.presenceTimer) clearInterval(this.state.presenceTimer);
      this.state.presenceTimer = null;
    },

    show(){
      this.injectView();
      const content = document.getElementById('socTabContent');
      if(content && !content.dataset.rendered){
        content.dataset.rendered = '1';
        this.setActiveTab('feed');
        this.renderRightSidebar();
      }
    },

    /* ---- 14.6 Khởi tạo tổng ---- */
    async init(){
      if(this.state.initialized) return;
      this.injectStyles();
      this.injectNav();
      this.injectView();
      const user = FirebaseService.currentUser();
      if(!user) return; // chưa đăng nhập thì chưa tạo hồ sơ / nghe realtime
      await ProfileManager.ensureProfile(user);
      NotificationManager.listen(user.uid);
      this.startPresence();
      this.state.initialized = true;

      // Đồng bộ badge chuông thông báo <-> badge trong menu trái
      const origUpdate = NotificationManager.updateBellBadge.bind(NotificationManager);
      NotificationManager.updateBellBadge = function(){
        origUpdate();
        const menuBadge = document.getElementById('socMenuNotifBadge');
        if(menuBadge){ menuBadge.style.display = this._unreadCount>0?'flex':'none'; menuBadge.textContent = this._unreadCount>99?'99+':this._unreadCount; }
      };
    },

    teardown(){
      RealtimeManager.detachAll();
      this.stopPresence();
      this.state.initialized = false;
      const content = document.getElementById('socTabContent');
      if(content) content.dataset.rendered = '';
    }
  };

  /* ==========================================================================
     15) MÓC VÀO VÒNG ĐỜI CÓ SẴN — chỉ bọc thêm (wrap), không sửa hàm gốc
     ========================================================================== */
  function hookIntoExistingApp(){
    // Thêm tiêu đề cho view "social" vào UIManager.titles nếu UIManager đã tồn tại
    if(window.UIManager){
      if(!window.UIManager.titles) window.UIManager.titles = {};
      if(!window.UIManager.titles.social){
        window.UIManager.titles.social = ['Thảo luận', 'Cộng đồng học tập — chia sẻ, hỏi đáp, kết bạn cùng ôn thi'];
      }
      if(!window.UIManager.__socialNavigateWrapped){
        const origNavigate = window.UIManager.navigate.bind(window.UIManager);
        window.UIManager.navigate = function(view){
          const result = origNavigate(view);
          if(view === 'social') SocialApp.show();
          return result;
        };
        window.UIManager.__socialNavigateWrapped = true;
      }
    }

    // Gắn theo trạng thái đăng nhập Google đã có sẵn (fbAuth), không đụng AuthManager gốc
    if(window.fbAuth && !window.__socialAuthHooked){
      window.__socialAuthHooked = true;
      window.fbAuth.onAuthStateChanged(user=>{
        if(user){
          SocialApp.init();
        }else{
          SocialApp.teardown();
        }
      });
    }
  }

  /* ==========================================================================
     16) ENTRYPOINT — window.initSocial()
     ========================================================================== */
  window.initSocial = function(){
    try{
      SocialApp.injectStyles();
      SocialApp.injectNav();
      SocialApp.injectView();
      hookIntoExistingApp();
      // Nếu người dùng đã đăng nhập từ trước khi initSocial() được gọi
      if(window.fbAuth && window.fbAuth.currentUser){
        SocialApp.init();
      }
      console.log('[Social] Module Cộng đồng đã khởi tạo thành công.');
    }catch(err){
      console.error('[Social] Lỗi khởi tạo module:', err);
    }
  };

  // Expose một vài đối tượng ra global để debug / các module khác (nếu cần) có thể đọc,
  // KHÔNG ghi đè bất kỳ biến global nào đã tồn tại.
  if(!window.SocialApp) window.SocialApp = SocialApp;
  if(!window.SocialFeed) window.SocialFeed = SocialFeed;
  if(!window.PostManager) window.PostManager = PostManager;
  if(!window.CommentManager) window.CommentManager = CommentManager;
  if(!window.FriendManager) window.FriendManager = FriendManager;
  if(!window.ChatManager) window.ChatManager = ChatManager;
  if(!window.NotificationManager) window.NotificationManager = NotificationManager;
  if(!window.GroupManager) window.GroupManager = GroupManager;
  if(!window.ProfileManager) window.ProfileManager = ProfileManager;
  if(!window.LeaderboardManager) window.LeaderboardManager = LeaderboardManager;

  // Tự động khởi tạo nếu index.html đã load xong DOM (an toàn khi script đặt ở cuối body)
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(()=>window.initSocial(), 0);
  }else{
    document.addEventListener('DOMContentLoaded', ()=>window.initSocial());
  }

})();
