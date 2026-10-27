-- =====================================================================
-- 13 · Veredas del Meta: 169 de los 4 municipios del TDR 26-153
--      (Mapiripán 56, Puerto Concordia 37, Puerto Lleras 31, Puerto Rico 45)
-- Mismo código del formulario Kobo (kobo/meta/veredas_meta.csv).
-- Nombres corregidos: tildes, «Inspección», «Rincón del Indio», «Charco
-- Caimán», «Laguna Gringa», «Charco Carbón» (venía «Carco Carbón») y Caño
-- Ovejas (dos polígonos con el mismo nombre, se distinguen por el código).
-- =====================================================================
insert into productores.vereda (cod_vereda, nombre, cod_mpio, origen, validada)
select split_part(x, '|', 1), split_part(x, '|', 2), left(split_part(x, '|', 1), 5), 'oficial', true
  from unnest(string_to_array($v$
50325001|Betania
50325002|Bonanza
50325003|Cachivera
50325004|California
50325005|Canapure
50325006|Caño Evaristo
50325007|Caño Jabón Alto
50325008|Caño Minas
50325009|Caño Ovejas (cód. 50325009)
50325010|Caño Ovejas (cód. 50325010)
50325011|Caño Siare
50325012|Chaparral
50325013|Charco Caimán
50325014|Costa Rica
50325015|Danubio
50325016|Delirio
50325017|El Águila
50325018|El Diamante
50325019|El Olvido
50325020|El Silencio
50325021|Esteros Altos
50325022|Esteros Bajos
50325023|Inspección Anzuelo
50325024|Inspección Buenos Aires
50325025|Inspección de Guacamayas
50325026|Inspección de la Cooperativa
50325027|Inspección de Mielón
50325028|Inspección de Puerto Alvira
50325029|Inspección del Siare
50325030|Inspección Sardinata
50325031|Jungla
50325032|La Esmeralda
50325033|La Libertad
50325034|La Realidad
50325035|La Rompida
50325036|Las Brisas
50325038|Maretas
50325039|Mata Bambú
50325040|Merecure
50325041|Mitare
50325042|Mocuare
50325043|Palestina
50325044|Palmarito
50325045|Progreso
50325046|Remolinos
50325047|Rincón del Indio
50325048|Sabanas de Guaracu
50325049|Sabanas de Miriti
50325050|Sabanas de San Ignacio
50325051|San Antonio
50325052|San Fernando
50325053|San Jorge
50325054|Santa Elena
50325055|Tigre
50325056|Trin
50325057|Yamu
50450001|Agua Linda
50450002|Aguas Claras
50450003|Alto Cafre
50450004|Alto Mielón
50450005|Bellavista
50450006|Bocas del Ariari
50450007|Cambulitos
50450008|Caño Ceiba Bajo
50450009|Caño la Sal
50450010|Caño Marimba
50450011|Chaparrito
50450012|Charco Carbón
50450013|Cruce del Poporio
50450014|El Palmar
50450015|El Paraíso
50450016|El Porvenir
50450017|El Progreso
50450018|El Salitre
50450019|El Tesoro
50450020|Gran Primavera
50450021|Guarupayas
50450022|La Cristalina
50450023|La Florida
50450024|La Unión
50450025|Lindenal
50450026|Los Andes
50450027|Mereles
50450028|Palomas
50450029|Playa Alta
50450030|Playa Nueva
50450031|Puerto Cacao
50450032|Puerto Colombia
50450033|Puerto Poporio
50450034|Resguardo Indígena Caño la Sal
50450035|San Fernando
50450036|Santa Isabel
50450037|Santa Lucía
50577001|Agua Linda
50577002|Alto Casibare
50577003|Alto Cunimia
50577004|Argentina
50577005|Brisas del Guejar
50577006|Campo Alegre
50577007|Canada
50577008|Candilejas
50577009|Caño Rayado
50577010|Caribe
50577011|Casibare
50577012|Chapurray
50577013|Charco 13
50577014|Chinata
50577015|Diamante
50577016|El Cairo
50577017|El Santuario
50577018|Esmeralda I
50577019|Esmeralda II
50577020|Esperanza
50577021|Fundadores
50577022|Islandia
50577023|José María
50577024|La Unión
50577025|Laureles
50577026|Morichito
50577027|Palmeras
50577028|Tierra Grata
50577029|Tigrera
50577031|Veracruz
50577032|Villa la Paz
50590001|Agualinda
50590002|Bajo Fundadores
50590003|Bajo Guaimaral
50590004|Barranco Colorado
50590005|Brisas del Cafre
50590006|Buenavista
50590007|Caño Alfa
50590008|Caño Blanco
50590009|Caño Ceiba
50590010|Caño la Torre
50590011|Caño Raya
50590012|Caños Negros
50590013|Charco Carbón
50590014|Charco Danto
50590015|El Darién
50590016|El Dorado
50590017|El Jordán
50590018|El Oasis
50590019|Guacamayas
50590020|La Argelia
50590021|La Cabaña
50590022|La Cascada
50590023|La Esperanza
50590024|La Hermita
50590025|La Lindosa
50590026|La Primavera
50590027|La Reforma
50590028|La Tigra
50590029|La Unión
50590030|La Venada
50590031|La Victoria
50590032|La Ye
50590033|Laguna Gringa
50590034|Las Colinas
50590035|Las Palmeras
50590036|Los Comuneros
50590037|Monserrate
50590038|Puerto Chispas
50590039|Puerto Toledo
50590040|San Pedro
50590041|San Rafael
50590042|San Vicente Alto
50590043|San Vicente Bajo
50590044|Santa Lucía
50590045|Sausalito
$v$, E'\n')) x
 where x <> ''
on conflict do nothing;
