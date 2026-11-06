// Conversation memory in Supabase (table coach_messages). The unique
// update_id doubles as duplicate protection: Telegram retries a webhook that
// times out, and a retried "had 2 eggs" must not be logged twice.

const HISTORY_LIMIT = 16;
const HISTORY_HOURS = 48;

export function createConversation({ db, now = () => new Date() }) {
  return {
    // Returns false if this Telegram update was already handled.
    async claim({ chatId, updateId, text, hasPhoto }) {
      try {
        await db.insert('coach_messages', [{ chat_id: chatId, update_id: updateId, role: 'user', content: text ?? '', has_photo: !!hasPhoto }]);
        return true;
      } catch (e) {
        if (/\(409\)|duplicate key|23505/.test(e.message)) return false;
        throw e;
      }
    },

    async saveReply({ chatId, text }) {
      await db.insert('coach_messages', [{ chat_id: chatId, role: 'assistant', content: text }]);
    },

    // Recent turns, oldest first, excluding the message being answered now.
    async recent({ chatId, excludeUpdateId }) {
      const since = new Date(now().getTime() - HISTORY_HOURS * 3_600_000).toISOString();
      const rows = (await db.select('coach_messages',
        `select=role,content,has_photo,update_id&chat_id=eq.${chatId}&created_at=gte.${since}&order=created_at.desc&limit=${HISTORY_LIMIT + 1}`)) ?? [];
      return rows
        .filter((r) => r.update_id == null || r.update_id !== excludeUpdateId)
        .slice(0, HISTORY_LIMIT)
        .reverse()
        .map((r) => ({ role: r.role, content: r.has_photo ? `[sent a photo] ${r.content}`.trim() : r.content }));
    },
  };
}
