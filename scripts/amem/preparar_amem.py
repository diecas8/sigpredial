"""
Prepara las zonas del Área de Manejo Especial La Macarena (AMEM, Decreto 1989 de 1989)
para cargarlas como determinante en los municipios del Meta del proyecto.

Insumo: DMI_AMEM.geojson (13 zonas: DMI Ariari-Guayabero, Macarena Norte, Macarena Sur
y los PNN). Campo de la zona: «Zona». Correcciones:
  - nombres cortados a 39 caracteres («…Occiden», «…Sur (»);
  - mayúsculas («Recuperación Para La Producción Sur»);
  - geometría con autointersección (se repara con make_valid).
Recorte: límite de cada municipio + 3 km alrededor de cada predio (igual que la BTZA).

Uso: python preparar_amem.py DMI_AMEM.geojson puntos.csv <carpeta_salida>
     puntos.csv: cod,lat,lon (no se sube al repositorio)
"""
import csv, json, os, sys
import geopandas as gpd, shapely
from shapely.geometry import mapping

CODS = ['50325', '50450', '50577', '50590']
GRUPO = 'Área de Manejo Especial La Macarena (AMEM)'
FUENTE = 'Decreto 1989 de 1989 · Cormacarena'
NOMBRE = {
    'Recuperación para la Producción Occiden': 'Recuperación para la Producción Occidente',
    'Recuperación para la Preservación Sur (': 'Recuperación para la Preservación Sur',
    'Recuperación para la Preservación Sur 1': 'Recuperación para la Preservación Sur',
    'Recuperación Para La Producción Sur': 'Recuperación para la Producción Sur',
}
FIGURA = {'Ariari Guayabero': 'DMI Ariari-Guayabero', 'Macarena Norte': 'DMI Macarena Norte',
          'Macarena Sur': 'DMI Macarena Sur', 'Parque Nacional': 'Parque Nacional Natural'}


def tipo(zona, dmi):
    """(texto de lo que indica, nivel 1 fuerte · 2 manejo · 3 precaución)"""
    if dmi == 'Parque Nacional':
        return 'Parque Nacional Natural: solo conservación, investigación y recreación pasiva; no se permiten actividades agropecuarias.', 1
    if zona.startswith('Preservación'):
        return 'Zona de preservación del AMEM: mantener los ecosistemas naturales; no se permiten actividades agropecuarias.', 1
    if zona.startswith('Recuperación para la Preservación'):
        return 'Zona de recuperación para la preservación del AMEM: restaurar los ecosistemas para llevarlos a preservación.', 1
    if zona.startswith('Recuperación para la Producción'):
        return 'Zona de recuperación para la producción del AMEM: producir recuperando suelos y bosque, con sistemas sostenibles.', 2
    return 'Zona de producción del AMEM: actividades agropecuarias con prácticas sostenibles, según la reglamentación de Cormacarena.', 3


def main(entrada, puntos, salida):
    raiz = os.path.join(os.path.dirname(__file__), '..', '..', 'capas', 'meta', 'municipios.geojson')
    mp = gpd.read_file(raiz)
    mp = mp[mp.cod_mpio.isin(CODS)].to_crs(9377)
    zona = {}
    for r in csv.DictReader(open(puntos, encoding='utf-8')):
        p = gpd.GeoSeries.from_xy([float(r['lon'])], [float(r['lat'])], crs=4326).to_crs(9377).iloc[0]
        zona.setdefault(r['cod'][:5], []).append(p.buffer(3000))
    mp['geometry'] = [shapely.union_all([g] + zona.get(c, [])) for c, g in zip(mp.cod_mpio, mp.geometry)]
    a = gpd.read_file(entrada).to_crs(9377)
    a['geometry'] = a.geometry.make_valid()
    a['zona'] = a.Zona.map(lambda z: NOMBRE.get(z, z))
    os.makedirs(salida, exist_ok=True)
    feats = []
    for _, m in mp.iterrows():
        s = a[a.intersects(m.geometry)].copy()
        if s.empty:
            print(m.cod_mpio, 'sin AMEM'); continue
        s['geometry'] = s.geometry.intersection(m.geometry)
        s = s.explode(index_parts=False); s = s[(s.geom_type == 'Polygon') & (s.area >= 1000)]
        s['_a'] = s.area; s = s[s.groupby(['DMI', 'zona'])['_a'].transform('sum') >= 500000]  # quita astillas de borde (< 50 ha)
        s = s.dissolve(['DMI', 'zona']).reset_index().to_crs(4326)
        s['geometry'] = shapely.make_valid(shapely.set_precision(s.geometry.values, 1e-6, mode='pointwise'))
        for _, r in s.iterrows():
            ind, niv = tipo(r.zona, r.DMI)
            cat = f'{r.zona} ({FIGURA[r.DMI]})' if r.DMI != 'Parque Nacional' else f'PNN {r.zona}'
            feats.append({'type': 'Feature', 'properties': {
                'cod_mpio': m.cod_mpio, 'grupo': GRUPO, 'categoria': cat, 'indicacion': ind, 'nivel': niv,
                'orden': 5, 'capa_origen': 'DMI_AMEM', 'fuente': FUENTE}, 'geometry': mapping(r.geometry)})
            print(m.cod_mpio, cat, round(gpd.GeoSeries([r.geometry], crs=4326).to_crs(9377).area.iloc[0] / 1e4), 'ha')
    ruta = os.path.join(salida, 'amem_meta.geojson')
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(ruta, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(ruta, round(os.path.getsize(ruta) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main(*sys.argv[1:4])
