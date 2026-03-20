const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const JWT_SECRET = process.env.JWT_SECRET || 'aria_secret_2024';
const PORT = process.env.PORT || 3001;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// In-memory DB
const users = new Map();
const conversations = new Map();
const messages = new Map();
const healthLogs = new Map();
let uid = 1, cid = 1, mid = 1;

// ── AUTH
function genToken(id) { return jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(t) { try { return jwt.verify(t, JWT_SECRET); } catch { return null; } }
function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'No token' });
  const d = verifyToken(t);
  if (!d) return res.status(401).json({ error: 'Invalid token' });
  req.userId = d.userId; next();
}

// ── GROQ AI
async function askGroq(userMessage, history = []) {
  if (!GROQ_API_KEY) return fallback(userMessage);
  try {
    const systemPrompt = `คุณคือ ARIA (Adaptive Responsive Intelligent Assistant) — ผู้ช่วย AI ส่วนตัวที่ฉลาด อบอุ่น และเป็นมิตร
สไตล์การพูด: เหมือน JARVIS ใน Iron Man — สุภาพ ชัดเจน กระชับ มีบุคลิก
ใช้ภาษาไทยเป็นหลัก เรียกผู้ใช้ว่า "ท่าน" ลงท้ายด้วย "ครับ"
ตอบกระชับ ไม่เกิน 3-4 ประโยค เหมาะกับการอ่านออกเสียง
ถ้าถามเรื่องสุขภาพ การเงิน งาน หรือ smart home ให้ตอบเป็นรายการสั้นๆ`;

    const msgs = [
      ...history.slice(-8).map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: 'user', content: userMessage }
    ];

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, ...msgs],
        max_tokens: 512,
        temperature: 0.7
      })
    });

    if (!res.ok) { const e = await res.json(); console.error('Groq error:', e); return fallback(userMessage); }
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (e) { console.error('Groq fetch error:', e); return fallback(userMessage); }
}

function fallback(msg) {
  const m = msg.toLowerCase();
  if (m.includes('สวัสดี') || m.includes('hello')) return 'สวัสดีครับ ผม ARIA พร้อมรับคำสั่งแล้วครับ';
  if (m.includes('สุขภาพ')) return 'ชีพจร 72 bpm ก้าวเดิน 8,532 ก้าว นอนหลับ 7.2 ชั่วโมง อารมณ์ดีครับ';
  if (m.includes('การเงิน')) return 'รายได้ 35,000 ใช้จ่าย 15,000 ออม 20,000 บาทครับ';
  return 'รับทราบครับ มีอะไรให้ช่วยเพิ่มเติมไหมครับ';
}

// ── ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/health', (req, res) => res.json({
  status: 'ARIA Online',
  ai: GROQ_API_KEY ? 'Groq Connected' : 'Fallback Mode',
  timestamp: new Date().toISOString()
}));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    if ([...users.values()].some(u => u.email === email)) return res.status(400).json({ error: 'Email นี้มีแล้ว' });
    const id = uid++;
    users.set(id, { id, email, password_hash: bcryptjs.hashSync(password, 10), full_name, created_at: new Date().toISOString() });
    res.status(201).json({ success: true, user: { id, email, full_name }, token: genToken(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = [...users.values()].find(u => u.email === email);
    if (!user || !bcryptjs.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    res.json({ success: true, user: { id: user.id, email: user.email, full_name: user.full_name }, token: genToken(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/me', auth, (req, res) => {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ id: u.id, email: u.email, full_name: u.full_name });
});

app.get('/api/chat/conversations', auth, (req, res) => {
  res.json([...conversations.values()].filter(c => c.user_id === req.userId).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)));
});

app.post('/api/chat/conversations', auth, (req, res) => {
  const now = new Date().toISOString(), id = cid++;
  const conv = { id, user_id: req.userId, title: req.body.title || 'New Session', created_at: now, updated_at: now, messages: [] };
  conversations.set(id, conv);
  res.status(201).json({ id: conv.id, title: conv.title, created_at: conv.created_at });
});

app.post('/api/chat/messages', auth, async (req, res) => {
  try {
    const { conversation_id, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });
    const conv = conversations.get(conversation_id);
    if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Conversation not found' });
    const now = new Date().toISOString();
    const umid = mid++;
    const userMsg = { id: umid, conversation_id, content, type: 'user', created_at: now };
    messages.set(umid, userMsg); conv.messages.push(umid);
    const history = conv.messages.slice(-20).map(i => messages.get(i)).filter(Boolean);
    const aiText = await askGroq(content, history);
    const amid = mid++;
    const aiMsg = { id: amid, conversation_id, content: aiText, type: 'ai', created_at: new Date().toISOString() };
    messages.set(amid, aiMsg); conv.messages.push(amid); conv.updated_at = now;
    res.status(201).json({ success: true, userMessage: userMsg, aiMessage: aiMsg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/conversations/:id/messages', auth, (req, res) => {
  const conv = conversations.get(parseInt(req.params.id));
  if (!conv || conv.user_id !== req.userId) return res.status(404).json({ error: 'Not found' });
  res.json(conv.messages.map(i => messages.get(i)).filter(Boolean));
});

app.get('/api/health/summary', auth, (req, res) => {
  const logs = [...healthLogs.values()].filter(h => h.user_id === req.userId);
  const l = logs[logs.length - 1] || {};
  res.json({ success: true, data: { heart_rate: l.heart_rate || 72, steps: l.steps || 8532, sleep_hours: l.sleep_hours || 7.2, mood: l.mood || 8 } });
});

app.post('/api/health/log', auth, (req, res) => {
  const id = `${req.userId}_${Date.now()}`;
  healthLogs.set(id, { id, user_id: req.userId, ...req.body, timestamp: new Date().toISOString() });
  res.status(201).json({ success: true });
});

app.post('/api/smart-home/control', auth, (req, res) => {
  res.json({ success: true, message: `${req.body.device} ${req.body.action} executed` });
});

app.listen(PORT, () => console.log(`ARIA running on port ${PORT} | AI: ${GROQ_API_KEY ? 'Groq' : 'Fallback'}`));
module.exports = app;
