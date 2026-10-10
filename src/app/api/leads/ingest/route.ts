import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapSheetRows } from "@/lib/leads/sheet-ingest";
import { notifyUsers } from "@/server/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  headers: z.array(z.string().max(300)).min(2).max(80),
  rows: z.array(z.array(z.string().max(2000)).max(80)).max(1000),
});

/**
 * Receives rows from a live source (Google Apps Script in the owner's sheet).
 * Auth: per-list bearer token (only its SHA-256 hash is stored). Idempotent:
 * every sheet row is processed once, so the script can safely resend rows.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token.length < 32) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: list } = await admin.from("lead_lists").select("id, name, kind, status").eq("ingest_token_hash", hash).maybeSingle();
  if (!list || list.kind !== "live") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (list.status === "archived") return NextResponse.json({ ok: true, archived: true, inserted: 0 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const rows = mapSheetRows(parsed.data.headers, parsed.data.rows);
  const { data, error } = await admin.rpc("crm_ingest_live_leads", { p_list_id: list.id, p_rows: rows });
  if (error) {
    console.error("[ingest] failed", error);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
  const res = data as { inserted: number; reinquiries: number; skipped: number; invalid: number; new: { id: string; name: string; reinquiry: boolean }[] };

  // Notify only the callers the owner ticked for this list
  if (res.new.length > 0) {
    const { data: members } = await admin.from("lead_list_members").select("caller_id").eq("list_id", list.id).eq("notify", true);
    const ids = (members ?? []).map((m) => m.caller_id as string);
    if (ids.length) {
      const first = res.new[0];
      await notifyUsers(ids, {
        title: res.new.length === 1 ? (first.reinquiry ? "Ponovno povpraševanje" : "Novo povpraševanje") : `${res.new.length} novih povpraševanj`,
        body: res.new.length === 1 ? `${first.name} · ${list.name}` : `${res.new.slice(0, 3).map((n) => n.name).join(", ")}${res.new.length > 3 ? " …" : ""} · ${list.name}`,
        url: `/leads?list=${list.id}`,
        tag: `live-${list.id}`,
      });
    }
  }
  return NextResponse.json({ ok: true, inserted: res.inserted, reinquiries: res.reinquiries, skipped: res.skipped, invalid: res.invalid });
}
