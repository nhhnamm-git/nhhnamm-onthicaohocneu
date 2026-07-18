/**
 * LEADERBOARD MODULE
 * Tự động tiêm (inject) Tab Bảng xếp hạng vào giao diện và xử lý đồng bộ Firebase.
 * Chạy độc lập, không cần sửa core logic của index.html.
 */
(function() {
    const LeaderboardManager = {
        currentTab: 'score', // 'score' hoặc 'time'
        list: [],
        initialized: false,

        // 1. INJECT GIAO DIỆN VÀO DOM
        injectUI() {
            // Chèn nút vào Sidebar
            const navSection = document.querySelector('.sidebar-nav');
            if (navSection && !document.querySelector('[data-view="leaderboard"]')) {
                // Tìm nhãn "Phân tích" để chèn ngay dưới nó
                const analysisLabel = Array.from(document.querySelectorAll('.nav-section-label')).find(el => el.textContent.includes('Phân tích'));
                if (analysisLabel) {
                    const btn = document.createElement('button');
                    btn.className = 'nav-item';
                    btn.dataset.view = 'leaderboard';
                    btn.innerHTML = '<i class="fa-solid fa-ranking-star"></i> Bảng xếp hạng';
                    // Thêm sự kiện điều hướng mượn từ UIManager
                    btn.addEventListener('click', () => UIManager.navigate('leaderboard'));
                    analysisLabel.insertAdjacentElement('afterend', btn);
                }
            }

            // Chèn màn hình View vào Content
            const contentArea = document.querySelector('.content');
            if (contentArea && !document.getElementById('view-leaderboard')) {
                const section = document.createElement('section');
                section.className = 'view';
                section.id = 'view-leaderboard';
                section.innerHTML = `
                    <div class="section-head">
                        <div>
                            <h2><i class="fa-solid fa-crown" style="color:var(--warning);"></i> Bảng xếp hạng</h2>
                            <p>Vinh danh các thành viên xuất sắc và chăm chỉ nhất hệ thống</p>
                        </div>
                        <div class="toolbar" style="margin:0;">
                            <button class="filter-chip active" data-lb-tab="score"><i class="fa-solid fa-star"></i> Top Điểm số</button>
                            <button class="filter-chip" data-lb-tab="time"><i class="fa-solid fa-clock"></i> Top Chăm chỉ</button>
                        </div>
                    </div>
                    <div class="card table-wrap" style="margin-top:16px;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="width: 60px; text-align:center;">Hạng</th>
                                    <th>Học viên</th>
                                    <th id="lb-metric-header">Tổng điểm</th>
                                </tr>
                            </thead>
                            <tbody id="leaderboardTableBody">
                                <tr><td colspan="3" style="text-align:center; padding: 30px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu...</td></tr>
                            </tbody>
                        </table>
                    </div>
                `;
                contentArea.appendChild(section);

                // Gắn sự kiện chuyển tab (Điểm / Thời gian)
                section.querySelectorAll('.filter-chip').forEach(chip => {
                    chip.addEventListener('click', (e) => {
                        section.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                        e.currentTarget.classList.add('active');
                        this.currentTab = e.currentTarget.dataset.lbTab;
                        document.getElementById('lb-metric-header').textContent = this.currentTab === 'score' ? 'Tổng điểm' : 'Thời gian học';
                        this.renderList();
                    });
                });
            }
        },

        // 2. ĐỒNG BỘ DỮ LIỆU CÁ NHÂN LÊN FIRESTORE
        async syncLocalDataToCloud() {
            if (typeof AuthManager === 'undefined' || !AuthManager.currentUser) return;
            
            // Tính tổng điểm từ ScoreManager
            const scores = ScoreManager.getAll();
            let totalScore = 0;
            Object.values(scores).forEach(s => { totalScore += s.best; });
            
            // Lấy tổng thời gian học từ StorageManager
            const studyTimeSec = StorageManager.get(StorageManager.KEYS.STUDY_TIME, 0);
            const user = AuthManager.currentUser;
            
            try {
                await fbDb.collection('leaderboard').doc(user.uid).set({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || user.email.split('@')[0],
                    photoURL: user.photoURL || '',
                    totalScore: parseFloat(totalScore.toFixed(2)),
                    studyTimeSec: studyTimeSec,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            } catch(e) {
                console.error("Lỗi đồng bộ leaderboard:", e);
            }
        },

        // 3. KÉO DỮ LIỆU TỪ FIRESTORE VÀ HIỂN THỊ
        async loadData() {
            const tbody = document.getElementById('leaderboardTableBody');
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ dữ liệu...</td></tr>';
            
            // Cập nhật điểm của mình lên server trước khi tải bảng xếp hạng về
            await this.syncLocalDataToCloud();

            const orderByField = this.currentTab === 'score' ? 'totalScore' : 'studyTimeSec';
            try {
                const snap = await fbDb.collection('leaderboard')
                    .orderBy(orderByField, 'desc')
                    .limit(50) // Top 50 người
                    .get();
                    
                this.list = snap.docs.map(doc => doc.data());
                this.renderList();
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--danger); padding: 30px;">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
            }
        },

        renderList() {
            const tbody = document.getElementById('leaderboardTableBody');
            if (!this.list.length) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 30px; color:var(--text-muted);">Chưa có dữ liệu xếp hạng.</td></tr>';
                return;
            }

            // Sắp xếp lại danh sách theo tab hiện tại (phòng trường hợp fetch 1 lần lưu cache)
            const sortedList = [...this.list].sort((a, b) => {
                if (this.currentTab === 'score') return (b.totalScore || 0) - (a.totalScore || 0);
                return (b.studyTimeSec || 0) - (a.studyTimeSec || 0);
            });

            const currentUid = (typeof AuthManager !== 'undefined' && AuthManager.currentUser) ? AuthManager.currentUser.uid : null;

            tbody.innerHTML = sortedList.map((user, index) => {
                let rankBadge = `<span style="font-size:14px; font-weight:800; color:var(--text-muted);">${index + 1}</span>`;
                if (index === 0) rankBadge = `<i class="fa-solid fa-trophy" style="color: #fbbf24; font-size: 20px;"></i>`;
                else if (index === 1) rankBadge = `<i class="fa-solid fa-medal" style="color: #9ca3af; font-size: 18px;"></i>`;
                else if (index === 2) rankBadge = `<i class="fa-solid fa-medal" style="color: #b45309; font-size: 18px;"></i>`;

                const metricValue = this.currentTab === 'score' 
                    ? `<span class="part-score" style="font-size:16px;">${(user.totalScore || 0).toFixed(2)}</span>`
                    : `<b style="color:var(--accent);">${Utils.formatSecToClock(user.studyTimeSec || 0)}</b>`;

                const isMe = (currentUid === user.uid);
                const rowStyle = isMe ? 'background: rgba(20, 120, 212, 0.08);' : '';

                return `
                    <tr style="${rowStyle}">
                        <td style="text-align:center;">${rankBadge}</td>
                        <td>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <img src="${user.photoURL || 'https://via.placeholder.com/40'}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border: 1.5px solid var(--card-border);">
                                <div>
                                    <b style="display:block; font-size:13.5px; color: ${isMe ? 'var(--accent)' : 'var(--text-main)'}">${Utils.escapeHtml(user.displayName)} ${isMe ? '<span class="pill good" style="margin-left:6px;">Bạn</span>' : ''}</b>
                                    <span style="font-size: 11px; color: var(--text-muted);">${Utils.escapeHtml(user.email)}</span>
                                </div>
                            </div>
                        </td>
                        <td>${metricValue}</td>
                    </tr>
                `;
            }).join('');
        }
    };

    // 4. MÓC (HOOK) VÀO VÒNG ĐỜI CỦA APP ĐỂ KHỞI CHẠY TỰ ĐỘNG
    // Hook vào hàm UIManager.navigate để xử lý khi bấm vào tab Leaderboard
    const observer = setInterval(() => {
        if (typeof UIManager !== 'undefined' && typeof AuthManager !== 'undefined') {
            clearInterval(observer);
            
            // Cập nhật mảng titles để thanh Topbar hiển thị đúng tiêu đề
            UIManager.titles.leaderboard = ['Bảng xếp hạng', 'Theo dõi và so sánh thành tích với các học viên khác'];
            
            // Overwrite (Monkey Patch) hàm navigate để bắt sự kiện mở tab
            const _origNavigate = UIManager.navigate.bind(UIManager);
            UIManager.navigate = function(view) {
                const result = _origNavigate(view);
                if (view === 'leaderboard') {
                    LeaderboardManager.loadData();
                }
                return result;
            };

            // Hook vào lúc User đăng nhập thành công để tiêm UI và đồng bộ dữ liệu ngầm
            const _origGrantAccess = AuthManager.grantAccess.bind(AuthManager);
            AuthManager.grantAccess = function(user) {
                _origGrantAccess(user);
                if (!LeaderboardManager.initialized) {
                    LeaderboardManager.injectUI();
                    LeaderboardManager.initialized = true;
                }
                // Đồng bộ nền mỗi khi đăng nhập
                LeaderboardManager.syncLocalDataToCloud();
            };
            
            // Hook vào QuizManager lúc nộp bài (finishQuiz) để cập nhật điểm ngay lập tức lên cloud
            if(typeof QuizManager !== 'undefined' && QuizManager.finishQuiz) {
                const _origFinishQuiz = QuizManager.finishQuiz.bind(QuizManager);
                QuizManager.finishQuiz = function() {
                    _origFinishQuiz();
                    LeaderboardManager.syncLocalDataToCloud();
                }
            }
        }
    }, 100);

})();