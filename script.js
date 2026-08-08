let currentUtterance = null;
let selectedVoice = null;

function loadVoicesSafely() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;

  selectedVoice =
    voices.find((voice) => voice.name.includes('Google')) ||
    voices.find((voice) => voice.name.includes('Samantha')) ||
    voices.find((voice) => voice.name.includes('Daniel')) ||
    voices.find((voice) => voice.name.includes('Enhanced')) ||
    voices.find((voice) => voice.lang === 'en-US') ||
    voices[0];
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoicesSafely;
  loadVoicesSafely();
}

const STORAGE_KEYS = {
  sessions: 'pomuSessions',
  model: 'pomuModel',
  theme: 'pomuTheme',
};
const MAX_HISTORY_MESSAGES = 6;
const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const ALLOWED_MODELS = ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'];
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!('speechSynthesis' in window)) {
  console.warn('Speech Synthesis not supported');
}

const chatMessagesEl = document.getElementById('chatMessages');
const sessionListEl = document.getElementById('sessionList');
const newSessionBtn = document.getElementById('newSessionBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const voiceBtn = document.getElementById('voice-btn');
const speechControls = document.getElementById('speech-controls');
const pauseBtn = document.getElementById('pause-btn');
const resumeBtn = document.getElementById('resume-btn');
const stopBtn = document.getElementById('stop-btn');
const profileForm = document.getElementById('profileForm');
const chatInfoTitle = document.getElementById('sessionTitle');
const chatInfoMeta = document.getElementById('sessionMeta');
const chatModeEl = document.getElementById('chatMode');
const scrollBtn = document.getElementById('scrollTopBtn');
const examSoonSelect = document.getElementById('examSoon');
const examDaysField = document.getElementById('examDaysField');
const gradeLevelInput = document.getElementById('gradeLevel');
const learningGoalInput = document.getElementById('learningGoal');
const learningStyleInput = document.getElementById('learningStyle');
const struggleAreasInput = document.getElementById('struggleAreas');
const topicInput = document.getElementById('topic');
const examDaysInput = document.getElementById('examDays');
const modelSelector = document.getElementById('modelSelector');
const workspaceShell = document.querySelector('.workspace-shell');

let sessions = [];
let currentSession = null;
let isSending = false;
let typingIndicatorEl = null;
let recognition = null;

if (speechControls && pauseBtn && resumeBtn && stopBtn) {
  pauseBtn.addEventListener('click', () => {
    if ('speechSynthesis' in window && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
    }
  });

  resumeBtn.addEventListener('click', () => {
    if ('speechSynthesis' in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  });

  stopBtn.addEventListener('click', () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;
  });
}

if (SpeechRecognition && voiceBtn) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;

  voiceBtn.addEventListener('click', () => {
    try {
      recognition.start();
      voiceBtn.classList.add('listening');
    } catch (error) {
      voiceBtn.classList.remove('listening');
      console.warn('Speech recognition could not start:', error);
    }
  });

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (!transcript) return;
    messageInput.value = transcript;
    resizeTextarea();
    sendUserMessage(transcript);
  };

  recognition.onend = () => {
    voiceBtn.classList.remove('listening');
  };

  recognition.onerror = () => {
    voiceBtn.classList.remove('listening');
    alert('Microphone access denied or not supported.');
  };
} else if (voiceBtn) {
  voiceBtn.hidden = true;
}

function safeUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStoredItem(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setStoredItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveSessions() {
  setStoredItem(STORAGE_KEYS.sessions, sessions);
}

function loadSessions() {
  sessions = getStoredItem(STORAGE_KEYS.sessions, []);
  if (!Array.isArray(sessions)) {
    sessions = [];
  }
}

function getStoredModel() {
  const saved = localStorage.getItem(STORAGE_KEYS.model);
  return ALLOWED_MODELS.includes(saved) ? saved : DEFAULT_MODEL;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const toggles = document.querySelectorAll('.theme-toggle');

  toggles.forEach((btn) => {
    const label = btn.querySelector('.theme-label');

    btn.classList.toggle('is-dark', theme === 'dark');
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');

    if (label) {
      label.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
  });
}

function buildSessionTitle(session) {
  if (!session.messages.length) {
    return 'New session';
  }
  const firstUser = session.messages.find((message) => message.role === 'user');
  if (!firstUser) {
    return 'Study session';
  }
  const title = firstUser.content.trim().slice(0, 40);
  return title.length < 40 ? title : `${title.slice(0, 37)}...`;
}

function createNewSession(profile = {}, model = DEFAULT_MODEL) {
  const now = Date.now();
  return {
    id: safeUUID(),
    createdAt: now,
    title: 'New session',
    model,
    profile: {
      gradeLevel: 'High school',
      learningGoal: 'Exam prep',
      learningStyle: 'Step-by-step',
      examSoon: 'No',
      daysUntilExam: '',
      struggleAreas: 'core concepts',
      topic: '',
      ...profile,
    },
    messages: [],
  };
}

function updateChatHeader() {
  if (!currentSession) return;
  chatInfoTitle.textContent = currentSession.title || 'New session';
  chatInfoMeta.textContent = `Created ${formatDate(currentSession.createdAt)} · ${currentSession.model}`;
  if (chatModeEl) {
    const { learningStyle = 'Step-by-step', learningGoal = 'Exam prep', gradeLevel = 'High school' } = currentSession.profile || {};
    chatModeEl.textContent = `Mode: ${learningStyle} ${learningGoal} (${gradeLevel})`;
  }
}

function applyProfileToForm(profile) {
  if (!profileForm || !profile) return;
  gradeLevelInput.value = profile.gradeLevel || 'High school';
  learningGoalInput.value = profile.learningGoal || 'Exam prep';
  learningStyleInput.value = profile.learningStyle || 'Step-by-step';
  examSoonSelect.value = profile.examSoon || 'No';
  struggleAreasInput.value = profile.struggleAreas || '';
  topicInput.value = profile.topic || '';
  examDaysInput.value = profile.daysUntilExam || '';
  modelSelector.value = profile.model || getStoredModel();
  updateExamDaysVisibility();
}

function updateProfileFromForm() {
  if (!currentSession) return;
  currentSession.profile = {
    gradeLevel: gradeLevelInput.value,
    learningGoal: learningGoalInput.value,
    learningStyle: learningStyleInput.value,
    examSoon: examSoonSelect.value,
    daysUntilExam: examDaysInput.value,
    struggleAreas: struggleAreasInput.value.trim() || 'core concepts',
    topic: topicInput.value.trim(),
  };
  saveSessions();
}

function updateExamDaysVisibility() {
  if (!examSoonSelect || !examDaysField) return;
  const shouldShow = examSoonSelect.value === 'Yes';
  examDaysField.classList.toggle('hidden', !shouldShow);
}

function renderSessionList() {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = '';
  if (!sessions.length) {
    sessionListEl.innerHTML = '<p class="session-empty">No sessions yet. Start a new one.</p>';
    return;
  }
  sessions.slice().reverse().forEach((session) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `session-item${currentSession?.id === session.id ? ' active' : ''}`;
    item.innerHTML = `
      <span class="session-item-title">${session.title}</span>
      <span class="session-item-meta">${formatDate(session.createdAt)}</span>
    `;
    item.addEventListener('click', () => selectSession(session.id));
    sessionListEl.appendChild(item);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function renderMarkdown(text) {
  const source = String(text ?? '').replace(
    /!\[[^\]]*\]\(([^)\s]+)\)/g,
    '[View image]($1)',
  );
  const parsedHtml = window.marked?.parse
    ? window.marked.parse(source)
    : escapeHtml(source).replace(/\n/g, '<br />');
  const sanitizedHtml = window.DOMPurify?.sanitize
    ? window.DOMPurify.sanitize(parsedHtml, {
      ALLOWED_TAGS: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr', 'br', 'h1', 'h2', 'h3', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'class'],
    })
    : escapeHtml(source).replace(/\n/g, '<br />');

  return sanitizedHtml;
}

function enhanceRenderedMessage(container) {
  container.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

function renderMessageContent(text) {
  const container = document.createElement('div');
  container.className = 'message-text';
  container.innerHTML = renderMarkdown(text);
  enhanceRenderedMessage(container);
  return container;
}

function createMessageElement(message) {
  const bubble = document.createElement('article');
  bubble.className = `chat-message ${message.role}`;
  bubble.dataset.messageId = message.id;

  const content = document.createElement('div');
  content.className = 'message-content';

  const text = renderMessageContent(message.content);

  content.appendChild(text);

  if (message.role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'message-action';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => copyMessageText(message.content, copyButton));
    actions.appendChild(copyButton);

    const regenButton = document.createElement('button');
    regenButton.type = 'button';
    regenButton.className = 'message-action';
    regenButton.textContent = 'Regenerate';
    regenButton.addEventListener('click', () => regenerateMessage(message.id));
    actions.appendChild(regenButton);

    content.appendChild(actions);
  }

  if (message.status === 'pending') {
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    content.appendChild(indicator);
  }

  bubble.appendChild(content);

  if (message.role === 'assistant') {
    const playBtn = document.createElement('button');
    playBtn.className = 'play-audio-btn';
    playBtn.innerHTML = '🔊 Play Audio';

    playBtn.addEventListener('click', function () {
      const spokenText = bubble.innerText;
      speakText(spokenText);
    });

    bubble.appendChild(playBtn);
  }

  return bubble;
}

function renderChatMessages() {
  if (!chatMessagesEl || !currentSession) return;
  chatMessagesEl.innerHTML = '';
  currentSession.messages.forEach((message) => {
    chatMessagesEl.appendChild(createMessageElement(message));
  });
  scrollChatToBottom();
}

function scrollChatToBottom() {
  if (!chatMessagesEl) return;
  requestAnimationFrame(() => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });
}

function setChatMeta(text) {
  if (!chatInfoMeta) return;
  chatInfoMeta.textContent = text;
}

function addMessage(message) {
  if (!currentSession) return;
  currentSession.messages.push(message);
  if (message.role === 'assistant') {
    setChatMeta('Pomu is composing your response...');
  } else {
    setChatMeta('Waiting for Pomu...');
  }
  saveSessions();
  const bubble = createMessageElement(message);
  chatMessagesEl.appendChild(bubble);
  scrollChatToBottom();
  return bubble;
}

function updateMessageContent(messageId, newContent) {
  if (!currentSession) return;
  const message = currentSession.messages.find((messageItem) => messageItem.id === messageId);
  if (!message) return;
  message.content = newContent;
  message.status = 'complete';
  saveSessions();
  const bubble = chatMessagesEl.querySelector(`[data-message-id="${messageId}"] .message-text`);
  if (bubble) {
    const renderedContent = renderMessageContent(newContent);
    bubble.replaceChildren(...renderedContent.childNodes);
    enhanceRenderedMessage(bubble);
  }
}

function setMessagePending(messageId) {
  if (!currentSession) return;
  const message = currentSession.messages.find((sessionMessage) => sessionMessage.id === messageId);
  if (!message) return;
  message.status = 'pending';
  message.content = '';
  saveSessions();
  renderChatMessages();
}

function getConversationPayload(limit = MAX_HISTORY_MESSAGES, untilMessageId = null) {
  if (!currentSession) return [];
  const messages = [...currentSession.messages];
  if (untilMessageId) {
    const index = messages.findIndex((item) => item.id === untilMessageId);
    if (index !== -1) {
      messages.splice(index + 1);
    }
  }
  const trimmed = messages.slice(-limit);
  return trimmed.map((message) => ({ role: message.role, content: message.content }));
}

function getLastUserMessageForAssistant(assistantId) {
  if (!currentSession) return null;
  const index = currentSession.messages.findIndex((message) => message.id === assistantId);
  if (index === -1) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (currentSession.messages[i].role === 'user') {
      return currentSession.messages[i];
    }
  }
  return null;
}

function copyMessageText(text, button) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const tooltip = document.createElement('span');
    tooltip.className = 'copy-tooltip';
    tooltip.textContent = 'Copied!';
    button.appendChild(tooltip);
    window.setTimeout(() => tooltip.remove(), 1200);
  });
}

function speakText(text) {
  if (!text) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  utterance.rate = 1.08;
  utterance.pitch = 1.03;

  speechSynthesis.speak(utterance);
}

window.speakText = speakText;

function createTypingIndicator() {
  if (!chatMessagesEl) return null;
  typingIndicatorEl = document.createElement('article');
  typingIndicatorEl.className = 'chat-message assistant typing-message';
  typingIndicatorEl.innerHTML = `
    <div class="message-content">
      <div class="message-text">Pomu is typing...</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>
  `;
  chatMessagesEl.appendChild(typingIndicatorEl);
  scrollChatToBottom();
  return typingIndicatorEl;
}

function removeTypingIndicator() {
  if (typingIndicatorEl?.parentElement) {
    typingIndicatorEl.parentElement.removeChild(typingIndicatorEl);
  }
  typingIndicatorEl = null;
}

function resizeTextarea() {
  if (!messageInput) return;
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(160, messageInput.scrollHeight)}px`;
}

function cleanSessionTitle() {
  if (!currentSession) return;
  currentSession.title = buildSessionTitle(currentSession);
  updateChatHeader();
  saveSessions();
  renderSessionList();
}

async function requestAICompletion(userMessageId, conversationContext) {
  if (!currentSession) return;
  const payload = {
    model: currentSession.model || DEFAULT_MODEL,
    profile: currentSession.profile,
    preferences: currentSession.profile,
    conversation: conversationContext,
  };
  const response = await fetch('http://localhost:5001/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to generate response');
  }

  const data = await response.json();
  if (!data.result) {
    throw new Error('No response returned from Pomu');
  }
  return data.result;
}

function streamMessageText(element, text, callback) {
  if (!element) return;
  element.replaceChildren();
  let index = 0;
  const interval = window.setInterval(() => {
    index += 1;
    const renderedContent = renderMessageContent(text.slice(0, index));
    element.replaceChildren(...renderedContent.childNodes);
    enhanceRenderedMessage(element);
    scrollChatToBottom();
    if (index >= text.length) {
      clearInterval(interval);
      if (callback) callback();
    }
  }, 18);
}

async function sendUserMessage(content) {
  if (!currentSession || isSending || !content) return;
  isSending = true;
  const userMessage = {
    id: safeUUID(),
    role: 'user',
    content,
    createdAt: Date.now(),
  };

  addMessage(userMessage);
  updateProfileFromForm();
  cleanSessionTitle();

  const assistantMessage = {
    id: safeUUID(),
    role: 'assistant',
    content: '',
    status: 'pending',
    createdAt: Date.now(),
  };
  addMessage(assistantMessage);

  const conversation = getConversationPayload(MAX_HISTORY_MESSAGES);
  removeTypingIndicator();
  createTypingIndicator();

  try {
    const fullText = await requestAICompletion(userMessage.id, conversation);
    removeTypingIndicator();
    const assistantBubble = chatMessagesEl.querySelector(`[data-message-id="${assistantMessage.id}"] .message-text`);
    updateMessageContent(assistantMessage.id, '');
    if (assistantBubble) {
      streamMessageText(assistantBubble, fullText, () => {
        updateMessageContent(assistantMessage.id, fullText);
        setChatMeta('Pomu has responded.');
      });
    } else {
      updateMessageContent(assistantMessage.id, fullText);
      setChatMeta('Pomu has responded.');
    }
  } catch (error) {
    removeTypingIndicator();
    updateMessageContent(assistantMessage.id, `Error: ${error.message}`);
    setChatMeta('There was an error generating the response.');
  } finally {
    isSending = false;
  }
}

async function regenerateMessage(assistantId) {
  if (!currentSession || isSending) return;
  const assistantMessage = currentSession.messages.find((message) => message.id === assistantId && message.role === 'assistant');
  if (!assistantMessage) return;

  const userMessage = getLastUserMessageForAssistant(assistantId);
  if (!userMessage) return;

  isSending = true;
  setMessagePending(assistantId);
  removeTypingIndicator();
  createTypingIndicator();

  const conversation = getConversationPayload(MAX_HISTORY_MESSAGES, userMessage.id);
  conversation.push({ role: 'user', content: userMessage.content });

  try {
    const fullText = await requestAICompletion(userMessage.id, conversation);
    removeTypingIndicator();
    const assistantBubble = chatMessagesEl.querySelector(`[data-message-id="${assistantId}"] .message-text`);
    updateMessageContent(assistantId, '');
    if (assistantBubble) {
      streamMessageText(assistantBubble, fullText, () => {
        updateMessageContent(assistantId, fullText);
        setChatMeta('Pomu has regenerated the response.');
      });
    } else {
      updateMessageContent(assistantId, fullText);
      setChatMeta('Pomu has regenerated the response.');
    }
  } catch (error) {
    removeTypingIndicator();
    updateMessageContent(assistantId, `Error: ${error.message}`);
    setChatMeta('There was an error regenerating the response.');
  } finally {
    isSending = false;
  }
}

function selectSession(sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  currentSession = session;
  applyProfileToForm(currentSession.profile);
  modelSelector.value = currentSession.model || getStoredModel();
  updateChatHeader();
  renderSessionList();
  renderChatMessages();
}

function createSessionFromForm() {
  const profile = {
    gradeLevel: gradeLevelInput.value,
    learningGoal: learningGoalInput.value,
    learningStyle: learningStyleInput.value,
    examSoon: examSoonSelect.value,
    daysUntilExam: examDaysInput.value,
    struggleAreas: struggleAreasInput.value.trim() || 'core concepts',
    topic: topicInput.value.trim(),
  };
  const model = modelSelector.value || getStoredModel();
  return createNewSession(profile, model);
}

function startNewSession() {
  const model = modelSelector.value || getStoredModel();
  const profile = {
    gradeLevel: gradeLevelInput.value,
    learningGoal: learningGoalInput.value,
    learningStyle: learningStyleInput.value,
    examSoon: examSoonSelect.value,
    daysUntilExam: examDaysInput.value,
    struggleAreas: struggleAreasInput.value.trim() || 'core concepts',
    topic: topicInput.value.trim(),
  };
  const newSession = createNewSession(profile, model);
  sessions.push(newSession);
  currentSession = newSession;
  saveSessions();
  applyProfileToForm(currentSession.profile);
  updateChatHeader();
  renderSessionList();
  renderChatMessages();
  setChatMeta('Start your new Pomu conversation.');
}

function exportSessionPdf() {
  if (!currentSession) return;
  const doc = window.jspdf?.jsPDF ? new window.jspdf.jsPDF() : null;
  const title = buildSessionTitle(currentSession);
  const lines = [`Pomu AI Study Session`, `${title}`, `${formatDate(currentSession.createdAt)}`, `Model: ${currentSession.model}`];
  lines.push('');
  currentSession.messages.forEach((message) => {
    const prefix = message.role === 'user' ? 'You:' : 'Pomu:';
    const content = message.content || '';
    const split = doc ? doc.splitTextToSize(content, 170) : [content];
    lines.push(prefix);
    lines.push(...split);
    lines.push('');
  });

  if (doc) {
    doc.setFontSize(14);
    doc.text('Pomu AI Study Session', 14, 20);
    doc.setFontSize(10);
    doc.text(`Title: ${title}`, 14, 30);
    doc.text(`Date: ${formatDate(currentSession.createdAt)}`, 14, 36);
    doc.text(`Model: ${currentSession.model}`, 14, 42);
    doc.setFontSize(10);
    const body = doc.splitTextToSize(lines.join('\n'), 180);
    doc.text(body, 14, 52);
    doc.save(`${title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'pomu_session'}.pdf`);
    setChatMeta('Conversation exported.');
  } else {
    window.print();
  }
}

function handleProfileChange() {
  if (!currentSession) return;
  updateProfileFromForm();
  currentSession.model = modelSelector.value || getStoredModel();
  saveSessions();
  updateChatHeader();
}

function handleSubmit(event) {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content || isSending) {
    return;
  }
  messageInput.value = '';
  resizeTextarea();
  sendUserMessage(content);
}

function initDashboard() {
  loadSessions();
  const storedModel = getStoredModel();
  if (!sessions.length) {
    sessions = [createNewSession({}, storedModel)];
  }
  currentSession = sessions[sessions.length - 1];
  currentSession.model = currentSession.model || storedModel;
  applyProfileToForm(currentSession.profile);
  renderSessionList();
  updateChatHeader();
  renderChatMessages();
  if (newSessionBtn) {
    newSessionBtn.addEventListener('click', startNewSession);
  }
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => workspaceShell.classList.toggle('sidebar-collapsed'));
  }
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', exportSessionPdf);
  }
  if (messageForm) {
    messageForm.addEventListener('submit', handleSubmit);
  }
  if (messageInput) {
    messageInput.addEventListener('input', resizeTextarea);
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit(event);
      }
    });
  }
  if (profileForm) {
    profileForm.addEventListener('change', handleProfileChange);
  }
  if (modelSelector) {
    modelSelector.addEventListener('change', () => {
      updateProfileFromForm();
      currentSession.model = modelSelector.value;
      localStorage.setItem(STORAGE_KEYS.model, modelSelector.value);
      saveSessions();
      updateChatHeader();
    });
  }
}

if (scrollBtn) {
  window.addEventListener('scroll', () => {
    scrollBtn.classList.toggle('show', window.scrollY > 300);
  });

  scrollBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const toggles = document.querySelectorAll('.theme-toggle');
  if (!toggles.length) return;

  const stored = localStorage.getItem('theme');
  const initialTheme = stored === 'dark' || stored === 'light' ? stored : 'dark';

  applyTheme(initialTheme);

  toggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('theme', next);
    });
  });

  if (chatMessagesEl && messageForm) {
    initDashboard();
  }
});
