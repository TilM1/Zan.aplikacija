import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { COMMISSION_RULES } from "@/lib/commission/rules";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { ProductsEditor } from "@/components/settings/products-editor";
import { getAllProducts } from "@/server/queries/policies";

export const metadata: Metadata = { title: "Nastavitve" };

export default async function SettingsPage() {
  await requireSession(["owner"]);
  const products = await getAllProducts();
  const r = COMMISSION_RULES;
  return (
    <>
      <PageHeader title="Nastavitve" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Produkti" description="Neaktivni produkti se ne ponujajo pri novih policah; obstoječe police ostanejo nespremenjene." />
          <ProductsEditor products={products} />
        </Card>
        <Card>
          <CardHeader title="Pravila provizij" description={`Različica ${r.version} · spremembe zahtevajo posodobitev src/lib/commission/rules.ts`} />
          <CardBody>
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                { label: "Provizija zastopnika", value: "mesečna premija × 12 × trajanje (leta) × odstotek zastopnika ob prodaji" },
                { label: "Obroki zastopnika", value: r.agentInstallments.map((i) => `${i.number}. obrok ${i.sharePercent} % (+${i.monthsAfterFirstPayout} mes. od 1. izplačila)`).join(" · ") },
                { label: "Provizija klicatelja", value: `mesečna premija × ${r.callerMultiplier.display}, enkratno, skupaj s 1. obrokom zastopnika` },
                { label: "Presečni dan / dan izplačila", value: `Police do vključno ${r.cutoffDay}. v mesecu → izplačilo ${r.payoutDay}. naslednjega meseca; kasnejše → ${r.payoutDay}. čez dva meseca` },
                { label: "Posnetki (snapshot)", value: "Odstotek, premija, trajanje in pravila se ob sklenitvi shranijo k proviziji. Kasnejše spremembe ne vplivajo na obstoječe provizije." },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
