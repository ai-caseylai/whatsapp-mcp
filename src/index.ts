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
import { createLogger } from './utils/index.js';

const log = createLogger('Main');

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

  // 优雅关闭处理
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n[WhatsApp MCP] Received ${signal}, shutting down gracefully...`);
    
    try {
      await server.stop();
      console.log('[WhatsApp MCP] Server stopped successfully');
      process.exit(0);
    } catch (error) {
      log.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  // 监听终止信号
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 启动服务器
  await server.start();
}

main().catch((err) => {
  console.error('[WhatsApp MCP] Fatal error:', err);
  process.exit(1);
});
