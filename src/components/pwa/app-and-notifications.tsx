"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removePushSubscription, savePushSubscription, sendTestNotification } from "@/server/actions/push";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Env = { standalone: boolean; ios: boolean; android: boolean; supported: boolean; permission: NotificationPermission | "unsupported" };

function readEnv(): Env {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return {
    standalone,
    ios: /iPhone|iPad|iPod/.test(ua),
    android: /Android/.test(ua),
    supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
}

/** Install to home screen + enable push notifications on this device. */
export function AppAndNotifications() {
  const [env, setEnv] = useState<Env | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const init = async () => {
      const current = readEnv();
      let sub = false;
      if (current.supported) {
        const reg = await navigator.serviceWorker.ready;
        sub = !!(await reg.pushManager.getSubscription());
      }
      setEnv(current);
      setSubscribed(sub);
    };
    void init();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function enable() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return toast.error("Obvestila na strežniku še niso nastavljena.");
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Obvestila niso dovoljena. Dovolite jih v nastavitvah brskalnika / telefona.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      const res = await savePushSubscription(sub.toJSON());
      if (!res.ok) throw new Error(res.error);
      setSubscribed(true);
      setEnv(readEnv());
      toast.success("Obvestila so vklopljena.");
    } catch (e) {
      toast.error((e as Error).message || "Obvestil ni bilo mogoče vklopiti.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Obvestila so izklopljena na tej napravi.");
    } finally {
      setBusy(false);
    }
  }

  if (!env) return <div className="h-24 animate-pulse rounded-lg bg-subtle" />;
  const iosNeedsInstall = env.ios && !env.standalone;

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Smartphone className="size-4 text-brand" /> Aplikacija na začetnem zaslonu
        </p>
        {env.standalone ? (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-success">✓ CoreMark je nameščen kot aplikacija na tej napravi.</p>
        ) : installEvt ? (
          <Button
            variant="gold"
            className="self-start"
            onClick={async () => {
              await installEvt.prompt();
              setInstallEvt(null);
            }}
          >
            <Download className="size-4" /> Namesti aplikacijo
          </Button>
        ) : env.ios ? (
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>
              Odprite to stran v brskalniku <b>Safari</b>.
            </li>
            <li>
              Tapnite gumb <b>Deli</b> (kvadrat s puščico navzgor).
            </li>
            <li>
              Izberite <b>»Dodaj na začetni zaslon«</b> in potrdite z »Dodaj«.
            </li>
            <li>Odprite CoreMark z ikone na začetnem zaslonu in se prijavite.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>
              V brskalniku <b>Chrome</b> tapnite meni <b>⋮</b> (zgoraj desno).
            </li>
            <li>
              Izberite <b>»Namesti aplikacijo«</b> ali <b>»Dodaj na začetni zaslon«</b>.
            </li>
            <li>Na računalniku: ikona za namestitev v naslovni vrstici brskalnika.</li>
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="flex items-center gap-2 font-semibold">
          <Bell className="size-4 text-brand" /> Obvestila na tej napravi
        </p>
        <p className="text-ink-3">Nov termin, stranka za ponovni klic, jutranji povzetek (skadence, klici, termini brez rezultata).</p>
        {iosNeedsInstall ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">Na iPhonu obvestila delujejo samo, ko je CoreMark dodan na začetni zaslon (zgoraj). Nato ga odprite z ikone in tu vklopite obvestila.</p>
        ) : !env.supported ? (
          <p className="rounded-lg bg-subtle px-3 py-2 text-ink-2">Ta brskalnik ne podpira obvestil.</p>
        ) : env.permission === "denied" ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">Obvestila so v nastavitvah brskalnika/telefona blokirana za to stran. Dovolite jih tam in osvežite stran.</p>
        ) : subscribed ? (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-success-soft px-3 py-2 text-success">✓ Vklopljeno</span>
            <Button variant="secondary" size="sm" onClick={async () => {
              const r = await sendTestNotification();
              if (r.ok) toast.success(r.message ?? "Poslano.");
              else toast.error(r.error);
            }}>
              Pošlji testno obvestilo
            </Button>
            <Button variant="ghost" size="sm" loading={busy} onClick={disable}>
              <BellOff className="size-4" /> Izklopi
            </Button>
          </div>
        ) : (
          <Button variant="gold" className="self-start" loading={busy} onClick={enable}>
            <Bell className="size-4" /> Vklopi obvestila
          </Button>
        )}
      </section>
    </div>
  );
}
