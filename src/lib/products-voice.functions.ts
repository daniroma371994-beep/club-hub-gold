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
  query: z.string(),
  category_name: z.string(),
  unit_type: z.string(),
  is_smokeable: z.boolean(),
  product_name: z.string(),
  category_id: z.string(),
  stock: z.number(),
  buy_price: z.number(),
  sell_price: z.number(),
  strain: z.string(),
});

export const parseProductCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const catsList = data.categories.map((c) => `${c.id} = ${c.name} (${c.unit_type}${c.is_smokeable ? ", fumable" : ""})`).join("\n");

    const system = `Eres un parser de comandos de voz para una página de productos de un club cannábico (español/italiano).
Decide la acción según el transcript:
- "buscar X" / "busca X" / "encuentra X" / sólo el nombre → action="search", query=texto a buscar.
- "crear categoría X" / "nueva categoría X" → action="create_category". unit_type: "gr" si gramos, "unit" si unidades, "" si no se sabe. is_smokeable=true si menciona "fumable" o si la categoría suena a flor/hash/extracción.
- "crear producto X en categoría Y stock N compra A venta B (indica/sativa/híbrida)" → action="create_product". category_id DEBE coincidir con el id exacto de la lista. Si no encaja, "".
- strain: "indica" | "sativa" | "hibrida" | "".
- Si no se entiende, action="unknown".

Categorías disponibles:
${catsList || "(ninguna)"}

Devuelve SIEMPRE todos los campos (strings vacíos "" o 0 si no aplican, booleans false).`;

    const { object } = await generateObject({
      model,
      system,
      schema: Schema,
      prompt: `Transcript: "${data.transcript}"`,
    });
    return object;
  });
