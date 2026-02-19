const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://izwdetsrqjepoxmocore.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('wa_users')
    .select('*')
    .eq('phone_number', '85297188675');
  
  if (error) {
    console.log('Error:', error.message);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('User found:', data[0].id);
    console.log('Is active:', data[0].is_active);
  } else {
    console.log('No user found for 85297188675');
    console.log('Please run MCP server locally first to scan QR code');
  }
}

check();
