import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- Transcription ----------
const TranscribeInput = z.object({
  audioBase64: z.string().min(1),
  mime: z.string().min(1),
  language: z.string().optional(),
  prompt: z.string().optional(),
});

function extToFormat(mime: string): { ext: string; format: string } {
  const m = mime.split(";")[0].toLowerCase();
  if (m.includes("webm")) return { ext: "webm", format: "webm" };
  if (m.includes("mp4") || m.includes("m4a")) return { ext: "mp4", format: "mp4" };
  if (m.includes("mpeg") || m.includes("mp3")) return { ext: "mp3", format: "mp3" };
  if (m.includes("wav")) return { ext: "wav", format: "wav" };
  if (m.includes("ogg")) return { ext: "ogg", format: "ogg" };
  return { ext: "webm", format: "webm" };
}

export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const buf = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (buf.byteLength < 1024) throw new Error("Audio troppo breve: ripeti il campo.");
    if (buf.byteLength > 25 * 1024 * 1024) throw new Error("Audio troppo lungo: ripeti più corto.");
    const { ext } = extToFormat(data.mime);
    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append("language", data.language ?? "it");
    form.append(
      "prompt",
      data.prompt ??
        "Trascrivi la risposta breve dell'utente in italiano. Mantieni nomi, email, numeri e date il più fedeli possibile.",
    );
    form.append("file", new Blob([buf], { type: data.mime }), `recording.${ext}`);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Trascrizione fallita (${res.status}): ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    return { text: (json.text ?? "").trim() };
  });

// ---------- Intent parsing ----------
const IntentSchema = z.object({
  action: z.enum([
    "navigate",
    "create_member",
    "find_member",
    "add_to_cart",
    "remove_from_cart",
    "clear_cart",
    "confirm_order",
    "renew_plan",
    "cancel",
    "unknown",
  ]),
  target: z.string().optional(),
  query: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  dni: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  email: z.string().optional(),
  birth_date: z.string().optional(),
  quantity: z.number().optional(),
  unit: z.enum(["g", "pz"]).optional(),
  speak: z.string().optional(),
});

const ParseInput = z.object({
  text: z.string().min(1),
  route: z.string().optional(),
  products: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  plans: z.array(z.object({ id: z.string(), name: z.string(), duration_days: z.number() })).optional(),
});

export const parseVoiceIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ParseInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);

    const productList = (data.products ?? []).map((p) => `- ${p.name}`).join("\n") || "(nessuno)";
    const planList = (data.plans ?? []).map((p) => `- ${p.name} (${p.duration_days} giorni)`).join("\n") || "(nessuno)";

    const system = `Sei l'assistente vocale "Meduza" di un club privato. L'utente parla in italiano. Il tuo compito è convertire il testo trascritto in un'azione strutturata. NON esegui nulla, restituisci solo JSON.

Azioni disponibili:
- navigate: vai a una sezione. target ∈ {"dashboard","soci","crear-socio","gestionar-socio","productos","caja","planes","colaboradores"}. Frasi tipiche: "apri cassa", "vai a prodotti", "mostra dashboard", "nuovo socio", "gestisci soci", "quote", "collaboratori".
- create_member: registra un nuovo socio. Estrai first_name, last_name e opzionali dni, phone, address, email, birth_date (formato YYYY-MM-DD). Frase tipica: "nuovo socio Mario Rossi DNI 12345678 telefono 600...".
- find_member: cerca socio esistente. query = numero tessera o nome. "cerca socio numero 42", "apri scheda Maria".
- add_to_cart: aggiungi prodotto al carrello/ordine del socio attuale. query = nome prodotto (deve coincidere con lista), quantity = numero anche decimale, unit = "g" per grammi o "pz" per pezzi. "aggiungi 2 grammi di Amnesia", "metti 3 pezzi".
- remove_from_cart: togli prodotto dal carrello. query = nome prodotto.
- clear_cart: svuota tutto il carrello.
- confirm_order: conferma e incassa l'ordine attuale. "conferma ordine", "incassa", "cobra".
- renew_plan: attiva/rinnova quota associativa per il socio attuale. query = nome o durata del piano. "rinnova piano 6 mesi".
- cancel: l'utente ha detto "annulla", "lascia stare", "fermati".
- unknown: se non capisci o manca informazione critica. In "speak" metti una spiegazione breve in italiano.

Prodotti attivi:
${productList}

Piani attivi:
${planList}

Pagina attuale: ${data.route ?? "sconosciuta"}

Regole:
- Per add_to_cart: se l'utente non specifica unità, usa "pz" per prodotti a pezzo e "g" per gli altri; se non sei sicuro usa "g". quantity predefinita 1.
- Per renew_plan: passa il nome come detto dall'utente; il client farà match difuso.
- Non inventare prodotti o piani non presenti nelle liste. Se non c'è match ragionevole, usa unknown.
- In "speak" metti SEMPRE una conferma corta in italiano di ciò che farai (es. "Aggiungo 2 grammi di Amnesia"). Massimo 15 parole.`;

    const { experimental_output: output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      experimental_output: Output.object({ schema: IntentSchema }),
      system,
      prompt: `Testo dell'utente: """${data.text}"""`,
    });

    return output;
  });

export type VoiceIntent = z.infer<typeof IntentSchema>;
