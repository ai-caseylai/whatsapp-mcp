-- ============================================
-- WhatsApp MCP 数据库修复脚本
-- 在 Supabase Dashboard 中执行
-- URL: https://supabase.com/dashboard/project/izwdetsrqjepoxmocore/editor
-- ============================================

-- 1. 添加 sync_settings 列到 wa_users 表
ALTER TABLE wa_users 
ADD COLUMN IF NOT EXISTS sync_settings JSONB DEFAULT '{
  auto_sync: true,
  sync_interval_minutes: 15,
  download_media: false,
  max_media_size_mb: 10
}'::jsonb;

-- 2. 添加 last_sync_at 列
ALTER TABLE wa_users 
ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;

-- 3. 添加 auth_credentials 列
ALTER TABLE wa_users 
ADD COLUMN IF NOT EXISTS auth_credentials JSONB;

-- 4. 更新现有用户的 sync_settings
UPDATE wa_users 
SET sync_settings = '{
  auto_sync: true,
  sync_interval_minutes: 15,
  download_media: false,
  max_media_size_mb: 10
}'::jsonb
WHERE sync_settings IS NULL;

-- 5. 检查并添加 wa_chats 表的 user_id 列
DO 74106
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'wa_chats' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE wa_chats ADD COLUMN user_id UUID REFERENCES wa_users(id);
  END IF;
END 74106;

-- 6. 检查并添加 wa_messages 表的必要列
DO 74106
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'wa_messages' AND column_name = 'chat_id'
  ) THEN
    ALTER TABLE wa_messages ADD COLUMN chat_id UUID REFERENCES wa_chats(id);
  END IF;
END 74106;

-- 7. 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_wa_chats_user_id ON wa_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_id ON wa_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created_at ON wa_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_timestamp ON wa_messages(timestamp);

-- 8. 检查表结构
SELECT 'wa_users columns:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wa_users';

SELECT 'wa_chats columns:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wa_chats';

SELECT 'wa_messages columns:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'wa_messages';
