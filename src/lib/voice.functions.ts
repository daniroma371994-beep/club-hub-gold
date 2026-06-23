import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- Transcription ----------
const TranscribeInput = z.object({
  audioBase64: z.string().min(1),
  mime: z.string().min(1),
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
    const { ext } = extToFormat(data.mime);
    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("language", "es");
    form.append("file", new Blob([buf], { type: data.mime }), `recording.${ext}`);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Transcripción falló (${res.status}): ${txt.slice(0, 200)}`);
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

    const productList = (data.products ?? []).map((p) => `- ${p.name}`).join("\n") || "(ninguno)";
    const planList = (data.plans ?? []).map((p) => `- ${p.name} (${p.duration_days} días)`).join("\n") || "(ninguno)";

    const system = `Eres el asistente de voz "Meduza" de un club privado. El usuario habla en español. Tu tarea es convertir el texto transcrito en una acción estructurada. NO ejecutas nada, solo devuelves el JSON.

Acciones disponibles:
- navigate: ir a una sección. target ∈ {"dashboard","soci","crear-socio","gestionar-socio","productos","caja","planes","colaboradores"}. Frases típicas: "abre la caja", "ve a productos", "muestra el dashboard".
- create_member: registrar nuevo socio. Extrae first_name, last_name, y opcional dni, phone, address, email, birth_date (formato YYYY-MM-DD). El usuario suele decir "nuevo socio Juan Pérez DNI 12345678 teléfono 600...".
- find_member: buscar socio existente. query = número de tarjeta o nombre. "busca socio número 42", "abre la ficha de María".
- add_to_cart: añadir producto al pedido del socio actual. query = nombre del producto (debe coincidir con uno de la lista), quantity = número (acepta decimales), unit = "g" para gramos o "pz" para piezas. "añade 2 gramos de Amnesia", "agrega 3 piezas de pre-rolled".
- remove_from_cart: quitar producto del pedido. query = nombre del producto.
- clear_cart: vaciar el pedido entero.
- confirm_order: confirmar y cobrar el pedido actual. "confirma el pedido", "cobra".
- renew_plan: activar/renovar cuota asociativa para el socio actual. query = nombre o duración del plan (debe coincidir con uno de la lista). "renueva plan 6 meses".
- cancel: el usuario dijo "cancela", "olvídalo".
- unknown: si no entiendes o falta info crítica. Pon en "speak" una breve explicación en español de qué falta.

Productos activos:
${productList}

Planes activos:
${planList}

Ruta actual: ${data.route ?? "desconocida"}

Reglas:
- Para add_to_cart: si el usuario no especifica unidad, usa "pz" para productos por pieza y "g" para los demás (asume por defecto "g" si no estás seguro). quantity por defecto 1.
- Para renew_plan: pasa el nombre tal como lo dijo el usuario; el cliente hará el match difuso.
- Nunca inventes nombres de productos o planes que no aparecen en las listas. Si no hay match razonable, usa unknown.
- En "speak" pon SIEMPRE una confirmación corta en español de lo que vas a hacer (ej. "Añadiendo 2 gramos de Amnesia"). Máximo 15 palabras.`;

    const { experimental_output: output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      experimental_output: Output.object({ schema: IntentSchema }),
      system,
      prompt: `Texto del usuario: """${data.text}"""`,
    });

    return output;
  });

export type VoiceIntent = z.infer<typeof IntentSchema>;
