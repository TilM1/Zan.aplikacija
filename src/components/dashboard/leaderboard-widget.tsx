import Link from "next/link";
import { Trophy } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatEur } from "@/lib/money";
import { monthStart, todayIso } from "@/lib/dates";
import { getLeaderboard, type LeaderRow } from "@/server/queries/leaderboard";

const MEDAL = ["🥇", "🥈", "🥉"];

function Top({ title, prize, rows, value }: { title: string; prize: string | null; rows: LeaderRow[]; value: (r: LeaderRow) => string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-ink-2 uppercase">{title}</p>
      {prize && <p className="mt-0.5 text-xs text-brand">🎁 {prize}</p>}
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-3">Še ni rezultatov.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1 text-sm">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center gap-2">
              <span>{MEDAL[i]}</span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="text-ink-2 tabular">{value(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function LeaderboardWidget() {
  const { agents, callers, prizes } = await getLeaderboard(monthStart(todayIso()));
  const topAgents = agents.filter((a) => a.premiumCents > 0 || a.policies > 0).slice(0, 3);
  const topCallers = callers.filter((c) => c.policies > 0 || c.booked > 0).slice(0, 3);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Trophy className="size-4 text-gold" /> Lestvica meseca
          </span>
        }
        actions={
          <Link href="/leaderboard" className="text-xs font-medium text-brand hover:underline">
            Vse
          </Link>
        }
      />
      <div className="divide-y divide-line">
        <Top title="Zastopniki" prize={prizes.agent} rows={topAgents} value={(r) => formatEur(r.premiumCents)} />
        <Top title="Klicatelji" prize={prizes.caller} rows={topCallers} value={(r) => `${r.policies} pol.`} />
      </div>
    </Card>
  );
}
