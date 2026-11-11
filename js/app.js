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
    lotesProp: [],            // lotes propuestos: la finca soñada (escenario «propuesto»)
    elementosProp: { lineas: [], puntos: [], areas: [] },   // líneas y puntos propuestos (cercas vivas, barreras…)
    pps: null,                // catálogos PPS (zonas, acciones, apoyos); null si la base aún no los tiene
    ppsPredio: {},            // prospectiva y selección del predio abierto
    plan: [], accion: null,   // plan de acción del predio abierto y acción seleccionada
    vistaMapa: 'actual',      // 'actual' | 'propuesto' | 'ambos'
    elementos: { lineas: [], puntos: [], areas: [] }, elemento: null,
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

  // ------------------------------------------------------- Ayudas para el técnico
  // Texto corto bajo cada campo (solo mientras se edita) y guías por tarjeta.
  // Zonas del mapa futuro con la explicación sencilla del equipo (tabla 2)
  const ZONAS_AYUDA = () => ((S.pps && S.pps.zonas) || []).map((z) =>
    `${z.nombre}: «${(z.explicacion || '').toLowerCase()}»${z.ejemplos ? ' (' + z.ejemplos.replace(/\.$/, '') + ')' : ''}.`).join(' ');
  const AYUDA = {
    productor: {
      tipo_doc: 'Tal como aparece en el documento.',
      num_doc: 'Solo números, sin puntos ni espacios. Si empieza por PEND-, cámbielo por la cédula real.',
      nombres: 'Solo los nombres, como en la cédula.',
      apellidos: 'Los apellidos, separados de los nombres.',
      fecha_nac: 'Opcional.',
      telefono: 'Celular para coordinar la segunda visita.',
      asociacion: 'Asociación o JAC a la que pertenece, si aplica.'
    },
    predio: {
      nombre: 'Como lo llama la familia (ej.: Coralito).',
      vereda_id: 'Si no aparece, use «＋ Agregar vereda…»: quedará por validar.',
      tenencia_id: 'Relación de la familia con la tierra: propietario (con escritura), poseedor (sin título), arrendatario…',
      area_declarada_ha: 'Lo que dice la familia o el documento. No la cambie por el área SIG: las dos se comparan.',
      altitud_msnm: 'Metros sobre el nivel del mar (encuesta o GPS).',
      como_llegar: 'Desde la cabecera municipal: vía, distancia, tiempo y referencias (escuela, puente, tienda).'
    },
    lote: {
      cultivo_id: 'Lo que hay HOY en el lote: cultivo, pasto, bosque, humedal, rastrojo… Un solo uso por lote.',
      variedad: 'Si es cultivo: variedad o clon (ej.: CCN-51 en cacao).',
      fecha_siembra: 'Aproximada si no la recuerdan.',
      estado: 'Etapa del cultivo hoy.',
      area_declarada_ha: 'Lo que dice la familia. El área SIG sale del dibujo.',
      dist_surcos_m: 'Metros entre surcos. Con la distancia entre plantas se calculan los sitios.',
      dist_plantas_m: 'Metros entre plantas dentro del surco.',
      trazado: 'Cuadro (en filas) o tresbolillo (en triángulo).',
      num_plantas: 'Plantas vivas, contadas o estimadas.',
      sistema: 'Cómo está sembrado: a libre exposición, con sombra, agroforestal…',
      observaciones: 'Lo útil para planificar: plagas, pendiente, encharcamiento, quema…'
    },
    loteprop: {
      zona_pps_id: ZONAS_AYUDA,
      cultivo_id: 'Qué habrá aquí en 10 años: cacao, forraje, bosque, regeneración natural…',
      cobertura_clc: 'Opcional: nombre o código Corine Land Cover, si el proyecto lo pide.',
      observaciones: 'Para qué es este lote, con las palabras de la familia (ej.: «banco de forraje para el ganado»).'
    },
    prospectiva: {
      vision_familia: 'Una o dos frases que resuman la finca que sueñan, con sus palabras.',
      vision_cambios: 'Separe lo que quieren lograr en 3, en 6 y en 10 años.',
      fecha_taller: 'Día en que se conversó la visión (al cerrar la visita 1).',
      participantes_hombres: 'Solo el número de personas.',
      participantes_mujeres: 'Solo el número de personas.',
      participantes_jovenes: 'Jóvenes de 14 a 28 años. Solo el número.'
    },
    contexto: {
      sistema_principal_id: 'La actividad de la que más vive la familia: ganadería, café, cacao, piscicultura, caña…',
      microcuenca: 'La quebrada o río que recoge el agua del predio (ej.: microcuenca quebrada La Ceiba).',
      relacion_area_protegida: 'Si el predio está dentro, en la zona de amortiguación o cerca de un parque o reserva.',
      area_protegida: 'Ej.: Parque Nacional Natural Alto Fragua Indi Wasi.'
    },
    seleccion: {
      crit_ambiental: 'De 0 a 100, según la matriz de selección del proyecto.',
      crit_territorio: 'De 0 a 100, según la matriz de selección del proyecto.',
      crit_mejora: 'De 0 a 100, según la matriz de selección del proyecto.',
      hab_voluntaria: 'Según lo verificado en la visita.',
      hab_arraigo: 'Según lo verificado en la visita.',
      hab_acceso: 'Según lo verificado en la visita.',
      hab_jac: 'Según lo verificado en la visita.'
    },
    accion: {
      accion_id: 'Elija del catálogo lo que acordaron. Una acción por fila. Si eligió el lote, arriba salen las recomendadas para su cultivo.',
      lote_id: 'Primero el lote donde se hará (vacío si es para toda la finca): así la lista de acciones muestra arriba las de su cultivo.',
      elemento_linea_id: 'Para cercas, barreras, aislamientos o divisiones: la línea propuesta. Si deja la cantidad vacía, se usa su longitud.',
      cantidad: 'Cuánto: hectáreas, metros, árboles, colmenas… según la unidad.',
      unidad: 'Se llena sola con la del catálogo.',
      plazo: 'Como en la visión: corto, hasta 3 años; mediano, de 4 a 6; largo, de 7 a 10.',
      prioridad: '1 = lo primero que harían si llega el apoyo.',
      estado: '«Concertado» solo cuando la familia esté de acuerdo (visita 2).',
      apoyos: 'Lo que necesitarían para hacerlo. Marque todos los que apliquen.',
      responsable: 'Quién de la familia lo hace (sin nombres de menores de edad).'
    },
    elemento: {
      tipo_id: 'Qué es: quebrada, camino, nacimiento, vivienda… En la finca soñada: cerca viva, barrera viva, aislamiento, división de potreros.',
      nombre: 'Nombre local si tiene (ej.: quebrada La Ceiba).',
      permanencia: 'Para el agua: ¿corre todo el año (permanente) o solo en invierno (intermitente)?',
      estado: 'Cómo está hoy.'
    }
  };
  const GUIAS = {
    limite: ['Cómo delimitar el predio', [
      'Con la familia, señale el lindero sobre la imagen satelital; acérquese al máximo.',
      'Use «Dibujar límite» y haga clic en cada esquina; termine en el primer punto.',
      'Apóyese en cercas, quebradas y caminos que se ven en la imagen.',
      'Si tiene un archivo (GPS, KML, shapefile), cárguelo con el botón de carpeta del mapa.',
      'Confirme el área con la familia: si difiere mucho de la declarada, revise el dibujo.']],
    lotes: ['Cómo dibujar los lotes de hoy', [
      'Sistemas productivos: un lote por cada uno (ganadería, café, cacao, piscicultura, caña, maíz, frutales amazónicos, yuca, plátano, caucho) y el pancoger o la huerta.',
      'Áreas de conservación: bosque (monte) y rastrojo (regeneración natural) también son lotes.',
      'Dibújelos dentro del predio: lo que se salga se recorta solo y los lotes no se montan entre sí.',
      'Cubra todo el predio: «Total en lotes» debe quedar cerca del área del predio.',
      'Los lotes de hoy son la base de la finca soñada.']],
    elementos: ['Qué se ubica en el mapa actual', [
      'Infraestructura: vivienda, establos, sitio de procesamiento de leche, secaderos de café o cacao, estanques, trapiche, galpón (puntos) y vías de acceso (líneas).',
      'Recurso hídrico: nacimientos u ojos de agua (puntos) y quebradas, caños o ríos (líneas). La microcuenca va en la pestaña Predio.',
      'Zonas de riesgo: pendientes fuertes, zonas que se inundan, deslizamientos o agrietamientos (como punto, o como zona con «＋ Zona» si abarcan un área).',
      'Conflictos de uso: donde el uso no corresponde al terreno, por ejemplo ganado en el ojo de agua o en pendientes fuertes (punto o zona, y descríbalo en observaciones).']],
    vision: ['Cómo conversar la visión de futuro (al cerrar la visita 1)', [
      'Haga las preguntas de cada aspecto en orden: ambiental, productivo, alimentación, infraestructura y bienestar, cambios prioritarios, capacidades y apoyos.',
      'Escriba lo que dice la familia, con sus palabras, sin traducir a términos técnicos.',
      'En «cambios prioritarios» separe lo que quieren a 3, 6 y 10 años: así se ordena el plan de acción.',
      'Al final, resuma la finca soñada en una o dos frases.']],
    finca: ['Cómo dibujar la finca soñada (entre visitas)', [
      'Parta de la visión: cada respuesta de la familia debe verse en el mapa (un lote, una línea o un punto).',
      'Puede copiar los lotes de hoy y ajustarlos, o dibujar desde cero.',
      ZONAS_AYUDA,
      'Lo que la familia no mencionó queda como pregunta para la visita 2.']],
    lineasProp: ['Líneas de la finca soñada (herramientas de manejo del paisaje)', [
      'Cerca viva: árboles o arbustos sembrados como cerca, en linderos o alrededor de potreros.',
      'Barrera viva: hileras de plantas en curva de nivel, en pendientes, para frenar la erosión.',
      'Aislamiento de área de conservación: cerca que protege un bosque, nacimiento, humedal o ronda del ganado.',
      'División de potreros con árboles: cerca con árboles que divide un potrero grande para rotar el ganado.',
      'Dibuje cada tramo por donde iría; la longitud se calcula sola y sirve como cantidad en el plan de acción.']],
    plan: ['Cómo armar el plan de acción', [
      'Entre visitas: para cada lote propuesto, ¿qué hay que hacer para llegar ahí? Déjelo en borrador.',
      'En la visita 2: revíselo con la familia; ajuste cantidad, plazo y prioridad.',
      'Marque «Concertado» solo lo que la familia acepta hacer.',
      'Los apoyos son lo que necesitarían del proyecto o de aliados.']],
    seleccion: ['Cómo diligenciar la selección', [
      'Use la matriz de selección del proyecto para cada criterio, de 0 a 100.',
      'El puntaje se calcula solo: 35 % ambiental, 35 % territorio, 30 % mejora.',
      'Los habilitantes son condiciones para entrar: márquelos según lo verificado en la visita.']]
  };
  function guia(clave, abierta) {
    const g = GUIAS[clave];
    if (!g) return '';
    return `<details class="guia"${abierta ? ' open' : ''}><summary>💡 ${esc(g[0])}</summary>
      <ul>${g[1].map((t) => `<li>${esc(typeof t === 'function' ? t() : t)}</li>`).join('')}</ul></details>`;
  }

  // ------------------------------------------------------- Definición de campos
  const SI_NO = () => [['true', 'Sí'], ['false', 'No']];
  const TIPOS_ACCION = ['Conservación', 'Restauración', 'Producción sostenible', 'Diversificación'];
  const PLAZO = { corto: 'Corto', mediano: 'Mediano', largo: 'Largo' };
  const nomLote = (l) => (l.escenario === 'propuesto' ? 'P' : 'L') + String(l.num_lote).padStart(2, '0');
  // Lotes que puede usar una acción: primero los de la finca soñada, luego los actuales
  // Acciones del catálogo; las del sistema productivo (cultivo) del lote elegido van primero
  function opcionesAccion(loteId) {
    const lote = loteId ? S.lotesProp.concat(S.lotes).find((l) => String(l.id) === String(loteId)) : null;
    const cult = lote && lote.cultivo_id != null ? Number(lote.cultivo_id) : null;
    const rec = cult != null ? `★ Recomendadas para ${lote.cultivo || 'este lote'}` : null;
    return ((S.pps && S.pps.acciones) || []).filter((a) => a.activo || (S.accion && S.accion.accion_id === a.id))
      .map((a) => [a.id, a.nombre, rec && (a.cultivo_ids || []).map(Number).includes(cult) ? rec : a.tipo]);
  }
  function opcionesLotePlan() {
    return S.lotesProp.map((l) => [l.id, nomLote(l) + ' · ' + (l.zona_pps || 'sin zona') + (l.cultivo ? ' · ' + l.cultivo : ''), 'Finca soñada'])
      .concat(S.lotes.map((l) => [l.id, nomLote(l) + (l.cultivo ? ' · ' + l.cultivo : ''), 'Lotes actuales']));
  }
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
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001', sec: true },
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
      { k: 'variedad', l: 'Variedad', sec: true },
      { k: 'fecha_siembra', l: 'Fecha de siembra', t: 'date' },
      { k: 'edad_meses', l: 'Edad (meses)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'estado', l: 'Estado', t: 'select', op: ['Levante', 'Producción', 'Renovación', 'Zoca', 'Abandonado'] },
      { k: 'area_declarada_ha', l: 'Área declarada (ha)', t: 'number', step: '0.0001' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'dist_surcos_m', l: 'Distancia entre surcos (m)', t: 'number', step: '0.01', sec: true },
      { k: 'dist_plantas_m', l: 'Distancia entre plantas (m)', t: 'number', step: '0.01', sec: true },
      { k: 'trazado', l: 'Trazado', t: 'select', op: ['Cuadro / rectángulo', 'Tresbolillo'], sec: true },
      { k: 'densidad_ha', l: 'Densidad (plantas/ha)', ro: true, fmt: (v) => num(v, 0) },
      { k: 'num_plantas', l: 'Número de plantas', t: 'number', step: '1' },
      { k: 'sitios_estimados', l: 'Sitios estimados', ro: true, fmt: (v) => num(v, 0) },
      { k: 'ocupacion_pct', l: '% de ocupación', ro: true, fmt: (v) => v == null ? '—' : num(v, 1) + ' %' },
      { k: 'sistema', l: 'Sistema', t: 'select',
        op: ['Libre exposición', 'Semisombra', 'Sombra', 'Agroforestal', 'Silvopastoril', 'Asociado'] },
      { k: 'sombrio', l: 'Tipo de sombrío', sec: true },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ],
    // Lote de la finca soñada (escenario propuesto)
    loteprop: [
      { k: 'cod_lote', l: 'Código del lote', ro: true },
      { k: 'zona_pps_id', l: 'Zona PPS', t: 'select', req: true, n: true,
        op: () => ((S.pps && S.pps.zonas) || []).map((z) => [z.id, z.nombre + (z.explicacion ? ' — ' + z.explicacion.toLowerCase() : '')]) },
      { k: 'cultivo_id', l: 'Uso o cobertura propuesta', t: 'select', n: true,
        op: () => S.cat.cultivos.map((x) => [x.id, x.nombre, x.tipo || 'Otro']) },
      { k: 'cobertura_clc', l: 'Cobertura Corine (CLC)' },
      { k: 'area_sig_ha', l: 'Área SIG (ha)', ro: true, fmt: (v) => num(v, 4) },
      { k: 'observaciones', l: 'Qué se quiere lograr aquí', t: 'textarea', ancho: 2 }
    ],
    prospectiva: [
      { k: 'vision_ambiental', l: 'Ambiental: ¿qué bosques, fuentes de agua y áreas naturales quiere conservar o recuperar la familia?', t: 'textarea', ancho: 2 },
      { k: 'vision_productiva', l: 'Productivo: ¿qué actividades quiere mantener, mejorar, transformar o incorporar?', t: 'textarea', ancho: 2 },
      { k: 'vision_alimentacion', l: 'Alimentación: ¿qué alimentos quisiera producir para el consumo de la familia?', t: 'textarea', ancho: 2 },
      { k: 'vision_infraestructura', l: 'Infraestructura y bienestar: ¿qué mejoras necesita la finca en vivienda, agua, energía, vías o infraestructura productiva?', t: 'textarea', ancho: 2 },
      { k: 'vision_cambios', l: 'Cambios prioritarios: ¿cuáles son los principales cambios que quisiera lograr en los próximos 3, 6 y 10 años?', t: 'textarea', ancho: 2 },
      { k: 'vision_capacidades', l: 'Capacidades y apoyos: ¿con qué recursos y conocimientos cuenta la familia y qué apoyos necesitaría?', t: 'textarea', ancho: 2 },
      { k: 'vision_familia', l: 'En resumen: la finca soñada en pocas palabras', t: 'textarea', ancho: 2 },
      { k: 'fecha_taller', l: 'Fecha del taller', t: 'date' },
      { k: 'participantes_hombres', l: 'Participantes hombres', t: 'number', step: '1' },
      { k: 'participantes_mujeres', l: 'Participantes mujeres', t: 'number', step: '1' },
      { k: 'participantes_jovenes', l: 'Participantes jóvenes', t: 'number', step: '1' }
    ],
    contexto: [
      { k: 'sistema_principal_id', l: 'Sistema productivo principal', t: 'select', n: true,
        op: () => S.cat.cultivos.map((x) => [x.id, x.nombre, x.tipo || 'Otro']) },
      { k: 'microcuenca', l: 'Microcuenca a la que pertenece' },
      { k: 'relacion_area_protegida', l: 'Relación con un área protegida', t: 'select',
        op: () => ['Dentro del área protegida', 'En zona de amortiguación', 'Cerca', 'Ninguna'].map((x) => [x, x]) },
      { k: 'area_protegida', l: 'Nombre del área protegida' }
    ],
    seleccion: [
      { k: 'crit_ambiental', l: 'Criterio ambiental (0-100)', t: 'number', step: '0.01', max: 100 },
      { k: 'crit_territorio', l: 'Criterio territorio (0-100)', t: 'number', step: '0.01', max: 100 },
      { k: 'crit_mejora', l: 'Criterio mejora (0-100)', t: 'number', step: '0.01', max: 100 },
      { k: 'puntaje_seleccion', l: 'Puntaje (35/35/30)', ro: true,
        calc: (r) => (window.SIP_GEO ? window.SIP_GEO.puntaje(r) : r.puntaje_seleccion), fmt: (v) => num(v, 2) },
      { k: 'hab_voluntaria', l: 'Participa voluntariamente', t: 'select', b: true, op: SI_NO },
      { k: 'hab_arraigo', l: 'Arraigo en el territorio', t: 'select', b: true, op: SI_NO },
      { k: 'hab_acceso', l: 'Acceso al predio', t: 'select', b: true, op: SI_NO },
      { k: 'hab_jac', l: 'Aval de la JAC', t: 'select', b: true, op: SI_NO }
    ],
    accion: [
      // Primero el lote: así la lista de acciones pone arriba las de su sistema productivo
      { k: 'lote_id', l: 'Dónde (lote)', t: 'select', op: () => opcionesLotePlan() },
      { k: 'elemento_linea_id', l: 'Línea propuesta', t: 'select',
        op: () => S.elementosProp.lineas.map((e) => [e.id, `${e.tipo}${e.nombre ? ' · ' + e.nombre : ''} (${num(e.longitud_m, 0)} m)`]) },
      { k: 'accion_id', l: 'Acción', t: 'select', req: true, n: true, ancho: 2, orden: TIPOS_ACCION,
        op: () => opcionesAccion(S.accion && S.accion.lote_id) },
      { k: 'cantidad', l: 'Cantidad', t: 'number', step: '0.01' },
      { k: 'unidad', l: 'Unidad' },
      { k: 'plazo', l: 'Plazo', t: 'select', op: () => [['corto', 'Corto (hasta 3 años)'], ['mediano', 'Mediano (4 a 6 años)'], ['largo', 'Largo (7 a 10 años)']] },
      { k: 'prioridad', l: 'Prioridad', t: 'select', n: true, op: () => [[1, '1 · Alta'], [2, '2 · Media'], [3, '3 · Baja']] },
      { k: 'estado', l: 'Estado', t: 'select', req: true, op: () => [['borrador', 'Borrador'], ['concertado', 'Concertado con la familia']] },
      { k: 'apoyos', l: 'Apoyos que se requieren', t: 'checks', ancho: 2,
        op: () => ((S.pps && S.pps.apoyos) || []).filter((a) => a.activo).map((a) => [a.codigo, a.nombre]) },
      { k: 'responsable', l: 'Responsable', ancho: 2 },
      { k: 'observaciones', l: 'Observaciones', t: 'textarea', ancho: 2 }
    ],
    elemento: [
      { k: 'tipo_id', l: 'Tipo', t: 'select', req: true, n: true,
        orden: ['Paisaje (HMP)', 'Hídrico', 'Vial', 'Infraestructura', 'Riesgo', 'Conflicto de uso', 'Otro'],
        op: () => tiposDe(S.elemento && S.elemento.geometria) },
      { k: 'nombre', l: 'Nombre' },
      { k: 'estado', l: 'Estado', t: 'select', op: ['Bueno', 'Regular', 'Malo'] },
      { k: 'permanencia', l: 'Permanencia', t: 'select', op: ['Permanente', 'Intermitente'] },
      { k: 'longitud_m', l: 'Longitud (m)', ro: true, solo: 'linea', fmt: (v) => num(v, 1) },
      { k: 'area_ha', l: 'Área (ha)', ro: true, solo: 'area', fmt: (v) => num(v, 4) },
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
  let capaSimbolos, lineasConSimbolo = [];   // arbolitos y estacones sobre las cercas

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
      if (cfg.tipo === 'vias' || cfg.tipo === 'rios') return capaContexto(cfg);
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

  // ---------- Vías y ríos de contexto: debajo de todo, discretos y por jerarquía
  // c = 1 principal / río · 2 secundaria / quebrada · 3 terciaria (carreteables y trochas)
  const ESTILO_CONTEXTO = {
    vias: {
      1: { color: '#d6d0c4', w: 3.2, op: 0.75, desde: 0 },
      2: { color: '#d6d0c4', w: 2.0, op: 0.65, desde: 9 },
      3: { color: '#d6d0c4', w: 1.0, op: 0.55, desde: 12 }
    },
    rios: {
      1: { color: '#3d9bff', w: 2.0, op: 0.8, desde: 0 },
      2: { color: '#3d9bff', w: 1.0, op: 0.6, desde: 12 }
    }
  };
  let rendererContexto = null;
  function capaContexto(cfg) {
    const i = cfg.archivo;
    const est = ESTILO_CONTEXTO[cfg.tipo];
    const grupo = L.layerGroup(), clases = {};
    let cargada = false;
    rendererContexto = rendererContexto || L.canvas({ pane: 'contexto', padding: 0.3 });
    const factor = () => { const z = map.getZoom(); return z < 10 ? 0.75 : (z < 14 ? 1 : 1.4); };
    const actualizar = () => {
      if (!map.hasLayer(grupo)) return;
      const z = map.getZoom(), f = factor();
      Object.entries(clases).forEach(([c, capa]) => {
        const e = est[c];
        if (z >= e.desde) {
          if (!grupo.hasLayer(capa)) grupo.addLayer(capa);
          capa.setStyle({ weight: e.w * f });
        } else if (grupo.hasLayer(capa)) grupo.removeLayer(capa);
      });
    };
    grupo.on('add', async () => {
      grabar('sip_limite_' + i, '1');
      if (!cargada) {
        cargada = true;
        try {
          const gj = await (await fetch(cfg.archivo)).json();
          Object.keys(est).forEach((c) => {
            const e = est[c];
            clases[c] = L.geoJSON({ type: 'FeatureCollection', features: gj.features.filter((x) => String(x.properties.c) === c) }, {
              pane: 'contexto', renderer: rendererContexto, interactive: false,
              style: { color: e.color, weight: e.w, opacity: e.op, lineCap: 'round', lineJoin: 'round' }
            });
          });
        } catch (e) {
          cargada = false;
          aviso('No se pudo cargar la capa «' + cfg.nombre + '». Revise la conexión.', 'alerta');
          return;
        }
      }
      actualizar();
    });
    grupo.on('remove', () => grabar('sip_limite_' + i, '0'));
    map.on('zoomend', actualizar);
    controlCapas.addOverlay(grupo, cfg.nombre);
    if (leer('sip_limite_' + i) === '1') grupo.addTo(map);
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
    map.createPane('limites').style.zIndex = 350;
    map.createPane('contexto').style.zIndex = 340;         // vías y ríos: debajo de los límites
    map.getPane('contexto').style.pointerEvents = 'none';          // límites de referencia: debajo de predios y lotes
    map.getPane('limites').style.pointerEvents = 'none';
    controlCapas = L.control.layers(BASES, SUPERPUESTAS, { position: 'topright', collapsed: true }).addTo(map);
    iniciarPlanchas(BASES);
    L.control.scale({ imperial: false }).addTo(map);

    capaPredio = L.featureGroup().addTo(map);
    capaLotes = L.featureGroup().addTo(map);
    capaElementos = L.featureGroup().addTo(map);
    capaSimbolos = L.layerGroup().addTo(map);
    map.on('zoomend', pintarSimbolos);
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


  // ======================================================================
  //  PLANCHAS: imagen georreferenciada de cada predio para usar como fondo.
  //  Con internet el mapa trabaja con los mapas en línea de siempre. Sin internet
  //  (o si las imágenes del mapa dejan de cargar) pone la plancha del predio
  //  guardada en este equipo. Las imágenes se guardan en el navegador (IndexedDB).
  // ======================================================================
  const P = { meta: {}, locales: new Set(), capa: null, actual: null, url: null, auto: false, errores: [], db: null };

  function abrirDB() {
    if (!P.db) {
      P.db = new Promise((bien, mal) => {
        if (!window.indexedDB) { mal(new Error('Este navegador no permite guardar planchas.')); return; }
        const r = indexedDB.open('sip-planchas', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('img');
        r.onsuccess = () => bien(r.result);
        r.onerror = () => mal(r.error);
      });
    }
    return P.db;
  }
  async function idb(modo, fn) {
    const db = await abrirDB();
    return new Promise((bien, mal) => {
      const tx = db.transaction('img', modo);
      const req = fn(tx.objectStore('img'));
      tx.oncomplete = () => bien(req && req.result);
      tx.onerror = () => mal(tx.error);
      tx.onabort = () => mal(tx.error || new Error('No hay espacio para guardar la plancha en este equipo.'));
    });
  }
  const leerPlanchaLocal = (cod) => idb('readonly', (st) => st.get(cod)).catch(() => null);
  const guardarPlanchaLocal = (cod, blob) => idb('readwrite', (st) => st.put(blob, cod)).then(() => P.locales.add(cod));
  const claveMeta = () => 'sip_planchas_' + (S.user ? S.user.id : 'demo');

  async function cargarMetaPlanchas() {
    try { P.meta = JSON.parse(leer(claveMeta()) || '{}'); } catch (e) { P.meta = {}; }
    if (api.planchas && navigator.onLine) {
      try {
        const lista = await api.planchas();
        P.meta = {};
        lista.forEach((x) => { if (x.cod_predio) P.meta[x.cod_predio] = x; });
        grabar(claveMeta(), JSON.stringify(P.meta));
      } catch (e) { /* sin señal: se usa lo último guardado en el equipo */ }
    }
    P.locales = new Set(await idb('readonly', (st) => st.getAllKeys()).catch(() => []));
    actualizarBotonPlanchas();
    if (S.tab === 'predio' && S.predio && !S.editando) render();
  }

  function actualizarBotonPlanchas() {
    const cods = Object.keys(P.meta);
    const b = $('#btnPlanchas');
    if (b) {
      b.hidden = false;
      const listas = cods.filter((c) => P.locales.has(c)).length;
      b.textContent = '📥 Preparar para trabajar sin señal' + (cods.length ? ` (planchas ${listas} de ${cods.length})` : '');
    }
    const sb = $('#btnSubirPlanchas');
    if (sb) sb.hidden = !(esAdmin() && cods.length);
  }

  async function descargarPlancha(cod) {
    const url = await api.urlPlancha(cod);
    if (!url) throw new Error(`La plancha ${(P.meta[cod] || {}).etiqueta || cod} aún no está subida a Sigpredial.`);
    const r = await fetch(url);
    if (!r.ok) throw new Error('No se pudo descargar la plancha (error ' + r.status + ').');
    const blob = await r.blob();
    await guardarPlanchaLocal(cod, blob).catch(() => {});
    return blob;
  }

  // Pone en el mapa la plancha del predio. Devuelve true si la pudo mostrar.
  async function mostrarPlancha(cod, callado) {
    const m = P.meta[cod];
    if (!m) { if (!callado) aviso('Este predio no tiene plancha registrada.', 'alerta'); return false; }
    let blob = await leerPlanchaLocal(cod);
    if (!blob && navigator.onLine) {
      try { blob = await descargarPlancha(cod); } catch (e) { if (!callado) aviso(e.message, 'alerta'); return false; }
    }
    if (!blob) {
      if (!callado) {
        aviso(`La plancha ${m.etiqueta} no está guardada en este equipo. Cárguela con «Cargar desde archivo» ` +
          `(archivo ${cod}.jpg).`, 'alerta');
      }
      return false;
    }
    if (P.url) URL.revokeObjectURL(P.url);
    P.url = URL.createObjectURL(blob);
    P.actual = cod;
    P.capa.clearLayers();
    L.imageOverlay(P.url, [[m.sur, m.oeste], [m.norte, m.este]], { pane: 'plancha', interactive: false }).addTo(P.capa);
    if (!map.hasLayer(P.capa)) { P.cambiando = true; P.capa.addTo(map); P.cambiando = false; }
    return true;
  }

  function quitarPlancha() {
    P.capa.clearLayers();
    if (P.url) { URL.revokeObjectURL(P.url); P.url = null; }
    P.actual = null; P.auto = false;
    if (map.hasLayer(P.capa)) { P.cambiando = true; map.removeLayer(P.capa); P.cambiando = false; }
  }

  // Al abrir un predio: si la plancha está prendida, o no hay internet, se pone la de este predio
  async function planchaAlAbrir() {
    if (!S.predio || !S.predio.cod_predio) return;
    const quiere = map.hasLayer(P.capa) || !navigator.onLine;
    if (!quiere || P.actual === S.predio.cod_predio) return;
    const auto = !navigator.onLine || P.auto;
    if (!(await mostrarPlancha(S.predio.cod_predio, true))) {
      if (P.actual) quitarPlancha();
      if (!navigator.onLine) aviso('Sin internet y sin plancha guardada para este predio: el fondo del mapa no se puede mostrar.', 'alerta');
      return;
    }
    P.auto = auto;
  }

  async function sinConexion(motivo) {
    $('#chipSinRed').hidden = false;
    if (P.actual && map.hasLayer(P.capa)) return;
    if (!S.predio || !S.predio.cod_predio) {
      if (navigator.onLine) aviso(motivo + ' Abra un predio para usar su plancha como fondo del mapa.', 'alerta');
      return;
    }
    if (await mostrarPlancha(S.predio.cod_predio, true)) {
      P.auto = true;
      aviso(`${motivo} El fondo del mapa es ahora la plancha ${P.meta[S.predio.cod_predio].etiqueta}. ` +
        'Lo que guarde queda en el teléfono y se envía cuando vuelva la señal.', 'alerta');
    } else {
      aviso(motivo + ' Este predio no tiene la plancha guardada en este equipo.', 'alerta');
    }
    render();
  }

  function conConexion() {
    $('#chipSinRed').hidden = true;
    P.errores = [];
    if (P.auto) {
      quitarPlancha();
      aviso('Volvió la conexión: el mapa usa de nuevo las imágenes en línea.');
      render();
    }
  }

  function iniciarPlanchas(bases) {
    map.createPane('plancha').style.zIndex = 250;   // encima de las imágenes en línea, debajo de predios y lotes
    P.capa = L.layerGroup();
    controlCapas.addOverlay(P.capa, '🗺 Plancha del predio');
    map.on('overlayadd', (e) => {
      if (e.layer !== P.capa || P.cambiando) return;
      if (!S.predio || !S.predio.cod_predio) { aviso('Abra un predio para ver su plancha.', 'alerta'); return; }
      mostrarPlancha(S.predio.cod_predio).then((bien) => {
        if (!bien) { P.cambiando = true; map.removeLayer(P.capa); P.cambiando = false; }
        if (S.tab === 'predio') render();
      });
    });
    map.on('overlayremove', (e) => {
      if (e.layer !== P.capa || P.cambiando) return;
      P.capa.clearLayers(); P.actual = null; P.auto = false;
      if (S.tab === 'predio') render();
    });
    // Si las imágenes en línea fallan seguido (señal muy débil), se pasa a la plancha
    const vigilar = (capa) => {
      if (capa instanceof L.GridLayer) {
        capa.on('tileerror', () => {
          const ahora = Date.now();
          P.buenas = 0;
          P.errores = P.errores.filter((t) => ahora - t < 20000).concat(ahora);
          // Una sola vez cada 2 minutos, para no llenar la pantalla de avisos
          if (P.errores.length >= 8 && !P.actual && ahora - (P.avisoTeselas || 0) > 120000) {
            P.errores = []; P.avisoTeselas = ahora;
            sinConexion('Las imágenes del mapa no cargan.');
          }
        });
        capa.on('tileload', () => {
          P.errores = [];
          P.buenas = (P.buenas || 0) + 1;
          // Las imágenes en línea volvieron a cargar bien: se quita la plancha puesta sola
          if (P.buenas >= 6 && navigator.onLine && !$('#chipSinRed').hidden) conConexion();
        });
      } else if (capa.eachLayer) capa.eachLayer(vigilar);
    };
    Object.values(bases).forEach(vigilar);
    window.addEventListener('offline', () => sinConexion('Sin internet.'));
    window.addEventListener('online', conConexion);
    if (!navigator.onLine) $('#chipSinRed').hidden = false;
  }

  // Antes de salir a campo: guarda en este equipo las planchas de los predios del usuario
  // Antes de salir a campo, con internet: guarda en el teléfono los datos de los predios
  // del usuario (productor, lotes, elementos, finca soñada, plan) y sus planchas.
  async function prepararCampo(btn) {
    if (!navigator.onLine) { aviso('Necesita internet para preparar el teléfono. Hágalo antes de salir a campo.', true); return; }
    const lista = (S.mapaPredios && S.mapaPredios.length) ? S.mapaPredios : await api.prediosMapa().catch(() => []);
    if (!lista.length) { aviso('No hay predios para guardar.', 'alerta'); return; }
    const cods = Object.keys(P.meta);
    const faltan = cods.filter((c) => !P.locales.has(c));
    const mb = Math.max(1, Math.round(faltan.length * 0.45 + lista.length * 0.05));
    if (!confirm(`Se guardarán en este equipo los datos de ${lista.length} predios` +
      (faltan.length ? ` y ${faltan.length} planchas` : '') + ` (unos ${mb} MB) para trabajar sin señal. ¿Continuar?`)) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const texto = btn.textContent; btn.disabled = true;
    let errores = 0;
    const productores = new Set(); const mpios = new Set();
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i];
      btn.textContent = `Guardando predio ${i + 1} de ${lista.length}…`;
      try {
        const tareas = [api.lotesDe(p.id), api.elementosDe(p.id), api.caracterizacionesDe(p.id).catch(() => null),
          api.fichaDe(p.id).catch(() => null)];
        if (S.pps) tareas.push(api.ppsPredio(p.id), api.planDe(p.id));
        if (p.productor_id && !productores.has(p.productor_id)) {
          productores.add(p.productor_id);
          tareas.push(api.productor(p.productor_id), api.prediosDe(p.productor_id).then((ps) => {
            (ps || []).forEach((x) => { if (x.cod_mpio) mpios.add(x.cod_mpio); });
          }));
        }
        await Promise.all(tareas);
      } catch (e) { errores++; }
    }
    for (const m of mpios) await api.veredas(m).catch(() => {});
    await api.misRecientes().catch(() => {});
    let bien = 0; const malas = [];
    for (const c of faltan) {
      btn.textContent = `Guardando plancha ${bien + malas.length + 1} de ${faltan.length}…`;
      try { await descargarPlancha(c); bien++; } catch (e) { malas.push(P.meta[c].etiqueta); }
    }
    grabar(claveMeta() + '_listo', new Date().toISOString());
    btn.disabled = false; btn.textContent = texto;
    actualizarBotonPlanchas();
    if (S.tab === 'predio' && !S.editando) render();
    const partes = [`datos de ${lista.length - errores} predios`];
    if (cods.length) partes.push(`${cods.length - malas.length} de ${cods.length} planchas`);
    aviso(`Listo: el teléfono tiene ${partes.join(' y ')}. Ya puede abrir Sigpredial sin señal.` +
      (malas.length ? ` Faltan planchas: ${malas.join(', ')} (puede que aún no estén subidas).` : '') +
      (errores ? ` ${errores} predios no se pudieron guardar; repita con mejor señal.` : ''), (malas.length || errores) ? 'alerta' : false);
  }

  // Una plancha desde un archivo del equipo (memoria USB, carpeta compartida…)
  async function planchaDesdeArchivo(archivo) {
    let cod = archivo.name.replace(/\.(jpe?g)$/i, '').trim();
    if (!P.meta[cod]) {
      const abierto = S.predio && S.predio.cod_predio;
      if (!abierto || !P.meta[abierto]) {
        aviso(`El archivo «${archivo.name}» no corresponde a ninguna plancha de sus predios. Debe llamarse como el código del predio, por ejemplo 18094-0010.jpg.`, true);
        return;
      }
      if (!confirm(`El archivo «${archivo.name}» no tiene el nombre de un predio. ¿Usarlo como plancha ${P.meta[abierto].etiqueta} del predio ${abierto}?`)) return;
      cod = abierto;
    }
    try { await guardarPlanchaLocal(cod, archivo); } catch (e) { aviso('No se pudo guardar en este equipo; se muestra solo por ahora.', 'alerta'); }
    actualizarBotonPlanchas();
    if (S.predio && S.predio.cod_predio === cod) {
      P.actual = null;
      if (await mostrarPlancha(cod)) aviso(`Plancha ${P.meta[cod].etiqueta} cargada y guardada en este equipo.`);
    } else {
      aviso(`Plancha ${P.meta[cod].etiqueta} guardada en este equipo. Se verá al abrir el predio ${cod}.`);
    }
    if (S.tab === 'predio' && !S.editando) render();
  }

  // Administrador: sube las planchas georreferenciadas (archivos <cod_predio>.jpg)
  async function subirPlanchas(archivos, btn) {
    const validos = archivos.filter((a) => P.meta[a.name.replace(/\.(jpe?g)$/i, '')]);
    const otros = archivos.filter((a) => !validos.includes(a)).map((a) => a.name);
    if (!validos.length) { aviso('Ningún archivo tiene el nombre de una plancha registrada (ej.: 18094-0010.jpg).', true); return; }
    if (!confirm(`Se subirán ${validos.length} planchas a Sigpredial` +
      (otros.length ? ` (se ignoran ${otros.length} archivos que no corresponden)` : '') + '. ¿Continuar?')) return;
    const texto = btn.textContent; btn.disabled = true;
    let bien = 0; const malas = [];
    for (const a of validos) {
      btn.textContent = `Subiendo ${bien + malas.length + 1} de ${validos.length}…`;
      const cod = a.name.replace(/\.(jpe?g)$/i, '');
      try { await api.subirPlancha(cod, a); bien++; } catch (e) { malas.push(cod + ': ' + e.message); }
    }
    btn.disabled = false; btn.textContent = texto;
    aviso(`Se ${bien === 1 ? 'subió 1 plancha' : 'subieron ' + bien + ' planchas'}.` + (malas.length ? ' Con error: ' + malas.slice(0, 5).join(' · ') : ''), malas.length ? true : false);
    cargarMetaPlanchas();
  }

  function tarjetaPlancha(p) {
    const m = P.meta[p.cod_predio];
    if (!m) return '';
    const local = P.locales.has(p.cod_predio);
    const visible = P.actual === p.cod_predio && map.hasLayer(P.capa);
    const estado = m.estado === 'regenerar'
      ? `<p class="aviso">⚠ Esta plancha tiene nubes sobre el predio${m.nota ? ' (' + esc(m.nota) + ')' : ''}. Se va a regenerar con otra imagen.</p>`
      : (m.estado === 'nubes' ? `<p class="sin-datos">☁ ${esc(m.nota || 'Tiene algunas nubes')}.</p>` : '');
    return `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Plancha ${esc(m.etiqueta)}</h2><div class="acciones">
        ${visible ? '<button class="btn btn-borde btn-peq" data-accion="quitar-plancha">Quitar del mapa</button>'
          : '<button class="btn btn-borde btn-peq" data-accion="ver-plancha">Ver en el mapa</button>'}
        <button class="btn btn-claro btn-peq" data-accion="archivo-plancha" title="Usar el archivo ${esc(p.cod_predio)}.jpg de una memoria o carpeta">Cargar desde archivo</button>
      </div></div>
      <p class="sin-datos">${local
        ? '✓ Guardada en este equipo: se puede usar sin internet. Si se cae la señal, el mapa la pone sola de fondo.'
        : 'Aún no está guardada en este equipo. Antes de salir a campo use «📥 Preparar para trabajar sin señal»; también se guarda sola al verla con internet.'}</p>
      ${estado}
    </div>`;
  }


  // ======================================================================
  //  MODO CAMPO (celular): mapa a pantalla completa, barra delgada arriba,
  //  botones grandes abajo y los formularios como hoja que sube desde abajo.
  //  Lo de oficina (tablero, Excel, calidad, ruta, guías) queda en la vista completa.
  // ======================================================================
  const CM = { activo: false, hoja: false, clave: null, esc: 'actual', predio: null };

  function claveSeleccion() {
    if (S.editando) return 'ed:' + S.editando;
    if (S.tab === 'lotes' && S.lote && S.lote.id) return 'l:' + S.lote.id;
    if (S.tab === 'finca' && S.lote && S.lote.id && S.lote.escenario === 'propuesto') return 'l:' + S.lote.id;
    if ((S.tab === 'elementos' || S.tab === 'finca') && S.elemento && S.elemento.id) return 'e:' + S.elemento.id;
    return null;
  }

  function actualizarCampo() {
    if (!CM.activo) return;
    const k = claveSeleccion();
    if (CM.clave && CM.clave.startsWith('ed:') && !(k && k.startsWith('ed:'))) CM.hoja = false;   // guardó o canceló
    else if (k && k !== CM.clave) CM.hoja = true;                                                 // eligió o empezó a editar algo
    CM.clave = k;
    if (S.modoGeom) CM.hoja = false;                                                              // dibujando: mapa libre
    const pid = S.predio && S.predio.id;
    if (pid !== CM.predio) { CM.predio = pid; document.body.classList.remove('menu-abierto'); }
    if (['finca', 'plan'].includes(S.tab)) CM.esc = 'propuesto';
    else if (['lotes', 'elementos'].includes(S.tab)) CM.esc = 'actual';
    // En la hoja se muestra solo la tarjeta de lo que se está editando o se eligió
    document.querySelectorAll('#contenido .campo-foco').forEach((t) => t.classList.remove('campo-foco'));
    let foco = null;
    if (k && k.startsWith('ed:')) {
      const ctl = document.querySelector('#contenido .form[data-form] :is(input,select,textarea):not([disabled])');
      foco = ctl && ctl.closest('#contenido > *');
    } else if (k) {
      const f = document.querySelector(k.startsWith('l:') ? '#contenido .form[data-form^="lote"]' : '#contenido .form[data-form="elemento"]');
      foco = f && f.closest('#contenido > *');
    }
    if (foco) foco.classList.add('campo-foco');
    document.body.classList.toggle('hoja-abierta', CM.hoja);
    document.body.classList.toggle('hoja-seleccion', !!foco);
    const p = S.predio;
    $('#campoTitulo').innerHTML = p && p.id
      ? `<b>${esc(p.cod_predio || '')}</b> ${esc(p.nombre || '')}`
      : 'Toque ☰ para abrir un predio';
    document.querySelectorAll('#campoEsc [data-campo-esc]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.campoEsc === CM.esc)));
    const conLimite = !!(p && p.geojson);
    document.querySelectorAll('#campoBarra [data-campo]').forEach((b) => {
      const h = b.dataset.campo;
      b.disabled = (['lote', 'linea', 'punto', 'zona'].includes(h) && !conLimite) || (h !== 'gps' && h !== 'plancha' && !(p && p.id))
        || (h === 'zona' && CM.esc === 'propuesto');   // las zonas de riesgo son de la finca de hoy
      if (h === 'limite') b.querySelector('span:last-child').textContent = conLimite ? 'Límite' : 'Límite';
      if (h === 'datos') b.setAttribute('aria-pressed', String(CM.hoja));
    });
    $('#campoSinRed').hidden = $('#chipSinRed').hidden;
    if (!$('#campoPlancha').hidden) pintarMenuPlancha();
  }

  function activarCampo(si, guardarPref) {
    CM.activo = si;
    document.body.classList.toggle('modo-campo', si);
    if (!si) document.body.classList.remove('hoja-abierta', 'menu-abierto', 'hoja-seleccion');
    $('#campoPlancha').hidden = true; $('#campoMas').hidden = true;
    if (guardarPref) grabar('sip_campo', si ? '1' : '0');
    CM.clave = null;
    actualizarCampo();
    setTimeout(() => { if (map) map.invalidateSize(); }, 250);
  }

  function campoHerramienta(h, btn) {
    $('#campoPlancha').hidden = h !== 'plancha' || !$('#campoPlancha').hidden;
    $('#campoMas').hidden = true;
    if (h === 'gps') return gpsVertice(btn);
    if (h === 'plancha') { if (!$('#campoPlancha').hidden) pintarMenuPlancha(); return; }
    if (!S.predio || !S.predio.id) { document.body.classList.add('menu-abierto'); aviso('Primero abra un predio.', 'alerta'); return; }
    if (h === 'datos') {
      CM.hoja = !CM.hoja;
      if (CM.hoja && !claveSeleccion()) { S.tab = CM.esc === 'propuesto' ? 'finca' : 'predio'; render(); return; }
      return actualizarCampo();
    }
    if (S.editando) { aviso('Guarde o cancele el formulario abierto antes de dibujar.', 'alerta'); CM.hoja = true; return actualizarCampo(); }
    const prop = CM.esc === 'propuesto';
    const ejecutar = (a, tipo) => { const b = document.createElement('button'); b.dataset.accion = a; if (tipo) b.dataset.tipo = tipo; return accion(b); };
    let r;
    if (h === 'limite') r = S.predio.geojson ? ejecutar('editar-forma', 'predio') : ejecutar('dibujar', 'predio');
    else if (h === 'lote') r = ejecutar('dibujar', prop ? 'lote-prop' : 'lote');
    else if (h === 'linea') r = ejecutar('dibujar', prop ? 'elemento-linea-prop' : 'elemento-linea');
    else if (h === 'punto') r = ejecutar('dibujar', prop ? 'elemento-punto-prop' : 'elemento-punto');
    else if (h === 'zona') r = ejecutar('dibujar', 'elemento-area');
    Promise.resolve(r).then(actualizarCampo);
  }

  // GPS: si está dibujando, agrega un vértice donde está el técnico; si no, muestra su ubicación
  function gpsVertice(btn) {
    if (!navigator.geolocation) { aviso('Este equipo no tiene GPS disponible.', true); return; }
    btn.classList.add('ocupado');
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.classList.remove('ocupado');
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      const prec = Math.round(pos.coords.accuracy || 0);
      map.fire('locationfound', { latlng: ll, accuracy: pos.coords.accuracy || 0 });
      const m = S.modoGeom;
      if (m && m.accion === 'dibujar' && map.pm) {
        try {
          if (/punto/.test(m.tipo)) map.pm.Draw.CircleMarker._createMarker({ latlng: ll });
          else (/linea/.test(m.tipo) ? map.pm.Draw.Line : map.pm.Draw.Polygon)._createVertex({ latlng: ll });
          map.panTo(ll);
          aviso(`Punto agregado con el GPS (precisión ±${prec} m).` + (prec > 15 ? ' La señal es débil: espere unos segundos y repita.' : ''),
            prec > 15 ? 'alerta' : false);
        } catch (e) { aviso('No se pudo agregar el punto: ' + e.message, true); }
      } else {
        map.setView(ll, Math.max(map.getZoom(), 17));
        aviso(`Usted está aquí (precisión ±${prec} m). Para levantar el límite caminando: pulse «Límite» y luego 📍 en cada esquina.`);
      }
    }, (err) => {
      btn.classList.remove('ocupado');
      aviso(err.code === 1 ? 'Permita el acceso a la ubicación para usar el GPS.' : 'No fue posible obtener la ubicación. Intente a cielo abierto.', true);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  function pintarMenuPlancha() {
    const cods = Object.keys(P.meta);
    const listas = cods.filter((c) => P.locales.has(c)).length;
    const cod = S.predio && S.predio.cod_predio;
    const m = cod && P.meta[cod];
    const visible = m && P.actual === cod && map.hasLayer(P.capa);
    $('#campoPlancha').innerHTML = `
      <p class="campo-menu-tit">${m ? 'Plancha ' + esc(m.etiqueta) + (P.locales.has(cod) ? ' · ✓ guardada en el teléfono' : ' · no guardada') : (cod ? 'Este predio no tiene plancha registrada' : 'Abra un predio para ver su plancha')}</p>
      ${m ? `<button class="btn btn-primario btn-bloque" data-campo-pl="${visible ? 'quitar' : 'ver'}">${visible ? 'Quitar la plancha del mapa' : '🗺 Ver la plancha en el mapa'}</button>` : ''}
      ${m ? '<button class="btn btn-borde btn-bloque" data-campo-pl="archivo">📂 Cargar la plancha desde el teléfono</button>' : ''}
      <button class="btn btn-borde btn-bloque" data-campo-pl="todas">📥 Preparar para trabajar sin señal${cods.length ? ` (planchas ${listas} de ${cods.length})` : ''}</button>
      <p class="nota">Hágalo con internet antes de salir: guarda en el teléfono sus predios y planchas. Sin señal, Sigpredial abre igual y el mapa pone la plancha de fondo.</p>`;
  }

  async function campoPlancha(op, btn) {
    const cod = S.predio && S.predio.cod_predio;
    if (op === 'ver') { if (await mostrarPlancha(cod)) P.auto = false; }
    else if (op === 'quitar') quitarPlancha();
    else if (op === 'archivo') $('#archivoPlancha').click();
    else if (op === 'todas') await prepararCampo(btn);
    pintarMenuPlancha();
    if (op !== 'todas') $('#campoPlancha').hidden = true;
  }

  function iniciarCampo() {
    $('#campoBarra').addEventListener('click', (e) => {
      const b = e.target.closest('[data-campo]');
      if (b && !b.disabled) campoHerramienta(b.dataset.campo, b);
    });
    $('#campoEsc').addEventListener('click', (e) => {
      const b = e.target.closest('[data-campo-esc]');
      if (!b) return;
      CM.esc = b.dataset.campoEsc;
      if (S.predio && S.predio.id && !S.editando && !S.modoGeom) {
        S.lote = null; S.elemento = null;
        S.tab = CM.esc === 'propuesto' ? 'finca' : 'lotes';
        render();
      } else actualizarCampo();
      aviso(CM.esc === 'propuesto' ? 'Finca soñada: lo que dibuje ahora es lo propuesto.' : 'Hoy: lo que dibuje ahora es lo que existe en la finca.');
    });
    $('#campoPlancha').addEventListener('click', (e) => {
      const b = e.target.closest('[data-campo-pl]');
      if (b) campoPlancha(b.dataset.campoPl, b);
    });
    $('#campoMenu').addEventListener('click', () => {
      document.body.classList.toggle('menu-abierto');
      $('#campoPlancha').hidden = true; $('#campoMas').hidden = true;
    });
    $('#campoOpciones').addEventListener('click', () => { $('#campoMas').hidden = !$('#campoMas').hidden; $('#campoPlancha').hidden = true; });
    $('#campoMas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-campo-mas]');
      if (!b) return;
      $('#campoMas').hidden = true;
      if (b.dataset.campoMas === 'completa') activarCampo(false, true);
      else if (b.dataset.campoMas === 'salir') $('#btnSalir').click();
    });
    $('#campoCerrarHoja').addEventListener('click', () => { CM.hoja = false; actualizarCampo(); });
    $('#btnModoCampo').addEventListener('click', () => activarCampo(true, true));
    const pref = leer('sip_campo');
    const angosta = window.matchMedia('(max-width: 760px)').matches;
    if (pref === '1' || (pref == null && angosta)) activarCampo(true, false);
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
  const colorZona = (l) => l.zona_color || '#9e9e9e';     // finca soñada: color de la zona PPS

  const COLOR_GRUPO = { 'Hídrico': '#1e88e5', 'Vial': '#8d5524', 'Infraestructura': '#37474f', 'Otro': '#7e57c2',
    'Riesgo': '#c62828', 'Conflicto de uso': '#ef6c00' };
  const COLOR_HMP = { 'Cerca viva': '#2e7d32', 'Barrera viva': '#9e9d24', 'Aislamiento de área de conservación': '#00838f',
    'División de potreros con árboles': '#6d4c41' };
  const colorElemento = (e) => COLOR_HMP[e.tipo] || COLOR_GRUPO[e.grupo] || '#7e57c2';

  // ---------- Símbolos de las cercas: arbolitos (cerca viva, división de potreros), arbustos
  // (barrera viva) y estacones (cerca muerta de alambre, aislamiento). Se reparten a lo largo
  // de la línea cada tantos píxeles, y se vuelven a repartir al acercar o alejar el mapa.
  function simboloDe(e) {
    const t = (e.tipo || '').toLowerCase();
    if (/cerca viva|divisi[oó]n de potreros/.test(t)) return 'arbol';
    if (/barrera viva/.test(t)) return 'arbusto';
    if (/cerca muerta|alambre|cerca \/ lindero|aislamiento/.test(t)) return 'estacon';
    return null;
  }
  const SVG_SIMBOLO = {
    arbol: (sel) => ({ w: 19, h: 24, ax: 9.5, ay: 22, html: `<svg width="19" height="24" viewBox="0 0 16 20" aria-hidden="true">
      <rect x="7" y="11" width="2.4" height="8" rx="1" fill="#5d4037"/>
      <circle cx="8" cy="7.5" r="6.3" fill="#2e7d32" stroke="${sel ? AMARILLO : '#ffffff'}" stroke-width="1.4"/>
      <circle cx="6" cy="5.8" r="2" fill="#66bb6a"/></svg>` }),
    arbusto: (sel) => ({ w: 12, h: 12, ax: 6, ay: 6, html: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.8" fill="#9e9d24" stroke="${sel ? AMARILLO : '#ffffff'}" stroke-width="1.2"/></svg>` }),
    estacon: (sel) => ({ w: 8, h: 16, ax: 4, ay: 13, html: `<svg width="8" height="16" viewBox="0 0 8 16" aria-hidden="true">
      <rect x="1.5" y="1" width="5" height="14" rx="1" fill="#6d4c41" stroke="${sel ? AMARILLO : '#ffffff'}" stroke-width="1"/>
      <rect x="1.5" y="1" width="5" height="2.5" fill="#3e2723"/></svg>` })
  };
  const PASO_SIMBOLO = { arbol: 34, arbusto: 18, estacon: 20 };
  function pintarSimbolos() {
    if (!map || !capaSimbolos) return;
    capaSimbolos.clearLayers();
    const z = map.getZoom();
    if (z < 15) return;                       // de lejos solo se ve la línea
    let total = 0;
    const iconos = {};
    const icono = (sim, sel) => {
      const k = sim + (sel ? '1' : '0');
      if (!iconos[k]) {
        const d = SVG_SIMBOLO[sim](sel);
        iconos[k] = L.divIcon({ className: 'simbolo-cerca', html: d.html, iconSize: [d.w, d.h], iconAnchor: [d.ax, d.ay] });
      }
      return iconos[k];
    };
    lineasConSimbolo.forEach(({ geojson, sim, sel }) => {
      const g = geojson.type === 'MultiLineString' ? geojson.coordinates : (geojson.type === 'LineString' ? [geojson.coordinates] : []);
      const paso = PASO_SIMBOLO[sim];
      g.forEach((linea) => {
        const pts = linea.map(([lon, lat]) => map.project([lat, lon], z));
        let resto = paso / 2;
        for (let i = 1; i < pts.length && total < 1500; i++) {
          const a = pts[i - 1], b = pts[i];
          const largo = a.distanceTo(b);
          let d = resto;
          while (d <= largo && total < 1500) {
            const p = a.add(b.subtract(a).multiplyBy(d / largo));
            L.marker(map.unproject(p, z), { icon: icono(sim, sel), interactive: false, keyboard: false }).addTo(capaSimbolos);
            total++;
            d += paso;
          }
          resto = d - largo;
        }
      });
    });
  }

  // ---------- Selector del mapa: lo actual, la finca soñada o las dos superpuestas
  let controlEscenario = null;
  function actualizarControlEscenario() {
    if (!map) return;
    if (!controlEscenario) {
      const Ctl = L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
          const div = L.DomUtil.create('div', 'control-escenario');
          div.id = 'ctlEscenario';
          L.DomEvent.disableClickPropagation(div);
          L.DomEvent.on(div, 'click', (e) => {
            const b = e.target.closest('[data-vista]');
            if (!b) return;
            S.vistaMapa = b.dataset.vista;
            dibujarSeleccion(false);
          });
          return div;
        }
      });
      controlEscenario = new Ctl();
      map.addControl(controlEscenario);
    }
    const div = $('#ctlEscenario');
    const mostrar = !!(S.pps && S.predio && S.predio.id && (S.lotesProp.length || ['finca', 'plan'].includes(S.tab)));
    div.hidden = !mostrar;
    if (!mostrar) return;
    const v = S.vistaMapa;
    const b = (k, t) => `<button type="button" data-vista="${k}" aria-pressed="${v === k}">${t}</button>`;
    const zonas = (S.pps.zonas || []).filter((z) => S.lotesProp.some((l) => +l.zona_pps_id === z.id));
    div.innerHTML = `<div class="seg">${b('actual', 'Actual')}${b('propuesto', 'Finca soñada')}${b('ambos', 'Superpuesta')}</div>` +
      (v !== 'actual' && zonas.length ? `<ul class="leyenda-zonas">${zonas.map((z) =>
        `<li><span class="punto-color" style="background:${esc(z.color)}"></span>${esc(z.nombre)}</li>`).join('')}
        ${v === 'ambos' ? '<li><span class="contorno-actual"></span>Lotes actuales</li>' : ''}</ul>` : '');
  }

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
      actualizarBotonCorregir();
      const n = lista.filter((p) => !p.geojson).length;
      const b = $('#btnPendientes');
      if (b) { b.hidden = !n; b.textContent = `📍 Pendientes de delimitar (${n})`; }
      if (ajustar && capaGeneral.getLayers().length) map.fitBounds(capaGeneral.getBounds(), { padding: [20, 20] });
    } catch (e) { aviso(e.message, true); }
  }

  // ---------- Punto para la etiqueta: «polo de inaccesibilidad» (algoritmo polylabel):
  // el punto dentro del polígono más alejado de sus bordes. Para multipolígonos se usa
  // la parte más grande. Devuelve [lat, lon].
  function puntoEtiqueta(gj) {
    const g = gj && gj.type === 'Feature' ? gj.geometry : gj;
    if (!g) return null;
    const partes = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    if (!partes.length) return null;
    const areaAnillo = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
    const poli = partes.reduce((m, p) => (areaAnillo(p[0]) > areaAnillo(m[0]) ? p : m));
    const k = Math.cos(poli[0][0][1] * Math.PI / 180);           // escala aproximada lon→metros
    const anillos = poli.map((r) => r.map((c) => [c[0] * k, c[1]]));
    const distSeg = (px, py, a, b) => {
      let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
      if (dx || dy) {
        const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = px - x; dy = py - y; return dx * dx + dy * dy;
    };
    const distancia = (x, y) => {           // positiva dentro, negativa fuera
      let dentro = false, min = Infinity;
      anillos.forEach((r) => {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const a = r[i], b = r[j];
          if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) dentro = !dentro;
          min = Math.min(min, distSeg(x, y, a, b));
        }
      });
      return (dentro ? 1 : -1) * Math.sqrt(min);
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    anillos[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const tam = Math.min(x1 - x0, y1 - y0);
    if (!tam) return [anillos[0][0][1], anillos[0][0][0] / k];
    const celda = (x, y, h) => { const d = distancia(x, y); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
    const precision = tam / 200;
    let cola = [];
    for (let x = x0; x < x1; x += tam) for (let y = y0; y < y1; y += tam) cola.push(celda(x + tam / 2, y + tam / 2, tam / 2));
    let mejor = celda((x0 + x1) / 2, (y0 + y1) / 2, 0);
    let n = 0;
    while (cola.length && n++ < 4000) {
      cola.sort((a, b) => b.max - a.max);
      const c = cola.shift();
      if (c.d > mejor.d) mejor = c;
      if (c.max - mejor.d <= precision) continue;
      const h = c.h / 2;
      cola.push(celda(c.x - h, c.y - h, h), celda(c.x + h, c.y - h, h), celda(c.x - h, c.y + h, h), celda(c.x + h, c.y + h, h));
    }
    return [mejor.y, mejor.x / k];
  }

  function dibujarSeleccion(ajustar) {
    capaPredio.clearLayers();
    capaLotes.clearLayers();
    capaElementos.clearLayers();
    lineasConSimbolo = [];
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
    // Lotes según la vista del mapa: actual, finca soñada o las dos superpuestas
    // (en la superpuesta lo actual va solo como contorno punteado, debajo de lo propuesto)
    const vista = S.pps ? S.vistaMapa : 'actual';
    const selId = S.tab === 'plan' ? (S.accion && S.accion.lote_id) : (S.lote && S.lote.id);
    const pintarLote = (l, prop, contorno) => {
      if (!l.geojson) return;
      if (editandoCapa === 'lote' && S.lote && S.lote.id === l.id) return;
      const sel = selId === l.id;
      const abrir = () => { if (S.modoGeom) return; navegar(() => abrirLote(l.id)); };
      const estilo = contorno
        ? { color: '#ffffff', weight: 2, dashArray: '5 4', fill: false, interactive: false }
        : { color: sel ? AMARILLO : '#ffffff', weight: sel ? 3 : 1.5,
          fillColor: prop ? colorZona(l) : colorLote(l), fillOpacity: sel ? 0.7 : (prop ? 0.55 : 0.45) };
      const capa = L.geoJSON(l.geojson, { style: estilo });
      if (!contorno) capa.on('click', abrir);
      capa.addTo(capaLotes);
      if (contorno) return;
      // Etiqueta en el punto más interior del lote (no en el centro del recuadro, que en
      // lotes en forma de anillo o de «U» cae fuera, encima de otros lotes)
      const pe = puntoEtiqueta(l.geojson);
      if (pe) {
        L.tooltip({ permanent: true, direction: 'center', className: 'etq-lote' + (prop ? ' etq-prop' : ''), interactive: true })
          .setLatLng(pe).setContent(nomLote(l))
          .on('click', abrir).addTo(capaLotes);
      }
    };
    if (vista !== 'propuesto') S.lotes.forEach((l) => pintarLote(l, false, vista === 'ambos'));
    if (vista !== 'actual') S.lotesProp.forEach((l) => pintarLote(l, true, false));
    actualizarControlEscenario();
    // Las zonas van primero para quedar debajo de líneas y puntos
    const conGeo = (el) => el.areas.map((e) => Object.assign({ geometria: 'area' }, e))
      .concat(el.lineas.map((e) => Object.assign({ geometria: 'linea' }, e)))
      .concat(el.puntos.map((e) => Object.assign({ geometria: 'punto' }, e)));
    const elementos = (vista !== 'propuesto' ? conGeo(S.elementos) : [])
      .concat(vista !== 'actual' ? conGeo(S.elementosProp) : []);
    const selLinea = S.tab === 'plan' && S.accion ? S.accion.elemento_linea_id : null;
    elementos.forEach((e) => {
      if (!e.geojson) return;
      const sel = (S.elemento && S.elemento.id === e.id) || selLinea === e.id;
      if (editandoCapa === 'elemento' && S.elemento && S.elemento.id === e.id) return;
      const color = colorElemento(e);
      const prop = e.escenario === 'propuesto';
      // Propuestas: trazo grueso con borde blanco para distinguirlas de lo de hoy
      if (prop && e.geometria === 'linea') {
        L.geoJSON(e.geojson, { style: { color: '#ffffff', weight: sel ? 10 : 8, opacity: 0.9 }, interactive: false }).addTo(capaElementos);
      }
      // Cercas: línea delgada con arbolitos (vivas) o estacones (muertas, de alambre)
      const sim = e.geometria === 'linea' ? simboloDe(e) : null;
      if (sim) lineasConSimbolo.push({ geojson: e.geojson, sim, sel });
      const estilo = e.geometria === 'area'
        ? { color: sel ? AMARILLO : color, weight: sel ? 4 : 2, dashArray: '6 4', fillColor: color, fillOpacity: sel ? 0.35 : 0.25 }
        : sim
        ? { color: sel ? AMARILLO : (sim === 'estacon' ? '#4e342e' : '#2e7d32'), weight: sel ? 4 : 2.5, dashArray: null }
        : { color: sel ? AMARILLO : color, weight: sel ? 6 : (prop ? 4.5 : 3.5),
          dashArray: prop ? '10 6' : (e.grupo === 'Vial' ? '8 5' : (e.permanencia === 'Intermitente' ? '3 5' : null)) };
      const capa = L.geoJSON(e.geojson, {
        style: estilo,
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: sel ? 9 : 7, color: sel ? AMARILLO : (prop ? '#1d2a1d' : '#fff'),
          weight: 2, fillColor: color, fillOpacity: 1 })
      })
        .bindTooltip(`${prop ? 'Propuesto: ' : ''}${esc(e.tipo)}${e.nombre ? ' · ' + esc(e.nombre) : ''}`, { sticky: true })
        .on('click', (ev) => { if (S.modoGeom) return; L.DomEvent.stop(ev); navegar(() => abrirElemento(e.geometria, e.id)); });
      capa.addTo(capaElementos);
    });
    pintarSimbolos();
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
    if (CM.activo) { CM.hoja = false; actualizarCampo(); }
  }
  function cerrarBarra() { $('#mapaBarra').hidden = true; if (CM.activo) setTimeout(actualizarCampo, 0); }

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
    if (tipo === 'elemento-linea' || tipo === 'elemento-linea-prop') {
      barra(tipo === 'elemento-linea-prop'
        ? 'Marque la <b>línea propuesta</b> (cerca viva, barrera viva, aislamiento, división de potreros). Termine con clic en el último punto.'
        : 'Marque los puntos de la <b>línea</b> (vía, río, quebrada, cerca…). Termine con clic en el último punto. ' +
        'Lo que quede fuera del predio se recorta.', [
        ['Terminar', () => { try { map.pm.Draw.Line._finishShape(); } catch (e) { /* nada */ } }, 'btn-primario'],
        ['↶ Deshacer', () => { try { map.pm.Draw.Line._removeLastVertex(); } catch (e) { /* nada */ } }],
        ['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('Line', estilo);
    } else if (tipo === 'elemento-area') {
      barra('Dibuje la <b>zona</b> (pendiente fuerte, área que se inunda, deslizamiento, conflicto de uso…). ' +
        'Puede pasar por encima de los lotes; lo que quede fuera del predio se recorta. Termine haciendo clic en el primer punto.', [
        ['Terminar', () => { try { map.pm.Draw.Polygon._finishShape(); } catch (e) { /* nada */ } }, 'btn-primario'],
        ['↶ Deshacer', () => { try { map.pm.Draw.Polygon._removeLastVertex(); } catch (e) { /* nada */ } }],
        ['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('Polygon', estilo);
    } else if (tipo === 'elemento-punto' || tipo === 'elemento-punto-prop') {
      barra(tipo === 'elemento-punto-prop'
        ? 'Haga clic en el sitio del <b>punto propuesto</b> (reservorio, vivero, colmenas…), dentro del predio.'
        : 'Haga clic en el sitio del <b>punto</b> (nacimiento, captación, vivienda…), dentro del predio.',
        [['Cancelar', cancelarGeometria]]);
      map.pm.enableDraw('CircleMarker', { pathOptions: { color: AMARILLO, radius: 8 } });
    } else {
      barra(tipo === 'predio'
        ? 'Marque los vértices del <b>límite del predio</b>. Termine haciendo clic en el primer punto.'
        : (tipo === 'lote-prop'
          ? 'Dibuje una zona de la <b>finca soñada</b> dentro del predio. Puede pasar por encima de los lotes actuales; ' +
            'solo se recorta contra los otros lotes propuestos. Termine haciendo clic en el primer punto.'
          : 'Dibuje el lote <b>dentro del predio</b>. Termine haciendo clic en el primer punto.'),
      [['Terminar', () => { try { map.pm.Draw.Polygon._finishShape(); } catch (e) { /* nada */ } }, 'btn-primario'],
        ['↶ Deshacer', () => { try { map.pm.Draw.Polygon._removeLastVertex(); } catch (e) { /* nada */ } }],
        ['Cancelar', cancelarGeometria]]);
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
    } else if (/^elemento-(linea|punto|area)/.test(modo.tipo)) {
      prepararElementoNuevo(modo.tipo.split('-')[1], geo,
        modo.tipo.endsWith('-prop') ? 'propuesto' : 'actual');
    } else {
      prepararLoteNuevo(geo, modo.tipo === 'lote-prop' ? 'propuesto' : 'actual');
    }
  }

  function prepararLoteNuevo(geo, escenario) {
    S.geomLoteNueva = geo;
    S.geomElementoNueva = null;
    capaEdicion.clearLayers();
    dibujarPendientes();
    const prop = escenario === 'propuesto';
    S.lote = { predio_id: S.predio.id, escenario: prop ? 'propuesto' : 'actual' };
    S.editando = 'lote';
    S.tab = prop ? 'finca' : 'lotes';
    render();
    aviso(prop ? 'Zona dibujada. Elija la zona PPS y el uso propuesto, y pulse Guardar.'
      : 'Polígono listo. Complete los datos del lote y pulse Guardar.');
  }

  function prepararElementoNuevo(geometria, geo, escenario) {
    S.geomElementoNueva = geo;
    S.geomLoteNueva = null;
    capaEdicion.clearLayers();
    dibujarPendientes();
    const prop = escenario === 'propuesto';
    S.elemento = { predio_id: S.predio.id, geometria, escenario: prop ? 'propuesto' : 'actual' };
    if (geometria === 'linea') S.elemento.longitud_m = window.SIP_GEO ? window.SIP_GEO.longitudM(geo) : null;
    else if (geometria === 'area') S.elemento.area_ha = window.SIP_GEO ? Math.round(window.SIP_GEO.areaHa(geo) * 10000) / 10000 : null;
    else { S.elemento.latitud = geo.coordinates[1]; S.elemento.longitud = geo.coordinates[0]; }
    S.editando = 'elemento';
    S.tab = prop ? 'finca' : 'elementos';
    render();
    aviso({ linea: 'Línea lista', punto: 'Punto listo', area: 'Zona lista' }[geometria] + '. Elija el tipo y pulse Guardar.');
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

  // Si la forma de un lote se monta sobre otros lotes, pregunta si se recortan esos lotes
  // (el lote nuevo queda completo) o si el lote nuevo se ajusta al espacio libre.
  async function resolverSolapes(geom, excluirId) {
    if (!geom || !S.predio || !S.predio.id) return;
    const escenario = S.lote && S.lote.escenario === 'propuesto' ? 'propuesto' : 'actual';
    const bajo = await api.lotesBajo(S.predio.id, geom, excluirId, escenario);
    if (!bajo || !bajo.length) return;
    const lista = bajo.map((l) => `• ${l.cod_lote} (${l.cultivo || 'sin cultivo'}): ${num(l.area_solape_ha, 4)} ha encima`).join('\n');
    const recortar = confirm(`El lote se monta sobre:\n${lista}\n\n` +
      `¿Desea RECORTAR ${bajo.length === 1 ? 'ese lote' : 'esos lotes'} para darle espacio?\n\n` +
      `• Aceptar: se recortan y este lote queda completo, tal como lo dibujó.\n` +
      `• Cancelar: este lote se ajusta solo al espacio libre.`);
    if (!recortar) return;
    await api.abrirEspacio(S.predio.id, geom, bajo.map((l) => l.id), escenario);
    aviso(`Se recortó ${bajo.map((l) => l.cod_lote).join(', ')} para darle espacio al lote.`);
  }

  async function guardarForma(tipo, geo) {
    try {
      if (tipo === 'predio') {
        await api.guardarPredio({ id: S.predio.id }, geo);
        cancelarGeometria();
        await recargarPredio(S.predio.id);
        listo(`Límite del predio guardado. Área SIG: ${num(S.predio.area_sig_ha, 2)} ha`);
        avisoArea(S.predio, 'Predio ' + S.predio.cod_predio);
      } else if (tipo === 'lote') {
        await resolverSolapes(geo, S.lote.id);
        await api.guardarLote({ id: S.lote.id }, geo);
        cancelarGeometria();
        await recargarLotes(S.lote.id);
        listo(`Forma del lote guardada. Área SIG: ${num(S.lote.area_sig_ha, 2)} ha`);
        avisoArea(S.lote, 'Lote ' + S.lote.cod_lote);
      } else {
        await api.guardarElemento(S.elemento.geometria, { id: S.elemento.id }, geo);
        cancelarGeometria();
        await recargarElementos(S.elemento.geometria, S.elemento.id);
        listo('Ubicación del elemento guardada.');
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
      S.predio = null; S.lotes = []; S.lote = null; S.elementos = { lineas: [], puntos: [], areas: [] }; S.elemento = null;
      limpiarPPS();
      $('#resultados').innerHTML = '';
      if (predioId) return abrirPredio(predioId);
      S.tab = 'productor';
      render();
      dibujarSeleccion(false);
    } catch (e) { aviso(e.message, true); }
  }

  // Separa los lotes actuales de los propuestos (finca soñada)
  function repartirLotes(lista) {
    S.lotes = lista.filter((l) => l.escenario !== 'propuesto');
    S.lotesProp = lista.filter((l) => l.escenario === 'propuesto');
  }
  const todosLotes = () => S.lotes.concat(S.lotesProp);
  function limpiarPPS() { S.lotesProp = []; S.plan = []; S.accion = null; S.ppsPredio = {}; S.elementosProp = { lineas: [], puntos: [], areas: [] }; }
  // Separa los elementos de hoy de los propuestos (finca soñada)
  function repartirElementos(el) {
    const prop = (e) => e.escenario === 'propuesto';
    const areas = el.areas || [];
    S.elementos = { lineas: el.lineas.filter((e) => !prop(e)), puntos: el.puntos.filter((e) => !prop(e)), areas: areas.filter((e) => !prop(e)) };
    S.elementosProp = { lineas: el.lineas.filter(prop), puntos: el.puntos.filter(prop), areas: areas.filter(prop) };
  }
  // Lista de cada geometría: líneas, puntos y zonas (áreas)
  const LISTA_EL = { linea: 'lineas', punto: 'puntos', area: 'areas' };
  const todosElementos = (g) => S.elementos[LISTA_EL[g]].concat(S.elementosProp[LISTA_EL[g]]);
  const nElementos = (el) => el.lineas.length + el.puntos.length + el.areas.length;
  // Prospectiva, selección y plan de acción del predio (si la base ya tiene la PPS)
  async function cargarPPS(predioId) {
    if (!S.pps) { limpiarPPS(); return; }
    const [pps, plan] = await Promise.all([api.ppsPredio(predioId).catch(() => ({})), api.planDe(predioId).catch(() => [])]);
    S.ppsPredio = pps || {}; S.plan = plan || [];
  }

  async function cargarElementos(predioId) {
    try { return await api.elementosDe(predioId); } catch (e) { return { lineas: [], puntos: [], areas: [] }; }
  }

  async function abrirPredio(id) {
    try {
      S.predio = S.predios.find((p) => p.id === id) || null;
      if (!S.predio) return;
      await cargarVeredas(S.predio.cod_mpio);
      const [lotes, elementos, carac, ficha] = await Promise.all([api.lotesDe(id), cargarElementos(id),
        api.caracterizacionesDe(id).catch(() => []), api.fichaDe(id).catch(() => null)]);
      repartirLotes(lotes); repartirElementos(elementos); S.carac = carac; S.ficha = ficha;
      S.lote = null; S.elemento = null; S.accion = null;
      await cargarPPS(id);
      S.tab = 'predio';
      render();
      dibujarSeleccion(true);
      planchaAlAbrir();
    } catch (e) { aviso(e.message, true); }
  }

  function abrirLote(id) {
    S.lote = todosLotes().find((l) => l.id === id) || null;
    S.tab = S.lote && S.lote.escenario === 'propuesto' ? 'finca' : 'lotes';
    render();
    dibujarSeleccion(false);
  }

  function abrirElemento(geometria, id) {
    const e = todosElementos(geometria).find((x) => x.id === id);
    S.elemento = e ? Object.assign({ geometria }, e) : null;
    S.tab = e && e.escenario === 'propuesto' ? 'finca' : 'elementos';
    render();
    dibujarSeleccion(false);
  }

  async function recargarPredio(id) {
    // Áreas y longitudes antes del cambio, para avisar qué se recortó con el límite nuevo
    const antes = {};
    // (lo que aún estaba por enviar no cuenta: su área era un cálculo del teléfono)
    todosLotes().filter((l) => !l._pendiente).forEach((l) => { antes['l' + l.id] = [l.cod_lote, Number(l.area_sig_ha)]; });
    todosElementos('linea').filter((e) => !e._pendiente).forEach((e) => { antes['e' + e.id] = [e.tipo + (e.nombre ? ' «' + e.nombre + '»' : ''), Number(e.longitud_m)]; });
    S.predios = await api.prediosDe(S.productor.id);
    S.predio = S.predios.find((p) => p.id === id) || null;
    if (S.predio) {
      const [lotes, elementos] = await Promise.all([api.lotesDe(id), cargarElementos(id)]);
      repartirLotes(lotes); repartirElementos(elementos);   // el límite nuevo recorta lotes y elementos
      if (S.lote) S.lote = todosLotes().find((l) => l.id === S.lote.id) || null;
      const cambio = (k, v) => antes[k] && Math.abs(antes[k][1] - Number(v)) > 0.0001;
      const ajustados = todosLotes().filter((l) => cambio('l' + l.id, l.area_sig_ha)).map((l) => l.cod_lote)
        .concat(todosElementos('linea').filter((e) => cambio('e' + e.id, e.longitud_m)).map((e) => antes['e' + e.id][0]));
      if (ajustados.length) {
        aviso('Con el límite nuevo se recortó lo que quedaba por fuera del predio: ' + ajustados.join(', ') + '.', 'alerta');
      }
    }
    render();
    dibujarSeleccion(true);
  }

  async function recargarLotes(loteId) {
    repartirLotes(await api.lotesDe(S.predio.id));
    S.predios = await api.prediosDe(S.productor.id);
    S.predio = S.predios.find((p) => p.id === S.predio.id) || S.predio;
    S.lote = loteId ? (todosLotes().find((l) => l.id === loteId) || null) : null;
    if (S.pps) S.plan = await api.planDe(S.predio.id).catch(() => S.plan);   // un lote borrado deja acciones sin lote
    render();
    dibujarSeleccion(false);
    api.prediosMapa().then((l) => { S.mapaPredios = l; actualizarBotonCorregir(); }).catch(() => {});
  }

  async function recargarElementos(geometria, id) {
    repartirElementos(await cargarElementos(S.predio.id));
    S.elemento = null;
    if (S.pps) S.plan = await api.planDe(S.predio.id).catch(() => S.plan);   // una línea borrada deja acciones sin línea
    if (id) {
      const e = todosElementos(geometria).find((x) => x.id === id);
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
    // Predios cargados de Kobo o de la línea base no tienen creador: los trabaja el técnico del
    // municipio (la base aplica la misma regla en predio_editar y revisa el municipio)
    if (reg.creado_por == null && reg.cod_predio && reg.num_lote === undefined && reg.tipo_id === undefined) return true;
    return reg.creado_por === (S.user && S.user.id);
  }
  const esAdmin = () => api.demo || (S.perfil && S.perfil.rol === 'admin');
  const esCoordinador = () => api.demo || (S.perfil && ['coordinador', 'admin'].includes(S.perfil.rol));
  const sinLimite = (p) => p && !p.geojson;

  // ---------- Semáforo de calidad (lo calcula la base: productores.revision_predio)
  const CALIDAD = {
    verde: { txt: 'Completo', ico: '✓' },
    amarillo: { txt: 'Por revisar', ico: '!' },
    rojo: { txt: 'Incompleto', ico: '✕' }
  };
  const textoPend = (t) => String(t).slice(2);
  function marcaCalidad(p) {
    const c = p && CALIDAD[p.calidad];
    if (!c) return '';
    const det = (p.pendientes || []).map(textoPend).join(' · ');
    return ` <span class="semaforo s-${p.calidad}" title="${esc(c.txt + (det ? ': ' + det : ''))}" aria-label="${esc(c.txt)}">${c.ico}</span>`;
  }
  function tarjetaCalidad(p) {
    const c = CALIDAD[p.calidad];
    if (!c) return '';
    const pend = p.pendientes || [];
    return `<div class="tarjeta calidad c-${p.calidad}">
      <div class="tarjeta-cab"><h2>Calidad del registro</h2>
        <span class="chip-calidad s-${p.calidad}"><span aria-hidden="true">${c.ico}</span> ${c.txt}</span></div>
      ${pend.length ? `<ul class="pendientes">${pend.map((t) => {
        const rojo = t.startsWith('R:');
        return `<li class="${rojo ? 'p-rojo' : 'p-amarillo'}"><span class="semaforo s-${rojo ? 'rojo' : 'amarillo'}" aria-hidden="true">${rojo ? '✕' : '!'}</span>${esc(textoPend(t))}</li>`;
      }).join('')}</ul>`
        : '<p class="sin-datos">Tiene caracterización, límite, lotes y ficha predial al día. No hay nada pendiente.</p>'}
    </div>`;
  }
  function actualizarBotonCorregir() {
    const b = $('#btnPorCorregir');
    if (!b) return;
    const lista = (S.mapaPredios || []).filter((p) => p.calidad && p.calidad !== 'verde');
    const rojos = lista.filter((p) => p.calidad === 'rojo').length;
    b.hidden = !lista.length;
    b.textContent = `🚦 Por corregir (${lista.length})`;
    b.title = `${rojos} incompletos (rojo) y ${lista.length - rojos} por revisar (amarillo)`;
  }
  // Lista de predios en rojo o amarillo (opcional: solo los que tienen un pendiente dado)
  function listarPorCorregir(filtro) {
    const el = $('#resultados');
    const orden = { rojo: 0, amarillo: 1 };
    const lista = (S.mapaPredios || [])
      .filter((p) => p.calidad && p.calidad !== 'verde')
      .filter((p) => !filtro || (p.pendientes || []).some((t) => textoPend(t) === filtro))
      .sort((a, b) => orden[a.calidad] - orden[b.calidad] || String(a.cod_predio).localeCompare(String(b.cod_predio)));
    const tit = filtro ? esc(filtro) : 'Predios por corregir';
    if (!lista.length) { el.innerHTML = `<div class="titulo">${tit}</div><p class="sin-datos">No hay predios en esta lista.</p>`; return; }
    el.innerHTML = `<div class="titulo">${tit} (${lista.length})</div>` + lista.map((p) => {
      const pend = (p.pendientes || []).map(textoPend);
      return `<button class="item" data-productor="${esc(p.productor_id)}" data-predio-abrir="${esc(p.id)}">
        <b>${marcaCalidad(p).trim()} ${esc(p.cod_predio)} · ${esc(p.nombre)}</b>
        <small>${esc(p.productor)} · ${esc([p.vereda, p.municipio].filter(Boolean).join(', '))}</small>
        <small class="pend-corto">${esc(pend.slice(0, 2).join(' · '))}${pend.length > 2 ? ` y ${pend.length - 2} más` : ''}</small></button>`;
    }).join('');
  }
  // Vuelve a leer el semáforo después de un cambio (ficha, lotes…)
  async function refrescarCalidad() {
    try {
      if (S.productor && S.productor.id) {
        S.predios = await api.prediosDe(S.productor.id);
        if (S.predio && S.predio.id) S.predio = S.predios.find((p) => p.id === S.predio.id) || S.predio;
      }
      S.mapaPredios = await api.prediosMapa();
      actualizarBotonCorregir();
      if (!S.editando) render();
    } catch (e) { /* el semáforo se actualiza en la próxima carga */ }
  }

  // ======================================================================
  //  RENDER
  // ======================================================================
  function render() {
    recordarUltimo();
    // Al entrar a la finca soñada o al plan se muestra lo propuesto; al volver a Lotes, lo actual
    if (S.tab !== S.tabMapa) {
      S.tabMapa = S.tab;
      const antes = S.vistaMapa;
      if (['finca', 'plan'].includes(S.tab) && S.vistaMapa === 'actual' && (S.tab === 'finca' || S.lotesProp.length)) S.vistaMapa = 'propuesto';
      if (S.tab === 'lotes') S.vistaMapa = 'actual';      // en Lotes se trabaja sobre lo actual
      if (antes !== S.vistaMapa && map) setTimeout(() => dibujarSeleccion(false), 0);
    }
    renderArbol();
    renderMigas();
    renderPestanas();
    renderContenido();
    actualizarCampo();
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
            <span>L${String(l.num_lote).padStart(2, '0')}${marcaDif(l)}${pend(l)}</span><small>${esc(l.cultivo || '')}</small></button></li>`;
        }).join('')}${nodoElementos()}${nodosPPS()}</ul>` : '';
        return `<li><button class="nodo${act}" data-predio="${esc(p.id)}"><span class="ico">🏡</span>
          <span class="cod">${esc(p.cod_predio)}${marcaCalidad(p)}${marcaDif(p)}${sinLimite(p) ? ' <span class="marca-pend" title="Pendiente de delimitar">📍</span>' : ''}</span><small>${esc(p.nombre)}</small></button>${lotes}</li>`;
      }).join('') || '<li class="sin-datos">Sin predios</li>'}</ul>
    </li></ul>`;
  }

  function nodoElementos() {
    const n = nElementos(S.elementos);
    if (!n) return '';
    const a = S.tab === 'elementos' ? ' activo' : '';
    return `<li><button class="nodo${a}" data-tab="elementos"><span class="ico">💧</span><span>Elementos</span><small>${n}</small></button></li>`;
  }

  // Ramas de la PPS en el árbol: finca soñada (con sus lotes propuestos) y plan de acción
  function nodosPPS() {
    if (!S.pps) return '';
    const aF = S.tab === 'finca' && !(S.lote && S.lote.escenario === 'propuesto') ? ' activo' : '';
    const aP = S.tab === 'plan' ? ' activo' : '';
    const conc = S.plan.filter((a) => a.estado === 'concertado').length;
    const hijos = S.lotesProp.map((l) => {
      const a = S.lote && S.lote.id === l.id && S.tab === 'finca' ? ' activo' : '';
      return `<li><button class="nodo${a}" data-lote="${esc(l.id)}"><span class="punto-color" style="background:${esc(colorZona(l))}"></span>
        <span>${nomLote(l)}</span><small>${esc(l.zona_pps || 'sin zona')}</small></button></li>`;
    }).join('');
    return `<li><button class="nodo${aF}" data-tab="finca"><span class="ico">🌳</span><span>Finca soñada</span>
        <small>${S.lotesProp.length ? S.lotesProp.length + ' lotes' : 'sin dibujar'}${S.elementosProp.lineas.length ? ' · ' + S.elementosProp.lineas.length + ' líneas' : ''}</small></button>${hijos ? `<ul>${hijos}</ul>` : ''}</li>
      <li><button class="nodo${aP}" data-tab="plan"><span class="ico">📋</span><span>Plan de acción</span>
        <small>${S.plan.length ? `${S.plan.length} · ${conc} concertadas` : 'sin acciones'}</small></button></li>`;
  }

  function renderMigas() {
    const m = [];
    if (S.productor) m.push(`Productor: <b>${esc(S.productor.id ? (S.productor.nombres + ' ' + (S.productor.apellidos || '')) : 'nuevo')}</b>`);
    if (S.predio) m.push(`Predio: <b>${esc(S.predio.cod_predio || 'nuevo')}</b>`);
    if (S.lote && S.tab === 'lotes') m.push(`Lote: <b>${esc(S.lote.cod_lote || 'nuevo')}</b>`);
    if (S.tab === 'finca') m.push('<b>Finca soñada</b>' + (S.lote && S.lote.escenario === 'propuesto' ? ` &nbsp;›&nbsp; <b>${esc(S.lote.cod_lote || 'nuevo lote')}</b>` : ''));
    if (S.tab === 'plan') m.push('<b>Plan de acción</b>');
    if (S.elemento && S.tab === 'elementos') m.push(`Elemento: <b>${esc(S.elemento.tipo || 'nuevo')}</b>`);
    $('#migas').innerHTML = m.join(' &nbsp;›&nbsp; ');
  }

  function renderPestanas() {
    const el = $('#pestanas');
    if (!S.productor) { el.innerHTML = ''; return; }
    const hayPredio = !!(S.predio && S.predio.id);
    const nEl = nElementos(S.elementos);
    const t = [
      ['productor', 'Productor', true],
      ['predio', `Predio${S.predios.length ? ' (' + S.predios.length + ')' : ''}`, !!S.productor.id],
      ['lotes', `Lotes${hayPredio ? ' (' + S.lotes.length + ')' : ''}`, hayPredio],
      ['elementos', `Elementos${hayPredio ? ' (' + nEl + ')' : ''}`, hayPredio]
    ];
    if (S.pps) {
      t.push(['finca', `Finca soñada${hayPredio ? ' (' + S.lotesProp.length + ')' : ''}`, hayPredio],
        ['plan', `Plan de acción${hayPredio ? ' (' + S.plan.length + ')' : ''}`, hayPredio]);
    }
    el.innerHTML = t.map(([k, txt, hab]) =>
      `<button class="pestana" role="tab" data-tab="${k}" aria-selected="${S.tab === k}"${hab ? '' : ' disabled'}>${txt}</button>`).join('');
  }

  function renderContenido() {
    const el = $('#contenido');
    if (!S.productor) return;
    if (S.tab === 'productor') el.innerHTML = vistaProductor();
    else if (S.tab === 'predio') el.innerHTML = vistaPredio();
    else if (S.tab === 'elementos') el.innerHTML = vistaElementos();
    else if (S.tab === 'finca' && S.pps) el.innerHTML = vistaFinca();
    else if (S.tab === 'plan' && S.pps) el.innerHTML = vistaPlan();
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

  function htmlOpciones(ops, v, orden) {
    const opt = ([val, txt]) =>
      `<option value="${esc(val)}"${String(val) === String(v == null ? '' : v) ? ' selected' : ''}>${esc(txt)}</option>`;
    if (!ops.length || ops[0].length < 3) return ops.map(opt).join('');
    // Opciones agrupadas (cultivo por tipo de cobertura, elemento por grupo)
    const grupos = {};
    ops.forEach((o) => { (grupos[o[2]] = grupos[o[2]] || []).push(o); });
    const pos = (g) => { if (g.startsWith('★')) return -1;   // recomendadas primero
      const i = (orden || []).indexOf(g); return i < 0 ? 100 + ordenGrupo(g) : i; };
    return Object.keys(grupos).sort((a, b) => pos(a) - pos(b) || a.localeCompare(b))
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
        let html = `<option value="">—</option>` + htmlOpciones(opciones(c, obj), v, c.orden);
        if (c.op === 'veredas' && editable) html += '<option value="__nueva">＋ Agregar vereda…</option>';
        ctl = `<select id="${id}" data-k="${c.k}"${dis}>${html}</select>`;
      } else if (c.t === 'textarea') {
        ctl = `<textarea id="${id}" data-k="${c.k}"${dis}>${esc(v)}</textarea>`;
      } else if (c.t === 'checks') {
        const marcadas = Array.isArray(v) ? v : [];
        const ops = opciones(c, obj);
        ctl = `<div id="${id}" class="checks" data-k="${c.k}">${ops.map(([val, txt]) =>
          `<label class="check"><input type="checkbox" value="${esc(val)}"${marcadas.includes(val) ? ' checked' : ''}${dis}> ${esc(txt)}</label>`).join('')
          || '<span class="sin-datos">—</span>'}</div>`;
      } else {
        ctl = `<input id="${id}" data-k="${c.k}" type="${c.t || 'text'}"${c.step ? ` step="${c.step}"` : ''}${c.t === 'number' ? ' min="0"' : ''}${c.max != null ? ` max="${c.max}"` : ''} value="${esc(v)}"${dis}>`;
      }
      let ay = editable && !c.ro && !dis && (AYUDA[tipo] || {})[c.k];
      if (typeof ay === 'function') ay = ay();
      return `<div class="campo${c.ancho === 2 ? ' ancho2' : ''}${c.ro ? ' calculado' : ''}${(c.ro || c.sec) ? ' sec' : ''}">
        <label for="${id}">${esc(c.l)}${req}</label>${ctl}${ay ? `<small class="ayuda">${esc(ay)}</small>` : ''}</div>`;
    }).join('') + '</div>' +
      (CAMPOS[tipo].some((c) => (c.ro || c.sec) && !(c.solo && obj.geometria !== c.solo))
        ? '<button type="button" class="btn btn-claro btn-peq mas-datos" data-mas-datos>Más datos ▾</button>' : '');
  }

  function leerForm(tipo) {
    const datos = {};
    CAMPOS[tipo].filter((c) => !c.ro).forEach((c) => {
      const el = $(`#f_${tipo}_${c.k}`);
      if (!el) return;
      if (c.t === 'checks') { datos[c.k] = $$('input:checked', el).map((x) => x.value); return; }
      let v = el.value.trim();
      if (v === '__nueva') v = '';
      if (c.req && v === '') throw new Error(`El campo "${c.l}" es obligatorio.`);
      if (v === '') v = null;
      else if (c.b) v = v === 'true';
      else if (c.t === 'number' || c.n) {
        v = Number(v.replace(',', '.'));
        if (Number.isNaN(v)) throw new Error(`El campo "${c.l}" debe ser un número.`);
        if (c.max != null && v > c.max) throw new Error(`El campo "${c.l}" no puede ser mayor que ${c.max}.`);
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
    const docPendiente = p.id && /^PEND-/.test(p.num_doc || '');
    let html = docPendiente ? `<p class="aviso">⚠ Este productor se cargó de la encuesta ZAP II sin número de documento
      (código provisional <b>${esc(p.num_doc)}</b>). Pida la cédula en la visita y corríjala con «Editar»;
      revise también que nombres y apellidos queden separados.</p>` : '';
    html += `<div class="tarjeta">
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
            <td>${esc(x.cod_predio)}${marcaCalidad(x)}${marcaDif(x)}${sinLimite(x) ? ' <span class="marca-pend" title="Pendiente de delimitar">📍</span>' : ''}</td><td>${esc(x.nombre)}</td><td>${esc(x.municipio)}</td><td>${esc(x.vereda || '—')}${x.vereda && x.vereda_validada === false ? ' <small>(por validar)</small>' : ''}</td>
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
      if (!ed) html += tarjetaCalidad(p);
      if (!ed && S.pps) html += tarjetaRuta(p);
    }
    html += `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>${p.id ? 'Predio ' + esc(p.cod_predio) : 'Nuevo predio'}</h2>
        <div class="acciones">${p.id && !ed ? '<button class="btn btn-acento btn-peq" data-accion="ficha">Ficha predial</button>' : ''}${p.id && !ed && S.ficha
          ? `<button class="btn btn-borde btn-peq" data-accion="abrir-ficha" title="Guardada el ${esc(new Date(S.ficha.generado_en).toLocaleString('es-CO'))} (versión ${esc(S.ficha.version)})">📄 Ficha guardada</button>` : ''}${botonesEdicion('predio', p)}${p.id && !ed
          ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-predio">Eliminar predio</button>' : ''}</div></div>
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
        ${puede ? guia('limite', !p.geojson) : ''}
        <p class="sin-datos">${p.geojson
          ? 'El código, el área SIG y la ubicación se calculan automáticamente a partir del límite.'
          : (p.latitud != null
            ? `<b>Pendiente de delimitar.</b> El punto naranja del mapa es la ubicación GPS de la visita
               (${num(p.latitud, 6)}, ${num(p.longitud, 6)}). Recorra el lindero con el productor y dibújelo,
               o cárguelo desde un archivo (botón de carpeta del mapa).`
            : 'Este predio todavía no tiene límite. Dibújelo en el mapa o cárguelo desde un archivo (botón de carpeta del mapa).')}</p>
      </div>`;
      html += tarjetaPlancha(p);
      html += tarjetaCaracterizacion();
      if (S.pps) html += tarjetaContexto();
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
      ${guia('lotes', !S.lotes.length)}
      ${S.lotes.length ? `<table class="tabla"><thead><tr>
          <th>Lote</th><th>Cultivo / cobertura</th><th class="num">Área (ha)</th><th class="num">Sitios</th><th class="num">Ocup.</th><th>Estado</th>
        </tr></thead><tbody>${S.lotes.map((l) => `<tr data-lote="${esc(l.id)}"${S.lote && S.lote.id === l.id ? ' class="activo"' : ''}>
          <td><b>L${String(l.num_lote).padStart(2, '0')}</b></td>
          <td><span class="punto-color" style="background:${colorLote(l)}"></span>${esc(l.cultivo || '—')}${pend(l)}</td>
          <td class="num">${num(l.area_sig_ha != null ? l.area_sig_ha : l.area_declarada_ha)}${marcaDif(l)}</td>
          <td class="num">${num(l.sitios_estimados, 0)}</td>
          <td class="num">${l.ocupacion_pct == null ? '—' : num(l.ocupacion_pct, 0) + ' %'}</td>
          <td>${esc(l.estado || '—')}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2">Total en lotes / área del predio</td>
          <td class="num" colspan="2">${num(total)} / ${num(p.area_sig_ha != null ? p.area_sig_ha : p.area_declarada_ha)}</td><td colspan="2"></td></tr></tfoot></table>`
        : '<p class="sin-datos">Este predio no tiene lotes. Use “Dibujar lote” para trazarlo dentro del predio.</p>'}
    </div>`;

    const l = S.lote && S.lote.escenario !== 'propuesto' ? S.lote : null;
    if (l) {
      const ed = S.editando === 'lote';
      const puede = puedeEditar(l);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${l.id ? 'Lote ' + esc(l.cod_lote) : 'Nuevo lote'}${pend(l)}</h2>
          <div class="acciones">${botonesEdicion('lote', l)}
            ${l.id && !ed && puede && l.geojson ? '<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="lote">Editar forma</button>' : ''}
            ${l.id && !ed && puede && !l.geojson && p.geojson ? '<button class="btn btn-borde btn-peq" data-accion="dibujar-existente">Dibujar forma</button>' : ''}
            ${l.id && !ed ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-lote">Eliminar</button>' : ''}
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

  // ---------- Contexto del mapa actual (tabla 1): sistema principal, microcuenca, áreas protegidas
  function tarjetaContexto() {
    const ed = S.editando === 'contexto';
    return `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Contexto del predio</h2>
        <div class="acciones">${botonesEdicion('contexto', S.predio)}</div></div>
      ${htmlForm('contexto', Object.assign({}, S.ppsPredio), ed)}
    </div>`;
  }

  // ---------- Selección del predio (criterios 35/35/30 y habilitantes)
  function tarjetaSeleccion() {
    const ed = S.editando === 'seleccion';
    const r = Object.assign({}, S.ppsPredio);
    return `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Selección del predio (PPS)</h2>
        <div class="acciones">${botonesEdicion('seleccion', S.predio)}</div></div>
      ${guia('seleccion', ed)}
      ${htmlForm('seleccion', r, ed)}
      <p class="nota">Puntaje = 35 % ambiental + 35 % territorio + 30 % mejora. Los habilitantes son condiciones
        para entrar al programa.</p>
    </div>`;
  }

  // Hectáreas por zona PPS: lo actual frente a la finca soñada
  function comparacionZonas() {
    const area = (l) => Number(l.area_sig_ha != null ? l.area_sig_ha : (l.area_declarada_ha || 0));
    const filas = (S.pps.zonas || []).map((z) => ({ nombre: z.nombre, color: z.color,
      hoy: S.lotes.filter((l) => +l.zona_pps_id === z.id).reduce((t, l) => t + area(l), 0),
      fut: S.lotesProp.filter((l) => +l.zona_pps_id === z.id).reduce((t, l) => t + area(l), 0) }));
    const sinZ = { nombre: 'Sin zona asignada', color: '#cfcfcf',
      hoy: S.lotes.filter((l) => !l.zona_pps_id).reduce((t, l) => t + area(l), 0),
      fut: S.lotesProp.filter((l) => !l.zona_pps_id).reduce((t, l) => t + area(l), 0) };
    const lista = filas.concat([sinZ]).filter((f) => f.hoy > 0 || f.fut > 0);
    if (!lista.length) return '';
    const max = Math.max(...lista.map((f) => Math.max(f.hoy, f.fut)), 0.0001);
    const barra = (v, c, cls) => `<span class="barra-zona ${cls}" style="width:${Math.max(2, 100 * v / max)}%;background:${esc(c)}"></span>`;
    const dif = (f) => { const d = f.fut - f.hoy; return Math.abs(d) < 0.005 ? '=' : (d > 0 ? '+' : '−') + num(Math.abs(d)); };
    return `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>Hoy frente a la finca soñada</h2></div>
      <table class="tabla tabla-zonas"><thead><tr><th>Zona PPS</th><th class="num">Hoy (ha)</th><th class="num">En 10 años (ha)</th><th class="num">Cambio</th><th class="col-barras"></th></tr></thead>
      <tbody>${lista.map((f) => `<tr><td><span class="punto-color" style="background:${esc(f.color)}"></span>${esc(f.nombre)}</td>
        <td class="num">${num(f.hoy)}</td><td class="num">${num(f.fut)}</td><td class="num">${dif(f)}</td>
        <td class="col-barras">${barra(f.hoy, f.color, 'hoy')}${barra(f.fut, f.color, 'fut')}</td></tr>`).join('')}</tbody></table>
      <p class="nota">Barra superior: hoy (más clara) · barra inferior: finca soñada. Los lotes actuales cuentan
        como «sin zona» hasta que se les asigne una en la pestaña Lotes.</p>
    </div>`;
  }

  // ---------- Finca soñada: lotes propuestos, zonas PPS y prospectiva de la familia
  function vistaFinca() {
    const p = S.predio;
    if (!p || !p.id) return '<div class="vacio"><p>Primero seleccione un predio.</p></div>';
    const puede = puedeEditar(p);
    const prop = S.lotesProp;
    const area = (l) => Number(l.area_sig_ha != null ? l.area_sig_ha : (l.area_declarada_ha || 0));
    const total = prop.reduce((t, l) => t + area(l), 0);
    const areaP = p.area_sig_ha != null ? p.area_sig_ha : p.area_declarada_ha;
    const conZona = prop.filter((l) => l.zona_pps_id).length;
    const sinCopiar = !prop.length && S.lotes.some((l) => l.geojson);
    let html = tarjetaVision(p) + `<div class="resumen">
        <div class="dato"><span>Lotes propuestos</span><b>${prop.length}</b></div>
        <div class="dato"><span>Área propuesta</span><b>${num(total)} ha</b></div>
        <div class="dato${prop.length && conZona < prop.length ? ' alerta' : ''}"><span>Con zona PPS</span><b>${conZona} de ${prop.length}</b></div>
        <div class="dato"><span>Área del predio</span><b>${num(areaP)} ha</b></div>
      </div>
      <div class="tarjeta">
      <div class="tarjeta-cab"><h2>2 · Finca soñada (10 años) · ${esc(p.cod_predio)}</h2>
        <div class="acciones">
          ${sinCopiar && puede ? '<button class="btn btn-borde btn-peq" data-accion="copiar-lotes">⧉ Copiar lotes actuales como punto de partida</button>' : ''}
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="lote-prop"${p.geojson && puede ? '' : ' disabled title="Primero dibuje el límite del predio"'}>＋ Dibujar lote propuesto</button>
        </div></div>
      ${guia('finca', !prop.length)}
      <p class="sin-datos">Los lotes propuestos no se recortan contra los actuales, solo entre ellos, y no cambian los
        indicadores de hoy. Bosques, humedales y áreas de conservación se dibujan como lotes con zona de preservación o restauración.</p>
      ${prop.length ? `<table class="tabla"><thead><tr>
          <th>Lote</th><th>Zona PPS</th><th>Uso o cobertura</th><th class="num">Área (ha)</th>
        </tr></thead><tbody>${prop.map((l) => `<tr data-lote="${esc(l.id)}"${S.lote && S.lote.id === l.id ? ' class="activo"' : ''}>
          <td><b>${nomLote(l)}</b></td>
          <td><span class="punto-color" style="background:${esc(colorZona(l))}"></span>${l.zona_pps ? esc(l.zona_pps) : '<span class="falta">Sin zona</span>'}</td>
          <td>${esc(l.cultivo || '—')}${l.cobertura_clc ? ` <small>(${esc(l.cobertura_clc)})</small>` : ''}${pend(l)}</td>
          <td class="num">${num(area(l))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Total propuesto / área del predio</td><td class="num">${num(total)} / ${num(areaP)}</td></tr></tfoot></table>`
        : `<p class="sin-datos">${sinCopiar ? 'Para empezar rápido, copie los lotes actuales y ajústelos; o dibuje la finca soñada desde cero.'
          : 'Aún no hay lotes propuestos. Use «Dibujar lote propuesto».'}</p>`}
    </div>`;

    html += tarjetaElementosProp(p, puede);
    const l = S.lote && S.lote.escenario === 'propuesto' ? S.lote : null;
    if (l) {
      const ed = S.editando === 'lote';
      const pl = puedeEditar(l);
      const enPlan = S.plan.filter((a) => a.lote_id === l.id).length;
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${l.id ? 'Lote propuesto ' + esc(l.cod_lote) : 'Nuevo lote propuesto'}${pend(l)}</h2>
          <div class="acciones">${botonesEdicion('lote', l)}
            ${l.id && !ed && pl && l.geojson ? '<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="lote">Editar forma</button>' : ''}
            ${l.id && !ed ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-lote">Eliminar</button>' : ''}
          </div></div>
        ${!l.id && S.geomLoteNueva ? '<p class="aviso">El polígono dibujado se guardará con este lote propuesto.</p>' : ''}
        ${htmlForm('loteprop', l, ed)}
        ${enPlan ? `<p class="nota">Este lote tiene ${enPlan} acción(es) en el plan de acción.</p>` : ''}
      </div>`;
    }
    html += comparacionZonas();
    return html;
  }
  // Líneas y puntos de la finca soñada: cercas vivas, barreras vivas, aislamientos, divisiones de potreros…
  function tarjetaElementosProp(p, puede) {
    const lin = S.elementosProp.lineas, pun = S.elementosProp.puntos;
    const hab = p.geojson && puede && S.cat.tiposElemento && S.cat.tiposElemento.length;
    const porTipo = {};
    lin.forEach((e) => { porTipo[e.tipo] = (porTipo[e.tipo] || 0) + Number(e.longitud_m || 0); });
    const filas = lin.map((e) => ['linea', e, fmtLong(Number(e.longitud_m || 0))]).concat(pun.map((e) => ['punto', e, 'punto']));
    let html = `<div class="tarjeta">
      <div class="tarjeta-cab"><h2>3 · Líneas y puntos de la finca soñada</h2>
        <div class="acciones">
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-linea-prop"${hab ? '' : ' disabled title="Primero dibuje el límite del predio"'}>＋ Línea propuesta</button>
          <button class="btn btn-borde btn-peq" data-accion="dibujar" data-tipo="elemento-punto-prop"${hab ? '' : ' disabled'}>＋ Punto propuesto</button>
        </div></div>
      ${guia('lineasProp', !filas.length)}
      ${Object.keys(porTipo).length ? `<div class="resumen resumen-chico">${Object.entries(porTipo).map(([t, m]) =>
        `<div class="dato"><span>${esc(t)}</span><b>${fmtLong(m)}</b></div>`).join('')}</div>` : ''}
      ${filas.length ? `<table class="tabla"><thead><tr><th>Tipo</th><th>Nombre</th><th class="num">Medida</th><th>En el plan</th></tr></thead>
        <tbody>${filas.map(([g, e, medida]) => {
          const enPlan = S.plan.filter((a) => a.elemento_linea_id === e.id).length;
          return `<tr data-elemento="${g}:${esc(e.id)}"${S.elemento && S.elemento.id === e.id ? ' class="activo"' : ''}>
          <td><span class="punto-color${g === 'punto' ? '' : ' ' + g}" style="background:${colorElemento(e)}"></span>${esc(e.tipo)}${pend(e)}</td>
          <td>${esc(e.nombre || '—')}</td><td class="num">${medida}</td>
          <td>${g === 'linea' ? (enPlan ? `✓ ${enPlan} acción(es)` : '<span class="falta">Sin acción</span>') : '—'}</td></tr>`;
        }).join('')}</tbody></table>`
        : '<p class="sin-datos">Aún no hay líneas ni puntos propuestos.</p>'}
    </div>`;
    const e = S.elemento && S.elemento.escenario === 'propuesto' ? S.elemento : null;
    if (e) {
      const ed = S.editando === 'elemento';
      const pe = puedeEditar(e);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${e.id ? 'Propuesto: ' + esc(e.tipo) + (e.nombre ? ' · ' + esc(e.nombre) : '') : (e.geometria === 'linea' ? 'Nueva línea propuesta' : 'Nuevo punto propuesto')}</h2>
          <div class="acciones">${botonesEdicion('elemento', e)}
            ${e.id && !ed && pe && e.geojson ? `<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="elemento">${e.geometria === 'linea' ? 'Editar trazo' : 'Mover punto'}</button>` : ''}
            ${e.id && !ed && pe ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-elemento">Eliminar</button>' : ''}
          </div></div>
        ${htmlForm('elemento', e, ed)}
      </div>`;
    }
    return html;
  }

  // Visión de la familia: lo primero de la finca soñada (se recoge al cerrar la visita 1)
  function tarjetaVision(p) {
    const edP = S.editando === 'prospectiva';
    const falta = !hayVision();
    return `<div class="tarjeta${falta && !edP ? ' tarjeta-paso' : ''}">
      <div class="tarjeta-cab"><h2>1 · Visión de la familia</h2>
        <div class="acciones">${botonesEdicion('prospectiva', p)}</div></div>
      ${falta && !edP ? `<p class="aviso">Empiece aquí. Al cerrar la <b>visita 1</b>, pregunte a la familia cómo quiere ver
        la finca en 10 años y escríbalo con sus palabras. Con esa visión se dibuja la finca soñada entre visitas
        y se ajusta y concerta en la <b>visita 2</b>.</p>` : ''}
      ${guia('vision', falta || edP)}
      ${htmlForm('prospectiva', S.ppsPredio, edP)}
      <p class="nota">Solo se registran conteos de participantes, sin nombres de menores de edad (Ley 1581 de 2012).</p>
    </div>`;
  }

  // Recordatorio: la finca soñada se dibuja a partir de la visión de la familia
  const CAMPOS_VISION = ['vision_familia', 'vision_ambiental', 'vision_productiva', 'vision_alimentacion',
    'vision_infraestructura', 'vision_cambios', 'vision_capacidades'];
  const hayVision = () => CAMPOS_VISION.some((k) => S.ppsPredio && S.ppsPredio[k]);
  function sinVisionOk() {
    if (hayVision()) return true;
    return confirm('Aún no está registrada la visión de la familia.\n\nLo recomendado es escribirla primero (al cerrar la visita 1) ' +
      'y dibujar la finca soñada a partir de ella.\n\n¿Desea dibujar de todos modos?');
  }

  // ---------- Ruta del predio en dos visitas
  function tarjetaRuta(p) {
    const vis = hayVision();
    const conc = S.plan.filter((a) => a.estado === 'concertado').length;
    const pasos = [
      ['Visita 1', [
        ['Caracterización (Kobo)', (S.carac || []).some((c) => c.estado === 'procesada'), 'predio'],
        ['Límite del predio dibujado', !!p.geojson, 'predio'],
        ['Lotes de hoy (mapa actual)', S.lotes.some((l) => l.geojson), 'lotes'],
        ['Visión de la familia', vis, 'finca']]],
      ['Entre visitas (oficina)', [
        ['Finca soñada dibujada, con zona PPS', S.lotesProp.length > 0 && S.lotesProp.every((l) => l.zona_pps_id), 'finca'],
        ['Plan de acción en borrador', S.plan.length > 0, 'plan']]],
      ['Visita 2', [
        ['Acciones concertadas', conc > 0, 'plan'],
        ['Ficha predial guardada', !!S.ficha, 'predio']]]
    ];
    const hechos = pasos.reduce((t, [, l]) => t + l.filter((x) => x[1]).length, 0);
    const total = pasos.reduce((t, [, l]) => t + l.length, 0);
    return `<div class="tarjeta ruta">
      <div class="tarjeta-cab"><h2>Ruta del predio en dos visitas</h2><span class="chip">${hechos} de ${total}</span></div>
      <div class="ruta-pasos">${pasos.map(([t, l]) => `<div class="ruta-paso"><h3>${esc(t)}</h3><ul>${l.map(([n, ok, tab]) =>
        `<li class="${ok ? 'hecho' : ''}"><button class="enlace" data-tab="${tab}"><span aria-hidden="true">${ok ? '✓' : '○'}</span> ${esc(n)}</button>
          <span class="sr-only">${ok ? 'hecho' : 'pendiente'}</span></li>`).join('')}</ul></div>`).join('')}</div>
    </div>`;
  }

  // ---------- Plan de acción: lo que la familia y el técnico acuerdan hacer
  function vistaPlan() {
    const p = S.predio;
    if (!p || !p.id) return '<div class="vacio"><p>Primero seleccione un predio.</p></div>';
    const cat = (id) => (S.pps.acciones || []).find((a) => a.id === +id) || {};
    const apoyo = (c) => ((S.pps.apoyos || []).find((a) => a.codigo === c) || {}).nombre || c;
    const lote = (id) => todosLotes().find((l) => l.id === id);
    const lista = S.plan.slice().sort((a, b) => (a.prioridad || 9) - (b.prioridad || 9)
      || TIPOS_ACCION.indexOf(cat(a.accion_id).tipo) - TIPOS_ACCION.indexOf(cat(b.accion_id).tipo));
    const conc = S.plan.filter((a) => a.estado === 'concertado').length;
    const porTipo = TIPOS_ACCION.map((t) => [t, S.plan.filter((a) => cat(a.accion_id).tipo === t).length]);
    const nApoyos = new Set([].concat(...S.plan.map((a) => a.apoyos || []))).size;
    let html = `<div class="resumen">
        <div class="dato"><span>Acciones</span><b>${S.plan.length}</b></div>
        <div class="dato${S.plan.length && !conc ? ' alerta' : ''}"><span>Concertadas</span><b>${conc}</b></div>
        ${porTipo.map(([t, n]) => `<div class="dato"><span>${esc(t)}</span><b>${n}</b></div>`).join('')}
        <div class="dato"><span>Tipos de apoyo</span><b>${nApoyos}</b></div>
      </div>
      <div class="tarjeta">
      <div class="tarjeta-cab"><h2>Plan de acción · ${esc(p.cod_predio)}</h2>
        <div class="acciones"><button class="btn btn-acento btn-peq" data-accion="nueva-accion"${puedeEditar(p) ? '' : ' disabled'}>＋ Agregar acción</button></div></div>
      ${guia('plan', !S.plan.length)}
      ${lista.length ? `<table class="tabla tabla-plan"><thead><tr>
          <th>Acción</th><th>Dónde</th><th class="num">Cantidad</th><th>Plazo</th><th class="num">Prior.</th>
        </tr></thead><tbody>${lista.map((a) => {
          const c = cat(a.accion_id), l = lote(a.lote_id);
          const li = a.elemento_linea_id ? S.elementosProp.lineas.find((x) => x.id === a.elemento_linea_id) : null;
          const ap = (a.apoyos || []).map(apoyo).join(', ');
          return `<tr data-plan="${esc(a.id)}"${S.accion && S.accion.id === a.id ? ' class="activo"' : ''}>
            <td><b>${esc(c.nombre || '—')}</b>
              <span class="chip ${a.estado === 'concertado' ? 'chip-verde' : 'chip-borrador'}">${a.estado === 'concertado' ? 'Concertada' : 'Borrador'}</span>
              <br><small>${esc(c.tipo || '')}${ap ? ' · Apoyos: ' + esc(ap) : ''}</small></td>
            <td>${[l ? nomLote(l) : '', li ? esc(li.tipo) + ' ' + num(li.longitud_m, 0) + ' m' : ''].filter(Boolean).join(' · ') || '—'}</td>
            <td class="num">${a.cantidad != null ? num(a.cantidad) + ' ' + esc(a.unidad || '') : '—'}</td>
            <td>${esc(PLAZO[a.plazo] || '—')}</td><td class="num">${a.prioridad || '—'}</td></tr>`;
        }).join('')}</tbody></table>`
        : '<p class="sin-datos">Aún no hay acciones. Use «Agregar acción».</p>'}
    </div>`;
    const a = S.accion;
    if (a) {
      const ed = S.editando === 'accion';
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${a.id ? esc(cat(a.accion_id).nombre || 'Acción') : 'Nueva acción'}</h2>
          <div class="acciones">${botonesEdicion('accion', a)}
            ${a.id && !ed ? '<button class="btn btn-peligro btn-peq" data-accion="borrar-accion">Eliminar</button>' : ''}
          </div></div>
        ${htmlForm('accion', a, ed)}
        ${!S.lotesProp.length ? '<p class="nota">Aún no hay finca soñada: dibuje los lotes propuestos para ubicar las acciones.</p>' : ''}
      </div>`;
    }
    return html;
  }

  function vistaElementos() {
    const p = S.predio;
    if (!p || !p.id) return '<div class="vacio"><p>Primero seleccione un predio.</p></div>';
    const lineas = S.elementos.lineas, puntos = S.elementos.puntos, areas = S.elementos.areas;
    const hayTipos = S.cat.tiposElemento && S.cat.tiposElemento.length;
    const hab = p.geojson && hayTipos && puedeEditar(p);
    const tit = !hayTipos ? ' title="Falta ejecutar sql/09_paquete_octubre.sql en Supabase"'
      : (!p.geojson ? ' title="Primero dibuje el límite del predio"' : '');
    const mHid = lineas.filter((e) => e.grupo === 'Hídrico').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const mVia = lineas.filter((e) => e.grupo === 'Vial').reduce((s, e) => s + Number(e.longitud_m || 0), 0);
    const nNac = puntos.filter((e) => /Nacimiento/i.test(e.tipo || '')).length;
    const filas = lineas.map((e) => ['linea', e, fmtLong(Number(e.longitud_m || 0))])
      .concat(puntos.map((e) => ['punto', e, 'punto']))
      .concat(areas.map((e) => ['area', e, num(Number(e.area_ha || 0), 2) + ' ha']));
    const hayZonasTipo = (S.cat.tiposElemento || []).some((t) => t.geometria === 'area');
    let html = `<div class="resumen">
        <div class="dato"><span>Cauces (ríos, quebradas, canales)</span><b>${fmtLong(mHid)}</b></div>
        <div class="dato"><span>Vías y caminos</span><b>${fmtLong(mVia)}</b></div>
        <div class="dato"><span>Nacimientos</span><b>${nNac}</b></div>
        <div class="dato"><span>Puntos</span><b>${puntos.length}</b></div>
        <div class="dato"><span>Zonas de riesgo o conflicto</span><b>${areas.length}</b></div>
      </div>
      <div class="tarjeta">
      <div class="tarjeta-cab"><h2>Elementos del predio ${esc(p.cod_predio)}</h2>
        <div class="acciones">
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-linea"${hab ? '' : ' disabled' + tit}>＋ Línea</button>
          <button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-punto"${hab ? '' : ' disabled' + tit}>＋ Punto</button>
          ${hayZonasTipo ? `<button class="btn btn-acento btn-peq" data-accion="dibujar" data-tipo="elemento-area"${hab ? '' : ' disabled' + tit} title="Zona de riesgo o de conflicto de uso">＋ Zona</button>` : ''}
        </div></div>
      ${!hayTipos ? '<p class="aviso">Para registrar elementos falta ejecutar <b>sql/09_paquete_octubre.sql</b> en Supabase.</p>' : ''}
      ${guia('elementos', !lineas.length && !puntos.length && !areas.length)}
      <p class="sin-datos">Las líneas y las zonas se recortan al límite del predio. Las zonas pueden quedar encima de los lotes.</p>
      ${filas.length ? `<table class="tabla"><thead><tr>
          <th>Tipo</th><th>Nombre</th><th class="num">Medida</th><th>Permanencia</th><th>Estado</th>
        </tr></thead><tbody>${filas.map(([g, e, medida]) => `<tr data-elemento="${g}:${esc(e.id)}"${S.elemento && S.elemento.id === e.id ? ' class="activo"' : ''}>
          <td><span class="punto-color${g === 'linea' ? ' linea' : ''}" style="background:${colorElemento(e)}"></span>${esc(e.tipo)}${pend(e)}</td>
          <td>${esc(e.nombre || '—')}</td><td class="num">${medida}</td>
          <td>${esc(e.permanencia || '—')}</td><td>${esc(e.estado || '—')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="sin-datos">Aún no hay elementos registrados en este predio.</p>'}
    </div>`;

    const e = S.elemento && S.elemento.escenario !== 'propuesto' ? S.elemento : null;
    if (e) {
      const ed = S.editando === 'elemento';
      const puede = puedeEditar(e);
      html += `<div class="tarjeta">
        <div class="tarjeta-cab"><h2>${e.id ? esc(e.tipo) + (e.nombre ? ' · ' + esc(e.nombre) : '') : ({ linea: 'Nueva línea', punto: 'Nuevo punto', area: 'Nueva zona' }[e.geometria])}${pend(e)}</h2>
          <div class="acciones">${botonesEdicion('elemento', e)}
            ${e.id && !ed && puede && e.geojson ? `<button class="btn btn-borde btn-peq" data-accion="editar-forma" data-tipo="elemento">${{ linea: 'Editar trazo', punto: 'Mover punto', area: 'Editar forma' }[e.geometria]}</button>` : ''}
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
    // Acción del plan: la unidad sale del catálogo al elegir la acción
    const selAcc = $('#f_accion_accion_id'), uni = $('#f_accion_unidad');
    if (selAcc && uni && !selAcc.disabled) {
      selAcc.addEventListener('change', () => {
        const c = ((S.pps && S.pps.acciones) || []).find((x) => x.id === +selAcc.value);
        if (c) uni.value = c.unidad;
      });
    }
    // Al elegir el lote, las acciones de su sistema productivo pasan arriba («★ Recomendadas para…»)
    const selLote = $('#f_accion_lote_id');
    if (selAcc && selLote && !selLote.disabled) {
      selLote.addEventListener('change', () => {
        const v = selAcc.value;
        selAcc.innerHTML = '<option value="">—</option>' + htmlOpciones(opcionesAccion(selLote.value), v, TIPOS_ACCION);
        const g = selAcc.querySelector('optgroup');
        if (!v && g && g.label.startsWith('★')) aviso(`Arriba de la lista están las acciones ${g.label.slice(2).toLowerCase()}.`);
      });
    }
    // Acción sobre una línea propuesta: la cantidad sale de su longitud (si está vacía)
    const selLin = $('#f_accion_elemento_linea_id'), cant = $('#f_accion_cantidad');
    if (selLin && cant && !selLin.disabled) {
      selLin.addEventListener('change', () => {
        const e = S.elementosProp.lineas.find((x) => x.id === selLin.value);
        if (e && !cant.value && (!uni || !uni.value || uni.value === 'm')) {
          cant.value = Math.round(Number(e.longitud_m || 0));
          if (uni && !uni.value) uni.value = 'm';
        }
      });
    }
    // Selección: el puntaje se recalcula mientras se escriben los criterios
    if ($('#f_seleccion_crit_ambiental') && !$('#f_seleccion_crit_ambiental').disabled && window.SIP_GEO) {
      const recalc = () => {
        const v = (k) => { const x = $('#f_seleccion_' + k).value.replace(',', '.'); return x === '' ? null : Number(x); };
        $('#f_seleccion_puntaje_seleccion').value = num(window.SIP_GEO.puntaje({ crit_ambiental: v('crit_ambiental'),
          crit_territorio: v('crit_territorio'), crit_mejora: v('crit_mejora') }), 2);
      };
      ['crit_ambiental', 'crit_territorio', 'crit_mejora'].forEach((k) => $('#f_seleccion_' + k).addEventListener('input', recalc));
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
        listo('Productor guardado.');
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
        listo(nuevo ? `Predio creado con código ${S.predio.cod_predio}. Ahora dibuje su límite en el mapa.` : 'Predio guardado.');
        avisoArea(S.predio, 'Predio ' + S.predio.cod_predio);
      } else if (tipo === 'lote') {
        const prop = S.lote.escenario === 'propuesto';
        const datos = leerForm(prop ? 'loteprop' : 'lote');
        datos.predio_id = S.predio.id;
        const nuevo = !S.lote.id;
        if (nuevo && prop) datos.escenario = 'propuesto';
        const geom = nuevo && S.geomLoteNueva ? S.geomLoteNueva : undefined;
        if (geom) await resolverSolapes(geom, null);
        const id = await api.guardarLote(Object.assign({ id: S.lote.id }, datos), geom);
        S.editando = null;
        S.geomLoteNueva = null;
        capaEdicion.clearLayers();
        await recargarLotes(id);
        cargarMapaGeneral(false);
        listo(nuevo ? `Lote ${S.lote ? S.lote.cod_lote : ''} creado.` : 'Lote guardado.');
        if (S.lote && !prop) avisoArea(S.lote, 'Lote ' + S.lote.cod_lote);
      } else if (tipo === 'prospectiva' || tipo === 'seleccion' || tipo === 'contexto') {
        const datos = leerForm(tipo);
        await api.guardarPredio(Object.assign({ id: S.predio.id }, datos));
        S.ppsPredio = await api.ppsPredio(S.predio.id).catch(() => Object.assign(S.ppsPredio, datos));
        S.editando = null;
        render();
        listo({ prospectiva: 'Visión de la familia guardada.', seleccion: 'Selección del predio guardada.', contexto: 'Contexto del predio guardado.' }[tipo]);
      } else if (tipo === 'accion') {
        const datos = leerForm('accion');
        datos.predio_id = S.predio.id;
        const nuevo = !S.accion.id;
        const id = await api.guardarAccion(Object.assign({ id: S.accion.id }, datos));
        S.plan = await api.planDe(S.predio.id);
        S.accion = S.plan.find((a) => a.id === id) || null;
        S.editando = null;
        render();
        dibujarSeleccion(false);
        listo(nuevo ? 'Acción agregada al plan.' : 'Acción guardada.');
      } else if (tipo === 'elemento') {
        const datos = leerForm('elemento');
        datos.predio_id = S.predio.id;
        const nuevo = !S.elemento.id;
        if (nuevo && S.elemento.escenario === 'propuesto') datos.escenario = 'propuesto';
        const geometria = S.elemento.geometria;
        const geom = nuevo && S.geomElementoNueva ? S.geomElementoNueva : undefined;
        if (nuevo && !geom) throw new Error('Dibuje el elemento en el mapa.');
        const id = await api.guardarElemento(geometria, Object.assign({ id: S.elemento.id }, datos), geom);
        S.editando = null;
        S.geomElementoNueva = null;
        capaEdicion.clearLayers();
        await recargarElementos(geometria, id);
        listo(nuevo ? 'Elemento registrado.' : 'Elemento guardado.');
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
    if (tipo === 'accion' && !S.accion.id) S.accion = null;
    render();
    dibujarSeleccion(false);
  }

  function limpiarFicha() {
    S.productor = null; S.predios = []; S.predio = null; S.lotes = []; S.lote = null; S.tab = null;
    limpiarPPS();
    S.elementos = { lineas: [], puntos: [], areas: [] }; S.elemento = null;
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
        S.elementos = { lineas: [], puntos: [], areas: [] }; S.elemento = null; limpiarPPS();
        S.tab = 'predio'; S.editando = 'predio'; render(); dibujarSeleccion(false);
      });
    } else if (a === 'nuevo-lote') {
      navegar(() => { S.lote = { predio_id: S.predio.id }; S.tab = 'lotes'; S.editando = 'lote'; render(); });
    } else if (a === 'dibujar') {
      if (tipo !== 'predio' && S.editando) return aviso('Guarde o cancele la edición antes de dibujar.', true);
      if (/-prop$/.test(tipo) && !sinVisionOk()) return;
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
          refrescarCalidad();
        }
      });
    } else if (a === 'ver-predio') {
      dibujarSeleccion(true);
    } else if (a === 'ver-plancha') {
      if (await mostrarPlancha(S.predio.cod_predio)) { P.auto = false; render(); }
    } else if (a === 'quitar-plancha') {
      quitarPlancha(); render();
    } else if (a === 'archivo-plancha') {
      $('#archivoPlancha').click();
    } else if (a === 'copiar-lotes') {
      if (!sinVisionOk()) return;
      if (!confirm(`Se copiarán los ${S.lotes.filter((l) => l.geojson).length} lotes actuales dibujados como lotes propuestos ` +
        '(P01, P02…), para ajustarlos con la familia. Los lotes actuales no cambian. ¿Continuar?')) return;
      try {
        btn.disabled = true;
        const n = await api.copiarLotes(S.predio.id);
        S.vistaMapa = 'propuesto';
        await recargarLotes(null);
        aviso(`Se copiaron ${n} lotes. Ahora asígneles su zona PPS y ajuste las formas.`);
      } catch (e) { btn.disabled = false; aviso(e.message, true); }
    } else if (a === 'nueva-accion') {
      navegar(() => { S.accion = { predio_id: S.predio.id, estado: 'borrador', apoyos: [] }; S.tab = 'plan'; S.editando = 'accion'; render(); });
    } else if (a === 'borrar-accion') {
      const ac = S.accion;
      const nom = (((S.pps && S.pps.acciones) || []).find((x) => x.id === +ac.accion_id) || {}).nombre || 'esta acción';
      if (!confirm(`Va a ELIMINAR «${nom}» del plan de acción${ac.estado === 'concertado' ? ' (ya está CONCERTADA con la familia)' : ''}.\n\nEsta acción no se puede deshacer. ¿Desea continuar?`)) return;
      try {
        await api.borrarAccion(ac.id);
        S.plan = await api.planDe(S.predio.id); S.accion = null; render(); dibujarSeleccion(false);
        listo('Acción eliminada del plan.');
      } catch (e) { aviso(e.message, true); }
    } else if (a === 'borrar-lote') {
      const enPlan = S.plan.filter((x) => x.lote_id === S.lote.id).length;
      if (!confirm(`Va a ELIMINAR el lote ${S.lote.cod_lote}${S.lote.cultivo ? ' (' + S.lote.cultivo + ')' : ''} con su forma y sus datos.` +
        (enPlan ? `\n${enPlan} acción(es) del plan de acción quedarán sin lote asignado.` : '') +
        `\n\nEsta acción no se puede deshacer. ¿Desea continuar?`)) return;
      try { await api.borrarLote(S.lote.id); await recargarLotes(null); cargarMapaGeneral(false); listo('Lote eliminado.'); }
      catch (e) { aviso(e.message, true); }
    } else if (a === 'borrar-predio') {
      const p = S.predio;
      const resumen = `${S.lotes.length} lote(s), ${nElementos(S.elementos)} elemento(s)` +
        (S.lotesProp.length || S.plan.length ? `, ${S.lotesProp.length} lote(s) de la finca soñada y ${S.plan.length} acción(es) del plan` : '');
      const r = prompt(`Va a ELIMINAR el predio ${p.cod_predio} «${p.nombre}» con ${resumen}` +
        `${S.ficha ? ' y su ficha predial' : ''}. La encuesta de caracterización se conserva.\n\n` +
        `Queda una copia en la papelera y el administrador puede recuperarlo. Para confirmar escriba el código del predio (${p.cod_predio}):`);
      if (r == null) return;
      if (r.trim().toUpperCase() !== String(p.cod_predio).toUpperCase()) return aviso('El código no coincide; no se eliminó nada.', 'alerta');
      try {
        btn.disabled = true;
        await api.borrarPredio(p.id);
        aviso(`Predio ${p.cod_predio} eliminado.`);
        await abrirProductor(S.productor.id);
        cargarMapaGeneral(false);
      } catch (e) { btn.disabled = false; aviso(e.message, true); }
    } else if (a === 'borrar-elemento') {
      const e = S.elemento;
      const enPlan = S.plan.filter((x) => x.elemento_linea_id === e.id).length;
      if (!confirm(`¿Eliminar ${e.tipo}${e.nombre ? ' «' + e.nombre + '»' : ''}?` +
        (enPlan ? `\n${enPlan} acción(es) del plan quedarán sin línea.` : '') + ' Esta acción no se puede deshacer.')) return;
      try { await api.borrarElemento(e.geometria, e.id); await recargarElementos(e.geometria, null); listo('Elemento eliminado.'); }
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
  // ---------- Mi trabajo reciente: predios que el usuario tocó, del más reciente al más antiguo
  function cuando(f) {
    const d = new Date(f), hoy = new Date();
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dias = Math.round((dia(hoy) - dia(d)) / 86400000);
    const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    if (dias === 0) return 'hoy ' + hora;
    if (dias === 1) return 'ayer ' + hora;
    if (dias < 7) return d.toLocaleDateString('es-CO', { weekday: 'long' }) + ' ' + hora;
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: dias > 300 ? 'numeric' : undefined });
  }
  async function listarRecientes() {
    const el = $('#resultados');
    el.innerHTML = '<div class="titulo">Mi trabajo reciente</div><p class="sin-datos">Buscando…</p>';
    try {
      const lista = await api.misRecientes();
      if (!lista.length) {
        el.innerHTML = '<div class="titulo">Mi trabajo reciente</div><p class="sin-datos">Aún no ha registrado cambios. ' +
          'Aquí aparecerán los predios que delimite o edite, del más reciente al más antiguo.</p>';
        return;
      }
      el.innerHTML = `<div class="titulo">Mi trabajo reciente (${lista.length})</div>` + lista.map((p) =>
        `<button class="item" data-productor="${esc(p.productor_id)}" data-predio-abrir="${esc(p.predio_id)}">
          <b>${p.delimitado ? '🏡' : '📍'} ${esc(p.cod_predio)} · ${esc(p.nombre)}</b>
          <small>${esc(p.productor)} · ${esc([p.vereda, p.municipio].filter(Boolean).join(', '))}</small>
          <small><span class="cuando">${esc(cuando(p.fecha))}</span> · ${esc(p.accion)}${p.cambios > 1 ? ` · ${p.cambios} cambios` : ''}</small></button>`).join('');
    } catch (e) { el.innerHTML = ''; aviso(e.message, true); }
  }

  // ---------- Volver a donde estaba al recargar (solo en este navegador)
  const claveUltimo = () => 'sip_ultimo_' + ((S.user && S.user.id) || 'x');
  function recordarUltimo() {
    if (!S.user || !S.productor || !S.productor.id) return;
    grabar(claveUltimo(), JSON.stringify({ productor_id: S.productor.id, predio_id: (S.predio && S.predio.id) || null, tab: S.tab }));
  }
  async function volverAlUltimo() {
    let u = null;
    try { u = JSON.parse(leer(claveUltimo()) || 'null'); } catch (e) { u = null; }
    if (!u || !u.productor_id) return;
    try {
      await api.productor(u.productor_id);     // si ya no existe o no tiene permiso, se olvida sin avisar
    } catch (e) { grabar(claveUltimo(), ''); return; }
    try {
      await abrirProductor(u.productor_id, u.predio_id || undefined);
      if (!S.productor || !S.productor.id) return;
      if (u.tab && ['productor', 'predio', 'lotes', 'elementos', 'finca', 'plan'].includes(u.tab) &&
          (u.tab === 'productor' || (S.predio && S.predio.id)) && (S.pps || !['finca', 'plan'].includes(u.tab))) {
        S.tab = u.tab; render(); dibujarSeleccion(false);
      }
      aviso(S.predio && S.predio.id
        ? `Volvió a ${S.predio.nombre} (${S.predio.cod_predio}), donde estaba trabajando.`
        : `Volvió a ${S.productor.nombres}, donde estaba trabajando.`);
    } catch (e) { grabar(claveUltimo(), ''); }   // ya no existe o no tiene permiso: se olvida
  }

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

  // ======================================================================
  //  COLA DE ENVÍO: cambios guardados sin señal (ver api.js)
  // ======================================================================
  const Q = { estado: { total: 0, errores: 0, ops: [] }, iniciada: false };
  function pintarCola(e) {
    Q.estado = e;
    [['#chipCola', (n) => `📤 ${n} por enviar`], ['#campoCola', (n) => `📤 ${n}`]].forEach(([sel, texto]) => {
      const b = $(sel);
      if (!b) return;
      b.hidden = !e.total;
      b.textContent = texto(e.total);
      b.classList.toggle('con-error', e.errores > 0);
    });
    if (!$('#panelCola').hidden) llenarPanelCola();
  }
  const fechaCorta = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function llenarPanelCola() {
    const e = Q.estado;
    $('#panelColaTexto').textContent = !e.total ? 'No hay cambios pendientes: todo está en Sigpredial.'
      : e.total === e.errores ? 'La base no aceptó estos cambios. Lea el motivo, corrija en el mapa si hace falta y descarte el pendiente.'
      : (navigator.onLine ? 'Estos cambios están guardados en este teléfono. Pulse «Enviar ahora» para subirlos a Sigpredial.'
        : 'Están guardados en este teléfono y se enviarán solos cuando haya señal. No borre los datos del navegador.');
    $('#listaCola').innerHTML = e.ops.map((o) => `<li><strong>${esc(o.desc)}</strong>${o.cod_predio ? ' · ' + esc(o.cod_predio) : ''}
      <div class="cola-cuando">Guardado el ${esc(fechaCorta(o.creado))}</div>
      ${o.estado === 'error' ? `<div class="cola-error">⚠ No se pudo enviar: ${esc(o.error)}
        <button type="button" class="btn btn-borde btn-peq" data-descartar="${o.n}">Descartar</button></div>` : ''}</li>`).join('');
    $('#btnEnviarCola').disabled = !(e.total - e.errores) || !navigator.onLine;
  }
  function abrirPanelCola() { llenarPanelCola(); $('#panelCola').hidden = false; }

  async function enviarCola(manual) {
    if (!api.sincronizar) return;
    if (!navigator.onLine) { if (manual) aviso('Sin señal: los cambios siguen guardados en el teléfono.', 'alerta'); return; }
    const chips = $$('#chipCola, #campoCola');
    chips.forEach((b) => b.classList.add('enviando'));
    let r;
    try { r = await api.sincronizar(); } catch (e) { if (manual) aviso(e.message, true); return; } finally {
      chips.forEach((b) => b.classList.remove('enviando'));
    }
    if (r.sinSesion) { aviso('Para enviar los cambios, cierre sesión y vuelva a ingresar con su usuario (con señal).', true); return; }
    if (r.enviados) {
      aviso(`✓ ${r.enviados} ${r.enviados === 1 ? 'cambio enviado' : 'cambios enviados'} a Sigpredial.`);
      await refrescarTrasEnvio();
    }
    if (r.errores) aviso(`${r.errores === 1 ? 'Un cambio no se pudo' : r.errores + ' cambios no se pudieron'} enviar. Toque «📤» para ver el motivo.`, true);
    else if (manual && !r.enviados && r.pendientes) aviso('La señal no alcanzó para enviar. Se intentará de nuevo solo.', 'alerta');
  }
  // Tras enviar: el predio abierto se vuelve a leer de la base (códigos definitivos y recortes)
  async function refrescarTrasEnvio() {
    cargarMapaGeneral(false);
    if (!S.predio || !S.predio.id || !S.productor || S.editando || S.modoGeom) return;
    try {
      await recargarPredio(S.predio.id);
      if (S.pps && S.predio) { await cargarPPS(S.predio.id); render(); dibujarSeleccion(false); }
    } catch (e) { /* se verá al abrir de nuevo */ }
  }
  function iniciarCola() {
    if (!api.sincronizar || Q.iniciada) return;
    Q.iniciada = true;
    api.alCambiarCola = pintarCola;
    api.avisarCola();
    $('#chipCola').addEventListener('click', abrirPanelCola);
    $('#campoCola').addEventListener('click', abrirPanelCola);
    $('#btnCerrarCola').addEventListener('click', () => { $('#panelCola').hidden = true; });
    $('#btnEnviarCola').addEventListener('click', () => enviarCola(true));
    $('#listaCola').addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-descartar]');
      if (!b || !confirm('¿Descartar este cambio? Se pierde lo que se guardó en el teléfono para él.')) return;
      await api.descartar(Number(b.dataset.descartar));
      refrescarTrasEnvio();
    });
    // Vuelve la señal: se espera un momento a que la conexión se estabilice
    window.addEventListener('online', () => setTimeout(() => enviarCola(false), 2000));
    setInterval(() => { if (Q.estado.total > Q.estado.errores && navigator.onLine) enviarCola(false); }, 60000);
    enviarCola(false);
  }

  // Registro guardado en el teléfono que aún no llega a la base
  const pend = (r) => (r && r._pendiente ? ' <span class="pend-envio" title="Guardado en este teléfono, aún no se envía">⏳ por enviar</span>' : '');
  // Aviso después de guardar: si quedó en el teléfono (sin señal), se dice claramente
  function listo(texto) {
    if (api.tomarEncolado && api.tomarEncolado()) {
      aviso('📵 Guardado en este teléfono. Se enviará a Sigpredial cuando haya señal.', 'alerta');
    } else aviso(texto);
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
  //  TABLERO DE AVANCE
  // ======================================================================
  const VERSION = '2026.11.10g';
  // Dos series validadas (daltonismo y contraste): caracterizados = azul, delimitados = verde
  const SERIE = { caracterizados: '#3f8fd8', delimitados: '#2e6e2a' };
  const T = { dpto: '', datos: null, dptos: null, editandoMetas: false };
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const porc = (a, b) => (b > 0 ? Math.round(100 * a / b) : null);

  // ======================================================================
  //  REPORTES EN EXCEL (con los permisos de quien descarga)
  // ======================================================================
  let cargaXLSX = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    cargaXLSX = cargaXLSX || new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => (window.XLSX ? ok(window.XLSX) : mal(new Error('No se pudo cargar el generador de Excel.')));
      s.onerror = () => { cargaXLSX = null; mal(new Error('No se pudo cargar el generador de Excel. Revise la conexión.')); };
      document.head.appendChild(s);
    });
    return cargaXLSX;
  }
  const UBIC = [['departamento', 'Departamento'], ['municipio', 'Municipio'], ['vereda', 'Vereda'],
    ['propietario', 'Propietario'], ['finca', 'Nombre de la finca'], ['cod_predio', 'Código predio'], ['codigo_zap', 'Código ZAP']];
  const HOJAS = [
    { nombre: 'Predios', datos: (r) => r.predios, cols: UBIC.concat([['tenencia', 'Tenencia'],
      ['area_declarada_ha', 'Área declarada (ha)', 4], ['area_sig_ha', 'Área SIG (ha)', 4], ['estado_limite', 'Límite'], ['lotes', 'Lotes']]) },
    { nombre: 'Usos del suelo', datos: (r) => r.lotes.filter((l) => l.escenario !== 'propuesto'), cols: UBIC.concat([
      ['cod_lote', 'Código lote'], ['uso', 'Uso / cultivo'], ['tipo_cobertura', 'Tipo de cobertura'], ['zona_pps', 'Zona PPS'],
      ['sistema', 'Sistema'], ['estado', 'Estado'], ['variedad', 'Variedad'], ['area_sig_ha', 'Área SIG (ha)', 4],
      ['area_declarada_ha', 'Área declarada (ha)', 4], ['latitud', 'Latitud', 6], ['longitud', 'Longitud', 6],
      ['este_9377', 'Este (Origen Nacional)', 1], ['norte_9377', 'Norte (Origen Nacional)', 1], ['observaciones', 'Observaciones']]) },
    { nombre: 'Finca soñada - lotes', datos: (r) => r.lotes.filter((l) => l.escenario === 'propuesto'), cols: UBIC.concat([
      ['cod_lote', 'Código lote'], ['zona_pps', 'Zona PPS'], ['uso', 'Uso o cobertura propuesta'], ['cobertura_clc', 'Cobertura Corine'],
      ['area_sig_ha', 'Área SIG (ha)', 4], ['latitud', 'Latitud', 6], ['longitud', 'Longitud', 6],
      ['este_9377', 'Este (Origen Nacional)', 1], ['norte_9377', 'Norte (Origen Nacional)', 1], ['observaciones', 'Qué se quiere lograr']]) },
    { nombre: 'Finca soñada - resumen', datos: (r) => r.finca, cols: UBIC.concat([['area_predio_ha', 'Área del predio (ha)', 4],
      ['vision_familia', 'Visión (resumen)'], ['fecha_taller', 'Fecha del taller'], ['participantes_hombres', 'Participantes hombres'],
      ['participantes_mujeres', 'Participantes mujeres'], ['participantes_jovenes', 'Participantes jóvenes'],
 ['lotes_propuestos', 'Lotes propuestos'], ['ha_propuesta', 'Área propuesta (ha)', 4],
      ['ha_preservacion', 'Preservación (ha)', 4], ['ha_restauracion', 'Restauración (ha)', 4], ['ha_recuperacion', 'Recuperación (ha)', 4],
      ['ha_produccion_sostenible', 'Producción sostenible (ha)', 4], ['ha_soberania_alimentaria', 'Soberanía alimentaria (ha)', 4],
      ['ha_sin_zona', 'Sin zona (ha)', 4], ['vision_ambiental', 'Visión: ambiental'], ['vision_productiva', 'Visión: productivo'],
      ['vision_alimentacion', 'Visión: alimentación'], ['vision_infraestructura', 'Visión: infraestructura y bienestar'],
      ['vision_cambios', 'Visión: cambios prioritarios (3, 6, 10 años)'], ['vision_capacidades', 'Visión: capacidades y apoyos'],
      ['acciones', 'Acciones del plan'], ['acciones_concertadas', 'Acciones concertadas']]) },
    { nombre: 'Finca soñada - líneas', datos: (r) => (r.elementos || []).filter((e) => e.escenario === 'propuesto'), cols: UBIC.concat([
      ['geometria', 'Geometría'], ['tipo', 'Tipo'], ['nombre', 'Nombre'], ['longitud_m', 'Longitud (m)', 1],
      ['latitud', 'Latitud', 6], ['longitud', 'Longitud', 6], ['este_9377', 'Este (Origen Nacional)', 1],
      ['norte_9377', 'Norte (Origen Nacional)', 1], ['observaciones', 'Observaciones']]) },
    { nombre: 'Plan de acción', datos: (r) => r.plan, cols: UBIC.concat([['tipo', 'Tipo'], ['accion', 'Acción'], ['lote', 'Lote'], ['linea', 'Línea'],
      ['cantidad', 'Cantidad', 2], ['unidad', 'Unidad'], ['plazo', 'Plazo'], ['prioridad', 'Prioridad'], ['estado', 'Estado'],
      ['apoyos', 'Apoyos'], ['responsable', 'Responsable'], ['observaciones', 'Observaciones']]) }
  ];
  async function descargarExcel(btn) {
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ Preparando…';
    try {
      const [X, r] = await Promise.all([cargarXLSX(), api.reportes()]);
      const wb = X.utils.book_new();
      const hoy = new Date();
      const alcance = api.demo ? 'Datos de demostración'
        : (S.perfil && (S.perfil.rol === 'admin' || (S.perfil.rol === 'coordinador' && !S.perfil.cod_dpto)) ? 'Todos los departamentos'
          : (S.perfil && S.perfil.rol === 'coordinador' ? 'Su departamento' : 'Sus municipios asignados'));
      const info = [['Sigpredial · Reportes'], [], ['Generado', hoy.toLocaleString('es-CO')],
        ['Por', (S.perfil && S.perfil.nombre) || ''], ['Alcance', alcance],
        ['Nota', 'Áreas planas en MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377). Ubicación de cada lote: punto interior del lote.'],
        ['Datos personales', 'Uso interno del proyecto (Ley 1581 de 2012). No se comparte con terceros sin autorización.'], []]
        .concat(HOJAS.map((h) => [h.nombre, h.datos(r).length + ' filas']));
      const wsInfo = X.utils.aoa_to_sheet(info);
      wsInfo['!cols'] = [{ wch: 22 }, { wch: 90 }];
      X.utils.book_append_sheet(wb, wsInfo, 'Información');
      HOJAS.forEach((h) => {
        const filas = h.datos(r);
        const aoa = [h.cols.map((c) => c[1])].concat(filas.map((f) => h.cols.map(([k, , dec]) => {
          const v = f[k];
          if (v == null || v === '') return null;
          if (dec != null && !Number.isNaN(Number(v))) return Number(Number(v).toFixed(dec));
          return v;
        })));
        const ws = X.utils.aoa_to_sheet(aoa);
        ws['!cols'] = h.cols.map(([k, t]) => ({ wch: Math.min(48, Math.max(t.length + 2,
          ...filas.slice(0, 300).map((f) => String(f[k] == null ? '' : f[k]).length + 1))) }));
        if (filas.length) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: h.cols.length - 1 } }) };
        X.utils.book_append_sheet(wb, ws, h.nombre);
      });
      X.writeFile(wb, `Sigpredial_reportes_${hoy.toISOString().slice(0, 10)}.xlsx`);
      aviso(`Excel descargado: ${r.predios.length} predios, ${HOJAS[1].datos(r).length} lotes de uso actual y ${HOJAS[2].datos(r).length} de la finca soñada.`);
    } catch (e) { aviso(e.message, true); }
    btn.disabled = false; btn.textContent = txt;
  }

  async function abrirTablero() {
    if (S.modoGeom || S.editando) return aviso('Termine o cancele la edición antes de abrir el tablero.', true);
    $('.cuerpo').hidden = true;
    $('#tablero').hidden = false;
    const b = $('#btnTablero');
    b.textContent = '🗺 Volver al mapa'; b.setAttribute('aria-pressed', 'true');
    await cargarTablero();
  }
  function cerrarTablero() {
    $('#tablero').hidden = true;
    $('.cuerpo').hidden = false;
    const b = $('#btnTablero');
    b.textContent = '📊 Tablero'; b.setAttribute('aria-pressed', 'false');
    ocultarTip();
    setTimeout(() => map.invalidateSize(), 50);
  }
  async function cargarTablero() {
    const el = $('#tablero');
    if (!T.datos) el.innerHTML = '<div class="tb-cargando">Calculando indicadores…</div>';
    try {
      T.datos = await api.tablero(T.dpto);
      if (!T.dpto) T.dptos = T.datos.departamentos.map((d) => [d.cod_dpto, d.nombre]);
      renderTablero();
    } catch (e) {
      el.innerHTML = `<div class="tb-cargando"><p class="error">No se pudo calcular el tablero: ${esc(e.message)}</p>
        <button class="btn btn-borde" data-tb="actualizar">Reintentar</button></div>`;
    }
  }

  function barraAvance(etq, valor, total, unidad, color) {
    const p = porc(valor, total);
    const ancho = p == null ? 0 : Math.min(100, p);
    return `<div class="avance">
      <div class="avance-etq"><span>${esc(etq)}</span>
        <b>${num(valor, unidad ? 1 : 0)}${unidad || ''} <small>de ${total > 0 ? num(total, unidad ? 1 : 0) + (unidad || '') : '—'}</small>
        ${p == null ? '' : `<span class="avance-pct">${p} %</span>`}</b></div>
      <div class="avance-pista" role="img" aria-label="${esc(etq)}: ${p == null ? 'sin meta' : p + ' por ciento'}">
        <div class="avance-relleno" style="width:${ancho}%;background:${color || 'var(--verde-700)'}"></div></div>
    </div>`;
  }

  function graficoSemanas(semanas) {
    const W = 640, H = 210, M = { l: 34, r: 8, t: 12, b: 28 };
    const max = Math.max(1, ...semanas.map((s) => Math.max(s.caracterizados, s.delimitados)));
    const paso = Math.max(1, Math.ceil(max / 4));
    const tope = paso * Math.ceil(max / paso);
    const y = (v) => M.t + (H - M.t - M.b) * (1 - v / tope);
    const anchoGrupo = (W - M.l - M.r) / semanas.length;
    const bw = Math.min(14, (anchoGrupo - 8) / 2);
    let g = '';
    for (let v = 0; v <= tope; v += paso) {
      g += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" class="tb-rejilla"/>
        <text x="${M.l - 6}" y="${y(v) + 4}" class="tb-eje" text-anchor="end">${v}</text>`;
    }
    semanas.forEach((s, i) => {
      const x0 = M.l + i * anchoGrupo + anchoGrupo / 2 - bw - 1;
      const f = new Date(s.semana + 'T12:00:00');
      const etq = f.getDate() + ' ' + MESES[f.getMonth()];
      [['caracterizados', 0], ['delimitados', 1]].forEach(([k, j]) => {
        const v = s[k];
        if (!v) return;
        const x = x0 + j * (bw + 2), h = y(0) - y(v), r = Math.min(3, h / 2, bw / 2);
        g += `<path d="M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z" fill="${SERIE[k]}"/>`;
      });
      g += `<rect x="${M.l + i * anchoGrupo}" y="${M.t}" width="${anchoGrupo}" height="${H - M.t - M.b}" class="tb-zona"
        data-tip="<b>Semana del ${esc(etq)}</b><br><span class='tip-c' style='background:${SERIE.caracterizados}'></span>Caracterizados: ${s.caracterizados}<br><span class='tip-c' style='background:${SERIE.delimitados}'></span>Delimitados: ${s.delimitados}"/>`;
      if ((semanas.length - 1 - i) % 2 === 0) {
        g += `<text x="${M.l + i * anchoGrupo + anchoGrupo / 2}" y="${H - 8}" class="tb-eje" text-anchor="middle">${esc(etq)}</text>`;
      }
    });
    g += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}" class="tb-base"/>`;
    return `<div class="tb-leyenda">
        <span><i style="background:${SERIE.caracterizados}"></i>Predios caracterizados (Kobo)</span>
        <span><i style="background:${SERIE.delimitados}"></i>Predios delimitados</span></div>
      <svg class="tb-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Avance semanal de las últimas 12 semanas">${g}</svg>`;
  }

  function graficoCultivos(cultivos) {
    if (!cultivos.length) return '<p class="sin-datos">Aún no hay lotes registrados.</p>';
    let lista = cultivos.slice(0, 9);
    if (cultivos.length > 9) {
      const resto = cultivos.slice(9);
      lista.push({ cultivo: `Otros (${resto.length})`, lotes: resto.reduce((a, c) => a + c.lotes, 0),
        ha: resto.reduce((a, c) => a + Number(c.ha), 0) });
    }
    const max = Math.max(...lista.map((c) => Number(c.ha)), 0.01);
    return `<div class="barras-h">${lista.map((c) => `
      <div class="bh-fila" data-tip="<b>${esc(c.cultivo)}</b><br>${num(c.ha, 2)} ha · ${c.lotes} lote${c.lotes === 1 ? '' : 's'}">
        <span class="bh-etq">${esc(c.cultivo)}</span>
        <span class="bh-pista"><span class="bh-barra" style="width:${Math.max(1, 100 * Number(c.ha) / max)}%"></span></span>
        <span class="bh-val">${num(c.ha, 1)} ha</span></div>`).join('')}</div>`;
  }

  function bloqueSemaforo(t, pendientes) {
    const total = t.verde + t.amarillo + t.rojo;
    const seg = (k, n) => n ? `<span class="sem-seg s-${k}" style="flex:${n}" title="${CALIDAD[k].txt}: ${n}"></span>` : '';
    return `<div class="sem-barra" role="img" aria-label="${t.verde} completos, ${t.amarillo} por revisar, ${t.rojo} incompletos">
        ${total ? seg('verde', t.verde) + seg('amarillo', t.amarillo) + seg('rojo', t.rojo) : '<span class="sem-seg vacio"></span>'}</div>
      <div class="sem-leyenda">${['verde', 'amarillo', 'rojo'].map((k) => `<span><span class="semaforo s-${k}" aria-hidden="true">${CALIDAD[k].ico}</span>
        ${CALIDAD[k].txt}: <b>${t[k]}</b>${total ? ` <small>(${porc(t[k], total)} %)</small>` : ''}</span>`).join('')}</div>
      ${pendientes.length ? `<h3>Pendientes más frecuentes</h3><ul class="tb-pend">${pendientes.slice(0, 8).map((p) => `
        <li><span class="semaforo s-${p.nivel}" aria-hidden="true">${p.nivel === 'rojo' ? '✕' : '!'}</span>
          <span class="tb-pend-txt">${esc(p.pendiente)}</span><b>${p.predios}</b>
          <button class="btn btn-borde btn-peq" data-tb="ver-pendiente" data-p="${esc(p.pendiente)}">Ver predios</button></li>`).join('')}</ul>`
        : (total ? '<p class="sin-datos">Todos los predios están completos.</p>' : '')}`;
  }

  function bloqueMetas(dptos) {
    if (!dptos.length) return '<p class="sin-datos">Aún no hay predios registrados.</p>';
    if (T.editandoMetas) {
      return `<form id="formMetas" class="tb-metas-form">
        <p class="sin-datos">Número de predios y hectáreas que el proyecto debe atender en cada departamento.</p>
        <table class="tabla"><thead><tr><th>Departamento</th><th class="num">Meta de predios</th><th class="num">Meta de hectáreas</th></tr></thead>
        <tbody>${dptos.map((d) => `<tr><td>${esc(d.nombre)}</td>
          <td class="num"><input type="number" min="0" step="1" name="p_${esc(d.cod_dpto)}" value="${d.meta_predios ?? ''}" aria-label="Meta de predios ${esc(d.nombre)}"></td>
          <td class="num"><input type="number" min="0" step="0.01" name="h_${esc(d.cod_dpto)}" value="${d.meta_hectareas ?? ''}" aria-label="Meta de hectáreas ${esc(d.nombre)}"></td></tr>`).join('')}</tbody></table>
        <div class="acciones"><button type="button" class="btn btn-borde btn-peq" data-tb="cancelar-metas">Cancelar</button>
          <button type="submit" class="btn btn-primario btn-peq">Guardar metas</button></div></form>`;
    }
    return dptos.map((d) => {
      const meta = Number(d.meta_predios) > 0 ? Number(d.meta_predios) : null;
      const base = meta || d.predios;
      return `<div class="tb-dpto">
        <div class="tb-dpto-cab"><h3>${esc(d.nombre)}</h3>
          <small>${meta ? `Meta: ${num(meta, 0)} predios${Number(d.meta_hectareas) > 0 ? ' · ' + num(d.meta_hectareas, 0) + ' ha' : ''}`
            : `Sin meta definida · avance sobre ${num(d.predios, 0)} predios registrados`}</small></div>
        ${meta ? barraAvance('Predios registrados', d.predios, meta) : ''}
        ${barraAvance('Caracterizados', d.caracterizados, base, '', SERIE.caracterizados)}
        ${barraAvance('Delimitados', d.delimitados, base, '', SERIE.delimitados)}
        ${barraAvance('Con ficha predial', d.con_ficha, base)}
        ${Number(d.meta_hectareas) > 0 ? barraAvance('Hectáreas delimitadas', Number(d.ha_sig), Number(d.meta_hectareas), ' ha') : ''}
      </div>`;
    }).join('');
  }

  function renderTablero() {
    const d = T.datos, t = d.totales;
    const hora = new Date(d.generado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    const dptoNombre = T.dpto ? ((T.dptos || []).find((x) => x[0] === T.dpto) || [])[1] : '';
    const kpi = (etq, val, det, cls) => `<div class="kpi${cls ? ' ' + cls : ''}"><span>${etq}</span><b>${val}</b><small>${det || '&nbsp;'}</small></div>`;
    const pctTxt = (a) => (t.predios ? `${porc(a, t.predios)} % de los predios` : '');
    const filtro = (T.dptos || []).length > 1
      ? `<label class="tb-filtro">Departamento <select data-tb-dpto>
          <option value="">Todos</option>${T.dptos.map(([c, n]) => `<option value="${esc(c)}"${c === T.dpto ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select></label>` : '';
    $('#tablero').innerHTML = `<div class="tb">
      <div class="tb-cab">
        <div><h1>Avance del proyecto${dptoNombre ? ' · ' + esc(dptoNombre) : ''}</h1>
          <p class="tb-sub">Actualizado: ${esc(hora)} · Áreas en Origen Nacional (EPSG:9377)</p></div>
        <div class="tb-acciones">${filtro}
          <button class="btn btn-borde btn-peq" data-tb="actualizar">↻ Actualizar</button>
          <button class="btn btn-borde btn-peq" data-tb="imprimir">🖨 Imprimir o PDF</button></div>
      </div>
      <div class="kpis">
        ${kpi('Productores', num(t.productores, 0))}
        ${kpi('Predios', num(t.predios, 0), `${num(t.lotes, 0)} lotes`)}
        ${kpi('Caracterizados', num(t.caracterizados, 0), pctTxt(t.caracterizados))}
        ${kpi('Delimitados', num(t.delimitados, 0), pctTxt(t.delimitados))}
        ${kpi('Fichas prediales', num(t.con_ficha, 0), pctTxt(t.con_ficha))}
        ${kpi('Hectáreas SIG', num(t.ha_sig, 1), `${num(t.ha_lotes, 1)} ha en lotes`)}
      </div>
      <div class="tb-rejilla-2">
        <section class="tarjeta"><div class="tarjeta-cab"><h2>Avance frente a la meta</h2>
          ${esAdmin() && !T.editandoMetas && d.departamentos.length ? '<button class="btn btn-borde btn-peq" data-tb="editar-metas">Editar metas</button>' : ''}</div>
          ${bloqueMetas(d.departamentos)}</section>
        <section class="tarjeta"><div class="tarjeta-cab"><h2>Calidad de la información</h2></div>
          ${bloqueSemaforo(t, d.pendientes || [])}</section>
      </div>
      <div class="tb-rejilla-2">
        <section class="tarjeta"><div class="tarjeta-cab"><h2>Avance semanal</h2><small class="sin-datos">Últimas 12 semanas</small></div>
          ${graficoSemanas(d.semanas || [])}</section>
        <section class="tarjeta"><div class="tarjeta-cab"><h2>Hectáreas por cultivo o cobertura</h2><small class="sin-datos">Lotes dibujados</small></div>
          ${graficoCultivos(d.cultivos || [])}</section>
      </div>
      <section class="tarjeta"><div class="tarjeta-cab"><h2>Por municipio</h2></div>
        ${d.municipios.length ? `<table class="tabla tb-tabla"><thead><tr><th>Departamento</th><th>Municipio</th><th class="num">Predios</th>
          <th class="num">Caracterizados</th><th class="num">Delimitados</th><th class="num">Con ficha</th><th class="num">Hectáreas</th>
          <th class="num" title="Predios incompletos (rojo) y por revisar (amarillo)">Por corregir</th></tr></thead><tbody>
          ${d.municipios.map((m) => `<tr><td>${esc(m.departamento)}</td><td>${esc(m.municipio)}</td><td class="num">${m.predios}</td>
            <td class="num">${m.caracterizados}</td><td class="num">${m.delimitados}</td><td class="num">${m.con_ficha}</td>
            <td class="num">${num(m.ha_sig, 1)}</td><td class="num">${m.rojo ? `<span class="semaforo s-rojo" title="Incompletos">${m.rojo}</span> ` : ''}${m.amarillo ? `<span class="semaforo s-amarillo" title="Por revisar">${m.amarillo}</span>` : ''}${!m.rojo && !m.amarillo ? '—' : ''}</td></tr>`).join('')}
          </tbody></table>` : '<p class="sin-datos">Sin datos.</p>'}</section>
      <section class="tarjeta"><div class="tarjeta-cab"><h2>Por técnico</h2></div>
        ${d.tecnicos.length ? `<table class="tabla tb-tabla"><thead><tr><th>Técnico</th><th class="num">Predios</th><th class="num">Caracterizados</th>
          <th class="num">Delimitados</th><th class="num">Con ficha</th><th class="num">Por corregir</th></tr></thead><tbody>
          ${d.tecnicos.map((x) => `<tr><td>${esc(x.tecnico)}</td><td class="num">${x.predios}</td><td class="num">${x.caracterizados}</td>
            <td class="num">${x.delimitados}</td><td class="num">${x.con_ficha}</td><td class="num">${x.por_corregir || '—'}</td></tr>`).join('')}
          </tbody></table>` : '<p class="sin-datos">Sin datos.</p>'}</section>
      <p class="tb-pie">Sigpredial ${VERSION} · Corporación Biocomercio Sostenible · Información con fines de gestión del proyecto.
        Datos personales protegidos (Ley 1581 de 2012).</p>
    </div>
    <div id="tbTip" class="tb-tip" hidden></div>`;
  }

  function ocultarTip() { const tip = $('#tbTip'); if (tip) tip.hidden = true; }

  function eventosTablero() {
    const el = $('#tablero');
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tb]');
      if (!b) return;
      const a = b.dataset.tb;
      if (a === 'actualizar') cargarTablero();
      else if (a === 'imprimir') window.print();
      else if (a === 'editar-metas') { T.editandoMetas = true; renderTablero(); }
      else if (a === 'cancelar-metas') { T.editandoMetas = false; renderTablero(); }
      else if (a === 'ver-pendiente') {
        cerrarTablero();
        if ($('.cuerpo').classList.contains('sin-izq')) alternarPanel();
        listarPorCorregir(b.dataset.p);
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-tb-dpto]')) { T.dpto = e.target.value; T.editandoMetas = false; cargarTablero(); }
    });
    el.addEventListener('submit', async (e) => {
      if (e.target.id !== 'formMetas') return;
      e.preventDefault();
      const f = new FormData(e.target);
      const valor = (k) => { const v = f.get(k); return v === '' || v == null ? null : Number(v); };
      try {
        for (const d of T.datos.departamentos) {
          await api.guardarMeta(d.cod_dpto, valor('p_' + d.cod_dpto), valor('h_' + d.cod_dpto));
        }
        T.editandoMetas = false;
        aviso('Metas guardadas.');
        cargarTablero();
      } catch (ex) { aviso(ex.message, true); }
    });
    // Tooltip de los gráficos
    el.addEventListener('mousemove', (e) => {
      const z = e.target.closest('[data-tip]');
      const tip = $('#tbTip');
      if (!tip) return;
      if (!z) { tip.hidden = true; return; }
      tip.innerHTML = z.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      let x = e.clientX - r.left + el.scrollLeft + 14, y = e.clientY - r.top + el.scrollTop + 14;
      if (x + tip.offsetWidth > el.clientWidth + el.scrollLeft - 8) x -= tip.offsetWidth + 28;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    el.addEventListener('mouseleave', ocultarTip);
  }

  // ======================================================================
  //  AVISO DE TRATAMIENTO DE DATOS (Ley 1581 de 2012)
  // ======================================================================
  function avisoDatos(soloLeer) {
    return new Promise((resolver) => {
      const m = $('#avisoDatos'), chk = $('#chkDatos'), ok = $('#btnAceptarDatos'), no = $('#btnRechazarDatos');
      $('#avisoDatosCheck').hidden = soloLeer;
      chk.checked = false;
      ok.disabled = !soloLeer;
      ok.textContent = soloLeer ? 'Cerrar' : 'Aceptar y continuar';
      no.hidden = soloLeer;
      m.hidden = false;
      (soloLeer ? ok : chk).focus();
      const cerrar = (v) => { m.hidden = true; chk.onchange = ok.onclick = no.onclick = null; resolver(v); };
      chk.onchange = () => { ok.disabled = !chk.checked; };
      ok.onclick = () => cerrar(true);
      no.onclick = () => cerrar(false);
    });
  }

  // Primer ingreso: la clave genérica se cambia por una personal antes de entrar
  function cambioClaveObligatorio() {
    return new Promise((resolver) => {
      const m = $('#cambioClave'), c1 = $('#claveNueva'), c2 = $('#claveNueva2'), err = $('#cambioClaveError');
      const ok = $('#btnGuardarClave'), no = $('#btnSalirClave');
      c1.value = c2.value = ''; err.textContent = ''; m.hidden = false; c1.focus();
      const cerrar = (v) => { m.hidden = true; ok.onclick = no.onclick = null; resolver(v); };
      no.onclick = () => cerrar(false);
      ok.onclick = async () => {
        err.textContent = '';
        if (c1.value.length < 8) { err.textContent = 'La clave debe tener al menos 8 caracteres.'; return; }
        if (c1.value !== c2.value) { err.textContent = 'Las dos claves no coinciden.'; return; }
        ok.disabled = true;
        try { await api.cambiarClave(c1.value); cerrar(true); }
        catch (e) { err.textContent = /same|different|igual/i.test(e.message) ? 'La clave nueva debe ser distinta a la genérica.' : e.message; }
        ok.disabled = false;
      };
    });
  }

  function mostrarAliados() {
    const lista = C.LOGOS_ALIADOS || [];
    const el = $('#aliados');
    if (!el || !lista.length) return;
    el.innerHTML = '<span>Con el apoyo de</span>' + lista.map((a) =>
      `<img src="${esc(a.archivo)}" alt="${esc(a.nombre || '')}" title="${esc(a.nombre || '')}">`).join('');
    el.hidden = false;
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
    if (!perfil.acepto_datos_en) {
      if (!(await avisoDatos(false))) { await api.salir(); location.reload(); return; }
      perfil.acepto_datos_en = await api.aceptarDatos().catch(() => new Date().toISOString());
    }
    if (perfil.debe_cambiar_clave && !api.demo) {
      if (!(await cambioClaveObligatorio())) { await api.salir(); location.reload(); return; }
      perfil.debe_cambiar_clave = false;
    }
    S.user = user; S.perfil = perfil;
    $('#usuarioNombre').textContent = perfil.nombre || user.email;
    $('#usuarioRol').textContent = ({ tecnico: 'Técnico', coordinador: 'Coordinador', admin: 'Administrador' }[perfil.rol] || perfil.rol);
    $('#etiquetaDemo').hidden = !api.demo;
    S.cat = await api.catalogos();
    S.cat.tiposElemento = S.cat.tiposElemento || [];
    // Finca soñada y plan de acción: solo si la base ya tiene la migración 22 (PPS)
    S.pps = api.catalogosPPS ? await api.catalogosPPS().catch(() => null) : null;
    if (api.usarCatalogos) api.usarCatalogos(S.cat, S.pps);
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
    // Técnico sin municipios asignados: no verá predios hasta que el administrador se los asigne
    if (perfil.rol === 'tecnico' && api.misMunicipios) {
      const mios = await api.misMunicipios().catch(() => null);
      if (mios && !mios.length) {
        aviso('Aún no tiene municipios asignados, por eso no ve predios. Pida al administrador que le asigne sus municipios.', 'alerta');
      }
    }
    await cargarMapaGeneral(true);
    if (!navigator.onLine || api.sinSenal) {
      $('#chipSinRed').hidden = false;
      aviso('Sin señal: está viendo lo guardado en este teléfono. Puede dibujar y guardar; los cambios se envían solos cuando vuelva la señal.', 'alerta');
    }
    contarErroresKobo();
    cargarMetaPlanchas();
    await volverAlUltimo();
    iniciarCola();
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
      const n = Q.estado.total;
      if (n && !confirm(`Tiene ${n} ${n === 1 ? 'cambio' : 'cambios'} sin enviar a Sigpredial. Quedan guardados en este ` +
        'teléfono y se enviarán cuando vuelva a entrar con su usuario y haya señal.\n\n¿Cerrar sesión de todas formas?')) return;
      await api.salir();
      location.reload();
    });
    $('#btnPanel').addEventListener('click', alternarPanel);

    $('#formBuscar').addEventListener('submit', (e) => { e.preventDefault(); buscar($('#txtBuscar').value); });
    $('#btnPendientes').addEventListener('click', listarPendientes);
    $('#btnRecientes').addEventListener('click', listarRecientes);
    $('#btnPorCorregir').addEventListener('click', () => listarPorCorregir());
    $('#btnTablero').addEventListener('click', () => ($('#tablero').hidden ? abrirTablero() : cerrarTablero()));
    $('#btnExcel').addEventListener('click', (e) => descargarExcel(e.currentTarget));
    $('#btnPlanchas').addEventListener('click', (e) => prepararCampo(e.currentTarget));
    iniciarCampo();
    $('#btnSubirPlanchas').addEventListener('click', () => $('#archivoPlanchas').click());
    $('#archivoPlancha').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (f) await planchaDesdeArchivo(f);
    });
    $('#archivoPlanchas').addEventListener('change', async (e) => {
      const fs = Array.from(e.target.files || []); e.target.value = '';
      if (fs.length) await subirPlanchas(fs, $('#btnSubirPlanchas'));
    });
    $('#lnkDatos').addEventListener('click', () => avisoDatos(true));
    eventosTablero();
    $('#btnErroresKobo').addEventListener('click', listarErroresKobo);

    $('#archivoLocal').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await cargarArchivos(files);
    });

    $('#btnNuevoProductor').addEventListener('click', () => navegar(() => {
      S.productor = { cod_dpto: (S.perfil && S.perfil.cod_dpto) || C.DEPARTAMENTO_INICIAL || '' };
      S.predios = []; S.predio = null; S.lotes = []; S.lote = null;
      S.elementos = { lineas: [], puntos: [], areas: [] }; S.elemento = null; limpiarPPS();
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
      const md = e.target.closest('[data-mas-datos]');
      if (md) {
        const f = md.previousElementSibling;
        f.classList.toggle('ver-todo');
        md.textContent = f.classList.contains('ver-todo') ? 'Menos datos ▴' : 'Más datos ▾';
        return;
      }
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
      const t = e.target.closest('[data-accion],[data-productor],[data-predio],[data-lote],[data-elemento],[data-plan],[data-ir],[data-tab]');
      if (!t || t.disabled) return;
      if (t.dataset.accion) return accion(t);
      if (t.dataset.productor) {
        // Modo campo: al elegir un predio de la lista se cierra el menú (aunque sea el mismo que ya estaba abierto)
        if (t.dataset.predioAbrir) document.body.classList.remove('menu-abierto');
        return navegar(() => abrirProductor(t.dataset.productor, t.dataset.predioAbrir));
      }
      if (t.dataset.predio) return navegar(() => abrirPredio(t.dataset.predio));
      if (t.dataset.lote) return navegar(() => abrirLote(t.dataset.lote));
      if (t.dataset.plan) {
        return navegar(() => { S.accion = S.plan.find((x) => x.id === t.dataset.plan) || null; S.tab = 'plan'; render(); dibujarSeleccion(false); });
      }
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
    // Guarda la aplicación en el equipo para que abra sin señal (sw.js)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !api.demo) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    aplicarLogo();
    mostrarAliados();
    $('#versionApp').textContent = VERSION;
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
