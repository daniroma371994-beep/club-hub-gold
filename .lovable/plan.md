Procediamo per fasi. Questa è la **Fase 1**. Dashboard, Cassa, Prodotti, Collaboratori vengono nascosti ora e ricostruiti più avanti se vorrai.

## 1. Branding "Snoop"

- Logo caricato → diventa l'asset ufficiale (login, sidebar, watermark).
- Palette: nero profondo + **neon verde** (`#39FF14` con glow), bianco testo, oro solo nel logo.
- Font: display moderno geometrico (Space Grotesk) + body Inter. Niente più Cinzel/Cormorant.
- Effetti: glow verde sui bordi attivi, scanline sottile, micro-animazioni framer-motion.
- Nome app ovunque: **SNOOP** — "Your app for club access in Spain".

## 2. Reset database

Cancello tutto e ricreo schema pulito:

- `membership_plans` — piani fissi (Mensile / Trimestrale / Annuale) con prezzo e durata in giorni.
- `members` — nome, cognome, data nascita, città, telefono, numero DNI, URL foto DNI, piano scelto, data iscrizione, data scadenza, URL firma, data firma contratto.
- Drop: `products`, `sales`, `sale_items`, `member_subscriptions` (vecchi).
- Storage bucket privato `snoop-docs` per foto DNI e firme.
- RLS: solo utenti autenticati leggono/scrivono.
- Seed: 3 piani di default (Mensile 20 €, Trimestrale 50 €, Annuale 150 €) — modificabili dopo.

## 3. Menu laterale ridotto

Solo: **Soci** + **Piani quote** (admin). Tutto il resto nascosto.

## 4. Pagina Soci (menu)

Due grandi card:
- **Crea socio**
- **Gestisci socio** (cerca per nome/DNI, lista con scadenza)

## 5. Wizard "Crea socio" (5 step con barra progresso)

```text
[1 Anagrafica] → [2 Contatti] → [3 Quota] → [4 Foto DNI] → [5 Contratto + Firma]
```

1. Nome, Cognome, Data di nascita
2. Città, Telefono
3. Selezione piano (cards con prezzo/durata) → calcola automaticamente data scadenza
4. Numero DNI + scatto/upload foto fronte (compress + upload su bucket)
5. Testo contratto in spagnolo (Ley Orgánica 4/2015, consumo privato adulti, no lucro, riservatezza, codice di condotta) scrollabile, poi canvas firma col dito → salvato come PNG su bucket. Senza firma il salvataggio è bloccato.

A fine wizard: socio creato → schermata di conferma con QR personale + link a "Gestisci".

## 6. Gestisci socio

Lista con foto, nome, piano, **giorni residui** (badge verde/giallo/rosso), barra di ricerca, click apre dettaglio (anagrafica + foto DNI + contratto PDF/PNG firmato + rinnovo piano).

## 7. Cosa NON tocco in Fase 1

- Voice assistant (lo rimuovo dalla UI per ora)
- Cassa, Prodotti, Collaboratori (route disabilitate)
- Reset password e auth (già funzionanti)

## Dettagli tecnici

- Tabelle public con GRANT espliciti + RLS `TO authenticated`.
- Storage privato, accesso via signed URL (`createSignedUrl`).
- Firma: `<canvas>` touch/mouse → `toDataURL('image/png')` → upload.
- Foto DNI: input `capture="environment"` (apre camera su mobile) + canvas resize a max 1280px / ~300KB prima dell'upload.
- Tokens neon verde in `src/styles.css` (`--neon`, `--neon-glow`, ombre con `oklch`).
- Niente più `gold-*`. Conservo tutto come token semantici, mai colori hardcoded nei componenti.

Quando approvi parto subito con tutto questo in un colpo solo. Poi nei prossimi turni facciamo Dashboard, Cassa, ecc.
