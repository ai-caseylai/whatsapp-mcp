import { z } from 'zod';

// ==================== Tool Input Schemas ====================

export const SearchContactsSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(100).optional().default(20)
});

export const ListChatsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  include_last_message: z.boolean().optional().default(false)
});

export const GetChatSchema = z.object({
  chat_jid: z.string().min(1, 'Chat JID is required')
});

export const ListMessagesSchema = z.object({
  chat_jid: z.string().min(1, 'Chat JID is required'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  before_message_id: z.string().optional()
});

export const SearchMessagesSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  chat_jid: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20)
});

export const SendMessageSchema = z.object({
  to: z.string().min(1, 'Recipient is required'),
  message: z.string().min(1, 'Message cannot be empty').max(4096, 'Message too long'),
  quoted_message_id: z.string().optional()
});

export const GetContactSchema = z.object({
  jid: z.string().min(1, 'Contact JID is required')
});

export const SyncHistorySchema = z.object({
  full_sync: z.boolean().optional().default(false),
  days_back: z.number().int().min(1).max(365).optional().default(30)
});

// ==================== Type exports ====================

export type SearchContactsInput = z.infer<typeof SearchContactsSchema>;
export type ListChatsInput = z.infer<typeof ListChatsSchema>;
export type GetChatInput = z.infer<typeof GetChatSchema>;
export type ListMessagesInput = z.infer<typeof ListMessagesSchema>;
export type SearchMessagesInput = z.infer<typeof SearchMessagesSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type GetContactInput = z.infer<typeof GetContactSchema>;
export type SyncHistoryInput = z.infer<typeof SyncHistorySchema>;

// ==================== Validation helper ====================

export function validateSchema<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMessage = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return { success: false, error: errorMessage };
}
