/**
 * Connect the Telegram bot to the deployed CRM (run once, and again after
 * changing the domain or TELEGRAM_WEBHOOK_SECRET):
 *
 *   npm run telegram:setup -- https://crm.example.si
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env.local (the same
 * values must be set in Vercel → Production). Registers the webhook and the
 * command menu. Use `npm run telegram:setup -- --off` to disconnect the bot.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const COMMANDS = [
  { command: "novastranka", description: "Kontakt v Zasebno bazo" },
  { command: "novapolica", description: "Nova stranka s podpisano polico" },
  { command: "dodajpolico", description: "Polica za obstoječo stranko" },
  { command: "produkti", description: "Seznam produktov" },
  { command: "pomoc", description: "Navodila" },
];

async function api(method: string, body: Record<string, unknown> = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in .env.local");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--off") {
    await api("deleteWebhook", { drop_pending_updates: true });
    console.log("Webhook removed. The bot no longer reaches the CRM.");
    return;
  }
  if (!arg || !/^https:\/\//.test(arg)) throw new Error("Usage: npm run telegram:setup -- https://<production domain>");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new Error("Set TELEGRAM_WEBHOOK_SECRET in .env.local (32+ chars: letters, digits, _ or -). Generate: openssl rand -hex 32");
  }
  const url = `${arg.replace(/\/$/, "")}/api/telegram/webhook`;
  await api("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true, max_connections: 5 });
  await api("setMyCommands", { commands: COMMANDS });
  const me = (await api("getMe")) as { username: string };
  const info = (await api("getWebhookInfo")) as { url: string; last_error_message?: string };
  console.log(`Bot @${me.username} → ${info.url}`);
  if (info.last_error_message) console.log(`Last error from Telegram: ${info.last_error_message}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
