const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

let OpenAI;
try { OpenAI = require('openai').default || require('openai'); } catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add a Render Postgres database and connect it to this service.');
}
if (process.env.RENDER && !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD must be set in Render Environment Variables before deployment.');
}
if (process.env.RENDER && process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in Render Environment Variables.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

function id(prefix) { return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function today() { return new Date().toISOString().slice(0, 10); }
function pw(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + '.' + crypto.scryptSync(p, salt, 64).toString('hex');
}
function okpw(p, x) {
  const [salt, hash] = (x || '').split('.');
  if (!salt || !hash) return false;
  try { return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(p, salt, 64)); }
  catch { return false; }
}
function clean(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    xp: u.xp,
    level: u.level,
    streak: u.streak,
    badges: u.badges || [],
    lastCheckin: u.lastCheckin,
    aiToday: u.aiDate === today() ? u.aiCount : 0,
  };
}
function xp(u, n) {
  u.xp = Math.max(0, Number(u.xp || 0) + n);
  u.level = 1 + Math.floor(u.xp / 250);
}
function rowUser(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, username: r.username, password: r.password, role: r.role,
    xp: Number(r.xp), level: Number(r.level), streak: Number(r.streak),
    lastCheckin: r.last_checkin ? String(r.last_checkin).slice(0, 10) : null,
    badges: r.badges || [], aiCount: Number(r.ai_count || 0),
    aiDate: r.ai_date ? String(r.ai_date).slice(0, 10) : null,
    token: r.token, done: r.done || [],
  };
}
function rowSchedule(r) {
  return { id:r.id, title:r.title, subject:r.subject, date:r.date ? String(r.date).slice(0,10) : null, time:r.time, room:r.room, teacher:r.teacher, note:r.note, createdAt:r.created_at, active:r.active };
}
function rowAnnouncement(r) {
  return { id:r.id, title:r.title, body:r.body, type:r.type, createdAt:r.created_at, active:r.active };
}
function rowTask(r) { return { id:r.id, title:r.title, xp:Number(r.xp), createdAt:r.created_at, active:r.active }; }

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
    CREATE INDEX IF NOT EXISTS users_role_xp_idx ON users (role, xp DESC);

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      subject VARCHAR(40) NOT NULL DEFAULT '',
      date DATE NOT NULL,
      time VARCHAR(20) NOT NULL DEFAULT '',
      room VARCHAR(100) NOT NULL DEFAULT '',
      teacher VARCHAR(100) NOT NULL DEFAULT '',
      note VARCHAR(300) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS schedules_date_idx ON schedules (date, time);

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      body VARCHAR(1000) NOT NULL,
      type VARCHAR(30) NOT NULL DEFAULT 'info',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS announcements_created_idx ON announcements (created_at DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      xp INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  // One-time import if a local/legacy db.json exists beside this server.
  const legacy = path.join(__dirname, 'data', 'db.json');
  if (fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const u of old.users || []) {
          await client.query(`INSERT INTO users (id,name,username,password,role,xp,level,streak,last_checkin,badges,ai_count,ai_date,token,done)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb)
            ON CONFLICT (id) DO NOTHING`, [u.id,u.name,u.username,u.password,u.role||'student',u.xp||0,u.level||1,u.streak||0,u.lastCheckin||null,JSON.stringify(u.badges||[]),u.aiCount||0,u.aiDate||null,u.token||null,JSON.stringify(u.done||[])]);
        }
        for (const s of old.schedules || []) await client.query(`INSERT INTO schedules (id,title,subject,date,time,room,teacher,note,created_at,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [s.id,s.title,s.subject||'',s.date,s.time||'',s.room||'',s.teacher||'',s.note||'',s.createdAt||new Date().toISOString(),s.active!==false]);
        for (const a of old.announcements || []) await client.query(`INSERT INTO announcements (id,title,body,type,created_at,active) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [a.id,a.title,a.body,a.type||'info',a.createdAt||new Date().toISOString(),a.active!==false]);
        for (const t of old.tasks || []) await client.query(`INSERT INTO tasks (id,title,xp,created_at,active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [t.id,t.title,t.xp||10,t.createdAt||new Date().toISOString(),t.active!==false]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      console.log('Legacy db.json import check completed.');
    } catch (e) { console.error('Legacy db.json import skipped:', e.message); }
  }

  const admin = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (!admin.rowCount) {
    await pool.query(`INSERT INTO users (id,name,username,password,role,xp,level,streak,badges,ai_count,token,done) VALUES ($1,$2,$3,$4,'admin',0,1,0,$5::jsonb,0,NULL,'[]'::jsonb)`, [id('usr'),'7A6 Admin',process.env.ADMIN_USER||'admin',pw(process.env.ADMIN_PASSWORD||'change-me-now'),JSON.stringify(['founder'])]);
    console.log('Created admin account:', process.env.ADMIN_USER || 'admin');
  }
}

async function auth(req,res,next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({error:'Vui lòng đăng nhập'});
    const q = await pool.query('SELECT * FROM users WHERE token=$1 LIMIT 1', [token]);
    if (!q.rowCount) return res.status(401).json({error:'Vui lòng đăng nhập'});
    req.user = rowUser(q.rows[0]);
    req.user._db = q.rows[0];
    next();
  } catch (e) { console.error(e); res.status(500).json({error:'Lỗi máy chủ'}); }
}
function admin(req,res,next) { if (req.user.role !== 'admin') return res.status(403).json({error:'Chỉ Admin mới có quyền'}); next(); }

app.disable('x-powered-by');
app.use((q,r,next)=>{r.setHeader('X-Content-Type-Options','nosniff');r.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next()});
app.use(rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false}));
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/health', async (q,r)=>{ try { await pool.query('SELECT 1'); r.json({ok:true,service:'7A6 Study Bot',database:'postgres'}); } catch { r.status(503).json({ok:false,error:'Database unavailable'}); } });

app.post('/api/register', async (q,r)=>{
  try {
    const {name,username,password}=q.body;
    if(!name||!username||!password||password.length<6)return r.status(400).json({error:'Vui lòng điền đủ thông tin; mật khẩu ít nhất 6 ký tự'});
    const u={id:id('usr'),name:String(name).slice(0,40),username:String(username).slice(0,30),password:pw(password),role:'student',xp:0,level:1,streak:0,lastCheckin:null,badges:['newbie'],aiCount:0,aiDate:today(),token:crypto.randomBytes(32).toString('hex'),done:[]};
    const x=await pool.query(`INSERT INTO users (id,name,username,password,role,xp,level,streak,badges,ai_count,ai_date,token,done) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb) RETURNING *`,[u.id,u.name,u.username,u.password,u.role,u.xp,u.level,u.streak,JSON.stringify(u.badges),u.aiCount,u.aiDate,u.token,JSON.stringify(u.done)]);
    r.json({token:u.token,user:clean(rowUser(x.rows[0]))});
  } catch(e) { if(e.code==='23505') return r.status(409).json({error:'Tài khoản đã tồn tại'}); console.error(e); r.status(500).json({error:'Không thể tạo tài khoản'}); }
});

app.post('/api/login', async (q,r)=>{try{const username=String(q.body.username||'').trim();const x=await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[username]);const u=rowUser(x.rows[0]);if(!u||!okpw(String(q.body.password||''),u.password))return r.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});u.token=crypto.randomBytes(32).toString('hex');await pool.query('UPDATE users SET token=$1 WHERE id=$2',[u.token,u.id]);r.json({token:u.token,user:clean(u)});}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});
app.post('/api/logout',auth,async(q,r)=>{await pool.query('UPDATE users SET token=NULL WHERE id=$1',[q.user.id]);r.json({ok:true})});
app.get('/api/me',auth,(q,r)=>r.json(clean(q.user)));

app.post('/api/checkin',auth,async(q,r)=>{try{if(q.user.lastCheckin===today())return r.status(400).json({error:'Bạn đã điểm danh hôm nay'});const y=new Date(Date.now()-86400000).toISOString().slice(0,10);q.user.streak=q.user.lastCheckin===y?q.user.streak+1:1;q.user.lastCheckin=today();xp(q.user,25);if(q.user.streak>=7&&!q.user.badges.includes('week'))q.user.badges.push('week');await pool.query('UPDATE users SET streak=$1,last_checkin=$2,xp=$3,level=$4,badges=$5::jsonb WHERE id=$6',[q.user.streak,q.user.lastCheckin,q.user.xp,q.user.level,JSON.stringify(q.user.badges),q.user.id]);r.json({message:'+25 XP · Điểm danh thành công',user:clean(q.user)});}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});

app.get('/api/dashboard',auth,async(q,r)=>{try{const d=today();const [s,a,t,l]=await Promise.all([pool.query("SELECT * FROM schedules WHERE active<>false AND date >= $1 ORDER BY date,time LIMIT 10",[d]),pool.query('SELECT * FROM announcements WHERE active<>false ORDER BY created_at DESC LIMIT 8'),pool.query('SELECT * FROM tasks WHERE active<>false'),pool.query("SELECT * FROM users WHERE role='student' ORDER BY xp DESC LIMIT 10")]);r.json({user:clean(q.user),schedules:s.rows.map(rowSchedule),announcements:a.rows.map(rowAnnouncement),tasks:t.rows.map(rowTask),leaders:l.rows.map(x=>clean(rowUser(x)))});}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});

app.post('/api/tasks/:id/complete',auth,async(q,r)=>{try{const t=await pool.query('SELECT * FROM tasks WHERE id=$1',[q.params.id]);if(!t.rowCount)return r.status(404).json({error:'Không tìm thấy nhiệm vụ'});const task=rowTask(t.rows[0]);q.user.done=q.user.done||[];const k=task.id+':'+today();if(q.user.done.includes(k))return r.status(400).json({error:'Đã hoàn thành nhiệm vụ hôm nay'});q.user.done.push(k);xp(q.user,Number(task.xp)||10);await pool.query('UPDATE users SET done=$1::jsonb,xp=$2,level=$3 WHERE id=$4',[JSON.stringify(q.user.done),q.user.xp,q.user.level,q.user.id]);r.json({message:`+${task.xp} XP`,user:clean(q.user)});}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});
app.get('/api/leaderboard',auth,async(q,r)=>{const x=await pool.query("SELECT * FROM users WHERE role='student' ORDER BY xp DESC LIMIT 50");r.json(x.rows.map(v=>clean(rowUser(v))));});

const ail=rateLimit({windowMs:60000,max:8,message:{error:'Bạn đang gửi quá nhanh. Chờ một chút nhé.'}});
app.post('/api/ai',auth,ail,async(q,r)=>{try{if(!OpenAI||!process.env.OPENAI_API_KEY)return r.status(503).json({error:'AI chưa được cấu hình trên server'});if(q.user.aiDate!==today()){q.user.aiDate=today();q.user.aiCount=0}if(q.user.aiCount>=30)return r.status(429).json({error:'Bạn đã dùng 30 lượt AI hôm nay'});const m=String(q.body.message||'').trim().slice(0,5000);if(!m)return r.status(400).json({error:'Hãy nhập câu hỏi'});q.user.aiCount++;await pool.query('UPDATE users SET ai_count=$1,ai_date=$2 WHERE id=$3',[q.user.aiCount,today(),q.user.id]);const c=new OpenAI({apiKey:process.env.OPENAI_API_KEY});const z=await c.responses.create({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',instructions:'Bạn là 7A6 Study Bot, trợ lý học tập cho học sinh THCS. Giải thích dễ hiểu, có bước làm, khuyến khích tự suy nghĩ. Không làm bài kiểm tra thay học sinh.',input:m});xp(q.user,5);await pool.query('UPDATE users SET xp=$1,level=$2 WHERE id=$3',[q.user.xp,q.user.level,q.user.id]);r.json({answer:z.output_text||'Chưa có câu trả lời.',user:clean(q.user)});}catch(e){console.error('AI error:',e);r.status(500).json({error:'AI đang bận, hãy thử lại sau'});}});

app.use('/api/admin',auth,admin);
app.get('/api/admin/stats',async(q,r)=>{const [u,s,a,t]=await Promise.all([pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='student'"),pool.query('SELECT COUNT(*)::int AS n FROM schedules'),pool.query('SELECT COUNT(*)::int AS n FROM announcements'),pool.query('SELECT COUNT(*)::int AS n FROM tasks')]);r.json({users:u.rows[0].n,schedules:s.rows[0].n,announcements:a.rows[0].n,tasks:t.rows[0].n});});
app.post('/api/admin/schedules',async(q,r)=>{try{const b=q.body;if(!b.title||!b.date)return r.status(400).json({error:'Thiếu tiêu đề hoặc ngày'});const x={id:id('sch'),title:String(b.title).slice(0,100),subject:String(b.subject||'').slice(0,40),date:b.date,time:String(b.time||''),room:String(b.room||''),teacher:String(b.teacher||''),note:String(b.note||'').slice(0,300),createdAt:new Date().toISOString(),active:true};await pool.query('INSERT INTO schedules (id,title,subject,date,time,room,teacher,note,created_at,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[x.id,x.title,x.subject,x.date,x.time,x.room,x.teacher,x.note,x.createdAt,true]);r.json(x);}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});
app.delete('/api/admin/schedules/:id',async(q,r)=>{await pool.query('DELETE FROM schedules WHERE id=$1',[q.params.id]);r.json({ok:true});});
app.post('/api/admin/announcements',async(q,r)=>{try{const b=q.body;if(!b.title||!b.body)return r.status(400).json({error:'Thiếu tiêu đề hoặc nội dung'});const x={id:id('ann'),title:String(b.title).slice(0,120),body:String(b.body).slice(0,1000),type:b.type||'info',createdAt:new Date().toISOString(),active:true};await pool.query('INSERT INTO announcements (id,title,body,type,created_at,active) VALUES ($1,$2,$3,$4,$5,$6)',[x.id,x.title,x.body,x.type,x.createdAt,true]);r.json(x);}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});
app.delete('/api/admin/announcements/:id',async(q,r)=>{await pool.query('DELETE FROM announcements WHERE id=$1',[q.params.id]);r.json({ok:true});});
app.post('/api/admin/tasks',async(q,r)=>{try{const b=q.body;if(!b.title)return r.status(400).json({error:'Thiếu tên nhiệm vụ'});const x={id:id('task'),title:String(b.title).slice(0,120),xp:Math.min(100,Math.max(1,Number(b.xp)||10)),createdAt:new Date().toISOString(),active:true};await pool.query('INSERT INTO tasks (id,title,xp,created_at,active) VALUES ($1,$2,$3,$4,$5)',[x.id,x.title,x.xp,x.createdAt,true]);r.json(x);}catch(e){console.error(e);r.status(500).json({error:'Lỗi máy chủ'});}});
app.delete('/api/admin/tasks/:id',async(q,r)=>{await pool.query('DELETE FROM tasks WHERE id=$1',[q.params.id]);r.json({ok:true});});
app.get('/api/admin/users',async(q,r)=>{const x=await pool.query("SELECT * FROM users WHERE role='student'");r.json(x.rows.map(v=>clean(rowUser(v))));});
app.post('/api/admin/users/:id/xp',async(q,r)=>{const x=await pool.query('SELECT * FROM users WHERE id=$1',[q.params.id]);if(!x.rowCount)return r.status(404).json({error:'Không tìm thấy'});const u=rowUser(x.rows[0]);xp(u,Math.max(-1000,Math.min(1000,Number(q.body.xp)||0)));await pool.query('UPDATE users SET xp=$1,level=$2 WHERE id=$3',[u.xp,u.level,u.id]);r.json(clean(u));});

app.get('/{*splat}',(q,r)=>r.sendFile(path.join(__dirname,'public','index.html')));

async function start() {
  await initDb();
  const server = app.listen(PORT,'0.0.0.0',()=>console.log('7A6 Study Bot V1 PRO + PostgreSQL on '+PORT));
  const shutdown=async()=>{server.close(()=>pool.end().finally(()=>process.exit(0)));};
  process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
}
start().catch(err=>{console.error('Startup failed:',err);process.exit(1);});
