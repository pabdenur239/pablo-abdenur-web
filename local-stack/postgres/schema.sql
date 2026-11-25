-- Secretario Virtual Institucional — esquema de base de datos (Fase 1, local)
-- Se ejecuta una sola vez contra el Postgres local del stack (ver
-- docker-compose.yml). Nadie fuera de la red interna de Docker puede
-- conectarse a esta base: solo el servicio "rag-service".

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists visitantes (
  id uuid primary key default gen_random_uuid(),
  canal text not null default 'web',            -- web | whatsapp | messenger | instagram (fases futuras)
  perfil text,
  nombre text,
  telefono text,
  email text,
  localidad text,
  primera_interaccion timestamptz not null default now(),
  ultima_interaccion timestamptz not null default now()
);

create table if not exists conversaciones (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid not null references visitantes(id) on delete cascade,
  canal text not null default 'web',
  estado text not null default 'abierta',        -- abierta | escalada | cerrada
  tema text,
  prioridad text not null default 'normal',
  creada_en timestamptz not null default now(),
  cerrada_en timestamptz
);

create table if not exists mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  remitente text not null,                        -- visitante | asistente | humano | sistema
  contenido text not null,
  -- Referencia interna a los documentos usados para responder (título +
  -- carpeta + similitud), para poder mostrar la fuente al visitante en
  -- una fase futura. Vacío en mensajes de tipo "visitante".
  fuentes jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now()
);

create table if not exists reclamos (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid references visitantes(id),
  conversacion_id uuid references conversaciones(id),
  asunto text,
  descripcion text,
  estado text not null default 'nuevo',
  creado_en timestamptz not null default now()
);

create table if not exists reuniones (
  id uuid primary key default gen_random_uuid(),
  visitante_id uuid references visitantes(id),
  conversacion_id uuid references conversaciones(id),
  fecha_hora timestamptz,
  calendar_event_id text,
  confirmado boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists documentos_indexados (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  titulo text,
  ruta_carpeta text,
  hash_contenido text,
  ultima_actualizacion timestamptz not null default now()
);

-- 768 = dimensión del modelo de embeddings local recomendado
-- (nomic-embed-text, servido por Ollama). Si se cambia de modelo, ajustar
-- esta dimensión.
create table if not exists fragmentos_embebidos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos_indexados(id) on delete cascade,
  texto text not null,
  embedding vector(768),
  metadata jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists fragmentos_embebidos_embedding_idx
  on fragmentos_embebidos using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Búsqueda por similitud: usada por rag-service en cada consulta.
create or replace function buscar_fragmentos(
  query_embedding vector(768),
  match_count int default 5,
  match_threshold float default 0.65
)
returns table (
  id uuid,
  documento_id uuid,
  texto text,
  similarity float,
  metadata jsonb
)
language sql stable
as $$
  select
    fragmentos_embebidos.id,
    fragmentos_embebidos.documento_id,
    fragmentos_embebidos.texto,
    1 - (fragmentos_embebidos.embedding <=> query_embedding) as similarity,
    fragmentos_embebidos.metadata
  from fragmentos_embebidos
  where 1 - (fragmentos_embebidos.embedding <=> query_embedding) > match_threshold
  order by fragmentos_embebidos.embedding <=> query_embedding
  limit match_count;
$$;
