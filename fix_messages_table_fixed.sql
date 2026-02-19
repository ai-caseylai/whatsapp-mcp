-- ============================================
-- 完善 wa_messages 表结构 - 修复版
-- ============================================

-- 添加 sender_name 列（存储 pushName）
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- 添加 sender_jid 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS sender_jid TEXT;

-- 添加 message_type 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS message_type TEXT;

-- 添加 content 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS content TEXT;

-- 添加 status 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';

-- 添加 is_from_me 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS is_from_me BOOLEAN DEFAULT false;

-- 添加 timestamp 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE;

-- 添加 jid 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS jid TEXT;

-- 添加 lid 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS lid TEXT;

-- 添加 metadata 列
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_wa_messages_sender_name ON wa_messages(sender_name);
CREATE INDEX IF NOT EXISTS idx_wa_messages_sender_jid ON wa_messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_timestamp ON wa_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_wa_messages_jid ON wa_messages(jid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lid ON wa_messages(lid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_metadata ON wa_messages USING GIN (metadata);

-- 验证表结构
SELECT 'wa_messages 表结构:' as info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'wa_messages' 
ORDER BY ordinal_position;
