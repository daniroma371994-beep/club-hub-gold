import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  transcript: z.string().min(1),
  categories: z.array(z.object({ id: z.string(), name: z.string(), unit_type: z.string(), is_smokeable: z.boolean() })).default([]),
});

const Schema = z.object({
  action: z.enum(["search", "create_category", "create_product", "unknown"]),
  // search
  query: z.string().default(""),
  // create_category
  category_name: z.string().default(""),
  unit_type: z.enum(["gr", "unit", ""]).default(""),
  is_smokeable: z.boolean().default(false),
  // create_product
  product_name: z.string().default(""),
  category_id: z.string().default(""),
  stock: z.number().default(0),
  buy_price: z.number().default(0),
  sell_price: z.number().default(0),
  strain: z.enum(["indica", "sativa", "hibrida", ""]).default(""),
});

export const parseProductCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const catsList = data.categories.map((c) => `${c.id} = ${c.name} (${c.unit_type}${c.is_smokeable ? ", fumable" : ""})`).join("\n");

    const system = `Eres un parser de comandos de voz para una página de productos de un club cannábico (español/italiano).
Decide la acción según el transcript:
- "buscar X" / "busca X" / "encuentra X" / sólo el nombre → action="search", query=texto a buscar.
- "crear categoría X" / "nueva categoría X" → action="create_category". Detecta unit_type: gramos→"gr", unidades→"unit". is_smokeable=true si menciona "fumable" o si la categoría suena a flor/hash/extracción.
- "crear producto X en categoría Y stock N compra A venta B (indica/sativa/híbrida)" → action="create_product". category_id DEBE coincidir con el id exacto de la lista. Si no encaja claramente, devuelve "".
- Si no se entiende, action="unknown".

Categorías disponibles:
${catsList || "(ninguna)"}

Devuelve SIEMPRE todos los campos del schema (vacíos/0 si no aplican).`;

    const { object } = await generateObject({
      model,
      system,
      schema: Schema,
      prompt: `Transcript: "${data.transcript}"`,
    });
    return object;
  });
