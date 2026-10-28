// =====================================================================
// ficha-pdf · Abre la ficha predial guardada (PDF) desde Access
// ---------------------------------------------------------------------
// Access (vista r_fichas) trae para cada predio un enlace
//   …/ficha-pdf?predio=<id>&k=<clave de oficina>
// Aquí se valida la clave y se redirige a un enlace temporal (10 min)
// del PDF guardado en el almacenamiento privado «fichas».
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const pagina = (titulo: string, texto: string, status: number) =>
  new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
     <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f4f1e7;color:#1d2a1d;display:grid;place-items:center;height:100vh;margin:0}
     div{background:#fff;padding:28px 34px;border-radius:10px;border-top:6px solid #456A3E;max-width:460px;box-shadow:0 2px 12px rgba(0,0,0,.12)}
     h1{font-size:19px;margin:0 0 8px;color:#456A3E}</style></head>
     <body><div><h1>${titulo}</h1><p>${texto}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const predio = (url.searchParams.get("predio") ?? "").toLowerCase();
  const k = url.searchParams.get("k") ?? "";
  if (!UUID.test(predio) || !k) return pagina("Enlace incompleto", "El enlace de la ficha no es válido.", 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "productores" },
    auth: { persistSession: false },
  });

  const { data: valida, error: e1 } = await sb.rpc("clave_oficina_valida", { k });
  if (e1) return pagina("Error", "No se pudo validar el enlace. Intente de nuevo.", 500);
  if (!valida) return pagina("Sin permiso", "El enlace no tiene una clave válida. Vuelva a vincular Access.", 401);

  const { data, error } = await sb.storage.from("fichas").createSignedUrl(`${predio}/ficha.pdf`, 600);
  if (error || !data?.signedUrl) {
    return pagina("Ficha no encontrada",
      "Este predio todavía no tiene ficha predial guardada. Ábrala en el portal y pulse «Guardar en Sigpredial».", 404);
  }
  return new Response(null, { status: 302, headers: { Location: data.signedUrl } });
});
