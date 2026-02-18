import makeWASocket, {
  DisconnectReason,
  WASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WAMessage,
  Contact,
  Chat as BaileysChat,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { SupabaseDatabase } from '../db/supabase.js';
import type { WaUser, WhatsAppConnectionState } from '../types/index.js';
import { MessageHandler } from './message-handler.js';
import QRCodeLib from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, WhatsAppError, ConnectionError, CleanupManager } from '../utils/index.js';

const log = createLogger('WhatsApp');

export class WhatsAppClient {
  private socket: WASocket | null = null;
  private user: WaUser;
  private db: SupabaseDatabase;
  private messageHandler: MessageHandler;
  private state: WhatsAppConnectionState = { connection: 'close' };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private authStateFolder: string;
  private cleanupManager = new CleanupManager();

  constructor(user: WaUser, db: SupabaseDatabase) {
    this.user = user;
    this.db = db;
    this.messageHandler = new MessageHandler(user, db, this);
    this.authStateFolder = `./auth_info/${user.id}`;
  }

  async initialize(): Promise<void> {
    log.info({ phoneNumber: this.user.phone_number }, 'Initializing WhatsApp client');

    const { state: authState, saveCreds } = await useMultiFileAuthState(this.authStateFolder);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      version,
      logger: pino({ level: 'warn' }),
      printQRInTerminal: false,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, pino({ level: 'warn' }))
      },
      browser: ['OpenClaw WhatsApp MCP', 'Chrome', '1.0.0'],
      syncFullHistory: true,
      markOnlineOnConnect: false,
      fireInitQueries: true,
      shouldIgnoreJid: (jid) => {
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
        console.log('[QR_AVAILABLE] QR code is ready at /qr-code.png');
        qrcode.generate(qr, { small: true });
        
        // 保存 QR 码为图片文件
        const publicDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
        
        QRCodeLib.toFile(path.join(publicDir, 'qr-code.png'), qr, { width: 400 })
          .then(() => log.info('QR code saved to public/qr-code.png'))
          .catch((err: unknown) => log.error({ error: err }, 'Failed to save QR code'));
        
        this.state.connection = 'connecting';
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        this.state.connection = 'close';
        this.state.lastDisconnect = {
          error: lastDisconnect?.error as Error,
          date: new Date()
        };

        log.info({ 
          phoneNumber: this.user.phone_number, 
          shouldReconnect 
        }, 'Connection closed');

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = 2000 * this.reconnectAttempts;
          
          log.info({ 
            attempt: this.reconnectAttempts, 
            maxAttempts: this.maxReconnectAttempts,
            delay 
          }, 'Scheduling reconnection');

          // FIX: Track timeout for cleanup
          const timeoutId = setTimeout(() => {
            this.initialize();
          }, delay);
          this.cleanupManager.addTimeout(timeoutId);
        } else if (!shouldReconnect) {
          log.info({ phoneNumber: this.user.phone_number }, 'Logged out, clearing credentials');
          await this.db.updateAuthCredentials(this.user.id, {});
        }
      } else if (connection === 'open') {
        this.state.connection = 'open';
        this.state.qr = undefined;
        this.reconnectAttempts = 0;
        log.info({ phoneNumber: this.user.phone_number }, 'Connected successfully');

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

    // 消息更新
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
      log.info({ 
        phoneNumber: this.user.phone_number,
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length,
        isLatest
      }, 'History sync received');

      await this.handleHistorySync(chats, contacts, messages);
    });
  }

  // ==================== 历史消息同步 ====================

  private async syncHistory(): Promise<void> {
    if (!this.socket) return;

    const logId = await this.db.createSyncLog(this.user.id, 'full');

    try {
      log.info({ phoneNumber: this.user.phone_number }, 'History sync initiated');

      // 等待历史同步事件完成
      const timeoutId = setTimeout(async () => {
        await this.db.completeSyncLog(logId, {
          messages_synced: 0,
          chats_synced: 0,
          media_downloaded: 0
        });
      }, 30000);
      this.cleanupManager.addTimeout(timeoutId);

    } catch (error) {
      log.error({ error }, 'History sync failed');
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
        name: chat.name ?? undefined,
        chat_type: chat.id.includes('@g.us') ? 'group' as const : 'individual' as const,
        unread_count: chat.unreadCount || 0,
        is_pinned: !!chat.pinned,
        metadata: {
          archived: chat.archived,
          pinned: chat.pinned
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

      const validMessages = messageRecords.filter(Boolean) as Partial<import('../types/index.js').WaMessage>[];
      await this.db.batchCreateMessages(this.user.id, validMessages);

      await this.db.completeSyncLog(logId, {
        messages_synced: messages.length,
        chats_synced: chats.length,
        media_downloaded: 0
      });

      log.info({ 
        phoneNumber: this.user.phone_number,
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length
      }, 'History sync completed');

    } catch (error) {
      log.error({ error }, 'History sync processing failed');
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
        name: chat.name ?? undefined,
        chat_type: chat.id.includes('@g.us') ? 'group' : 'individual',
        unread_count: chat.unreadCount || 0,
        is_pinned: !!chat.pinned,
        last_message_at: chat.conversationTimestamp 
          ? new Date(Number(chat.conversationTimestamp) * 1000).toISOString() 
          : undefined,
        metadata: {
          archived: chat.archived,
          pinned: chat.pinned
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
          last_message_at: update.conversationTimestamp 
            ? new Date(Number(update.conversationTimestamp) * 1000).toISOString() 
            : existing.last_message_at,
          metadata: {
            ...existing.metadata,
            archived: update.archived,
            pinned: update.pinned
          }
        });
      }
    }
  }

  // ==================== 发送消息 ====================

  async sendMessage(to: string, message: string, quotedMessageId?: string): Promise<string> {
    if (!this.socket) {
      throw new ConnectionError('WhatsApp not connected');
    }

    const jid = this.formatJid(to);

    try {
      let result;
      
      if (quotedMessageId) {
        const quotedMsg = await this.db.getMessageById(this.user.id, quotedMessageId);
        if (quotedMsg) {
          // 使用 extendedTextMessage 来引用消息
          result = await this.socket.sendMessage(jid, {
            text: message,
            contextInfo: {
              stanzaId: quotedMessageId,
              participant: quotedMsg.sender_jid,
              quotedMessage: {
                conversation: quotedMsg.content || ''
              }
            }
          });
          log.debug({ quotedMessageId, jid }, 'Sending quoted message');
        } else {
          log.warn({ quotedMessageId }, 'Quoted message not found, sending without quote');
          result = await this.socket.sendMessage(jid, { text: message });
        }
      } else {
        result = await this.socket.sendMessage(jid, { text: message });
      }
      
      // 保存发送的消息到数据库
      if (result) {
        await this.messageHandler.handleOutgoingMessage(result, jid, message);
      }

      const messageId = result?.key?.id || '';
      log.info({ messageId, jid }, 'Message sent successfully');
      
      return messageId;
    } catch (error) {
      log.error({ error, jid }, 'Failed to send message');
      throw new WhatsAppError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        'SEND_FAILED',
        true
      );
    }
  }

  async sendMedia(
    to: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    filePath: string,
    caption?: string
  ): Promise<string> {
    if (!this.socket) {
      throw new ConnectionError('WhatsApp not connected');
    }

    const jid = this.formatJid(to);

    try {
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
            ptt: true
          });
          break;
        case 'document':
          result = await this.socket.sendMessage(jid, {
            document: { url: filePath },
            mimetype: 'application/pdf',
            fileName: filePath.split('/').pop() || 'document.pdf',
            caption
          });
          break;
      }

      const messageId = result?.key?.id || '';
      log.info({ messageId, jid, mediaType }, 'Media sent successfully');
      
      return messageId;
    } catch (error) {
      log.error({ error, jid, mediaType }, 'Failed to send media');
      throw new WhatsAppError(
        `Failed to send media: ${error instanceof Error ? error.message : String(error)}`,
        'MEDIA_SEND_FAILED',
        true
      );
    }
  }

  // ==================== 媒体下载 ====================

  async downloadMedia(msg: WAMessage): Promise<Buffer | null> {
    if (!this.socket) {
      throw new ConnectionError('WhatsApp not connected');
    }

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: pino({ level: 'warn' }),
          reuploadRequest: this.socket.updateMediaMessage
        }
      );
      
      log.debug({ messageId: msg.key.id }, 'Media downloaded successfully');
      return buffer as Buffer;
    } catch (error) {
      log.warn({ error, messageId: msg.key.id }, 'Failed to download media');
      return null;
    }
  }

  // ==================== 工具方法 ====================

  private formatJid(input: string): string {
    if (/^\d+$/.test(input)) {
      return `${input}@s.whatsapp.net`;
    }
    if (input.includes('@')) {
      return input;
    }
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
    // Clean up all tracked timeouts
    await this.cleanupManager.cleanup();

    if (this.socket) {
      try {
        await this.socket.logout();
        log.info({ phoneNumber: this.user.phone_number }, 'Disconnected successfully');
      } catch (error) {
        log.warn({ error }, 'Error during disconnect');
      }
      this.socket = null;
    }
  }
}
