import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, tool, stepCountIs } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- Transcription ----------
const TranscribeInput = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TranscribeInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const bin = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const ext =
      data.mimeType.includes("mp4") ? "mp4" :
      data.mimeType.includes("mpeg") ? "mp3" :
      data.mimeType.includes("wav") ? "wav" : "webm";
    const blob = new Blob([bin], { type: data.mimeType.split(";")[0] });

    const fd = new FormData();
    fd.append("model", "openai/gpt-4o-mini-transcribe");
    fd.append("file", blob, `recording.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Lovable-API-Key": key },
      body: fd,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Transcripción falló: ${res.status} ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as { text?: string };
    return { text: (j.text ?? "").trim() };
  });

// ---------- Field extraction for the new-socio page ----------
const ExtractInput = z.object({
  transcript: z.string().min(1),
  current: z.object({
    first_name: z.string().default(""),
    last_name: z.string().default(""),
    birth_date: z.string().default(""),
    city: z.string().default(""),
    phone: z.string().default(""),
    dni_number: z.string().default(""),
    plan_name: z.string().default(""),
  }),
  available_plans: z.array(z.string()).default([]),
});

export const extractMemberFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExtractInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const system = `Extraes datos de un socio dictados en voz (español/italiano).
Devuelve SOLO un JSON con las claves: first_name, last_name, birth_date, city, phone, dni_number, plan_name.
Reglas:
- birth_date en formato YYYY-MM-DD. Si el usuario dice "24 del 07 del 1995" → "1995-07-24".
- plan_name debe ser EXACTAMENTE uno de: ${data.available_plans.join(" | ") || "(ninguno)"}. Mapea sinónimos (mensual, trimestral, anual). Si no encaja, deja vacío.
- dni_number en mayúsculas, sin espacios.
- phone solo dígitos y opcional +.
- Si un campo no se menciona y ya existía un valor previo, MANTÉN el valor previo.
- Si un campo no se menciona y no había valor, devuélvelo como string vacío "".
- NO inventes datos. NO añadas explicaciones.
Estado actual:
${JSON.stringify(data.current)}`;

    const { text } = await generateText({
      model,
      system,
      prompt: `Transcripción nueva: "${data.transcript}"\n\nDevuelve el JSON actualizado.`,
    });

    // Try to extract JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { fields: data.current, raw: text };
    try {
      const parsed = JSON.parse(match[0]);
      const out = { ...data.current };
      for (const k of Object.keys(out) as Array<keyof typeof out>) {
        const v = parsed[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      return { fields: out, raw: text };
    } catch {
      return { fields: data.current, raw: text };
    }
  });

// ---------- Agent ----------
const AgentInput = z.object({
  transcript: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .default([]),
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function normalizeDate(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export const agentRespond = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AgentInput.parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const supabase = context.supabase;
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const tools = {
      list_plans: tool({
        description: "Lista las cuotas/planes activos disponibles.",
        inputSchema: z.object({}),
        execute: async () => {
          const { data, error } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days,price_cents")
            .eq("active", true)
            .order("sort_order");
          if (error) return { error: error.message };
          return { plans: data };
        },
      }),
      list_recent_members: tool({
        description: "Lista los socios más recientes con su fecha de caducidad.",
        inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
        execute: async ({ limit }) => {
          const { data, error } = await supabase
            .from("members")
            .select("id,first_name,last_name,phone,city,expires_at")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (error) return { error: error.message };
          return { members: data };
        },
      }),
      find_members: tool({
        description: "Busca socios por nombre, apellido o DNI.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: async ({ query }) => {
          const q = `%${query}%`;
          const { data, error } = await supabase
            .from("members")
            .select("id,first_name,last_name,phone,city,expires_at,plan_id,dni_number")
            .or(`first_name.ilike.${q},last_name.ilike.${q},dni_number.ilike.${q}`)
            .limit(10);
          if (error) return { error: error.message };
          return { members: data };
        },
      }),
      create_member: tool({
        description:
          "Crea un nuevo socio con TODOS los datos dictados. Llama esta herramienta UNA SOLA VEZ cuando tengas: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan. La foto del DNI y la firma del contrato son el ÚNICO paso aparte (se hacen en la ficha del socio después).",
        inputSchema: z.object({
          first_name: z.string().min(1),
          last_name: z.string().min(1),
          birth_date: z.string().describe("Fecha de nacimiento en formato YYYY-MM-DD o DD/MM/YYYY"),
          city: z.string().min(1),
          phone: z.string().min(3),
          dni_number: z.string().min(3),
          plan_name: z.string().describe("Nombre del plan (ej. Mensual, Trimestral, Anual)"),
        }),
        execute: async (input) => {
          const birth = normalizeDate(input.birth_date);
          if (!birth) return { error: "Fecha de nacimiento no válida. Usa DD/MM/AAAA." };
          const age = (Date.now() - new Date(birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          if (age < 18) return { error: "El socio debe ser mayor de edad." };

          const { data: planRows } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days")
            .eq("active", true);
          const plans = planRows ?? [];
          const target = input.plan_name.toLowerCase();
          const plan =
            plans.find((p) => p.name.toLowerCase() === target) ??
            plans.find((p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase()));
          if (!plan) return { error: `Plan no encontrado. Disponibles: ${plans.map((p) => p.name).join(", ")}` };

          const joined = todayISO();
          const expires = addDays(joined, plan.duration_days);

          const { data: created, error } = await supabase
            .from("members")
            .insert({
              first_name: input.first_name.trim(),
              last_name: input.last_name.trim(),
              birth_date: birth,
              city: input.city.trim(),
              phone: input.phone.trim(),
              dni_number: input.dni_number.trim().toUpperCase(),
              plan_id: plan.id,
              joined_at: joined,
              expires_at: expires,
              created_by: context.userId,
            })
            .select("id,first_name,last_name,expires_at")
            .single();
          if (error) return { error: error.message };
          return {
            created,
            navigate_to: `/soci/${created.id}`,
            note: "Socio creado. Ahora abre la ficha para subir la foto del DNI y firmar el contrato.",
          };
        },
      }),
      renew_member: tool({
        description: "Renueva la cuota de un socio existente. Suma los días del plan a la fecha de caducidad actual (o a hoy si ya caducó).",
        inputSchema: z.object({
          member_id: z.string().uuid(),
          plan_name: z.string(),
        }),
        execute: async ({ member_id, plan_name }) => {
          const { data: plans } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days")
            .eq("active", true);
          const target = plan_name.toLowerCase();
          const plan = (plans ?? []).find(
            (p) => p.name.toLowerCase() === target || p.name.toLowerCase().includes(target),
          );
          if (!plan) return { error: "Plan no encontrado." };
          const { data: m } = await supabase.from("members").select("expires_at").eq("id", member_id).maybeSingle();
          if (!m) return { error: "Socio no encontrado." };
          const base = m.expires_at < todayISO() ? todayISO() : m.expires_at;
          const newExpires = addDays(base, plan.duration_days);
          const { error } = await supabase
            .from("members")
            .update({ plan_id: plan.id, expires_at: newExpires })
            .eq("id", member_id);
          if (error) return { error: error.message };
          return { ok: true, expires_at: newExpires };
        },
      }),
    };

    const system = `Eres el asistente de voz de SNOOP, un club social de cannabis en España.
Hablas en español, respondes siempre MUY breve y natural (1-2 frases, como hablaría una persona, sin listas ni markdown).
Mantienes el contexto: si el usuario ya te dio un dato antes, NO lo vuelvas a pedir.

Para CREAR un socio necesitas TODOS estos datos: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan.
Ve acumulando los datos que el usuario dicte en uno o varios turnos. Cuando tengas TODOS, llama create_member UNA SOLA VEZ con todo junto.
Si faltan datos, pide solo los que falten, todos juntos en una sola frase (ej: "Me falta ciudad y teléfono").
NO preguntes por la foto del DNI ni por la firma: esos son el único paso aparte, se hacen luego en la ficha del socio.
Después de crear, confirma con el nombre y di "abro la ficha para la foto del DNI y la firma".

También puedes: buscar socios, listar planes, renovar cuotas.
Fecha de hoy: ${todayISO()}.`;

    const { text, toolResults } = await generateText({
      model,
      system,
      messages: [
        ...data.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: data.transcript },
      ],
      tools,
      stopWhen: stepCountIs(50),
    });

    // Surface a navigation target if create_member returned one
    let navigateTo: string | null = null;
    for (const tr of toolResults ?? []) {
      const out = (tr as any).output ?? (tr as any).result;
      if (out && typeof out === "object" && typeof out.navigate_to === "string") {
        navigateTo = out.navigate_to;
      }
    }

    return { reply: text || "Hecho.", navigateTo };
  });
