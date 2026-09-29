import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { ChangePasswordForm, OwnProfileForm } from "@/components/settings/profile-forms";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const { data } =
    profile.role === "caller"
      ? await supabase.from("caller_commission_rates").select("value:multiplier").eq("caller_id", profile.id).order("effective_from", { ascending: false }).limit(1).maybeSingle()
      : await supabase.from("agent_commission_rates").select("value:rate_percent").eq("agent_id", profile.id).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  const rate = !data ? "ni nastavljeno" : profile.role === "caller" ? `× ${Number(data.value).toLocaleString("sl-SI")} mesečne premije` : `${Number(data.value).toLocaleString("sl-SI")} %`;
  return (
    <>
      <PageHeader title="Profil" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Moji podatki" />
          <CardBody className="flex flex-col gap-5">
            <KeyValue
              items={[
                { label: "E-pošta (prijava)", value: profile.email },
                { label: "Vloga", value: ROLE_LABELS[profile.role] },
                { label: "Trenutna provizija", value: rate },
                { label: "Račun ustvarjen", value: formatDate(profile.created_at) },
              ]}
            />
            <OwnProfileForm initial={{ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone ?? "" }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Geslo" />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
