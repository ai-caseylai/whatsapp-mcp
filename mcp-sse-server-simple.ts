import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const app = express();
app.use(cors());

const transports = new Map();

// SSE endpoint
app.get('/mcp/sse', async (req, res) => {
  const phone = req.query.phone as string;
  if (!phone) {
    res.status(400).json({ error: 'Phone required' });
    return;
  }

  const { data: user } = await supabase.from('wa_users').select('*').eq('phone_number', phone).single();
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const server = new Server(
    { name: 'whatsapp-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Handle tool calls
  server.setRequestHandler('tools/list' as any, async () => ({
    tools: [
      { name: 'whatsapp_list_chats', description: 'List chats', inputSchema: { type: 'object', properties: {} } as any },
      { name: 'whatsapp_get_connection_status', description: 'Get status', inputSchema: { type: 'object', properties: {} } as any }
    ]
  }));

  server.setRequestHandler('tools/call' as any, async (request: any) => {
    const { name } = request.params;
    
    if (name === 'whatsapp_list_chats') {
      const { data: chats } = await supabase.from('wa_chats').select('*').eq('user_id', user.id).limit(10);
      return {
        content: [{ type: 'text', text: JSON.stringify(chats || [], null, 2) }]
      };
    }
    
    if (name === 'whatsapp_get_connection_status') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ connected: true, user: user.phone_number }) }]
      };
    }
    
    throw new Error('Unknown tool: ' + name);
  });

  const transport = new SSEServerTransport('/mcp/message', res);
  transports.set(transport.sessionId, { transport, server });
  
  res.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// Message endpoint
app.post('/mcp/message', express.raw({ type: '*/*' }), async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid session' });
    return;
  }

  const { transport } = transports.get(sessionId);
  await transport.handlePostMessage(req, res);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: transports.size });
});

app.get('/config', (req, res) => {
  const key = process.env.OPENROUTER_API_KEY || '';
  res.json({
    openrouterKeyConfigured: !!key,
    openrouterKeyMasked: key ? key.slice(0, 12) + '...' + key.slice(-4) : '',
    openrouterKey: req.headers.referer?.includes('whatsapp-crm.techforliving.app') ? key : undefined
  });
});

const PORT = process.env.MCP_SSE_PORT || 3457;
app.listen(PORT, () => {
  console.log('MCP SSE Server on port', PORT);
});
