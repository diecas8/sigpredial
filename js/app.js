/* =====================================================================
   SIP · CBS — Aplicación
   Estructura tipo SICA:  Productor  →  Predios  →  Lotes
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

  // ---------------------------------------------------------------- Estado
  const S = {
    user: null, perfil: null, cat: { departamentos: [], municipios: [], cultivos: [], tenencias: [] },
    veredas: {},              // caché por municipio
    productor: null, predios: [], predio: null, lotes: [], lote: null,
    tab: null,                // 'productor' | 'predio' | 'lotes'
    editando: null,           // 'productor' | 'predio' | 'lote'
    geomLoteNueva: null,      // polígono dibujado para un lote aún no guardado
    modoGeom: null
  };

  // ------------------------------------------------------- Definición de campos
  const CAMPOS = {
    productor: [
      { k: 'tipo_doc', l: 'Tipo de documento', t: 'select', op: ['CC', 'TI', 'CE', 'PPT', 'NIT', 'Otro'] },
      { k: 'num_doc', l: 'Número de documento', req: true },
      { k: 'nombres', l: 'Nombres', req: true },
      { k: 'apellidos', l: 'Apellidos' },
      { k: 'sexo', l: 'Sexo', t: 'select', op: ['Mujer', 'Hombre', 'Otro'] },
      { k: 'fecha_nac', l: 'Fecha de nacimiento', t: 'date' },
      { k: 'telefono', l: 'Teléfono', t: 'tel' },
      { k: 'correo', l: 'Correo', t: 'email' },
      { k: 'asociacion', l: 'Asociación', ancho: 2 },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ],
    predio: [
      { k: 'cod_predio', l: 'Código del predio', ro: true },
      { k: 'nombre', l: 'Nombre del predio', req: true },
      { k: 'cod_dpto', l: 'Departamento', t: 'select', req: true, virtual: true,
        op: () => S.cat.departamentos.map((d) => [d.cod_dpto, d.nombre]) },
      { k: 'cod_mpio', l: 'Municipio', t: 'select', req: true, op: 'municipios' },
      { k: 'vereda_id', l: 'Vereda', t: 'select', op: 'veredas' },
      { k: 'num_predial', l: 'Número predial' },
      { k: 'matricula', l: 'Matrícula inmobiliaria' },
      { k: 'tenencia_id', l: 'Tenencia', t: 'select', n: true,
        op: () => S.cat.tenencias.map((x) => [x.id, x.nombre]) },
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'altitud_msnm', l: 'Altitud (msnm)', t: 'number', step: '1' },
      { k: 'latitud', l: 'Latitud', ro: true, fmt: (v) => num(v, 6) },
      { k: 'longitud', l: 'Longitud', ro: true, fmt: (v) => num(v, 6) },
      { k: 'como_llegar', l: 'Cómo llegar', t: 'textarea', ancho: 2 }
    ],
    lote: [
      { k: 'cod_lote', l: 'Código del lote', ro: true },
      { k: 'cultivo_id', l: 'Cultivo', t: 'select', req: true, n: true,
        op: () => S.cat.cultivos.map((x) => [x.id, x.nombre]) },
      { k: 'variedad', l: 'Variedad' },
      { k: 'fecha_siembra', l: 'Fecha de siembra', t: 'date' },
      { k: 'edad_meses', l: 'Edad (meses)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'estado', l: 'Estado', t: 'select', op: ['Levante', 'Producción', 'Renovación', 'Zoca', 'Abandonado'] },
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'num_plantas', l: 'Número de plantas', t: 'number', step: '1' },
      { k: 'densidad_ha', l: 'Densidad (plantas/ha)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'dist_surcos_m', l: 'Distancia entre surcos (m)', t: 'number', step: '0.01' },
      { k: 'dist_plantas_m', l: 'Distancia entre plantas (m)', t: 'number', step: '0.01' },
      { k: 'sistema', l: 'Sistema', t: 'select',
        op: ['Libre exposición', 'Semisombra', 'Sombra', 'Agroforestal', 'Silvopastoril', 'Asociado'] },
      { k: 'sombrio', l: 'Tipo de sombrío' },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ]
  };

  // ======================================================================
  //  MAPA
  // ======================================================================
  let map, capaGeneral, capaPredio, capaLotes, capaEdicion, capaUbicacion;

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
    try { const g = localStorage.getItem('sip_mapa_base'); if (g && BASES[g]) baseInicial = g; } catch (e) { /* sin almacenamiento */ }
    BASES[baseInicial].addTo(map);
    map.on('baselayerchange', (e) => { try { localStorage.setItem('sip_mapa_base', e.name); } catch (err) { /* nada */ } });

    window.SIP_MAPA = map;   // útil para depurar desde la consola
    capaGeneral = L.featureGroup().addTo(map);

    // Capas superpuestas que se pueden prender o apagar
    const SUPERPUESTAS = {
      'Todos los predios': capaGeneral,
      'Nombres y límites': etiquetasEsri(),
      'Vías': viasEsri()
    };
    L.control.layers(BASES, SUPERPUESTAS, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    capaPredio = L.featureGroup().addTo(map);
    capaLotes = L.featureGroup().addTo(map);
    capaEdicion = L.featureGroup().addTo(map);
    capaUbicacion = L.featureGroup().addTo(map);

    // Botón "mi ubicación"
    const Ubicar = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar control-mapa');
        div.innerHTML = '<a href="#" title="Mi ubicación" role="button" aria-label="Mi ubicación">⌖</a>';
        L.DomEvent.on(div, 'click', (e) => { L.DomEvent.preventDefault(e); map.locate({ setView: true, maxZoom: 17 }); });
        return div;
      }
    });
    map.addControl(new Ubicar());
    map.on('locationfound', (e) => {
      capaUbicacion.clearLayers();
      L.circle(e.latlng, { radius: e.accuracy, color: '#1f4d1f', weight: 1, fillOpacity: .1 }).addTo(capaUbicacion);
      L.circleMarker(e.latlng, { radius: 6, color: '#fff', weight: 2, fillColor: '#e8a020', fillOpacity: 1 }).addTo(capaUbicacion);
    });
    map.on('locationerror', () => aviso('No fue posible obtener su ubicación.', true));

    if (map.pm) {
      map.pm.setLang('es');
      map.pm.setGlobalOptions({ snappable: true, snapDistance: 15, allowSelfIntersection: false });
      map.on('pm:create', alTerminarDibujo);
    }
  }

  const COLOR_CULTIVO = { 'Café': '#2e6b2e', 'Plátano': '#c9b037', 'Banano': '#c9b037', 'Cacao': '#8b5a2b',
    'Aguacate': '#5f8f2f', 'Cítricos': '#e6a400', 'Caña panelera': '#9cb84a' };
  const colorLote = (l) => COLOR_CULTIVO[l.cultivo] || '#4a8c3f';

  async function cargarMapaGeneral(ajustar) {
    try {
      const lista = await api.prediosMapa();
      capaGeneral.clearLayers();
      lista.forEach((p) => {
        if (!p.geojson) return;
        L.geoJSON(p.geojson, { style: { color: '#e8a020', weight: 1.5, fillOpacity: 0.05, dashArray: '4 3' } })
          .bindTooltip(`${esc(p.cod_predio)} · ${esc(p.nombre)}<br><small>${esc(p.productor)}</small>`, { sticky: true })
          .on('click', () => navegar(() => abrirProductor(p.productor_id, p.id)))
          .addTo(capaGeneral);
      });
      if (ajustar && capaGeneral.getLayers().length) map.fitBounds(capaGeneral.getBounds(), { padding: [20, 20] });
    } catch (e) { aviso(e.message, true); }
  }

  function dibujarSeleccion(ajustar) {
    capaPredio.clearLayers();
    capaLotes.clearLayers();
    if (S.predio && S.predio.geojson && !(S.modoGeom && S.modoGeom.capa === 'predio')) {
      L.geoJSON(S.predio.geojson, { style: { color: '#e8a020', weight: 4, fillColor: '#e8a020', fillOpacity: 0.08 } })
        .bindTooltip(`Predio ${esc(S.predio.cod_predio)}`, { sticky: true })
        .addTo(capaPredio);
    }
    S.lotes.forEach((l) => {
      if (!l.geojson) return;
      if (S.modoGeom && S.modoGeom.capa === 'lote' && S.lote && S.lote.id === l.id) return;
      const sel = S.lote && S.lote.id === l.id;
      L.geoJSON(l.geojson, {
        style: { color: sel ? '#e8a020' : '#ffffff', weight: sel ? 3 : 1.5,
          fillColor: colorLote(l), fillOpacity: sel ? 0.65 : 0.45 }
      })
        .bindTooltip('L' + String(l.num_lote).padStart(2, '0'), { permanent: true, direction: 'center', className: 'etq-lote' })
        .on('click', () => navegar(() => abrirLote(l.id)))
        .addTo(capaLotes);
    });
    if (ajustar) {
      if (capaPredio.getLayers().length) map.fitBounds(capaPredio.getBounds(), { padding: [30, 30], maxZoom: 18 });
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

  function cancelarGeometria() {
    if (map.pm) {
      map.pm.disableDraw();
      capaEdicion.eachLayer((l) => l.pm && l.pm.disable());
    }
    capaEdicion.clearLayers();
    S.modoGeom = null;
    cerrarBarra();
    dibujarSeleccion(false);
    if (S.geomLoteNueva) L.geoJSON(S.geomLoteNueva, { style: { color: '#e8a020', weight: 3, dashArray: '6 4' } }).addTo(capaEdicion);
  }

  function dibujar(tipo) {
    if (!map.pm) return aviso('La herramienta de dibujo no está disponible.', true);
    cancelarGeometria();
    S.modoGeom = { tipo, accion: 'dibujar' };
    barra(tipo === 'predio'
      ? 'Marque los vértices del <b>límite del predio</b>. Termine haciendo clic en el primer punto.'
      : 'Dibuje el lote <b>dentro del predio</b>. Termine haciendo clic en el primer punto.',
    [['Cancelar', cancelarGeometria]]);
    map.pm.enableDraw('Polygon', {
      templineStyle: { color: '#e8a020' }, hintlineStyle: { color: '#e8a020', dashArray: [5, 5] },
      pathOptions: { color: '#e8a020', weight: 3, fillOpacity: 0.15 }
    });
    if (tipo !== 'predio' && capaPredio.getLayers().length) map.fitBounds(capaPredio.getBounds(), { padding: [30, 30] });
  }

  async function alTerminarDibujo(e) {
    const modo = S.modoGeom;
    const geo = e.layer.toGeoJSON().geometry;
    map.removeLayer(e.layer);
    S.modoGeom = null;
    cerrarBarra();
    if (!modo) return;
    if (modo.tipo === 'predio') {
      await guardarForma('predio', geo);
    } else if (modo.tipo === 'lote-existente') {
      await guardarForma('lote', geo);
    } else {
      S.geomLoteNueva = geo;
      capaEdicion.clearLayers();
      L.geoJSON(geo, { style: { color: '#e8a020', weight: 3, dashArray: '6 4' } }).addTo(capaEdicion);
      S.lote = { predio_id: S.predio.id };
      S.editando = 'lote';
      S.tab = 'lotes';
      render();
      aviso('Polígono listo. Complete los datos del lote y pulse Guardar.');
    }
  }

  function editarForma(tipo) {
    if (!map.pm) return;
    const reg = tipo === 'predio' ? S.predio : S.lote;
    if (!reg || !reg.geojson) return;
    cancelarGeometria();
    S.modoGeom = { tipo, accion: 'editar', capa: tipo };
    dibujarSeleccion(false);
    const capa = L.geoJSON(reg.geojson, { style: { color: '#e8a020', weight: 3, fillOpacity: 0.15 } }).addTo(capaEdicion);
    capa.eachLayer((l) => l.pm.enable({ allowSelfIntersection: false, snappable: true }));
    map.fitBounds(capa.getBounds(), { padding: [30, 30], maxZoom: 18 });
    barra('Arrastre los vértices para ajustar la forma.', [
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
      } else {
        await api.guardarLote({ id: S.lote.id }, geo);
        cancelarGeometria();
        await recargarLotes(S.lote.id);
        aviso(`Forma del lote guardada. Área SIG: ${num(S.lote.area_sig_ha, 2)} ha`);
      }
      cargarMapaGeneral(false);
    } catch (e) {
      aviso(e.message, true);
    }
  }

  // ======================================================================
  //  NAVEGACIÓN Y CARGA DE DATOS
  // ======================================================================
  function navegar(fn) {
    if (S.editando && !confirm('Hay cambios sin guardar. ¿Desea descartarlos?')) return;
    S.editando = null;
    S.geomLoteNueva = null;
    cancelarGeometria();
    fn();
  }

  async function abrirProductor(id, predioId) {
    try {
      S.productor = await api.productor(id);
      S.predios = await api.prediosDe(id);
      S.predio = null; S.lotes = []; S.lote = null;
      $('#resultados').innerHTML = '';
      if (predioId) return abrirPredio(predioId);
      S.tab = 'productor';
      render();
      dibujarSeleccion(false);
    } catch (e) { aviso(e.message, true); }
  }

  async function abrirPredio(id) {
    try {
      S.predio = S.predios.find((p) => p.id === id) || null;
      if (!S.predio) return;
      await cargarVeredas(S.predio.cod_mpio);
      S.lotes = await api.lotesDe(id);
      S.lote = null;
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

  async function recargarPredio(id) {
    S.predios = await api.prediosDe(S.productor.id);
    S.predio = S.predios.find((p) => p.id === id) || null;
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
            <span>L${String(l.num_lote).padStart(2, '0')}</span><small>${esc(l.cultivo || '')}</small></button></li>`;
        }).join('')}</ul>` : '';
        return `<li><button class="nodo${act}" data-predio="${esc(p.id)}"><span class="ico">🏡</span>
          <span class="cod">${esc(p.cod_predio)}</span><small>${esc(p.nombre)}</small></button>${lotes}</li>`;
      }).join('') || '<li class="sin-datos">Sin predios</li>'}</ul>
    </li></ul>`;
  }

  function renderMigas() {
    const m = [];
    if (S.productor) m.push(`Productor: <b>${esc(S.productor.id ? (S.productor.nombres + ' ' + (S.productor.apellidos || '')) : 'nuevo')}</b>`);
    if (S.predio) m.push(`Predio: <b>${esc(S.predio.cod_predio || 'nuevo')}</b>`);
    if (S.lote && S.tab === 'lotes') m.push(`Lote: <b>${esc(S.lote.cod_lote || 'nuevo')}</b>`);
    $('#migas').innerHTML = m.join(' &nbsp;›&nbsp; ');
  }

  function renderPestanas() {
    const el = $('#pestanas');
    if (!S.productor) { el.innerHTML = ''; return; }
    const t = [
      ['productor', 'Productor', true],
      ['predio', `Predio${S.predios.length ? ' (' + S.predios.length + ')' : ''}`, !!S.productor.id],
      ['lotes', `Lotes${S.predio && S.predio.id ? ' (' + S.lotes.length + ')' : ''}`, !!(S.predio && S.predio.id)]
    ];
    el.innerHTML = t.map(([k, txt, hab]) =>
      `<button class="pestana" role="tab" data-tab="${k}" aria-selected="${S.tab === k}"${hab ? '' : ' disabled'}>${txt}</button>`).join('');
  }

  function renderContenido() {
    const el = $('#contenido');
    if (!S.productor) return;
    if (S.tab === 'productor') el.innerHTML = vistaProductor();
    else if (S.tab === 'predio') el.innerHTML = vistaPredio();
    else el.innerHTML = vistaLotes();
    conectarFormulario();
  }

  // ---------- Formularios genéricos
  // Departamento del registro (por su municipio) o el predeterminado
  function dptoDe(obj) {
    if (obj.cod_dpto) return obj.cod_dpto;
    if (obj.cod_mpio) return String(obj.cod_mpio).slice(0, 2);
    return C.DEPARTAMENTO_INICIAL || '';
  }
  function municipiosDe(codDpto) {
    return S.cat.municipios.filter((m) => m.cod_dpto === codDpto).map((m) => [m.cod_mpio, m.nombre]);
  }

  function opciones(c, obj) {
    if (c.op === 'municipios') return municipiosDe(dptoDe(obj));
    if (c.op === 'veredas') return (S.veredas[obj.cod_mpio] || []).map((v) => [v.id, v.nombre]);
    if (typeof c.op === 'function') return c.op();
    return (c.op || []).map((v) => [v, v]);
  }

  function htmlForm(tipo, obj, editable) {
    return '<div class="form" data-form="' + tipo + '">' + CAMPOS[tipo].map((c) => {
      const v = c.k === 'cod_dpto' ? dptoDe(obj) : obj[c.k];
      const id = `f_${tipo}_${c.k}`;
      const dis = (!editable || c.ro) ? ' disabled' : '';
      const req = c.req && editable ? ' <span class="req">*</span>' : '';
      let ctl;
      if (c.ro) {
        ctl = `<input id="${id}" type="text" value="${esc(c.fmt ? c.fmt(v) : (v == null ? '—' : v))}" disabled>`;
      } else if (c.t === 'select') {
        const ops = opciones(c, obj);
        let html = `<option value="">—</option>` + ops.map(([val, txt]) =>
          `<option value="${esc(val)}"${String(val) === String(v == null ? '' : v) ? ' selected' : ''}>${esc(txt)}</option>`).join('');
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
            <td>${esc(x.cod_predio)}</td><td>${esc(x.nombre)}</td><td>${esc(x.municipio)}</td><td>${esc(x.vereda || '—')}</td>
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
    let html = '';
    if (p.id) {
      html += `<div class="resumen">
        <div class="dato"><span>Área declarada</span><b>${num(p.area_declarada_ha)} ha</b></div>
        <div class="dato"><span>Área SIG</span><b>${num(p.area_sig_ha)} ha</b></div>
        <div class="dato"><span>Lotes</span><b>${p.n_lotes}</b></div>
        <div class="dato${exceso ? ' alerta' : ''}"><span>Área en lotes</span><b>${num(p.area_lotes_ha)} ha</b></div>
      </div>`;
    }
    html += `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>${p.id ? 'Predio ' + esc(p.cod_predio) : 'Nuevo predio'}</h2>
        <div class="acciones">${p.id && !ed ? '<button class="btn btn-acento btn-peq" data-accion="ficha">Ficha predial</button>' : ''}${botonesEdicion('predio', p)}</div></div>
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
          : 'Este predio todavía no tiene límite dibujado.'}</p>
      </div>`;
    }
    return html;
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
          <th>Lote</th><th>Cultivo</th><th>Variedad</th><th class="num">Área (ha)</th><th class="num">Edad (meses)</th><th>Estado</th>
        </tr></thead><tbody>${S.lotes.map((l) => `<tr data-lote="${esc(l.id)}"${S.lote && S.lote.id === l.id ? ' class="activo"' : ''}>
          <td><b>L${String(l.num_lote).padStart(2, '0')}</b></td><td>${esc(l.cultivo || '—')}</td><td>${esc(l.variedad || '—')}</td>
          <td class="num">${num(l.area_sig_ha != null ? l.area_sig_ha : l.area_declarada_ha)}</td>
          <td class="num">${num(l.edad_meses, 0)}</td><td>${esc(l.estado || '—')}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Total en lotes / área del predio</td>
          <td class="num">${num(total)} / ${num(p.area_sig_ha != null ? p.area_sig_ha : p.area_declarada_ha)}</td><td colspan="2"></td></tr></tfoot></table>`
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
        ${htmlForm('lote', l, ed)}
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
        const nombre = (prompt('Nombre de la nueva vereda:') || '').trim();
        if (!nombre) { ver.value = ''; return; }
        try {
          const v = await api.crearVereda(mpio.value, nombre);
          await cargarVeredas(mpio.value, true);
          llenarVeredas(ver, mpio.value, v.id);
          aviso(`Vereda "${nombre}" agregada.`);
        } catch (e) { ver.value = ''; aviso(e.message, true); }
      });
    }
  }

  function llenarVeredas(sel, codMpio, valor) {
    const lista = S.veredas[codMpio] || [];
    sel.innerHTML = '<option value="">—</option>' +
      lista.map((v) => `<option value="${esc(v.id)}"${v.id === valor ? ' selected' : ''}>${esc(v.nombre)}</option>`).join('') +
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
    render();
    dibujarSeleccion(false);
  }

  function limpiarFicha() {
    S.productor = null; S.predios = []; S.predio = null; S.lotes = []; S.lote = null; S.tab = null;
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
        S.tab = 'predio'; S.editando = 'predio'; render(); dibujarSeleccion(false);
      });
    } else if (a === 'nuevo-lote') {
      navegar(() => { S.lote = { predio_id: S.predio.id }; S.tab = 'lotes'; S.editando = 'lote'; render(); });
    } else if (a === 'dibujar') {
      if (tipo === 'lote' && S.editando) return aviso('Guarde o cancele la edición antes de dibujar.', true);
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
        productor: S.productor, predio: S.predio, lotes: S.lotes,
        tecnico: S.perfil ? S.perfil.nombre : '',
        logo: C.LOGO ? new URL(C.LOGO, location.href).href : '',
        colorDe: colorLote
      });
    } else if (a === 'ver-predio') {
      dibujarSeleccion(true);
    } else if (a === 'borrar-lote') {
      if (!confirm(`¿Eliminar el lote ${S.lote.cod_lote}? Esta acción no se puede deshacer.`)) return;
      try { await api.borrarLote(S.lote.id); await recargarLotes(null); cargarMapaGeneral(false); aviso('Lote eliminado.'); }
      catch (e) { aviso(e.message, true); }
    }
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

  // ---------- Avisos
  function aviso(texto, esError) {
    const t = document.createElement('div');
    t.className = 'toast' + (esError ? ' error' : '');
    t.textContent = texto;
    $('#avisos').appendChild(t);
    setTimeout(() => t.remove(), esError ? 7000 : 4000);
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
    $('#usuarioRol').textContent = { tecnico: 'Técnico', coordinador: 'Coordinador', admin: 'Administrador' }[perfil.rol] || perfil.rol;
    $('#etiquetaDemo').hidden = !api.demo;
    S.cat = await api.catalogos();
    $('#ingreso').hidden = true;
    $('#app').hidden = false;
    map.invalidateSize();
    await cargarMapaGeneral(true);
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

    $('#formBuscar').addEventListener('submit', (e) => { e.preventDefault(); buscar($('#txtBuscar').value); });

    $('#btnNuevoProductor').addEventListener('click', () => navegar(() => {
      S.productor = {}; S.predios = []; S.predio = null; S.lotes = []; S.lote = null;
      S.tab = 'productor'; S.editando = 'productor';
      $('#resultados').innerHTML = '';
      render(); dibujarSeleccion(false);
      const f = $('#f_productor_tipo_doc'); if (f) f.focus();
    }));

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-accion],[data-productor],[data-predio],[data-lote],[data-ir],[data-tab]');
      if (!t || t.disabled) return;
      if (t.dataset.accion) return accion(t);
      if (t.dataset.productor) return navegar(() => abrirProductor(t.dataset.productor, t.dataset.predioAbrir));
      if (t.dataset.predio) return navegar(() => abrirPredio(t.dataset.predio));
      if (t.dataset.lote) return navegar(() => abrirLote(t.dataset.lote));
      if (t.dataset.ir === 'productor') return navegar(() => { S.tab = 'productor'; render(); });
      if (t.dataset.tab) {
        return navegar(() => {
          S.tab = t.dataset.tab;
          if (S.tab === 'predio' && !S.predio && S.predios.length === 1) return abrirPredio(S.predios[0].id);
          render();
        });
      }
    });
  }

  // ======================================================================
  //  INICIO
  // ======================================================================
  async function iniciar() {
    aplicarLogo();
    iniciarMapa();
    eventos();
    try {
      const user = await api.sesion();
      if (user) { await arrancar(user); return; }
    } catch (e) { $('#ingresoError').textContent = e.message; }
    mostrarIngreso();
  }

  iniciar();
})();
