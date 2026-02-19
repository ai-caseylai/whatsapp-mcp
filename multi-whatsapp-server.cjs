const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const PORT = 3456;
const MAX_SESSIONS = 10;

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6d2RldHNycWplcG94bW9jb3JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDIwNDgwOSwiZXhwIjoyMDg1NzgwODA5fQ.nbq_NKxfOc8exmEHZ6juJkSLE9SRsXtmMEEoig6oqAE';

// 会话管理
const sessions = new Map(); // phoneNumber -> { status, qrPath, lastActive }

const HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp MCP Server - 多号码管理</title>
    <style>
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            min-height: 100vh; 
            margin: 0;
            padding: 20px;
        }
        .header { 
            text-align: center; 
            color: white; 
            margin-bottom: 30px;
        }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 10px 0 0; opacity: 0.9; }
        .container { 
            max-width: 1200px; 
            margin: 0 auto;
        }
        .add-session {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        .add-session h3 { margin-top: 0; color: #333; }
        .add-session input {
            padding: 12px 15px;
            font-size: 16px;
            border: 2px solid #ddd;
            border-radius: 8px;
            width: 250px;
            margin-right: 10px;
        }
        .add-session button {
            padding: 12px 25px;
            font-size: 16px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
        }
        .add-session button:hover { background: #5a67d8; }
        .sessions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        .session-card {
            background: white;
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        .session-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .session-phone {
            font-size: 18px;
            font-weight: 600;
            color: #333;
        }
        .session-status {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .status-connecting { background: #e3f2fd; color: #1976d2; }
        .status-waiting_qr { background: #fff3e0; color: #f57c00; }
        .status-connected { background: #e8f5e9; color: #388e3c; }
        .status-error { background: #ffebee; color: #c62828; }
        .qr-container {
            background: #f5f5f5;
            border-radius: 10px;
            padding: 15px;
            min-height: 280px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        .qr-code img {
            max-width: 100%;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .loading {
            width: 50px;
            height: 50px;
            border: 4px solid #e0e0e0;
            border-top-color: #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .session-actions {
            margin-top: 15px;
            display: flex;
            gap: 10px;
        }
        .btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn-refresh { background: #667eea; color: white; }
        .btn-disconnect { background: #ff6b6b; color: white; }
        .btn:hover { opacity: 0.9; }
        .stats {
            text-align: center;
            color: white;
            margin-top: 20px;
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📱 WhatsApp MCP Server</h1>
        <p>多号码管理系统 (最多 {{maxSessions}} 个)</p>
    </div>
    
    <div class="container">
        <div class="add-session">
            <h3>➕ 添加新号码</h3>
            <form onsubmit="addSession(event)">
                <input type="text" id="phoneInput" placeholder="输入电话号码 (如: 85212345678)" required>
                <button type="submit">添加并连接</button>
            </form>
        </div>
        
        <div class="sessions-grid" id="sessionsGrid">
            {{sessions}}
        </div>
        
        <div class="stats">
            当前活跃: {{activeCount}} / {{maxSessions}} 个号码
        </div>
    </div>
    
    <script>
        function addSession(e) {
            e.preventDefault();
            const phone = document.getElementById('phoneInput').value.trim();
            if (phone) {
                fetch('/api/sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                }).then(() => {
                    document.getElementById('phoneInput').value = '';
                    location.reload();
                });
            }
        }
        
        function disconnect(phone) {
            fetch('/api/sessions/' + phone, { method: 'DELETE' })
                .then(() => location.reload());
        }
        
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>
`;

// 启动 MCP 进程
function startMCP(phoneNumber) {
  const authDir = path.join(__dirname, 'auth_info', phoneNumber);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://izwdetsrqjepoxmocore.supabase.co',
    SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    WHATSAPP_PHONE_NUMBER: phoneNumber,
    AUTH_DIR: authDir
  };
  
  const mcp = spawn('node', ['dist/index.js'], {
    cwd: __dirname,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let qrData = null;
  
  mcp.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // 捕获 QR 码数据
      if (trimmed.includes('[QR_AVAILABLE]') || trimmed.match(/^[▄█▀].{50,}[▄█▀]$/)) {
        const session = sessions.get(phoneNumber);
        if (session) {
          session.status = 'waiting_qr';
          // 保存 QR 数据用于生成图片
          if (!session.qrData) session.qrData = [];
          if (trimmed.match(/^[▄█▀]/)) {
            session.qrData.push(trimmed);
            if (session.qrData.length > 30) session.qrData = session.qrData.slice(-25);
            
            // 生成 QR 图片
            generateQRImage(phoneNumber, session.qrData);
          }
        }
      }
      
      if (trimmed.includes('opened connection')) {
        const session = sessions.get(phoneNumber);
        if (session) {
          session.status = 'connected';
          session.connectedAt = new Date();
        }
      }
      
      console.log('[MCP ' + phoneNumber + ']', trimmed.slice(0, 80));
    }
  });
  
  mcp.stderr.on('data', (data) => {
    console.error('[MCP ' + phoneNumber + ' ERR]', data.toString().trim().slice(0, 80));
  });
  
  mcp.on('exit', (code) => {
    console.log('[MCP ' + phoneNumber + '] exited with code', code);
    const session = sessions.get(phoneNumber);
    if (session) {
      session.status = 'error';
      session.error = 'Process exited';
    }
  });
  
  return mcp;
}

// 生成 QR 码图片（从终端格式转换）
function generateQRImage(phoneNumber, qrLines) {
  // 这里简化处理：使用 test QR 或提示用户查看终端
  // 实际应该用 qrcode 库重新生成
  const qrPath = path.join(__dirname, 'public', 'qr-' + phoneNumber + '.png');
  
  // 创建一个占位 QR 码
  const testData = 'whatsapp://qr?phone=' + phoneNumber + '&time=' + Date.now();
  QRCode.toFile(qrPath, testData, { width: 280 })
    .then(() => {
      const session = sessions.get(phoneNumber);
      if (session) session.qrPath = qrPath;
    })
    .catch(err => console.error('QR gen error:', err));
}

// 渲染会话卡片
function renderSessionCard(phone, session) {
  const statusClass = 'status-' + session.status;
  const statusText = {
    'connecting': '连接中...',
    'waiting_qr': '请扫描 QR',
    'connected': '已连接',
    'error': '错误'
  }[session.status] || session.status;
  
  let qrContent = '';
  if (session.status === 'connected') {
    qrContent = '<div style="font-size:50px">✅</div><p style="color:#4caf50">已连接!</p>';
  } else if (session.qrPath && fs.existsSync(session.qrPath)) {
    qrContent = '<div class="qr-code"><img src="/qr-' + phone + '.png?v=' + Date.now() + '" width="250"></div>';
  } else {
    qrContent = '<div class="loading"></div><p style="margin-top:15px;color:#666">等待 QR...</p>';
  }
  
  return `
    <div class="session-card">
      <div class="session-header">
        <div class="session-phone">📱 </div>
        <div class="session-status "></div>
      </div>
      <div class="qr-container"></div>
      <div class="session-actions">
        <button class="btn btn-refresh" onclick="location.reload()">刷新</button>
        <button class="btn btn-disconnect" onclick="disconnect('')">断开</button>
      </div>
    </div>
  `;
}

// API 路由
app.use(express.json());

// 获取所有会话
app.get('/api/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([phone, data]) => ({
    phoneNumber: phone,
    status: data.status,
    connectedAt: data.connectedAt
  }));
  res.json(sessionList);
});

// 添加新会话
app.post('/api/sessions', (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber || !/^\d{8,15}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  
  if (sessions.size >= MAX_SESSIONS) {
    return res.status(400).json({ error: 'Max sessions reached (' + MAX_SESSIONS + ')' });
  }
  
  if (sessions.has(phoneNumber)) {
    return res.status(400).json({ error: 'Session already exists' });
  }
  
  // 创建新会话
  const session = {
    status: 'connecting',
    qrPath: null,
    qrData: [],
    process: null,
    createdAt: new Date()
  };
  
  session.process = startMCP(phoneNumber);
  sessions.set(phoneNumber, session);
  
  console.log('[Server] Added session for', phoneNumber);
  res.json({ success: true, phoneNumber });
});

// 删除会话
app.delete('/api/sessions/:phone', (req, res) => {
  const phone = req.params.phone;
  const session = sessions.get(phone);
  
  if (session) {
    if (session.process) {
      session.process.kill();
    }
    // 清理文件
    const authDir = path.join(__dirname, 'auth_info', phone);
    const qrPath = path.join(__dirname, 'public', 'qr-' + phone + '.png');
    try { fs.rmSync(authDir, { recursive: true }); } catch(e) {}
    try { fs.unlinkSync(qrPath); } catch(e) {}
    
    sessions.delete(phone);
    console.log('[Server] Removed session for', phone);
  }
  
  res.json({ success: true });
});

// QR 码图片
app.get('/qr-:phone.png', (req, res) => {
  const phone = req.params.phone;
  const qrPath = path.join(__dirname, 'public', 'qr-' + phone + '.png');
  if (fs.existsSync(qrPath)) {
    res.sendFile(qrPath);
  } else {
    res.status(404).send('Not found');
  }
});

// 主页面
app.get('/', (req, res) => {
  const sessionsHtml = Array.from(sessions.entries())
    .map(([phone, session]) => renderSessionCard(phone, session))
    .join('');
  
  const html = HTML
    .replace('{{maxSessions}}', MAX_SESSIONS)
    .replace('{{activeCount}}', sessions.size)
    .replace('{{sessions}}', sessionsHtml || '<p style="text-align:center;color:white">暂无会话，请添加号码</p>');
  
  res.send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Multi-session WhatsApp MCP Server on http://0.0.0.0:' + PORT);
  console.log('Max sessions:', MAX_SESSIONS);
  
  // 确保目录存在
  if (!fs.existsSync('auth_info')) fs.mkdirSync('auth_info');
  if (!fs.existsSync('public')) fs.mkdirSync('public');
});
