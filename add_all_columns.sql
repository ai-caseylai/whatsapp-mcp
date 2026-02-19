-- ============================================
-- 添加所有需要的列到 wa_messages 表
-- ============================================

-- 添加 jid 列
ALTER TABLE wa_messages 
ADD COLUMN IF NOT EXISTS jid TEXT;

-- 添加 lid 列
ALTER TABLE wa_messages 
ADD COLUMN IF NOT EXISTS lid TEXT;

-- 添加 metadata 列（JSONB 格式）
ALTER TABLE wa_messages 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_wa_messages_jid ON wa_messages(jid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lid ON wa_messages(lid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_metadata ON wa_messages USING GIN (metadata);

-- 验证列已添加
SELECT 'wa_messages 表结构:' as info;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'wa_messages'
ORDER BY ordinal_position;
