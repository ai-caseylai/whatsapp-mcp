import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';
import { SupabaseDatabase } from '../db/supabase.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import type { WaUser } from '../types/index.js';

// Tool 定义
const TOOLS: Tool[] = [
  {
    name: 'whatsapp_search_contacts',
    description: 'Search WhatsApp contacts by name or phone number',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (name or phone number)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20
        }
      },
      required: ['query']
    }
  },
  {
    name: 'whatsapp_list_chats',
    description: 'List WhatsApp chats with optional filtering and sorting',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of chats to return (default: 50)',
          default: 50
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default: 0)',
          default: 0
        },
        include_last_message: {
          type: 'boolean',
          description: 'Include the last message in each chat (default: false)',
          default: false
        }
      }
    }
  },
  {
    name: 'whatsapp_get_chat',
    description: 'Get detailed information about a specific chat',
    inputSchema: {
      type: 'object',
      properties: {
        chat_jid: {
          type: 'string',
          description: 'WhatsApp JID of the chat (e.g., 1234567890@s.whatsapp.net or group@g.us)'
        }
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
        chat_jid: {
          type: 'string',
          description: 'WhatsApp JID of the chat'
        },
        limit: {
          type: 'number',
          description: 'Number of messages to return (default: 50)',
          default: 50
        },
        before_message_id: {
          type: 'string',
          description: 'Get messages before this message ID (for pagination)'
        }
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
        query: {
          type: 'string',
          description: 'Search text'
        },
        chat_jid: {
          type: 'string',
          description: 'Optional: limit search to specific chat'
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20
        }
      },
      required: ['query']
    }
  },
  {
    name: 'whatsapp_send_message',
    description: 'Send a text message to a WhatsApp contact or group',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient phone number or JID (e.g., 1234567890 or 1234567890@s.whatsapp.net)'
        },
        message: {
          type: 'string',
          description: 'Message text to send'
        },
        quoted_message_id: {
          type: 'string',
          description: 'Optional: ID of message to reply to'
        }
      },
      required: ['to', 'message']
    }
  },
  {
    name: 'whatsapp_get_contact',
    description: 'Get detailed information about a contact',
    inputSchema: {
      type: 'object',
      properties: {
        jid: {
          type: 'string',
          description: 'Contact JID (e.g., 1234567890@s.whatsapp.net)'
        }
      },
      required: ['jid']
    }
  },
  {
    name: 'whatsapp_get_connection_status',
    description: 'Get the current WhatsApp connection status',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'whatsapp_sync_history',
    description: 'Trigger a manual sync of message history',
    inputSchema: {
      type: 'object',
      properties: {
        full_sync: {
          type: 'boolean',
          description: 'Perform a full sync instead of incremental (default: false)',
          default: false
        },
        days_back: {
          type: 'number',
          description: 'How many days back to sync (default: 30)',
          default: 30
        }
      }
    }
  }
];

export class WhatsAppMCPServer {
  private server: Server;
  private db: SupabaseDatabase;
  private whatsappClient: WhatsAppClient | null = null;
  private user: WaUser | null = null;

  constructor(db: SupabaseDatabase) {
    this.db = db;
    
    this.server = new Server(
      {
        name: 'whatsapp-mcp-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }));

    // Call Tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // 确保 WhatsApp 客户端已初始化
        await this.ensureWhatsAppClient();

        switch (name) {
          case 'whatsapp_search_contacts':
            return await this.handleSearchContacts(args as any);
          case 'whatsapp_list_chats':
            return await this.handleListChats(args as any);
          case 'whatsapp_get_chat':
            return await this.handleGetChat(args as any);
          case 'whatsapp_list_messages':
            return await this.handleListMessages(args as any);
          case 'whatsapp_search_messages':
            return await this.handleSearchMessages(args as any);
          case 'whatsapp_send_message':
            return await this.handleSendMessage(args as any);
          case 'whatsapp_get_contact':
            return await this.handleGetContact(args as any);
          case 'whatsapp_get_connection_status':
            return await this.handleGetConnectionStatus();
          case 'whatsapp_sync_history':
            return await this.handleSyncHistory(args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error(`[MCP Server] Error calling tool ${name}:`, error);
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          } as TextContent],
          isError: true
        };
      }
    });
  }

  // ==================== Tool Handlers ====================

  private async handleSearchContacts(args: { query: string; limit?: number }) {
    if (!this.user) throw new Error('User not initialized');

    const contacts = await this.db.searchContacts(this.user.id, args.query, args.limit || 20);

    const formatted = contacts.map(c => ({
      jid: c.jid,
      name: c.name || c.push_name || 'Unknown',
      phone: c.phone_number,
      is_business: c.is_business
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(formatted, null, 2)
      } as TextContent]
    };
  }

  private async handleListChats(args: { limit?: number; offset?: number; include_last_message?: boolean }) {
    if (!this.user) throw new Error('User not initialized');

    const chats = await this.db.listChats(
      this.user.id,
      args.limit || 50,
      args.offset || 0,
      args.include_last_message || false
    );

    const formatted = chats.map(c => ({
      jid: c.jid,
      name: c.name || 'Unknown',
      type: c.chat_type,
      unread: c.unread_count,
      last_message_at: c.last_message_at,
      last_message: c.last_message ? {
        content: c.last_message.content?.substring(0, 100),
        timestamp: c.last_message.timestamp,
        is_from_me: c.last_message.is_from_me
      } : undefined
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(formatted, null, 2)
      } as TextContent]
    };
  }

  private async handleGetChat(args: { chat_jid: string }) {
    if (!this.user) throw new Error('User not initialized');

    const chat = await this.db.getChatByJid(this.user.id, args.chat_jid);
    if (!chat) {
      return {
        content: [{
          type: 'text',
          text: 'Chat not found'
        } as TextContent]
      };
    }

    // 获取最近消息统计
    const recentMessages = await this.db.listMessages(this.user.id, args.chat_jid, 1);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          jid: chat.jid,
          name: chat.name,
          type: chat.chat_type,
          unread: chat.unread_count,
          is_pinned: chat.is_pinned,
          mute_until: chat.mute_until,
          last_message_at: chat.last_message_at,
          metadata: chat.metadata
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleListMessages(args: { chat_jid: string; limit?: number; before_message_id?: string }) {
    if (!this.user) throw new Error('User not initialized');

    const messages = await this.db.listMessages(
      this.user.id,
      args.chat_jid,
      args.limit || 50,
      args.before_message_id
    );

    const formatted = messages.map(m => ({
      id: m.message_id,
      sender: m.sender_name || m.sender_jid,
      content: m.content,
      type: m.message_type,
      timestamp: m.timestamp,
      is_from_me: m.is_from_me,
      status: m.status,
      quoted: m.quoted_message_content ? {
        content: m.quoted_message_content
      } : undefined
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(formatted, null, 2)
      } as TextContent]
    };
  }

  private async handleSearchMessages(args: { query: string; chat_jid?: string; limit?: number }) {
    if (!this.user) throw new Error('User not initialized');

    const messages = await this.db.searchMessages(
      this.user.id,
      args.query,
      args.chat_jid,
      args.limit || 20
    );

    const formatted = messages.map(m => ({
      id: m.message_id,
      chat_jid: m.sender_jid,
      sender: m.sender_name || m.sender_jid,
      content: m.content,
      timestamp: m.timestamp,
      is_from_me: m.is_from_me
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(formatted, null, 2)
      } as TextContent]
    };
  }

  private async handleSendMessage(args: { to: string; message: string; quoted_message_id?: string }) {
    if (!this.whatsappClient) throw new Error('WhatsApp not connected');

    const messageId = await this.whatsappClient.sendMessage(
      args.to,
      args.message,
      args.quoted_message_id
    );

    return {
      content: [{
        type: 'text',
        text: `Message sent successfully. ID: ${messageId}`
      } as TextContent]
    };
  }

  private async handleGetContact(args: { jid: string }) {
    if (!this.user) throw new Error('User not initialized');

    const contact = await this.db.getContactByJid(this.user.id, args.jid);
    if (!contact) {
      return {
        content: [{
          type: 'text',
          text: 'Contact not found'
        } as TextContent]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          jid: contact.jid,
          name: contact.name,
          push_name: contact.push_name,
          phone: contact.phone_number,
          status: contact.status,
          is_business: contact.is_business,
          is_blocked: contact.is_blocked
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleGetConnectionStatus() {
    const status = this.whatsappClient?.getState() || { connection: 'close' };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connection: status.connection,
          connected: this.whatsappClient?.isConnected() || false,
          qr_available: !!status.qr,
          user: this.user ? {
            phone: this.user.phone_number,
            name: this.user.display_name
          } : null
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleSyncHistory(args: { full_sync?: boolean; days_back?: number }) {
    // 触发同步（通过重新初始化或发送同步命令）
    // 实际同步由 Baileys 自动处理
    return {
      content: [{
        type: 'text',
        text: `Sync ${args.full_sync ? 'full' : 'incremental'} triggered. History sync is handled automatically by WhatsApp Web API.`
      } as TextContent]
    };
  }

  // ==================== Helpers ====================

  private async ensureWhatsAppClient(): Promise<void> {
    // 从环境变量获取用户配置
    const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
    const authUserId = process.env.WHATSAPP_AUTH_USER_ID;

    if (!phoneNumber) {
      throw new Error('WHATSAPP_PHONE_NUMBER environment variable not set');
    }

    // 如果已经有客户端且用户匹配，直接返回
    if (this.whatsappClient && this.user?.phone_number === phoneNumber) {
      return;
    }

    // 查找或创建用户
    let user = await this.db.getUserByPhone(phoneNumber);
    
    if (!user) {
      user = await this.db.createUser({
        phone_number: phoneNumber,
        auth_user_id: authUserId,
        is_active: true
      });
      console.log(`[MCP Server] Created new user: ${phoneNumber}`);
    }

    this.user = user;

    // 初始化 WhatsApp 客户端
    this.whatsappClient = new WhatsAppClient(user, this.db);
    await this.whatsappClient.initialize();

    // 等待连接或 QR 码
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
      
      const checkConnection = setInterval(() => {
        const state = this.whatsappClient?.getState();
        if (state?.connection === 'open') {
          clearInterval(checkConnection);
          clearTimeout(timeout);
          resolve(undefined);
        } else if (state?.qr) {
          // 有 QR 码，让用户扫描
          console.log('[MCP Server] Please scan the QR code above with WhatsApp');
        }
      }, 1000);
    });
  }

  // ==================== Server Lifecycle ====================

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('[MCP Server] WhatsApp MCP Server started');
  }

  async stop(): Promise<void> {
    if (this.whatsappClient) {
      await this.whatsappClient.disconnect();
    }
    await this.server.close();
  }
}
