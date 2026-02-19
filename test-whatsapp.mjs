import { SupabaseDatabase } from './dist/db/supabase.js';
import { WhatsAppClient } from './dist/whatsapp/client.js';

const db = new SupabaseDatabase();

const user = await db.getUserByPhone('85297188675') || await db.createUser({
  phone_number: '85297188675',
  is_active: true
});

console.log('User:', user.id);

const client = new WhatsAppClient(user, db);
await client.initialize();

console.log('WhatsApp client initialized. Waiting for QR...');

// 保持运行
setInterval(() => {
  const state = client.getState();
  console.log('State:', state.connection, state.qr ? 'QR available' : 'no QR');
}, 5000);
