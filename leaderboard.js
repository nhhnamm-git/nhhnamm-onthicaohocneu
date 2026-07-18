/**
 * HALL OF FAME MODULE (ranking.js / hall_of_fame.js)
 * Tự động tiêm Tab "Hall Of Fame" vào giao diện.
 * Tính toán, phân tích 40 chỉ số xếp hạng và đồng bộ Firestore (collection: leaderboard)
 * Độc lập 100%, không can thiệp logic cũ.
 */
(function() {
    // 1. INJECT CSS DÀNH RIÊNG CHO HALL OF FAME
    const style = document.createElement('style');
    style.innerHTML = `
        .hof-view { display: none; animation: fadeUp .35s ease; }
        .hof-view.active { display: block; }
        
        /* Dashboard Cards */
        .hof-dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 22px; }
        .hof-dash-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 16px; display: flex; align-items: center; gap: 14px; box-shadow: var(--shadow-sm); }
        .hof-dash-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; flex-shrink: 0; }
        .hof-dash-info b { display: block; font-size: 20px; font-weight: 900; line-height: 1.2; color: var(--text-main); }
        .hof-dash-info span { font-size: 11.5px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

        /* Chips & Filters */
        .hof-chip-group { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .hof-chip { padding: 8px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; border: 1.5px solid var(--card-border); background: var(--card-bg); color: var(--text-main); cursor: pointer; transition: var(--trans); display: inline-flex; align-items: center; gap: 6px; }
        .hof-chip:hover { border-color: var(--accent); color: var(--accent); background: rgba(20,120,212,.06); }
        .hof-chip.active { background: linear-gradient(135deg, var(--blue-500), var(--cyan-500)); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(20,120,212,.25); }
        
        /* Select Dropdown cho 40 chỉ số */
        .hof-metric-select-wrap { margin-bottom: 18px; display: flex; align-items: center; gap: 10px; background: rgba(20,120,212,.05); padding: 12px 16px; border-radius: 14px; border: 1px solid var(--card-border); }
        .hof-metric-select { flex: 1; padding: 10px; border-radius: 10px; border: 1.5px solid var(--card-border); background: var(--card-bg-solid); color: var(--text-main); font-weight: 700; font-size: 13.5px; outline: none; cursor: pointer; }
        .hof-metric-select:focus { border-color: var(--accent); }

        /* Table & Animations */
        .hof-table-wrap { overflow-x: auto; border-radius: 16px; background: var(--card-bg); border: 1px solid var(--card-border); box-shadow: var(--shadow-sm); }
        .hof-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .hof-table th { text-align: left; padding: 14px 16px; background: rgba(20,120,212,.08); color: var(--text-muted); font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; border-bottom: 2px solid var(--card-border); }
        .hof-table td { padding: 14px 16px; border-bottom: 1px solid var(--card-border); white-space: nowrap; vertical-align: middle; transition: var(--trans); }
        .hof-table tr:last-child td { border-bottom: none; }
        .hof-table tr:hover td { background: rgba(20,120,212,.04); }

        /* Rank Styles */
        .hof-rank-box { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 15px; }
        
        .hof-top-1 { background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1.5px solid #fbbf24; color: #b45309; box-shadow: 0 0 15px rgba(251, 191, 36, 0.4); position: relative; }
        .hof-top-1::before { content: '👑'; position: absolute; top: -14px; font-size: 20px; animation: bounceCrown 1.5s infinite; filter: drop-shadow(0 2px 4px rgba(251,191,36,0.6)); }
        
        .hof-top-2 { background: linear-gradient(135deg, #f3f4f6, #e5e7eb); border: 1.5px solid #9ca3af; color: #4b5563; box-shadow: 0 0 10px rgba(156, 163, 175, 0.4); }
        .hof-top-3 { background: linear-gradient(135deg, #fff7ed, #ffedd5); border: 1.5px solid #fdba74; color: #c2410c; box-shadow: 0 0 10px rgba(253, 186, 116, 0.4); }
        .hof-top-n { background: rgba(20,120,212,.08); color: var(--text-muted); }

        /* User Info */
        .hof-user-cell { display: flex; align-items: center; gap: 12px; }
        .hof-avatar { width: 42px; height: 42px; border-radius: 12px; object-fit: cover; border: 2px solid var(--card-border); }
        .hof-avatar.glow-1 { border-color: #fbbf24; box-shadow: 0 0 0 3px rgba(251,191,36,0.2); animation: ringPulse 2s infinite; }
        .hof-avatar.glow-2 { border-color: #9ca3af; box-shadow: 0 0 0 3px rgba(156,163,175,0.2); }
        .hof-avatar.glow-3 { border-color: #fdba74; box-shadow: 0 0 0 3px rgba(253,186,116,0.2); }
        .hof-user-name { font-weight: 800; font-size: 14.5px; color: var(--text-main); display: flex; align-items: center; gap: 6px; }
        .hof-user-email { font-size: 11.5px; color: var(--text-muted); font-weight: 500; }
        
        /* Tags & Badges */
        .hof-title-tag { padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; }
        .hof-level-badge { background: linear-gradient(135deg, var(--blue-800), var(--blue-600)); color: #fff; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 900; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(6,53,99,0.3); }

        @keyframes bounceCrown { 0%, 100% { transform: translateY(0) rotate(-10deg); } 50% { transform: translateY(-4px) rotate(10deg); } }
        @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.6); } 70% { box-shadow: 0 0 0 8px rgba(251,191,36,0); } 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); } }
    `;
    document.head.appendChild(style);

    // 2. CẤU HÌNH 40 CHỈ SỐ VÀ CÁC DANH HIỆU
    const METRICS_CONFIG = {
        totalScore: { id: 'totalScore', name: '1. Tổng điểm', format: 'score', title: '👑 Vua điểm số', icon: 'fa-star' },
        avgScore: { id: 'avgScore', name: '2. Điểm trung bình', format: 'score', title: '📚 Học bá', icon: 'fa-chart-pie' },
        maxScore: { id: 'maxScore', name: '3. Điểm cao nhất', format: 'score', title: '🎯 Chính xác tuyệt đối', icon: 'fa-arrow-up-right-dots' },
        quizzesTaken: { id: 'quizzesTaken', name: '4. Số bài đã làm', format: 'number', title: '🏆 Vua luyện đề', icon: 'fa-pen-to-square' },
        totalExamsCompleted: { id: 'totalExamsCompleted', name: '5. Tổng số đề hoàn thành', format: 'number', title: '📝 Chuyên gia cày đề', icon: 'fa-file-signature' },
        studyTimeSec: { id: 'studyTimeSec', name: '6. Tổng thời gian học', format: 'time', title: '⏱️ Người chăm chỉ nhất', icon: 'fa-clock' },
        streak: { id: 'streak', name: '7. Chuỗi học liên tục', format: 'days', title: '🔥 Chuỗi học dài nhất', icon: 'fa-fire' },
        studyDays: { id: 'studyDays', name: '8. Tổng số ngày học', format: 'days', title: '📅 Chiến thần kiên trì', icon: 'fa-calendar-days' },
        accuracy: { id: 'accuracy', name: '9. Accuracy %', format: 'percent', title: '🎯 Xạ thủ học thuật', icon: 'fa-bullseye' },
        totalCorrect: { id: 'totalCorrect', name: '10. Tổng câu đúng', format: 'number', title: '✔️ Kẻ chinh phục', icon: 'fa-check' },
        totalWrong: { id: 'totalWrong', name: '11. Tổng câu sai (Càng thấp càng tốt)', format: 'number_reverse', title: '🛡️ Tường thành phòng ngự', icon: 'fa-xmark' },
        speed: { id: 'speed', name: '12. Tốc độ làm bài (giây/câu)', format: 'time_reverse', title: '⚡ Cao thủ tốc độ', icon: 'fa-bolt' },
        xp: { id: 'xp', name: '13. Điểm kinh nghiệm (XP)', format: 'number', title: '⭐ Siêu sao', icon: 'fa-angles-up' },
        level: { id: 'level', name: '14. Level', format: 'number', title: '👑 Grand Master', icon: 'fa-layer-group' },
        badgeCount: { id: 'badgeCount', name: '15. Số lượng Huy hiệu', format: 'number', title: '🏅 Người sưu tầm', icon: 'fa-medal' },
        achievementCount: { id: 'achievementCount', name: '16. Thành tích mở khóa', format: 'number', title: '🏆 Thợ săn thành tích', icon: 'fa-trophy' },
        completionRate: { id: 'completionRate', name: '17. Tỷ lệ hoàn thành', format: 'percent', title: '💯 Hoàn mĩ', icon: 'fa-percent' },
        quizHard: { id: 'quizHard', name: '18. Quiz Hard hoàn thành', format: 'number', title: '🧠 Kẻ thách thức', icon: 'fa-brain' },
        quizEasy: { id: 'quizEasy', name: '19. Quiz Easy hoàn thành', format: 'number', title: '🌱 Khởi đầu tốt', icon: 'fa-seedling' },
        quizMedium: { id: 'quizMedium', name: '20. Quiz Medium hoàn thành', format: 'number', title: '⚖️ Cân bằng hoàn hảo', icon: 'fa-scale-balanced' },
        quizExpert: { id: 'quizExpert', name: '21. Quiz Expert hoàn thành', format: 'number', title: '💎 Huyền thoại', icon: 'fa-gem' },
        loginCount: { id: 'loginCount', name: '22. Số lần đăng nhập', format: 'number', title: '👋 Khách quen', icon: 'fa-right-to-bracket' },
        joinedAt: { id: 'joinedAt', name: '23. Ngày tham gia (Sớm nhất)', format: 'date_reverse', title: '🏛️ Bậc thầy kỳ cựu', icon: 'fa-hourglass-start' },
        lastActive: { id: 'lastActive', name: '24. Người hoạt động gần đây nhất', format: 'date', title: '🟢 Đang Online', icon: 'fa-wifi' },
        progress7Days: { id: 'progress7Days', name: '25. Người tiến bộ nhất 7 ngày', format: 'score', title: '🚀 Thăng tiến thần tốc', icon: 'fa-rocket' },
        progress30Days: { id: 'progress30Days', name: '26. Người tiến bộ nhất 30 ngày', format: 'score', title: '📈 Tăng trưởng bền vững', icon: 'fa-chart-line' },
        studyToday: { id: 'studyToday', name: '27. Học nhiều nhất hôm nay', format: 'time', title: '☀️ Ngôi sao trong ngày', icon: 'fa-sun' },
        studyWeek: { id: 'studyWeek', name: '28. Học nhiều nhất tuần', format: 'time', title: '📅 Ngôi sao tuần', icon: 'fa-calendar-week' },
        studyMonth: { id: 'studyMonth', name: '29. Học nhiều nhất tháng', format: 'time', title: '🌙 Ngôi sao tháng', icon: 'fa-moon' },
        sessionCount: { id: 'sessionCount', name: '30. Tổng số phiên học', format: 'number', title: '🔁 Kẻ miệt mài', icon: 'fa-rotate' },
        averageSessionTime: { id: 'averageSessionTime', name: '31. Thời lượng trung bình mỗi phiên', format: 'time', title: '🧘 Thiền sư học tập', icon: 'fa-yin-yang' },
        hardExamsCompleted: { id: 'hardExamsCompleted', name: '32. Đề khó hoàn thành', format: 'number', title: '⚔️ Chiến thần', icon: 'fa-khanda' },
        perfectScoreCount: { id: 'perfectScoreCount', name: '33. Điểm tuyệt đối (10đ) nhiều nhất', format: 'number', title: '🌟 Vô đối', icon: 'fa-star-half-stroke' },
        hundredPercentCount: { id: 'hundredPercentCount', name: '34. Số lần đạt 100% Accuracy', format: 'number', title: '🎯 Bách phát bách trúng', icon: 'fa-crosshairs' },
        rareBadges: { id: 'rareBadges', name: '35. Huy hiệu hiếm', format: 'number', title: '🔮 Tinh anh', icon: 'fa-crystal-ball' },
        totalAchievements: { id: 'totalAchievements', name: '36. Tổng thành tích (Mọi loại)', format: 'number', title: '📜 Bách khoa toàn thư', icon: 'fa-scroll' },
        missionCompleted: { id: 'missionCompleted', name: '37. Tổng nhiệm vụ hoàn thành', format: 'number', title: '✅ Người giải quyết', icon: 'fa-list-check' },
        weeklyXP: { id: 'weeklyXP', name: '38. Tổng XP tuần', format: 'number', title: '🔥 Đang cháy', icon: 'fa-fire-flame-curved' },
        monthlyXP: { id: 'monthlyXP', name: '39. Tổng XP tháng', format: 'number', title: '🌪️ Cuồng phong', icon: 'fa-hurricane' },
        allTimeXP: { id: 'allTimeXP', name: '40. Tổng XP toàn thời gian', format: 'number', title: '👑 Đế vương', icon: 'fa-chess-king' }
    };

    const CHIPS_MAP = [
        { id: 'tong_hop', label: 'Tổng hợp', metric: 'xp' },
        { id: 'diem_so', label: 'Điểm số', metric: 'totalScore' },
        { id: 'cham_chi', label: 'Chăm chỉ', metric: 'studyTimeSec' },
        { id: 'thanh_tich', label: 'Thành tích', metric: 'achievementCount' },
        { id: 'kinh_nghiem', label: 'Kinh nghiệm', metric: 'level' },
        { id: 'chuoi_hoc', label: 'Chuỗi học', metric: 'streak' },
        { id: 'do_chinh_xac', label: 'Độ chính xác', metric: 'accuracy' },
        { id: 'bai_luyen', label: 'Bài luyện', metric: 'quizzesTaken' },
        { id: 'de_hoan_thanh', label: 'Đề hoàn thành', metric: 'totalExamsCompleted' },
        { id: 'huy_hieu', label: 'Huy hiệu', metric: 'badgeCount' },
        { id: 'cap_bac', label: 'Cấp bậc', metric: 'level' },
        { id: 'nguoi_moi', label: 'Người mới', metric: 'joinedAt' },
        { id: 'tien_bo', label: 'Tiến bộ', metric: 'progress7Days' },
        { id: 'hoat_dong', label: 'Hoạt động', metric: 'lastActive' },
        { id: 'cao_thu', label: 'Cao thủ', metric: 'perfectScoreCount' }
    ];

    // 3. CORE LOGIC CLASS
    const HallOfFameManager = {
        usersData: [],
        currentMetricId: 'xp',
        initialized: false,
        
        injectDOM() {
            // Sidebar
            const navSection = document.querySelector('.sidebar-nav');
            if (navSection && !document.querySelector('[data-view="halloffame"]')) {
                const leaderboardBtn = Array.from(document.querySelectorAll('.nav-item')).find(el => el.textContent.includes('Bảng xếp hạng'));
                const btn = document.createElement('button');
                btn.className = 'nav-item';
                btn.dataset.view = 'halloffame';
                btn.innerHTML = '<i class="fa-solid fa-crown" style="color: #fbbf24;"></i> Hall Of Fame';
                
                // Navigate Hook logic
                btn.addEventListener('click', () => UIManager.navigate('halloffame'));
                
                if (leaderboardBtn) {
                    leaderboardBtn.insertAdjacentElement('afterend', btn);
                } else {
                    const statsLabel = Array.from(document.querySelectorAll('.nav-section-label')).find(el => el.textContent.includes('Phân tích'));
                    if (statsLabel) statsLabel.insertAdjacentElement('afterend', btn);
                    else navSection.appendChild(btn);
                }
            }

            // Main Content View
            const contentArea = document.querySelector('.content');
            if (contentArea && !document.getElementById('view-halloffame')) {
                const section = document.createElement('section');
                section.className = 'view hof-view';
                section.id = 'view-halloffame';
                
                // Build Chips
                const chipsHTML = CHIPS_MAP.map((chip, idx) => `
                    <button class="hof-chip ${idx===0 ? 'active' : ''}" data-metric="${chip.metric}">
                        ${chip.label}
                    </button>
                `).join('');

                // Build Metric Dropdown
                const optionsHTML = Object.values(METRICS_CONFIG).map(m => `
                    <option value="${m.id}">${m.name}</option>
                `).join('');

                section.innerHTML = `
                    <div class="section-head">
                        <div>
                            <h2>👑 Hall Of Fame</h2>
                            <p>Bảng xếp hạng toàn diện của toàn bộ học viên.</p>
                        </div>
                    </div>
                    
                    <div class="hof-dashboard" id="hofDashboardTop">
                        <!-- Rendered dynamically -->
                    </div>

                    <div class="card" style="padding: 20px; margin-bottom: 22px;">
                        <div class="hof-chip-group">
                            ${chipsHTML}
                        </div>
                        
                        <div class="hof-metric-select-wrap">
                            <i class="fa-solid fa-filter" style="color: var(--accent);"></i>
                            <span style="font-size: 13px; font-weight: 600; color: var(--text-muted);">Hoặc chọn chi tiết 40 chỉ số:</span>
                            <select class="hof-metric-select" id="hofMetricSelector">
                                ${optionsHTML}
                            </select>
                        </div>
                        
                        <div class="hof-table-wrap">
                            <table class="hof-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50px; text-align:center;">#</th>
                                        <th>Học viên</th>
                                        <th>Danh hiệu</th>
                                        <th style="text-align: right;" id="hofValueHeader">Giá trị</th>
                                        <th style="width: 80px; text-align:center;">Cấp</th>
                                    </tr>
                                </thead>
                                <tbody id="hofTableBody">
                                    <tr><td colspan="5" style="text-align:center; padding: 40px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu HOF...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                contentArea.appendChild(section);

                // Event Listeners for Filter UI
                const chipEls = section.querySelectorAll('.hof-chip');
                const selectEl = document.getElementById('hofMetricSelector');
                
                chipEls.forEach(chip => {
                    chip.addEventListener('click', (e) => {
                        chipEls.forEach(c => c.classList.remove('active'));
                        chip.classList.add('active');
                        this.currentMetricId = chip.dataset.metric;
                        selectEl.value = this.currentMetricId; // sync dropdown
                        this.renderTable();
                    });
                });

                selectEl.addEventListener('change', (e) => {
                    this.currentMetricId = e.target.value;
                    chipEls.forEach(c => c.classList.remove('active'));
                    // Highlight matching chip if exists
                    const matchChip = Array.from(chipEls).find(c => c.dataset.metric === this.currentMetricId);
                    if (matchChip) matchChip.classList.add('active');
                    this.renderTable();
                });
            }
        },

        calculateLocalStats() {
            // Function thu thập và tính toán 40 chỉ số từ LocalStorage của user hiện tại
            let history = [], scores = {}, wrongBank = {}, correctBank = {};
            let studyTimeSec = 0, sessionCount = 0;
            
            // Safe JSON parse wrapper
            const getL = (key, def) => { try { return JSON.parse(localStorage.getItem('examMasterPro_' + key)) || def; } catch(e) { return def; } };
            
            history = getL('history', []);
            scores = getL('partScores', {});
            wrongBank = getL('wrongBank', {});
            correctBank = getL('correctBank', {});
            studyTimeSec = getL('studyTimeSec', 0);
            sessionCount = getL('sessionsCount', 0);

            // Compute aggregates
            let totalScore = 0, maxScore = 0, totalCorrect = 0, totalWrong = 0, perfectScoreCount = 0;
            let studyToday = 0, studyWeek = 0, studyMonth = 0;
            let weeklyXP = 0, monthlyXP = 0;
            let progress7Days = 0, progress30Days = 0; // Simple diff mock
            let hardExamsCompleted = 0, quizHard = 0, quizExpert = 0;
            let totalExamsCompleted = 0;
            
            const now = Date.now();
            const dayMs = 86400000;

            history.forEach(h => {
                totalScore += h.score;
                if (h.score > maxScore) maxScore = h.score;
                totalCorrect += h.correct;
                totalWrong += h.wrong;
                if (h.score === 10) perfectScoreCount++;
                if (h.partName.includes('Đề PDF') || h.partName.includes('JSON')) totalExamsCompleted++;
                if (h.partName.toLowerCase().includes('khó') || h.partName.toLowerCase().includes('hard')) {
                    hardExamsCompleted++; quizHard++;
                }
                
                const hDate = new Date(h.timestamp).getTime();
                const diffDays = (now - hDate) / dayMs;
                const hXp = (h.score * 10) + (h.correct * 2) + Math.round(h.timeSec/60);
                
                if (diffDays <= 1) studyToday += h.timeSec;
                if (diffDays <= 7) { studyWeek += h.timeSec; weeklyXP += hXp; progress7Days += h.score; }
                if (diffDays <= 30) { studyMonth += h.timeSec; monthlyXP += hXp; progress30Days += h.score; }
            });

            const quizzesTaken = history.length;
            const avgScore = quizzesTaken ? totalScore / quizzesTaken : 0;
            const accuracy = (totalCorrect + totalWrong) > 0 ? (totalCorrect / (totalCorrect + totalWrong)) * 100 : 0;
            const hundredPercentCount = perfectScoreCount; // Mock
            const speed = quizzesTaken ? (studyTimeSec / (totalCorrect + totalWrong || 1)) : 0;
            
            const allTimeXP = Math.round((totalScore * 10) + (totalCorrect * 2) + (studyTimeSec / 60));
            const level = Math.floor(Math.sqrt(allTimeXP / 100)) + 1;
            const averageSessionTime = sessionCount ? studyTimeSec / sessionCount : 0;
            
            // Streak Calculation
            const dailyLog = getL('dailyLog', {});
            const sortedDates = Object.keys(dailyLog).sort((a,b) => new Date(b) - new Date(a));
            let streak = 0;
            let dCheck = new Date();
            for(let i=0; i<sortedDates.length; i++) {
                const ds = `${dCheck.getFullYear()}-${String(dCheck.getMonth()+1).padStart(2,'0')}-${String(dCheck.getDate()).padStart(2,'0')}`;
                if (dailyLog[ds]) { streak++; dCheck.setDate(dCheck.getDate() - 1); }
                else if (i===0) { dCheck.setDate(dCheck.getDate() - 1); i--; } // allow missing today
                else break;
            }

            const studyDays = Object.keys(dailyLog).length;
            const achievementCount = Math.floor(level / 2) + (perfectScoreCount > 0 ? 1 : 0);
            const badgeCount = Math.floor(achievementCount / 3);
            const rareBadges = Math.floor(badgeCount / 5);
            const missionCompleted = quizzesTaken * 2;
            const completionRate = Math.min(100, (totalCorrect / 300) * 100);

            return {
                totalScore: parseFloat(totalScore.toFixed(2)),
                avgScore: parseFloat(avgScore.toFixed(2)),
                maxScore: parseFloat(maxScore.toFixed(2)),
                quizzesTaken, totalExamsCompleted, studyTimeSec, streak, studyDays,
                accuracy: parseFloat(accuracy.toFixed(2)),
                totalCorrect, totalWrong, 
                speed: parseFloat(speed.toFixed(2)),
                xp: allTimeXP, level, badgeCount, achievementCount,
                completionRate: parseFloat(completionRate.toFixed(2)),
                quizHard, quizEasy: quizzesTaken - quizHard, quizMedium: Math.floor(quizzesTaken/3), quizExpert,
                progress7Days: parseFloat((progress7Days / (quizzesTaken||1)).toFixed(2)),
                progress30Days: parseFloat((progress30Days / (quizzesTaken||1)).toFixed(2)),
                studyToday, studyWeek, studyMonth, sessionCount, 
                averageSessionTime: Math.round(averageSessionTime),
                hardExamsCompleted, perfectScoreCount, hundredPercentCount, rareBadges,
                totalAchievements: achievementCount, missionCompleted,
                weeklyXP, monthlyXP, allTimeXP
            };
        },

        async syncData() {
            if (typeof AuthManager === 'undefined' || !AuthManager.currentUser) return;
            const user = AuthManager.currentUser;
            const newStats = this.calculateLocalStats();
            
            try {
                // Fetch current doc to prevent overwriting loginCount and joinedAt
                const docRef = fbDb.collection('leaderboard').doc(user.uid);
                const docSnap = await docRef.get();
                
                let loginCount = 1;
                let joinedAt = new Date().toISOString();
                
                if (docSnap.exists) {
                    const data = docSnap.data();
                    // Increment login count loosely if we want, but syncing every finishQuiz shouldn't increment login.
                    // We only increment login on AuthManager.grantAccess
                    loginCount = data.loginCount || 1;
                    if (this._isLoginTrigger) {
                        loginCount += 1;
                        this._isLoginTrigger = false;
                    }
                    joinedAt = data.joinedAt || joinedAt;
                }

                await docRef.set({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || user.email.split('@')[0],
                    photoURL: user.photoURL || '',
                    ...newStats, // Merge 40 stats
                    loginCount,
                    joinedAt,
                    lastActive: new Date().toISOString(),
                    lastUpdatedHOF: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
            } catch (e) {
                console.error("[HOF] Sync Error:", e);
            }
        },

        async loadData() {
            const tbody = document.getElementById('hofTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu HOF...</td></tr>';
            
            await this.syncData();

            try {
                // Fetch ALL to allow client side dynamic sorting across 40 metrics
                const snap = await fbDb.collection('leaderboard').get();
                this.usersData = snap.docs.map(doc => doc.data());
                this.renderDashboard();
                this.renderTable();
            } catch (e) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding: 30px;">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
            }
        },

        formatValue(val, format) {
            if (val === undefined || val === null) val = 0;
            switch(format) {
                case 'score': return parseFloat(val).toFixed(2);
                case 'time': 
                case 'time_reverse':
                    return typeof Utils !== 'undefined' ? Utils.formatSecToClock(val) : `${Math.floor(val/60)}:${String(val%60).padStart(2,'0')}`;
                case 'days': return `${val} ngày`;
                case 'percent': return `${val}%`;
                case 'date': 
                case 'date_reverse':
                    if (!val) return '—';
                    try { return new Date(val).toLocaleDateString('vi-VN'); } catch(e) { return val; }
                case 'number_reverse':
                case 'number':
                default:
                    return val.toLocaleString('vi-VN');
            }
        },

        renderDashboard() {
            const dashEl = document.getElementById('hofDashboardTop');
            if (!dashEl || !this.usersData.length) return;
            
            const totalUsers = this.usersData.length;
            const topUser = [...this.usersData].sort((a,b) => (b.xp || 0) - (a.xp || 0))[0];
            const maxScoreUser = [...this.usersData].sort((a,b) => (b.maxScore || 0) - (a.maxScore || 0))[0];
            const totalHours = this.usersData.reduce((sum, u) => sum + (u.studyTimeSec || 0), 0) / 3600;
            const maxStreakUser = [...this.usersData].sort((a,b) => (b.streak || 0) - (a.streak || 0))[0];
            const totalExams = this.usersData.reduce((sum, u) => sum + (u.totalExamsCompleted || 0), 0);

            const cards = [
                { icon: 'fa-users', color: 'linear-gradient(135deg,#1478d4,#22d3ee)', val: totalUsers, label: 'Tổng số học viên' },
                { icon: 'fa-crown', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)', val: topUser ? topUser.displayName.split(' ')[0] : '—', label: 'Người đứng đầu' },
                { icon: 'fa-star', color: 'linear-gradient(135deg,#ef4444,#dc2626)', val: maxScoreUser ? maxScoreUser.maxScore : 0, label: 'Điểm cao nhất' },
                { icon: 'fa-clock', color: 'linear-gradient(135deg,#16c784,#0e9d68)', val: `${totalHours.toFixed(1)}h`, label: 'Tổng giờ học' },
                { icon: 'fa-fire', color: 'linear-gradient(135deg,#f97316,#ea580c)', val: maxStreakUser ? `${maxStreakUser.streak} ngày` : '0', label: 'Chuỗi dài nhất' },
                { icon: 'fa-layer-group', color: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', val: totalExams, label: 'Tổng số đề hoàn thành' }
            ];

            dashEl.innerHTML = cards.map(c => `
                <div class="hof-dash-card">
                    <div class="hof-dash-icon" style="background:${c.color}"><i class="fa-solid ${c.icon}"></i></div>
                    <div class="hof-dash-info">
                        <b>${Utils.escapeHtml(String(c.val))}</b>
                        <span>${c.label}</span>
                    </div>
                </div>
            `).join('');
        },

        renderTable() {
            const tbody = document.getElementById('hofTableBody');
            const header = document.getElementById('hofValueHeader');
            if (!tbody || !this.usersData.length) return;

            const metric = METRICS_CONFIG[this.currentMetricId];
            header.innerHTML = `${metric.name.split('. ')[1]} <i class="fa-solid ${metric.icon}"></i>`;

            // Sort Logic based on format (reverse means smaller is better, or older date is better)
            const sortedList = [...this.usersData].sort((a, b) => {
                let valA = a[this.currentMetricId]; let valB = b[this.currentMetricId];
                if (metric.format.includes('date')) {
                    valA = valA ? new Date(valA).getTime() : 0;
                    valB = valB ? new Date(valB).getTime() : 0;
                } else {
                    valA = valA || 0; valB = valB || 0;
                }
                
                if (metric.format.includes('reverse')) return valA - valB;
                return valB - valA;
            });

            const currentUid = (typeof AuthManager !== 'undefined' && AuthManager.currentUser) ? AuthManager.currentUser.uid : null;

            tbody.innerHTML = sortedList.map((user, index) => {
                let rankClass = 'hof-top-n';
                let rankHtml = index + 1;
                let avatarGlow = '';

                if (index === 0) { rankClass = 'hof-top-1'; rankHtml = '1'; avatarGlow = 'glow-1'; }
                else if (index === 1) { rankClass = 'hof-top-2'; rankHtml = '🥈'; avatarGlow = 'glow-2'; }
                else if (index === 2) { rankClass = 'hof-top-3'; rankHtml = '🥉'; avatarGlow = 'glow-3'; }

                const isMe = currentUid === user.uid;
                const trStyle = isMe ? 'background: rgba(20, 120, 212, 0.05); border-left: 4px solid var(--accent);' : '';
                
                // Colorize the title tag based on rank
                let tagBg = 'rgba(20,120,212,.1)'; let tagColor = 'var(--blue-600)';
                if (index === 0) { tagBg = '#fef3c7'; tagColor = '#b45309'; }

                return `
                    <tr style="${trStyle}">
                        <td style="text-align:center;">
                            <div class="hof-rank-box ${rankClass}">${rankHtml}</div>
                        </td>
                        <td>
                            <div class="hof-user-cell">
                                <img src="${user.photoURL || 'https://via.placeholder.com/42'}" class="hof-avatar ${avatarGlow}">
                                <div>
                                    <div class="hof-user-name">
                                        ${Utils.escapeHtml(user.displayName)}
                                        ${isMe ? '<span style="font-size:10px; background:var(--success); color:#fff; padding:2px 6px; border-radius:10px;">BẠN</span>' : ''}
                                    </div>
                                    <div class="hof-user-email">${Utils.escapeHtml(user.email)}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="hof-title-tag" style="background:${tagBg}; color:${tagColor};">
                                <i class="fa-solid ${metric.icon}"></i> ${metric.title}
                            </div>
                        </td>
                        <td style="text-align: right; font-weight: 800; font-size: 15px; color: var(--accent);">
                            ${this.formatValue(user[this.currentMetricId], metric.format)}
                        </td>
                        <td style="text-align:center;">
                            <div class="hof-level-badge">Lv.${user.level || 1}</div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    };

    // 4. MONKEY PATCHING ĐỂ HOOK VÀO HỆ THỐNG GỐC
    const observer = setInterval(() => {
        if (typeof UIManager !== 'undefined' && typeof AuthManager !== 'undefined' && typeof QuizManager !== 'undefined') {
            clearInterval(observer);
            
            // 4.1. Khai báo title cho UIManager
            UIManager.titles.halloffame = ['👑 Hall Of Fame', 'Bảng xếp hạng toàn diện của toàn bộ học viên'];
            
            // 4.2. Hook UIManager.navigate
            const _origNavigate = UIManager.navigate.bind(UIManager);
            UIManager.navigate = function(view) {
                const result = _origNavigate(view);
                if (view === 'halloffame') {
                    // Xóa các active view cũ để tránh đụng độ
                    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                    const target = document.getElementById('view-halloffame');
                    if (target) target.classList.add('active');
                    
                    HallOfFameManager.loadData();
                } else {
                    const target = document.getElementById('view-halloffame');
                    if (target) target.classList.remove('active');
                }
                return result;
            };

            // 4.3. Hook AuthManager.grantAccess
            const _origGrantAccess = AuthManager.grantAccess.bind(AuthManager);
            AuthManager.grantAccess = function(user) {
                _origGrantAccess(user);
                if (!HallOfFameManager.initialized) {
                    HallOfFameManager.injectDOM();
                    HallOfFameManager.initialized = true;
                }
                // Flag to increment login count once per session
                HallOfFameManager._isLoginTrigger = true;
                HallOfFameManager.syncData();
            };
            
            // 4.4. Hook QuizManager.finishQuiz
            const _origFinishQuiz = QuizManager.finishQuiz.bind(QuizManager);
            QuizManager.finishQuiz = function() {
                _origFinishQuiz();
                HallOfFameManager.syncData();
            };

            // 4.5. Hook PdfExamManager.submit
            if (typeof PdfExamManager !== 'undefined' && PdfExamManager.submit) {
                const _origPdfSubmit = PdfExamManager.submit.bind(PdfExamManager);
                PdfExamManager.submit = function() {
                    _origPdfSubmit();
                    HallOfFameManager.syncData();
                };
            }
        }
    }, 100);

})();
