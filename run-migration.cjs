const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://izwdetsrqjepoxmocore.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

async function runMigration() {
  const sql = fs.readFileSync('./supabase/migrations/001_initial.sql', 'utf8');
  
  console.log('Running migration...');
  
  // 分割 SQL 语句并逐一执行
  const statements = sql.split(';').filter(s => s.trim());
  
  for (const statement of statements) {
    if (!statement.trim()) continue;
    
    const { error } = await supabase.rpc('exec_sql', {
      sql: statement + ';'
    });
    
    if (error) {
      console.log('Note:', error.message);
    }
  }
  
  console.log('Migration attempted. Checking tables...');
  
  // 检查表是否存在
  const { data, error } = await supabase
    .from('wa_users')
    .select('count')
    .limit(1);
    
  if (error) {
    console.log('Table check error:', error.message);
    console.log('');
    console.log('Please manually run the SQL in Supabase Dashboard:');
    console.log('https://supabase.com/dashboard/project/izwdetsrqjepoxmocore/sql');
  } else {
    console.log('Tables created successfully!');
  }
}

runMigration();
