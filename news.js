/* ============================================================================
   NEWS.JS — MODULE "ĐỌC BÁO"
   ============================================================================
   Tác giả kiến trúc: Senior Software Architect
   Mục đích: Bổ sung module đọc tin tức tài chính/kinh tế vào hệ thống hiện có
   (ASP.NET MVC + trang HTML "Ôn thi đầu vào cao học NEU") mà KHÔNG sửa bất kỳ
   file nào khác ngoài việc thêm 1 dòng:

        <script src="news.js"></script>

   NGUYÊN TẮC THIẾT KẾ
   --------------------
   1) Pure ES6, không dùng framework, không phụ thuộc thư viện ngoài
      (chỉ tận dụng Font Awesome đã có sẵn trong trang cho icon).
   2) File tự làm mọi việc khi được nạp:
        - Tự inject <style> (CSS) vào <head>
        - Tự inject HTML (nav item ở sidebar + section "view-news")
        - Tự bind toàn bộ sự kiện
        - Tự khởi tạo (gọi NewsManager.init() khi DOMContentLoaded)
   3) KHÔNG scrape trực tiếp bất kỳ trang báo nào. Toàn bộ dữ liệu lấy từ
      Backend API (ASP.NET MVC) qua các endpoint GET:
        GET /api/news             (danh sách bài, phân trang, lọc)
        GET /api/news/search       (tìm kiếm realtime)
        GET /api/news/detail       (chi tiết 1 bài — trả về HTML đã xử lý)
        GET /api/news/source       (danh sách nguồn báo)
        GET /api/news/trending     (bài phổ biến / xu hướng)
        GET /api/news/latest       (kiểm tra bài mới — dùng cho realtime)
        GET /api/news/category     (danh sách chuyên mục)
      news.js CHỈ RENDER dữ liệu JSON trả về, không tự ý xử lý/scrape nội dung.
   4) Đồng bộ 100% phong cách giao diện với trang gốc: tái sử dụng các biến
      CSS (--accent, --card-bg, --radius-md, --shadow-md, --text-main, ...),
      tái sử dụng UIManager.toast()/UIManager.confirm() đã có sẵn để đồng nhất
      trải nghiệm thông báo, và tái sử dụng cơ chế UIManager.navigate() bằng
      cách "bọc thêm" (wrap) giống hệt cách course.js/leaderboard.js đã làm,
      không sửa đổi hàm gốc.
   5) Có khả năng mở rộng: danh sách nguồn báo có thể bổ sung tại runtime qua
      NewsManager.addSource({id, name, icon, color}), có thể đổi API_BASE qua
      NewsManager.configure({...}).

   CÁC CLASS CHÍNH (theo mục XIV yêu cầu)
   --------------------------------------
     NewsUtils      : hàm tiện ích thuần (debounce, throttle, format, escape...)
     NewsCache       : Memory Cache + LocalStorage + IndexedDB (offline cache)
     NewsAPI         : gọi API backend, có AbortController + hàng đợi request
     NewsBookmark    : quản lý bookmark & favorite
     NewsHistory     : lịch sử đọc / đọc gần đây
     NewsSearch      : tìm kiếm realtime có debounce + bộ lọc
     NewsReader      : modal đọc bài toàn màn hình (reading progress, font size..)
     NewsRealtime    : polling 30s để phát hiện bài mới (badge NEW + toast)
     NewsUI          : dựng giao diện, virtual list, infinite scroll, skeleton...
     NewsManager     : nhạc trưởng — điều phối toàn bộ, expose API mở rộng
   ============================================================================ */
(function () {
  'use strict';

  // Nếu đã được nạp trước đó (nạp trùng script) thì bỏ qua, tránh khởi tạo 2 lần
  if (window.__NEWS_MODULE_LOADED__) return;
  window.__NEWS_MODULE_LOADED__ = true;

  /* ==========================================================================
     0. CẤU HÌNH TRUNG TÂM
     ========================================================================== */
  const NEWS_CONFIG = {
    // Endpoint backend — CHỈ đọc (GET), không scrape trực tiếp bất kỳ đâu
    ENDPOINTS: {
      list: '/api/news',
      search: '/api/news/search',
      detail: '/api/news/detail',
      source: '/api/news/source',
      trending: '/api/news/trending',
      latest: '/api/news/latest',
      category: '/api/news/category'
    },
    PAGE_SIZE: 20,                 // số bài / trang khi infinite scroll
    POLL_INTERVAL_MS: 30000,       // 30 giây — realtime check bài mới
    SEARCH_DEBOUNCE_MS: 380,       // debounce ô tìm kiếm
    SCROLL_THROTTLE_MS: 120,       // throttle scroll cho virtual list
    RESIZE_THROTTLE_MS: 200,
    MAX_MEMORY_ITEMS: 400,         // giới hạn memory cache (LRU)
    MAX_HISTORY_ITEMS: 300,        // giới hạn lịch sử đọc lưu local
    IDB_NAME: 'NewsOfflineDB',
    IDB_VERSION: 1,
    IDB_STORE_ARTICLES: 'articles',
    IDB_STORE_LISTS: 'listPages',
    ESTIMATED_CARD_HEIGHT: 346,    // px — dùng ước lượng cho virtual list
    ESTIMATED_CARD_MIN_WIDTH: 300, // px — dùng để tính số cột responsive
    CARD_GAP: 18
  };

  // Danh sách nguồn báo mặc định theo yêu cầu mục III — có thể mở rộng runtime
  // qua NewsManager.addSource(). "enabled" mặc định true (đang được lọc hiển thị).
  const DEFAULT_SOURCES = [
    { id: 'vnexpress',          name: 'VNExpress',              icon: 'fa-newspaper',        color: '#e02020' },
    { id: 'cafef',              name: 'CafeF',                   icon: 'fa-chart-line',       color: '#0b5ed7' },
    { id: 'cafebiz',            name: 'CafeBiz',                 icon: 'fa-briefcase',        color: '#f59e0b' },
    { id: 'vneconomy',          name: 'VnEconomy',               icon: 'fa-coins',            color: '#16c784' },
    { id: 'baodautu',           name: 'Báo Đầu Tư',              icon: 'fa-building-columns', color: '#0d5fb3' },
    { id: 'saigontimes',        name: 'The Saigon Times',        icon: 'fa-globe-asia',       color: '#22d3ee' },
    { id: 'vietnamfinance',     name: 'VietnamFinance',          icon: 'fa-sack-dollar',      color: '#8b5cf6' },
    { id: 'vietstock',          name: 'Vietstock',               icon: 'fa-chart-column',     color: '#ef4444' },
    { id: 'stockbiz',           name: 'Stockbiz',                icon: 'fa-arrow-trend-up',   color: '#0ea5e9' },
    { id: 'tinnhanhchungkhoan', name: 'Tin Nhanh Chứng Khoán',   icon: 'fa-bolt',             color: '#f97316' },
    { id: 'kinhtechungkhoan',   name: 'Kinh Tế Chứng Khoán',     icon: 'fa-scale-balanced',   color: '#14b8a6' },
    { id: 'baomoi',             name: 'Báo Mới',                 icon: 'fa-layer-group',      color: '#3b96e8' },
    { id: 'thoibaokinhte',      name: 'Thời Báo Kinh Tế',        icon: 'fa-clock',            color: '#6366f1' }
  ];

  const TIME_RANGES = [
    { id: 'all',   label: 'Tất cả' },
    { id: 'today', label: 'Hôm nay' },
    { id: 'week',  label: '7 ngày qua' },
    { id: 'month', label: '30 ngày qua' }
  ];

  const SORT_OPTIONS = [
    { id: 'latest',     label: 'Mới nhất' },
    { id: 'popular',    label: 'Phổ biến nhất' },
    { id: 'mostread',   label: 'Đọc nhiều nhất' }
  ];

  /* ==========================================================================
     1. NewsUtils — các hàm tiện ích thuần, không phụ thuộc DOM/State
     ========================================================================== */
  class NewsUtilsClass {
    /** Trì hoãn thực thi hàm cho tới khi ngưng gọi trong "wait" ms (dùng cho search) */
    debounce(fn, wait) {
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
      };
    }

    /** Giới hạn tần suất gọi hàm tối đa 1 lần / "wait" ms (dùng cho scroll/resize) */
    throttle(fn, wait) {
      let last = 0, timer = null, lastArgs = null;
      return (...args) => {
        const now = Date.now();
        lastArgs = args;
        if (now - last >= wait) {
          last = now;
          fn.apply(this, lastArgs);
        } else {
          clearTimeout(timer);
          timer = setTimeout(() => { last = Date.now(); fn.apply(this, lastArgs); }, wait - (now - last));
        }
      };
    }

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /** Cắt mô tả ngắn gọn, không cắt giữa từ */
    truncate(str, max) {
      if (!str) return '';
      if (str.length <= max) return str;
      const cut = str.slice(0, max);
      return cut.slice(0, cut.lastIndexOf(' ')) + '…';
    }

    /** Định dạng "x phút trước / x giờ trước / dd/MM/yyyy" */
    timeAgo(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diffSec < 60) return 'Vừa xong';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
      if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} ngày trước`;
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    }

    formatFullDate(isoString) {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())} - ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    }

    /** Ước lượng thời gian đọc nếu backend không trả sẵn (200 từ/phút) */
    estimateReadingTime(text) {
      if (!text) return 1;
      const words = String(text).trim().split(/\s+/).length;
      return Math.max(1, Math.round(words / 200));
    }

    uid() {
      return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    qs(params) {
      const usp = new URLSearchParams();
      Object.keys(params || {}).forEach(k => {
        const v = params[k];
        if (v === undefined || v === null || v === '') return;
        if (Array.isArray(v)) { if (v.length) usp.set(k, v.join(',')); }
        else usp.set(k, v);
      });
      const s = usp.toString();
      return s ? ('?' + s) : '';
    }

    /** Tạo DocumentFragment từ mảng HTML string — hạn chế reflow khi render nhiều card */
    fragmentFromHtml(htmlArray) {
      const frag = document.createDocumentFragment();
      const tmp = document.createElement('div');
      tmp.innerHTML = htmlArray.join('');
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      return frag;
    }
  }
  const NewsUtils = new NewsUtilsClass();

  /* ==========================================================================
     2. NewsCache — 3 tầng cache: Memory (nhanh nhất) → LocalStorage (nhẹ) →
        IndexedDB (offline, dữ liệu nặng như HTML chi tiết bài báo)
     ========================================================================== */
  class NewsCacheClass {
    constructor() {
      this.memory = new Map();      // key -> {data, ts}
      this.memoryOrder = [];        // LRU order
      this.db = null;
      this.dbReady = this._openDb();
    }

    /* ---------- MEMORY CACHE ---------- */
    memGet(key) {
      const hit = this.memory.get(key);
      if (!hit) return null;
      // đưa lên đầu LRU
      this.memoryOrder = this.memoryOrder.filter(k => k !== key);
      this.memoryOrder.push(key);
      return hit.data;
    }
    memSet(key, data) {
      this.memory.set(key, { data, ts: Date.now() });
      this.memoryOrder = this.memoryOrder.filter(k => k !== key);
      this.memoryOrder.push(key);
      while (this.memoryOrder.length > NEWS_CONFIG.MAX_MEMORY_ITEMS) {
        const oldest = this.memoryOrder.shift();
        this.memory.delete(oldest);
      }
    }

    /* ---------- LOCAL STORAGE (nhẹ: bookmark, favorite, setting...) ---------- */
    lsGet(key, fallback) {
      try {
        const raw = localStorage.getItem('news:' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    }
    lsSet(key, value) {
      try { localStorage.setItem('news:' + key, JSON.stringify(value)); }
      catch (e) { /* localStorage đầy hoặc bị chặn — bỏ qua an toàn */ }
    }

    /* ---------- INDEXEDDB (offline cache — bài chi tiết + trang danh sách) ---------- */
    _openDb() {
      return new Promise((resolve) => {
        if (!('indexedDB' in window)) { resolve(null); return; }
        try {
          const req = indexedDB.open(NEWS_CONFIG.IDB_NAME, NEWS_CONFIG.IDB_VERSION);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(NEWS_CONFIG.IDB_STORE_ARTICLES)) {
              db.createObjectStore(NEWS_CONFIG.IDB_STORE_ARTICLES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(NEWS_CONFIG.IDB_STORE_LISTS)) {
              db.createObjectStore(NEWS_CONFIG.IDB_STORE_LISTS, { keyPath: 'key' });
            }
          };
          req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
          req.onerror = () => resolve(null); // Không có IndexedDB thì vẫn chạy được (bỏ qua offline cache)
        } catch (e) { resolve(null); }
      });
    }
    async _store(storeName, mode) {
      const db = await this.dbReady;
      if (!db) return null;
      return db.transaction(storeName, mode).objectStore(storeName);
    }
    async saveArticle(article) {
      const store = await this._store(NEWS_CONFIG.IDB_STORE_ARTICLES, 'readwrite');
      if (!store) return;
      try { store.put({ ...article, _cachedAt: Date.now() }); } catch (e) { /* bỏ qua */ }
    }
    async getArticle(id) {
      const store = await this._store(NEWS_CONFIG.IDB_STORE_ARTICLES, 'readonly');
      if (!store) return null;
      return new Promise(resolve => {
        try {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    async saveListPage(key, items) {
      const store = await this._store(NEWS_CONFIG.IDB_STORE_LISTS, 'readwrite');
      if (!store) return;
      try { store.put({ key, items, _cachedAt: Date.now() }); } catch (e) { /* bỏ qua */ }
    }
    async getListPage(key) {
      const store = await this._store(NEWS_CONFIG.IDB_STORE_LISTS, 'readonly');
      if (!store) return null;
      return new Promise(resolve => {
        try {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
  }
  const NewsCache = new NewsCacheClass();

  /* ==========================================================================
     3. NewsAPI — lớp giao tiếp DUY NHẤT với backend. news.js không tự ý xử lý
        hay scrape bất cứ đâu khác ngoài các endpoint GET được cấu hình.
     ========================================================================== */
  class NewsAPIClass {
    constructor() {
      this.controllers = new Map(); // channel -> AbortController (huỷ request cũ)
    }

    /** Huỷ request đang chạy dở của cùng 1 "channel" (vd: gõ search liên tục) */
    _abortPrev(channel) {
      const prev = this.controllers.get(channel);
      if (prev) prev.abort();
    }

    async _get(endpoint, params, channel) {
      const controller = new AbortController();
      if (channel) { this._abortPrev(channel); this.controllers.set(channel, controller); }
      const url = endpoint + NewsUtils.qs(params);
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('API trả về lỗi HTTP ' + res.status);
        const data = await res.json();
        return data;
      } finally {
        if (channel && this.controllers.get(channel) === controller) this.controllers.delete(channel);
      }
    }

    getList(params) { return this._get(NEWS_CONFIG.ENDPOINTS.list, params, 'list'); }
    search(params) { return this._get(NEWS_CONFIG.ENDPOINTS.search, params, 'search'); }
    getDetail(id) { return this._get(NEWS_CONFIG.ENDPOINTS.detail, { id }, 'detail'); }
    getSources() { return this._get(NEWS_CONFIG.ENDPOINTS.source, {}, 'source'); }
    getTrending(params) { return this._get(NEWS_CONFIG.ENDPOINTS.trending, params, 'trending'); }
    getLatest(params) { return this._get(NEWS_CONFIG.ENDPOINTS.latest, params, 'latest'); }
    getCategories() { return this._get(NEWS_CONFIG.ENDPOINTS.category, {}, 'category'); }
  }
  const NewsAPI = new NewsAPIClass();

  /* ==========================================================================
     4. NewsBookmark — Bookmark & Favorite (lưu localStorage, đồng bộ theo id bài)
     ========================================================================== */
  class NewsBookmarkClass {
    constructor() {
      this.bookmarks = NewsCache.lsGet('bookmarks', {});   // {id: {id,title,source,savedAt}}
      this.favorites = NewsCache.lsGet('favorites', {});
    }
    isBookmarked(id) { return !!this.bookmarks[id]; }
    isFavorite(id) { return !!this.favorites[id]; }
    toggleBookmark(article) {
      if (this.bookmarks[article.id]) delete this.bookmarks[article.id];
      else this.bookmarks[article.id] = { id: article.id, title: article.title, source: article.source, thumbnail: article.thumbnail, savedAt: Date.now() };
      NewsCache.lsSet('bookmarks', this.bookmarks);
      return this.isBookmarked(article.id);
    }
    toggleFavorite(article) {
      if (this.favorites[article.id]) delete this.favorites[article.id];
      else this.favorites[article.id] = { id: article.id, title: article.title, source: article.source, thumbnail: article.thumbnail, savedAt: Date.now() };
      NewsCache.lsSet('favorites', this.favorites);
      return this.isFavorite(article.id);
    }
    listBookmarks() { return Object.values(this.bookmarks).sort((a, b) => b.savedAt - a.savedAt); }
    listFavorites() { return Object.values(this.favorites).sort((a, b) => b.savedAt - a.savedAt); }
  }
  const NewsBookmark = new NewsBookmarkClass();

  /* ==========================================================================
     5. NewsHistory — Lịch sử đọc / Đọc gần đây
     ========================================================================== */
  class NewsHistoryClass {
    constructor() {
      this.items = NewsCache.lsGet('history', []); // [{id,title,source,readAt}]
    }
    add(article) {
      this.items = this.items.filter(x => x.id !== article.id);
      this.items.unshift({ id: article.id, title: article.title, source: article.source, thumbnail: article.thumbnail, readAt: Date.now() });
      if (this.items.length > NEWS_CONFIG.MAX_HISTORY_ITEMS) this.items.length = NEWS_CONFIG.MAX_HISTORY_ITEMS;
      NewsCache.lsSet('history', this.items);
    }
    list() { return this.items; }
    clear() { this.items = []; NewsCache.lsSet('history', []); }
  }
  const NewsHistory = new NewsHistoryClass();

  /* ==========================================================================
     6. NewsRealtime — polling 30s để phát hiện bài mới (badge NEW + toast)
     ========================================================================== */
  class NewsRealtimeClass {
    constructor() {
      this.timer = null;
      this.lastCheckedAt = new Date().toISOString();
      this.pendingCount = 0;
    }
    start() {
      this.stop();
      this.timer = setInterval(() => this._check(), NEWS_CONFIG.POLL_INTERVAL_MS);
    }
    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
    async _check() {
      // Chỉ check khi người dùng đang ở view Đọc báo để tránh gọi API thừa
      const view = document.getElementById('view-news');
      if (!view || !view.classList.contains('active')) return;
      try {
        const res = await NewsAPI.getLatest({ since: this.lastCheckedAt });
        const count = (res && (res.newCount ?? res.count)) || 0;
        if (count > 0) {
          this.pendingCount += count;
          this.lastCheckedAt = (res.latestTimestamp) || new Date().toISOString();
          NewsUI.showNewBadge(this.pendingCount);
          if (window.UIManager && UIManager.toast) {
            UIManager.toast('success', 'Có tin mới', `${count} bài báo mới vừa được cập nhật`);
          }
        }
      } catch (e) { /* lỗi mạng khi poll — im lặng bỏ qua, thử lại ở chu kỳ sau */ }
    }
    resetPending() { this.pendingCount = 0; this.lastCheckedAt = new Date().toISOString(); }
  }
  const NewsRealtime = new NewsRealtimeClass();

  /* ==========================================================================
     7. NewsSearch — tìm kiếm realtime (debounce) + trạng thái bộ lọc
     ========================================================================== */
  class NewsSearchClass {
    constructor() {
      this.state = {
        keyword: '',
        sources: [],       // rỗng = tất cả nguồn
        category: '',
        timeRange: 'all',
        sort: 'latest'
      };
      this.debouncedRun = NewsUtils.debounce(() => NewsManager.reload(), NEWS_CONFIG.SEARCH_DEBOUNCE_MS);
    }
    setKeyword(kw) { this.state.keyword = kw.trim(); this.debouncedRun(); }
    toggleSource(id) {
      const i = this.state.sources.indexOf(id);
      if (i >= 0) this.state.sources.splice(i, 1); else this.state.sources.push(id);
      NewsManager.reload();
    }
    clearSources() { this.state.sources = []; NewsManager.reload(); }
    setCategory(cat) { this.state.category = cat; NewsManager.reload(); }
    setTimeRange(r) { this.state.timeRange = r; NewsManager.reload(); }
    setSort(s) { this.state.sort = s; NewsManager.reload(); }
    resetAll() {
      this.state = { keyword: '', sources: [], category: '', timeRange: 'all', sort: 'latest' };
      NewsManager.reload();
    }
    /** true nếu có từ khoá => gọi /api/news/search, ngược lại => /api/news (list có lọc) */
    isSearching() { return this.state.keyword.length > 0; }
    buildParams(page) {
      return {
        q: this.state.keyword || undefined,
        source: this.state.sources.length ? this.state.sources : undefined,
        category: this.state.category || undefined,
        range: this.state.timeRange !== 'all' ? this.state.timeRange : undefined,
        sort: this.state.sort,
        page: page,
        pageSize: NEWS_CONFIG.PAGE_SIZE
      };
    }
  }
  const NewsSearch = new NewsSearchClass();

  /* ==========================================================================
     8. NewsReader — Modal đọc bài toàn màn hình
     ========================================================================== */
  class NewsReaderClass {
    constructor() {
      this.currentArticle = null;
      this.fontSize = NewsCache.lsGet('fontSize', 18);
      this.darkReader = NewsCache.lsGet('darkReader', false);
    }

    async open(id) {
      const modal = document.getElementById('newsReaderModal');
      const body = document.getElementById('newsReaderBody');
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';
      body.innerHTML = this._skeletonHtml();
      this._applyFontSize();
      this._applyDarkReader();

      let article = NewsCache.memGet('detail:' + id);
      if (!article) {
        try {
          article = await NewsAPI.getDetail(id);
          NewsCache.memSet('detail:' + id, article);
          NewsCache.saveArticle(article); // offline cache
        } catch (e) {
          // Offline / lỗi mạng — thử lấy từ IndexedDB cache đã lưu trước đó
          article = await NewsCache.getArticle(id);
          if (!article) {
            body.innerHTML = `<div class="news-reader-error"><i class="fa-solid fa-wifi"></i>
              <p>Không thể tải nội dung bài báo (mất kết nối hoặc lỗi máy chủ).</p>
              <button class="news-btn news-btn-primary" id="newsRetryBtn">Thử lại</button></div>`;
            document.getElementById('newsRetryBtn').onclick = () => this.open(id);
            return;
          }
          if (window.UIManager) UIManager.toast('warn', 'Chế độ ngoại tuyến', 'Đang hiển thị bản đã lưu trước đó');
        }
      }
      this.currentArticle = article;
      NewsHistory.add(article);
      this._render(article);
    }

    close() {
      document.getElementById('newsReaderModal').classList.remove('show');
      document.body.style.overflow = '';
      this.currentArticle = null;
      // cập nhật lại card ngoài danh sách (trạng thái bookmark/favorite có thể đổi)
      NewsUI.refreshVisibleCards();
    }

    _skeletonHtml() {
      return `
        <div class="news-skel news-skel-title"></div>
        <div class="news-skel news-skel-meta"></div>
        <div class="news-skel news-skel-cover"></div>
        ${'<div class="news-skel news-skel-line"></div>'.repeat(6)}
      `;
    }

    _render(a) {
      const body = document.getElementById('newsReaderBody');
      const isBk = NewsBookmark.isBookmarked(a.id);
      const isFv = NewsBookmark.isFavorite(a.id);
      const readingTime = a.readingTime || NewsUtils.estimateReadingTime(a.content || a.description);
      body.innerHTML = `
        <div class="news-reader-topline">
          <span class="news-source-chip" style="--src-color:${a.sourceColor || '#1478d4'}">
            <i class="fa-solid ${a.sourceIcon || 'fa-newspaper'}"></i> ${NewsUtils.escapeHtml(a.source || '')}
          </span>
          <span class="news-reader-cat">${NewsUtils.escapeHtml(a.category || '')}</span>
        </div>
        <h1 class="news-reader-title">${NewsUtils.escapeHtml(a.title || '')}</h1>
        <div class="news-reader-meta">
          <span><i class="fa-regular fa-clock"></i> ${NewsUtils.formatFullDate(a.publishTime)}</span>
          <span><i class="fa-regular fa-user"></i> ${NewsUtils.escapeHtml(a.author || 'Không rõ tác giả')}</span>
          <span><i class="fa-regular fa-hourglass"></i> ${readingTime} phút đọc</span>
        </div>
        ${a.thumbnail ? `<img class="news-reader-cover" src="${a.thumbnail}" alt="" loading="lazy">` : ''}
        <div class="news-reader-content" id="newsReaderContent">${a.contentHtml || `<p>${NewsUtils.escapeHtml(a.description || '')}</p>`}</div>
        ${(a.tags && a.tags.length) ? `<div class="news-reader-tags">${a.tags.map(t => `<span class="news-tag">#${NewsUtils.escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="news-reader-actions">
          <button class="news-icon-btn ${isBk ? 'active' : ''}" id="readerBookmarkBtn" title="Lưu bài viết"><i class="fa-solid fa-bookmark"></i></button>
          <button class="news-icon-btn ${isFv ? 'active' : ''}" id="readerFavoriteBtn" title="Yêu thích"><i class="fa-solid fa-heart"></i></button>
          <button class="news-icon-btn" id="readerShareBtn" title="Chia sẻ"><i class="fa-solid fa-share-nodes"></i></button>
          <button class="news-icon-btn" id="readerCopyLinkBtn" title="Copy link"><i class="fa-solid fa-link"></i></button>
          <a class="news-icon-btn" href="${a.originalUrl || '#'}" target="_blank" rel="noopener" title="Xem bản gốc" style="${a.originalUrl ? '' : 'display:none;'}"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        </div>
      `;
      document.getElementById('readerBookmarkBtn').onclick = (e) => {
        const active = NewsBookmark.toggleBookmark(a);
        e.currentTarget.classList.toggle('active', active);
        if (window.UIManager) UIManager.toast('success', active ? 'Đã lưu bài viết' : 'Đã bỏ lưu', a.title);
      };
      document.getElementById('readerFavoriteBtn').onclick = (e) => {
        const active = NewsBookmark.toggleFavorite(a);
        e.currentTarget.classList.toggle('active', active);
        if (window.UIManager) UIManager.toast('success', active ? 'Đã thêm yêu thích' : 'Đã bỏ yêu thích', a.title);
      };
      document.getElementById('readerShareBtn').onclick = () => NewsUI.shareArticle(a);
      document.getElementById('readerCopyLinkBtn').onclick = () => NewsUI.copyLink(a);
    }

    changeFontSize(delta) {
      this.fontSize = Math.max(14, Math.min(26, this.fontSize + delta));
      NewsCache.lsSet('fontSize', this.fontSize);
      this._applyFontSize();
    }
    _applyFontSize() {
      const content = document.getElementById('newsReaderBody');
      if (content) content.style.setProperty('--reader-font-size', this.fontSize + 'px');
      const lbl = document.getElementById('readerFontSizeLabel');
      if (lbl) lbl.textContent = this.fontSize + 'px';
    }
    toggleDarkReader() {
      this.darkReader = !this.darkReader;
      NewsCache.lsSet('darkReader', this.darkReader);
      this._applyDarkReader();
    }
    _applyDarkReader() {
      const modal = document.getElementById('newsReaderModal');
      if (modal) modal.classList.toggle('news-dark-reader', this.darkReader);
      const btn = document.getElementById('readerDarkReaderBtn');
      if (btn) btn.classList.toggle('active', this.darkReader);
    }
    /** Cập nhật thanh tiến độ đọc (%) theo vị trí scroll trong modal */
    updateProgress() {
      const scroller = document.getElementById('newsReaderScroll');
      const bar = document.getElementById('newsReaderProgressBar');
      if (!scroller || !bar) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.round((scroller.scrollTop / max) * 100)) : 0;
      bar.style.width = pct + '%';
    }
  }
  const NewsReader = new NewsReaderClass();

  /* ==========================================================================
     9. NewsUI — Toàn bộ giao diện: inject CSS/HTML, card, virtual list,
        infinite scroll, skeleton, lazy image, filter bar, danh sách nguồn.
     ========================================================================== */
  class NewsUIClass {
    constructor() {
      this.sources = DEFAULT_SOURCES.slice();
      this.categories = [];
      this.articles = [];           // toàn bộ bài đã tải (dùng cho virtual list)
      this.columns = 3;
      this.colWidth = 0;
      this.rowHeight = NEWS_CONFIG.ESTIMATED_CARD_HEIGHT + NEWS_CONFIG.CARD_GAP;
      this.renderedRange = { start: -1, end: -1 };
      this.imgObserver = null;
      this.loading = false;
      this.hasMore = true;
      this.page = 1;
    }

    /* ---------------------- 9.1 INJECT CSS ---------------------- */
    injectCss() {
      if (document.getElementById('news-module-style')) return;
      const style = document.createElement('style');
      style.id = 'news-module-style';
      style.textContent = `
      /* ============ NEWS MODULE — style đồng bộ theme chung của site ============ */
      .news-toolbar{display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:16px;}
      .news-search-box{
        flex:1 1 280px; position:relative; display:flex; align-items:center;
        background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-md);
        padding:0 14px; height:46px; backdrop-filter:var(--glass-blur); box-shadow:var(--shadow-sm);
      }
      .news-search-box i.fa-magnifying-glass{color:var(--text-muted); margin-right:10px;}
      .news-search-box input{flex:1; background:transparent; border:none; outline:none; color:var(--text-main); font-size:14px; height:100%;}
      .news-search-box .news-clear-btn{color:var(--text-muted); padding:4px; border-radius:50%;}
      .news-search-box .news-clear-btn:hover{background:rgba(20,120,212,.12); color:var(--accent);}
      .news-toolbar-btn{
        display:flex; align-items:center; gap:8px; padding:0 16px; height:46px; border-radius:var(--radius-md);
        background:var(--card-bg); border:1px solid var(--card-border); color:var(--text-main); font-size:13.5px; font-weight:600;
        box-shadow:var(--shadow-sm); transition:var(--trans); position:relative;
      }
      .news-toolbar-btn:hover{border-color:var(--accent); color:var(--accent);}
      .news-toolbar-btn.active{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; border-color:transparent;}
      .news-toolbar-btn .news-count-dot{background:var(--danger); color:#fff; font-size:10px; font-weight:800; border-radius:50%; width:17px; height:17px; display:flex; align-items:center; justify-content:center; margin-left:2px;}

      .news-filter-panel{
        display:none; flex-wrap:wrap; gap:22px; padding:18px 20px; margin-bottom:16px;
        background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-md);
        box-shadow:var(--shadow-sm); backdrop-filter:var(--glass-blur);
      }
      .news-filter-panel.show{display:flex;}
      .news-filter-group{display:flex; flex-direction:column; gap:8px; min-width:170px;}
      .news-filter-group label{font-size:11px; text-transform:uppercase; letter-spacing:.6px; font-weight:700; color:var(--text-muted);}
      .news-chip-row{display:flex; flex-wrap:wrap; gap:8px;}
      .news-filter-chip{
        padding:6px 13px; border-radius:20px; font-size:12.5px; font-weight:600; cursor:pointer;
        border:1px solid var(--card-border); color:var(--text-main); background:transparent; transition:var(--trans);
      }
      .news-filter-chip:hover{border-color:var(--accent);}
      .news-filter-chip.active{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff; border-color:transparent;}
      .news-filter-reset{color:var(--danger); font-size:12.5px; font-weight:700; align-self:flex-end; margin-left:auto; cursor:pointer;}

      .news-sources-panel{
        display:flex; gap:10px; overflow-x:auto; padding-bottom:6px; margin-bottom:16px; scrollbar-width:thin;
      }
      .news-source-pill{
        flex-shrink:0; display:flex; align-items:center; gap:8px; padding:8px 14px; border-radius:14px;
        background:var(--card-bg); border:1px solid var(--card-border); font-size:12.5px; font-weight:600;
        color:var(--text-main); cursor:pointer; transition:var(--trans); white-space:nowrap;
      }
      .news-source-pill i{color:var(--src-color, var(--accent));}
      .news-source-pill.active{border-color:var(--src-color, var(--accent)); background:color-mix(in srgb, var(--src-color, var(--accent)) 12%, var(--card-bg));}

      .news-badge-new{
        position:sticky; top:8px; z-index:20; display:none; align-items:center; gap:8px; justify-content:center;
        margin:0 auto 16px; padding:9px 20px; width:max-content; border-radius:30px; cursor:pointer;
        background:linear-gradient(135deg,var(--success),var(--success-dark)); color:#fff; font-size:13px; font-weight:700;
        box-shadow:0 8px 22px rgba(22,199,132,.35); animation:newsBadgePop .4s ease;
      }
      .news-badge-new.show{display:flex;}
      @keyframes newsBadgePop{from{transform:translateY(-14px) scale(.9); opacity:0;} to{transform:translateY(0) scale(1); opacity:1;}}

      .news-grid-viewport{position:relative; min-height:200px;}
      .news-grid-spacer{position:relative; width:100%;}
      .news-card{
        position:absolute; top:0; left:0; display:flex; flex-direction:column;
        background:var(--card-bg-solid); border:1px solid var(--card-border); border-radius:var(--radius-lg);
        overflow:hidden; box-shadow:var(--shadow-sm); transition:var(--trans);
      }
      .news-card:hover{box-shadow:var(--shadow-md); transform:translateY(-3px);}
      .news-card-thumb{position:relative; width:100%; height:150px; background:var(--blue-100); overflow:hidden; flex-shrink:0; cursor:pointer;}
      [data-theme="dark"] .news-card-thumb{background:var(--blue-900);}
      .news-card-thumb img{width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .35s ease;}
      .news-card-thumb img.loaded{opacity:1;}
      .news-card-thumb .news-src-tag{
        position:absolute; top:8px; left:8px; padding:4px 10px; border-radius:8px; font-size:10.5px; font-weight:700;
        background:rgba(4,32,63,.65); color:#fff; backdrop-filter:blur(4px);
      }
      .news-card-thumb .news-new-flag{
        position:absolute; top:8px; right:8px; padding:3px 9px; border-radius:8px; font-size:10px; font-weight:800;
        background:var(--danger); color:#fff; animation:newsPulse 1.6s ease-in-out infinite;
      }
      @keyframes newsPulse{0%,100%{opacity:1;} 50%{opacity:.55;}}
      .news-card-body{padding:14px 15px 12px; display:flex; flex-direction:column; gap:8px; flex:1;}
      .news-card-cat{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--accent);}
      .news-card-title{font-size:14.5px; font-weight:700; line-height:1.4; color:var(--text-main); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; cursor:pointer;}
      .news-card-desc{font-size:12.5px; color:var(--text-muted); line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
      .news-card-meta{display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text-muted); margin-top:auto; padding-top:8px; flex-wrap:wrap;}
      .news-card-meta span{display:flex; align-items:center; gap:4px;}
      .news-card-actions{display:flex; align-items:center; gap:6px; border-top:1px solid var(--card-border); padding:8px 10px;}
      .news-icon-btn{
        width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;
        color:var(--text-muted); font-size:13.5px; transition:var(--trans); flex-shrink:0;
      }
      .news-icon-btn:hover{background:rgba(20,120,212,.12); color:var(--accent);}
      .news-icon-btn.active{color:var(--danger);}
      .news-card-actions .news-open-btn{margin-left:auto; font-size:12px; font-weight:700; color:var(--accent); display:flex; align-items:center; gap:6px; padding:0 10px; width:auto; border-radius:8px;}

      .news-skel{background:linear-gradient(90deg, var(--card-border) 25%, rgba(150,180,210,.28) 37%, var(--card-border) 63%); background-size:400% 100%; animation:newsShimmer 1.3s ease infinite; border-radius:8px;}
      @keyframes newsShimmer{0%{background-position:100% 50%;} 100%{background-position:0 50%;}}
      .news-skel-card{height:${NEWS_CONFIG.ESTIMATED_CARD_HEIGHT}px; border-radius:var(--radius-lg);}
      .news-skel-title{height:30px; width:70%; margin-bottom:14px;}
      .news-skel-meta{height:16px; width:40%; margin-bottom:18px;}
      .news-skel-cover{height:220px; width:100%; margin-bottom:18px;}
      .news-skel-line{height:14px; width:100%; margin-bottom:10px;}

      .news-empty-state, .news-loading-more{display:flex; flex-direction:column; align-items:center; gap:10px; padding:40px 0; color:var(--text-muted); font-size:13.5px;}
      .news-empty-state i, .news-loading-more i{font-size:34px; color:var(--blue-300);}
      .news-sentinel{height:1px;}

      /* -------- MODAL ĐỌC BÀI TOÀN MÀN HÌNH -------- */
      .news-reader-modal{position:fixed; inset:0; z-index:400; display:none; background:rgba(4,20,38,.55); backdrop-filter:blur(4px);}
      .news-reader-modal.show{display:flex; align-items:flex-start; justify-content:center;}
      .news-reader-panel{
        width:100%; max-width:860px; height:100vh; background:var(--card-bg-solid); display:flex; flex-direction:column;
        box-shadow:var(--shadow-lg); animation:newsSlideUp .3s ease;
      }
      @keyframes newsSlideUp{from{transform:translateY(24px); opacity:0;} to{transform:translateY(0); opacity:1;}}
      .news-reader-progress{height:3px; background:var(--card-border); flex-shrink:0;}
      .news-reader-progress-bar{height:100%; width:0%; background:linear-gradient(90deg,var(--blue-500),var(--cyan-500)); transition:width .1s linear;}
      .news-reader-head{display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--card-border); flex-shrink:0;}
      .news-reader-tools{display:flex; align-items:center; gap:4px;}
      .news-reader-scroll{flex:1; overflow-y:auto; padding:26px 30px 60px;}
      .news-reader-topline{display:flex; align-items:center; gap:10px; margin-bottom:14px;}
      .news-source-chip{display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--src-color,var(--accent));}
      .news-reader-cat{font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--text-muted); background:var(--card-border); padding:3px 10px; border-radius:8px;}
      .news-reader-title{font-size:26px; font-weight:800; line-height:1.35; margin-bottom:14px; color:var(--text-main);}
      .news-reader-meta{display:flex; flex-wrap:wrap; gap:16px; font-size:12.5px; color:var(--text-muted); margin-bottom:18px;}
      .news-reader-meta span{display:flex; align-items:center; gap:6px;}
      .news-reader-cover{width:100%; border-radius:var(--radius-md); margin-bottom:20px;}
      .news-reader-content{font-size:var(--reader-font-size, 18px); line-height:1.9; color:var(--text-main);}
      .news-reader-content p{margin-bottom:16px;}
      .news-reader-content img{max-width:100%; border-radius:var(--radius-sm); margin:14px 0;}
      .news-reader-content h2, .news-reader-content h3{margin:22px 0 12px; font-weight:800;}
      .news-reader-tags{display:flex; flex-wrap:wrap; gap:8px; margin-top:24px;}
      .news-tag{font-size:12px; font-weight:600; color:var(--accent); background:rgba(20,120,212,.1); padding:5px 12px; border-radius:14px;}
      .news-reader-actions{display:flex; gap:8px; margin-top:26px; padding-top:18px; border-top:1px solid var(--card-border);}
      .news-reader-error{display:flex; flex-direction:column; align-items:center; gap:14px; padding:60px 0; color:var(--text-muted);}
      .news-reader-error i{font-size:40px; color:var(--danger);}
      .news-dark-reader .news-reader-panel{background:#12100c; color:#e8dfce;}
      .news-dark-reader .news-reader-content, .news-dark-reader .news-reader-title{color:#e8dfce;}
      .news-dark-reader .news-reader-scroll{background:#12100c;}

      .news-btn{padding:9px 18px; border-radius:var(--radius-sm); font-size:13px; font-weight:700; transition:var(--trans);}
      .news-btn-primary{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500)); color:#fff;}
      .news-btn-primary:hover{filter:brightness(1.08);}

      @media (max-width:720px){
        .news-reader-scroll{padding:20px 18px 50px;}
        .news-reader-title{font-size:21px;}
      }
      `;
      document.head.appendChild(style);
    }

    /* ---------------------- 9.2 INJECT HTML (sidebar + view + modal) ---------------------- */
    injectHtml() {
      // (a) Nav item ở sidebar — chèn cuối danh sách nav-item hiện có, không đụng HTML gốc
      const nav = document.querySelector('.sidebar-nav');
      if (nav && !document.querySelector('.nav-item[data-view="news"]')) {
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.dataset.view = 'news';
        btn.innerHTML = '<i class="fa-solid fa-newspaper"></i> Đọc báo';
        nav.appendChild(btn);
      }

      // (b) View "Đọc báo" — chèn ngay sau view cuối cùng hiện có trong main-wrap
      if (!document.getElementById('view-news')) {
        const existingViews = document.querySelectorAll('.view');
        const lastView = existingViews[existingViews.length - 1];
        const section = document.createElement('section');
        section.className = 'view';
        section.id = 'view-news';
        section.innerHTML = this._viewTemplate();
        if (lastView) lastView.insertAdjacentElement('afterend', section);
        else document.querySelector('.main-wrap')?.appendChild(section);
      }

      // (c) Modal đọc bài toàn màn hình — chèn cuối <body>
      if (!document.getElementById('newsReaderModal')) {
        const modal = document.createElement('div');
        modal.id = 'newsReaderModal';
        modal.className = 'news-reader-modal';
        modal.innerHTML = `
          <div class="news-reader-panel">
            <div class="news-reader-progress"><div class="news-reader-progress-bar" id="newsReaderProgressBar"></div></div>
            <div class="news-reader-head">
              <button class="news-icon-btn" id="newsReaderCloseBtn" title="Đóng"><i class="fa-solid fa-xmark"></i></button>
              <div class="news-reader-tools">
                <button class="news-icon-btn" id="readerFontMinusBtn" title="Giảm cỡ chữ"><i class="fa-solid fa-minus"></i></button>
                <span id="readerFontSizeLabel" style="font-size:12px; font-weight:700; color:var(--text-muted); width:38px; text-align:center;">18px</span>
                <button class="news-icon-btn" id="readerFontPlusBtn" title="Tăng cỡ chữ"><i class="fa-solid fa-plus"></i></button>
                <button class="news-icon-btn" id="readerDarkReaderBtn" title="Chế độ đọc tối"><i class="fa-solid fa-moon"></i></button>
              </div>
            </div>
            <div class="news-reader-scroll" id="newsReaderScroll">
              <div id="newsReaderBody"></div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
    }

    _viewTemplate() {
      return `
        <div class="section-head">
          <div><h2>Đọc báo</h2><p>Tổng hợp tin tức tài chính - kinh tế - chứng khoán từ các nguồn báo uy tín, cập nhật realtime.</p></div>
        </div>

        <div class="news-toolbar">
          <div class="news-search-box">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="newsSearchInput" placeholder="Tìm theo tiêu đề, mô tả, nguồn, tag, tác giả, từ khoá...">
            <span class="news-clear-btn" id="newsSearchClearBtn" style="display:none;"><i class="fa-solid fa-circle-xmark"></i></span>
          </div>
          <button class="news-toolbar-btn" id="newsFilterToggleBtn"><i class="fa-solid fa-sliders"></i> Bộ lọc <span class="news-count-dot" id="newsFilterCountDot" style="display:none;">0</span></button>
          <button class="news-toolbar-btn" id="newsBookmarkViewBtn"><i class="fa-solid fa-bookmark"></i> Đã lưu</button>
          <button class="news-toolbar-btn" id="newsHistoryViewBtn"><i class="fa-solid fa-clock-rotate-left"></i> Đã đọc</button>
        </div>

        <div class="news-filter-panel" id="newsFilterPanel">
          <div class="news-filter-group">
            <label>Chuyên mục</label>
            <div class="news-chip-row" id="newsCategoryChips"><span class="news-filter-chip active" data-cat="">Tất cả</span></div>
          </div>
          <div class="news-filter-group">
            <label>Thời gian</label>
            <div class="news-chip-row" id="newsTimeChips">
              ${TIME_RANGES.map(r => `<span class="news-filter-chip ${r.id === 'all' ? 'active' : ''}" data-range="${r.id}">${r.label}</span>`).join('')}
            </div>
          </div>
          <div class="news-filter-group">
            <label>Độ phổ biến / Sắp xếp</label>
            <div class="news-chip-row" id="newsSortChips">
              ${SORT_OPTIONS.map(s => `<span class="news-filter-chip ${s.id === 'latest' ? 'active' : ''}" data-sort="${s.id}">${s.label}</span>`).join('')}
            </div>
          </div>
          <span class="news-filter-reset" id="newsFilterResetBtn"><i class="fa-solid fa-rotate-left"></i> Xoá lọc</span>
        </div>

        <div class="news-sources-panel" id="newsSourcesPanel"></div>

        <div class="news-badge-new" id="newsBadgeNew"><i class="fa-solid fa-circle-arrow-up"></i> <span id="newsBadgeNewText">Có bài mới</span></div>

        <div class="news-grid-viewport" id="newsGridViewport">
          <div class="news-grid-spacer" id="newsGridSpacer"></div>
        </div>
        <div class="news-empty-state" id="newsEmptyState" style="display:none;">
          <i class="fa-solid fa-newspaper"></i><p>Không tìm thấy bài báo nào phù hợp với bộ lọc hiện tại.</p>
        </div>
        <div class="news-loading-more" id="newsLoadingMore" style="display:none;">
          <i class="fa-solid fa-spinner fa-spin"></i><p>Đang tải thêm bài viết...</p>
        </div>
        <div class="news-sentinel" id="newsSentinel"></div>
      `;
    }

    /* ---------------------- 9.3 RENDER DANH SÁCH NGUỒN BÁO ---------------------- */
    renderSourcesPanel() {
      const panel = document.getElementById('newsSourcesPanel');
      if (!panel) return;
      panel.innerHTML = this.sources.map(s => `
        <span class="news-source-pill ${NewsSearch.state.sources.includes(s.id) ? 'active' : ''}" data-source="${s.id}" style="--src-color:${s.color}">
          <i class="fa-solid ${s.icon}"></i> ${NewsUtils.escapeHtml(s.name)}
        </span>
      `).join('');
      panel.querySelectorAll('.news-source-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          NewsSearch.toggleSource(pill.dataset.source);
          pill.classList.toggle('active');
        });
      });
    }

    renderCategoryChips() {
      const wrap = document.getElementById('newsCategoryChips');
      if (!wrap || !this.categories.length) return;
      wrap.innerHTML = `<span class="news-filter-chip active" data-cat="">Tất cả</span>` +
        this.categories.map(c => `<span class="news-filter-chip" data-cat="${c.id}">${NewsUtils.escapeHtml(c.name)}</span>`).join('');
      wrap.querySelectorAll('.news-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          wrap.querySelectorAll('.news-filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          NewsSearch.setCategory(chip.dataset.cat);
        });
      });
    }

    /* ---------------------- 9.4 SKELETON LOADING ---------------------- */
    showSkeleton() {
      const spacer = document.getElementById('newsGridSpacer');
      document.getElementById('newsEmptyState').style.display = 'none';
      const n = this.columns * 2;
      const html = [];
      for (let i = 0; i < n; i++) {
        const col = i % this.columns;
        const row = Math.floor(i / this.columns);
        html.push(`<div class="news-card news-skel news-skel-card" style="width:${this.colWidth}px; left:${col * (this.colWidth + NEWS_CONFIG.CARD_GAP)}px; top:${row * this.rowHeight}px;"></div>`);
      }
      spacer.innerHTML = '';
      spacer.appendChild(NewsUtils.fragmentFromHtml(html));
      spacer.style.height = (Math.ceil(n / this.columns) * this.rowHeight) + 'px';
    }

    /* ---------------------- 9.5 RESPONSIVE COLUMNS ---------------------- */
    recalcColumns() {
      const viewport = document.getElementById('newsGridViewport');
      if (!viewport) return;
      const width = viewport.clientWidth || 900;
      const cols = Math.max(1, Math.floor((width + NEWS_CONFIG.CARD_GAP) / (NEWS_CONFIG.ESTIMATED_CARD_MIN_WIDTH + NEWS_CONFIG.CARD_GAP)));
      this.columns = cols;
      this.colWidth = Math.floor((width - (cols - 1) * NEWS_CONFIG.CARD_GAP) / cols);
    }

    /* ---------------------- 9.6 VIRTUAL LIST — chỉ render các card trong khung nhìn ---------------------- */
    setArticles(list, append) {
      this.articles = append ? this.articles.concat(list) : list;
      const spacer = document.getElementById('newsGridSpacer');
      const totalRows = Math.ceil(this.articles.length / this.columns);
      spacer.style.height = (totalRows * this.rowHeight) + 'px';
      document.getElementById('newsEmptyState').style.display = this.articles.length ? 'none' : 'flex';
      this.renderedRange = { start: -1, end: -1 }; // ép render lại toàn bộ khung nhìn hiện tại
      this._renderVisibleWindow(true);
    }

    _renderVisibleWindow(force) {
      const viewport = document.getElementById('newsGridViewport');
      const spacer = document.getElementById('newsGridSpacer');
      if (!viewport || !spacer || !this.articles.length) return;

      // Vị trí đầu viewport tính theo trang tài liệu (document-relative), để so với vùng nhìn thấy hiện tại
      const rect = viewport.getBoundingClientRect();
      const viewportTopInDoc = rect.top + window.scrollY;
      const visibleTop = window.scrollY - viewportTopInDoc;
      const visibleBottom = visibleTop + window.innerHeight;

      const buffer = 3; // số hàng đệm trên/dưới để cuộn mượt, tránh giật khi render lại
      const startRow = Math.max(0, Math.floor(visibleTop / this.rowHeight) - buffer);
      const endRow = Math.min(Math.ceil(this.articles.length / this.columns), Math.ceil(visibleBottom / this.rowHeight) + buffer);
      const startIdx = Math.max(0, startRow * this.columns);
      const endIdx = Math.min(this.articles.length, endRow * this.columns);

      if (!force && startIdx === this.renderedRange.start && endIdx === this.renderedRange.end) return;
      this.renderedRange = { start: startIdx, end: endIdx };

      const html = [];
      for (let i = startIdx; i < endIdx; i++) {
        const a = this.articles[i];
        if (!a) continue;
        const col = i % this.columns;
        const row = Math.floor(i / this.columns);
        html.push(this._cardHtml(a, col, row));
      }
      spacer.innerHTML = '';
      spacer.appendChild(NewsUtils.fragmentFromHtml(html));
      this._bindCardEvents(spacer);
      this._observeLazyImages(spacer);
    }

    _cardHtml(a, col, row) {
      const isBk = NewsBookmark.isBookmarked(a.id);
      const isFv = NewsBookmark.isFavorite(a.id);
      const isNew = a.isNew ? '<span class="news-new-flag">NEW</span>' : '';
      const readingTime = a.readingTime || NewsUtils.estimateReadingTime(a.description);
      const left = col * (this.colWidth + NEWS_CONFIG.CARD_GAP);
      const top = row * this.rowHeight;
      return `
        <article class="news-card" data-id="${a.id}" style="width:${this.colWidth}px; left:${left}px; top:${top}px; height:${NEWS_CONFIG.ESTIMATED_CARD_HEIGHT}px;">
          <div class="news-card-thumb">
            <span class="news-src-tag">${NewsUtils.escapeHtml(a.source || '')}</span>
            ${isNew}
            <img data-src="${a.thumbnail || ''}" alt="" class="news-lazy-img">
          </div>
          <div class="news-card-body">
            <span class="news-card-cat">${NewsUtils.escapeHtml(a.category || '')}</span>
            <h3 class="news-card-title">${NewsUtils.escapeHtml(a.title || '')}</h3>
            <p class="news-card-desc">${NewsUtils.escapeHtml(NewsUtils.truncate(a.description || '', 110))}</p>
            <div class="news-card-meta">
              <span><i class="fa-regular fa-clock"></i> ${NewsUtils.timeAgo(a.publishTime)}</span>
              <span><i class="fa-regular fa-hourglass"></i> ${readingTime} phút</span>
              ${a.tags && a.tags[0] ? `<span><i class="fa-solid fa-tag"></i> ${NewsUtils.escapeHtml(a.tags[0])}</span>` : ''}
            </div>
          </div>
          <div class="news-card-actions">
            <button class="news-icon-btn news-bookmark-btn ${isBk ? 'active' : ''}" title="Lưu bài viết"><i class="fa-solid fa-bookmark"></i></button>
            <button class="news-icon-btn news-favorite-btn ${isFv ? 'active' : ''}" title="Yêu thích"><i class="fa-solid fa-heart"></i></button>
            <button class="news-icon-btn news-share-btn" title="Chia sẻ"><i class="fa-solid fa-share-nodes"></i></button>
            <button class="news-open-btn">Đọc <i class="fa-solid fa-arrow-right"></i></button>
          </div>
        </article>
      `;
    }

    _bindCardEvents(container) {
      container.querySelectorAll('.news-card').forEach(card => {
        const id = card.dataset.id;
        const article = this.articles.find(a => a.id === id);
        if (!article) return;
        card.querySelector('.news-open-btn').addEventListener('click', () => NewsReader.open(id));
        card.querySelector('.news-card-thumb').addEventListener('click', () => NewsReader.open(id));
        card.querySelector('.news-card-title').addEventListener('click', () => NewsReader.open(id));
        card.querySelector('.news-bookmark-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const active = NewsBookmark.toggleBookmark(article);
          e.currentTarget.classList.toggle('active', active);
        });
        card.querySelector('.news-favorite-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const active = NewsBookmark.toggleFavorite(article);
          e.currentTarget.classList.toggle('active', active);
        });
        card.querySelector('.news-share-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this.shareArticle(article);
        });
      });
    }

    /** Cập nhật lại trạng thái bookmark/favorite trên các card đang hiển thị (không render lại toàn bộ) */
    refreshVisibleCards() {
      document.querySelectorAll('#newsGridSpacer .news-card').forEach(card => {
        const id = card.dataset.id;
        const bk = card.querySelector('.news-bookmark-btn');
        const fv = card.querySelector('.news-favorite-btn');
        if (bk) bk.classList.toggle('active', NewsBookmark.isBookmarked(id));
        if (fv) fv.classList.toggle('active', NewsBookmark.isFavorite(id));
      });
    }

    /* ---------------------- 9.7 LAZY IMAGE (IntersectionObserver) ---------------------- */
    _observeLazyImages(container) {
      if (!this.imgObserver) {
        this.imgObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target;
              const src = img.dataset.src;
              if (src) {
                img.src = src;
                img.onload = () => img.classList.add('loaded');
                img.onerror = () => { img.closest('.news-card-thumb')?.classList.add('news-img-error'); };
              }
              this.imgObserver.unobserve(img);
            }
          });
        }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
      }
      container.querySelectorAll('img.news-lazy-img[data-src]').forEach(img => this.imgObserver.observe(img));
    }

    /* ---------------------- 9.8 INFINITE SCROLL (sentinel + IntersectionObserver) ---------------------- */
    setupInfiniteScroll() {
      const sentinel = document.getElementById('newsSentinel');
      if (!sentinel) return;
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) NewsManager.loadMore();
      }, { root: null, rootMargin: '400px 0px' });
      observer.observe(sentinel);
    }

    /* ---------------------- 9.9 BADGE "CÓ BÀI MỚI" ---------------------- */
    showNewBadge(count) {
      const badge = document.getElementById('newsBadgeNew');
      if (!badge) return;
      document.getElementById('newsBadgeNewText').textContent = `${count} bài báo mới — bấm để xem`;
      badge.classList.add('show');
      badge.onclick = () => { NewsManager.prependNew(); badge.classList.remove('show'); };
    }
    hideNewBadge() { document.getElementById('newsBadgeNew')?.classList.remove('show'); }

    /* ---------------------- 9.10 SHARE / COPY LINK ---------------------- */
    shareArticle(article) {
      const url = article.originalUrl || (location.origin + location.pathname + '#news-' + article.id);
      if (navigator.share) {
        navigator.share({ title: article.title, text: article.description, url }).catch(() => {});
      } else {
        this.copyLink(article);
      }
    }
    copyLink(article) {
      const url = article.originalUrl || (location.origin + location.pathname + '#news-' + article.id);
      navigator.clipboard?.writeText(url).then(() => {
        if (window.UIManager) UIManager.toast('success', 'Đã copy link', url);
      }).catch(() => {
        if (window.UIManager) UIManager.toast('error', 'Không thể copy', 'Trình duyệt chặn quyền truy cập clipboard');
      });
    }

    /* ---------------------- 9.11 BIND CÁC SỰ KIỆN GIAO DIỆN TĨNH (chạy 1 lần) ---------------------- */
    bindStaticEvents() {
      const searchInput = document.getElementById('newsSearchInput');
      const clearBtn = document.getElementById('newsSearchClearBtn');
      searchInput.addEventListener('input', (e) => {
        clearBtn.style.display = e.target.value ? 'flex' : 'none';
        NewsSearch.setKeyword(e.target.value);
      });
      clearBtn.addEventListener('click', () => { searchInput.value = ''; clearBtn.style.display = 'none'; NewsSearch.setKeyword(''); });

      document.getElementById('newsFilterToggleBtn').addEventListener('click', (e) => {
        document.getElementById('newsFilterPanel').classList.toggle('show');
        e.currentTarget.classList.toggle('active');
      });
      document.getElementById('newsFilterResetBtn').addEventListener('click', () => {
        NewsSearch.resetAll();
        document.querySelectorAll('#newsTimeChips .news-filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
        document.querySelectorAll('#newsSortChips .news-filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
        document.querySelectorAll('#newsCategoryChips .news-filter-chip').forEach((c, i) => c.classList.toggle('active', i === 0));
        document.querySelectorAll('.news-source-pill').forEach(p => p.classList.remove('active'));
        document.getElementById('newsFilterCountDot').style.display = 'none';
      });
      document.querySelectorAll('#newsTimeChips .news-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#newsTimeChips .news-filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          NewsSearch.setTimeRange(chip.dataset.range);
        });
      });
      document.querySelectorAll('#newsSortChips .news-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('#newsSortChips .news-filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          NewsSearch.setSort(chip.dataset.sort);
        });
      });

      document.getElementById('newsBookmarkViewBtn').addEventListener('click', () => NewsManager.showSavedList('bookmark'));
      document.getElementById('newsHistoryViewBtn').addEventListener('click', () => NewsManager.showSavedList('history'));

      // Modal reader
      document.getElementById('newsReaderCloseBtn').addEventListener('click', () => NewsReader.close());
      document.getElementById('newsReaderModal').addEventListener('click', (e) => { if (e.target.id === 'newsReaderModal') NewsReader.close(); });
      document.getElementById('readerFontMinusBtn').addEventListener('click', () => NewsReader.changeFontSize(-1));
      document.getElementById('readerFontPlusBtn').addEventListener('click', () => NewsReader.changeFontSize(1));
      document.getElementById('readerDarkReaderBtn').addEventListener('click', () => NewsReader.toggleDarkReader());
      document.getElementById('newsReaderScroll').addEventListener('scroll', NewsUtils.throttle(() => NewsReader.updateProgress(), 60));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('newsReaderModal').classList.contains('show')) NewsReader.close();
      });

      // Virtual list: cuộn trang chính + resize
      window.addEventListener('scroll', NewsUtils.throttle(() => this._renderVisibleWindow(false), NEWS_CONFIG.SCROLL_THROTTLE_MS), { passive: true });
      window.addEventListener('resize', NewsUtils.throttle(() => {
        this.recalcColumns();
        this.setArticles(this.articles, false);
      }, NEWS_CONFIG.RESIZE_THROTTLE_MS));

      this.setupInfiniteScroll();
    }
  }
  const NewsUI = new NewsUIClass();

  /* ==========================================================================
     10. NewsManager — Nhạc trưởng điều phối toàn bộ module + API mở rộng
     ========================================================================== */
  const NewsManager = {
    initialized: false,
    _firstLoadDone: false,

    /** Cho phép cấu hình lại endpoint / hằng số khi tích hợp vào môi trường khác */
    configure(overrides) { Object.assign(NEWS_CONFIG.ENDPOINTS, overrides || {}); },

    /** Mở rộng thêm nguồn báo mới tại runtime — thoả yêu cầu "cho phép thêm nguồn mới sau này" */
    addSource(source) {
      if (!source || !source.id) return;
      if (NewsUI.sources.some(s => s.id === source.id)) return;
      NewsUI.sources.push({ icon: 'fa-newspaper', color: '#1478d4', ...source });
      NewsUI.renderSourcesPanel();
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;
      NewsUI.injectCss();
      NewsUI.injectHtml();
      NewsUI.recalcColumns();
      NewsUI.renderSourcesPanel();
      NewsUI.bindStaticEvents();
      this._loadSourcesFromApi();
      this._loadCategoriesFromApi();

      // Đăng ký nav-item vừa được thêm vào hệ thống nav-item chung của UIManager
      const btn = document.querySelector('.nav-item[data-view="news"]');
      if (btn && window.UIManager) {
        btn.addEventListener('click', () => UIManager.navigate('news'));
      }
      if (window.UIManager) {
        if (!UIManager.titles.news) {
          UIManager.titles.news = ['Đọc báo', 'Tổng hợp tin tức tài chính - kinh tế - chứng khoán, cập nhật realtime'];
        }
        const _origNavigate = UIManager.navigate.bind(UIManager);
        UIManager.navigate = (view) => {
          const result = _origNavigate(view);
          if (view === 'news') this._onEnterView();
          else NewsRealtime.stop();
          return result;
        };
      }
    },

    _onEnterView() {
      NewsRealtime.start();
      if (!this._firstLoadDone) { this.reload(); this._firstLoadDone = true; }
    },

    async _loadSourcesFromApi() {
      try {
        const res = await NewsAPI.getSources();
        const list = Array.isArray(res) ? res : (res && res.items) || [];
        if (list.length) {
          NewsUI.sources = list.map(s => ({ icon: 'fa-newspaper', color: '#1478d4', ...s }));
          NewsUI.renderSourcesPanel();
        }
      } catch (e) { /* backend chưa sẵn sàng — vẫn dùng DEFAULT_SOURCES để UI hoạt động được */ }
    },

    async _loadCategoriesFromApi() {
      try {
        const res = await NewsAPI.getCategories();
        const list = Array.isArray(res) ? res : (res && res.items) || [];
        NewsUI.categories = list;
        NewsUI.renderCategoryChips();
      } catch (e) { /* im lặng — không có chuyên mục cũng không chặn luồng chính */ }
    },

    /** Tải lại từ đầu (khi đổi search/filter) */
    async reload() {
      NewsUI.page = 1;
      NewsUI.hasMore = true;
      this._updateFilterCountDot();
      NewsUI.loading = true;
      NewsUI.showSkeleton();
      try {
        const data = await this._fetchPage(1);
        NewsUI.setArticles(data.items, false);
        NewsUI.hasMore = !!data.hasMore;
        NewsCache.saveListPage(this._cacheKey(1), data.items); // cache offline
      } catch (e) {
        const cached = await NewsCache.getListPage(this._cacheKey(1));
        if (cached) {
          NewsUI.setArticles(cached.items, false);
          if (window.UIManager) UIManager.toast('warn', 'Chế độ ngoại tuyến', 'Đang hiển thị dữ liệu đã lưu trước đó');
        } else {
          NewsUI.setArticles([], false);
          if (window.UIManager) UIManager.toast('error', 'Lỗi tải dữ liệu', 'Không thể kết nối máy chủ tin tức');
        }
      }
      NewsUI.loading = false;
    },

    async loadMore() {
      if (NewsUI.loading || !NewsUI.hasMore) return;
      NewsUI.loading = true;
      document.getElementById('newsLoadingMore').style.display = 'flex';
      const nextPage = NewsUI.page + 1;
      try {
        const data = await this._fetchPage(nextPage);
        if (data.items && data.items.length) {
          NewsUI.page = nextPage;
          NewsUI.setArticles(data.items, true);
        }
        NewsUI.hasMore = !!data.hasMore;
      } catch (e) {
        if (window.UIManager) UIManager.toast('error', 'Lỗi tải thêm', 'Không thể tải thêm bài viết, thử lại sau');
      }
      document.getElementById('newsLoadingMore').style.display = 'none';
      NewsUI.loading = false;
    },

    async _fetchPage(page) {
      const params = NewsSearch.buildParams(page);
      const res = NewsSearch.isSearching() ? await NewsAPI.search(params) : await NewsAPI.getList(params);
      // Chuẩn hoá response — backend có thể trả {items,hasMore,total} hoặc mảng thô
      if (Array.isArray(res)) return { items: res, hasMore: res.length >= NEWS_CONFIG.PAGE_SIZE };
      return { items: res.items || [], hasMore: res.hasMore ?? (res.items && res.items.length >= NEWS_CONFIG.PAGE_SIZE) };
    },

    _cacheKey(page) {
      return 'list:' + JSON.stringify(NewsSearch.state) + ':' + page;
    },

    /** Khi bấm badge "Có bài mới" — nạp bài mới nhất và đưa lên đầu danh sách */
    async prependNew() {
      try {
        const res = await NewsAPI.getLatest({ since: NewsRealtime.lastCheckedAt, take: NewsRealtime.pendingCount });
        const items = (res && (res.items || res)) || [];
        items.forEach(it => it.isNew = true);
        NewsUI.setArticles(items.concat(NewsUI.articles), false);
      } catch (e) { await this.reload(); /* nếu lỗi thì reload toàn bộ cho chắc */ }
      NewsRealtime.resetPending();
      NewsUI.hideNewBadge();
    },

    _updateFilterCountDot() {
      const s = NewsSearch.state;
      let n = 0;
      if (s.sources.length) n += s.sources.length;
      if (s.category) n += 1;
      if (s.timeRange !== 'all') n += 1;
      const dot = document.getElementById('newsFilterCountDot');
      if (!dot) return;
      dot.style.display = n ? 'flex' : 'none';
      dot.textContent = n;
    },

    /** Hiển thị danh sách Đã lưu (bookmark) hoặc Lịch sử đọc (history) ngay trong lưới hiện có */
    showSavedList(type) {
      const list = type === 'bookmark' ? NewsBookmark.listBookmarks() : NewsHistory.list();
      if (!list.length) {
        if (window.UIManager) UIManager.toast('warn', 'Trống', type === 'bookmark' ? 'Bạn chưa lưu bài viết nào' : 'Bạn chưa đọc bài viết nào');
        return;
      }
      const mapped = list.map(x => ({ ...x, description: '', publishTime: new Date(x.savedAt || x.readAt).toISOString() }));
      NewsUI.setArticles(mapped, false);
      NewsUI.hasMore = false;
      if (window.UIManager) UIManager.toast('success', type === 'bookmark' ? 'Bài đã lưu' : 'Lịch sử đọc', `Hiển thị ${list.length} bài`);
    }
  };

  /* ==========================================================================
     11. TỰ KHỞI TẠO — không cần gọi tay, tự chạy khi DOM sẵn sàng
     ========================================================================== */
  function bootstrap() { NewsManager.init(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Expose ra global để có thể mở rộng / debug từ console, đồng bộ cách làm
  // của CommunitySync/CommunityExamUI đã có trong trang (window.CommunitySync = ...)
  window.NewsManager = NewsManager;
  window.NewsAPI = NewsAPI;
  window.NewsUI = NewsUI;
  window.NewsSearch = NewsSearch;
  window.NewsReader = NewsReader;
  window.NewsBookmark = NewsBookmark;
  window.NewsHistory = NewsHistory;
  window.NewsCache = NewsCache;
  window.NewsRealtime = NewsRealtime;
  window.NewsUtils = NewsUtils;

})();
