import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

const envPath = new URL('./.env', import.meta.url).pathname;
dotenv.config({ path: envPath });

const app = express();
const port = Number(process.env.PORT || 5001);

app.use(cors());
app.use(express.json());

const groqApiKey = process.env.GROQ_API_KEY?.trim();
if (!groqApiKey) {
  console.error('❌ ERROR: GROQ_API_KEY is missing in backend/.env');
  process.exit(1);
}

const ALLOWED_MODELS = ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'];

function sanitizeModel(model) {
  if (typeof model !== 'string') return 'llama-3.1-8b-instant';
  return ALLOWED_MODELS.includes(model) ? model : 'llama-3.1-8b-instant';
}

function isNonsenseTopic(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (/^[0-9\s]+$/.test(trimmed)) return true;
  if (/^[^a-zA-Z]+$/.test(trimmed)) return true;
  return false;
}

function isInappropriateTopic(text) {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text.toLowerCase();
  const blocked = ['violence', 'drugs', 'weapon', 'sex', 'hate', 'terrorism'];
  return blocked.some((word) => cleaned.includes(word));
}

function detectSubject(topic, struggleAreas) {
  const text = `${topic} ${struggleAreas}`.toLowerCase();
  const subjects = [
    { label: 'Mathematics', regex: /\b(math|algebra|geometry|calculus|statistics|equation|formula|function|derivative|integral|trigonometry|probability)\b/i },
    { label: 'Science', regex: /\b(physics|chemistry|biology|anatomy|ecosystem|molecule|cell|reaction|energy|force|gravity|biology|chemistry)\b/i },
    { label: 'Computer Science', regex: /\b(programming|algorithm|data structure|coding|javascript|python|computer|software|database|machine learning|ai)\b/i },
    { label: 'Language Arts', regex: /\b(grammar|vocabulary|essay|literature|poetry|reading|writing|composition|analysis)\b/i },
    { label: 'Social Studies', regex: /\b(history|geography|economics|politics|government|law|culture|society)\b/i },
  ];

  return subjects.find((subject) => subject.regex.test(text))?.label || 'Academic';
}

function buildProfileSummary(profile) {
  return `Student Profile:\n- Grade level: ${profile.gradeLevel}\n- Learning goal: ${profile.learningGoal}\n- Struggle areas: ${profile.struggleAreas}\n- Exam soon: ${profile.examSoon}\n- Days until exam: ${profile.daysUntilExam || 'N/A'}\n`;
}

function buildPersonalizationBlock(profile, subject) {
  const gradeGuidance = {
    'Middle school': 'Explain at a middle-school level with concrete examples and short definitions.',
    'High school': 'Explain clearly at a high-school level using simple language without oversimplifying.',
    College: 'Use college-level precision, context, and meaningful connections between ideas.',
    Professional: 'Use practical, domain-aware language and focus on real-world application.',
  };
  const goalGuidance = {
    'Exam prep': 'Focus on high-yield concepts, exam signals, common mistakes, and quick practice questions.',
    Revision: 'Prioritize concise summaries, retrieval prompts, and spaced-review friendly takeaways.',
    'Concept learning': 'Build understanding from first principles and connect new ideas to prior knowledge.',
    'Quick doubt': 'Answer directly first, then add only the context needed to remove the confusion.',
  };
  const examGuidance = profile.examSoon === 'Yes'
    ? `An exam is soon${profile.daysUntilExam !== 'N/A' ? `, in ${profile.daysUntilExam} day(s)` : ''}; be calm, focused, and confidence-building.`
    : 'There is no immediate exam; optimize for durable understanding and retention.';

  return [
    gradeGuidance[profile.gradeLevel] || gradeGuidance['High school'],
    goalGuidance[profile.learningGoal] || goalGuidance['Concept learning'],
    examGuidance,
    `Subject lens: ${subject}. Struggle areas to address: ${profile.struggleAreas}.`,
  ].map((instruction) => `- ${instruction}`).join('\n');
}

function buildInstructions(profile) {
  const subject = detectSubject(profile.contextTopic, profile.struggleAreas);
  return `Profile summary:\n${buildProfileSummary(profile)}\nPersonalization directives:\n${buildPersonalizationBlock(profile, subject)}\nGeneral instructions:\n- You are Pomu, an adaptive study coach.\n- Answer as a structured study session with useful Markdown headings and bullets.\n- Include a warm-up, core explanation, worked example, mini quiz, recap, memory tip, or revision suggestion when appropriate.\n- Use a calm, confidence-building tone.\n- Avoid hallucinations, made-up details, or unsupported claims.\n- If the topic is broad, ask the student to narrow it down rather than inventing specifics.\n`;
}

function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];
  return conversation
    .filter((item) => item && typeof item.role === 'string' && typeof item.content === 'string')
    .map((item) => ({ role: item.role, content: item.content.trim() }))
    .slice(-12);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: 'Groq', port });
});

app.post('/generate', async (req, res) => {
  try {
    const {
      model,
      profile = {},
      preferences = {},
      conversation = [],
      message = '',
    } = req.body || {};

    const selectedModel = sanitizeModel(model);
    const selectedPreferences = {
      ...profile,
      ...preferences,
    };
    const {
      gradeLevel = 'High school',
      learningGoal = 'Exam prep',
      examSoon = 'No',
      daysUntilExam = '',
      struggleAreas = 'core concepts',
    } = selectedPreferences;

    const safeConversation = sanitizeConversation(conversation);
    const latestUserMessage = [...safeConversation]
      .reverse()
      .find((item) => item.role === 'user')?.content || message;
    const topic = String(latestUserMessage || '').trim();
    if (!topic) {
      return res.status(400).json({ error: 'Please enter a study topic or ask Pomu a clear question so it can help you.' });
    }

    if (isNonsenseTopic(topic)) {
      return res.status(400).json({ error: 'Please enter a clear study topic like algebra, cellular respiration, or world history.' });
    }

    if (isInappropriateTopic(topic)) {
      return res.status(400).json({ error: 'That topic is not suitable for Pomu. Please enter a safe study topic instead.' });
    }

    const examSoonNormalized = String(examSoon).trim().toLowerCase() === 'yes';
    const examDaysRaw = String(daysUntilExam || '').trim();
    const examDaysNumber = examSoonNormalized ? Number(examDaysRaw) : null;

    if (examSoonNormalized && (!Number.isFinite(examDaysNumber) || examDaysNumber <= 0)) {
      return res.status(400).json({ error: 'Please provide a valid number of days until your exam.' });
    }

    const normalizedProfile = {
      contextTopic: topic,
      gradeLevel: String(gradeLevel).trim() || 'High school',
      learningGoal: String(learningGoal).trim() || 'Exam prep',
      examSoon: examSoonNormalized ? 'Yes' : 'No',
      daysUntilExam: examSoonNormalized ? String(examDaysNumber) : 'N/A',
      struggleAreas: String(struggleAreas).trim() || 'core concepts',
    };

    const profilePrompt = buildInstructions(normalizedProfile);

    const messages = [
      {
        role: 'system',
        content: `You are Pomu AI, an adaptive study assistant.

Write clear, structured explanations using Markdown (headings, bullet lists, etc.).

When a diagram, picture, or video would help the user understand a concept, include it INLINE, close to the paragraph it explains, not in a separate section at the end.

Use these Markdown formats:

- For an image (on its own line, with a blank line before and after):
  ![very short description](IMAGE_URL)

- For a video link (on its own line, with a blank line before and after):
  [Video: Title](https://www.youtube.com/watch?v=VIDEO_ID)
  or
  [Video: Title](https://youtu.be/VIDEO_ID)

Very important formatting rules:
- DO NOT create separate sections named "Visual Representation", "Visual Resources", "Additional Resources", or similar.
- DO NOT surround visuals with dashed lines like "------------------------" or "---".
- DO NOT put image or video Markdown inside bullet points or numbered list items. Put each visual on its own line, directly after the paragraph or sentence it illustrates.
- If you want to reference a visual in text, do it naturally, for example: "See the diagram below:", then put the image Markdown on the next line.

Rules for URLs:
- NEVER invent or guess URLs. Only use real, trustworthy links from reputable educational or scientific sources.
- For images, use direct image URLs that end with .png, .jpg, .jpeg, or .svg from sites like Wikipedia/Wikimedia, NASA, or other official archives.
- For videos, use normal watch URLs (youtube.com/watch?v=...) or short links (youtu.be/...), not /embed/ URLs and not raw iframe HTML. The frontend renders these as clickable links.
- If you are not sure about a valid image or video URL, skip the visual instead of making one up.

When the user explicitly asks to be taught using images or videos, strongly try to include at least one helpful diagram image and one helpful video link, each placed directly after the paragraph that it explains, following all the rules above.`,
      },
      {
        role: 'system',
        content: profilePrompt,
      },
      ...safeConversation,
    ];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: 0.28,
        max_tokens: 1200,
      }),
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error('Groq API error:', data);
      return res.status(groqResponse.status).json({ error: 'Groq API error', details: data?.error?.message || data });
    }

    const assistantText = data?.choices?.[0]?.message?.content?.trim();
    if (!assistantText) {
      return res.status(500).json({ error: 'No response generated from the AI.' });
    }

    res.json({ result: assistantText });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'AI generation failed', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
