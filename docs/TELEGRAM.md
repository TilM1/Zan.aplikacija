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
- Bot uporabljajo samo Telegram uporabniki iz `TELEGRAM_ALLOWED_USERS`, povezani z **aktivnim lastnikom** v CRM. Vse zapise še enkrat preverijo funkcije `crm_*` v bazi (`crm_require_owner`).
- Vsako poslano predlogo zapiše tabela `telegram_submissions` (ena vrstica na sporočilo, stanje `pending → processing → done/failed/cancelled`). Dvojni pritisk na ✅ ali ponovno poslano sporočilo se zato shrani samo enkrat. Brskalnik do te tabele nima dostopa.
- Brez `TELEGRAM_BOT_TOKEN` in `TELEGRAM_WEBHOOK_SECRET` vrne pot 404 in bot je izklopljen.
- Bot naj bo v **zasebnem** klepetu. Skupine bot ignorira.

## Namestitev (enkrat)

1. **Bot:** v Telegramu odpri @BotFather → `/newbot` → ime in uporabniško ime (npr. `ZZPartnerjiCrmBot`). Shrani žeton. V BotFather nato `/setjoingroups` → Disable.
2. **Migracija baze** (pred deployem kode): v `.env.local` nastavi `SUPABASE_DB_URL` za produkcijo, nato
   `npm run db:migrate -- --dry` (pokaže samo `20261113120000_telegram_bot.sql`) in `npm run db:migrate`.
   Migracija samo dodaja: nova tabela, dve novi funkciji, vrsta seznama `private`. Klicatelji zasebnih seznamov ne vidijo.
3. **Vercel → Settings → Environment Variables (Production):**
   - `TELEGRAM_BOT_TOKEN` = žeton iz BotFather
   - `TELEGRAM_WEBHOOK_SECRET` = `openssl rand -hex 32`
   - `TELEGRAM_ALLOWED_USERS` = `<Telegram ID>:<ID lastnikovega profila>` (ID profila: Supabase → tabela `profiles`, ali URL Zaposleni → lastnik)
   - po želji `APP_PUBLIC_HOST` = produkcijska domena (za povezave v odgovorih)
   Nato **Redeploy**.
4. **Telegram ID:** Žan botu pošlje karkoli. Bot odgovori »Ni dostopa« in izpiše njegov Telegram ID. Vpiši ga v `TELEGRAM_ALLOWED_USERS` in ponovno deployaj.
5. **Webhook:** lokalno v `.env.local` vpiši isti `TELEGRAM_BOT_TOKEN` in `TELEGRAM_WEBHOOK_SECRET` in poženi
   `npm run telegram:setup -- https://<produkcijska domena>`.
   Domena mora biti produkcijska (ne `*.vercel.app` predogled, ki je za prijavo).

Izklop: `npm run telegram:setup -- --off` ali odstrani env spremenljivke v Vercelu.

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
