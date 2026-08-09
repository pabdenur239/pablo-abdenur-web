-- Secretario Virtual Institucional — esquema de base de datos (Fase 1)
-- Ejecutar una sola vez en el SQL Editor del proyecto de Supabase.
-- No se accede desde el navegador: solo las Edge Functions (con la
-- service role key) leen y escriben estas tablas.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- Quién escribe, y con qué perfil se identificó.
create table if not exists visitantes (
  id uuid primary key default gen_random_uuid(),
  canal text not null default 'web',            -- web | whatsapp | messenger | instagram (fases futuras)
  perfil text,                                   -- vecino, comerciante, periodista, etc.
  nombre text,
  telefono text,
  email text,
  localidad text,
  primera_interaccion timestamptz not null default now(),
  ultima_interaccion timestamptz not null default now()
);

-- Cada hilo de conversación.
create table if not exists conversaciones (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid not null references visitantes(id) on delete cascade,
  canal text not null default 'web',
  estado text not null default 'abierta',        -- abierta | escalada | cerrada
  tema text,
  prioridad text not null default 'normal',       -- normal | alta
  creada_en timestamptz not null default now(),
  cerrada_en timestamptz
);

-- Cada mensaje individual, en orden.
create table if not exists mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  remitente text not null,                        -- visitante | asistente | humano | sistema
  contenido text not null,
  creado_en timestamptz not null default now()
);

-- Reclamos y propuestas (Fase 4).
create table if not exists reclamos (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid references visitantes(id),
  conversacion_id uuid references conversaciones(id),
  asunto text,
  descripcion text,
  estado text not null default 'nuevo',
  creado_en timestamptz not null default now()
);

-- Reuniones agendadas vía Google Calendar (Fase 5).
create table if not exists reuniones (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid references visitantes(id),
  conversacion_id uuid references conversaciones(id),
  fecha_hora timestamptz,
  calendar_event_id text,
  confirmado boolean not null default false,
  creado_en timestamptz not null default now()
);

-- Qué archivo de Drive corresponde a qué versión ya indexada.
create table if not exists documentos_indexados (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  titulo text,
  ruta_carpeta text,
  hash_contenido text,
  ultima_actualizacion timestamptz not null default now()
);

-- Fragmentos de texto buscables por significado (RAG).
-- 1536 = dimensión del modelo text-embedding-3-small de OpenAI.
create table if not exists fragmentos_embebidos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos_indexados(id) on delete cascade,
  texto text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists fragmentos_embebidos_embedding_idx
  on fragmentos_embebidos using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Búsqueda por similitud: usada por la Edge Function "asistente" en cada consulta.
create or replace function buscar_fragmentos(
  query_embedding vector(1536),
  match_count int default 5,
  match_threshold float default 0.75
)
returns table (
  id uuid,
  documento_id uuid,
  texto text,
  similarity float
)
language sql stable
as $$
  select
    fragmentos_embebidos.id,
    fragmentos_embebidos.documento_id,
    fragmentos_embebidos.texto,
    1 - (fragmentos_embebidos.embedding <=> query_embedding) as similarity
  from fragmentos_embebidos
  where 1 - (fragmentos_embebidos.embedding <=> query_embedding) > match_threshold
  order by fragmentos_embebidos.embedding <=> query_embedding
  limit match_count;
$$;

-- Todas las tablas quedan con RLS activado y sin políticas públicas: la
-- clave anon (pública) no puede leer ni escribir nada. Solo la service
-- role key, usada exclusivamente dentro de las Edge Functions, tiene acceso.
alter table visitantes enable row level security;
alter table conversaciones enable row level security;
alter table mensajes enable row level security;
alter table reclamos enable row level security;
alter table reuniones enable row level security;
alter table documentos_indexados enable row level security;
alter table fragmentos_embebidos enable row level security;
