/* ============================================================================
   type.js — "Phân loại theo chủ đề" cho Website Ôn thi Cao học NEU
   ----------------------------------------------------------------------------
   CÁCH DÙNG: thêm 1 dòng cuối <body> của index.html (sau các script khác):
       <script src="type.js"></script>
   Không sửa file nào khác. Module tự chèn nút Sidebar "Chủ đề" + view mới, tự
   "wrap" UIManager.navigate và QuizManager.recordAnswer (cùng kỹ thuật với
   flashcard.js / tailieu.js) — không ghi đè logic gốc.

   TÍNH NĂNG
   1) Gắn 1 tag chủ đề cho MỖI câu hỏi (Địa lý, Lịch sử, Văn học, Tin học, Pháp luật,
      Kinh tế, Sinh học - Y học, Khoa học tự nhiên, Văn hóa - Nghệ thuật, Thể thao...).
      - 300 câu gốc: dùng bảng gắn tag thủ công (chính xác).
      - Câu hỏi mới/đề khác: tự phân loại bằng từ khóa (không dấu cũng nhận).
      - Bạn có thể sửa tag từng câu ở phần "Danh sách câu hỏi" (lưu theo trình duyệt).
   2) Thống kê điểm mạnh / yếu theo chủ đề: số câu đã làm, tỷ lệ đúng, số câu cần ôn,
      xếp hạng chủ đề mạnh - yếu. Dữ liệu lấy từ ngân hàng câu sai / câu đúng có sẵn
      của app + lịch sử đáp án riêng của module (ghi nhận từ mọi lượt làm bài).
   3) Luyện theo chủ đề (tất cả câu / chỉ câu cần ôn) hoặc "N câu ngẫu nhiên"
      (toàn bộ hoặc chỉ trong các chủ đề chọn; có chế độ ưu tiên câu sai/chưa làm).

   Lưu trữ: localStorage (tiền tố examMasterPro_type_). Luyện tập dùng
   QuizManager.startCustomReview nên KHÔNG làm thay đổi điểm các phần.
   ========================================================================== */
(function () {
  'use strict';
  if (window.TopicTags) return;

  /* ---------- tiện ích ---------- */
  var PFX = 'examMasterPro_type_';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); };
  var pad = function (s) { return ' ' + norm(s).replace(/[^a-z0-9]+/g, ' ') + ' '; };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(PFX + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { } }
  };
  var appGet = function (k, d) { try { var v = localStorage.getItem('examMasterPro_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  function UIM() { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; }
  function QM() { try { if (typeof QuestionManager !== 'undefined' && QuestionManager) return QuestionManager; } catch (e) { } return null; }
  function QZ() { try { if (typeof QuizManager !== 'undefined' && QuizManager) return QuizManager; } catch (e) { } return null; }
  function BM() { try { if (typeof BankManager !== 'undefined' && BankManager) return BankManager; } catch (e) { } return null; }
  function toast(type, t, m) { var u = UIM(); if (u && u.toast) u.toast(type, t, m || ''); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ==========================================================================
     1) DANH MỤC CHỦ ĐỀ
     ======================================================================== */
  var TOPICS = [
    { c: 'D', name: 'Địa lý', icon: 'fa-earth-asia', color: '#16c784' },
    { c: 'L', name: 'Lịch sử', icon: 'fa-landmark', color: '#f59e0b' },
    { c: 'V', name: 'Văn học', icon: 'fa-book-open', color: '#8b5cf6' },
    { c: 'H', name: 'Văn hóa - Nghệ thuật', icon: 'fa-masks-theater', color: '#ec4899' },
    { c: 'T', name: 'Tin học', icon: 'fa-laptop-code', color: '#06b6d4' },
    { c: 'P', name: 'Pháp luật - Chính trị', icon: 'fa-scale-balanced', color: '#0d5fb3' },
    { c: 'K', name: 'Kinh tế - Tổ chức quốc tế', icon: 'fa-chart-line', color: '#1478d4' },
    { c: 'S', name: 'Sinh học - Y học', icon: 'fa-dna', color: '#22c55e' },
    { c: 'N', name: 'Khoa học tự nhiên', icon: 'fa-atom', color: '#3b96e8' },
    { c: 'W', name: 'Thể thao', icon: 'fa-futbol', color: '#ef4444' },
    { c: 'X', name: 'Đời sống - Xã hội', icon: 'fa-people-roof', color: '#f97316' },
    { c: 'O', name: 'Khác', icon: 'fa-shapes', color: '#8fa9c4' }
  ];
  var TBY = {}; TOPICS.forEach(function (t) { TBY[t.c] = t; });

  /* ==========================================================================
     2) BẢNG TAG THỦ CÔNG CHO 300 CÂU GỐC (ký tự thứ i = câu có id i+1)
     ======================================================================== */
  var BASE_TAGS = [
    'KDDKDDNKKD', 'NKKKKDDNLK', 'LTSLSSDLSL', 'NVSNDHLKSN', 'DKKLHNKDKK',
    'HHDTHXHNDS', 'TLDXKSNDSV', 'HLLLKNVVHH', 'LNWTXDDDVW', 'SDVTNDTDLV',
    'LDDDDDDDDD', 'DDVDDLLLKD', 'DDKKKKDKDD', 'PDDDDDDDKS', 'DSDDVDDDPK',
    'LPPDLLLLKP', 'KKLLLLLLLX', 'SVLVVHDSSH', 'NNVDLLDDDL', 'XHNNSNTSLL',
    'DWHHLHLHHH', 'XLDDLLHHWV', 'HLLNLXLPDH', 'DWHWNDSVVW', 'SSSSSSLLLN',
    'PPPPHHPPLL', 'PPPPLDDLDD', 'XVLHSSNPXX', 'NOSVSLNDSS', 'NSSNXDNVLL'
  ].join('');
  // Chỉ dùng bảng này khi ngân hàng đúng là bộ 300 câu gốc (đối chiếu câu 1 và câu 300)
  function baseBankValid(all) {
    if (!all || all.length !== 300 || BASE_TAGS.length !== 300) return false;
    var a = all.filter(function (q) { return q.id === 1; })[0], b = all.filter(function (q) { return q.id === 300; })[0];
    return !!(a && b && norm(a.question).indexOf('apec') > -1 && norm(b.question).indexOf('mong') > -1);
  }

  /* ==========================================================================
     3) PHÂN LOẠI TỰ ĐỘNG BẰNG TỪ KHÓA (cho câu hỏi ngoài bộ 300 gốc)
        "=từ" = khớp nguyên từ; còn lại khớp chuỗi con (đã bỏ dấu).
     ======================================================================== */
  var KW = {
    D: [['thu do', 3], ['chau a', 2], ['chau au', 2], ['chau phi', 2], ['chau my', 2], ['khi hau', 3], ['dien tich', 2], ['song ', 1], ['nui ', 1], ['vinh ', 1], ['quan dao', 3], ['bien gioi', 3], ['vung kinh te', 3], ['tinh nao', 3], ['dan so', 2], ['tay nguyen', 3], ['dong bang', 3], ['xich dao', 3], ['cuc bac', 3], ['cuc dong', 3], ['cuc tay', 3], ['mien bac', 2], ['mien trung', 2], ['quoc gia nao', 1], ['nuoc nao', 1], ['bai tam', 3], ['thanh pho', 1], ['dao quoc', 3], ['nam o dau', 2], ['o dau', 1]],
    L: [['khoi nghia', 3], ['nam 1', 1], ['trieu dai', 3], ['nha ly', 3], ['nha tran', 3], ['nha dinh', 3], ['nha nguyen', 2], ['cach mang', 2], ['chien tranh', 3], ['phong trao', 2], ['quoc hieu', 3], ['dai viet', 3], ['van lang', 3], ['lam son', 3], ['dang cong san', 3], ['hiep uoc', 2], ['the chien', 3], ['=vua', 1], ['thanh lap', 1], ['xo viet', 3], ['su quan', 3], ['thuoc dia', 3], ['binh phap', 2], ['danh nhan', 1]],
    V: [['tac gia', 3], ['bai tho', 3], ['nha tho', 3], ['tac pham', 2], ['truyen ngan', 3], ['truyen kieu', 3], ['ca dao', 3], ['tuc ngu', 3], ['danh ngon', 3], ['cham ngon', 3], ['van hoc', 3], ['tam quoc', 2], ['su thi', 3], ['chu nom', 3], ['cau tho', 3], ['nhan vat', 1]],
    T: [['excel', 3], ['window', 3], ['phan mem', 3], ['winrar', 3], ['=byte', 3], ['=kb', 3], ['internet', 3], ['=gps', 3], ['=web', 2], ['=gov', 2], ['may tinh', 3], ['=3g', 3], ['=gprs', 3]],
    P: [['luat', 2], ['phap luat', 3], ['toa an', 3], ['bi cao', 3], ['nghia vu', 3], ['cong dan', 3], ['lien hop quoc', 2], ['chinh phu', 3], ['quoc hoi', 3], ['tong thong', 3], ['thu tuong', 3], ['ma tuy', 3], ['quyen tre em', 3], ['quan khu', 2]],
    K: [['=apec', 4], ['=asean', 3], ['=opec', 4], ['=oecd', 4], ['=wto', 4], ['=fed', 4], ['=fao', 4], ['=iaea', 4], ['=wwf', 4], ['=eu', 3], ['=gdp', 4], ['=hdi', 4], ['=fdi', 4], ['=nics', 4], ['=afta', 4], ['=efta', 4], ['kinh te', 2], ['tien te', 2], ['xuat khau', 3], ['hang hoa', 3], ['thuong mai', 3], ['to chuc', 1], ['lien minh', 2], ['ngan hang', 2], ['con rong', 3], ['cong nghiep', 2], ['dau mo', 2]],
    S: [['dong vat', 3], ['thuc vat', 3], ['loai chim', 3], ['chim ', 2], ['buom', 3], ['ca voi', 3], ['ca ngua', 3], ['thang lan', 3], ['trung roi', 3], ['dinh duong', 2], ['di truyen', 3], ['uu the lai', 3], ['dai tan sinh', 3], ['co the', 1], ['xuong', 2], ['nhom mau', 3], ['dong mach', 3], ['vitamin', 3], ['gay te', 3], ['gay me', 3], ['cham cuu', 3], ['benh', 2], ['sinh vat', 3], ['loai ong', 3]],
    N: [['hanh tinh', 3], ['ngoi sao', 3], ['sao hoa', 3], ['sao moc', 3], ['sao tho', 3], ['sao kim', 3], ['sao thuy', 3], ['mat troi', 3], ['mat trang', 3], ['vu tru', 3], ['thien the', 3], ['thien thach', 3], ['vec to', 3], ['nguyen to', 3], ['ap suat', 3], ['nhiet do', 2], ['axeton', 3], ['plasma', 3], ['tro bep', 3], ['hoa hoc', 3], ['vat ly', 3], ['toan hoc', 2], ['chom sao', 3]],
    H: [['le hoi', 3], ['nhac', 3], ['ca si', 3], ['giai thuong', 2], ['grammy', 3], ['oscar', 3], ['phim', 3], ['dien vien', 3], ['dan bau', 3], ['dan day', 3], ['ca tru', 3], ['trong dong', 3], ['cong chieng', 3], ['giao huong', 3], ['vu dieu', 3], ['ton giao', 3], ['phat giao', 3], ['thien chua', 3], ['tin lanh', 3], ['hoi giao', 3], ['ngoi chua', 3], ['di san', 3], ['unesco', 3], ['carnaval', 3], ['nghe thuat', 3], ['bai hat', 3]],
    W: [['bong da', 3], ['world cup', 3], ['euro', 3], ['=aff', 3], ['asian cup', 3], ['olympic', 3], ['van dong vien', 3], ['the thao', 3], ['giai vo dich', 2], ['co vua', 3], ['san bong', 3], ['yard', 2]],
    X: [['am thuc', 3], ['cuoi hoi', 3], ['mon an', 3], ['nuoc giai khat', 3], ['ma dien thoai', 3], ['mang vien thong', 3], ['thu tuc', 1], ['gia dinh', 1]]
  };
  function autoTag(q) {
    var qt = pad(q.question || ''), ot = pad(Object.keys(q.options || {}).map(function (k) { return q.options[k]; }).join(' ')), best = 'O', bs = 0;
    Object.keys(KW).forEach(function (code) {
      var s = 0;
      KW[code].forEach(function (p) {
        var kw = p[0], w = p[1], key;
        if (kw.charAt(0) === '=') key = ' ' + kw.slice(1) + ' '; else key = kw;
        if (qt.indexOf(key) > -1) s += w * 3; else if (ot.indexOf(key) > -1) s += w;
      });
      if (s > bs) { bs = s; best = code; }
    });
    return bs >= 2 ? best : 'O';
  }

  /* ---------- gắn tag cho toàn bộ ngân hàng ---------- */
  function tagMap() {
    var qm = QM(), all = (qm && qm.all) || [], over = store.get('override', {}), base = baseBankValid(all), m = new Map();
    all.forEach(function (q) {
      var c = over[q.id];
      if (!c || !TBY[c]) c = base && q.id >= 1 && q.id <= 300 ? BASE_TAGS.charAt(q.id - 1) : autoTag(q);
      m.set(q.id, TBY[c] ? c : 'O');
    });
    return m;
  }

  /* ==========================================================================
     4) GHI NHẬN KẾT QUẢ TỪNG CÂU (wrap QuizManager.recordAnswer)
        Mỗi câu chỉ tính 1 lần / 1 lượt làm bài (không tính lặp ở vòng ôn lại).
     ======================================================================== */
  var seenBy = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function track(qid, correct) {
    var st = store.get('stats', {}), r = st[qid] || { c: 0, w: 0 };
    if (correct) r.c++; else r.w++;
    r.t = Date.now(); st[qid] = r; store.set('stats', st);
  }
  function hook() {
    var qz = QZ();
    if (qz && !qz.__typeWrapped && typeof qz.recordAnswer === 'function') {
      qz.__typeWrapped = true;
      var orig = qz.recordAnswer.bind(qz);
      qz.recordAnswer = function (q, selected, correct, t) {
        try {
          if (q && q.id != null && qz.state) {
            var seen = seenBy ? seenBy.get(qz.state) : null;
            if (seenBy && !seen) { seen = {}; seenBy.set(qz.state, seen); }
            if (!seen || !seen[q.id]) { if (seen) seen[q.id] = 1; track(q.id, !!correct); }
          }
        } catch (e) { console.warn('[TopicTags]', e); }
        return orig(q, selected, correct, t);
      };
    }
    var ui = UIM();
    if (ui && !ui.__typeWrapped && typeof ui.navigate === 'function') {
      ui.__typeWrapped = true; ui.titles = ui.titles || {};
      ui.titles.type = ['Chủ đề', 'Phân loại câu hỏi theo chủ đề, xem điểm mạnh - yếu và luyện tập theo từng chủ đề'];
      var nav = ui.navigate.bind(ui);
      ui.navigate = function (v) { var r = nav(v); if (v === 'type') { wire(); render(); } return r; };
    }
  }

  /* ==========================================================================
     5) THỐNG KÊ
     ======================================================================== */
  function compute() {
    var qm = QM(), bm = BM(), all = (qm && qm.all) || [], tags = tagMap(), own = store.get('stats', {});
    var wrong = bm ? bm.getWrong() : appGet('wrongBank', {}), correct = bm ? bm.getCorrect() : appGet('correctBank', {});
    var per = {}; TOPICS.forEach(function (t) { per[t.c] = { c: t.c, qs: [], seen: 0, C: 0, W: 0, weak: 0 }; });
    var qinfo = new Map();
    all.forEach(function (q) {
      var code = tags.get(q.id) || 'O', o = own[q.id] || {};
      var c = Math.max(o.c || 0, correct[q.id] ? 1 : 0), w = Math.max(o.w || 0, wrong[q.id] ? (wrong[q.id].count || 1) : 0);
      var weak = !!wrong[q.id] || w > c, seen = c + w > 0, P = per[code];
      P.qs.push(q); if (seen) P.seen++; P.C += c; P.W += w; if (weak) P.weak++;
      qinfo.set(q.id, { code: code, c: c, w: w, weak: weak, seen: seen });
    });
    var rows = TOPICS.map(function (t) {
      var p = per[t.c]; p.total = p.qs.length; p.acc = (p.C + p.W) ? Math.round(p.C / (p.C + p.W) * 100) : null;
      p.cover = p.total ? Math.round(p.seen / p.total * 100) : 0; p.t = t; return p;
    }).filter(function (p) { return p.total > 0; });
    return { rows: rows, qinfo: qinfo, tags: tags, all: all };
  }
  function level(p) {
    if (p.acc === null) return { k: 'none', label: 'Chưa học', color: 'var(--text-muted)' };
    if (p.acc >= 80) return { k: 'strong', label: 'Mạnh', color: 'var(--success)' };
    if (p.acc >= 60) return { k: 'mid', label: 'Khá', color: 'var(--warning)' };
    return { k: 'weak', label: 'Yếu', color: 'var(--danger)' };
  }

  /* ==========================================================================
     6) LUYỆN TẬP
     ======================================================================== */
  function practice(list, label) {
    var qz = QZ();
    if (!qz || typeof qz.startCustomReview !== 'function') return toast('error', 'Chủ đề', 'Không tìm thấy bộ làm bài của app');
    if (!list.length) return toast('warn', 'Không có câu hỏi', 'Không có câu nào phù hợp để luyện');
    qz.startCustomReview(list, label);
  }
  function pickRandom(pool, n, info, prefer) {
    n = Math.max(1, Math.min(n, pool.length));
    if (!prefer) return shuffle(pool).slice(0, n);
    var g1 = [], g2 = [], g3 = [];
    pool.forEach(function (q) { var i = info.get(q.id) || {}; (i.weak ? g1 : (!i.seen ? g2 : g3)).push(q); });
    return shuffle(g1).concat(shuffle(g2), shuffle(g3)).slice(0, n);
  }

  /* ==========================================================================
     7) CSS + DOM
     ======================================================================== */
  function css() {
    if ($('#tpStyles')) return;
    var s = document.createElement('style'); s.id = 'tpStyles';
    s.textContent = [
      '.tp-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px}',
      '.tp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}@media(max-width:860px){.tp-two{grid-template-columns:1fr}}',
      '.tp-box{padding:16px 18px}.tp-box h3{font-size:14px;font-weight:800;margin-bottom:10px;display:flex;gap:8px;align-items:center}',
      '.tp-rank{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed var(--card-border);font-size:13px}.tp-rank:last-child{border:0}.tp-rank b{flex:1}',
      '.tp-chip{display:inline-flex;gap:6px;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;color:#fff;background:var(--c,#1478d4);white-space:nowrap}',
      '.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:20px}',
      '.tp-card{padding:16px;display:flex;flex-direction:column;gap:10px;border-top:4px solid var(--c,#1478d4)}',
      '.tp-top{display:flex;align-items:center;gap:11px}.tp-ic{width:42px;height:42px;border-radius:12px;background:var(--c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}',
      '.tp-top b{font-size:14.5px;display:block}.tp-top span{font-size:12px;color:var(--text-muted)}.tp-lv{margin-left:auto;font-size:11.5px;font-weight:800}',
      '.tp-meta{display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)}',
      '.tp-bar{height:9px;border-radius:9px;background:rgba(20,120,212,.12);overflow:hidden}.tp-bar i{display:block;height:100%;border-radius:9px}',
      '.tp-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}',
      '.tp-rand{padding:18px 20px;margin-bottom:20px}.tp-rand h3{font-size:15px;font-weight:800;margin-bottom:12px;display:flex;gap:8px;align-items:center}',
      '.tp-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.tp-row label{font-size:12.5px;font-weight:700;color:var(--text-muted)}',
      '.tp-num{width:84px;padding:9px 10px;border-radius:10px;border:1.5px solid var(--card-border);background:var(--card-bg);color:var(--text-main);font:inherit;font-size:14px;text-align:center;font-weight:700}',
      '.tp-pick{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.tp-pick button{padding:6px 12px;border-radius:20px;border:1.5px solid var(--card-border);background:var(--card-bg);font-size:12px;font-weight:700;color:var(--text-muted)}',
      '.tp-pick button.on{background:var(--c);border-color:var(--c);color:#fff}',
      '.tp-quick{display:flex;gap:6px;flex-wrap:wrap}.tp-quick button{padding:6px 12px;border-radius:10px;background:rgba(20,120,212,.09);color:var(--accent);font-size:12.5px;font-weight:700}',
      '.tp-q{display:flex;gap:12px;align-items:flex-start;padding:11px 14px;margin-bottom:8px}.tp-q .t{flex:1;min-width:0;font-size:13.5px;line-height:1.5}.tp-q .t small{display:block;color:var(--text-muted);margin-top:2px;font-size:12px}',
      '.tp-q select{padding:6px 8px;border-radius:9px;border:1.5px solid var(--card-border);background:var(--card-bg);color:var(--text-main);font-size:12px;max-width:170px}',
      '.tp-st{font-size:11px;font-weight:800;padding:2px 8px;border-radius:20px;white-space:nowrap}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function injectDom() {
    if (!$('.nav-item[data-view="type"]')) {
      var anchor = $('.nav-item[data-view="parts"]') || $('.nav-item[data-view="quiz"]');
      var b = document.createElement('button'); b.className = 'nav-item'; b.dataset.view = 'type';
      b.innerHTML = '<i class="fa-solid fa-tags"></i> Chủ đề';
      if (anchor) anchor.insertAdjacentElement('afterend', b); else { var n = $('.sidebar-nav'); if (n) n.appendChild(b); }
      if (window.__appInitialized) b.addEventListener('click', function () { var u = UIM(); if (u) u.navigate('type'); });
    }
    if (!$('#view-type')) {
      var main = $('main.content'); if (!main) return;
      var sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-type';
      sec.innerHTML = '<div id="tpRoot"></div>'; main.appendChild(sec);
    }
  }

  /* ==========================================================================
     8) RENDER
     ======================================================================== */
  var S = { detail: null, n: 20, prefer: true, scope: {}, dq: '' };

  function render() {
    var root = $('#tpRoot'); if (!root) return;
    var D = compute();
    if (!D.all.length) { root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-tags"></i><p>Chưa có câu hỏi nào để phân loại</p></div>'; return; }
    var rows = D.rows, seenRows = rows.filter(function (p) { return p.acc !== null; });
    var totalSeen = rows.reduce(function (s, p) { return s + p.seen; }, 0), C = rows.reduce(function (s, p) { return s + p.C; }, 0), W = rows.reduce(function (s, p) { return s + p.W; }, 0);
    var overall = (C + W) ? Math.round(C / (C + W) * 100) : null;
    var sorted = seenRows.slice().sort(function (a, b) { return b.acc - a.acc; });
    var strong = sorted.filter(function (p) { return p.acc >= 80; }).slice(0, 5), weak = sorted.slice().reverse().filter(function (p) { return p.acc < 80; }).slice(0, 5);
    var chip = function (p) { return '<span class="tp-chip" style="--c:' + p.t.color + '"><i class="fa-solid ' + p.t.icon + '"></i> ' + esc(p.t.name) + '</span>'; };
    var rk = function (p) { return '<div class="tp-rank">' + chip(p) + '<b></b><span style="font-weight:800;color:' + level(p).color + '">' + p.acc + '%</span><span style="font-size:11.5px;color:var(--text-muted)">' + p.seen + '/' + p.total + ' câu</span></div>'; };
    var cards = [
      ['fa-tags', 'linear-gradient(135deg,#1478d4,#22d3ee)', rows.length, 'Chủ đề'],
      ['fa-circle-question', 'linear-gradient(135deg,#0d5fb3,#3b96e8)', D.all.length, 'Tổng số câu'],
      ['fa-book-open', 'linear-gradient(135deg,#16c784,#0e9d68)', totalSeen + '/' + D.all.length, 'Câu đã làm'],
      ['fa-bullseye', 'linear-gradient(135deg,#f59e0b,#fbbf24)', overall === null ? '--' : overall + '%', 'Tỷ lệ đúng chung']
    ];
    var h = '<div class="section-head"><div><h2><i class="fa-solid fa-tags"></i> Chủ đề</h2><p>Mỗi câu hỏi được gắn 1 tag chủ đề — xem điểm mạnh/yếu và luyện theo chủ đề</p></div></div>' +
      '<div class="tp-sum">' + cards.map(function (c) { return '<div class="card stat-card"><div class="stat-top"><div class="stat-icon" style="background:' + c[1] + '"><i class="fa-solid ' + c[0] + '"></i></div></div><div class="stat-val">' + c[2] + '</div><div class="stat-label">' + c[3] + '</div></div>'; }).join('') + '</div>' +
      '<div class="tp-two"><div class="card tp-box"><h3><i class="fa-solid fa-trophy" style="color:var(--success)"></i> Điểm mạnh (≥ 80%)</h3>' + (strong.length ? strong.map(rk).join('') : '<div class="tp-meta">Chưa có chủ đề nào đạt 80%. Làm bài để có dữ liệu nhé!</div>') + '</div>' +
      '<div class="card tp-box"><h3><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i> Cần cải thiện</h3>' + (weak.length ? weak.map(rk).join('') : '<div class="tp-meta">Chưa có dữ liệu hoặc bạn đã mạnh ở mọi chủ đề 🎉</div>') + '</div></div>' +
      '<div class="tp-grid">' + rows.map(function (p) {
        var lv = level(p), bar = p.acc === null ? 0 : p.acc;
        return '<div class="card tp-card" style="--c:' + p.t.color + '"><div class="tp-top"><div class="tp-ic"><i class="fa-solid ' + p.t.icon + '"></i></div><div><b>' + esc(p.t.name) + '</b><span>' + p.total + ' câu · đã làm ' + p.seen + ' (' + p.cover + '%)</span></div><span class="tp-lv" style="color:' + lv.color + '">' + lv.label + '</span></div>' +
          '<div><div class="tp-meta"><span>Tỷ lệ đúng</span><b style="color:' + lv.color + '">' + (p.acc === null ? '—' : p.acc + '%') + '</b></div><div class="tp-bar"><i style="width:' + bar + '%;background:' + (lv.k === 'none' ? 'transparent' : lv.color) + '"></i></div></div>' +
          '<div class="tp-meta"><span>Đúng ' + p.C + ' · Sai ' + p.W + '</span><span>' + p.weak + ' câu cần ôn</span></div>' +
          '<div class="tp-acts"><button class="btn btn-primary btn-sm" data-pa="all" data-c="' + p.c + '"><i class="fa-solid fa-play"></i> Luyện chủ đề</button>' +
          '<button class="btn btn-outline btn-sm" data-pa="weak" data-c="' + p.c + '"' + (p.weak ? '' : ' disabled') + '><i class="fa-solid fa-rotate-left"></i> Câu cần ôn (' + p.weak + ')</button>' +
          '<button class="btn btn-ghost btn-sm" data-pa="list" data-c="' + p.c + '"><i class="fa-solid fa-list"></i> Xem câu</button></div></div>';
      }).join('') + '</div>' +
      '<div class="card tp-rand"><h3><i class="fa-solid fa-shuffle"></i> Luyện "N câu ngẫu nhiên"</h3>' +
      '<div class="tp-row"><label>Số câu</label><input class="tp-num" id="tpN" type="number" min="1" max="300" value="' + S.n + '"><div class="tp-quick">' + [10, 20, 30, 50].map(function (n) { return '<button data-n="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="tpPrefer"' + (S.prefer ? ' checked' : '') + '> Ưu tiên câu sai / chưa làm</label></div>' +
      '<div class="tp-row"><label>Phạm vi (không chọn = tất cả chủ đề)</label></div><div class="tp-pick" id="tpScope">' + rows.map(function (p) { return '<button data-sc="' + p.c + '" class="' + (S.scope[p.c] ? 'on' : '') + '" style="--c:' + p.t.color + '">' + esc(p.t.name) + ' (' + p.total + ')</button>'; }).join('') + '</div>' +
      '<button class="btn btn-primary" id="tpGo"><i class="fa-solid fa-dice"></i> Bắt đầu luyện</button></div>';
    if (S.detail && TBY[S.detail]) h += detailHtml(D, S.detail);
    root.innerHTML = h;
    S.D = D;
  }

  function detailHtml(D, code) {
    var T = TBY[code], q = norm(S.dq), list = D.all.filter(function (x) { return D.tags.get(x.id) === code && (!q || norm(x.question).indexOf(q) > -1); }), shown = list.slice(0, 100);
    return '<div id="tpDetail"><div class="section-head" style="margin-top:6px"><div><h2 style="font-size:17px"><i class="fa-solid ' + T.icon + '" style="color:' + T.color + '"></i> Danh sách câu: ' + esc(T.name) + '</h2><p>Đổi tag ở cột bên phải nếu thấy câu bị gắn chưa đúng chủ đề</p></div>' +
      '<div style="display:flex;gap:8px"><input class="tp-num" id="tpDQ" style="width:200px;text-align:left" placeholder="Lọc câu hỏi..." value="' + esc(S.dq) + '"><button class="btn btn-outline btn-sm" data-pa="close">Đóng</button></div></div>' +
      (shown.length ? shown.map(function (x) {
        var i = D.qinfo.get(x.id) || {}, st = !i.seen ? ['Chưa làm', 'var(--text-muted)'] : i.weak ? ['Cần ôn', 'var(--danger)'] : ['Đã đúng', 'var(--success)'];
        return '<div class="card tp-q"><span class="tp-st" style="background:rgba(127,127,127,.12);color:' + st[1] + '">' + st[0] + '</span><div class="t"><b>#' + x.id + '</b> ' + esc(x.question) + '<small>Đáp án: ' + esc(x.answer) + '. ' + esc((x.options || {})[x.answer] || '') + '</small></div>' +
          '<select data-retag="' + x.id + '">' + TOPICS.map(function (t) { return '<option value="' + t.c + '"' + (t.c === code ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></div>';
      }).join('') + (list.length > 100 ? '<div class="tp-meta" style="justify-content:center">Hiển thị 100/' + list.length + ' câu — dùng ô lọc để thu hẹp.</div>' : '') : '<div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Không có câu nào</p></div>') + '</div>';
  }

  /* ==========================================================================
     9) SỰ KIỆN
     ======================================================================== */
  function wire() {
    var root = $('#tpRoot'); if (!root || root.__wired) return; root.__wired = true;
    root.addEventListener('click', function (e) {
      var el, D = S.D || compute();
      if ((el = e.target.closest('[data-n]'))) { S.n = +el.dataset.n; var i = $('#tpN'); if (i) i.value = S.n; return; }
      if ((el = e.target.closest('[data-sc]'))) { S.n = +($('#tpN') || {}).value || S.n; if (S.scope[el.dataset.sc]) delete S.scope[el.dataset.sc]; else S.scope[el.dataset.sc] = 1; el.classList.toggle('on'); return; }
      if (e.target.closest('#tpGo')) {
        var n = Math.max(1, parseInt(($('#tpN') || {}).value, 10) || 20), codes = Object.keys(S.scope);
        S.n = n; S.prefer = !!($('#tpPrefer') || {}).checked;
        var pool = D.all.filter(function (q) { return !codes.length || codes.indexOf(D.tags.get(q.id)) > -1; });
        var pick = pickRandom(pool, n, D.qinfo, S.prefer);
        if (pick.length < n && pool.length) toast('warn', 'Không đủ câu', 'Chỉ có ' + pool.length + ' câu trong phạm vi đã chọn');
        practice(pick, pick.length + ' câu ngẫu nhiên' + (codes.length ? ' · ' + codes.map(function (c) { return TBY[c].name; }).join(', ') : ''));
        return;
      }
      if ((el = e.target.closest('[data-pa]'))) {
        if (el.disabled) return;
        var a = el.dataset.pa, c = el.dataset.c;
        if (a === 'close') { S.detail = null; S.dq = ''; render(); return; }
        if (a === 'list') { S.detail = c; S.dq = ''; render(); var d = $('#tpDetail'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        var qs = D.all.filter(function (q) { var i = D.qinfo.get(q.id) || {}; return i.code === c && (a === 'all' || i.weak); });
        practice(qs, 'Chủ đề: ' + TBY[c].name + (a === 'weak' ? ' (câu cần ôn)' : ''));
      }
    });
    root.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.retag) {
        var over = store.get('override', {}); over[e.target.dataset.retag] = e.target.value; store.set('override', over);
        toast('success', 'Đã đổi tag', 'Câu #' + e.target.dataset.retag + ' → ' + TBY[e.target.value].name);
        render();
      } else if (e.target.id === 'tpPrefer') S.prefer = e.target.checked;
    });
    root.addEventListener('input', function (e) {
      if (e.target.id === 'tpDQ') {
        S.dq = e.target.value; var D = S.D || compute(), box = $('#tpDetail'), pos = e.target.selectionStart;
        if (box && S.detail) { box.outerHTML = detailHtml(D, S.detail); var ni = $('#tpDQ'); if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (er) { } } }
      }
    });
  }

  /* ==========================================================================
     10) KHỞI ĐỘNG
     ======================================================================== */
  function init() { css(); injectDom(); wire(); hook(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setInterval(hook, 2000); // phòng khi QuizManager/UIManager nạp muộn

  window.TopicTags = {
    open: function () { var u = UIM(); if (u) u.navigate('type'); },
    tagOf: function (id) { return TBY[tagMap().get(id)] ? TBY[tagMap().get(id)].name : null; },
    stats: function () { return compute().rows; },
    random: function (n) { var D = compute(); practice(pickRandom(D.all, n || 20, D.qinfo, true), (n || 20) + ' câu ngẫu nhiên'); }
  };
})();
