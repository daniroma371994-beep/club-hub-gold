
# Controllo vocale globale "Meduza"

Aggiungo un assistente vocale always-on in spagnolo che permette di navigare, registrare soci, gestire il dispensario e rinnovare le quote, il tutto a voce.

## Flusso

```text
[Web Speech API es-ES continuo]  →  rileva wake word "Meduza"
        ↓
[MediaRecorder webm/mp4]         →  registra il comando (stop dopo 1.5s di silenzio o 8s max)
        ↓
[serverFn transcribeVoice]       →  Lovable AI · openai/gpt-4o-mini-transcribe
        ↓
[serverFn parseVoiceIntent]      →  Gemini 3 Flash + Output.object (zod schema)
        ↓
[VoiceRouter client]             →  esegue azione (navigate / dbInsert / addToCart / ecc.)
        ↓
HUD a schermo: stato (idle/listening/processing) + testo trascritto + conferma azione
```

## Intent supportati (schema zod)

| action | parametri | esempio in voce |
|---|---|---|
| `navigate` | `target: 'dashboard'|'soci'|'crear-socio'|'gestionar-socio'|'productos'|'caja'|'planes'|'colaboradores'` | "Meduza, abre la caja" |
| `create_member` | `first_name, last_name, dni?, phone?, address?, email?, birth_date?` | "Meduza, nuevo socio Juan Pérez DNI 12345678 teléfono..." |
| `find_member` | `query` (numero tessera, nome o cognome) | "Meduza, busca socio número 42" / "...Juan Pérez" |
| `add_to_cart` | `product_query, quantity, unit: 'g'|'pz'` | "Meduza, añade 2 gramos de Amnesia" |
| `remove_from_cart` | `product_query` | "Meduza, quita Amnesia" |
| `clear_cart` | — | "Meduza, vacía el pedido" |
| `confirm_order` | — | "Meduza, confirma el pedido" |
| `renew_plan` | `plan_query` (nome o durata) | "Meduza, renueva plan 6 meses" |
| `cancel` / `unknown` | `reason?` | feedback all'utente |

`find_member`, `add_to_cart`, `confirm_order`, `renew_plan` agiscono sullo state condiviso della pagina "Gestisci socio"; se chiamati da un'altra route, naviga prima a `/soci/gestisci`.

## Backend (TanStack server functions)

- `src/lib/voice.functions.ts`
  - `transcribeVoice({ audioBase64, mime })` → POST multipart a `https://ai.gateway.lovable.dev/v1/audio/transcriptions` con `model=openai/gpt-4o-mini-transcribe`, `language=es`. Restituisce `{ text }`.
  - `parseVoiceIntent({ text, context: { route, products: [{id,name}], plans: [{id,name,days}] } })` → AI SDK `generateText` + `Output.object(zod)`. Schema unione discriminato sugli intent sopra. System prompt in spagnolo che spiega: matcha nomi prodotto/piano fuzzy passandoli per nome, parsing numeri, niente azioni distruttive senza conferma esplicita. Modello `google/gemini-3-flash-preview`.
- `src/lib/ai-gateway.server.ts` — helper provider (pattern canonico).
- Server functions montate con `requireSupabaseAuth` (lo staff è loggato; il bearer è auto-attaccato).

## Frontend

- `bun add ai @ai-sdk/openai-compatible zod` (zod già presente — verificare; ai/openai-compatible nuovi).
- `src/components/voice/VoiceAssistant.tsx` — montato dentro `MeduzaLayout`, fixed bottom-right.
  - State machine: `off | wake | recording | transcribing | thinking | executing | error`.
  - Web Speech API (`webkitSpeechRecognition`, lang `es-ES`, continuous, interimResults) per wake word. Quando il transcript contiene "meduza", ferma SR e parte `MediaRecorder` (mime `audio/webm` o `audio/mp4` Safari).
  - VAD semplice: AnalyserNode RMS; chiude quando RMS < soglia per 1.5s, oppure 8s max.
  - Toggle on/off persistente in `localStorage('meduza-voice')`.
  - HUD: stato corrente, ultima trascrizione, ultima azione eseguita, toast con `sonner` su errori/successi.
- `src/components/voice/VoiceContext.tsx` — context globale per i comandi che agiscono sulla pagina "Gestisci socio": espone `register({ findMember, addToCart, removeFromCart, clearCart, confirmOrder, activatePlanByQuery })`. `soci.gestisci.tsx` registra i suoi handler al mount; se la route non è quella, il router naviga lì e poi (dopo mount) richiama l'azione pendente via context.
- `src/components/voice/VoiceRouter.ts` — funzione pura `executeIntent(intent, { navigate, voiceCtx, supabase, userId })`. Gestisce `create_member` chiamando direttamente `supabase.from('members').insert(...)` e mostrando QR con redirect a `/soci/elenco`.

## Permessi e UX

- Toggle nel layout per accendere/spegnere il microfono globale (utenti senza permesso fotocamera/mic vedono solo l'errore).
- Wake word fallback: pulsante mic flottante per push-to-talk (utile su Safari iOS dove SR continuo non funziona; in quel caso il toggle disabilita auto-wake e usa solo PTT).
- Feedback udibile breve (beep WebAudio) quando viene rilevata la wake word.
- L'assistente è invisibile finché l'utente non si logga (vive in `_authenticated` layout).

## File nuovi/modificati

- nuovi: `src/lib/ai-gateway.server.ts`, `src/lib/voice.functions.ts`, `src/components/voice/VoiceAssistant.tsx`, `src/components/voice/VoiceContext.tsx`, `src/components/voice/VoiceRouter.ts`
- modificati: `src/components/MeduzaLayout.tsx` (monta VoiceAssistant + provider), `src/routes/_authenticated/soci.gestisci.tsx` (registra handlers nel context, espone state machine), `package.json` (deps).

## Non incluso (lo chiediamo dopo se serve)

- TTS di risposta (per ora solo testo + toast).
- Conferma vocale a due step per ordini sopra una soglia.
- Comandi per modificare prodotti/piani/collaboratori (solo creazione socio + dispensario + rinnovo quota + navigazione, come richiesto).
