import { WAMessage, proto } from '@whiskeysockets/baileys';
import { SupabaseDatabase } from '../db/supabase.js';
import type { WaUser, WaMessage } from '../types/index.js';

export class MessageHandler {
  private user: WaUser;
  private db: SupabaseDatabase;

  constructor(user: WaUser, db: SupabaseDatabase) {
    this.user = user;
    this.db = db;
  }

  // ==================== 入站消息处理 ====================

  async handleIncomingMessage(msg: WAMessage): Promise<void> {
    try {
      const messageData = await this.convertWAMessage(msg);
      if (!messageData) return;

      // 确保聊天存在
      const chatJid = msg.key.remoteJid!;
      const chat = await this.db.getChatByJid(this.user.id, chatJid);
      
      if (!chat) {
        // 创建新聊天
        await this.db.createOrUpdateChat(this.user.id, {
          jid: chatJid,
          name: msg.pushName || undefined,
          chat_type: chatJid.includes('@g.us') ? 'group' : 'individual',
          last_message_at: messageData.timestamp
        });
      }

      // 获取新创建的聊天
      const newChat = await this.db.getChatByJid(this.user.id, chatJid);
      if (newChat) {
        messageData.chat_id = newChat.id;
        await this.db.createMessage(this.user.id, messageData);
      }

      // 处理媒体下载
      if (messageData.message_type !== 'text' && this.user.sync_settings?.download_media && messageData.message_id) {
        await this.handleMediaDownload(msg, messageData.message_id);
      }

    } catch (error) {
      console.error('[MessageHandler] Error handling incoming message:', error);
    }
  }

  async handleOutgoingMessage(
    result: proto.WebMessageInfo,
    to: string,
    content: string
  ): Promise<void> {
    try {
      const chat = await this.db.getChatByJid(this.user.id, to);
      if (!chat) return;

      await this.db.createMessage(this.user.id, {
        chat_id: chat.id,
        message_id: result.key.id!,
        sender_jid: this.user.phone_number,
        sender_name: 'Me',
        message_type: 'text',
        content,
        status: 'sent',
        is_from_me: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[MessageHandler] Error handling outgoing message:', error);
    }
  }

  // ==================== 消息更新处理 ====================

  async handleMessageUpdate(update: {
    key: proto.IMessageKey;
    update: Partial<proto.IWebMessageInfo>;
  }): Promise<void> {
    try {
      const { key, update: updateData } = update;

      if (updateData.status) {
        // 消息状态更新 (pending -> sent -> delivered -> read)
        const statusMap: Record<number, WaMessage['status']> = {
          0: 'pending',
          1: 'sent',
          2: 'delivered',
          3: 'read',
          4: 'failed'
        };
        
        const status = statusMap[updateData.status as number];
        if (status && key.id) {
          await this.db.updateMessageStatus(this.user.id, key.id, status);
        }
      }

      // 消息被删除
      if (updateData.messageStubType === 2) { // REVOKE
        if (key.id) {
          const existing = await this.db.getMessageById(this.user.id, key.id);
          if (existing) {
            await this.db.createMessage(this.user.id, {
              ...existing,
              is_deleted: true
            });
          }
        }
      }

    } catch (error) {
      console.error('[MessageHandler] Error handling message update:', error);
    }
  }

  // ==================== WAMessage 转换 ====================

  async convertWAMessage(msg: WAMessage): Promise<Partial<WaMessage> | null> {
    const messageType = this.getMessageType(msg);
    if (!messageType) return null;

    const content = this.extractContent(msg);
    const mediaInfo = this.extractMediaInfo(msg);

    return {
      message_id: msg.key.id!,
      sender_jid: msg.key.participant || msg.key.remoteJid!,
      sender_name: msg.pushName ?? undefined,
      message_type: messageType,
      content: content || undefined,
      ...mediaInfo,
      quoted_message_id: this.extractQuotedMessageId(msg),
      quoted_message_content: this.extractQuotedContent(msg),
      status: this.mapMessageStatus(msg.status),
      is_from_me: msg.key.fromMe || false,
      timestamp: new Date(msg.messageTimestamp! as number * 1000).toISOString(),
      metadata: {
        messageStubType: msg.messageStubType,
        messageStubParameters: msg.messageStubParameters,
        participant: msg.participant,
        ephemeralOutOfSync: msg.ephemeralOutOfSync
      }
    };
  }

  // ==================== 消息类型判断 ====================

  private getMessageType(msg: WAMessage): WaMessage['message_type'] | null {
    const message = msg.message;
    if (!message) return null;

    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.stickerMessage) return 'sticker';
    if (message.locationMessage) return 'location';
    if (message.contactMessage || message.contactsArrayMessage) return 'vcard';
    
    return 'unknown';
  }

  // ==================== 内容提取 ====================

  private extractContent(msg: WAMessage): string | null {
    const message = msg.message;
    if (!message) return null;

    // 纯文本
    if (message.conversation) {
      return message.conversation;
    }

    // 扩展文本 (包含链接预览等)
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }

    // 图片配文
    if (message.imageMessage?.caption) {
      return `[圖片] ${message.imageMessage.caption}`;
    }

    // 视频配文
    if (message.videoMessage?.caption) {
      return `[影片] ${message.videoMessage.caption}`;
    }

    // 文档
    if (message.documentMessage) {
      return `[檔案] ${message.documentMessage.fileName || '未命名'}`;
    }

    // 音频
    if (message.audioMessage) {
      return message.audioMessage.ptt ? '[語音訊息]' : '[音訊]';
    }

    // 位置
    if (message.locationMessage) {
      const loc = message.locationMessage;
      return `[位置] ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
    }

    // 联系人
    if (message.contactMessage) {
      return `[聯絡人] ${message.contactMessage.displayName || ''}`;
    }

    // 贴纸
    if (message.stickerMessage) {
      return '[貼圖]';
    }

    return null;
  }

  // ==================== 媒体信息提取 ====================

  private extractMediaInfo(msg: WAMessage): Partial<WaMessage> {
    const message = msg.message;
    if (!message) return {};

    let mediaData: any;

    if (message.imageMessage) mediaData = message.imageMessage;
    else if (message.videoMessage) mediaData = message.videoMessage;
    else if (message.audioMessage) mediaData = message.audioMessage;
    else if (message.documentMessage) mediaData = message.documentMessage;
    else if (message.stickerMessage) mediaData = message.stickerMessage;

    if (!mediaData) return {};

    return {
      media_mime_type: mediaData.mimetype,
      media_file_name: mediaData.fileName,
      media_file_size: mediaData.fileLength ? Number(mediaData.fileLength) : undefined,
      media_duration: mediaData.seconds || undefined
    };
  }

  // ==================== 引用消息处理 ====================

  private extractQuotedMessageId(msg: WAMessage): string | undefined {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    return contextInfo?.stanzaId || undefined;
  }

  private extractQuotedContent(msg: WAMessage): string | undefined {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = contextInfo?.quotedMessage;
    
    if (!quotedMsg) return undefined;

    if (quotedMsg.conversation) return quotedMsg.conversation;
    if (quotedMsg.extendedTextMessage?.text) return quotedMsg.extendedTextMessage.text;
    if (quotedMsg.imageMessage) return '[圖片]';
    if (quotedMsg.videoMessage) return '[影片]';
    if (quotedMsg.audioMessage) return '[語音]';

    return undefined;
  }

  // ==================== 状态映射 ====================

  private mapMessageStatus(status: number | null | undefined): WaMessage['status'] {
    if (!status) return 'sent';
    
    const statusMap: Record<number, WaMessage['status']> = {
      0: 'pending',
      1: 'sent',
      2: 'delivered',
      3: 'read',
      4: 'failed'
    };

    return statusMap[status] || 'sent';
  }

  // ==================== 媒体下载 ====================

  private async handleMediaDownload(msg: WAMessage, messageId: string): Promise<void> {
    // 这里可以实现媒体下载逻辑
    // 1. 使用 baileys 的 downloadMediaMessage 下载媒体
    // 2. 上传到 Supabase Storage
    // 3. 更新数据库中的 media_url

    // 暂时跳过实现，因为需要 socket 实例
    console.log(`[MessageHandler] Media message received: ${messageId}`);
  }
}
