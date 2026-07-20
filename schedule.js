/* ============================================================================
   SCHEDULE.JS — "📅 Kế hoạch học"
   ----------------------------------------------------------------------------
   Module độc lập, TỰ INJECT toàn bộ HTML/CSS/Event vào hệ thống ôn thi hiện có.
   KHÔNG sửa index.html, KHÔNG sửa CSS gốc, KHÔNG sửa logic quiz/dashboard/
   Firebase/localStorage hiện tại — chỉ đọc (read-only) các API công khai đã
   có sẵn (UIManager, QuizManager, ReviewUI, QuestionManager, StorageManager,
   Utils, DashboardUI...) để tích hợp, và ghi dữ liệu riêng vào 1 localStorage
   key hoàn toàn mới: "learningSchedule".

   Sau khi phân tích index.html, các quy ước sau được tuân thủ nghiêm ngặt:
   - Theme dùng biến CSS :root / [data-theme="dark"] (--blue-*, --cyan-*,
     --accent, --accent-2, --success, --danger, --warning, --star, --card-bg,
     --card-border, --text-main, --text-muted, --shadow-*, --radius-*, --trans)
     → module này CHỈ dùng các biến đó, không tự bịa màu mới kiểu Google.
   - Chuyển View bằng cách toggle class "active" trên .view / .nav-item, do
     UIManager.navigate(view) đảm nhiệm → module "wrap" thêm (giống kỹ thuật
     AdminExamPanel / CommunityExamUI đã có trong index.html) chứ không sửa
     hàm gốc.
   - Nav-item + view section mới được chèn bằng insertAdjacentElement /
     appendChild giống hệt kỹ thuật injectDom() của khối "Đề cộng đồng".
   - Class .btn/.card/.select-box/.filter-chip/.badge/.empty-state/
     .heatmap-wrap/.heatmap-cell/.switch/.slider-toggle/[data-tip] được TÁI
     SỬ DỤNG nguyên bản để đồng bộ 100% giao diện (kể cả hiệu ứng ripple vì
     UIManager đã gắn ripple listener toàn cục cho mọi `.btn`).
   - localStorage: chỉ 1 key mới "learningSchedule" — không đụng tới các key
     StorageManager.KEYS.* hiện có.
   - Chỉ tạo duy nhất window.Schedule (module pattern, không rò rỉ global).
   ========================================================================== */
(function () {
  'use strict';
  if (window.Schedule) return; // tránh nạp trùng nếu script bị include 2 lần

  /* ============================================================================
     0. TIỆN ÍCH DÙNG CHUNG (tái sử dụng Utils gốc nếu có, fallback nếu chưa nạp)
     ========================================================================== */
  const hasUtils = typeof window.Utils === 'object' && window.Utils;
  const esc = hasUtils && Utils.escapeHtml ? Utils.escapeHtml.bind(Utils) : function (str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  };
  const genId = hasUtils && Utils.uid ? Utils.uid.bind(Utils) : function () {
    return 'sch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  };

  /* ---------- Date helpers ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  const D = {
    todayKey() { return D.toKey(new Date()); },
    toKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; },
    fromKey(key) {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    },
    addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; },
    addMonths(date, n) { const d = new Date(date); d.setMonth(d.getMonth() + n); return d; },
    addYears(date, n) { const d = new Date(date); d.setFullYear(d.getFullYear() + n); return d; },
    startOfWeekSun(date) { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; },
    startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); },
    endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); },
    sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); },
    isToday(d) { return D.sameDay(d, new Date()); },
    weekdayShort: ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'],
    weekdayMini: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
    monthNames: ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'],
    fmtDateVN(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; },
    timeToMin(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); },
    minToTime(min) { min = ((min % 1440) + 1440) % 1440; return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; },
    keyCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  };

  function downloadFile(filename, content, mime) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ============================================================================
     1. STORE — quản lý localStorage riêng "learningSchedule"
     ========================================================================== */
  const STORAGE_KEY = 'learningSchedule';
  const Store = {
    data: { events: [], notified: [], settings: { defaultReminder: 10 } },
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.data = Object.assign({ events: [], notified: [], settings: { defaultReminder: 10 } }, parsed);
        }
      } catch (e) { console.error('[Schedule] Lỗi đọc localStorage:', e); }
      return this.data;
    },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
      catch (e) { console.error('[Schedule] Lỗi ghi localStorage:', e); }
    },
    all() { return this.data.events; },
    getById(id) { return this.data.events.find(e => e.id === id) || null; },
    add(ev) { this.data.events.push(ev); this.save(); return ev; },
    update(id, patch) {
      const ev = this.getById(id);
      if (!ev) return null;
      Object.assign(ev, patch, { updatedAt: Date.now() });
      this.save();
      return ev;
    },
    remove(id) {
      this.data.events = this.data.events.filter(e => e.id !== id);
      this.save();
    },
    duplicate(id) {
      const ev = this.getById(id);
      if (!ev) return null;
      const copy = JSON.parse(JSON.stringify(ev));
      copy.id = genId();
      copy.title = ev.title + ' (bản sao)';
      copy.createdAt = copy.updatedAt = Date.now();
      copy.exceptions = {};
      this.add(copy);
      return copy;
    },
    isNotified(key) { return this.data.notified.includes(key); },
    markNotified(key) {
      this.data.notified.push(key);
      if (this.data.notified.length > 800) this.data.notified = this.data.notified.slice(-500);
      this.save();
    }
  };

  /* ============================================================================
     2. RECURRENCE ENGINE — sinh occurrence trong 1 khoảng ngày cho trước
     ========================================================================== */
  const Recur = {
    // Trả về mảng { event, dateKey, startTime, endTime, completed, progress, occKey }
    expand(event, rangeStartKey, rangeEndKey) {
      const out = [];
      const rep = event.repeat || { freq: 'none' };
      const anchor = D.fromKey(event.date);
      const rangeStart = D.fromKey(rangeStartKey);
      const rangeEnd = D.fromKey(rangeEndKey);
      const untilDate = rep.until ? D.fromKey(rep.until) : null;
      const pushOcc = (dateObj) => {
        const dateKey = D.toKey(dateObj);
        if (dateKey < rangeStartKey || dateKey > rangeEndKey) return;
        if (untilDate && dateObj > untilDate) return;
        const ex = (event.exceptions && event.exceptions[dateKey]) || null;
        if (ex && ex.deleted) return;
        const occ = {
          event,
          occKey: event.id + '::' + dateKey,
          dateKey: (ex && ex.date) ? ex.date : dateKey,
          startTime: (ex && ex.startTime) || event.startTime,
          endTime: (ex && ex.endTime) || event.endTime,
          completed: !!(ex && 'completed' in ex ? ex.completed : event.completed),
          progress: (ex && 'progress' in ex) ? ex.progress : (event.progress || 0),
          moved: !!(ex && ex.date && ex.date !== dateKey)
        };
        // nếu occurrence bị dời sang ngày khác (kéo-thả) mà ngày mới nằm ngoài range hiện tại vẫn add,
        // vì người dùng cần thấy nó ở vị trí mới khi ngày mới nằm trong range đang render.
        if (occ.dateKey >= rangeStartKey && occ.dateKey <= rangeEndKey) out.push(occ);
      };

      const freq = rep.freq || 'none';
      const MAX_OCC = 1000;
      let count = 0;

      if (freq === 'none') {
        pushOcc(anchor);
        return out;
      }
      if (freq === 'daily') {
        const step = Math.max(1, rep.interval || 1);
        let cur = new Date(anchor);
        if (cur < rangeStart) {
          const diffDays = Math.floor((rangeStart - cur) / 86400000);
          const jumps = Math.floor(diffDays / step);
          cur = D.addDays(cur, jumps * step);
        }
        while (cur <= rangeEnd && count++ < MAX_OCC) {
          if (cur >= anchor) pushOcc(cur);
          cur = D.addDays(cur, step);
        }
        return out;
      }
      if (freq === 'weekly' || freq === 'custom') {
        const step = Math.max(1, rep.interval || 1); // số tuần
        const byDay = (rep.byDay && rep.byDay.length) ? rep.byDay : [anchor.getDay()];
        const anchorWeekStart = D.startOfWeekSun(anchor);
        let weekCursor = D.startOfWeekSun(rangeStart < anchor ? anchor : rangeStart);
        // lùi về đúng pha (phase) của interval tuần so với anchorWeekStart
        const weeksFromAnchor = Math.round((weekCursor - anchorWeekStart) / (7 * 86400000));
        const rem = ((weeksFromAnchor % step) + step) % step;
        if (rem !== 0) weekCursor = D.addDays(weekCursor, -(rem) * 7);
        while (weekCursor <= rangeEnd && count < MAX_OCC) {
          for (const wd of byDay) {
            const day = D.addDays(weekCursor, wd);
            if (day >= anchor && day <= rangeEnd) { pushOcc(day); count++; }
          }
          weekCursor = D.addDays(weekCursor, step * 7);
        }
        return out;
      }
      if (freq === 'monthly') {
        const step = Math.max(1, rep.interval || 1);
        const dom = anchor.getDate();
        let cur = new Date(anchor);
        while (cur <= rangeEnd && count++ < MAX_OCC) {
          if (cur >= anchor && cur >= rangeStart || cur >= anchor) pushOcc(cur);
          cur = D.addMonths(cur, step);
          // giữ nguyên ngày-trong-tháng, xử lý tháng thiếu ngày (vd 31/2)
          if (cur.getDate() !== dom) cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
        }
        return out;
      }
      if (freq === 'yearly') {
        const step = Math.max(1, rep.interval || 1);
        let cur = new Date(anchor);
        while (cur <= rangeEnd && count++ < MAX_OCC) {
          if (cur >= anchor) pushOcc(cur);
          cur = D.addYears(cur, step);
        }
        return out;
      }
      pushOcc(anchor);
      return out;
    },
    expandAll(rangeStartKey, rangeEndKey, list) {
      const out = [];
      (list || Store.all()).forEach(ev => out.push(...Recur.expand(ev, rangeStartKey, rangeEndKey)));
      out.sort((a, b) => D.keyCompare(a.dateKey, b.dateKey) || D.keyCompare(a.startTime || '', b.startTime || ''));
      return out;
    }
  };

  /* ============================================================================
     3. TÍCH HỢP HỆ THỐNG ÔN THI (part/quiz/review) — chỉ ĐỌC API sẵn có
     ========================================================================== */
  const TYPE_META = {
    part: { label: 'Ôn phần', icon: 'fa-layer-group', color: 'var(--blue-500)' },
    exam: { label: 'Làm đề', icon: 'fa-file-pen', color: 'var(--accent-2)' },
    wrong: { label: 'Ôn câu sai', icon: 'fa-rotate-left', color: 'var(--danger)' },
    star: { label: 'Ôn câu yêu thích', icon: 'fa-star', color: 'var(--star)' },
    reading: { label: 'Đọc tài liệu', icon: 'fa-book-open', color: 'var(--blue-300)' },
    mock: { label: 'Thi thử', icon: 'fa-clipboard-check', color: 'var(--success)' },
    other: { label: 'Khác', icon: 'fa-note-sticky', color: 'var(--text-muted)' }
  };

  const Integration = {
    parsePartNumber(title) {
      const m = String(title || '').match(/ph[aầâấ]n\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    },
    // trả về nhãn phần để hiển thị badge (VD: "Phần 3")
    partLabel(ev) {
      const n = ev.partNumber || Integration.parsePartNumber(ev.title);
      return n ? `Phần ${n}` : null;
    },
    canOpen(ev) { return ['part', 'exam', 'wrong', 'star', 'mock'].includes(ev.type); },
    open(ev) {
      try {
        switch (ev.type) {
          case 'part': {
            const n = ev.partNumber || Integration.parsePartNumber(ev.title);
            if (n && typeof window.startQuiz === 'function') { window.startQuiz(n); return true; }
            if (n && window.QuizManager && typeof QuizManager.startPart === 'function') {
              const meta = (window.QuestionManager && QuestionManager.allPartsMeta) ? QuestionManager.allPartsMeta() : [];
              if (meta[n - 1]) { QuizManager.startPart(n - 1); return true; }
              UIManager.toast('warn', 'Không tìm thấy phần', `Phần ${n} chưa tồn tại trong danh sách phần hiện tại`);
              return true;
            }
            if (window.UIManager) UIManager.navigate('parts');
            return true;
          }
          case 'wrong':
            if (window.UIManager) UIManager.navigate('reviewWrong');
            return true;
          case 'star':
            if (window.UIManager) UIManager.navigate('reviewStar');
            return true;
          case 'exam':
          case 'mock':
            if (window.UIManager) UIManager.navigate('customExam');
            return true;
          default:
            return false;
        }
      } catch (e) { console.error('[Schedule] Lỗi mở liên kết hệ thống:', e); return false; }
    }
  };

  /* ============================================================================
     4. STATE điều hướng lịch (view hiện tại, ngày hiện tại, filter, search)
     ========================================================================== */
  const State = {
    view: 'month',      // month | week | day | agenda
    cursor: new Date(),  // ngày mốc cho view hiện tại
    search: '',
    filterType: 'all',
    filterPriority: 'all',
    filterStatus: 'all', // all | done | pending
    dragOccKey: null
  };

  const PRIORITY_META = {
    low: { label: 'Thấp', color: 'var(--blue-300)' },
    medium: { label: 'Trung bình', color: 'var(--warning)' },
    high: { label: 'Cao', color: 'var(--accent-2)' },
    urgent: { label: 'Khẩn cấp', color: 'var(--danger)' }
  };
  const REMINDER_OPTS = [
    { v: 0, l: 'Không' }, { v: 5, l: '5 phút trước' }, { v: 10, l: '10 phút trước' },
    { v: 15, l: '15 phút trước' }, { v: 30, l: '30 phút trước' }, { v: 60, l: '1 giờ trước' },
    { v: 1440, l: '1 ngày trước' }
  ];
  const REPEAT_OPTS = [
    { v: 'none', l: 'Không lặp' }, { v: 'daily', l: 'Hàng ngày' }, { v: 'weekly', l: 'Hàng tuần' },
    { v: 'monthly', l: 'Hàng tháng' }, { v: 'yearly', l: 'Hàng năm' }, { v: 'custom', l: 'Tùy chỉnh' }
  ];
  const DAY_START_HOUR = 6, DAY_END_HOUR = 22; // 6:00 -> 22:00

  /* ============================================================================
     5. INJECT CSS
     ========================================================================== */
  function injectCss() {
    if (document.getElementById('schedule-styles')) return;
    const css = `
#view-schedule{ animation:schFade .25s ease; }
@keyframes schFade{ from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:translateY(0);} }

.sch-header{ display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:18px; }
.sch-header-left{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.sch-header-right{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.sch-title-label{ font-size:16px; font-weight:800; min-width:170px; }
.sch-viewswitch{ display:flex; gap:4px; background:var(--card-bg); border:1.5px solid var(--card-border); border-radius:12px; padding:4px; }
.sch-viewswitch button{ padding:7px 12px; border-radius:9px; font-size:12.5px; font-weight:600; color:var(--text-muted); transition:var(--trans); }
.sch-viewswitch button.active{ background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; }
.sch-search{ display:flex; align-items:center; gap:8px; background:var(--card-bg); border:1.5px solid var(--card-border); border-radius:12px; padding:8px 14px; min-width:200px; }
.sch-search input{ border:none; outline:none; background:transparent; color:var(--text-main); font-size:13px; width:100%; }
.sch-search i{ color:var(--text-muted); font-size:13px; }
.sch-filters{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }

/* ---- MONTH VIEW ---- */
.sch-month-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:8px; }
.sch-weekday-head{ font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); text-align:center; padding-bottom:6px; }
.sch-day-cell{ background:var(--card-bg); border:1.5px solid var(--card-border); border-radius:var(--radius-sm); min-height:108px; padding:8px; display:flex; flex-direction:column; gap:4px; cursor:pointer; transition:var(--trans); position:relative; }
.sch-day-cell:hover{ border-color:var(--accent); box-shadow:var(--shadow-sm); }
.sch-day-cell.other-month{ opacity:.38; }
.sch-day-cell.is-today{ border-color:var(--accent); box-shadow:0 0 0 2px rgba(20,120,212,.18) inset; }
.sch-day-cell.drag-over{ background:rgba(20,120,212,.12); border-color:var(--accent); }
.sch-day-num{ font-size:12.5px; font-weight:700; color:var(--text-main); display:flex; align-items:center; justify-content:space-between; }
.sch-day-num .sch-today-dot{ background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; }
.sch-day-events{ display:flex; flex-direction:column; gap:3px; overflow:hidden; }
.sch-pill{ font-size:10.5px; font-weight:600; padding:3px 7px; border-radius:7px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:grab; display:flex; align-items:center; gap:4px; transition:var(--trans); }
.sch-pill:hover{ filter:brightness(1.08); transform:translateX(1px); }
.sch-pill.done{ opacity:.55; text-decoration:line-through; }
.sch-pill-more{ font-size:10px; color:var(--text-muted); font-weight:700; padding:2px 4px; cursor:pointer; }

/* ---- WEEK / DAY TIMELINE ---- */
.sch-timeline-wrap{ display:flex; border:1.5px solid var(--card-border); border-radius:var(--radius-md); overflow:hidden; background:var(--card-bg); }
.sch-time-col{ width:56px; flex-shrink:0; border-right:1px solid var(--card-border); }
.sch-time-slot{ height:52px; font-size:10.5px; color:var(--text-muted); text-align:right; padding:2px 8px 0 0; border-bottom:1px solid var(--card-border); box-sizing:border-box; }
.sch-days-scroll{ flex:1; overflow-x:auto; }
.sch-days-row{ display:flex; min-width:100%; }
.sch-day-col-head{ text-align:center; padding:10px 4px; font-size:11.5px; font-weight:700; border-bottom:1.5px solid var(--card-border); border-left:1px solid var(--card-border); color:var(--text-muted); }
.sch-day-col-head.is-today{ color:var(--accent); }
.sch-day-col-head b{ display:block; font-size:15px; color:var(--text-main); }
.sch-day-col-head.is-today b{ color:var(--accent); }
.sch-timeline-col{ flex:1; min-width:130px; position:relative; border-left:1px solid var(--card-border); }
.sch-timeline-col.day-single{ min-width:100%; }
.sch-slot-row{ height:52px; border-bottom:1px solid var(--card-border); box-sizing:border-box; }
.sch-slot-row:hover{ background:rgba(20,120,212,.05); cursor:pointer; }
.sch-now-line{ position:absolute; left:0; right:0; height:2px; background:var(--danger); z-index:5; }
.sch-now-line::before{ content:''; position:absolute; left:-4px; top:-3px; width:8px; height:8px; border-radius:50%; background:var(--danger); }
.sch-block{ position:absolute; left:3px; right:3px; border-radius:8px; padding:5px 8px; color:#fff; font-size:11px; font-weight:600; overflow:hidden; cursor:grab; box-shadow:var(--shadow-sm); transition:box-shadow .15s ease, filter .15s ease; z-index:2; }
.sch-block:hover{ filter:brightness(1.07); box-shadow:var(--shadow-md); z-index:6; }
.sch-block.dragging{ opacity:.75; cursor:grabbing; z-index:20; }
.sch-block.done{ opacity:.55; }
.sch-block .sch-block-title{ display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sch-block .sch-block-time{ font-size:9.5px; opacity:.85; }
.sch-resize-handle{ position:absolute; left:0; right:0; bottom:0; height:7px; cursor:ns-resize; }

/* ---- AGENDA VIEW ---- */
.sch-agenda-group{ margin-bottom:18px; }
.sch-agenda-date{ font-size:12.5px; font-weight:800; color:var(--accent); margin-bottom:8px; display:flex; align-items:center; gap:8px; }
.sch-agenda-date .line{ flex:1; height:1px; background:var(--card-border); }
.sch-agenda-item{ display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:8px; }
.sch-agenda-time{ width:56px; flex-shrink:0; font-size:12px; font-weight:700; color:var(--text-main); text-align:center; }
.sch-agenda-dot{ width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.sch-agenda-body{ flex:1; min-width:0; }
.sch-agenda-body b{ font-size:13.5px; font-weight:700; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sch-agenda-body span{ font-size:11.5px; color:var(--text-muted); }
.sch-agenda-item.done .sch-agenda-body b{ text-decoration:line-through; opacity:.55; }
.sch-agenda-check{ width:26px; height:26px; border-radius:50%; border:2px solid var(--card-border); display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; color:transparent; transition:var(--trans); }
.sch-agenda-check.done{ background:var(--success); border-color:var(--success); color:#fff; }
.sch-agenda-priority{ font-size:9.5px; font-weight:800; padding:2px 7px; border-radius:6px; color:#fff; flex-shrink:0; }

/* ---- MODAL FORM (thêm/sửa kế hoạch) ---- */
.sch-modal-overlay{ display:none; position:fixed; inset:0; background:rgba(3,19,36,.55); backdrop-filter:blur(3px); z-index:500; align-items:center; justify-content:center; padding:16px; }
.sch-modal-overlay.show{ display:flex; animation:fadeIn .2s ease; }
.sch-modal-box{ background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg); width:100%; max-width:560px; max-height:90vh; overflow-y:auto; padding:24px; }
.sch-modal-box h3{ font-size:17px; font-weight:800; margin-bottom:16px; display:flex; align-items:center; gap:10px; justify-content:space-between; }
.sch-modal-box h3 .sch-close-x{ font-size:16px; color:var(--text-muted); cursor:pointer; }
.sch-form-row{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
.sch-form-row.single{ grid-template-columns:1fr; }
.sch-form-field label{ display:block; font-size:11.5px; font-weight:700; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase; letter-spacing:.3px; }
.sch-form-field input[type=text], .sch-form-field input[type=date], .sch-form-field input[type=time], .sch-form-field input[type=number], .sch-form-field textarea, .sch-form-field select{
  width:100%; padding:9px 12px; border-radius:11px; background:var(--card-bg); border:1.5px solid var(--card-border); color:var(--text-main); font-size:13px; outline:none; font-family:inherit; transition:var(--trans);
}
.sch-form-field input:focus, .sch-form-field textarea:focus, .sch-form-field select:focus{ border-color:var(--accent); }
.sch-form-field textarea{ resize:vertical; min-height:56px; }
.sch-color-row{ display:flex; gap:8px; flex-wrap:wrap; }
.sch-color-swatch{ width:26px; height:26px; border-radius:50%; cursor:pointer; border:2.5px solid transparent; transition:var(--trans); }
.sch-color-swatch.active{ border-color:var(--text-main); transform:scale(1.12); }
.sch-priority-row{ display:flex; gap:6px; }
.sch-priority-row button{ flex:1; padding:8px 4px; border-radius:10px; font-size:11.5px; font-weight:700; border:1.5px solid var(--card-border); color:var(--text-muted); transition:var(--trans); }
.sch-priority-row button.active{ color:#fff; border-color:transparent; }
.sch-modal-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:18px; padding-top:14px; border-top:1px solid var(--card-border); }
.sch-modal-actions .sch-danger-zone{ margin-right:auto; }
.sch-inline-toggle{ display:flex; align-items:center; gap:10px; }

/* ---- DETAIL POPOVER ---- */
.sch-popover{ position:fixed; z-index:450; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); padding:16px; width:280px; }
.sch-popover .sch-pop-title{ font-size:14.5px; font-weight:800; margin-bottom:6px; }
.sch-popover .sch-pop-meta{ font-size:12px; color:var(--text-muted); margin-bottom:4px; display:flex; align-items:center; gap:6px; }
.sch-popover .sch-pop-actions{ display:flex; gap:6px; margin-top:12px; flex-wrap:wrap; }

/* ---- CONTEXT MENU ---- */
.sch-ctx-menu{ position:fixed; z-index:460; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:12px; box-shadow:var(--shadow-lg); padding:6px; min-width:160px; }
.sch-ctx-menu button{ display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--text-main); text-align:left; }
.sch-ctx-menu button:hover{ background:rgba(20,120,212,.1); color:var(--accent); }
.sch-ctx-menu button.danger:hover{ background:rgba(239,68,68,.1); color:var(--danger); }
.sch-ctx-menu hr{ border:none; border-top:1px solid var(--card-border); margin:5px 0; }

/* ---- STATS ---- */
.sch-stats-heatmap-wrap{ overflow-x:auto; }

/* ---- DASHBOARD WIDGETS ---- */
.sch-dash-widgets{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; margin-bottom:22px; }
.sch-widget-card{ padding:18px 20px; }
.sch-widget-card h3{ font-size:14px; font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
.sch-widget-card h3 i{ color:var(--accent); }
.sch-widget-list{ display:flex; flex-direction:column; gap:9px; max-height:260px; overflow-y:auto; }
.sch-widget-item{ display:flex; align-items:center; gap:10px; font-size:12.5px; }
.sch-widget-time{ font-weight:700; width:44px; flex-shrink:0; color:var(--accent); }
.sch-widget-dot{ width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.sch-widget-item b{ font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sch-widget-item span{ color:var(--text-muted); font-size:11px; }

/* ---- NOTIFICATION POPUP ---- */
.sch-notify{ position:fixed; bottom:24px; right:24px; z-index:600; background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); padding:18px 20px; width:300px; animation:schNotifyIn .35s cubic-bezier(.34,1.56,.64,1); }
@keyframes schNotifyIn{ from{ transform:translateY(30px) scale(.9); opacity:0; } to{ transform:translateY(0) scale(1); opacity:1; } }
.sch-notify .sch-notify-head{ display:flex; align-items:center; gap:8px; font-weight:800; font-size:13px; margin-bottom:6px; color:var(--accent); }
.sch-notify p{ font-size:12.5px; color:var(--text-muted); margin-bottom:12px; }
.sch-notify .sch-notify-actions{ display:flex; gap:8px; }

/* ---- responsive ---- */
@media (max-width:860px){
  .sch-day-cell{ min-height:74px; padding:5px; }
  .sch-pill{ font-size:9.5px; padding:2px 5px; }
  .sch-form-row{ grid-template-columns:1fr; }
  .sch-title-label{ min-width:auto; font-size:14px; }
}
@media (max-width:520px){
  .sch-month-grid{ gap:4px; }
  .sch-weekday-head{ font-size:9px; }
  .sch-day-cell{ min-height:60px; }
  .sch-time-col{ width:40px; }
  .sch-notify{ right:10px; left:10px; width:auto; bottom:10px; }
}
`;
    const style = document.createElement('style');
    style.id = 'schedule-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============================================================================
     6. INJECT DOM — nav item + view section + modal + popover container
     ========================================================================== */
  function injectDom() {
    // 6a) Nav item trong sidebar, ngay dưới "Câu yêu thích"
    if (!document.querySelector('.nav-item[data-view="schedule"]')) {
      const anchor = document.querySelector('.nav-item[data-view="reviewStar"]') || document.querySelector('.nav-item[data-view="quiz"]');
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.view = 'schedule';
      btn.innerHTML = '<i class="fa-solid fa-calendar-days"></i> Kế hoạch học';
      if (anchor) anchor.insertAdjacentElement('afterend', btn);
      else document.querySelector('.sidebar-nav').appendChild(btn);
    }

    // 6b) View section mới
    if (!document.getElementById('view-schedule')) {
      const main = document.querySelector('main.content');
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-schedule';
      section.innerHTML = `
        <div class="sch-header">
          <div class="sch-header-left">
            <button class="btn btn-outline btn-sm" id="schTodayBtn">Hôm nay</button>
            <button class="icon-btn" id="schPrevBtn" data-tip="Trước"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="icon-btn" id="schNextBtn" data-tip="Sau"><i class="fa-solid fa-chevron-right"></i></button>
            <div class="sch-title-label" id="schTitleLabel">-</div>
          </div>
          <div class="sch-header-right">
            <div class="sch-search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" id="schSearchInput" placeholder="Tìm tên, mô tả, tag..."></div>
            <div class="sch-viewswitch" id="schViewSwitch">
              <button data-v="month" class="active">Tháng</button>
              <button data-v="week">Tuần</button>
              <button data-v="day">Ngày</button>
              <button data-v="agenda">Lịch trình</button>
            </div>
            <button class="btn btn-primary btn-sm" id="schAddBtn"><i class="fa-solid fa-plus"></i> Thêm kế hoạch</button>
          </div>
        </div>

        <div class="sch-filters">
          <select class="select-box" id="schFilterType">
            <option value="all">Tất cả loại học</option>
            ${Object.keys(TYPE_META).map(k => `<option value="${k}">${TYPE_META[k].label}</option>`).join('')}
          </select>
          <select class="select-box" id="schFilterPriority">
            <option value="all">Mọi mức ưu tiên</option>
            ${Object.keys(PRIORITY_META).map(k => `<option value="${k}">${PRIORITY_META[k].label}</option>`).join('')}
          </select>
          <select class="select-box" id="schFilterStatus">
            <option value="all">Mọi trạng thái</option>
            <option value="pending">Chưa hoàn thành</option>
            <option value="done">Đã hoàn thành</option>
          </select>
          <button class="btn btn-outline btn-sm" id="schExportBtn"><i class="fa-solid fa-file-export"></i> Xuất dữ liệu</button>
          <button class="btn btn-outline btn-sm" id="schImportBtn"><i class="fa-solid fa-file-import"></i> Nhập dữ liệu</button>
          <input type="file" id="schImportFile" accept=".json" style="display:none;">
          <button class="btn btn-ghost btn-sm" id="schStatsBtn"><i class="fa-solid fa-chart-simple"></i> Thống kê</button>
        </div>

        <div id="schViewBody"></div>

        <div class="card" id="schStatsPanel" style="display:none; margin-top:18px; padding:20px 22px;">
          <h3 style="font-size:14.5px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-chart-simple" style="color:var(--accent);"></i> Thống kê kế hoạch học</h3>
          <div class="stat-grid" id="schStatsGrid"></div>
          <h4 style="font-size:13px;font-weight:700;margin:16px 0 10px;">Heatmap 365 ngày gần nhất</h4>
          <div class="sch-stats-heatmap-wrap"><div class="heatmap-wrap" id="schHeatmap"></div></div>
          <div class="heatmap-legend"><span>Ít</span><div class="heatmap-cell" style="background:rgba(20,120,212,.10)"></div><div class="heatmap-cell" style="background:rgba(20,120,212,.35)"></div><div class="heatmap-cell" style="background:rgba(20,120,212,.6)"></div><div class="heatmap-cell" style="background:rgba(20,120,212,.9)"></div><span>Nhiều</span></div>
        </div>
      `;
      if (main) main.appendChild(section);
    }

    // 6c) Modal thêm/sửa kế hoạch
    if (!document.getElementById('schEventModal')) {
      const overlay = document.createElement('div');
      overlay.className = 'sch-modal-overlay';
      overlay.id = 'schEventModal';
      overlay.innerHTML = `
        <div class="sch-modal-box">
          <h3><span id="schModalTitle"><i class="fa-solid fa-calendar-plus"></i> Thêm kế hoạch</span><i class="fa-solid fa-xmark sch-close-x" id="schModalCloseX"></i></h3>
          <input type="hidden" id="schFieldId">
          <div class="sch-form-row single">
            <div class="sch-form-field"><label>Tên kế hoạch *</label><input type="text" id="schFieldTitle" placeholder="VD: Ôn phần 3"></div>
          </div>
          <div class="sch-form-row single">
            <div class="sch-form-field"><label>Mô tả</label><textarea id="schFieldDesc" placeholder="Ghi chú thêm..."></textarea></div>
          </div>
          <div class="sch-form-row">
            <div class="sch-form-field"><label>Ngày *</label><input type="date" id="schFieldDate"></div>
            <div class="sch-form-field"><label>Loại học</label>
              <select id="schFieldType">${Object.keys(TYPE_META).map(k => `<option value="${k}">${TYPE_META[k].label}</option>`).join('')}</select>
            </div>
          </div>
          <div class="sch-form-row">
            <div class="sch-form-field"><label>Giờ bắt đầu *</label><input type="time" id="schFieldStart" value="08:00"></div>
            <div class="sch-form-field"><label>Giờ kết thúc *</label><input type="time" id="schFieldEnd" value="09:00"></div>
          </div>
          <div class="sch-form-row" id="schPartRow" style="display:none;">
            <div class="sch-form-field"><label>Chọn phần</label><select id="schFieldPartSelect"></select></div>
            <div class="sch-form-field"><label>Tiến độ (%)</label><input type="number" id="schFieldProgress" min="0" max="100" step="5" value="0"></div>
          </div>
          <div class="sch-form-row" id="schProgressRowAlone">
            <div class="sch-form-field"><label>Tiến độ (%)</label><input type="number" id="schFieldProgressAlone" min="0" max="100" step="5" value="0"></div>
            <div class="sch-form-field"><label>Nhắc nhở</label>
              <select id="schFieldReminder">${REMINDER_OPTS.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select>
            </div>
          </div>
          <div class="sch-form-row" id="schReminderRowWithPart" style="display:none;">
            <div class="sch-form-field"><label>Nhắc nhở</label>
              <select id="schFieldReminder2">${REMINDER_OPTS.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select>
            </div>
            <div class="sch-form-field"><label>&nbsp;</label><div class="sch-inline-toggle"><label class="switch"><input type="checkbox" id="schFieldDeadline2"><span class="slider-toggle"></span></label><span style="font-size:12.5px;">Đặt làm Deadline</span></div></div>
          </div>
          <div class="sch-form-row">
            <div class="sch-form-field"><label>Lặp lại</label>
              <select id="schFieldRepeat">${REPEAT_OPTS.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select>
            </div>
            <div class="sch-form-field" id="schRepeatUntilField" style="display:none;"><label>Lặp đến ngày</label><input type="date" id="schFieldUntil"></div>
          </div>
          <div class="sch-form-row single" id="schByDayField" style="display:none;">
            <div class="sch-form-field"><label>Các ngày trong tuần</label>
              <div class="sch-color-row" id="schByDayChips">
                ${D.weekdayMini.map((w, i) => `<button type="button" class="filter-chip" data-wd="${i}" style="padding:6px 10px;font-size:11px;">${w}</button>`).join('')}
              </div>
            </div>
          </div>
          <div class="sch-form-row single">
            <div class="sch-form-field"><label>Màu sắc</label>
              <div class="sch-color-row" id="schColorRow"></div>
            </div>
          </div>
          <div class="sch-form-row single">
            <div class="sch-form-field"><label>Mức ưu tiên</label>
              <div class="sch-priority-row" id="schPriorityRow"></div>
            </div>
          </div>
          <div class="sch-form-row">
            <div class="sch-form-field"><div class="sch-inline-toggle"><label class="switch"><input type="checkbox" id="schFieldDeadline"><span class="slider-toggle"></span></label><span style="font-size:12.5px;">Đặt làm Deadline</span></div></div>
            <div class="sch-form-field"><div class="sch-inline-toggle"><label class="switch"><input type="checkbox" id="schFieldCompleted"><span class="slider-toggle"></span></label><span style="font-size:12.5px;">Đã hoàn thành</span></div></div>
          </div>
          <div class="sch-modal-actions">
            <button class="btn btn-danger btn-sm sch-danger-zone" id="schDeleteBtn" style="display:none;"><i class="fa-solid fa-trash"></i> Xóa</button>
            <button class="btn btn-outline btn-sm" id="schCancelBtn">Hủy</button>
            <button class="btn btn-primary btn-sm" id="schSaveBtn"><i class="fa-solid fa-check"></i> Lưu kế hoạch</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      // preset màu theo đúng theme hiện có (không dùng màu Google)
      const presetColors = ['var(--blue-500)', 'var(--accent-2)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--star)', 'var(--blue-700)', 'var(--blue-300)'];
      document.getElementById('schColorRow').innerHTML = presetColors.map((c, i) =>
        `<div class="sch-color-swatch${i === 0 ? ' active' : ''}" data-color="${c}" style="background:${c};"></div>`).join('');
      document.getElementById('schPriorityRow').innerHTML = Object.keys(PRIORITY_META).map((k, i) =>
        `<button type="button" data-p="${k}" class="${k === 'medium' ? 'active' : ''}" style="${k === 'medium' ? `background:${PRIORITY_META[k].color};` : ''}">${PRIORITY_META[k].label}</button>`).join('');
    }

    // 6d) Container popover chi tiết + context menu (rỗng, render động)
    if (!document.getElementById('schPopover')) {
      const pop = document.createElement('div');
      pop.id = 'schPopover';
      pop.className = 'sch-popover';
      pop.style.display = 'none';
      document.body.appendChild(pop);
    }
    if (!document.getElementById('schCtxMenu')) {
      const ctx = document.createElement('div');
      ctx.id = 'schCtxMenu';
      ctx.className = 'sch-ctx-menu';
      ctx.style.display = 'none';
      document.body.appendChild(ctx);
    }

    // 6e) Widget "Hôm nay" + "Upcoming" trên Dashboard — chèn sau card heatmap gốc
    if (!document.getElementById('schDashWidgets')) {
      const dashView = document.getElementById('view-dashboard');
      if (dashView) {
        const wrap = document.createElement('div');
        wrap.className = 'sch-dash-widgets';
        wrap.id = 'schDashWidgets';
        wrap.innerHTML = `
          <div class="card sch-widget-card">
            <h3><i class="fa-solid fa-calendar-day"></i> Hôm nay</h3>
            <div class="sch-widget-list" id="schWidgetToday"></div>
          </div>
          <div class="card sch-widget-card">
            <h3><i class="fa-solid fa-calendar-week"></i> Sắp tới (7 ngày)</h3>
            <div class="sch-widget-list" id="schWidgetUpcoming"></div>
          </div>`;
        dashView.appendChild(wrap);
      }
    }
  }

  /* ============================================================================
     7. TOAST / CONFIRM — dùng UIManager có sẵn nếu tồn tại, fallback alert
     ========================================================================== */
  function toast(type, title, msg) {
    if (window.UIManager && typeof UIManager.toast === 'function') UIManager.toast(type, title, msg);
    else console.log(`[${type}] ${title}: ${msg || ''}`);
  }
  function confirmDialog(title, msg, onOk) {
    if (window.UIManager && typeof UIManager.confirm === 'function') { UIManager.confirm(title, msg, onOk); return; }
    if (window.confirm(`${title}\n${msg}`)) onOk();
  }

  /* ============================================================================
     8. RENDER — MONTH / WEEK / DAY / AGENDA
     ========================================================================== */
  function matchesFilters(occ) {
    const ev = occ.event;
    if (State.filterType !== 'all' && ev.type !== State.filterType) return false;
    if (State.filterPriority !== 'all' && ev.priority !== State.filterPriority) return false;
    if (State.filterStatus === 'done' && !occ.completed) return false;
    if (State.filterStatus === 'pending' && occ.completed) return false;
    if (State.search) {
      const q = State.search.toLowerCase();
      const hay = `${ev.title} ${ev.description || ''} ${TYPE_META[ev.type] ? TYPE_META[ev.type].label : ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function updateTitleLabel() {
    const label = document.getElementById('schTitleLabel');
    if (!label) return;
    const c = State.cursor;
    if (State.view === 'month') label.textContent = `${D.monthNames[c.getMonth()]}, ${c.getFullYear()}`;
    else if (State.view === 'week') {
      const start = D.startOfWeekSun(c), end = D.addDays(start, 6);
      label.textContent = `${D.fmtDateVN(start)} - ${D.fmtDateVN(end)}`;
    } else if (State.view === 'day') label.textContent = `${D.weekdayShort[c.getDay()]}, ${D.fmtDateVN(c)}`;
    else label.textContent = 'Lịch trình sắp tới';
  }

  function renderView() {
    updateTitleLabel();
    const body = document.getElementById('schViewBody');
    if (!body) return;
    if (State.view === 'month') renderMonth(body);
    else if (State.view === 'week') renderWeek(body);
    else if (State.view === 'day') renderDay(body);
    else renderAgenda(body);
    refreshBadges();
  }

  function refreshBadges() {
    // đồng bộ badge số lượng "cần ôn" liên quan (không sửa hàm gốc, chỉ đọc thêm nếu cần) — bỏ qua, không đụng badge hệ thống gốc.
  }

  /* -------- MONTH -------- */
  function renderMonth(body) {
    const monthStart = D.startOfMonth(State.cursor);
    const gridStart = D.startOfWeekSun(monthStart);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(D.addDays(gridStart, i));
    const rangeStartKey = D.toKey(days[0]);
    const rangeEndKey = D.toKey(days[days.length - 1]);
    const occs = Recur.expandAll(rangeStartKey, rangeEndKey).filter(matchesFilters);
    const byDate = {};
    occs.forEach(o => { (byDate[o.dateKey] = byDate[o.dateKey] || []).push(o); });

    let html = `<div class="sch-month-grid">`;
    D.weekdayMini.forEach(w => html += `<div class="sch-weekday-head">${w}</div>`);
    days.forEach(d => {
      const key = D.toKey(d);
      const inMonth = d.getMonth() === State.cursor.getMonth();
      const list = (byDate[key] || []).slice(0, 3);
      const extra = (byDate[key] || []).length - list.length;
      html += `<div class="sch-day-cell${inMonth ? '' : ' other-month'}${D.isToday(d) ? ' is-today' : ''}" data-date="${key}">
        <div class="sch-day-num">${D.isToday(d) ? `<span class="sch-today-dot">${d.getDate()}</span>` : `<span>${d.getDate()}</span>`}</div>
        <div class="sch-day-events">
          ${list.map(o => pillHtml(o)).join('')}
          ${extra > 0 ? `<div class="sch-pill-more" data-more="${key}">+${extra} khác</div>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
    body.innerHTML = html;

    body.querySelectorAll('.sch-day-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.sch-pill') || e.target.closest('.sch-pill-more')) return;
        openAddModal({ date: cell.dataset.date });
      });
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault(); cell.classList.remove('drag-over');
        const occKey = e.dataTransfer.getData('text/plain');
        if (occKey) moveOccurrenceToDate(occKey, cell.dataset.date);
      });
    });
    body.querySelectorAll('.sch-pill').forEach(el => wirePillEvents(el));
    body.querySelectorAll('.sch-pill-more').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        State.view = 'day'; State.cursor = D.fromKey(el.dataset.more);
        syncViewSwitchUI(); renderView();
      });
    });
  }

  function pillHtml(o) {
    const meta = TYPE_META[o.event.type] || TYPE_META.other;
    const color = o.event.color || meta.color;
    return `<div class="sch-pill${o.completed ? ' done' : ''}" draggable="true" data-occ="${o.occKey}" style="background:${color};" title="${esc(o.event.title)}">
      ${o.startTime ? `<span>${o.startTime}</span>` : ''}<span>${esc(o.event.title)}</span>
    </div>`;
  }

  /* -------- WEEK -------- */
  function renderWeek(body) {
    const start = D.startOfWeekSun(State.cursor);
    const days = Array.from({ length: 7 }, (_, i) => D.addDays(start, i));
    renderTimelineGrid(body, days, false);
  }
  /* -------- DAY -------- */
  function renderDay(body) {
    renderTimelineGrid(body, [new Date(State.cursor)], true);
  }

  function renderTimelineGrid(body, days, single) {
    const rangeStartKey = D.toKey(days[0]);
    const rangeEndKey = D.toKey(days[days.length - 1]);
    const occs = Recur.expandAll(rangeStartKey, rangeEndKey).filter(matchesFilters);
    const byDate = {};
    occs.forEach(o => { (byDate[o.dateKey] = byDate[o.dateKey] || []).push(o); });

    const hours = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hours.push(h);

    let head = `<div class="sch-day-col-head" style="width:56px;flex-shrink:0;"></div>`;
    days.forEach(d => {
      head += `<div class="sch-day-col-head${D.isToday(d) ? ' is-today' : ''}" style="flex:1;min-width:${single ? '100%' : '130px'};">${D.weekdayMini[d.getDay()]}<b>${d.getDate()}</b></div>`;
    });

    let timeCol = `<div class="sch-time-col">`;
    hours.forEach(h => timeCol += `<div class="sch-time-slot">${pad2(h)}:00</div>`);
    timeCol += `</div>`;

    let dayCols = '';
    days.forEach(d => {
      const key = D.toKey(d);
      const list = byDate[key] || [];
      let colHtml = `<div class="sch-timeline-col${single ? ' day-single' : ''}" data-date="${key}">`;
      hours.forEach((h, idx) => { colHtml += `<div class="sch-slot-row" data-hour="${h}"></div>`; });
      // now-line nếu là hôm nay
      if (D.isToday(d)) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const top = ((nowMin - DAY_START_HOUR * 60) / 60) * 52;
        if (nowMin >= DAY_START_HOUR * 60 && nowMin <= DAY_END_HOUR * 60) {
          colHtml += `<div class="sch-now-line" style="top:${top}px;"></div>`;
        }
      }
      list.forEach(o => { colHtml += blockHtml(o); });
      colHtml += `</div>`;
      dayCols += colHtml;
    });

    body.innerHTML = `<div class="sch-timeline-wrap">
      ${timeCol}
      <div class="sch-days-scroll"><div class="sch-days-row" style="flex-direction:column;">
        <div style="display:flex;">${head}</div>
        <div style="display:flex;">${dayCols}</div>
      </div></div>
    </div>`;

    body.querySelectorAll('.sch-slot-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const col = row.closest('.sch-timeline-col');
        const h = parseInt(row.dataset.hour, 10);
        openAddModal({ date: col.dataset.date, startTime: `${pad2(h)}:00`, endTime: `${pad2(h + 1)}:00` });
      });
    });
    body.querySelectorAll('.sch-block').forEach(el => wireBlockEvents(el));
  }

  function blockHtml(o) {
    const meta = TYPE_META[o.event.type] || TYPE_META.other;
    const color = o.event.color || meta.color;
    const startMin = D.timeToMin(o.startTime || '08:00');
    const endMin = Math.max(startMin + 15, D.timeToMin(o.endTime || '09:00'));
    const top = ((startMin - DAY_START_HOUR * 60) / 60) * 52;
    const height = ((endMin - startMin) / 60) * 52;
    return `<div class="sch-block${o.completed ? ' done' : ''}" data-occ="${o.occKey}" style="top:${top}px; height:${Math.max(20, height)}px; background:${color};">
      <span class="sch-block-title">${esc(o.event.title)}</span>
      <span class="sch-block-time">${o.startTime} - ${o.endTime}</span>
      <div class="sch-resize-handle" data-resize="${o.occKey}"></div>
    </div>`;
  }

  /* -------- AGENDA -------- */
  function renderAgenda(body) {
    const start = D.toKey(State.cursor);
    const end = D.toKey(D.addDays(State.cursor, 60));
    const occs = Recur.expandAll(start, end).filter(matchesFilters);
    if (!occs.length) {
      body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>Không có kế hoạch nào trong khoảng thời gian này</p></div>`;
      return;
    }
    const byDate = {};
    occs.forEach(o => { (byDate[o.dateKey] = byDate[o.dateKey] || []).push(o); });
    const dates = Object.keys(byDate).sort();
    let html = '';
    dates.forEach(key => {
      const d = D.fromKey(key);
      html += `<div class="sch-agenda-group">
        <div class="sch-agenda-date">${D.isToday(d) ? 'HÔM NAY · ' : ''}${D.weekdayShort[d.getDay()]}, ${D.fmtDateVN(d)}<div class="line"></div></div>
        ${byDate[key].map(o => agendaItemHtml(o)).join('')}
      </div>`;
    });
    body.innerHTML = html;
    body.querySelectorAll('.sch-agenda-item').forEach(el => wireAgendaEvents(el));
  }

  function agendaItemHtml(o) {
    const meta = TYPE_META[o.event.type] || TYPE_META.other;
    const color = o.event.color || meta.color;
    const pr = PRIORITY_META[o.event.priority] || PRIORITY_META.medium;
    return `<div class="card sch-agenda-item${o.completed ? ' done' : ''}" data-occ="${o.occKey}">
      <div class="sch-agenda-time">${o.startTime || ''}</div>
      <div class="sch-agenda-dot" style="background:${color};"></div>
      <div class="sch-agenda-body">
        <b>${esc(o.event.title)}</b>
        <span><i class="fa-solid ${meta.icon}"></i> ${meta.label}${o.progress ? ` · ${o.progress}%` : ''}</span>
      </div>
      <span class="sch-agenda-priority" style="background:${pr.color};">${pr.label}</span>
      <div class="sch-agenda-check${o.completed ? ' done' : ''}" data-check="${o.occKey}"><i class="fa-solid fa-check" style="font-size:11px;"></i></div>
    </div>`;
  }

  /* ============================================================================
     9. WIRE — pill / block / agenda item (click, dblclick, contextmenu, drag)
     ========================================================================== */
  function wirePillEvents(el) {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.occ); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('click', e => { e.stopPropagation(); showPopover(el.dataset.occ, e.clientX, e.clientY); });
    el.addEventListener('dblclick', e => { e.stopPropagation(); openEditModal(el.dataset.occ); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showContextMenu(el.dataset.occ, e.clientX, e.clientY); });
  }

  function wireAgendaEvents(el) {
    el.addEventListener('click', e => {
      if (e.target.closest('.sch-agenda-check')) return;
      openEditModal(el.dataset.occ);
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(el.dataset.occ, e.clientX, e.clientY); });
    el.querySelector('.sch-agenda-check').addEventListener('click', e => {
      e.stopPropagation(); toggleComplete(el.dataset.occ);
    });
  }

  let dragState = null;
  function wireBlockEvents(el) {
    el.addEventListener('click', e => {
      if (e.target.closest('.sch-resize-handle')) return;
      if (dragState && dragState.moved) return;
      e.stopPropagation(); showPopover(el.dataset.occ, e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', e => { e.stopPropagation(); openEditModal(el.dataset.occ); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showContextMenu(el.dataset.occ, e.clientX, e.clientY); });

    const handle = el.querySelector('.sch-resize-handle');
    handle.addEventListener('mousedown', e => { e.stopPropagation(); startResize(e, el); });
    handle.addEventListener('touchstart', e => { e.stopPropagation(); startResize(e.touches[0], el); }, { passive: true });

    el.addEventListener('mousedown', e => { if (e.target.closest('.sch-resize-handle')) return; startMove(e, el); });
    el.addEventListener('touchstart', e => { if (e.target.closest('.sch-resize-handle')) return; startMove(e.touches[0], el); }, { passive: true });
  }

  function startMove(pointerEvt, el) {
    const occKey = el.dataset.occ;
    const col = el.closest('.sch-timeline-col');
    const startTop = parseFloat(el.style.top);
    const startY = pointerEvt.clientY;
    dragState = { type: 'move', occKey, el, col, startTop, startY, moved: false };
    el.classList.add('dragging');
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onTouchDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }
  function startResize(pointerEvt, el) {
    const occKey = el.dataset.occ;
    const startHeight = parseFloat(el.style.height);
    const startY = pointerEvt.clientY;
    dragState = { type: 'resize', occKey, el, startHeight, startY, moved: false };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onTouchDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }
  function onTouchDragMove(e) { e.preventDefault(); onDragMove(e.touches[0]); }
  function onDragMove(e) {
    if (!dragState) return;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dy) > 4) dragState.moved = true;
    const snap = 13; // 15 phút = 13px (52px/giờ /4)
    if (dragState.type === 'move') {
      const snapped = Math.round((dragState.startTop + dy) / snap) * snap;
      dragState.el.style.top = Math.max(0, snapped) + 'px';
    } else {
      const snapped = Math.round((dragState.startHeight + dy) / snap) * snap;
      dragState.el.style.height = Math.max(20, snapped) + 'px';
    }
  }
  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onTouchDragMove);
    document.removeEventListener('touchend', onDragEnd);
    if (!dragState) return;
    const ds = dragState;
    ds.el.classList.remove('dragging');
    if (ds.moved) {
      if (ds.type === 'move') {
        const newTop = parseFloat(ds.el.style.top);
        const newStartMin = DAY_START_HOUR * 60 + Math.round(newTop / 52 * 60 / 5) * 5;
        const occ = findOccByKey(ds.occKey);
        if (occ) {
          const dur = D.timeToMin(occ.endTime) - D.timeToMin(occ.startTime);
          applyOccurrenceEdit(ds.occKey, { startTime: D.minToTime(newStartMin), endTime: D.minToTime(newStartMin + dur) });
        }
      } else {
        const newHeight = parseFloat(ds.el.style.height);
        const occ = findOccByKey(ds.occKey);
        if (occ) {
          const startMin = D.timeToMin(occ.startTime);
          const durMin = Math.max(15, Math.round(newHeight / 52 * 60 / 5) * 5);
          applyOccurrenceEdit(ds.occKey, { endTime: D.minToTime(startMin + durMin) });
        }
      }
    }
    setTimeout(() => { dragState = null; }, 30);
  }

  function findOccByKey(occKey) {
    const [eventId, dateKey] = occKey.split('::');
    const ev = Store.getById(eventId);
    if (!ev) return null;
    const list = Recur.expand(ev, dateKey, dateKey);
    return list[0] || null;
  }

  // Áp dụng thay đổi giờ (move/resize) cho 1 occurrence — nếu event lặp lại,
  // tạo exception riêng cho ngày đó; nếu không lặp, sửa trực tiếp trên event.
  function applyOccurrenceEdit(occKey, patch) {
    const [eventId, dateKey] = occKey.split('::');
    const ev = Store.getById(eventId);
    if (!ev) return;
    if (!ev.repeat || ev.repeat.freq === 'none') {
      Store.update(eventId, patch);
    } else {
      ev.exceptions = ev.exceptions || {};
      ev.exceptions[dateKey] = Object.assign({}, ev.exceptions[dateKey], patch);
      Store.save();
    }
    renderView();
    refreshDashboardWidgets();
    toast('success', 'Đã cập nhật', 'Thời gian kế hoạch đã được thay đổi');
  }

  function moveOccurrenceToDate(occKey, newDateKey) {
    const [eventId, oldDateKey] = occKey.split('::');
    const ev = Store.getById(eventId);
    if (!ev || oldDateKey === newDateKey) return;
    if (!ev.repeat || ev.repeat.freq === 'none') {
      Store.update(eventId, { date: newDateKey });
    } else {
      ev.exceptions = ev.exceptions || {};
      ev.exceptions[oldDateKey] = Object.assign({}, ev.exceptions[oldDateKey], { date: newDateKey });
      Store.save();
    }
    renderView();
    refreshDashboardWidgets();
    toast('success', 'Đã dời lịch', 'Kế hoạch đã được chuyển sang ngày mới');
  }

  function toggleComplete(occKey) {
    const occ = findOccByKey(occKey);
    if (!occ) return;
    const [eventId, dateKey] = occKey.split('::');
    const ev = Store.getById(eventId);
    const newCompleted = !occ.completed;
    const patch = { completed: newCompleted, progress: newCompleted ? 100 : occ.progress };
    if (!ev.repeat || ev.repeat.freq === 'none') {
      Store.update(eventId, patch);
    } else {
      ev.exceptions = ev.exceptions || {};
      ev.exceptions[dateKey] = Object.assign({}, ev.exceptions[dateKey], patch);
      Store.save();
    }
    renderView();
    refreshDashboardWidgets();
  }

  /* ============================================================================
     10. POPOVER CHI TIẾT
     ========================================================================== */
  function showPopover(occKey, x, y) {
    const occ = findOccByKey(occKey);
    if (!occ) return;
    const pop = document.getElementById('schPopover');
    const meta = TYPE_META[occ.event.type] || TYPE_META.other;
    const canOpen = Integration.canOpen(occ.event);
    pop.innerHTML = `
      <div class="sch-pop-title">${esc(occ.event.title)}</div>
      <div class="sch-pop-meta"><i class="fa-solid fa-clock"></i> ${occ.dateKey.split('-').reverse().join('/')} · ${occ.startTime || ''}${occ.endTime ? ' - ' + occ.endTime : ''}</div>
      <div class="sch-pop-meta"><i class="fa-solid ${meta.icon}"></i> ${meta.label}${occ.progress ? ` · Tiến độ ${occ.progress}%` : ''}</div>
      ${occ.event.description ? `<div class="sch-pop-meta"><i class="fa-solid fa-align-left"></i> ${esc(occ.event.description)}</div>` : ''}
      <div class="sch-pop-actions">
        ${canOpen ? `<button class="btn btn-primary btn-sm" data-act="open"><i class="fa-solid fa-play"></i> Mở</button>` : ''}
        <button class="btn btn-outline btn-sm" data-act="edit"><i class="fa-solid fa-pen"></i> Sửa</button>
        <button class="btn btn-ghost btn-sm" data-act="done"><i class="fa-solid fa-check"></i> ${occ.completed ? 'Bỏ hoàn thành' : 'Hoàn thành'}</button>
      </div>`;
    pop.style.display = 'block';
    const rect = pop.getBoundingClientRect();
    let left = x, top = y;
    if (left + 290 > window.innerWidth) left = window.innerWidth - 300;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    pop.style.left = Math.max(10, left) + 'px';
    pop.style.top = Math.max(10, top) + 'px';

    pop.querySelector('[data-act="edit"]').addEventListener('click', () => { hidePopover(); openEditModal(occKey); });
    pop.querySelector('[data-act="done"]').addEventListener('click', () => { hidePopover(); toggleComplete(occKey); });
    const openBtn = pop.querySelector('[data-act="open"]');
    if (openBtn) openBtn.addEventListener('click', () => { hidePopover(); Integration.open(occ.event); });

    setTimeout(() => document.addEventListener('click', hidePopoverOnce), 10);
  }
  function hidePopoverOnce(e) {
    const pop = document.getElementById('schPopover');
    if (pop && !pop.contains(e.target)) hidePopover();
  }
  function hidePopover() {
    const pop = document.getElementById('schPopover');
    if (pop) pop.style.display = 'none';
    document.removeEventListener('click', hidePopoverOnce);
  }

  /* ============================================================================
     11. CONTEXT MENU (chuột phải) — Edit / Duplicate / Delete / Complete
     ========================================================================== */
  function showContextMenu(occKey, x, y) {
    const occ = findOccByKey(occKey);
    if (!occ) return;
    const menu = document.getElementById('schCtxMenu');
    menu.innerHTML = `
      <button data-act="edit"><i class="fa-solid fa-pen"></i> Sửa</button>
      <button data-act="dup"><i class="fa-solid fa-copy"></i> Nhân bản</button>
      <button data-act="done"><i class="fa-solid fa-check"></i> ${occ.completed ? 'Bỏ hoàn thành' : 'Hoàn thành'}</button>
      <hr>
      <button data-act="del" class="danger"><i class="fa-solid fa-trash"></i> Xóa</button>`;
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 10) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 10) + 'px';

    menu.querySelector('[data-act="edit"]').addEventListener('click', () => { hideContextMenu(); openEditModal(occKey); });
    menu.querySelector('[data-act="dup"]').addEventListener('click', () => {
      hideContextMenu();
      const [eventId] = occKey.split('::');
      Store.duplicate(eventId);
      renderView(); refreshDashboardWidgets();
      toast('success', 'Đã nhân bản', 'Bản sao kế hoạch đã được tạo');
    });
    menu.querySelector('[data-act="done"]').addEventListener('click', () => { hideContextMenu(); toggleComplete(occKey); });
    menu.querySelector('[data-act="del"]').addEventListener('click', () => {
      hideContextMenu();
      const [eventId] = occKey.split('::');
      confirmDialog('Xóa kế hoạch?', 'Hành động này không thể hoàn tác.', () => {
        Store.remove(eventId);
        renderView(); refreshDashboardWidgets();
        toast('success', 'Đã xóa', 'Kế hoạch đã được xóa');
      });
    });
    setTimeout(() => document.addEventListener('click', hideCtxOnce), 10);
  }
  function hideCtxOnce(e) {
    const menu = document.getElementById('schCtxMenu');
    if (menu && !menu.contains(e.target)) hideContextMenu();
  }
  function hideContextMenu() {
    const menu = document.getElementById('schCtxMenu');
    if (menu) menu.style.display = 'none';
    document.removeEventListener('click', hideCtxOnce);
  }

  /* ============================================================================
     12. MODAL THÊM / SỬA KẾ HOẠCH
     ========================================================================== */
  let modalMode = 'add'; // add | edit
  let modalEditOccKey = null;

  function refreshPartSelect() {
    const sel = document.getElementById('schFieldPartSelect');
    if (!sel) return;
    let meta = [];
    try { if (window.QuestionManager && QuestionManager.allPartsMeta) meta = QuestionManager.allPartsMeta(); } catch (e) {}
    if (!meta.length) {
      sel.innerHTML = `<option value="">(Chưa có dữ liệu phần)</option>`;
      return;
    }
    sel.innerHTML = meta.map(p => `<option value="${p.index + 1}">${esc(p.name)} (${p.count} câu)</option>`).join('');
  }

  function toggleTypeDependentFields() {
    const type = document.getElementById('schFieldType').value;
    const isPart = type === 'part';
    document.getElementById('schPartRow').style.display = isPart ? 'grid' : 'none';
    document.getElementById('schProgressRowAlone').style.display = isPart ? 'none' : 'grid';
    document.getElementById('schReminderRowWithPart').style.display = isPart ? 'grid' : 'none';
    if (isPart) refreshPartSelect();
  }

  function toggleRepeatFields() {
    const freq = document.getElementById('schFieldRepeat').value;
    document.getElementById('schRepeatUntilField').style.display = (freq !== 'none') ? 'block' : 'none';
    document.getElementById('schByDayField').style.display = (freq === 'weekly' || freq === 'custom') ? 'block' : 'none';
  }

  function resetModalForm() {
    document.getElementById('schFieldId').value = '';
    document.getElementById('schFieldTitle').value = '';
    document.getElementById('schFieldDesc').value = '';
    document.getElementById('schFieldDate').value = D.todayKey();
    document.getElementById('schFieldType').value = 'part';
    document.getElementById('schFieldStart').value = '08:00';
    document.getElementById('schFieldEnd').value = '09:00';
    document.getElementById('schFieldProgress').value = 0;
    document.getElementById('schFieldProgressAlone').value = 0;
    document.getElementById('schFieldReminder').value = '10';
    document.getElementById('schFieldReminder2').value = '10';
    document.getElementById('schFieldRepeat').value = 'none';
    document.getElementById('schFieldUntil').value = '';
    document.getElementById('schFieldDeadline').checked = false;
    document.getElementById('schFieldDeadline2').checked = false;
    document.getElementById('schFieldCompleted').checked = false;
    document.querySelectorAll('#schByDayChips .filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.sch-color-swatch').forEach((c, i) => c.classList.toggle('active', i === 0));
    document.querySelectorAll('#schPriorityRow button').forEach(b => {
      const active = b.dataset.p === 'medium';
      b.classList.toggle('active', active);
      b.style.background = active ? PRIORITY_META[b.dataset.p].color : '';
    });
    document.getElementById('schDeleteBtn').style.display = 'none';
    toggleTypeDependentFields();
    toggleRepeatFields();
  }

  function openAddModal(defaults) {
    modalMode = 'add'; modalEditOccKey = null;
    resetModalForm();
    if (defaults) {
      if (defaults.date) document.getElementById('schFieldDate').value = defaults.date;
      if (defaults.startTime) document.getElementById('schFieldStart').value = defaults.startTime;
      if (defaults.endTime) document.getElementById('schFieldEnd').value = defaults.endTime;
    }
    document.getElementById('schModalTitle').innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Thêm kế hoạch';
    document.getElementById('schEventModal').classList.add('show');
    document.getElementById('schFieldTitle').focus();
  }

  function openEditModal(occKey) {
    const occ = findOccByKey(occKey);
    if (!occ) return;
    modalMode = 'edit'; modalEditOccKey = occKey;
    resetModalForm();
    const ev = occ.event;
    document.getElementById('schFieldId').value = ev.id;
    document.getElementById('schFieldTitle').value = ev.title;
    document.getElementById('schFieldDesc').value = ev.description || '';
    document.getElementById('schFieldDate').value = occ.dateKey;
    document.getElementById('schFieldType').value = ev.type;
    document.getElementById('schFieldStart').value = occ.startTime || '08:00';
    document.getElementById('schFieldEnd').value = occ.endTime || '09:00';
    document.getElementById('schFieldProgress').value = occ.progress || 0;
    document.getElementById('schFieldProgressAlone').value = occ.progress || 0;
    document.getElementById('schFieldReminder').value = String(ev.reminder || 0);
    document.getElementById('schFieldReminder2').value = String(ev.reminder || 0);
    document.getElementById('schFieldRepeat').value = (ev.repeat && ev.repeat.freq) || 'none';
    document.getElementById('schFieldUntil').value = (ev.repeat && ev.repeat.until) || '';
    document.getElementById('schFieldDeadline').checked = !!ev.deadline;
    document.getElementById('schFieldDeadline2').checked = !!ev.deadline;
    document.getElementById('schFieldCompleted').checked = !!occ.completed;
    if (ev.repeat && ev.repeat.byDay) {
      document.querySelectorAll('#schByDayChips .filter-chip').forEach(c => {
        c.classList.toggle('active', ev.repeat.byDay.includes(parseInt(c.dataset.wd, 10)));
      });
    }
    if (ev.partNumber) document.getElementById('schFieldPartSelect').value = String(ev.partNumber);
    const color = ev.color || (TYPE_META[ev.type] || TYPE_META.other).color;
    document.querySelectorAll('.sch-color-swatch').forEach(c => c.classList.toggle('active', c.dataset.color === color));
    document.querySelectorAll('#schPriorityRow button').forEach(b => {
      const active = b.dataset.p === (ev.priority || 'medium');
      b.classList.toggle('active', active);
      b.style.background = active ? PRIORITY_META[b.dataset.p].color : '';
    });
    toggleTypeDependentFields();
    toggleRepeatFields();
    document.getElementById('schModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Sửa kế hoạch';
    document.getElementById('schDeleteBtn').style.display = 'inline-flex';
    document.getElementById('schEventModal').classList.add('show');
  }

  function closeModal() { document.getElementById('schEventModal').classList.remove('show'); }

  function collectFormData() {
    const type = document.getElementById('schFieldType').value;
    const title = document.getElementById('schFieldTitle').value.trim();
    const date = document.getElementById('schFieldDate').value;
    const startTime = document.getElementById('schFieldStart').value;
    const endTime = document.getElementById('schFieldEnd').value;
    const activeColor = document.querySelector('.sch-color-swatch.active');
    const activePriority = document.querySelector('#schPriorityRow button.active');
    const repeatFreq = document.getElementById('schFieldRepeat').value;
    const byDay = Array.from(document.querySelectorAll('#schByDayChips .filter-chip.active')).map(c => parseInt(c.dataset.wd, 10));
    const isPart = type === 'part';
    const progress = Math.max(0, Math.min(100, parseInt(isPart ? document.getElementById('schFieldProgress').value : document.getElementById('schFieldProgressAlone').value, 10) || 0));
    const reminder = parseInt(isPart ? document.getElementById('schFieldReminder2').value : document.getElementById('schFieldReminder').value, 10) || 0;
    const deadline = isPart ? document.getElementById('schFieldDeadline2').checked : document.getElementById('schFieldDeadline').checked;
    const partNumber = isPart ? parseInt(document.getElementById('schFieldPartSelect').value, 10) || null : null;

    if (!title) { toast('warn', 'Thiếu tên kế hoạch', 'Vui lòng nhập tên kế hoạch'); return null; }
    if (!date) { toast('warn', 'Thiếu ngày', 'Vui lòng chọn ngày'); return null; }
    if (D.timeToMin(endTime) <= D.timeToMin(startTime)) { toast('warn', 'Giờ không hợp lệ', 'Giờ kết thúc phải sau giờ bắt đầu'); return null; }

    return {
      title, description: document.getElementById('schFieldDesc').value.trim(),
      date, startTime, endTime, type,
      partNumber: partNumber || Integration.parsePartNumber(title),
      color: activeColor ? activeColor.dataset.color : null,
      priority: activePriority ? activePriority.dataset.p : 'medium',
      repeat: { freq: repeatFreq, interval: 1, until: document.getElementById('schFieldUntil').value || null, byDay },
      deadline, reminder, progress,
      completed: document.getElementById('schFieldCompleted').checked
    };
  }

  function saveModal() {
    const payload = collectFormData();
    if (!payload) return;
    if (modalMode === 'add') {
      const ev = Object.assign({ id: genId(), exceptions: {}, createdAt: Date.now(), updatedAt: Date.now() }, payload);
      Store.add(ev);
      toast('success', 'Đã thêm kế hoạch', ev.title);
    } else {
      const eventId = document.getElementById('schFieldId').value;
      const ev = Store.getById(eventId);
      if (ev) {
        const oldDateKey = modalEditOccKey.split('::')[1];
        // Nếu người dùng đổi ngày/giờ của 1 occurrence thuộc chuỗi lặp, và không đổi
        // các thuộc tính khác của chuỗi (loại/màu/ưu tiên...), ta vẫn cập nhật cả
        // chuỗi gốc để đơn giản & nhất quán với kỳ vọng "sửa" thông thường.
        Store.update(eventId, payload);
        if (payload.date !== oldDateKey && ev.exceptions && ev.exceptions[oldDateKey]) {
          delete ev.exceptions[oldDateKey];
          Store.save();
        }
      }
      toast('success', 'Đã cập nhật', payload.title);
    }
    closeModal();
    renderView();
    refreshDashboardWidgets();
  }

  function deleteFromModal() {
    const eventId = document.getElementById('schFieldId').value;
    if (!eventId) return;
    confirmDialog('Xóa kế hoạch?', 'Toàn bộ chuỗi lặp lại (nếu có) sẽ bị xóa. Hành động này không thể hoàn tác.', () => {
      Store.remove(eventId);
      closeModal();
      renderView();
      refreshDashboardWidgets();
      toast('success', 'Đã xóa', 'Kế hoạch đã được xóa');
    });
  }

  /* ============================================================================
     13. DASHBOARD WIDGETS — "Hôm nay" + "Upcoming"
     ========================================================================== */
  function refreshDashboardWidgets() {
    const todayEl = document.getElementById('schWidgetToday');
    const upEl = document.getElementById('schWidgetUpcoming');
    if (!todayEl || !upEl) return;
    const todayKey = D.todayKey();
    const todayOccs = Recur.expandAll(todayKey, todayKey).sort((a, b) => D.keyCompare(a.startTime || '', b.startTime || ''));
    todayEl.innerHTML = todayOccs.length ? todayOccs.map(o => widgetItemHtml(o)).join('') :
      `<div class="empty-state" style="padding:20px 10px;"><i class="fa-regular fa-calendar" style="font-size:26px;"></i><p style="font-size:12px;">Không có kế hoạch nào hôm nay</p></div>`;

    const endKey = D.toKey(D.addDays(new Date(), 7));
    const upcoming = Recur.expandAll(D.toKey(D.addDays(new Date(), 1)), endKey);
    upEl.innerHTML = upcoming.length ? upcoming.slice(0, 30).map(o => widgetItemHtml(o, true)).join('') :
      `<div class="empty-state" style="padding:20px 10px;"><i class="fa-regular fa-calendar-plus" style="font-size:26px;"></i><p style="font-size:12px;">Chưa có kế hoạch sắp tới</p></div>`;

    todayEl.querySelectorAll('[data-widget-occ]').forEach(el => {
      el.addEventListener('click', () => openEditModal(el.dataset.widgetOcc));
    });
    upEl.querySelectorAll('[data-widget-occ]').forEach(el => {
      el.addEventListener('click', () => openEditModal(el.dataset.widgetOcc));
    });
  }
  function widgetItemHtml(o, showDate) {
    const meta = TYPE_META[o.event.type] || TYPE_META.other;
    const color = o.event.color || meta.color;
    const d = D.fromKey(o.dateKey);
    return `<div class="sch-widget-item" data-widget-occ="${o.occKey}" style="cursor:pointer;">
      <div class="sch-widget-time">${showDate ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) : (o.startTime || '')}</div>
      <div class="sch-widget-dot" style="background:${color};"></div>
      <b>${esc(o.event.title)}</b>
      <span>${showDate ? (o.startTime || '') : ''}</span>
    </div>`;
  }

  /* ============================================================================
     14. THÔNG BÁO NHẮC NHỞ (reminder) — kiểm tra định kỳ + âm thanh WebAudio
     ========================================================================== */
  function beep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      [0, 0.18].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.32);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.35);
      });
    } catch (e) { /* AudioContext không khả dụng — bỏ qua âm thanh */ }
  }

  function showNotifyPopup(occ) {
    const wrap = document.createElement('div');
    wrap.className = 'sch-notify';
    const meta = TYPE_META[occ.event.type] || TYPE_META.other;
    wrap.innerHTML = `
      <div class="sch-notify-head"><i class="fa-solid fa-bell"></i> Sắp đến giờ học!</div>
      <p><b>${esc(occ.event.title)}</b><br>${meta.label} · ${occ.startTime} - ${occ.endTime}</p>
      <div class="sch-notify-actions">
        <button class="btn btn-primary btn-sm" id="schNotifyGoBtn"><i class="fa-solid fa-play"></i> Bắt đầu học ngay</button>
        <button class="btn btn-outline btn-sm" id="schNotifyCloseBtn">Đóng</button>
      </div>`;
    document.body.appendChild(wrap);
    beep();
    wrap.querySelector('#schNotifyCloseBtn').addEventListener('click', () => wrap.remove());
    wrap.querySelector('#schNotifyGoBtn').addEventListener('click', () => {
      wrap.remove();
      if (!Integration.open(occ.event)) { UIManager.navigate('schedule'); openEditModal(occ.occKey); }
    });
    setTimeout(() => { if (document.body.contains(wrap)) wrap.remove(); }, 45000);
  }

  function checkReminders() {
    const now = new Date();
    const todayKey = D.toKey(now);
    const tomorrowKey = D.toKey(D.addDays(now, 1));
    const occs = Recur.expandAll(todayKey, tomorrowKey);
    const nowMs = now.getTime();
    occs.forEach(o => {
      const ev = o.event;
      if (!ev.reminder || o.completed) return;
      const dt = D.fromKey(o.dateKey);
      const [h, m] = (o.startTime || '00:00').split(':').map(Number);
      dt.setHours(h, m, 0, 0);
      const triggerMs = dt.getTime() - ev.reminder * 60000;
      if (nowMs >= triggerMs && nowMs <= dt.getTime() + 60000) {
        const notifyKey = o.occKey + '@' + todayKey;
        if (!Store.isNotified(notifyKey)) {
          Store.markNotified(notifyKey);
          showNotifyPopup(o);
        }
      }
    });
  }

  /* ============================================================================
     15. EXPORT / IMPORT — JSON, CSV, ICS, Excel (SheetJS đã có sẵn trong index)
     ========================================================================== */
  function toFlatRows() {
    const occs = Recur.expandAll(D.toKey(D.addYears(new Date(), -1)), D.toKey(D.addYears(new Date(), 2)));
    return occs.map(o => ({
      'Tên kế hoạch': o.event.title, 'Ngày': o.dateKey, 'Bắt đầu': o.startTime, 'Kết thúc': o.endTime,
      'Loại học': (TYPE_META[o.event.type] || TYPE_META.other).label, 'Ưu tiên': (PRIORITY_META[o.event.priority] || {}).label || '',
      'Hoàn thành': o.completed ? 'Có' : 'Không', 'Tiến độ (%)': o.progress || 0, 'Mô tả': o.event.description || ''
    }));
  }
  function exportJSON() { downloadFile('ke-hoach-hoc.json', JSON.stringify(Store.data, null, 2), 'application/json'); toast('success', 'Đã xuất JSON', 'ke-hoach-hoc.json'); }
  function exportCSV() {
    const rows = toFlatRows();
    if (!rows.length) { toast('warn', 'Không có dữ liệu', 'Chưa có kế hoạch nào để xuất'); return; }
    const headers = Object.keys(rows[0]);
    const csvEsc = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvEsc(r[h])).join(','))].join('\n');
    downloadFile('ke-hoach-hoc.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast('success', 'Đã xuất CSV', 'ke-hoach-hoc.csv');
  }
  function exportExcel() {
    if (typeof XLSX === 'undefined') { toast('error', 'Thiếu thư viện', 'SheetJS (XLSX) chưa được nạp'); return; }
    const rows = toFlatRows();
    if (!rows.length) { toast('warn', 'Không có dữ liệu', 'Chưa có kế hoạch nào để xuất'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'KeHoachHoc');
    XLSX.writeFile(wb, 'ke-hoach-hoc.xlsx');
    toast('success', 'Đã xuất Excel', 'ke-hoach-hoc.xlsx');
  }
  function exportICS() {
    const occs = Recur.expandAll(D.toKey(D.addYears(new Date(), -1)), D.toKey(D.addYears(new Date(), 2)));
    if (!occs.length) { toast('warn', 'Không có dữ liệu', 'Chưa có kế hoạch nào để xuất'); return; }
    const pad = n => String(n).padStart(2, '0');
    const toIcsDt = (dateKey, time) => {
      const [y, mo, d] = dateKey.split('-'); const [h, mi] = (time || '00:00').split(':');
      return `${y}${mo}${d}T${pad(h)}${pad(mi)}00`;
    };
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//KeHoachHoc//Schedule//VI\r\n';
    occs.forEach(o => {
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${o.occKey}@kehoachhoc\r\n`;
      ics += `DTSTAMP:${toIcsDt(D.toKey(new Date()), '00:00')}Z\r\n`;
      ics += `DTSTART:${toIcsDt(o.dateKey, o.startTime)}\r\n`;
      ics += `DTEND:${toIcsDt(o.dateKey, o.endTime)}\r\n`;
      ics += `SUMMARY:${(o.event.title || '').replace(/\r?\n/g, ' ')}\r\n`;
      if (o.event.description) ics += `DESCRIPTION:${o.event.description.replace(/\r?\n/g, '\\n')}\r\n`;
      ics += 'END:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR\r\n';
    downloadFile('ke-hoach-hoc.ics', ics, 'text/calendar;charset=utf-8');
    toast('success', 'Đã xuất ICS', 'ke-hoach-hoc.ics — có thể nhập vào Google Calendar/Outlook');
  }
  function openExportMenu() {
    const menu = document.getElementById('schCtxMenu');
    menu.innerHTML = `
      <button data-x="json"><i class="fa-solid fa-file-code"></i> Xuất JSON</button>
      <button data-x="csv"><i class="fa-solid fa-file-csv"></i> Xuất CSV</button>
      <button data-x="xlsx"><i class="fa-solid fa-file-excel"></i> Xuất Excel</button>
      <button data-x="ics"><i class="fa-solid fa-calendar"></i> Xuất ICS</button>`;
    const btn = document.getElementById('schExportBtn');
    const rect = btn.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.querySelector('[data-x="json"]').addEventListener('click', () => { hideContextMenu(); exportJSON(); });
    menu.querySelector('[data-x="csv"]').addEventListener('click', () => { hideContextMenu(); exportCSV(); });
    menu.querySelector('[data-x="xlsx"]').addEventListener('click', () => { hideContextMenu(); exportExcel(); });
    menu.querySelector('[data-x="ics"]').addEventListener('click', () => { hideContextMenu(); exportICS(); });
    setTimeout(() => document.addEventListener('click', hideCtxOnce), 10);
  }
  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        const events = Array.isArray(parsed) ? parsed : (parsed.events || []);
        if (!Array.isArray(events)) throw new Error('Định dạng file không hợp lệ');
        let added = 0;
        events.forEach(ev => {
          if (!ev || !ev.title || !ev.date) return;
          const exists = Store.getById(ev.id);
          if (exists) { Store.update(ev.id, ev); }
          else { Store.add(Object.assign({ id: ev.id || genId(), exceptions: {}, createdAt: Date.now(), updatedAt: Date.now() }, ev)); }
          added++;
        });
        renderView(); refreshDashboardWidgets();
        toast('success', 'Đã nhập dữ liệu', `${added} kế hoạch đã được nhập`);
      } catch (err) {
        toast('error', 'Lỗi nhập dữ liệu', err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ============================================================================
     16. THỐNG KÊ + HEATMAP 365 NGÀY
     ========================================================================== */
  function renderStats() {
    const horizon = { start: D.toKey(D.addYears(new Date(), -2)), end: D.toKey(D.addDays(new Date(), 1)) };
    const occs = Recur.expandAll(horizon.start, horizon.end);
    const total = occs.length;
    const done = occs.filter(o => o.completed).length;
    const pending = total - done;
    let totalMinutes = 0;
    occs.filter(o => o.completed).forEach(o => { totalMinutes += Math.max(0, D.timeToMin(o.endTime) - D.timeToMin(o.startTime)); });
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

    // streak: số ngày liên tục (tính đến hôm nay) có ít nhất 1 occurrence hoàn thành
    const doneDates = new Set(occs.filter(o => o.completed).map(o => o.dateKey));
    let streak = 0; let cursor = new Date();
    while (doneDates.has(D.toKey(cursor))) { streak++; cursor = D.addDays(cursor, -1); }

    const grid = document.getElementById('schStatsGrid');
    const cards = [
      { icon: 'fa-list-check', color: 'linear-gradient(135deg,#1478d4,#22d3ee)', val: total, label: 'Tổng số kế hoạch' },
      { icon: 'fa-circle-check', color: 'linear-gradient(135deg,#16c784,#0e9d68)', val: done, label: 'Đã hoàn thành' },
      { icon: 'fa-circle-xmark', color: 'linear-gradient(135deg,#ef4444,#dc2626)', val: pending, label: 'Chưa hoàn thành' },
      { icon: 'fa-clock', color: 'linear-gradient(135deg,#0d5fb3,#3b96e8)', val: `${totalHours}h`, label: 'Tổng số giờ học' },
      { icon: 'fa-fire', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)', val: `${streak} ngày`, label: 'Chuỗi học liên tục' }
    ];
    grid.innerHTML = cards.map(c => `<div class="card stat-card"><div class="stat-top"><div class="stat-icon" style="background:${c.color}"><i class="fa-solid ${c.icon}"></i></div></div><div class="stat-val">${c.val}</div><div class="stat-label">${c.label}</div></div>`).join('');

    // heatmap 365 ngày
    const countByDate = {};
    occs.filter(o => o.completed).forEach(o => { countByDate[o.dateKey] = (countByDate[o.dateKey] || 0) + 1; });
    const cells = [];
    for (let i = 364; i >= 0; i--) {
      const d = D.addDays(new Date(), -i);
      const key = D.toKey(d);
      const c = countByDate[key] || 0;
      let bg = 'rgba(20,120,212,.10)';
      if (c > 4) bg = 'rgba(20,120,212,.9)';
      else if (c > 2) bg = 'rgba(20,120,212,.6)';
      else if (c > 0) bg = 'rgba(20,120,212,.35)';
      cells.push(`<div class="heatmap-cell" style="background:${bg}" data-tip="${key}: ${c} kế hoạch hoàn thành"></div>`);
    }
    document.getElementById('schHeatmap').innerHTML = cells.join('');
  }

  /* ============================================================================
     17. WIRE SỰ KIỆN CHUNG (header, filter, search, modal, dark mode sync...)
     ========================================================================== */
  let wired = false;
  function wireEvents() {
    if (wired) return; wired = true;

    document.getElementById('schTodayBtn').addEventListener('click', () => { State.cursor = new Date(); renderView(); });
    document.getElementById('schPrevBtn').addEventListener('click', () => { shiftCursor(-1); renderView(); });
    document.getElementById('schNextBtn').addEventListener('click', () => { shiftCursor(1); renderView(); });
    document.getElementById('schAddBtn').addEventListener('click', () => openAddModal({ date: D.toKey(State.cursor) }));

    document.querySelectorAll('#schViewSwitch button').forEach(btn => {
      btn.addEventListener('click', () => {
        State.view = btn.dataset.v;
        syncViewSwitchUI();
        renderView();
      });
    });

    let searchTimer = null;
    document.getElementById('schSearchInput').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { State.search = e.target.value.trim(); renderView(); }, 200);
    });
    document.getElementById('schFilterType').addEventListener('change', e => { State.filterType = e.target.value; renderView(); });
    document.getElementById('schFilterPriority').addEventListener('change', e => { State.filterPriority = e.target.value; renderView(); });
    document.getElementById('schFilterStatus').addEventListener('change', e => { State.filterStatus = e.target.value; renderView(); });

    document.getElementById('schExportBtn').addEventListener('click', openExportMenu);
    document.getElementById('schImportBtn').addEventListener('click', () => document.getElementById('schImportFile').click());
    document.getElementById('schImportFile').addEventListener('change', e => { if (e.target.files[0]) importJSONFile(e.target.files[0]); e.target.value = ''; });

    document.getElementById('schStatsBtn').addEventListener('click', () => {
      const panel = document.getElementById('schStatsPanel');
      const show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      if (show) renderStats();
    });

    // modal
    document.getElementById('schModalCloseX').addEventListener('click', closeModal);
    document.getElementById('schCancelBtn').addEventListener('click', closeModal);
    document.getElementById('schSaveBtn').addEventListener('click', saveModal);
    document.getElementById('schDeleteBtn').addEventListener('click', deleteFromModal);
    document.getElementById('schEventModal').addEventListener('click', e => { if (e.target.id === 'schEventModal') closeModal(); });
    document.getElementById('schFieldType').addEventListener('change', toggleTypeDependentFields);
    document.getElementById('schFieldRepeat').addEventListener('change', toggleRepeatFields);
    document.getElementById('schFieldTitle').addEventListener('input', e => {
      if (document.getElementById('schFieldType').value === 'part') {
        const n = Integration.parsePartNumber(e.target.value);
        if (n) {
          const sel = document.getElementById('schFieldPartSelect');
          if (sel.querySelector(`option[value="${n}"]`)) sel.value = String(n);
        }
      }
    });
    document.querySelectorAll('.sch-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => { document.querySelectorAll('.sch-color-swatch').forEach(c => c.classList.remove('active')); sw.classList.add('active'); });
    });
    document.querySelectorAll('#schPriorityRow button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#schPriorityRow button').forEach(b => { b.classList.remove('active'); b.style.background = ''; });
        btn.classList.add('active'); btn.style.background = PRIORITY_META[btn.dataset.p].color;
      });
    });
    document.querySelectorAll('#schByDayChips .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => chip.classList.toggle('active'));
    });

    // ESC đóng modal/popover/context-menu
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeModal(); hidePopover(); hideContextMenu();
    });

    // đồng bộ dark mode ngay lập tức khi data-theme đổi (không cần reload)
    const observer = new MutationObserver(() => { /* các block dùng biến CSS nên tự đổi màu; chỉ cần re-render nếu đang mở để cập nhật viền/inline style tĩnh */ });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function shiftCursor(dir) {
    if (State.view === 'month') State.cursor = D.addMonths(State.cursor, dir);
    else if (State.view === 'week') State.cursor = D.addDays(State.cursor, dir * 7);
    else if (State.view === 'day') State.cursor = D.addDays(State.cursor, dir);
    else State.cursor = D.addDays(State.cursor, dir * 30);
  }
  function syncViewSwitchUI() {
    document.querySelectorAll('#schViewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.v === State.view));
  }

  /* ============================================================================
     18. HOOK VÀO VÒNG ĐỜI CÓ SẴN — chỉ wrap thêm, không sửa hàm gốc
     ========================================================================== */
  function hookIntoApp() {
    if (window.UIManager && !UIManager.titles.schedule) {
      UIManager.titles.schedule = ['Kế hoạch học', 'Lên lịch ôn tập theo tuần/tháng, đồng bộ trực tiếp với hệ thống ôn thi'];
    }
    if (window.UIManager && typeof UIManager.navigate === 'function' && !UIManager.__scheduleWrapped) {
      const orig = UIManager.navigate.bind(UIManager);
      UIManager.navigate = function (view) {
        const result = orig(view);
        if (view === 'schedule') { syncViewSwitchUI(); renderView(); }
        return result;
      };
      UIManager.__scheduleWrapped = true;
    }
    if (window.DashboardUI && typeof DashboardUI.render === 'function' && !DashboardUI.__scheduleWrapped) {
      const origRender = DashboardUI.render.bind(DashboardUI);
      DashboardUI.render = function () {
        const result = origRender();
        refreshDashboardWidgets();
        return result;
      };
      DashboardUI.__scheduleWrapped = true;
    }
  }

  /* ============================================================================
     19. INIT
     ========================================================================== */
  function init() {
    Store.load();
    injectCss();
    injectDom();
    wireEvents();
    hookIntoApp();
    refreshDashboardWidgets();
    checkReminders();
    setInterval(checkReminders, 20000);
    // nếu app đã ở sẵn view dashboard lúc script này nạp, đảm bảo widget có dữ liệu
    if (document.getElementById('view-dashboard') && document.getElementById('view-dashboard').classList.contains('active')) {
      refreshDashboardWidgets();
    }
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  boot();

  /* ============================================================================
     20. PUBLIC API — window.Schedule (module pattern, không rò rỉ global khác)
     ========================================================================== */
  window.Schedule = {
    open() { if (window.UIManager) UIManager.navigate('schedule'); },
    addEvent(data) { const ev = Object.assign({ id: genId(), exceptions: {}, createdAt: Date.now(), updatedAt: Date.now(), repeat: { freq: 'none' }, priority: 'medium', reminder: 10, progress: 0, completed: false }, data); Store.add(ev); refreshDashboardWidgets(); return ev; },
    removeEvent(id) { Store.remove(id); refreshDashboardWidgets(); },
    getEvents() { return Store.all(); },
    exportJSON, exportCSV, exportExcel, exportICS,
    refresh() { renderView(); refreshDashboardWidgets(); }
  };

})();
