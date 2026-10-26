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

  // Departamento que aparece seleccionado al crear un predio nuevo
  // (código DANE de 2 dígitos: "76" Valle, "18" Caquetá, "50" Meta…). Vacío = ninguno.
  DEPARTAMENTO_INICIAL: "76",

  // Vista inicial del mapa (Valle del Cauca)
  CENTRO_MAPA: [4.25, -76.30],
  ZOOM_MAPA: 9,

  // Límites de referencia (solo para ver; no se editan). Aparecen en el selector de capas
  // del mapa y se descargan la primera vez que se prenden.
  //   tipo: "municipio" (línea gruesa) o "vereda" (línea delgada)
  //   etiquetas_desde: zoom a partir del cual se muestran los nombres
  // Para agregar otro departamento, copie una línea y cambie el nombre y el archivo.
  CAPAS_REFERENCIA: [
    { nombre: "Municipios · Caquetá", archivo: "capas/caqueta/municipios.geojson", tipo: "municipio", etiquetas_desde: 9 },
    { nombre: "Veredas · Caquetá",    archivo: "capas/caqueta/veredas.geojson",    tipo: "vereda",    etiquetas_desde: 13 }
  ]
};
