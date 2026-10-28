// =====================================================================
// kobo-recibir · Receptor de encuestas de KoboToolbox para Sigpredial
// ---------------------------------------------------------------------
// Kobo (Configuración › Servicios REST) envía aquí cada encuesta en JSON.
// La URL lleva ?clave=… (privado.config 'kobo_clave'); sin ella se rechaza.
// Las respuestas llegan con el nombre del grupo («g_hogar/documento»);
// aquí se dejan con el nombre corto de la pregunta («documento») y la
// base de datos (productores.procesar_kobo) crea o actualiza productor,
// vereda y predio, y guarda la encuesta completa.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

type Json = Record<string, unknown>;

// «grupo/subgrupo/pregunta» → «pregunta»; también dentro de los repetidos
function aplanar(obj: Json): Json {
  const r: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    const corto = k.startsWith("_") ? k : k.split("/").pop()!;
    r[corto] = Array.isArray(v)
      ? v.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? aplanar(x as Json) : x))
      : v;
  }
  return r;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "GET") return json({ ok: true, servicio: "Sigpredial · receptor Kobo" });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const clave = new URL(req.url).searchParams.get("clave") ?? "";
  if (!clave) return json({ error: "Falta la clave" }, 401);

  let cuerpo: Json;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "El cuerpo no es JSON válido" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "productores" },
    auth: { persistSession: false },
  });
  const { data, error } = await sb.rpc("procesar_kobo", { p: aplanar(cuerpo), crudo: cuerpo, clave });

  if (error) {
    const noAutorizado = error.code === "28000" || /clave/i.test(error.message);
    console.error("procesar_kobo:", error.message);
    return json({ error: error.message }, noAutorizado ? 401 : 500);
  }
  // Se responde 200 aunque la encuesta quede con «error»: queda guardada para revisarla
  // y reprocesarla en Sigpredial, y así Kobo no la reenvía una y otra vez.
  console.log("encuesta", data?.estado, data?.id, data?.error ?? "");
  return json(data);
});
