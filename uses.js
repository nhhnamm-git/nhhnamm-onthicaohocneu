/* ============================================================================
   uses.js - Hướng dẫn sử dụng & Tóm tắt chức năng
   ============================================================================ */

(function() {
    // 1. Inject CSS cho Modal Hướng dẫn sử dụng
    const style = document.createElement('style');
    style.innerHTML = `
        #userGuideModal .modal-box {
            max-width: 700px;
            max-height: 85vh;
            overflow-y: auto;
            text-align: left;
        }
        .ug-section {
            margin-bottom: 20px;
        }
        .ug-section h4 {
            font-size: 15.5px;
            color: var(--accent);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ug-section p, .ug-section ul {
            font-size: 13.5px;
            color: var(--text-main);
            line-height: 1.6;
        }
        .ug-section ul {
            padding-left: 20px;
            margin-top: 4px;
        }
        .ug-section li {
            margin-bottom: 6px;
        }
        .ug-highlight {
            background: rgba(245, 158, 11, 0.1);
            border-left: 3px solid var(--warning);
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 13px;
            line-height: 1.5;
            color: #b45309;
            margin-top: 10px;
        }
        [data-theme="dark"] .ug-highlight {
            color: #fcd34d;
        }
        
        #userGuideBtn {
            margin-right: 8px;
            font-weight: 700;
        }
        @media (max-width: 600px) {
            #userGuideBtn span { display: none; }
        }
    `;
    document.head.appendChild(style);

    // 2. Tạo nội dung Modal HTML
    const modalHtml = \`
        <div class="modal-overlay" id="userGuideModal">
            <div class="modal-box">
                <h3 style="font-size: 19px; font-weight: 800; margin-bottom: 18px; text-align: center; color: var(--text-main);">
                    <i class="fa-solid fa-compass" style="color: var(--accent);"></i> Tóm tắt chức năng & Hướng dẫn sử dụng
                </h3>
                
                <div class="ug-section">
                    <h4><i class="fa-solid fa-graduation-cap"></i> 1. Học Tập & Luyện Đề Cơ Bản</h4>
                    <ul>
                        <li><b>Danh sách phần & Làm bài:</b> Hệ thống câu hỏi trắc nghiệm chia theo từng phần nhỏ. Tự động chấm điểm, tính giờ và hiện giải thích chi tiết sau khi làm xong.</li>
                        <li><b>Khóa học (Video):</b> Hệ thống bài giảng video (YouTube, Google Drive) chia theo chuyên đề. Tự động lưu tiến trình xem của học viên.</li>
                        <li><b>Ôn câu sai & Câu yêu thích:</b> Tính năng tự động lưu và nhóm các câu hỏi làm sai hoặc được đánh dấu để tối ưu việc ôn tập lại.</li>
                        <li><b>Đề tự tạo & Đề cộng đồng:</b> Tính năng tải đề thi lên hệ thống bằng file PDF (kèm đáp án Excel) hoặc file JSON. Học viên có thể thi thử và chia sẻ đề cho cộng đồng.</li>
                    </ul>
                </div>

                <div class="ug-section">
                    <h4><i class="fa-solid fa-robot"></i> 2. Tiện ích AI & Mở rộng</h4>
                    <ul>
                        <li><b>Chấm bài luận AI:</b> Tải lên file bài làm, đề bài, và rubric. Trí tuệ nhân tạo (Gemini/Claude) sẽ đọc hiểu và chấm điểm, phân tích chuyên sâu từng câu chữ, đoạn văn.</li>
                        <li><b>Đọc báo:</b> Cập nhật tin tức kinh tế, tài chính liên tục theo thời gian thực từ các nguồn báo lớn (VNExpress, CafeF, CafeBiz, v.v.).</li>
                        <li><b>Khỉ AI Chatbot:</b> Trợ lý ảo góc dưới màn hình hỗ trợ giải đáp thắc mắc tức thời mọi lúc mọi nơi.</li>
                        <li><b>Bảng xếp hạng (Hall of Fame):</b> Hệ thống tính điểm kinh nghiệm (XP) và hơn 40 chỉ số phụ, giúp tạo động lực thi đua giữa các học viên.</li>
                    </ul>
                    <div class="ug-highlight">
                        <i class="fa-solid fa-clock"></i> <b>Lưu ý quan trọng:</b> Do đòi hỏi việc phân tích dữ liệu lớn và lấy dữ liệu trực tiếp từ các hệ thống bên ngoài, <b>thời gian chờ cho các module "Chấm luận AI" và "Đọc báo" là khoảng 1 phút</b>. Vui lòng kiên nhẫn khi sử dụng!
                    </div>
                </div>

                <div class="ug-section">
                    <h4><i class="fa-solid fa-chart-pie"></i> 3. Quản lý, Thống Kê & Phân Tích</h4>
                    <ul>
                        <li><b>Dashboard & Thống kê:</b> Hiển thị đầy đủ biểu đồ tiến độ, phân tích độ chính xác, tỷ lệ đúng/sai và heatmap lịch sử học tập.</li>
                        <li><b>Lịch sử & Export:</b> Nhật ký làm bài chi tiết; cho phép xuất (Export) dữ liệu dưới dạng file CSV/Excel tiện lợi.</li>
                        <li><b>Hệ thống Quản lý (Admin):</b> Quản lý, phê duyệt đăng nhập của thành viên và phân quyền truy cập.</li>
                    </ul>
                </div>

                <div class="modal-actions" style="margin-top: 24px;">
                    <button class="btn btn-primary" id="closeUserGuideBtn" style="width: 100%;"><i class="fa-solid fa-check"></i> Đã hiểu</button>
                </div>
            </div>
        </div>
    \`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 3. Khởi tạo nút trên thanh Header (Topbar)
    function injectHeaderBtn() {
        const topbarRight = document.querySelector('.topbar-right');
        if (topbarRight && !document.getElementById('userGuideBtn')) {
            const guideBtn = document.createElement('button');
            guideBtn.id = 'userGuideBtn';
            guideBtn.className = 'btn btn-outline btn-sm';
            guideBtn.innerHTML = '<i class="fa-solid fa-circle-info"></i> <span>Hướng dẫn</span>';
            guideBtn.title = "Hướng dẫn sử dụng";
            
            // Chèn vào trước nút Dark Mode nếu có
            const darkToggle = document.getElementById('darkToggleBtn');
            if (darkToggle) {
                topbarRight.insertBefore(guideBtn, darkToggle);
            } else {
                topbarRight.appendChild(guideBtn);
            }

            const modal = document.getElementById('userGuideModal');
            const closeBtn = document.getElementById('closeUserGuideBtn');

            guideBtn.addEventListener('click', () => {
                modal.classList.add('show');
            });

            closeBtn.addEventListener('click', () => {
                modal.classList.remove('show');
            });

            // Nhấn ra ngoài modal để đóng
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });
        }
    }

    // Đảm bảo DOM đã tải xong
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectHeaderBtn);
    } else {
        injectHeaderBtn();
    }
})();
