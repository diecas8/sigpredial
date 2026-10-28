/* =====================================================================
   Capa de datos del SIP.
   - Con SUPABASE_URL configurado: lee y escribe en Supabase.
   - Sin configuración: MODO DEMOSTRACIÓN en memoria.
   Ambas versiones exponen las mismas funciones.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.SIP_CONFIG || {};

  // ---------- Utilidades geométricas compartidas ----------
  function anillosDe(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    throw new Error('La geometría debe ser un polígono.');
  }

  // GeoJSON → EWKT (lo entiende PostGIS directamente)
  function aEWKT(g) {
    if (!g) return null;
    const par = (p) => p[0] + ' ' + p[1];
    const linea = (l) => '(' + l.map(par).join(',') + ')';
    const anillo = (r) => {
      const pts = r.slice();
      const a = pts[0], b = pts[pts.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
      return linea(pts);
    };
    if (g.type === 'Point') return 'SRID=4326;POINT(' + par(g.coordinates) + ')';
    if (g.type === 'LineString') return 'SRID=4326;MULTILINESTRING(' + linea(g.coordinates) + ')';
    if (g.type === 'MultiLineString') return 'SRID=4326;MULTILINESTRING(' + g.coordinates.map(linea).join(',') + ')';
    return 'SRID=4326;MULTIPOLYGON(' +
      anillosDe(g).map((p) => '(' + p.map(anillo).join(',') + ')').join(',') + ')';
  }

  // Longitud geodésica en metros (líneas)
  function longitudM(g) {
    if (!g) return 0;
    const lineas = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
    const R = 6371008.8, rad = Math.PI / 180;
    let t = 0;
    lineas.forEach((l) => {
      for (let i = 1; i < l.length; i++) {
        const [x1, y1] = l[i - 1], [x2, y2] = l[i];
        const a = Math.sin((y2 - y1) * rad / 2) ** 2 +
          Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
        t += 2 * R * Math.asin(Math.sqrt(a));
      }
    });
    return t;
  }

  // Densidad y sitios de siembra (misma fórmula de la base)
  function siembra(l, areaSig) {
    const ds = +l.dist_surcos_m, dp = +l.dist_plantas_m;
    if (!(ds > 0 && dp > 0)) return { densidad_ha: null, sitios_estimados: null, ocupacion_pct: null };
    const dens = 10000 / (ds * dp * (l.trazado === 'Tresbolillo' ? 0.866 : 1));
    const sitios = areaSig ? Math.round(dens * areaSig) : null;
    const ocup = (sitios && l.num_plantas != null && l.num_plantas !== '')
      ? Math.round(1000 * l.num_plantas / (dens * areaSig)) / 10 : null;
    return { densidad_ha: Math.round(dens), sitios_estimados: sitios, ocupacion_pct: ocup };
  }

  // Área aproximada en hectáreas (solo para el modo demostración)
  function areaHa(g) {
    let total = 0;
    anillosDe(g).forEach((poligono) => {
      poligono.forEach((anillo, i) => {
        const lat0 = anillo[0][1] * Math.PI / 180;
        const kx = 111320 * Math.cos(lat0), ky = 110574;
        let s = 0;
        for (let j = 0; j < anillo.length - 1; j++) {
          const [x1, y1] = anillo[j], [x2, y2] = anillo[j + 1];
          s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
        }
        total += (i === 0 ? 1 : -1) * Math.abs(s / 2);
      });
    });
    return Math.round(total / 100) / 100;
  }

  function puntoEnPoligono(pt, g) {
    return anillosDe(g).some((poligono) => {
      let dentro = false;
      const r = poligono[0];
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (((yi > pt[1]) !== (yj > pt[1])) &&
            (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) dentro = !dentro;
      }
      return dentro;
    });
  }

  function centro(g) {
    const r = anillosDe(g)[0][0];
    let x = 0, y = 0;
    const n = r.length - 1;
    for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; }
    return [x / n, y / n];
  }

  // Texto sin tildes ni mayúsculas (para búsquedas y comparaciones)
  const normalizar = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function edadMeses(fecha) {
    if (!fecha) return null;
    const f = new Date(fecha + 'T00:00:00'), h = new Date();
    return (h.getFullYear() - f.getFullYear()) * 12 + (h.getMonth() - f.getMonth());
  }

  const CAMPOS_PRODUCTOR = ['cod_dpto','tipo_doc','num_doc','nombres','apellidos','sexo','fecha_nac','telefono',
    'correo','asociacion','observaciones'];
  const CAMPOS_PREDIO = ['productor_id','nombre','num_predial','matricula','tenencia_id','area_declarada_ha',
    'cod_mpio','vereda_id','altitud_msnm','como_llegar'];
  const CAMPOS_LOTE = ['predio_id','cultivo_id','variedad','fecha_siembra','area_declarada_ha','num_plantas',
    'dist_surcos_m','dist_plantas_m','trazado','sistema','sombrio','estado','observaciones'];

  const CAMPOS_ELEMENTO = ['predio_id','tipo_id','nombre','estado','permanencia','observaciones'];
  const TABLA_ELEMENTO = { linea: 'elemento_linea', punto: 'elemento_punto' };

  function tomar(o, campos) {
    const r = {};
    campos.forEach((k) => { if (k in o) r[k] = (o[k] === '' ? null : o[k]); });
    return r;
  }

  // =====================================================================
  //  SUPABASE
  // =====================================================================
  function apiSupabase() {
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      db: { schema: C.ESQUEMA || 'productores' }
    });

    function traducir(e) {
      if (!e) return 'Error desconocido';
      if (e.code === '23505') {
        if (/num_doc/.test(e.message)) return 'Ya existe un productor con ese número de documento.';
        if (/uq_vereda/.test(e.message)) return 'Esa vereda ya existe en el municipio.';
        return 'Ya existe un registro con esos datos.';
      }
      if (e.code === '42501' || /row-level security/i.test(e.message)) return 'No tiene permiso para esta acción.';
      if (e.code === '23503') return 'El registro está relacionado con otros datos y no se puede modificar así.';
      if (e.code === 'PGRST116') return 'No se encontró el registro o no tiene permiso para modificarlo.';
      if (/failed to fetch|networkerror|load failed|network request failed/i.test(e.message || '')) {
        return 'Sin conexión con la base de datos: no se guardó. Los datos siguen en el formulario; ' +
          'revise la señal e intente de nuevo.';
      }
      return e.message || String(e);
    }
    const ok = ({ data, error }) => { if (error) throw new Error(traducir(error)); return data; };
    const limpiar = (q) => q.replace(/[,()*%"\\]/g, ' ').trim();

    return {
      demo: false,

      async sesion() {
        const { data } = await sb.auth.getSession();
        return data.session ? data.session.user : null;
      },
      async ingresar(correo, clave) {
        const { data, error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
        if (error) throw new Error(/invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message);
        return data.user;
      },
      async salir() { await sb.auth.signOut(); },
      async perfil(uid) {
        return ok(await sb.from('usuario_app').select('*').eq('user_id', uid).maybeSingle());
      },

      async catalogos() {
        const [d, m, c, t, e] = await Promise.all([
          sb.from('departamento').select('cod_dpto,nombre').order('nombre'),
          sb.from('municipio').select('cod_mpio,nombre,cod_dpto').order('nombre').range(0, 4999),
          sb.from('cultivo').select('id,nombre,tipo').order('nombre'),
          sb.from('tenencia').select('id,nombre').order('nombre'),
          sb.from('tipo_elemento').select('id,nombre,geometria,grupo').order('id')
        ]);
        // Si aún no se ha ejecutado el SQL 09, la app sigue funcionando sin elementos
        const tipos = e.error ? [] : e.data;
        return { departamentos: ok(d), municipios: ok(m), cultivos: ok(c), tenencias: ok(t), tiposElemento: tipos };
      },
      async veredas(codMpio) {
        if (!codMpio) return [];
        return ok(await sb.from('vereda').select('id,nombre,validada').eq('cod_mpio', codMpio).order('nombre'));
      },
      // Las veredas que agrega un técnico quedan "por validar"; las de un coordinador, validadas
      async crearVereda(codMpio, nombre, validada) {
        return ok(await sb.from('vereda').insert({ cod_mpio: codMpio, nombre: nombre.trim(), origen: 'campo', validada: !!validada })
          .select('id,nombre,validada').single());
      },
      async validarVereda(id) {
        ok(await sb.from('vereda').update({ validada: true }).eq('id', id).select('id').single());
      },

      // Búsqueda en la base: sin tildes ni mayúsculas, por todas las palabras
      // (cédula, nombre completo, código o nombre del predio, vereda, municipio)
      async buscar(texto) {
        const q = limpiar(texto);
        if (!q) return { productores: [], predios: [] };
        const r = ok(await sb.rpc('buscar', { q }));
        return { productores: r.productores || [], predios: r.predios || [] };
      },

      async productor(id) { return ok(await sb.from('productor').select('*').eq('id', id).single()); },
      async prediosDe(productorId) {
        return ok(await sb.from('v_predio').select('*').eq('productor_id', productorId).order('cod_predio'));
      },
      async lotesDe(predioId) {
        return ok(await sb.from('v_lote').select('*').eq('predio_id', predioId).order('num_lote'));
      },
      async prediosMapa() {
        return ok(await sb.from('v_predio')
          .select('id,cod_predio,nombre,productor,productor_id,geojson,latitud,longitud,municipio,vereda').limit(5000));
      },

      async guardarProductor(o) {
        const datos = tomar(o, CAMPOS_PRODUCTOR);
        const q = o.id ? sb.from('productor').update(datos).eq('id', o.id) : sb.from('productor').insert(datos);
        return ok(await q.select('id').single()).id;
      },
      async guardarPredio(o, geom) {
        const datos = tomar(o, CAMPOS_PREDIO);
        if (geom !== undefined) datos.geom = aEWKT(geom);
        const q = o.id ? sb.from('predio').update(datos).eq('id', o.id) : sb.from('predio').insert(datos);
        return ok(await q.select('id').single()).id;
      },
      async guardarLote(o, geom) {
        const datos = tomar(o, CAMPOS_LOTE);
        if (geom !== undefined) datos.geom = aEWKT(geom);
        const q = o.id ? sb.from('lote').update(datos).eq('id', o.id) : sb.from('lote').insert(datos);
        return ok(await q.select('id').single()).id;
      },
      async borrarLote(id) { ok(await sb.from('lote').delete().eq('id', id)); },

      async elementosDe(predioId) {
        const [a, b] = await Promise.all([
          sb.from('v_elemento_linea').select('*').eq('predio_id', predioId).order('creado_en'),
          sb.from('v_elemento_punto').select('*').eq('predio_id', predioId).order('creado_en')
        ]);
        if (a.error && /does not exist|schema cache/i.test(a.error.message)) return { lineas: [], puntos: [] };
        return { lineas: ok(a), puntos: ok(b) };
      },
      async guardarElemento(geometria, o, geom) {
        const tabla = TABLA_ELEMENTO[geometria];
        const datos = tomar(o, CAMPOS_ELEMENTO);
        if (geom !== undefined) datos.geom = aEWKT(geom);
        const q = o.id ? sb.from(tabla).update(datos).eq('id', o.id) : sb.from(tabla).insert(datos);
        return ok(await q.select('id').single()).id;
      },
      async borrarElemento(geometria, id) { ok(await sb.from(TABLA_ELEMENTO[geometria]).delete().eq('id', id)); },

      // Encuestas de caracterización que llegan de Kobo
      async caracterizacionesDe(predioId) {
        const r = await sb.from('caracterizacion')
          .select('id,fecha_visita,tecnico,kobo_usuario,estado,error,datos,recibido_en,formulario')
          .eq('predio_id', predioId).order('recibido_en', { ascending: false });
        if (r.error && /does not exist|schema cache/i.test(r.error.message)) return [];
        return ok(r);
      },
      async encuestasConError() {
        const r = await sb.from('caracterizacion')
          .select('id,kobo_uuid,formulario,tecnico,fecha_visita,error,recibido_en')
          .eq('estado', 'error').order('recibido_en', { ascending: false }).limit(200);
        if (r.error && /does not exist|schema cache/i.test(r.error.message)) return [];
        return ok(r);
      },
      async reprocesarEncuesta(id) { return ok(await sb.rpc('reprocesar_kobo', { p_id: id })); },

      // Ficha predial en PDF (almacenamiento privado «fichas»: <predio_id>/ficha.pdf)
      async guardarFicha(predioId, blob) {
        const { error } = await sb.storage.from('fichas')
          .upload(predioId + '/ficha.pdf', blob, { upsert: true, contentType: 'application/pdf', cacheControl: '60' });
        if (error) throw new Error(/row-level|permission|not authorized|403/i.test(error.message)
          ? 'No tiene permiso para guardar la ficha de este predio.' : error.message);
        return ok(await sb.rpc('registrar_ficha', { p_predio: predioId }));
      },
      async fichaDe(predioId) {
        const r = await sb.from('ficha_predial').select('version,generado_en').eq('predio_id', predioId).maybeSingle();
        if (r.error && /does not exist|schema cache/i.test(r.error.message)) return null;
        return ok(r);
      },
      async urlFicha(predioId) {
        const { data, error } = await sb.storage.from('fichas').createSignedUrl(predioId + '/ficha.pdf', 600);
        if (error) throw new Error('No se encontró la ficha guardada.');
        return data.signedUrl;
      }
    };
  }

  // =====================================================================
  //  DEMOSTRACIÓN (en memoria)
  // =====================================================================
  function apiDemo() {
    const D = JSON.parse(JSON.stringify(window.SIP_DEMO));
    let n = 100;
    const nuevoId = () => 'd' + (n++);
    const espera = (v) => new Promise((r) => setTimeout(() => r(v), 120));
    const nombreDe = (lista, campo, valor) => { const x = lista.find((e) => e[campo] === valor); return x ? x.nombre : null; };

    function vPredio(p) {
      const pr = D.productores.find((x) => x.id === p.productor_id) || {};
      const ls = D.lotes.filter((l) => l.predio_id === p.id);
      const c = p.geom ? centro(p.geom) : (p.punto || null);   // punto = [lon, lat] de la visita
      return Object.assign({}, p, {
        geojson: p.geom || null,
        area_sig_ha: p.geom ? areaHa(p.geom) : null,
        latitud: c ? c[1] : null, longitud: c ? c[0] : null,
        municipio: nombreDe(D.municipios.map((m) => ({ id: m.cod_mpio, nombre: m.nombre })), 'id', p.cod_mpio),
        vereda: nombreDe(D.veredas, 'id', p.vereda_id),
        vereda_validada: (D.veredas.find((v) => v.id === p.vereda_id) || {}).validada,
        tenencia: nombreDe(D.tenencias, 'id', p.tenencia_id),
        num_doc: pr.num_doc,
        productor: [pr.nombres, pr.apellidos].filter(Boolean).join(' '),
        n_lotes: ls.length,
        area_lotes_ha: ls.reduce((s, l) => s + (l.geom ? areaHa(l.geom) : (l.area_declarada_ha || 0)), 0)
      });
    }
    function vLote(l) {
      const p = D.predios.find((x) => x.id === l.predio_id) || {};
      const cu = D.cultivos.find((c) => c.id === l.cultivo_id) || {};
      const area = l.geom ? areaHa(l.geom) : null;
      return Object.assign({}, l, {
        geojson: l.geom || null,
        area_sig_ha: area,
        cod_predio: p.cod_predio, predio: p.nombre,
        cultivo: cu.nombre || null, tipo_cobertura: cu.tipo || null,
        edad_meses: edadMeses(l.fecha_siembra)
      }, siembra(l, area));
    }
    function vElemento(e, geometria) {
      const t = D.tiposElemento.find((x) => x.id === +e.tipo_id) || {};
      const r = Object.assign({}, e, { tipo: t.nombre, grupo: t.grupo, geojson: e.geom });
      if (geometria === 'linea') r.longitud_m = Math.round(longitudM(e.geom) * 10) / 10;
      else { r.latitud = e.geom.coordinates[1]; r.longitud = e.geom.coordinates[0]; }
      return r;
    }
    D.tiposElemento = D.tiposElemento || [];
    D.elementosLinea = D.elementosLinea || [];
    D.elementosPunto = D.elementosPunto || [];
    const multi = (g) => (g && g.type === 'Polygon') ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g;

    return {
      demo: true,
      async sesion() { return null; },
      async ingresar(correo) { return espera({ id: 'demo', email: correo }); },
      async salir() {},
      async perfil() { return { nombre: 'Usuario de demostración', rol: 'admin', activo: true }; },

      async catalogos() {
        return espera({ departamentos: D.departamentos, municipios: D.municipios,
          cultivos: D.cultivos, tenencias: D.tenencias, tiposElemento: D.tiposElemento });
      },
      async veredas(codMpio) {
        return espera(D.veredas.filter((v) => v.cod_mpio === codMpio)
          .sort((a, b) => a.nombre.localeCompare(b.nombre)));
      },
      async crearVereda(codMpio, nombre, validada) {
        nombre = nombre.trim();
        if (D.veredas.some((v) => v.cod_mpio === codMpio && normalizar(v.nombre) === normalizar(nombre))) {
          throw new Error('Esa vereda ya existe en el municipio.');
        }
        const v = { id: nuevoId(), cod_mpio: codMpio, nombre, validada: !!validada };
        D.veredas.push(v);
        return espera(v);
      },
      async validarVereda(id) { const v = D.veredas.find((x) => x.id === id); if (v) v.validada = true; return espera(); },

      async buscar(texto) {
        const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
        if (!palabras.length) return { productores: [], predios: [] };
        const todas = (t) => { const n = normalizar(t); return palabras.every((w) => n.includes(w)); };
        return espera({
          productores: D.productores.filter((p) => todas([p.num_doc, p.nombres, p.apellidos].join(' '))),
          predios: D.predios.map(vPredio).filter((p) => todas([p.cod_predio, p.nombre, p.vereda, p.municipio].join(' ')))
        });
      },
      async productor(id) { return espera(Object.assign({}, D.productores.find((p) => p.id === id))); },
      async prediosDe(pid) {
        return espera(D.predios.filter((p) => p.productor_id === pid).map(vPredio)
          .sort((a, b) => a.cod_predio.localeCompare(b.cod_predio)));
      },
      async lotesDe(predioId) {
        return espera(D.lotes.filter((l) => l.predio_id === predioId).map(vLote)
          .sort((a, b) => a.num_lote - b.num_lote));
      },
      async prediosMapa() { return espera(D.predios.map(vPredio)); },

      async guardarProductor(o) {
        const datos = tomar(o, CAMPOS_PRODUCTOR);
        if (!datos.num_doc || !datos.nombres) throw new Error('Número de documento y nombres son obligatorios.');
        if (D.productores.some((p) => p.num_doc === datos.num_doc && p.id !== o.id)) {
          throw new Error('Ya existe un productor con ese número de documento.');
        }
        if (o.id) { Object.assign(D.productores.find((p) => p.id === o.id), datos); return espera(o.id); }
        const p = Object.assign({ id: nuevoId(), creado_por: 'demo' }, datos);
        D.productores.push(p);
        return espera(p.id);
      },
      async guardarPredio(o, geom) {
        const datos = tomar(o, CAMPOS_PREDIO);
        if (geom !== undefined) datos.geom = multi(geom);
        if (o.id) { Object.assign(D.predios.find((p) => p.id === o.id), datos); return espera(o.id); }
        if (!datos.cod_mpio) throw new Error('Seleccione el municipio.');
        const consecutivo = D.predios.filter((p) => p.cod_mpio === datos.cod_mpio).length + 1;
        const p = Object.assign({ id: nuevoId(), creado_por: 'demo',
          cod_predio: datos.cod_mpio + '-' + String(consecutivo).padStart(4, '0') }, datos);
        D.predios.push(p);
        return espera(p.id);
      },
      async guardarLote(o, geom) {
        const datos = tomar(o, CAMPOS_LOTE);
        if (geom !== undefined) datos.geom = multi(geom);
        const actual = o.id ? D.lotes.find((l) => l.id === o.id) : null;
        const predioId = actual ? actual.predio_id : datos.predio_id;
        const predio = D.predios.find((p) => p.id === predioId);
        if (!predio) throw new Error('El lote debe pertenecer a un predio.');
        const g = datos.geom !== undefined ? datos.geom : (actual && actual.geom);
        if (g && predio.geom) {
          const vertices = anillosDe(g)[0][0];
          const fuera = vertices.filter((v) => !puntoEnPoligono(v, predio.geom)).length;
          if (fuera > 0) throw new Error(`El lote se sale del predio ${predio.cod_predio}. Dibújelo dentro del límite.`);
        }
        if (actual) { delete datos.predio_id; Object.assign(actual, datos); return espera(actual.id); }
        const num = D.lotes.filter((l) => l.predio_id === predioId).reduce((m, l) => Math.max(m, l.num_lote), 0) + 1;
        const l = Object.assign({ id: nuevoId(), creado_por: 'demo', num_lote: num,
          cod_lote: predio.cod_predio + '-L' + String(num).padStart(2, '0') }, datos);
        D.lotes.push(l);
        return espera(l.id);
      },
      async borrarLote(id) { D.lotes = D.lotes.filter((l) => l.id !== id); return espera(); },

      async elementosDe(predioId) {
        return espera({
          lineas: D.elementosLinea.filter((e) => e.predio_id === predioId).map((e) => vElemento(e, 'linea')),
          puntos: D.elementosPunto.filter((e) => e.predio_id === predioId).map((e) => vElemento(e, 'punto'))
        });
      },
      async guardarElemento(geometria, o, geom) {
        const lista = geometria === 'linea' ? D.elementosLinea : D.elementosPunto;
        const datos = tomar(o, CAMPOS_ELEMENTO);
        if (!datos.tipo_id && !o.id) throw new Error('Seleccione el tipo de elemento.');
        if (datos.tipo_id) datos.tipo_id = +datos.tipo_id;
        const actual = o.id ? lista.find((e) => e.id === o.id) : null;
        const predio = D.predios.find((p) => p.id === (actual ? actual.predio_id : datos.predio_id));
        if (geom !== undefined) {
          if (geometria === 'linea') {
            const g = geom.type === 'LineString' ? { type: 'MultiLineString', coordinates: [geom.coordinates] } : geom;
            if (predio && predio.geom) {
              // Recorte simple: se conservan los tramos con vértices dentro del predio
              const partes = g.coordinates.map((l) => l.filter((v) => puntoEnPoligono(v, predio.geom))).filter((l) => l.length > 1);
              if (!partes.length) throw new Error('La línea no pasa por el predio.');
              datos.geom = { type: 'MultiLineString', coordinates: partes };
            } else datos.geom = g;
          } else {
            if (predio && predio.geom && !puntoEnPoligono(geom.coordinates, predio.geom)) {
              throw new Error('El punto está fuera del predio.');
            }
            datos.geom = geom;
          }
        }
        if (actual) { delete datos.predio_id; Object.assign(actual, datos); return espera(actual.id); }
        if (!datos.geom) throw new Error('Dibuje el elemento en el mapa.');
        const e = Object.assign({ id: nuevoId(), creado_por: 'demo', creado_en: new Date().toISOString() }, datos);
        lista.push(e);
        return espera(e.id);
      },
      async borrarElemento(geometria, id) {
        if (geometria === 'linea') D.elementosLinea = D.elementosLinea.filter((e) => e.id !== id);
        else D.elementosPunto = D.elementosPunto.filter((e) => e.id !== id);
        return espera();
      },
      async caracterizacionesDe(predioId) { return espera((D.caracterizaciones || []).filter((c) => c.predio_id === predioId)); },
      async encuestasConError() { return espera((D.caracterizaciones || []).filter((c) => c.estado === 'error')); },
      async reprocesarEncuesta() { return espera({ estado: 'procesada' }); },
      async guardarFicha(predioId, blob) {
        D.fichas = D.fichas || {};
        const f = D.fichas[predioId] || { version: 0 };
        D.fichas[predioId] = { version: f.version + 1, generado_en: new Date().toISOString(), url: URL.createObjectURL(blob) };
        return espera(D.fichas[predioId]);
      },
      async fichaDe(predioId) { return espera((D.fichas || {})[predioId] || null); },
      async urlFicha(predioId) { return espera(((D.fichas || {})[predioId] || {}).url); }
    };
  }

  // Con la base configurada NUNCA se entra en demostración: si la librería de Supabase
  // no cargó (sin señal, CDN caído), la app muestra un error y no deja trabajar,
  // para que nadie registre datos que se perderían al recargar.
  const hayBase = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  if (hayBase && !window.supabase) {
    window.SIP_API = { demo: false, sinConexion: true };
  } else {
    window.SIP_API = hayBase ? apiSupabase() : apiDemo();
  }
  window.SIP_GEO = { areaHa, longitudM, siembra, anillosDe, normalizar };
})();
