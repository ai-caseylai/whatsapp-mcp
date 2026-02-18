import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { 
  WaUser, WaChat, WaMessage, WaContact,
  ChatWithLastMessage, MessageWithMedia 
} from '../types/index.js';
import { createLogger, DatabaseError } from '../utils/index.js';

const log = createLogger('Database');

export class SupabaseDatabase {
  private client: SupabaseClient;

  constructor(url?: string, key?: string) {
    const supabaseUrl = url || process.env.SUPABASE_URL;
    const supabaseKey = key || process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new DatabaseError('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    log.info('Database client initialized');
  }

  // ==================== Helper Methods ====================

  private logOperation(operation: string, details?: Record<string, unknown>) {
    log.debug({ operation, ...details }, 'Database operation');
  }

  // ==================== User Operations ====================

  async getUserByPhone(phoneNumber: string): Promise<WaUser | null> {
    this.logOperation('getUserByPhone', { phoneNumber });

    const { data, error } = await this.client
      .from('wa_users')
      .select('*')
      .eq('phone_number', phoneNumber)
      .maybeSingle();

    if (error) {
      log.warn({ phoneNumber, error: error.message }, 'Error fetching user by phone');
      return null;
    }
    
    return data as WaUser | null;
  }

  async getUserByAuthId(authUserId: string): Promise<WaUser | null> {
    this.logOperation('getUserByAuthId', { authUserId });

    const { data, error } = await this.client
      .from('wa_users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) {
      log.warn({ authUserId, error: error.message }, 'Error fetching user by auth ID');
      return null;
    }
    
    return data as WaUser | null;
  }

  async createUser(userData: Partial<WaUser>): Promise<WaUser> {
    this.logOperation('createUser', { phoneNumber: userData.phone_number });

    const { data, error } = await this.client
      .from('wa_users')
      .insert(userData)
      .select()
      .single();

    if (error) {
      log.error({ error: error.message }, 'Failed to create user');
      throw new DatabaseError('Failed to create user', error);
    }
    
    log.info({ userId: (data as WaUser).id }, 'User created successfully');
    return data as WaUser;
  }

  async updateUser(userId: string, updates: Partial<WaUser>): Promise<void> {
    this.logOperation('updateUser', { userId });

    const { error } = await this.client
      .from('wa_users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      log.error({ userId, error: error.message }, 'Failed to update user');
      throw new DatabaseError('Failed to update user', error);
    }
  }

  async updateAuthCredentials(userId: string, credentials: Record<string, unknown>): Promise<void> {
    this.logOperation('updateAuthCredentials', { userId });
    await this.updateUser(userId, { auth_credentials: credentials });
  }

  // ==================== Chat Operations ====================

  async getChatByJid(userId: string, jid: string): Promise<WaChat | null> {
    this.logOperation('getChatByJid', { userId, jid });

    const { data, error } = await this.client
      .from('wa_chats')
      .select('*')
      .eq('user_id', userId)
      .eq('jid', jid)
      .maybeSingle();

    if (error) {
      log.warn({ userId, jid, error: error.message }, 'Error fetching chat');
      return null;
    }
    
    return data as WaChat | null;
  }

  async createOrUpdateChat(userId: string, chatData: Partial<WaChat>): Promise<WaChat> {
    this.logOperation('createOrUpdateChat', { userId, jid: chatData.jid });

    const existing = await this.getChatByJid(userId, chatData.jid!);
    
    if (existing) {
      const { data, error } = await this.client
        .from('wa_chats')
        .update({ ...chatData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new DatabaseError('Failed to update chat', error);
      }
      return data as WaChat;
    } else {
      const { data, error } = await this.client
        .from('wa_chats')
        .insert({ ...chatData, user_id: userId })
        .select()
        .single();

      if (error) {
        throw new DatabaseError('Failed to create chat', error);
      }
      return data as WaChat;
    }
  }

  async listChats(
    userId: string, 
    limit = 50, 
    offset = 0,
    includeLastMessage = false
  ): Promise<ChatWithLastMessage[]> {
    this.logOperation('listChats', { userId, limit, offset, includeLastMessage });

    const { data, error } = await this.client
      .from('wa_chats')
      .select('*')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new DatabaseError('Failed to list chats', error);
    }

    const chats = data as WaChat[];

    if (!includeLastMessage || chats.length === 0) {
      return chats;
    }

    // FIX: Correctly fetch last messages using .in() for multiple IDs
    const lastMessageIds = chats
      .map(c => c.last_message_id)
      .filter((id): id is string => id !== null && id !== undefined);

    if (lastMessageIds.length === 0) {
      return chats;
    }

    const { data: messages, error: messagesError } = await this.client
      .from('wa_messages')
      .select('*')
      .in('id', lastMessageIds);

    if (messagesError) {
      log.warn({ error: messagesError.message }, 'Error fetching last messages');
      return chats;
    }

    const messageMap = new Map(
      (messages as WaMessage[] || []).map(m => [m.id, m])
    );
    
    return chats.map(chat => ({
      ...chat,
      last_message: chat.last_message_id ? messageMap.get(chat.last_message_id) : undefined
    }));
  }

  async updateChatLastMessage(chatId: string, messageId: string, timestamp: string): Promise<void> {
    this.logOperation('updateChatLastMessage', { chatId, messageId });

    const { error } = await this.client
      .from('wa_chats')
      .update({
        last_message_id: messageId,
        last_message_at: timestamp,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId);

    if (error) {
      log.warn({ chatId, error: error.message }, 'Failed to update chat last message');
    }
  }

  // ==================== Message Operations ====================

  async getMessageById(userId: string, messageId: string): Promise<WaMessage | null> {
    this.logOperation('getMessageById', { userId, messageId });

    const { data, error } = await this.client
      .from('wa_messages')
      .select('*')
      .eq('user_id', userId)
      .eq('message_id', messageId)
      .maybeSingle();

    if (error) {
      log.warn({ messageId, error: error.message }, 'Error fetching message');
      return null;
    }
    
    return data as WaMessage | null;
  }

  async getMessageByDbId(dbId: string): Promise<WaMessage | null> {
    this.logOperation('getMessageByDbId', { dbId });

    const { data, error } = await this.client
      .from('wa_messages')
      .select('*')
      .eq('id', dbId)
      .maybeSingle();

    if (error) {
      log.warn({ dbId, error: error.message }, 'Error fetching message by DB ID');
      return null;
    }
    
    return data as WaMessage | null;
  }

  async createMessage(userId: string, messageData: Partial<WaMessage>): Promise<WaMessage> {
    this.logOperation('createMessage', { userId, messageId: messageData.message_id });

    const { data, error } = await this.client
      .from('wa_messages')
      .insert({ ...messageData, user_id: userId })
      .select()
      .single();

    if (error) {
      // 如果消息已存在，尝试更新
      if (error.code === '23505') { // unique violation
        log.debug({ messageId: messageData.message_id }, 'Message exists, updating');
        
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
      throw new DatabaseError('Failed to create message', error);
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
    this.logOperation('listMessages', { userId, chatJid, limit, beforeMessageId });

    const chat = await this.getChatByJid(userId, chatJid);
    if (!chat) {
      log.warn({ chatJid }, 'Chat not found for listing messages');
      return [];
    }

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

    if (error) {
      throw new DatabaseError('Failed to list messages', error);
    }
    
    return (data as unknown as MessageWithMedia[] || []).reverse();
  }

  async searchMessages(
    userId: string,
    query: string,
    chatJid?: string,
    limit = 20
  ): Promise<WaMessage[]> {
    this.logOperation('searchMessages', { userId, query, chatJid, limit });

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
    if (error) {
      throw new DatabaseError('Failed to search messages', error);
    }
    return (data as WaMessage[]) || [];
  }

  async updateMessageStatus(
    userId: string,
    messageId: string,
    status: WaMessage['status']
  ): Promise<void> {
    this.logOperation('updateMessageStatus', { userId, messageId, status });

    const { error } = await this.client
      .from('wa_messages')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('message_id', messageId);

    if (error) {
      log.warn({ messageId, error: error.message }, 'Failed to update message status');
    }
  }

  // ==================== Contact Operations ====================

  async getContactByJid(userId: string, jid: string): Promise<WaContact | null> {
    this.logOperation('getContactByJid', { userId, jid });

    const { data, error } = await this.client
      .from('wa_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('jid', jid)
      .maybeSingle();

    if (error) {
      log.warn({ jid, error: error.message }, 'Error fetching contact');
      return null;
    }
    
    return data as WaContact | null;
  }

  async createOrUpdateContact(userId: string, contactData: Partial<WaContact>): Promise<WaContact> {
    this.logOperation('createOrUpdateContact', { userId, jid: contactData.jid });

    const existing = await this.getContactByJid(userId, contactData.jid!);
    
    if (existing) {
      const { data, error } = await this.client
        .from('wa_contacts')
        .update({ ...contactData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new DatabaseError('Failed to update contact', error);
      }
      return data as WaContact;
    } else {
      const { data, error } = await this.client
        .from('wa_contacts')
        .insert({ ...contactData, user_id: userId })
        .select()
        .single();

      if (error) {
        throw new DatabaseError('Failed to create contact', error);
      }
      return data as WaContact;
    }
  }

  async searchContacts(userId: string, query: string, limit = 20): Promise<WaContact[]> {
    this.logOperation('searchContacts', { userId, query, limit });

    const { data, error } = await this.client
      .from('wa_contacts')
      .select('*')
      .eq('user_id', userId)
      .or(`name.ilike.%${query}%,push_name.ilike.%${query}%,jid.ilike.%${query}%`)
      .limit(limit);

    if (error) {
      throw new DatabaseError('Failed to search contacts', error);
    }
    return (data as WaContact[]) || [];
  }

  // ==================== Sync Operations ====================

  async createSyncLog(
    userId: string,
    syncType: string
  ): Promise<string> {
    this.logOperation('createSyncLog', { userId, syncType });

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

    if (error) {
      throw new DatabaseError('Failed to create sync log', error);
    }
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
    this.logOperation('completeSyncLog', { logId, stats });

    const { error } = await this.client
      .from('wa_sync_logs')
      .update({
        status: 'completed',
        messages_synced: stats.messages_synced,
        chats_synced: stats.chats_synced,
        media_downloaded: stats.media_downloaded,
        completed_at: new Date().toISOString()
      })
      .eq('id', logId);

    if (error) {
      log.warn({ logId, error: error.message }, 'Failed to complete sync log');
    }
  }

  async failSyncLog(logId: string, errorMsg: string): Promise<void> {
    this.logOperation('failSyncLog', { logId });

    const { error } = await this.client
      .from('wa_sync_logs')
      .update({
        status: 'failed',
        errors: [errorMsg],
        completed_at: new Date().toISOString()
      })
      .eq('id', logId);

    if (error) {
      log.warn({ logId, error: error.message }, 'Failed to update failed sync log');
    }
  }

  // ==================== Batch Operations ====================

  async batchCreateMessages(userId: string, messages: Partial<WaMessage>[]): Promise<number> {
    if (messages.length === 0) return 0;

    this.logOperation('batchCreateMessages', { userId, count: messages.length });

    const messagesWithUserId = messages.map(m => ({ ...m, user_id: userId }));

    const { error } = await this.client
      .from('wa_messages')
      .upsert(messagesWithUserId, { 
        onConflict: 'user_id,message_id',
        ignoreDuplicates: true 
      });

    if (error) {
      log.warn({ error: error.message }, 'Batch message insert had errors');
    }

    return messages.length;
  }

  async batchCreateChats(userId: string, chats: Partial<WaChat>[]): Promise<number> {
    if (chats.length === 0) return 0;

    this.logOperation('batchCreateChats', { userId, count: chats.length });

    const chatsWithUserId = chats.map(c => ({ ...c, user_id: userId }));

    const { error } = await this.client
      .from('wa_chats')
      .upsert(chatsWithUserId, { 
        onConflict: 'user_id,jid',
        ignoreDuplicates: false 
      });

    if (error) {
      log.warn({ error: error.message }, 'Batch chat insert had errors');
    }

    return chats.length;
  }

  async batchCreateContacts(userId: string, contacts: Partial<WaContact>[]): Promise<number> {
    if (contacts.length === 0) return 0;

    this.logOperation('batchCreateContacts', { userId, count: contacts.length });

    const contactsWithUserId = contacts.map(c => ({ ...c, user_id: userId }));

    const { error } = await this.client
      .from('wa_contacts')
      .upsert(contactsWithUserId, { 
        onConflict: 'user_id,jid',
        ignoreDuplicates: false 
      });

    if (error) {
      log.warn({ error: error.message }, 'Batch contact insert had errors');
    }

    return contacts.length;
  }
}
