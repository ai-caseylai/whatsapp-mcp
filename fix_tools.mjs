import fs from 'fs';

let content = fs.readFileSync('src/tools/index.ts', 'utf8');

// 找到并替换整个 Promise 等待块
const start = content.indexOf('// 等待连接或 QR 码');
const end = content.indexOf('  // ==================== Server Lifecycle ====================');

if (start !== -1 && end !== -1) {
  const newContent = content.substring(0, start) + 
    '    console.log([MCP Server] WhatsApp client initialized, QR code will appear in terminal.);\n' +
    content.substring(end);
  fs.writeFileSync('src/tools/index.ts', newContent);
  console.log('Fixed!');
} else {
  console.log('Pattern not found');
}
