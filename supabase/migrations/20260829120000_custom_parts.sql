-- Las piezas que se hacen en el taller.
--
-- Los edificios se visten con piezas. Las que trae el juego —la caja, el
-- cilindro, el tejado— son código y no cambian. Éstas las hace quien juega,
-- componiéndolas con aquéllas, y son datos: una lista de piezas del juego con
-- su sitio, su tamaño y su material.
--
-- Van en su propia tabla porque no son de ningún edificio: son el vocabulario
-- con el que se hacen todos, y una sola pieza puede estar en veinte. Y por eso
-- mismo quedan **enlazadas**: cambiar una aquí cambia de golpe todos los
-- edificios que la lleven, para todo el que juegue.

create table if not exists public.custom_parts (
  -- La clave con la que los modelos la nombran: dentro de un edificio va como
  -- 'mia:<key>'. Aquí se guarda sin el prefijo.
  key text primary key,
  -- La pieza entera tal y como la guarda el taller: { key, label, parts }.
  part jsonb not null,
  updated_at timestamptz not null default now(),

  -- Como en los modelos, esto no sustituye al validador del juego, que recorta
  -- pieza a pieza al leer: es el cinturón de la base de datos.
  constraint custom_parts_key_valid
    check (key ~ '^[a-z][a-z0-9-]{2,31}$'),
  constraint custom_parts_shape
    check (
      jsonb_typeof(part) = 'object'
      and part ->> 'key' = key
      and jsonb_typeof(part -> 'parts') = 'array'
      -- Una pieza propia se compone con las del juego y con pocas: si hicieran
      -- falta sesenta, eso ya es un edificio.
      and jsonb_array_length(part -> 'parts') <= 60
      and length(coalesce(part ->> 'label', '')) between 1 and 32
    ),
  constraint custom_parts_size
    check (pg_column_size(part) < 32768)
);

comment on table public.custom_parts is
  'Piezas hechas en el taller, con las que se visten los edificios. Una fila por pieza.';

-- `updated_at` lo lleva la base de datos, igual que en los modelos. La función
-- ya existe si se aplicó aquella migración; se deja creada por si no.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_parts_touch on public.custom_parts;
create trigger custom_parts_touch
  before update on public.custom_parts
  for each row execute function public.touch_updated_at();

-- --- Quién puede qué -------------------------------------------------------
--
-- Lo mismo que con los modelos: el taller es de todos y no hay cuentas. El
-- precio, aquí, es mayor —quitar una pieza deja sin dibujar lo que la llevara—,
-- así que el taller avisa de cuántos edificios la usan antes de dejar borrarla.

alter table public.custom_parts enable row level security;

drop policy if exists "cualquiera lee las piezas" on public.custom_parts;
create policy "cualquiera lee las piezas"
  on public.custom_parts for select
  to anon, authenticated
  using (true);

drop policy if exists "cualquiera crea una pieza" on public.custom_parts;
create policy "cualquiera crea una pieza"
  on public.custom_parts for insert
  to anon, authenticated
  with check (true);

drop policy if exists "cualquiera rehace una pieza" on public.custom_parts;
create policy "cualquiera rehace una pieza"
  on public.custom_parts for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "cualquiera quita una pieza" on public.custom_parts;
create policy "cualquiera quita una pieza"
  on public.custom_parts for delete
  to anon, authenticated
  using (true);

grant select, insert, update, delete on public.custom_parts to anon, authenticated;
