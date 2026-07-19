/* ============================================================================
   uses.js — Hướng dẫn sử dụng & Tóm tắt chức năng (BẢN GỘP)
   ----------------------------------------------------------------------------
   - Thuần JavaScript ES6+, không sửa HTML/CSS gốc, chỉ cần thêm:
       <script src="uses.js"></script>
   - File này gộp đầy đủ tính năng của 2 phiên bản trước đó, KHÔNG bớt tính
     năng nào:
       1) Nút "Hướng dẫn sử dụng" LUÔN hiển thị ngay khi trang tải xong,
          không phụ thuộc trạng thái đăng nhập — được chèn vào .topbar-right,
          ngay trước khu vực tên người dùng (#userBadge). Đây là lối vào
          chính, đảm bảo mọi người dùng (kể cả chưa đăng nhập) đều thấy được.
       2) Đồng thời, khi #userBadge xuất hiện/hiển thị (đã đăng nhập), khu
          vực avatar/tên đó cũng được gắn thêm một dropdown nhỏ với mục
          "Hướng dẫn sử dụng" để bấm thẳng vào label tên vẫn mở được hướng
          dẫn — giữ nguyên trải nghiệm của bản dropdown gốc.
       Cả 2 lối vào đều mở chung một modal duy nhất, tránh trùng lặp nội
       dung và dữ liệu.
   - Nội dung hướng dẫn bao trùm toàn bộ chức năng hiện có của website, chia
     đúng theo các nhóm trong sidebar (Tổng quan / Học tập / Phân tích / Hệ
     thống) cộng thêm nhóm "Tiện ích mở rộng" (các module nạp thêm bằng JS
     riêng: Đọc báo, Khóa học video, Chấm luận AI, Khỉ AI Chatbot, Bảng xếp
     hạng...).
   ============================================================================ */

(function () {
    'use strict';

    /* ============================================================
     * 1. CSS cho Modal Hướng dẫn sử dụng + Nút cố định + Dropdown
     * ============================================================ */
    const style = document.createElement('style');
    style.id = 'user-guide-styles';
    style.innerHTML = `
        #userGuideModal .modal-box {
            max-width: 760px;
            max-height: 85vh;
            overflow-y: auto;
            text-align: left;
        }
        .ug-section { margin-bottom: 22px; }
        .ug-section:last-of-type { margin-bottom: 0; }
        .ug-section-tag {
            display: inline-block;
            font-size: 10.5px;
            font-weight: 800;
            letter-spacing: .4px;
            text-transform: uppercase;
            color: var(--accent-2);
            background: rgba(6, 182, 212, 0.12);
            padding: 3px 9px;
            border-radius: 6px;
            margin-bottom: 8px;
        }
        .ug-section h4 {
            font-size: 15.5px;
            font-weight: 800;
            color: var(--text-main);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ug-section h4 i { color: var(--accent); width: 18px; text-align: center; }
        .ug-section p, .ug-section ul {
            font-size: 13.5px;
            color: var(--text-main);
            line-height: 1.65;
        }
        .ug-section > p.ug-desc { color: var(--text-muted); margin-bottom: 6px; }
        .ug-section ul { padding-left: 20px; margin-top: 4px; }
        .ug-section li { margin-bottom: 7px; }
        .ug-section li b { color: var(--text-main); }
        .ug-divider {
            border: none;
            border-top: 1px dashed var(--card-border);
            margin: 18px 0;
        }
        .ug-highlight {
            background: rgba(245, 158, 11, 0.1);
            border-left: 3px solid var(--warning);
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.55;
            color: #b45309;
            margin-top: 10px;
        }
        [data-theme="dark"] .ug-highlight { color: #fcd34d; }
        .ug-admin-note {
            background: rgba(20, 120, 212, 0.08);
            border-left: 3px solid var(--accent);
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.55;
            color: var(--text-main);
            margin-top: 10px;
        }

        /* ---- Nút "Hướng dẫn sử dụng" cố định trên topbar (luôn hiển thị) ---- */
        #userGuideBtn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 8px 14px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--card-border);
            background: var(--card-bg-solid);
            color: var(--text-main);
            font-size: 13px;
            font-weight: 700;
            font-family: inherit;
            cursor: pointer;
            transition: var(--trans);
            white-space: nowrap;
        }
        #userGuideBtn i { color: var(--accent); }
        #userGuideBtn:hover { border-color: var(--accent); color: var(--accent); }

        @media (max-width: 600px) {
            #userGuideBtn span { display: none; }
            #userGuideBtn { padding: 8px 10px; }
        }

        /* ---- Dropdown gắn tại user-badge trên header (lối vào phụ) ---- */
        #userBadge {
            position: relative;
            cursor: pointer;
            user-select: none;
        }
        #userBadge .ug-caret {
            margin-left: 6px;
            font-size: 10px;
            color: var(--text-muted);
            transition: transform .2s ease;
        }
        #userBadge.ug-open .ug-caret { transform: rotate(180deg); }
        .ug-dropdown {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            min-width: 200px;
            background: var(--card-bg-solid);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-lg);
            padding: 6px;
            z-index: 500;
            display: none;
            opacity: 0;
            transform: translateY(-6px);
            transition: opacity .18s ease, transform .18s ease;
        }
        .ug-dropdown.show { display: block; opacity: 1; transform: translateY(0); }
        .ug-dropdown-item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 10px 12px;
            border: none;
            background: transparent;
            color: var(--text-main);
            font-size: 13.5px;
            font-weight: 600;
            font-family: inherit;
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: var(--trans);
            text-align: left;
        }
        .ug-dropdown-item:hover { background: rgba(20,120,212,0.12); color: var(--accent); }
        .ug-dropdown-item i { width: 16px; text-align: center; color: var(--accent); }

        @media (max-width: 600px) {
            .ug-dropdown { right: -10px; }
        }
    `;
    document.head.appendChild(style);

    /* ============================================================
     * 2. Nội dung Modal — Tóm tắt TOÀN BỘ chức năng của website
     * ============================================================ */
    const modalHtml = `
        <div class="modal-overlay" id="userGuideModal">
            <div class="modal-box">
                <h3 style="font-size: 19px; font-weight: 800; margin-bottom: 18px; text-align: center; color: var(--text-main);">
                    <i class="fa-solid fa-compass" style="color: var(--accent);"></i> Tóm tắt chức năng &amp; Hướng dẫn sử dụng
                </h3>

                <!-- ====== TÀI KHOẢN & PHÂN QUYỀN ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Tài khoản</span>
                    <h4><i class="fa-brands fa-google"></i> Đăng nhập &amp; Phân quyền</h4>
                    <ul>
                        <li><b>Đăng nhập bằng Google:</b> Toàn bộ tiến trình học được gắn với tài khoản Google của bạn, không phụ thuộc vào trình duyệt hay thiết bị đang dùng.</li>
                        <li><b>Vai trò User / Admin:</b> Mỗi tài khoản được cấp một vai trò hiển thị ngay tại khu vực tên trên header. Admin có thêm quyền chia sẻ đề cho toàn bộ người dùng và cập nhật trực tiếp 300 câu hỏi gốc.</li>
                        <li><b>Đăng xuất &amp; Reset:</b> Nút <i class="fa-solid fa-right-from-bracket"></i> để đăng xuất, nút <i class="fa-solid fa-trash-can"></i> trên header để xoá nhanh dữ liệu học tập trên thiết bị hiện tại.</li>
                    </ul>
                </div>

                <hr class="ug-divider">

                <!-- ====== TỔNG QUAN ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Tổng quan</span>
                    <h4><i class="fa-solid fa-gauge-high"></i> Dashboard</h4>
                    <ul>
                        <li>Tổng hợp nhanh các chỉ số học tập quan trọng: số câu đã làm, độ chính xác, số phần đã hoàn thành...</li>
                        <li>4 biểu đồ trực quan: <b>Tỷ lệ Đúng/Sai</b>, <b>Điểm số từng phần</b>, <b>Tiến bộ theo ngày</b> và <b>Radar kỹ năng theo phần</b> giúp nhận diện điểm mạnh/yếu.</li>
                        <li><b>Heatmap 90 ngày:</b> Bản đồ nhiệt hiển thị mức độ chăm chỉ ôn luyện theo từng ngày, càng đậm màu càng luyện tập nhiều.</li>
                    </ul>
                </div>

                <hr class="ug-divider">

                <!-- ====== HỌC TẬP ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Học tập</span>
                    <h4><i class="fa-solid fa-graduation-cap"></i> Luyện đề &amp; Ôn tập</h4>
                    <ul>
                        <li><b>Danh sách phần:</b> Ngân hàng câu hỏi được tự động chia thành các phần nhỏ (30/40/50/60 câu tuỳ chọn) để luyện tập từng bước.</li>
                        <li><b>Làm bài:</b> Trả lời trắc nghiệm với đồng hồ đếm ngược 90 giây/câu, bản đồ câu hỏi (qmap) để nhảy nhanh giữa các câu, đánh dấu <i class="fa-regular fa-star"></i> câu khó ngay trong lúc làm, và xem giải thích chi tiết (35 giây) ngay sau khi trả lời.</li>
                        <li><b>Kết quả:</b> Sau khi nộp bài, hệ thống chấm điểm/10, hiển thị số câu đúng/sai, thời gian làm bài, độ chính xác và cho phép làm lại hoặc chuyển thẳng sang ôn câu sai.</li>
                        <li><b>Ôn câu sai:</b> Gom toàn bộ các câu từng trả lời sai, lọc theo 7/30/90 ngày gần nhất hoặc tất cả, rồi ôn lại theo bộ riêng.</li>
                        <li><b>Câu yêu thích:</b> Danh sách các câu bạn đã tự đánh dấu (⭐) vì thấy khó hoặc cần ôn thêm.</li>
                    </ul>
                </div>

                <div class="ug-section">
                    <h4><i class="fa-solid fa-file-import"></i> Đề tự tạo &amp; Đề cộng đồng</h4>
                    <ul>
                        <li><b>Tạo đề từ JSON:</b> Tải lên file <code>questions.json</code> (id/question/options/answer) để tạo một đề luyện thi riêng, không ảnh hưởng tới 300 câu hỏi gốc.</li>
                        <li><b>Tạo đề từ PDF + đáp án Excel:</b> Upload đề thi dạng PDF, tải file mẫu Excel để điền đáp án rồi upload lại; khi làm bài hệ thống tính giờ chung cho toàn bài (dựa trên số câu × 90 giây).</li>
                        <li><b>Đề cộng đồng:</b> Bất kỳ ai cũng có thể tải đề (JSON hoặc PDF + Excel) lên để <b>mọi người dùng khác</b> cùng xem và làm thử; đề gắn tên người tải lên, không ảnh hưởng 300 câu gốc, và chỉ người tải lên hoặc Admin mới xoá được.</li>
                        <li><b>Riêng với Admin:</b> có thêm 2 tuỳ chọn — chia sẻ đề cho <b>TẤT CẢ</b> người dùng, hoặc cập nhật thẳng vào <b>300 câu hỏi gốc</b> (áp dụng ngay cho mọi người, cần thao tác cẩn thận vì sẽ thay thế toàn bộ nội dung hiện tại).</li>
                    </ul>
                </div>

                <hr class="ug-divider">

                <!-- ====== PHÂN TÍCH ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Phân tích</span>
                    <h4><i class="fa-solid fa-chart-line"></i> Thống kê &amp; Lịch sử</h4>
                    <ul>
                        <li><b>Thống kê:</b> Xem lại tiến trình học theo <b>Ngày / Tuần / Tháng / Năm</b> kèm biểu đồ cột thay đổi tương ứng.</li>
                        <li><b>Lịch sử học tập:</b> Nhật ký chi tiết từng lần làm bài (ngày, giờ, phần, điểm, đúng/sai, thời gian), có thể tìm kiếm theo tên phần/ngày và sắp xếp theo điểm hoặc thời gian.</li>
                    </ul>
                </div>

                <hr class="ug-divider">

                <!-- ====== HỆ THỐNG ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Hệ thống</span>
                    <h4><i class="fa-solid fa-gear"></i> Export &amp; Cài đặt</h4>
                    <ul>
                        <li><b>Export kết quả:</b> Xuất Lịch sử / Câu sai / Câu yêu thích ra file CSV (mở trực tiếp bằng Excel); hoặc dùng nút "In / Lưu PDF báo cáo" để lưu báo cáo dưới dạng PDF qua chức năng in của trình duyệt.</li>
                        <li><b>Cài đặt:</b> Bật/tắt xáo trộn thứ tự câu hỏi và đáp án, chuyển Dark Mode, xem lại thời gian quy định mỗi câu (90 giây) và thời gian đọc giải thích (35 giây), hoặc reset toàn bộ dữ liệu đã lưu trên thiết bị.</li>
                        <li><b>Quản trị (Admin):</b> Duyệt đăng nhập của thành viên mới, phân quyền User/Admin, quản lý và gỡ các đề dùng chung hoặc đề cộng đồng vi phạm.</li>
                    </ul>
                </div>

                <hr class="ug-divider">

                <!-- ====== TIỆN ÍCH MỞ RỘNG (AI & module thêm) ====== -->
                <div class="ug-section">
                    <span class="ug-section-tag">Tiện ích mở rộng</span>
                    <h4><i class="fa-solid fa-robot"></i> AI &amp; Các module bổ sung</h4>
                    <ul>
                        <li><b>Chấm bài luận AI:</b> Tải lên file bài làm, đề bài và rubric chấm điểm; AI (Gemini/Claude) đọc hiểu và chấm điểm, phân tích chi tiết từng câu/đoạn văn kèm nhận xét cải thiện.</li>
                        <li><b>Đọc báo:</b> Module tổng hợp tin tức kinh tế - tài chính theo thời gian thực từ nhiều nguồn báo (VNExpress, CafeF, CafeBiz, VnEconomy, Vietstock...), có tìm kiếm, lọc theo nguồn/thời gian, bookmark và lịch sử đã đọc, tự cập nhật mỗi 60 giây.</li>
                        <li><b>Khóa học (Video):</b> Hệ thống bài giảng video (YouTube/Google Drive) chia theo chuyên đề, tự lưu lại tiến trình xem của bạn.</li>
                        <li><b>Khỉ AI Chatbot:</b> Trợ lý ảo ở góc màn hình, hỗ trợ giải đáp thắc mắc về kiến thức hoặc cách dùng website mọi lúc.</li>
                        <li><b>Bảng xếp hạng (Hall of Fame):</b> Hệ thống tính điểm kinh nghiệm (XP) cùng hơn 40 chỉ số phụ khác, tạo động lực thi đua giữa các học viên.</li>
                    </ul>
                    <div class="ug-highlight">
                        <i class="fa-solid fa-clock"></i> <b>Lưu ý quan trọng:</b> Do cần phân tích dữ liệu lớn hoặc lấy dữ liệu trực tiếp từ hệ thống bên ngoài, <b>thời gian chờ cho "Chấm luận AI" và "Đọc báo" có thể mất khoảng 1 phút</b> ở lần tải đầu tiên. Vui lòng kiên nhẫn khi sử dụng!
                    </div>
                </div>

                <div class="modal-actions" style="margin-top: 24px;">
                    <button class="btn btn-primary" id="closeUserGuideBtn" style="width: 100%;"><i class="fa-solid fa-check"></i> Đã hiểu</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    /* ============================================================
     * 3. Mở / đóng modal (dùng chung cho cả 2 lối vào)
     * ============================================================ */
    function openModal() {
        const modal = document.getElementById('userGuideModal');
        if (modal) modal.classList.add('show');
    }

    function closeModal() {
        const modal = document.getElementById('userGuideModal');
        if (modal) modal.classList.remove('show');
    }

    function bindModalClose() {
        const modal = document.getElementById('userGuideModal');
        const closeBtn = document.getElementById('closeUserGuideBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    }

    /* ============================================================
     * 4. LỐI VÀO CHÍNH — Nút "Hướng dẫn sử dụng" cố định trên topbar,
     *    LUÔN hiển thị ngay khi trang tải, KHÔNG phụ thuộc đăng nhập.
     * ============================================================ */
    function injectGuideButton() {
        if (document.getElementById('userGuideBtn')) return true; // đã chèn rồi, tránh trùng lặp

        const topbarRight = document.querySelector('.topbar-right');
        if (!topbarRight) return false; // chưa thấy topbar, thử lại sau

        const btn = document.createElement('button');
        btn.id = 'userGuideBtn';
        btn.type = 'button';
        btn.innerHTML = '<i class="fa-solid fa-circle-info"></i><span>Hướng dẫn sử dụng</span>';
        btn.title = 'Hướng dẫn sử dụng';
        btn.addEventListener('click', openModal);

        // Chèn ngay TRƯỚC khu vực tên user (#userBadge) nếu có, để nằm sát cạnh nó;
        // nếu chưa có (chưa kịp render / chưa đăng nhập) thì chèn vào đầu topbar-right.
        const userBadge = document.getElementById('userBadge');
        if (userBadge) {
            topbarRight.insertBefore(btn, userBadge);
        } else {
            topbarRight.insertBefore(btn, topbarRight.firstChild);
