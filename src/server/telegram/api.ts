import "server-only";

/** Minimal Telegram Bot API client (only what the CRM bot needs). */

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number };
    message?: TelegramMessage;
    data?: string;
  };
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_WEBHOOK_SECRET;
}

async function call(method: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[telegram] ${method} failed`, res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error(`[telegram] ${method} failed`, e);
  }
}

/** Escape user-provided text for parse_mode HTML. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sendMessage(
  chatId: number,
  html: string,
  opts: { replyTo?: number; buttons?: InlineButton[][]; keyboard?: string[][] } = {},
) {
  return call("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
    ...(opts.keyboard
      ? { reply_markup: { keyboard: opts.keyboard.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true } }
      : {}),
  });
}

/** Replace the text of a bot message and remove its buttons. */
export function editMessage(chatId: number, messageId: number, html: string) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [] },
  });
}

export function answerCallback(callbackId: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/** Command menu and the texts shown before/after "Start" (set on /start, so no manual setup is needed). */
export async function setupBotProfile() {
  await Promise.all([
    call("setMyCommands", {
      commands: [
        { command: "novastranka", description: "Kontakt v Zasebno bazo" },
        { command: "novapolica", description: "Nova stranka s podpisano polico" },
        { command: "dodajpolico", description: "Polica za obstoječo stranko" },
        { command: "produkti", description: "Seznam produktov" },
        { command: "pomoc", description: "Navodila" },
      ],
    }),
    call("setMyDescription", {
      description:
        "Vpis strank in polic v ZZ CRM kar iz Telegrama.\n\nPritisni Start: dobiš navodila in gumbe. Izbereš, kaj vpisuješ, izpolniš predlogo in potrdiš z ✅. Brez potrditve se nič ne zapiše.",
    }),
    call("setMyShortDescription", { short_description: "Vpis strank in polic v ZZ CRM" }),
  ]);
}
