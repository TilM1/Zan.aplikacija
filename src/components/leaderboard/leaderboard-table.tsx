import { Trophy } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { LeaderRow } from "@/server/queries/leaderboard";

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "–");

export function LeaderboardTable({ kind, rows, meId }: { kind: "agent" | "caller"; rows: LeaderRow[]; meId: string }) {
  const active = rows.filter((r) => r.policies > 0 || r.consultations > 0 || r.booked > 0);
  return (
    <Card>
      <CardHeader
        title={kind === "agent" ? "Zastopniki" : "Klicatelji"}
        description={kind === "agent" ? "Razvrščeno po prodani mesečni premiji, nato po številu polic" : "Razvrščeno po številu polic iz dogovorjenih terminov, nato po terminih"}
      />
      {active.length === 0 ? (
        <EmptyState icon={Trophy} title="Ta mesec še ni rezultatov" description="Prvi rezultat in že si na vrhu!" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH className="w-14">#</TH>
              <TH>{kind === "agent" ? "Zastopnik" : "Klicatelj"}</TH>
              {kind === "agent" ? (
                <>
                  <TH className="text-right">Premija / mes.</TH>
                  <TH className="text-right">Police</TH>
                  <TH className="text-right">Svetovanja</TH>
                  <TH className="text-right">Uspešnost</TH>
                </>
              ) : (
                <>
                  <TH className="text-right">Police</TH>
                  <TH className="text-right">Termini</TH>
                  <TH className="text-right">Svetovanja</TH>
                  <TH className="text-right">Uspešnost</TH>
                </>
              )}
            </tr>
          </THead>
          <tbody>
            {active.map((r) => (
              <TR key={r.userId} className={cn(r.userId === meId && "bg-gold-soft", r.rank === 1 && "font-semibold")}>
                <TD className="text-lg">{MEDAL[r.rank] ?? <span className="text-sm text-ink-3 tabular">{r.rank}.</span>}</TD>
                <TD>
                  {r.name}
                  {r.userId === meId && <span className="ml-2 rounded bg-gold px-1.5 text-[11px] font-bold text-ink">Ti</span>}
                </TD>
                {kind === "agent" ? (
                  <>
                    <TD className="text-right tabular">{formatEur(r.premiumCents)}</TD>
                    <TD className="text-right tabular">{r.policies}</TD>
                    <TD className="text-right tabular">{r.consultations}</TD>
                    <TD className="text-right tabular">{pct(r.successful, r.consultations)}</TD>
                  </>
                ) : (
                  <>
                    <TD className="text-right tabular">{r.policies}</TD>
                    <TD className="text-right tabular">{r.booked}</TD>
                    <TD className="text-right tabular">{r.consultations}</TD>
                    <TD className="text-right tabular">{pct(r.successful, r.consultations)}</TD>
                  </>
                )}
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
