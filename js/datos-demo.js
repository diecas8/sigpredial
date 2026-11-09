/* Datos de ejemplo para el MODO DEMOSTRACIÓN (no se usan con Supabase). */
window.SIP_DEMO = (function () {
  const municipios = [
    ['76001','Cali'],['76020','Alcalá'],['76036','Andalucía'],['76041','Ansermanuevo'],['76054','Argelia'],
    ['76100','Bolívar'],['76109','Buenaventura'],['76111','Buga'],['76113','Bugalagrande'],['76122','Caicedonia'],
    ['76126','Calima (El Darién)'],['76130','Candelaria'],['76147','Cartago'],['76233','Dagua'],['76243','El Águila'],
    ['76246','El Cairo'],['76248','El Cerrito'],['76250','El Dovio'],['76275','Florida'],['76306','Ginebra'],
    ['76318','Guacarí'],['76364','Jamundí'],['76377','La Cumbre'],['76400','La Unión'],['76403','La Victoria'],
    ['76497','Obando'],['76520','Palmira'],['76563','Pradera'],['76606','Restrepo'],['76616','Riofrío'],
    ['76622','Roldanillo'],['76670','San Pedro'],['76736','Sevilla'],['76823','Toro'],['76828','Trujillo'],
    ['76834','Tuluá'],['76845','Ulloa'],['76863','Versalles'],['76869','Vijes'],['76890','Yotoco'],
    ['76892','Yumbo'],['76895','Zarzal']
  ].map(([cod_mpio, nombre]) => ({ cod_mpio, nombre, cod_dpto: cod_mpio.slice(0, 2) }));
  municipios.push({ cod_mpio: '18001', nombre: 'Florencia', cod_dpto: '18' },
                  { cod_mpio: '18753', nombre: 'San Vicente del Caguán', cod_dpto: '18' });
  const departamentos = [{ cod_dpto: '18', nombre: 'Caquetá' }, { cod_dpto: '76', nombre: 'Valle del Cauca' }];

  const T = { P: 'Permanente', S: 'Semipermanente', R: 'Transitorio', C: 'Conservación', D: 'Descanso',
    E: 'Pecuario', F: 'Forestal', O: 'Otro' };
  const cultivos = [
    ['Café','P'],['Plátano','P'],['Banano','P'],['Cacao','P'],['Aguacate','P'],['Cítricos','P'],['Mora','P'],
    ['Guayaba','P'],['Caña panelera','S'],['Lulo','S'],['Granadilla','S'],['Maracuyá','S'],['Tomate de árbol','S'],
    ['Piña','S'],['Yuca','R'],['Maíz','R'],['Fríjol','R'],['Hortalizas','R'],['Pastos y forrajes','E'],
    ['Bosque / forestal','F'],['Otro','O'],['Humedal','C'],['Bosque de galería','C'],['Rastrojo (regeneración natural)','C'],
    ['Área en descanso','D'],['Palma de aceite','P'],['Arroz','R'],['Pancoger','R'],['Piscicultura','E'],
    ['Frutales amazónicos','P'],['Huerta','R'],['Especies menores','E']
  ].map(([nombre, t], i) => ({ id: i + 1, nombre, tipo: T[t] }));

  const tiposElemento = [
    ['Río','linea','Hídrico'],['Quebrada','linea','Hídrico'],['Caño / drenaje','linea','Hídrico'],
    ['Canal / acequia','linea','Hídrico'],['Vía carreteable','linea','Vial'],['Camino / trocha','linea','Vial'],
    ['Sendero','linea','Vial'],['Cerca muerta (alambre de púa)','linea','Infraestructura'],['Cerca viva','linea','Paisaje (HMP)'],
    ['Otro (línea)','linea','Otro'],['Nacimiento / afloramiento','punto','Hídrico'],['Captación / bocatoma','punto','Hídrico'],
    ['Reservorio / jagüey','punto','Hídrico'],['Pozo / aljibe','punto','Hídrico'],['Vivienda','punto','Infraestructura'],
    ['Beneficiadero','punto','Infraestructura'],['Bodega','punto','Infraestructura'],['Establo / corral','punto','Infraestructura'],
    ['Vivero','punto','Infraestructura'],['Otro (punto)','punto','Otro'],
    ['Barrera viva','linea','Paisaje (HMP)'],['Aislamiento de área de conservación','linea','Paisaje (HMP)'],
    ['División de potreros con árboles','linea','Paisaje (HMP)'],
    ['Sitio de procesamiento de leche','punto','Infraestructura'],['Secadero de café o cacao','punto','Infraestructura'],
    ['Estanque','punto','Infraestructura'],['Trapiche','punto','Infraestructura'],['Galpón','punto','Infraestructura'],
    ['Pendiente fuerte','punto','Riesgo'],['Zona que se inunda','punto','Riesgo'],['Deslizamiento','punto','Riesgo'],
    ['Agrietamiento','punto','Riesgo'],['Conflicto de uso','punto','Conflicto de uso']
  ].map(([nombre, geometria, grupo], i) => ({ id: i + 1, nombre, geometria, grupo }));

  const tenencias = ['Propietario','Poseedor','Arrendatario','Comodato','Usufructo',
    'Sucesión ilíquida','Ocupante de baldío','Otro'].map((nombre, i) => ({ id: i + 1, nombre }));

  const veredas = [
    { id: 'v1', cod_mpio: '76863', nombre: 'Vereda Ejemplo 1' },
    { id: 'v2', cod_mpio: '76863', nombre: 'Vereda Ejemplo 2' },
    { id: 'v3', cod_mpio: '76147', nombre: 'Vereda Ejemplo 3' }
  ];

  const poly = (pts) => ({ type: 'MultiPolygon', coordinates: [[pts.concat([pts[0]])]] });

  const productores = [
    { id: 'p1', tipo_doc: 'CC', num_doc: '10000001', nombres: 'María Elena', apellidos: 'Productora Ejemplo',
      sexo: 'Mujer', telefono: '300 000 0001', asociacion: 'Asociación de ejemplo', creado_por: 'demo' },
    { id: 'p2', tipo_doc: 'CC', num_doc: '10000002', nombres: 'José Antonio', apellidos: 'Productor Ejemplo',
      sexo: 'Hombre', telefono: '300 000 0002', creado_por: 'demo' }
  ];

  const predios = [
    { id: 'pr1', cod_predio: '76863-0001', productor_id: 'p1', nombre: 'La Esperanza (ejemplo)',
      cod_mpio: '76863', vereda_id: 'v1', tenencia_id: 1, area_declarada_ha: 6, altitud_msnm: 1750,
      creado_por: 'demo',
      geom: poly([[-76.2032, 4.5708], [-76.2004, 4.5706], [-76.2001, 4.5729], [-76.2019, 4.5736], [-76.2034, 4.5726]]) },
    { id: 'pr2', cod_predio: '76863-0002', productor_id: 'p2', nombre: 'El Mirador (ejemplo)',
      cod_mpio: '76863', vereda_id: 'v2', tenencia_id: 2, area_declarada_ha: 3.5, altitud_msnm: 1820,
      creado_por: 'demo',
      geom: poly([[-76.1984, 4.5744], [-76.1962, 4.5745], [-76.1961, 4.5763], [-76.1983, 4.5764]]) }
  ];

  const lotes = [
    { id: 'l1', predio_id: 'pr1', num_lote: 1, cod_lote: '76863-0001-L01', cultivo_id: 1, variedad: 'Castillo',
      fecha_siembra: '2022-05-01', area_declarada_ha: 2, num_plantas: 10000, dist_surcos_m: 1.5, dist_plantas_m: 1.3,
      trazado: 'Cuadro / rectángulo', sistema: 'Semisombra', estado: 'Producción', creado_por: 'demo',
      geom: poly([[-76.2029, 4.5711], [-76.2015, 4.5710], [-76.2014, 4.5724], [-76.2030, 4.5725]]) },
    { id: 'l2', predio_id: 'pr1', num_lote: 2, cod_lote: '76863-0001-L02', cultivo_id: 1, variedad: 'Cenicafé 1',
      fecha_siembra: '2024-09-01', area_declarada_ha: 1.5, num_plantas: 7000, dist_surcos_m: 1.4, dist_plantas_m: 1.2,
      sistema: 'Libre exposición', estado: 'Levante', creado_por: 'demo',
      geom: poly([[-76.2012, 4.5710], [-76.2005, 4.5709], [-76.2003, 4.5726], [-76.2012, 4.5727]]) },
    { id: 'l3', predio_id: 'pr1', num_lote: 3, cod_lote: '76863-0001-L03', cultivo_id: 2, variedad: 'Dominico hartón',
      fecha_siembra: '2023-03-01', area_declarada_ha: 0.8, sistema: 'Asociado', estado: 'Producción', creado_por: 'demo',
      geom: poly([[-76.2026, 4.5727], [-76.2008, 4.5728], [-76.2018, 4.5734]]) }
  ];

  const elementosLinea = [
    { id: 'e1', predio_id: 'pr1', tipo_id: 2, nombre: 'Quebrada La Ejemplo', permanencia: 'Permanente', estado: 'Bueno',
      geom: { type: 'MultiLineString', coordinates: [[[-76.2031, 4.5716], [-76.2022, 4.5709], [-76.2007, 4.5708]]] } },
    { id: 'e2', predio_id: 'pr1', tipo_id: 6, nombre: 'Camino de acceso', estado: 'Regular',
      geom: { type: 'MultiLineString', coordinates: [[[-76.2003, 4.5722], [-76.2013, 4.5729], [-76.2020, 4.5734]]] } }
  ];
  const elementosPunto = [
    { id: 'e3', predio_id: 'pr1', tipo_id: 11, nombre: 'Nacimiento 1', permanencia: 'Permanente', estado: 'Bueno',
      geom: { type: 'Point', coordinates: [-76.2027, 4.5730] } },
    { id: 'e4', predio_id: 'pr1', tipo_id: 15, nombre: 'Casa principal',
      geom: { type: 'Point', coordinates: [-76.2017, 4.5731] } }
  ];

  // Planificación Predial Sostenible (mismos catálogos de sql/22_pps_base.sql)
  const zonasPPS = [
    [1, 'preservacion', 'Preservación', '#1b5e20'], [2, 'restauracion', 'Restauración', '#7cb342'],
    [3, 'recuperacion', 'Recuperación', '#f9a825'], [4, 'produccion_sostenible', 'Producción sostenible', '#8d6e63'],
    [5, 'soberania_alimentaria', 'Soberanía alimentaria', '#ad1457']
  ].map(([id, codigo, nombre, color]) => ({ id, codigo, nombre, color, orden: id,
    explicacion: { preservacion: 'Lo que no se toca', restauracion: 'Lo que se recupera para no tocar',
      recuperacion: 'Lo que se recupera para producir', produccion_sostenible: 'Donde se produce',
      soberania_alimentaria: 'Lo que comemos' }[codigo],
    ejemplos: { preservacion: 'Bosques, nacimientos, rondas de quebradas.',
      restauracion: 'Rondas sin árboles, nacimientos desprotegidos, conectores entre bosques.',
      recuperacion: 'Potreros o suelos degradados, erosionados o en conflicto de uso.',
      produccion_sostenible: 'Cultivos, potreros, sistemas agroforestales y silvopastoriles.',
      soberania_alimentaria: 'Huerta, patio productivo, pancoger, especies menores.' }[codigo] }));
  const accionesPPS = [
    ['Cierre de frontera agrícola', 'Conservación', 'ha'], ['Protección de nacimientos y cauces', 'Conservación', 'm'],
    ['Árboles dispersos en praderas', 'Restauración', 'árboles'], ['Cercas vivas', 'Restauración', 'm'],
    ['Sistema silvopastoril', 'Producción sostenible', 'ha'], ['Bancos de proteína', 'Producción sostenible', 'ha'],
    ['Parcela agroforestal (frutos amazónicos y maderables)', 'Producción sostenible', 'ha'],
    ['Piscicultura', 'Diversificación', 'm² de espejo de agua'], ['Meliponicultura', 'Diversificación', 'colmenas'],
    ['Cosecha de agua lluvia', 'Producción sostenible', 'sistemas'], ['Paneles solares', 'Producción sostenible', 'sistemas'],
    ['Barreras vivas', 'Producción sostenible', 'm'], ['Aislamiento de áreas de conservación', 'Conservación', 'm'],
    ['División de potreros con árboles', 'Producción sostenible', 'm']
  ].map(([nombre, tipo, unidad], i) => ({ id: i + 1, nombre, tipo, unidad, activo: true }));
  const apoyosPPS = [['asistencia_tecnica', 'Asistencia técnica'], ['semillas', 'Semillas'], ['insumos', 'Insumos'],
    ['cerramientos', 'Cerramientos / alambre'], ['infraestructura_hidrica', 'Infraestructura hídrica']]
    .map(([codigo, nombre]) => ({ codigo, nombre, activo: true }));

  return { departamentos, municipios, cultivos, tenencias, veredas, productores, predios, lotes,
    tiposElemento, elementosLinea, elementosPunto, zonasPPS, accionesPPS, apoyosPPS, plan: [] };
})();
