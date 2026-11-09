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
  // MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377): sistema oficial para áreas,
  // longitudes y coordenadas planas. La geometría se guarda en EPSG:4326.
  const DEF_9377 = '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  let conv9377 = null;
  function a9377(lon, lat) {
    if (lon == null || lat == null || !window.proj4) return null;
    try {
      conv9377 = conv9377 || window.proj4('EPSG:4326', DEF_9377);
      return conv9377.forward([+lon, +lat]);
    } catch (e) { return null; }
  }
  // Área plana (m²) de un anillo [[lon,lat],...] en 9377; null si no hay proj4
  function areaAnillo9377(anillo) {
    const pts = anillo.map((c) => a9377(c[0], c[1]));
    if (pts.some((p) => !p)) return null;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s / 2);
  }
  // Distancia plana (m) en 9377 entre dos [lon,lat]; null si no hay proj4
  function dist9377(c1, c2) {
    const a = a9377(c1[0], c1[1]), b = a9377(c2[0], c2[1]);
    return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null;
  }

  function longitudM(g) {
    if (!g) return 0;
    const lineas = g.type === 'LineString' ? [g.coordinates] : (g.type === 'MultiLineString' ? g.coordinates : []);
    const R = 6371008.8, rad = Math.PI / 180;
    let t = 0;
    lineas.forEach((l) => {
      for (let i = 1; i < l.length; i++) {
        const d = dist9377(l[i - 1], l[i]);
        if (d != null) { t += d; continue; }
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

  // Área en hectáreas, plana en Origen Nacional (9377) como en la base de datos
  function areaHa(g) {
    let total = 0;
    anillosDe(g).forEach((poligono) => {
      poligono.forEach((anillo, i) => {
        const a9 = areaAnillo9377(anillo);
        if (a9 != null) { total += (i === 0 ? 1 : -1) * a9; return; }
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
    'cod_mpio','vereda_id','altitud_msnm','como_llegar',
    // PPS: prospectiva (finca soñada) y selección del predio
    'vision_familia','fecha_taller','participantes_hombres','participantes_mujeres','participantes_jovenes',
    'crit_ambiental','crit_territorio','crit_mejora','hab_voluntaria','hab_arraigo','hab_acceso','hab_jac',
    // Visión por aspecto (tabla 3) y contexto del mapa actual (tabla 1)
    'vision_ambiental','vision_productiva','vision_alimentacion','vision_infraestructura','vision_cambios','vision_capacidades',
    'microcuenca','area_protegida','relacion_area_protegida','sistema_principal_id'];
  const CAMPOS_PPS_PREDIO = CAMPOS_PREDIO.slice(CAMPOS_PREDIO.indexOf('vision_familia')).concat(['puntaje_seleccion']);
  const CAMPOS_LOTE = ['predio_id','cultivo_id','variedad','fecha_siembra','area_declarada_ha','num_plantas',
    'dist_surcos_m','dist_plantas_m','trazado','sistema','sombrio','estado','observaciones',
    'escenario','zona_pps_id','cobertura_clc'];
  const CAMPOS_ACCION = ['predio_id','accion_id','lote_id','elemento_linea_id','cantidad','unidad','plazo','prioridad','apoyos',
    'responsable','estado','observaciones'];
  // Puntaje de selección (misma fórmula de la base: 35 % ambiental, 35 % territorio, 30 % mejora)
  const puntaje = (p) => [p.crit_ambiental, p.crit_territorio, p.crit_mejora].some((v) => v == null || v === '') ? null
    : Math.round((0.35 * p.crit_ambiental + 0.35 * p.crit_territorio + 0.30 * p.crit_mejora) * 100) / 100;

  const CAMPOS_ELEMENTO = ['predio_id','tipo_id','nombre','estado','permanencia','observaciones','escenario'];
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
      async cambiarClave(nueva) {
        const { error } = await sb.auth.updateUser({ password: nueva });
        if (error) throw new Error(error.message);
        ok(await sb.rpc('clave_cambiada'));
      },
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
          .select('id,cod_predio,nombre,productor,productor_id,geojson,latitud,longitud,municipio,vereda,calidad,pendientes').limit(5000));
      },

      // Tablero de avance (indicadores filtrados por los departamentos del usuario)
      async tablero(codDpto) { return ok(await sb.rpc('tablero', { p_dpto: codDpto || null })); },
      async guardarMeta(codDpto, predios, hectareas) {
        return ok(await sb.from('meta_departamento').upsert({ cod_dpto: codDpto, predios, hectareas,
          actualizado_en: new Date().toISOString() }));
      },
      // Aviso de tratamiento de datos personales (Ley 1581 de 2012)
      async aceptarDatos() { return ok(await sb.rpc('aceptar_tratamiento_datos')); },

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
      // Lotes que quedan debajo de una forma nueva, y recorte para abrirle espacio
      async lotesBajo(predioId, geom, excluirId, escenario) {
        const a = { p_predio: predioId, p_geom: aEWKT(geom), p_excluir: excluirId || null };
        if (escenario === 'propuesto') a.p_escenario = 'propuesto';
        return ok(await sb.rpc('lotes_bajo', a));
      },
      async abrirEspacio(predioId, geom, lotes, escenario) {
        const a = { p_predio: predioId, p_geom: aEWKT(geom), p_lotes: lotes };
        if (escenario === 'propuesto') a.p_escenario = 'propuesto';
        return ok(await sb.rpc('abrir_espacio_lote', a));
      },

      // ---------- Planificación Predial Sostenible (requiere sql/22_pps_base.sql)
      // Sin la migración devuelve null y el portal oculta la finca soñada y el plan.
      async catalogosPPS() {
        const [z, a, ap] = await Promise.all([
          sb.from('zona_pps').select('*').order('orden'),
          sb.from('catalogo_accion').select('id,nombre,tipo,unidad,activo').order('id'),
          sb.from('catalogo_apoyo').select('codigo,nombre,activo').order('nombre')
        ]);
        if (z.error || a.error || ap.error) return null;
        return { zonas: z.data, acciones: a.data, apoyos: ap.data };
      },
      async ppsPredio(predioId) {
        const r = await sb.from('predio').select(CAMPOS_PPS_PREDIO.join(',')).eq('id', predioId).maybeSingle();
        return r.error ? {} : (r.data || {});
      },
      async copiarLotes(predioId) { return ok(await sb.rpc('copiar_lotes_a_propuesto', { p_predio: predioId })); },

      // Predios en que trabajó el usuario, del más reciente al más antiguo (sql/24)
      async misRecientes() {
        const r = await sb.rpc('mi_trabajo_reciente', { p_limite: 30 });
        if (r.error && /does not exist|schema cache|function/i.test(r.error.message)) return [];
        return ok(r) || [];
      },
      // Municipios que el usuario puede trabajar (técnicos: los asignados)
      async misMunicipios() {
        const r = await sb.rpc('mis_municipios');
        return r.error ? null : (r.data || []).map((x) => (typeof x === 'string' ? x : x.mis_municipios));
      },
      // Reportes: las vistas rep_* respetan los permisos de quien consulta
      async reportes() {
        const todo = async (vista, orden) => {
          let filas = [];
          for (let i = 0; ; i += 1000) {
            const r = ok(await sb.from(vista).select('*').order(orden[0]).order(orden[1]).range(i, i + 999));
            filas = filas.concat(r);
            if (r.length < 1000) return filas;
          }
        };
        const [predios, lotes, finca, plan, elementos] = await Promise.all([
          todo('rep_predios', ['municipio', 'cod_predio']), todo('rep_lotes', ['municipio', 'cod_lote']),
          todo('rep_finca_sonada', ['municipio', 'cod_predio']), todo('rep_plan_accion', ['municipio', 'cod_predio']),
          todo('rep_elementos', ['municipio', 'cod_predio']).catch(() => [])]);
        return { predios, lotes, finca, plan, elementos };
      },
      async planDe(predioId) {
        const r = await sb.from('plan_accion').select('*').eq('predio_id', predioId).order('creado_en');
        return r.error ? [] : r.data;
      },
      async guardarAccion(o) {
        const datos = tomar(o, CAMPOS_ACCION);
        const q = o.id ? sb.from('plan_accion').update(datos).eq('id', o.id) : sb.from('plan_accion').insert(datos);
        return ok(await q.select('id').single()).id;
      },
      async borrarAccion(id) {
        const r = ok(await sb.from('plan_accion').delete().eq('id', id).select('id'));
        if (!r || !r.length) throw new Error('No tiene permiso para eliminar esta acción.');
      },
      async borrarLote(id) {
        const r = ok(await sb.from('lote').delete().eq('id', id).select('id'));
        if (!r || !r.length) throw new Error('No tiene permiso para eliminar este lote (es de otro departamento).');
      },
      // Elimina el predio con sus lotes, elementos y ficha. Las encuestas se conservan.
      async borrarPredio(id) {
        await sb.storage.from('fichas').remove([id + '/ficha.pdf']).catch(() => {});
        const r = ok(await sb.from('predio').delete().eq('id', id).select('id'));
        if (!r || !r.length) throw new Error('No tiene permiso para eliminar este predio (es de otro departamento).');
      },

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
      },

      // Planchas de cartografía social (almacenamiento privado «planchas»: <cod_predio>.jpg)
      async planchas() {
        const r = await sb.from('plancha').select('etiqueta,sur,oeste,norte,este,estado,nota,subida_en,predio:predio_id(cod_predio)');
        if (r.error && /does not exist|schema cache/i.test(r.error.message)) return [];
        return ok(r).map((x) => Object.assign({ cod_predio: x.predio && x.predio.cod_predio }, x));
      },
      async urlPlancha(cod) {
        const { data, error } = await sb.storage.from('planchas').createSignedUrl(cod + '.jpg', 600);
        return error ? null : data.signedUrl;
      },
      async subirPlancha(cod, blob) {
        const { error } = await sb.storage.from('planchas')
          .upload(cod + '.jpg', blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
        if (error) throw new Error(/row-level|permission|not authorized|403/i.test(error.message)
          ? 'Solo el administrador puede subir planchas.' : error.message);
        const pr = await sb.from('predio').select('id').eq('cod_predio', cod).maybeSingle();
        if (pr.data) await sb.from('plancha').update({ subida_en: new Date().toISOString() }).eq('predio_id', pr.data.id);
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
      const ls = D.lotes.filter((l) => l.predio_id === p.id && l.escenario !== 'propuesto');
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
      }, revision(p, ls));
    }
    // Misma revisión de calidad que productores.revision_predio() en la base
    function revision(p, ls) {
      const v = D.veredas.find((x) => x.id === p.vereda_id);
      const sig = p.geom ? areaHa(p.geom) : null;
      const enLotes = ls.reduce((s, l) => s + (l.geom ? areaHa(l.geom) : (l.area_declarada_ha || 0)), 0);
      const carac = (D.caracterizaciones || []).some((c) => c.predio_id === p.id && c.estado === 'procesada');
      const ficha = (D.fichas || {})[p.id];
      const pend = [];
      if (!p.geom) pend.push('R:Falta dibujar el límite del predio');
      if (!carac) pend.push('R:Falta la caracterización (encuesta Kobo)');
      if (!p.vereda_id) pend.push('A:Sin vereda asignada');
      else if (v && v.validada === false) pend.push('A:La vereda está por validar');
      if (p.geom && !ls.some((l) => l.geom)) pend.push('A:Sin lotes dibujados');
      if (p.area_declarada_ha > 0 && sig > 0 && Math.abs(sig - p.area_declarada_ha) / p.area_declarada_ha > 0.3) {
        pend.push('A:El área SIG difiere más de 30 % del área declarada');
      }
      if (sig > 0 && enLotes > sig * 1.001) pend.push('A:Los lotes suman más área que el predio');
      if (p.gps_precision_m > 15) pend.push('A:Punto GPS de baja precisión (más de 15 m)');
      if (p.geom && !ficha) pend.push('A:Sin ficha predial guardada');
      const calidad = pend.some((x) => x.startsWith('R:')) ? 'rojo' : (pend.length ? 'amarillo' : 'verde');
      return { calidad, pendientes: pend };
    }
    // Tablero calculado en el navegador (mismo formato que productores.tablero())
    function tableroDemo(codDpto) {
      const ps = D.predios.filter((p) => !codDpto || String(p.cod_mpio).slice(0, 2) === codDpto).map(vPredio);
      const carac = (p) => (D.caracterizaciones || []).some((c) => c.predio_id === p.id && c.estado === 'procesada');
      const ficha = (p) => !!(D.fichas || {})[p.id];
      const ids = new Set(ps.map((p) => p.id));
      const lotes = D.lotes.filter((l) => ids.has(l.predio_id) && l.escenario !== 'propuesto').map(vLote);
      const suma = (a, f) => Math.round(a.reduce((s, x) => s + (Number(f(x)) || 0), 0) * 100) / 100;
      const resumen = (a) => ({ predios: a.length, caracterizados: a.filter(carac).length,
        delimitados: a.filter((p) => p.geojson).length, con_ficha: a.filter(ficha).length, ha_sig: suma(a, (p) => p.area_sig_ha) });
      const grupo = (a, k) => a.reduce((m, x) => { (m[k(x)] = m[k(x)] || []).push(x); return m; }, {});
      const dptos = D.departamentos.filter((d) => !codDpto || d.cod_dpto === codDpto)
        .filter((d) => ps.some((p) => String(p.cod_mpio).startsWith(d.cod_dpto)) || (D.metas || {})[d.cod_dpto]);
      const hoy = new Date(); const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      const semanas = [];
      for (let i = 11; i >= 0; i--) { const s = new Date(lunes); s.setDate(lunes.getDate() - 7 * i); semanas.push(s.toISOString().slice(0, 10)); }
      const pend = {};
      ps.forEach((p) => p.pendientes.forEach((t) => { pend[t] = (pend[t] || 0) + 1; }));
      return {
        generado_en: new Date().toISOString(),
        totales: Object.assign(resumen(ps), {
          productores: new Set(ps.map((p) => p.productor_id)).size,
          verde: ps.filter((p) => p.calidad === 'verde').length, amarillo: ps.filter((p) => p.calidad === 'amarillo').length,
          rojo: ps.filter((p) => p.calidad === 'rojo').length, lotes: lotes.length, ha_lotes: suma(lotes, (l) => l.area_sig_ha || l.area_declarada_ha) }),
        departamentos: dptos.map((d) => Object.assign({ cod_dpto: d.cod_dpto, nombre: d.nombre },
          resumen(ps.filter((p) => String(p.cod_mpio).startsWith(d.cod_dpto))),
          { meta_predios: ((D.metas || {})[d.cod_dpto] || {}).predios ?? null,
            meta_hectareas: ((D.metas || {})[d.cod_dpto] || {}).hectareas ?? null })),
        municipios: Object.entries(grupo(ps, (p) => p.cod_mpio)).map(([cod, a]) => Object.assign({ cod_mpio: cod,
          municipio: a[0].municipio, departamento: (D.departamentos.find((d) => cod.startsWith(d.cod_dpto)) || {}).nombre,
          rojo: a.filter((p) => p.calidad === 'rojo').length, amarillo: a.filter((p) => p.calidad === 'amarillo').length }, resumen(a))),
        tecnicos: [Object.assign({ tecnico: 'Usuario de demostración', por_corregir: ps.filter((p) => p.calidad !== 'verde').length }, resumen(ps))],
        cultivos: Object.entries(grupo(lotes, (l) => l.cultivo || 'Sin cultivo')).map(([c, a]) => ({ cultivo: c,
          tipo: a[0].tipo_cobertura || 'Otro', lotes: a.length, ha: suma(a, (l) => l.area_sig_ha || l.area_declarada_ha) }))
          .sort((a, b) => b.ha - a.ha),
        pendientes: Object.entries(pend).map(([t, n]) => ({ pendiente: t.slice(2), nivel: t.startsWith('R:') ? 'rojo' : 'amarillo', predios: n }))
          .sort((a, b) => b.predios - a.predios),
        semanas: semanas.map((s, i) => ({ semana: s, caracterizados: i === 11 ? ps.filter(carac).length : 0,
          delimitados: i >= 9 ? Math.max(0, ps.filter((p) => p.geojson).length - (11 - i)) : 0 }))
      };
    }
    function vLote(l) {
      const p = D.predios.find((x) => x.id === l.predio_id) || {};
      const cu = D.cultivos.find((c) => c.id === l.cultivo_id) || {};
      const z = (D.zonasPPS || []).find((x) => x.id === +l.zona_pps_id) || {};
      const area = l.geom ? areaHa(l.geom) : null;
      return Object.assign({}, l, {
        escenario: l.escenario || 'actual', zona_pps: z.nombre || null, zona_color: z.color || null,
        geojson: l.geom || null,
        area_sig_ha: area,
        cod_predio: p.cod_predio, predio: p.nombre,
        cultivo: cu.nombre || null, tipo_cobertura: cu.tipo || null,
        edad_meses: edadMeses(l.fecha_siembra)
      }, siembra(l, area));
    }
    function vElemento(e, geometria) {
      const t = D.tiposElemento.find((x) => x.id === +e.tipo_id) || {};
      const r = Object.assign({}, e, { tipo: t.nombre, grupo: t.grupo, geojson: e.geom, escenario: e.escenario || 'actual' });
      if (geometria === 'linea') r.longitud_m = Math.round(longitudM(e.geom) * 10) / 10;
      else { r.latitud = e.geom.coordinates[1]; r.longitud = e.geom.coordinates[0]; }
      return r;
    }
    D.tiposElemento = D.tiposElemento || [];
    D.elementosLinea = D.elementosLinea || [];
    D.elementosPunto = D.elementosPunto || [];
    const multi = (g) => (g && g.type === 'Polygon') ? { type: 'MultiPolygon', coordinates: [g.coordinates] } : g;
    // Registro de lo que hace el usuario en la demostración (equivale a las columnas de auditoría)
    D.actividad = D.actividad || [];
    const registrar = (predioId, accion) => { if (predioId) D.actividad.push({ predio_id: predioId, accion, fecha: new Date().toISOString() }); };

    return {
      demo: true,
      async sesion() { return null; },
      async ingresar(correo) { return espera({ id: 'demo', email: correo }); },
      async salir() {},
      async cambiarClave() { return espera(); },
      async perfil() {
        let acepto = null;
        try { acepto = localStorage.getItem('sip_demo_acepto_datos'); } catch (e) { /* sin almacenamiento */ }
        return { nombre: 'Usuario de demostración', rol: 'admin', activo: true, acepto_datos_en: acepto };
      },

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
        if (o.id) {
          Object.assign(D.predios.find((p) => p.id === o.id), datos);
          registrar(o.id, geom !== undefined ? 'Delimitó el límite' : 'Editó los datos del predio');
          return espera(o.id);
        }
        if (!datos.cod_mpio) throw new Error('Seleccione el municipio.');
        const consecutivo = D.predios.filter((p) => p.cod_mpio === datos.cod_mpio).length + 1;
        const p = Object.assign({ id: nuevoId(), creado_por: 'demo',
          cod_predio: datos.cod_mpio + '-' + String(consecutivo).padStart(4, '0') }, datos);
        D.predios.push(p);
        registrar(p.id, 'Registró el predio');
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
        if (actual) {
          delete datos.predio_id; delete datos.escenario; Object.assign(actual, datos);
          registrar(actual.predio_id, 'Editó ' + (actual.escenario === 'propuesto' ? 'lote propuesto ' : 'lote ') + actual.cod_lote.slice(-3));
          return espera(actual.id);
        }
        const esc = datos.escenario === 'propuesto' ? 'propuesto' : 'actual';
        const num = D.lotes.filter((l) => l.predio_id === predioId && (l.escenario || 'actual') === esc)
          .reduce((m, l) => Math.max(m, l.num_lote), 0) + 1;
        const l = Object.assign({ id: nuevoId(), creado_por: 'demo', num_lote: num,
          cod_lote: predio.cod_predio + (esc === 'propuesto' ? '-P' : '-L') + String(num).padStart(2, '0') }, datos, { escenario: esc });
        registrar(predioId, 'Agregó ' + (esc === 'propuesto' ? 'lote propuesto ' : 'lote ') + l.cod_lote.slice(-3));
        D.lotes.push(l);
        return espera(l.id);
      },
      async borrarLote(id) {
        D.lotes = D.lotes.filter((l) => l.id !== id);
        (D.plan || []).forEach((a) => { if (a.lote_id === id) a.lote_id = null; });   // como «on delete set null»
        return espera();
      },
      async lotesBajo() { return espera([]); },          // en demostración no se calculan superposiciones
      async abrirEspacio() { return espera(0); },

      // ---------- Planificación Predial Sostenible
      async catalogosPPS() {
        return espera({ zonas: D.zonasPPS || [], acciones: D.accionesPPS || [], apoyos: D.apoyosPPS || [] });
      },
      async misMunicipios() { return espera(null); },
      async misRecientes() {
        const ult = {};
        D.actividad.forEach((a) => { const u = ult[a.predio_id]; ult[a.predio_id] = { a, cambios: (u ? u.cambios : 0) + 1 }; });
        return espera(Object.values(ult).sort((x, y) => (x.a.fecha < y.a.fecha ? 1 : -1)).map(({ a, cambios }) => {
          const p = D.predios.find((x) => x.id === a.predio_id);
          if (!p) return null;
          const v = vPredio(p);
          return { predio_id: p.id, productor_id: p.productor_id, cod_predio: p.cod_predio, nombre: p.nombre, productor: v.productor,
            vereda: v.vereda, municipio: v.municipio, accion: a.accion, fecha: a.fecha, cambios, delimitado: !!p.geom };
        }).filter(Boolean));
      },
      async reportes() {
        const base = (p) => {
          const v = vPredio(p);
          const dp = D.departamentos.find((d) => String(p.cod_mpio).startsWith(d.cod_dpto)) || {};
          return { departamento: dp.nombre, municipio: v.municipio, vereda: v.vereda, propietario: v.productor,
            finca: p.nombre, cod_predio: p.cod_predio, codigo_zap: p.cod_humboldt || null };
        };
        const predios = D.predios.map((p) => { const v = vPredio(p); return Object.assign(base(p), { tenencia: v.tenencia,
          area_declarada_ha: p.area_declarada_ha || null, area_sig_ha: v.area_sig_ha,
          estado_limite: p.geom ? 'Delimitado' : 'Pendiente de delimitar', lotes: v.n_lotes }); });
        const lotes = D.lotes.map((l) => {
          const v = vLote(l), p = D.predios.find((x) => x.id === l.predio_id);
          const pt = l.geom ? centro(l.geom) : null, en = pt ? a9377(pt[0], pt[1]) : null;
          return Object.assign({ escenario: v.escenario }, base(p), { cod_lote: l.cod_lote, uso: v.cultivo,
            tipo_cobertura: v.tipo_cobertura || 'Sin clasificar', zona_pps: v.zona_pps, cobertura_clc: l.cobertura_clc || null,
            sistema: l.sistema || null, estado: l.estado || null, variedad: l.variedad || null,
            area_sig_ha: v.area_sig_ha, area_declarada_ha: l.area_declarada_ha || null,
            latitud: pt ? +pt[1].toFixed(6) : null, longitud: pt ? +pt[0].toFixed(6) : null,
            este_9377: en ? +en[0].toFixed(1) : null, norte_9377: en ? +en[1].toFixed(1) : null, observaciones: l.observaciones || null });
        });
        const zonaHa = (pid, cod) => Math.round(D.lotes.filter((l) => l.predio_id === pid && l.escenario === 'propuesto' &&
          (cod === null ? !l.zona_pps_id : ((D.zonasPPS || []).find((z) => z.id === +l.zona_pps_id) || {}).codigo === cod))
          .reduce((t, l) => t + (l.geom ? areaHa(l.geom) : 0), 0) * 10000) / 10000;
        const plan = D.plan || [];
        const finca = D.predios.filter((p) => p.vision_familia || p.fecha_taller || plan.some((a) => a.predio_id === p.id)
          || D.lotes.some((l) => l.predio_id === p.id && l.escenario === 'propuesto')).map((p) => {
          const prop = D.lotes.filter((l) => l.predio_id === p.id && l.escenario === 'propuesto');
          return Object.assign(base(p), { area_predio_ha: vPredio(p).area_sig_ha, vision_familia: p.vision_familia || null,
            fecha_taller: p.fecha_taller || null, participantes_hombres: p.participantes_hombres ?? null,
            participantes_mujeres: p.participantes_mujeres ?? null, participantes_jovenes: p.participantes_jovenes ?? null,
            puntaje_seleccion: puntaje(p), lotes_propuestos: prop.length,
            ha_propuesta: Math.round(prop.reduce((t, l) => t + (l.geom ? areaHa(l.geom) : 0), 0) * 10000) / 10000,
            ha_preservacion: zonaHa(p.id, 'preservacion'), ha_restauracion: zonaHa(p.id, 'restauracion'),
            ha_recuperacion: zonaHa(p.id, 'recuperacion'), ha_produccion_sostenible: zonaHa(p.id, 'produccion_sostenible'),
            ha_sin_zona: zonaHa(p.id, null), acciones: plan.filter((a) => a.predio_id === p.id).length,
            acciones_concertadas: plan.filter((a) => a.predio_id === p.id && a.estado === 'concertado').length });
        });
        const planRep = plan.map((a) => {
          const p = D.predios.find((x) => x.id === a.predio_id), c = (D.accionesPPS || []).find((x) => x.id === +a.accion_id) || {};
          const l = D.lotes.find((x) => x.id === a.lote_id);
          const li = a.elemento_linea_id ? D.elementosLinea.find((x) => x.id === a.elemento_linea_id) : null;
          const tl = li ? (D.tiposElemento.find((x) => x.id === +li.tipo_id) || {}).nombre : null;
          return Object.assign(base(p), { tipo: c.tipo, accion: c.nombre, lote: l ? l.cod_lote : null, cantidad: a.cantidad ?? null,
            linea: li ? `${tl}${li.nombre ? ' · ' + li.nombre : ''} (${Math.round(longitudM(li.geom))} m)` : null,
            unidad: a.unidad || null, plazo: a.plazo || null, prioridad: a.prioridad || null, estado: a.estado,
            apoyos: (a.apoyos || []).map((x) => ((D.apoyosPPS || []).find((y) => y.codigo === x) || {}).nombre || x).join(', ') || null,
            responsable: a.responsable || null, observaciones: a.observaciones || null });
        });
        const elementos = D.elementosLinea.map((e) => ['Línea', e]).concat(D.elementosPunto.map((e) => ['Punto', e])).map(([g, e]) => {
          const p = D.predios.find((x) => x.id === e.predio_id), t = D.tiposElemento.find((x) => x.id === +e.tipo_id) || {};
          const c = e.geom.type === 'Point' ? e.geom.coordinates : (e.geom.coordinates[0] || [])[Math.floor(((e.geom.coordinates[0] || []).length - 1) / 2)];
          const en = c ? a9377(c[0], c[1]) : null;
          return Object.assign({ escenario: e.escenario || 'actual' }, base(p), { geometria: g, grupo: t.grupo, tipo: t.nombre,
            nombre: e.nombre || null, longitud_m: g === 'Línea' ? Math.round(longitudM(e.geom) * 10) / 10 : null,
            latitud: c ? +c[1].toFixed(6) : null, longitud: c ? +c[0].toFixed(6) : null,
            este_9377: en ? +en[0].toFixed(1) : null, norte_9377: en ? +en[1].toFixed(1) : null, observaciones: e.observaciones || null });
        });
        return espera({ predios, lotes, finca, plan: planRep, elementos });
      },
      async ppsPredio(predioId) {
        const p = D.predios.find((x) => x.id === predioId) || {};
        const r = tomar(p, CAMPOS_PPS_PREDIO);
        r.puntaje_seleccion = puntaje(p);
        return espera(r);
      },
      async copiarLotes(predioId) {
        if (D.lotes.some((l) => l.predio_id === predioId && l.escenario === 'propuesto')) {
          throw new Error('Este predio ya tiene lotes propuestos. Elimínelos antes de volver a copiar.');
        }
        const predio = D.predios.find((p) => p.id === predioId);
        const fuente = D.lotes.filter((l) => l.predio_id === predioId && (l.escenario || 'actual') === 'actual' && l.geom)
          .sort((a, b) => a.num_lote - b.num_lote);
        fuente.forEach((l, i) => D.lotes.push({ id: nuevoId(), creado_por: 'demo', predio_id: predioId, escenario: 'propuesto',
          num_lote: i + 1, cod_lote: predio.cod_predio + '-P' + String(i + 1).padStart(2, '0'),
          cultivo_id: l.cultivo_id, variedad: l.variedad, sistema: l.sistema, sombrio: l.sombrio,
          zona_pps_id: l.zona_pps_id || null, cobertura_clc: l.cobertura_clc || null,
          observaciones: 'Copiado de ' + l.cod_lote, geom: JSON.parse(JSON.stringify(l.geom)) }));
        if (fuente.length) registrar(predioId, 'Agregó lote propuesto P' + String(fuente.length).padStart(2, '0'));
        return espera(fuente.length);
      },
      async planDe(predioId) {
        D.plan = D.plan || [];
        return espera(D.plan.filter((a) => a.predio_id === predioId).map((a) => Object.assign({}, a)));
      },
      async guardarAccion(o) {
        D.plan = D.plan || [];
        const datos = tomar(o, CAMPOS_ACCION);
        const actual = o.id ? D.plan.find((a) => a.id === o.id) : null;
        const predioId = actual ? actual.predio_id : datos.predio_id;
        if (datos.lote_id && !D.lotes.some((l) => l.id === datos.lote_id && l.predio_id === predioId)) {
          throw new Error('El lote elegido no pertenece a este predio.');
        }
        const lin = datos.elemento_linea_id ? D.elementosLinea.find((e) => e.id === datos.elemento_linea_id && e.predio_id === predioId) : null;
        if (datos.elemento_linea_id && !lin) throw new Error('La línea elegida no pertenece a este predio.');
        const cat = (D.accionesPPS || []).find((a) => a.id === +(datos.accion_id || (actual && actual.accion_id)));
        if (!datos.unidad && cat) datos.unidad = cat.unidad;
        if (lin && datos.cantidad == null && datos.unidad === 'm') datos.cantidad = Math.round(longitudM(lin.geom));
        if (actual) { delete datos.predio_id; Object.assign(actual, datos); return espera(actual.id); }
        const a = Object.assign({ id: nuevoId(), creado_por: 'demo', creado_en: new Date().toISOString(),
          estado: 'borrador', apoyos: [] }, datos);
        registrar(a.predio_id, 'Plan: ' + ((cat || {}).nombre || 'acción'));
        D.plan.push(a);
        return espera(a.id);
      },
      async borrarAccion(id) { D.plan = (D.plan || []).filter((a) => a.id !== id); return espera(); },

      async borrarPredio(id) {
        D.predios = D.predios.filter((p) => p.id !== id);
        D.lotes = D.lotes.filter((l) => l.predio_id !== id);
        if (D.plan) D.plan = D.plan.filter((a) => a.predio_id !== id);
        ['elementosLinea', 'elementosPunto'].forEach((k) => { if (D[k]) D[k] = D[k].filter((e) => e.predio_id !== id); });
        if (D.fichas) delete D.fichas[id];
        return espera();
      },

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
        if (actual) { delete datos.predio_id; delete datos.escenario; Object.assign(actual, datos); return espera(actual.id); }
        if (!datos.geom) throw new Error('Dibuje el elemento en el mapa.');
        datos.escenario = datos.escenario === 'propuesto' ? 'propuesto' : 'actual';
        registrar(datos.predio_id, 'Elemento: ' + ((D.tiposElemento.find((t) => t.id === +datos.tipo_id) || {}).nombre || ''));
        const e = Object.assign({ id: nuevoId(), creado_por: 'demo', creado_en: new Date().toISOString() }, datos);
        lista.push(e);
        return espera(e.id);
      },
      async borrarElemento(geometria, id) {
        (D.plan || []).forEach((a) => { if (a.elemento_linea_id === id) a.elemento_linea_id = null; });
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
        registrar(predioId, 'Guardó la ficha predial');
        return espera(D.fichas[predioId]);
      },
      async fichaDe(predioId) { return espera((D.fichas || {})[predioId] || null); },
      async tablero(codDpto) { return espera(tableroDemo(codDpto)); },
      async guardarMeta(codDpto, predios, hectareas) {
        D.metas = D.metas || {}; D.metas[codDpto] = { predios, hectareas }; return espera();
      },
      async aceptarDatos() {
        const f = new Date().toISOString();
        try { localStorage.setItem('sip_demo_acepto_datos', f); } catch (e) { /* sin almacenamiento */ }
        return espera(f);
      },
      async urlFicha(predioId) { return espera(((D.fichas || {})[predioId] || {}).url); },
      async planchas() { return espera(D.planchas || []); },
      async urlPlancha(cod) { return espera((D.planchasUrl || {})[cod] || null); },
      async subirPlancha(cod, blob) {
        D.planchasUrl = D.planchasUrl || {}; D.planchasUrl[cod] = URL.createObjectURL(blob); return espera();
      }
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
  window.SIP_GEO = { areaHa, longitudM, siembra, anillosDe, normalizar, a9377, areaAnillo9377, dist9377, puntaje };
})();
