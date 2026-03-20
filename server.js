// ============================================
// ARIA BACKEND SERVER - FIXED VERSION
// ============================================

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Constants
const JWT_SECRET = process.env.JWT_SECRET || 'aria_secret_key_2024';
const PORT = process.env.PORT || 3001;

// In-memory Database
const users = new Map();
const conversations = new Map();
const messages = new Map();
const healthLogs = new Map();

let userIdCounter = 1;
let conversationIdCounter = 1;
let messageIdCounter = 1;

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'ไม่มี token' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้อง' });
  }

  req.userId = decoded.userId;
  next();
}

function generateAIResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  
  const responses = {
    'สวัสดี': 'สวัสดีครับ! ผมเป็น ARIA ผู้ช่วยดิจิทัลของคุณ มีอะไรให้ผมช่วยบ้าง?',
    'สุขภาพ': '✅ สถิติสุขภาพวันนี้:\n• ชีพจร: 72 bpm\n• ขั้นตอน: 8,532\n• นอนหลับ: 7.2 ชั่วโมง\n• อารมณ์: 8/10\nยอดเยี่ยม!',
    'ปฏิทิน': '📅 การประชุมวันนี้:\n1. 09:00 - Team Meeting\n2. 14:00 - Project Review\n3. 16:30 - 1:1 Meeting',
    'การเงิน': '💰 สรุปการเงิน:\n• รายได้: 35,000 บาท\n• ใช้ไป: 15,000 บาท\n• ประหยัด: 20,000 บาท',
    'งาน': '✅ งานของวันนี้:\n• เสร็จแล้ว: 6/10\n• เหลือ: 4 รายการ',
    'ตั้งปลุก': '⏰ ตั้งปลุกเวลา 07:00 ครับ',
    'ไฟ': '💡 เปิดไฟเรียบร้อย',
    'เพลง': '🎵 เปิดเพลง Thai Pop กำลังไหลอยู่',
    'default': 'ดีครับ ผมจดไว้แล้ว! มีอะไรให้ผมช่วยเพิ่มเติมไหม?'
  };

  for (const [keyword, response] of Object.entries(responses)) {
    if (lower.includes(keyword)) {
      return response;
    }
  }

  return responses.default;
}

// ============================================
// API ROUTES
// ============================================

// ✅ Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: '✅ ARIA Backend is Running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// ✅ Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    }

    if (Array.from(users.values()).some(u => u.email === email)) {
      return res.status(400).json({ error: 'Email นี้มีคนสมัครแล้ว' });
    }

    const hashedPassword = bcryptjs.hashSync(password, 10);
    const userId = userIdCounter++;

    const user = {
      id: userId,
      email,
      password_hash: hashedPassword,
      full_name,
      created_at: new Date().toISOString()
    };

    users.set(userId, user);
    const token = generateToken(userId);

    res.status(201).json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const isValidPassword = bcryptjs.compareSync(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER ROUTES
// ============================================

// ✅ Get User Profile
app.get('/api/users/me', authMiddleware, (req, res) => {
  try {
    const user = users.get(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    }

    res.json({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      created_at: user.created_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CHAT ROUTES
// ============================================

// ✅ Get Conversations
app.get('/api/chat/conversations', authMiddleware, (req, res) => {
  try {
    const userConversations = Array.from(conversations.values())
      .filter(c => c.user_id === req.userId)
      .map(c => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at
      }))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    res.json(userConversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Create Conversation
app.post('/api/chat/conversations', authMiddleware, (req, res) => {
  try {
    const { title } = req.body;
    const conversationId = conversationIdCounter++;
    const now = new Date().toISOString();

    const conversation = {
      id: conversationId,
      user_id: req.userId,
      title: title || `Conversation #${conversationId}`,
      created_at: now,
      updated_at: now,
      messages: []
    };

    conversations.set(conversationId, conversation);

    res.status(201).json({
      id: conversation.id,
      title: conversation.title,
      created_at: conversation.created_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Send Message & Get AI Response
app.post('/api/chat/messages', authMiddleware, async (req, res) => {
  try {
    const { conversation_id, content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'ข้อความว่าง' });
    }

    const conversation = conversations.get(conversation_id);
    if (!conversation || conversation.user_id !== req.userId) {
      return res.status(404).json({ error: 'ไม่พบการสนทนา' });
    }

    const now = new Date().toISOString();

    // Save User Message
    const userMessageId = messageIdCounter++;
    const userMessage = {
      id: userMessageId,
      conversation_id,
      user_id: req.userId,
      content,
      type: 'user',
      created_at: now
    };
    messages.set(userMessageId, userMessage);
    conversation.messages.push(userMessageId);

    // Generate AI Response
    const aiResponseText = generateAIResponse(content);
    const aiMessageId = messageIdCounter++;
    const aiMessage = {
      id: aiMessageId,
      conversation_id,
      user_id: req.userId,
      content: aiResponseText,
      type: 'ai',
      created_at: new Date(Date.now() + 1000).toISOString()
    };
    messages.set(aiMessageId, aiMessage);
    conversation.messages.push(aiMessageId);

    // Update conversation
    conversation.updated_at = now;

    res.status(201).json({
      success: true,
      userMessage: {
        id: userMessage.id,
        content: userMessage.content,
        created_at: userMessage.created_at
      },
      aiMessage: {
        id: aiMessage.id,
        content: aiMessage.content,
        created_at: aiMessage.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get Messages in Conversation
app.get('/api/chat/conversations/:id/messages', authMiddleware, (req, res) => {
  try {
    const conversation = conversations.get(parseInt(req.params.id));
    if (!conversation || conversation.user_id !== req.userId) {
      return res.status(404).json({ error: 'ไม่พบการสนทนา' });
    }

    const conversationMessages = conversation.messages.map(msgId => messages.get(msgId));

    res.json(conversationMessages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH ROUTES
// ============================================

// ✅ Log Health Data
app.post('/api/health/log', authMiddleware, (req, res) => {
  try {
    const { heart_rate, steps, sleep_hours, mood, stress_level } = req.body;
    const healthLogId = `${req.userId}_${Date.now()}`;

    const healthLog = {
      id: healthLogId,
      user_id: req.userId,
      heart_rate: heart_rate || 72,
      steps: steps || 0,
      sleep_hours: sleep_hours || 0,
      mood: mood || 5,
      stress_level: stress_level || 5,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString()
    };

    healthLogs.set(healthLogId, healthLog);

    res.status(201).json({
      success: true,
      message: 'บันทึกข้อมูลสุขภาพสำเร็จ',
      data: healthLog
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get Health Summary
app.get('/api/health/summary', authMiddleware, (req, res) => {
  try {
    const userHealthLogs = Array.from(healthLogs.values())
      .filter(h => h.user_id === req.userId);

    const latestLog = userHealthLogs[userHealthLogs.length - 1] || {};

    res.json({
      success: true,
      data: {
        heart_rate: latestLog.heart_rate || 72,
        steps: latestLog.steps || 8532,
        sleep_hours: latestLog.sleep_hours || 7.2,
        mood: latestLog.mood || 8,
        stress_level: latestLog.stress_level || 3,
        calories_burned: 2100,
        date: latestLog.date || new Date().toISOString().split('T')[0],
        summary: 'ทำได้ยอดเยี่ยม! ดำเนินการต่อเนื่องเช่นนี้'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VOICE ROUTES
// ============================================

// ✅ Transcribe Voice
app.post('/api/voice/transcribe', authMiddleware, (req, res) => {
  try {
    const { audio_base64 } = req.body;

    res.json({
      success: true,
      transcription: 'สวัสดี ARIA',
      confidence: 0.98,
      language: 'th'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SMART HOME ROUTES
// ============================================

// ✅ Control Smart Devices
app.post('/api/smart-home/control', authMiddleware, (req, res) => {
  try {
    const { device, action } = req.body;

    const responses = {
      'light_on': '💡 เปิดไฟเรียบร้อยแล้ว',
      'light_off': '💡 ปิดไฟเรียบร้อยแล้ว',
      'fan_on': '💨 เปิดพัดลมเรียบร้อยแล้ว',
      'fan_off': '💨 ปิดพัดลมเรียบร้อยแล้ว',
      'ac_on': '❄️ เปิดแอร์เรียบร้อยแล้ว',
      'ac_off': '❄️ ปิดแอร์เรียบร้อยแล้ว'
    };

    res.json({
      success: true,
      message: responses[`${device}_${action}`] || 'ทำเรียบร้อยแล้ว',
      device,
      action,
      status: action === 'on' ? 'enabled' : 'disabled'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║  🤖 ARIA BACKEND SERVER RUNNING            ║
║  🌐 http://localhost:${PORT}                   ║
║  ✅ Ready for requests                    ║
║  📝 API Base: http://localhost:${PORT}/api    ║
╚════════════════════════════════════════════╝
  `);
  
  console.log('\n📚 Available Endpoints:');
  console.log('  POST   /api/auth/register');
  console.log('  POST   /api/auth/login');
  console.log('  GET    /api/users/me');
  console.log('  GET    /api/chat/conversations');
  console.log('  POST   /api/chat/conversations');
  console.log('  POST   /api/chat/messages');
  console.log('  POST   /api/health/log');
  console.log('  GET    /api/health/summary');
  console.log('  POST   /api/voice/transcribe');
  console.log('  POST   /api/smart-home/control');
  console.log('\n');
});

module.exports = app;
