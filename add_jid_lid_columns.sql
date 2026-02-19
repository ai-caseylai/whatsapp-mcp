-- ============================================
-- 添加 jid 和 lid 列到 wa_messages 表
-- 在 Supabase Dashboard 中执行
-- ============================================

-- 1. 添加 jid 列（消息完整 JID）
ALTER TABLE wa_messages 
ADD COLUMN IF NOT EXISTS jid TEXT;

-- 2. 添加 lid 列（WhatsApp LID）
ALTER TABLE wa_messages 
ADD COLUMN IF NOT EXISTS lid TEXT;

-- 3. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_wa_messages_jid ON wa_messages(jid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lid ON wa_messages(lid);

-- 4. 验证列已添加
SELECT 'wa_messages 表现在有以下列:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wa_messages'
ORDER BY ordinal_position;
