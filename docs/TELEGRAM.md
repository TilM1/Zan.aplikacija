# Telegram bot: vpis v CRM

Lastnik (Žan) lahko prek Telegrama vpiše kontakt ali prodano polico, ne da bi odprl CRM.

| Ukaz | Kaj naredi | Kam se zapiše |
|---|---|---|
| `/novastranka` | Kontakt (ime, priimek, telefon, …, opomba) | Klicni seznami → **Zasebna baza** (vidi jo samo lastnik). Od tam kot običajno »Pretvori v termin«. |
| `/novapolica` | Nova stranka, ki je že podpisala, in njena polica | Enako kot »Dodaj podpisano stranko« v CRM: stranka, posvet A1, polica in provizije. Zastopnik je lastnik. |
| `/dodajpolico` | Nova polica za **obstoječo** stranko (najde jo po telefonu) | Nov obisk z rezultatom A1 pri tej stranki, polica in provizije. Zastopnik je lastnik. |
| `/produkti` | Seznam aktivnih produktov | – |

## Kako deluje

1. Ukaz → bot pošlje predlogo. Tap na predlogo jo skopira.
2. Izpolnjeno predlogo pošlješ nazaj. Bot jo preveri z istimi pravili kot obrazci v CRM (telefon, poštna številka, znesek, datum …), poišče produkt (dovolj je del imena) in opozori na dvojnike.
3. Bot pokaže povzetek z gumboma **✅ Shrani / ❌ Prekliči**. Nič se ne zapiše, dokler ne pritisneš ✅. Gumb velja 24 ur.
4. Po shranjevanju bot vrne povezavo do zapisa v CRM.

Primer:

```
#novapolica
Ime: Ana
Priimek: Kovač
Telefon: 031 222 333
E-pošta:
Naslov:
Pošta:
Kraj: Kranj
Produkt: bonus
Mesečna premija: 45,50
Trajanje (let): 20
Datum police: 5.10.2026
Številka police: 123456
Opomba: priporočilo od Petra
```

Prazen datum police pomeni danes. Opomba je lahko v več vrsticah (mora biti zadnja).

### Pravila, ki veljajo kot v CRM

- Provizije računa isti mehanizem kot v aplikaciji (trenutni odstotek lastnika, pravila produkta). Pri `/dodajpolico` dobi provizijo klicatelja isti klicatelj, kot bi jo pri vnosu v CRM (odprt »klic nazaj« → njegov klicatelj, sicer odgovorni klicatelj stranke). Bot to izpiše v povzetku.
- `/dodajpolico` zavrne stranko, ki ima odprt termin. Takrat vpiši rezultat A1 pri tem terminu v CRM.
- `/novapolica` opozori, če stranka s tem telefonom ali e-pošto že obstaja (gumb »Vseeno ustvari novo«).
- `/novastranka` zavrne številko, ki je že v kateremkoli klicnem seznamu ali na seznamu »Ne kliči«.
- Če ista oseba pozneje odda povpraševanje prek live seznama (Google Sheets), se kot vsak dvojnik **premakne** v live seznam (obstoječe pravilo za ponovna povpraševanja).

## Varnost

- Pot `/api/telegram/webhook` sprejme samo zahteve s skrivnim žetonom (`TELEGRAM_WEBHOOK_SECRET`, Telegram ga pošlje v glavi `X-Telegram-Bot-Api-Secret-Token`).
- Bot uporabljajo samo Telegram uporabniki iz `TELEGRAM_ALLOWED_USERS`, povezani (prek e-pošte ali ID profila) z **aktivnim lastnikom** v CRM. Vse zapise še enkrat preverijo funkcije `crm_*` v bazi (`crm_require_owner`).
- Vsako poslano predlogo zapiše tabela `telegram_submissions` (ena vrstica na sporočilo, stanje `pending → processing → done/failed/cancelled`). Dvojni pritisk na ✅ ali ponovno poslano sporočilo se zato shrani samo enkrat. Brskalnik do te tabele nima dostopa.
- Brez `TELEGRAM_BOT_TOKEN` in `TELEGRAM_WEBHOOK_SECRET` vrne pot 404 in bot je izklopljen.
- Bot naj bo v **zasebnem** klepetu. Skupine bot ignorira.

## Namestitev (enkrat, brez terminala)

1. **Bot:** v Telegramu @BotFather → `/newbot` → ime in uporabniško ime (konča se na `bot`). Shrani žeton. Nato `/setjoingroups` → Disable.
2. **Baza (pred mergom):** Supabase (projekt CRM-ja) → SQL Editor → New query → prilepi celotno skripto za namestitev (vsebina `supabase/migrations/20261113120000_telegram_bot.sql`, ovita v transakcijo, ki migracijo tudi zabeleži v `supabase_migrations.schema_migrations`) → Run.
   Alternativa s terminalom: `npm run db:migrate -- --dry` (izpiše samo to datoteko), nato `npm run db:migrate`.
3. **Vercel → Settings → Environment Variables (Production):**
   - `TELEGRAM_BOT_TOKEN` = žeton iz BotFather
   - `TELEGRAM_WEBHOOK_SECRET` = poljuben naključen niz, 32–256 znakov, samo črke, številke, `_` in `-`
   - `TELEGRAM_ALLOWED_USERS` = `<Telegram ID>:<e-pošta, s katero se Žan prijavlja v CRM>`, npr. `123456789:zan@zzpartnerji.si` (namesto e-pošte gre tudi ID profila)
   - po želji `APP_PUBLIC_HOST` = produkcijska domena (za povezave v odgovorih)
4. **Merge PR** (ali Redeploy, če je koda že na `main`).
5. **Webhook:** v brskalniku odpri (zamenjaj TOKEN, DOMENA, SECRET):
   `https://api.telegram.org/botTOKEN/setWebhook?url=https://DOMENA/api/telegram/webhook&secret_token=SECRET&allowed_updates=["message","callback_query"]&drop_pending_updates=true`
   Odgovor mora biti `{"ok":true,...,"description":"Webhook was set"}`. Domena mora biti produkcijska (ne `*.vercel.app` predogled).
   Alternativa s terminalom: `npm run telegram:setup -- https://DOMENA`.
6. Žan botu pošlje `/start`. Bot nastavi meni ukazov in izpiše navodila.

Izklop: v brskalniku `https://api.telegram.org/botTOKEN/deleteWebhook` ali odstrani env spremenljivke v Vercelu.
Stanje webhooka: `https://api.telegram.org/botTOKEN/getWebhookInfo` (polje `last_error_message`).

## Preizkus po namestitvi

1. `/novastranka` s testnim kontaktom (izmišljena številka) → ✅ → v CRM: Klicni seznami → »Zasebna baza« (ZASEBNO).
2. V prijavi klicatelja preveri, da »Zasebna baza« ni vidna.
3. `/novapolica` → najprej ❌ Prekliči (nič se ne zapiše), nato po želji pravi vnos.
4. Testni kontakt izbriši v CRM (Klicni seznami).

## Koda

| Datoteka | Vsebina |
|---|---|
| `src/app/api/telegram/webhook/route.ts` | Webhook: preveri skrivni žeton, pokliče bot |
| `src/server/telegram/bot.ts` | Ukazi, preverjanje, potrditev, shranjevanje prek `crm_*` |
| `src/server/telegram/api.ts` | Klici Telegram Bot API |
| `src/lib/telegram/templates.ts` | Predloge, razčlenjevanje in preverjanje (testi v `templates.test.ts`) |
| `supabase/migrations/20261113120000_telegram_bot.sql` | `crm_add_private_lead`, `crm_add_policy_to_customer`, `telegram_submissions`, vrsta seznama `private` (testi v `tests/db/telegram.test.ts`) |
| `scripts/telegram/setup.ts` | Nastavi webhook in meni ukazov |
