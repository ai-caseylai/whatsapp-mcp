-- ============================================
-- 完善 wa_messages 表结构
-- 添加所有需要的列
-- ============================================

-- 检查并添加所有必需的列
DO 74812
BEGIN
  -- message_id (应该已存在)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'message_id') THEN
    ALTER TABLE wa_messages ADD COLUMN message_id TEXT NOT NULL UNIQUE;
  END IF;

  -- sender_jid
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'sender_jid') THEN
    ALTER TABLE wa_messages ADD COLUMN sender_jid TEXT NOT NULL;
  END IF;

  -- sender_name (pushName)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'sender_name') THEN
    ALTER TABLE wa_messages ADD COLUMN sender_name TEXT;
  END IF;

  -- message_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'message_type') THEN
    ALTER TABLE wa_messages ADD COLUMN message_type TEXT;
  END IF;

  -- content
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'content') THEN
    ALTER TABLE wa_messages ADD COLUMN content TEXT;
  END IF;

  -- status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'status') THEN
    ALTER TABLE wa_messages ADD COLUMN status TEXT DEFAULT 'sent';
  END IF;

  -- is_from_me
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'is_from_me') THEN
    ALTER TABLE wa_messages ADD COLUMN is_from_me BOOLEAN DEFAULT false;
  END IF;

  -- timestamp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'timestamp') THEN
    ALTER TABLE wa_messages ADD COLUMN timestamp TIMESTAMP WITH TIME ZONE;
  END IF;

  -- jid (remote JID)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'jid') THEN
    ALTER TABLE wa_messages ADD COLUMN jid TEXT;
  END IF;

  -- lid
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'lid') THEN
    ALTER TABLE wa_messages ADD COLUMN lid TEXT;
  END IF;

  -- metadata
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wa_messages' AND column_name = 'metadata') THEN
    ALTER TABLE wa_messages ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END 74812;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_wa_messages_sender_jid ON wa_messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_wa_messages_sender_name ON wa_messages(sender_name);
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
