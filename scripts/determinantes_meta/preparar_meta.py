"""
Prepara tres determinantes ambientales de Cormacarena / PDFD Meta para los municipios
del Meta del proyecto, cada categoría con la ACCIÓN que recomienda (conservar, restaurar
o producir con prácticas sostenibles):

  1. POMCA Río Medio y Bajo Ariari: zonificación ambiental (campo de subzona SZO_US_M_1).
  2. DMI Macarena Norte, zona de Recuperación para la Producción Norte: subzonas del
     Plan de Ordenamiento Forestal (POF) (campo USO_Porpue).
  3. Núcleos de Desarrollo Forestal y de la Biodiversidad (NDFyB).

Insumos: capas del proyecto PDFD Meta, recortadas antes en el computador de Diego a la
máscara de los 4 municipios + 3 km alrededor de cada predio, pasadas a EPSG:9377 y
simplificadas a 10 m (archivos .pkl: nombres de campos, valores, geometrías WKB).
Recorte final: límite de cada municipio + 3 km alrededor de cada predio (igual que AMEM).

Uso: python preparar_meta.py <carpeta_pkl> puntos.csv <carpeta_salida>
     puntos.csv: cod,lat,lon (no se sube al repositorio)
"""
import csv, json, os, pickle, sys
import geopandas as gpd, shapely
from shapely.geometry import mapping

CODS = ['50325', '50450', '50577', '50590']

# ---- 1. POMCA: subzona -> (categoría corregida, indicación con la acción, nivel)
POMCA = {
    'Areas de importancia Ambiental': ('Áreas de importancia ambiental',
        'Conservar: proteger la cobertura natural (bosques, rondas, nacimientos); no ampliar potreros ni cultivos.', 1),
    'Areas complementarias para la conservación': ('Áreas complementarias para la conservación',
        'Conservar: mantener los bosques y la vegetación natural; solo usos de bajo impacto.', 1),
    'Areas con reglamentación especial': ('Áreas con reglamentación especial',
        'Conservar: rige su propia reglamentación; no ampliar la actividad agropecuaria.', 1),
    'Areas SINAP': ('Áreas protegidas (SINAP)',
        'Conservar: área protegida; se rige por su plan de manejo.', 1),
    'Areas de Amenazas Naturales': ('Áreas de amenazas naturales',
        'Conservar por riesgo (inundación o remoción): no construir vivienda ni infraestructura; mantener la cobertura vegetal.', 1),
    'Areas de restauraciín ecológica': ('Áreas de restauración ecológica',
        'Restaurar: recuperar el bosque y la vegetación natural (aislamiento, regeneración, enriquecimiento).', 2),
    'Areas de recuperación para el uso múltiple': ('Áreas de recuperación para el uso múltiple',
        'Restaurar y producir: recuperar suelos degradados con sistemas agroforestales o silvopastoriles.', 2),
    'Areas Agrosilvopastoriles': ('Áreas agrosilvopastoriles',
        'Producir con prácticas sostenibles: sistemas agroforestales y silvopastoriles, conservando rondas y bosques.', 3),
    'Areas agrícolas': ('Áreas agrícolas',
        'Producir con prácticas sostenibles: agricultura y ganadería con buenas prácticas, conservando rondas y bosques.', 3),
    'Areas urbanas, municipales y distritales': ('Áreas urbanas', 'Suelo urbano: se rige por el plan de ordenamiento municipal.', 3),
}
# ---- 2. DMI Macarena Norte (POF): subzona -> (categoría, indicación, nivel)
DMI = {
    'Preservacion': ('Subzona de preservación',
        'Conservar: mantener el bosque y los ecosistemas naturales; no se permiten actividades agropecuarias.', 1),
    'Restauracion': ('Subzona de restauración',
        'Restaurar: recuperar el bosque para llevarlo a preservación.', 1),
    'Subzona para el aprovechamiento sostenible': ('Subzona para el aprovechamiento sostenible',
        'Producir con prácticas sostenibles: sistemas agroforestales, silvopastoriles y aprovechamiento forestal sostenible.', 2),
}
GRUPOS = {
    'pomca': ('POMCA Río Medio y Bajo Ariari', 6, 'ZA_POMCA_MEDIO_Y_BAJO_ARIARI', 'POMCA Río Medio y Bajo Ariari · Cormacarena'),
    'dmi': ('DMI Macarena Norte · subzonas POF', 6, 'POF_ZonificacionDMI', 'Plan de Ordenamiento Forestal DMI Macarena Norte · Cormacarena'),
    'ndfyb': ('Núcleo de Desarrollo Forestal y de la Biodiversidad', 7, 'Nucleos_DFB_Meta', 'NDFyB · SINCHI / Parques Nacionales'),
}


def clasificar(capa, r):
    if capa == 'pomca':
        return POMCA[r['SZO_US_M_1']]
    if capa == 'dmi':
        cat, ind, niv = DMI[r['USO_Porpue']]
        return f"{cat} ({r['Zona_DMI']})", ind, niv
    return (r['nom_pc'], 'Uso sostenible del bosque: manejo forestal comunitario, productos del bosque y '
            'restauración productiva; no deforestar (Núcleo de Desarrollo Forestal y de la Biodiversidad).', 2)


def leer(ruta):
    nombres, vals, wkb = pickle.load(open(ruta, 'rb'))
    df = gpd.GeoDataFrame({n: list(v) for n, v in zip(nombres, vals)}, geometry=shapely.from_wkb(wkb), crs=9377)
    df['geometry'] = df.geometry.make_valid()
    return df


def main(carpeta, puntos, salida):
    raiz = os.path.join(os.path.dirname(__file__), '..', '..', 'capas', 'meta', 'municipios.geojson')
    mp = gpd.read_file(raiz)
    mp = mp[mp.cod_mpio.isin(CODS)].to_crs(9377)
    zona = {}
    for r in csv.DictReader(open(puntos, encoding='utf-8')):
        p = gpd.GeoSeries.from_xy([float(r['lon'])], [float(r['lat'])], crs=4326).to_crs(9377).iloc[0]
        zona.setdefault(r['cod'][:5], []).append(p.buffer(3000))
    mp['geometry'] = [shapely.union_all([g] + zona.get(c, [])) for c, g in zip(mp.cod_mpio, mp.geometry)]
    os.makedirs(salida, exist_ok=True)
    for capa, (grupo, orden, origen, fuente) in GRUPOS.items():
        a = leer(os.path.join(carpeta, capa + '.pkl'))
        cl = [clasificar(capa, r) for _, r in a.drop(columns='geometry').iterrows()]
        a['categoria'] = [c[0] for c in cl]; a['indicacion'] = [c[1] for c in cl]; a['nivel'] = [c[2] for c in cl]
        a = a[['categoria', 'indicacion', 'nivel', 'geometry']]
        feats = []
        for _, m in mp.iterrows():
            s = a[a.intersects(m.geometry)].copy()
            if s.empty:
                print(capa, m.cod_mpio, 'sin datos'); continue
            s['geometry'] = s.geometry.intersection(m.geometry)
            s = s.explode(index_parts=False); s = s[(s.geom_type == 'Polygon') & (s.area >= 1000)]
            s['_a'] = s.area; s = s[s.groupby('categoria')['_a'].transform('sum') >= 100000]  # quita astillas (< 10 ha)
            s = s.dissolve(['categoria', 'indicacion', 'nivel']).reset_index()
            s['ha'] = s.area / 1e4
            s = s.to_crs(4326)
            s['geometry'] = shapely.make_valid(shapely.set_precision(s.geometry.values, 1e-6, mode='pointwise'))
            for _, r in s.iterrows():
                feats.append({'type': 'Feature', 'properties': {
                    'cod_mpio': m.cod_mpio, 'grupo': grupo, 'categoria': r.categoria, 'indicacion': r.indicacion,
                    'nivel': int(r.nivel), 'orden': orden, 'capa_origen': origen, 'fuente': fuente},
                    'geometry': mapping(r.geometry)})
                print(capa, m.cod_mpio, r.categoria, round(r.ha), 'ha')
        ruta = os.path.join(salida, capa + '_meta.geojson')
        json.dump({'type': 'FeatureCollection', 'features': feats}, open(ruta, 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        print(ruta, round(os.path.getsize(ruta) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main(*sys.argv[1:4])
