/* ============================================================================
   MODULE: KHÓA HỌC (Video Lessons) — js/course.js
   ----------------------------------------------------------------------------
   Module NÀY LÀ BỔ SUNG THÊM, KHÔNG SỬA/GHI ĐÈ bất kỳ logic gốc nào của app.
   Cách hoạt động (giống hệt kỹ thuật đã dùng cho "Đề cộng đồng" trong
   index.html): script này tự chèn thêm nút Sidebar + 1 <section> view mới
   bằng JavaScript (KHÔNG cần sửa HTML), rồi "wrap" (monkey-patch) thêm vào
   UIManager.navigate / App.init / CloudSync.teardown đã có sẵn để tự khởi
   động đúng lúc — không thay thế, không xoá code cũ.

   DỮ LIỆU:
   - Chuyên đề (category) + Bài học (lesson): lưu ở Firestore (nếu app đã có
     `fbDb` — tức đã đăng nhập Firebase) để MỌI người dùng cùng thấy nội dung
     do Admin quản lý (đúng tinh thần CMS). Nếu vì lý do nào đó chưa có
     Firestore, module tự động fallback sang localStorage để vẫn chạy được.
   - Tiến trình xem (progress) của từng người: lưu localStorage (đúng yêu cầu
     gốc), không đẩy lên Firestore để đơn giản & không cần thêm rules cho
     phần này.

   ‼️ CẦN BỔ SUNG FIRESTORE SECURITY RULES (nếu dùng Firestore), ví dụ:

   match /courseCategories/{catId} {
     allow read: if request.auth != null;
     allow write: if request.auth != null &&
       get(/databases/$(database)/documents/allowedUsers/$(request.auth.token.email.lower())).data.role == 'admin';
   }
   match /courseLessons/{lessonId} {
     allow read: if request.auth != null;
     allow write: if request.auth != null &&
       get(/databases/$(database)/documents/allowedUsers/$(request.auth.token.email.lower())).data.role == 'admin';
   }
   ========================================================================== */
(function(){
  'use strict';

  const HAS_FIRESTORE = typeof fbDb !== 'undefined';
  const LS_PREFIX = 'courseModule_';
  const LS_KEYS = {
    CATEGORIES: LS_PREFIX + 'categories',
    LESSONS: LS_PREFIX + 'lessons',
    PROGRESS: LS_PREFIX + 'progress'
  };

  /* ---------------------------------------------------------------------
     Helpers dùng chung (không phụ thuộc app gốc, nhưng tận dụng Utils nếu có)
     --------------------------------------------------------------------- */
  function uid(){
    return (typeof Utils !== 'undefined' && Utils.uid) ? Utils.uid()
      : 'crs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(s){
    return (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml(s)
      : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toast(type, title, msg){
    if(typeof UIManager !== 'undefined' && UIManager.toast) UIManager.toast(type, title, msg);
    else alert(title + (msg ? ('\n' + msg) : ''));
  }
  function confirmDialog(title, msg, onOk){
    if(typeof UIManager !== 'undefined' && UIManager.confirm) UIManager.confirm(title, msg, onOk);
    else if(confirm(title + '\n' + msg)) onOk();
  }
  function isAdmin(){
    return typeof AuthManager !== 'undefined' && typeof AuthManager.isAdmin === 'function' && AuthManager.isAdmin();
  }
  function currentUserTag(){
    if(typeof AuthManager !== 'undefined' && AuthManager.currentUser){
      return { uid: AuthManager.currentUser.uid, email: AuthManager.currentUser.email };
    }
    return { uid: null, email: null };
  }
  function fmtClock(sec){
    if(typeof Utils !== 'undefined' && Utils.formatSecToClock) return Utils.formatSecToClock(sec);
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }
  function fmtHours(totalSec){
    const h = (totalSec || 0) / 3600;
    return h < 1 ? Math.round(h * 60) + ' phút' : h.toFixed(1) + ' giờ';
  }
  function fmtDate(ts){
    if(!ts) return 'Chưa học';
    const d = new Date(ts);
    return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
  }

  /* ---------------------------------------------------------------------
     1) CourseStorage — localStorage cho tiến trình cá nhân + cache dữ liệu
     --------------------------------------------------------------------- */
  const CourseStorage = {
    _get(key, def){
      try{ const raw = localStorage.getItem(key); return raw === null ? def : JSON.parse(raw); }
      catch(e){ return def; }
    },
    _set(key, val){
      try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch(e){ console.error('[Course] Lỗi lưu localStorage', e); return false; }
    },
    getProgressMap(){ return this._get(LS_KEYS.PROGRESS, {}); },
    saveProgressMap(map){ this._set(LS_KEYS.PROGRESS, map); },
    getLocalCategories(){ return this._get(LS_KEYS.CATEGORIES, []); },
    setLocalCategories(v){ this._set(LS_KEYS.CATEGORIES, v); },
    getLocalLessons(){ return this._get(LS_KEYS.LESSONS, []); },
    setLocalLessons(v){ this._set(LS_KEYS.LESSONS, v); }
  };

  /* ---------------------------------------------------------------------
     2) CourseRepository — CRUD chuyên đề & bài học (Firestore ưu tiên,
        fallback localStorage). Mọi thao tác ghi đều kiểm tra quyền ADMIN
        ngay tại đây (không chỉ dựa vào việc ẩn nút trên UI).
     --------------------------------------------------------------------- */
  const CourseRepository = {
    categories: [],
    lessons: [],
    _unsubCats: null,
    _unsubLessons: null,
    _listeners: [],

    onChange(cb){ this._listeners.push(cb); },
    _emit(){ this._listeners.forEach(cb => { try{ cb(); }catch(e){ console.error(e); } }); },

    init(){
      if(HAS_FIRESTORE){
        this._unsubCats = fbDb.collection('courseCategories').orderBy('order','asc')
          .onSnapshot(snap=>{
            this.categories = snap.docs.map(d=>({id:d.id, ...d.data()}));
            CourseStorage.setLocalCategories(this.categories);
            this._emit();
          }, err=>{
            console.error('[Course] Lỗi tải chuyên đề, dùng cache local:', err);
            this.categories = CourseStorage.getLocalCategories();
            this._emit();
          });
        this._unsubLessons = fbDb.collection('courseLessons').orderBy('order','asc')
          .onSnapshot(snap=>{
            this.lessons = snap.docs.map(d=>({id:d.id, ...d.data()}));
            CourseStorage.setLocalLessons(this.lessons);
            this._emit();
          }, err=>{
            console.error('[Course] Lỗi tải bài học, dùng cache local:', err);
            this.lessons = CourseStorage.getLocalLessons();
            this._emit();
          });
      } else {
        this.categories = CourseStorage.getLocalCategories();
        this.lessons = CourseStorage.getLocalLessons();
      }
    },
    teardown(){
      if(this._unsubCats) this._unsubCats();
      if(this._unsubLessons) this._unsubLessons();
      this._unsubCats = null; this._unsubLessons = null;
    },

    getVisibleCategories(){ return this.categories.slice().sort((a,b)=>(a.order||0)-(b.order||0)); },
    getCategoryById(id){ return this.categories.find(c=>c.id===id); },
    getLessonById(id){ return this.lessons.find(l=>l.id===id); },
    getCategoryLessons(categoryId, includeHidden){
      return this.lessons
        .filter(l=> l.categoryId === categoryId && (includeHidden || l.visible !== false))
        .sort((a,b)=>(a.order||0)-(b.order||0));
    },

    async addCategory(name){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được tạo chuyên đề');
      name = (name||'').trim();
      if(!name) throw new Error('Vui lòng nhập tên chuyên đề');
      const order = this.categories.length;
      if(HAS_FIRESTORE){
        await fbDb.collection('courseCategories').add({ name, order, createdAt: Date.now() });
      } else {
        const cat = { id: uid(), name, order, createdAt: Date.now() };
        this.categories.push(cat);
        CourseStorage.setLocalCategories(this.categories);
        this._emit();
      }
    },
    async updateCategory(id, patch){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được sửa chuyên đề');
      if(HAS_FIRESTORE){
        await fbDb.collection('courseCategories').doc(id).update(patch);
      } else {
        const c = this.categories.find(x=>x.id===id);
        if(c) Object.assign(c, patch);
        CourseStorage.setLocalCategories(this.categories);
        this._emit();
      }
    },
    async deleteCategory(id){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được xóa chuyên đề');
      const hasLessons = this.lessons.some(l=>l.categoryId===id);
      if(hasLessons) throw new Error('Chuyên đề đang có bài học, hãy xóa hết bài học trước');
      if(HAS_FIRESTORE){
        await fbDb.collection('courseCategories').doc(id).delete();
      } else {
        this.categories = this.categories.filter(c=>c.id!==id);
        CourseStorage.setLocalCategories(this.categories);
        this._emit();
      }
    },

    async addLesson(data){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được tạo bài học');
      const user = currentUserTag();
      const siblingCount = this.lessons.filter(l=>l.categoryId===data.categoryId).length;
      const payload = {
        categoryId: data.categoryId,
        title: (data.title||'').trim(),
        description: data.description || '',
        thumbnail: data.thumbnail || '',
        type: data.type,
        url: data.url,
        duration: Number(data.duration) || 0,
        order: siblingCount,
        visible: data.visible !== false,
        attachmentUrl: data.attachmentUrl || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: user.email || 'unknown'
      };
      if(!payload.title || !payload.url || !payload.categoryId) throw new Error('Thiếu tên bài học, chuyên đề hoặc link video');
      if(HAS_FIRESTORE){
        await fbDb.collection('courseLessons').add(payload);
      } else {
        payload.id = uid();
        this.lessons.push(payload);
        CourseStorage.setLocalLessons(this.lessons);
        this._emit();
      }
    },
    async updateLesson(id, patch){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được sửa bài học');
      patch.updatedAt = Date.now();
      if(HAS_FIRESTORE){
        await fbDb.collection('courseLessons').doc(id).update(patch);
      } else {
        const l = this.lessons.find(x=>x.id===id);
        if(l) Object.assign(l, patch);
        CourseStorage.setLocalLessons(this.lessons);
        this._emit();
      }
    },
    async deleteLesson(id){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được xóa bài học');
      if(HAS_FIRESTORE){
        await fbDb.collection('courseLessons').doc(id).delete();
      } else {
        this.lessons = this.lessons.filter(l=>l.id!==id);
        CourseStorage.setLocalLessons(this.lessons);
        this._emit();
      }
    },
    async toggleVisible(id){
      const l = this.getLessonById(id);
      if(!l) return;
      await this.updateLesson(id, { visible: l.visible === false });
    },
    async reorder(id, dir){
      if(!isAdmin()) throw new Error('Chỉ Admin mới được đổi thứ tự bài học');
      const l = this.getLessonById(id);
      if(!l) return;
      const siblings = this.getCategoryLessons(l.categoryId, true);
      const idx = siblings.findIndex(x=>x.id===id);
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if(swapIdx < 0 || swapIdx >= siblings.length) return;
      const other = siblings[swapIdx];
      const myOrder = l.order || 0, otherOrder = other.order || 0;
      await this.updateLesson(l.id, { order: otherOrder });
      await this.updateLesson(other.id, { order: myOrder });
    }
  };

  /* ---------------------------------------------------------------------
     3) CourseProgress — tiến trình học của người dùng (localStorage)
     --------------------------------------------------------------------- */
  const CourseProgress = {
    _blank(lessonId){
      return { lessonId, watched:false, currentTime:0, duration:0, percent:0,
        completed:false, viewCount:0, totalWatchTime:0, lastViewed:null };
    },
    get(lessonId){
      const map = CourseStorage.getProgressMap();
      return map[lessonId] || this._blank(lessonId);
    },
    save(lessonId, patch){
      const map = CourseStorage.getProgressMap();
      const cur = map[lessonId] || this._blank(lessonId);
      const merged = Object.assign({}, cur, patch, { lessonId });
      if(merged.duration > 0){
        merged.percent = Math.min(100, Math.round((merged.currentTime / merged.duration) * 100));
      }
      if(merged.percent >= 95) merged.completed = true;
      merged.watched = true;
      map[lessonId] = merged;
      CourseStorage.saveProgressMap(map);
      return merged;
    },
    registerView(lessonId){
      const map = CourseStorage.getProgressMap();
      const cur = map[lessonId] || this._blank(lessonId);
      cur.viewCount = (cur.viewCount || 0) + 1;
      cur.lastViewed = Date.now();
      map[lessonId] = cur;
      CourseStorage.saveProgressMap(map);
      return cur;
    },
    markCompleted(lessonId){ return this.save(lessonId, { completed:true, percent:100 }); },
    resetLesson(lessonId){
      const map = CourseStorage.getProgressMap();
      delete map[lessonId];
      CourseStorage.saveProgressMap(map);
    },
    allProgress(){ return CourseStorage.getProgressMap(); }
  };

  /* ---------------------------------------------------------------------
     4) CourseStatistics — tổng hợp thống kê cá nhân
     --------------------------------------------------------------------- */
  const CourseStatistics = {
    compute(){
      const lessons = CourseRepository.lessons.filter(l=>l.visible !== false);
      const progressMap = CourseProgress.allProgress();
      let completed = 0, totalWatchTime = 0, totalViews = 0, lastViewed = null;
      lessons.forEach(l=>{
        const p = progressMap[l.id];
        if(p){
          if(p.completed) completed++;
          totalWatchTime += p.totalWatchTime || 0;
          totalViews += p.viewCount || 0;
          if(p.lastViewed && (!lastViewed || p.lastViewed > lastViewed)) lastViewed = p.lastViewed;
        }
      });
      const percent = lessons.length ? Math.round((completed / lessons.length) * 100) : 0;
      return { total: lessons.length, completed, totalWatchTime, totalViews, lastViewed, percent };
    }
  };

  /* ---------------------------------------------------------------------
     5) CoursePlayer — nhúng & theo dõi video (YouTube IFrame API / Google Drive)
     --------------------------------------------------------------------- */
  const CoursePlayer = {
    ytPlayer: null,
    autosaveTimer: null,
    currentLessonId: null,
    _driveElapsed: 0,
    _driveDuration: 0,

    detectType(url){
      if(!url) return 'other';
      if(/youtu\.?be/i.test(url)) return 'youtube';
      if(/drive\.google\.com/i.test(url)) return 'drive';
      return 'other';
    },
    parseYoutubeId(url){
      const patterns = [
        /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
        /[?&]v=([a-zA-Z0-9_-]{6,})/,
        /embed\/([a-zA-Z0-9_-]{6,})/,
        /shorts\/([a-zA-Z0-9_-]{6,})/
      ];
      for(const p of patterns){ const m = url.match(p); if(m) return m[1]; }
      return null;
    },
    toDriveEmbed(url){
      let id = null;
      let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if(m) id = m[1];
      if(!id){ m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m) id = m[1]; }
      if(id) return 'https://drive.google.com/file/d/' + id + '/preview';
      return url.replace('/view', '/preview');
    },
    youtubeThumb(url){
      const id = this.parseYoutubeId(url);
      return id ? ('https://img.youtube.com/vi/' + id + '/hqdefault.jpg') : '';
    },

    mount(lesson, containerEl, resumeSeconds){
      this.destroy();
      this.currentLessonId = lesson.id;
      const type = lesson.type || this.detectType(lesson.url);
      if(type === 'youtube') this._mountYoutube(lesson, containerEl, resumeSeconds || 0);
      else if(type === 'drive') this._mountDrive(lesson, containerEl, resumeSeconds || 0);
      else containerEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Không nhận diện được loại video (chỉ hỗ trợ YouTube / Google Drive)</p></div>';
    },
    _ensureYtApi(cb){
      if(window.YT && window.YT.Player){ cb(); return; }
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function(){ if(typeof prevReady === 'function') prevReady(); cb(); };
      if(!window.__ytApiLoading){
        window.__ytApiLoading = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    },
    _mountYoutube(lesson, containerEl, resumeSeconds){
      const vid = this.parseYoutubeId(lesson.url);
      const divId = 'ytPlayer_' + uid();
      containerEl.innerHTML = '<div id="' + divId + '" class="course-video-frame"></div>';
      if(!vid){ containerEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Link YouTube không hợp lệ</p></div>'; return; }
      this._ensureYtApi(()=>{
        if(!document.getElementById(divId)) return; // user đã điều hướng đi chỗ khác
        this.ytPlayer = new YT.Player(divId, {
          videoId: vid,
          playerVars: { rel: 0, modestbranding: 1, start: Math.floor(resumeSeconds || 0) },
          events: {
            onReady: () => { CourseProgress.registerView(lesson.id); CourseUI.refreshMiniStats(); },
            onStateChange: (e) => {
              if(e.data === YT.PlayerState.PLAYING) this._startAutosave(lesson, false);
              else this._stopAutosave();
              if(e.data === YT.PlayerState.ENDED){
                const dur = this.ytPlayer.getDuration() || lesson.duration || 0;
                CourseProgress.save(lesson.id, { currentTime: dur, duration: dur });
                CourseUI.updateProgressUIFor(lesson.id);
              }
            }
          }
        });
      });
    },
    _mountDrive(lesson, containerEl, resumeSeconds){
      const embedUrl = this.toDriveEmbed(lesson.url);
      containerEl.innerHTML = '<iframe class="course-video-frame" src="' + embedUrl + '" allow="autoplay" allowfullscreen></iframe>' +
        '<p class="course-drive-note"><i class="fa-solid fa-circle-info"></i> Video Google Drive không hỗ trợ đo thời gian chính xác từ trình phát — hệ thống ước lượng tiến trình dựa trên thời lượng bạn đã mở video.</p>';
      CourseProgress.registerView(lesson.id);
      this._driveElapsed = resumeSeconds || 0;
      this._driveDuration = lesson.duration || 0;
      this._startAutosave(lesson, true);
    },
    _startAutosave(lesson, isDriveEstimate){
      this._stopAutosave();
      let lastTick = Date.now();
      this.autosaveTimer = setInterval(() => {
        const now = Date.now();
        const deltaSec = (now - lastTick) / 1000;
        lastTick = now;
        let current, duration;
        if(isDriveEstimate){
          this._driveElapsed += deltaSec;
          current = this._driveElapsed;
          duration = this._driveDuration;
        } else if(this.ytPlayer && this.ytPlayer.getCurrentTime){
          current = this.ytPlayer.getCurrentTime();
          duration = this.ytPlayer.getDuration();
        } else return;
        const prev = CourseProgress.get(lesson.id);
        CourseProgress.save(lesson.id, {
          currentTime: current,
          duration: duration || prev.duration,
          totalWatchTime: (prev.totalWatchTime || 0) + deltaSec
        });
        CourseUI.updateProgressUIFor(lesson.id);
      }, 5000);
    },
    _stopAutosave(){
      if(this.autosaveTimer){ clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
    },
    destroy(){
      this._stopAutosave();
      if(this.ytPlayer && this.ytPlayer.destroy){ try{ this.ytPlayer.destroy(); }catch(e){} }
      this.ytPlayer = null;
      this.currentLessonId = null;
    }
  };

  /* ---------------------------------------------------------------------
     6) CourseAdmin — form thêm/sửa, mọi hành động đều re-check quyền
     --------------------------------------------------------------------- */
  const CourseAdmin = {
    _modalRoot: null,
    _closeModal(){
      if(this._modalRoot){ this._modalRoot.remove(); this._modalRoot = null; }
    },
    _openModal(innerHtml){
      this._closeModal();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay course-form-modal show';
      overlay.innerHTML = '<div class="modal-box">' + innerHtml + '</div>';
      overlay.addEventListener('click', (e)=>{ if(e.target === overlay) this._closeModal(); });
      document.body.appendChild(overlay);
      this._modalRoot = overlay;
      return overlay;
    },

    openCategoryForm(categoryId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được quản lý chuyên đề'); return; }
      const cat = categoryId ? CourseRepository.getCategoryById(categoryId) : null;
      this._openModal(
        '<h3><i class="fa-solid fa-layer-group"></i> ' + (cat ? 'Sửa chuyên đề' : 'Thêm chuyên đề') + '</h3>' +
        '<div style="text-align:left; margin:16px 0;">' +
          '<label style="font-size:12.5px; font-weight:700; color:var(--text-muted);">Tên chuyên đề</label>' +
          '<input type="text" class="text-input" id="courseCatNameInput" style="margin-top:6px;" value="' + escapeHtml(cat ? cat.name : '') + '" placeholder="VD: Toán cao cấp">' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-outline" onclick="CourseAdmin._closeModal()">Hủy</button>' +
          '<button class="btn btn-primary" onclick="CourseAdmin.submitCategoryForm(' + (cat ? "'"+cat.id+"'" : 'null') + ')"><i class="fa-solid fa-check"></i> Lưu</button>' +
        '</div>'
      );
    },
    async submitCategoryForm(categoryId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được quản lý chuyên đề'); return; }
      const name = document.getElementById('courseCatNameInput').value.trim();
      if(!name){ toast('warn','Thiếu thông tin','Vui lòng nhập tên chuyên đề'); return; }
      try{
        if(categoryId) await CourseRepository.updateCategory(categoryId, { name });
        else await CourseRepository.addCategory(name);
        this._closeModal();
        toast('success','Đã lưu', 'Cập nhật chuyên đề thành công');
        CourseUI.render();
      }catch(e){ toast('error','Lỗi', e.message); }
    },
    confirmDeleteCategory(categoryId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được xóa chuyên đề'); return; }
      confirmDialog('Xóa chuyên đề?', 'Chỉ xóa được khi chuyên đề không còn bài học nào.', async ()=>{
        try{ await CourseRepository.deleteCategory(categoryId); toast('success','Đã xóa','Đã xóa chuyên đề'); CourseUI.render(); }
        catch(e){ toast('error','Lỗi', e.message); }
      });
    },

    openLessonForm(lessonId, defaultCategoryId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được quản lý bài học'); return; }
      const lesson = lessonId ? CourseRepository.getLessonById(lessonId) : null;
      const cats = CourseRepository.getVisibleCategories();
      const catOptions = cats.map(c=>
        '<option value="' + c.id + '"' + ((lesson ? lesson.categoryId : defaultCategoryId) === c.id ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>'
      ).join('');
      const type = lesson ? lesson.type : 'youtube';
      this._openModal(
        '<h3><i class="fa-solid fa-clapperboard"></i> ' + (lesson ? 'Sửa bài học' : 'Thêm bài học') + '</h3>' +
        '<div style="text-align:left; margin:14px 0; display:flex; flex-direction:column; gap:12px; max-height:60vh; overflow-y:auto; padding-right:4px;">' +
          '<div><label class="cf-label">Chuyên đề</label><select class="select-box" id="courseLessonCatSelect" style="width:100%;">' + catOptions + '</select></div>' +
          '<div><label class="cf-label">Tên bài học</label><input type="text" class="text-input" id="courseLessonTitleInput" value="' + escapeHtml(lesson ? lesson.title : '') + '" placeholder="VD: Bài 1 - Giới hạn hàm số"></div>' +
          '<div><label class="cf-label">Mô tả</label><textarea class="text-input" id="courseLessonDescInput" rows="3" placeholder="Mô tả ngắn về bài học">' + escapeHtml(lesson ? lesson.description : '') + '</textarea></div>' +
          '<div><label class="cf-label">Loại video</label>' +
            '<div style="display:flex; gap:16px; margin-top:6px;">' +
              '<label><input type="radio" name="courseLessonType" value="youtube" ' + (type==='youtube'?'checked':'') + '> YouTube</label>' +
              '<label><input type="radio" name="courseLessonType" value="drive" ' + (type==='drive'?'checked':'') + '> Google Drive</label>' +
            '</div></div>' +
          '<div><label class="cf-label">Link video</label><input type="text" class="text-input" id="courseLessonUrlInput" value="' + escapeHtml(lesson ? lesson.url : '') + '" placeholder="https://youtube.com/... hoặc https://drive.google.com/..."></div>' +
          '<div><label class="cf-label">Thumbnail (để trống sẽ tự lấy ảnh YouTube nếu có)</label><input type="text" class="text-input" id="courseLessonThumbInput" value="' + escapeHtml(lesson ? lesson.thumbnail : '') + '" placeholder="https://..."></div>' +
          '<div><label class="cf-label">Tài liệu đính kèm (link, không bắt buộc)</label><input type="text" class="text-input" id="courseLessonAttachInput" value="' + escapeHtml(lesson ? lesson.attachmentUrl : '') + '" placeholder="https://..."></div>' +
          '<div><label class="cf-label">Thời lượng (phút)</label><input type="number" min="0" step="0.5" class="text-input" id="courseLessonDurationInput" value="' + (lesson ? Math.round((lesson.duration||0)/60*10)/10 : '') + '" placeholder="VD: 12"></div>' +
          '<div><label><input type="checkbox" id="courseLessonVisibleInput" ' + (lesson ? (lesson.visible !== false ? 'checked' : '') : 'checked') + '> Hiển thị cho học viên</label></div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-outline" onclick="CourseAdmin._closeModal()">Hủy</button>' +
          '<button class="btn btn-primary" onclick="CourseAdmin.submitLessonForm(' + (lesson ? "'"+lesson.id+"'" : 'null') + ')"><i class="fa-solid fa-check"></i> Lưu</button>' +
        '</div>'
      );
    },
    async submitLessonForm(lessonId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được quản lý bài học'); return; }
      const categoryId = document.getElementById('courseLessonCatSelect').value;
      const title = document.getElementById('courseLessonTitleInput').value.trim();
      const description = document.getElementById('courseLessonDescInput').value.trim();
      const type = document.querySelector('input[name="courseLessonType"]:checked').value;
      const url = document.getElementById('courseLessonUrlInput').value.trim();
      let thumbnail = document.getElementById('courseLessonThumbInput').value.trim();
      const attachmentUrl = document.getElementById('courseLessonAttachInput').value.trim();
      const durationMin = parseFloat(document.getElementById('courseLessonDurationInput').value) || 0;
      const visible = document.getElementById('courseLessonVisibleInput').checked;

      if(!categoryId){ toast('warn','Thiếu thông tin','Vui lòng tạo chuyên đề trước'); return; }
      if(!title || !url){ toast('warn','Thiếu thông tin','Vui lòng nhập tên bài học và link video'); return; }
      if(!thumbnail && type === 'youtube') thumbnail = CoursePlayer.youtubeThumb(url);

      const payload = { categoryId, title, description, type, url, thumbnail, attachmentUrl, duration: Math.round(durationMin*60), visible };
      try{
        if(lessonId) await CourseRepository.updateLesson(lessonId, payload);
        else await CourseRepository.addLesson(payload);
        this._closeModal();
        toast('success','Đã lưu','Cập nhật bài học thành công');
        CourseUI.render();
      }catch(e){ toast('error','Lỗi', e.message); }
    },
    confirmDeleteLesson(lessonId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được xóa bài học'); return; }
      confirmDialog('Xóa bài học?', 'Bài học sẽ bị xóa vĩnh viễn khỏi hệ thống.', async ()=>{
        try{ await CourseRepository.deleteLesson(lessonId); toast('success','Đã xóa','Đã xóa bài học'); CourseUI.render(); }
        catch(e){ toast('error','Lỗi', e.message); }
      });
    },
    async toggleVisible(lessonId){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được ẩn/hiện bài học'); return; }
      try{ await CourseRepository.toggleVisible(lessonId); CourseUI.render(); }
      catch(e){ toast('error','Lỗi', e.message); }
    },
    async reorder(lessonId, dir){
      if(!isAdmin()){ toast('error','Không có quyền','Chỉ Admin mới được đổi thứ tự'); return; }
      try{ await CourseRepository.reorder(lessonId, dir); CourseUI.render(); }
      catch(e){ toast('error','Lỗi', e.message); }
    }
  };

  /* ---------------------------------------------------------------------
     7) CourseUI — render toàn bộ giao diện tab "Khóa học"
     --------------------------------------------------------------------- */
  let viewCategoryId = null;
  let viewLessonId = null;
  let pendingResume = null; // {resume:true/false} chờ người dùng chọn khi có tiến trình cũ

  const CourseUI = {
    _inited: false,

    init(){
      if(this._inited) return;
      CourseRepository.onChange(()=>{
        const activeSection = document.getElementById('view-course');
        if(activeSection && activeSection.classList.contains('active')) this.render();
      });
      CourseRepository.init();
      this._inited = true;
    },

    render(){
      if(!this._inited) this.init();
      const root = document.getElementById('courseRoot');
      if(!root) return;
      CoursePlayer.destroy();
      if(viewLessonId) this.renderPlayerView(root, viewLessonId);
      else if(viewCategoryId) this.renderLessonsView(root, viewCategoryId);
      else this.renderCategoriesView(root);
    },

    renderCategoriesView(root){
      const admin = isAdmin();
      const stats = CourseStatistics.compute();
      const cats = CourseRepository.getVisibleCategories();

      let statsHtml =
        '<div class="stat-grid" style="margin-bottom:22px;">' +
          this._statCard('fa-book-open','#1478d4','Tổng bài học', stats.total) +
          this._statCard('fa-circle-check','#16c784','Đã hoàn thành', stats.completed) +
          this._statCard('fa-clock','#f59e0b','Tổng giờ học', fmtHours(stats.totalWatchTime)) +
          this._statCard('fa-eye','#06b6d4','Tổng lượt xem', stats.totalViews) +
        '</div>' +
        '<div class="card" style="padding:16px 20px; margin-bottom:22px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">' +
          '<div><b>Tiến trình tổng thể: ' + stats.percent + '%</b><div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Lần học gần nhất: ' + fmtDate(stats.lastViewed) + '</div></div>' +
          '<div class="course-progress-bar-outer" style="width:220px;"><div class="course-progress-bar-inner" style="width:' + stats.percent + '%;"></div></div>' +
        '</div>';

      let catsHtml = '';
      if(!cats.length){
        catsHtml = '<div class="empty-state"><i class="fa-solid fa-book"></i><p>' + (admin ? 'Chưa có chuyên đề nào, bấm "Thêm chuyên đề" để bắt đầu.' : 'Chưa có nội dung khóa học nào.') + '</p></div>';
      } else {
        catsHtml = '<div class="parts-grid">' + cats.map(c=>{
          const lessons = CourseRepository.getCategoryLessons(c.id, admin);
          const visibleCount = CourseRepository.getCategoryLessons(c.id, false).length;
          const progressMap = CourseProgress.allProgress();
          const completedCount = lessons.filter(l=> progressMap[l.id] && progressMap[l.id].completed).length;
          return (
            '<div class="card" style="padding:18px; display:flex; flex-direction:column; gap:10px;">' +
              '<div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="CourseUI.openCategory(\'' + c.id + '\')">' +
                '<div class="stat-icon" style="background:linear-gradient(135deg,var(--blue-500),var(--cyan-500));"><i class="fa-solid fa-layer-group"></i></div>' +
                '<div><b style="font-size:15px;">' + escapeHtml(c.name) + '</b><div style="font-size:12px; color:var(--text-muted);">' + visibleCount + ' bài học · Hoàn thành ' + completedCount + '/' + lessons.length + '</div></div>' +
              '</div>' +
              (admin ? (
                '<div style="display:flex; gap:8px; border-top:1px solid var(--card-border); padding-top:10px;">' +
                  '<button class="btn btn-outline btn-sm" onclick="CourseAdmin.openCategoryForm(\'' + c.id + '\')"><i class="fa-solid fa-pen"></i> Sửa</button>' +
                  '<button class="btn btn-ghost btn-sm" onclick="CourseAdmin.confirmDeleteCategory(\'' + c.id + '\')"><i class="fa-solid fa-trash"></i> Xóa</button>' +
                '</div>'
              ) : '') +
            '</div>'
          );
        }).join('') + '</div>';
      }

      root.innerHTML =
        '<div class="section-head">' +
          '<div><h2><i class="fa-solid fa-graduation-cap"></i> Khóa học</h2><p>Xem video bài giảng theo chuyên đề trước khi luyện đề trắc nghiệm.</p></div>' +
          (admin ? '<button class="btn btn-primary btn-sm" onclick="CourseAdmin.openCategoryForm()"><i class="fa-solid fa-plus"></i> Thêm chuyên đề</button>' : '') +
        '</div>' +
        statsHtml + catsHtml;
    },

    renderLessonsView(root, categoryId){
      const admin = isAdmin();
      const cat = CourseRepository.getCategoryById(categoryId);
      if(!cat){ viewCategoryId = null; this.render(); return; }
      const lessons = CourseRepository.getCategoryLessons(categoryId, admin);
      const progressMap = CourseProgress.allProgress();

      let lessonsHtml = '';
      if(!lessons.length){
        lessonsHtml = '<div class="empty-state"><i class="fa-solid fa-clapperboard"></i><p>' + (admin ? 'Chưa có bài học nào trong chuyên đề này.' : 'Chuyên đề này chưa có bài học.') + '</p></div>';
      } else {
        lessonsHtml = '<div class="parts-grid">' + lessons.map((l, idx)=>{
          const p = progressMap[l.id];
          const percent = p ? p.percent : 0;
          const completed = p && p.completed;
          const thumb = l.thumbnail || (l.type==='youtube' ? CoursePlayer.youtubeThumb(l.url) : '');
          return (
            '<div class="card" style="overflow:hidden; display:flex; flex-direction:column;">' +
              '<div style="position:relative; cursor:pointer; height:140px; background:#0b1f33 center/cover no-repeat url(\'' + escapeHtml(thumb) + '\');" onclick="CourseUI.openLesson(\'' + l.id + '\')">' +
                (l.visible === false ? '<span style="position:absolute; top:8px; left:8px; background:var(--danger); color:#fff; font-size:10.5px; padding:3px 8px; border-radius:6px; font-weight:700;">ẨN</span>' : '') +
                (completed ? '<span style="position:absolute; top:8px; right:8px; background:var(--success); color:#fff; font-size:14px; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-check"></i></span>' : '') +
                '<span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,.65); color:#fff; font-size:11px; padding:2px 7px; border-radius:5px;">' + fmtClock(l.duration) + '</span>' +
              '</div>' +
              '<div style="padding:14px; display:flex; flex-direction:column; gap:8px; flex:1;">' +
                '<b style="font-size:14px; cursor:pointer;" onclick="CourseUI.openLesson(\'' + l.id + '\')">' + escapeHtml(l.title) + '</b>' +
                '<div class="course-progress-bar-outer"><div class="course-progress-bar-inner" style="width:' + percent + '%;"></div></div>' +
                '<div style="font-size:11.5px; color:var(--text-muted);">' + percent + '% · ' + (p ? (p.viewCount||0) : 0) + ' lượt xem</div>' +
                (admin ? (
                  '<div style="display:flex; gap:6px; flex-wrap:wrap; border-top:1px solid var(--card-border); padding-top:8px; margin-top:2px;">' +
                    '<button class="btn btn-outline btn-sm" onclick="CourseAdmin.openLessonForm(\'' + l.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="btn btn-ghost btn-sm" onclick="CourseAdmin.confirmDeleteLesson(\'' + l.id + '\')"><i class="fa-solid fa-trash"></i></button>' +
                    '<button class="btn btn-outline btn-sm" onclick="CourseAdmin.toggleVisible(\'' + l.id + '\')"><i class="fa-solid fa-eye' + (l.visible===false?'':'-slash') + '"></i></button>' +
                    '<button class="btn btn-outline btn-sm" ' + (idx===0?'disabled':'') + ' onclick="CourseAdmin.reorder(\'' + l.id + '\',\'up\')"><i class="fa-solid fa-arrow-up"></i></button>' +
                    '<button class="btn btn-outline btn-sm" ' + (idx===lessons.length-1?'disabled':'') + ' onclick="CourseAdmin.reorder(\'' + l.id + '\',\'down\')"><i class="fa-solid fa-arrow-down"></i></button>' +
                  '</div>'
                ) : '') +
              '</div>' +
            '</div>'
          );
        }).join('') + '</div>';
      }

      root.innerHTML =
        '<div class="section-head">' +
          '<div>' +
            '<button class="btn btn-outline btn-sm" style="margin-bottom:8px;" onclick="CourseUI.backToCategories()"><i class="fa-solid fa-arrow-left"></i> Quay lại chuyên đề</button>' +
            '<h2>' + escapeHtml(cat.name) + '</h2>' +
          '</div>' +
          (admin ? '<button class="btn btn-primary btn-sm" onclick="CourseAdmin.openLessonForm(null,\'' + categoryId + '\')"><i class="fa-solid fa-plus"></i> Thêm bài học</button>' : '') +
        '</div>' + lessonsHtml;
    },

    renderPlayerView(root, lessonId){
      const admin = isAdmin();
      const lesson = CourseRepository.getLessonById(lessonId);
      if(!lesson){ viewLessonId = null; this.render(); return; }
      const progress = CourseProgress.get(lessonId);
      const showContinuePrompt = pendingResume === null && progress.currentTime > 5 && !progress.completed;

      root.innerHTML =
        '<div class="section-head">' +
          '<div>' +
            '<button class="btn btn-outline btn-sm" style="margin-bottom:8px;" onclick="CourseUI.backToLessons()"><i class="fa-solid fa-arrow-left"></i> Danh sách bài học</button>' +
            '<h2>' + escapeHtml(lesson.title) + '</h2>' +
            (lesson.description ? '<p>' + escapeHtml(lesson.description) + '</p>' : '') +
          '</div>' +
          (admin ? (
            '<div style="display:flex; gap:8px;">' +
              '<button class="btn btn-outline btn-sm" onclick="CourseAdmin.openLessonForm(\'' + lesson.id + '\')"><i class="fa-solid fa-pen"></i> Sửa</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="CourseAdmin.confirmDeleteLesson(\'' + lesson.id + '\')"><i class="fa-solid fa-trash"></i> Xóa</button>' +
            '</div>'
          ) : '') +
        '</div>' +
        (showContinuePrompt ?
          '<div class="card" id="courseContinueBanner" style="padding:16px 20px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">' +
            '<div><i class="fa-solid fa-circle-play" style="color:var(--accent);"></i> Bạn đã xem đến <b>' + fmtClock(progress.currentTime) + '</b>. Tiếp tục học?</div>' +
            '<div style="display:flex; gap:8px;">' +
              '<button class="btn btn-primary btn-sm" onclick="CourseUI._resumeChoice(true)">Tiếp tục</button>' +
              '<button class="btn btn-outline btn-sm" onclick="CourseUI._resumeChoice(false)">Xem lại từ đầu</button>' +
            '</div>' +
          '</div>'
        : '<div id="coursePlayerMount" class="card" style="padding:0; overflow:hidden;"></div>') +
        (lesson.attachmentUrl ? '<a class="btn btn-outline btn-sm" style="margin-top:14px;" href="' + escapeHtml(lesson.attachmentUrl) + '" target="_blank" rel="noopener"><i class="fa-solid fa-paperclip"></i> Tài liệu đính kèm</a>' : '') +
        '<div class="card" style="padding:16px 20px; margin-top:16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">' +
          '<div id="courseLessonProgressLabel" style="font-size:13px; color:var(--text-muted);">' + this._progressLabel(progress) + '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="CourseUI.markCompleted(\'' + lesson.id + '\')"><i class="fa-solid fa-circle-check"></i> Đánh dấu hoàn thành</button>' +
        '</div>';

      if(!showContinuePrompt){
        const mount = document.getElementById('coursePlayerMount');
        const resumeSeconds = pendingResume === true ? progress.currentTime : 0;
        pendingResume = null;
        if(mount) CoursePlayer.mount(lesson, mount, resumeSeconds);
      }
    },

    _progressLabel(p){
      return 'Đã xem ' + p.percent + '% · ' + (p.viewCount||0) + ' lượt xem · Tổng thời gian: ' + fmtHours(p.totalWatchTime) + ' · Lần cuối: ' + fmtDate(p.lastViewed);
    },
    _resumeChoice(resume){
      pendingResume = resume;
      this.render();
    },
    updateProgressUIFor(lessonId){
      const label = document.getElementById('courseLessonProgressLabel');
      if(label && viewLessonId === lessonId){
        label.textContent = this._progressLabel(CourseProgress.get(lessonId));
      }
    },
    refreshMiniStats(){ /* hook mở rộng sau này nếu cần cập nhật badge realtime */ },
    markCompleted(lessonId){
      CourseProgress.markCompleted(lessonId);
      toast('success','Tuyệt vời!','Đã đánh dấu hoàn thành bài học');
      this.updateProgressUIFor(lessonId);
    },

    _statCard(icon, color, label, val){
      return '<div class="card stat-card"><div class="stat-top"><div class="stat-icon" style="background:' + color + ';"><i class="fa-solid ' + icon + '"></i></div></div><div class="stat-val">' + val + '</div><div class="stat-label">' + label + '</div></div>';
    },

    openCategory(id){ viewCategoryId = id; viewLessonId = null; this.render(); },
    openLesson(id){ viewLessonId = id; pendingResume = null; this.render(); },
    backToLessons(){ viewLessonId = null; pendingResume = null; this.render(); },
    backToCategories(){ viewCategoryId = null; viewLessonId = null; pendingResume = null; this.render(); }
  };

  /* ---------------------------------------------------------------------
     8) Chèn CSS + DOM (Sidebar + view) — không sửa HTML gốc
     --------------------------------------------------------------------- */
  function injectStyles(){
    if(document.getElementById('courseModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'courseModuleStyles';
    style.textContent =
      '.course-video-frame{width:100%; aspect-ratio:16/9; border:0; display:block; background:#000;}' +
      'iframe.course-video-frame{width:100%;}' +
      '.course-drive-note{padding:10px 14px; font-size:11.5px; color:var(--text-muted); background:rgba(20,120,212,.06);}' +
      '.course-progress-bar-outer{width:100%; height:7px; border-radius:6px; background:rgba(20,120,212,.12); overflow:hidden;}' +
      '.course-progress-bar-inner{height:100%; background:linear-gradient(90deg,var(--blue-500),var(--cyan-500)); border-radius:6px; transition:width .3s ease;}' +
      '.course-form-modal .modal-box{max-width:560px; width:92vw; text-align:center;}' +
      '.course-form-modal .cf-label{font-size:12.5px; font-weight:700; color:var(--text-muted); display:block; margin-bottom:4px;}' +
      '.course-form-modal textarea.text-input{resize:vertical;}';
    document.head.appendChild(style);
  }

  function injectDom(){
    injectStyles();
    const anchorNav = document.querySelector('.nav-item[data-view="parts"]');
    if(anchorNav && !document.querySelector('.nav-item[data-view="course"]')){
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.view = 'course';
      btn.innerHTML = '<i class="fa-solid fa-graduation-cap"></i> Khóa học';
      anchorNav.insertAdjacentElement('afterend', btn);
    }
    const anchorView = document.getElementById('view-parts');
    if(anchorView && !document.getElementById('view-course')){
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-course';
      section.innerHTML = '<div id="courseRoot"></div>';
      anchorView.insertAdjacentElement('afterend', section);
    }
  }

  /* ---------------------------------------------------------------------
     9) Wire vào app gốc bằng "wrap" (monkey-patch) — không sửa code gốc
     --------------------------------------------------------------------- */
  if(typeof UIManager !== 'undefined'){
    UIManager.titles.course = ['Khóa học', 'Học video bài giảng trước khi luyện đề'];
    const _origNavigate = UIManager.navigate.bind(UIManager);
    UIManager.navigate = function(view){
      const result = _origNavigate(view);
      if(view === 'course') CourseUI.render();
      return result;
    };
  }
  if(typeof App !== 'undefined'){
    const _origAppInit = App.init.bind(App);
    App.init = function(){
      const result = _origAppInit();
      CourseUI.init();
      return result;
    };
  }
  if(typeof CloudSync !== 'undefined'){
    const _origTeardown = CloudSync.teardown.bind(CloudSync);
    CloudSync.teardown = function(){
      CoursePlayer.destroy();
      CourseRepository.teardown();
      return _origTeardown();
    };
  }

  injectDom();

  // Expose ra global để dùng trong thuộc tính onclick="" của HTML sinh động
  // (đây là 2 global DUY NHẤT của module, giống cách AdminExamPanel/CommunityExamUI
  // đã làm ở phần code gốc — không tạo thêm biến global nào khác).
  window.CourseUI = CourseUI;
  window.CourseAdmin = CourseAdmin;

})();
