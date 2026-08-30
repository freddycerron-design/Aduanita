-- =====================================================================
-- AduANITA MVP - Schema de base de datos (Supabase / PostgreSQL)
-- =====================================================================
-- Ejecutar completo en el SQL Editor de Supabase, sobre un proyecto nuevo.
-- Requiere que Supabase Auth ya este habilitado (viene activo por defecto).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensiones
-- ---------------------------------------------------------------------
-- Se instalan en el schema "extensions" (no en "public") siguiendo la
-- practica recomendada por el linter de seguridad de Supabase.
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions; -- para gen_random_uuid()


-- ---------------------------------------------------------------------
-- 1. perfiles_especialista
-- ---------------------------------------------------------------------
-- Espejo 1:1 de auth.users con datos de negocio que Supabase Auth no
-- maneja (rol, nombre completo). Se llena automaticamente via trigger
-- cuando un usuario se registra.
create table public.perfiles_especialista (
    id              uuid primary key references auth.users(id) on delete cascade,
    nombre_completo text not null,
    rol             text not null default 'ESPECIALISTA'
                        check (rol in ('ESPECIALISTA', 'ADMIN')),
    activo          boolean not null default true,
    creado_en       timestamptz not null default now()
);

comment on table public.perfiles_especialista is
    'Datos de negocio de cada especialista aduanero que usa el dashboard. 1:1 con auth.users.';

-- Funcion + trigger: al crear un usuario en auth.users, crea su perfil
-- automaticamente. El nombre completo se toma de raw_user_meta_data si
-- el frontend lo envia al hacer sign up (metadata "nombre_completo"),
-- y si no viene, se usa el correo como valor por defecto.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.perfiles_especialista (id, nombre_completo)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'nombre_completo', new.email)
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- handle_new_user() solo debe ejecutarse como trigger al crear un usuario en
-- auth.users; se revoca su ejecucion como endpoint RPC publico
-- (/rest/v1/rpc/handle_new_user) para los roles anon/authenticated.
revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. despachos
-- ---------------------------------------------------------------------
-- Un despacho agrupa los 4 documentos de una operacion de importacion,
-- su validacion cruzada, la propuesta de clasificacion y el borrador
-- de correo generado. El campo "estado" funciona como maquina de
-- estados del pipeline (ver services/README del backend / app/main.py).
create table public.despachos (
    id              uuid primary key default gen_random_uuid(),
    numero_despacho text not null unique,
    cliente         text not null,
    estado          text not null default 'PENDIENTE_DOCUMENTOS'
                        check (estado in (
                            'PENDIENTE_DOCUMENTOS',
                            'EXTRAYENDO',
                            'VALIDADO_CON_ALERTAS',
                            'VALIDADO_OK',
                            'CLASIFICADO_IA',
                            'APROBADO',
                            'CORREGIDO',
                            'ERROR'
                        )),
    fecha_creacion  timestamptz not null default now(),
    creado_por      uuid references public.perfiles_especialista(id),
    actualizado_en  timestamptz not null default now()
);

create index despachos_creado_por_idx on public.despachos (creado_por);

comment on column public.despachos.estado is
    'Maquina de estados del pipeline: PENDIENTE_DOCUMENTOS -> EXTRAYENDO -> '
    'VALIDADO_OK|VALIDADO_CON_ALERTAS -> CLASIFICADO_IA -> APROBADO|CORREGIDO. '
    'ERROR es alcanzable desde cualquier paso si la extraccion o clasificacion falla.';


-- ---------------------------------------------------------------------
-- 3. documentos_extraidos
-- ---------------------------------------------------------------------
-- Resultado estructurado (JSON validado contra un schema Pydantic) de
-- cada uno de los 4 documentos de un despacho.
create table public.documentos_extraidos (
    id                   uuid primary key default gen_random_uuid(),
    id_despacho          uuid not null references public.despachos(id) on delete cascade,
    tipo_documento       text not null
                             check (tipo_documento in ('FACTURA', 'SEGURO', 'SWIFT_BANCARIO', 'BL')),
    contenido_json       jsonb not null,
    url_pdf_storage      text not null,
    metodo_extraccion    text not null default 'PYMUPDF'
                             check (metodo_extraccion in ('PYMUPDF', 'GEMINI_VISION')),
    confianza_extraccion float,
    creado_en            timestamptz not null default now(),
    -- MVP: un solo documento de cada tipo por despacho (sin BL master+house,
    -- sin facturas multiples).
    unique (id_despacho, tipo_documento)
);

comment on column public.documentos_extraidos.contenido_json is
    'Salida ya validada contra FacturaSchema / SeguroSchema / SwiftSchema / BLSchema (services/pdf_processor.py).';
comment on column public.documentos_extraidos.metodo_extraccion is
    'PYMUPDF si el texto se extrajo y estructuro directamente; GEMINI_VISION si el PDF '
    'era un escaneado y se uso el fallback de vision.';


-- ---------------------------------------------------------------------
-- 4. resultados_validacion
-- ---------------------------------------------------------------------
-- Persiste el output de services/validation_engine.py para no tener que
-- recomputarlo en cada carga del dashboard y para dejar auditoria de
-- que se comparo y con que resultado.
create table public.resultados_validacion (
    id           uuid primary key default gen_random_uuid(),
    id_despacho  uuid not null references public.despachos(id) on delete cascade,
    regla        text not null,
    severidad    text not null check (severidad in ('ALTA', 'MEDIA', 'NINGUNA')),
    detalle      text not null,
    valor_a      jsonb,
    valor_b      jsonb,
    creado_en    timestamptz not null default now()
);

create index resultados_validacion_id_despacho_idx on public.resultados_validacion (id_despacho);

comment on column public.resultados_validacion.regla is
    'Identificador de la regla aplicada, p.ej. PESO_FACTURA_VS_BL, BULTOS_FACTURA_VS_BL, '
    'MONTO_FACTURA_VS_SWIFT, VALOR_ASEGURADO_VS_FACTURA, CONSIGNATARIO_FACTURA_VS_BL, INCOTERM.';


-- ---------------------------------------------------------------------
-- 5. historial_clasificaciones (RAG feedback loop)
-- ---------------------------------------------------------------------
-- Cada fila es una clasificacion arancelaria ya decidida por un humano
-- (aprobando o corrigiendo la propuesta de la IA). Sirve como base de
-- antecedentes para las futuras busquedas semanticas (RAG).
create table public.historial_clasificaciones (
    id                       uuid primary key default gen_random_uuid(),
    id_despacho              uuid references public.despachos(id) on delete set null,
    descripcion_comercial    text not null,
    atributos_json           jsonb not null default '{}'::jsonb,
    subpartida_sugerida_ia   text not null,
    subpartida_final_humano  text not null,
    tipo_accion              text not null check (tipo_accion in ('APROBADO', 'EDITADO')),
    motivo_modificacion      text,
    embedding                vector(768) not null,
    peso_prioridad           float not null default 1.0,
    aprobado_por             uuid not null references public.perfiles_especialista(id),
    creado_en                timestamptz not null default now(),
    constraint motivo_requerido_si_editado check (
        tipo_accion <> 'EDITADO' or motivo_modificacion is not null
    )
);

comment on column public.historial_clasificaciones.embedding is
    'Vector de 768 dimensiones generado con Gemini text-embedding-004 sobre '
    'descripcion_comercial + atributos_json (ver rag_service.construir_texto_para_embedding).';
comment on column public.historial_clasificaciones.peso_prioridad is
    '1.0 cuando el humano aprobo la sugerencia de la IA tal cual; 2.0 cuando la corrigio '
    '(una correccion es una senal mas fuerte para el RAG que una aprobacion pasiva).';

-- Indice HNSW para busqueda por similitud de coseno eficiente.
create index historial_clasificaciones_embedding_idx
    on public.historial_clasificaciones
    using hnsw (embedding vector_cosine_ops);

create index historial_clasificaciones_id_despacho_idx on public.historial_clasificaciones (id_despacho);
create index historial_clasificaciones_aprobado_por_idx on public.historial_clasificaciones (aprobado_por);


-- ---------------------------------------------------------------------
-- 6. borradores_correo
-- ---------------------------------------------------------------------
-- Borrador de correo generado por services/email_draft_service.py. No se
-- envia automaticamente: el especialista lo copia o edita desde el
-- dashboard (decision confirmada con el usuario).
create table public.borradores_correo (
    id              uuid primary key default gen_random_uuid(),
    id_despacho     uuid not null references public.despachos(id) on delete cascade,
    tipo            text not null check (tipo in ('RESULTADOS', 'SOLICITUD_INFO_FALTANTE')),
    asunto          text not null,
    cuerpo          text not null,
    generado_en     timestamptz not null default now(),
    editado_por     uuid references public.perfiles_especialista(id),
    cuerpo_editado  text
);

create index borradores_correo_id_despacho_idx on public.borradores_correo (id_despacho);
create index borradores_correo_editado_por_idx on public.borradores_correo (editado_por);


-- ---------------------------------------------------------------------
-- 7. RPC: match_antecedentes_aduaneros
-- ---------------------------------------------------------------------
-- Busqueda semantica por coseno sobre historial_clasificaciones,
-- ponderando el score de similitud por peso_prioridad para que las
-- correcciones humanas (EDITADO, peso 2.0) pesen mas que las simples
-- aprobaciones (APROBADO, peso 1.0) al ordenar los resultados.
--
-- search_path incluye "extensions" ademas de "public" porque el operador
-- <=> (distancia de coseno) vive ahi junto con la extension vector.
create or replace function public.match_antecedentes_aduaneros(
    query_embedding vector(768),
    match_count     int default 5,
    min_similarity  float default 0.0
)
returns table (
    id                        uuid,
    descripcion_comercial     text,
    atributos_json            jsonb,
    subpartida_final_humano   text,
    tipo_accion               text,
    motivo_modificacion       text,
    peso_prioridad            float,
    similitud                 float,
    score_ponderado           float
)
language sql
stable
set search_path = public, extensions
as $$
    select
        h.id,
        h.descripcion_comercial,
        h.atributos_json,
        h.subpartida_final_humano,
        h.tipo_accion,
        h.motivo_modificacion,
        h.peso_prioridad,
        1 - (h.embedding <=> query_embedding)                    as similitud,
        (1 - (h.embedding <=> query_embedding)) * h.peso_prioridad as score_ponderado
    from public.historial_clasificaciones h
    where 1 - (h.embedding <=> query_embedding) >= min_similarity
    order by score_ponderado desc
    limit match_count;
$$;

comment on function public.match_antecedentes_aduaneros is
    'Devuelve los antecedentes de clasificacion mas relevantes para un embedding de consulta, '
    'ordenados por similitud de coseno multiplicada por peso_prioridad (rag_service.buscar_antecedentes).';


-- ---------------------------------------------------------------------
-- 8. Row Level Security (RLS)
-- ---------------------------------------------------------------------
-- El backend FastAPI opera con la clave service_role, que bypassa RLS
-- por diseno de Supabase: por eso las tablas de pipeline (despachos,
-- documentos_extraidos, resultados_validacion) NO tienen policies de
-- insert/update para el rol "authenticated" -- solo el backend las
-- escribe. Toda la proteccion de esas tablas depende de que el backend
-- valide el JWT del especialista antes de ejecutar cualquier operacion
-- (ver app/main.py -> get_current_user).
--
-- El dashboard de Streamlit, en cambio, usa un cliente Supabase
-- autenticado con el JWT del usuario (anon key + token de sesion) para
-- las operaciones que deben quedar auditadas por auth.uid(): guardar
-- feedback de clasificacion y editar el borrador de correo.

alter table public.perfiles_especialista   enable row level security;
alter table public.despachos               enable row level security;
alter table public.documentos_extraidos    enable row level security;
alter table public.resultados_validacion   enable row level security;
alter table public.historial_clasificaciones enable row level security;
alter table public.borradores_correo       enable row level security;

-- Lectura: cualquier usuario autenticado puede leer todo (MVP de un solo
-- equipo interno, sin multi-tenant todavia).
--
-- Las llamadas a auth.uid()/auth.role() se envuelven en (select ...) para
-- que Postgres las evalue una sola vez por consulta en vez de una vez por
-- fila (recomendacion oficial de Supabase para RLS a escala).
create policy "auth_select_perfiles" on public.perfiles_especialista
    for select using ((select auth.role()) = 'authenticated');

create policy "auth_select_despachos" on public.despachos
    for select using ((select auth.role()) = 'authenticated');

create policy "auth_select_documentos" on public.documentos_extraidos
    for select using ((select auth.role()) = 'authenticated');

create policy "auth_select_validacion" on public.resultados_validacion
    for select using ((select auth.role()) = 'authenticated');

create policy "auth_select_historial" on public.historial_clasificaciones
    for select using ((select auth.role()) = 'authenticated');

create policy "auth_select_borradores" on public.borradores_correo
    for select using ((select auth.role()) = 'authenticated');

-- Insert en historial_clasificaciones: solo el propio usuario autenticado
-- puede insertar una fila donde el figure como aprobado_por (evita que
-- alguien registre una decision a nombre de otro especialista).
create policy "auth_insert_historial_propio" on public.historial_clasificaciones
    for insert with check ((select auth.uid()) = aprobado_por);

-- Update en borradores_correo: cualquier autenticado puede editar, pero
-- solo puede dejar registrado su propio uid como editor.
create policy "auth_update_borrador_propio" on public.borradores_correo
    for update using ((select auth.role()) = 'authenticated')
    with check ((select auth.uid()) = editado_por or editado_por is null);

-- perfiles_especialista: cada usuario solo puede actualizar su propio perfil.
create policy "self_update_perfil" on public.perfiles_especialista
    for update using ((select auth.uid()) = id);


-- ---------------------------------------------------------------------
-- 9. Storage: bucket de PDFs
-- ---------------------------------------------------------------------
-- Bucket privado para los PDFs originales subidos por el dashboard. El
-- backend sube los archivos con la clave service_role; el dashboard
-- descarga el PDF original para previsualizarlo usando su propio cliente
-- Supabase autenticado (JWT del especialista), amparado por la policy de
-- storage.objects definida abajo.
insert into storage.buckets (id, name, public)
values ('documentos-aduaneros', 'documentos-aduaneros', false)
on conflict (id) do nothing;

create policy "auth_select_storage_documentos"
    on storage.objects for select
    using (bucket_id = 'documentos-aduaneros' and (select auth.role()) = 'authenticated');
