
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

let GoogleGenAI;
try { GoogleGenAI = require('@google/genai').GoogleGenAI; } catch {}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (isProd && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in Render Environment Variables.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isProd ? { rejectUnauthorized: false } : undefined
});

const DAY = 86400000;
function id(p) { return `${p}_${crypto.randomBytes(8).toString('hex')}`; }
function dateKey(d = new Date()) { return d.toISOString().slice(0,10); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}.${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split('.');
  if (!salt || !hex) return false;
  try { return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), crypto.scryptSync(password, salt, 64)); }
  catch { return false; }
}
function levelFor(xp) { return 1 + Math.floor(Math.max(0, Number(xp) || 0) / 250); }
function publicUser(u) {
  return {
    id:u.id, name:u.name, username:u.username, role:u.role,
    xp:Number(u.xp)||0, level:Number(u.level)||1, streak:Number(u.streak)||0,
    badges:Array.isArray(u.badges) ? u.badges : [],
    lastCheckin:u.last_checkin ? String(u.last_checkin).slice(0,10) : null,
    aiToday:u.ai_date && String(u.ai_date).slice(0,10) === dateKey() ? Number(u.ai_count)||0 : 0
  };
}
function addXp(u, amount) {
  u.xp = Math.max(0, (Number(u.xp)||0) + Number(amount||0));
  u.level = levelFor(u.xp);
}
function cleanText(v, max) { return String(v ?? '').trim().slice(0,max); }

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({limit:'1mb'}));

const globalLimiter = rateLimit({
  windowMs:60_000, max:180, standardHeaders:true, legacyHeaders:false,
  message:{error:'Bạn thao tác quá nhanh. Vui lòng thử lại sau.'}
});
app.use('/api/', globalLimiter);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name VARCHAR(40) NOT NULL,
      username VARCHAR(30) NOT NULL,
      password TEXT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'student',
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      streak INTEGER NOT NULL DEFAULT 0,
      last_checkin DATE,
      badges JSONB NOT NULL DEFAULT '[]'::jsonb,
      ai_count INTEGER NOT NULL DEFAULT 0,
      ai_date DATE,
      token TEXT UNIQUE,
      done JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
    CREATE INDEX IF NOT EXISTS users_xp_idx ON users (xp DESC);

    CREATE TABLE IF NOT EXISTS checkins (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checkin_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, checkin_date)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, title VARCHAR(100) NOT NULL, subject VARCHAR(40) NOT NULL DEFAULT '',
      date DATE NOT NULL, time VARCHAR(20) NOT NULL DEFAULT '', room VARCHAR(100) NOT NULL DEFAULT '',
      teacher VARCHAR(100) NOT NULL DEFAULT '', note VARCHAR(300) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS schedules_date_idx ON schedules(date,time);

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title VARCHAR(120) NOT NULL, body VARCHAR(1000) NOT NULL,
      type VARCHAR(30) NOT NULL DEFAULT 'info', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title VARCHAR(120) NOT NULL, xp INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  // Backward-compatible import from an old local JSON file if one exists.
  const fs = require('fs');
  const legacy = path.join(__dirname,'data','db.json');
  if (fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy,'utf8'));
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const u of old.users||[]) {
          await c.query(`INSERT INTO users
            (id,name,username,password,role,xp,level,streak,last_checkin,badges,ai_count,ai_date,token,done)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb)
            ON CONFLICT(id) DO NOTHING`,
            [u.id,u.name,u.username,u.password,u.role||'student',u.xp||0,u.level||1,u.streak||0,
             u.lastCheckin||null,JSON.stringify(u.badges||[]),u.aiCount||0,u.aiDate||null,u.token||null,JSON.stringify(u.done||[])]);
        }
        await c.query('COMMIT');
      } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      console.log('Legacy import checked.');
    } catch(e) { console.warn('Legacy import skipped:',e.message); }
  }

  const admin = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (!admin.rowCount) {
    const username = cleanText(process.env.ADMIN_USER || 'admin',30) || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'change-me-now';
    await pool.query(`INSERT INTO users
      (id,name,username,password,role,xp,level,streak,badges)
      VALUES($1,$2,$3,$4,'admin',0,1,0,$5::jsonb)`,
      [id('usr'),'7A6 Admin',username,hashPassword(password),JSON.stringify(['founder'])]);
    console.log('Admin account initialized:', username);
  }
}

async function auth(req,res,next) {
  try {
    const token = String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if (!token) return res.status(401).json({error:'Vui lòng đăng nhập'});
    const q = await pool.query('SELECT * FROM users WHERE token=$1 LIMIT 1',[token]);
    if (!q.rowCount) return res.status(401).json({error:'Phiên đăng nhập đã hết hạn'});
    req.user = q.rows[0];
    next();
  } catch(e) { console.error(e); res.status(500).json({error:'Lỗi máy chủ'}); }
}
function admin(req,res,next) {
  if (req.user.role !== 'admin') return res.status(403).json({error:'Chỉ Admin mới có quyền'});
  next();
}

app.get('/health', async (req,res) => {
  try { await pool.query('SELECT 1'); res.json({ok:true,service:'7A6 Study Bot V2',database:'postgres'}); }
  catch { res.status(503).json({ok:false,error:'Database unavailable'}); }
});

app.post('/api/register', async (req,res) => {
  try {
    const name=cleanText(req.body.name,40), username=cleanText(req.body.username,30), password=String(req.body.password||'');
    if (name.length<2 || username.length<3 || password.length<6)
      return res.status(400).json({error:'Tên từ 2 ký tự, tài khoản từ 3 ký tự và mật khẩu ít nhất 6 ký tự.'});
    if (!/^[a-zA-Z0-9._-]+$/.test(username))
      return res.status(400).json({error:'Tên tài khoản chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.'});
    const token=crypto.randomBytes(32).toString('hex');
    const q=await pool.query(`INSERT INTO users
      (id,name,username,password,role,xp,level,streak,badges,ai_count,ai_date,token,done)
      VALUES($1,$2,$3,$4,'student',0,1,0,$5::jsonb,0,$6,$7,'[]'::jsonb) RETURNING *`,
      [id('usr'),name,username,hashPassword(password),JSON.stringify(['newbie']),dateKey(),token]);
    res.json({token,user:publicUser(q.rows[0])});
  } catch(e) {
    if(e.code==='23505') return res.status(409).json({error:'Tên tài khoản đã tồn tại'});
    console.error(e); res.status(500).json({error:'Không thể tạo tài khoản'});
  }
});

app.post('/api/login', async (req,res) => {
  try {
    const username=cleanText(req.body.username,30), password=String(req.body.password||'');
    const q=await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[username]);
    if(!q.rowCount || !verifyPassword(password,q.rows[0].password))
      return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});
    const token=crypto.randomBytes(32).toString('hex');
    const u=(await pool.query('UPDATE users SET token=$1 WHERE id=$2 RETURNING *',[token,q.rows[0].id])).rows[0];
    res.json({token,user:publicUser(u)});
  } catch(e) { console.error(e); res.status(500).json({error:'Lỗi máy chủ'}); }
});
app.post('/api/logout',auth,async(req,res)=>{await pool.query('UPDATE users SET token=NULL WHERE id=$1',[req.user.id]);res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(publicUser(req.user)));

app.post('/api/checkin',auth,async(req,res)=>{
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const d=dateKey();
    const ins=await c.query(`INSERT INTO checkins(user_id,checkin_date) VALUES($1,$2)
      ON CONFLICT(user_id,checkin_date) DO NOTHING RETURNING id`,[req.user.id,d]);
    if(!ins.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({error:'Bạn đã điểm danh hôm nay'}); }
    const previous=req.user.last_checkin ? String(req.user.last_checkin).slice(0,10) : null;
    const streak=previous===dateKey(new Date(Date.now()-DAY)) ? Number(req.user.streak)+1 : 1;
    const xp=Number(req.user.xp)+25, level=levelFor(xp);
    const badges=Array.isArray(req.user.badges)?req.user.badges.slice():[];
    if(streak>=7 && !badges.includes('week')) badges.push('week');
    const u=(await c.query(`UPDATE users SET last_checkin=$1,streak=$2,xp=$3,level=$4,badges=$5::jsonb
      WHERE id=$6 RETURNING *`,[d,streak,xp,level,JSON.stringify(badges),req.user.id])).rows[0];
    await c.query('COMMIT');
    res.json({message:'+25 XP · Điểm danh thành công',user:publicUser(u)});
  } catch(e) { await c.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Không thể điểm danh'}); }
  finally { c.release(); }
});

app.get('/api/dashboard',auth,async(req,res)=>{
  try {
    const d=dateKey();
    const [s,a,t,l]=await Promise.all([
      pool.query("SELECT * FROM schedules WHERE active AND date >= $1 ORDER BY date,time LIMIT 12",[d]),
      pool.query("SELECT * FROM announcements WHERE active ORDER BY created_at DESC LIMIT 10"),
      pool.query("SELECT * FROM tasks WHERE active ORDER BY created_at DESC"),
      pool.query("SELECT * FROM users WHERE role='student' ORDER BY xp DESC,created_at ASC LIMIT 10")
    ]);
    res.json({
      user:publicUser(req.user),
      schedules:s.rows.map(x=>({id:x.id,title:x.title,subject:x.subject,date:String(x.date).slice(0,10),time:x.time,room:x.room,teacher:x.teacher,note:x.note})),
      announcements:a.rows.map(x=>({id:x.id,title:x.title,body:x.body,type:x.type,createdAt:x.created_at})),
      tasks:t.rows.map(x=>({id:x.id,title:x.title,xp:Number(x.xp)})),
      leaders:l.rows.map(publicUser)
    });
  } catch(e) { console.error(e); res.status(500).json({error:'Không tải được dashboard'}); }
});

app.post('/api/tasks/:id/complete',auth,async(req,res)=>{
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const tq=await c.query('SELECT * FROM tasks WHERE id=$1 AND active',[req.params.id]);
    if(!tq.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Không tìm thấy nhiệm vụ'});}
    const task=tq.rows[0], key=`${task.id}:${dateKey()}`;
    const uq=await c.query('SELECT done,xp FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
    const done=Array.isArray(uq.rows[0].done)?uq.rows[0].done.slice():[];
    if(done.includes(key)){await c.query('ROLLBACK');return res.status(409).json({error:'Bạn đã hoàn thành nhiệm vụ hôm nay'});}
    done.push(key);
    const xp=Number(uq.rows[0].xp)+Number(task.xp), level=levelFor(xp);
    const u=(await c.query('UPDATE users SET done=$1::jsonb,xp=$2,level=$3 WHERE id=$4 RETURNING *',
      [JSON.stringify(done.slice(-500)),xp,level,req.user.id])).rows[0];
    await c.query('COMMIT'); res.json({message:`+${task.xp} XP`,user:publicUser(u)});
  } catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'Không thể hoàn thành nhiệm vụ'});}
  finally{c.release();}
});

const aiLimiter=rateLimit({windowMs:60_000,max:8,message:{error:'Bạn đang gửi AI quá nhanh. Hãy chờ một chút.'}});
app.post('/api/ai',auth,aiLimiter,async(req,res)=>{
  try {
    if(!GoogleGenAI || !process.env.GEMINI_API_KEY) return res.status(503).json({error:'Gemini AI chưa được cấu hình'});
    let aiCount=Number(req.user.ai_count)||0, aiDate=req.user.ai_date?String(req.user.ai_date).slice(0,10):null;
    if(aiDate!==dateKey()){aiDate=dateKey();aiCount=0;}
    if(aiCount>=30)return res.status(429).json({error:'Bạn đã dùng 30 lượt AI hôm nay'});
    const message=cleanText(req.body.message,5000);
    if(!message)return res.status(400).json({error:'Hãy nhập câu hỏi'});
    const client=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
    const z=await client.models.generateContent({
      model:process.env.GEMINI_MODEL||'gemini-3.8-flash',
      contents:message,
      config:{
        systemInstruction:'Bạn là 7A6 Study Bot, trợ lý học tập cho học sinh THCS. Trả lời bằng tiếng Việt, dễ hiểu, có ví dụ và các bước khi cần. Khuyến khích học sinh tự suy nghĩ. Không hỗ trợ gian lận trong kiểm tra.'
      }
    });
    aiCount++;
    const xp=Number(req.user.xp)+5;
    const u=(await pool.query('UPDATE users SET ai_count=$1,ai_date=$2,xp=$3,level=$4 WHERE id=$5 RETURNING *',
      [aiCount,aiDate,xp,levelFor(xp),req.user.id])).rows[0];
    res.json({answer:z.text||'Chưa có câu trả lời.',user:publicUser(u)});
  } catch(e){console.error('Gemini error:',e);res.status(500).json({error:'Gemini AI đang bận, hãy thử lại sau'});}
});

app.use('/api/admin',auth,admin);
app.get('/api/admin/stats',async(req,res)=>{
  const [u,s,a,t]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM users WHERE role='student'"),
    pool.query("SELECT COUNT(*)::int n FROM schedules WHERE active"),
    pool.query("SELECT COUNT(*)::int n FROM announcements WHERE active"),
    pool.query("SELECT COUNT(*)::int n FROM tasks WHERE active")
  ]);
  res.json({users:u.rows[0].n,schedules:s.rows[0].n,announcements:a.rows[0].n,tasks:t.rows[0].n});
});
app.get('/api/admin/users',async(req,res)=>{
  const q=await pool.query("SELECT * FROM users WHERE role='student' ORDER BY xp DESC");
  res.json(q.rows.map(publicUser));
});
app.post('/api/admin/users/:id/xp',async(req,res)=>{
  const amount=Math.max(-1000,Math.min(1000,Number(req.body.xp)||0));
  const q=await pool.query('SELECT * FROM users WHERE id=$1',[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'Không tìm thấy học sinh'});
  const u=q.rows[0], newXp=Math.max(0,Number(u.xp)+amount);
  const r=await pool.query('UPDATE users SET xp=$1,level=$2 WHERE id=$3 RETURNING *',[newXp,levelFor(newXp),u.id]);
  res.json(publicUser(r.rows[0]));
});
app.post('/api/admin/schedules',async(req,res)=>{
  const b=req.body;if(!b.title||!b.date)return res.status(400).json({error:'Thiếu tiêu đề hoặc ngày'});
  const x={id:id('sch'),title:cleanText(b.title,100),subject:cleanText(b.subject,40),date:cleanText(b.date,10),time:cleanText(b.time,20),room:cleanText(b.room,100),teacher:cleanText(b.teacher,100),note:cleanText(b.note,300)};
  await pool.query(`INSERT INTO schedules(id,title,subject,date,time,room,teacher,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [x.id,x.title,x.subject,x.date,x.time,x.room,x.teacher,x.note]);res.json(x);
});
app.delete('/api/admin/schedules/:id',async(req,res)=>{await pool.query('DELETE FROM schedules WHERE id=$1',[req.params.id]);res.json({ok:true});});
app.post('/api/admin/announcements',async(req,res)=>{
  const title=cleanText(req.body.title,120),body=cleanText(req.body.body,1000);if(!title||!body)return res.status(400).json({error:'Thiếu tiêu đề hoặc nội dung'});
  const x={id:id('ann'),title,body,type:cleanText(req.body.type||'info',30)};
  await pool.query('INSERT INTO announcements(id,title,body,type) VALUES($1,$2,$3,$4)',[x.id,x.title,x.body,x.type]);res.json(x);
});
app.delete('/api/admin/announcements/:id',async(req,res)=>{await pool.query('DELETE FROM announcements WHERE id=$1',[req.params.id]);res.json({ok:true});});
app.post('/api/admin/tasks',async(req,res)=>{
  const title=cleanText(req.body.title,120), xp=Math.min(100,Math.max(1,Number(req.body.xp)||10));if(!title)return res.status(400).json({error:'Thiếu tên nhiệm vụ'});
  const x={id:id('task'),title,xp};await pool.query('INSERT INTO tasks(id,title,xp) VALUES($1,$2,$3)',[x.id,x.title,x.xp]);res.json(x);
});
app.delete('/api/admin/tasks/:id',async(req,res)=>{await pool.query('DELETE FROM tasks WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.use(express.static(path.join(__dirname,'public')));
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

async function start(){
  await initDb();
  const server=app.listen(PORT,'0.0.0.0',()=>console.log(`7A6 Study Bot V2 running on ${PORT}`));
  const stop=()=>server.close(()=>pool.end().finally(()=>process.exit(0)));
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
start().catch(e=>{console.error('Startup failed:',e);process.exit(1);});
