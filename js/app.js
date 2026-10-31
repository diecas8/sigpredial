/* =====================================================================
   SIP · CBS — Aplicación
   Estructura tipo SICA:  Productor  →  Predios  →  Lotes / Elementos
   ===================================================================== */
(function () {
  'use strict';

  const C = window.SIP_CONFIG || {};
  const api = window.SIP_API;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 2) => (n === null || n === undefined || n === '') ? '—'
    : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d });
  const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const grabar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };

  // Colores de la marca (logo CBS)
  const VERDE = '#456A3E', LIMA = '#B8BE16', AMARILLO = '#E1CC11', NARANJA = '#F28C28';

  // ---------------------------------------------------------------- Estado
  const S = {
    user: null, perfil: null,
    cat: { departamentos: [], municipios: [], cultivos: [], tenencias: [], tiposElemento: [] },
    veredas: {},              // caché por municipio
    productor: null, predios: [], predio: null, lotes: [], lote: null,
    elementos: { lineas: [], puntos: [] }, elemento: null,
    carac: [],                // encuestas de caracterización (Kobo) del predio abierto
    ficha: null,              // ficha predial guardada en PDF del predio abierto
    tab: null,                // 'productor' | 'predio' | 'lotes' | 'elementos'
    editando: null,           // 'productor' | 'predio' | 'lote' | 'elemento'
    geomLoteNueva: null,      // polígono dibujado para un lote aún no guardado
    geomElementoNueva: null,  // línea o punto dibujado para un elemento aún no guardado
    modoGeom: null,
    refs: []                  // capas cargadas desde archivos locales (no se guardan)
  };

  const ORDEN_COBERTURA = ['Permanente', 'Semipermanente', 'Transitorio', 'Pecuario', 'Forestal',
    'Conservación', 'Descanso', 'Otro'];
  const ordenGrupo = (g) => { const i = ORDEN_COBERTURA.indexOf(g); return i < 0 ? 99 : i; };

  function tiposDe(geometria) {
    return (S.cat.tiposElemento || []).filter((t) => t.geometria === geometria).map((t) => [t.id, t.nombre, t.grupo]);
  }

  // ------------------------------------------------------- Definición de campos
  const CAMPOS = {
    productor: [
      { k: 'cod_dpto', l: 'Departamento', t: 'select', req: true, soloNuevo: true,
        op: () => dptosPermitidos() },
      { k: 'tipo_doc', l: 'Tipo de documento', t: 'select', op: () => [['CC', 'CC · Cédula de ciudadanía'],
        ['TI', 'TI · Tarjeta de identidad'], ['CE', 'CE · Cédula de extranjería'], ['PPT', 'PPT · Permiso por Protección Temporal'],
        ['PAS', 'PAS · Pasaporte'], ['NIT', 'NIT · Persona jurídica'], ['Otro', 'Otro']] },
      { k: 'num_doc', l: 'Número de documento', req: true },
      { k: 'nombres', l: 'Nombres', req: true },
      { k: 'apellidos', l: 'Apellidos' },
      { k: 'sexo', l: 'Sexo', t: 'select', op: ['Mujer', 'Hombre', 'Intersexual'] },
      { k: 'fecha_nac', l: 'Fecha de nacimiento', t: 'date' },
      { k: 'telefono', l: 'Teléfono', t: 'tel' },
      { k: 'correo', l: 'Correo', t: 'email' },
      { k: 'asociacion', l: 'Asociación', ancho: 2 },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ],
    predio: [
      { k: 'cod_predio', l: 'Código del predio', ro: true },
      { k: 'cod_humboldt', l: 'Código Humboldt (Kobo)', ro: true },
      { k: 'nombre', l: 'Nombre del predio', req: true },
      { k: 'cod_dpto', l: 'Departamento', t: 'select', req: true, virtual: true,
        op: () => dptosPermitidos(S.productor && S.productor.cod_dpto) },
      { k: 'cod_mpio', l: 'Municipio', t: 'select', req: true, op: 'municipios' },
      { k: 'vereda_id', l: 'Vereda', t: 'select', op: 'veredas' },
      { k: 'tenencia_id', l: 'Tenencia', t: 'select', n: true,
        op: () => S.cat.tenencias.map((x) => [x.id, x.nombre]) },
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'altitud_msnm', l: 'Altitud (msnm)', t: 'number', step: '1' },
      { k: 'latitud', l: 'Latitud', ro: true, fmt: (v) => num(v, 6) },
      { k: 'longitud', l: 'Longitud', ro: true, fmt: (v) => num(v, 6) },
      { k: 'este_9377', l: 'Este (Origen Nacional)', ro: true, calc: (r) => en9377(r, 0), fmt: (v) => num(v, 1) },
      { k: 'norte_9377', l: 'Norte (Origen Nacional)', ro: true, calc: (r) => en9377(r, 1), fmt: (v) => num(v, 1) },
      { k: 'como_llegar', l: 'Cómo llegar', t: 'textarea', ancho: 2 }
    ],
    lote: [
      { k: 'cod_lote', l: 'Código del lote', ro: true },
      { k: 'cultivo_id', l: 'Cultivo / cobertura', t: 'select', req: true, n: true,
        op: () => S.cat.cultivos.map((x) => [x.id, x.nombre, x.tipo || 'Otro']) },
      { k: 'variedad', l: 'Variedad' },
      { k: 'fecha_siembra', l: 'Fecha de siembra', t: 'date' },
      { k: 'edad_meses', l: 'Edad (meses)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'estado', l: 'Estado', t: 'select', op: ['Levante', 'Producción', 'Renovación', 'Zoca', 'Abandonado'] },
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'dist_surcos_m', l: 'Distancia entre surcos (m)', t: 'number', step: '0.01' },
      { k: 'dist_plantas_m', l: 'Distancia entre plantas (m)', t: 'number', step: '0.01' },
      { k: 'trazado', l: 'Trazado', t: 'select', op: ['Cuadro / rectángulo', 'Tresbolillo'] },
      { k: 'densidad_ha', l: 'Densidad (plantas/ha)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'num_plantas', l: 'Número de plantas', t: 'number', step: '1' },
      { k: 'sitios_estimados', l: 'Sitios estimados', ro: true, fmt: (v) => num(v, 0) },
      { k: 'ocupacion_pct', l: '% de ocupación', ro: true, fmt: (v) => v == null ? '—' : num(v, 1) + ' %' },
      { k: 'sistema', l: 'Sistema', t: 'select',
        op: ['Libre exposición', 'Semisombra', 'Sombra', 'Agroforestal', 'Silvopastoril', 'Asociado'] },
      { k: 'sombrio', l: 'Tipo de sombrío' },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ],
    elemento: [
      { k: 'tipo_id', l: 'Tipo', t: 'select', req: true, n: true,
        op: () => tiposDe(S.elemento && S.elemento.geometria) },
      { k: 'nombre', l: 'Nombre' },
      { k: 'estado', l: 'Estado', t: 'select', op: ['Bueno', 'Regular', 'Malo'] },
      { k: 'permanencia', l: 'Permanencia', t: 'select', op: ['Permanente', 'Intermitente'] },
      { k: 'longitud_m', l: 'Longitud (m)', ro: true, solo: 'linea', fmt: (v) => num(v, 1) },
      { k: 'latitud', l: 'Latitud', ro: true, solo: 'punto', fmt: (v) => num(v, 6) },
      { k: 'longitud', l: 'Longitud', ro: true, solo: 'punto', fmt: (v) => num(v, 6) },
      { k: 'este_9377', l: 'Este (Origen Nacional)', ro: true, solo: 'punto', calc: (r) => en9377(r, 0), fmt: (v) => num(v, 1) },
      { k: 'norte_9377', l: 'Norte (Origen Nacional)', ro: true, solo: 'punto', calc: (r) => en9377(r, 1), fmt: (v) => num(v, 1) },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ]
  };

  // Diferencia entre área SIG y declarada (más de 30 % → aviso informativo)
  function difArea(r) {
    if (!r) return null;
    const s = Number(r.area_sig_ha), d = Number(r.area_declarada_ha);
    if (!(s > 0 && d > 0)) return null;
    const pct = (s - d) / d * 100;
    return Math.abs(pct) > 30 ? pct : null;
  }
  const textoDif = (pct) => `${pct > 0 ? '+' : '−'}${num(Math.abs(pct), 0)} %`;
  function avisoArea(r, que) {
    const pct = difArea(r);
    if (pct === null) return;
    aviso(`⚠ ${que}: el área dibujada (${num(r.area_sig_ha, 2)} ha) difiere ${textoDif(pct)} del área declarada ` +
      `(${num(r.area_declarada_ha, 2)} ha). Revise el dibujo o confirme el dato con el productor. ` +
      'El área declarada no se modifica.', 'alerta');
  }
  const marcaDif = (r) => {
    const pct = difArea(r);
    return pct === null ? '' : `<span class="marca-alerta" title="Área SIG ${textoDif(pct)} frente a la declarada">⚠</span>`;
  };

  // ======================================================================
  //  MAPA
  // ======================================================================
  let map, capaGeneral, capaPredio, capaLotes, capaElementos, capaEdicion, capaUbicacion, capaMedida, capaRefs;

  // ---------- Límites de referencia (municipios, veredas) definidos en config.js ----------
  // Se descargan solo la primera vez que se prenden. No reciben clics, así que no estorban
  // al dibujar ni al seleccionar predios. Los nombres aparecen desde el zoom configurado.
  let controlCapas = null, limitesAgregados = false;
  function agregarLimites() {
    if (limitesAgregados) return;
    limitesAgregados = true;
    // Solo las capas del departamento del usuario (el administrador ve todas)
    const dpto = S.perfil && S.perfil.cod_dpto;
    const lista = (C.CAPAS_REFERENCIA || []).filter((cfg) => !dpto || !cfg.dpto || cfg.dpto === dpto);
    if (!lista.length || !controlCapas) return;
    lista.forEach((cfg) => {
      const i = cfg.archivo;   // clave para recordar si estaba prendida
      const grupo = L.layerGroup(), etiquetas = L.layerGroup();
      const esMpio = cfg.tipo === 'municipio';
      const estilo = esMpio
        ? { color: '#ffffff', weight: 2.5, opacity: 0.95, fill: false }
        : { color: '#ffe066', weight: 1.2, opacity: 0.9, dashArray: '5 4', fill: false };
      let cargada = false, puntos = [];
      const pintarEtiquetas = () => {
        etiquetas.clearLayers();
        if (!map.hasLayer(grupo) || map.getZoom() < (cfg.etiquetas_desde || 12)) return;
        const vista = map.getBounds().pad(0.1);
        let n = 0;
        for (const p of puntos) {
          if (!vista.contains(p.ll)) continue;
          if (++n > 400) break;
          L.marker(p.ll, { pane: 'limites', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'etq-limite ' + (esMpio ? 'etq-mpio' : 'etq-vereda'),
              html: '<span>' + esc(p.nombre) + '</span>', iconSize: null }) }).addTo(etiquetas);
        }
      };
      grupo.on('add', async () => {
        etiquetas.addTo(map);
        grabar('sip_limite_' + i, '1');
        if (!cargada) {
          cargada = true;
          try {
            const gj = await (await fetch(cfg.archivo)).json();
            L.geoJSON(gj, { pane: 'limites', interactive: false, style: estilo }).addTo(grupo);
            puntos = gj.features.filter((f) => f.properties && f.properties.lx != null)
              .map((f) => ({ ll: L.latLng(f.properties.ly, f.properties.lx), nombre: f.properties.nombre || '' }));
          } catch (e) {
            cargada = false;
            aviso('No se pudo cargar la capa «' + cfg.nombre + '». Revise la conexión.', 'alerta');
            return;
          }
        }
        pintarEtiquetas();
      });
      grupo.on('remove', () => { map.removeLayer(etiquetas); grabar('sip_limite_' + i, '0'); });
      map.on('moveend', pintarEtiquetas);
      controlCapas.addOverlay(grupo, cfg.nombre);
      if (leer('sip_limite_' + i) === '1') grupo.addTo(map);   // recordar si estaba prendida
    });
  }

  function iniciarMapa() {
    map = L.map('mapa', { zoomControl: true, maxZoom: 20 })
      .setView(C.CENTRO_MAPA || [4.25, -76.3], C.ZOOM_MAPA || 9);

    // ---------- Mapas base (todos gratuitos, sin clave) ----------
    const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    const esri = (servicio, nativo, atrib) => L.tileLayer(ESRI + servicio + '/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: nativo, attribution: atrib });
    const atribEsri = 'Imágenes © Esri, Maxar, Earthstar Geographics';
    const etiquetasEsri = () => esri('Reference/World_Boundaries_and_Places', 19, '© Esri');
    const viasEsri = () => esri('Reference/World_Transportation', 19, '© Esri');

    const BASES = {
      'Satélite (Esri)': esri('World_Imagery', 19, atribEsri),
      'Satélite con nombres y vías': L.layerGroup([esri('World_Imagery', 19, atribEsri), viasEsri(), etiquetasEsri()]),
      'Sentinel-2 sin nubes 2024 (EOX)': L.tileLayer(
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
        { maxZoom: 20, maxNativeZoom: 15,
          attribution: 'Sentinel-2 cloudless 2024 © <a href="https://s2maps.eu">EOX IT Services GmbH</a> (datos Copernicus Sentinel)' }),
      'Topográfico con curvas (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        { maxZoom: 20, maxNativeZoom: 17,
          attribution: '© OpenStreetMap, SRTM · estilo © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
      'Topográfico (Esri)': esri('World_Topo_Map', 19, '© Esri y colaboradores'),
      'Relieve sombreado (Esri)': L.layerGroup([esri('Elevation/World_Hillshade', 16, '© Esri'), etiquetasEsri()]),
      'Calles (OpenStreetMap)': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }),
      'Claro (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' }),
      'Oscuro (CARTO)': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' })
    };

    // Capas de Google (se pueden desactivar con GOOGLE_MAPAS: false en config.js)
    if (C.GOOGLE_MAPAS !== false) {
      const google = (lyrs) => L.tileLayer(`https://mt{s}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}&hl=es`,
        { maxZoom: 20, maxNativeZoom: 20, subdomains: '0123', attribution: 'Imágenes © Google' });
      BASES['Google Satélite'] = google('s');
      BASES['Google Híbrido'] = google('y');
      BASES['Google Mapa'] = google('m');
      BASES['Google Terreno'] = google('p');
    }

    // Recordar el último mapa base elegido en este navegador
    let baseInicial = 'Satélite (Esri)';
    const g = leer('sip_mapa_base'); if (g && BASES[g]) baseInicial = g;
    BASES[baseInicial].addTo(map);
    map.on('baselayerchange', (e) => grabar('sip_mapa_base', e.name));

    window.SIP_MAPA = map;   // útil para depurar desde la consola
    capaGeneral = L.featureGroup().addTo(map);
    // Capas cargadas desde archivos y mediciones: por encima de predios y lotes
    map.createPane('refs').style.zIndex = 450;
    map.createPane('medida').style.zIndex = 460;
    capaRefs = L.featureGroup().addTo(map);

    // Capas superpuestas que se pueden prender o apagar
    const SUPERPUESTAS = {
      'Todos los predios': capaGeneral,
      'Nombres y límites': etiquetasEsri(),
      'Vías': viasEsri()
    };
    map.createPane('limites').style.zIndex = 350;          // límites de referencia: debajo de predios y lotes
    map.getPane('limites').style.pointerEvents = 'none';
    controlCapas = L.control.layers(BASES, SUPERPUESTAS, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    capaPredio = L.featureGroup().addTo(map);
    capaLotes = L.featureGroup().addTo(map);
    capaElementos = L.featureGroup().addTo(map);
    capaEdicion = L.featureGroup().addTo(map);
    capaUbicacion = L.featureGroup().addTo(map);
    capaMedida = L.featureGroup().addTo(map);

    // Herramientas: ubicación, medición, archivos y mapa completo
    const Herramientas = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar control-mapa');
        const boton = (ico, titulo, fn) => {
          const a = L.DomUtil.create('a', '', div);
          a.href = '#'; a.innerHTML = ico; a.title = titulo;
          a.setAttribute('role', 'button'); a.setAttribute('aria-label', titulo);
          L.DomEvent.on(a, 'click', (e) => { L.DomEvent.stop(e); fn(); });
          return a;
        };
        boton('⌖', 'Mi ubicación', () => map.locate({ setView: true, maxZoom: 17 }));
        boton(ICO_REGLA, 'Medir distancia', () => medir('linea'));
        boton(ICO_AREA, 'Medir área', () => medir('area'));
        boton(ICO_ARCHIVO, 'Cargar archivo (Shapefile .zip, KML/KMZ, GeoJSON, GPX)', () => $('#archivoLocal').click());
        boton(ICO_COMPLETO, 'Mapa completo', alternarMapaCompleto);
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    map.addControl(new Herramientas());

    // Lista de capas cargadas desde archivos
    const ListaRefs = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'refs-panel');
        div.id = 'refsPanel'; div.hidden = true;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      }
    });
    map.addControl(new ListaRefs());

    map.on('locationfound', (e) => {
      capaUbicacion.clearLayers();
      L.circle(e.latlng, { radius: e.accuracy, color: VERDE, weight: 1, fillOpacity: .1 }).addTo(capaUbicacion);
      L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: AMARILLO, fillOpacity: 1 }).addTo(capaUbicacion);
    });
    map.on('locationerror', () => aviso('No fue posible obtener su ubicación.', true));

    if (map.pm) {
      map.pm.setLang('es');
      map.pm.setGlobalOptions({ snappable: true, snapDistance: 15, allowSelfIntersection: false });
      map.on('pm:create', alTerminarDibujo);
    }
  }

  const ICO_REGLA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 17 17 3l4 4L7 21z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke="currentColor" stroke-width="2"/></svg>';
  const ICO_AREA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7l7-4 9 5-3 12H6z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const ICO_ARCHIVO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 11v6M9 14l3-3 3 3" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  const ICO_COMPLETO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  // Colores por cultivo o cobertura
  const COLOR_CULTIVO = {
    'Café': '#456A3E', 'Plátano': '#c9b037', 'Banano': '#d4bf3c', 'Cacao': '#8b5a2b',
    'Aguacate': '#5f8f2f', 'Cítricos': '#e6a400', 'Caña panelera': '#9cb84a', 'Mora': '#7b2d5b',
    'Pastos y forrajes': '#b7d36b', 'Bosque / forestal': '#2f5d2a',
    'Humedal': '#3b82c4', 'Bosque de galería': '#1f4d1f', 'Regeneración natural': '#8bc34a',
    'Área en descanso': '#c8a96a', 'Palma de aceite': '#c06a1f', 'Arroz': '#e3d36b', 'Pancoger': '#a6a83a'
  };
  const COLOR_TIPO = { 'Conservación': '#2f6f3a', 'Descanso': '#c8a96a', 'Transitorio': '#d9c45a',
    'Semipermanente': '#9cb84a', 'Permanente': '#5f8f2f', 'Pecuario': '#b7d36b', 'Forestal': '#2f5d2a' };
  const colorLote = (l) => COLOR_CULTIVO[l.cultivo] || COLOR_TIPO[l.tipo_cobertura] || '#6e9a4a';

  const COLOR_GRUPO = { 'Hídrico': '#1e88e5', 'Vial': '#8d5524', 'Infraestructura': '#37474f', 'Otro': '#7e57c2' };
  const colorElemento = (e) => COLOR_GRUPO[e.grupo] || '#7e57c2';

  async function cargarMapaGeneral(ajustar) {
    try {
      const lista = await api.prediosMapa();
      S.mapaPredios = lista;
      capaGeneral.clearLayers();
      lista.forEach((p) => {
        const abrir = () => { if (S.modoGeom) return; navegar(() => abrirProductor(p.productor_id, p.id)); };
        if (p.geojson) {
          L.geoJSON(p.geojson, { style: { color: AMARILLO, weight: 1.5, fillOpacity: 0.05, dashArray: '4 3' } })
            .bindTooltip(`${esc(p.cod_predio)} · ${esc(p.nombre)}<br><small>${esc(p.productor)}</small>`, { sticky: true })
            .on('click', abrir).addTo(capaGeneral);
        } else if (p.latitud != null) {
          // Predio caracterizado (punto GPS de la visita) que aún no tiene límite
          L.circleMarker([p.latitud, p.longitud], { radius: 7, color: '#fff', weight: 2, fillColor: NARANJA, fillOpacity: 1 })
            .bindTooltip(`${esc(p.cod_predio)} · ${esc(p.nombre)}<br><small>${esc(p.productor)}</small><br><b>Pendiente de delimitar</b>`, { sticky: true })
            .on('click', abrir).addTo(capaGeneral);
        }
      });
      const n = lista.filter((p) => !p.geojson).length;
      const b = $('#btnPendientes');
      if (b) { b.hidden = !n; b.textContent = `📍 Pendientes de delimitar (${n})`; }
      if (ajustar && capaGeneral.getLayers().length) map.fitBounds(capaGeneral.getBounds(), { padding: [20, 20] });
    } catch (e) { aviso(e.message, true); }
  }

  function dibujarSeleccion(ajustar) {
    capaPredio.clearLayers();
    capaLotes.clearLayers();
    capaElementos.clearLayers();
    const editandoCapa = S.modoGeom && S.modoGeom.capa;
    if (S.predio && S.predio.geojson && editandoCapa !== 'predio') {
      L.geoJSON(S.predio.geojson, { style: { color: AMARILLO, weight: 4, fillColor: AMARILLO, fillOpacity: 0.08 } })
        .bindTooltip(`Predio ${esc(S.predio.cod_predio)}`, { sticky: true })
        .addTo(capaPredio);
    } else if (S.predio && S.predio.id && S.predio.latitud != null && editandoCapa !== 'predio') {
      L.circleMarker([S.predio.latitud, S.predio.longitud], { radius: 10, color: AMARILLO, weight: 3, fillColor: NARANJA, fillOpacity: 0.9 })
        .bindTooltip(`Predio ${esc(S.predio.cod_predio)} · punto de la visita<br><b>Pendiente de delimitar</b>`, { sticky: true })
        .addTo(capaPredio);
    }
    S.lotes.forEach((l) => {
      if (!l.geojson) return;
      if (editandoCapa === 'lote' && S.lote && S.lote.id === l.id) return;
      const sel = S.lote && S.lote.id === l.id;
      L.geoJSON(l.geojson, {
        style: { color: sel ? AMARILLO : '#ffffff', weight: sel ? 3 : 1.5,
          fillColor: colorLote(l), fillOpacity: sel ? 0.65 : 0.45 }
      })
        .bindTooltip('L' + String(l.num_lote).padStart(2, '0'), { permanent: true, direction: 'center', className: 'etq-lote' })
        .on('click', () => { if (S.modoGeom) return; navegar(() => abrirLote(l.id)); })
        .addTo(capaLotes);
    });
    const elementos = S.elementos.lineas.map((e) => Object.assign({ geometria: 'linea' }, e))
      .concat(S.elementos.puntos.map((e) => Object.assign({ geometria: 'punto' }, e)));
    elementos.forEach((e) => {
      if (!e.geojson) return;
      const sel = S.elemento && S.elemento.id === e.id;
      if (editandoCapa === 'elemento' && sel) return;
      const color = colorElemento(e);
      const capa = L.geoJSON(e.geojson, {
        style: { color: sel ? AMARILLO : color, weight: sel ? 6 : 3.5,
          dashArray: e.grupo === 'Vial' ? '8 5' : (e.permanencia === 'Intermitente' ? '3 5' : null) },
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: sel ? 9 : 7, color: sel ? AMARILLO : '#fff',
          weight: 2, fillColor: color, fillOpacity: 1 })
      })
        .bindTooltip(`${esc(e.tipo)}${e.nombre ? ' · ' + esc(e.nombre) : ''}`, { sticky: true })
        .on('click', (ev) => { if (S.modoGeom) return; L.DomEvent.stop(ev); navegar(() => abrirElemento(e.geometria, e.id)); });
      capa.addTo(capaElementos);
    });
    if (ajustar) {
      if (S.predio && sinLimite(S.predio) && S.predio.latitud != null) map.setView([S.predio.latitud, S.predio.longitud], 17);
      else if (capaPredio.getLayers().length) map.fitBounds(capaPredio.getBounds(), { padding: [30, 30], maxZoom: 18 });
      else if (capaLotes.getLayers().length) map.fitBounds(capaLotes.getBounds(), { padding: [30, 30], maxZoom: 18 });
      else if (S.predio && S.predio.latitud) map.setView([S.predio.latitud, S.predio.longitud], 16);
    }
  }

  // ---------- Barra flotante de edición geométrica
  function barra(texto, botones) {
    const b = $('#mapaBarra');
    b.innerHTML = `<p>${texto}</p>`;
    botones.forEach(([etq, fn, clase]) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-peq ' + (clase || 'btn-borde');
      btn.textContent = etq;
      btn.addEventListener('click', fn);
      b.appendChild(btn);
    });
    b.hidden = false;
  }
  function cerrarBarra() { $('#mapaBarra').hidden = true; }

  function dibujarPendientes() {
    const est = { color: AMARILLO, weight: 3, dashArray: '6 4' };
    if (S.geomLoteNueva) L.geoJSON(S.geomLoteNueva, { style: est }).addTo(capaEdicion);
    if (S.geomElementoNueva) {
      L.geoJSON(S.geomElementoNueva, { style: est,
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 8, color: AMARILLO, weight: 3, fillOpacity: .3 }) }).addTo(capaEdicion);
    }
  }

  function cancelarGeometria() {
    if (S.modoGeom && S.modoGeom.tipo === 'medir') detenerMedida();
    if (map.pm) {
      map.pm.disableDraw();
      capaEdicion.eachLayer((l) => l.pm && l.pm.disable());
    }
    capaEdicion.clearLayers();
    S.modoGeom = null;
    cerrarBarra();
    dibujarSeleccion(false);
    dibujarPendientes();
  }

  function dibujar(tipo) {
    if (!map.pm) return aviso('La herramienta de dibujo no está disponible.', true);
    cancelarGeometria();
    borrarMedida();
    S.modoGeom = { tipo, accion: 'dibujar' };
    const estilo = {
      templineStyle: { color: AMARILLO }, hintlineStyle: { color: AMARILLO, dashArray: [5, 5] },
      pathOptions: { color: AMARILLO, weight: 3, fillOpacity: 0.15 }
    };
    if (tipo === 'elemento-linea') {
      barra('Marque los puntos de la <b>línea</b> (vía, río, quebrada, cerca…). Termine con clic en el último punto. ' +
        'Lo que quede fuera del predio se recorta.', [
        ['Terminar', () => { try { map.pm.Draw.Line._finishShape(); } catch (e) { /* nada */ } }, 'btn-primario'],
        ['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('Line', estilo);
    } else if (tipo === 'elemento-punto') {
      barra('Haga clic en el sitio del <b>punto</b> (nacimiento, captación, vivienda…), dentro del predio.',
        [['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('CircleMarker', { pathOptions: { color: AMARILLO, radius: 8 } });
    } else {
      barra(tipo === 'predio'
        ? 'Marque los vértices del <b>límite del predio</b>. Termine haciendo clic en el primer punto.'
        : 'Dibuje el lote <b>dentro del predio</b>. Termine haciendo clic en el primer punto.',
      [['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('Polygon', estilo);
    }
    if (tipo === 'predio' && S.predio && S.predio.latitud != null) map.setView([S.predio.latitud, S.predio.longitud], Math.max(map.getZoom(), 17));
    else if (tipo !== 'predio' && capaPredio.getLayers().length) map.fitBounds(capaPredio.getBounds(), { padding: [30, 30] });
  }

  async function alTerminarDibujo(e) {
    const modo = S.modoGeom;
    const geo = e.layer.toGeoJSON().geometry;
    map.removeLayer(e.layer);
    S.modoGeom = null;
    cerrarBarra();
    if (map.pm) map.pm.disableDraw();
    if (!modo) return;
    if (modo.tipo === 'predio') {
      await guardarForma('predio', geo);
    } else if (modo.tipo === 'lote-existente') {
      await guardarForma('lote', geo);
    } else if (modo.tipo === 'elemento-linea' || modo.tipo === 'elemento-punto') {
      prepararElementoNuevo(modo.tipo === 'elemento-linea' ? 'linea' : 'punto', geo);
    } else {
      prepararLoteNuevo(geo);
    }
  }

  function prepararLoteNuevo(geo) {
    S.geomLoteNueva = geo;
    S.geomElementoNueva = null;
    capaEdicion.clearLayers();
    dibujarPendientes();
    S.lote = { predio_id: S.predio.id };
    S.editando = 'lote';
    S.tab = 'lotes';
    render();
    aviso('Polígono listo. Complete los datos del lote y pulse Guardar.');
  }

  function prepararElementoNuevo(geometria, geo) {
    S.geomElementoNueva = geo;
    S.geomLoteNueva = null;
    capaEdicion.clearLayers();
    dibujarPendientes();
    S.elemento = { predio_id: S.predio.id, geometria };
    if (geometria === 'linea') S.elemento.longitud_m = window.SIP_GEO ? window.SIP_GEO.longitudM(geo) : null;
    else { S.elemento.latitud = geo.coordinates[1]; S.elemento.longitud = geo.coordinates[0]; }
    S.editando = 'elemento';
    S.tab = 'elementos';
    render();
    aviso(geometria === 'linea' ? 'Línea lista. Elija el tipo y pulse Guardar.' : 'Punto listo. Elija el tipo y pulse Guardar.');
  }

  function registroDe(tipo) {
    return tipo === 'predio' ? S.predio : (tipo === 'lote' ? S.lote : S.elemento);
  }

  function editarForma(tipo) {
    if (!map.pm) return;
    const reg = registroDe(tipo);
    if (!reg || !reg.geojson) return;
    cancelarGeometria();
    borrarMedida();
    S.modoGeom = { tipo, accion: 'editar', capa: tipo };
    dibujarSeleccion(false);
    const capa = L.geoJSON(reg.geojson, {
      style: { color: AMARILLO, weight: 3, fillOpacity: 0.15 },
      pointToLayer: (f, ll) => L.marker(ll, { draggable: true })
    }).addTo(capaEdicion);
    capa.eachLayer((l) => { if (!(l instanceof L.Marker)) l.pm.enable({ allowSelfIntersection: false, snappable: true }); });
    if (reg.geojson.type === 'Point') map.setView(capa.getLayers()[0].getLatLng(), Math.max(map.getZoom(), 17));
    else map.fitBounds(capa.getBounds(), { padding: [30, 30], maxZoom: 18 });
    barra(reg.geojson.type === 'Point' ? 'Arrastre el punto al sitio correcto.' : 'Arrastre los vértices para ajustar la forma.', [
      ['Guardar forma', async () => {
        const geo = capa.toGeoJSON().features[0].geometry;
        await guardarForma(tipo, geo);
      }, 'btn-primario'],
      ['Cancelar', cancelarGeometria]
    ]);
  }

  async function guardarForma(tipo, geo) {
    try {
      if (tipo === 'predio') {
        await api.guardarPredio({ id: S.predio.id }, geo);
        cancelarGeometria();
        await recargarPredio(S.predio.id);
        aviso(`Límite del predio guardado. Área SIG: ${num(S.predio.area_sig_ha, 2)} ha`);
        avisoArea(S.predio, 'Predio ' + S.predio.cod_predio);
      } else if (tipo === 'lote') {
        await api.guardarLote({ id: S.lote.id }, geo);
        cancelarGeometria();
        await recargarLotes(S.lote.id);
        aviso(`Forma del lote guardada. Área SIG: ${num(S.lote.area_sig_ha, 2)} ha`);
        avisoArea(S.lote, 'Lote ' + S.lote.cod_lote);
      } else {
        await api.guardarElemento(S.elemento.geometria, { id: S.elemento.id }, geo);
        cancelarGeometria();
        await recargarElementos(S.elemento.geometria, S.elemento.id);
        aviso('Ubicación del elemento guardada.');
      }
      cargarMapaGeneral(false);
    } catch (e) {
      aviso(e.message, true);
    }
  }

  // ======================================================================
  //  MEDICIÓN (no guarda nada)
  // ======================================================================
  const M = { modo: null, puntos: [], cursor: null };

  // Coordenada plana Origen Nacional (EPSG:9377) de un registro con latitud/longitud
  function en9377(r, i) {
    const c = r && window.SIP_GEO ? window.SIP_GEO.a9377(r.longitud, r.latitud) : null;
    return c ? c[i] : null;
  }
  // Medidas planas en Origen Nacional (9377), como las calcula la base de datos
  function distancia(a, b) {
    const d = window.SIP_GEO && window.SIP_GEO.dist9377([a.lng, a.lat], [b.lng, b.lat]);
    return d != null ? d : map.distance(a, b);
  }
  function areaGeodesica(lls) {
    const a9 = window.SIP_GEO && window.SIP_GEO.areaAnillo9377(lls.map((p) => [p.lng, p.lat]));
    if (a9 != null) return a9;
    const R = 6378137, d = Math.PI / 180;
    let a = 0;
    for (let i = 0; i < lls.length; i++) {
      const p1 = lls[i], p2 = lls[(i + 1) % lls.length];
      a += (p2.lng - p1.lng) * d * (2 + Math.sin(p1.lat * d) + Math.sin(p2.lat * d));
    }
    return Math.abs(a * R * R / 2);
  }
  const fmtLong = (m) => m >= 1000 ? `${num(m / 1000, 3)} km` : `${num(m, 1)} m`;
  const fmtArea = (m2) => `${num(m2, 0)} m² · ${num(m2 / 10000, 4)} ha`;

  function medir(modo) {
    if (S.modoGeom && S.modoGeom.tipo !== 'medir') {
      if (!confirm('Hay un dibujo en curso. ¿Desea cancelarlo para medir?')) return;
    }
    cancelarGeometria();
    borrarMedida();
    S.modoGeom = { tipo: 'medir' };
    M.modo = modo; M.puntos = []; M.cursor = null;
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('midiendo');
    map.on('click', clicMedida);
    map.on('mousemove', moverMedida);
    map.on('dblclick', terminarMedida);
    barra(`<b>${modo === 'linea' ? 'Medir distancia' : 'Medir área'}</b> · haga clic en el mapa para marcar puntos; ` +
      'doble clic o “Terminar” para cerrar. Medidas en Origen Nacional (EPSG:9377).<br><span id="medidaTxt" class="medida-txt">—</span>', [
      ['Deshacer punto', () => { M.puntos.pop(); pintarMedida(); }],
      ['Terminar', terminarMedida, 'btn-primario'],
      ['Borrar', () => { cancelarGeometria(); borrarMedida(); }]
    ]);
  }

  function clicMedida(e) {
    const ult = M.puntos[M.puntos.length - 1];
    if (ult && map.latLngToContainerPoint(ult).distanceTo(e.containerPoint) < 4) return;   // doble clic
    M.puntos.push(e.latlng);
    pintarMedida();
  }
  function moverMedida(e) { M.cursor = e.latlng; if (M.puntos.length) pintarMedida(); }

  function textoMedida(pts) {
    if (M.modo === 'linea') {
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += distancia(pts[i - 1], pts[i]);
      const tramo = pts.length > 1 ? distancia(pts[pts.length - 2], pts[pts.length - 1]) : 0;
      return `Distancia: <b>${fmtLong(total)}</b>${pts.length > 2 ? ` · último tramo ${fmtLong(tramo)}` : ''} · ${pts.length} puntos`;
    }
    let per = 0;
    for (let i = 0; i < pts.length; i++) per += distancia(pts[i], pts[(i + 1) % pts.length]);
    return pts.length < 3 ? 'Marque al menos tres puntos.'
      : `Área: <b>${fmtArea(areaGeodesica(pts))}</b> · Perímetro: ${fmtLong(per)}`;
  }

  function pintarMedida(final) {
    capaMedida.clearLayers();
    const pts = M.puntos.slice();
    if (!final && M.cursor && pts.length) pts.push(M.cursor);
    const est = { pane: 'medida', interactive: false, color: '#ff2d55', weight: 3, dashArray: final ? null : '6 4', fillColor: '#ff2d55', fillOpacity: .15 };
    if (pts.length > 1) {
      if (M.modo === 'area' && pts.length > 2) L.polygon(pts, est).addTo(capaMedida);
      else L.polyline(pts, est).addTo(capaMedida);
    }
    M.puntos.forEach((p) => L.circleMarker(p, { pane: 'medida', radius: 4, color: '#fff', weight: 2, fillColor: '#ff2d55', fillOpacity: 1, interactive: false }).addTo(capaMedida));
    if (M.modo === 'linea') {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        L.tooltip({ permanent: true, direction: 'center', className: 'etq-medida', interactive: false })
          .setLatLng([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]).setContent(fmtLong(distancia(a, b))).addTo(capaMedida);
      }
    }
    const t = $('#medidaTxt');
    if (t) t.innerHTML = pts.length ? textoMedida(pts) : '—';
    return pts;
  }

  function detenerMedida() {
    map.off('click', clicMedida);
    map.off('mousemove', moverMedida);
    map.off('dblclick', terminarMedida);
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove('midiendo');
  }

  function terminarMedida() {
    detenerMedida();
    S.modoGeom = null;
    const pts = pintarMedida(true);
    const modo = M.modo;
    barra(`<b>Medición</b> (no se guarda): ${pts.length > 1 ? textoMedida(pts) : 'sin puntos'}`, [
      ['Nueva medición', () => medir(modo), 'btn-primario'],
      ['Borrar', () => { borrarMedida(); cerrarBarra(); }]
    ]);
  }

  function borrarMedida() { capaMedida.clearLayers(); M.puntos = []; M.cursor = null; }

  // ======================================================================
  //  ARCHIVOS LOCALES (capas de referencia; no se guardan)
  // ======================================================================
  const TM_MAGNA = (lon0) => `+proj=tmerc +lat_0=4.596200416666666 +lon_0=${lon0} +k=1 +x_0=1000000 +y_0=1000000 ` +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  const SRC_COLOMBIA = {
    9377: ['MAGNA-SIRGAS Origen Nacional', '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'],
    3114: ['MAGNA Colombia Oeste Oeste', TM_MAGNA(-80.0775079166667)],
    3115: ['MAGNA Colombia Oeste', TM_MAGNA(-77.0775079166667)],
    3116: ['MAGNA Colombia Bogotá', TM_MAGNA(-74.0775079166667)],
    3117: ['MAGNA Colombia Este Central', TM_MAGNA(-71.0775079166667)],
    3118: ['MAGNA Colombia Este', TM_MAGNA(-68.0775079166667)]
  };
  function definirSRC() {
    if (!window.proj4) return;
    Object.entries(SRC_COLOMBIA).forEach(([cod, [, def]]) => window.proj4.defs('EPSG:' + cod, def));
    window.proj4.defs('EPSG:4686', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs');
  }

  function recorrerCoords(c, fn) {
    if (typeof c[0] === 'number') return fn(c);
    return c.map((x) => recorrerCoords(x, fn));
  }
  function geometrias(gj, fn) {
    gj.features.forEach((f) => {
      const g = f.geometry;
      if (!g) return;
      if (g.type === 'GeometryCollection') g.geometries.forEach(fn); else fn(g);
    });
  }
  function esProyectado(gj) {
    let si = false;
    geometrias(gj, (g) => recorrerCoords(g.coordinates, (p) => { if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) si = true; return p; }));
    return si;
  }
  function reproyectar(gj, epsg) {
    if (!window.proj4) throw new Error('No se pudo cargar la librería de reproyección.');
    const tr = window.proj4('EPSG:' + epsg, 'EPSG:4326');
    geometrias(gj, (g) => { g.coordinates = recorrerCoords(g.coordinates, (p) => tr.forward([p[0], p[1]])); });
    return gj;
  }
  function epsgDeGeoJSON(gj) {
    const n = gj && gj.crs && gj.crs.properties && gj.crs.properties.name;
    const m = n && String(n).match(/(\d{4,5})\s*$/);
    return m ? Number(m[1]) : null;
  }
  function primerX(gj) {
    let x = null;
    geometrias(gj, (g) => recorrerCoords(g.coordinates, (p) => { if (x === null) x = p[0]; return p; }));
    return x;
  }
  function aColeccion(r) {
    if (Array.isArray(r)) return { type: 'FeatureCollection', features: r.flatMap((x) => aColeccion(x).features) };
    if (!r) return { type: 'FeatureCollection', features: [] };
    if (r.type === 'FeatureCollection') return r;
    if (r.type === 'Feature') return { type: 'FeatureCollection', features: [r] };
    if (r.type) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: r }] };
    return { type: 'FeatureCollection', features: [] };
  }
  const xml = (t) => new DOMParser().parseFromString(t, 'text/xml');

  async function leerArchivo(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let gj, epsg = null;
    if (ext === 'zip') {
      if (!window.shp) throw new Error('No se pudo cargar el lector de Shapefile.');
      gj = aColeccion(await window.shp(await file.arrayBuffer()));
    } else if (ext === 'kml') {
      gj = aColeccion(window.toGeoJSON.kml(xml(await file.text())));
    } else if (ext === 'kmz') {
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      const k = Object.keys(zip.files).find((n) => /\.kml$/i.test(n));
      if (!k) throw new Error('El KMZ no contiene un archivo KML.');
      gj = aColeccion(window.toGeoJSON.kml(xml(await zip.file(k).async('string'))));
    } else if (ext === 'gpx') {
      gj = aColeccion(window.toGeoJSON.gpx(xml(await file.text())));
    } else if (ext === 'geojson' || ext === 'json') {
      const crudo = JSON.parse(await file.text());
      epsg = epsgDeGeoJSON(crudo);
      gj = aColeccion(crudo);
    } else if (['shp', 'dbf', 'shx', 'prj'].includes(ext)) {
      throw new Error('Para Shapefile comprima en un solo .zip los archivos .shp, .shx, .dbf y .prj.');
    } else {
      throw new Error('Formato no reconocido. Use .zip (Shapefile), .kml, .kmz, .geojson o .gpx.');
    }
    gj.features = gj.features.filter((f) => f && f.geometry);
    if (!gj.features.length) throw new Error('El archivo no tiene geometrías.');

    if (epsg && epsg !== 4326 && epsg !== 4686 && esProyectado(gj)) {
      if (!SRC_COLOMBIA[epsg]) throw new Error(`Sistema de referencia EPSG:${epsg} no soportado. Exporte en 4326 o MAGNA (9377, 3114-3118).`);
      reproyectar(gj, epsg);
    } else if (esProyectado(gj)) {
      // Coordenadas planas sin sistema conocido (p. ej. shapefile sin .prj)
      const sugerido = primerX(gj) > 3000000 ? '9377' : '3116';
      const lista = Object.entries(SRC_COLOMBIA).map(([c, [n]]) => `${c} = ${n}`).join('\n');
      const r = prompt('El archivo tiene coordenadas planas sin sistema de referencia.\nEscriba el código EPSG:\n' + lista, sugerido);
      if (!r) throw new Error('Carga cancelada.');
      if (!SRC_COLOMBIA[Number(r)]) throw new Error('Código EPSG no válido.');
      reproyectar(gj, Number(r));
    }
    return gj;
  }

  const ESTILO_REF = { color: '#ff3fd0', weight: 2.5, fillColor: '#ff3fd0', fillOpacity: .08 };

  async function cargarArchivos(files) {
    for (const file of files) {
      try {
        const gj = await leerArchivo(file);
        const idx = S.refs.length;
        const capa = L.geoJSON(gj, {
          pane: 'refs',
          style: ESTILO_REF,
          pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'refs', radius: 6, color: '#fff', weight: 2, fillColor: '#ff3fd0', fillOpacity: 1 }),
          onEachFeature: (f, lyr) => {
            lyr.on('click', (e) => {
              if (S.modoGeom) return;
              L.DomEvent.stop(e);
              L.popup({ maxWidth: 320 }).setLatLng(e.latlng)
                .setContent(popupRef(idx, gj.features.indexOf(f))).openOn(map);
            });
          }
        }).addTo(capaRefs);
        S.refs.push({ nombre: file.name, capa, gj, visible: true });
        renderRefs();
        if (capa.getBounds().isValid()) map.fitBounds(capa.getBounds(), { padding: [30, 30], maxZoom: 18 });
        aviso(`${file.name}: ${gj.features.length} elemento(s) cargado(s) como referencia. Haga clic sobre uno para usarlo.`);
      } catch (e) {
        aviso(`${file.name}: ${e.message}`, true);
      }
    }
  }

  function tipoGeom(g) {
    if (!g) return null;
    if (/Polygon/.test(g.type)) return 'poligono';
    if (/LineString/.test(g.type)) return 'linea';
    if (/Point/.test(g.type)) return 'punto';
    return null;
  }

  function popupRef(i, j) {
    const f = S.refs[i].gj.features[j];
    const props = Object.entries(f.properties || {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').slice(0, 8);
    const t = tipoGeom(f.geometry);
    const hayPredio = S.predio && S.predio.id;
    const puede = hayPredio && puedeEditar(S.predio);
    const b = (uso, txt) => `<button class="btn btn-peq btn-borde" data-accion="usar-archivo" data-uso="${uso}" data-ref="${i}" data-f="${j}">${txt}</button>`;
    let acciones = '';
    if (!hayPredio) acciones = '<p class="sin-datos">Abra un predio para usar esta forma.</p>';
    else if (t === 'poligono') {
      acciones = (puede ? b('predio', 'Usar como límite del predio') : '') +
        (S.predio.geojson ? b('lote', 'Crear lote con esta forma') : '');
    } else if (t === 'linea' || t === 'punto') {
      acciones = S.predio.geojson && S.cat.tiposElemento.length ? b('elemento', `Guardar como elemento (${t === 'linea' ? 'línea' : 'punto'})`)
        : '<p class="sin-datos">El predio necesita límite para agregar elementos.</p>';
    }
    let medida = '';
    if (t === 'poligono' && window.SIP_GEO) medida = `${num(window.SIP_GEO.areaHa(f.geometry), 4)} ha`;
    else if (t === 'linea' && window.SIP_GEO) medida = fmtLong(window.SIP_GEO.longitudM(f.geometry));
    return `<div class="popup-ref"><b>${esc(S.refs[i].nombre)}</b>${medida ? ` · ${medida}` : ''}
      ${props.length ? `<table>${props.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      <div class="acciones">${acciones}</div></div>`;
  }

  function renderRefs() {
    const el = $('#refsPanel');
    if (!el) return;
    el.hidden = !S.refs.some(Boolean);
    el.innerHTML = '<div class="refs-tit">Capas cargadas (no se guardan)</div>' + S.refs.map((r, i) => r ? `
      <div class="refs-fila">
        <label><input type="checkbox" data-ref-ver="${i}"${r.visible ? ' checked' : ''}> ${esc(r.nombre)}</label>
        <button title="Acercar" data-ref-zoom="${i}">🔍</button><button title="Quitar" data-ref-quitar="${i}">✕</button>
      </div>` : '').join('');
  }

  function usarArchivo(btn) {
    const f = S.refs[+btn.dataset.ref].gj.features[+btn.dataset.f];
    let g = JSON.parse(JSON.stringify(f.geometry));
    g.coordinates = recorrerCoords(g.coordinates, (p) => [p[0], p[1]]);   // sin altura (KML/GPX)
    map.closePopup();
    const uso = btn.dataset.uso;
    if (S.editando) return aviso('Guarde o cancele la edición antes de usar la forma.', true);
    if (uso === 'predio') {
      if (S.predio.geojson && !confirm(`¿Reemplazar el límite actual del predio ${S.predio.cod_predio} con esta forma?`)) return;
      guardarForma('predio', g);
    } else if (uso === 'lote') {
      prepararLoteNuevo(g);
    } else {
      if (g.type === 'MultiPoint') g = { type: 'Point', coordinates: g.coordinates[0] };
      prepararElementoNuevo(tipoGeom(g) === 'linea' ? 'linea' : 'punto', g);
    }
  }

  // ======================================================================
  //  DISEÑO: panel plegable, divisor arrastrable, mapa completo
  // ======================================================================
  function alternarPanel() {
    const c = $('.cuerpo');
    c.classList.toggle('sin-izq');
    grabar('sip_sin_izq', c.classList.contains('sin-izq') ? '1' : '0');
    setTimeout(() => map.invalidateSize(), 220);
  }
  function alternarMapaCompleto() {
    const c = $('.cuerpo');
    c.classList.toggle('mapa-completo');
    setTimeout(() => map.invalidateSize(), 220);
  }
  function iniciarDiseno() {
    const c = $('.cuerpo');
    if (leer('sip_sin_izq') === '1') c.classList.add('sin-izq');
    const ancho = Number(leer('sip_ancho_mapa'));
    if (ancho > 200) c.style.setProperty('--mapa', ancho + 'px');
    const div = $('#divisor');
    let arrastrando = false;
    div.addEventListener('pointerdown', (e) => {
      arrastrando = true; div.setPointerCapture(e.pointerId); c.classList.add('arrastrando');
    });
    div.addEventListener('pointermove', (e) => {
      if (!arrastrando) return;
      const r = c.getBoundingClientRect();
      const izq = $('.panel-izq').getBoundingClientRect().width;
      const w = Math.max(260, Math.min(r.right - e.clientX, r.width - izq - 330));
      c.style.setProperty('--mapa', w + 'px');
      map.invalidateSize();
    });
    const soltar = () => {
      if (!arrastrando) return;
      arrastrando = false; c.classList.remove('arrastrando');
      const w = parseInt(getComputedStyle(c).getPropertyValue('--mapa'), 10);
      if (w) grabar('sip_ancho_mapa', String(w));
      map.invalidateSize();
    };
    div.addEventListener('pointerup', soltar);
    div.addEventListener('pointercancel', soltar);
    div.addEventListener('dblclick', () => {
      c.style.removeProperty('--mapa'); grabar('sip_ancho_mapa', ''); setTimeout(() => map.invalidateSize(), 50);
    });
  }

  // ======================================================================
  //  NAVEGACIÓN Y CARGA DE DATOS
  // ======================================================================
  function navegar(fn) {
    if (S.editando && !confirm('Hay cambios sin guardar. ¿Desea descartarlos?')) return;
    S.editando = null;
    S.geomLoteNueva = null;
    S.geomElementoNueva = null;
    cancelarGeometria();
    fn();
  }

  async function abrirProductor(id, predioId) {
    try {
      S.productor = await api.productor(id);
      S.predios = await api.prediosDe(id);
      S.predio = null; S.lotes = []; S.lote = null; S.elementos = { lineas: [], puntos: [] }; S.elemento = null;
      $('#resultados').innerHTML = '';
      if (predioId) return abrirPredio(predioId);
      S.tab = 'productor';
      render();
      dibujarSeleccion(false);
    } catch (e) { aviso(e.message, true); }
  }

  async function cargarElementos(predioId) {
    try { return await api.elementosDe(predioId); } catch (e) { return { lineas: [], puntos: [] }; }
  }

  async function abrirPredio(id) {
    try {
      S.predio = S.predios.find((p) => p.id === id) || null;
      if (!S.predio) return;
      await cargarVeredas(S.predio.cod_mpio);
      const [lotes, elementos, carac, ficha] = await Promise.all([api.lotesDe(id), cargarElementos(id),
        api.caracterizacionesDe(id).catch(() => []), api.fichaDe(id).catch(() => null)]);
      S.lotes = lotes; S.elementos = elementos; S.carac = carac; S.ficha = ficha;
      S.lote = null; S.elemento = null;
      S.tab = 'predio';
      render();
      dibujarSeleccion(true);
    } catch (e) { aviso(e.message, true); }
  }

  function abrirLote(id) {
    S.lote = S.lotes.find((l) => l.id === id) || null;
    S.tab = 'lotes';
    render();
    dibujarSeleccion(false);
  }

  function abrirElemento(geometria, id) {
    const lista = geometria === 'linea' ? S.elementos.lineas : S.elementos.puntos;
    const e = lista.find((x) => x.id === id);
    S.elemento = e ? Object.assign({ geometria }, e) : null;
    S.tab = 'elementos';
    render();
    dibujarSeleccion(false);
  }

  async function recargarPredio(id) {
    // Áreas y longitudes antes del cambio, para avisar qué se recortó con el límite nuevo
    const antes = {};
    S.lotes.forEach((l) => { antes['l' + l.id] = [l.cod_lote, Number(l.area_sig_ha)]; });
    S.elementos.lineas.forEach((e) => { antes['e' + e.id] = [e.tipo + (e.nombre ? ' «' + e.nombre + '»' : ''), Number(e.longitud_m)]; });
    S.predios = await api.prediosDe(S.productor.id);
    S.predio = S.predios.find((p) => p.id === id) || null;
    if (S.predio) {
      const [lotes, elementos] = await Promise.all([api.lotesDe(id), cargarElementos(id)]);
      S.lotes = lotes; S.elementos = elementos;   // el límite nuevo recorta lotes y elementos
      if (S.lote) S.lote = S.lotes.find((l) => l.id === S.lote.id) || null;
      const cambio = (k, v) => antes[k] && Math.abs(antes[k][1] - Number(v)) > 0.0001;
      const ajustados = S.lotes.filter((l) => cambio('l' + l.id, l.area_sig_ha)).map((l) => l.cod_lote)
        .concat(S.elementos.lineas.filter((e) => cambio('e' + e.id, e.longitud_m)).map((e) => antes['e' + e.id][0]));
      if (ajustados.length) {
        aviso('Con el límite nuevo se recortó lo que quedaba por fuera del predio: ' + ajustados.join(', ') + '.', 'alerta');
      }
    }
    render();
    dibujarSeleccion(true);
  }

  async function recargarLotes(loteId) {
    S.lotes = await api.lotesDe(S.predio.id);
    S.predios = await api.prediosDe(S.productor.id);
    S.predio = S.predios.find((p) => p.id === S.predio.id) || S.predio;
    S.lote = loteId ? (S.lotes.find((l) => l.id === loteId) || null) : null;
    render();
    dibujarSeleccion(false);
  }

  async function recargarElementos(geometria, id) {
    S.elementos = await cargarElementos(S.predio.id);
    S.elemento = null;
    if (id) {
      const e = (geometria === 'linea' ? S.elementos.lineas : S.elementos.puntos).find((x) => x.id === id);
      if (e) S.elemento = Object.assign({ geometria }, e);
    }
    render();
    dibujarSeleccion(false);
  }

  async function cargarVeredas(codMpio, forzar) {
    if (!codMpio) return [];
    if (!S.veredas[codMpio] || forzar) S.veredas[codMpio] = await api.veredas(codMpio);
    return S.veredas[codMpio];
  }

  // ---------- Permisos
  function puedeEditar(reg) {
    if (api.demo) return true;
    if (!reg || !reg.id) return true;
    if (S.perfil && ['coordinador', 'admin'].includes(S.perfil.rol)) return true;
    return reg.creado_por === (S.user && S.user.id);
  }
  const esAdmin = () => api.demo || (S.perfil && S.perfil.rol === 'admin');
  const esCoordinador = () => api.demo || (S.perfil && ['coordinador', 'admin'].includes(S.perfil.rol));
  const sinLimite = (p) => p && !p.geojson;

  // ======================================================================
  //  RENDER
  // ======================================================================
  function render() {
    renderArbol();
    renderMigas();
    renderPestanas();
    renderContenido();
  }

  function renderArbol() {
    const el = $('#arbol');
    if (!S.productor || !S.productor.id) { el.innerHTML = ''; return; }
    const pr = S.productor;
    const activoProd = S.tab === 'productor' ? ' activo' : '';
    el.innerHTML = `<ul><li>
      <button class="nodo${activoProd}" data-ir="productor"><span class="ico">👤</span>
        <span>${esc(pr.nombres)} ${esc(pr.apellidos || '')}</span><small>${esc(pr.tipo_doc || '')} ${esc(pr.num_doc)}</small></button>
      <ul>${S.predios.map((p) => {
        const abierto = S.predio && S.predio.id === p.id;
        const act = abierto && S.tab === 'predio' ? ' activo' : '';
        const lotes = abierto ? `<ul>${S.lotes.map((l) => {
          const a = S.lote && S.lote.id === l.id && S.tab === 'lotes' ? ' activo' : '';
          return `<li><button class="nodo${a}" data-lote="${esc(l.id)}"><span class="ico">🌱</span>
            <span>L${String(l.num_lote).padStart(2, '0')}${marcaDif(l)}</span><small>${esc(l.cultivo || '')}</small></button></li>`;
        }).join('')}${nodoElementos()}</ul>` : '';
        return `<li><button class="nodo${act}" data-predio="${esc(p.id)}"><span class="ico">🏡</span>
          <span class="cod">${esc(p.cod_predio)}${marcaDif(p)}${sinLimite(p) ? ' <span class="marca-pend" title="Pendiente de delimitar">📍</span>' : ''}</span><small>${esc(p.nombre)}</small></button>${lotes}</li>`;
      }).join('') || '<li class="sin-datos">Sin predios</li>'}</ul>
    </li></ul>`;
  }

  function nodoElementos() {
    const n = S.elementos.lineas.length + S.elementos.puntos.length;
    if (!n) return '';
    const a = S.tab === 'elementos' ? ' activo' : '';
    return `<li><button class="nodo${a}" data-tab="elementos"><span class="ico">💧</span><span>Elementos</span><small>${n}</small></button></li>`;
  }

  function renderMigas() {
    const m = [];
    if (S.productor) m.push(`Productor: <b>${esc(S.productor.id ? (S.productor.nombres + ' ' + (S.productor.apellidos || '')) : 'nuevo')}</b>`);
    if (S.predio) m.push(`Predio: <b>${esc(S.predio.cod_predio || 'nuevo')}</b>`);
    if (S.lote && S.tab === 'lotes') m.push(`Lote: <b>${esc(S.lote.cod_lote || 'nuevo')}</b>`);
    if (S.elemento && S.tab === 'elementos') m.push(`Elemento: <b>${esc(S.elemento.tipo || 'nuevo')}</b>`);
    $('#migas').innerHTML = m.join(' &nbsp;›&nbsp; ');
  }

  function renderPestanas() {
    const el = $('#pestanas');
    if (!S.productor) { el.innerHTML = ''; return; }
    const hayPredio = !!(S.predio && S.predio.id);
    const nEl = S.elementos.lineas.length + S.elementos.puntos.length;
    const t = [
      ['productor', 'Productor', true],
      ['predio', `Predio${S.predios.length ? ' (' + S.predios.length + ')' : ''}`, !!S.productor.id],
      ['lotes', `Lotes${hayPredio ? ' (' + S.lotes.length + ')' : ''}`, hayPredio],
      ['elementos', `Elementos${hayPredio ? ' (' + nEl + ')' : ''}`, hayPredio]
    ];
    el.innerHTML = t.map(([k, txt, hab]) =>
      `<button class="pestana" role="tab" data-tab="${k}" aria-selected="${S.tab === k}"${hab ? '' : ' disabled'}>${txt}</button>`).join('');
  }

  function renderContenido() {
    const el = $('#contenido');
    if (!S.productor) return;
    if (S.tab === 'productor') el.innerHTML = vistaProductor();
    else if (S.tab === 'predio') el.innerHTML = vistaPredio();
    else if (S.tab === 'elementos') el.innerHTML = vistaElementos();
    else el.innerHTML = vistaLotes();
    conectarFormulario();
  }

  // ---------- Formularios genéricos
  // Departamento del registro (por su municipio) o el predeterminado
  function dptoDe(obj) {
    if (obj.cod_dpto) return obj.cod_dpto;
    if (obj.cod_mpio) return String(obj.cod_mpio).slice(0, 2);
    if (S.productor && S.productor.cod_dpto) return S.productor.cod_dpto;   // predio nuevo: el del productor
    return (S.perfil && S.perfil.cod_dpto) || C.DEPARTAMENTO_INICIAL || '';
  }
  // Departamentos que el usuario puede usar: el suyo (técnicos y coordinadores) o todos (administrador).
  // Con «fijo» se limita a ese departamento (el predio va en el departamento de su productor).
  function dptosPermitidos(fijo) {
    const propio = S.perfil && S.perfil.cod_dpto;
    return S.cat.departamentos
      .filter((d) => (fijo ? d.cod_dpto === fijo : (!propio || d.cod_dpto === propio)))
      .map((d) => [d.cod_dpto, d.nombre]);
  }
  function municipiosDe(codDpto) {
    return S.cat.municipios.filter((m) => m.cod_dpto === codDpto).map((m) => [m.cod_mpio, m.nombre]);
  }

  function opciones(c, obj) {
    if (c.op === 'municipios') return municipiosDe(dptoDe(obj));
    if (c.op === 'veredas') return (S.veredas[obj.cod_mpio] || []).map((v) => [v.id, nombreVereda(v)]);
    if (typeof c.op === 'function') return c.op();
    return (c.op || []).map((v) => [v, v]);
  }

  function htmlOpciones(ops, v) {
    const opt = ([val, txt]) =>
      `<option value="${esc(val)}"${String(val) === String(v == null ? '' : v) ? ' selected' : ''}>${esc(txt)}</option>`;
    if (!ops.length || ops[0].length < 3) return ops.map(opt).join('');
    // Opciones agrupadas (cultivo por tipo de cobertura, elemento por grupo)
    const grupos = {};
    ops.forEach((o) => { (grupos[o[2]] = grupos[o[2]] || []).push(o); });
    return Object.keys(grupos).sort((a, b) => ordenGrupo(a) - ordenGrupo(b) || a.localeCompare(b))
      .map((g) => `<optgroup label="${esc(g)}">${grupos[g].map(opt).join('')}</optgroup>`).join('');
  }

  function htmlForm(tipo, obj, editable) {
    return '<div class="form" data-form="' + tipo + '">' + CAMPOS[tipo].map((c) => {
      if (c.solo && obj.geometria !== c.solo) return '';
      const v = c.k === 'cod_dpto' ? dptoDe(obj) : (c.calc ? c.calc(obj) : obj[c.k]);
      const id = `f_${tipo}_${c.k}`;
      const dis = (!editable || c.ro || (c.soloNuevo && obj.id)) ? ' disabled' : '';
      const req = c.req && editable ? ' <span class="req">*</span>' : '';
      let ctl;
      if (c.ro) {
        ctl = `<input id="${id}" type="text" value="${esc(c.fmt ? c.fmt(v) : (v == null ? '—' : v))}" disabled>`;
      } else if (c.t === 'select') {
        let html = `<option value="">—</option>` + htmlOpciones(opciones(c, obj), v);
        if (c.op === 'veredas' && editable) html += '<option value="__nueva">＋ Agregar vereda…</option>';
        ctl = `<select id="${id}" data-k="${c.k}"${dis}>${html}</select>`;
      } else if (c.t === 'textarea') {
        ctl = `<textarea id="${id}" data-k="${c.k}"${dis}>${esc(v)}</textarea>`;
      } else {
        ctl = `<input id="${id}" data-k="${c.k}" type="${c.t || 'text'}"${c.step ? ` step="${c.step}"` : ''}${c.t === 'number' ? ' min="0"' : ''} value="${esc(v)}"${dis}>`;
      }
      return `<div class="campo${c.ancho === 2 ? ' ancho2' : ''}${c.ro ? ' calculado' : ''}">
        <label for="${id}">${esc(c.l)}${req}</label>${ctl}</div>`;
    }).join('') + '</div>';
  }

  function leerForm(tipo) {
    const datos = {};
    CAMPOS[tipo].filter((c) => !c.ro).forEach((c) => {
      const el = $(`#f_${tipo}_${c.k}`);
      if (!el) return;
      let v = el.value.trim();
      if (v === '__nueva') v = '';
      if (c.req && v === '') throw new Error(`El campo "${c.l}" es obligatorio.`);
      if (v === '') v = null;
      else if (c.t === 'number' || c.n) {
        v = Number(v.replace(',', '.'));
        if (Number.isNaN(v)) throw new Error(`El campo "${c.l}" debe ser un número.`);
      }
      if (!c.virtual) datos[c.k] = v;
    });
    return datos;
  }

  function botonesEdicion(tipo, reg) {
    if (S.editando === tipo) {
      return `<button class="btn btn-primario btn-peq" data-accion="guardar" data-tipo="${tipo}">Guardar</button>
              <button class="btn btn-borde btn-peq" data-accion="cancelar" data-tipo="${tipo}">Cancelar</button>`;
    }
    return puedeEditar(reg)
      ? `<button class="btn btn-borde btn-peq" data-accion="editar" data-tipo="${tipo}">Editar</button>`
      : '<span class="chip chip-verde">Solo lectura</span>';
  }

  function avisoDif(r) {
    const pct = difArea(r);
    if (pct === null) return '';
    return `<p class="aviso aviso-area">⚠ El área SIG (${num(r.area_sig_ha, 2)} ha) difiere ${textoDif(pct)} del área declarada
      (${num(r.area_declarada_ha, 2)} ha). Es solo un aviso: revise el dibujo o confirme el dato con el productor.</p>`;
  }

  // ---------- Vistas
  function vistaProductor() {
    const p = S.productor;
    const ed = S.editando === 'productor';
    let html = `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Datos del productor</h2><div class="acciones">${botonesEdicion('productor', p)}</div></div>
      ${htmlForm('productor', p, ed)}
    </div>`;
    if (p.id) {
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>Predios</h2>
          <div class="acciones"><button class="btn btn-acento btn-peq" data-accion="nuevo-predio">＋ Nuevo predio</button></div></div>
        ${S.predios.length ? `<table class="tabla"><thead><tr>
            <th>Código</th><th>Predio</th><th>Municipio</th><th>Vereda</th><th class="num">Área (ha)</th><th class="num">Lotes</th>
          </tr></thead><tbody>${S.predios.map((x) => `<tr data-predio="${esc(x.id)}">
            <td>${esc(x.cod_predio)}${marcaDif(x)}${sinLimite(x) ? ' <span class="marca-pend" title="Pendiente de delimitar">📍</span>' : ''}</td><td>${esc(x.nombre)}</td><td>${esc(x.municipio)}</td><td>${esc(x.vereda || '—')}${x.vereda && x.vereda_validada === false ? ' <small>(por validar)</small>' : ''}</td>
            <td class="num">${num(x.area_sig_ha != null ? x.area_sig_ha : x.area_declarada_ha)}</td><td class="num">${x.n_lotes}</td>
          </tr>`).join('')}</tbody></table>`
          : '<p class="sin-datos">Este productor aún no tiene predios registrados.</p>'}
      </div>`;
    }
    return html;
  }

  function vistaPredio() {
    const p = S.predio;
    if (!p) {
      return `<div class="vacio"><h2>Predios</h2><p>Seleccione un predio en el árbol o registre uno nuevo.</p>
        <button class="btn btn-acento" data-accion="nuevo-predio">＋ Nuevo predio</button></div>`;
    }
    const ed = S.editando === 'predio';
    const areaRef = p.area_sig_ha != null ? p.area_sig_ha : p.area_declarada_ha;
    const exceso = p.area_lotes_ha && areaRef && p.area_lotes_ha > areaRef * 1.001;
    const pct = difArea(p);
    let html = '';
    if (p.id) {
      html += `<div class="resumen">
        <div class="dato"><span>Área declarada</span><b>${num(p.area_declarada_ha)} ha</b></div>
        <div class="dato${pct !== null ? ' alerta-area' : ''}"><span>Área SIG${pct !== null ? ' ⚠ ' + textoDif(pct) : ''}</span><b>${num(p.area_sig_ha)} ha</b></div>
        <div class="dato"><span>Lotes</span><b>${p.n_lotes}</b></div>
        <div class="dato${exceso ? ' alerta' : ''}"><span>Área en lotes</span><b>${num(p.area_lotes_ha)} ha</b></div>
      </div>${avisoDif(p)}`;
    }
    html += `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>${p.id ? 'Predio ' + esc(p.cod_predio) : 'Nuevo predio'}</h2>
        <div class="acciones">${p.id && !ed ? '<button class="btn btn-acento btn-peq" data-accion="ficha">Ficha predial</button>' : ''}${p.id && !ed && S.ficha
          ? `<button class="btn btn-borde btn-peq" data-accion="abrir-ficha" title="Guardada el ${esc(new Date(S.ficha.generado_en).toLocaleString('es-CO'))} (versión ${esc(S.ficha.version)})">📄 Ficha guardada</button>` : ''}${botonesEdicion('predio', p)}</div></div>
      ${htmlForm('predio', p, ed)}
    </div>`;
    if (p.id) {
      const puede = puedeEditar(p);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>Límite del predio</h2><div class="acciones">
          ${p.geojson
            ? `<button class="btn btn-borde btn-peq" data-accion="ver-predio">Ver en el mapa</button>
               ${puede ? '<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="predio">Editar límite</button>' : ''}`
            : (puede ? '<button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="predio">Dibujar límite en el mapa</button>' : '')}
        </div></div>
        <p class="sin-datos">${p.geojson
          ? 'El código, el área SIG y la ubicación se calculan automáticamente a partir del límite.'
          : (p.latitud != null
            ? `<b>Pendiente de delimitar.</b> El punto naranja del mapa es la ubicación GPS de la visita
               (${num(p.latitud, 6)}, ${num(p.longitud, 6)}). Recorra el lindero con el productor y dibújelo,
               o cárguelo desde un archivo (botón de carpeta del mapa).`
            : 'Este predio todavía no tiene límite. Dibújelo en el mapa o cárguelo desde un archivo (botón de carpeta del mapa).')}</p>
      </div>`;
      html += tarjetaCaracterizacion();
      if (p.vereda && p.vereda_validada === false) {
        html += `<p class="aviso">La vereda <b>${esc(p.vereda)}</b> está <b>por validar</b>: la agregó un técnico o viene
          con dudas de la cartografía oficial.${esCoordinador() && !ed
            ? ` <button class="btn btn-borde btn-peq" data-accion="validar-vereda">✓ Validar vereda</button>` : ''}</p>`;
      }
    }
    return html;
  }

  // ---------- Caracterización (encuesta de Kobo) del predio
  const ETQ_KOBO = {
    fecha_visita: 'Fecha de la visita', tecnico: 'Técnico', informante_nombre: 'Responde', informante_relacion: 'Relación',
    personas_hogar: 'Personas en el hogar', mujeres: 'Mujeres', ninos: 'Niños y niñas (<14)', jovenes: 'Jóvenes (14-28)',
    adultos_mayores: 'Adultos mayores', discapacidad: 'Con discapacidad', grupo_diferencial: 'Grupo diferencial',
    mujer_cabeza: 'Jefatura femenina', servicios: 'Servicios', fuente_agua_consumo: 'Agua para consumo',
    infraestructura: 'Infraestructura', acceso_via: 'Acceso vial', area_declarada_ha: 'Área declarada (ha)',
    lineas_productivas: 'Líneas productivas', autoconsumo: 'Autoconsumo', huerta: 'Huerta / pancoger',
    principal_ingreso: 'Principal ingreso', asistencia_tecnica: 'Asistencia técnica', pertenece_asociacion: 'Asociación',
    nombre_asociacion: 'Cuál asociación', tiene_fuentes: 'Fuentes hídricas', tiene_conservacion: 'Áreas de conservación',
    area_conservacion_ha: 'Conservación (ha)', tiene_degradadas: 'Áreas degradadas', tipo_degradacion: 'Tipo de degradación',
    conectividad: 'Conectividad ecológica', determinantes: 'Determinantes ambientales', conflicto_uso: 'Conflicto de uso',
    problematicas: 'Problemáticas', oportunidades: 'Oportunidades', intereses_familia: 'Intereses de la familia',
    observaciones_generales: 'Observaciones', persona_contacto: 'Contacto visita 2', nucleo_zap: 'Núcleo ZAP'
  };
  const RESUMEN_KOBO = ['fecha_visita', 'tecnico', 'personas_hogar', 'mujeres', 'jovenes', 'area_declarada_ha',
    'lineas_productivas', 'principal_ingreso', 'problematicas', 'oportunidades'];
  // Preguntas de selección múltiple: Kobo envía las opciones separadas por espacios
  const MULTIPLE_KOBO = ['grupo_diferencial', 'servicios', 'infraestructura', 'lineas_productivas',
    'tipo_degradacion', 'determinantes'];
  const valorKobo = (v, k) => {
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.length + ' registro(s)';
    const t = String(v);
    if (t === 'si') return 'Sí'; if (t === 'no') return 'No'; if (t === 'ns') return 'No sabe';
    if (MULTIPLE_KOBO.includes(k)) return t.split(/\s+/).map((x) => x.replace(/_/g, ' ')).join(', ');
    return /^[a-z0-9_]+$/.test(t) ? t.replace(/_/g, ' ') : t;   // código de opción → texto
  };
  function tarjetaCaracterizacion() {
    const p = S.predio;
    const lista = S.carac || [];
    if (!lista.length) {
      return `<div class="tarjeta"><div class="tarjeta-cab"><h2>Caracterización (Kobo)</h2></div>
        <p class="sin-datos">${p.cod_humboldt ? 'Aún no ha llegado la encuesta de este predio.'
          : 'Este predio se registró en el portal; no tiene encuesta de Kobo asociada.'}</p></div>`;
    }
    const c = lista[0], d = c.datos || {};
    const usos = Array.isArray(d.usos_suelo) ? d.usos_suelo : [];
    const fila = (k) => `<tr><th>${esc(ETQ_KOBO[k] || k.replace(/_/g, ' '))}</th><td>${esc(valorKobo(d[k], k))}</td></tr>`;
    const todas = Object.keys(d).filter((k) => !k.startsWith('_') && !k.startsWith('formhub') && !['meta', 'instanceID',
      'start', 'end', 'today', 'deviceid', 'username', 'firma_consentimiento', 'documento_confirma'].includes(k));
    return `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Caracterización (Kobo)</h2>
        <span class="chip${c.estado === 'error' ? ' chip-naranja' : ''}">${esc(c.estado)}${lista.length > 1 ? ' · ' + lista.length + ' encuestas' : ''}</span></div>
      ${c.estado === 'error' ? `<p class="aviso">⚠ ${esc(c.error)}</p>` : ''}
      <table class="tabla tabla-ficha"><tbody>${RESUMEN_KOBO.map(fila).join('')}</tbody></table>
      ${usos.length ? `<h3 class="sub">Usos del suelo declarados</h3><table class="tabla"><thead><tr>
          <th>Uso / cobertura</th><th class="num">Área (ha)</th><th>Estado</th></tr></thead><tbody>${usos.map((u) =>
          `<tr><td>${esc(valorKobo(u.tipo_uso))}${u.cultivo_cual ? ': ' + esc(valorKobo(u.cultivo_cual)) : ''}${u.uso_otro ? ' · ' + esc(u.uso_otro) : ''}</td>
           <td class="num">${num(u.area_uso_ha)}</td><td>${esc(valorKobo(u.estado_uso))}</td></tr>`).join('')}</tbody></table>
          <p class="sin-datos">Es lo que declaró la familia; los lotes dibujados son la medición.</p>` : ''}
      <details class="todas"><summary>Ver todas las respuestas</summary>
        <table class="tabla tabla-ficha"><tbody>${todas.map(fila).join('')}</tbody></table></details>
    </div>`;
  }

  function vistaLotes() {
    const p = S.predio;
    if (!p || !p.id) return '<div class="vacio"><p>Primero seleccione un predio.</p></div>';
    const total = S.lotes.reduce((s, l) => s + Number(l.area_sig_ha != null ? l.area_sig_ha : (l.area_declarada_ha || 0)), 0);
    let html = `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Lotes del predio ${esc(p.cod_predio)}</h2>
        <div class="acciones">
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="lote"${p.geojson ? '' : ' disabled title="Primero dibuje el límite del predio"'}>＋ Dibujar lote</button>
          <button class="btn btn-borde btn-peq" data-accion="nuevo-lote">＋ Lote sin dibujo</button>
        </div></div>
      ${S.lotes.length ? `<table class="tabla"><thead><tr>
          <th>Lote</th><th>Cultivo / cobertura</th><th class="num">Área (ha)</th><th class="num">Sitios</th><th class="num">Ocup.</th><th>Estado</th>
        </tr></thead><tbody>${S.lotes.map((l) => `<tr data-lote="${esc(l.id)}"${S.lote && S.lote.id === l.id ? ' class="activo"' : ''}>
          <td><b>L${String(l.num_lote).padStart(2, '0')}</b></td>
          <td><span class="punto-color" style="background:${colorLote(l)}"></span>${esc(l.cultivo || '—')}</td>
          <td class="num">${num(l.area_sig_ha != null ? l.area_sig_ha : l.area_declarada_ha)}${marcaDif(l)}</td>
          <td class="num">${num(l.sitios_estimados, 0)}</td>
          <td class="num">${l.ocupacion_pct == null ? '—' : num(l.ocupacion_pct, 0) + ' %'}</td>
          <td>${esc(l.estado || '—')}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2">Total en lotes / área del predio</td>
          <td class="num" colspan="2">${num(total)} / ${num(p.area_sig_ha != null ? p.area_sig_ha : p.area_declarada_ha)}</td><td colspan="2"></td></tr></tfoot></table>`
        : '<p class="sin-datos">Este predio no tiene lotes. Use “Dibujar lote” para trazarlo dentro del predio.</p>'}
    </div>`;

    const l = S.lote;
    if (l) {
      const ed = S.editando === 'lote';
      const puede = puedeEditar(l);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${l.id ? 'Lote ' + esc(l.cod_lote) : 'Nuevo lote'}</h2>
          <div class="acciones">${botonesEdicion('lote', l)}
            ${l.id && !ed && puede && l.geojson ? '<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="lote">Editar forma</button>' : ''}
            ${l.id && !ed && puede && !l.geojson && p.geojson ? '<button class="btn btn-borde btn-peq" data-accion="dibujar-existente">Dibujar forma</button>' : ''}
            ${l.id && !ed && esAdmin() ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-lote">Eliminar</button>' : ''}
          </div></div>
        ${!l.id && S.geomLoteNueva ? '<p class="aviso">El polígono dibujado se guardará con este lote.</p>' : ''}
        ${l.id ? avisoDif(l) : ''}
        ${htmlForm('lote', l, ed)}
        <p class="nota">Sitios estimados = área SIG ÷ (distancia entre surcos × distancia entre plantas); en tresbolillo se divide
          además por 0,866. % de ocupación = plantas registradas ÷ sitios (ayuda a estimar resiembra).</p>
      </div>`;
    }
    return html;
  }

  function vistaElementos() {
    const p = S.predio;
    if (!p || !p.id) return '<div class="vacio"><p>Primero seleccione un predio.</p></div>';
    const lineas = S.elementos.lineas, puntos = S.elementos.puntos;
    const hayTipos = S.cat.tiposElemento && S.cat.tiposElemento.length;
    const hab = p.geojson && hayTipos && puedeEditar(p);
    const tit = !hayTipos ? ' title="Falta ejecutar sql/09_paquete_octubre.sql en Supabase"'
      : (!p.geojson ? ' title="Primero dibuje el límite del predio"' : '');
    const mHid = lineas.filter((e) => e.grupo === 'Hídrico').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const mVia = lineas.filter((e) => e.grupo === 'Vial').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const nNac = puntos.filter((e) => /Nacimiento/i.test(e.tipo || '')).length;
    const filas = lineas.map((e) => ['linea', e, fmtLong(Number(e.longitud_m || 0))])
      .concat(puntos.map((e) => ['punto', e, 'punto']));
    let html = `<div class="resumen">
        <div class="dato"><span>Cauces (ríos, quebradas, canales)</span><b>${fmtLong(mHid)}</b></div>
        <div class="dato"><span>Vías y caminos</span><b>${fmtLong(mVia)}</b></div>
        <div class="dato"><span>Nacimientos</span><b>${nNac}</b></div>
        <div class="dato"><span>Puntos</span><b>${puntos.length}</b></div>
      </div>
      <div class="tarjeta">
      <div class="tarjeta-cab"><h2>Elementos del predio ${esc(p.cod_predio)}</h2>
        <div class="acciones">
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-linea"${hab ? '' : ' disabled' + tit}>＋ Línea</button>
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-punto"${hab ? '' : ' disabled' + tit}>＋ Punto</button>
        </div></div>
      ${!hayTipos ? '<p class="aviso">Para registrar elementos falta ejecutar <b>sql/09_paquete_octubre.sql</b> en Supabase.</p>' : ''}
      <p class="sin-datos">Líneas: vías, ríos, quebradas, canales, cercas. Puntos: nacimientos, captaciones, reservorios,
        vivienda, beneficiadero… Las líneas se recortan al límite del predio.</p>
      ${filas.length ? `<table class="tabla"><thead><tr>
          <th>Tipo</th><th>Nombre</th><th class="num">Medida</th><th>Permanencia</th><th>Estado</th>
        </tr></thead><tbody>${filas.map(([g, e, medida]) => `<tr data-elemento="${g}:${esc(e.id)}"${S.elemento && S.elemento.id === e.id ? ' class="activo"' : ''}>
          <td><span class="punto-color${g === 'linea' ? ' linea' : ''}" style="background:${colorElemento(e)}"></span>${esc(e.tipo)}</td>
          <td>${esc(e.nombre || '—')}</td><td class="num">${medida}</td>
          <td>${esc(e.permanencia || '—')}</td><td>${esc(e.estado || '—')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="sin-datos">Aún no hay elementos registrados en este predio.</p>'}
    </div>`;

    const e = S.elemento;
    if (e) {
      const ed = S.editando === 'elemento';
      const puede = puedeEditar(e);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${e.id ? esc(e.tipo) + (e.nombre ? ' · ' + esc(e.nombre) : '') : (e.geometria === 'linea' ? 'Nueva línea' : 'Nuevo punto')}</h2>
          <div class="acciones">${botonesEdicion('elemento', e)}
            ${e.id && !ed && puede && e.geojson ? `<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="elemento">${e.geometria === 'linea' ? 'Editar trazo' : 'Mover punto'}</button>` : ''}
            ${e.id && !ed && puede ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-elemento">Eliminar</button>' : ''}
          </div></div>
        ${htmlForm('elemento', e, ed)}
      </div>`;
    }
    return html;
  }

  // ---------- Conexión de controles del formulario en edición
  function conectarFormulario() {
    const dpto = $('#f_predio_cod_dpto');
    const mpio = $('#f_predio_cod_mpio');
    const ver = $('#f_predio_vereda_id');
    // Cascada Departamento → Municipio
    if (dpto && mpio && !dpto.disabled) {
      dpto.addEventListener('change', () => {
        mpio.innerHTML = '<option value="">—</option>' + municipiosDe(dpto.value)
          .map(([val, txt]) => `<option value="${esc(val)}">${esc(txt)}</option>`).join('');
        if (ver) llenarVeredas(ver, '', null);
      });
    }
    if (mpio && ver && !mpio.disabled) {
      mpio.addEventListener('change', async () => {
        try {
          await cargarVeredas(mpio.value);
          llenarVeredas(ver, mpio.value, null);
        } catch (e) { aviso(e.message, true); }
      });
      ver.addEventListener('change', async () => {
        if (ver.value !== '__nueva') return;
        if (!mpio.value) { ver.value = ''; return aviso('Primero seleccione el municipio.', true); }
        const coord = esCoordinador();
        const nombre = (prompt('Nombre de la vereda o comunidad, como la nombra la gente.\n' +
          'Revise antes que no esté en la lista con otra forma de escribirla.' +
          (coord ? '' : '\nQuedará «por validar» hasta que un coordinador la revise.')) || '').trim();
        if (!nombre) { ver.value = ''; return; }
        try {
          const v = await api.crearVereda(mpio.value, nombre, coord);
          await cargarVeredas(mpio.value, true);
          llenarVeredas(ver, mpio.value, v.id);
          aviso(coord ? `Vereda "${nombre}" agregada.` : `Vereda "${nombre}" agregada como «por validar».`);
        } catch (e) { ver.value = ''; aviso(e.message, true); }
      });
    }
    // Lote: densidad, sitios y ocupación en vivo mientras se edita
    if ($('#f_lote_dist_surcos_m') && !$('#f_lote_dist_surcos_m').disabled && window.SIP_GEO) {
      const recalcular = () => {
        const val = (k) => { const el = $('#f_lote_' + k); return el ? el.value.replace(',', '.') : ''; };
        const area = S.lote.area_sig_ha != null ? Number(S.lote.area_sig_ha)
          : (S.geomLoteNueva ? window.SIP_GEO.areaHa(S.geomLoteNueva) : null);
        const r = window.SIP_GEO.siembra({ dist_surcos_m: val('dist_surcos_m'), dist_plantas_m: val('dist_plantas_m'),
          trazado: val('trazado'), num_plantas: val('num_plantas') }, area);
        $('#f_lote_densidad_ha').value = num(r.densidad_ha, 0);
        $('#f_lote_sitios_estimados').value = num(r.sitios_estimados, 0);
        $('#f_lote_ocupacion_pct').value = r.ocupacion_pct == null ? '—' : num(r.ocupacion_pct, 1) + ' %';
      };
      ['dist_surcos_m', 'dist_plantas_m', 'trazado', 'num_plantas'].forEach((k) => {
        const el = $('#f_lote_' + k);
        if (el) { el.addEventListener('input', recalcular); el.addEventListener('change', recalcular); }
      });
      recalcular();
    }
  }

  const nombreVereda = (v) => v.nombre + (v.validada === false ? ' (por validar)' : '');
  function llenarVeredas(sel, codMpio, valor) {
    const lista = S.veredas[codMpio] || [];
    sel.innerHTML = '<option value="">—</option>' +
      lista.map((v) => `<option value="${esc(v.id)}"${v.id === valor ? ' selected' : ''}>${esc(nombreVereda(v))}</option>`).join('') +
      '<option value="__nueva">＋ Agregar vereda…</option>';
  }

  // ======================================================================
  //  ACCIONES
  // ======================================================================
  async function guardar(tipo) {
    try {
      if (tipo === 'productor') {
        const datos = leerForm('productor');
        const id = await api.guardarProductor(Object.assign({ id: S.productor.id }, datos));
        S.editando = null;
        aviso('Productor guardado.');
        await abrirProductor(id);
      } else if (tipo === 'predio') {
        const datos = leerForm('predio');
        datos.productor_id = S.productor.id;
        const id = await api.guardarPredio(Object.assign({ id: S.predio.id }, datos));
        const nuevo = !S.predio.id;
        S.editando = null;
        S.predios = await api.prediosDe(S.productor.id);
        await abrirPredio(id);
        cargarMapaGeneral(false);
        aviso(nuevo ? `Predio creado con código ${S.predio.cod_predio}. Ahora dibuje su límite en el mapa.` : 'Predio guardado.');
        avisoArea(S.predio, 'Predio ' + S.predio.cod_predio);
      } else if (tipo === 'lote') {
        const datos = leerForm('lote');
        datos.predio_id = S.predio.id;
        const nuevo = !S.lote.id;
        const geom = nuevo && S.geomLoteNueva ? S.geomLoteNueva : undefined;
        const id = await api.guardarLote(Object.assign({ id: S.lote.id }, datos), geom);
        S.editando = null;
        S.geomLoteNueva = null;
        capaEdicion.clearLayers();
        await recargarLotes(id);
        cargarMapaGeneral(false);
        aviso(nuevo ? `Lote ${S.lote.cod_lote} creado.` : 'Lote guardado.');
        avisoArea(S.lote, 'Lote ' + S.lote.cod_lote);
      } else if (tipo === 'elemento') {
        const datos = leerForm('elemento');
        datos.predio_id = S.predio.id;
        const nuevo = !S.elemento.id;
        const geometria = S.elemento.geometria;
        const geom = nuevo && S.geomElementoNueva ? S.geomElementoNueva : undefined;
        if (nuevo && !geom) throw new Error('Dibuje el elemento en el mapa.');
        const id = await api.guardarElemento(geometria, Object.assign({ id: S.elemento.id }, datos), geom);
        S.editando = null;
        S.geomElementoNueva = null;
        capaEdicion.clearLayers();
        await recargarElementos(geometria, id);
        aviso(nuevo ? 'Elemento registrado.' : 'Elemento guardado.');
      }
    } catch (e) {
      aviso(e.message, true);
    }
  }

  async function cancelar(tipo) {
    S.editando = null;
    if (tipo === 'productor' && !S.productor.id) { limpiarFicha(); return; }
    if (tipo === 'predio' && !S.predio.id) S.predio = null;
    if (tipo === 'lote' && !S.lote.id) { S.lote = null; S.geomLoteNueva = null; capaEdicion.clearLayers(); }
    if (tipo === 'elemento' && !S.elemento.id) { S.elemento = null; S.geomElementoNueva = null; capaEdicion.clearLayers(); }
    render();
    dibujarSeleccion(false);
  }

  function limpiarFicha() {
    S.productor = null; S.predios = []; S.predio = null; S.lotes = []; S.lote = null; S.tab = null;
    S.elementos = { lineas: [], puntos: [] }; S.elemento = null;
    render();
    $('#contenido').innerHTML = `<div class="vacio"><h2>Bienvenido</h2>
      <p>Busque un productor por cédula, nombre o código de predio, o registre uno nuevo.</p></div>`;
    dibujarSeleccion(false);
  }

  async function accion(btn) {
    const a = btn.dataset.accion, tipo = btn.dataset.tipo;
    if (a === 'editar') {
      if (tipo === 'predio') await cargarVeredas(S.predio.cod_mpio).catch(() => {});
      S.editando = tipo; render();
    } else if (a === 'guardar') {
      btn.disabled = true; await guardar(tipo); btn.disabled = false;
    } else if (a === 'cancelar') {
      cancelar(tipo);
    } else if (a === 'nuevo-predio') {
      navegar(() => {
        S.predio = { productor_id: S.productor.id }; S.lotes = []; S.lote = null;
        S.elementos = { lineas: [], puntos: [] }; S.elemento = null;
        S.tab = 'predio'; S.editando = 'predio'; render(); dibujarSeleccion(false);
      });
    } else if (a === 'nuevo-lote') {
      navegar(() => { S.lote = { predio_id: S.predio.id }; S.tab = 'lotes'; S.editando = 'lote'; render(); });
    } else if (a === 'dibujar') {
      if (tipo !== 'predio' && S.editando) return aviso('Guarde o cancele la edición antes de dibujar.', true);
      dibujar(tipo);
    } else if (a === 'dibujar-existente') {
      // Dibujar la forma de un lote ya registrado que aún no tiene geometría
      if (S.editando) return aviso('Guarde o cancele la edición antes de dibujar.', true);
      dibujar('lote-existente');
    } else if (a === 'editar-forma') {
      if (S.editando) return aviso('Guarde o cancele la edición antes de modificar la forma.', true);
      editarForma(tipo);
    } else if (a === 'ficha') {
      if (!window.SIP_FICHA) return aviso('No se pudo cargar el módulo de fichas.', true);
      window.SIP_FICHA.abrir({
        productor: S.productor, predio: S.predio, lotes: S.lotes, elementos: S.elementos,
        tecnico: S.perfil ? S.perfil.nombre : '',
        logo: logoCache || (C.LOGO ? new URL(C.LOGO, location.href).href : ''),
        colorDe: colorLote, colorElemento, difArea,
        // Botón «Guardar en Sigpredial» de la ficha: sube el PDF y lo deja disponible en Access
        guardar: async (blob) => {
          const predioId = S.predio.id;
          await api.guardarFicha(predioId, blob);
          if (S.predio && S.predio.id === predioId) {
            S.ficha = await api.fichaDe(predioId).catch(() => null);
            if (S.tab === 'predio' && !S.editando) render();
          }
          aviso('Ficha predial guardada en Sigpredial.');
        }
      });
    } else if (a === 'ver-predio') {
      dibujarSeleccion(true);
    } else if (a === 'borrar-lote') {
      if (!confirm(`¿Eliminar el lote ${S.lote.cod_lote}? Esta acción no se puede deshacer.`)) return;
      try { await api.borrarLote(S.lote.id); await recargarLotes(null); cargarMapaGeneral(false); aviso('Lote eliminado.'); }
      catch (e) { aviso(e.message, true); }
    } else if (a === 'borrar-elemento') {
      const e = S.elemento;
      if (!confirm(`¿Eliminar ${e.tipo}${e.nombre ? ' «' + e.nombre + '»' : ''}? Esta acción no se puede deshacer.`)) return;
      try { await api.borrarElemento(e.geometria, e.id); await recargarElementos(e.geometria, null); aviso('Elemento eliminado.'); }
      catch (err) { aviso(err.message, true); }
    } else if (a === 'usar-archivo') {
      usarArchivo(btn);
    } else if (a === 'abrir-ficha') {
      const v = window.open('', '_blank');   // se abre antes de esperar, para que el navegador no la bloquee
      try { const u = await api.urlFicha(S.predio.id); if (v) v.location = u; else window.location = u; }
      catch (e) { if (v) v.close(); aviso(e.message, true); }
    } else if (a === 'reprocesar') {
      try {
        const r = await api.reprocesarEncuesta(btn.dataset.id);
        aviso(r && r.estado === 'procesada' ? 'Encuesta procesada.' : 'Sigue con error: ' + ((r && r.error) || ''), r && r.estado === 'procesada' ? undefined : true);
        await contarErroresKobo(); listarErroresKobo(); cargarMapaGeneral(false);
      } catch (e) { aviso(e.message, true); }
    } else if (a === 'validar-vereda') {
      if (!confirm(`¿Confirmar que la vereda «${S.predio.vereda}» existe con ese nombre en el municipio?`)) return;
      try {
        await api.validarVereda(S.predio.vereda_id);
        await cargarVeredas(S.predio.cod_mpio, true);
        await recargarPredio(S.predio.id);
        aviso('Vereda validada.');
      } catch (e) { aviso(e.message, true); }
    }
  }

  // Logo como imagen incrustada (la ficha se abre en otra ventana y se imprime)
  let logoCache = null;
  async function logoIncrustado() {
    if (!C.LOGO) return '';
    if (logoCache) return logoCache;
    const url = new URL(C.LOGO, location.href).href;
    try {
      const blob = await (await fetch(url)).blob();
      logoCache = await new Promise((ok, mal) => {
        const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(blob);
      });
      return logoCache;
    } catch (e) { return url; }
  }

  // ---------- Búsqueda
  async function buscar(texto) {
    const el = $('#resultados');
    if (!texto.trim()) { el.innerHTML = ''; return; }
    try {
      const r = await api.buscar(texto);
      if (!r.productores.length && !r.predios.length) {
        el.innerHTML = '<p class="sin-datos">Sin resultados.</p>';
        return;
      }
      el.innerHTML =
        (r.productores.length ? '<div class="titulo">Productores</div>' + r.productores.map((p) =>
          `<button class="item" data-productor="${esc(p.id)}"><b>${esc(p.nombres)} ${esc(p.apellidos || '')}</b>
            <small>Documento ${esc(p.num_doc)}</small></button>`).join('') : '') +
        (r.predios.length ? '<div class="titulo">Predios</div>' + r.predios.map((p) =>
          `<button class="item" data-productor="${esc(p.productor_id)}" data-predio-abrir="${esc(p.id)}">
            <b>${esc(p.cod_predio)} · ${esc(p.nombre)}</b><small>${esc(p.productor)}</small></button>`).join('') : '');
    } catch (e) { aviso(e.message, true); }
  }

  // ---------- Predios caracterizados que aún no tienen límite
  function listarPendientes() {
    const el = $('#resultados');
    const lista = (S.mapaPredios || []).filter((p) => !p.geojson)
      .sort((a, b) => String(a.cod_predio).localeCompare(String(b.cod_predio)));
    if (!lista.length) { el.innerHTML = '<p class="sin-datos">No hay predios pendientes de delimitar.</p>'; return; }
    el.innerHTML = '<div class="titulo">Pendientes de delimitar</div>' + lista.map((p) =>
      `<button class="item" data-productor="${esc(p.productor_id)}" data-predio-abrir="${esc(p.id)}">
        <b>📍 ${esc(p.cod_predio)} · ${esc(p.nombre)}</b>
        <small>${esc(p.productor)} · ${esc([p.vereda, p.municipio].filter(Boolean).join(', '))}</small></button>`).join('');
  }

  // ---------- Encuestas de Kobo que no se pudieron procesar (coordinadores y administrador)
  async function contarErroresKobo() {
    const b = $('#btnErroresKobo');
    if (!b || !esCoordinador()) return;
    try {
      S.erroresKobo = await api.encuestasConError();
      b.hidden = !S.erroresKobo.length;
      b.textContent = `⚠ Encuestas Kobo con error (${S.erroresKobo.length})`;
    } catch (e) { b.hidden = true; }
  }
  function listarErroresKobo() {
    const el = $('#resultados');
    const lista = S.erroresKobo || [];
    if (!lista.length) { el.innerHTML = '<p class="sin-datos">No hay encuestas con error.</p>'; return; }
    el.innerHTML = '<div class="titulo">Encuestas Kobo con error</div>' + lista.map((c) =>
      `<div class="item item-error"><b>${esc(c.formulario || 'Formulario')} · ${esc(c.fecha_visita || String(c.recibido_en).slice(0, 10))}</b>
        <small>${esc(c.tecnico || '')}</small><small class="error">${esc(c.error)}</small>
        ${esAdmin() ? `<button class="btn btn-borde btn-peq" data-accion="reprocesar" data-id="${esc(c.id)}">Reprocesar</button>` : ''}</div>`).join('') +
      '<p class="sin-datos">Corrija la causa (por ejemplo, la vereda o el municipio) y pulse «Reprocesar».</p>';
  }

  // ---------- Avisos  (tipo: true = error, 'alerta' = aviso amarillo)
  function aviso(texto, tipo) {
    const t = document.createElement('div');
    t.className = 'toast' + (tipo === true ? ' error' : (tipo === 'alerta' ? ' alerta' : ''));
    t.textContent = texto;
    t.addEventListener('click', () => t.remove());
    const caja = $('#avisos');
    caja.appendChild(t);
    while (caja.children.length > 4) caja.firstElementChild.remove();
    setTimeout(() => t.remove(), tipo ? 9000 : 4000);
  }

  // ======================================================================
  //  INGRESO
  // ======================================================================
  function aplicarLogo() {
    $$('[data-logo]').forEach((el) => {
      if (C.LOGO) el.style.backgroundImage = `url("${C.LOGO}")`;
      else el.classList.add('generico');
    });
  }

  async function arrancar(user) {
    const perfil = await api.perfil(user.id);
    if (!perfil || !perfil.activo) {
      await api.salir();
      throw new Error('Su usuario no está habilitado en el SIP. Pida al administrador que lo registre.');
    }
    S.user = user; S.perfil = perfil;
    $('#usuarioNombre').textContent = perfil.nombre || user.email;
    $('#usuarioRol').textContent = ({ tecnico: 'Técnico', coordinador: 'Coordinador', admin: 'Administrador' }[perfil.rol] || perfil.rol);
    $('#etiquetaDemo').hidden = !api.demo;
    S.cat = await api.catalogos();
    S.cat.tiposElemento = S.cat.tiposElemento || [];
    logoIncrustado();   // se precarga para la ficha predial
    $('#ingreso').hidden = true;
    $('#app').hidden = false;
    map.invalidateSize();
    // Departamento del usuario en la cabecera, vista inicial y capas de referencia
    const dpto = perfil.cod_dpto && S.cat.departamentos.find((d) => d.cod_dpto === perfil.cod_dpto);
    if (dpto) $('#usuarioRol').textContent += ' · ' + dpto.nombre;
    const vista = perfil.cod_dpto && C.VISTA_DEPARTAMENTO && C.VISTA_DEPARTAMENTO[perfil.cod_dpto];
    if (vista) map.setView(vista.centro, vista.zoom);
    agregarLimites();
    await cargarMapaGeneral(true);
    contarErroresKobo();
  }

  function mostrarIngreso() {
    $('#app').hidden = true;
    $('#ingreso').hidden = false;
    $('#ingresoDemo').hidden = !api.demo;
    $('#ingClave').required = !api.demo;
    if (api.demo && !$('#ingCorreo').value) $('#ingCorreo').value = 'demo@biocomerciosostenible.org';
  }

  // ======================================================================
  //  EVENTOS
  // ======================================================================
  function eventos() {
    $('#formIngreso').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#ingresoError');
      err.textContent = '';
      const btn = e.submitter || $('#formIngreso button');
      btn.disabled = true;
      try {
        const user = await api.ingresar($('#ingCorreo').value.trim(), $('#ingClave').value);
        await arrancar(user);
      } catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    });

    $('#btnSalir').addEventListener('click', async () => {
      await api.salir();
      location.reload();
    });
    $('#btnPanel').addEventListener('click', alternarPanel);

    $('#formBuscar').addEventListener('submit', (e) => { e.preventDefault(); buscar($('#txtBuscar').value); });
    $('#btnPendientes').addEventListener('click', listarPendientes);
    $('#btnErroresKobo').addEventListener('click', listarErroresKobo);

    $('#archivoLocal').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await cargarArchivos(files);
    });

    $('#btnNuevoProductor').addEventListener('click', () => navegar(() => {
      S.productor = { cod_dpto: (S.perfil && S.perfil.cod_dpto) || C.DEPARTAMENTO_INICIAL || '' };
      S.predios = []; S.predio = null; S.lotes = []; S.lote = null;
      S.elementos = { lineas: [], puntos: [] }; S.elemento = null;
      S.tab = 'productor'; S.editando = 'productor';
      $('#resultados').innerHTML = '';
      render(); dibujarSeleccion(false);
      const f = $('#f_productor_tipo_doc'); if (f) f.focus();
    }));

    // Panel de capas cargadas
    document.addEventListener('change', (e) => {
      const i = e.target.dataset && e.target.dataset.refVer;
      if (i === undefined) return;
      const r = S.refs[+i];
      r.visible = e.target.checked;
      if (r.visible) r.capa.addTo(capaRefs); else capaRefs.removeLayer(r.capa);
    });

    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-ref-zoom],[data-ref-quitar]');
      if (r) {
        if (r.dataset.refZoom !== undefined) {
          const b = S.refs[+r.dataset.refZoom].capa.getBounds();
          if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
        } else {
          const i = +r.dataset.refQuitar;
          capaRefs.removeLayer(S.refs[i].capa);
          map.closePopup();
          S.refs[i] = null;
          renderRefs();
        }
        return;
      }
      const t = e.target.closest('[data-accion],[data-productor],[data-predio],[data-lote],[data-elemento],[data-ir],[data-tab]');
      if (!t || t.disabled) return;
      if (t.dataset.accion) return accion(t);
      if (t.dataset.productor) return navegar(() => abrirProductor(t.dataset.productor, t.dataset.predioAbrir));
      if (t.dataset.predio) return navegar(() => abrirPredio(t.dataset.predio));
      if (t.dataset.lote) return navegar(() => abrirLote(t.dataset.lote));
      if (t.dataset.elemento) {
        const [g, id] = t.dataset.elemento.split(':');
        return navegar(() => abrirElemento(g, id));
      }
      if (t.dataset.ir === 'productor') return navegar(() => { S.tab = 'productor'; render(); });
      if (t.dataset.tab) {
        return navegar(() => {
          S.tab = t.dataset.tab;
          if (S.tab === 'predio' && !S.predio && S.predios.length === 1) return abrirPredio(S.predios[0].id);
          render();
        });
      }
    });

    // Aviso del navegador al cerrar o recargar la página con trabajo sin guardar
    window.addEventListener('beforeunload', (e) => {
      const dibujando = S.modoGeom && S.modoGeom.tipo !== 'medir';
      if (S.editando || S.geomLoteNueva || S.geomElementoNueva || dibujando) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (S.modoGeom && S.modoGeom.tipo === 'medir') terminarMedida();
      else if ($('.cuerpo').classList.contains('mapa-completo')) alternarMapaCompleto();
    });
  }

  // ======================================================================
  //  INICIO
  // ======================================================================
  async function iniciar() {
    aplicarLogo();
    definirSRC();
    iniciarMapa();
    iniciarDiseno();
    eventos();
    if (api.sinConexion) {
      // La base está configurada pero no cargó la conexión: no se deja entrar
      mostrarIngreso();
      $('#ingresoError').textContent = 'No se pudo conectar con la base de datos de Sigpredial. ' +
        'Revise la conexión a internet y recargue la página. Sin conexión no se puede registrar información.';
      $$('#formIngreso input, #formIngreso button').forEach((el) => { el.disabled = true; });
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-primario btn-bloque'; b.textContent = 'Reintentar';
      b.addEventListener('click', () => location.reload());
      $('#formIngreso').appendChild(b);
      return;
    }
    try {
      const user = await api.sesion();
      if (user) { await arrancar(user); return; }
    } catch (e) { $('#ingresoError').textContent = e.message; }
    mostrarIngreso();
  }

  iniciar();
})();
