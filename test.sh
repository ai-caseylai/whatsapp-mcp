#!/bin/bash

# 测试 MCP Server

cd $(dirname $0)

export WHATSAPP_PHONE_NUMBER=${1:-85298765432}
export SUPABASE_URL=https://izwdetsrqjepoxmocore.supabase.co
export SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:-}

node dist/index.js
