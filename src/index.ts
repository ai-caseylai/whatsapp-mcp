#!/usr/bin/env node

// 全局错误处理
process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
});

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

  const db = new SupabaseDatabase(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const server = new WhatsAppMCPServer(db);
  await server.start();
}

main().catch(console.error);
