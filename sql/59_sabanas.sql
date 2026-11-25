-- 59 · Sabanas del Meta como uso del suelo
-- Corine Land Cover (IDEAM) las clasifica como herbazales (3.2.1); en campo se les dice «sabana».
insert into productores.cultivo (nombre, tipo, codigo)
select x.nombre, x.tipo, x.codigo
  from (values ('Sabana natural (herbazal)', 'Conservación', 'sabana_natural'),
               ('Sabana natural con pastoreo', 'Pecuario', 'sabana_pastoreo')) as x(nombre, tipo, codigo)
 where not exists (select 1 from productores.cultivo c where c.nombre = x.nombre);
