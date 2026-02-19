#!/bin/bash
# 快速启动 - 用于 PM2

cd $(dirname $0)
export SUPABASE_URL=https://izwdetsrqjepoxmocore.supabase.co
export SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
export WHATSAPP_PHONE_NUMBER=85297188675

exec node dist/index.js
