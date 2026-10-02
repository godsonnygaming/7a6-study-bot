
const app = document.getElementById('app');
let token = localStorage.getItem('7a6_token') || '';
let state = null;
const $ = (s, r=document) => r.querySelector(s);
const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmtDate = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'}) : '';
const api = async (url, opts={}) => {
  const o={...opts,headers:{...(opts.headers||{}),...(token?{Authorization:`Bearer ${token}`}:{})}};
  if(o.body && typeof o.body==='object'){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body);}
  const r=await fetch(url,o); const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
  return j;
};
function toast(message,type='info'){
  const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message;
  document.body.append(el); requestAnimationFrame(()=>el.classList.add('show')); setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),220)},2800);
}
function icon(name){return ({home:'⌂',calendar:'◫',tasks:'✓',trophy:'♛',spark:'✦',settings:'⚙',logout:'↪',bolt:'ϟ',users:'♙'})[name]||'•'}
function auth(){
  app.innerHTML=`<main class="auth-page"><div class="aurora"></div><section class="auth-card">
    <div class="brand big"><div class="brand-mark">7A6</div><div><strong>Study Bot</strong><span>SMART LEARNING OS</span></div></div>
    <div class="auth-copy"><span class="eyebrow">V2 / PRO</span><h1>Học thông minh.<br><em>Tiến bộ mỗi ngày.</em></h1><p>Trung tâm học tập dành cho 7A6 — XP, streak, nhiệm vụ và trợ lý AI trong một nơi.</p></div>
    <div class="auth-tabs"><button class="active" data-mode="login">Đăng nhập</button><button data-mode="register">Tạo tài khoản</button></div>
    <form id="auth-form" class="form"></form><div class="auth-foot">Dữ liệu được lưu an toàn trên PostgreSQL.</div>
  </section></main>`;
  let mode='login';
  const draw=()=>{
    $('.auth-tabs button.active')?.classList.remove('active'); $(`.auth-tabs button[data-mode="${mode}"]`).classList.add('active');
    $('#auth-form').innerHTML=mode==='login'
      ? `<label>Tên tài khoản<input name="username" autocomplete="username" placeholder="Ví dụ: nguyenan" required></label><label>Mật khẩu<input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required></label><button class="primary wide" type="submit">Vào Study Bot <span>→</span></button>`
      : `<label>Tên hiển thị<input name="name" autocomplete="name" placeholder="Nguyễn Văn A" required></label><label>Tên tài khoản<input name="username" autocomplete="username" placeholder="nguyenvana" required></label><label>Mật khẩu<input name="password" type="password" autocomplete="new-password" placeholder="Ít nhất 6 ký tự" minlength="6" required></label><button class="primary wide" type="submit">Tạo tài khoản <span>→</span></button>`;
  };
  $('.auth-tabs').onclick=e=>{const b=e.target.closest('button[data-mode]');if(!b)return;mode=b.dataset.mode;draw()};
  $('#auth-form').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget; const button=form.querySelector('button'); button.disabled=true;button.innerHTML='<span class="spinner"></span> Đang xử lý…';
    try{
      const body=Object.fromEntries(new FormData(form));
      const x=await api(mode==='login'?'/api/login':'/api/register',{method:'POST',body});
      token=x.token;localStorage.setItem('7a6_token',token);await load();
    }catch(err){toast(err.message,'error');button.disabled=false;button.innerHTML=mode==='login'?'Vào Study Bot →':'Tạo tài khoản →';}
  };
  draw();
}
async function load(){
  try{state=await api('/api/dashboard');dashboard();}
  catch(e){token='';localStorage.removeItem('7a6_token');auth();}
}
function statCard(label,value,sub,iconText){
  return `<div class="stat-card"><div class="stat-icon">${iconText}</div><div><span>${label}</span><strong>${value}</strong><small>${sub}</small></div></div>`;
}
function dashboard(){
  const u=state.user;
  const pct=Math.min(100,((u.xp%250)/250)*100);
  app.innerHTML=`<div class="app-shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">7A6</div><div><strong>Study Bot</strong><span>V2 PRO</span></div></div>
      <div class="side-label">WORKSPACE</div><nav><button class="side active" data-view="home">${icon('home')}<span>Tổng quan</span></button><button class="side" data-view="schedule">${icon('calendar')}<span>Lịch học</span></button><button class="side" data-view="tasks">${icon('tasks')}<span>Nhiệm vụ</span></button><button class="side" data-view="rank">${icon('trophy')}<span>Xếp hạng</span></button></nav>
      ${u.role==='admin'?`<div class="side-label admin-label">ADMIN</div><button class="side" data-view="admin">${icon('settings')}<span>Quản trị</span></button>`:''}
      <div class="side-bottom"><div class="mini-user"><div class="avatar">${esc(u.name[0]||'7')}</div><div><b>${esc(u.name)}</b><span>Level ${u.level} · ${u.xp} XP</span></div></div><button class="logout" id="logout">${icon('logout')}<span>Đăng xuất</span></button></div>
    </aside>
    <main class="main"><header class="topbar"><button class="mobile-menu" id="menu">☰</button><div><span class="eyebrow">7A6 / ${u.role==='admin'?'ADMIN':'STUDENT'}</span><h2 id="page-title">Tổng quan</h2></div><div class="top-actions"><span class="online"><i></i> ONLINE</span><div class="top-avatar">${esc(u.name[0]||'7')}</div></div></header><div id="content"></div></main>
  </div>`;
  bindShell(); renderHome();
}
function renderHome(){
  const u=state.user;
  $('#page-title').textContent='Tổng quan';
  const pct=Math.min(100,((u.xp%250)/250)*100), next=250-(u.xp%250);
  $('#content').innerHTML=`<div class="content">
    <section class="welcome"><div><span class="eyebrow">THỨC DẬY VÀ HỌC 🚀</span><h1>Xin chào, ${esc(u.name)}.</h1><p>Hôm nay bạn muốn chinh phục điều gì?</p></div><button class="primary checkin" id="checkin"><span>ϟ</span> Điểm danh <b>+25 XP</b></button></section>
    <div class="stats">${statCard('TỔNG XP',u.xp,`${next} XP tới level tiếp theo`,'✦')}${statCard('STREAK',u.streak, 'ngày liên tiếp','🔥')}${statCard('LEVEL',u.level,'cấp độ hiện tại','◆')}${statCard('AI HÔM NAY',`${u.aiToday}/30`,'lượt sử dụng','✧')}</div>
    <div class="progress-card"><div class="progress-head"><div><span>LEVEL ${u.level}</span><strong>Tiến trình cấp độ</strong></div><b>${Math.round(pct)}%</b></div><div class="xpbar"><i style="width:${pct}%"></i></div><div class="progress-foot"><span>${u.xp%250} / 250 XP</span><span>+250 XP = Level ${u.level+1}</span></div></div>
    <div class="dashboard-grid"><section class="panel ai-panel"><div class="panel-head"><div><span class="eyebrow">AI LEARNING ENGINE</span><h3>Trợ lý học tập</h3></div><span class="live-dot">● LIVE</span></div><div class="chat" id="chat"><div class="msg bot"><span class="msg-icon">✦</span><div><b>7A6 AI</b><p>Chào ${esc(u.name)}! Mình có thể giúp bạn học Toán, Văn, KHTN, Tiếng Anh hoặc lập kế hoạch học.</p></div></div></div><div class="suggests"><button data-q="Giải thích định luật Ohm thật dễ hiểu">Định luật Ohm</button><button data-q="Lập kế hoạch học Toán trong 7 ngày">Kế hoạch 7 ngày</button><button data-q="Cho mình 5 câu Toán lớp 7 để luyện">Luyện Toán</button></div><div class="chatbar"><input id="q" maxlength="5000" placeholder="Hỏi bất cứ điều gì về việc học…"><button class="primary" id="ask">Gửi ↗</button></div></section>
      <div class="right-stack"><section class="panel"><div class="panel-head"><div><span class="eyebrow">TODAY</span><h3>Nhiệm vụ</h3></div><button class="ghost" data-view="tasks">Xem tất cả →</button></div>${taskPreview()}</section>
      <section class="panel"><div class="panel-head"><div><span class="eyebrow">RANKING</span><h3>Top học sinh</h3></div><button class="ghost" data-view="rank">Bảng đầy đủ →</button></div>${leadersPreview()}</section></div></div>
  </div>`;
  bindHome();
}
function taskPreview(){
  return state.tasks.slice(0,4).map(t=>`<div class="task-row"><div class="task-check">✓</div><div class="task-info"><b>${esc(t.title)}</b><span>Thưởng XP</span></div><button class="xp-btn task-btn" data-id="${t.id}">+${t.xp}</button></div>`).join('')||'<div class="empty">Chưa có nhiệm vụ.</div>';
}
function leadersPreview(){
  return state.leaders.slice(0,5).map((x,i)=>`<div class="leader-row"><span class="rank r${i+1}">#${i+1}</span><div class="avatar sm">${esc(x.name[0]||'7')}</div><b>${esc(x.name)}</b><span>${x.xp} XP</span></div>`).join('')||'<div class="empty">Chưa có dữ liệu.</div>';
}
function bindShell(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
  $('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{} token='';localStorage.removeItem('7a6_token');auth();};
  $('#menu').onclick=()=>$('.sidebar').classList.toggle('open');
}
function navigate(view){
  $('.sidebar')?.classList.remove('open');
  document.querySelectorAll('.side[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if(view==='home')renderHome(); if(view==='schedule')renderSchedule(); if(view==='tasks')renderTasks(); if(view==='rank')renderRank(); if(view==='admin')renderAdmin();
}
function bindHome(){
  $('#checkin').onclick=async()=>{const b=$('#checkin');b.disabled=true;try{const x=await api('/api/checkin',{method:'POST'});toast(x.message,'success');state.user=x.user;renderHome();}catch(e){toast(e.message,'error');b.disabled=false;}};
  $('#ask').onclick=ask;$('#q').onkeydown=e=>{if(e.key==='Enter')ask()};
  document.querySelectorAll('.suggests button').forEach(b=>b.onclick=()=>{$('#q').value=b.dataset.q;$('#q').focus()});
  document.querySelectorAll('.task-btn').forEach(b=>b.onclick=()=>completeTask(b.dataset.id));
  document.querySelectorAll('[data-view]').forEach(b=>{if(!b.onclick)b.onclick=()=>navigate(b.dataset.view)});
}
async function ask(){
  const input=$('#q'), message=input.value.trim(); if(!message)return;
  const chat=$('#chat'); chat.innerHTML+=`<div class="msg me"><div><b>Bạn</b><p>${esc(message)}</p></div></div><div class="msg bot pending"><span class="msg-icon">✦</span><div><b>7A6 AI</b><p>Đang suy nghĩ…</p></div></div>`;
  input.value='';chat.scrollTop=chat.scrollHeight;const pending=chat.querySelector('.pending:last-child');
  try{const x=await api('/api/ai',{method:'POST',body:{message}});pending.classList.remove('pending');pending.querySelector('p').textContent=x.answer;state.user=x.user;chat.scrollTop=chat.scrollHeight;}
  catch(e){pending.querySelector('p').textContent=e.message;pending.classList.remove('pending');}
}
async function completeTask(id){try{const x=await api(`/api/tasks/${encodeURIComponent(id)}/complete`,{method:'POST'});toast(x.message,'success');state.user=x.user;await load();}catch(e){toast(e.message,'error')}}
function renderSchedule(){
  $('#page-title').textContent='Lịch học'; const groups={}; state.schedules.forEach(x=>(groups[x.date]??=[]).push(x));
  $('#content').innerHTML=`<div class="content"><div class="section-title"><div><span class="eyebrow">UPCOMING</span><h1>Lịch học sắp tới</h1></div></div><div class="schedule-grid">${Object.keys(groups).map(d=>`<section class="panel day"><div class="day-head"><strong>${fmtDate(d)}</strong><span>${groups[d].length} tiết</span></div>${groups[d].map(x=>`<div class="schedule-row"><div class="time">${esc(x.time||'—')}</div><div><b>${esc(x.title)}</b><span>${esc(x.subject)} · ${esc(x.teacher||'Chưa cập nhật')}</span>${x.room?`<small>Phòng ${esc(x.room)}</small>`:''}</div></div>`).join('')}</section>`).join('')||'<div class="empty">Chưa có lịch học.</div>'}</div></div>`;
}
function renderTasks(){
  $('#page-title').textContent='Nhiệm vụ'; $('#content').innerHTML=`<div class="content"><div class="section-title"><div><span class="eyebrow">DAILY MISSIONS</span><h1>Nhiệm vụ học tập</h1><p>Hoàn thành nhiệm vụ để tích XP.</p></div></div><div class="task-grid">${state.tasks.map(t=>`<section class="panel mission"><div class="mission-icon">✦</div><div><span class="eyebrow">MISSION</span><h3>${esc(t.title)}</h3><p>Hoàn thành nhiệm vụ hôm nay để nhận thưởng.</p></div><button class="xp-btn task-btn" data-id="${t.id}">+${t.xp} XP</button></section>`).join('')||'<div class="empty">Admin chưa tạo nhiệm vụ.</div>'}</div></div>`;
  document.querySelectorAll('.task-btn').forEach(b=>b.onclick=()=>completeTask(b.dataset.id));
}
function renderRank(){
  $('#page-title').textContent='Xếp hạng'; $('#content').innerHTML=`<div class="content"><div class="section-title"><div><span class="eyebrow">LEADERBOARD</span><h1>Bảng xếp hạng</h1><p>Thứ hạng được tính theo XP.</p></div></div><section class="panel ranking">${state.leaders.map((x,i)=>`<div class="leader-big"><span class="rank r${i+1}">#${i+1}</span><div class="avatar">${esc(x.name[0]||'7')}</div><div><b>${esc(x.name)}</b><span>Level ${x.level}</span></div><strong>${x.xp}<small> XP</small></strong></div>`).join('')||'<div class="empty">Chưa có học sinh.</div>'}</section></div>`;
}
function renderAdmin(){
  $('#page-title').textContent='Quản trị'; $('#content').innerHTML=`<div class="content"><div class="section-title"><div><span class="eyebrow">ADMIN CONTROL CENTER</span><h1>Điều hành 7A6</h1><p>Tạo nội dung và quản lý XP.</p></div></div><div id="adminStats" class="stats"></div>
  <div class="admin-grid"><section class="panel"><div class="panel-head"><h3>Đăng lịch học</h3></div><form id="sf" class="form"><input name="title" placeholder="Tên tiết học" required><div class="two"><input name="subject" placeholder="Môn học"><input name="date" type="date" required></div><div class="two"><input name="time" placeholder="07:00"><input name="room" placeholder="Phòng"></div><input name="teacher" placeholder="Giáo viên"><input name="note" placeholder="Ghi chú"><button class="primary">Đăng lịch</button></form></section>
  <section class="panel"><div class="panel-head"><h3>Thông báo</h3></div><form id="af" class="form"><input name="title" placeholder="Tiêu đề" required><textarea name="body" rows="5" placeholder="Nội dung" required></textarea><button class="primary">Đăng thông báo</button></form></section>
  <section class="panel"><div class="panel-head"><h3>Nhiệm vụ XP</h3></div><form id="tf" class="form"><input name="title" placeholder="Tên nhiệm vụ" required><input name="xp" type="number" min="1" max="100" value="10"><button class="primary">Tạo nhiệm vụ</button></form></section></div></div>`;
  api('/api/admin/stats').then(s=>{$('#adminStats').innerHTML=statCard('HỌC SINH',s.users,'tài khoản','♙')+statCard('LỊCH',s.schedules,'mục','◫')+statCard('THÔNG BÁO',s.announcements,'bài','◉')+statCard('NHIỆM VỤ',s.tasks,'mission','✦')});
  $('#sf').onsubmit=adminForm('/api/admin/schedules','Đã đăng lịch');$('#af').onsubmit=adminForm('/api/admin/announcements','Đã đăng thông báo');$('#tf').onsubmit=adminForm('/api/admin/tasks','Đã tạo nhiệm vụ');
}
function adminForm(url,msg){return async e=>{e.preventDefault();try{await api(url,{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget))});toast(msg,'success');await load();navigate('admin');}catch(err){toast(err.message,'error')}}}
if(token) load(); else auth();
