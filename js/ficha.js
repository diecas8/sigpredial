/* =====================================================================
   SIP · CBS — Ficha predial imprimible
   Abre una ventana con la ficha del predio (datos, mapa, lotes y elementos)
   lista para imprimir o guardar en PDF desde el navegador.
   ===================================================================== */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 2) => (n === null || n === undefined || n === '') ? '—'
    : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d });
  const fecha = (f) => {
    if (!f) return '—';
    const d = new Date(String(f).length <= 10 ? f + 'T00:00:00' : f);
    return isNaN(d) ? esc(f) : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  // ---------------- Geometría y proyección (Web Mercator en píxeles) ----------------
  function anillos(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    return [];
  }
  // Coordenadas "mundo" a zoom 0 (0..256)
  function mundo(lon, lat) {
    const s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256];
  }
  function centroAnillo(r) {
    // centroide de área del anillo exterior (en lon/lat; suficiente para etiquetas)
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      a += f; cx += (r[i][0] + r[i + 1][0]) * f; cy += (r[i][1] + r[i + 1][1]) * f;
    }
    if (Math.abs(a) < 1e-14) return r[0];
    return [cx / (3 * a), cy / (3 * a)];
  }

  // MAGNA-SIRGAS / Origen Nacional (EPSG:9377) con proj4, si está disponible
  function origenNacional(lon, lat) {
    if (!window.proj4) return null;
    try {
      const def = '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
      return window.proj4('EPSG:4326', def, [lon, lat]);
    } catch (e) { return null; }
  }

  // Todas las coordenadas de una geometría (cualquier tipo)
  function coords(g) {
    const out = [];
    const rec = (c) => { if (typeof c[0] === 'number') out.push(c); else c.forEach(rec); };
    if (g && g.coordinates) rec(g.coordinates);
    return out;
  }
  function lineasDe(g) {
    if (!g) return [];
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'MultiLineString') return g.coordinates;
    return [];
  }

  // ---------------- Mapa (teselas satelitales + SVG) ----------------
  function construirMapa(predio, lotes, elementos, colorDe, colorEl, ancho, alto) {
    const geoms = [];
    if (predio.geojson) geoms.push(predio.geojson);
    lotes.forEach((l) => l.geojson && geoms.push(l.geojson));
    elementos.forEach((e) => e.geojson && geoms.push(e.geojson));
    if (!geoms.length) {
      return `<div class="mapa-vacio">Este predio aún no tiene límite ni lotes dibujados.</div>`;
    }

    // Extensión en coordenadas mundo
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    geoms.forEach((g) => coords(g).forEach(([lon, lat]) => {
      const [x, y] = mundo(lon, lat);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }));
    // Margen del 12 % y ajuste a la proporción del recuadro
    let w = Math.max(x1 - x0, 1e-7), h = Math.max(y1 - y0, 1e-7);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    w *= 1.24; h *= 1.24;
    if (w / h > ancho / alto) h = w * alto / ancho; else w = h * ancho / alto;
    x0 = cx - w / 2; y0 = cy - h / 2;

    // Zoom de teselas: el mayor que quepa en el ancho, máximo 18
    let z = Math.floor(Math.log2(ancho / w));
    z = Math.max(1, Math.min(18, z));
    const k = Math.pow(2, z);               // mundo → píxeles del zoom z
    const esc2 = ancho / (w * k);            // píxeles del zoom z → píxeles del recuadro
    const P = (lon, lat) => { const [x, y] = mundo(lon, lat); return [(x - x0) * k * esc2, (y - y0) * k * esc2]; };

    // Teselas
    const tx0 = Math.floor(x0 * k / 256), tx1 = Math.floor((x0 + w) * k / 256);
    const ty0 = Math.floor(y0 * k / 256), ty1 = Math.floor((y0 + h) * k / 256);
    const lado = 256 * esc2;
    let teselas = '';
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const left = (tx * 256 - x0 * k) * esc2, top = (ty * 256 - y0 * k) * esc2;
        teselas += `<img src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}" ` +
          `style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;width:${(lado + 0.6).toFixed(2)}px;height:${(lado + 0.6).toFixed(2)}px" alt="">`;
      }
    }

    // Polígonos
    const ruta = (g) => anillos(g).map((p) => p.map((r) =>
      'M' + r.map(([lon, lat]) => P(lon, lat).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('')).join('');
    let svg = '';
    if (predio.geojson) {
      svg += `<path d="${ruta(predio.geojson)}" fill="rgba(225,204,17,.10)" stroke="#000" stroke-opacity=".35" stroke-width="6" fill-rule="evenodd"/>`;
      svg += `<path d="${ruta(predio.geojson)}" fill="none" stroke="#E1CC11" stroke-width="3.2" fill-rule="evenodd"/>`;
    }
    lotes.forEach((l) => {
      if (!l.geojson) return;
      svg += `<path d="${ruta(l.geojson)}" fill="${colorDe(l)}" fill-opacity=".55" stroke="#fff" stroke-width="1.8" fill-rule="evenodd"/>`;
    });
    // Elementos: líneas y puntos
    elementos.forEach((e) => {
      if (!e.geojson) return;
      const col = colorEl(e);
      lineasDe(e.geojson).forEach((ln) => {
        const d = 'M' + ln.map(([lon, lat]) => P(lon, lat).map((v) => v.toFixed(1)).join(',')).join('L');
        svg += `<path d="${d}" fill="none" stroke="#fff" stroke-width="5" stroke-opacity=".8"/>`;
        svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="3"${e.grupo === 'Vial' ? ' stroke-dasharray="7 4"' : ''}/>`;
      });
      if (e.geojson.type === 'Point') {
        const [px, py] = P(...e.geojson.coordinates);
        svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="${col}" stroke="#fff" stroke-width="2"/>`;
      }
    });
    lotes.forEach((l) => {
      if (!l.geojson) return;
      const ext = anillos(l.geojson)[0];
      if (!ext) return;
      const [lx, ly] = P(...centroAnillo(ext[0]));
      const t = 'L' + String(l.num_lote).padStart(2, '0');
      svg += `<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})">
        <rect x="-19" y="-10" width="38" height="20" rx="4" fill="#fff" stroke="#2c4527" stroke-width="1.2"/>
        <text text-anchor="middle" dy="4.5" font-size="12.5" font-weight="700" fill="#2c4527">${t}</text></g>`;
    });

    // Norte
    svg += `<g transform="translate(${ancho - 42},46)">
      <circle r="24" fill="#fff" fill-opacity=".9" stroke="#2c4527"/>
      <path d="M0,-17 L7,8 L0,3 L-7,8 Z" fill="#2c4527"/>
      <text y="20" text-anchor="middle" font-size="11" font-weight="700" fill="#2c4527">N</text></g>`;

    // Barra de escala (metros reales en la latitud central)
    const latC = predio.latitud || (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy / 256))) * 180 / Math.PI);
    const mPorPx = (40075016.686 * Math.cos(latC * Math.PI / 180)) / (256 * k) / esc2;
    const opciones = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    let largo = opciones[0];
    opciones.forEach((o) => { if (o / mPorPx <= ancho * 0.22) largo = o; });
    const px = largo / mPorPx;
    const etq = largo >= 1000 ? (largo / 1000) + ' km' : largo + ' m';
    svg += `<g transform="translate(18,${alto - 26})">
      <rect x="-8" y="-20" width="${(px + 40).toFixed(0)}" height="34" rx="4" fill="#fff" fill-opacity=".9"/>
      <rect x="0" y="0" width="${(px / 2).toFixed(1)}" height="6" fill="#2c4527"/>
      <rect x="${(px / 2).toFixed(1)}" y="0" width="${(px / 2).toFixed(1)}" height="6" fill="#fff" stroke="#2c4527"/>
      <text x="0" y="-6" font-size="10.5" fill="#2c4527">0</text>
      <text x="${px.toFixed(1)}" y="-6" font-size="10.5" text-anchor="middle" fill="#2c4527">${etq}</text></g>`;

    return `<div class="mapa" style="width:${ancho}px;height:${alto}px">
      <div class="teselas">${teselas}</div>
      <svg viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">${svg}</svg>
      <div class="atrib">Imagen: Esri World Imagery · Datum WGS84</div>
    </div>`;
  }

  // ---------------- Ficha completa ----------------
  function html(d) {
    const { productor: pr, predio: p, lotes, tecnico, logo, colorDe } = d;
    const colorEl = d.colorElemento || (() => '#1e88e5');
    const difArea = d.difArea || (() => null);
    const els = d.elementos || { lineas: [], puntos: [] };
    const elementos = els.lineas.map((e) => Object.assign({ geometria: 'linea' }, e))
      .concat(els.puntos.map((e) => Object.assign({ geometria: 'punto' }, e)));
    const conDif = (r) => { const x = difArea(r); return x === null ? '' : ` <b class="alerta">⚠ ${x > 0 ? '+' : '−'}${num(Math.abs(x), 0)} %</b>`; };
    const metros = (m) => m >= 1000 ? num(m / 1000, 2) + ' km' : num(m, 0) + ' m';
    const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const on = (p.longitud != null && p.latitud != null) ? origenNacional(p.longitud, p.latitud) : null;
    const nombreProd = [pr.nombres, pr.apellidos].filter(Boolean).join(' ');

    const filas = (pares) => pares.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('');

    const tAreaD = lotes.reduce((s, l) => s + (Number(l.area_declarada_ha) || 0), 0);
    const tAreaS = lotes.reduce((s, l) => s + (Number(l.area_sig_ha) || 0), 0);
    const tPlantas = lotes.reduce((s, l) => s + (Number(l.num_plantas) || 0), 0);
    const tSitios = lotes.reduce((s, l) => s + (Number(l.sitios_estimados) || 0), 0);

    // Leyenda de cultivos presentes
    const vistos = {};
    lotes.forEach((l) => { if (l.geojson) vistos[l.cultivo || 'Sin cultivo'] = colorDe(l); });
    const vistosEl = {};
    elementos.forEach((e) => { if (e.geojson) vistosEl[e.tipo] = [colorEl(e), e.geometria]; });
    const leyenda = `<span class="ley"><i style="background:transparent;border:3px solid #E1CC11"></i>Límite del predio</span>` +
      Object.entries(vistos).map(([c, col]) => `<span class="ley"><i style="background:${col}"></i>${esc(c)}</span>`).join('') +
      Object.entries(vistosEl).map(([t, [col, g]]) => `<span class="ley"><i class="${g}" style="background:${col}"></i>${esc(t)}</span>`).join('');
    const mHid = elementos.filter((e) => e.geometria === 'linea' && e.grupo === 'Hídrico').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const mVia = elementos.filter((e) => e.geometria === 'linea' && e.grupo === 'Vial').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const nNac = elementos.filter((e) => /Nacimiento/i.test(e.tipo || '')).length;

    const logoHtml = logo
      ? `<img class="logo" src="${esc(logo)}" alt="CBS">`
      : `<svg class="logo" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#fff" stroke="#B8BE16" stroke-width="2"/><path d="M20 33c-1-9 1-17 11-23-11 0-18 6-18 14 0 3 1 6 3 9" fill="#456A3E"/><path d="M20 33c0-6 2-11 7-15" stroke="#E1CC11" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Ficha predial ${esc(p.cod_predio)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1d2a1d; font-size: 11.5px; background: #e9e5da; }
  .hoja { width: 186mm; margin: 12px auto; background: #fff; padding: 0 0 8mm; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  .cab { display: flex; align-items: center; gap: 12px; background: #456A3E; color: #fff; padding: 10px 14px; border-bottom: 4px solid #E1CC11; }
  .cab .logo { width: 46px; height: 46px; border-radius: 50%; background: #fff; object-fit: contain; flex: none; }
  .cab .org { font-weight: 700; font-size: 14px; line-height: 1.1; }
  .cab .sis { font-size: 10.5px; opacity: .9; }
  .cab .tit { margin-left: auto; text-align: right; }
  .cab .tit b { display: block; font-size: 17px; letter-spacing: .06em; }
  .cab .tit span { font-size: 12px; background: #E1CC11; color: #2a1d00; padding: 1px 8px; border-radius: 10px; font-weight: 700; }
  .cuerpo { padding: 10px 14px 0; }
  h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: #fff; background: #6b8f45;
       margin: 10px 0 6px; padding: 3px 8px; border-radius: 3px; }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  table.datos { width: 100%; border-collapse: collapse; }
  table.datos th { text-align: left; font-weight: 600; color: #5b665a; width: 42%; padding: 2.5px 6px 2.5px 0; vertical-align: top; }
  table.datos td { padding: 2.5px 0; border-bottom: 1px dotted #d8d2c2; }
  .mapa { position: relative; overflow: hidden; border: 1.5px solid #2c4527; background: #dfe6da; margin: 0 auto; }
  .mapa .teselas img { position: absolute; display: block; }
  .mapa svg { position: absolute; left: 0; top: 0; }
  .mapa .atrib { position: absolute; right: 0; bottom: 0; background: rgba(255,255,255,.85); font-size: 8.5px; padding: 1px 5px; }
  .mapa-vacio { border: 1.5px dashed #d8d2c2; padding: 40px; text-align: center; color: #5b665a; }
  .leyenda { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 2px 0; font-size: 10.5px; }
  .ley i { display: inline-block; width: 14px; height: 10px; margin-right: 5px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.25); }
  table.lotes { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.lotes th { background: #456A3E; color: #fff; padding: 4px 4px; text-align: left; font-weight: 600; }
  table.lotes td { padding: 3.5px 4px; border-bottom: 1px solid #e3ddcc; }
  table.lotes tr:nth-child(even) td { background: #f6f3ec; }
  table.lotes tfoot td { font-weight: 700; background: #eaf0e3 !important; border-top: 1.5px solid #456A3E; }
  .alerta { color: #c46a00; }
  .nota { font-size: 9.5px; color: #5b665a; margin: 4px 0 0; }
  .ley i.linea { height: 4px; vertical-align: 2px; border: 0; }
  .ley i.punto { width: 10px; height: 10px; border-radius: 50%; }
  .cab .logo { padding: 3px; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 28px; }
  .firma { border-top: 1px solid #1d2a1d; padding-top: 4px; font-size: 10.5px; }
  .pie { display: flex; justify-content: space-between; margin-top: 14px; padding-top: 6px; border-top: 1px solid #d8d2c2; font-size: 9.5px; color: #5b665a; }
  .barra-acc { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #2c4527; }
  .barra-acc button { font: inherit; font-weight: 700; padding: 7px 16px; border-radius: 6px; border: 0; cursor: pointer; background: #E1CC11; color: #2a1d00; }
  .barra-acc button.sec { background: #fff; color: #2c4527; }
  @media print {
    body { background: #fff; }
    .hoja { margin: 0; box-shadow: none; width: auto; }
    .barra-acc { display: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mapa, table.lotes tr, .firmas { break-inside: avoid; }
  }
</style></head><body>
<div class="barra-acc">
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
  <button class="sec" onclick="window.close()">Cerrar</button>
</div>
<div class="hoja">
  <div class="cab">
    ${logoHtml}
    <div><div class="org">Corporación Biocomercio Sostenible</div><div class="sis">Sistema de Información de Productores</div></div>
    <div class="tit"><b>FICHA PREDIAL</b><span>${esc(p.cod_predio)}</span></div>
  </div>
  <div class="cuerpo">
    <div class="dos">
      <div>
        <h2>Productor</h2>
        <table class="datos">${filas([
          ['Nombre', esc(nombreProd)],
          ['Documento', esc((pr.tipo_doc || '') + ' ' + (pr.num_doc || ''))],
          ['Teléfono', esc(pr.telefono || '—')],
          ['Correo', esc(pr.correo || '—')],
          ['Asociación', esc(pr.asociacion || '—')]
        ])}</table>
      </div>
      <div>
        <h2>Predio</h2>
        <table class="datos">${filas([
          ['Nombre', esc(p.nombre)],
          ['Municipio / vereda', esc(p.municipio || '—') + ' / ' + esc(p.vereda || '—')],
          ['Tenencia', esc(p.tenencia || '—')],
          ['Elementos', `${metros(mHid)} de cauces · ${metros(mVia)} de vías · ${nNac} nacimiento(s)`]
        ])}</table>
      </div>
    </div>
    <div class="dos">
      <table class="datos">${filas([
        ['Área declarada', num(p.area_declarada_ha, 4) + ' ha'],
        ['Área SIG', num(p.area_sig_ha, 4) + ' ha' + conDif(p)],
        ['Área en lotes', num(p.area_lotes_ha, 4) + ' ha'],
        ['Número de lotes', esc(lotes.length)]
      ])}</table>
      <table class="datos">${filas([
        ['Altitud', p.altitud_msnm != null ? num(p.altitud_msnm, 0) + ' msnm' : '—'],
        ['Lat / Lon (WGS84)', p.latitud != null ? num(p.latitud, 6) + ' / ' + num(p.longitud, 6) : '—'],
        ['Origen Nacional (E / N)', on ? num(on[0], 1) + ' / ' + num(on[1], 1) : '—'],
        ['Cómo llegar', esc(p.como_llegar || '—')]
      ])}</table>
    </div>

    <h2>Mapa del predio y sus lotes</h2>
    ${construirMapa(p, lotes, elementos, colorDe, colorEl, 680, 430)}
    <div class="leyenda">${leyenda}</div>

    <h2>Lotes</h2>
    ${lotes.length ? `<table class="lotes"><thead><tr>
        <th>Lote</th><th>Cultivo / cobertura</th><th>Variedad</th><th>Siembra</th><th class="n">Edad (m)</th>
        <th class="n">Área decl. (ha)</th><th class="n">Área SIG (ha)</th><th class="n">Plantas</th>
        <th class="n">Dens. (pl/ha)</th><th class="n">Sitios est.</th><th class="n">Ocup.</th><th>Estado</th></tr></thead><tbody>
      ${lotes.map((l) => `<tr><td><b>L${String(l.num_lote).padStart(2, '0')}</b></td><td>${esc(l.cultivo || '—')}</td>
        <td>${esc(l.variedad || '—')}</td><td>${fecha(l.fecha_siembra)}</td><td class="n">${num(l.edad_meses, 0)}</td>
        <td class="n">${num(l.area_declarada_ha, 4)}</td><td class="n">${num(l.area_sig_ha, 4)}${difArea(l) !== null ? ' <b class="alerta">⚠</b>' : ''}</td>
        <td class="n">${num(l.num_plantas, 0)}</td><td class="n">${num(l.densidad_ha, 0)}${l.trazado === 'Tresbolillo' ? '<sup>T</sup>' : ''}</td>
        <td class="n">${num(l.sitios_estimados, 0)}</td><td class="n">${l.ocupacion_pct == null ? '—' : num(l.ocupacion_pct, 0) + ' %'}</td>
        <td>${esc(l.estado || '—')}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5">Total</td><td class="n">${num(tAreaD, 4)}</td><td class="n">${num(tAreaS, 4)}</td>
        <td class="n">${num(tPlantas, 0)}</td><td></td><td class="n">${num(tSitios, 0)}</td><td colspan="2"></td></tr></tfoot></table>
      <p class="nota">Sitios estimados = área SIG ÷ (dist. surcos × dist. plantas); <sup>T</sup> tresbolillo (÷ 0,866).
        Ocupación = plantas registradas ÷ sitios estimados. ⚠ = el área SIG difiere más de 30 % de la declarada.</p>`
      : '<p>Este predio no tiene lotes registrados.</p>'}

    ${elementos.length ? `<h2>Elementos del predio (levantados en campo)</h2>
    <table class="lotes"><thead><tr><th>Tipo</th><th>Grupo</th><th>Nombre</th><th class="n">Longitud / ubicación</th>
      <th>Permanencia</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>
      ${elementos.map((e) => `<tr><td>${esc(e.tipo)}</td><td>${esc(e.grupo || '')}</td><td>${esc(e.nombre || '—')}</td>
        <td class="n">${e.geometria === 'linea' ? metros(Number(e.longitud_m || 0)) : num(e.latitud, 5) + ' / ' + num(e.longitud, 5)}</td>
        <td>${esc(e.permanencia || '—')}</td><td>${esc(e.estado || '—')}</td><td>${esc(e.observaciones || '')}</td></tr>`).join('')}
    </tbody></table>` : ''}

    <div class="firmas">
      <div class="firma"><b>${esc(tecnico || '')}</b><br>Técnico responsable</div>
      <div class="firma"><b>${esc(nombreProd)}</b><br>Productor · ${esc((pr.tipo_doc || '') + ' ' + (pr.num_doc || ''))}</div>
    </div>
    <div class="pie">
      <span>Generado el ${esc(hoy)} · SIP · Corporación Biocomercio Sostenible</span>
      <span>Información con fines de gestión técnica. Datos personales protegidos (Ley 1581 de 2012).</span>
    </div>
  </div>
</div>
</body></html>`;
  }

  function abrir(datos) {
    const v = window.open('', '_blank');
    if (!v) { alert('El navegador bloqueó la ventana de la ficha. Permita las ventanas emergentes para este sitio.'); return null; }
    v.document.open();
    v.document.write(html(datos));
    v.document.close();
    return v;
  }

  window.SIP_FICHA = { abrir, html };
})();
