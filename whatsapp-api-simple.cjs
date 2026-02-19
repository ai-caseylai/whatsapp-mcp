const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read .env manually
const envContent = fs.readFileSync('.env', 'utf8');
const supabaseUrl = envContent.match(/SUPABASE_URL=(.+)/)?.[1];
const supabaseKey = envContent.match(/SUPABASE_SERVICE_KEY=(.+)/)?.[1];
const openrouterKey = envContent.match(/OPENROUTER_API_KEY=(.+)/)?.[1];

console.log('Starting API server...');
console.log('URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json());

async function getUser(phone) {
  const { data, error } = await supabase
    .from('wa_users')
    .select('id, phone_number, display_name')
    .eq('phone_number', phone)
    .single();
  if (error) {
    console.log('User error:', error.message);
    return null;
  }
  return data;
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/config', (req, res) => {
  res.json({
    openrouterKeyConfigured: !!openrouterKey,
    openrouterKeyMasked: openrouterKey ? openrouterKey.slice(0, 12) + '...' + openrouterKey.slice(-4) : '',
    openrouterKey: req.headers.referer?.includes('whatsapp-crm.techforliving.app') ? openrouterKey : undefined
  });
});

app.get('/api/chats', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  const user = await getUser(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: chats } = await supabase
    .from('wa_chats')
    .select('*')
    .eq('user_id', user.id)
    .limit(50);
    
  res.json({ user: phone, count: chats?.length || 0, chats: chats || [] });
});

app.get('/api/messages', async (req, res) => {
  const phone = req.query.phone;
  const chatJid = req.query.chat_jid;
  if (!phone || !chatJid) return res.status(400).json({ error: 'Phone and chat_jid required' });
  
  const user = await getUser(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: chat } = await supabase
    .from('wa_chats')
    .select('id')
    .eq('user_id', user.id)
    .eq('jid', chatJid)
    .single();
    
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  
  const { data: messages } = await supabase
    .from('wa_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('chat_id', chat.id)
    .order('timestamp', { ascending: false })
    .limit(50);
    
  res.json({ chat_jid: chatJid, count: messages?.length || 0, messages: messages || [] });
});

app.get('/api/contacts', async (req, res) => {
  const phone = req.query.phone;
  const query = req.query.q || '';
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  const user = await getUser(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  let dbQuery = supabase.from('wa_contacts').select('*').eq('user_id', user.id);
  if (query) dbQuery = dbQuery.or(`name.ilike.%${query}%,phone_number.ilike.%${query}%`);
  
  const { data: contacts } = await dbQuery.limit(50);
  res.json({ user: phone, query: query || null, count: contacts?.length || 0, contacts: contacts || [] });
});

app.get('/api/search', async (req, res) => {
  const phone = req.query.phone;
  const query = req.query.q;
  if (!phone || !query) return res.status(400).json({ error: 'Phone and query required' });
  
  const user = await getUser(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { data: messages } = await supabase
    .from('wa_messages')
    .select('*')
    .eq('user_id', user.id)
    .ilike('content', `%${query}%`)
    .order('timestamp', { ascending: false })
    .limit(50);
    
  res.json({ user: phone, query: query, count: messages?.length || 0, messages: messages || [] });
});

app.get('/api/status', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  const user = await getUser(phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const { count: chatCount } = await supabase.from('wa_chats').select('*', { count: 'exact' }).eq('user_id', user.id);
  const { count: msgCount } = await supabase.from('wa_messages').select('*', { count: 'exact' }).eq('user_id', user.id);
  
  res.json({
    connected: true,
    user: phone,
    display_name: user.display_name,
    stats: { chats: chatCount || 0, messages: msgCount || 0 }
  });
});

const PORT = 3458;
app.listen(PORT, () => console.log('WhatsApp API on port', PORT));
