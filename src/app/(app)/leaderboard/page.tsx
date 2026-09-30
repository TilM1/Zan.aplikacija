import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Gift, Trophy } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { addMonthsToMonthStart, formatMonth, isValidIsoDate, monthStart, todayIso } from "@/lib/dates";
import { param } from "@/lib/url";
import { PageHeader } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { PrizesEditor } from "@/components/leaderboard/prizes-editor";
import { getLeaderboard } from "@/server/queries/leaderboard";

export const metadata: Metadata = { title: "Lestvica" };

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const current = monthStart(todayIso());
  const requested = param(sp, "month");
  const month = requested && isValidIsoDate(requested) ? monthStart(requested) : current;
  const { agents, callers, prizes } = await getLeaderboard(month);
  const label = formatMonth(month);
  const isCurrent = month === current;
  const leaderAgent = agents.find((a) => a.rank === 1 && (a.premiumCents > 0 || a.policies > 0));
  const leaderCaller = callers.find((c) => c.rank === 1 && (c.policies > 0 || c.booked > 0));

  return (
    <>
      <PageHeader
        title="Lestvica meseca"
        description={<span className="capitalize">{label}{isCurrent ? " · tekmovanje poteka" : " · zaključeno"}</span>}
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/leaderboard?month=${addMonthsToMonthStart(month, -1)}`} className={buttonClasses("secondary", "md", "px-2")} aria-label="Prejšnji mesec">
              <ChevronLeft className="size-4" />
            </Link>
            {!isCurrent && (
              <Link href="/leaderboard" className={buttonClasses("secondary")}>
                Ta mesec
              </Link>
            )}
            {!isCurrent && (
              <Link href={`/leaderboard?month=${addMonthsToMonthStart(month, 1)}`} className={buttonClasses("secondary", "md", "px-2")} aria-label="Naslednji mesec">
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {([
          ["Nagrada za najboljšega zastopnika meseca", prizes.agent, leaderAgent?.name],
          ["Nagrada za najboljšega klicatelja meseca", prizes.caller, leaderCaller?.name],
        ] as const).map(([title, prize, leader]) => (
          <div key={title} className="flex items-start gap-4 rounded-xl border border-gold bg-gradient-to-br from-gold-soft to-surface p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink text-gold">
              <Gift className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="font-brand text-xs font-semibold tracking-wide text-brand uppercase">{title}</p>
              <p className="mt-1 text-lg font-semibold">{prize ?? <span className="text-ink-3">Nagrada še ni določena</span>}</p>
              {leader && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
                  <Trophy className="size-4 text-gold" /> {isCurrent ? "Trenutno vodi" : "Zmagovalec"}: <b>{leader}</b>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {profile.role === "owner" && (
        <div className="-mt-2 mb-5">
          <PrizesEditor month={month} monthLabel={label} agent={prizes.agent} caller={prizes.caller} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <LeaderboardTable kind="agent" rows={agents} meId={profile.id} />
        <LeaderboardTable kind="caller" rows={callers} meId={profile.id} />
      </div>
      <p className="mt-3 text-xs text-ink-3">Upoštevane so aktivne (nestornirane) police z datumom police v izbranem mesecu ter svetovanja, zaključena v tem mesecu. Zneski provizij niso prikazani.</p>
    </>
  );
}
