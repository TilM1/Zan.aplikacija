import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { COMMISSION_RULES } from "@/lib/commission/rules";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { ProductsEditor } from "@/components/settings/products-editor";
import { getAllProducts } from "@/server/queries/policies";
import { getRecallMonths } from "@/server/queries/leads";
import { RecallForm } from "@/components/settings/recall-form";
import { ExpiryDaysForm } from "@/components/settings/expiry-days-form";
import { getExpiryReminderDays } from "@/server/queries/expiries";

export const metadata: Metadata = { title: "Nastavitve" };

export default async function SettingsPage() {
  await requireSession(["owner"]);
  const [products, recallMonths, expiryDays] = await Promise.all([getAllProducts(), getRecallMonths(), getExpiryReminderDays()]);
  const r = COMMISSION_RULES;
  return (
    <>
      <PageHeader title="Nastavitve" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Produkti" description="Produkti, ki jih zastopnik izbira pri vnosu police. S puščicama določite vrstni red. Pri vsakem izberete, kako se računa provizija zastopnika, in koliko agenciji plača zavarovalnica (»Agencija«: % ali × število). Spremembe veljajo samo za nove police." />
          <ProductsEditor products={products} />
        </Card>
        <Card>
          <CardHeader title="Pravila provizij" description="Kako se obračunajo provizije (samo pregled)" />
          <CardBody>
            <KeyValue
              className="sm:grid-cols-1"
              wrap
              items={[
                { label: "Provizija zastopnika", value: "mesečna premija × 12 × trajanje (leta) × odstotek zastopnika ob prodaji" },
                { label: "Obroki zastopnika", value: r.agentInstallments.map((i) => `${i.number}. obrok ${i.sharePercent} % (+${i.monthsAfterFirstPayout} mes. od 1. izplačila)`).join(" · ") },
                { label: "Provizija klicatelja", value: `mesečna premija × faktor klicatelja ob prodaji (privzeto ${r.defaultCallerMultiplier.replace(".", ",")}; nastavi se pri zaposlenem), enkratno, skupaj s 1. obrokom zastopnika` },
                { label: "Sprememba provizije", value: "Odstotek zastopnika in faktor klicatelja spremenite v Zaposleni → oseba → Provizija. Nova vrednost velja za police, shranjene od spremembe naprej." },
                { label: "Presečni dan / dan izplačila", value: `Police do vključno ${r.cutoffDay}. v mesecu → izplačilo ${r.payoutDay}. naslednjega meseca; kasnejše → ${r.payoutDay}. čez dva meseca` },
                { label: "Posnetki (snapshot)", value: "Odstotek/faktor, premija, trajanje in pravila se ob sklenitvi shranijo k proviziji. Kasnejše spremembe ne vplivajo na obstoječe provizije." },
              ]}
            />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Klicni seznami – ponovni klic po zavrnitvi" description="Ko klicateljica označi kontakt kot »Zavrnjen«, se ta čez izbrano obdobje ponovno pojavi v seznamu »Za klic«." />
          <CardBody>
            <RecallForm current={recallMonths} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Skadence – opomnik pred potekom" description="Koliko dni pred potekom drugega zavarovanja stranke se skadenca pojavi zastopniku v seznamu »Za klic«." />
          <CardBody>
            <ExpiryDaysForm current={expiryDays} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
