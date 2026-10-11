import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { ChangePasswordForm, InviteSettingsForm, OwnProfileForm } from "@/components/settings/profile-forms";
import { mailConfig } from "@/server/mail";
import { AppAndNotifications } from "@/components/pwa/app-and-notifications";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const { data } =
    profile.role === "caller"
      ? await supabase.from("caller_commission_rates").select("value:multiplier").eq("caller_id", profile.id).eq("tariff", "standard").order("effective_from", { ascending: false }).limit(1).maybeSingle()
      : await supabase.from("agent_commission_rates").select("value:rate_percent").eq("agent_id", profile.id).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  const { data: live } =
    profile.role === "caller"
      ? await supabase.from("caller_commission_rates").select("value:multiplier").eq("caller_id", profile.id).eq("tariff", "live").order("effective_from", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
  const liveRate = `× ${Number((live ?? data)?.value ?? 0).toLocaleString("sl-SI")} mesečne premije`;
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
                { label: profile.role === "caller" ? "Provizija – navadni seznami" : "Trenutna provizija", value: rate },
                ...(profile.role === "caller" && data ? [{ label: "Provizija – live seznami (oglasi)", value: liveRate }] : []),
                { label: "Račun ustvarjen", value: formatDate(profile.created_at) },
              ]}
            />
            <OwnProfileForm initial={{ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone ?? "" }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Aplikacija in obvestila" description="Namestite CoreMark na telefon in vklopite obvestila." />
          <CardBody>
            <AppAndNotifications />
          </CardBody>
        </Card>
        {profile.role !== "caller" && (
          <Card>
            <CardHeader title="Vabila na termin po e-pošti" description="Termini v vašem koledarju (Outlook, Google, Apple) – brez povezovanja računa." />
            <CardBody>
              <InviteSettingsForm initial={{ enabled: profile.invite_enabled, email: profile.invite_email ?? "" }} loginEmail={profile.email} configured={!!mailConfig()} />
            </CardBody>
          </Card>
        )}
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
