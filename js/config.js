/* =====================================================================
   CONFIGURACIÓN DEL SIP · CBS
   Diligencie estos datos con los de su proyecto de Supabase
   (Supabase › Project Settings › API).
   Si SUPABASE_URL queda vacío, la app abre en MODO DEMOSTRACIÓN.
   ===================================================================== */
window.SIP_CONFIG = {
  SUPABASE_URL: "https://usbqciezxkbyixqlnlhm.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NR4tBSe2sfdfPZiwsFrfCQ_RncbzN3K",   // clave pública (la protege el RLS)
  ESQUEMA: "productores",

  // Logo institucional (archivo dentro del repositorio). Vacío = marca genérica.
  LOGO: "img/logo-cbs.png",

  // Mapas base de Google (Satélite, Híbrido, Mapa, Terreno).
  // Ponga false para ocultarlos.
  GOOGLE_MAPAS: true,

  // Departamento propuesto al administrador al crear un productor (los técnicos y coordinadores
  // usan siempre el de su usuario). Código DANE de 2 dígitos: "76" Valle, "18" Caquetá, "50" Meta.
  DEPARTAMENTO_INICIAL: "76",

  // Vista inicial del mapa (Valle del Cauca)
  CENTRO_MAPA: [4.25, -76.30],
  ZOOM_MAPA: 9,

  // Límites de referencia (solo para ver; no se editan). Aparecen en el selector de capas
  // del mapa y se descargan la primera vez que se prenden.
  //   tipo: "municipio" (línea gruesa) o "vereda" (línea delgada)
  //   etiquetas_desde: zoom a partir del cual se muestran los nombres
  // Para agregar otro departamento, copie una línea y cambie el nombre y el archivo.
  //   dpto: código del departamento. Cada técnico ve solo las capas de su departamento;
  //         el administrador ve todas.
  CAPAS_REFERENCIA: [
    { nombre: "Municipios · Caquetá", archivo: "capas/caqueta/municipios.geojson", tipo: "municipio", etiquetas_desde: 9,  dpto: "18" },
    { nombre: "Veredas · Caquetá",    archivo: "capas/caqueta/veredas.geojson",    tipo: "vereda",    etiquetas_desde: 13, dpto: "18" }
  ],

  // Vista inicial del mapa según el departamento del usuario (si aún no hay predios)
  VISTA_DEPARTAMENTO: {
    "18": { centro: [1.35, -75.0], zoom: 8 },    // Caquetá (piedemonte, zona más poblada)
    "50": { centro: [2.90, -72.85], zoom: 9 },   // Meta: Puerto Lleras, Puerto Rico, Puerto Concordia, Mapiripán
    "76": { centro: [4.25, -76.30], zoom: 9 }    // Valle del Cauca
  }
};
