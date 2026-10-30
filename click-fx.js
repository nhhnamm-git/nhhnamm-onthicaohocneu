/* ============================================================================
   click-fx.js — Hiệu ứng click "vệt sáng xanh dương, kiểu chuyển đổi số"
   ----------------------------------------------------------------------------
   CÁCH DÙNG (chỉ 1 dòng, đặt cuối <body> trong index.html):
       <script src="click-fx.js"></script>

   - Không cần sửa bất kỳ file/CSS nào khác. File tự tạo 1 lớp canvas trong suốt
     phủ toàn trang (pointer-events:none nên KHÔNG chặn click, KHÔNG ảnh hưởng
     layout), nghe sự kiện ở cấp document nên áp dụng cho mọi trang/mọi phần tử,
     kể cả phần tử tạo động sau này (modal, tab Thảo luận, ...).
   - Hiệu ứng: tia sáng toả ra + vòng xung + vòng nét đứt xoay + đường mạch điện
     (trục ngang/dọc kết thúc bằng nút vuông) + hạt pixel, màu xanh dương/cyan.
   - Tự tắt khi người dùng bật "giảm chuyển động" của hệ điều hành.
   - Canvas chỉ chạy khi có hiệu ứng đang phát; xong là dừng, không tốn CPU.

   TUỲ CHỈNH nhanh:  window.ClickFX.disable() / .enable() / .setColors(a, b)
   ========================================================================== */
(function () {
  'use strict';
  if (window.ClickFX) return;

  var cfg = {
    enabled: true,
    c1: [20, 120, 212],   // xanh dương chính  (#1478d4)
    c2: [34, 211, 238],   // cyan nhấn         (#22d3ee)
    life: 760,            // ms
    max: 24               // tối đa số vụ nổ cùng lúc
  };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv, cx, dpr = 1, W = 0, H = 0, bursts = [], raf = 0;

  var rgba = function (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
    (document.body || document.documentElement).appendChild(cv);
    cx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize, { passive: true });
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x, y) {
    var b = { x: x, y: y, t0: performance.now(), rays: [], pix: [], rot: rnd(0, Math.PI) };
    var n = 12, i, a;
    for (i = 0; i < n; i++) {                       // tia sáng toả đều + lệch ngẫu nhiên
      a = (i / n) * Math.PI * 2 + rnd(-0.18, 0.18);
      b.rays.push({ a: a, r0: rnd(6, 12), len: rnd(26, 62), w: rnd(1, 2.2), cy: Math.random() < 0.4 });
    }
    for (i = 0; i < 4; i++) {                       // đường mạch điện 4 hướng, kết thúc bằng nút vuông
      b.rays.push({ a: i * Math.PI / 2, r0: 10, len: rnd(46, 84), w: 1.2, node: true, cy: true });
    }
    for (i = 0; i < 10; i++) {                      // hạt pixel
      a = rnd(0, Math.PI * 2);
      b.pix.push({ a: a, d: rnd(14, 52), s: Math.random() < 0.5 ? 2 : 3, cy: Math.random() < 0.5, dl: rnd(0, 0.25) });
    }
    if (bursts.length >= cfg.max) bursts.shift();
    bursts.push(b);
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function drawBurst(b, now) {
    var t = (now - b.t0) / cfg.life;
    if (t >= 1) return false;
    var e = easeOut(t), fade = 1 - t, x = b.x, y = b.y, i, r, g;

    // 1) quầng sáng lõi
    r = 10 + e * 46; g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(cfg.c2, 0.55 * Math.pow(fade, 1.6)));
    g.addColorStop(0.4, rgba(cfg.c1, 0.28 * fade));
    g.addColorStop(1, rgba(cfg.c1, 0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();

    // 2) vòng xung đặc + vòng nét đứt xoay (cảm giác "quét dữ liệu")
    cx.lineWidth = 1.6; cx.strokeStyle = rgba(cfg.c2, 0.75 * fade);
    cx.beginPath(); cx.arc(x, y, 8 + e * 42, 0, Math.PI * 2); cx.stroke();
    cx.save(); cx.translate(x, y); cx.rotate(b.rot + e * 2.2);
    cx.setLineDash([5, 7]); cx.lineWidth = 1.2; cx.strokeStyle = rgba(cfg.c1, 0.8 * fade);
    cx.beginPath(); cx.arc(0, 0, 14 + e * 62, 0, Math.PI * 2); cx.stroke();
    cx.restore(); cx.setLineDash([]);

    // 3) tia sáng: đầu tia chạy ra trước, đuôi bám theo rồi tắt dần
    cx.lineCap = 'round';
    for (i = 0; i < b.rays.length; i++) {
      var ry = b.rays[i], head = ry.r0 + ry.len * e, tail = ry.r0 + ry.len * Math.max(0, e - 0.55);
      var ca = Math.cos(ry.a), sa = Math.sin(ry.a);
      var x1 = x + ca * tail, y1 = y + sa * tail, x2 = x + ca * head, y2 = y + sa * head;
      g = cx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, rgba(cfg.c1, 0));
      g.addColorStop(1, rgba(ry.cy ? cfg.c2 : cfg.c1, 0.95 * fade));
      cx.strokeStyle = g; cx.lineWidth = ry.w;
      cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke();
      if (ry.node && t > 0.25) {                    // nút vuông ở cuối đường mạch
        var s = 4 * (1 - t) + 1.5;
        cx.fillStyle = rgba(cfg.c2, 0.95 * fade);
        cx.fillRect(x2 - s / 2, y2 - s / 2, s, s);
      }
    }

    // 4) hạt pixel bay ra, nhấp nháy nhẹ
    for (i = 0; i < b.pix.length; i++) {
      var p = b.pix[i], pt = Math.min(1, Math.max(0, (t - p.dl) / (1 - p.dl)));
      if (pt <= 0) continue;
      var d = p.d * easeOut(pt), al = (1 - pt) * (Math.random() < 0.15 ? 0.4 : 1);
      cx.fillStyle = rgba(p.cy ? cfg.c2 : cfg.c1, 0.9 * al);
      cx.fillRect(x + Math.cos(p.a) * d - p.s / 2, y + Math.sin(p.a) * d - p.s / 2, p.s, p.s);
    }
    return true;
  }

  function frame(now) {
    raf = 0;
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, W, H);
    cx.globalCompositeOperation = 'lighter';        // cộng sáng -> hiệu ứng phát sáng
    bursts = bursts.filter(function (b) { return drawBurst(b, now); });
    cx.globalCompositeOperation = 'source-over';
    if (bursts.length) raf = requestAnimationFrame(frame);
    else cx.clearRect(0, 0, W, H);                  // xong -> dừng hẳn, không tốn CPU
  }

  // capture:true để vẫn nhận sự kiện dù phần tử khác gọi stopPropagation()
  document.addEventListener('pointerdown', function (e) {
    if (!cfg.enabled || reduce) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // chỉ chuột trái / chạm / bút
    ensureCanvas();
    spawn(e.clientX, e.clientY);
  }, { capture: true, passive: true });

  window.ClickFX = {
    enable: function () { cfg.enabled = true; },
    disable: function () { cfg.enabled = false; },
    setColors: function (c1, c2) { if (c1) cfg.c1 = c1; if (c2) cfg.c2 = c2; }  // dạng [r,g,b]
  };
})();
