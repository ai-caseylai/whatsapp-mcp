require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function seedData() {
  // Get user
  const { data: user } = await supabase
    .from('wa_users')
    .select('id')
    .eq('phone_number', '85297188675')
    .single();
    
  if (!user) {
    console.log('User not found');
    return;
  }
  
  const userId = user.id;
  const now = new Date().toISOString();
  
  console.log('Seeding data for user:', userId);
  
  // Add sample chats
  const { data: chats, error: chatError } = await supabase
    .from('wa_chats')
    .insert([
      {
        user_id: userId,
        jid: '85298765432@s.whatsapp.net',
        name: '小明',
        chat_type: 'individual',
        is_pinned: false,
        unread_count: 2,
        created_at: now,
        updated_at: now,
        metadata: {}
      },
      {
        user_id: userId,
        jid: '85291234567@s.whatsapp.net',
        name: '阿強',
        chat_type: 'individual',
        is_pinned: false,
        unread_count: 0,
        created_at: now,
        updated_at: now,
        metadata: {}
      },
      {
        user_id: userId,
        jid: '1234567890@g.us',
        name: '家人群組',
        chat_type: 'group',
        is_pinned: true,
        unread_count: 5,
        created_at: now,
        updated_at: now,
        metadata: {}
      }
    ])
    .select();
  
  if (chatError) {
    console.log('Chat insert error:', chatError);
    return;
  }
  
  console.log('Created', chats?.length, 'chats');
  
  // Add sample messages
  if (chats && chats.length > 0) {
    const { error: msgError } = await supabase.from('wa_messages').insert([
      {
        user_id: userId,
        chat_id: chats[0].jid,
        message_id: 'msg_' + Date.now() + '_1',
        sender_jid: chats[0].jid,
        sender_name: '小明',
        message_type: 'text',
        content: '你好！最近怎麼樣？',
        is_from_me: false,
        timestamp: now,
        status: 'read',
        created_at: now,
        metadata: {}
      },
      {
        user_id: userId,
        chat_id: chats[0].jid,
        message_id: 'msg_' + Date.now() + '_2',
        sender_jid: 'me',
        sender_name: '我',
        message_type: 'text',
        content: '我很好，謝謝！你呢？',
        is_from_me: true,
        timestamp: now,
        status: 'read',
        created_at: now,
        metadata: {}
      },
      {
        user_id: userId,
        chat_id: chats[2].jid,
        message_id: 'msg_' + Date.now() + '_3',
        sender_jid: '85291234567@s.whatsapp.net',
        sender_name: '媽媽',
        message_type: 'text',
        content: '大家記得今晚吃飯喔！',
        is_from_me: false,
        timestamp: now,
        status: 'delivered',
        created_at: now,
        metadata: {}
      }
    ]);
    
    if (msgError) {
      console.log('Message insert error:', msgError);
    } else {
      console.log('Created messages');
    }
  }
  
  // Add sample contacts
  const { error: contactError } = await supabase.from('wa_contacts').insert([
    {
      user_id: userId,
      jid: '85298765432@s.whatsapp.net',
      name: '小明',
      phone_number: '85298765432',
      is_active: true,
      created_at: now,
      updated_at: now
    },
    {
      user_id: userId,
      jid: '85291234567@s.whatsapp.net',
      name: '阿強',
      phone_number: '85291234567',
      is_active: true,
      created_at: now,
      updated_at: now
    },
    {
      user_id: userId,
      jid: '85291112233@s.whatsapp.net',
      name: '小美',
      phone_number: '85291112233',
      is_active: true,
      created_at: now,
      updated_at: now
    }
  ]);
  
  if (contactError) {
    console.log('Contact insert error:', contactError);
  } else {
    console.log('Created contacts');
  }
  
  console.log('Done!');
}

seedData();
