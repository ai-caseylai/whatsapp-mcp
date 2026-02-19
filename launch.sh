#!/bin/bash

cd $(dirname $0)

export SUPABASE_URL=https://izwdetsrqjepoxmocore.supabase.co
export SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:-$1}
export WHATSAPP_PHONE_NUMBER=85297188675

echo '╔════════════════════════════════════════════════════════════╗'
echo '║        WhatsApp MCP Server - 启动向导                      ║'
echo '╚════════════════════════════════════════════════════════════╝'
echo ''

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo '❌ 错误: 请提供 SUPABASE_SERVICE_KEY'
    echo '用法: ./launch.sh <your-service-key>'
    exit 1
fi

# 1. 运行数据库迁移
echo '📦 Step 1: 数据库迁移...'
node auto-migrate.cjs
echo ''

# 2. 启动 Web 服务器（用于显示 QR 码）
echo '🌐 Step 2: 启动 Web 界面...'
echo '   访问: http://whatsapp-crm.techforliving.app:3456'
echo ''

node web-server.cjs &
WEB_PID=$!

echo "   Web 服务器 PID: $WEB_PID"
echo ''
echo '⏳ 等待 MCP Server 启动...'
echo '   请在浏览器中打开上面的链接查看 QR 码'
echo ''

# 等待用户按键
echo '按 Enter 键停止服务...'
read

kill $WEB_PID 2>/dev/null
echo '✅ 服务已停止'
