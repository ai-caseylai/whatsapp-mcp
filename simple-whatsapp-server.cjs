const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;
const MAX_SESSIONS = 10;

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6d2RldHNycWplcG94bW9jb3JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDIwNDgwOSwiZXhwIjoyMDg1NzgwODA5fQ.nbq_NKxfOc8exmEHZ6juJkSLE9SRsXtmMEEoig6oqAE';

const sessions = new Map();
let sessionCounter = 0;

// 启动时自动恢复已保存的会话
function restoreSessions() {
  const authDir = path.join(__dirname, 'auth_info');
  if (!fs.existsSync(authDir)) return;
  
  const dirs = fs.readdirSync(authDir, { withFileTypes: true })
    .filter(d => d.isDirectory());
  
  for (const dir of dirs) {
    const dirPath = path.join(authDir, dir.name);
    const credsPath = path.join(dirPath, 'creds.json');
    
    if (fs.existsSync(credsPath)) {
      console.log('[Restore] Found creds in:', dir.name);
      
      let sessionId = dir.name;
      let phoneNumber = null;
      
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        // 提取电话号码，格式如: 85297188675:89@s.whatsapp.net
        const match = creds.me?.id?.match(/(\d+):/);
        if (match) phoneNumber = match[1];
      } catch(e) {}
      
      if (!sessionId.startsWith('sess_')) {
        sessionId = 'restored_' + (phoneNumber || sessionId.slice(0, 8));
      }
      
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          status: 'connected',
          qrPath: null,
          phoneNumber: phoneNumber,
          process: startMCP(sessionId, true)
        });
        sessionCounter++;
        console.log('[Restore] Session:', sessionId, phoneNumber || '');
      }
    }
  }
}

// 管理首页
function getHomeHTML() {
  let devicesHtml = '';
  for (const [id, session] of sessions) {
    const statusColor = session.status === 'connected' ? '#4caf50' : 
                       session.status === 'waiting_qr' ? '#ff9800' : '#999';
    const statusText = session.status === 'connected' ? '已连接' : 
                      session.status === 'waiting_qr' ? '等待扫码' : '连接中';
    
    devicesHtml += '<div style="background:white;border-radius:12px;padding:15px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;">' +
      '<div>' +
      '<div style="font-size:16px;font-weight:600;">📱 ' + (session.phoneNumber || '设备 #' + id.slice(-6)) + '</div>' +
      '<div style="color:' + statusColor + ';font-size:13px;margin-top:4px;">' + statusText + '</div>' +
      '</div>' +
      '<div>' +
      '<a href="/device/' + id + '" style="padding:8px 16px;background:#667eea;color:white;text-decoration:none;border-radius:6px;font-size:14px;">查看</a>' +
      '</div>' +
      '</div>';
  }
  
  if (sessions.size === 0) {
    devicesHtml = '<p style="text-align:center;color:white;opacity:.7;padding:40px;">暂无设备，点击下方按钮添加</p>';
  }
  
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>WhatsApp MCP 管理</title><style>' +
    'body{font-family:system-ui,-apple-system,sans-serif;background:#667eea;min-height:100vh;margin:0;padding:20px}' +
    '.container{max-width:500px;margin:0 auto}' +
    '.header{text-align:center;color:white;margin-bottom:30px}' +
    '.header h1{margin:0;font-size:24px}' +
    '.btn-add{width:100%;padding:15px;background:#4caf50;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;margin-bottom:20px}' +
    '.btn-add:disabled{background:#ccc}' +
    '.stats{text-align:center;color:white;opacity:.8;font-size:14px}' +
    '</style></head><body><div class="container"><div class="header"><h1>📱 WhatsApp 设备管理</h1><p>最多 ' + MAX_SESSIONS + ' 个设备</p></div>' +
    '<button class="btn-add" onclick="addDevice()" ' + (sessions.size >= MAX_SESSIONS ? 'disabled' : '') + '>➕ 添加新设备</button>' +
    devicesHtml +
    '<p class="stats">' + sessions.size + ' / ' + MAX_SESSIONS + '</p></div>' +
    '<script>function addDevice(){fetch("/api/sessions",{method:"POST"}).then(r=>r.json()).then(d=>{if(d.success)location.href="/device/"+d.sessionId;});}</script></body></html>';
}

// 设备连接页
function getDeviceHTML(sessionId) {
  const session = sessions.get(sessionId);
  
  if (!session) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>设备未找到</title><style>' +
      'body{font-family:system-ui,sans-serif;background:#f5f5f5;min-height:100vh;margin:0;display:flex;justify-content:center;align-items:center}' +
      '.box{background:white;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}' +
      '.icon{font-size:48px;margin-bottom:16px} .text{color:#666;margin-bottom:20px}' +
      '.btn{padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;display:inline-block}' +
      '</style></head><body><div class="box"><div class="icon">⚠️</div><div style="font-size:20px;font-weight:bold;margin-bottom:8px">设备未找到</div>' +
      '<div class="text">Session ID 错误或已过期<br>' + sessionId + '</div><a href="/admin" class="btn">返回管理页</a></div></body></html>';
  }
  
  if (session.status === 'connected') {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>已连接</title><style>' +
      'body{font-family:system-ui,sans-serif;background:#667eea;min-height:100vh;margin:0;display:flex;justify-content:center;align-items:center}' +
      '.box{background:white;padding:40px;border-radius:16px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.2)}' +
      '</style></head><body><div class="box"><div style="font-size:64px">✅</div><h2 style="color:#4caf50">连接成功</h2>' +
      '<p>' + (session.phoneNumber || '') + '</p><a href="/admin" style="padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;display:inline-block;margin-top:10px">← 返回管理页</a></div></body></html>';
  }
  
  if (session.status === 'error') {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>连接失败</title><style>' +
      'body{font-family:system-ui,sans-serif;background:#f5f5f5;min-height:100vh;margin:0;display:flex;justify-content:center;align-items:center}' +
      '.box{background:white;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}' +
      '</style></head><body><div class="box"><div style="font-size:64px">❌</div><h2 style="color:#f44336">连接失败</h2>' +
      '<a href="/admin" style="padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;display:inline-block">返回管理页</a></div></body></html>';
  }
  
  // 等待扫码
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>扫码连接</title><style>' +
    'body{font-family:system-ui,sans-serif;background:#667eea;min-height:100vh;margin:0;display:flex;justify-content:center;align-items:center;padding:20px}' +
    '.box{background:white;padding:30px;border-radius:16px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.2);max-width:320px;width:100%}' +
    '.qr{width:100%;max-width:260px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,.15)}' +
    '.timer{color:#ff9800;font-size:18px;font-weight:bold;margin:15px 0}' +
    '.tip{color:#666;font-size:13px;line-height:1.5}' +
    '.back{position:fixed;top:15px;left:15px;color:white;text-decoration:none;padding:10px}' +
    '</style></head><body><a href="/admin" class="back">← 返回</a><div class="box">' +
    '<h3 style="margin:0 0 15px 0">WhatsApp 扫码登录</h3>' +
    '<img class="qr" src="/qr/' + sessionId + '?t=' + Date.now() + '" id="qr">' +
    '<div class="timer" id="timer">20秒</div>' +
    '<div class="tip">打开 WhatsApp → 设置 → 链接设备<br>扫码自动更新，请在20秒内完成</div>' +
    '</div><script>' +
    'let t=20;setInterval(()=>{t--;if(t<0)t=20;document.getElementById("timer").textContent=t+"秒";},1000);' +
    'setInterval(()=>{document.getElementById("qr").src="/qr/' + sessionId + '?t="+Date.now();},3000);' +
    'setInterval(()=>{fetch("/api/sessions").then(r=>r.json()).then(d=>{const s=d.find(x=>x.id=="' + sessionId + '");if(s&&s.status=="connected")location.reload();});},3000);' +
    '</script></body></html>';
}

// 启动 MCP 进程
function startMCP(sessionId, isRestore = false) {
  const authDir = path.join(__dirname, 'auth_info', sessionId);
  fs.mkdirSync(authDir, { recursive: true });
  
  const tempPhone = 'TEMP' + Date.now().toString().slice(-10);
  
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://izwdetsrqjepoxmocore.supabase.co',
    SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    WHATSAPP_PHONE_NUMBER: tempPhone,
    USER_ID: sessionId,
    AUTH_USER_ID: sessionId
  };
  
  const mcp = spawn('node', ['dist/index.js'], { cwd: __dirname, env, stdio: ['pipe', 'pipe', 'pipe'] });
  
  const syncQR = () => {
    const session = sessions.get(sessionId);
    if (!session || session.status === 'connected') return;
    
    const mcpQrPath = path.join(__dirname, 'public', 'qr-code.png');
    const sessionQrPath = path.join(__dirname, 'public', sessionId + '.png');
    
    if (fs.existsSync(mcpQrPath)) {
      try {
        const mcpStat = fs.statSync(mcpQrPath);
        const sessionStat = fs.existsSync(sessionQrPath) ? fs.statSync(sessionQrPath) : null;
        
        if (!sessionStat || mcpStat.mtime > sessionStat.mtime) {
          fs.copyFileSync(mcpQrPath, sessionQrPath);
          session.qrPath = sessionQrPath;
          if (session.status !== 'connected') session.status = 'waiting_qr';
        }
      } catch(e) {}
    }
  };
  
  const qrInterval = setInterval(syncQR, 1000);
  
  mcp.stdout.on('data', (data) => {
    const text = data.toString();
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes('▄') || trimmed.includes('█')) continue;
      
      if (trimmed.includes('Connected successfully') || trimmed.includes("'open'")) {
        const session = sessions.get(sessionId);
        if (session) {
          session.status = 'connected';
          const match = trimmed.match(/(\d{8,15})/);
          if (match && !session.phoneNumber) {
            session.phoneNumber = match[1];
          }
          console.log('[✓] Connected:', sessionId.slice(-6), session.phoneNumber || '');
        }
      }
      
      if (trimmed.includes('[QR_SAVED]')) {
        console.log('[QR] Generated:', sessionId.slice(-6));
      }
      
      if (trimmed.length < 70) {
        console.log('[MCP ' + sessionId.slice(-6) + ']', trimmed.slice(0, 60));
      }
    }
  });
  
  mcp.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg.includes('▄') && !msg.includes('█') && msg.length < 70) {
      console.error('[MCP ' + sessionId.slice(-6) + ']', msg.slice(0, 60));
    }
  });
  
  mcp.on('exit', () => {
    clearInterval(qrInterval);
    const session = sessions.get(sessionId);
    if (session && session.status !== 'connected') {
      session.status = 'error';
      console.log('[✗] Exit:', sessionId.slice(-6));
    }
  });
  
  return mcp;
}

// API 路由
app.use(express.json());

app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({ id, phoneNumber: s.phoneNumber, status: s.status });
  }
  res.json(list);
});

app.post('/api/sessions', (req, res) => {
  if (sessions.size >= MAX_SESSIONS) {
    return res.status(400).json({ error: 'Max sessions' });
  }
  
  sessionCounter++;
  const sessionId = 'sess_' + Date.now() + '_' + sessionCounter;
  
  sessions.set(sessionId, {
    status: 'connecting',
    qrPath: null,
    phoneNumber: null,
    process: startMCP(sessionId)
  });
  
  res.json({ success: true, sessionId });
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  const session = sessions.get(id);
  if (session) {
    if (session.process) session.process.kill();
    try { fs.rmSync(path.join(__dirname, 'auth_info', id), { recursive: true, force: true }); } catch(e) {}
    try { fs.unlinkSync(path.join(__dirname, 'public', id + '.png')); } catch(e) {}
    sessions.delete(id);
  }
  res.json({ success: true });
});

app.get('/qr/:id', (req, res) => {
  const qrPath = path.join(__dirname, 'public', req.params.id + '.png');
  if (fs.existsSync(qrPath)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(qrPath);
  } else {
    res.status(404).send('QR not found');
  }
});

app.get('/device/:id', (req, res) => res.send(getDeviceHTML(req.params.id)));

app.get('/device', (req, res) => res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>缺少设备ID</title><style>' +
  'body{font-family:system-ui,sans-serif;background:#f5f5f5;min-height:100vh;margin:0;display:flex;justify-content:center;align-items:center}' +
  '.box{background:white;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}' +
  '</style></head><body><div class="box"><div style="font-size:48px">⚠️</div><h3>缺少设备 ID</h3><p style="color:#666">URL 格式: /device/&lt;session-id&gt;</p><a href="/admin" style="padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;display:inline-block">返回管理页</a></div></body></html>'));

// 管理首页 - /admin
app.get('/admin', (req, res) => res.send(getHomeHTML()));

// 根路径重定向到 /admin
app.get('/', (req, res) => res.redirect('/admin'));

// 确保目录存在
fs.mkdirSync('auth_info', { recursive: true });
fs.mkdirSync('public', { recursive: true });

// 启动时恢复会话
restoreSessions();

app.listen(PORT, '0.0.0.0', () => {
  console.log('WhatsApp MCP Server on http://0.0.0.0:' + PORT);
  console.log('Admin page: http://0.0.0.0:' + PORT + '/admin');
  console.log('Sessions restored:', sessions.size);
});
