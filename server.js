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
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

const users = new Map();
const conversations = new Map();
const messages = new Map();
let uid=1,cid=1,mid=1;

// ── AUTH UTILS
function genToken(id){return jwt.sign({userId:id},JWT_SECRET,{expiresIn:'7d'});}
function verifyToken(t){try{return jwt.verify(t,JWT_SECRET);}catch{return null;}}
function auth(req,res,next){
  const t=req.headers.authorization?.replace('Bearer ','');
  if(!t)return res.status(401).json({error:'No token'});
  const d=verifyToken(t);
  if(!d)return res.status(401).json({error:'Invalid token'});
  req.userId=d.userId;next();
}

// ── GROQ AI with tool awareness
async function askGroq(userMessage, history=[], toolData=null) {
  if (!GROQ_API_KEY) return fallback(userMessage);
  try {
    const systemPrompt = `คุณคือ ARIA ผู้ช่วย AI ส่วนตัว เพศหญิง ฉลาด อบอุ่น พูดภาษาไทย
ตอบสั้น 1-3 ประโยค เหมาะกับการอ่านออกเสียง ลงท้ายด้วย "ค่ะ"
ถ้ามีข้อมูล real-time ให้ใช้ข้อมูลนั้นตอบ อย่าแต่งข้อมูลขึ้นมาเอง
${toolData ? `\n[ข้อมูล Real-time ที่ดึงมา]: ${JSON.stringify(toolData)}` : ''}`;

    const msgs = [
      ...history.slice(-6).map(m=>({role:m.type==='user'?'user':'assistant',content:m.content})),
      {role:'user',content:userMessage}
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${GROQ_API_KEY}`},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:systemPrompt},...msgs],max_tokens:300,temperature:0.7})
    });
    if(!res.ok)return fallback(userMessage);
    const data=await res.json();
    return data.choices[0].message.content;
  }catch(e){return fallback(userMessage);}
}

function fallback(msg){
  const m=msg.toLowerCase();
  if(m.includes('สวัสดี'))return'สวัสดีค่ะ ดิฉัน ARIA พร้อมรับคำสั่งค่ะ';
  return'รับทราบค่ะ มีอะไรให้ช่วยเพิ่มเติมไหมคะ';
}

// ── DETECT INTENT from message
function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (m.includes('อากาศ')||m.includes('ฝน')||m.includes('ร้อน')||m.includes('weather')||m.includes('อุณหภูมิ')) return 'weather';
  if (m.includes('bitcoin')||m.includes('btc')||m.includes('crypto')||m.includes('ethereum')||m.includes('eth')||m.includes('คริปโต')||m.includes('หุ้น')) return 'crypto';
  if (m.includes('ข่าว')||m.includes('news')||m.includes('ล่าสุด')) return 'news';
  if (m.match(/https?:\/\//)) return 'url';
  return null;
}

// ── FETCH WEATHER (OpenWeatherMap free)
async function fetchWeather(city='Bangkok') {
  try {
    const apiKey = WEATHER_API_KEY || 'demo';
    // ใช้ wttr.in ถ้าไม่มี API key (ฟรีไม่ต้องสมัคร)
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    const current = data.current_condition[0];
    return {
      type: 'weather',
      city,
      temp_c: current.temp_C,
      feels_like: current.FeelsLikeC,
      desc: current.lang_th?.[0]?.value || current.weatherDesc[0].value,
      humidity: current.humidity,
      wind: current.windspeedKmph,
      icon: current.weatherCode,
      forecast: data.weather.slice(0,3).map(d=>({
        date: d.date,
        max: d.maxtempC,
        min: d.mintempC,
        desc: d.hourly[4]?.lang_th?.[0]?.value || d.hourly[4]?.weatherDesc?.[0]?.value || ''
      }))
    };
  } catch(e) {
    return {type:'weather',error:'ดึงข้อมูลอากาศไม่ได้ค่ะ',city};
  }
}

// ── FETCH CRYPTO (CoinGecko free)
async function fetchCrypto(coins=['bitcoin','ethereum','binancecoin']) {
  try {
    const ids = coins.join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=thb&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`);
    if (!res.ok) throw new Error('Crypto fetch failed');
    const data = await res.json();
    return {
      type: 'crypto',
      coins: data.map(c=>({
        id: c.id, name: c.name, symbol: c.symbol.toUpperCase(),
        price: c.current_price, change24h: c.price_change_percentage_24h,
        high24h: c.high_24h, low24h: c.low_24h,
        marketCap: c.market_cap,
        sparkline: c.sparkline_in_7d?.price?.slice(-24) || []
      }))
    };
  } catch(e) {
    return {type:'crypto', error:'ดึงข้อมูล Crypto ไม่ได้ค่ะ'};
  }
}

// ── FETCH NEWS (RSS feeds - ฟรี)
async function fetchNews(topic='thailand') {
  try {
    // ใช้ RSS2JSON (ฟรี)
    const rssUrl = encodeURIComponent(`https://feeds.bbcthai.com/thai/thailand/rss.xml`);
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=5`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return {
      type: 'news',
      source: 'BBC Thai',
      articles: (data.items||[]).slice(0,5).map(item=>({
        title: item.title,
        desc: item.description?.replace(/<[^>]*>/g,'').substring(0,120),
        url: item.link,
        date: item.pubDate,
        thumb: item.thumbnail || item.enclosure?.link || null
      }))
    };
  } catch(e) {
    return {type:'news', error:'ดึงข่าวไม่ได้ค่ะ'};
  }
}

// ── FETCH URL preview
async function fetchUrl(url) {
  try {
    const res = await fetch(url, {headers:{'User-Agent':'ARIA-Bot/1.0'},signal:AbortSignal.timeout(5000)});
    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const imgMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    return {
      type: 'url',
      url, title: titleMatch?.[1] || url,
      desc: descMatch?.[1] || '',
      image: imgMatch?.[1] || null
    };
  } catch(e) {
    return {type:'url', error:'เปิด URL ไม่ได้ค่ะ', url};
  }
}

// ── ElevenLabs TTS
async function textToSpeech(text) {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const clean = text.replace(/[^\u0E00-\u0E7F\u0041-\u007A\u0041-\u005A\s.,!?0-9]/g,'').substring(0,500);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','xi-api-key':ELEVENLABS_API_KEY},
      body:JSON.stringify({text:clean,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.5,similarity_boost:0.75}})
    });
    if(!res.ok)return null;
    const buf=await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  }catch{return null;}
}

// ── ROUTES
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/health',(req,res)=>res.json({status:'ARIA Online',ai:GROQ_API_KEY?'Groq Connected':'Fallback',tts:ELEVENLABS_API_KEY?'ElevenLabs Connected':'Browser TTS',weather:'wttr.in Free',crypto:'CoinGecko Free',news:'RSS Free'}));

// Auth routes
app.post('/api/auth/register',async(req,res)=>{
  try{
    const{email,password,full_name}=req.body;
    if(!email||!password||!full_name)return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'});
    if([...users.values()].some(u=>u.email===email))return res.status(400).json({error:'Email นี้มีแล้ว'});
    const id=uid++;
    users.set(id,{id,email,password_hash:bcryptjs.hashSync(password,10),full_name});
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
  const conv={id,user_id:req.userId,title:req.body.title||'Session',created_at:now,updated_at:now,messages:[]};
  conversations.set(id,conv);
  res.status(201).json({id:conv.id,title:conv.title,created_at:conv.created_at});
});

// ── MAIN CHAT — with real-time data
app.post('/api/chat/messages',auth,async(req,res)=>{
  try{
    const{conversation_id,content}=req.body;
    if(!content?.trim())return res.status(400).json({error:'Empty'});
    const conv=conversations.get(conversation_id);
    if(!conv||conv.user_id!==req.userId)return res.status(404).json({error:'Not found'});

    const now=new Date().toISOString();
    const umid=mid++;
    const userMsg={id:umid,conversation_id,content,type:'user',created_at:now};
    messages.set(umid,userMsg);conv.messages.push(umid);

    const history=conv.messages.slice(-12).map(i=>messages.get(i)).filter(Boolean);

    // Detect intent และดึงข้อมูล real-time
    const intent=detectIntent(content);
    let toolData=null;
    let richData=null;

    if(intent==='weather'){
      const cityMatch=content.match(/(?:อากาศ|weather|ฝน|ร้อน|อุณหภูมิ)(?:\s+(?:ที่|ใน|@))?\s*([^\s?]+)?/i);
      const city=cityMatch?.[1]||'Bangkok';
      toolData=await fetchWeather(city);
      richData=toolData;
    } else if(intent==='crypto'){
      const coins=[];
      if(content.toLowerCase().includes('bitcoin')||content.includes('btc'))coins.push('bitcoin');
      if(content.toLowerCase().includes('ethereum')||content.includes('eth'))coins.push('ethereum');
      if(content.toLowerCase().includes('bnb')||content.includes('binance'))coins.push('binancecoin');
      if(coins.length===0)coins.push('bitcoin','ethereum','binancecoin');
      toolData=await fetchCrypto(coins);
      richData=toolData;
    } else if(intent==='news'){
      toolData=await fetchNews();
      richData=toolData;
    } else if(intent==='url'){
      const urlMatch=content.match(/https?:\/\/[^\s]+/);
      if(urlMatch){toolData=await fetchUrl(urlMatch[0]);richData=toolData;}
    }

    const aiText=await askGroq(content,history,toolData);
    const audio=await textToSpeech(aiText);

    const amid=mid++;
    const aiMsg={id:amid,conversation_id,content:aiText,type:'ai',created_at:new Date().toISOString()};
    messages.set(amid,aiMsg);conv.messages.push(amid);conv.updated_at=now;

    res.status(201).json({success:true,userMessage:userMsg,aiMessage:aiMsg,audio,richData});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/chat/conversations/:id/messages',auth,(req,res)=>{
  const conv=conversations.get(parseInt(req.params.id));
  if(!conv||conv.user_id!==req.userId)return res.status(404).json({error:'Not found'});
  res.json(conv.messages.map(i=>messages.get(i)).filter(Boolean));
});

// Direct API endpoints
app.get('/api/realtime/weather',auth,async(req,res)=>{
  const city=req.query.city||'Bangkok';
  res.json(await fetchWeather(city));
});
app.get('/api/realtime/crypto',auth,async(req,res)=>{
  const coins=(req.query.coins||'bitcoin,ethereum,binancecoin').split(',');
  res.json(await fetchCrypto(coins));
});
app.get('/api/realtime/news',auth,async(req,res)=>{
  res.json(await fetchNews());
});

app.post('/api/health/log',auth,(req,res)=>res.status(201).json({success:true}));
app.get('/api/health/summary',auth,(req,res)=>res.json({success:true,data:{heart_rate:72,steps:8532,sleep_hours:7.2,mood:8}}));
app.post('/api/smart-home/control',auth,(req,res)=>res.json({success:true}));

app.listen(PORT,()=>console.log(`ARIA v3 on port ${PORT} | Groq:${!!GROQ_API_KEY} | TTS:${!!ELEVENLABS_API_KEY}`));
module.exports=app;
