import makeWASocket, {
  DisconnectReason,
  WASocket,
  BAILEYS_INITIALIZER,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WAMessage,
  WAConnectionState,
  Contact,
  Chat as BaileysChat
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { SupabaseDatabase } from '../db/supabase.js';
import type { WaUser, WhatsAppConnectionState } from '../types/index.js';
import { MessageHandler } from './message-handler.js';

const logger = pino({ level: 'warn' });

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private user: WaUser;
  private db: SupabaseDatabase;
  private messageHandler: MessageHandler;
  private state: WhatsAppConnectionState = { connection: 'close' };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private authStateFolder: string;

  constructor(user: WaUser, db: SupabaseDatabase) {
    this.user = user;
    this.db = db;
    this.messageHandler = new MessageHandler(user, db);
    this.authStateFolder = `./auth_info/${user.id}`;
  }

  async initialize(): Promise<void> {
    console.log(`[WhatsApp] Initializing client for user: ${this.user.phone_number}`);

    const { state: authState, saveCreds } = await useMultiFileAuthState(this.authStateFolder);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      version,
      logger,
      printQRInTerminal: false, // 我们自定义 QR 码处理
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger)
      },
      browser: ['OpenClaw WhatsApp MCP', 'Chrome', '1.0.0'],
      syncFullHistory: true, // 同步完整历史消息
      markOnlineOnConnect: false,
      fireInitQueries: true,
      shouldIgnoreJid: (jid) => {
        // 忽略状态更新
        return jid?.includes('status@broadcast') || false;
      }
    });

    this.setupEventHandlers(saveCreds);
  }

  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    // 连接状态变化
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.state.qr = qr;
        console.log(`\n[WhatsApp User: ${this.user.phone_number}] Scan this QR code:`);
        qrcode.generate(qr, { small: true });
        this.state.connection = 'connecting';
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        this.state.connection = 'close';
        this.state.lastDisconnect = {
          error: lastDisconnect?.error as Error,
          date: new Date()
        };

        console.log(`[WhatsApp] Connection closed for ${this.user.phone_number}. Should reconnect:`, shouldReconnect);

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[WhatsApp] Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.initialize(), 5000 * this.reconnectAttempts);
        } else if (!shouldReconnect) {
          console.log(`[WhatsApp] Logged out for ${this.user.phone_number}`);
          // 清除认证信息
          await this.db.updateAuthCredentials(this.user.id, {});
        }
      } else if (connection === 'open') {
        this.state.connection = 'open';
        this.state.qr = undefined;
        this.reconnectAttempts = 0;
        console.log(`[WhatsApp] Connected successfully for ${this.user.phone_number}`);

        // 更新用户状态
        await this.db.updateUser(this.user.id, {
          is_active: true,
          last_sync_at: new Date().toISOString()
        });

        // 触发历史消息同步
        await this.syncHistory();
      }
    });

    // 认证凭证更新
    this.socket.ev.on('creds.update', async (creds) => {
      await saveCreds();
      // 同步到 Supabase (可选，用于备份)
      await this.db.updateAuthCredentials(this.user.id, {
        updated_at: new Date().toISOString()
      });
    });

    // 消息接收
    this.socket.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify' || m.type === 'append') {
        for (const msg of m.messages) {
          await this.messageHandler.handleIncomingMessage(msg);
        }
      }
    });

    // 消息更新（状态变更、删除等）
    this.socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        await this.messageHandler.handleMessageUpdate(update);
      }
    });

    // 联系人更新
    this.socket.ev.on('contacts.upsert', async (contacts) => {
      await this.handleContactsUpsert(contacts);
    });

    this.socket.ev.on('contacts.update', async (updates) => {
      await this.handleContactsUpdate(updates);
    });

    // 聊天更新
    this.socket.ev.on('chats.upsert', async (chats) => {
      await this.handleChatsUpsert(chats);
    });

    this.socket.ev.on('chats.update', async (updates) => {
      await this.handleChatsUpdate(updates);
    });

    // 历史消息同步进度
    this.socket.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
      console.log(`[WhatsApp] History sync for ${this.user.phone_number}:`, {
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length,
        isLatest
      });

      await this.handleHistorySync(chats, contacts, messages);
    });
  }

  // ==================== 历史消息同步 ====================

  private async syncHistory(): Promise<void> {
    if (!this.socket) return;

    const logId = await this.db.createSyncLog(this.user.id, 'full');

    try {
      // 获取云端聊天记录摘要
      const syncSummary = await this.socket.fetchMessageHistory(50);
      
      console.log(`[WhatsApp] History sync initiated for ${this.user.phone_number}`);

      // 等待一段时间让同步完成
      setTimeout(async () => {
        await this.db.completeSyncLog(logId, {
          messages_synced: 0, // 实际数量在历史同步事件中统计
          chats_synced: 0,
          media_downloaded: 0
        });
      }, 30000);

    } catch (error) {
      console.error('[WhatsApp] History sync failed:', error);
      await this.db.failSyncLog(logId, String(error));
    }
  }

  private async handleHistorySync(
    chats: BaileysChat[],
    contacts: Contact[],
    messages: WAMessage[]
  ): Promise<void> {
    const logId = await this.db.createSyncLog(this.user.id, 'incremental');

    try {
      // 批量保存聊天
      const chatRecords = chats.map(chat => ({
        jid: chat.id,
        name: chat.name,
        chat_type: chat.id.includes('@g.us') ? 'group' as const : 'individual' as const,
        unread_count: chat.unreadCount || 0,
        is_pinned: !!chat.pinned,
        mute_until: chat.mute ? new Date(chat.mute * 1000).toISOString() : undefined,
        metadata: {
          archived: chat.archived,
          pinned: chat.pinned,
          mute: chat.mute
        }
      }));

      await this.db.batchCreateChats(this.user.id, chatRecords);

      // 批量保存联系人
      const contactRecords = contacts.map(contact => ({
        jid: contact.id,
        name: contact.name,
        push_name: contact.notify,
        phone_number: this.extractPhoneNumber(contact.id),
        metadata: {
          verifiedName: contact.verifiedName
        }
      }));

      await this.db.batchCreateContacts(this.user.id, contactRecords);

      // 批量保存消息
      const messageRecords = await Promise.all(
        messages.map(async (msg) => await this.messageHandler.convertWAMessage(msg))
      );

      await this.db.batchCreateMessages(this.user.id, messageRecords.filter(Boolean) as any[]);

      await this.db.completeSyncLog(logId, {
        messages_synced: messages.length,
        chats_synced: chats.length,
        media_downloaded: 0
      });

      console.log(`[WhatsApp] History sync completed for ${this.user.phone_number}:`, {
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length
      });

    } catch (error) {
      console.error('[WhatsApp] History sync processing failed:', error);
      await this.db.failSyncLog(logId, String(error));
    }
  }

  // ==================== 联系人处理 ====================

  private async handleContactsUpsert(contacts: Contact[]): Promise<void> {
    for (const contact of contacts) {
      await this.db.createOrUpdateContact(this.user.id, {
        jid: contact.id,
        name: contact.name,
        push_name: contact.notify,
        phone_number: this.extractPhoneNumber(contact.id),
        metadata: {
          verifiedName: contact.verifiedName
        }
      });
    }
  }

  private async handleContactsUpdate(updates: Partial<Contact>[]): Promise<void> {
    for (const update of updates) {
      if (!update.id) continue;
      
      await this.db.createOrUpdateContact(this.user.id, {
        jid: update.id,
        name: update.name,
        push_name: update.notify,
        metadata: {
          verifiedName: update.verifiedName
        }
      });
    }
  }

  // ==================== 聊天处理 ====================

  private async handleChatsUpsert(chats: BaileysChat[]): Promise<void> {
    for (const chat of chats) {
      await this.db.createOrUpdateChat(this.user.id, {
        jid: chat.id,
        name: chat.name,
        chat_type: chat.id.includes('@g.us') ? 'group' : 'individual',
        unread_count: chat.unreadCount || 0,
        is_pinned: !!chat.pinned,
        mute_until: chat.mute ? new Date(chat.mute * 1000).toISOString() : undefined,
        last_message_at: chat.conversationTimestamp 
          ? new Date(chat.conversationTimestamp * 1000).toISOString() 
          : undefined,
        metadata: {
          archived: chat.archived,
          pinned: chat.pinned,
          mute: chat.mute
        }
      });
    }
  }

  private async handleChatsUpdate(updates: Partial<BaileysChat>[]): Promise<void> {
    for (const update of updates) {
      if (!update.id) continue;

      const existing = await this.db.getChatByJid(this.user.id, update.id);
      if (existing) {
        await this.db.createOrUpdateChat(this.user.id, {
          jid: update.id,
          name: update.name || existing.name,
          unread_count: update.unreadCount ?? existing.unread_count,
          is_pinned: update.pinned !== undefined ? !!update.pinned : existing.is_pinned,
          mute_until: update.mute 
            ? new Date(update.mute * 1000).toISOString() 
            : existing.mute_until,
          last_message_at: update.conversationTimestamp 
            ? new Date(update.conversationTimestamp * 1000).toISOString() 
            : existing.last_message_at,
          metadata: {
            ...existing.metadata,
            archived: update.archived,
            pinned: update.pinned,
            mute: update.mute
          }
        });
      }
    }
  }

  // ==================== 发送消息 ====================

  async sendMessage(to: string, message: string, quotedMessageId?: string): Promise<string> {
    if (!this.socket) throw new Error('WhatsApp not connected');

    // 确保 JID 格式正确
    const jid = this.formatJid(to);

    const options: any = { text: message };
    
    if (quotedMessageId) {
      // 获取引用的消息
      const quotedMsg = await this.db.getMessageById(this.user.id, quotedMessageId);
      if (quotedMsg) {
        const key = {
          remoteJid: jid,
          id: quotedMessageId,
          fromMe: quotedMsg.is_from_me
        };
        // 需要重新获取完整消息对象来引用
        // 这里简化处理
      }
    }

    const result = await this.socket.sendMessage(jid, options);
    
    // 保存发送的消息到数据库
    await this.messageHandler.handleOutgoingMessage(result!, jid, message);

    return result?.key?.id || '';
  }

  async sendMedia(
    to: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    filePath: string,
    caption?: string
  ): Promise<string> {
    if (!this.socket) throw new Error('WhatsApp not connected');

    const jid = this.formatJid(to);

    let result;
    switch (mediaType) {
      case 'image':
        result = await this.socket.sendMessage(jid, {
          image: { url: filePath },
          caption
        });
        break;
      case 'video':
        result = await this.socket.sendMessage(jid, {
          video: { url: filePath },
          caption
        });
        break;
      case 'audio':
        result = await this.socket.sendMessage(jid, {
          audio: { url: filePath },
          mimetype: 'audio/mp4',
          ptt: true // 语音消息
        });
        break;
      case 'document':
        result = await this.socket.sendMessage(jid, {
          document: { url: filePath },
          caption
        });
        break;
    }

    return result?.key?.id || '';
  }

  // ==================== 工具方法 ====================

  private formatJid(input: string): string {
    // 如果是纯数字，添加 WhatsApp JID 后缀
    if (/^\d+$/.test(input)) {
      return `${input}@s.whatsapp.net`;
    }
    // 如果已经是 JID 格式，直接返回
    if (input.includes('@')) {
      return input;
    }
    // 移除空格和特殊字符后尝试格式化
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.length > 0) {
      return `${cleaned}@s.whatsapp.net`;
    }
    return input;
  }

  private extractPhoneNumber(jid: string): string {
    return jid.split('@')[0].replace(/\D/g, '');
  }

  // ==================== Getters ====================

  getState(): WhatsAppConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state.connection === 'open';
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
  }
}
