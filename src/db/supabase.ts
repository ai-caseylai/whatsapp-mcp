import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { 
  WaUser, WaChat, WaMessage, WaContact,
  ChatWithLastMessage, MessageWithMedia 
} from '../types/index.js';

export class SupabaseDatabase {
  private client: SupabaseClient;

  constructor(url?: string, key?: string) {
    const supabaseUrl = url || process.env.SUPABASE_URL;
    const supabaseKey = key || process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  // ==================== User Operations ====================

  async getUserByPhone(phoneNumber: string): Promise<WaUser | null> {
    const { data, error } = await this.client
      .from('wa_users')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (error) return null;
    return data as WaUser;
  }

  async getUserByAuthId(authUserId: string): Promise<WaUser | null> {
    const { data, error } = await this.client
      .from('wa_users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .single();

    if (error) return null;
    return data as WaUser;
  }

  async createUser(userData: Partial<WaUser>): Promise<WaUser> {
    const { data, error } = await this.client
      .from('wa_users')
      .insert(userData)
      .select()
      .single();

    if (error) throw error;
    return data as WaUser;
  }

  async updateUser(userId: string, updates: Partial<WaUser>): Promise<void> {
    const { error } = await this.client
      .from('wa_users')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;
  }

  async updateAuthCredentials(userId: string, credentials: Record<string, unknown>): Promise<void> {
    await this.updateUser(userId, { auth_credentials: credentials });
  }

  // ==================== Chat Operations ====================

  async getChatByJid(userId: string, jid: string): Promise<WaChat | null> {
    const { data, error } = await this.client
      .from('wa_chats')
      .select('*')
      .eq('user_id', userId)
      .eq('jid', jid)
      .single();

    if (error) return null;
    return data as WaChat;
  }

  async createOrUpdateChat(userId: string, chatData: Partial<WaChat>): Promise<WaChat> {
    const existing = await this.getChatByJid(userId, chatData.jid!);
    
    if (existing) {
      const { data, error } = await this.client
        .from('wa_chats')
        .update({ ...chatData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data as WaChat;
    } else {
      const { data, error } = await this.client
        .from('wa_chats')
        .insert({ ...chatData, user_id: userId })
        .select()
        .single();

      if (error) throw error;
      return data as WaChat;
    }
  }

  async listChats(
    userId: string, 
    limit = 50, 
    offset = 0,
    includeLastMessage = false
  ): Promise<ChatWithLastMessage[]> {
    let query = this.client
      .from('wa_chats')
      .select('*')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    const chats = data as WaChat[];

    if (includeLastMessage && chats.length > 0) {
      const chatIds = chats.map(c => c.id);
      const { data: messages } = await this.client
        .from('wa_messages')
        .select('*')
        .in('chat_id', chatIds)
        .eq('id', chats.map(c => c.last_message_id).filter(Boolean));

      const messageMap = new Map((messages as WaMessage[] || []).map(m => [m.id, m]));
      
      return chats.map(chat => ({
        ...chat,
        last_message: chat.last_message_id ? messageMap.get(chat.last_message_id) : undefined
      }));
    }

    return chats;
  }

  async updateChatLastMessage(chatId: string, messageId: string, timestamp: string): Promise<void> {
    await this.client
      .from('wa_chats')
      .update({
        last_message_id: messageId,
        last_message_at: timestamp,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId);
  }

  // ==================== Message Operations ====================

  async getMessageById(userId: string, messageId: string): Promise<WaMessage | null> {
    const { data, error } = await this.client
      .from('wa_messages')
      .select('*')
      .eq('user_id', userId)
      .eq('message_id', messageId)
      .single();

    if (error) return null;
    return data as WaMessage;
  }

  async createMessage(userId: string, messageData: Partial<WaMessage>): Promise<WaMessage> {
    const { data, error } = await this.client
      .from('wa_messages')
      .insert({ ...messageData, user_id: userId })
      .select()
      .single();

    if (error) {
      // 如果消息已存在，尝试更新
      if (error.code === '23505') { // unique violation
        const existing = await this.getMessageById(userId, messageData.message_id!);
        if (existing) {
          const { data: updated } = await this.client
            .from('wa_messages')
            .update({ ...messageData, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select()
            .single();
          return updated as WaMessage;
        }
      }
      throw error;
    }

    // 更新聊天的最后消息
    if (messageData.chat_id && messageData.timestamp) {
      await this.updateChatLastMessage(
        messageData.chat_id,
        (data as WaMessage).id,
        messageData.timestamp
      );
    }

    return data as WaMessage;
  }

  async listMessages(
    userId: string,
    chatJid: string,
    limit = 50,
    beforeMessageId?: string
  ): Promise<MessageWithMedia[]> {
    const chat = await this.getChatByJid(userId, chatJid);
    if (!chat) return [];

    let query = this.client
      .from('wa_messages')
      .select(`
        *,
        wa_media(*)
      `)
      .eq('user_id', userId)
      .eq('chat_id', chat.id)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (beforeMessageId) {
      const beforeMsg = await this.getMessageById(userId, beforeMessageId);
      if (beforeMsg) {
        query = query.lt('timestamp', beforeMsg.timestamp);
      }
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data as unknown as MessageWithMedia[]).reverse(); // 按时间正序返回
  }

  async searchMessages(
    userId: string,
    query: string,
    chatJid?: string,
    limit = 20
  ): Promise<WaMessage[]> {
    let dbQuery = this.client
      .from('wa_messages')
      .select('*')
      .eq('user_id', userId)
      .ilike('content', `%${query}%`)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (chatJid) {
      const chat = await this.getChatByJid(userId, chatJid);
      if (chat) {
        dbQuery = dbQuery.eq('chat_id', chat.id);
      }
    }

    const { data, error } = await dbQuery;
    if (error) throw error;
    return data as WaMessage[];
  }

  async updateMessageStatus(
    userId: string,
    messageId: string,
    status: WaMessage['status']
  ): Promise<void> {
    await this.client
      .from('wa_messages')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('message_id', messageId);
  }

  // ==================== Contact Operations ====================

  async getContactByJid(userId: string, jid: string): Promise<WaContact | null> {
    const { data, error } = await this.client
      .from('wa_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('jid', jid)
      .single();

    if (error) return null;
    return data as WaContact;
  }

  async createOrUpdateContact(userId: string, contactData: Partial<WaContact>): Promise<WaContact> {
    const existing = await this.getContactByJid(userId, contactData.jid!);
    
    if (existing) {
      const { data, error } = await this.client
        .from('wa_contacts')
        .update({ ...contactData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data as WaContact;
    } else {
      const { data, error } = await this.client
        .from('wa_contacts')
        .insert({ ...contactData, user_id: userId })
        .select()
        .single();

      if (error) throw error;
      return data as WaContact;
    }
  }

  async searchContacts(userId: string, query: string, limit = 20): Promise<WaContact[]> {
    const { data, error } = await this.client
      .from('wa_contacts')
      .select('*')
      .eq('user_id', userId)
      .or(`name.ilike.%${query}%,push_name.ilike.%${query}%,jid.ilike.%${query}%`)
      .limit(limit);

    if (error) throw error;
    return data as WaContact[];
  }

  // ==================== Sync Operations ====================

  async createSyncLog(
    userId: string,
    syncType: string
  ): Promise<string> {
    const { data, error } = await this.client
      .from('wa_sync_logs')
      .insert({
        user_id: userId,
        sync_type: syncType,
        status: 'started',
        start_time: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return (data as { id: string }).id;
  }

  async completeSyncLog(
    logId: string,
    stats: {
      messages_synced: number;
      chats_synced: number;
      media_downloaded: number;
    }
  ): Promise<void> {
    await this.client
      .from('wa_sync_logs')
      .update({
        status: 'completed',
        ...stats,
        completed_at: new Date().toISOString()
      })
      .eq('id', logId);
  }

  async failSyncLog(logId: string, error: string): Promise<void> {
    await this.client
      .from('wa_sync_logs')
      .update({
        status: 'failed',
        errors: [error],
        completed_at: new Date().toISOString()
      })
      .eq('id', logId);
  }

  // ==================== Batch Operations ====================

  async batchCreateMessages(userId: string, messages: Partial<WaMessage>[]): Promise<void> {
    if (messages.length === 0) return;

    const messagesWithUserId = messages.map(m => ({ ...m, user_id: userId }));

    const { error } = await this.client
      .from('wa_messages')
      .upsert(messagesWithUserId, { 
        onConflict: 'user_id,message_id',
        ignoreDuplicates: true 
      });

    if (error) throw error;
  }

  async batchCreateChats(userId: string, chats: Partial<WaChat>[]): Promise<void> {
    if (chats.length === 0) return;

    const chatsWithUserId = chats.map(c => ({ ...c, user_id: userId }));

    const { error } = await this.client
      .from('wa_chats')
      .upsert(chatsWithUserId, { 
        onConflict: 'user_id,jid',
        ignoreDuplicates: false 
      });

    if (error) throw error;
  }

  async batchCreateContacts(userId: string, contacts: Partial<WaContact>[]): Promise<void> {
    if (contacts.length === 0) return;

    const contactsWithUserId = contacts.map(c => ({ ...c, user_id: userId }));

    const { error } = await this.client
      .from('wa_contacts')
      .upsert(contactsWithUserId, { 
        onConflict: 'user_id,jid',
        ignoreDuplicates: false 
      });

    if (error) throw error;
  }
}
