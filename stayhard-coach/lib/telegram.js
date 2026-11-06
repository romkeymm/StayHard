// Minimal Telegram Bot API client. The token is part of every request URL,
// so errors report only the method and Telegram's description, never the URL.

export function createTelegram({ token, fetch: fetchImpl } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function call(method, body) {
    const res = await doFetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', ...body });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok || !data?.ok) {
      throw new Error(`Telegram ${method} failed (${res.status}): ${data?.description ?? 'no description'}`);
    }
    return data.result;
  }

  const json = (payload) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  return {
    sendMessage: (chatId, text, opts = {}) => call('sendMessage', json({ chat_id: chatId, text, ...opts })),

    // photo: Uint8Array/ArrayBuffer of PNG bytes
    sendPhoto(chatId, photo, { caption, filename = 'nutrition.png' } = {}) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      if (caption) form.append('caption', caption);
      form.append('photo', new Blob([photo], { type: 'image/png' }), filename);
      return call('sendPhoto', { body: form });
    },
  };
}
