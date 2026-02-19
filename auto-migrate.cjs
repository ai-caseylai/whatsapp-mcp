const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://izwdetsrqjepoxmocore.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
    console.error('❌ Error: SUPABASE_SERVICE_KEY not set');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// 简化的建表 SQL（按依赖顺序）
const TABLES = [
    `CREATE TABLE IF NOT EXISTS wa_users (
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
        auth_credentials JSONB,
        sync_settings JSONB DEFAULT '{"auto_sync": true, "sync_interval_minutes": 5, "download_media": true, "max_media_size_mb": 50}'::jsonb
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        jid TEXT NOT NULL,
        name TEXT,
        chat_type TEXT DEFAULT 'individual',
        is_pinned BOOLEAN DEFAULT false,
        mute_until TIMESTAMPTZ,
        unread_count INTEGER DEFAULT 0,
        last_message_id UUID,
        last_message_at TIMESTAMPTZ,
        profile_pic_url TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, jid)
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        chat_id UUID REFERENCES wa_chats(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        sender_name TEXT,
        message_type TEXT DEFAULT 'text',
        content TEXT,
        media_url TEXT,
        media_mime_type TEXT,
        media_file_name TEXT,
        media_file_size INTEGER,
        media_duration INTEGER,
        quoted_message_id TEXT,
        quoted_message_content TEXT,
        status TEXT DEFAULT 'sent',
        is_from_me BOOLEAN DEFAULT false,
        is_deleted BOOLEAN DEFAULT false,
        is_edited BOOLEAN DEFAULT false,
        edited_at TIMESTAMPTZ,
        timestamp TIMESTAMPTZ NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, message_id)
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        jid TEXT NOT NULL,
        name TEXT,
        push_name TEXT,
        short_name TEXT,
        phone_number TEXT,
        profile_pic_url TEXT,
        status TEXT,
        is_blocked BOOLEAN DEFAULT false,
        is_business BOOLEAN DEFAULT false,
        labels TEXT[],
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, jid)
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_media (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        message_id UUID REFERENCES wa_messages(id) ON DELETE CASCADE,
        storage_path TEXT NOT NULL,
        public_url TEXT,
        media_type TEXT NOT NULL,
        mime_type TEXT,
        file_name TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        duration INTEGER,
        is_downloaded BOOLEAN DEFAULT false,
        download_attempts INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_sync_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        sync_type TEXT NOT NULL,
        status TEXT DEFAULT 'started',
        start_time TIMESTAMPTZ,
        end_time TIMESTAMPTZ,
        messages_synced INTEGER DEFAULT 0,
        chats_synced INTEGER DEFAULT 0,
        media_downloaded INTEGER DEFAULT 0,
        errors JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
    );`,
    
    `CREATE TABLE IF NOT EXISTS wa_webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES wa_users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT DEFAULT 'pending',
        result JSONB,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ
    );`,
    
    // 索引
    `CREATE INDEX IF NOT EXISTS idx_messages_user_chat ON wa_messages(user_id, chat_id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON wa_messages(timestamp DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_chats_user_active ON wa_chats(user_id, is_pinned, last_message_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_user_name ON wa_contacts(user_id, name);`,
];

async function migrate() {
    console.log('🚀 Starting database migration...\n');
    
    for (let i = 0; i < TABLES.length; i++) {
        const sql = TABLES[i];
        const tableName = sql.match(/wa_\w+/)?.[0] || 'step_' + i;
        
        process.stdout.write(`[${i + 1}/${TABLES.length}] Creating ${tableName}... `);
        
        try {
            // 使用 Supabase 的 rpc 或直接查询来执行 SQL
            const { error } = await supabase.rpc('exec_sql', { sql });
            
            if (error) {
                // 如果 exec_sql 函数不存在，尝试直接 REST API
                const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'apikey': SUPABASE_KEY
                    },
                    body: JSON.stringify({ query: sql })
                });
                
                if (!response.ok) {
                    // 忽略 "already exists" 错误
                    const text = await response.text();
                    if (text.includes('already exists') || text.includes('duplicate')) {
                        console.log('✅ (exists)');
                    } else {
                        console.log(`⚠️  ${text.slice(0, 50)}`);
                    }
                } else {
                    console.log('✅');
                }
            } else {
                console.log('✅');
            }
        } catch (err) {
            // 忽略已存在的错误
            if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
                console.log('✅ (exists)');
            } else {
                console.log(`⚠️  ${err.message?.slice(0, 50) || 'Unknown error'}`);
            }
        }
    }
    
    console.log('\n🎉 Migration completed!');
    
    // 验证
    console.log('\n📋 Verifying tables...');
    const tables = ['wa_users', 'wa_chats', 'wa_messages', 'wa_contacts', 'wa_media', 'wa_sync_logs', 'wa_webhook_events'];
    
    for (const table of tables) {
        const { data, error } = await supabase
            .from(table)
            .select('count')
            .limit(1);
        
        if (error && error.message.includes('does not exist')) {
            console.log(`  ❌ ${table}: not found`);
        } else {
            console.log(`  ✅ ${table}: ready`);
        }
    }
}

migrate().catch(console.error);
