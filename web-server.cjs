const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6d2RldHNycWplcG94bW9jb3JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDIwNDgwOSwiZXhwIjoyMDg1NzgwODA5fQ.nbq_NKxfOc8exmEHZ6juJkSLE9SRsXtmMEEoig6oqAE';

let mcpState = {
  status: 'starting',
  qrAvailable: false,
  phoneNumber: '85297188675'
};

const HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>WhatsApp MCP Server</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; margin: 0; }
        .container { background: white; border-radius: 20px; padding: 40px; max-width: 500px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
        h1 { color: #333; margin-bottom: 10px; }
        .phone { color: #667eea; font-size: 18px; margin-bottom: 20px; }
        .status { padding: 12px 24px; border-radius: 50px; font-weight: 600; margin-bottom: 20px; display: inline-block; }
        .status.starting { background: #e3f2fd; color: #1976d2; }
        .status.waiting_qr { background: #fff3e0; color: #f57c00; }
        .status.connected { background: #e8f5e9; color: #388e3c; }
        .qr-container { background: #f5f5f5; padding: 20px; border-radius: 15px; margin-bottom: 20px; min-height: 350px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .qr-code img { max-width: 100%; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .loading { width: 60px; height: 60px; border: 4px solid #e0e0e0; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .instructions { color: #666; font-size: 14px; line-height: 1.6; margin-top: 20px; }
        .refresh-btn { background: #667eea; color: white; border: none; padding: 12px 30px; border-radius: 50px; font-size: 16px; cursor: pointer; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📱 WhatsApp MCP Server</h1>
        <div class="phone">{{phone}}</div>
        <div class="status {{statusClass}}">{{statusText}}</div>
        <div class="qr-container">{{qrContent}}</div>
        <div class="instructions">{{instructions}}</div>
        <button class="refresh-btn" onclick="location.reload()">🔄 刷新</button>
    </div>
    <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>
`;

function startMCP() {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://izwdetsrqjepoxmocore.supabase.co',
    SUPABASE_SERVICE_KEY: SUPABASE_KEY,
    WHATSAPP_PHONE_NUMBER: mcpState.phoneNumber
  };
  
  const mcp = spawn('node', ['dist/index.js'], {
    cwd: __dirname,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  mcp.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.includes('[QR_AVAILABLE]') || trimmed.includes('Scan this QR code')) {
        mcpState.qrAvailable = true;
        mcpState.status = 'waiting_qr';
      }
      if (trimmed.includes('opened connection')) {
        mcpState.status = 'connected';
      }
      console.log('[MCP]', trimmed.slice(0, 100));
    }
  });
  
  mcp.stderr.on('data', (data) => {
    console.error('[MCP ERR]', data.toString().trim().slice(0, 100));
  });
  
  return mcp;
}

function renderPage() {
  const statusMap = {
    starting: { text: '正在启动...', class: 'starting' },
    waiting_qr: { text: '请扫描 QR 码', class: 'waiting_qr' },
    connected: { text: '✅ 已连接', class: 'connected' }
  };
  
  const s = statusMap[mcpState.status] || statusMap.starting;
  
  let qrContent = '';
  const qrPath = path.join(__dirname, 'public', 'qr-code.png');
  
  if (mcpState.status === 'connected') {
    qrContent = '<div style="font-size:60px">✅</div><p style="color:#4caf50">WhatsApp 已连接!</p>';
  } else if (fs.existsSync(qrPath)) {
    const stat = fs.statSync(qrPath);
    const ageSec = Math.floor((Date.now() - stat.mtimeMs) / 1000);
    if (ageSec < 120) {
      qrContent = '<div class="qr-code"><img src="/mcp/qr-code.png?v=' + Date.now() + '" alt="QR Code" width="280"></div><p style="color:#666;font-size:12px">QR 码已生成 (' + ageSec + '秒前)</p>';
    } else {
      qrContent = '<div class="loading"></div><p style="margin-top:20px;color:#666">QR 码已过期，请刷新...</p>';
    }
  } else {
    qrContent = '<div class="loading"></div><p style="margin-top:20px;color:#666">等待 QR 码生成...</p>';
  }
  
  const instructions = {
    starting: '正在初始化 WhatsApp 连接...',
    waiting_qr: '1. 打开 WhatsApp 手机应用<br>2. 点击 设置 → 已连接的设备<br>3. 点击 "连接新设备"<br>4. 扫描上方的 QR 码',
    connected: 'WhatsApp MCP Server 已成功连接！'
  };
  
  return HTML
    .replace('{{phone}}', mcpState.phoneNumber)
    .replace('{{statusClass}}', s.class)
    .replace('{{statusText}}', s.text)
    .replace('{{qrContent}}', qrContent)
    .replace('{{instructions}}', instructions[mcpState.status] || instructions.starting);
}

// QR 码图片路由
app.get('/mcp/qr-code.png', (req, res) => {
  const qrPath = path.join(__dirname, 'public', 'qr-code.png');
  if (fs.existsSync(qrPath)) {
    res.sendFile(qrPath);
  } else {
    res.status(404).send('QR code not found');
  }
});

app.get('/', (req, res) => res.send(renderPage()));
app.get('/mcp/', (req, res) => res.send(renderPage()));
app.get('/mcp', (req, res) => res.redirect('/mcp/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Web server on http://0.0.0.0:' + PORT);
  startMCP();
});
