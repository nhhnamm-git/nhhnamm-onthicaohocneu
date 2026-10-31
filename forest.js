/* ============================================================================
   forest.js — "Study Forest" (Rừng phép thuật) cho Website Ôn thi Cao học NEU
   BẢN VIẾT LẠI: khôi phục GIỜ HỌC CŨ + cho phép QUY ĐỔI ra Linh quang
   ----------------------------------------------------------------------------
   CÁCH DÙNG (1 dòng, đặt cuối <body> của index.html, SAU các script khác):
       <script src="forest.js"></script>

   KHÔNG cần sửa Firestore Rules. Chỉ dùng các quyền đã có sẵn:
     - users/{uid}/forest/main   (đọc/ghi dữ liệu khu rừng của chính mình)
     - leaderboard/{uid}         (đọc: có trường studyTimeSec đồng bộ từ app)
     - users/{uid}               (đọc hồ sơ của chính mình: totalStudyMinutes)
     - localStorage của trình duyệt (examMasterPro_dailyLog / _history)

   VÌ SAO BẢN TRƯỚC KHÔNG ĐỔI ĐƯỢC ĐIỂM
   Bản cũ tìm giờ học cũ trong users/{uid}/studyHistory và flashDecks — những nơi
   KHÔNG lưu thời gian làm bài của app nên luôn ra 0. Giờ học thật của app nằm ở:
     1) localStorage: examMasterPro_dailyLog (timeSec theo ngày) + _history
     2) Firestore leaderboard/{uid}.studyTimeSec (đồng bộ mỗi lần làm bài)
     3) Firestore users/{uid}.totalStudyMinutes (API signin.js, nếu có dùng)
   Bản này quét CẢ 3 nguồn, lấy GIÁ TRỊ LỚN NHẤT (không cộng dồn → không nhân đôi),
   loại phần đã được Study Forest tự đo sau ngày khu rừng được tạo, rồi lưu mốc
   "tổng giờ học cũ" vào forest/main (chỉ tăng, không bao giờ giảm — kể cả khi bạn
   xoá dữ liệu trình duyệt).

   QUY ĐỔI GIỜ HỌC CŨ (do người dùng tự bấm trong thẻ "Giờ học cũ"):
     • Cứ 6 phút học cũ  → 1 Linh quang  (1 giờ = 10 Linh quang)
     • Đồng thời cộng đúng số phút đó vào "điểm nuôi cây" (để lên cấp rừng, mở
       khoá loài Rare/Epic/Legendary và nuôi cây lớn)
     • Có thể đổi một phần hoặc toàn bộ; phần chưa đổi được giữ lại để đổi sau.
     • Mọi lần đổi đi qua transaction và ghi "convertedSec" → không đổi trùng.

   NGUỒN ĐIỂM NUÔI CÂY KHÁC (1 điểm = 1 phút nuôi cây)
   - Thời gian học THẬT đo bằng bộ đếm hoạt động (tab đang hiển thị, có thao tác,
     ở màn hình học, hoặc Pomodoro đang chạy)
   - Hoàn thành đề (QuizManager.finishQuiz / PdfExamManager.submit): +10 phút
   - 20 flashcard: +5 · Pomodoro: +25 · Mục tiêu ngày: +10 · Chuỗi 7 ngày: +30 · 30 ngày: +120
   Flashcard: window.dispatchEvent(new CustomEvent('forest:flashcards',{detail:{count:1}}))
   hoặc Forest.reportFlashcards(1).
   ========================================================================== */
(function () {
  'use strict';
  var BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (BROWSER && window.Forest) return;

  /* ==========================================================================
     1) CORE — dữ liệu & luật chơi thuần (không đụng DOM/Firebase)
     ======================================================================== */
  var Core = (function () {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var r3 = function (n) { return Math.round(n * 1000) / 1000; };
    var addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
    var dayKey = function (d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var weekKey = function (d) { d = d || new Date(); return dayKey(addDays(d, -((d.getDay() + 6) % 7))); };
    var dayNum = function (d) { return Math.floor((d || new Date()).getTime() / 86400000); };

    var STAGES = ['Hạt giống', 'Mầm non', 'Cây con', 'Cây non', 'Trưởng thành', 'Cổ thụ phát sáng'];
    var THRESH = [0, 20, 60, 120, 240, 480];
    var STAGE_SPARKS = [0, 2, 4, 8, 12, 20];
    var RARITY = {
      common: { label: 'Common', mul: 1, cost: 10, minLevel: 1, color: '#9fb4c8' },
      rare: { label: 'Rare', mul: 1.5, cost: 35, minLevel: 3, color: '#4aa3ff' },
      epic: { label: 'Epic', mul: 2.2, cost: 100, minLevel: 6, color: '#b366ff' },
      legendary: { label: 'Legendary', mul: 3.2, cost: 260, minLevel: 10, color: '#ffb521' }
    };
    var BONUS = { quiz: 10, cards20: 5, pomo: 25, goal: 10, streak7: 30, streak30: 120 };
    var DAY_CAP = 36000;
    var MAX_TREES = 64;
    var LEGACY = { SEC_PER_SPARK: 360, MAX_SEC: 36000 * 3650 };

    var SPECIES = [
      { id: 'oak', name: 'Sồi Xanh', r: 'common', shape: 'round', trunk: ['#6b4a2f', '#4a3220'], leaf: ['#7bd36a', '#3f9a4a', '#2c7a3d'], glow: '#b5ff9a', seas: 'full', desc: 'Cây phổ biến, vững chãi.' },
      { id: 'pine', name: 'Thông Sương', r: 'common', shape: 'pine', trunk: ['#5d4330', '#3f2d20'], leaf: ['#4fae7b', '#2f8059', '#1f5e44'], glow: '#9fffd0', seas: 'conifer', desc: 'Xanh quanh năm, nhuốm sương.' },
      { id: 'birch', name: 'Bạch Dương', r: 'common', shape: 'round', trunk: ['#f1f1ea', '#c9c9bf'], leaf: ['#c7ee7a', '#8fcb52', '#65a83a'], glow: '#eaffb0', seas: 'full', desc: 'Thân trắng, tán nhẹ như lụa.' },
      { id: 'willow', name: 'Liễu Dịu', r: 'common', shape: 'willow', trunk: ['#6d5436', '#4b3926'], leaf: ['#9be07a', '#5fb35a', '#3f8c48'], glow: '#c8ffb0', seas: 'full', desc: 'Cành buông mềm theo gió.' },
      { id: 'sakura', name: 'Anh Đào Hồng', r: 'rare', shape: 'blossom', trunk: ['#6a4538', '#4a2d25'], leaf: ['#ffc2dc', '#ff8fbf', '#ffd9ea'], glow: '#ffb3d9', seas: 'none', desc: 'Hoa nở rộ, cánh bay trong gió.' },
      { id: 'maple', name: 'Phong Đỏ', r: 'rare', shape: 'round', trunk: ['#5f3b2b', '#402519'], leaf: ['#ff9a4d', '#e0482f', '#a8261f'], glow: '#ffb27a', seas: 'none', desc: 'Sắc lá rực như hoàng hôn.' },
      { id: 'wisteria', name: 'Tử Đằng', r: 'rare', shape: 'willow', trunk: ['#5b4a63', '#3d3043'], leaf: ['#c9a6ff', '#9a6bf0', '#6f45c4'], glow: '#d8bfff', seas: 'none', desc: 'Chùm hoa tím rủ xuống như thác.' },
      { id: 'silver', name: 'Bạch Ngân Thông', r: 'rare', shape: 'pine', trunk: ['#7b8795', '#4f5a67'], leaf: ['#cfe8ff', '#8fc3ee', '#5d97c9'], glow: '#d9f0ff', seas: 'none', desc: 'Lá ánh bạc, lạnh và sáng.' },
      { id: 'crystal', name: 'Thủy Tinh Thụ', r: 'epic', shape: 'crystal', trunk: ['#6a7fb0', '#3d4c78'], leaf: ['#9ff3ff', '#4fc3f7', '#a78bfa'], glow: '#7be9ff', seas: 'none', desc: 'Tán pha lê rung lên ánh sao.' },
      { id: 'lumi', name: 'Dạ Quang Thụ', r: 'epic', shape: 'round', trunk: ['#2c4a5a', '#1b3140'], leaf: ['#6ffff0', '#1fbfb8', '#127a85'], glow: '#5ffff0', seas: 'none', desc: 'Phát sáng sinh học trong đêm.' },
      { id: 'gold', name: 'Hoàng Kim Thụ', r: 'epic', shape: 'round', trunk: ['#8a6a2a', '#5c4418'], leaf: ['#fff0a0', '#ffc933', '#d9971a'], glow: '#ffe066', seas: 'none', desc: 'Lá vàng ròng lấp lánh.' },
      { id: 'world', name: 'Thế Giới Thụ', r: 'legendary', shape: 'round', trunk: ['#5a4a7a', '#352a52'], leaf: ['#8dffcf', '#5a9bff', '#b57bff'], glow: '#9fe8ff', seas: 'none', desc: 'Cội nguồn của mọi khu rừng.' },
      { id: 'phoenix', name: 'Phượng Hoàng Thụ', r: 'legendary', shape: 'blossom', trunk: ['#7a2f1f', '#4a1810'], leaf: ['#ffb347', '#ff5a36', '#ffd78a'], glow: '#ff9a52', seas: 'none', desc: 'Tán lửa tái sinh bất tận.' }
    ];
    var SP = {}; SPECIES.forEach(function (s) { SP[s.id] = s; });

    var DECOS = [
      { id: 'lantern', name: 'Đèn Lồng Phép', cost: 20, lv: 1, color: '#ffd36e' },
      { id: 'mushroom', name: 'Nấm Dạ Quang', cost: 20, lv: 1, color: '#7bf6ff' },
      { id: 'rune', name: 'Đá Rune', cost: 15, lv: 1, color: '#b69bff' },
      { id: 'flowers', name: 'Hoa Tiên', cost: 15, lv: 2, color: '#ff9fd1' },
      { id: 'fountain', name: 'Suối Tinh Linh', cost: 80, lv: 4, color: '#7bf6ff' },
      { id: 'shard', name: 'Tinh Thể Ma Pháp', cost: 120, lv: 6, color: '#a78bfa' },
      { id: 'portal', name: 'Cổng Phép Thuật', cost: 150, lv: 7, color: '#c58bff' },
      { id: 'statue', name: 'Tượng Hộ Rừng', cost: 200, lv: 9, color: '#ffc861' }
    ];
    var DC = {}; DECOS.forEach(function (x) { DC[x.id] = x; });

    var LAND = [null, { cost: 40, lv: 2 }, { cost: 110, lv: 4 }, { cost: 240, lv: 6 }, { cost: 450, lv: 9 }, { cost: 800, lv: 13 }];
    var sideOf = function (land) { return 2 + land; };

    var QUESTS = [
      { id: 'd_min30', scope: 'daily', t: 'Học đủ 30 phút', need: 30, unit: 'phút', reward: 15, get: function (d) { return d.day.sec / 60; } },
      { id: 'd_quiz1', scope: 'daily', t: 'Hoàn thành 1 đề / 1 phần', need: 1, unit: 'đề', reward: 15, get: function (d) { return d.day.quiz; } },
      { id: 'd_cards20', scope: 'daily', t: 'Ôn 20 flashcard', need: 20, unit: 'thẻ', reward: 10, get: function (d) { return d.day.cards; } },
      { id: 'd_pomo1', scope: 'daily', t: 'Hoàn thành 1 phiên Pomodoro', need: 1, unit: 'phiên', reward: 15, get: function (d) { return d.day.pomo; } },
      { id: 'w_min300', scope: 'weekly', t: 'Học đủ 300 phút trong tuần', need: 300, unit: 'phút', reward: 80, get: function (d) { return d.week.sec / 60; } },
      { id: 'w_days5', scope: 'weekly', t: 'Học ít nhất 5 ngày trong tuần', need: 5, unit: 'ngày', reward: 60, get: function (d) { return d.week.days.length; } },
      { id: 'w_quiz5', scope: 'weekly', t: 'Hoàn thành 5 đề / phần', need: 5, unit: 'đề', reward: 60, get: function (d) { return d.week.quiz; } },
      { id: 'w_pomo8', scope: 'weekly', t: 'Hoàn thành 8 phiên Pomodoro', need: 8, unit: 'phiên', reward: 70, get: function (d) { return d.week.pomo; } }
    ];

    function freshDay(now) { return { k: dayKey(now), sec: 0, quiz: 0, cards: 0, pomo: 0, cardChunks: 0, claimed: {} }; }
    function freshWeek(now) { return { k: weekKey(now), sec: 0, quiz: 0, pomo: 0, days: [], claimed: {} }; }
    function freshLegacy() { return { baseSec: 0, convertedSec: 0, sparks: 0, srcs: {}, scannedAt: 0 }; }

    function newDoc(ts, now) {
      now = now || new Date();
      return {
        v: 2, trackedSec: 0, bonusMin: 0, fed: 0, lastTrackAt: ts, createdAt: ts,
        sparksEarned: 30, sparksSpent: 0, lvlClaimed: 0, landLevel: 1,
        trees: [], decos: [], focus: null,
        streak: { cur: 0, best: 0, last: '' },
        day: freshDay(now), week: freshWeek(now),
        ev: {}, cardAcc: 0, stats: { quiz: 0, cards: 0, pomo: 0 }, log: [],
        legacy: freshLegacy()
      };
    }

    function normalize(raw, now) {
      var base = newDoc(null, now), d = {}, k;
      for (k in base) d[k] = (raw && raw[k] !== undefined) ? raw[k] : base[k];
      d.streak = Object.assign({ cur: 0, best: 0, last: '' }, d.streak);
      d.stats = Object.assign({ quiz: 0, cards: 0, pomo: 0 }, d.stats);
      d.day = Object.assign(freshDay(now), d.day); d.day.claimed = d.day.claimed || {};
      d.week = Object.assign(freshWeek(now), d.week); d.week.claimed = d.week.claimed || {}; d.week.days = d.week.days || [];
      d.trees = d.trees || []; d.decos = d.decos || []; d.ev = d.ev || {}; d.log = d.log || [];
      d.legacy = Object.assign(freshLegacy(), d.legacy || {});
      d.legacy.srcs = d.legacy.srcs || {};
      return d;
    }
    function rollover(d, now) {
      if (d.day.k !== dayKey(now)) d.day = freshDay(now);
      if (d.week.k !== weekKey(now)) d.week = freshWeek(now);
    }

    var earned = function (d) { return d.trackedSec / 60 + d.bonusMin; };
    var balance = function (d) { return d.sparksEarned - d.sparksSpent; };
    var level = function (e) { return Math.min(50, Math.floor(Math.sqrt(Math.max(0, e) / 30)) + 1); };
    var levelMin = function (l) { return 30 * (l - 1) * (l - 1); };
    var capOf = function (t) { return THRESH[5] * RARITY[(SP[t.sp] || SPECIES[0]).r].mul; };
    function stageOf(t) {
      var mul = RARITY[(SP[t.sp] || SPECIES[0]).r].mul, s = 0;
      for (var i = 1; i <= 5; i++) if (t.g >= THRESH[i] * mul - 1e-6) s = i;
      return s;
    }
    function stageProgress(t) {
      var mul = RARITY[(SP[t.sp] || SPECIES[0]).r].mul, s = stageOf(t);
      if (s >= 5) return { stage: 5, pct: 100, left: 0 };
      var a = THRESH[s] * mul, b = THRESH[s + 1] * mul;
      return { stage: s, pct: Math.max(0, Math.min(100, (t.g - a) / (b - a) * 100)), left: Math.max(0, b - t.g) };
    }

    function durText(sec) {
      sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
      return h ? h + ' giờ ' + m + ' phút' : m + ' phút';
    }
    function pushLog(d, kind, min, text, ctx) {
      d.log.unshift({ t: ctx.now.getTime(), k: kind, m: r3(min), n: text });
      if (d.log.length > 25) d.log.length = 25;
    }
    function grant(d, min, evId, kind, text, ctx) {
      if (evId) { if (d.ev[evId]) return false; d.ev[evId] = dayNum(ctx.now); }
      d.bonusMin = r3(d.bonusMin + min);
      pushLog(d, kind, min, text, ctx);
      ctx.gained.push({ kind: kind, min: min, text: text });
      return true;
    }
    function markActiveDay(d, ctx) {
      var today = dayKey(ctx.now);
      if (d.streak.last === today) return;
      var y = dayKey(addDays(ctx.now, -1));
      d.streak.cur = d.streak.last === y ? d.streak.cur + 1 : 1;
      d.streak.last = today;
      d.streak.best = Math.max(d.streak.best, d.streak.cur);
      if (d.week.days.indexOf(today) < 0) d.week.days.push(today);
      var start = dayKey(addDays(ctx.now, -(d.streak.cur - 1)));
      if (d.streak.cur === 7) grant(d, BONUS.streak7, 'st7:' + start, 'streak', 'Chuỗi 7 ngày học liên tiếp', ctx);
      if (d.streak.cur === 30) grant(d, BONUS.streak30, 'st30:' + start, 'streak', 'Chuỗi 30 ngày học liên tiếp', ctx);
    }
    function addTracked(d, sec, ctx) {
      sec = Math.floor(sec);
      sec = Math.min(sec, Math.max(0, DAY_CAP - d.day.sec));
      if (sec <= 0) return 0;
      d.trackedSec += sec; d.lastTrackAt = ctx.ts;
      d.day.sec += sec; d.week.sec += sec;
      if (d.day.sec >= 300) markActiveDay(d, ctx);
      return sec;
    }
    function completeQuiz(d, evId, label, ctx) {
      if (!grant(d, BONUS.quiz, evId, 'quiz', 'Hoàn thành: ' + label, ctx)) return false;
      d.day.quiz++; d.week.quiz++; d.stats.quiz++;
      markActiveDay(d, ctx);
      return true;
    }
    function completePomo(d, evId, minutes, ctx) {
      var m = Math.max(1, Math.min(BONUS.pomo, Math.floor(minutes) || 0));
      if (!grant(d, m, evId, 'pomo', 'Hoàn thành 1 phiên Pomodoro', ctx)) return false;
      d.day.pomo++; d.week.pomo++; d.stats.pomo++;
      return true;
    }
    function completeGoal(d, evId, ctx) { return grant(d, BONUS.goal, evId, 'goal', 'Hoàn thành mục tiêu ngày', ctx); }
    function reportCards(d, n, ctx) {
      n = Math.max(0, Math.min(200, Math.floor(n) || 0)); if (!n) return 0;
      d.stats.cards += n; d.day.cards += n; d.cardAcc += n;
      var chunks = Math.floor(d.cardAcc / 20); d.cardAcc -= chunks * 20;
      var ok = Math.max(0, Math.min(chunks, 20 - d.day.cardChunks));
      if (ok > 0) { d.day.cardChunks += ok; grant(d, ok * BONUS.cards20, null, 'cards', 'Ôn ' + (ok * 20) + ' flashcard', ctx); }
      return ok;
    }

    /* ---- GIỜ HỌC CŨ ---- */
    var legacyAvail = function (d) { return Math.max(0, d.legacy.baseSec - d.legacy.convertedSec); };
    // Mốc tổng giờ học cũ chỉ TĂNG. Trả về true nếu có thay đổi cần ghi.
    function applyLegacyScan(d, scan, ctx) {
      var L = d.legacy, total = Math.max(0, Math.min(LEGACY.MAX_SEC, Math.floor(scan.total) || 0));
      if (total <= L.baseSec) return false;
      L.baseSec = total; L.srcs = scan.srcs || {}; L.scannedAt = ctx.now.getTime();
      return true;
    }
    function convertLegacy(d, sec, ctx) {
      sec = Math.floor(sec) || 0;
      var avail = legacyAvail(d); sec = Math.min(sec, avail);
      var units = Math.floor(sec / LEGACY.SEC_PER_SPARK);
      if (units < 1) throw new Error('Cần tối thiểu ' + (LEGACY.SEC_PER_SPARK / 60) + ' phút học cũ để đổi 1 Linh quang');
      var use = units * LEGACY.SEC_PER_SPARK, min = use / 60;
      d.legacy.convertedSec += use; d.legacy.sparks += units;
      d.sparksEarned += units; d.bonusMin = r3(d.bonusMin + min);
      pushLog(d, 'legacy', min, 'Quy đổi ' + durText(use) + ' học cũ → +' + units + ' Linh quang', ctx);
      return { sparks: units, min: min, sec: use };
    }

    function distribute(d, ctx) {
      var pool = earned(d) - d.fed, guard = 0;
      while (pool > 0.0005 && guard++ < 200) {
        var t = d.trees.filter(function (x) { return x.id === d.focus && x.g < capOf(x) - 1e-6; })[0];
        if (!t) {
          t = d.trees.filter(function (x) { return x.g < capOf(x) - 1e-6; }).sort(function (a, b) { return a.at - b.at; })[0];
          if (!t) break; d.focus = t.id;
        }
        var before = stageOf(t), give = Math.min(pool, capOf(t) - t.g);
        t.g = r3(t.g + give); d.fed = r3(d.fed + give); pool = r3(pool - give);
        for (var s = before + 1, after = stageOf(t); s <= after; s++) {
          var sk = STAGE_SPARKS[s]; d.sparksEarned += sk;
          ctx.stageUps.push({ id: t.id, name: t.name, stage: s, sparks: sk });
          pushLog(d, 'stage', 0, '"' + t.name + '" đạt giai đoạn ' + STAGES[s] + ' (+' + sk + ' Linh quang)', ctx);
        }
      }
    }
    function claimLevels(d, ctx) {
      var lv = level(earned(d));
      while (d.lvlClaimed < lv - 1) {
        d.lvlClaimed++; var rw = 10 + d.lvlClaimed * 2; d.sparksEarned += rw;
        ctx.levelUps.push({ level: d.lvlClaimed + 1, sparks: rw });
        pushLog(d, 'level', 0, 'Rừng lên cấp ' + (d.lvlClaimed + 1) + ' (+' + rw + ' Linh quang)', ctx);
      }
    }
    function pruneEv(d, now) {
      var today = dayNum(now), keys = Object.keys(d.ev);
      keys.forEach(function (k) { if (today - d.ev[k] > 45) delete d.ev[k]; });
      keys = Object.keys(d.ev);
      if (keys.length > 300) keys.sort(function (a, b) { return d.ev[a] - d.ev[b]; }).slice(0, keys.length - 300).forEach(function (k) { delete d.ev[k]; });
    }
    function settle(d, ctx) { distribute(d, ctx); claimLevels(d, ctx); pruneEv(d, ctx.now); }

    var cleanName = function (n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24); };
    var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); };
    function occupied(d, pos) {
      return d.trees.some(function (t) { return t.pos === pos; }) || d.decos.some(function (x) { return x.pos === pos; });
    }
    function checkPos(d, pos) {
      var n = sideOf(d.landLevel);
      if (!(pos >= 0 && pos < n * n && pos === Math.floor(pos))) throw new Error('Ô đất không hợp lệ');
      if (occupied(d, pos)) throw new Error('Ô đất này đã có vật thể');
    }
    function plant(d, o, ctx) {
      var s = SP[o.sp]; if (!s) throw new Error('Loài cây không tồn tại');
      var R = RARITY[s.r];
      if (level(earned(d)) < R.minLevel) throw new Error('Cần đạt cấp rừng ' + R.minLevel + ' để trồng loài ' + R.label);
      checkPos(d, o.pos);
      if (d.trees.length >= MAX_TREES) throw new Error('Đã đạt số cây tối đa');
      if (balance(d) < R.cost) throw new Error('Không đủ Linh quang (cần ' + R.cost + ')');
      d.sparksSpent += R.cost;
      var t = { id: uid(), sp: s.id, name: cleanName(o.name) || s.name, g: 0, at: ctx.now.getTime(), pos: o.pos };
      d.trees.push(t);
      var cur = d.trees.filter(function (x) { return x.id === d.focus && x.g < capOf(x) - 1e-6; })[0];
      if (!cur) d.focus = t.id;
      pushLog(d, 'plant', 0, 'Trồng "' + t.name + '" (-' + R.cost + ' Linh quang)', ctx);
      return t;
    }
    function placeDeco(d, o, ctx) {
      var x = DC[o.k]; if (!x) throw new Error('Vật trang trí không tồn tại');
      if (level(earned(d)) < x.lv) throw new Error('Cần đạt cấp rừng ' + x.lv);
      checkPos(d, o.pos);
      if (d.decos.length >= MAX_TREES) throw new Error('Đã đạt số vật trang trí tối đa');
      if (balance(d) < x.cost) throw new Error('Không đủ Linh quang (cần ' + x.cost + ')');
      d.sparksSpent += x.cost;
      d.decos.push({ id: uid(), k: x.id, pos: o.pos });
      pushLog(d, 'deco', 0, 'Đặt ' + x.name + ' (-' + x.cost + ' Linh quang)', ctx);
    }
    function removeTree(d, id) {
      d.trees = d.trees.filter(function (t) { return t.id !== id; });
      if (d.focus === id) d.focus = null;
    }
    function removeDeco(d, id) { d.decos = d.decos.filter(function (x) { return x.id !== id; }); }
    function renameTree(d, id, name) {
      var t = d.trees.filter(function (x) { return x.id === id; })[0]; if (!t) throw new Error('Không tìm thấy cây');
      t.name = cleanName(name) || (SP[t.sp] || SPECIES[0]).name;
    }
    function setFocus(d, id) {
      var t = d.trees.filter(function (x) { return x.id === id; })[0]; if (!t) throw new Error('Không tìm thấy cây');
      if (t.g >= capOf(t) - 1e-6) throw new Error('Cây này đã phát triển tối đa');
      d.focus = id;
    }
    function expand(d, ctx) {
      var nx = LAND[d.landLevel]; if (!nx) throw new Error('Đất đã mở rộng tối đa');
      if (level(earned(d)) < nx.lv) throw new Error('Cần đạt cấp rừng ' + nx.lv);
      if (balance(d) < nx.cost) throw new Error('Không đủ Linh quang (cần ' + nx.cost + ')');
      d.sparksSpent += nx.cost; d.landLevel++;
      pushLog(d, 'land', 0, 'Mở rộng đất lên ' + sideOf(d.landLevel) + '×' + sideOf(d.landLevel) + ' (-' + nx.cost + ' Linh quang)', ctx);
    }
    function claimQuest(d, id, ctx) {
      var q = QUESTS.filter(function (x) { return x.id === id; })[0]; if (!q) throw new Error('Nhiệm vụ không tồn tại');
      var b = q.scope === 'daily' ? d.day : d.week;
      if (b.claimed[id]) throw new Error('Bạn đã nhận thưởng nhiệm vụ này');
      if (q.get(d) < q.need) throw new Error('Nhiệm vụ chưa hoàn thành');
      b.claimed[id] = true; d.sparksEarned += q.reward;
      pushLog(d, 'quest', 0, 'Nhiệm vụ "' + q.t + '" (+' + q.reward + ' Linh quang)', ctx);
      return q.reward;
    }

    return {
      STAGES: STAGES, THRESH: THRESH, RARITY: RARITY, BONUS: BONUS, SPECIES: SPECIES, SP: SP, DECOS: DECOS, DC: DC, LAND: LAND, QUESTS: QUESTS,
      LEGACY: LEGACY, DAY_CAP: DAY_CAP, MAX_TREES: MAX_TREES,
      dayKey: dayKey, weekKey: weekKey, addDays: addDays, sideOf: sideOf, newDoc: newDoc, normalize: normalize, rollover: rollover,
      earned: earned, balance: balance, level: level, levelMin: levelMin, capOf: capOf, stageOf: stageOf, stageProgress: stageProgress,
      durText: durText, addTracked: addTracked, completeQuiz: completeQuiz, completePomo: completePomo, completeGoal: completeGoal, reportCards: reportCards,
      legacyAvail: legacyAvail, applyLegacyScan: applyLegacyScan, convertLegacy: convertLegacy,
      settle: settle, plant: plant, placeDeco: placeDeco, removeTree: removeTree, removeDeco: removeDeco, renameTree: renameTree,
      setFocus: setFocus, expand: expand, claimQuest: claimQuest, occupied: occupied
    };
  })();

  if (!BROWSER) { if (typeof module !== 'undefined') module.exports = { Core: Core }; return; }

  /* ==========================================================================
     2) MÔI TRƯỜNG & TIỆN ÍCH  (biến const của index.html không nằm trên window)
     ======================================================================== */
  var LSK = 'examMasterPro_forest_';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function DB() { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (e) { } return window.fbDb || null; }
  function AU() { try { if (typeof fbAuth !== 'undefined' && fbAuth) return fbAuth; } catch (e) { } return window.fbAuth || null; }
  function UIM() { try { if (typeof UIManager !== 'undefined' && UIManager) return UIManager; } catch (e) { } return window.UIManager || null; }
  function toast(type, title, msg) { var u = UIM(); if (u && u.toast) u.toast(type, title, msg || ''); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function tsMs(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : Date.now()); }
  function fmtDur(sec) { return Core.durText(sec); }
  function fmtMin(m) { return Math.floor(m * 10) / 10; }
  function fmtHr(sec) { return (Math.round(sec / 360) / 10).toString().replace('.', ',') + ' giờ'; }

  var S = {
    uid: null, d: null, ready: false, booting: false, active: false, err: null,
    tab: 'plant', sel: null, season: lsGet(LSK + 'season', 'auto'), pending: [], goalTried: {}, prevStage: {},
    lgBusy: false, lgAt: 0, lgDone: false, lgSrcs: null, lgErr: null
  };
  var T = { buf: 0, last: Date.now(), lastAct: Date.now(), lastIframe: 0, flushing: false, cards: 0, cardsAt: 0 };
  var TAB = Math.random().toString(36).slice(2);

  /* ==========================================================================
     3) TRANSACTION — mọi thay đổi đi qua đây (tuần tự, chống cộng trùng)
     ======================================================================== */
  var Q = Promise.resolve();
  function mutate(fn) { var p = Q.then(function () { return doTx(fn); }); Q = p.catch(function () { }); return p; }
  async function doTx(fn) {
    var db = DB(), ref = db.collection('users').doc(S.uid).collection('forest').doc('main'), ctx, d;
    await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref), fresh = !snap.exists, now = new Date();
      ctx = { now: now, ts: firebase.firestore.FieldValue.serverTimestamp(), gained: [], stageUps: [], levelUps: [], skip: false, out: null };
      d = fresh ? Core.newDoc(ctx.ts, now) : Core.normalize(snap.data(), now);
      Core.rollover(d, now);
      ctx.out = fn(d, ctx, fresh);
      if (!fresh && ctx.skip) return;
      Core.settle(d, ctx);
      tx.set(ref, d);
    });
    var T0 = firebase.firestore.Timestamp.now();
    if (d.lastTrackAt && typeof d.lastTrackAt.toMillis !== 'function') d.lastTrackAt = T0;
    if (d.createdAt && typeof d.createdAt.toMillis !== 'function') d.createdAt = T0;
    S.d = d;
    announce(ctx);
    if (S.active) renderAll();
    return ctx;
  }
  function announce(ctx) {
    ctx.gained.forEach(function (g) { floatText('+' + fmtMin(g.min) + ' phút · ' + g.text); });
    ctx.stageUps.forEach(function (u) { toast('success', '🌳 Cây lớn lên!', '"' + u.name + '" đạt giai đoạn ' + Core.STAGES[u.stage] + ' · +' + u.sparks + ' ✨'); S.prevStage[u.id] = -1; });
    ctx.levelUps.forEach(function (u) { toast('success', '✨ Rừng lên cấp ' + u.level, '+' + u.sparks + ' Linh quang'); });
  }
  function handleErr(e, what) {
    console.warn('[Forest] ' + what, e);
    if (e && (e.code === 'permission-denied' || /permission/i.test(e.message || ''))) S.err = 'perm';
    else if (e && e.code) S.err = S.err || 'net';
    if (S.active) renderBanner();
  }
  function whenReady(fn) { if (S.ready) fn(); else S.pending.push(fn); }

  /* ==========================================================================
     4) ĐO THỜI GIAN HỌC THẬT
     ======================================================================== */
  function readPomo() { return lsGet('examMasterPro_tools_pomo', null); }
  function activeViewId() { var v = $('.view.active'); return v ? v.id.replace('view-', '') : ''; }
  function inStudyView() {
    var id = activeViewId();
    if (id === 'quiz') { var a = $('#quizActiveArea'); return !!(a && a.style.display !== 'none'); }
    if (id === 'pdfExam') { var p = $('#pdfExamActiveArea'); return !!(p && p.style.display !== 'none'); }
    if (id === 'tailieu') {
      var cur = window.TaiLieu && typeof window.TaiLieu.current === 'function' ? window.TaiLieu.current() : null;
      return !!(cur || $('#tdView iframe'));
    }
    if (id === 'course' || id === 'essayGrader') return true;
    return /flash/i.test(id);
  }
  function lockHeld() {
    var now = Date.now();
    try {
      var v = JSON.parse(localStorage.getItem(LSK + 'lock') || 'null');
      if (!v || v.id === TAB || now - v.t > 20000) { localStorage.setItem(LSK + 'lock', JSON.stringify({ id: TAB, t: now })); return true; }
      return false;
    } catch (e) { return true; }
  }
  function studying(now, pomoOn) {
    if (pomoOn) return true;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
    if (!inStudyView()) return false;
    var ae = document.activeElement;
    return (now - T.lastAct < 150000) || (now - T.lastIframe < 600000 && ae && ae.tagName === 'IFRAME');
  }
  function persistBuf() { if (S.uid) lsSet(LSK + 'buf_' + S.uid, { sec: T.buf }); }
  function onAct() { T.lastAct = Date.now(); }
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) { document.addEventListener(ev, onAct, { passive: true, capture: true }); });
  document.addEventListener('scroll', onAct, { passive: true, capture: true });
  window.addEventListener('blur', function () { setTimeout(function () { var ae = document.activeElement; if (ae && ae.tagName === 'IFRAME') T.lastIframe = Date.now(); }, 0); });

  function sample() {
    var now = Date.now(), dt = now - T.last; T.last = now;
    if (!S.ready) return;
    var pomo = readPomo(), pomoOn = !!(pomo && pomo.running && pomo.mode === 'focus' && pomo.endAt > now);
    dt = Math.min(dt, pomoOn ? 70000 : 15000);
    if (dt > 0 && lockHeld() && studying(now, pomoOn)) { T.buf += dt / 1000; persistBuf(); }
    if (T.buf >= 300) flushTracked();
    pollCards(now);
    pollIntegrations(pomo);
    if (S.active) { renderStats(); renderPool(); }
  }
  async function flushTracked() {
    if (!S.ready || T.flushing) return;
    var sec = Math.floor(T.buf); if (sec < 10) return;
    T.flushing = true;
    try {
      await mutate(function (d, ctx) {
        var allowed = Math.max(0, Math.floor((Date.now() - tsMs(d.lastTrackAt)) / 1000) - 2);
        var use = Math.min(sec, allowed);
        if (!(use > 0 && Core.addTracked(d, use, ctx))) ctx.skip = true;
      });
      T.buf = Math.max(0, T.buf - sec); persistBuf();
    } catch (e) { handleErr(e, 'flushTracked'); }
    T.flushing = false;
  }
  async function pollCards(now) {
    if (!T.cards) return;
    if (T.cards < 20 && now - T.cardsAt < 60000) return;
    var n = T.cards; T.cards = 0;
    try { await mutate(function (d, ctx) { Core.reportCards(d, n, ctx); }); }
    catch (e) { T.cards += n; handleErr(e, 'cards'); }
  }
  function reportFlashcards(n) {
    n = Math.max(0, Math.min(100, Math.floor(+n || 0))); if (!n) return;
    if (!T.cards) T.cardsAt = Date.now();
    T.cards += n;
  }
  window.addEventListener('forest:flashcards', function (e) { reportFlashcards(e && e.detail ? e.detail.count : 1); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushTracked(); pollCards(Infinity); } });

  /* ---- tích hợp: Pomodoro (study-tools.js) + mục tiêu ngày ---- */
  var integ = { busy: false, after: null };
  function pollIntegrations(pomo) {
    if (integ.busy || !S.ready) return;
    var jobs = [], today = Core.dayKey(), dev = lsGet(LSK + 'dev', null);
    if (!dev) { dev = TAB; lsSet(LSK + 'dev', dev); }
    if (pomo && typeof pomo.done === 'number') {
      var key = LSK + 'pomoSeen_' + S.uid, seen = lsGet(key, null);
      if (seen === null || seen > pomo.done) { lsSet(key, pomo.done); }
      else if (pomo.done > seen) {
        var from = seen, to = Math.min(pomo.done, seen + 6), mins = pomo.focus || 25;
        jobs.push(function (d, ctx) { for (var i = from + 1; i <= to; i++) Core.completePomo(d, 'po:' + dev + ':' + i, mins, ctx); });
        integ.after = function () { lsSet(key, pomo.done); };
      }
    }
    if (!S.goalTried[today] && S.d && !S.d.ev['goal:' + today]) {
      var log = lsGet('examMasterPro_dailyLog', {}), t = log[today] || {}, goal = lsGet('examMasterPro_tools_goal', 30);
      if ((t.correct || 0) + (t.wrong || 0) >= goal && goal > 0) {
        S.goalTried[today] = true;
        jobs.push(function (d, ctx) { Core.completeGoal(d, 'goal:' + today, ctx); });
      }
    }
    if (!jobs.length) return;
    integ.busy = true;
    mutate(function (d, ctx) { jobs.forEach(function (j) { j(d, ctx); }); })
      .then(function () { if (integ.after) integ.after(); })
      .catch(function (e) { handleErr(e, 'integrations'); })
      .then(function () { integ.busy = false; integ.after = null; });
  }

  /* ---- hook hoàn thành đề: bọc thêm, không sửa hàm gốc ---- */
  function hookApp() {
    var ui = UIM();
    if (ui && !ui.__forestWrapped && typeof ui.navigate === 'function') {
      ui.__forestWrapped = true;
      ui.titles = ui.titles || {};
      ui.titles.forest = ['Study Forest', 'Mỗi phút học thật nuôi lớn khu rừng phép thuật của bạn'];
      var nav = ui.navigate.bind(ui);
      ui.navigate = function (view) { var r = nav(view); if (view === 'forest') onEnter(); else onLeave(); return r; };
    }
    try {
      if (typeof QuizManager !== 'undefined' && QuizManager && !QuizManager.__forestWrapped) {
        QuizManager.__forestWrapped = true;
        var fq = QuizManager.finishQuiz.bind(QuizManager);
        QuizManager.finishQuiz = function () {
          var st = QuizManager.state, snap = st ? { id: st.partId, name: st.partName, start: st.startTime, pure: !!st.isPureReview, total: st.totalOriginal } : null;
          var r = fq();
          try { onQuizDone(snap); } catch (e) { console.warn('[Forest]', e); }
          return r;
        };
      }
    } catch (e) { }
    try {
      if (typeof PdfExamManager !== 'undefined' && PdfExamManager && !PdfExamManager.__forestWrapped) {
        PdfExamManager.__forestWrapped = true;
        var fp = PdfExamManager.submit.bind(PdfExamManager);
        PdfExamManager.submit = function () {
          var st = PdfExamManager.state, snap = (st && !st.finished) ? { id: st.exam.id, name: st.exam.name, start: st.startTime, total: st.exam.totalQuestions } : null;
          var r = fp();
          try { if (snap && PdfExamManager.state && PdfExamManager.state.finished) onPdfDone(snap); } catch (e) { console.warn('[Forest]', e); }
          return r;
        };
      }
    } catch (e) { }
  }
  function award(evId, label, minSec, snap) {
    var dur = (Date.now() - snap.start) / 1000;
    if (dur < minSec) { toast('warn', 'Study Forest', 'Bài hoàn thành quá nhanh nên không tính thưởng nuôi cây'); return; }
    whenReady(function () {
      mutate(function (d, ctx) { Core.completeQuiz(d, evId, label, ctx); })
        .then(function () { pollIntegrations(readPomo()); })
        .catch(function (e) { handleErr(e, 'award'); });
    });
  }
  function onQuizDone(snap) {
    if (!snap || snap.pure) return;
    award('qz:' + snap.id + ':' + Math.floor(snap.start / 1000), snap.name || 'đề thi', (snap.total || 10) * 4, snap);
  }
  function onPdfDone(snap) {
    award('pdf:' + snap.id + ':' + Math.floor(snap.start / 1000), snap.name || 'đề PDF', (snap.total || 10) * 3, snap);
  }

  /* ==========================================================================
     5) QUÉT GIỜ HỌC CŨ — chỉ ĐỌC; dùng đúng các nguồn mà rules hiện tại cho phép
     ======================================================================== */
  var num = function (v) { v = Number(v); return isFinite(v) && v > 0 ? v : 0; };
  async function scanLegacy(force) {
    if (!S.ready || !S.uid || !S.d || S.lgBusy || !DB()) return;
    var now = Date.now();
    if (!force && S.lgAt && now - S.lgAt < 600000) return;
    S.lgBusy = true; S.lgErr = null; if (S.active) renderLegacy();
    try {
      var db = DB(), uid = S.uid;
      // Ngày khu rừng được tạo: từ ngày này trở đi Study Forest đã tự đo → không tính lại.
      var createdMs = tsMs(S.d.createdAt), ck = Core.dayKey(new Date(createdMs));

      // (1) localStorage — nhật ký ngày (timeSec) và lịch sử làm bài
      var log = lsGet('examMasterPro_dailyLog', {}), lsBefore = 0, lsSince = 0;
      Object.keys(log || {}).forEach(function (k) {
        var s = num(log[k] && log[k].timeSec);
        if (k < ck) lsBefore += s; else lsSince += s;
      });
      var hist = lsGet('examMasterPro_history', []), histBefore = 0;
      if (Array.isArray(hist)) hist.forEach(function (h) {
        var s = num(h && h.timeSec), t = Date.parse(h && h.timestamp);
        if (s && (isNaN(t) || t < createdMs)) histBefore += s;
      });

      // (2) Firestore leaderboard/{uid}.studyTimeSec  (tổng, đồng bộ giữa các thiết bị)
      var lb = 0;
      try {
        var ls = await db.collection('leaderboard').doc(uid).get();
        if (ls.exists) lb = num(ls.data().studyTimeSec);
      } catch (e) { console.warn('[Forest] Không đọc được leaderboard:', e); }
      var lbAdj = Math.max(0, lb - lsSince); // trừ phần đã nằm trong thời gian Forest tự đo

      // (3) Firestore users/{uid}.totalStudyMinutes (API signin.js)
      var usr = 0;
      try {
        var us = await db.collection('users').doc(uid).get();
        if (us.exists) usr = num(us.data().totalStudyMinutes) * 60;
      } catch (e) { console.warn('[Forest] Không đọc được hồ sơ users:', e); }

      var srcs = { ls: Math.floor(lsBefore), hist: Math.floor(histBefore), lb: Math.floor(lbAdj), usr: Math.floor(usr) };
      var total = Math.max(srcs.ls, srcs.hist, srcs.lb, srcs.usr);
      S.lgSrcs = srcs;
      await mutate(function (d, ctx) { if (!Core.applyLegacyScan(d, { total: total, srcs: srcs }, ctx)) ctx.skip = true; });
      S.lgAt = Date.now(); S.lgDone = true;
    } catch (e) {
      S.lgErr = e && e.message ? e.message : 'Không quét được dữ liệu';
      handleErr(e, 'scanLegacy');
    }
    S.lgBusy = false;
    if (S.active) renderLegacy();
  }
  function convertLegacy(sec) {
    return mutate(function (d, ctx) { return Core.convertLegacy(d, sec, ctx); }).then(function (ctx) {
      var o = ctx.out;
      toast('success', '✨ Quy đổi thành công', '+' + o.sparks + ' Linh quang · +' + fmtMin(o.min) + ' phút nuôi cây');
      floatText('+' + o.sparks + ' Linh quang');
      return ctx;
    }).catch(function (e) { toast('error', 'Study Forest', e.message || 'Không quy đổi được'); handleErr(e, 'convert'); });
  }

  /* ==========================================================================
     6) SVG: CÂY (6 giai đoạn × 13 loài) & VẬT TRANG TRÍ
     ======================================================================== */
  var GID = 0;
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function treeSVG(spId, stage) {
    var sp = Core.SP[spId] || Core.SPECIES[0], id = 'fg' + (++GID), c1 = sp.leaf[0], c2 = sp.leaf[1], c3 = sp.leaf[2];
    var R = rng(spId.length * 977 + stage * 131 + spId.charCodeAt(0)), o = '', i;
    o += '<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>' +
      '<radialGradient id="' + id + 'l" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></radialGradient>' +
      '<linearGradient id="' + id + 't" x1="0" x2="1"><stop offset="0" stop-color="' + sp.trunk[0] + '"/><stop offset="1" stop-color="' + sp.trunk[1] + '"/></linearGradient>' +
      '<radialGradient id="' + id + 'a"><stop offset="0" stop-color="' + sp.glow + '" stop-opacity=".6"/><stop offset="1" stop-color="' + sp.glow + '" stop-opacity="0"/></radialGradient></defs>';
    o += '<ellipse cx="50" cy="108" rx="' + (10 + stage * 5) + '" ry="3.2" fill="rgba(0,0,0,.28)"/>';
    if (stage === 0) {
      o += '<ellipse cx="50" cy="106" rx="17" ry="6" fill="#4a3226"/><ellipse cx="50" cy="104" rx="14" ry="5" fill="#6a4a36"/>' +
        '<g class="fo-seed"><circle cx="50" cy="98" r="10" fill="url(#' + id + 'a)"/><ellipse cx="50" cy="99" rx="4" ry="5.5" fill="' + sp.glow + '"/></g>';
      return o + '</svg>';
    }
    if (stage === 1) {
      o += '<ellipse cx="50" cy="106" rx="13" ry="4.5" fill="#5a3f2e"/><path d="M50 106 C50 98 49 92 50 86" stroke="' + c2 + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="43" cy="88" rx="7" ry="3.6" transform="rotate(-32 43 88)" fill="' + c1 + '"/><ellipse cx="57.5" cy="84" rx="7.5" ry="3.8" transform="rotate(30 57.5 84)" fill="' + c1 + '"/>' +
        '<circle cx="50" cy="84" r="9" fill="url(#' + id + 'a)" opacity=".5" class="fo-aura"/>';
      return o + '</svg>';
    }
    var H = [0, 0, 16, 26, 36, 44][stage], W = [0, 0, 4.5, 7, 10, 13][stage], r = [0, 0, 13, 20, 28, 35][stage];
    var cy = 108 - H - r * 0.45, cx = 50, w2 = W * 0.6, rar = sp.r;
    if (stage >= 5 || (stage === 4 && (rar === 'epic' || rar === 'legendary')))
      o += '<circle cx="50" cy="' + cy + '" r="' + (r * 1.7) + '" fill="url(#' + id + 'a)" class="fo-aura" opacity="' + (stage >= 5 ? 0.95 : 0.55) + '"/>';
    o += '<path d="M' + (50 - W / 2) + ' 108 C' + (50 - W / 2) + ' ' + (108 - H * 0.5) + ' ' + (50 - w2 / 2) + ' ' + (108 - H * 0.6) + ' ' + (50 - w2 / 2) + ' ' + (108 - H) +
      ' L' + (50 + w2 / 2) + ' ' + (108 - H) + ' C' + (50 + w2 / 2) + ' ' + (108 - H * 0.6) + ' ' + (50 + W / 2) + ' ' + (108 - H * 0.5) + ' ' + (50 + W / 2) + ' 108Z" fill="url(#' + id + 't)"/>';
    if (stage >= 3) o += '<path d="M' + (50 - W) + ' 109 Q' + (50 - W / 2) + ' 103 50 103 Q' + (50 + W / 2) + ' 103 ' + (50 + W) + ' 109Z" fill="url(#' + id + 't)"/>';
    if (stage >= 4) o += '<path d="M50 ' + (108 - H * 0.5) + ' Q' + (50 - r * 0.6) + ' ' + (108 - H * 0.75) + ' ' + (50 - r * 0.8) + ' ' + (cy + r * 0.2) + '" stroke="' + sp.trunk[1] + '" stroke-width="2.4" fill="none"/>' +
      '<path d="M50 ' + (108 - H * 0.55) + ' Q' + (50 + r * 0.6) + ' ' + (108 - H * 0.8) + ' ' + (50 + r * 0.8) + ' ' + (cy + r * 0.1) + '" stroke="' + sp.trunk[1] + '" stroke-width="2.4" fill="none"/>';
    var shape = sp.shape;
    if (shape === 'round' || shape === 'blossom' || shape === 'willow') {
      var rr = shape === 'willow' ? r * 0.85 : r;
      [[-.55, .25, .68], [.55, .2, .64], [0, -.42, .72]].forEach(function (p) { o += '<circle cx="' + (cx + p[0] * rr) + '" cy="' + (cy + p[1] * rr) + '" r="' + (p[2] * rr) + '" fill="' + c3 + '"/>'; });
      o += '<circle cx="' + cx + '" cy="' + (cy + rr * 0.05) + '" r="' + (rr * 0.92) + '" fill="url(#' + id + 'l)"/>';
      for (i = 0; i < 6; i++) { var an = R() * 6.283, dd = R() * rr * 0.65; o += '<circle cx="' + (cx + Math.cos(an) * dd) + '" cy="' + (cy + Math.sin(an) * dd) + '" r="' + (rr * (0.1 + R() * 0.09)) + '" fill="' + c1 + '" opacity=".5"/>'; }
      o += '<circle cx="' + (cx - rr * 0.28) + '" cy="' + (cy - rr * 0.32) + '" r="' + (rr * 0.32) + '" fill="rgba(255,255,255,.17)"/>';
      if (shape === 'blossom') {
        for (i = 0; i < 6 + stage * 3; i++) { var a2 = R() * 6.283, d2 = R() * rr * 0.95; o += '<circle cx="' + (cx + Math.cos(a2) * d2) + '" cy="' + (cy + Math.sin(a2) * d2) + '" r="' + (1.2 + R() * 1.6) + '" fill="' + (i % 3 ? c3 : '#fff') + '" opacity=".92"/>'; }
        if (stage >= 4) for (i = 0; i < 3; i++) o += '<ellipse class="fo-petal" style="animation-delay:' + (i * 1.3) + 's" cx="' + (cx - rr * 0.6 + i * rr * 0.6) + '" cy="' + (cy + rr * 0.8) + '" rx="2.2" ry="1.2" fill="' + c1 + '"/>';
      }
      if (shape === 'willow') {
        var n = 5 + stage * 2;
        for (i = 0; i < n; i++) {
          var x0 = cx - rr * 0.95 + (rr * 1.9) * i / (n - 1), y0 = cy + rr * 0.35 + Math.abs(x0 - cx) * 0.18, L = rr * (0.9 + R() * 0.6), dx = (R() - 0.5) * 6;
          o += '<path class="fo-strand" style="animation-delay:' + (i * 0.25) + 's" d="M' + x0 + ' ' + y0 + ' Q' + (x0 + dx) + ' ' + (y0 + L * 0.55) + ' ' + (x0 + dx * 1.5) + ' ' + (y0 + L) + '" stroke="' + (i % 2 ? c1 : c2) + '" stroke-width="2.1" fill="none" stroke-linecap="round"/>';
        }
      }
    } else if (shape === 'pine') {
      var tiers = stage <= 2 ? 2 : (stage === 3 ? 3 : 4);
      for (i = tiers - 1; i >= 0; i--) {
        var top = cy - r * 1.2 + i * r * 0.5, half = r * (0.55 + 0.45 * (tiers > 1 ? i / (tiers - 1) : 0)), tH = r * 0.95;
        o += '<polygon points="50,' + top + ' ' + (50 - half) + ',' + (top + tH) + ' ' + (50 + half) + ',' + (top + tH) + '" fill="' + (i % 2 ? c3 : (i === 0 ? 'url(#' + id + 'l)' : c2)) + '"/>' +
          '<polygon points="50,' + top + ' ' + (50 - half * 0.2) + ',' + (top + tH * 0.5) + ' ' + (50 + half * 0.55) + ',' + (top + tH * 0.9) + ' ' + (50 + half) + ',' + (top + tH) + ' 50,' + (top + tH) + '" fill="rgba(0,0,0,.1)"/>';
      }
    } else {
      var sh = function (ang, sc, fill) { return '<g transform="rotate(' + ang + ' ' + cx + ' ' + (cy + r * 0.5) + ')"><polygon points="' + cx + ',' + (cy - r * 1.05 * sc) + ' ' + (cx + r * 0.36 * sc) + ',' + cy + ' ' + cx + ',' + (cy + r * 0.55) + ' ' + (cx - r * 0.36 * sc) + ',' + cy + '" fill="' + fill + '" stroke="rgba(255,255,255,.65)" stroke-width=".8" opacity=".92"/><line x1="' + cx + '" y1="' + (cy - r * 1.05 * sc) + '" x2="' + cx + '" y2="' + (cy + r * 0.55) + '" stroke="rgba(255,255,255,.35)" stroke-width=".6"/></g>'; };
      o += sh(-52, .7, c3) + sh(52, .7, c3) + sh(-26, .88, c2) + sh(26, .88, c2) + sh(0, 1, 'url(#' + id + 'l)');
      if (stage >= 4) for (i = 0; i < 3; i++) o += '<path class="fo-spark" style="animation-delay:' + (i * 0.9) + 's" d="M' + (cx - r * 0.7 + i * r * 0.7) + ' ' + (cy - r * 0.6 + (i % 2) * r * 0.5) + ' l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" fill="#fff"/>';
    }
    if (stage >= 5) {
      for (i = 0; i < (rar === 'legendary' ? 10 : 6); i++) o += '<circle class="fo-mote" style="animation-delay:' + (i * 0.55) + 's" cx="' + (cx + (R() - 0.5) * r * 2.6) + '" cy="' + (cy + (R() - 0.5) * r * 2.2) + '" r="' + (0.9 + R() * 1.4) + '" fill="' + sp.glow + '"/>';
      if (rar === 'legendary') o += '<ellipse class="fo-ring" cx="' + cx + '" cy="' + cy + '" rx="' + (r * 1.35) + '" ry="' + (r * 0.36) + '" fill="none" stroke="' + sp.glow + '" stroke-width="1.2" stroke-dasharray="3 4" transform="rotate(-15 ' + cx + ' ' + cy + ')"/>';
    }
    return o + '</svg>';
  }
  function decoSVG(k) {
    var x = Core.DC[k] || Core.DECOS[0], id = 'fd' + (++GID), c = x.color, o = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="' + id + '"><stop offset="0" stop-color="' + c + '" stop-opacity=".65"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient></defs><ellipse cx="50" cy="90" rx="22" ry="5" fill="rgba(0,0,0,.28)"/>';
    switch (k) {
      case 'lantern': o += '<rect x="47.5" y="42" width="5" height="48" rx="2" fill="#4b3b5c"/><circle cx="50" cy="30" r="24" fill="url(#' + id + ')" class="fo-aura"/><path d="M50 44 C37 40 38 20 50 14 C62 20 63 40 50 44Z" fill="#ffd36e"/><rect x="44" y="12" width="12" height="4" rx="2" fill="#4b3b5c"/>'; break;
      case 'mushroom': o += '<circle cx="50" cy="66" r="30" fill="url(#' + id + ')" class="fo-aura"/><rect x="45" y="62" width="10" height="26" rx="4" fill="#e9e2f2"/><path d="M26 66 C28 40 72 40 74 66Z" fill="#3fb6c9"/><circle cx="42" cy="56" r="3.6" fill="#d9fbff"/><circle cx="58" cy="52" r="2.8" fill="#d9fbff"/><circle cx="52" cy="60" r="2.2" fill="#d9fbff"/>'; break;
      case 'rune': o += '<circle cx="50" cy="58" r="26" fill="url(#' + id + ')" class="fo-aura"/><path d="M28 88 L32 48 L50 34 L68 46 L74 88Z" fill="#6b6f86"/><path d="M32 48 L50 34 L68 46 L52 54Z" fill="#8e93ab"/><path d="M50 56 L50 74 M43 62 L57 68 M43 70 L57 64" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round" class="fo-ring"/>'; break;
      case 'flowers': o += '<circle cx="50" cy="60" r="30" fill="url(#' + id + ')" class="fo-aura"/>' + [[34, '#ff9fd1', 56], [52, '#ffe27a', 46], [68, '#8fd0ff', 58]].map(function (f) { return '<path d="M' + f[0] + ' 90 Q' + (f[0] + 2) + ' ' + (f[2] + 16) + ' ' + f[0] + ' ' + f[2] + '" stroke="#3f9a4a" stroke-width="2.6" fill="none"/><circle cx="' + f[0] + '" cy="' + f[2] + '" r="7" fill="' + f[1] + '"/><circle cx="' + f[0] + '" cy="' + f[2] + '" r="2.6" fill="#fff6d0"/>'; }).join(''); break;
      case 'fountain': o += '<circle cx="50" cy="52" r="34" fill="url(#' + id + ')" class="fo-aura"/><ellipse cx="50" cy="80" rx="30" ry="9" fill="#7f86a8"/><ellipse cx="50" cy="77" rx="25" ry="6.5" fill="#4fc3f7"/><rect x="46" y="48" width="8" height="28" rx="3" fill="#9aa1c0"/><path class="fo-strand" d="M50 48 Q36 44 32 68 M50 48 Q64 44 68 68 M50 48 Q50 30 50 52" stroke="#bff3ff" stroke-width="2.2" fill="none" stroke-linecap="round"/>'; break;
      case 'shard': o += '<circle cx="50" cy="56" r="34" fill="url(#' + id + ')" class="fo-aura"/><polygon points="50,12 62,56 50,88 38,56" fill="#a78bfa" stroke="rgba(255,255,255,.6)" stroke-width=".8"/><polygon points="30,38 40,64 32,88 22,64" fill="#7be9ff" opacity=".9"/><polygon points="72,34 80,62 72,88 64,62" fill="#c4a8ff" opacity=".9"/>'; break;
      case 'portal': o += '<circle cx="50" cy="50" r="38" fill="url(#' + id + ')" class="fo-aura"/><rect x="22" y="76" width="14" height="14" rx="3" fill="#6b6f86"/><rect x="64" y="76" width="14" height="14" rx="3" fill="#6b6f86"/><ellipse cx="50" cy="50" rx="25" ry="34" fill="#2a1450" stroke="' + c + '" stroke-width="3.5"/><ellipse class="fo-ring" cx="50" cy="50" rx="15" ry="24" fill="none" stroke="#f0d8ff" stroke-width="1.6" stroke-dasharray="4 5"/>'; break;
      default: o += '<circle cx="50" cy="46" r="34" fill="url(#' + id + ')" class="fo-aura"/><rect x="34" y="78" width="32" height="10" rx="3" fill="#6b6f86"/><path d="M38 78 L42 52 Q50 44 58 52 L62 78Z" fill="#9aa1b8"/><circle cx="50" cy="38" r="9" fill="#aab1c8"/><circle cx="46.5" cy="37" r="1.8" fill="' + c + '" class="fo-aura"/><circle cx="53.5" cy="37" r="1.8" fill="' + c + '" class="fo-aura"/>';
    }
    return o + '</svg>';
  }
  var previewCache = {};
  function sprev(id) { return previewCache['s' + id] || (previewCache['s' + id] = treeSVG(id, 4)); }
  function dprev(id) { return previewCache['d' + id] || (previewCache['d' + id] = decoSVG(id)); }

  /* ==========================================================================
     7) HIỆU ỨNG PHÉP THUẬT (canvas hạt)
     ======================================================================== */
  var Fx = {
    cv: null, ctx: null, parts: [], raf: 0, season: 'summer', w: 0, h: 0, ro: null,
    reduce: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
    init: function (cv) {
      this.cv = cv; this.ctx = cv.getContext('2d');
      var self = this;
      if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self.size(); }); this.ro.observe(cv.parentNode); }
      this.size();
    },
    size: function () {
      if (!this.cv) return; var dpr = Math.min(window.devicePixelRatio || 1, 2), p = this.cv.parentNode;
      this.w = p.clientWidth; this.h = p.clientHeight;
      this.cv.width = Math.max(1, Math.round(this.w * dpr)); this.cv.height = Math.max(1, Math.round(this.h * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    spawn: function (init) {
      var s = this.season, t = Math.random(), type = 'mote';
      if (s === 'spring' && t < 0.55) type = 'petal'; else if (s === 'autumn' && t < 0.6) type = 'leaf'; else if (s === 'winter' && t < 0.7) type = 'snow';
      var colors = { petal: ['#ffc2dc', '#ffd9ea', '#fff'], leaf: ['#ff9a4d', '#e0482f', '#ffc247'], snow: ['#fff'], mote: [{ spring: '#ffd1f0', summer: '#b8ff9b', autumn: '#ffc66d', winter: '#e8fbff' }[s]] }[type];
      return {
        type: type, x: Math.random() * this.w, y: init ? Math.random() * this.h : (type === 'mote' ? Math.random() * this.h : -10),
        vx: (Math.random() - 0.5) * (type === 'mote' ? 0.25 : 0.5), vy: type === 'mote' ? (Math.random() - 0.5) * 0.2 : 0.25 + Math.random() * 0.6,
        r: type === 'snow' ? 1.2 + Math.random() * 2 : type === 'mote' ? 1.4 + Math.random() * 2.2 : 2.5 + Math.random() * 2.5,
        ph: Math.random() * 6.28, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.04, c: colors[Math.floor(Math.random() * colors.length)]
      };
    },
    setSeason: function (s) {
      this.season = s; var n = (window.innerWidth < 700 ? 20 : 38), self = this;
      this.parts = Array.from({ length: n }, function () { return self.spawn(true); });
    },
    draw: function (t) {
      var c = this.ctx; c.clearRect(0, 0, this.w, this.h);
      for (var i = 0; i < this.parts.length; i++) {
        var p = this.parts[i];
        if (!this.reduce) {
          p.ph += 0.02; p.x += p.vx + (p.type === 'mote' ? 0 : Math.sin(p.ph) * 0.35); p.y += p.vy; p.rot += p.vr;
          if (p.y > this.h + 12 || p.y < -14 || p.x < -14 || p.x > this.w + 14) { var n = this.spawn(false); if (p.type === 'mote') { n.y = Math.random() * this.h; } this.parts[i] = p = n; }
        }
        if (p.type === 'mote') {
          var a = 0.45 + 0.4 * Math.sin(t / 700 + p.ph), g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          c.globalAlpha = Math.max(0.1, a); g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g;
          c.beginPath(); c.arc(p.x, p.y, p.r * 5, 0, 6.283); c.fill();
        } else if (p.type === 'snow') { c.globalAlpha = 0.85; c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }
        else { c.globalAlpha = 0.9; c.fillStyle = p.c; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.beginPath(); c.ellipse(0, 0, p.r * 1.4, p.r * 0.7, 0, 0, 6.283); c.fill(); c.restore(); }
      }
      c.globalAlpha = 1;
    },
    start: function () {
      if (this.raf || !this.cv) return; var self = this;
      this.size(); if (!this.parts.length) this.setSeason(this.season);
      if (this.reduce) { this.draw(0); return; }
      var loop = function (t) { self.raf = requestAnimationFrame(loop); if (document.visibilityState === 'visible') self.draw(t); };
      this.raf = requestAnimationFrame(loop);
    },
    stop: function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  };

  /* ==========================================================================
     8) CSS
     ======================================================================== */
  function css() {
    if ($('#foStyles')) return;
    var s = document.createElement('style'); s.id = 'foStyles';
    s.textContent = [
      '#view-forest .fo-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;align-items:start}',
      '@media(max-width:1100px){#view-forest .fo-layout{grid-template-columns:1fr}}',
      '.fo-scene{--sky1:#07122e;--sky2:#103a5e;--sky3:#1f6d78;--gr1:#2f8a4f;--gr2:#17553a;--fog:rgba(160,255,230,.15);position:relative;border-radius:22px;overflow:hidden;min-height:560px;isolation:isolate;box-shadow:0 20px 50px rgba(2,10,30,.45),inset 0 0 0 1px rgba(255,255,255,.08);color:#fff}',
      '.fo-scene[data-season=spring]{--sky1:#16264d;--sky2:#2f5d8f;--sky3:#8ec5d6;--gr1:#58a86a;--gr2:#2f6b46;--fog:rgba(255,220,240,.2)}',
      '.fo-scene[data-season=autumn]{--sky1:#1f1233;--sky2:#5a3250;--sky3:#d9835a;--gr1:#86823a;--gr2:#4f4a22;--fog:rgba(255,190,140,.18)}',
      '.fo-scene[data-season=winter]{--sky1:#0b1c3d;--sky2:#27508a;--sky3:#a9cdf0;--gr1:#dbeaf5;--gr2:#9bbad3;--fog:rgba(225,243,255,.3)}',
      '.fo-sky{position:absolute;inset:0;background:linear-gradient(180deg,var(--sky1),var(--sky2) 55%,var(--sky3));z-index:0}',
      '.fo-stars{position:absolute;inset:0 0 45% 0;z-index:1;background-image:radial-gradient(1.5px 1.5px at 12% 20%,#fff,transparent),radial-gradient(1px 1px at 28% 40%,#fff,transparent),radial-gradient(1.5px 1.5px at 44% 14%,#fff,transparent),radial-gradient(1px 1px at 60% 34%,#fff,transparent),radial-gradient(1.5px 1.5px at 74% 18%,#fff,transparent),radial-gradient(1px 1px at 88% 42%,#fff,transparent),radial-gradient(1px 1px at 6% 52%,#fff,transparent),radial-gradient(1.3px 1.3px at 52% 56%,#fff,transparent);animation:foTw 5s ease-in-out infinite alternate}',
      '.fo-aurora{position:absolute;inset:-20% -10% 38% -10%;z-index:1;background:radial-gradient(ellipse at 28% 40%,rgba(120,255,214,.26),transparent 60%),radial-gradient(ellipse at 72% 30%,rgba(168,120,255,.24),transparent 60%);filter:blur(30px);animation:foAur 16s ease-in-out infinite alternate}',
      '.fo-moon{position:absolute;top:26px;right:9%;width:62px;height:62px;border-radius:50%;z-index:1;background:radial-gradient(circle at 35% 35%,#fffbe6,#f3e9b8 60%,#d9c98c);box-shadow:0 0 40px 12px rgba(255,248,200,.32)}',
      '.fo-hills{position:absolute;inset:auto 0 0 0;height:52%;z-index:2;pointer-events:none}',
      '.fo-hills i{position:absolute;bottom:-30%;border-radius:50%;background:linear-gradient(180deg,var(--gr1),var(--gr2))}',
      '.fo-hills i:nth-child(1){left:-15%;width:75%;height:70%;opacity:.55}.fo-hills i:nth-child(2){right:-20%;width:85%;height:82%;opacity:.8}',
      '.fo-fog{position:absolute;left:-30%;width:160%;height:38%;border-radius:50%;z-index:4;pointer-events:none;background:radial-gradient(ellipse at center,var(--fog),transparent 65%);filter:blur(18px)}',
      '.fo-fog.f1{bottom:4%;animation:foFog 38s linear infinite alternate}.fo-fog.f2{bottom:24%;opacity:.7;animation:foFog 54s linear infinite alternate-reverse}',
      '.fo-fx{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none}',
      '.fo-bw{position:relative;z-index:3;padding:64px 12px 34px;display:flex;justify-content:center}',
      '.fo-board{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:2px;width:min(100%,calc(var(--n)*108px))}',
      '.fo-cell{position:relative;aspect-ratio:1/.82;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.fo-cell::before{content:"";position:absolute;left:4%;right:4%;bottom:4%;height:46%;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,var(--gr1),var(--gr2));opacity:.75;box-shadow:0 0 0 1px rgba(255,255,255,.08) inset;transition:opacity .2s,transform .2s}',
      '.fo-cell:hover::before{opacity:1;transform:scale(1.04)}',
      '.fo-cell.fo-target::after{content:"+";position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;border:2px dashed rgba(255,255,255,.85);background:rgba(255,255,255,.12);animation:foPulse 1.6s ease-in-out infinite;z-index:60}',
      '.fo-cell.fo-focus::before{box-shadow:0 0 0 2px rgba(255,236,150,.9),0 0 18px rgba(255,236,150,.6)}',
      '.fo-tree,.fo-deco{position:absolute;left:50%;bottom:10%;transform:translateX(-50%);pointer-events:none}',
      '.fo-tree{width:112%;aspect-ratio:100/120}.fo-deco{width:74%;aspect-ratio:1}',
      '.fo-tree svg,.fo-deco svg{width:100%;height:100%;overflow:visible;display:block}',
      '.fo-tree svg{--sf:hue-rotate(0deg);filter:var(--sf) var(--gl,drop-shadow(0 0 0 transparent));transform-origin:50% 92%;animation:foSway 6s ease-in-out infinite}',
      '.fo-scene[data-season=spring] .fo-seas-full svg{--sf:saturate(1.12) brightness(1.08)}',
      '.fo-scene[data-season=autumn] .fo-seas-full svg{--sf:hue-rotate(-72deg) saturate(1.35) brightness(1.02)}',
      '.fo-scene[data-season=winter] .fo-seas-full svg{--sf:saturate(.3) brightness(1.28) hue-rotate(20deg)}',
      '.fo-scene[data-season=winter] .fo-seas-conifer svg{--sf:saturate(.55) brightness(1.3) hue-rotate(15deg)}',
      '.fo-name{position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);max-width:120%;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(5,15,35,.7);color:#fff;opacity:0;transition:opacity .2s;z-index:50;pointer-events:none}',
      '.fo-cell:hover .fo-name,.fo-cell.fo-focus .fo-name{opacity:1}',
      '.fo-tree.fo-pop{animation:foPop .9s ease}',
      '.fo-hint{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:30;max-width:92%;padding:7px 14px;border-radius:20px;background:rgba(5,15,35,.78);backdrop-filter:blur(6px);font-size:12.5px;font-weight:700;display:none;align-items:center;gap:10px;white-space:nowrap}',
      '.fo-hint.on{display:flex}.fo-hint button{color:#ffd1d1;font-size:12px;font-weight:800}',
      '.fo-float{position:absolute;left:50%;bottom:20%;transform:translateX(-50%);z-index:40;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:800;background:rgba(255,236,150,.95);color:#4a3200;box-shadow:0 0 22px rgba(255,236,150,.8);animation:foFloat 3.2s ease-out forwards;pointer-events:none;white-space:nowrap}',
      '.fo-pool{margin-top:10px;padding:10px 14px;border-radius:14px;font-size:12.5px;background:var(--card-bg);border:1px solid var(--card-border);color:var(--text-muted);display:none}',
      '.fo-pool b{color:var(--accent)}.fo-pool.on{display:block}',
      '.fo-banner{margin-bottom:14px;padding:12px 16px;border-radius:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:var(--danger);font-size:13px;line-height:1.55}',
      '.fo-banner code{background:rgba(239,68,68,.12);padding:1px 6px;border-radius:5px}',
      /* thẻ giờ học cũ */
      '.fo-lg{margin-bottom:18px;padding:18px 20px;border-radius:18px;border:1.5px solid rgba(251,191,36,.55);background:linear-gradient(135deg,rgba(251,191,36,.14),rgba(20,120,212,.08));display:flex;gap:18px;align-items:center;flex-wrap:wrap}',
      '.fo-lg.mute{border-color:var(--card-border);background:var(--card-bg)}',
      '.fo-lg-ic{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 20px rgba(245,158,11,.35)}',
      '.fo-lg-main{flex:1 1 260px;min-width:0}.fo-lg-main h3{font-size:15.5px;font-weight:800;margin-bottom:3px}',
      '.fo-lg-main p{font-size:12.5px;color:var(--text-muted);line-height:1.55}.fo-lg-main p b{color:var(--text-main)}',
      '.fo-lg-src{font-size:11.5px;color:var(--text-muted);margin-top:5px}',
      '.fo-lg-act{display:flex;flex-direction:column;gap:8px;min-width:250px;flex:0 1 300px}',
      '.fo-lg-row{display:flex;gap:8px;align-items:center}',
      '.fo-lg-row input{flex:1;min-width:0;padding:8px 10px;border-radius:10px;border:1.5px solid var(--card-border);background:var(--card-bg-solid);color:var(--text-main);font:inherit;font-size:13.5px;text-align:center}',
      '.fo-lg-row span{font-size:12.5px;font-weight:700;color:var(--text-muted)}',
      '.fo-lg-prev{font-size:12.5px;font-weight:700;color:var(--warning)}',
      '.fo-sub{font-size:11px;color:var(--text-muted);margin-top:-2px}',
      '.fo-lvbar{height:6px;border-radius:6px;background:rgba(20,120,212,.14);overflow:hidden}.fo-lvbar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue-500),var(--cyan-400))}',
      '.fo-side{padding:14px;position:sticky;top:84px;max-height:calc(100vh - 100px);overflow:auto}',
      '@media(max-width:1100px){.fo-side{position:static;max-height:none}}',
      '.fo-tabs{display:flex;gap:5px;margin-bottom:12px}.fo-tabs button{flex:1;padding:8px 2px;border-radius:10px;font-size:12px;font-weight:700;background:rgba(20,120,212,.08);color:var(--text-muted)}.fo-tabs button.on{background:var(--accent);color:#fff}',
      '.fo-h{font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:14px 0 8px}',
      '.fo-spg{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}',
      '.fo-sp{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px 10px;border-radius:14px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.04);text-align:center;transition:var(--trans)}',
      '.fo-sp:hover:not(.locked){border-color:var(--rc,var(--accent));transform:translateY(-2px)}.fo-sp.on{border-color:var(--rc,var(--accent));box-shadow:0 0 0 3px color-mix(in srgb,var(--rc,var(--accent)) 25%,transparent)}',
      '.fo-sp.locked{opacity:.5;cursor:not-allowed}',
      '.fo-sp-art{width:72px;height:80px}.fo-sp-art svg{width:100%;height:100%}',
      '.fo-sp b{font-size:12.5px}.fo-rar{font-size:10px;font-weight:800;padding:1px 8px;border-radius:10px;color:#fff;background:var(--rc)}.fo-cost{font-size:12px;font-weight:800;color:var(--warning)}',
      '.fo-lock{position:absolute;inset:auto 6px 6px 6px;font-size:10.5px;font-weight:800;color:var(--text-muted)}',
      '.fo-land{padding:12px;border-radius:14px;background:rgba(20,120,212,.07);display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px}',
      '.fo-btn{padding:8px 13px;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(20,120,212,.1);color:var(--accent);display:inline-flex;gap:6px;align-items:center;justify-content:center}.fo-btn:hover{background:rgba(20,120,212,.2)}',
      '.fo-btn.pri{background:linear-gradient(135deg,var(--blue-500),var(--cyan-500));color:#fff}.fo-btn.dng{background:rgba(239,68,68,.1);color:var(--danger)}.fo-btn.gold{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff}.fo-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.fo-q{padding:11px 12px;border-radius:12px;background:rgba(20,120,212,.05);margin-bottom:8px}.fo-q.done{background:rgba(22,199,132,.1)}',
      '.fo-q-top{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:700;margin-bottom:6px}.fo-q-top span{color:var(--warning);white-space:nowrap}',
      '.fo-q-bot{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11.5px;color:var(--text-muted)}.fo-q-bot .fo-lvbar{flex:1}',
      '.fo-log{display:flex;gap:8px;font-size:12px;padding:7px 0;border-bottom:1px dashed var(--card-border)}.fo-log time{color:var(--text-muted);flex-shrink:0;width:42px}',
      '.fo-tbl{width:100%;font-size:12.5px;border-collapse:collapse}.fo-tbl td{padding:5px 4px;border-bottom:1px dashed var(--card-border)}.fo-tbl td:last-child{text-align:right;font-weight:800;color:var(--accent);white-space:nowrap}',
      '.fo-mov{position:fixed;inset:0;z-index:9600;background:rgba(3,19,36,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.fo-mod{width:min(420px,100%);max-height:88vh;overflow:auto;background:var(--card-bg-solid);color:var(--text-main);border:1px solid var(--card-border);border-radius:20px;padding:22px;box-shadow:var(--shadow-lg);text-align:center}',
      '.fo-mod h3{font-size:16px;margin-bottom:4px}.fo-mod .fo-art{width:130px;height:150px;margin:6px auto}.fo-mod .fo-art svg{width:100%;height:100%;overflow:visible}',
      '.fo-mod input{width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--card-border);background:rgba(20,120,212,.05);color:inherit;font:inherit;margin:8px 0;text-align:center}',
      '.fo-mod .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}',
      '.fo-mod .fo-lvbar{margin:8px 0 4px}.fo-mod small{color:var(--text-muted);font-size:12px;display:block}',
      '@keyframes foSway{0%,100%{transform:rotate(-1.2deg)}50%{transform:rotate(1.2deg)}}',
      '@keyframes foPulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.85}50%{transform:translate(-50%,-50%) scale(1.12);opacity:1}}',
      '@keyframes foPop{0%{transform:translateX(-50%) scale(.85)}40%{transform:translateX(-50%) scale(1.14)}100%{transform:translateX(-50%) scale(1)}}',
      '@keyframes foAur{from{transform:translateX(-4%) scale(1)}to{transform:translateX(5%) scale(1.08)}}',
      '@keyframes foFog{from{transform:translateX(-8%)}to{transform:translateX(8%)}}',
      '@keyframes foTw{from{opacity:.45}to{opacity:1}}',
      '@keyframes foFloat{0%{opacity:0;transform:translate(-50%,10px)}15%{opacity:1}100%{opacity:0;transform:translate(-50%,-150px)}}',
      '.fo-aura{animation:foAuraP 3.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}',
      '@keyframes foAuraP{0%,100%{transform:scale(.94);opacity:.75}50%{transform:scale(1.06);opacity:1}}',
      '.fo-mote{animation:foMote 4.2s ease-in-out infinite;transform-box:fill-box}',
      '@keyframes foMote{0%,100%{transform:translateY(0);opacity:.2}50%{transform:translateY(-7px);opacity:1}}',
      '.fo-seed{animation:foSeed 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}',
      '@keyframes foSeed{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
      '.fo-strand{animation:foStr 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 0}',
      '@keyframes foStr{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}',
      '.fo-petal{animation:foPet 5s linear infinite;transform-box:fill-box}',
      '@keyframes foPet{0%{transform:translate(0,-6px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translate(8px,20px) rotate(200deg);opacity:0}}',
      '.fo-spark{animation:foSpk 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}',
      '@keyframes foSpk{0%,100%{transform:scale(.2);opacity:0}50%{transform:scale(1);opacity:1}}',
      '.fo-ring{animation:foRing 6s linear infinite;transform-box:fill-box;transform-origin:center}',
      '@keyframes foRing{to{transform:rotate(360deg)}}',
      '@media(prefers-reduced-motion:reduce){.fo-scene *,.fo-scene *::before{animation:none!important}}',
      '@media(max-width:520px){.fo-bw{padding:56px 4px 28px}.fo-scene{min-height:440px}.fo-name{font-size:9px}.fo-lg-act{min-width:100%;flex-basis:100%}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ==========================================================================
     9) DOM: nav + view
     ======================================================================== */
  function viewHTML() {
    return '<div class="section-head"><div><h2><i class="fa-solid fa-tree"></i> Study Forest</h2><p>Mỗi phút học thật nuôi lớn một khu rừng phép thuật của riêng bạn</p></div>' +
      '<div class="toolbar" id="foSeasons" style="margin:0">' + [['auto', 'Tự động'], ['spring', '🌸 Xuân'], ['summer', '☀️ Hạ'], ['autumn', '🍂 Thu'], ['winter', '❄️ Đông']].map(function (x) { return '<button class="filter-chip" data-s="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div id="foBanner"></div><div id="foLegacy"></div><div class="stat-grid" id="foStats"></div>' +
      '<div class="fo-layout"><div><div class="fo-scene" id="foScene" data-season="summer"><div class="fo-sky"></div><div class="fo-stars"></div><div class="fo-aurora"></div><div class="fo-moon"></div>' +
      '<div class="fo-hills"><i></i><i></i></div><div class="fo-fog f1"></div><div class="fo-fog f2"></div><canvas class="fo-fx" id="foFx"></canvas>' +
      '<div class="fo-hint" id="foHint"></div><div class="fo-bw"><div class="fo-board" id="foBoard"></div></div></div><div class="fo-pool" id="foPool"></div></div>' +
      '<aside class="card fo-side"><div class="fo-tabs" id="foTabs"><button data-t="plant">Trồng cây</button><button data-t="deco">Trang trí</button><button data-t="quest">Nhiệm vụ</button><button data-t="log">Nhật ký</button></div><div id="foSide"></div></aside></div>';
  }
  var dom = false;
  function injectDom() {
    if (dom) return; var nav = $('.sidebar-nav'), main = $('main.content'); if (!nav || !main) return;
    css();
    if (!$('.nav-item[data-view="forest"]')) {
      var b = document.createElement('button'); b.className = 'nav-item'; b.dataset.view = 'forest';
      b.innerHTML = '<i class="fa-solid fa-tree"></i> Study Forest';
      var anchor = $('.nav-item[data-view="schedule"]') || $('.nav-item[data-view="reviewStar"]') || $('.nav-item[data-view="quiz"]');
      if (anchor) anchor.insertAdjacentElement('afterend', b); else nav.appendChild(b);
      if (window.__appInitialized) b.addEventListener('click', function () { var u = UIM(); if (u) u.navigate('forest'); });
    }
    if (!$('#view-forest')) {
      var sec = document.createElement('section'); sec.className = 'view'; sec.id = 'view-forest'; sec.innerHTML = viewHTML(); main.appendChild(sec);
    }
    wireView(); dom = true;
  }
  function wireView() {
    var v = $('#view-forest'); if (!v || v.__fo) return; v.__fo = true;
    $('#foSeasons').addEventListener('click', function (e) { var b = e.target.closest('[data-s]'); if (!b) return; S.season = b.dataset.s; lsSet(LSK + 'season', S.season); applySeason(); });
    $('#foTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; S.tab = b.dataset.t; if (S.tab !== 'plant' && S.tab !== 'deco') S.sel = null; renderSide(); renderBoard(); renderHint(); });
    $('#foBoard').addEventListener('click', function (e) { var c = e.target.closest('.fo-cell'); if (c) onCell(+c.dataset.pos); });
    $('#foSide').addEventListener('click', onSideClick);
    $('#foHint').addEventListener('click', function (e) { if (e.target.closest('button')) { S.sel = null; renderBoard(); renderSide(); renderHint(); } });
    var lg = $('#foLegacy');
    lg.addEventListener('click', onLegacyClick);
    lg.addEventListener('input', function (e) { if (e.target.id === 'foLgIn') updateLegacyPreview(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.sel && S.active) { S.sel = null; renderBoard(); renderSide(); renderHint(); } });
    Fx.init($('#foFx'));
  }

  /* ==========================================================================
     10) RENDER
     ======================================================================== */
  function curSeason() {
    if (S.season !== 'auto') return S.season;
    var m = new Date().getMonth() + 1; return m >= 3 && m <= 5 ? 'spring' : m <= 8 && m >= 6 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  }
  function applySeason() {
    var sc = $('#foScene'); if (!sc) return; var s = curSeason(); sc.dataset.season = s;
    $$('#foSeasons .filter-chip').forEach(function (b) { b.classList.toggle('active', b.dataset.s === S.season); });
    Fx.setSeason(s);
  }
  function renderAll() { if (!S.d) { renderBanner(); return; } renderBanner(); renderLegacy(); renderStats(); renderBoard(); renderSide(); renderHint(); renderPool(); }
  function renderBanner() {
    var el = $('#foBanner'); if (!el) return;
    el.innerHTML = S.err === 'perm' ? '<div class="fo-banner"><b><i class="fa-solid fa-triangle-exclamation"></i> Firestore từ chối quyền truy cập.</b> Rules cho <code>users/{uid}/forest/main</code> đã có trong file rules hiện tại — hãy chắc chắn bản rules đó đã được publish tại Firebase Console → Firestore → Rules và tài khoản đã được duyệt, rồi tải lại trang. Nếu vẫn lỗi, kiểm tra đồng hồ máy tính (lệch quá 2 phút sẽ bị chặn khi ghi thời gian học).</div>'
      : S.err === 'net' ? '<div class="fo-banner">Không đồng bộ được với máy chủ. Dữ liệu học vẫn được giữ lại trên máy và sẽ gửi lên khi có mạng.</div>' : '';
  }

  /* ---- thẻ GIỜ HỌC CŨ ---- */
  function srcLine(srcs) {
    var names = { ls: 'nhật ký trình duyệt', hist: 'lịch sử làm bài', lb: 'bảng xếp hạng', usr: 'hồ sơ tài khoản' }, out = [];
    Object.keys(names).forEach(function (k) { if (srcs && srcs[k] > 0) out.push(names[k] + ': ' + fmtHr(srcs[k])); });
    return out.length ? 'Đã quét — ' + out.join(' · ') + '. Hệ thống lấy nguồn LỚN NHẤT (không cộng dồn).' : '';
  }
  function renderLegacy() {
    var el = $('#foLegacy'); if (!el || !S.d) return;
    var ae = document.activeElement; if (ae && ae.id === 'foLgIn' && el.contains(ae)) return;
    var L = S.d.legacy, avail = Core.legacyAvail(S.d), per = Core.LEGACY.SEC_PER_SPARK, srcs = S.lgSrcs || L.srcs;
    var scanBtn = '<button class="fo-btn" data-lg="scan"' + (S.lgBusy ? ' disabled' : '') + '><i class="fa-solid fa-rotate"></i> ' + (S.lgBusy ? 'Đang quét...' : 'Quét lại') + '</button>';
    if (!S.lgDone && S.lgBusy) {
      el.innerHTML = '<div class="fo-lg mute"><div class="fo-lg-ic" style="background:var(--accent)"><i class="fa-solid fa-spinner fa-spin"></i></div><div class="fo-lg-main"><h3>Đang tìm giờ học cũ của bạn...</h3><p>Hệ thống đang đọc nhật ký học tập, lịch sử làm bài và bảng xếp hạng.</p></div></div>'; return;
    }
    if (S.lgErr && !L.baseSec) {
      el.innerHTML = '<div class="fo-lg mute"><div class="fo-lg-main"><h3>Chưa quét được giờ học cũ</h3><p>' + esc(S.lgErr) + '</p></div><div class="fo-lg-act">' + scanBtn + '</div></div>'; return;
    }
    if (L.baseSec <= 0) {
      if (!S.lgDone) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="fo-lg mute"><div class="fo-lg-ic" style="background:var(--text-muted)"><i class="fa-solid fa-clock-rotate-left"></i></div><div class="fo-lg-main"><h3>Chưa tìm thấy giờ học cũ</h3><p>Không có thời gian học nào trước khi Study Forest được tạo trên tài khoản này. Nếu bạn từng học trên trình duyệt/thiết bị khác, hãy mở Study Forest ở đó rồi bấm "Quét lại".</p></div><div class="fo-lg-act">' + scanBtn + '</div></div>'; return;
    }
    if (avail < per) {
      el.innerHTML = '<div class="fo-lg mute"><div class="fo-lg-ic" style="background:linear-gradient(135deg,#16c784,#0e9d68)"><i class="fa-solid fa-circle-check"></i></div><div class="fo-lg-main"><h3>Đã quy đổi hết giờ học cũ</h3><p>Tổng giờ học cũ <b>' + fmtDur(L.baseSec) + '</b> · đã đổi <b>' + fmtDur(L.convertedSec) + '</b> → <b>' + L.sparks + ' Linh quang</b>.</p><div class="fo-lg-src">' + esc(srcLine(srcs)) + '</div></div><div class="fo-lg-act">' + scanBtn + '</div></div>'; return;
    }
    var maxH = Math.floor(avail / 360) / 10, units = Math.floor(avail / per);
    el.innerHTML = '<div class="fo-lg"><div class="fo-lg-ic"><i class="fa-solid fa-hourglass-half"></i></div>' +
      '<div class="fo-lg-main"><h3>Bạn có ' + fmtDur(avail) + ' học cũ chưa quy đổi</h3>' +
      '<p>Cứ <b>' + (per / 60) + ' phút</b> học cũ = <b>1 Linh quang</b> (1 giờ = 10). Số phút đó cũng được cộng vào <b>điểm nuôi cây</b> để lên cấp rừng, mở khoá cây hiếm và nuôi cây lớn. Đổi toàn bộ sẽ nhận <b>+' + units + ' Linh quang</b>.</p>' +
      '<div class="fo-lg-src">' + esc(srcLine(srcs)) + '</div></div>' +
      '<div class="fo-lg-act"><div class="fo-lg-row"><input id="foLgIn" type="number" min="0.1" max="' + maxH + '" step="0.1" value="' + maxH + '" data-avail="' + avail + '"><span>giờ</span></div>' +
      '<div class="fo-lg-prev" id="foLgPrev"></div>' +
      '<div class="fo-lg-row"><button class="fo-btn gold" data-lg="conv" style="flex:1"><i class="fa-solid fa-wand-magic-sparkles"></i> Đổi số giờ này</button><button class="fo-btn pri" data-lg="all" style="flex:1">Đổi tất cả</button></div>' + scanBtn + '</div></div>';
    updateLegacyPreview();
  }
  function lgInputSec() {
    var inp = $('#foLgIn'); if (!inp) return 0;
    var avail = +inp.dataset.avail || 0, sec = Math.round((parseFloat(String(inp.value).replace(',', '.')) || 0) * 3600);
    return Math.max(0, Math.min(sec, avail));
  }
  function updateLegacyPreview() {
    var pv = $('#foLgPrev'); if (!pv) return; var sec = lgInputSec(), u = Math.floor(sec / Core.LEGACY.SEC_PER_SPARK);
    pv.textContent = u ? '→ +' + u + ' Linh quang · +' + fmtMin(u * Core.LEGACY.SEC_PER_SPARK / 60) + ' phút nuôi cây' : 'Nhập ít nhất ' + (Core.LEGACY.SEC_PER_SPARK / 60) + ' phút (0,1 giờ)';
  }
  function onLegacyClick(e) {
    var b = e.target.closest('[data-lg]'); if (!b || b.disabled) return; var a = b.dataset.lg;
    if (a === 'scan') { scanLegacy(true); return; }
    var sec = a === 'all' ? Core.legacyAvail(S.d) : lgInputSec();
    if (sec < Core.LEGACY.SEC_PER_SPARK) { toast('warn', 'Study Forest', 'Cần tối thiểu ' + (Core.LEGACY.SEC_PER_SPARK / 60) + ' phút học cũ để đổi 1 Linh quang'); return; }
    b.disabled = true; convertLegacy(sec);
  }

  function renderStats() {
    var el = $('#foStats'); if (!el || !S.d) return; var d = S.d, e = Core.earned(d), lv = Core.level(e), a = Core.levelMin(lv), b = Core.levelMin(lv + 1);
    var pct = lv >= 50 ? 100 : Math.max(0, Math.min(100, (e - a) / (b - a) * 100)), live = Math.floor(T.buf);
    var plots = Core.sideOf(d.landLevel) * Core.sideOf(d.landLevel), grown = d.trees.filter(function (t) { return Core.stageOf(t) >= 5; }).length;
    var qs = Core.QUESTS.filter(function (q) { return q.scope === 'daily'; }), qDone = qs.filter(function (q) { return d.day.claimed[q.id] || q.get(d) >= q.need; }).length;
    var cards = [
      ['fa-clock', 'linear-gradient(135deg,#1478d4,#22d3ee)', fmtDur(d.trackedSec + live), 'Giờ học đo bởi Forest', 'Hôm nay: ' + fmtDur(d.day.sec + live)],
      ['fa-seedling', 'linear-gradient(135deg,#16c784,#0e9d68)', fmtMin(e + live / 60) + ' phút', 'Điểm nuôi cây', 'Gồm ' + fmtMin(d.bonusMin) + ' phút thưởng/quy đổi'],
      ['fa-tree', 'linear-gradient(135deg,#0d5fb3,#3b96e8)', d.trees.length + '/' + plots, 'Số cây', grown + ' cổ thụ phát sáng'],
      ['fa-ranking-star', 'linear-gradient(135deg,#8b5cf6,#6d28d9)', 'Lv.' + lv, 'Cấp độ rừng', '<div class="fo-lvbar"><i style="width:' + pct + '%"></i></div>'],
      ['fa-fire', 'linear-gradient(135deg,#f97316,#ea580c)', d.streak.cur + ' ngày', 'Chuỗi ngày học', 'Kỷ lục ' + d.streak.best + ' ngày'],
      ['fa-wand-sparkles', 'linear-gradient(135deg,#f59e0b,#fbbf24)', Core.balance(d), 'Linh quang', 'Dùng để trồng & trang trí'],
      ['fa-list-check', 'linear-gradient(135deg,#ef4444,#dc2626)', qDone + '/' + qs.length, 'Nhiệm vụ hôm nay', 'Tuần: ' + Core.QUESTS.filter(function (q) { return q.scope === 'weekly' && (d.week.claimed[q.id] || q.get(d) >= q.need); }).length + '/4']
    ];
    el.innerHTML = cards.map(function (c) { return '<div class="card stat-card"><div class="stat-top"><div class="stat-icon" style="background:' + c[1] + '"><i class="fa-solid ' + c[0] + '"></i></div></div><div class="stat-val">' + c[2] + '</div><div class="stat-label">' + c[3] + '</div><div class="fo-sub">' + c[4] + '</div></div>'; }).join('');
  }
  function renderPool() {
    var el = $('#foPool'); if (!el || !S.d) return; var d = S.d, pool = Core.earned(d) - d.fed;
    var growing = d.trees.some(function (t) { return t.g < Core.capOf(t) - 1e-6; });
    if (pool > 0.5 && !growing) { el.className = 'fo-pool on'; el.innerHTML = '🌱 Bạn có <b>' + fmtMin(pool) + ' phút</b> sinh lực đang chờ — hãy trồng một cây mới để hấp thụ ngay.'; }
    else if (!d.trees.length) { el.className = 'fo-pool on'; el.innerHTML = '🌱 Khu rừng còn trống. Mở tab <b>Trồng cây</b> và chọn một hạt giống để bắt đầu.'; }
    else el.className = 'fo-pool';
  }
  function renderHint() {
    var el = $('#foHint'); if (!el) return;
    if (S.sel) { var nm = S.sel.t === 'tree' ? Core.SP[S.sel.id].name : Core.DC[S.sel.id].name; el.className = 'fo-hint on'; el.innerHTML = 'Chọn ô đất để đặt <b>' + esc(nm) + '</b><button>Huỷ (Esc)</button>'; }
    else el.className = 'fo-hint';
  }
  function renderBoard() {
    var board = $('#foBoard'); if (!board || !S.d) return; var d = S.d, n = Core.sideOf(d.landLevel), tot = n * n;
    board.style.setProperty('--n', n);
    if (board.children.length !== tot) {
      board.innerHTML = ''; for (var i = 0; i < tot; i++) { var c = document.createElement('div'); c.className = 'fo-cell'; c.dataset.pos = i; c.style.zIndex = Math.floor(i / n) + 1; board.appendChild(c); }
    }
    var tmap = {}, dmap = {}; d.trees.forEach(function (t) { tmap[t.pos] = t; }); d.decos.forEach(function (x) { dmap[x.pos] = x; });
    for (var p = 0; p < tot; p++) {
      var cell = board.children[p], t = tmap[p], x = dmap[p], sig = '', stage = 0;
      if (t) { stage = Core.stageOf(t); sig = 't|' + t.id + '|' + t.sp + '|' + stage + '|' + t.name + '|' + (d.focus === t.id ? 1 : 0); }
      else if (x) sig = 'd|' + x.id + '|' + x.k;
      var target = !!S.sel && !t && !x;
      cell.classList.toggle('fo-target', target);
      cell.classList.toggle('fo-focus', !!t && d.focus === t.id);
      if (cell.__sig === sig) continue;
      var prev = t ? S.prevStage[t.id] : undefined; cell.__sig = sig;
      if (t) {
        var sp = Core.SP[t.sp] || Core.SPECIES[0], gl = stage >= 4 ? 'drop-shadow(0 0 ' + (stage >= 5 ? 6 : 3) + 'px ' + sp.glow + ') drop-shadow(0 0 ' + (stage >= 5 ? 14 : 7) + 'px ' + sp.glow + ')' : 'drop-shadow(0 0 0 transparent)';
        cell.innerHTML = '<div class="fo-tree fo-seas-' + sp.seas + ((prev !== undefined && prev !== stage) ? ' fo-pop' : '') + '" style="--gl:' + gl + '">' + treeSVG(t.sp, stage) + '</div><span class="fo-name">' + esc(t.name) + '</span>';
        S.prevStage[t.id] = stage;
      } else if (x) cell.innerHTML = '<div class="fo-deco">' + decoSVG(x.k) + '</div>';
      else cell.innerHTML = '';
    }
  }
  function renderSide() {
    var el = $('#foSide'), d = S.d; if (!el || !d) return;
    $$('#foTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === S.tab); });
    var lv = Core.level(Core.earned(d)), bal = Core.balance(d), h = '';
    if (S.tab === 'plant') {
      var nx = Core.LAND[d.landLevel], n = Core.sideOf(d.landLevel);
      h += '<div class="fo-land"><div><b>Mảnh đất ' + n + '×' + n + '</b><div class="fo-sub">' + (nx ? 'Mở rộng lên ' + (n + 1) + '×' + (n + 1) + ' · cần Lv.' + nx.lv : 'Đã mở rộng tối đa') + ' · Linh quang: ✨ ' + bal + '</div></div>' +
        (nx ? '<button class="fo-btn pri" data-expand ' + ((lv < nx.lv || bal < nx.cost) ? 'disabled' : '') + '>✨ ' + nx.cost + '</button>' : '') + '</div>';
      ['common', 'rare', 'epic', 'legendary'].forEach(function (r) {
        var R = Core.RARITY[r]; h += '<div class="fo-h" style="color:' + R.color + '">' + R.label + ' · ✨ ' + R.cost + ' · Lv.' + R.minLevel + '+</div><div class="fo-spg">';
        Core.SPECIES.filter(function (s) { return s.r === r; }).forEach(function (s) {
          var locked = lv < R.minLevel;
          h += '<button class="fo-sp ' + (locked ? 'locked' : '') + (S.sel && S.sel.id === s.id ? ' on' : '') + '" data-sp="' + s.id + '" style="--rc:' + R.color + '" title="' + esc(s.desc) + '"><div class="fo-sp-art">' + sprev(s.id) + '</div><b>' + esc(s.name) + '</b><span class="fo-rar">' + R.label + '</span><span class="fo-cost">✨ ' + R.cost + '</span>' + (locked ? '<span class="fo-lock"><i class="fa-solid fa-lock"></i> Cấp ' + R.minLevel + '</span>' : '') + '</button>';
        }); h += '</div>';
      });
    } else if (S.tab === 'deco') {
      h += '<div class="fo-h" style="margin-top:0">Vật trang trí · Linh quang: ✨ ' + bal + '</div><div class="fo-spg">';
      Core.DECOS.forEach(function (x) {
        var locked = lv < x.lv;
        h += '<button class="fo-sp ' + (locked ? 'locked' : '') + (S.sel && S.sel.id === x.id ? ' on' : '') + '" data-deco="' + x.id + '" style="--rc:' + x.color + '"><div class="fo-sp-art">' + dprev(x.id) + '</div><b>' + esc(x.name) + '</b><span class="fo-cost">✨ ' + x.cost + '</span>' + (locked ? '<span class="fo-lock"><i class="fa-solid fa-lock"></i> Cấp ' + x.lv + '</span>' : '') + '</button>';
      }); h += '</div>';
    } else if (S.tab === 'quest') {
      var qrow = function (q) {
        var b = q.scope === 'daily' ? d.day : d.week, v = Math.min(q.need, Math.floor(q.get(d))), done = v >= q.need, got = !!b.claimed[q.id];
        return '<div class="fo-q ' + (done ? 'done' : '') + '"><div class="fo-q-top">' + esc(q.t) + '<span>+' + q.reward + ' ✨</span></div><div class="fo-lvbar"><i style="width:' + (v / q.need * 100) + '%"></i></div><div class="fo-q-bot">' + v + '/' + q.need + ' ' + q.unit + '<span style="flex:1"></span>' +
          (got ? '<b style="color:var(--success)">Đã nhận ✓</b>' : '<button class="fo-btn pri" data-claim="' + q.id + '" ' + (done ? '' : 'disabled') + '>Nhận</button>') + '</div></div>';
      };
      h += '<div class="fo-h" style="margin-top:0">Hằng ngày</div>' + Core.QUESTS.filter(function (q) { return q.scope === 'daily'; }).map(qrow).join('');
      h += '<div class="fo-h">Hằng tuần</div>' + Core.QUESTS.filter(function (q) { return q.scope === 'weekly'; }).map(qrow).join('');
      h += '<div class="fo-h">Mốc chuỗi ngày học</div><div class="fo-q"><div class="fo-q-top">7 ngày liên tiếp<span>+30 phút</span></div><div class="fo-lvbar"><i style="width:' + Math.min(100, d.streak.cur / 7 * 100) + '%"></i></div></div><div class="fo-q"><div class="fo-q-top">30 ngày liên tiếp<span>+120 phút</span></div><div class="fo-lvbar"><i style="width:' + Math.min(100, d.streak.cur / 30 * 100) + '%"></i></div><div class="fo-q-bot">Hiện tại: ' + d.streak.cur + ' ngày (1 ngày tính khi học ≥ 5 phút hoặc xong 1 đề)</div></div>';
    } else {
      h += '<div class="fo-h" style="margin-top:0">Bảng quy đổi</div><table class="fo-tbl"><tr><td>10 phút học thật</td><td>10 phút</td></tr><tr><td>Hoàn thành 1 đề / phần</td><td>+10 phút</td></tr><tr><td>20 flashcard</td><td>+5 phút</td></tr><tr><td>1 phiên Pomodoro</td><td>+25 phút</td></tr><tr><td>Hoàn thành mục tiêu ngày</td><td>+10 phút</td></tr><tr><td>Chuỗi 7 ngày</td><td>+30 phút</td></tr><tr><td>Chuỗi 30 ngày</td><td>+120 phút</td></tr><tr><td>Giờ học cũ: 6 phút</td><td>1 ✨ + 6 phút</td></tr></table>';
      h += '<div class="fo-h">6 giai đoạn (cây Common)</div><table class="fo-tbl">' + Core.STAGES.map(function (s, i) { return '<tr><td>' + (i + 1) + '. ' + s + '</td><td>' + Core.THRESH[i] + ' phút</td></tr>'; }).join('') + '</table><div class="fo-sub" style="margin-top:6px">Rare ×1.5 · Epic ×2.2 · Legendary ×3.2</div>';
      h += '<div class="fo-h">Hoạt động gần đây</div>' + (d.log.length ? d.log.map(function (l) { var t = new Date(l.t); return '<div class="fo-log"><time>' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + '</time><span>' + esc(l.n) + (l.m ? ' <b style="color:var(--accent)">+' + fmtMin(l.m) + 'p</b>' : '') + '</span></div>'; }).join('') : '<div class="fo-sub">Chưa có hoạt động nào.</div>');
    }
    el.innerHTML = h;
  }
  function floatText(txt) {
    var sc = $('#foScene'); if (!sc || !S.active) return; var f = document.createElement('div'); f.className = 'fo-float'; f.textContent = txt; sc.appendChild(f); setTimeout(function () { f.remove(); }, 3300);
  }

  /* ==========================================================================
     11) TƯƠNG TÁC
     ======================================================================== */
  function run(fn, okMsg) {
    return mutate(fn).then(function (ctx) { if (okMsg) toast('success', 'Study Forest', okMsg); return ctx; }).catch(function (e) { toast('error', 'Study Forest', e.message || 'Không thực hiện được'); handleErr(e, 'action'); });
  }
  function onSideClick(e) {
    var b;
    if ((b = e.target.closest('[data-sp]'))) {
      if (b.classList.contains('locked')) { toast('warn', 'Chưa mở khoá', 'Hãy tăng cấp rừng bằng cách học thêm hoặc quy đổi giờ học cũ.'); return; }
      S.sel = (S.sel && S.sel.id === b.dataset.sp) ? null : { t: 'tree', id: b.dataset.sp };
    } else if ((b = e.target.closest('[data-deco]'))) {
      if (b.classList.contains('locked')) { toast('warn', 'Chưa mở khoá', 'Hãy tăng cấp rừng bằng cách học thêm hoặc quy đổi giờ học cũ.'); return; }
      S.sel = (S.sel && S.sel.id === b.dataset.deco) ? null : { t: 'deco', id: b.dataset.deco };
    } else if ((b = e.target.closest('[data-expand]'))) { run(function (d, ctx) { Core.expand(d, ctx); }, 'Đã mở rộng mảnh đất!'); return; }
    else if ((b = e.target.closest('[data-claim]'))) { var id = b.dataset.claim; run(function (d, ctx) { return Core.claimQuest(d, id, ctx); }).then(function (c) { if (c && c.out) toast('success', 'Nhận thưởng', '+' + c.out + ' Linh quang'); }); return; }
    else return;
    renderSide(); renderBoard(); renderHint();
  }
  function onCell(pos) {
    var d = S.d; if (!d) return;
    var t = d.trees.filter(function (x) { return x.pos === pos; })[0], x = d.decos.filter(function (y) { return y.pos === pos; })[0];
    if (S.sel) {
      if (t || x) { toast('warn', 'Ô đất đã có vật thể', 'Hãy chọn một ô trống.'); return; }
      if (S.sel.t === 'tree') openNameModal(S.sel.id, pos);
      else { var k = S.sel.id; run(function (dd, ctx) { Core.placeDeco(dd, { k: k, pos: pos }, ctx); }, 'Đã đặt ' + Core.DC[k].name); S.sel = null; renderHint(); renderSide(); }
      return;
    }
    if (t) openTreeModal(t.id); else if (x) openDecoModal(x.id);
    else { S.tab = 'plant'; renderSide(); toast('success', 'Ô đất trống', 'Chọn một hạt giống ở bảng bên để trồng.'); }
  }
  function modal(html, mount) {
    var ov = document.createElement('div'); ov.className = 'fo-mov'; ov.innerHTML = '<div class="fo-mod">' + html + '</div>'; document.body.appendChild(ov);
    var close = function () { ov.remove(); document.removeEventListener('keydown', k, true); }, k = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', k, true); ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    if (mount) mount(ov, close); return close;
  }
  function openNameModal(spId, pos) {
    var sp = Core.SP[spId], R = Core.RARITY[sp.r];
    modal('<h3>Trồng ' + esc(sp.name) + '</h3><small style="color:' + R.color + ';font-weight:800">' + R.label + ' · ✨ ' + R.cost + '</small><div class="fo-art">' + treeSVG(spId, 2) + '</div><small>Đặt tên cho cây của bạn</small><input id="foNm" maxlength="24" value="' + esc(sp.name) + '"><div class="row"><button class="fo-btn" id="foNo">Huỷ</button><button class="fo-btn pri" id="foYes">🌱 Trồng cây</button></div>', function (ov, close) {
      var inp = $('#foNm', ov); inp.focus(); inp.select();
      var go = function () { var nm = inp.value; close(); run(function (d, ctx) { Core.plant(d, { sp: spId, pos: pos, name: nm }, ctx); }, 'Đã trồng cây mới!'); S.sel = null; renderHint(); renderSide(); };
      $('#foYes', ov).onclick = go; $('#foNo', ov).onclick = close; inp.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    });
  }
  function openTreeModal(id) {
    var t = S.d.trees.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var sp = Core.SP[t.sp] || Core.SPECIES[0], R = Core.RARITY[sp.r], pr = Core.stageProgress(t), cap = Core.capOf(t), isFocus = S.d.focus === id, full = t.g >= cap - 1e-6;
    modal('<h3>' + esc(t.name) + '</h3><small style="color:' + R.color + ';font-weight:800">' + esc(sp.name) + ' · ' + R.label + '</small><div class="fo-art">' + treeSVG(t.sp, pr.stage) + '</div>' +
      '<b>Giai đoạn ' + (pr.stage + 1) + '/6 — ' + Core.STAGES[pr.stage] + '</b><div class="fo-lvbar"><i style="width:' + pr.pct + '%"></i></div>' +
      '<small>' + (full ? 'Đã phát triển tối đa ✨' : 'Còn ' + Math.ceil(pr.left) + ' phút nữa để lên giai đoạn tiếp theo') + ' · Đã nuôi ' + fmtMin(t.g) + '/' + fmtMin(cap) + ' phút</small>' +
      '<small>Trồng ngày ' + new Date(t.at).toLocaleDateString('vi-VN') + '</small><input id="foRn" maxlength="24" value="' + esc(t.name) + '">' +
      '<div class="row"><button class="fo-btn pri" id="foSv">Lưu tên</button>' + (!full ? '<button class="fo-btn" id="foFc" ' + (isFocus ? 'disabled' : '') + '>' + (isFocus ? '⭐ Đang được nuôi' : '⭐ Ưu tiên nuôi cây này') + '</button>' : '') + '<button class="fo-btn dng" id="foRm">Nhổ cây</button></div>', function (ov, close) {
        $('#foSv', ov).onclick = function () { var nm = $('#foRn', ov).value; close(); run(function (d) { Core.renameTree(d, id, nm); }, 'Đã đổi tên cây'); };
        var fc = $('#foFc', ov); if (fc) fc.onclick = function () { close(); run(function (d) { Core.setFocus(d, id); }, 'Cây này sẽ được nuôi trước'); };
        var rm = $('#foRm', ov), armed = false;
        rm.onclick = function () { if (!armed) { armed = true; rm.textContent = 'Bấm lần nữa để xác nhận'; return; } close(); run(function (d) { Core.removeTree(d, id); }, 'Đã nhổ cây'); };
      });
  }
  function openDecoModal(id) {
    var x = S.d.decos.filter(function (y) { return y.id === id; })[0]; if (!x) return; var def = Core.DC[x.k];
    modal('<h3>' + esc(def.name) + '</h3><div class="fo-art">' + decoSVG(x.k) + '</div><div class="row"><button class="fo-btn" id="foCl">Đóng</button><button class="fo-btn dng" id="foRd">Gỡ bỏ</button></div>', function (ov, close) {
      $('#foCl', ov).onclick = close; var rd = $('#foRd', ov), armed = false;
      rd.onclick = function () { if (!armed) { armed = true; rd.textContent = 'Bấm lần nữa để xác nhận'; return; } close(); run(function (d) { Core.removeDeco(d, id); }, 'Đã gỡ vật trang trí'); };
    });
  }

  /* ==========================================================================
     12) VÒNG ĐỜI: vào/ra view, khởi động sau đăng nhập, đăng xuất
     ======================================================================== */
  function onEnter() {
    S.active = true; injectDom(); applySeason(); renderAll(); Fx.start();
    if (!S.ready && !S.err) { var b = $('#foStats'); if (b && !S.d) b.innerHTML = '<div class="card" style="padding:20px;grid-column:1/-1;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải khu rừng của bạn...</div>'; }
    else scanLegacy(false);
  }
  function onLeave() { if (!S.active) return; S.active = false; Fx.stop(); }

  async function start(user) {
    S.booting = true; S.uid = user.uid;
    var saved = lsGet(LSK + 'buf_' + S.uid, null); T.buf = saved && saved.sec > 0 ? Math.min(saved.sec, 3600) : 0;
    try {
      await mutate(function (d, ctx, fresh) { if (!fresh) ctx.skip = true; });
      S.ready = true; S.err = null;
      var q = S.pending; S.pending = []; q.forEach(function (fn) { try { fn(); } catch (e) { } });
      if (S.active) renderAll();
      scanLegacy(true); // quét giờ học cũ ngay khi khu rừng sẵn sàng (chỉ đọc, an toàn khi chạy lại)
    } catch (e) { handleErr(e, 'start'); S.uid = null; }
    S.booting = false;
  }
  function stop() {
    flushTracked(); S.uid = null; S.d = null; S.ready = false; S.err = null; S.sel = null; T.buf = 0; T.cards = 0;
    S.goalTried = {}; S.prevStage = {}; S.lgBusy = false; S.lgAt = 0; S.lgDone = false; S.lgSrcs = null; S.lgErr = null;
  }
  function boot() {
    injectDom(); hookApp();
    var a = AU(), ok = !!(window.__appInitialized && a && a.currentUser && DB());
    if (ok && !S.booting && !S.ready && !S.err) start(a.currentUser);
    else if (ok && S.err && !S.booting && a.currentUser.uid !== S.uid) { S.err = null; }
    if (!ok && S.uid) stop();
  }
  injectDom(); hookApp();
  document.addEventListener('DOMContentLoaded', function () { injectDom(); hookApp(); });
  setInterval(boot, 1500);
  setInterval(sample, 5000);

  window.Forest = {
    open: function () { var u = UIM(); if (u) u.navigate('forest'); },
    reportFlashcards: reportFlashcards,
    getState: function () { return S.d ? JSON.parse(JSON.stringify(S.d)) : null; },
    scanLegacy: function () { return scanLegacy(true); },
    convertLegacy: convertLegacy,
    _core: Core
  };
})();
