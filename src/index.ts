#!/usr/bin/env node

import { SupabaseDatabase } from './db/supabase.js';
import { WhatsAppMCPServer } from './tools/index.js';

async function main() {
  // 检查必要的环境变量
  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'WHATSAPP_PHONE_NUMBER'];
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  console.log('[WhatsApp MCP] Starting server...');
  console.log('[WhatsApp MCP] Phone:', process.env.WHATSAPP_PHONE_NUMBER);

  // 初始化数据库连接
  const db = new SupabaseDatabase();

  // 创建并启动 MCP Server
  const server = new WhatsAppMCPServer(db);

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\n[WhatsApp MCP] Shutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[WhatsApp MCP] Shutting down...');
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch(console.error);
