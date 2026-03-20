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

const users = new Map();
const conversations = new Map();
const messages = new Map();
const healthLogs = new Map();

let userIdCounter = 1;
let conversationIdCounter = 1;
let messageIdCounter = 1;

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

function generateAIResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  const responses = {
    'hello': 'Hello! I am ARIA. How can I help you?',
    'hi': 'Hi there! ARIA at your service.',
    'test': 'System online. All systems operational.',
    'status': 'All systems nominal. Ready for commands.',
  };
  const thaiResponses = {
    'สวัสดี': 'สวัสดีครับ! ผม ARIA พร้อมรับคำสั่งแล้ว',
    'สุขภาพ': 'ชีพจร: 72 bpm | ก้าวเดิน: 8,532 | นอนหลับ: 7.2 ชม.',
    'ปฏิทิน': '09:00 Team Meeting | 14:00 Project Review | 16:30 1on1',
    'การเงิน': 'รายได้: 35,000 | ใช้: 15,000 | ออม: 20,000 บาท',
    'ไฟ': 'เปิดไฟเรียบร้อยแล้วครับ',
    'งาน': 'งานเสร็จแล้ว 6/10 รายการ เหลืออีก 4 รายการ',
  };
  for (const [k, v] of Object.entries(thaiResponses)) {
    if (lower.includes(k)) return v;
  }
  for (const [k, v] of Object.entries(responses)) {
    if (lower.includes(k)) return v;
  }
  return 'รับทราบครับ มีอะไรให้ช่วยเพิ่มเติมไหม?';
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ARIA Online', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'Please fill all fields' });
    if (Array.from(users.values()).some(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
    const hashedPassword = bcryptjs.hashSync(password, 10);
    const userId = userIdCounter++;
    const user = { id: userId, email, password_hash: hashedPassword, full_name, created_at: new Date().toISOString() };
    users.set(userId, user);
    const token = generateToken(userId);
    res.status(201).json({ success: true, user: { id: user.id, email: user.email, full_name: user.full_name }, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user || !bcryptjs.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken(user.id);
    res.json({ success: true, user: { id: user.id, email: user.email, full_name: user.full_name }, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/me', authMiddleware, (req, res) => {
  const user = users.get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
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

app.post('/api/chat/messages', authMiddleware, (req, res) => {
  const { conversation_id, content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
  const conv = conversations.get(conversation_id);
  if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Conversation not found' });
  const now = new Date().toISOString();
  const userMsgId = messageIdCounter++;
  const userMsg = { id: userMsgId, conversation_id, content, type: 'user', created_at: now };
  messages.set(userMsgId, userMsg);
  conv.messages.push(userMsgId);
  const aiText = generateAIResponse(content);
  const aiMsgId = messageIdCounter++;
  const aiMsg = { id: aiMsgId, conversation_id, content: aiText, type: 'ai', created_at: now };
  messages.set(aiMsgId, aiMsg);
  conv.messages.push(aiMsgId);
  conv.updated_at = now;
  res.status(201).json({ success: true, userMessage: userMsg, aiMessage: aiMsg });
});

app.get('/api/chat/conversations/:id/messages', authMiddleware, (req, res) => {
  const conv = conversations.get(parseInt(req.params.id));
  if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json(conv.messages.map(id => messages.get(id)));
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
  res.json({ success: true, message: `${device} ${action} done`, device, action });
});

app.post('/api/voice/transcribe', authMiddleware, (req, res) => {
  res.json({ success: true, transcription: 'Hello ARIA', confidence: 0.98 });
});

app.listen(PORT, () => {
  console.log('ARIA Backend running on port ' + PORT);
});

module.exports = app;
