// WhatsApp MCP Server Type Definitions

// ==================== Database Types ====================

export interface WaUser {
  id: string;
  auth_user_id: string;
  phone_number: string;
  display_name?: string;
  profile_pic_url?: string;
  status?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at?: string;
  auth_credentials?: Record<string, unknown>;
  sync_settings: {
    auto_sync: boolean;
    sync_interval_minutes: number;
    download_media: boolean;
    max_media_size_mb: number;
  };
}

export interface WaChat {
  id: string;
  user_id: string;
  jid: string;
  name?: string;
  chat_type: 'individual' | 'group' | 'broadcast' | 'status';
  is_pinned: boolean;
  mute_until?: string;
  unread_count: number;
  last_message_id?: string;
  last_message_at?: string;
  profile_pic_url?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WaMessage {
  id: string;
  user_id: string;
  chat_id: string;
  message_id: string;
  sender_jid: string;
  sender_name?: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'vcard' | 'unknown';
  content?: string;
  media_url?: string;
  media_mime_type?: string;
  media_file_name?: string;
  media_file_size?: number;
  media_duration?: number;
  quoted_message_id?: string;
  quoted_message_content?: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  is_from_me: boolean;
  is_deleted: boolean;
  is_edited: boolean;
  edited_at?: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WaContact {
  id: string;
  user_id: string;
  jid: string;
  name?: string;
  push_name?: string;
  short_name?: string;
  phone_number?: string;
  profile_pic_url?: string;
  status?: string;
  is_blocked: boolean;
  is_business: boolean;
  labels?: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ==================== Baileys Types ====================

export interface WhatsAppConnectionState {
  connection: 'connecting' | 'open' | 'close' | 'loggedOut';
  qr?: string;
  lastDisconnect?: {
    error?: Error;
    date: Date;
  };
}

export interface WhatsAppCredentials {
  creds: Record<string, unknown>;
  keys: Record<string, unknown>;
}

// ==================== MCP Tool Types ====================

export interface SearchContactsArgs {
  query: string;
  limit?: number;
}

export interface ListChatsArgs {
  limit?: number;
  offset?: number;
  include_last_message?: boolean;
}

export interface ListMessagesArgs {
  chat_jid: string;
  limit?: number;
  before_message_id?: string;
}

export interface SendMessageArgs {
  to: string;  // JID or phone number
  message: string;
  quoted_message_id?: string;
}

export interface SendMediaArgs {
  to: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  file_path: string;
  caption?: string;
}

export interface GetChatArgs {
  chat_jid: string;
}

export interface SearchMessagesArgs {
  query: string;
  chat_jid?: string;
  limit?: number;
}

export interface SyncHistoryArgs {
  full_sync?: boolean;
  days_back?: number;
}

// ==================== API Response Types ====================

export interface ToolResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface ChatWithLastMessage extends WaChat {
  last_message?: WaMessage;
}

export interface MessageWithMedia extends WaMessage {
  media?: {
    url: string;
    type: string;
    mime_type: string;
    file_name?: string;
  };
}
