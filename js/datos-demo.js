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

  const cultivos = [
    'Café','Plátano','Banano','Cacao','Aguacate','Cítricos','Mora','Guayaba','Caña panelera','Lulo',
    'Granadilla','Maracuyá','Tomate de árbol','Piña','Yuca','Maíz','Fríjol','Hortalizas',
    'Pastos y forrajes','Bosque / forestal','Otro'
  ].map((nombre, i) => ({ id: i + 1, nombre }));

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
      sistema: 'Semisombra', estado: 'Producción', creado_por: 'demo',
      geom: poly([[-76.2029, 4.5711], [-76.2015, 4.5710], [-76.2014, 4.5724], [-76.2030, 4.5725]]) },
    { id: 'l2', predio_id: 'pr1', num_lote: 2, cod_lote: '76863-0001-L02', cultivo_id: 1, variedad: 'Cenicafé 1',
      fecha_siembra: '2024-09-01', area_declarada_ha: 1.5, num_plantas: 7000, dist_surcos_m: 1.4, dist_plantas_m: 1.2,
      sistema: 'Libre exposición', estado: 'Levante', creado_por: 'demo',
      geom: poly([[-76.2012, 4.5710], [-76.2005, 4.5709], [-76.2003, 4.5726], [-76.2012, 4.5727]]) },
    { id: 'l3', predio_id: 'pr1', num_lote: 3, cod_lote: '76863-0001-L03', cultivo_id: 2, variedad: 'Dominico hartón',
      fecha_siembra: '2023-03-01', area_declarada_ha: 0.8, sistema: 'Asociado', estado: 'Producción', creado_por: 'demo',
      geom: poly([[-76.2026, 4.5727], [-76.2008, 4.5728], [-76.2018, 4.5734]]) }
  ];

  return { departamentos, municipios, cultivos, tenencias, veredas, productores, predios, lotes };
})();
