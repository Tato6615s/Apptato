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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
// ElevenLabs Voice ID — "Rachel" เสียงผู้หญิงภาษาอังกฤษ/ไทย
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

const users = new Map();
const conversations = new Map();
const messages = new Map();
const healthLogs = new Map();
let uid=1,cid=1,mid=1;

function genToken(id){return jwt.sign({userId:id},JWT_SECRET,{expiresIn:'7d'});}
function verifyToken(t){try{return jwt.verify(t,JWT_SECRET);}catch{return null;}}
function auth(req,res,next){
  const t=req.headers.authorization?.replace('Bearer ','');
  if(!t)return res.status(401).json({error:'No token'});
  const d=verifyToken(t);
  if(!d)return res.status(401).json({error:'Invalid token'});
  req.userId=d.userId;next();
}

// ── GROQ AI
async function askGroq(userMessage, history=[]) {
  if (!GROQ_API_KEY) return fallback(userMessage);
  try {
    const system = `คุณคือ ARIA ผู้ช่วย AI ส่วนตัว เพศหญิง อ่อนโยน ฉลาด เหมือน JARVIS ใน Iron Man
พูดภาษาไทยเป็นหลัก สุภาพ กระชับ ตอบสั้น 1-3 ประโยค เหมาะกับการอ่านออกเสียง
เรียกผู้ใช้ว่า "ท่าน" ลงท้ายด้วย "ค่ะ" (เพราะเป็นผู้หญิง)
ห้ามใช้ emoji หรือสัญลักษณ์พิเศษ เพราะจะถูกอ่านออกเสียง`;

    const msgs = [
      ...history.slice(-8).map(m=>({role:m.type==='user'?'user':'assistant',content:m.content})),
      {role:'user',content:userMessage}
    ];

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        messages:[{role:'system',content:system},...msgs],
        max_tokens:300, temperature:0.7
      })
    });
    if(!res.ok){console.error('Groq error:',await res.text());return fallback(userMessage);}
    const data=await res.json();
    return data.choices[0].message.content;
  } catch(e){console.error('Groq:',e.message);return fallback(userMessage);}
}

function fallback(msg){
  const m=msg.toLowerCase();
  if(m.includes('สวัสดี')||m.includes('hello'))return'สวัสดีค่ะ ดิฉัน ARIA พร้อมรับคำสั่งแล้วค่ะ';
  if(m.includes('สุขภาพ'))return'ชีพจร 72 ครั้งต่อนาที ก้าวเดิน 8,532 ก้าว นอนหลับ 7.2 ชั่วโมงค่ะ';
  if(m.includes('เงิน')||m.includes('การเงิน'))return'รายได้ 35,000 บาท ใช้จ่าย 15,000 บาท ออม 20,000 บาทค่ะ';
  return'รับทราบค่ะ มีอะไรให้ช่วยเพิ่มเติมไหมคะ';
}

// ── ELEVENLABS TTS
async function textToSpeech(text) {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    // ทำความสะอาด text ก่อนส่ง
    const clean = text.replace(/[^\u0E00-\u0E7F\u0041-\u007A\u0041-\u005A\s.,!?0-9]/g,'').substring(0,500);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body:JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {stability:0.5, similarity_boost:0.75, style:0.4, use_speaker_boost:true}
      })
    });
    if(!res.ok){console.error('ElevenLabs error:',res.status);return null;}
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch(e){console.error('ElevenLabs:',e.message);return null;}
}

// ── ROUTES
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.get('/health',(req,res)=>res.json({
  status:'ARIA Online',
  ai: GROQ_API_KEY?'Groq Connected':'Fallback Mode',
  tts: ELEVENLABS_API_KEY?'ElevenLabs Connected':'Browser TTS',
  timestamp:new Date().toISOString()
}));

app.post('/api/auth/register',async(req,res)=>{
  try{
    const{email,password,full_name}=req.body;
    if(!email||!password||!full_name)return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
    if([...users.values()].some(u=>u.email===email))return res.status(400).json({error:'Email นี้มีแล้ว'});
    const id=uid++;
    users.set(id,{id,email,password_hash:bcryptjs.hashSync(password,10),full_name,created_at:new Date().toISOString()});
    res.status(201).json({success:true,user:{id,email,full_name},token:genToken(id)});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/auth/login',(req,res)=>{
  try{
    const{email,password}=req.body;
    const user=[...users.values()].find(u=>u.email===email);
    if(!user||!bcryptjs.compareSync(password,user.password_hash))return res.status(401).json({error:'Email หรือรหัสผ่านไม่ถูกต้อง'});
    res.json({success:true,user:{id:user.id,email:user.email,full_name:user.full_name},token:genToken(user.id)});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/users/me',auth,(req,res)=>{
  const u=users.get(req.userId);
  if(!u)return res.status(404).json({error:'Not found'});
  res.json({id:u.id,email:u.email,full_name:u.full_name});
});

app.get('/api/chat/conversations',auth,(req,res)=>{
  res.json([...conversations.values()].filter(c=>c.user_id===req.userId).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)));
});

app.post('/api/chat/conversations',auth,(req,res)=>{
  const now=new Date().toISOString(),id=cid++;
  const conv={id,user_id:req.userId,title:req.body.title||'New Session',created_at:now,updated_at:now,messages:[]};
  conversations.set(id,conv);
  res.status(201).json({id:conv.id,title:conv.title,created_at:conv.created_at});
});

app.post('/api/chat/messages',auth,async(req,res)=>{
  try{
    const{conversation_id,content}=req.body;
    if(!content?.trim())return res.status(400).json({error:'Empty message'});
    const conv=conversations.get(conversation_id);
    if(!conv||conv.user_id!==req.userId)return res.status(404).json({error:'Not found'});
    const now=new Date().toISOString();
    const umid=mid++;
    const userMsg={id:umid,conversation_id,content,type:'user',created_at:now};
    messages.set(umid,userMsg);conv.messages.push(umid);
    const history=conv.messages.slice(-16).map(i=>messages.get(i)).filter(Boolean);
    const aiText=await askGroq(content,history);
    // Generate TTS audio
    const audioBase64=await textToSpeech(aiText);
    const amid=mid++;
    const aiMsg={id:amid,conversation_id,content:aiText,type:'ai',created_at:new Date().toISOString()};
    messages.set(amid,aiMsg);conv.messages.push(amid);conv.updated_at=now;
    res.status(201).json({
      success:true,
      userMessage:userMsg,
      aiMessage:aiMsg,
      audio:audioBase64 // base64 mp3 จาก ElevenLabs หรือ null
    });
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/chat/conversations/:id/messages',auth,(req,res)=>{
  const conv=conversations.get(parseInt(req.params.id));
  if(!conv||conv.user_id!==req.userId)return res.status(404).json({error:'Not found'});
  res.json(conv.messages.map(i=>messages.get(i)).filter(Boolean));
});

app.get('/api/health/summary',auth,(req,res)=>{
  const logs=[...healthLogs.values()].filter(h=>h.user_id===req.userId);
  const l=logs[logs.length-1]||{};
  res.json({success:true,data:{heart_rate:l.heart_rate||72,steps:l.steps||8532,sleep_hours:l.sleep_hours||7.2,mood:l.mood||8}});
});

app.post('/api/health/log',auth,(req,res)=>{
  const id=`${req.userId}_${Date.now()}`;
  healthLogs.set(id,{id,user_id:req.userId,...req.body,timestamp:new Date().toISOString()});
  res.status(201).json({success:true});
});

app.post('/api/smart-home/control',auth,(req,res)=>{
  res.json({success:true,message:`${req.body.device} ${req.body.action} done`});
});

// TTS endpoint สำหรับเรียกแยก
app.post('/api/tts',auth,async(req,res)=>{
  try{
    const{text}=req.body;
    if(!text)return res.status(400).json({error:'No text'});
    const audio=await textToSpeech(text);
    res.json({audio,tts:ELEVENLABS_API_KEY?'elevenlabs':'browser'});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,()=>console.log(`ARIA on port ${PORT} | AI:${GROQ_API_KEY?'Groq':'Fallback'} | TTS:${ELEVENLABS_API_KEY?'ElevenLabs':'Browser'}`));
module.exports=app;
