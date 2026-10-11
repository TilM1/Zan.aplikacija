import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing e-mail through an ordinary SMTP mailbox (env: SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, MAIL_FROM). When it is not configured, nothing is sent.
 */
export function mailConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 587);
  const from = MAIL_FROM || SMTP_USER;
  return { host: SMTP_HOST, port, user: SMTP_USER, pass: SMTP_PASS, from, fromName: process.env.MAIL_FROM_NAME || "CoreMark CRM" };
}

let transport: nodemailer.Transporter | null = null;

export async function sendCalendarMail(opts: { to: string; subject: string; text: string; method: "REQUEST" | "CANCEL"; ics: string }) {
  const cfg = mailConfig();
  if (!cfg) throw new Error("E-pošta ni nastavljena (SMTP).");
  transport ??= nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
  await transport.sendMail({
    from: { name: cfg.fromName, address: cfg.from },
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    icalEvent: { method: opts.method, content: opts.ics, filename: "termin.ics" },
  });
}
