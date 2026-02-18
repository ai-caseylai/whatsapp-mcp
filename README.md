# WhatsApp MCP Server

一个功能完整的 WhatsApp MCP (Model Context Protocol) 服务器，支持多用户、云存储 (Supabase) 和完整的历史消息同步。

## ✨ 特性

- 🔗 **MCP 协议支持** - 与 OpenClaw、Claude Desktop、Cursor 等兼容
- 👥 **多用户支持** - 每个用户独立的 WhatsApp 连接和数据隔离
- ☁️ **Supabase 云存储** - 消息、联系人、聊天记录持久化到云端
- 📜 **历史消息同步** - 自动同步旧消息，支持增量更新
- 🔍 **全文搜索** - 支持消息内容搜索
- 📎 **媒体文件支持** - 图片、视频、文档、语音消息处理
- 🔐 **安全隔离** - 基于 Supabase RLS 的行级安全控制

## 📁 项目结构

```
whatsapp-mcp-server/
├── src/
│   ├── index.ts              # 主入口
│   ├── db/
│   │   └── supabase.ts       # Supabase 数据库操作
│   ├── whatsapp/
│   │   ├── client.ts         # Baileys WhatsApp 客户端
│   │   └── message-handler.ts # 消息处理器
│   ├── tools/
│   │   └── index.ts          # MCP Tools 实现
│   └── types/
│       └── index.ts          # TypeScript 类型定义
├── supabase/
│   └── migrations/
│       └── 001_initial.sql   # 数据库初始化脚本
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/caseyklai/whatsapp-mcp.git
cd whatsapp-mcp
```

### 2. 安装依赖

```bash
npm install
```

### 3. 设置 Supabase

1. 在 [Supabase](https://supabase.com) 创建新项目
2. 在 SQL Editor 中执行 `supabase/migrations/001_initial.sql`
3. 获取 Project URL 和 Service Role Key (Settings > API)

### 4. 配置环境变量

```bash
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_KEY="your-service-role-key"
export WHATSAPP_PHONE_NUMBER="your-phone-number"
export WHATSAPP_AUTH_USER_ID="optional-auth-user-id"
```

### 5. 构建并运行

```bash
npm run build
node dist/index.js
```

首次运行会显示 QR 码，使用 WhatsApp 扫描即可登录。

## 🔧 与 OpenClaw 集成

在 OpenClaw 配置中添加 MCP Server：

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/path/to/whatsapp-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_KEY": "your-service-role-key",
        "WHATSAPP_PHONE_NUMBER": "your-phone-number"
      }
    }
  }
}
```

## 🛠️ 可用 Tools

| Tool | 描述 |
|------|------|
| `whatsapp_search_contacts` | 搜索联系人 |
| `whatsapp_list_chats` | 列出聊天列表 |
| `whatsapp_get_chat` | 获取聊天详情 |
| `whatsapp_list_messages` | 列出消息 |
| `whatsapp_search_messages` | 搜索消息内容 |
| `whatsapp_send_message` | 发送消息 |
| `whatsapp_get_contact` | 获取联系人详情 |
| `whatsapp_get_connection_status` | 获取连接状态 |
| `whatsapp_sync_history` | 触发历史同步 |

## 📊 数据库 Schema

### 核心表

- `wa_users` - 用户信息及认证
- `wa_chats` - 聊天会话
- `wa_messages` - 消息记录
- `wa_contacts` - 联系人
- `wa_media` - 媒体文件元数据
- `wa_sync_logs` - 同步日志
- `wa_webhook_events` - Webhook 事件队列

## 🔒 安全特性

- 使用 Supabase Row Level Security (RLS) 确保用户数据隔离
- 认证信息本地存储 (auth_info/ 目录)
- 支持 OAuth 集成

## 📝 与 OpenClaw 内置 WhatsApp 对比

| 功能 | OpenClaw 内置 | MCP Server |
|------|--------------|------------|
| 历史消息获取 | ❌ 无法获取旧消息 | ✅ 自动同步完整历史 |
| 数据存储 | ❌ 本地/内存 | ✅ Supabase 云端持久化 |
| 多用户支持 | ❌ 单机版 | ✅ 完整多用户架构 |
| 全文搜索 | ❌ 有限 | ✅ 数据库全文搜索 |
| 媒体文件 | ❌ 临时存储 | ✅ 云存储 + CDN |
| 跨实例使用 | ❌ 数据无法共享 | ✅ 所有实例共享数据 |

## 🐛 故障排除

### QR 码不显示
检查终端是否支持二维码显示，或尝试使用其他终端。

### 连接断开
Baileys 会自动重连（最多5次）。如需重新登录，删除 `auth_info/` 目录后重启。

### 消息同步慢
首次同步可能需要较长时间，取决于消息历史数量。后续为增量同步。

## 📄 许可证

MIT

## 🙏 致谢

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议
- [Supabase](https://supabase.com/) - 开源 Firebase 替代方案
