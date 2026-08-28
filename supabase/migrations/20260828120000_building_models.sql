-- Los modelos con los que se dibujan los edificios del juego.
--
-- El taller no inventa edificios: le cambia la cara a los que ya hay. Aquí vive
-- esa cara, una fila por edificio, para que el cambio no se quede en el
-- navegador de quien lo hizo y lo vea todo el mundo, en cualquier dispositivo.
--
-- La ficha del edificio (lo que cuesta, lo que aguanta, lo que hace) no está
-- aquí ni tiene por qué: la pone el juego. De aquí sale sólo el modelo.

create table if not exists public.building_models (
  -- El edificio del juego al que viste este modelo: 'house', 'mill', 'castle'...
  target text primary key,
  -- El modelo entero tal y como lo guarda el taller: { target, size, palette, parts }.
  model jsonb not null,
  updated_at timestamptz not null default now(),

  -- Nada de esto sustituye al validador del juego, que recorta pieza a pieza al
  -- leer. Es el cinturón de la base de datos: que no entre en la tabla algo que
  -- ningún taller podría haber escrito.
  constraint building_models_target_valid
    check (target ~ '^[a-z][a-z0-9]{2,23}$'),
  constraint building_models_model_shape
    check (
      jsonb_typeof(model) = 'object'
      and model ->> 'target' = target
      and jsonb_typeof(model -> 'parts') = 'array'
      and jsonb_array_length(model -> 'parts') <= 200
      and jsonb_typeof(model -> 'palette') = 'object'
    ),
  -- Un modelo normal ronda el kilobyte y el tope de piezas ya lo acota; esto
  -- corta de raíz que alguien use la tabla de almacén de lo que sea.
  constraint building_models_model_size
    check (pg_column_size(model) < 65536)
);

comment on table public.building_models is
  'Cara de cada edificio del juego, hecha en el taller. Una fila por edificio.';

-- `updated_at` lo lleva la base de datos: así vale para saber qué se tocó y
-- cuándo aunque quien escriba se lo salte.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists building_models_touch on public.building_models;
create trigger building_models_touch
  before update on public.building_models
  for each row execute function public.touch_updated_at();

-- --- Quién puede qué -------------------------------------------------------
--
-- El taller es de todos: quien abra el juego lee los modelos y puede rehacerlos.
-- No hay cuentas ni claves de edición, así que estas políticas dejan pasar a
-- cualquiera con la clave pública. Es una decisión deliberada: el precio es que
-- cualquiera puede repintar el juego o dejar un edificio como estaba.

alter table public.building_models enable row level security;

drop policy if exists "cualquiera lee los modelos" on public.building_models;
create policy "cualquiera lee los modelos"
  on public.building_models for select
  to anon, authenticated
  using (true);

drop policy if exists "cualquiera crea un modelo" on public.building_models;
create policy "cualquiera crea un modelo"
  on public.building_models for insert
  to anon, authenticated
  with check (true);

drop policy if exists "cualquiera rehace un modelo" on public.building_models;
create policy "cualquiera rehace un modelo"
  on public.building_models for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "cualquiera devuelve un edificio a su aspecto" on public.building_models;
create policy "cualquiera devuelve un edificio a su aspecto"
  on public.building_models for delete
  to anon, authenticated
  using (true);

grant select, insert, update, delete on public.building_models to anon, authenticated;
