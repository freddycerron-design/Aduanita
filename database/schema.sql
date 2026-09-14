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
    rol             text not null default 'GESTOR'
                        check (rol in ('GESTOR', 'LIQUIDADOR', 'ADMIN')),
    activo          boolean not null default true,
    creado_en       timestamptz not null default now()
);

comment on table public.perfiles_especialista is
    'Datos de negocio de cada usuario que usa el dashboard (gestor/liquidador/admin). 1:1 con auth.users.';
comment on column public.perfiles_especialista.rol is
    'GESTOR: sube y valida documentos, envia el despacho a clasificacion '
    '(antes se llamaba ESPECIALISTA, renombrado). '
    'LIQUIDADOR: revisa la propuesta de subpartida, la acepta u observa, y '
    'calcula la pre-liquidacion de tributos. '
    'ADMIN: puede realizar cualquier accion de los dos roles anteriores, '
    'ademas de administrar reglas de validacion, cargos especiales del '
    'arancel, y usuarios.';

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
    estado          text not null default 'REVISION_DOC'
                        check (estado in (
                            'REVISION_DOC',
                            'CLASIFICACION',
                            'FINALIZADO'
                        )),
    fecha_creacion  timestamptz not null default now(),
    creado_por      uuid references public.perfiles_especialista(id),
    actualizado_en  timestamptz not null default now()
);

create index despachos_creado_por_idx on public.despachos (creado_por);

comment on column public.despachos.estado is
    'Maquina de estados del flujo de negocio: REVISION_DOC (subida y validacion '
    'de documentos, a cargo del especialista) -> CLASIFICACION (el especialista '
    'envio el despacho a clasificar via el boton Enviar a Clasificacion; se '
    'genera la propuesta IA) -> FINALIZADO (el liquidador registro su decision, '
    'aceptando u observando la propuesta -- el detalle de cual de las dos ocurrio '
    'vive en historial_clasificaciones.tipo_accion (APROBADO/EDITADO), no en '
    'este campo).';


-- ---------------------------------------------------------------------
-- 3. documentos_extraidos
-- ---------------------------------------------------------------------
-- Resultado estructurado (JSON validado contra un schema Pydantic) de
-- cada uno de los 4 documentos de un despacho.
--
-- La carga del PDF (subir_documento) y la extraccion con Gemini
-- (_ejecutar_extraccion_pendiente) son dos pasos separados: al subir, se
-- crea la fila con contenido_json='{}' y procesado=false (rapido, sin
-- llamar a Gemini); al presionar "Procesar informacion" se extrae el
-- contenido real en bloque para todos los documentos pendientes.
create table public.documentos_extraidos (
    id                   uuid primary key default gen_random_uuid(),
    id_despacho          uuid not null references public.despachos(id) on delete cascade,
    tipo_documento       text not null
                             check (tipo_documento in ('FACTURA', 'SEGURO', 'SWIFT_BANCARIO', 'BL', 'PACKING_LIST')),
    contenido_json       jsonb not null default '{}'::jsonb,
    url_pdf_storage      text not null,
    metodo_extraccion    text
                             check (metodo_extraccion in ('PYMUPDF', 'GEMINI_VISION')),
    procesado            boolean not null default false,
    confianza_extraccion float,
    creado_en            timestamptz not null default now(),
    -- MVP: un solo documento de cada tipo por despacho (sin BL master+house,
    -- sin facturas multiples).
    unique (id_despacho, tipo_documento)
);

comment on column public.documentos_extraidos.contenido_json is
    'Salida ya validada contra FacturaSchema / SeguroSchema / SwiftSchema / BLSchema (services/pdf_processor.py). '
    'Vacio ({}) mientras procesado=false.';
comment on column public.documentos_extraidos.metodo_extraccion is
    'PYMUPDF si el texto se extrajo y estructuro directamente; GEMINI_VISION si el PDF '
    'era un escaneado y se uso el fallback de vision. NULL mientras procesado=false.';
comment on column public.documentos_extraidos.procesado is
    'true una vez que se extrajo el contenido_json real; false mientras el PDF '
    'esta subido pero pendiente de extraccion.';


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


-- ---------------------------------------------------------------------
-- 10. reglas_validacion
-- ---------------------------------------------------------------------
-- Motor de reglas de validacion cruzada, configurable por un ADMIN sin
-- tocar codigo Python (antes eran 5 funciones hardcodeadas en
-- services/validation_engine.py). Cada fila define una comparacion entre
-- un campo de un documento (documento_a/campo_a) y un campo de otro
-- documento (documento_b/campo_b); services/validation_engine.py
-- interpreta cada fila activa segun su tipo_comparacion.
create table public.reglas_validacion (
    id                          uuid primary key default gen_random_uuid(),
    codigo                      text not null unique,
    nombre                      text not null,
    descripcion                 text,
    activo                      boolean not null default true,
    documento_a                 text not null
                                    check (documento_a in ('FACTURA', 'SEGURO', 'SWIFT_BANCARIO', 'BL', 'PACKING_LIST')),
    campo_a                     text not null,
    documento_b                 text not null
                                    check (documento_b in ('FACTURA', 'SEGURO', 'SWIFT_BANCARIO', 'BL', 'PACKING_LIST')),
    campo_b                     text not null,
    campo_moneda_a              text,
    campo_moneda_b              text,
    severidad_moneda_distinta   text check (severidad_moneda_distinta in ('ALTA', 'MEDIA', 'NINGUNA')),
    severidad_dato_faltante     text not null check (severidad_dato_faltante in ('ALTA', 'MEDIA', 'NINGUNA')),
    tipo_comparacion            text not null
                                    check (tipo_comparacion in ('RANGO_ASIMETRICO', 'IGUALDAD_EXACTA', 'TEXTO_FUZZY')),
    parametros                  jsonb not null default '{}'::jsonb,
    creado_por                  uuid references public.perfiles_especialista(id),
    creado_en                   timestamptz not null default now(),
    actualizado_en              timestamptz not null default now(),
    constraint reglas_validacion_moneda_par_completo
        check ((campo_moneda_a is null) = (campo_moneda_b is null)),
    constraint reglas_validacion_severidad_moneda_si_aplica
        check (campo_moneda_a is null or severidad_moneda_distinta is not null)
);

create index reglas_validacion_activo_idx on public.reglas_validacion (activo);

comment on table public.reglas_validacion is
    'Reglas de validacion cruzada configurables por un ADMIN (antes eran funciones '
    'Python hardcodeadas en services/validation_engine.py). documento_a/documento_b '
    'y campo_a/campo_b se validan en la API contra TIPO_A_SCHEMA[...].model_fields '
    '(services/pdf_processor.py) antes de insertar/actualizar -- la DB no puede validar '
    'eso por si sola. codigo es lo que queda persistido en resultados_validacion.regla.';
comment on column public.reglas_validacion.tipo_comparacion is
    'RANGO_ASIMETRICO: numerico, compara (valor_b-valor_a)/max(|valor_a|,|valor_b|) contra '
    'dos umbrales con severidad propia cada uno. parametros = {"umbral_inferior": float, '
    '"severidad_inferior": Severidad, "umbral_superior": float, "severidad_superior": Severidad}. '
    'IGUALDAD_EXACTA: compara valor_a==valor_b (numerico) o normalizado trim+upper (si texto); '
    'parametros = {"severidad_si_distinto": Severidad, "normalizar_texto": bool}. '
    'TEXTO_FUZZY: usa _normalizar_razon_social() fija (no configurable) + rapidfuzz.fuzz.ratio; '
    'parametros = {"umbral_similitud": float (0-1), "severidad_si_distinto": Severidad}.';
comment on column public.reglas_validacion.campo_moneda_a is
    'Opcional. Si campo_moneda_a y campo_moneda_b estan seteados y las monedas leidas de esos '
    'campos difieren (case-insensitive), la regla corta corto devolviendo severidad_moneda_distinta '
    'sin evaluar la comparacion principal. Debe venir en pareja con campo_moneda_b (ver constraint).';
comment on column public.reglas_validacion.severidad_dato_faltante is
    'Severidad devuelta cuando falta el documento entero, o cuando el campo especifico viene '
    'null/vacio en un documento que si esta presente.';

alter table public.reglas_validacion enable row level security;

-- Igual que el resto de tablas de pipeline (ver seccion 8): sin policies
-- de insert/update/delete para "authenticated", solo el backend
-- (service_role, gateado por _requiere_rol(usuario, set()) = solo ADMIN)
-- escribe aqui.
create policy "auth_select_reglas_validacion" on public.reglas_validacion
    for select using ((select auth.role()) = 'authenticated');


-- ---------------------------------------------------------------------
-- 11. partidas_arancelarias
-- ---------------------------------------------------------------------
-- Nomenclador del Arancel de Aduanas del Peru 2022 (D.S. 404-2021-EF),
-- cargado por scripts/importar_arancel.py (parseo del PDF oficial de
-- SUNAT -- no existe una version CSV/API oficial). Se usa como fuente de
-- CANDIDATAS para el clasificador (services/arancel_service.py), no como
-- fuente de verdad de la tasa vigente (el ad_valorem de este documento
-- puede haber quedado desactualizado por decretos puntuales posteriores).
create table public.partidas_arancelarias (
    codigo        text primary key,
    descripcion   text not null,
    ad_valorem    numeric,
    creado_en     timestamptz not null default now(),
    search_vector tsvector generated always as (to_tsvector('spanish', descripcion)) stored
);

create index partidas_arancelarias_search_idx on public.partidas_arancelarias using gin (search_vector);

comment on table public.partidas_arancelarias is
    'Nomenclador oficial (Arancel de Aduanas del Peru 2022) usado como candidatas de '
    'contexto para el clasificador, via busqueda de texto completo (sin embeddings -- '
    'evita miles de llamadas a la API de Gemini). No representa la tasa arancelaria '
    'vigente garantizada, solo una referencia -- ver scripts/importar_arancel.py.';
comment on column public.partidas_arancelarias.codigo is
    'Subpartida nacional de 10 digitos, formato NNNN.NN.NN.NN.';
comment on column public.partidas_arancelarias.descripcion is
    'Combina el texto de la partida (4 digitos) mas el texto propio de la subpartida '
    'nacional -- simplificacion deliberada, no guarda la jerarquia intermedia completa '
    '(6/8 digitos). Ver scripts/importar_arancel.py para el detalle del parseo.';

alter table public.partidas_arancelarias enable row level security;

create policy "auth_select_partidas_arancelarias" on public.partidas_arancelarias
    for select using ((select auth.role()) = 'authenticated');

-- Sin policies de insert/update/delete para "authenticated": es una tabla
-- de referencia que solo carga scripts/importar_arancel.py con
-- service_role, igual criterio que el resto de tablas de pipeline.


-- ---------------------------------------------------------------------
-- 12. RPC: buscar_partidas_candidatas
-- ---------------------------------------------------------------------
-- Busqueda de texto completo con semantica OR sobre partidas_arancelarias
-- (via el operador || entre tsquery, uno por palabra) -- una descripcion
-- comercial real ("microscopios opticos de laboratorio, marca Zeiss")
-- casi nunca calza palabra por palabra con la terminologia legal terse
-- del arancel, asi que con AND (plainto_tsquery normal) no devuelve nada;
-- con OR, ts_rank igual prioriza arriba las filas que calzan mas palabras.
-- plainto_tsquery() nunca lanza error de sintaxis con texto arbitrario (a
-- diferencia de to_tsquery() con el texto crudo), por eso se arma la
-- consulta palabra por palabra con esa funcion antes de combinarlas.
create or replace function public.buscar_partidas_candidatas(
    consulta text,
    limite   int default 8
)
returns table (
    codigo      text,
    descripcion text,
    ad_valorem  numeric,
    rank        real
)
language plpgsql
stable
set search_path = public
as $$
declare
    palabra text;
    consulta_tsquery tsquery := ''::tsquery;
begin
    foreach palabra in array regexp_split_to_array(trim(coalesce(consulta, '')), '\s+') loop
        if length(palabra) > 2 then
            consulta_tsquery := consulta_tsquery || plainto_tsquery('spanish', palabra);
        end if;
    end loop;

    if consulta_tsquery = ''::tsquery then
        return;
    end if;

    return query
        select p.codigo, p.descripcion, p.ad_valorem,
               ts_rank(p.search_vector, consulta_tsquery) as rank
        from public.partidas_arancelarias p
        where p.search_vector @@ consulta_tsquery
        order by rank desc
        limit limite;
end;
$$;

comment on function public.buscar_partidas_candidatas is
    'Full-text search con semantica OR (no AND) sobre partidas_arancelarias -- '
    'ver services/arancel_service.py::buscar_subpartidas_candidatas.';


-- ---------------------------------------------------------------------
-- 13. cargos_especiales_arancel
-- ---------------------------------------------------------------------
-- Tasas de antidumping y derecho especifico por subpartida, cargadas a
-- mano por un ADMIN -- no existe una fuente oficial CSV/API consolidada
-- para estos cargos (son resoluciones puntuales de INDECOPI/MEF), a
-- diferencia del arancel general (partidas_arancelarias) que sale de un
-- documento oficial completo. Sirve como DEFAULT sugerido al calcular la
-- pre-liquidacion de un despacho; el especialista/liquidador puede
-- sobreescribirlo por despacho (ver preliquidaciones abajo).
create table public.cargos_especiales_arancel (
    id                       uuid primary key default gen_random_uuid(),
    subpartida               text not null unique references public.partidas_arancelarias(codigo),
    antidumping_monto        numeric not null default 0,
    derecho_especifico_monto numeric not null default 0,
    moneda                   text not null default 'USD',
    nota                     text,
    creado_por               uuid references public.perfiles_especialista(id),
    creado_en                timestamptz not null default now(),
    actualizado_en           timestamptz not null default now()
);

comment on table public.cargos_especiales_arancel is
    'Tasas de antidumping y derecho especifico por subpartida, cargadas a mano por '
    'un ADMIN (no hay fuente oficial CSV/API consolidada para estos cargos -- son '
    'resoluciones puntuales de INDECOPI/MEF). Sirve como DEFAULT sugerido al calcular '
    'la pre-liquidacion de un despacho; el especialista/liquidador puede sobreescribirlo '
    'por despacho (ver preliquidaciones). subpartida referencia partidas_arancelarias '
    'para evitar cargar tasas contra codigos inexistentes.';
comment on column public.cargos_especiales_arancel.nota is
    'Texto libre para que el ADMIN documente la fuente/resolucion, p.ej. '
    '"Res. INDECOPI 123-2024, vigente hasta ...".';

alter table public.cargos_especiales_arancel enable row level security;

-- Mismo patron que reglas_validacion: sin policies de insert/update/delete
-- para "authenticated", solo el backend (service_role, gateado por
-- _requiere_rol(usuario, set()) = solo ADMIN) escribe aqui.
create policy "auth_select_cargos_especiales_arancel" on public.cargos_especiales_arancel
    for select using ((select auth.role()) = 'authenticated');


-- ---------------------------------------------------------------------
-- 14. preliquidaciones
-- ---------------------------------------------------------------------
-- Snapshot editable del calculo de tributos de un despacho (Ad Valorem /
-- IGV / IPM / antidumping / derecho especifico), uno por despacho. Se
-- recalcula y sobreescribe (upsert por id_despacho) cada vez que el
-- especialista/liquidador presiona "Calcular" en la pestana
-- Pre-liquidacion -- ver services/preliquidacion_service.py y
-- app/main.py::calcular_preliquidacion.
create table public.preliquidaciones (
    id                       uuid primary key default gen_random_uuid(),
    id_despacho              uuid not null unique references public.despachos(id) on delete cascade,
    subpartida               text not null,
    valor_cif                numeric not null,
    moneda                   text not null default 'USD',
    ad_valorem_tasa          numeric not null,
    ad_valorem_monto         numeric not null,
    base_igv_ipm             numeric not null,
    igv_monto                numeric not null,
    ipm_monto                numeric not null,
    antidumping_monto        numeric not null default 0,
    derecho_especifico_monto numeric not null default 0,
    total_tributos           numeric not null,
    actualizado_por          uuid references public.perfiles_especialista(id),
    actualizado_en           timestamptz not null default now()
);

comment on table public.preliquidaciones is
    'Snapshot editable del calculo de tributos de un despacho (Ad Valorem/IGV/IPM/ '
    'antidumping/derecho especifico), uno por despacho (unique id_despacho). Se '
    'recalcula y sobreescribe (upsert) cada vez que el especialista/liquidador '
    'presiona "Calcular" en la pestana Pre-liquidacion. ad_valorem_tasa guarda el % '
    'usado en el momento del calculo (snapshot), por si partidas_arancelarias.ad_valorem '
    'cambia despues. No se aplica tipo de cambio: todos los montos quedan en la moneda '
    'de valor_cif (normalmente USD) -- limite aceptado, ver app/main.py.';

alter table public.preliquidaciones enable row level security;

create policy "auth_select_preliquidaciones" on public.preliquidaciones
    for select using ((select auth.role()) = 'authenticated');
