/**
 * MCP SSE Server - 為 Web 客戶端提供 SSE 傳輸層
 * 允許瀏覽器通過 SSE 連接到 MCP 服務器
 */
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import getRawBody from 'raw-body';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });
// ==================== Logger ====================
const createLogger = (name) => ({
    info: (msg, meta) => console.log(`[${name}]`, msg, meta || ''),
    error: (msg, meta) => console.error(`[${name}]`, msg, meta || ''),
    warn: (msg, meta) => console.warn(`[${name}]`, msg, meta || '')
});
const log = createLogger('MCP-SSE');
// ==================== Supabase Client ====================
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
}
const supabase = createClient(supabaseUrl, supabaseKey);
// ==================== Database Helpers ====================
async function getUserByPhone(phone) {
    const { data, error } = await supabase
        .from('wa_users')
        .select('*')
        .eq('phone_number', phone)
        .single();
    if (error)
        return null;
    return data;
}
async function searchContacts(userId, query, limit = 20) {
    const { data, error } = await supabase
        .from('wa_contacts')
        .select('*')
        .eq('user_id', userId)
        .or(`name.ilike.%${query}%,phone_number.ilike.%${query}%`)
        .limit(limit);
    if (error)
        throw error;
    return data || [];
}
async function listChats(userId, limit = 50, offset = 0) {
    const { data, error } = await supabase
        .from('wa_chats')
        .select('*')
        .eq('user_id', userId)
        .order('last_message_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error)
        throw error;
    return data || [];
}
async function getChatByJid(userId, jid) {
    const { data, error } = await supabase
        .from('wa_chats')
        .select('*')
        .eq('user_id', userId)
        .eq('jid', jid)
        .single();
    if (error)
        return null;
    return data;
}
async function listMessages(userId, chatJid, limit = 50) {
    const { data, error } = await supabase
        .from('wa_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('chat_id', chatJid)
        .order('timestamp', { ascending: false })
        .limit(limit);
    if (error)
        throw error;
    return data || [];
}
async function searchMessages(userId, query, chatJid, limit = 20) {
    let q = supabase
        .from('wa_messages')
        .select('*')
        .eq('user_id', userId)
        .ilike('content', `%${query}%`)
        .limit(limit);
    if (chatJid) {
        q = q.eq('chat_id', chatJid);
    }
    const { data, error } = await q;
    if (error)
        throw error;
    return data || [];
}
// ==================== MCP Tools Definition ====================
const TOOLS = [
    {
        name: 'whatsapp_search_contacts',
        description: 'Search WhatsApp contacts by name or phone number',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query (name or phone number)' },
                limit: { type: 'number', description: 'Maximum number of results (default: 20)', default: 20 }
            },
            required: ['query']
        }
    },
    {
        name: 'whatsapp_list_chats',
        description: 'List WhatsApp chats with filtering and sorting',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Number of chats to return (default: 50)', default: 50 },
                offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 }
            }
        }
    },
    {
        name: 'whatsapp_get_chat',
        description: 'Get detailed information about a specific chat',
        inputSchema: {
            type: 'object',
            properties: {
                chat_jid: { type: 'string', description: 'WhatsApp JID of the chat (e.g., 1234567890@s.whatsapp.net)' }
            },
            required: ['chat_jid']
        }
    },
    {
        name: 'whatsapp_list_messages',
        description: 'List messages from a specific chat',
        inputSchema: {
            type: 'object',
            properties: {
                chat_jid: { type: 'string', description: 'WhatsApp JID of the chat' },
                limit: { type: 'number', description: 'Number of messages to return (default: 50)', default: 50 }
            },
            required: ['chat_jid']
        }
    },
    {
        name: 'whatsapp_search_messages',
        description: 'Search for messages containing specific text',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search text' },
                chat_jid: { type: 'string', description: 'Optional: limit search to specific chat' },
                limit: { type: 'number', description: 'Maximum results (default: 20)', default: 20 }
            },
            required: ['query']
        }
    },
    {
        name: 'whatsapp_get_connection_status',
        description: 'Get the current WhatsApp connection status',
        inputSchema: { type: 'object', properties: {} }
    }
];
// ==================== MCP Server Factory ====================
function createMcpServer(user) {
    const server = new Server({ name: 'whatsapp-mcp-sse', version: '1.0.0' }, { capabilities: { tools: {} } });
    // List Tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS
    }));
    // Call Tool
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        log.info(`Tool called: ${name}`, { user: user.phone_number });
        try {
            switch (name) {
                case 'whatsapp_search_contacts': {
                    const { query, limit = 20 } = args;
                    const contacts = await searchContacts(user.id, query, limit);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(contacts.map(c => ({
                                    jid: c.jid,
                                    name: c.name || c.push_name || 'Unknown',
                                    phone: c.phone_number,
                                    is_business: c.is_business
                                })), null, 2)
                            }]
                    };
                }
                case 'whatsapp_list_chats': {
                    const { limit = 50, offset = 0 } = args;
                    const chats = await listChats(user.id, limit, offset);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(chats.map(c => ({
                                    jid: c.jid,
                                    name: c.name || 'Unknown',
                                    type: c.chat_type,
                                    unread: c.unread_count,
                                    last_message_at: c.last_message_at
                                })), null, 2)
                            }]
                    };
                }
                case 'whatsapp_get_chat': {
                    const { chat_jid } = args;
                    const chat = await getChatByJid(user.id, chat_jid);
                    if (!chat) {
                        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Chat not found' }) }] };
                    }
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    jid: chat.jid,
                                    name: chat.name,
                                    type: chat.chat_type,
                                    unread: chat.unread_count,
                                    last_message_at: chat.last_message_at
                                }, null, 2)
                            }]
                    };
                }
                case 'whatsapp_list_messages': {
                    const { chat_jid, limit = 50 } = args;
                    const messages = await listMessages(user.id, chat_jid, limit);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(messages.map(m => ({
                                    id: m.message_id,
                                    sender: m.sender_name || m.sender_jid,
                                    content: m.content,
                                    type: m.message_type,
                                    timestamp: m.timestamp,
                                    is_from_me: m.is_from_me
                                })), null, 2)
                            }]
                    };
                }
                case 'whatsapp_search_messages': {
                    const { query, chat_jid, limit = 20 } = args;
                    const messages = await searchMessages(user.id, query, chat_jid, limit);
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify(messages.map(m => ({
                                    id: m.message_id,
                                    chat_jid: m.chat_id,
                                    sender: m.sender_name || m.sender_jid,
                                    content: m.content,
                                    timestamp: m.timestamp,
                                    is_from_me: m.is_from_me
                                })), null, 2)
                            }]
                    };
                }
                case 'whatsapp_get_connection_status': {
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    connected: true,
                                    user: {
                                        phone: user.phone_number,
                                        name: user.display_name || user.phone_number
                                    }
                                }, null, 2)
                            }]
                    };
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (error) {
            log.error(`Tool execution failed: ${name}`, error);
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true
            };
        }
    });
    return server;
}
// ==================== Express Server ====================
const app = express();
app.use(cors());
// Parse JSON for all routes except /mcp/message
app.use((req, res, next) => {
    if (req.path === '/mcp/message') {
        return next();
    }
    express.json()(req, res, next);
});
const PORT = process.env.MCP_SSE_PORT || 3457;
// Store active transports
const transports = new Map();
// SSE endpoint for MCP connection
app.get('/mcp/sse', async (req, res) => {
    const phone = req.query.phone;
    if (!phone) {
        res.status(400).json({ error: 'Phone number required. Use ?phone=852xxxxxxxx' });
        return;
    }
    log.info(`SSE connection request for: ${phone}`);
    // Get user from database
    const user = await getUserByPhone(phone);
    if (!user) {
        res.status(404).json({ error: 'User not found. Please connect WhatsApp first via /admin' });
        return;
    }
    // Create MCP server for this user
    const server = createMcpServer(user);
    // Create SSE transport
    const transport = new SSEServerTransport('/mcp/message', res);
    transports.set(transport.sessionId, transport);
    log.info(`SSE transport created: ${transport.sessionId}`);
    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        try {
            if (!res.writableEnded) {
                res.write(':heartbeat\n\n');
            }
            else {
                clearInterval(heartbeat);
            }
        }
        catch (e) {
            clearInterval(heartbeat);
        }
    }, 30000);
    // Handle disconnect
    res.on('close', () => {
        log.info(`SSE connection closed: ${transport.sessionId}`);
        clearInterval(heartbeat);
        transports.delete(transport.sessionId);
    });
    // Connect server to transport
    try {
        await server.connect(transport);
        log.info(`MCP server connected for user: ${user.phone_number}`);
    }
    catch (err) {
        log.error(`Failed to connect MCP server: ${err}`);
        transports.delete(transport.sessionId);
        res.end();
    }
});
// Message endpoint for client-to-server communication
app.post('/mcp/message', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !transports.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or expired session' });
        return;
    }
    const transport = transports.get(sessionId);
    try {
        // Read raw body
        const body = await getRawBody(req, {
            length: req.headers['content-length'],
            limit: '1mb',
            encoding: 'utf8'
        });
        // Create a fake req object with the body
        const fakeReq = Object.create(req);
        fakeReq.body = body;
        await transport.handlePostMessage(fakeReq, res);
    }
    catch (err) {
        log.error('Error handling POST message:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', activeSessions: transports.size });
});
// Client configuration - provides Kimi API key
app.get('/config', (req, res) => {
    const kimiKey = process.env.OPENROUTER_API_KEY || '';
    // Mask the key for security (only show first 8 and last 4 chars)
    const maskedKey = kimiKey
        ? kimiKey.substring(0, 12) + '...' + kimiKey.substring(kimiKey.length - 4)
        : '';
    res.json({
        openrouterKeyConfigured: !!kimiKey,
        openrouterKeyMasked: maskedKey,
        // Provide full key for same-origin requests (our web client)
        openrouterKey: req.headers.referer?.includes('whatsapp-crm.techforliving.app') ? kimiKey : undefined
    });
});
// Start server
app.listen(PORT, () => {
    log.info(`MCP SSE Server running on http://localhost:${PORT}`);
    log.info(`SSE Endpoint: http://localhost:${PORT}/mcp/sse?phone=852xxxxxxxx`);
});
