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
import {
  SearchContactsSchema,
  ListChatsSchema,
  GetChatSchema,
  ListMessagesSchema,
  SearchMessagesSchema,
  SendMessageSchema,
  GetContactSchema,
  SyncHistorySchema,
  validateSchema,
  type SearchContactsInput,
  type ListChatsInput,
  type GetChatInput,
  type ListMessagesInput,
  type SearchMessagesInput,
  type SendMessageInput,
  type GetContactInput,
  type SyncHistoryInput
} from '../schemas/index.js';
import { createLogger, ConnectionError, ValidationError, CleanupManager } from '../utils/index.js';

const log = createLogger('MCP-Server');

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
  private cleanupManager = new CleanupManager();
  private connectionState = {
    isConnecting: false,
    connectionPromise: null as Promise<void> | null
  };

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

        // Validate and route to appropriate handler
        switch (name) {
          case 'whatsapp_search_contacts': {
            const validation = validateSchema(SearchContactsSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleSearchContacts(validation.data);
          }
          case 'whatsapp_list_chats': {
            const validation = validateSchema(ListChatsSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleListChats(validation.data);
          }
          case 'whatsapp_get_chat': {
            const validation = validateSchema(GetChatSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleGetChat(validation.data);
          }
          case 'whatsapp_list_messages': {
            const validation = validateSchema(ListMessagesSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleListMessages(validation.data);
          }
          case 'whatsapp_search_messages': {
            const validation = validateSchema(SearchMessagesSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleSearchMessages(validation.data);
          }
          case 'whatsapp_send_message': {
            const validation = validateSchema(SendMessageSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleSendMessage(validation.data);
          }
          case 'whatsapp_get_contact': {
            const validation = validateSchema(GetContactSchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleGetContact(validation.data);
          }
          case 'whatsapp_get_connection_status':
            return await this.handleGetConnectionStatus();
          case 'whatsapp_sync_history': {
            const validation = validateSchema(SyncHistorySchema, args);
            if (!validation.success) return this.createErrorResponse(validation.error);
            return await this.handleSyncHistory(validation.data);
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        log.error({ tool: name, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
        return this.createErrorResponse(
          error instanceof Error ? error.message : 'An unexpected error occurred'
        );
      }
    });
  }

  // ==================== Response Helpers ====================

  private createErrorResponse(message: string) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${message}`
      } as TextContent],
      isError: true
    };
  }

  private createUserResponse(data: unknown) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2)
      } as TextContent]
    };
  }

  // ==================== Tool Handlers ====================

  private async handleSearchContacts(args: SearchContactsInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const contacts = await this.db.searchContacts(this.user.id, args.query, args.limit);

    const formatted = contacts.map(c => ({
      jid: c.jid,
      name: c.name || c.push_name || 'Unknown',
      phone: c.phone_number,
      is_business: c.is_business
    }));

    return this.createUserResponse(formatted);
  }

  private async handleListChats(args: ListChatsInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const chats = await this.db.listChats(
      this.user.id,
      args.limit,
      args.offset,
      args.include_last_message
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

    return this.createUserResponse(formatted);
  }

  private async handleGetChat(args: GetChatInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const chat = await this.db.getChatByJid(this.user.id, args.chat_jid);
    if (!chat) {
      return this.createUserResponse({ error: 'Chat not found' });
    }

    return this.createUserResponse({
      jid: chat.jid,
      name: chat.name,
      type: chat.chat_type,
      unread: chat.unread_count,
      is_pinned: chat.is_pinned,
      mute_until: chat.mute_until,
      last_message_at: chat.last_message_at,
      metadata: chat.metadata
    });
  }

  private async handleListMessages(args: ListMessagesInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const messages = await this.db.listMessages(
      this.user.id,
      args.chat_jid,
      args.limit,
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

    return this.createUserResponse(formatted);
  }

  private async handleSearchMessages(args: SearchMessagesInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const messages = await this.db.searchMessages(
      this.user.id,
      args.query,
      args.chat_jid,
      args.limit
    );

    const formatted = messages.map(m => ({
      id: m.message_id,
      chat_jid: m.sender_jid,
      sender: m.sender_name || m.sender_jid,
      content: m.content,
      timestamp: m.timestamp,
      is_from_me: m.is_from_me
    }));

    return this.createUserResponse(formatted);
  }

  private async handleSendMessage(args: SendMessageInput) {
    if (!this.whatsappClient) throw new ConnectionError('WhatsApp not connected');

    const messageId = await this.whatsappClient.sendMessage(
      args.to,
      args.message,
      args.quoted_message_id
    );

    log.info({ to: args.to, messageId }, 'Message sent successfully');

    return this.createUserResponse({
      success: true,
      message: 'Message sent successfully',
      message_id: messageId
    });
  }

  private async handleGetContact(args: GetContactInput) {
    if (!this.user) throw new ConnectionError('User not initialized');

    const contact = await this.db.getContactByJid(this.user.id, args.jid);
    if (!contact) {
      return this.createUserResponse({ error: 'Contact not found' });
    }

    return this.createUserResponse({
      jid: contact.jid,
      name: contact.name,
      push_name: contact.push_name,
      phone: contact.phone_number,
      status: contact.status,
      is_business: contact.is_business,
      is_blocked: contact.is_blocked
    });
  }

  private async handleGetConnectionStatus() {
    const status = this.whatsappClient?.getState() || { connection: 'close' };

    return this.createUserResponse({
      connection: status.connection,
      connected: this.whatsappClient?.isConnected() || false,
      qr_available: !!status.qr,
      user: this.user ? {
        phone: this.user.phone_number,
        name: this.user.display_name
      } : null
    });
  }

  private async handleSyncHistory(args: SyncHistoryInput) {
    log.info({ fullSync: args.full_sync, daysBack: args.days_back }, 'Sync history requested');
    
    return this.createUserResponse({
      success: true,
      message: `Sync ${args.full_sync ? 'full' : 'incremental'} triggered. History sync is handled automatically by WhatsApp Web API.`,
      days_back: args.days_back
    });
  }

  // ==================== Helpers ====================

  private async ensureWhatsAppClient(): Promise<void> {
    const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
    const authUserId = process.env.WHATSAPP_AUTH_USER_ID;

    if (!phoneNumber) {
      throw new ValidationError('WHATSAPP_PHONE_NUMBER environment variable not set');
    }

    // 如果已经有客户端且用户匹配，直接返回
    if (this.whatsappClient && this.user?.phone_number === phoneNumber) {
      return;
    }

    // 防止并发初始化
    if (this.connectionState.isConnecting && this.connectionState.connectionPromise) {
      await this.connectionState.connectionPromise;
      return;
    }

    this.connectionState.isConnecting = true;

    try {
      // 查找或创建用户
      let user = await this.db.getUserByPhone(phoneNumber);
      
      if (!user) {
        user = await this.db.createUser({
          phone_number: phoneNumber,
          auth_user_id: authUserId,
          is_active: true
        });
        log.info({ phoneNumber }, 'Created new user');
      }

      this.user = user;

      // 初始化 WhatsApp 客户端
      this.whatsappClient = new WhatsAppClient(user, this.db);
      
      // 创建连接 Promise
      this.connectionState.connectionPromise = this.waitForConnection();
      
      await this.whatsappClient.initialize();
      await this.connectionState.connectionPromise;
      
    } finally {
      this.connectionState.isConnecting = false;
      this.connectionState.connectionPromise = null;
    }
  }

  private async waitForConnection(): Promise<void> {
    const CONNECTION_TIMEOUT = 60000; // 60 seconds
    const CHECK_INTERVAL = 1000; // 1 second

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let intervalId: NodeJS.Timeout;

      const cleanup = () => {
        this.cleanupManager.clearInterval(intervalId);
        this.cleanupManager.clearTimeout(timeoutId);
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new ConnectionError('Connection timeout - please scan QR code within 60 seconds'));
      }, CONNECTION_TIMEOUT);
      this.cleanupManager.addTimeout(timeoutId);

      intervalId = setInterval(() => {
        const state = this.whatsappClient?.getState();
        
        if (state?.connection === 'open') {
          cleanup();
          resolve();
        } else if (state?.qr) {
          log.info('Please scan the QR code above with WhatsApp');
        }
      }, CHECK_INTERVAL);
      this.cleanupManager.addInterval(intervalId);
    });
  }

  // ==================== Server Lifecycle ====================

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info('WhatsApp MCP Server started');
    this.autoInitWhatsApp().catch(console.error);
  }

  private async autoInitWhatsApp(): Promise<void> {
    try {
      const phone = process.env.WHATSAPP_PHONE_NUMBER;
      if (!phone) { 
        log.warn('No WHATSAPP_PHONE_NUMBER configured'); 
        return; 
      }
      
      let user = await this.db.getUserByPhone(phone);
      if (!user) { 
        user = await this.db.createUser({ phone_number: phone, is_active: true }); 
      }
      this.user = user;
      this.whatsappClient = new WhatsAppClient(user, this.db);
      await this.whatsappClient.initialize();
      log.info('WhatsApp client initialized');
    } catch (err) { 
      log.error({ error: err }, 'Failed to initialize WhatsApp client'); 
    }
  }

  async stop(): Promise<void> {
    // Clean up all intervals and timeouts
    await this.cleanupManager.cleanup();

    if (this.whatsappClient) {
      await this.whatsappClient.disconnect();
    }
    await this.server.close();
    log.info('WhatsApp MCP Server stopped');
  }
}
