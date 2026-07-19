/**
 * essay-grader.js
 * ============================================================================
 * MODULE "CHẤM BÀI LUẬN AI" — tích hợp thành 1 TAB MỚI trong sidebar của app.
 * Chỉ cần thêm 1 dòng duy nhất vào cuối <body>, TRƯỚC thẻ </body>, SAU toàn
 * bộ script hiện có của trang (để fbDb / fbAuth / AuthManager / UIManager đã
 * tồn tại khi module này chạy):
 *
 *   <script src="essay-grader.js"></script>
 *
 * LUỒNG HOẠT ĐỘNG
 * ----------------------------------------------------------------------------
 * 1. Học viên vào tab "Chấm bài luận AI" → upload đề/rubric/đáp án/bài mẫu/bài
 *    làm → bấm "Chấm bài ngay" → AI (Claude) chấm và phân tích.
 * 2. Học viên bấm "Gửi bài cho Admin" → bài làm + kết quả AI được lưu lên
 *    Firestore (collection "essaySubmissions"), trạng thái "pending".
 * 3. Admin (tài khoản có role=admin trong collection "allowedUsers", giống hệ
 *    thống hiện tại của app) vào cùng tab, thấy thêm mục "Duyệt bài học viên"
 *    — danh sách realtime tất cả bài đã nộp, xem lại bài + nhận xét của AI,
 *    viết nhận xét riêng, bấm "Gửi nhận xét".
 * 4. Học viên xem lại ở mục "Bài đã nộp của tôi" — thấy nhận xét của Admin
 *    xuất hiện realtime (không cần tải lại trang) nhờ Firestore onSnapshot.
 *
 * YÊU CẦU BẮT BUỘC VỀ FIRESTORE SECURITY RULES
 * ----------------------------------------------------------------------------
 * Module dùng 1 collection mới "essaySubmissions". Cần thêm rule tương ứng
 * (điều chỉnh theo cách app hiện xác định admin — ở đây minh hoạ bằng cách
 * đọc collection "allowedUsers" giống các rule khác của app):
 *
 *   match /essaySubmissions/{submissionId} {
 *     function isSignedIn() { return request.auth != null; }
 *     function isAdmin() {
 *       return isSignedIn() &&
 *         get(/databases/$(database)/documents/allowedUsers/$(request.auth.token.email.lower())).data.role == 'admin';
 *     }
 *     allow create: if isSignedIn() && request.resource.data.studentUid == request.auth.uid;
 *     allow read:   if isSignedIn() && (resource.data.studentUid == request.auth.uid || isAdmin());
 *     allow update: if isSignedIn() && isAdmin();
 *     allow delete: if false;
 *   }
 *
 * Nếu rule "isAdmin()" ở trên không khớp với cách project đã cấu hình sẵn,
 * hãy thay bằng đúng hàm/kiểm tra admin mà các collection khác (vd
 * "sharedQuestionBank", "sharedCustomExams") của app đang dùng.
 *
 * CẢNH BÁO BẢO MẬT (API KEY)
 * ----------------------------------------------------------------------------
 * Việc chấm bài (bước AI) gọi thẳng Anthropic API từ trình duyệt bằng API key
 * do người dùng tự nhập — key có thể bị xem qua DevTools trên máy của họ. Phù
 * hợp cho dùng nội bộ/lớp học nhỏ. Nếu cần an toàn hơn cho quy mô lớn, hãy đổi
 * CONFIG.apiEndpoint bên dưới sang một backend proxy riêng của bạn.
 * ============================================================================
 */
(function (global, document) {
  "use strict";

  if (global.__essayGraderMounted) return;
  global.__essayGraderMounted = true;

  // ==========================================================================
  // 0. CẤU HÌNH
  // ==========================================================================
  const CONFIG = {
    apiEndpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-5",
    maxTokens: 8000,
    storageKeyApiKey: "essayGrader.apiKey",
    storageKeyModel: "essayGrader.model",
    maxScoreDefault: 10,
    firestoreCollection: "essaySubmissions",
    maxDocBytes: 900000, // Firestore giới hạn ~1MB/document, chừa biên an toàn
  };

  const VIEW_ID = "essayGrader";
  const NAV_TITLE = "Chấm bài luận AI";
  const NAV_SUB = "Upload đề, rubric, đáp án, bài mẫu và bài làm để AI chấm điểm, phân tích chi tiết";

  // ==========================================================================
  // 1. SYSTEM PROMPT CHO AI CHẤM BÀI
  // ==========================================================================
  const SYSTEM_PROMPT = `
ROLE
Bạn là một hệ thống AI đa tác nhân (Multi-Agent AI System) gồm các vai trò hoạt động đồng thời:
- Senior Full Stack Developer
- Software Architect
- Senior Front-end Engineer
- AI Engineer
- Prompt Engineer
- NLP Engineer
- Data Engineer
- Information Retrieval Engineer
- Academic Writing Expert
- University Lecturer
- Thesis Examiner
- Essay Grading Expert
- Proofreading Expert
- Academic Editor
- UX/UI Expert
Mọi agent phải phối hợp để đưa ra duy nhất một kết quả cuối cùng.

PRIMARY OBJECTIVE
Bạn là AI dùng để huấn luyện và chấm bài luận. Bạn KHÔNG phải chatbot, KHÔNG trả lời
kiến thức chung, KHÔNG được suy luận ngoài dữ liệu. Bạn chỉ được sử dụng: Knowledge Base,
Rubric, Assignment, Answer Key, Example Essays, Teacher Instructions do người dùng cung cấp.
Nếu dữ liệu không tồn tại, ghi rõ: "Không có căn cứ trong dữ liệu nguồn."

ABSOLUTE RULES
- Knowledge Restriction: chỉ dùng dữ liệu đã upload, không dùng kiến thức nền, internet,
  trí nhớ mô hình, dữ liệu huấn luyện hay suy luận cá nhân. Không đoán, không tự tạo,
  không bổ sung, không giả định khi thiếu dữ liệu.
- Evidence First: mọi đánh giá phải có căn cứ theo chuỗi Tiêu chí Rubric -> Đoạn bài ->
  Giải thích -> Điểm -> Đề xuất. Không nhận xét cảm tính.
- Rubric Strict Mode: chỉ chấm theo Rubric, không cộng/trừ điểm ngoài Rubric, không bỏ
  sót tiêu chí, không thay đổi trọng số.
- Academic Integrity: không thay đổi quan điểm tác giả, không thêm lập luận mới, không
  thêm dẫn chứng/số liệu/tài liệu tham khảo mới, không thêm kiến thức ngoài dữ liệu nguồn.
- Hallucination Guard: nếu không tìm thấy căn cứ, phải ghi rõ "Không có căn cứ trong dữ
  liệu nguồn." và không được suy diễn.

REQUIRED WORKFLOW (bắt buộc thực hiện tuần tự, không bỏ qua bước nào)
Phase 1: Đọc Assignment. Phase 2: Đọc Rubric. Phase 3: Đọc Answer Key.
Phase 4: Đọc toàn bộ Example Essays. Phase 5: Đọc Teacher Instructions.
Phase 6: Đọc toàn bộ Knowledge Base. Phase 7: Xây dựng tiêu chí chấm.
Phase 8: Đọc bài sinh viên. Phase 9: Đối chiếu từng tiêu chí. Phase 10: Chấm điểm.
Phase 11: Phân tích. Phase 12: Biên tập học thuật. Phase 13: Sinh JSON.

ANALYSIS LEVELS
- Essay Level: cấu trúc, logic, học thuật, lập luận, tính đầy đủ, độ bao phủ Rubric.
- Paragraph Level: mỗi đoạn cần score, strengths, weaknesses, missing ideas, redundant
  ideas, transitions, coherence, academic quality, và một Improved Paragraph giữ nguyên
  ý, không thêm dữ liệu mới, kèm giải thích vì sao tốt hơn.
- Sentence Level: mỗi câu cần Original, Evaluation, Severity, Issues, Evidence, Reason,
  Suggested Rewrite, Rewrite Reason, Confidence Score, Rubric Reference.
- Word Level: phát hiện lặp từ, sai thuật ngữ, khẩu ngữ, từ yếu, từ không học thuật.
- Grammar: grammar, punctuation, tense, agreement, article, preposition.
- Style: repetition, redundancy, vague wording, weak verbs, câu quá dài/ngắn, chuyển ý kém,
  văn phong khẩu ngữ.
- Logic: contradiction, unsupported claim, missing evidence, weak reasoning, circular
  reasoning, inconsistent argument.

EDIT LEVEL
- Light: chỉ sửa chính tả, ngữ pháp, dấu câu, typo. Không thay đổi cấu trúc.
- Medium: thêm cải thiện diễn đạt, chuyển ý, mạch lạc, tránh lặp từ, tăng tính học thuật,
  vẫn giữ nguyên cấu trúc bài.
- Advanced: viết lại theo văn phong học thuật, tối ưu lập luận/logic/tính học thuật/liên
  kết, NHƯNG không đổi ý, không đổi quan điểm, không thêm dữ liệu, không thêm kiến thức
  ngoài nguồn.

REWRITE FORMAT
Mỗi đề xuất chỉnh sửa phải gồm: Original -> Rewrite -> Improvement Summary -> Reason ->
Affected Rubric -> Confidence.

FINAL SUMMARY
Cuối bài phải tổng hợp: 10 strengths, 10 weaknesses, 10 priorities, 10 practice
suggestions, và Reading list (nếu có trong Knowledge Base).

OUTPUT FORMAT — BẮT BUỘC
Chỉ trả lời bằng DUY NHẤT một object JSON hợp lệ, không kèm lời dẫn, không kèm markdown
code fence, không kèm giải thích nào khác ngoài JSON, đúng theo schema sau. "maxScore" của
totalScore và của mỗi phần tử trong "criteria" mặc định là thang điểm được nêu trong Rubric;
nếu Rubric không nêu, dùng thang 10.

{
  "totalScore": 0,
  "maxScore": 10,
  "summary": "",
  "criteria": [
    { "name": "", "weight": 0, "maxScore": 10, "score": 0, "evidence": "", "comment": "" }
  ],
  "sentenceAnalysis": [
    { "original": "", "evaluation": "", "severity": "", "issues": [], "evidence": "",
      "reason": "", "rewrite": "", "rewriteReason": "", "rubricReference": "", "confidence": 0 }
  ],
  "paragraphAnalysis": [
    { "original": "", "score": 0, "strengths": [], "weaknesses": [], "missingIdeas": [],
      "redundantIdeas": [], "coherence": 0, "academicLevel": "", "rewrite": "",
      "rewriteReason": "", "confidence": 0 }
  ],
  "grammarErrors": [{ "text": "", "issue": "", "suggestion": "" }],
  "spellingErrors": [{ "text": "", "issue": "", "suggestion": "" }],
  "logicErrors": [{ "text": "", "issue": "", "explanation": "" }],
  "styleIssues": [{ "text": "", "issue": "", "suggestion": "" }],
  "academicSuggestions": [],
  "rewrittenEssay": { "editLevel": "Light", "content": "" },
  "statistics": {
    "words": 0, "sentences": 0, "paragraphs": 0, "grammarErrors": 0, "spellingErrors": 0,
    "styleIssues": 0, "academicLevel": "", "coherenceScore": 0, "rubricCoverage": 0
  },
  "finalSummary": {
    "strengths": [], "weaknesses": [], "priorities": [], "practiceSuggestions": [],
    "readingList": []
  }
}
`.trim();

  // ==========================================================================
  // 2. ĐỌC FILE (txt/md/csv/json/html trực tiếp; pdf/docx cần thư viện ngoài)
  // ==========================================================================
  const TEXT_EXTENSIONS = ["txt", "md", "markdown", "csv", "json", "html", "htm"];

  function getExtension(filename) {
    const parts = filename.split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }
  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Không đọc được file: " + file.name));
      reader.readAsText(file);
    });
  }
  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Không đọc được file: " + file.name));
      reader.readAsArrayBuffer(file);
    });
  }
  async function readPdf(file) {
    if (!global.pdfjsLib) {
      throw new Error(
        `File "${file.name}" là PDF nhưng trang chưa nhúng pdf.js. Thêm ` +
        `<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script> ` +
        `trước thẻ script của essay-grader.js, hoặc dùng file .txt/.docx.`
      );
    }
    const buffer = await readAsArrayBuffer(file);
    const pdf = await global.pdfjsLib.getDocument({ data: buffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n\n";
    }
    return text.trim();
  }
  async function readDocx(file) {
    if (!global.mammoth) {
      throw new Error(
        `File "${file.name}" là DOCX nhưng trang chưa nhúng mammoth.js. Thêm ` +
        `<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js"></script> ` +
        `trước thẻ script của essay-grader.js, hoặc dùng file .txt.`
      );
    }
    const buffer = await readAsArrayBuffer(file);
    const result = await global.mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }
  async function extractFileContent(file) {
    const ext = getExtension(file.name);
    if (TEXT_EXTENSIONS.includes(ext)) return readAsText(file);
    if (ext === "pdf") return readPdf(file);
    if (ext === "docx") return readDocx(file);
    throw new Error(`Định dạng ".${ext}" (${file.name}) chưa được hỗ trợ đọc trực tiếp.`);
  }
  function computeStatistics(text) {
    const trimmed = (text || "").trim();
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const sentences = trimmed ? (trimmed.match(/[^.!?…]+[.!?…]+/g) || [trimmed]).length : 0;
    const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
    return { words, sentences, paragraphs };
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function formatDate(ts) {
    try {
      const d = ts && typeof ts.toDate === "function" ? ts.toDate() : ts instanceof Date ? ts : null;
      if (!d) return "-";
      return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "-";
    }
  }

  // ==========================================================================
  // 3. GỌI AI CHẤM BÀI
  // ==========================================================================
  class EssayGraderEngine {
    constructor({ apiKey, model }) {
      this.apiKey = apiKey;
      this.model = model || CONFIG.defaultModel;
    }
    _normalize(input) {
      if (!input) return "";
      if (typeof input === "string") return input;
      if (Array.isArray(input)) return input.filter(Boolean).map((i) => this._normalize(i)).join("\n\n---\n\n");
      if (input.content) return `[Tên file: ${input.name || "không rõ"}]\n${input.content}`;
      return "";
    }
    _buildUserPrompt(inputs) {
      const section = (title, value) => {
        const n = this._normalize(value);
        return `### ${title}\n${n || "(không có dữ liệu)"}\n`;
      };
      return [
        section("ASSIGNMENT (Đề bài)", inputs.assignment),
        section("RUBRIC (Tiêu chí chấm)", inputs.rubric),
        section("ANSWER KEY (Đáp án)", inputs.answerKey),
        section("EXAMPLE ESSAYS (Bài mẫu tham khảo)", inputs.exampleEssays),
        section("TEACHER INSTRUCTIONS (Hướng dẫn giáo viên)", inputs.teacherInstructions),
        section("KNOWLEDGE BASE (Tài liệu nền)", inputs.knowledgeBase),
        section("STUDENT ESSAY (Bài làm cần chấm)", inputs.studentEssay),
        `### EDIT LEVEL YÊU CẦU\n${inputs.editLevel || "Medium"}\n`,
        `\nHãy thực hiện đầy đủ REQUIRED WORKFLOW và trả về DUY NHẤT JSON theo đúng schema đã quy định. Không thêm bất kỳ văn bản nào ngoài JSON.`,
      ].join("\n");
    }
    async grade(inputs, onProgress) {
      const progress = typeof onProgress === "function" ? onProgress : () => {};
      if (!inputs.studentEssay) throw new Error("Thiếu bài làm của sinh viên.");
      if (!inputs.rubric) throw new Error("Thiếu Rubric (tiêu chí chấm).");
      progress("Đang đọc Assignment, Rubric, Answer Key, Bài mẫu, Knowledge Base...");
      const userPrompt = this._buildUserPrompt(inputs);
      progress("Đang gửi cho AI chấm bài (xây tiêu chí, đối chiếu, chấm điểm, phân tích)...");
      const raw = await this._call(userPrompt);
      progress("Đang phân tích kết quả trả về...");
      const result = this._parse(raw);
      const studentText = this._normalize(inputs.studentEssay);
      const offline = computeStatistics(studentText);
      result.statistics = {
        ...offline, ...result.statistics,
        words: result.statistics?.words || offline.words,
        sentences: result.statistics?.sentences || offline.sentences,
        paragraphs: result.statistics?.paragraphs || offline.paragraphs,
      };
      progress("Hoàn tất.");
      return result;
    }
    async _call(userPrompt) {
      const res = await fetch(CONFIG.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: this.model, max_tokens: CONFIG.maxTokens, system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Lỗi gọi API (HTTP ${res.status}): ${body || res.statusText}`);
      }
      const data = await res.json();
      const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
      if (!text) throw new Error("AI không trả về nội dung.");
      return text;
    }
    _parse(text) {
      let cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
      if (a !== -1 && b !== -1 && b > a) cleaned = cleaned.slice(a, b + 1);
      try { return JSON.parse(cleaned); }
      catch (err) { throw new Error("Không phân tích được JSON từ AI: " + err.message); }
    }
  }

  // ==========================================================================
  // 4. TÍCH HỢP FIRESTORE — NỘP BÀI CHO ADMIN / DUYỆT / GỬI NHẬN XÉT
  // ==========================================================================
  function firestoreReady() {
    return !!(global.fbDb && global.firebase && global.firebase.firestore);
  }

  function currentAuthUser() {
    return global.AuthManager && global.AuthManager.currentUser ? global.AuthManager.currentUser : null;
  }

  function isCurrentUserAdmin() {
    return !!(global.AuthManager && typeof global.AuthManager.isAdmin === "function" && global.AuthManager.isAdmin());
  }

  async function submitToAdmin(payload) {
    if (!firestoreReady()) throw new Error("Chưa kết nối được Firestore.");
    const user = currentAuthUser();
    if (!user) throw new Error("Bạn cần đăng nhập để nộp bài cho Admin.");

    const docData = {
      studentUid: user.uid,
      studentEmail: user.email || "",
      studentName: user.displayName || user.email || "Học viên",
      studentAvatar: user.photoURL || "",
      assignmentName: payload.assignmentName || "",
      studentEssayName: payload.studentEssayName || "",
      studentEssayContent: payload.studentEssayContent || "",
      aiResult: payload.aiResult || null,
      status: "pending",
      adminFeedback: "",
      adminScore: null,
      submittedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedByUid: null,
      reviewedByName: null,
    };

    const approxBytes = new Blob([JSON.stringify(docData)]).size;
    if (approxBytes > CONFIG.maxDocBytes) {
      throw new Error("Bài làm + kết quả AI quá lớn để gửi (vượt giới hạn ~1MB của Firestore). Hãy rút gọn bài làm hoặc số lượng bài mẫu/knowledge base trước khi chấm.");
    }

    return global.fbDb.collection(CONFIG.firestoreCollection).add(docData);
  }

  function listenMySubmissions(onChange, onError) {
    if (!firestoreReady()) return () => {};
    const user = currentAuthUser();
    if (!user) return () => {};
    return global.fbDb.collection(CONFIG.firestoreCollection)
      .where("studentUid", "==", user.uid)
      .orderBy("submittedAt", "desc")
      .onSnapshot(
        (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => { console.error("[essay-grader] listenMySubmissions:", err); if (onError) onError(err); }
      );
  }

  function listenAllSubmissions(onChange, onError) {
    if (!firestoreReady()) return () => {};
    return global.fbDb.collection(CONFIG.firestoreCollection)
      .orderBy("submittedAt", "desc")
      .onSnapshot(
        (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => { console.error("[essay-grader] listenAllSubmissions:", err); if (onError) onError(err); }
      );
  }

  async function sendFeedback(submissionId, feedbackText, adminScore) {
    if (!firestoreReady()) throw new Error("Chưa kết nối được Firestore.");
    const user = currentAuthUser();
    if (!user) throw new Error("Bạn cần đăng nhập.");
    return global.fbDb.collection(CONFIG.firestoreCollection).doc(submissionId).update({
      status: "reviewed",
      adminFeedback: feedbackText || "",
      adminScore: (adminScore === "" || adminScore == null || isNaN(adminScore)) ? null : Number(adminScore),
      reviewedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
      reviewedByUid: user.uid,
      reviewedByName: user.displayName || user.email || "Admin",
    });
  }

  // ==========================================================================
  // 5. CSS
  // ==========================================================================
  const STYLE = `
  #essay-grader-widget * { box-sizing: border-box; }
  #essay-grader-widget {
    --eg-accent: var(--accent, #1478d4);
    --eg-accent-2: var(--accent-2, #06b6d4);
    --eg-card-bg: var(--card-bg-solid, #ffffff);
    --eg-card-border: var(--card-border, rgba(20,120,212,0.14));
    --eg-text: var(--text-main, #0b1f33);
    --eg-text-muted: var(--text-muted, #5c7590);
    --eg-radius-md: var(--radius-md, 16px);
    --eg-radius-sm: var(--radius-sm, 10px);
    --eg-shadow: var(--shadow-md, 0 8px 24px rgba(10,74,138,0.12));
    --eg-success: var(--success, #16c784);
    --eg-danger: var(--danger, #ef4444);
    --eg-warning: var(--warning, #f59e0b);
    font-family: 'Inter', system-ui, sans-serif;
    color: var(--eg-text);
  }
  #essay-grader-widget .eg-header { margin-bottom: 20px; }
  #essay-grader-widget .eg-header h2 { font-size: 22px; font-weight: 800; margin: 0 0 4px; display:flex; align-items:center; gap:10px;}
  #essay-grader-widget .eg-header p { font-size: 13px; color: var(--eg-text-muted); margin: 0; }
  #essay-grader-widget .eg-card {
    background: var(--eg-card-bg); border: 1px solid var(--eg-card-border);
    border-radius: var(--eg-radius-md); box-shadow: var(--eg-shadow);
    padding: 20px; margin-bottom: 18px;
  }
  #essay-grader-widget .eg-card h3 { font-size: 15px; font-weight: 700; margin: 0 0 14px; display:flex; align-items:center; gap:8px;}
  #essay-grader-widget .eg-config-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
  #essay-grader-widget .eg-field { display:flex; flex-direction:column; gap:6px; flex:1; min-width:180px; }
  #essay-grader-widget .eg-field label { font-size:11.5px; font-weight:700; color:var(--eg-text-muted); text-transform:uppercase; letter-spacing:.4px;}
  #essay-grader-widget input[type=text], #essay-grader-widget input[type=password], #essay-grader-widget input[type=number],
  #essay-grader-widget select, #essay-grader-widget textarea {
    border: 1.5px solid var(--eg-card-border); border-radius: var(--eg-radius-sm);
    padding: 9px 12px; font-size: 13px; font-family: inherit; color: var(--eg-text);
    background: transparent; width: 100%;
  }
  #essay-grader-widget input:focus, #essay-grader-widget select:focus, #essay-grader-widget textarea:focus {
    outline: none; border-color: var(--eg-accent); box-shadow: 0 0 0 3px rgba(20,120,212,.15);
  }
  #essay-grader-widget .eg-hint { font-size:11px; color: var(--eg-text-muted); margin-top:6px; }
  #essay-grader-widget .eg-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px,1fr)); gap:14px; }
  #essay-grader-widget .eg-drop {
    border: 1.5px dashed var(--eg-card-border); border-radius: var(--eg-radius-sm);
    padding: 16px; text-align:center; cursor:pointer; transition:.2s; position:relative;
    background: rgba(20,120,212,.03);
  }
  #essay-grader-widget .eg-drop:hover, #essay-grader-widget .eg-drop.eg-drag { border-color: var(--eg-accent); background: rgba(20,120,212,.08); }
  #essay-grader-widget .eg-drop input[type=file] { position:absolute; inset:0; opacity:0; cursor:pointer; }
  #essay-grader-widget .eg-drop .eg-drop-icon { font-size:20px; color: var(--eg-accent); margin-bottom:6px;}
  #essay-grader-widget .eg-drop .eg-drop-title { font-size:12.5px; font-weight:700; }
  #essay-grader-widget .eg-drop .eg-drop-sub { font-size:11px; color:var(--eg-text-muted); margin-top:2px;}
  #essay-grader-widget .eg-drop .eg-drop-tag { font-size:10px; color:var(--eg-text-muted); }
  #essay-grader-widget .eg-drop.eg-required .eg-drop-title::after { content:" *"; color: var(--eg-danger); }
  #essay-grader-widget .eg-filelist { margin-top:8px; display:flex; flex-direction:column; gap:4px; text-align:left; }
  #essay-grader-widget .eg-file-chip {
    display:flex; align-items:center; justify-content:space-between; gap:6px;
    font-size:11.5px; background: rgba(20,120,212,.08); color: var(--eg-accent);
    border-radius: 8px; padding: 4px 8px;
  }
  #essay-grader-widget .eg-file-chip button { color: var(--eg-danger); font-size:13px; line-height:1; }
  #essay-grader-widget .eg-btn {
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    border-radius: var(--eg-radius-sm); padding: 11px 22px; font-weight:700; font-size:13.5px;
    cursor:pointer; border:none; transition:.2s;
  }
  #essay-grader-widget .eg-btn-primary {
    background: linear-gradient(135deg, var(--eg-accent), var(--eg-accent-2)); color:#fff;
    box-shadow: 0 8px 20px rgba(20,120,212,.28); width:100%;
  }
  #essay-grader-widget .eg-btn-secondary {
    background: rgba(20,120,212,.1); color: var(--eg-accent); width:auto;
  }
  #essay-grader-widget .eg-btn-success {
    background: linear-gradient(135deg, var(--eg-success), #0ea968); color:#fff; width:auto;
  }
  #essay-grader-widget .eg-btn:disabled { opacity:.55; cursor:not-allowed; }
  #essay-grader-widget .eg-btn-primary:not(:disabled):hover, #essay-grader-widget .eg-btn-success:not(:disabled):hover { transform: translateY(-1px); }
  #essay-grader-widget .eg-progress-wrap { margin-top:14px; display:none; }
  #essay-grader-widget .eg-progress-wrap.eg-active { display:block; }
  #essay-grader-widget .eg-progress-bar { height:6px; border-radius:20px; background: rgba(20,120,212,.12); overflow:hidden; }
  #essay-grader-widget .eg-progress-fill {
    height:100%; width:30%; border-radius:20px;
    background: linear-gradient(90deg, var(--eg-accent), var(--eg-accent-2));
    animation: eg-indeterminate 1.3s ease-in-out infinite;
  }
  @keyframes eg-indeterminate { 0%{margin-left:-30%;} 100%{margin-left:100%;} }
  #essay-grader-widget .eg-progress-label { font-size:12px; color: var(--eg-text-muted); margin-top:6px; }
  #essay-grader-widget .eg-error {
    margin-top:12px; padding:10px 14px; border-radius: var(--eg-radius-sm);
    background: rgba(239,68,68,.09); color: var(--eg-danger); font-size:12.5px; display:none;
  }
  #essay-grader-widget .eg-error.eg-active { display:block; }
  #essay-grader-widget .eg-toast {
    margin-top:12px; padding:10px 14px; border-radius: var(--eg-radius-sm);
    background: rgba(22,199,132,.1); color: var(--eg-success); font-size:12.5px; display:none;
  }
  #essay-grader-widget .eg-toast.eg-active { display:block; }
  #essay-grader-widget .eg-results-wrap { display:none; margin-top:18px; }
  #essay-grader-widget .eg-results-wrap.eg-active { display:block; }
  #essay-grader-widget .eg-score-row { display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  #essay-grader-widget .eg-gauge { flex-shrink:0; }
  #essay-grader-widget .eg-score-summary { flex:1; min-width:220px; font-size:13.5px; color: var(--eg-text); line-height:1.6; }
  #essay-grader-widget .eg-tabs { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1.5px solid var(--eg-card-border); margin-bottom:16px; }
  #essay-grader-widget .eg-tab {
    padding:9px 14px; font-size:12.5px; font-weight:700; color: var(--eg-text-muted);
    border-bottom:2px solid transparent; cursor:pointer; margin-bottom:-1.5px; white-space:nowrap;
    display:flex; align-items:center; gap:6px;
  }
  #essay-grader-widget .eg-tab.eg-active-tab { color: var(--eg-accent); border-color: var(--eg-accent); }
  #essay-grader-widget .eg-tabpanel { display:none; }
  #essay-grader-widget .eg-tabpanel.eg-active-panel { display:block; }
  #essay-grader-widget .eg-criteria-row { padding:10px 0; border-bottom:1px solid var(--eg-card-border); }
  #essay-grader-widget .eg-criteria-row:last-child { border-bottom:none; }
  #essay-grader-widget .eg-criteria-top { display:flex; justify-content:space-between; font-size:13px; font-weight:700; margin-bottom:6px;}
  #essay-grader-widget .eg-criteria-score { color: var(--eg-accent); }
  #essay-grader-widget .eg-bar-bg { height:7px; border-radius:20px; background: rgba(20,120,212,.12); overflow:hidden; margin-bottom:6px;}
  #essay-grader-widget .eg-bar-fill { height:100%; border-radius:20px; background: linear-gradient(90deg, var(--eg-accent), var(--eg-accent-2)); }
  #essay-grader-widget .eg-criteria-comment { font-size:12px; color: var(--eg-text-muted); }
  #essay-grader-widget .eg-item {
    border: 1px solid var(--eg-card-border); border-radius: var(--eg-radius-sm);
    padding: 12px 14px; margin-bottom:10px;
  }
  #essay-grader-widget .eg-item-top { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:6px; }
  #essay-grader-widget .eg-severity { font-size:10px; font-weight:800; padding:2px 8px; border-radius:99px; text-transform:uppercase; flex-shrink:0; }
  #essay-grader-widget .eg-severity-high { background: rgba(239,68,68,.12); color: var(--eg-danger); }
  #essay-grader-widget .eg-severity-medium { background: rgba(245,158,11,.14); color: var(--eg-warning); }
  #essay-grader-widget .eg-severity-low { background: rgba(22,199,132,.13); color: var(--eg-success); }
  #essay-grader-widget .eg-item-orig { font-size:13px; color: var(--eg-text); }
  #essay-grader-widget .eg-item-arrow { font-size:11px; color: var(--eg-text-muted); margin:6px 0; }
  #essay-grader-widget .eg-item-rewrite { font-size:13px; color: var(--eg-success); font-weight:600; }
  #essay-grader-widget .eg-item-reason { font-size:11.5px; color: var(--eg-text-muted); margin-top:6px; }
  #essay-grader-widget .eg-stat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px,1fr)); gap:12px; }
  #essay-grader-widget .eg-stat-box { text-align:center; padding:14px 8px; border-radius: var(--eg-radius-sm); background: rgba(20,120,212,.05); }
  #essay-grader-widget .eg-stat-num { font-size:22px; font-weight:800; color: var(--eg-accent); }
  #essay-grader-widget .eg-stat-label { font-size:10.5px; color: var(--eg-text-muted); font-weight:600; text-transform:uppercase; margin-top:2px;}
  #essay-grader-widget .eg-list { margin:0; padding-left:18px; font-size:12.5px; color: var(--eg-text); line-height:1.8; }
  #essay-grader-widget .eg-summary-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:16px; }
  #essay-grader-widget .eg-summary-box h4 { font-size:12.5px; margin:0 0 8px; font-weight:800; }
  #essay-grader-widget .eg-rewritten { white-space:pre-wrap; font-size:13px; line-height:1.7; color: var(--eg-text); }
  #essay-grader-widget .eg-empty { font-size:12.5px; color: var(--eg-text-muted); text-align:center; padding: 20px 0; }
  #essay-grader-widget .eg-maintabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
  #essay-grader-widget .eg-maintab {
    padding:10px 16px; border-radius: var(--eg-radius-sm); font-size:13px; font-weight:700;
    background: var(--eg-card-bg); border:1px solid var(--eg-card-border); color: var(--eg-text-muted);
    cursor:pointer; display:flex; align-items:center; gap:8px; transition:.15s;
  }
  #essay-grader-widget .eg-maintab.eg-active-maintab { background: linear-gradient(135deg, var(--eg-accent), var(--eg-accent-2)); color:#fff; border-color:transparent; }
  #essay-grader-widget .eg-maintab .eg-count {
    font-size:10.5px; font-weight:800; padding:1px 7px; border-radius:99px; background: rgba(0,0,0,.15);
  }
  #essay-grader-widget .eg-mainpanel { display:none; }
  #essay-grader-widget .eg-mainpanel.eg-active-mainpanel { display:block; }
  #essay-grader-widget .eg-sub-note { font-size:12.5px; color: var(--eg-text-muted); background: rgba(20,120,212,.06); border-radius: var(--eg-radius-sm); padding:10px 14px; margin-bottom:14px; }
  #essay-grader-widget .eg-submission-card {
    border:1px solid var(--eg-card-border); border-radius: var(--eg-radius-sm); padding:14px 16px; margin-bottom:12px; cursor:pointer; transition:.15s;
  }
  #essay-grader-widget .eg-submission-card:hover { border-color: var(--eg-accent); }
  #essay-grader-widget .eg-submission-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; }
  #essay-grader-widget .eg-submission-title { font-size:13.5px; font-weight:700; }
  #essay-grader-widget .eg-submission-meta { font-size:11.5px; color: var(--eg-text-muted); margin-top:3px; }
  #essay-grader-widget .eg-pill { font-size:10.5px; font-weight:800; padding:3px 10px; border-radius:99px; text-transform:uppercase; white-space:nowrap; }
  #essay-grader-widget .eg-pill-pending { background: rgba(245,158,11,.14); color: var(--eg-warning); }
  #essay-grader-widget .eg-pill-reviewed { background: rgba(22,199,132,.13); color: var(--eg-success); }
  #essay-grader-widget .eg-submission-feedback { margin-top:10px; padding:10px 12px; border-radius: var(--eg-radius-sm); background: rgba(22,199,132,.07); font-size:12.5px; }
  #essay-grader-widget .eg-back-btn { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color: var(--eg-accent); cursor:pointer; margin-bottom:14px; }
  #essay-grader-widget .eg-detail-student { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  #essay-grader-widget .eg-detail-student img { width:38px; height:38px; border-radius:50%; }
  #essay-grader-widget .eg-essay-box { white-space:pre-wrap; font-size:13px; line-height:1.7; max-height:340px; overflow:auto; padding:12px 14px; border:1px solid var(--eg-card-border); border-radius: var(--eg-radius-sm); background: rgba(20,120,212,.03); }
  #essay-grader-widget .eg-feedback-row { display:flex; gap:12px; flex-wrap:wrap; }
  `;

  // ==========================================================================
  // 6. GAUGE SVG
  // ==========================================================================
  function renderGauge(score, maxScore) {
    const pct = Math.max(0, Math.min(1, maxScore ? score / maxScore : 0));
    const size = 140, stroke = 12, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const offset = c * (1 - pct);
    const color = pct >= 0.8 ? "var(--eg-success)" : pct >= 0.5 ? "var(--eg-warning)" : "var(--eg-danger)";
    return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(20,120,212,.12)" stroke-width="${stroke}"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size/2} ${size/2})" style="transition: stroke-dashoffset 1s ease;"/>
      <text x="50%" y="47%" text-anchor="middle" font-size="28" font-weight="800" fill="var(--eg-text)" font-family="Inter,sans-serif">${score}</text>
      <text x="50%" y="63%" text-anchor="middle" font-size="12" fill="var(--eg-text-muted)" font-family="Inter,sans-serif">/ ${maxScore}</text>
    </svg>`;
  }

  // ==========================================================================
  // 7. RENDER HELPERS CHO TỪNG PHẦN KẾT QUẢ
  // ==========================================================================
  function severityClass(sev) {
    const s = (sev || "").toLowerCase();
    if (s.includes("cao") || s.includes("high") || s.includes("nặng")) return "eg-severity-high";
    if (s.includes("trung") || s.includes("medium")) return "eg-severity-medium";
    return "eg-severity-low";
  }
  function renderCriteria(criteria) {
    if (!criteria || !criteria.length) return `<div class="eg-empty">Không có dữ liệu tiêu chí.</div>`;
    return criteria.map((c) => {
      const max = c.maxScore || 10;
      const pct = max ? Math.min(100, (c.score / max) * 100) : 0;
      return `
      <div class="eg-criteria-row">
        <div class="eg-criteria-top"><span>${escapeHtml(c.name)}</span><span class="eg-criteria-score">${c.score ?? "-"} / ${max}</span></div>
        <div class="eg-bar-bg"><div class="eg-bar-fill" style="width:${pct}%"></div></div>
        ${c.evidence ? `<div class="eg-criteria-comment"><strong>Căn cứ:</strong> ${escapeHtml(c.evidence)}</div>` : ""}
        ${c.comment ? `<div class="eg-criteria-comment">${escapeHtml(c.comment)}</div>` : ""}
      </div>`;
    }).join("");
  }
  function renderSentences(items) {
    if (!items || !items.length) return `<div class="eg-empty">Không có dữ liệu.</div>`;
    return items.map((s) => `
      <div class="eg-item">
        <div class="eg-item-top">
          <div class="eg-item-orig">${escapeHtml(s.original)}</div>
          ${s.severity ? `<span class="eg-severity ${severityClass(s.severity)}">${escapeHtml(s.severity)}</span>` : ""}
        </div>
        ${s.evaluation ? `<div class="eg-item-reason">${escapeHtml(s.evaluation)}</div>` : ""}
        ${s.rewrite ? `<div class="eg-item-arrow">→ đề xuất chỉnh sửa</div><div class="eg-item-rewrite">${escapeHtml(s.rewrite)}</div>` : ""}
        ${s.rewriteReason ? `<div class="eg-item-reason">${escapeHtml(s.rewriteReason)}</div>` : ""}
        ${s.rubricReference ? `<div class="eg-item-reason"><strong>Rubric:</strong> ${escapeHtml(s.rubricReference)}</div>` : ""}
      </div>`).join("");
  }
  function renderParagraphs(items) {
    if (!items || !items.length) return `<div class="eg-empty">Không có dữ liệu.</div>`;
    return items.map((p) => `
      <div class="eg-item">
        <div class="eg-item-top"><strong>Điểm đoạn: ${p.score ?? "-"}</strong><span style="font-size:11px;color:var(--eg-text-muted)">Mạch lạc: ${p.coherence ?? "-"}</span></div>
        <div class="eg-item-orig">${escapeHtml(p.original)}</div>
        ${p.strengths?.length ? `<div class="eg-item-reason"><strong>Điểm mạnh:</strong> ${p.strengths.map(escapeHtml).join("; ")}</div>` : ""}
        ${p.weaknesses?.length ? `<div class="eg-item-reason"><strong>Điểm yếu:</strong> ${p.weaknesses.map(escapeHtml).join("; ")}</div>` : ""}
        ${p.missingIdeas?.length ? `<div class="eg-item-reason"><strong>Ý còn thiếu:</strong> ${p.missingIdeas.map(escapeHtml).join("; ")}</div>` : ""}
        ${p.rewrite ? `<div class="eg-item-arrow">→ đoạn cải thiện</div><div class="eg-item-rewrite">${escapeHtml(p.rewrite)}</div>` : ""}
        ${p.rewriteReason ? `<div class="eg-item-reason">${escapeHtml(p.rewriteReason)}</div>` : ""}
      </div>`).join("");
  }
  function renderIssueList(items, fields) {
    if (!items || !items.length) return `<div class="eg-empty">Không phát hiện lỗi.</div>`;
    return items.map((it) => `
      <div class="eg-item">
        <div class="eg-item-orig">${escapeHtml(it[fields.text])}</div>
        <div class="eg-item-reason"><strong>${escapeHtml(it.issue || "")}</strong></div>
        ${it[fields.suggestion] ? `<div class="eg-item-arrow">→ gợi ý</div><div class="eg-item-rewrite">${escapeHtml(it[fields.suggestion])}</div>` : ""}
      </div>`).join("");
  }
  function renderStatistics(stats) {
    if (!stats) return "";
    const boxes = [
      ["words", "Số từ"], ["sentences", "Số câu"], ["paragraphs", "Số đoạn"],
      ["grammarErrors", "Lỗi ngữ pháp"], ["spellingErrors", "Lỗi chính tả"], ["styleIssues", "Lỗi văn phong"],
      ["coherenceScore", "Điểm mạch lạc"], ["rubricCoverage", "% Bao phủ Rubric"],
    ];
    return `<div class="eg-stat-grid">${boxes.map(([k, label]) => `
      <div class="eg-stat-box"><div class="eg-stat-num">${stats[k] ?? "-"}</div><div class="eg-stat-label">${label}</div></div>
    `).join("")}</div>${stats.academicLevel ? `<div class="eg-hint" style="margin-top:10px;">Mức học thuật: <strong>${escapeHtml(stats.academicLevel)}</strong></div>` : ""}`;
  }
  function renderFinalSummary(fs) {
    if (!fs) return `<div class="eg-empty">Không có dữ liệu.</div>`;
    const box = (title, arr) => `
      <div class="eg-summary-box"><h4>${title}</h4>
        <ul class="eg-list">${(arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>-</li>"}</ul>
      </div>`;
    return `<div class="eg-summary-grid">
      ${box("✅ Điểm mạnh", fs.strengths)}
      ${box("⚠️ Điểm yếu", fs.weaknesses)}
      ${box("🎯 Ưu tiên cải thiện", fs.priorities)}
      ${box("📝 Gợi ý luyện tập", fs.practiceSuggestions)}
      ${fs.readingList?.length ? box("📚 Tài liệu nên đọc", fs.readingList) : ""}
    </div>`;
  }

  const TABS = [
    { id: "overview", label: "Rubric" },
    { id: "sentence", label: "Câu" },
    { id: "paragraph", label: "Đoạn" },
    { id: "grammar", label: "Ngữ pháp & Chính tả" },
    { id: "logicstyle", label: "Logic & Văn phong" },
    { id: "rewritten", label: "Bài viết lại" },
    { id: "stats", label: "Thống kê" },
    { id: "summary", label: "Tổng kết" },
  ];

  // Sinh HTML cho 1 khối "kết quả chấm bài" độc lập (không phụ thuộc ID cố
  // định) để có thể dùng lại ở nhiều nơi: tab Chấm bài mới, chi tiết bài nộp
  // của học viên, chi tiết duyệt bài của Admin — cùng lúc trên 1 trang.
  function buildResultsBlockHTML(data) {
    const maxScore = data.maxScore || CONFIG.maxScoreDefault;
    const panelContent = {
      overview: renderCriteria(data.criteria),
      sentence: renderSentences(data.sentenceAnalysis),
      paragraph: renderParagraphs(data.paragraphAnalysis),
      grammar: `<div style="margin-bottom:16px;"><h4 style="font-size:12.5px;margin-bottom:8px;">Ngữ pháp</h4>${renderIssueList(data.grammarErrors, { text: "text", suggestion: "suggestion" })}</div>
                 <div><h4 style="font-size:12.5px;margin-bottom:8px;">Chính tả</h4>${renderIssueList(data.spellingErrors, { text: "text", suggestion: "suggestion" })}</div>`,
      logicstyle: `<div style="margin-bottom:16px;"><h4 style="font-size:12.5px;margin-bottom:8px;">Logic</h4>${renderIssueList(data.logicErrors, { text: "text", suggestion: "explanation" })}</div>
                    <div><h4 style="font-size:12.5px;margin-bottom:8px;">Văn phong</h4>${renderIssueList(data.styleIssues, { text: "text", suggestion: "suggestion" })}</div>`,
      rewritten: data.rewrittenEssay?.content
        ? `<div class="eg-hint" style="margin-bottom:8px;">Mức biên tập: <strong>${escapeHtml(data.rewrittenEssay.editLevel || "")}</strong></div><div class="eg-rewritten">${escapeHtml(data.rewrittenEssay.content)}</div>`
        : `<div class="eg-empty">Không có dữ liệu.</div>`,
      stats: renderStatistics(data.statistics),
      summary: renderFinalSummary(data.finalSummary),
    };
    return `
      <div class="eg-card">
        <div class="eg-score-row">
          <div class="eg-gauge">${renderGauge(data.totalScore ?? 0, maxScore)}</div>
          <div class="eg-score-summary"><p>${escapeHtml(data.summary || "")}</p></div>
        </div>
      </div>
      <div class="eg-card">
        <div class="eg-tabs" data-resulttabs>${TABS.map((t, i) => `<div class="eg-tab ${i === 0 ? "eg-active-tab" : ""}" data-tab="${t.id}">${t.label}</div>`).join("")}</div>
        <div data-resultpanels>${TABS.map((t, i) => `<div class="eg-tabpanel ${i === 0 ? "eg-active-panel" : ""}" data-panel="${t.id}">${panelContent[t.id]}</div>`).join("")}</div>
      </div>`;
  }

  // Gắn sự kiện chuyển tab cho 1 khối kết quả vừa chèn vào DOM (dùng event
  // delegation trong phạm vi container, không phụ thuộc ID toàn cục).
  function wireResultsBlock(container) {
    const tabsEl = container.querySelector("[data-resulttabs]");
    const panelsEl = container.querySelector("[data-resultpanels]");
    if (!tabsEl || !panelsEl) return;
    tabsEl.addEventListener("click", (e) => {
      const tabEl = e.target.closest(".eg-tab");
      if (!tabEl) return;
      tabsEl.querySelectorAll(".eg-tab").forEach((el) => el.classList.remove("eg-active-tab"));
      panelsEl.querySelectorAll(".eg-tabpanel").forEach((el) => el.classList.remove("eg-active-panel"));
      tabEl.classList.add("eg-active-tab");
      panelsEl.querySelector(`[data-panel="${tabEl.dataset.tab}"]`).classList.add("eg-active-panel");
    });
  }

  // ==========================================================================
  // 8. HTML CỦA WIDGET
  // ==========================================================================
  function buildDropZone({ id, icon, title, sub, tag, multiple, required }) {
    return `
    <div class="eg-drop ${required ? "eg-required" : ""}" data-drop="${id}">
      <input type="file" id="eg-file-${id}" ${multiple ? "multiple" : ""} data-target="${id}" />
      <div class="eg-drop-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="eg-drop-title">${title}</div>
      <div class="eg-drop-sub">${sub}</div>
      <div class="eg-drop-tag">${tag}</div>
      <div class="eg-filelist" id="eg-filelist-${id}"></div>
    </div>`;
  }

  function widgetHTML() {
    return `
    <div class="eg-header">
      <h2><i class="fa-solid fa-graduation-cap" style="color:var(--eg-accent)"></i> ${NAV_TITLE}</h2>
      <p>${NAV_SUB}</p>
    </div>

    <div class="eg-maintabs" id="eg-maintabs">
      <div class="eg-maintab eg-active-maintab" data-maintab="grade"><i class="fa-solid fa-wand-magic-sparkles"></i> Chấm bài mới</div>
      <div class="eg-maintab" data-maintab="mine"><i class="fa-solid fa-inbox"></i> Bài đã nộp của tôi <span class="eg-count" id="eg-count-mine">0</span></div>
      <div class="eg-maintab" data-maintab="admin" id="eg-maintab-admin" style="display:none;"><i class="fa-solid fa-user-shield"></i> Duyệt bài học viên <span class="eg-count" id="eg-count-admin">0</span></div>
    </div>

    <!-- ================= TAB: CHẤM BÀI MỚI ================= -->
    <div class="eg-mainpanel eg-active-mainpanel" data-mainpanel="grade">
      <div class="eg-card">
        <h3><i class="fa-solid fa-key"></i> Cấu hình API</h3>
        <div class="eg-config-row">
          <div class="eg-field">
            <label>Anthropic API Key</label>
            <input type="password" id="eg-apikey" placeholder="sk-ant-..." />
          </div>
          <div class="eg-field" style="max-width:220px;">
            <label>Model</label>
            <select id="eg-model">
              <option value="claude-sonnet-5">claude-sonnet-5</option>
              <option value="claude-opus-4-8">claude-opus-4-8</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
            </select>
          </div>
          <div class="eg-field" style="max-width:170px;">
            <label>Mức biên tập</label>
            <select id="eg-editlevel">
              <option value="Light">Light</option>
              <option value="Medium" selected>Medium</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
        </div>
        <div class="eg-hint">
          <label style="font-weight:600; cursor:pointer;">
            <input type="checkbox" id="eg-remember" style="width:auto; margin-right:5px;" checked/>
            Ghi nhớ API key trên trình duyệt này (localStorage)
          </label>
          — key chỉ được gửi thẳng tới api.anthropic.com.
        </div>
      </div>

      <div class="eg-card">
        <h3><i class="fa-solid fa-file-arrow-up"></i> Tài liệu chấm bài</h3>
        <div class="eg-grid">
          ${buildDropZone({ id: "assignment", icon: "fa-file-lines", title: "Đề bài", sub: "Assignment", tag: ".txt .md .html .pdf .docx" })}
          ${buildDropZone({ id: "rubric", icon: "fa-list-check", title: "Rubric", sub: "Tiêu chí chấm điểm", tag: "bắt buộc", required: true })}
          ${buildDropZone({ id: "answerKey", icon: "fa-key", title: "Đáp án", sub: "Answer Key", tag: "tuỳ chọn" })}
          ${buildDropZone({ id: "exampleEssays", icon: "fa-copy", title: "Bài mẫu", sub: "Example Essays (điểm 10/8/6/4/2)", tag: "có thể chọn nhiều file", multiple: true })}
          ${buildDropZone({ id: "knowledgeBase", icon: "fa-book", title: "Knowledge Base", sub: "Tài liệu nền tham khảo", tag: "có thể chọn nhiều file", multiple: true })}
          ${buildDropZone({ id: "studentEssay", icon: "fa-pen-nib", title: "Bài làm", sub: "Bài luận cần chấm", tag: "bắt buộc", required: true })}
        </div>
        <div class="eg-field" style="margin-top:14px;">
          <label>Hướng dẫn giáo viên (tuỳ chọn, gõ trực tiếp)</label>
          <textarea id="eg-teacher-instructions" rows="2" placeholder="VD: chú trọng phần lập luận, bỏ qua lỗi chính tả nhẹ..."></textarea>
        </div>
      </div>

      <div class="eg-card">
        <button class="eg-btn eg-btn-primary" id="eg-grade-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Chấm bài ngay</button>
        <div class="eg-progress-wrap" id="eg-progress-wrap">
          <div class="eg-progress-bar"><div class="eg-progress-fill"></div></div>
          <div class="eg-progress-label" id="eg-progress-label">Đang xử lý...</div>
        </div>
        <div class="eg-error" id="eg-error"></div>
      </div>

      <div class="eg-results-wrap" id="eg-results-wrap">
        <div class="eg-card" id="eg-submit-admin-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
            <div class="eg-hint" style="margin:0;" id="eg-submit-admin-hint">Gửi bài làm này (kèm nhận xét của AI) cho Admin xem và cho ý kiến.</div>
            <button class="eg-btn eg-btn-success" id="eg-submit-admin-btn"><i class="fa-solid fa-paper-plane"></i> Gửi bài cho Admin</button>
          </div>
          <div class="eg-toast" id="eg-submit-toast"></div>
          <div class="eg-error" id="eg-submit-error"></div>
        </div>
        <div id="eg-results-container"></div>
      </div>
    </div>

    <!-- ================= TAB: BÀI ĐÃ NỘP CỦA TÔI ================= -->
    <div class="eg-mainpanel" data-mainpanel="mine">
      <div class="eg-card" id="eg-mine-list-card">
        <h3><i class="fa-solid fa-inbox"></i> Bài đã nộp của tôi</h3>
        <div id="eg-mine-list"><div class="eg-empty">Đang tải...</div></div>
      </div>
      <div id="eg-mine-detail" style="display:none;"></div>
    </div>

    <!-- ================= TAB: DUYỆT BÀI HỌC VIÊN (ADMIN) ================= -->
    <div class="eg-mainpanel" data-mainpanel="admin">
      <div class="eg-card" id="eg-admin-list-card">
        <h3><i class="fa-solid fa-user-shield"></i> Bài học viên đã nộp</h3>
        <label style="font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; gap:6px; align-items:center; margin-bottom:12px;">
          <input type="checkbox" id="eg-admin-onlypending" style="width:auto;" checked/> Chỉ hiện bài chờ duyệt
        </label>
        <div id="eg-admin-list"><div class="eg-empty">Đang tải...</div></div>
      </div>
      <div id="eg-admin-detail" style="display:none;"></div>
    </div>
    `;
  }

  // ==========================================================================
  // 9. RENDER DANH SÁCH BÀI NỘP
  // ==========================================================================
  function renderMineList(container, items, onOpen) {
    if (!items.length) { container.innerHTML = `<div class="eg-empty">Bạn chưa nộp bài nào. Hãy chấm bài ở tab "Chấm bài mới" rồi bấm "Gửi bài cho Admin".</div>`; return; }
    container.innerHTML = items.map((it) => `
      <div class="eg-submission-card" data-id="${it.id}">
        <div class="eg-submission-top">
          <div>
            <div class="eg-submission-title">${escapeHtml(it.studentEssayName || "Bài làm")} ${it.assignmentName ? `— ${escapeHtml(it.assignmentName)}` : ""}</div>
            <div class="eg-submission-meta">Nộp lúc ${formatDate(it.submittedAt)} · Điểm AI: ${it.aiResult?.totalScore ?? "-"}/${it.aiResult?.maxScore ?? CONFIG.maxScoreDefault}</div>
          </div>
          <span class="eg-pill ${it.status === "reviewed" ? "eg-pill-reviewed" : "eg-pill-pending"}">${it.status === "reviewed" ? "Đã có nhận xét" : "Đang chờ Admin"}</span>
        </div>
        ${it.status === "reviewed" ? `
          <div class="eg-submission-feedback">
            <strong>Nhận xét của ${escapeHtml(it.reviewedByName || "Admin")}${it.adminScore != null ? ` — Điểm: ${it.adminScore}` : ""}:</strong><br/>
            ${escapeHtml(it.adminFeedback || "(không có nội dung)")}
          </div>` : ""}
      </div>`).join("");
    container.querySelectorAll(".eg-submission-card").forEach((card) => {
      card.addEventListener("click", () => onOpen(items.find((i) => i.id === card.dataset.id)));
    });
  }

  function renderAdminList(container, items, onlyPending, onOpen) {
    const filtered = onlyPending ? items.filter((i) => i.status !== "reviewed") : items;
    if (!filtered.length) { container.innerHTML = `<div class="eg-empty">Không có bài nào.</div>`; return; }
    container.innerHTML = filtered.map((it) => `
      <div class="eg-submission-card" data-id="${it.id}">
        <div class="eg-submission-top">
          <div>
            <div class="eg-submission-title">${escapeHtml(it.studentName || it.studentEmail)}</div>
            <div class="eg-submission-meta">${escapeHtml(it.studentEssayName || "Bài làm")}${it.assignmentName ? ` — ${escapeHtml(it.assignmentName)}` : ""} · Nộp lúc ${formatDate(it.submittedAt)} · Điểm AI: ${it.aiResult?.totalScore ?? "-"}/${it.aiResult?.maxScore ?? CONFIG.maxScoreDefault}</div>
          </div>
          <span class="eg-pill ${it.status === "reviewed" ? "eg-pill-reviewed" : "eg-pill-pending"}">${it.status === "reviewed" ? "Đã duyệt" : "Chờ duyệt"}</span>
        </div>
      </div>`).join("");
    container.querySelectorAll(".eg-submission-card").forEach((card) => {
      card.addEventListener("click", () => onOpen(items.find((i) => i.id === card.dataset.id)));
    });
  }

  function renderStudentDetail(container, item) {
    container.innerHTML = `
      <div class="eg-back-btn" id="eg-mine-back"><i class="fa-solid fa-arrow-left"></i> Quay lại danh sách</div>
      <div class="eg-card">
        <div class="eg-submission-title" style="font-size:16px; margin-bottom:6px;">${escapeHtml(item.studentEssayName || "Bài làm")}</div>
        <div class="eg-submission-meta">Nộp lúc ${formatDate(item.submittedAt)}</div>
        ${item.status === "reviewed" ? `
          <div class="eg-submission-feedback" style="margin-top:12px;">
            <strong>Nhận xét của ${escapeHtml(item.reviewedByName || "Admin")}${item.adminScore != null ? ` — Điểm: ${item.adminScore}` : ""} (${formatDate(item.reviewedAt)}):</strong><br/>
            ${escapeHtml(item.adminFeedback || "(không có nội dung)")}
          </div>` : `<div class="eg-sub-note" style="margin-top:12px;">Bài đang chờ Admin xem và nhận xét.</div>`}
      </div>
      ${item.aiResult ? buildResultsBlockHTML(item.aiResult) : `<div class="eg-empty">Không có dữ liệu chấm AI.</div>`}
      <div class="eg-card">
        <h3><i class="fa-solid fa-file-lines"></i> Nội dung bài làm đã nộp</h3>
        <div class="eg-essay-box">${escapeHtml(item.studentEssayContent || "")}</div>
      </div>
    `;
    wireResultsBlock(container);
    container.querySelector("#eg-mine-back").addEventListener("click", () => {
      container.style.display = "none";
      document.getElementById("eg-mine-list-card").style.display = "block";
    });
    document.getElementById("eg-mine-list-card").style.display = "none";
    container.style.display = "block";
  }

  function renderAdminDetail(container, item, onSent) {
    container.innerHTML = `
      <div class="eg-back-btn" id="eg-admin-back"><i class="fa-solid fa-arrow-left"></i> Quay lại danh sách</div>
      <div class="eg-card">
        <div class="eg-detail-student">
          ${item.studentAvatar ? `<img src="${escapeHtml(item.studentAvatar)}" alt="">` : ""}
          <div>
            <div class="eg-submission-title">${escapeHtml(item.studentName || item.studentEmail)}</div>
            <div class="eg-submission-meta">${escapeHtml(item.studentEmail || "")} · Nộp lúc ${formatDate(item.submittedAt)}</div>
          </div>
        </div>
        ${item.status === "reviewed" ? `<div class="eg-submission-feedback">Đã duyệt bởi ${escapeHtml(item.reviewedByName || "")} lúc ${formatDate(item.reviewedAt)}</div>` : ""}
      </div>
      ${item.aiResult ? buildResultsBlockHTML(item.aiResult) : `<div class="eg-empty">Không có dữ liệu chấm AI.</div>`}
      <div class="eg-card">
        <h3><i class="fa-solid fa-file-lines"></i> Nội dung bài làm</h3>
        <div class="eg-essay-box">${escapeHtml(item.studentEssayContent || "")}</div>
      </div>
      <div class="eg-card">
        <h3><i class="fa-solid fa-comment-dots"></i> Nhận xét của Admin</h3>
        <div class="eg-feedback-row">
          <div class="eg-field" style="flex:3;">
            <label>Nội dung nhận xét</label>
            <textarea id="eg-admin-feedback-text" rows="4" placeholder="Nhận xét cho học viên...">${escapeHtml(item.adminFeedback || "")}</textarea>
          </div>
          <div class="eg-field" style="flex:1; min-width:120px;">
            <label>Điểm Admin (tuỳ chọn)</label>
            <input type="number" id="eg-admin-score" step="0.1" value="${item.adminScore ?? ""}" placeholder="VD: 8.5" />
          </div>
        </div>
        <div style="margin-top:12px;">
          <button class="eg-btn eg-btn-success" id="eg-send-feedback-btn" style="width:auto;"><i class="fa-solid fa-paper-plane"></i> Gửi nhận xét tới học viên</button>
        </div>
        <div class="eg-toast" id="eg-admin-feedback-toast"></div>
        <div class="eg-error" id="eg-admin-feedback-error"></div>
      </div>
    `;
    wireResultsBlock(container);
    container.querySelector("#eg-admin-back").addEventListener("click", () => {
      container.style.display = "none";
      document.getElementById("eg-admin-list-card").style.display = "block";
    });
    container.querySelector("#eg-send-feedback-btn").addEventListener("click", async () => {
      const btn = container.querySelector("#eg-send-feedback-btn");
      const toastEl = container.querySelector("#eg-admin-feedback-toast");
      const errorEl = container.querySelector("#eg-admin-feedback-error");
      toastEl.classList.remove("eg-active"); errorEl.classList.remove("eg-active");
      const text = container.querySelector("#eg-admin-feedback-text").value.trim();
      const score = container.querySelector("#eg-admin-score").value;
      if (!text) { errorEl.textContent = "Vui lòng nhập nội dung nhận xét."; errorEl.classList.add("eg-active"); return; }
      btn.disabled = true;
      try {
        await sendFeedback(item.id, text, score);
        toastEl.textContent = "Đã gửi nhận xét tới học viên.";
        toastEl.classList.add("eg-active");
        if (onSent) onSent();
      } catch (err) {
        errorEl.textContent = err.message || String(err);
        errorEl.classList.add("eg-active");
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById("eg-admin-list-card").style.display = "none";
    container.style.display = "block";
  }

  // ==========================================================================
  // 10. MOUNT — GẮN VÀO SIDEBAR + VIEW CỦA APP
  // ==========================================================================
  function injectStyle() {
    if (document.getElementById("essay-grader-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "essay-grader-styles";
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);
  }

  function getMountPoint() {
    const sidebarNav = document.querySelector(".sidebar-nav");
    const mainContent = document.querySelector("main.content");

    if (sidebarNav && mainContent) {
      if (!document.querySelector(`.nav-item[data-view="${VIEW_ID}"]`)) {
        sidebarNav.insertAdjacentHTML(
          "beforeend",
          `<div class="nav-section-label">AI</div>
           <button class="nav-item" data-view="${VIEW_ID}" id="eg-nav-item">
             <i class="fa-solid fa-graduation-cap"></i> ${NAV_TITLE}
             <span class="badge" id="eg-nav-badge" style="display:none;">0</span>
           </button>`
        );
      }
      const navBtn = document.getElementById("eg-nav-item");

      let view = document.getElementById("view-" + VIEW_ID);
      if (!view) {
        mainContent.insertAdjacentHTML("beforeend", `<section class="view" id="view-${VIEW_ID}"></section>`);
        view = document.getElementById("view-" + VIEW_ID);
      }

      if (global.UIManager && global.UIManager.titles) {
        global.UIManager.titles[VIEW_ID] = [NAV_TITLE, NAV_SUB];
      }

      navBtn.addEventListener("click", () => {
        if (global.UIManager && typeof global.UIManager.navigate === "function") {
          global.UIManager.navigate(VIEW_ID);
        } else {
          document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
          view.classList.add("active");
          document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b === navBtn));
          const titleEl = document.getElementById("pageTitle");
          const subEl = document.getElementById("pageSub");
          if (titleEl) titleEl.textContent = NAV_TITLE;
          if (subEl) subEl.textContent = NAV_SUB;
        }
      });

      return view;
    }

    let el = document.getElementById("essay-grader-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "essay-grader-root";
      document.body.appendChild(el);
    }
    return el;
  }

  function showError(scopeEl, msg) {
    const el = scopeEl.querySelector("#eg-error");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("eg-active");
  }
  function clearError(scopeEl) {
    const el = scopeEl.querySelector("#eg-error");
    if (!el) return;
    el.textContent = "";
    el.classList.remove("eg-active");
  }

  function waitForAuth(cb, tries) {
    tries = tries || 0;
    if (global.AuthManager && global.AuthManager.currentUser) return cb();
    if (tries > 60) return cb(); // ~15s, vẫn gọi lại để UI không treo mãi ở trạng thái "đang tải"
    setTimeout(() => waitForAuth(cb, tries + 1), 250);
  }

  function mount() {
    injectStyle();
    const mountPoint = getMountPoint();
    if (document.getElementById("essay-grader-widget")) return;
    const wrapper = document.createElement("div");
    wrapper.id = "essay-grader-widget";
    wrapper.innerHTML = widgetHTML();
    mountPoint.appendChild(wrapper);

    // ------------------------------------------------------------------
    // Trạng thái upload cho tab "Chấm bài mới"
    // ------------------------------------------------------------------
    const uploadedFiles = { assignment: null, rubric: null, answerKey: null, exampleEssays: [], knowledgeBase: [], studentEssay: null };
    let lastGradeContext = null; // { assignmentName, studentEssayName, studentEssayContent, aiResult }

    const savedKey = global.localStorage?.getItem(CONFIG.storageKeyApiKey);
    const savedModel = global.localStorage?.getItem(CONFIG.storageKeyModel);
    if (savedKey) wrapper.querySelector("#eg-apikey").value = savedKey;
    if (savedModel) wrapper.querySelector("#eg-model").value = savedModel;

    wrapper.querySelectorAll('input[type="file"]').forEach((input) => {
      const targetId = input.dataset.target;
      const listEl = wrapper.querySelector(`#eg-filelist-${targetId}`);
      const dropEl = wrapper.querySelector(`[data-drop="${targetId}"]`);
      const renderFileList = () => {
        const val = uploadedFiles[targetId];
        const entries = Array.isArray(val) ? val : val ? [val] : [];
        listEl.innerHTML = entries.map((f, idx) => `
          <div class="eg-file-chip"><span><i class="fa-solid fa-file"></i> ${escapeHtml(f.name)}</span>
          <button type="button" data-remove="${targetId}" data-idx="${idx}">✕</button></div>`).join("");
      };
      const handleFiles = async (fileArr) => {
        for (const file of fileArr) {
          try {
            const content = await extractFileContent(file);
            const entry = { name: file.name, content };
            if (Array.isArray(uploadedFiles[targetId])) uploadedFiles[targetId].push(entry);
            else uploadedFiles[targetId] = entry;
          } catch (err) { showError(wrapper, err.message); }
        }
        renderFileList();
      };
      input.addEventListener("change", (e) => handleFiles(Array.from(e.target.files || [])));
      dropEl.addEventListener("dragover", (e) => { e.preventDefault(); dropEl.classList.add("eg-drag"); });
      dropEl.addEventListener("dragleave", () => dropEl.classList.remove("eg-drag"));
      dropEl.addEventListener("drop", (e) => { e.preventDefault(); dropEl.classList.remove("eg-drag"); handleFiles(Array.from(e.dataTransfer.files || [])); });
      listEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove]");
        if (!btn) return;
        const idx = Number(btn.dataset.idx);
        if (Array.isArray(uploadedFiles[targetId])) uploadedFiles[targetId].splice(idx, 1);
        else uploadedFiles[targetId] = null;
        renderFileList();
      });
    });

    // ------------------------------------------------------------------
    // Nút "Chấm bài ngay"
    // ------------------------------------------------------------------
    const gradeBtn = wrapper.querySelector("#eg-grade-btn");
    const progressWrap = wrapper.querySelector("#eg-progress-wrap");
    const progressLabel = wrapper.querySelector("#eg-progress-label");
    const resultsWrap = wrapper.querySelector("#eg-results-wrap");
    const resultsContainer = wrapper.querySelector("#eg-results-container");
    const submitAdminBtn = wrapper.querySelector("#eg-submit-admin-btn");
    const submitAdminCard = wrapper.querySelector("#eg-submit-admin-card");

    gradeBtn.addEventListener("click", async () => {
      clearError(wrapper);
      resultsWrap.classList.remove("eg-active");
      const apiKey = wrapper.querySelector("#eg-apikey").value.trim();
      const model = wrapper.querySelector("#eg-model").value;
      const editLevel = wrapper.querySelector("#eg-editlevel").value;
      const remember = wrapper.querySelector("#eg-remember").checked;
      const teacherInstructions = wrapper.querySelector("#eg-teacher-instructions").value.trim();

      if (!apiKey) return showError(wrapper, "Vui lòng nhập Anthropic API key.");
      if (!uploadedFiles.rubric) return showError(wrapper, "Vui lòng upload file Rubric.");
      if (!uploadedFiles.studentEssay) return showError(wrapper, "Vui lòng upload bài làm của sinh viên.");

      if (global.localStorage) {
        if (remember) { global.localStorage.setItem(CONFIG.storageKeyApiKey, apiKey); global.localStorage.setItem(CONFIG.storageKeyModel, model); }
        else global.localStorage.removeItem(CONFIG.storageKeyApiKey);
      }

      const engine = new EssayGraderEngine({ apiKey, model });
      gradeBtn.disabled = true;
      progressWrap.classList.add("eg-active");

      try {
        const result = await engine.grade(
          {
            assignment: uploadedFiles.assignment, rubric: uploadedFiles.rubric, answerKey: uploadedFiles.answerKey,
            exampleEssays: uploadedFiles.exampleEssays, knowledgeBase: uploadedFiles.knowledgeBase,
            studentEssay: uploadedFiles.studentEssay, teacherInstructions, editLevel,
          },
          (msg) => { progressLabel.textContent = msg; }
        );
        resultsContainer.innerHTML = buildResultsBlockHTML(result);
        wireResultsBlock(resultsContainer);
        resultsWrap.classList.add("eg-active");
        resultsWrap.scrollIntoView({ behavior: "smooth", block: "start" });

        lastGradeContext = {
          assignmentName: uploadedFiles.assignment?.name || "",
          studentEssayName: uploadedFiles.studentEssay?.name || "",
          studentEssayContent: uploadedFiles.studentEssay?.content || "",
          aiResult: result,
        };

        const loggedIn = !!currentAuthUser();
        submitAdminCard.style.display = loggedIn ? "block" : "none";
        wrapper.querySelector("#eg-submit-toast").classList.remove("eg-active");
        wrapper.querySelector("#eg-submit-error").classList.remove("eg-active");
        submitAdminBtn.disabled = false;
        submitAdminBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Gửi bài cho Admin`;
      } catch (err) {
        showError(wrapper, err.message || String(err));
      } finally {
        gradeBtn.disabled = false;
        progressWrap.classList.remove("eg-active");
      }
    });

    submitAdminBtn.addEventListener("click", async () => {
      if (!lastGradeContext) return;
      const toastEl = wrapper.querySelector("#eg-submit-toast");
      const errorEl = wrapper.querySelector("#eg-submit-error");
      toastEl.classList.remove("eg-active"); errorEl.classList.remove("eg-active");
      submitAdminBtn.disabled = true;
      try {
        await submitToAdmin(lastGradeContext);
        toastEl.textContent = "Đã gửi bài cho Admin. Bạn có thể theo dõi ở tab \"Bài đã nộp của tôi\".";
        toastEl.classList.add("eg-active");
      } catch (err) {
        errorEl.textContent = err.message || String(err);
        errorEl.classList.add("eg-active");
      } finally {
        submitAdminBtn.disabled = false;
      }
    });

    // ------------------------------------------------------------------
    // Chuyển đổi giữa 3 tab chính (Chấm bài mới / Bài đã nộp / Duyệt bài)
    // ------------------------------------------------------------------
    const maintabsEl = wrapper.querySelector("#eg-maintabs");
    const mainpanels = wrapper.querySelectorAll(".eg-mainpanel");
    let mineListenerStarted = false;
    let adminListenerStarted = false;

    maintabsEl.addEventListener("click", (e) => {
      const tabEl = e.target.closest(".eg-maintab");
      if (!tabEl || tabEl.style.display === "none") return;
      maintabsEl.querySelectorAll(".eg-maintab").forEach((el) => el.classList.remove("eg-active-maintab"));
      mainpanels.forEach((p) => p.classList.remove("eg-active-mainpanel"));
      tabEl.classList.add("eg-active-maintab");
      wrapper.querySelector(`.eg-mainpanel[data-mainpanel="${tabEl.dataset.maintab}"]`).classList.add("eg-active-mainpanel");
      if (tabEl.dataset.maintab === "mine") startMineListener();
      if (tabEl.dataset.maintab === "admin") startAdminListener();
    });

    // ------------------------------------------------------------------
    // Tab "Bài đã nộp của tôi"
    // ------------------------------------------------------------------
    const mineListEl = wrapper.querySelector("#eg-mine-list");
    const mineDetailEl = wrapper.querySelector("#eg-mine-detail");
    const countMineEl = wrapper.querySelector("#eg-count-mine");
    let mineItemsCache = [];

    function startMineListener() {
      if (mineListenerStarted) return;
      mineListenerStarted = true;
      listenMySubmissions(
        (items) => {
          mineItemsCache = items;
          const unread = items.filter((i) => i.status === "reviewed" && !i._seen).length;
          countMineEl.textContent = String(items.length);
          renderMineList(mineListEl, items, (item) => renderStudentDetail(mineDetailEl, item));
        },
        (err) => { mineListEl.innerHTML = `<div class="eg-empty">Không tải được danh sách (${escapeHtml(err.message || "")}). Có thể cần đăng nhập hoặc cấu hình Firestore rules.</div>`; }
      );
    }

    // ------------------------------------------------------------------
    // Tab "Duyệt bài học viên" (chỉ Admin)
    // ------------------------------------------------------------------
    const adminListEl = wrapper.querySelector("#eg-admin-list");
    const adminDetailEl = wrapper.querySelector("#eg-admin-detail");
    const countAdminEl = wrapper.querySelector("#eg-count-admin");
    const onlyPendingChk = wrapper.querySelector("#eg-admin-onlypending");
    const navBadgeEl = document.getElementById("eg-nav-badge");
    let adminItemsCache = [];

    function refreshAdminList() {
      renderAdminList(adminListEl, adminItemsCache, onlyPendingChk.checked, (item) =>
        renderAdminDetail(adminDetailEl, item, () => {
          adminDetailEl.style.display = "none";
          document.getElementById("eg-admin-list-card").style.display = "block";
        })
      );
    }

    function startAdminListener() {
      if (adminListenerStarted) return;
      adminListenerStarted = true;
      listenAllSubmissions(
        (items) => {
          adminItemsCache = items;
          const pending = items.filter((i) => i.status !== "reviewed").length;
          countAdminEl.textContent = String(pending);
          if (navBadgeEl) {
            navBadgeEl.textContent = String(pending);
            navBadgeEl.style.display = pending > 0 ? "inline-flex" : "none";
          }
          refreshAdminList();
        },
        (err) => { adminListEl.innerHTML = `<div class="eg-empty">Không tải được danh sách (${escapeHtml(err.message || "")}). Có thể cần cấu hình Firestore rules cho Admin.</div>`; }
      );
    }
    onlyPendingChk.addEventListener("change", refreshAdminList);

    // ------------------------------------------------------------------
    // Hiện/ẩn tab Admin theo vai trò, và luôn khởi động 2 listener đếm badge
    // ngay khi xác định được trạng thái đăng nhập (không cần đợi bấm vào tab)
    // ------------------------------------------------------------------
    waitForAuth(() => {
      const adminTabBtn = wrapper.querySelector("#eg-maintab-admin");
      if (isCurrentUserAdmin()) {
        adminTabBtn.style.display = "flex";
        startAdminListener();
      }
      if (currentAuthUser()) {
        startMineListener();
      } else {
        mineListEl.innerHTML = `<div class="eg-empty">Đăng nhập để xem và nộp bài cho Admin.</div>`;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(typeof window !== "undefined" ? window : globalThis, document);
