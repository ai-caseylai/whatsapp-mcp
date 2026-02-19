#!/bin/bash

# WhatsApp MCP Server 启动脚本

cd $(dirname $0)

# 加载环境变量
if [ -f .env.production ]; then
    export $(grep -v '^#' .env.production | xargs)
fi

# 设置 Node 环境
export NODE_ENV=production

# 运行 MCP Server
node dist/index.js
