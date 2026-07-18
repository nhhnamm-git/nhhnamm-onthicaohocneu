// ==========================================================================
// KHỈ AI CHATBOT WIDGET - FILE GỘP HOÀN CHỈNH
// Tích hợp 100% UI Khỉ Robot và Logic API Groq (Đã fix lỗi dấu * và câu chúc)
// Đã đồng bộ giao diện sáng/tối theo hệ thống (data-theme="dark")
// ==========================================================================

(function initKhiAIChatbot() {
  // 1. CHÈN GIAO DIỆN HTML & CSS VÀO TRANG
  const chatbotUI = `
  <style id="khi-ai-styles">
  /* Reset cơ bản cho widget */
  #bot-chat-window *, #ai-widget-container *, #bot-chat-window *::before, #bot-chat-window *::after { box-sizing: border-box; }
  
  :root {
    --blue-950:#031324; --blue-900:#04203f; --blue-800:#063563; --blue-700:#0a4a8a;
    --blue-600:#0d5fb3; --blue-500:#1478d4; --blue-400:#3b96e8; --blue-300:#6fb6f2;
    --blue-200:#a7d3f7; --blue-100:#dcedfd; --cyan-400:#22d3ee; --cyan-500:#06b6d4;
    --accent:#1478d4; --success:#16c784; --danger:#ef4444; --warning:#f59e0b;
    --card-bg:rgba(255,255,255,.72); --card-bg-solid:#ffffff; --card-border:rgba(20,120,212,.14);
    --text-main:#0b1f33; --text-muted:#5c7590; --shadow-lg:0 20px 48px rgba(4,32,63,.18);
    --radius-lg:22px; --glass-blur:blur(18px);
    --bot-widget-size:84px;
    --bot-z:999999;
  }
  
  /* Đã thay đổi để đồng bộ với theme của hệ thống index.html */
  [data-theme="dark"] {
    --card-bg:rgba(9,26,46,.68); --card-bg-solid:#0b1f33; --card-border:rgba(59,150,232,.18);
    --text-main:#eaf4ff; --text-muted:#8fa9c4; --shadow-lg:0 20px 48px rgba(0,0,0,.55);
  }
  
  #ai-widget-container {
    position:fixed; bottom:26px; right:26px; width:var(--bot-widget-size); height:var(--bot-widget-size);
    z-index:var(--bot-z); cursor:pointer; display:flex; align-items:center; justify-content:center;
    pointer-events:auto; font-family:'Inter',system-ui,sans-serif;
  }
  .bot-halo {
    position:absolute; width:128%; height:128%; border-radius:50%;
    background:radial-gradient(circle, rgba(34,211,238,0.38) 0%, rgba(20,120,212,0) 72%);
    animation:bot-pulse 3s infinite linear, bot-rotate 12s infinite linear; z-index:1; filter:blur(6px);
  }
  .bot-shadow {
    position:absolute; bottom:-2px; width:58%; height:9px; background:rgba(4,32,63,0.28);
    border-radius:50%; animation:bot-shadow-scale 2.2s infinite ease-in-out; z-index:2;
  }
  
  /* Đã thay đổi để đồng bộ với theme của hệ thống index.html */
  [data-theme="dark"] .bot-shadow { background:rgba(0,0,0,0.5); }
  
  .bot-wrapper {
    position:relative; width:100%; height:100%; z-index:3;
    transition:transform .3s cubic-bezier(.175,.885,.32,1.275);
    animation:bot-float 2.4s infinite ease-in-out;
  }
  #ai-widget-container:hover .bot-wrapper { transform:scale(1.08); filter:drop-shadow(0 0 14px var(--cyan-400)); }
  #ai-widget-container.jumping .bot-wrapper { animation:bot-jump .5s cubic-bezier(.25,.46,.45,.94) forwards; }
  .bot-svg { width:100%; height:100%; overflow:visible; }
  .bot-head { animation:bot-head-tilt 4.2s infinite ease-in-out; transform-origin:100px 78px; }
  .bot-eye { animation:bot-blink 4.2s infinite; transform-origin:center; }
  .bot-arm-right { animation:bot-wave 2.4s infinite ease-in-out; transform-origin:143px 84px; }
  .bot-tail { animation:bot-wag 2.1s infinite ease-in-out; transform-origin:132px 150px; }
  .bot-sparkle { animation:bot-twinkle 1.8s infinite ease-in-out; }
  .bot-sparkle:nth-child(2) { animation-delay:.5s; }
  .bot-sparkle:nth-child(3) { animation-delay:1s; }
  
  @keyframes bot-pulse { 0%,100%{transform:scale(1); opacity:.6;} 50%{transform:scale(1.28); opacity:1;} }
  @keyframes bot-rotate { 0%{transform:rotate(0deg);} 100%{transform:rotate(360deg);} }
  @keyframes bot-shadow-scale { 0%,100%{transform:scale(1); opacity:.5;} 50%{transform:scale(.7); opacity:.2;} }
  @keyframes bot-float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-7px);} }
  @keyframes bot-jump { 0%{transform:translateY(0) scale(1);} 50%{transform:translateY(-18px) scale(1.08);} 100%{transform:translateY(0) scale(1);} }
  @keyframes bot-head-tilt { 0%,100%{transform:rotate(0deg);} 25%{transform:rotate(-4deg);} 75%{transform:rotate(4deg);} }
  @keyframes bot-blink { 0%,46%,49%,100%{transform:scaleY(1);} 47%,48%{transform:scaleY(.1);} }
  @keyframes bot-wave { 0%,100%{transform:rotate(0deg);} 25%{transform:rotate(-18deg);} 75%{transform:rotate(12deg);} }
  @keyframes bot-wag { 0%,100%{transform:rotate(0deg);} 50%{transform:rotate(12deg);} }
  @keyframes bot-twinkle { 0%,100%{opacity:.3; transform:scale(.7);} 50%{opacity:1; transform:scale(1.15);} }
  
  /* Chat window */
  #bot-chat-window {
    position:fixed; bottom:122px; right:26px; width:370px; max-width:calc(100vw - 44px);
    height:560px; max-height:calc(100vh - 150px); font-family:'Inter',system-ui,sans-serif;
    background:var(--card-bg); backdrop-filter:var(--glass-blur); -webkit-backdrop-filter:var(--glass-blur);
    border:1px solid var(--card-border); border-radius:var(--radius-lg);
    box-shadow:var(--shadow-lg), 0 0 24px rgba(34,211,238,0.18);
    z-index:calc(var(--bot-z) - 1); display:flex; flex-direction:column; overflow:hidden;
    opacity:0; pointer-events:none; transform:scale(.85) translateY(16px); transform-origin:bottom right;
    transition:all .3s cubic-bezier(.34,1.56,.64,1); color:var(--text-main);
  }
  #bot-chat-window.active { opacity:1; pointer-events:auto; transform:scale(1) translateY(0); }
  .bot-chat-header {
    padding:16px 18px; background:linear-gradient(135deg, var(--blue-400), var(--blue-700));
    color:#fff; display:flex; align-items:center; justify-content:space-between;
    border-radius:var(--radius-lg) var(--radius-lg) 0 0; box-shadow:0 2px 10px rgba(4,32,63,.15);
  }
  .bot-header-info { display:flex; align-items:center; gap:12px; }
  .bot-header-avatar {
    width:42px; height:42px; background:#fff; border-radius:50%;
    display:flex; align-items:center; justify-content:center; padding:3px; flex-shrink:0;
    box-shadow:0 2px 6px rgba(0,0,0,.15);
  }
  .bot-header-avatar svg { width:100%; height:100%; }
  .bot-header-text { display:flex; flex-direction:column; }
  .bot-header-title { font-weight:700; font-size:15.5px; display:flex; align-items:center; gap:7px; margin:0;}
  .bot-online-dot { width:8px; height:8px; background:var(--success); border-radius:50%; box-shadow:0 0 5px var(--success); animation:bot-pulse 2s infinite; }
  .bot-header-subtitle { font-size:11.5px; opacity:.92; }
  .bot-header-actions { display:flex; gap:8px; align-items:center; }
  .bot-action-btn {
    background:rgba(255,255,255,.2); border:none; color:#fff; width:32px; height:32px; border-radius:50%;
    cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13.5px;
    transition:background .2s, transform .2s; outline:none;
  }
  .bot-action-btn:hover { background:rgba(255,255,255,.38); transform:scale(1.08); }
  .bot-action-btn.active { background:rgba(34,211,238,.4); }
  
  .bot-chat-body {
    flex:1; padding:18px; overflow-y:auto; display:flex; flex-direction:column; gap:14px;
    scrollbar-width:thin; scrollbar-color:var(--blue-300) transparent; background: transparent;
  }
  .bot-chat-body::-webkit-scrollbar { width:6px; }
  .bot-chat-body::-webkit-scrollbar-thumb { background:var(--blue-300); border-radius:10px; }
  .bot-msg {
    max-width:85%; padding:11px 15px; border-radius:16px; font-size:13.5px; line-height:1.55;
    word-wrap:break-word; animation:bot-msg-spring .4s cubic-bezier(.175,.885,.32,1.275) forwards;
    opacity:0; transform:translateY(10px);
  }
  @keyframes bot-msg-spring { to{opacity:1; transform:translateY(0);} }
  .bot-msg.bot { align-self:flex-start; background:var(--card-bg-solid); color:var(--text-main); border:1px solid var(--card-border); border-bottom-left-radius:4px; }
  .bot-msg.user { align-self:flex-end; background:linear-gradient(135deg, var(--blue-400), var(--blue-700)); color:#fff; border-bottom-right-radius:4px; }
  .bot-typing { display:none; align-self:flex-start; background:var(--card-bg-solid); border:1px solid var(--card-border); padding:11px 15px; border-radius:16px; border-bottom-left-radius:4px; }
  .bot-typing span { display:inline-block; width:6px; height:6px; background:var(--accent); border-radius:50%; margin:0 2px; animation:bot-typing-dot 1s infinite alternate; }
  .bot-typing span:nth-child(2) { animation-delay:.2s; }
  .bot-typing span:nth-child(3) { animation-delay:.4s; }
  @keyframes bot-typing-dot { 0%{transform:translateY(0); opacity:.5;} 100%{transform:translateY(-4px); opacity:1;} }
  
  .bot-chat-footer { padding:12px 14px; background:rgba(20,120,212,.06); border-top:1px solid var(--card-border); display:flex; gap:8px; align-items:flex-end; }
  
  /* Đã thay đổi để đồng bộ với theme của hệ thống index.html */
  [data-theme="dark"] .bot-chat-footer { background:rgba(0,0,0,.25); }
  
  .bot-input-wrap { flex:1; background:var(--card-bg-solid); border-radius:18px; padding:7px 12px; display:flex; align-items:center; border:1px solid var(--card-border); box-shadow:inset 0 1px 3px rgba(0,0,0,.05); }
  .bot-icon-btn { background:none; border:none; cursor:pointer; color:var(--text-muted); padding:4px; display:flex; align-items:center; justify-content:center; font-size:14px; transition:color .2s; outline:none;}
  .bot-icon-btn:hover { color:var(--accent); }
  .bot-icon-btn.recording { color:var(--danger); animation:bot-pulse 1.5s infinite; }
  #bot-input { flex:1; border:none; outline:none; background:transparent; resize:none; max-height:100px; padding:4px 8px; font-family:inherit; font-size:13.5px; color:var(--text-main); height:22px; line-height:22px; margin:0;}
  #bot-input::placeholder { color:var(--text-muted); }
  .bot-send-btn { background:var(--accent); color:#fff; border:none; width:38px; height:38px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform .2s, background .2s; flex-shrink:0; font-size:13px; outline:none;}
  .bot-send-btn:hover { background:var(--blue-700); transform:scale(1.05); }
  
  @media (max-width:480px) {
    #bot-chat-window { bottom:0; right:0; width:100%; height:100%; max-height:100vh; max-width:100%; border-radius:0; transform:translateY(100%); }
    #bot-chat-window.active { transform:translateY(0); }
    .bot-chat-header { border-radius:0; }
    #ai-widget-container { bottom:16px; right:16px; --bot-widget-size:66px; }
    #bot-chat-window.active ~ #ai-widget-container { display:none; }
  }
  </style>

  <div id="bot-chat-window">
    <div class="bot-chat-header">
      <div class="bot-header-info">
        <div class="bot-header-avatar">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="#1478d4"/>
            <rect x="18" y="28" width="64" height="52" rx="22" fill="#3b96e8"/>
            <rect x="28" y="38" width="44" height="34" rx="15" fill="#ffffff"/>
            <circle cx="42" cy="55" r="5.5" fill="#0b1f33"/>
            <circle cx="58" cy="55" r="5.5" fill="#0b1f33"/>
            <path d="M40 66 Q50 76 60 66 Q50 71 40 66 Z" fill="#ff5a4e"/>
          </svg>
        </div>
        <div class="bot-header-text">
          <span class="bot-header-title"><i class="fa-solid fa-robot"></i> Khỉ AI <span class="bot-online-dot"></span></span>
          <span class="bot-header-subtitle">Trợ lý ôn thi trắc nghiệm</span>
        </div>
      </div>
      <div class="bot-header-actions">
        <!-- Đã gỡ bỏ nút theme: <button class="bot-action-btn" id="bot-theme-toggle" title="Sáng/Tối"><i class="fa-solid fa-moon"></i></button> -->
        <button class="bot-action-btn" id="bot-tts-toggle" title="Bật/Tắt đọc văn bản"><i class="fa-solid fa-volume-high"></i></button>
        <button class="bot-action-btn" id="bot-close-chat" title="Đóng"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
  
    <div class="bot-chat-body" id="bot-chat-body"></div>
  
    <div class="bot-typing" id="bot-typing-indicator"><span></span><span></span><span></span></div>
  
    <div class="bot-chat-footer">
      <div class="bot-input-wrap">
        <textarea id="bot-input" placeholder="Nhập câu hỏi..." rows="1"></textarea>
        <button class="bot-icon-btn" id="bot-mic-btn" title="Nhập bằng giọng nói"><i class="fa-solid fa-microphone"></i></button>
      </div>
      <button class="bot-send-btn" id="bot-send-btn" title="Gửi (Enter)"><i class="fa-solid fa-paper-plane"></i></button>
    </div>
  </div>
  
  <div id="ai-widget-container">
    <div class="bot-halo"></div>
    <div class="bot-shadow"></div>
    <div class="bot-wrapper" id="bot-robot-btn">
      <svg class="bot-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <path class="bot-sparkle" d="M28 38 L31 47 L40 50 L31 53 L28 62 L25 53 L16 50 L25 47 Z" fill="#ffffff"/>
        <path class="bot-sparkle" d="M174 58 L176.6 64.5 L183 67 L176.6 69.5 L174 76 L171.4 69.5 L165 67 L171.4 64.5 Z" fill="#ffffff"/>
        <path class="bot-sparkle" d="M158 26 L159.7 30.2 L163.9 32 L159.7 33.8 L158 38 L156.3 33.8 L152.1 32 L156.3 30.2 Z" fill="#ffffff"/>
        <g class="bot-tail">
          <path d="M132 150 Q170 148 174 120 Q176 100 158 96 Q148 94 146 106" fill="none" stroke="#0d5fb3" stroke-width="13" stroke-linecap="round"/>
          <circle cx="146" cy="106" r="8" fill="#3b96e8" stroke="#0d5fb3" stroke-width="1.5"/>
        </g>
        <g class="bot-body-group">
          <rect x="72" y="166" width="20" height="30" rx="9" fill="#3b96e8" stroke="#0d5fb3" stroke-width="2"/>
          <rect x="106" y="166" width="20" height="30" rx="9" fill="#3b96e8" stroke="#0d5fb3" stroke-width="2"/>
          <ellipse cx="82" cy="197" rx="14" ry="6" fill="#0a4a8a"/>
          <ellipse cx="116" cy="197" rx="14" ry="6" fill="#0a4a8a"/>
          <rect x="49" y="112" width="17" height="44" rx="8.5" fill="#3b96e8" stroke="#0d5fb3" stroke-width="2" transform="rotate(16 57 112)"/>
          <circle cx="49" cy="158" r="10.5" fill="#6fb6f2" stroke="#0d5fb3" stroke-width="2"/>
          <rect x="60" y="94" width="80" height="76" rx="30" fill="#3b96e8" stroke="#0a4a8a" stroke-width="2.5"/>
          <ellipse cx="100" cy="136" rx="27" ry="29" fill="#ffffff"/>
          <circle cx="100" cy="120" r="12" fill="#ffffff" stroke="#a7d3f7" stroke-width="1.5"/>
          <path d="M101 111 L96.5 121.5 L100.5 121.5 L99 128.5 L105 118 L100.5 118 Z" fill="#f5c518"/>
          <g class="bot-arm-right">
            <rect x="134" y="84" width="17" height="44" rx="8.5" fill="#3b96e8" stroke="#0d5fb3" stroke-width="2" transform="rotate(-34 143 84)"/>
            <circle cx="163" cy="58" r="12.5" fill="#6fb6f2" stroke="#0d5fb3" stroke-width="2"/>
          </g>
        </g>
        <g class="bot-head">
          <circle cx="47" cy="64" r="17" fill="#0d5fb3"/>
          <circle cx="47" cy="64" r="9" fill="#ffffff"/>
          <circle cx="153" cy="64" r="17" fill="#0d5fb3"/>
          <circle cx="153" cy="64" r="9" fill="#ffffff"/>
          <rect x="46" y="22" width="108" height="92" rx="46" fill="#3b96e8" stroke="#0a4a8a" stroke-width="2.5"/>
          <path d="M68 24 Q100 10 132 24" fill="none" stroke="#0a4a8a" stroke-width="3" stroke-linecap="round"/>
          <rect x="60" y="44" width="80" height="58" rx="26" fill="#ffffff"/>
          <g class="bot-eye" style="transform-origin:82px 66px;">
            <circle cx="82" cy="66" r="9.5" fill="#0b1f33"/>
            <circle cx="85" cy="62" r="3.2" fill="#ffffff"/>
          </g>
          <g class="bot-eye" style="transform-origin:120px 66px;">
            <circle cx="120" cy="66" r="9.5" fill="#0b1f33"/>
            <circle cx="123" cy="62" r="3.2" fill="#ffffff"/>
          </g>
          <ellipse cx="101" cy="80" rx="4" ry="2.6" fill="#0b1f33"/>
          <path d="M89 88 Q101 103 113 88 Q101 96 89 88 Z" fill="#ff5a4e" stroke="#0b1f33" stroke-width="1.4"/>
        </g>
      </svg>
    </div>
  </div>
  `;

  if (!document.querySelector('link[href*="font-awesome"]')) {
    const faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(faLink);
  }

  document.body.insertAdjacentHTML('beforeend', chatbotUI);

  // 2. LOGIC XỬ LÝ API GROQ VÀ UI CHATBOT
  // => Dán API Key Groq thật của bạn vào chuỗi bên dưới (lấy tại https://console.groq.com/keys).
  const GROQ_API_KEY = "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";
  // Model Groq đang dùng. Muốn đổi model sau này chỉ cần sửa đúng dòng này.
  const GROQ_MODEL = "llama-3.3-70b-versatile";

  const widgetContainer = document.getElementById('ai-widget-container');
  const chatWindow = document.getElementById('bot-chat-window');
  const closeChatBtn = document.getElementById('bot-close-chat');
  const ttsToggleBtn = document.getElementById('bot-tts-toggle');
  const chatBody = document.getElementById('bot-chat-body');
  const chatInput = document.getElementById('bot-input');
  const sendBtn = document.getElementById('bot-send-btn');
  const typingIndicator = document.getElementById('bot-typing-indicator');
  const micBtn = document.getElementById('bot-mic-btn');

  let isTTSActive = false;
  let chatHistory = [];
  const DEFAULT_MESSAGE = "Xin chào 👋\n\nTôi là Khỉ AI.\n\nTôi có thể hỗ trợ bạn:\n• Giải thích đáp án\n• Mẹo ôn thi hiệu quả\n• Định hướng ôn tập theo phần\n\nBạn cần hỗ trợ gì?\n\n<b>Cố gắng ôn thi cao học nhé</b>";

  // --- Chat History ---
  const saveChatHistory = () => { try{ localStorage.setItem('botChatHistory', JSON.stringify(chatHistory)); }catch(e){} };
  const loadChatHistory = () => {
    let saved = null;
    try{ saved = localStorage.getItem('botChatHistory'); }catch(e){}
    if (saved) {
      chatHistory = JSON.parse(saved);
      chatHistory.forEach(msg => renderMessage(msg.text, msg.sender, false));
      scrollToBottom();
    } else {
      setTimeout(() => addMessage(DEFAULT_MESSAGE, 'bot'), 500);
    }
  };

  const toggleChat = () => {
    const isActive = chatWindow.classList.contains('active');
    if (!isActive) {
      widgetContainer.classList.add('jumping');
      setTimeout(() => widgetContainer.classList.remove('jumping'), 500);
    }
    chatWindow.classList.toggle('active');
    if (!isActive) setTimeout(() => chatInput.focus(), 300);
  };

  const renderMessage = (text, sender, animate = true) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('bot-msg', sender);
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    if (!animate) msgDiv.style.animation = 'none';
    chatBody.appendChild(msgDiv);
    scrollToBottom();
  };

  const addMessage = (text, sender) => {
    if (!text.trim()) return;
    chatHistory.push({ text, sender });
    saveChatHistory();
    renderMessage(text, sender);
    if (sender === 'bot' && isTTSActive) speak(text);
  };

  const scrollToBottom = () => { chatBody.scrollTop = chatBody.scrollHeight; };

  // --- Logic gọi API AI (Groq) ---
  async function callGroq(model, q) {
    const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          // Giữ nguyên System Instruction để yêu cầu không sử dụng *
          { role: "system", content: "Bạn là một trợ lý ảo hỗ trợ ôn thi. Trả lời ngắn gọn, chính xác bằng tiếng Việt. Tuyệt đối KHÔNG dùng ký tự * (dấu sao) hay định dạng markdown trong câu trả lời. Không tự tạo lời chào kết thúc vì hệ thống sẽ làm việc đó." },
          { role: "user", content: q }
        ],
        temperature: 0.5
      })
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  async function askAI(q) {
    typingIndicator.style.display = 'block';
    scrollToBottom();

    let lastErrorMsg = "Lỗi không xác định từ máy chủ.";

    try {
      const { ok, status, data } = await callGroq(GROQ_MODEL, q);

      if (ok && data.choices && data.choices[0]?.message?.content) {
        typingIndicator.style.display = 'none';

        let botResponse = data.choices[0].message.content;

        // 1. Loại bỏ toàn bộ các dấu sao (*)
        botResponse = botResponse.replace(/\*/g, '');

        // 2. Xóa lời chúc cũ (nếu API có tự sinh ra)
        botResponse = botResponse.replace(/Chúc bạn ôn tập tốt cho kì tuyển sinh cao học Đại học kinh tế quốc dân [.!]*\s*/gi, '');

        // 3. Thêm câu chúc yêu cầu (In đậm bằng HTML) vào cuối câu trả lời
        botResponse = botResponse.trim() + '\n\n<b>Cố gắng ôn thi cao học nhé🍀</b>';

        addMessage(botResponse, 'bot');
        return;
      }

      if (!ok) {
        console.error(`Lỗi từ model ${GROQ_MODEL} (HTTP ${status}):`, data);
        lastErrorMsg = data.error?.message || lastErrorMsg;

        typingIndicator.style.display = 'none';
        addMessage(`⚠️ Lỗi kết nối: ${lastErrorMsg}`, 'bot');
        return;
      }

      typingIndicator.style.display = 'none';
      addMessage("Không nhận được câu trả lời hợp lệ từ AI.", 'bot');
      return;

    } catch (e) {
      console.error(`Lỗi mạng khi gọi model ${GROQ_MODEL}:`, e);
      lastErrorMsg = "Lỗi mạng, không thể kết nối tới máy chủ AI.";

      typingIndicator.style.display = 'none';
      addMessage(`⚠️ ${lastErrorMsg}`, 'bot');
      return;
    }
  }

  const handleSend = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = '22px';
    addMessage(text, 'user');
    
    askAI(text);
  };

  chatInput.addEventListener('input', function() {
    this.style.height = '22px';
    this.style.height = (this.scrollHeight < 100 ? this.scrollHeight : 100) + 'px';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // --- Chuyển văn bản thành giọng nói (TTS) & Mic ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.onstart = () => { micBtn.classList.add('recording'); chatInput.placeholder = 'Đang nghe...'; };
    recognition.onresult = (event) => { chatInput.value += event.results[0][0].transcript; chatInput.focus(); };
    recognition.onerror = (e) => console.error('Speech recognition error', e.error);
    recognition.onend = () => { micBtn.classList.remove('recording'); chatInput.placeholder = 'Nhập câu hỏi...'; };
  } else {
    micBtn.style.display = 'none';
  }

  const toggleMic = () => {
    if (!recognition) return;
    if (micBtn.classList.contains('recording')) recognition.stop(); else recognition.start();
  };

  const toggleTTS = () => {
    isTTSActive = !isTTSActive;
    ttsToggleBtn.classList.toggle('active', isTTSActive);
    ttsToggleBtn.innerHTML = isTTSActive ? '<i class="fa-solid fa-volume-high"></i>' : '<i class="fa-solid fa-volume-xmark"></i>';
    if (!isTTSActive) window.speechSynthesis.cancel();
  };

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Bỏ qua các thẻ HTML như <b> và loại bỏ các icon trước khi đọc
    const cleanText = text.replace(/<[^>]*>?/gm, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/gu, '').replace(/[•×*#]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'vi-VN';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // --- Gắn sự kiện (Events) ---
  widgetContainer.addEventListener('click', toggleChat);
  closeChatBtn.addEventListener('click', (e) => { e.stopPropagation(); chatWindow.classList.remove('active'); });
  ttsToggleBtn.addEventListener('click', toggleTTS);
  sendBtn.addEventListener('click', handleSend);
  micBtn.addEventListener('click', toggleMic);

  loadChatHistory();

  try { window.parent.postMessage({ type:'chatbot-ready' }, '*'); } catch(e) {}
})();
