const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envContent.match(/SUPABASE_URL=(.+)/)?.[1]?.trim();
const supabaseKey = envContent.match(/SUPABASE_SERVICE_KEY=(.+)/)?.[1]?.trim();

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json());

async function getUserByPhone(phone) {
  const { data, error } = await supabase
    .from('wa_users')
    .select('id')
    .eq('phone_number', phone)
    .single();
  if (error) return null;
  return data;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Get API config
app.get('/api/config', (req, res) => {
  const envContent = fs.readFileSync('.env', 'utf8');
  const openrouterKey = envContent.match(/OPENROUTER_API_KEY=(.+)/)?.[1]?.trim() || '';
  res.json({ openrouterKey });
});

// List chats
app.get('/api/chats', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  const user = await getUserByPhone(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: chats } = await supabase
    .from('wa_chats')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
    
  res.json({ user: phone, count: chats?.length || 0, chats: chats || [] });
});

// Get messages for a chat
app.get('/api/messages', async (req, res) => {
  const { phone, chat_jid } = req.query;
  if (!phone || !chat_jid) return res.status(400).json({ error: 'Phone and chat_jid required' });
  
  const user = await getUserByPhone(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: chat } = await supabase
    .from('wa_chats')
    .select('id')
    .eq('user_id', user.id)
    .eq('jid', chat_jid)
    .single();
    
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  
  const { data: messages } = await supabase
    .from('wa_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('chat_id', chat.id)
    .order('timestamp', { ascending: false })
    .limit(100);
    
  res.json({ chat_jid, count: messages?.length || 0, messages: messages || [] });
});

// List contacts (fallback to chats if no contacts table)
app.get('/api/contacts', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  const user = await getUserByPhone(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: contacts, error } = await supabase
    .from('wa_contacts')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true })
    .limit(100);
  
  if (error || !contacts || contacts.length === 0) {
    const { data: chats } = await supabase
      .from('wa_chats')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true })
      .limit(100);
    
    const contactsFromChats = (chats || []).map(chat => ({
      id: chat.id,
      user_id: chat.user_id,
      jid: chat.jid,
      name: chat.name,
      phone_number: chat.jid.split('@')[0].replace(/\D/g, ''),
      is_group: chat.chat_type === 'group',
      is_whatsapp_user: true,
      created_at: chat.created_at,
      source: 'chat'
    }));
    
    return res.json({ 
      user: phone, 
      count: contactsFromChats.length, 
      contacts: contactsFromChats,
      note: 'Using chats as contacts (no contacts table)'
    });
  }
    
  res.json({ user: phone, count: contacts.length, contacts });
});

// Bind to 0.0.0.0 to allow external access
app.listen(3458, '0.0.0.0', () => console.log('API on 3458'));
