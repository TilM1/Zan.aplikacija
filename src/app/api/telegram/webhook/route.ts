import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { telegramConfigured, type TelegramUpdate } from "@/server/telegram/api";
import { handleUpdate } from "@/server/telegram/bot";

export const runtime = "nodejs";
export const maxDuration = 30;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Telegram bot webhook (see docs/TELEGRAM.md). Off unless TELEGRAM_BOT_TOKEN and
 * TELEGRAM_WEBHOOK_SECRET are set. Telegram proves itself with the secret token
 * header set in setWebhook; the user is then checked against TELEGRAM_ALLOWED_USERS.
 * Always answers 200 after a valid request, so Telegram does not resend updates.
 */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(secret, process.env.TELEGRAM_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (!update || typeof update.update_id !== "number") return NextResponse.json({ ok: true });
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("[telegram] update failed", e);
  }
  return NextResponse.json({ ok: true });
}
