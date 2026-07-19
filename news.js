/**
 * ============================================================================
 *  news.js — Module "📰 Đọc báo" (Google-News-mini) cho Sidebar
 * ============================================================================
 *  - Thuần JavaScript ES6+, KHÔNG framework, KHÔNG thư viện ngoài.
 *  - KHÔNG cần sửa HTML/CSS hiện có. Chỉ cần thêm:
 *        <script src="news.js"></script>
 *    Module sẽ tự tạo giao diện, tự bind sự kiện, tự tải dữ liệu và chạy ngay.
 *
 *  Tương thích với cấu trúc trang hiện tại:
 *    - Sidebar nav:   <nav class="sidebar-nav"> ... <button class="nav-item" data-view="..">
 *    - Nội dung view: <main class="content"> <section class="view" id="view-..">
 *    - Điều hướng:    window.UIManager.navigate(view)  (nếu tồn tại, module sẽ dùng
 *                     lại để giữ đồng bộ với toàn bộ app; nếu không tồn tại module
 *                     tự vận hành cơ chế điều hướng riêng cho view "news").
 *    - Theme:         document.documentElement.getAttribute('data-theme') === 'dark'
 *                     Toàn bộ màu sắc dùng CSS variables sẵn có (--accent, --card-bg,
 *                     --text-main, --card-border, ...) nên tự thích ứng dark/light.
 * ============================================================================
 */

(() => {
  'use strict';

  /* ==========================================================================
   * 1. CONFIG — Toàn bộ cấu hình tĩnh của module. Sửa ở đây để thêm/xoá nguồn,
   *    đổi RSS Proxy, đổi tốc độ refresh ... mà không đụng tới phần code khác.
   * ========================================================================== */
  const NewsConfig = Object.freeze({
    // Danh sách nguồn tin. Thêm/xoá 1 phần tử = thêm/xoá 1 nguồn báo.
    SOURCES: [
      { id: 'vnexpress',   name: 'VNExpress',            rss: 'https://vnexpress.net/rss/tin-moi-nhat.rss',              category: 'Tổng hợp'   },
      { id: 'cafef',       name: 'CafeF',                 rss: 'https://cafef.vn/home.rss',                               category: 'Kinh tế'    },
      { id: 'cafebiz',     name: 'CafeBiz',               rss: 'https://cafebiz.vn/rss/home.rss',                         category: 'Kinh doanh' },
      { id: 'vneconomy',   name: 'VnEconomy',             rss: 'https://vneconomy.vn/tin-moi.rss',                        category: 'Kinh tế'    },
      { id: 'baodautu',    name: 'Báo Đầu Tư',            rss: 'https://baodautu.vn/rss/tin-moi-nhat.rss',                category: 'Đầu tư'     },
      { id: 'saigontimes', name: 'The Saigon Times',      rss: 'https://thesaigontimes.vn/feed/',                         category: 'Kinh tế'    },
      { id: 'vietstock',   name: 'Vietstock',             rss: 'https://vietstock.vn/rss/tin-moi.rss',                    category: 'Chứng khoán'},
      { id: 'vnfinance',   name: 'VietnamFinance',        rss: 'https://vietnamfinance.vn/rss/home.rss',                  category: 'Tài chính'  },
      { id: 'stockbiz',    name: 'Stockbiz',              rss: 'https://www.stockbiz.vn/rss.aspx',                        category: 'Chứng khoán'},
      { id: 'tnck',        name: 'Tin Nhanh Chứng Khoán', rss: 'https://www.tinnhanhchungkhoan.vn/rss/trang-chu.rss',     category: 'Chứng khoán'},
      { id: 'ktck',        name: 'Kinh Tế Chứng Khoán',   rss: 'https://kinhtechungkhoan.vn/rss/home.rss',                category: 'Chứng khoán'},
      { id: 'baomoi',      name: 'Báo Mới',               rss: 'https://baomoi.com/rss/home.rss',                         category: 'Tổng hợp'   },
      { id: 'thoibaokt',   name: 'Thời báo Kinh tế',      rss: 'https://thoibaokinhdoanh.vn/rss/home.rss',                category: 'Kinh tế'    },
      { id: 'nguoiquansat',name: 'Người Quan Sát',        rss: 'https://nguoiquansat.vn/rss/home.rss',                    category: 'Tài chính'  }
    ],

    // ---- RSS PROXY (đa proxy, tự chuyển khi lỗi) ------------------------
    // Muốn thêm/xoá/đổi thứ tự ưu tiên proxy chỉ cần sửa mảng này.
    // mode: 'xml'  -> proxy trả nguyên văn RSS/XML, parse bằng DOMParser
    //       'json' -> proxy trả JSON đã bọc sẵn (vd rss2json), đọc field items
    //       'auto' -> không chắc proxy trả gì: thử parse JSON trước, thất bại thì parse XML
    RSS_PROXY_LIST: [
      { name: 'codetabs',    url: 'https://api.codetabs.com/v1/proxy?quest=',        mode: 'xml'  },
      { name: 'allorigins',  url: 'https://api.allorigins.win/raw?url=',              mode: 'xml'  },
      { name: 'corsproxy',   url: 'https://corsproxy.io/?url=',                       mode: 'auto' },
      { name: 'rss2json',    url: 'https://api.rss2json.com/v1/api.json?rss_url=',    mode: 'json' }
    ],

    FETCH_TIMEOUT_MS: 15000,      // timeout mỗi request nguồn tin
    REFRESH_INTERVAL_MS: 60000,   // tự refresh mỗi 60s khi tab đang mở
    PAGE_SIZE: 12,                 // số bài render mỗi lượt (infinite scroll)
    MAX_STORE_SIZE: 600,          // giới hạn số bài lưu trong bộ nhớ/localStorage
    MAX_HISTORY: 200,             // giới hạn lịch sử đã đọc

    STORAGE_KEYS: {
      CACHE: 'newsReader.cache.v1',
      BOOKMARKS: 'newsReader.bookmarks.v1',
      HISTORY: 'newsReader.history.v1',
      PREFS: 'newsReader.prefs.v1'
    },

    SEARCH_DEBOUNCE_MS: 300,
    SCROLL_THROTTLE_MS: 150
  });

  /* ==========================================================================
   * 2. UTILS — Các hàm tiện ích dùng chung: debounce, throttle, format thời
   *    gian, escape HTML, chuẩn hoá chuỗi (bỏ dấu) để tìm kiếm, sinh id...
   * ========================================================================== */
  class NewsUtils {
    /** Trì hoãn thực thi fn cho tới khi ngừng gọi trong `wait` ms. */
    static debounce(fn, wait) {
      let t = null;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
      };
    }

    /** Giới hạn tần suất gọi fn tối đa 1 lần mỗi `wait` ms. */
    static throttle(fn, wait) {
      let last = 0;
      let timer = null;
      return (...args) => {
        const now = Date.now();
        const remaining = wait - (now - last);
        if (remaining <= 0) {
          last = now;
          fn.apply(null, args);
        } else {
          clearTimeout(timer);
          timer = setTimeout(() => {
            last = Date.now();
            fn.apply(null, args);
          }, remaining);
        }
      };
    }

    /** Escape HTML để tránh XSS khi render dữ liệu lấy từ RSS. */
    static escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    /** Bỏ thẻ HTML còn sót trong description của RSS, trả về text thuần. */
    static stripHtml(html) {
      if (!html) return '';
      const div = document.createElement('div');
      div.innerHTML = html;
      return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
    }

    /** Chuẩn hoá chuỗi tiếng Việt: bỏ dấu + lowercase, phục vụ tìm kiếm mờ. */
    static normalize(str) {
      if (!str) return '';
      return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .trim();
    }

    /** Sinh id ổn định từ link/guid/title để phục vụ dedupe & lưu trữ. */
    static makeId(link, guid, title) {
      const base = (guid || link || title || '').toString();
      let hash = 0;
      for (let i = 0; i < base.length; i++) {
        hash = (hash * 31 + base.charCodeAt(i)) | 0;
      }
      return 'n' + Math.abs(hash).toString(36);
    }

    /** Định dạng "X phút trước / X giờ trước / dd/mm/yyyy". */
    static timeAgo(dateStr) {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      const diffMs = Date.now() - date.getTime();
      const min = Math.floor(diffMs / 60000);
      if (min < 1) return 'Vừa xong';
      if (min < 60) return `${min} phút trước`;
      const hour = Math.floor(min / 60);
      if (hour < 24) return `${hour} giờ trước`;
      const day = Math.floor(hour / 24);
      if (day < 7) return `${day} ngày trước`;
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }

    /** Trích ảnh thumbnail từ enclosure/media:content hoặc <img> trong description. */
    static extractThumbnail(item) {
      if (item.enclosure) return item.enclosure;
      if (item.mediaContent) return item.mediaContent;
      const desc = item.rawDescription || '';
      const match = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      return match ? match[1] : '';
    }

    /** Kiểm tra thời điểm bài viết có nằm trong khoảng lọc (today/week/all). */
    static isWithinRange(dateStr, range) {
      if (!range || range === 'all') return true;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return true;
      const now = new Date();
      if (range === 'today') {
        return date.getFullYear() === now.getFullYear() &&
               date.getMonth() === now.getMonth() &&
               date.getDate() === now.getDate();
      }
      if (range === 'week') {
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        return (now.getTime() - date.getTime()) <= weekMs;
      }
      return true;
    }

    static isDarkMode() {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }
  }

  /* ==========================================================================
   * 3. NewsAPI — Lấy dữ liệu qua RSS Proxy (KHÔNG scrape, KHÔNG iframe).
   *    Đổi/thêm/bớt proxy chỉ cần sửa NewsConfig.RSS_PROXY_LIST.
   * ========================================================================== */
  class NewsAPI {
    /**
     * Lấy & chuẩn hoá tin từ 1 nguồn, thử lần lượt từng RSS Proxy trong
     * NewsConfig.RSS_PROXY_LIST. Proxy đầu lỗi (timeout/HTTP lỗi/parse lỗi)
     * -> tự động chuyển sang proxy tiếp theo. Chỉ khi TẤT CẢ proxy đều lỗi
     * mới ném lỗi ra ngoài (để tầng gọi biết "nguồn lỗi").
     */
    static async fetchSource(source) {
      const proxies = NewsConfig.RSS_PROXY_LIST;
      let lastError = null;

      for (const proxy of proxies) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NewsConfig.FETCH_TIMEOUT_MS);
        try {
          const proxied = proxy.url + encodeURIComponent(source.rss);
          const res = await fetch(proxied, { signal: controller.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const text = await res.text();
          const items = NewsAPI._parseByMode(text, proxy.mode);

          // Parse ra 0 bài dù response OK vẫn coi là nghi ngờ lỗi -> thử proxy khác,
          // trừ khi đây là proxy cuối cùng thì chấp nhận trả về mảng rỗng.
          if (items.length === 0 && proxy !== proxies[proxies.length - 1]) {
            throw new Error('Không phân tích được bài viết nào (proxy có thể đã chặn)');
          }

          return items.map(it => NewsAPI._normalize(it, source));
        } catch (err) {
          lastError = err;
          // Thử tiếp proxy kế tiếp trong danh sách, không dừng cả module.
          continue;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // Tất cả proxy đều lỗi -> báo nguồn này lỗi, nhưng KHÔNG làm crash các nguồn khác
      // (Promise.allSettled ở fetchAll đã cô lập lỗi theo từng nguồn).
      throw new Error(`[${source.name}] Tất cả RSS Proxy đều lỗi — ${(lastError && lastError.message) || 'không rõ nguyên nhân'}`);
    }

    /** Phân giải nội dung trả về theo mode của proxy ('xml' | 'json' | 'auto'). */
    static _parseByMode(text, mode) {
      if (mode === 'json') {
        return NewsAPI._parseJsonFeed(JSON.parse(text));
      }
      if (mode === 'xml') {
        return NewsAPI._parseXmlFeed(text);
      }
      // 'auto' — Auto Detect: thử JSON trước (rss2json/nhiều proxy khác trả JSON),
      // nếu không phải JSON hợp lệ thì coi là XML và parse bằng DOMParser.
      try {
        const data = JSON.parse(text);
        return NewsAPI._parseJsonFeed(data);
      } catch (e) {
        return NewsAPI._parseXmlFeed(text);
      }
    }

    /**
     * Lấy tất cả nguồn. Để tránh dội cùng lúc hàng chục request vào CÙNG một
     * proxy dùng chung (dễ bị giới hạn tần suất phía proxy), mỗi nguồn được
     * khởi động cách nhau một khoảng rất nhỏ (staggered start) thay vì bắn
     * đồng thời 100% — nhưng vẫn chạy song song và không nguồn nào chặn nguồn nào
     * (Promise.allSettled).
     */
    static async fetchAll(sources) {
      const STAGGER_MS = 120;
      const tasks = sources.map((s, i) => NewsAPI._delay(i * STAGGER_MS).then(() => NewsAPI.fetchSource(s)));
      const results = await Promise.allSettled(tasks);
      const articles = [];
      const errors = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          articles.push(...r.value);
        } else {
          errors.push({ source: sources[i], message: r.reason && r.reason.message });
        }
      });
      return { articles, errors };
    }

    static _delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Parse chế độ JSON (kiểu rss2json): { items: [{title,description,link,pubDate,guid,enclosure:{link}}] } */
    static _parseJsonFeed(data) {
      const list = (data && (data.items || data.entries)) || [];
      return list.map(it => ({
        title: it.title,
        rawDescription: it.description || it.content || '',
        link: it.link || it.url,
        pubDate: it.pubDate || it.published || it.date,
        guid: it.guid || it.id,
        enclosure: (it.enclosure && (it.enclosure.link || it.enclosure.url)) || it.thumbnail || ''
      }));
    }

    /** Parse chế độ XML thuần (RSS 2.0) bằng DOMParser. */
    static _parseXmlFeed(xmlText) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('XML không hợp lệ');
      }
      const nodes = Array.from(doc.querySelectorAll('item'));
      return nodes.map(node => {
        const get = (tag) => {
          const el = node.querySelector(tag);
          return el ? el.textContent.trim() : '';
        };
        let enclosure = '';
        const encEl = node.querySelector('enclosure');
        if (encEl && encEl.getAttribute('url')) enclosure = encEl.getAttribute('url');
        const mediaEl = node.getElementsByTagName('media:content')[0] ||
                         node.getElementsByTagName('media:thumbnail')[0];
        const mediaContent = mediaEl ? mediaEl.getAttribute('url') : '';
        return {
          title: get('title'),
          rawDescription: get('description') || get('content:encoded'),
          link: get('link'),
          pubDate: get('pubDate') || get('date'),
          guid: get('guid'),
          enclosure: enclosure || mediaContent,
          category: get('category')
        };
      });
    }

    /** Chuẩn hoá 1 item thô thành cấu trúc article dùng chung toàn app. */
    static _normalize(raw, source) {
      const id = NewsUtils.makeId(raw.link, raw.guid, raw.title);
      return {
        id,
        title: (raw.title || '').trim(),
        description: NewsUtils.stripHtml(raw.rawDescription).slice(0, 260),
        link: raw.link || '',
        guid: raw.guid || '',
        source: source.name,
        sourceId: source.id,
        category: raw.category || source.category,
        pubDate: raw.pubDate || '',
        pubTime: (() => { const t = new Date(raw.pubDate).getTime(); return isNaN(t) ? Date.now() : t; })(),
        thumbnail: NewsUtils.extractThumbnail(raw),
        fetchedAt: Date.now()
      };
    }
  }

  /* ==========================================================================
   * 4. NewsCache — Lưu/đọc cache trong localStorage để mở lại thấy ngay dữ liệu.
   * ========================================================================== */
  class NewsCache {
    static load() {
      try {
        const raw = localStorage.getItem(NewsConfig.STORAGE_KEYS.CACHE);
        if (!raw) return { articles: [], updatedAt: 0 };
        const parsed = JSON.parse(raw);
        return { articles: Array.isArray(parsed.articles) ? parsed.articles : [], updatedAt: parsed.updatedAt || 0 };
      } catch (e) {
        console.warn('[NewsCache] Không đọc được cache:', e);
        return { articles: [], updatedAt: 0 };
      }
    }

    static save(articles) {
      try {
        const trimmed = articles.slice(0, NewsConfig.MAX_STORE_SIZE);
        localStorage.setItem(NewsConfig.STORAGE_KEYS.CACHE, JSON.stringify({
          articles: trimmed,
          updatedAt: Date.now()
        }));
      } catch (e) {
        console.warn('[NewsCache] Không lưu được cache (có thể đầy quota):', e);
      }
    }
  }

  /* ==========================================================================
   * 5. NewsStore — Nguồn chân lý duy nhất về danh sách bài viết trong bộ nhớ.
   *    Chịu trách nhiệm dedupe (theo title/url/guid) và sắp xếp.
   * ========================================================================== */
  class NewsStore {
    constructor() {
      /** @type {Map<string, object>} id -> article */
      this.map = new Map();
    }

    get size() { return this.map.size; }

    /** Nạp danh sách ban đầu (từ cache) vào store, không tính là "mới". */
    hydrate(articles) {
      articles.forEach(a => this.map.set(a.id, a));
    }

    /**
     * Thêm các bài viết mới, tự động loại trùng theo id (đã gồm guid/link/title).
     * Trả về mảng các bài THỰC SỰ mới (chưa từng có trong store) để hiển thị badge/toast.
     */
    merge(newArticles) {
      const added = [];
      for (const a of newArticles) {
        if (!this.map.has(a.id)) {
          this.map.set(a.id, a);
          added.push(a);
        }
      }
      // Giới hạn kích thước store để tránh phình bộ nhớ vô hạn.
      if (this.map.size > NewsConfig.MAX_STORE_SIZE) {
        const all = this.getAll().sort((x, y) => y.pubTime - x.pubTime);
        this.map.clear();
        all.slice(0, NewsConfig.MAX_STORE_SIZE).forEach(a => this.map.set(a.id, a));
      }
      return added;
    }

    getAll() { return Array.from(this.map.values()); }

    getById(id) { return this.map.get(id); }
  }

  /* ==========================================================================
   * 6. NewsSearch — Bộ tìm kiếm realtime có debounce, tìm theo nhiều field.
   * ========================================================================== */
  class NewsSearch {
    constructor(onChange) {
      this.query = '';
      this._debouncedNotify = NewsUtils.debounce(() => onChange(this.query), NewsConfig.SEARCH_DEBOUNCE_MS);
    }

    setQuery(q) {
      this.query = q || '';
      this._debouncedNotify();
    }

    /** Kiểm tra 1 article có khớp query hiện tại không (title/desc/source/category). */
    matches(article) {
      if (!this.query) return true;
      const q = NewsUtils.normalize(this.query);
      const haystack = NewsUtils.normalize(
        `${article.title} ${article.description} ${article.source} ${article.category}`
      );
      return haystack.includes(q);
    }
  }

  /* ==========================================================================
   * 7. NewsFilter — Lọc theo nguồn báo + khoảng thời gian, sắp xếp mới/cũ.
   * ========================================================================== */
  class NewsFilter {
    constructor() {
      this.sourceId = 'all';   // 'all' hoặc source.id
      this.category = 'all';   // 'all' hoặc tên chuyên mục
      this.range = 'all';      // 'all' | 'today' | 'week'
      this.sort = 'newest';    // 'newest' | 'oldest' | 'source'
    }

    apply(articles) {
      let result = articles.filter(a => {
        const okSource = this.sourceId === 'all' || a.sourceId === this.sourceId;
        const okCategory = this.category === 'all' || a.category === this.category;
        const okRange = NewsUtils.isWithinRange(a.pubDate, this.range);
        return okSource && okCategory && okRange;
      });
      if (this.sort === 'oldest') {
        result.sort((a, b) => a.pubTime - b.pubTime);
      } else if (this.sort === 'source') {
        result.sort((a, b) => a.source.localeCompare(b.source, 'vi') || b.pubTime - a.pubTime);
      } else {
        result.sort((a, b) => b.pubTime - a.pubTime);
      }
      return result;
    }
  }

  /* ==========================================================================
   * 8. NewsBookmark — Lưu bài đã bookmark vào localStorage.
   * ========================================================================== */
  class NewsBookmark {
    constructor() {
      this.ids = new Set(this._load());
    }

    _load() {
      try {
        const raw = localStorage.getItem(NewsConfig.STORAGE_KEYS.BOOKMARKS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    }

    _persist() {
      try {
        localStorage.setItem(NewsConfig.STORAGE_KEYS.BOOKMARKS, JSON.stringify(Array.from(this.ids)));
      } catch (e) { console.warn('[NewsBookmark] Lưu thất bại:', e); }
    }

    has(id) { return this.ids.has(id); }

    toggle(id) {
      if (this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
      this._persist();
      return this.ids.has(id);
    }

    getIds() { return Array.from(this.ids); }
  }

  /* ==========================================================================
   * 9. NewsHistory — Lưu "Đã đọc gần đây" (recently read) vào localStorage.
   * ========================================================================== */
  class NewsHistory {
    constructor() {
      this.entries = this._load(); // [{id, readAt}], mới nhất ở đầu
    }

    _load() {
      try {
        const raw = localStorage.getItem(NewsConfig.STORAGE_KEYS.HISTORY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    }

    _persist() {
      try {
        localStorage.setItem(NewsConfig.STORAGE_KEYS.HISTORY, JSON.stringify(this.entries));
      } catch (e) { console.warn('[NewsHistory] Lưu thất bại:', e); }
    }

    record(id) {
      this.entries = this.entries.filter(e => e.id !== id);
      this.entries.unshift({ id, readAt: Date.now() });
      if (this.entries.length > NewsConfig.MAX_HISTORY) {
        this.entries = this.entries.slice(0, NewsConfig.MAX_HISTORY);
      }
      this._persist();
    }

    has(id) { return this.entries.some(e => e.id === id); }

    getIds() { return this.entries.map(e => e.id); }
  }

  /* ==========================================================================
   * 10. NewsRenderer — Toàn bộ việc dựng DOM: layout, skeleton, card, lazy
   *     image, infinite scroll (virtual render theo trang).
   * ========================================================================== */
  class NewsRenderer {
    constructor(root, manager) {
      this.root = root;           // element gốc của view "news"
      this.manager = manager;     // tham chiếu ngược tới NewsManager
      this.renderedCount = 0;     // số bài đã render (cho infinite scroll)
      this._imgObserver = null;
      this._scrollObserver = null;
      this._buildLayout();
    }

    /** Dựng khung giao diện tĩnh 1 lần: header, search, filter, list container... */
    _buildLayout() {
      this.root.innerHTML = `
        <div class="news-app">
          <div class="news-toolbar">
            <div class="news-search-wrap">
              <i class="fa-solid fa-magnifying-glass news-search-icon"></i>
              <input type="text" class="news-search-input" placeholder="Tìm theo tiêu đề, mô tả, nguồn, chuyên mục..." autocomplete="off">
            </div>
            <button class="news-btn news-refresh-btn" title="Làm mới">
              <i class="fa-solid fa-rotate"></i><span class="news-refresh-label">Làm mới</span>
            </button>
          </div>

          <div class="news-filters">
            <select class="news-select" data-role="source-filter">
              <option value="all">Tất cả nguồn</option>
              ${NewsConfig.SOURCES.map(s => `<option value="${s.id}">${NewsUtils.escapeHtml(s.name)}</option>`).join('')}
            </select>
            <select class="news-select" data-role="category-filter">
              <option value="all">Tất cả chuyên mục</option>
              ${Array.from(new Set(NewsConfig.SOURCES.map(s => s.category))).map(c => `<option value="${NewsUtils.escapeHtml(c)}">${NewsUtils.escapeHtml(c)}</option>`).join('')}
            </select>
            <select class="news-select" data-role="range-filter">
              <option value="all">Mọi thời điểm</option>
              <option value="today">Hôm nay</option>
              <option value="week">7 ngày qua</option>
            </select>
            <select class="news-select" data-role="sort-filter">
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="source">Theo báo</option>
            </select>
            <button class="news-chip" data-role="bookmark-toggle" title="Xem bài đã lưu">
              <i class="fa-regular fa-bookmark"></i> Đã lưu <span class="news-chip-count" data-role="bookmark-count">0</span>
            </button>
            <button class="news-chip" data-role="history-toggle" title="Xem lịch sử đọc">
              <i class="fa-solid fa-clock-rotate-left"></i> Đã đọc
            </button>
          </div>

          <div class="news-stats" data-role="stats">
            <div class="news-stat-item"><i class="fa-solid fa-newspaper"></i><span data-role="stat-total">0</span> bài</div>
            <div class="news-stat-item"><i class="fa-solid fa-layer-group"></i><span data-role="stat-sources">0</span> nguồn</div>
            <div class="news-stat-item"><i class="fa-solid fa-bookmark"></i><span data-role="stat-bookmarks">0</span> đã lưu</div>
            <div class="news-stat-item"><i class="fa-solid fa-calendar-day"></i><span data-role="stat-today">0</span> bài hôm nay</div>
          </div>

          <div class="news-new-banner" data-role="new-banner" hidden>
            <i class="fa-solid fa-arrow-up"></i>
            <span data-role="new-banner-text">Có bài mới</span>
          </div>

          <div class="news-list" data-role="list"></div>
          <div class="news-sentinel" data-role="sentinel"></div>
          <div class="news-empty" data-role="empty" hidden>
            <i class="fa-regular fa-newspaper"></i>
            <p>Không tìm thấy bài viết nào phù hợp.</p>
          </div>
          <div class="news-error" data-role="error" hidden>
            <i class="fa-solid fa-triangle-exclamation"></i>
            <p data-role="error-text">Đã xảy ra lỗi khi tải tin.</p>
            <button class="news-btn" data-role="retry-btn">Thử lại</button>
          </div>
        </div>
      `;

      this.el = {
        search: this.root.querySelector('.news-search-input'),
        refreshBtn: this.root.querySelector('.news-refresh-btn'),
        sourceFilter: this.root.querySelector('[data-role="source-filter"]'),
        categoryFilter: this.root.querySelector('[data-role="category-filter"]'),
        rangeFilter: this.root.querySelector('[data-role="range-filter"]'),
        sortFilter: this.root.querySelector('[data-role="sort-filter"]'),
        statTotal: this.root.querySelector('[data-role="stat-total"]'),
        statSources: this.root.querySelector('[data-role="stat-sources"]'),
        statBookmarks: this.root.querySelector('[data-role="stat-bookmarks"]'),
        statToday: this.root.querySelector('[data-role="stat-today"]'),
        bookmarkToggle: this.root.querySelector('[data-role="bookmark-toggle"]'),
        bookmarkCount: this.root.querySelector('[data-role="bookmark-count"]'),
        historyToggle: this.root.querySelector('[data-role="history-toggle"]'),
        newBanner: this.root.querySelector('[data-role="new-banner"]'),
        newBannerText: this.root.querySelector('[data-role="new-banner-text"]'),
        list: this.root.querySelector('[data-role="list"]'),
        sentinel: this.root.querySelector('[data-role="sentinel"]'),
        empty: this.root.querySelector('[data-role="empty"]'),
        error: this.root.querySelector('[data-role="error"]'),
        errorText: this.root.querySelector('[data-role="error-text"]'),
        retryBtn: this.root.querySelector('[data-role="retry-btn"]')
      };

      this._setupLazyImageObserver();
      this._setupInfiniteScrollObserver();
    }

    /** IntersectionObserver dùng chung để lazy-load ảnh (data-src -> src + fade). */
    _setupLazyImageObserver() {
      this._imgObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          const src = img.getAttribute('data-src');
          if (src) {
            img.src = src;
            img.addEventListener('load', () => img.classList.add('news-img-loaded'), { once: true });
            img.removeAttribute('data-src');
          }
          obs.unobserve(img);
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
    }

    /** IntersectionObserver theo dõi sentinel cuối danh sách -> infinite scroll. */
    _setupInfiniteScrollObserver() {
      this._scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) this.manager.loadMore();
        });
      }, { root: null, rootMargin: '300px 0px', threshold: 0 });
      this._scrollObserver.observe(this.el.sentinel);
    }

    /** Hiện skeleton loading (chỉ dùng lần tải đầu, khi list còn trống). */
    showSkeleton(count = 6) {
      this.el.empty.hidden = true;
      this.el.error.hidden = true;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const sk = document.createElement('div');
        sk.className = 'news-card news-skeleton';
        sk.innerHTML = `
          <div class="news-skel-thumb"></div>
          <div class="news-skel-body">
            <div class="news-skel-line news-skel-line-title"></div>
            <div class="news-skel-line"></div>
            <div class="news-skel-line news-skel-line-short"></div>
          </div>`;
        frag.appendChild(sk);
      }
      this.el.list.innerHTML = '';
      this.el.list.appendChild(frag);
    }

    showError(message) {
      this.el.error.hidden = false;
      this.el.errorText.textContent = message || 'Không thể tải tin tức. Vui lòng thử lại.';
    }

    hideError() { this.el.error.hidden = true; }

    /**
     * Render lại toàn bộ danh sách từ đầu (dùng khi đổi filter/search/sort).
     * Reset về trang đầu tiên (virtual render theo PAGE_SIZE).
     */
    renderList(articles) {
      this._fullList = articles;
      this.renderedCount = 0;
      this.el.list.innerHTML = '';
      this.el.list.scrollTop = 0;
      if (!articles.length) {
        this.el.empty.hidden = false;
        return;
      }
      this.el.empty.hidden = true;
      this.appendNextPage();
    }

    /** Render thêm 1 trang (PAGE_SIZE bài) tiếp theo — phục vụ infinite scroll. */
    appendNextPage() {
      if (!this._fullList) return;
      const next = this._fullList.slice(this.renderedCount, this.renderedCount + NewsConfig.PAGE_SIZE);
      if (!next.length) return;
      const frag = document.createDocumentFragment();
      next.forEach(article => frag.appendChild(this._buildCard(article)));
      this.el.list.appendChild(frag);
      this.renderedCount += next.length;
    }

    hasMore() {
      return !!this._fullList && this.renderedCount < this._fullList.length;
    }

    /** Chèn các bài mới lên đầu danh sách (khi user bấm banner "Có bài mới"), có animation. */
    prependArticles(articles) {
      if (!articles.length) return;
      const frag = document.createDocumentFragment();
      articles.forEach(article => {
        const card = this._buildCard(article, /*isNew*/ true);
        card.classList.add('news-card-enter');
        frag.appendChild(card);
      });
      this.el.list.insertBefore(frag, this.el.list.firstChild);
      this.renderedCount += articles.length;
      if (this._fullList) this._fullList = [...articles, ...this._fullList];
      // Kích hoạt animation ở frame kế tiếp.
      requestAnimationFrame(() => {
        this.el.list.querySelectorAll('.news-card-enter').forEach(el => {
          el.classList.add('news-card-enter-active');
          setTimeout(() => el.classList.remove('news-card-enter', 'news-card-enter-active'), 700);
        });
      });
    }

    /** Dựng 1 thẻ (card) bài báo. */
    _buildCard(article, isNew) {
      const card = document.createElement('article');
      card.className = 'news-card';
      card.dataset.id = article.id;

      const isBookmarked = this.manager.bookmark.has(article.id);
      const wasRead = this.manager.history.has(article.id);
      const showNewBadge = isNew || (Date.now() - article.fetchedAt < 5 * 60 * 1000 && !wasRead);

      card.innerHTML = `
        <div class="news-card-thumb-wrap">
          <img class="news-card-thumb" alt="" data-src="${NewsUtils.escapeHtml(article.thumbnail || '')}"
               src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'/%3E">
          ${showNewBadge ? '<span class="news-badge-new">MỚI</span>' : ''}
        </div>
        <div class="news-card-body">
          <div class="news-card-meta">
            <span class="news-card-source">${NewsUtils.escapeHtml(article.source)}</span>
            <span class="news-card-dot">•</span>
            <span class="news-card-category">${NewsUtils.escapeHtml(article.category || '')}</span>
            <span class="news-card-dot">•</span>
            <span class="news-card-time">${NewsUtils.escapeHtml(NewsUtils.timeAgo(article.pubDate))}</span>
          </div>
          <h4 class="news-card-title ${wasRead ? 'news-card-title-read' : ''}">${NewsUtils.escapeHtml(article.title)}</h4>
          <p class="news-card-desc">${NewsUtils.escapeHtml(article.description)}</p>
          <div class="news-card-actions">
            <button class="news-btn news-btn-sm news-read-btn"><i class="fa-solid fa-arrow-up-right-from-square"></i> Đọc ngay</button>
            <button class="news-icon-btn news-bookmark-btn ${isBookmarked ? 'active' : ''}" title="Lưu bài viết">
              <i class="fa-${isBookmarked ? 'solid' : 'regular'} fa-bookmark"></i>
            </button>
            <button class="news-icon-btn news-share-btn" title="Chia sẻ bài viết">
              <i class="fa-solid fa-share-nodes"></i>
            </button>
          </div>
        </div>
      `;

      // Lazy load ảnh thật.
      const img = card.querySelector('.news-card-thumb');
      if (article.thumbnail) {
        this._imgObserver.observe(img);
      } else {
        img.classList.add('news-img-empty');
      }

      // Click mở bài / bookmark — xử lý qua NewsManager để tập trung logic.
      card.querySelector('.news-read-btn').addEventListener('click', () => this.manager.openArticle(article));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.news-bookmark-btn') || e.target.closest('.news-read-btn')) return;
        this.manager.openArticle(article);
      });
      card.querySelector('.news-bookmark-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.toggleBookmark(article, e.currentTarget);
      });
      card.querySelector('.news-share-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.shareArticle(article);
      });

      return card;
    }

    /** Hiện banner "Có N bài mới" phía trên danh sách, có badge + có thể click. */
    showNewBanner(count) {
      this.el.newBanner.hidden = false;
      this.el.newBannerText.textContent = `Có ${count} bài viết mới — Nhấn để xem`;
    }

    hideNewBanner() { this.el.newBanner.hidden = true; }

    updateBookmarkCount(n) { this.el.bookmarkCount.textContent = String(n); }

    /** Cập nhật thanh Thống kê: tổng số bài / số nguồn / số bookmark / số bài hôm nay. */
    updateStats({ total, sourceCount, bookmarkCount, todayCount }) {
      if (this.el.statTotal) this.el.statTotal.textContent = String(total);
      if (this.el.statSources) this.el.statSources.textContent = String(sourceCount);
      if (this.el.statBookmarks) this.el.statBookmarks.textContent = String(bookmarkCount);
      if (this.el.statToday) this.el.statToday.textContent = String(todayCount);
    }

    setRefreshingState(isRefreshing) {
      this.el.refreshBtn.classList.toggle('news-spinning', isRefreshing);
      this.el.refreshBtn.disabled = isRefreshing;
    }
  }

  /* ==========================================================================
   * 11. NewsRealtime — Quản lý vòng lặp tự refresh mỗi 60s + so sánh bài mới.
   * ========================================================================== */
  class NewsRealtime {
    constructor(onTick) {
      this.onTick = onTick;
      this.timerId = null;
    }

    start() {
      this.stop();
      this.timerId = setInterval(() => this.onTick(), NewsConfig.REFRESH_INTERVAL_MS);
    }

    stop() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }
  }

  /* ==========================================================================
   * 12. NewsManager — Orchestrator: gắn vào Sidebar/App, khởi tạo mọi thành
   *     phần trên, điều phối luồng dữ liệu (cache -> render -> fetch -> merge
   *     -> refresh định kỳ), xử lý toast + giữ nguyên vị trí cuộn khi có tin mới.
   * ========================================================================== */
  class NewsManager {
    constructor() {
      this.store = new NewsStore();
      this.filter = new NewsFilter();
      this.search = new NewsSearch((q) => this._refreshView());
      this.bookmark = new NewsBookmark();
      this.history = new NewsHistory();
      this.realtime = new NewsRealtime(() => this.silentRefresh());
      this.renderer = null;
      this._pendingNew = [];     // bài mới đang chờ user bấm "xem" để chèn lên đầu
      this._isViewActive = false;
      this._isLoading = false;
      this._bookmarkModeOn = false;
    }

    /** Điểm khởi động module — gọi 1 lần khi script được load. */
    init() {
      this._injectStyles();
      this._injectSidebarNavItem();
      this._injectViewSection();
      this._hydrateFromCache();
      this._bindNavigation();
      this._bindThemeObserver();
    }

    /* ---------------------------------------------------------------- DOM injection ---- */

    _injectStyles() {
      const style = document.createElement('style');
      style.id = 'news-module-styles';
      style.textContent = NEWS_MODULE_CSS;
      document.head.appendChild(style);
    }

    _injectSidebarNavItem() {
      const nav = document.querySelector('.sidebar-nav');
      if (!nav) { console.warn('[NewsManager] Không tìm thấy .sidebar-nav để chèn mục Đọc báo.'); return; }
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.view = 'news';
      btn.innerHTML = '<i class="fa-solid fa-newspaper"></i> Đọc báo <span class="badge" data-role="news-nav-badge" style="display:none;">0</span>';
      nav.appendChild(btn);
      this._navBadge = btn.querySelector('[data-role="news-nav-badge"]');
      btn.addEventListener('click', () => this._navigateToNews());
    }

    _injectViewSection() {
      const content = document.querySelector('main.content') || document.querySelector('.content');
      if (!content) { console.warn('[NewsManager] Không tìm thấy <main class="content"> để chèn view Đọc báo.'); return; }
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-news';
      content.appendChild(section);
      this.renderer = new NewsRenderer(section, this);
      this._bindToolbarEvents();
    }

    /** Điều hướng tới view "news", tận dụng UIManager.navigate nếu app có sẵn. */
    _navigateToNews() {
      if (window.UIManager && typeof window.UIManager.navigate === 'function') {
        if (window.UIManager.titles && !window.UIManager.titles.news) {
          window.UIManager.titles.news = ['Đọc báo', 'Tin tức tổng hợp từ nhiều nguồn báo, tự cập nhật mỗi phút'];
        }
        window.UIManager.navigate('news');
      } else {
        // Fallback tự vận hành nếu không có UIManager trong trang.
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById('view-news');
        if (target) target.classList.add('active');
        document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'news'));
      }
      this._onViewEnter();
    }

    /** Theo dõi việc chuyển sang view khác để dừng auto-refresh (tiết kiệm tài nguyên). */
    _bindNavigation() {
      document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        if (btn.dataset.view === 'news') return;
        btn.addEventListener('click', () => this._onViewLeave());
      });
    }

    /** Re-check theme khi user bật/tắt dark mode để cập nhật icon bookmark rỗng/đầy đúng màu (không cần vì dùng CSS var, nhưng vẫn theo dõi để mở rộng sau này). */
    _bindThemeObserver() {
      const observer = new MutationObserver(() => { /* CSS variables tự áp dụng, không cần thao tác thêm */ });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    _onViewEnter() {
      if (this._isViewActive) return;
      this._isViewActive = true;
      this._refreshView();
      if (this.store.size === 0) this.loadInitial();
      else this.silentRefresh();
      this.realtime.start();
    }

    _onViewLeave() {
      this._isViewActive = false;
      this.realtime.stop();
    }

    /* ---------------------------------------------------------------- Toolbar events ---- */

    _bindToolbarEvents() {
      const el = this.renderer.el;

      el.search.addEventListener('input', (e) => this.search.setQuery(e.target.value));

      el.refreshBtn.addEventListener('click', () => this.manualRefresh());

      el.sourceFilter.addEventListener('change', (e) => {
        this.filter.sourceId = e.target.value;
        this._refreshView();
      });
      el.categoryFilter.addEventListener('change', (e) => {
        this.filter.category = e.target.value;
        this._refreshView();
      });
      el.rangeFilter.addEventListener('change', (e) => {
        this.filter.range = e.target.value;
        this._refreshView();
      });
      el.sortFilter.addEventListener('change', (e) => {
        this.filter.sort = e.target.value;
        this._refreshView();
      });

      el.bookmarkToggle.addEventListener('click', () => {
        this._bookmarkModeOn = !this._bookmarkModeOn;
        el.bookmarkToggle.classList.toggle('active', this._bookmarkModeOn);
        this._refreshView();
      });

      el.historyToggle.addEventListener('click', () => this._showHistoryPanel());

      el.newBanner.addEventListener('click', () => {
        const toInsert = this._pendingNew;
        this._pendingNew = [];
        this.renderer.hideNewBanner();
        this._setNavBadge(0);
        this.renderer.prependArticles(toInsert);
      });

      el.retryBtn.addEventListener('click', () => this.manualRefresh());
    }

    /* ---------------------------------------------------------------- Data loading ------ */

    /** Nạp cache đã lưu (nếu có) để hiển thị NGAY khi user mở tab, trước khi có mạng. */
    _hydrateFromCache() {
      const { articles } = NewsCache.load();
      if (articles.length) this.store.hydrate(articles);
    }

    /** Lần tải đầu tiên: show skeleton rồi fetch toàn bộ nguồn. */
    async loadInitial() {
      if (this.store.size === 0) this.renderer.showSkeleton();
      await this._fetchAndMerge({ silent: false });
    }

    /** Refresh do user chủ động bấm nút — có trạng thái loading trên nút. */
    async manualRefresh() {
      if (this._isLoading) return;
      this.renderer.setRefreshingState(true);
      this.renderer.hideError();
      await this._fetchAndMerge({ silent: false });
      this.renderer.setRefreshingState(false);
    }

    /** Refresh nền mỗi 60s — KHÔNG hiện skeleton, KHÔNG làm mất vị trí cuộn. */
    async silentRefresh() {
      if (this._isLoading || !this._isViewActive) return;
      await this._fetchAndMerge({ silent: true });
    }

    /** Lõi tải dữ liệu: gọi NewsAPI, merge vào store, cache lại, cập nhật UI phù hợp. */
    async _fetchAndMerge({ silent }) {
      this._isLoading = true;
      try {
        const { articles, errors } = await NewsAPI.fetchAll(NewsConfig.SOURCES);

        if (!articles.length && errors.length && this.store.size === 0) {
          this.renderer.showError(`Không tải được tin tức (${errors.length} nguồn lỗi, đã thử toàn bộ RSS Proxy trong NewsConfig.RSS_PROXY_LIST).`);
          return;
        }

        const added = this.store.merge(articles);
        NewsCache.save(this.store.getAll().sort((a, b) => b.pubTime - a.pubTime));

        if (added.length === 0) {
          if (!silent) this._refreshView();
          return;
        }

        if (silent && this.store.size > added.length) {
          // Có tin mới trong lúc đang xem -> không chèn thẳng để KHÔNG làm mất vị trí cuộn.
          // Gom lại, hiện banner + badge + toast, chờ user chủ động bấm xem.
          this._pendingNew.push(...added);
          this.renderer.showNewBanner(this._pendingNew.length);
          this._setNavBadge(this._pendingNew.length);
          this._toast(`Có ${added.length} bài viết mới`);
        } else {
          // Tải lần đầu (chưa có gì trên màn hình) -> render thẳng luôn.
          this._refreshView();
        }

        if (errors.length) {
          const names = errors.map(e => e.source.name).join(', ');
          console.warn('[NewsManager] Các nguồn lỗi:', errors.map(e => `${e.source.name}: ${e.message}`));
          // Chỉ toast khi có bài (nếu không thì showError ở nhánh trên đã xử lý) —
          // tránh làm phiền người dùng khi mọi thứ đều ổn.
          if (articles.length && !silent) {
            this._toast(`⚠️ ${errors.length} nguồn tạm thời không tải được: ${names}`);
          }
        }
      } catch (err) {
        console.error('[NewsManager] Lỗi tải tin:', err);
        if (this.store.size === 0) this.renderer.showError(err.message);
      } finally {
        this._isLoading = false;
      }
    }

    loadMore() {
      if (this.renderer && this.renderer.hasMore()) this.renderer.appendNextPage();
    }

    /* ---------------------------------------------------------------- View rendering ---- */

    /** Áp dụng filter + search + (chế độ bookmark) lên toàn bộ store rồi render lại từ đầu. */
    _refreshView() {
      if (!this.renderer) return;
      const all = this.store.getAll();
      let list = all;
      if (this._bookmarkModeOn) {
        list = list.filter(a => this.bookmark.has(a.id));
      }
      list = this.filter.apply(list);
      list = list.filter(a => this.search.matches(a));
      this.renderer.renderList(list);
      this.renderer.updateBookmarkCount(this.bookmark.getIds().length);

      // Thống kê tính trên TOÀN BỘ dữ liệu đang có trong store (không phụ thuộc filter hiện tại)
      // để người dùng luôn thấy bức tranh tổng thể.
      const sourceIdsPresent = new Set(all.map(a => a.sourceId));
      const todayCount = all.filter(a => NewsUtils.isWithinRange(a.pubDate, 'today')).length;
      this.renderer.updateStats({
        total: all.length,
        sourceCount: sourceIdsPresent.size,
        bookmarkCount: this.bookmark.getIds().length,
        todayCount
      });
    }

    /* ---------------------------------------------------------------- Actions ----------- */

    /** Mở bài báo gốc ở tab mới (không iframe) + ghi lịch sử đã đọc. */
    openArticle(article) {
      this.history.record(article.id);
      window.open(article.link, '_blank', 'noopener,noreferrer');
      const card = this.renderer.el.list.querySelector(`[data-id="${article.id}"] .news-card-title`);
      if (card) card.classList.add('news-card-title-read');
    }

    /**
     * Chia sẻ bài viết: ưu tiên navigator.share() (Web Share API, hoạt động
     * tốt trên mobile). Nếu trình duyệt không hỗ trợ (hầu hết desktop),
     * fallback copy link vào clipboard rồi báo toast.
     */
    async shareArticle(article) {
      const shareData = {
        title: article.title,
        text: `${article.title} — ${article.source}`,
        url: article.link
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch (err) {
          // Người dùng bấm huỷ chia sẻ (AbortError) -> im lặng, không phải lỗi thật.
          if (err && err.name !== 'AbortError') {
            this._toast('Không thể chia sẻ bài viết');
          }
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(article.link);
        this._toast('Đã sao chép liên kết bài viết');
      } catch (err) {
        this._toast('Không thể sao chép liên kết');
      }
    }

    toggleBookmark(article, btnEl) {
      const active = this.bookmark.toggle(article.id);
      btnEl.classList.toggle('active', active);
      const icon = btnEl.querySelector('i');
      icon.className = `fa-${active ? 'solid' : 'regular'} fa-bookmark`;
      this.renderer.updateBookmarkCount(this.bookmark.getIds().length);
      this._toast(active ? 'Đã lưu bài viết' : 'Đã bỏ lưu bài viết');
      if (this._bookmarkModeOn && !active) this._refreshView();
    }

    _setNavBadge(n) {
      if (!this._navBadge) return;
      if (n > 0) {
        this._navBadge.style.display = 'inline-block';
        this._navBadge.textContent = String(n);
      } else {
        this._navBadge.style.display = 'none';
      }
    }

    /** Hiện panel "Lịch sử đọc" đơn giản dưới dạng danh sách lọc nhanh trong ô search. */
    _showHistoryPanel() {
      const ids = new Set(this.history.getIds());
      if (!ids.size) { this._toast('Chưa có bài viết nào trong lịch sử'); return; }
      const list = this.store.getAll().filter(a => ids.has(a.id))
        .sort((a, b) => this.history.getIds().indexOf(a.id) - this.history.getIds().indexOf(b.id));
      this.renderer.renderList(list);
    }

    /** Toast thông báo — dùng lại hệ thống toast của app nếu có, fallback tự vẽ. */
    _toast(message) {
      if (window.UIManager && typeof window.UIManager.toast === 'function') {
        window.UIManager.toast('success', 'Đọc báo', message);
        return;
      }
      const el = document.createElement('div');
      el.className = 'news-toast-fallback';
      el.textContent = message;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2500);
    }
  }

  /* ==========================================================================
   * 13. CSS của module — dùng CSS variables sẵn có của trang (không hardcode
   *     màu) để tự thích ứng dark/light mode.
   * ========================================================================== */
  const NEWS_MODULE_CSS = `
    #view-news .news-app{ display:flex; flex-direction:column; gap:16px; }

    .news-toolbar{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    .news-search-wrap{ position:relative; flex:1; min-width:220px; }
    .news-search-icon{ position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:13px; }
    .news-search-input{
      width:100%; padding:11px 14px 11px 38px; border-radius:var(--radius-md);
      border:1px solid var(--card-border); background:var(--card-bg-solid); color:var(--text-main);
      font-family:inherit; font-size:14px; outline:none; transition:var(--trans);
    }
    .news-search-input:focus{ border-color:var(--accent); box-shadow:0 0 0 3px rgba(20,120,212,0.14); }

    .news-btn{
      display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border-radius:var(--radius-sm);
      border:1px solid var(--card-border); background:var(--card-bg-solid); color:var(--text-main);
      font-size:13.5px; font-weight:600; cursor:pointer; transition:var(--trans); white-space:nowrap;
    }
    .news-btn:hover{ border-color:var(--accent); color:var(--accent); }
    .news-btn:disabled{ opacity:.6; cursor:not-allowed; }
    .news-btn-sm{ padding:7px 12px; font-size:12.5px; }
    .news-refresh-btn.news-spinning i{ animation:news-spin 0.9s linear infinite; }
    @keyframes news-spin{ from{ transform:rotate(0deg);} to{ transform:rotate(360deg);} }

    .news-filters{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .news-select{
      padding:9px 12px; border-radius:var(--radius-sm); border:1px solid var(--card-border);
      background:var(--card-bg-solid); color:var(--text-main); font-size:13px; font-family:inherit; cursor:pointer;
    }
    .news-chip{
      display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:999px;
      border:1px solid var(--card-border); background:var(--card-bg-solid); color:var(--text-muted);
      font-size:12.5px; font-weight:600; cursor:pointer; transition:var(--trans);
    }
    .news-chip:hover{ color:var(--accent); border-color:var(--accent); }
    .news-chip.active{ background:var(--accent); color:#fff; border-color:var(--accent); }
    .news-chip-count{ background:rgba(0,0,0,0.12); border-radius:999px; padding:1px 7px; font-size:11px; }

    .news-stats{
      display:flex; gap:18px; flex-wrap:wrap; padding:10px 14px; border-radius:var(--radius-sm);
      background:var(--card-bg); border:1px solid var(--card-border); font-size:12.5px; color:var(--text-muted); font-weight:600;
    }
    .news-stat-item{ display:flex; align-items:center; gap:7px; }
    .news-stat-item i{ color:var(--accent); font-size:13px; }
    .news-stat-item span{ color:var(--text-main); font-weight:800; font-size:13.5px; }

    .news-new-banner{
      display:flex; align-items:center; justify-content:center; gap:8px; padding:10px; cursor:pointer;
      background:linear-gradient(90deg, var(--accent), var(--accent-2)); color:#fff; border-radius:var(--radius-sm);
      font-size:13px; font-weight:700; animation:news-banner-in .35s ease;
    }
    @keyframes news-banner-in{ from{ opacity:0; transform:translateY(-8px);} to{ opacity:1; transform:translateY(0);} }

    .news-list{ display:flex; flex-direction:column; gap:12px; }

    .news-card{
      display:flex; gap:14px; padding:14px; border-radius:var(--radius-md); background:var(--card-bg);
      border:1px solid var(--card-border); box-shadow:var(--shadow-sm); cursor:pointer; transition:var(--trans);
      backdrop-filter:var(--glass-blur);
    }
    .news-card:hover{ box-shadow:var(--shadow-md); transform:translateY(-1px); border-color:var(--accent); }

    .news-card-enter{ opacity:0; transform:translateY(-14px); }
    .news-card-enter-active{ opacity:1; transform:translateY(0); transition:all .5s cubic-bezier(.4,0,.2,1); }

    .news-card-thumb-wrap{ position:relative; flex:0 0 120px; width:120px; height:88px; border-radius:var(--radius-sm); overflow:hidden; background:rgba(127,127,127,0.12); }
    .news-card-thumb{ width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .4s ease; }
    .news-card-thumb.news-img-loaded{ opacity:1; }
    .news-card-thumb.news-img-empty{ opacity:0.15; }
    .news-badge-new{
      position:absolute; top:6px; left:6px; background:var(--danger); color:#fff; font-size:10px; font-weight:800;
      padding:2px 7px; border-radius:6px; letter-spacing:.3px;
    }

    .news-card-body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
    .news-card-meta{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--text-muted); font-weight:600; }
    .news-card-dot{ opacity:.5; }
    .news-card-source{ color:var(--accent); }
    .news-card-title{ font-size:14.5px; font-weight:700; line-height:1.4; color:var(--text-main); }
    .news-card-title-read{ opacity:.55; font-weight:600; }
    .news-card-desc{ font-size:12.5px; color:var(--text-muted); line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .news-card-actions{ display:flex; align-items:center; gap:8px; margin-top:4px; }
    .news-icon-btn{
      width:32px; height:32px; border-radius:50%; border:1px solid var(--card-border); background:var(--card-bg-solid);
      color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; transition:var(--trans);
    }
    .news-icon-btn:hover, .news-icon-btn.active{ color:var(--star); border-color:var(--star); }

    .news-skeleton{ pointer-events:none; }
    .news-skel-thumb{ flex:0 0 120px; width:120px; height:88px; border-radius:var(--radius-sm); background:rgba(127,127,127,0.15); animation:news-pulse 1.4s ease-in-out infinite; }
    .news-skel-body{ flex:1; display:flex; flex-direction:column; gap:8px; justify-content:center; }
    .news-skel-line{ height:11px; border-radius:6px; background:rgba(127,127,127,0.15); animation:news-pulse 1.4s ease-in-out infinite; }
    .news-skel-line-title{ height:14px; width:70%; }
    .news-skel-line-short{ width:40%; }
    @keyframes news-pulse{ 0%,100%{ opacity:.5;} 50%{ opacity:1;} }

    .news-sentinel{ height:1px; }

    .news-empty, .news-error{ display:flex; flex-direction:column; align-items:center; gap:10px; padding:48px 16px; color:var(--text-muted); text-align:center; }
    .news-empty i, .news-error i{ font-size:34px; opacity:.5; }
    .news-error i{ color:var(--danger); }

    .news-toast-fallback{
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); opacity:0;
      background:var(--card-bg-solid); color:var(--text-main); border:1px solid var(--card-border); box-shadow:var(--shadow-lg);
      padding:12px 20px; border-radius:var(--radius-md); font-size:13.5px; font-weight:600; z-index:9999; transition:all .3s ease;
    }
    .news-toast-fallback.show{ opacity:1; transform:translateX(-50%) translateY(0); }

    @media (max-width: 720px){
      .news-card-thumb-wrap{ flex-basis:88px; width:88px; height:70px; }
      .news-filters{ gap:8px; }
      .news-select{ flex:1; min-width:110px; }
    }
  `;

  /* ==========================================================================
   * 14. KHỞI TẠO — Tự chạy ngay khi DOM sẵn sàng, không cần gọi thêm hàm nào.
   * ========================================================================== */
  const bootstrap = () => {
    try {
      const manager = new NewsManager();
      manager.init();
      // Expose có kiểm soát (chỉ 1 biến global) để debug / mở rộng nếu cần,
      // không rò rỉ các biến trung gian khác ra global scope.
      window.NewsReader = manager;
    } catch (err) {
      console.error('[news.js] Khởi tạo module Đọc báo thất bại:', err);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
