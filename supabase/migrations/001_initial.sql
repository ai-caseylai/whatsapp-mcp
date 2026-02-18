-- WhatsApp MCP Server Database Schema
-- 支持多用户的 WhatsApp 消息云存储

-- 用户表 (关联 Supabase Auth)
CREATE TABLE IF NOT EXISTS wa_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number TEXT UNIQUE NOT NULL,
    display_name TEXT,
    profile_pic_url TEXT,
    status TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ,
    -- Baileys 认证信息 (加密存储)
    auth_credentials JSONB,
    -- 同步设置
    sync_settings JSONB DEFAULT '{
        "auto_sync": true,
        "sync_interval_minutes": 5,
        "download_media": true,
        "max_media_size_mb": 50
    }'::jsonb
);

-- 聊天会话表
CREATE TABLE IF NOT EXISTS wa_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    -- WhatsApp JID (e.g., 1234567890@s.whatsapp.net)
    jid TEXT NOT NULL,
    name TEXT,
    -- 聊天类型: individual, group, broadcast, status
    chat_type TEXT DEFAULT 'individual',
    -- 是否置顶
    is_pinned BOOLEAN DEFAULT false,
    -- 静音设置
    mute_until TIMESTAMPTZ,
    -- 未读消息数
    unread_count INTEGER DEFAULT 0,
    -- 最后一条消息
    last_message_id UUID,
    last_message_at TIMESTAMPTZ,
    -- 头像
    profile_pic_url TEXT,
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- 复合唯一索引：每个用户的每个 JID 只出现一次
    UNIQUE(user_id, jid)
);

-- 消息表
CREATE TABLE IF NOT EXISTS wa_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES wa_chats(id) ON DELETE CASCADE,
    -- WhatsApp 消息 ID
    message_id TEXT NOT NULL,
    -- 发送者 JID
    sender_jid TEXT NOT NULL,
    sender_name TEXT,
    -- 消息类型: text, image, video, audio, document, sticker, location, vcard
    message_type TEXT DEFAULT 'text',
    -- 消息内容
    content TEXT,
    -- 媒体文件信息
    media_url TEXT,
    media_mime_type TEXT,
    media_file_name TEXT,
    media_file_size INTEGER,
    media_duration INTEGER, -- 音频/视频时长(秒)
    -- 引用回复
    quoted_message_id TEXT,
    quoted_message_content TEXT,
    -- 消息状态: pending, sent, delivered, read, failed
    status TEXT DEFAULT 'sent',
    -- 是否来自我
    is_from_me BOOLEAN DEFAULT false,
    -- 是否已删除
    is_deleted BOOLEAN DEFAULT false,
    -- 是否已编辑
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    -- 消息时间戳
    timestamp TIMESTAMPTZ NOT NULL,
    -- 元数据 (转发、提及等)
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- 复合唯一索引
    UNIQUE(user_id, message_id)
);

-- 联系人表
CREATE TABLE IF NOT EXISTS wa_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    -- WhatsApp JID
    jid TEXT NOT NULL,
    -- 姓名
    name TEXT,
    -- 推送名称 (WhatsApp 显示名)
    push_name TEXT,
    -- 短名称
    short_name TEXT,
    -- 电话号码
    phone_number TEXT,
    -- 头像
    profile_pic_url TEXT,
    -- 状态
    status TEXT,
    -- 是否被阻止
    is_blocked BOOLEAN DEFAULT false,
    -- 是否是企业账号
    is_business BOOLEAN DEFAULT false,
    -- 标签/分组
    labels TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- 复合唯一索引
    UNIQUE(user_id, jid)
);

-- 媒体文件表 (用于存储文件元数据，实际文件存 Supabase Storage)
CREATE TABLE IF NOT EXISTS wa_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES wa_messages(id) ON DELETE CASCADE,
    -- Supabase Storage 路径
    storage_path TEXT NOT NULL,
    -- 公开访问 URL
    public_url TEXT,
    -- 文件类型: image, video, audio, document, sticker
    media_type TEXT NOT NULL,
    mime_type TEXT,
    file_name TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    -- 是否已下载完成
    is_downloaded BOOLEAN DEFAULT false,
    -- 下载尝试次数
    download_attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 同步日志表
CREATE TABLE IF NOT EXISTS wa_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    -- 同步类型: full, incremental, media
    sync_type TEXT NOT NULL,
    -- 状态: started, completed, failed
    status TEXT DEFAULT 'started',
    -- 同步范围
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    -- 同步统计
    messages_synced INTEGER DEFAULT 0,
    chats_synced INTEGER DEFAULT 0,
    media_downloaded INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Webhook 事件表 (用于处理入站消息)
CREATE TABLE IF NOT EXISTS wa_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
    -- 事件类型: message, receipt, presence, connection
    event_type TEXT NOT NULL,
    -- 事件数据
    payload JSONB NOT NULL,
    -- 处理状态: pending, processing, completed, failed
    status TEXT DEFAULT 'pending',
    -- 处理结果
    result JSONB,
    -- 重试次数
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- 创建索引以优化查询性能

-- 消息表索引
CREATE INDEX IF NOT EXISTS idx_messages_user_chat ON wa_messages(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON wa_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_search ON wa_messages USING gin(to_tsvector('simple', content));

-- 聊天表索引
CREATE INDEX IF NOT EXISTS idx_chats_user_active ON wa_chats(user_id, is_pinned, last_message_at DESC);

-- 联系人表索引
CREATE INDEX IF NOT EXISTS idx_contacts_user_name ON wa_contacts(user_id, name);
CREATE INDEX IF NOT EXISTS idx_contacts_search ON wa_contacts USING gin(to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(push_name, '')));

-- Webhook 事件索引
CREATE INDEX IF NOT EXISTS idx_webhook_pending ON wa_webhook_events(user_id, status) WHERE status = 'pending';

-- 启用 Row Level Security (RLS)
ALTER TABLE wa_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能访问自己的数据
CREATE POLICY "Users can only access their own data" ON wa_users
    FOR ALL USING (auth_user_id = auth.uid());

CREATE POLICY "Users can only access their own chats" ON wa_chats
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can only access their own messages" ON wa_messages
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can only access their own contacts" ON wa_contacts
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can only access their own media" ON wa_media
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can only access their own sync logs" ON wa_sync_logs
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users can only access their own webhook events" ON wa_webhook_events
    FOR ALL USING (user_id IN (SELECT id FROM wa_users WHERE auth_user_id = auth.uid()));

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wa_users_updated_at BEFORE UPDATE ON wa_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wa_chats_updated_at BEFORE UPDATE ON wa_chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wa_contacts_updated_at BEFORE UPDATE ON wa_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wa_media_updated_at BEFORE UPDATE ON wa_media
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
