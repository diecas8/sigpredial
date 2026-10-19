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
    const anillo = (r) => {
      const pts = r.slice();
      const a = pts[0], b = pts[pts.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
      return '(' + pts.map((p) => p[0] + ' ' + p[1]).join(',') + ')';
    };
    return 'SRID=4326;MULTIPOLYGON(' +
      anillosDe(g).map((p) => '(' + p.map(anillo).join(',') + ')').join(',') + ')';
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

  function edadMeses(fecha) {
    if (!fecha) return null;
    const f = new Date(fecha + 'T00:00:00'), h = new Date();
    return (h.getFullYear() - f.getFullYear()) * 12 + (h.getMonth() - f.getMonth());
  }

  const CAMPOS_PRODUCTOR = ['tipo_doc','num_doc','nombres','apellidos','sexo','fecha_nac','telefono',
    'correo','asociacion','observaciones'];
  const CAMPOS_PREDIO = ['productor_id','nombre','num_predial','matricula','tenencia_id','area_declarada_ha',
    'cod_mpio','vereda_id','altitud_msnm','como_llegar'];
  const CAMPOS_LOTE = ['predio_id','cultivo_id','variedad','fecha_siembra','area_declarada_ha','num_plantas',
    'dist_surcos_m','dist_plantas_m','sistema','sombrio','estado','observaciones'];

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
        const [m, c, t] = await Promise.all([
          sb.from('municipio').select('cod_mpio,nombre').order('nombre'),
          sb.from('cultivo').select('id,nombre').order('nombre'),
          sb.from('tenencia').select('id,nombre').order('nombre')
        ]);
        return { municipios: ok(m), cultivos: ok(c), tenencias: ok(t) };
      },
      async veredas(codMpio) {
        if (!codMpio) return [];
        return ok(await sb.from('vereda').select('id,nombre').eq('cod_mpio', codMpio).order('nombre'));
      },
      async crearVereda(codMpio, nombre) {
        return ok(await sb.from('vereda').insert({ cod_mpio: codMpio, nombre: nombre.trim() })
          .select('id,nombre').single());
      },

      async buscar(texto) {
        const q = limpiar(texto);
        if (!q) return { productores: [], predios: [] };
        const p = `"*${q}*"`;
        const [a, b] = await Promise.all([
          sb.from('productor').select('id,num_doc,nombres,apellidos')
            .or(`num_doc.ilike.${p},nombres.ilike.${p},apellidos.ilike.${p}`).order('nombres').limit(30),
          sb.from('v_predio').select('id,cod_predio,nombre,productor_id,productor')
            .or(`cod_predio.ilike.${p},nombre.ilike.${p}`).order('cod_predio').limit(30)
        ]);
        return { productores: ok(a), predios: ok(b) };
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
          .select('id,cod_predio,nombre,productor,productor_id,geojson,latitud,longitud').limit(5000));
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
      async borrarLote(id) { ok(await sb.from('lote').delete().eq('id', id)); }
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
      const c = p.geom ? centro(p.geom) : null;
      return Object.assign({}, p, {
        geojson: p.geom || null,
        area_sig_ha: p.geom ? areaHa(p.geom) : null,
        latitud: c ? c[1] : null, longitud: c ? c[0] : null,
        municipio: nombreDe(D.municipios.map((m) => ({ id: m.cod_mpio, nombre: m.nombre })), 'id', p.cod_mpio),
        vereda: nombreDe(D.veredas, 'id', p.vereda_id),
        tenencia: nombreDe(D.tenencias, 'id', p.tenencia_id),
        num_doc: pr.num_doc,
        productor: [pr.nombres, pr.apellidos].filter(Boolean).join(' '),
        n_lotes: ls.length,
        area_lotes_ha: ls.reduce((s, l) => s + (l.geom ? areaHa(l.geom) : (l.area_declarada_ha || 0)), 0)
      });
    }
    function vLote(l) {
      const p = D.predios.find((x) => x.id === l.predio_id) || {};
      return Object.assign({}, l, {
        geojson: l.geom || null,
        area_sig_ha: l.geom ? areaHa(l.geom) : null,
        cod_predio: p.cod_predio, predio: p.nombre,
        cultivo: nombreDe(D.cultivos, 'id', l.cultivo_id),
        edad_meses: edadMeses(l.fecha_siembra),
        densidad_ha: (l.dist_surcos_m > 0 && l.dist_plantas_m > 0)
          ? Math.round(10000 / (l.dist_surcos_m * l.dist_plantas_m)) : null
      });
    }
    const multi = (g) => (g && g.type === 'Polygon') ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g;

    return {
      demo: true,
      async sesion() { return null; },
      async ingresar(correo) { return espera({ id: 'demo', email: correo }); },
      async salir() {},
      async perfil() { return { nombre: 'Usuario de demostración', rol: 'admin', activo: true }; },

      async catalogos() {
        return espera({ municipios: D.municipios, cultivos: D.cultivos, tenencias: D.tenencias });
      },
      async veredas(codMpio) {
        return espera(D.veredas.filter((v) => v.cod_mpio === codMpio)
          .sort((a, b) => a.nombre.localeCompare(b.nombre)));
      },
      async crearVereda(codMpio, nombre) {
        nombre = nombre.trim();
        if (D.veredas.some((v) => v.cod_mpio === codMpio && v.nombre.toLowerCase() === nombre.toLowerCase())) {
          throw new Error('Esa vereda ya existe en el municipio.');
        }
        const v = { id: nuevoId(), cod_mpio: codMpio, nombre };
        D.veredas.push(v);
        return espera(v);
      },

      async buscar(texto) {
        const q = texto.trim().toLowerCase();
        if (!q) return { productores: [], predios: [] };
        const has = (s) => String(s || '').toLowerCase().includes(q);
        return espera({
          productores: D.productores.filter((p) => has(p.num_doc) || has(p.nombres) || has(p.apellidos)),
          predios: D.predios.filter((p) => has(p.cod_predio) || has(p.nombre)).map(vPredio)
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
      async borrarLote(id) { D.lotes = D.lotes.filter((l) => l.id !== id); return espera(); }
    };
  }

  const configurado = C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase;
  window.SIP_API = configurado ? apiSupabase() : apiDemo();
})();
