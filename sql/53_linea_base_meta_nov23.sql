-- 53 · Línea base del Meta, entrega del 23 de noviembre de 2026 (shape nuevo del equipo Meta)
--   Antes: respaldo en respaldo.predio_meta_20261123, productor_meta_20261123 y
--   caracterizacion_meta_20261123. Los datos de los predios nuevos se cargaron aparte en
--   respaldo.carga_meta_20261123 (no se guardan en el repositorio: traen datos personales).
--   1) Mapiripán: salen MMP 25 Las Cachamas y MMP 27 San Jorge (quedan en la papelera).
--   2) Mapiripán: nueva numeración del Humboldt (el código del portal no cambia):
--      La Cordillera MMP 28→27, Villa Diana 29→28, La Esperanza 30→29, Agualinda 2 31→30.
--   3) Predios nuevos: 30 de Puerto Concordia, MPR 29 y MPR 30, y La Esmeralda (MMP 25, 50325-0032),
--      con productor (quien respondió la encuesta) y encuesta de línea base. Del hogar solo conteos.
--   4) MPR 28 La Valentina: nueva ubicación del punto (289 m).
--   5) Número de personas del hogar actualizado en 12 encuestas.

-- 1) Salen dos predios de Mapiripán
create temp table _sale on commit drop as
  select id, productor_id from productores.predio
   where cod_mpio = '50325' and ((cod_humboldt = 'MMP 25' and nombre = 'Las Cachamas') or (cod_humboldt = 'MMP 27' and nombre = 'San Jorge'));
do $$ begin if (select count(*) from _sale) <> 2 then raise exception 'No se encontraron Las Cachamas y San Jorge'; end if; end $$;
delete from productores.caracterizacion where predio_id in (select id from _sale);
delete from productores.predio where id in (select id from _sale);
delete from productores.productor pr where pr.id in (select productor_id from _sale)
   and not exists (select 1 from productores.predio p where p.productor_id = pr.id);

-- 2) Nueva numeración de Mapiripán (en orden, para no chocar)
do $$
declare r record;
begin
  for r in select * from (values ('MMP 28','MMP 27','La Cordillera'), ('MMP 29','MMP 28','Villa Diana'),
                                 ('MMP 30','MMP 29','La Esperanza'), ('MMP 31','MMP 30','Agualinda 2')) v(viejo, nuevo, nom) loop
    update productores.predio set cod_humboldt = r.nuevo where cod_mpio = '50325' and cod_humboldt = r.viejo and nombre = r.nom;
    if not found then raise exception 'No se encontró % (%)', r.nom, r.viejo; end if;
    update productores.productor set num_doc = 'PEND-' || r.nuevo where num_doc = 'PEND-' || r.viejo;
    update productores.caracterizacion set kobo_uuid = 'zap2-linea-base-' || r.nuevo where kobo_uuid = 'zap2-linea-base-' || r.viejo;
  end loop;
end $$;

-- 3) Predios nuevos
insert into productores.productor (nombres, num_doc, cod_dpto)
select s.linea->'d'->>'informante_nombre', 'PEND-' || (s.linea->>'hum'), '50' from respaldo.carga_meta_20261123 s;

insert into productores.predio (cod_predio, cod_humboldt, productor_id, nombre, cod_mpio, vereda_id, tenencia_id,
                                area_declarada_ha, punto, punto_visita)
select s.linea->>'cod', s.linea->>'hum', pr.id, s.linea->'d'->>'nombre_predio', s.linea->>'mpio',
       (select v.id from productores.vereda v where v.cod_mpio = s.linea->>'mpio'
           and (lower(extensions.unaccent(v.nombre)) = lower(extensions.unaccent(s.linea->'d'->>'vereda_declarada'))
             or lower(extensions.unaccent('el ' || v.nombre)) = lower(extensions.unaccent(s.linea->'d'->>'vereda_declarada'))) limit 1),
       (select t.id from productores.tenencia t where t.nombre = s.linea->'d'->>'tenencia'),
       nullif((s.linea->'d'->>'area_declarada_ha')::numeric, 0),
       ST_SetSRID(ST_MakePoint((s.linea->>'lon')::float8, (s.linea->>'lat')::float8), 4326),
       ST_SetSRID(ST_MakePoint((s.linea->>'lon')::float8, (s.linea->>'lat')::float8), 4326)
  from respaldo.carga_meta_20261123 s join productores.productor pr on pr.num_doc = 'PEND-' || (s.linea->>'hum')
 order by s.linea->>'cod';

insert into productores.caracterizacion (kobo_uuid, formulario, proyecto, cod_dpto, productor_id, predio_id, fecha_visita,
                                         tecnico, estado, datos, recibido_en, procesado_en)
select 'zap2-linea-base-' || (s.linea->>'hum'), 'Formulario QField Meta (línea base)', 'ZAP II', '50', p.productor_id, p.id,
       (s.linea->'d'->>'fecha_visita')::date, s.linea->'d'->>'tecnico', 'procesada', s.linea->'d', now(), now()
  from respaldo.carga_meta_20261123 s join productores.predio p on p.cod_predio = s.linea->>'cod';

-- 4) MPR 28 La Valentina: punto nuevo
update productores.predio
   set punto = ST_SetSRID(ST_MakePoint(-72.8724669, 2.7962233), 4326),
       punto_visita = ST_SetSRID(ST_MakePoint(-72.8724669, 2.7962233), 4326)
 where cod_mpio = '50590' and cod_humboldt = 'MPR 28' and nombre = 'La Valentina';

-- 5) Personas del hogar según el shape nuevo (lo anterior queda en «previo»)
update productores.caracterizacion c
   set previo = coalesce(c.previo, c.datos), datos = jsonb_set(c.datos, '{personas_hogar}', to_jsonb(v.n))
  from (values ('MMP 16',3),('MPL 04',5),('MPL 08',4),('MPL 11',4),('MPL 12',4),('MPL 14',3),('MPL 15',6),
               ('MPL 20',4),('MPL 27',5),('MPR 05',3),('MPR 07',5),('MPR 19',3)) v(hum, n),
       productores.predio p
 where p.id = c.predio_id and p.cod_humboldt = v.hum and p.cod_mpio like '50%';
