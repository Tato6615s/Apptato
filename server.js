const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const JWT_SECRET = process.env.JWT_SECRET || 'aria_secret_key_2024';
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// In-memory DB
const users = new Map();
const conversations = new Map();
const messages = new Map();
const healthLogs = new Map();
let userIdCounter = 1;
let conversationIdCounter = 1;
let messageIdCounter = 1;

// ── AUTH UTILS ──
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });
  req.userId = decoded.userId;
  next();
}

// ── CLAUDE AI ──
async function getClaudeResponse(userMessage, conversationHistory = []) {
  if (!ANTHROPIC_API_KEY) {
    return getFallbackResponse(userMessage);
  }
  try {
    const systemPrompt = `คุณคือ ARIA (Adaptive Responsive Intelligent Assistant) ผู้ช่วย AI ส่วนตัวที่ฉลาด อบอุ่น และเป็นมิตร
คุณพูดภาษาไทยเป็นหลัก แต่สามารถพูดภาษาอังกฤษได้ถ้าผู้ใช้ถามเป็นภาษาอังกฤษ
บุคลิก: อ่อนโยน ใส่ใจ มีความรู้ ช่วยเหลือได้จริง เหมือน JARVIS ของ Iron Man
ใช้คำว่า "ครับ" ลงท้ายประโยค เรียกผู้ใช้ว่า "ท่าน"
ความสามารถ: ตอบคำถามทั่วไป, ช่วยวางแผน, ให้คำแนะนำด้านสุขภาพ การเงิน และการทำงาน
ตอบกระชับ ชัดเจน ใช้ emoji เล็กน้อยเพื่อความเป็นมิตร`;

    const apiMessages = conversationHistory.slice(-10).map(m => ({
      role: m.type === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    apiMessages.push({ role: 'user', content: userMessage });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: systemPrompt,
        messages: apiMessages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Claude API error:', err);
      return getFallbackResponse(userMessage);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Claude fetch error:', error);
    return getFallbackResponse(userMessage);
  }
}

function getFallbackResponse(msg) {
  const lower = msg.toLowerCase();
  if (lower.includes('สวัสดี') || lower.includes('hello') || lower.includes('hi')) return 'สวัสดีครับ! ผม ARIA พร้อมช่วยเหลือท่านแล้ว 😊';
  if (lower.includes('สุขภาพ')) return '💪 ข้อมูลสุขภาพวันนี้: ชีพจร 72 bpm | ก้าวเดิน 8,532 | นอน 7.2 ชม. ทำได้ดีมากครับ!';
  if (lower.includes('การเงิน') || lower.includes('เงิน')) return '💰 สรุปการเงิน: รายได้ 35,000 | ใช้ 15,000 | ออม 20,000 บาทครับ';
  if (lower.includes('ปฏิทิน') || lower.includes('นัด')) return '📅 วันนี้มี: 09:00 Team Meeting | 14:00 Project Review | 16:30 1on1 ครับ';
  if (lower.includes('ไฟ')) return '💡 เปิดไฟเรียบร้อยแล้วครับ';
  if (lower.includes('งาน')) return '✅ งานวันนี้: เสร็จ 6/10 | เหลือ 4 รายการครับ';
  return 'รับทราบครับ! มีอะไรให้ผมช่วยเพิ่มเติมไหมครับ? 🤖';
}

// ── ROUTES ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.json({
  status: 'ARIA Online',
  ai: ANTHROPIC_API_KEY ? 'Claude Connected' : 'Fallback Mode',
  timestamp: new Date().toISOString()
}));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'Please fill all fields' });
    if (Array.from(users.values()).some(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
    const userId = userIdCounter++;
    const user = { id: userId, email, password_hash: bcryptjs.hashSync(password, 10), full_name, created_at: new Date().toISOString() };
    users.set(userId, user);
    res.status(201).json({ success: true, user: { id: userId, email, full_name }, token: generateToken(userId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user || !bcryptjs.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ success: true, user: { id: user.id, email: user.email, full_name: user.full_name }, token: generateToken(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/me', authMiddleware, (req, res) => {
  const user = users.get(req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, email: user.email, full_name: user.full_name });
});

app.get('/api/chat/conversations', authMiddleware, (req, res) => {
  const list = Array.from(conversations.values())
    .filter(c => c.user_id === req.userId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  res.json(list);
});

app.post('/api/chat/conversations', authMiddleware, (req, res) => {
  const now = new Date().toISOString();
  const id = conversationIdCounter++;
  const conv = { id, user_id: req.userId, title: req.body.title || 'New Session', created_at: now, updated_at: now, messages: [] };
  conversations.set(id, conv);
  res.status(201).json({ id: conv.id, title: conv.title, created_at: conv.created_at });
});

app.post('/api/chat/messages', authMiddleware, async (req, res) => {
  try {
    const { conversation_id, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
    const conv = conversations.get(conversation_id);
    if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Conversation not found' });

    const now = new Date().toISOString();
    const userMsgId = messageIdCounter++;
    const userMsg = { id: userMsgId, conversation_id, content, type: 'user', created_at: now };
    messages.set(userMsgId, userMsg);
    conv.messages.push(userMsgId);

    // Get conversation history for context
    const history = conv.messages.slice(-20).map(id => messages.get(id)).filter(Boolean);

    // Call Claude
    const aiText = await getClaudeResponse(content, history);

    const aiMsgId = messageIdCounter++;
    const aiMsg = { id: aiMsgId, conversation_id, content: aiText, type: 'ai', created_at: new Date().toISOString() };
    messages.set(aiMsgId, aiMsg);
    conv.messages.push(aiMsgId);
    conv.updated_at = now;

    res.status(201).json({ success: true, userMessage: userMsg, aiMessage: aiMsg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/conversations/:id/messages', authMiddleware, (req, res) => {
  const conv = conversations.get(parseInt(req.params.id));
  if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json(conv.messages.map(id => messages.get(id)).filter(Boolean));
});

app.get('/api/health/summary', authMiddleware, (req, res) => {
  const logs = Array.from(healthLogs.values()).filter(h => h.user_id === req.userId);
  const latest = logs[logs.length - 1] || {};
  res.json({ success: true, data: { heart_rate: latest.heart_rate || 72, steps: latest.steps || 8532, sleep_hours: latest.sleep_hours || 7.2, mood: latest.mood || 8 } });
});

app.post('/api/health/log', authMiddleware, (req, res) => {
  const id = `${req.userId}_${Date.now()}`;
  const log = { id, user_id: req.userId, ...req.body, timestamp: new Date().toISOString() };
  healthLogs.set(id, log);
  res.status(201).json({ success: true, data: log });
});

app.post('/api/smart-home/control', authMiddleware, (req, res) => {
  const { device, action } = req.body;
  res.json({ success: true, message: `${device} ${action} executed`, device, action });
});

app.post('/api/voice/transcribe', authMiddleware, (req, res) => {
  res.json({ success: true, transcription: 'Hello ARIA', confidence: 0.98 });
});

app.listen(PORT, () => console.log(`ARIA running on port ${PORT} | AI: ${ANTHROPIC_API_KEY ? 'Claude' : 'Fallback'}`));
module.exports = app;
