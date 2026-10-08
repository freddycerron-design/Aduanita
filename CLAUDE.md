# CLAUDE.md

Este archivo guía a Claude Code (claude.ai/code) al trabajar con código en este repositorio.

## Qué es el proyecto

**Aduafy** (antes "AduANITA") es una herramienta para agencias de aduana en Perú: automatiza la revisión
documental y la clasificación arancelaria (subpartida arancelaria) de despachos de importación. Backend:
FastAPI (Python). Frontend principal: React + Vite SPA (`frontend-react/`). Datos: Supabase (Postgres +
pgvector, Auth, Storage). IA: Google Gemini (extracción estructurada de documentos, OCR por visión,
embeddings, clasificación asistida por RAG).

Todavía existe un dashboard de Streamlit heredado (`frontend/dashboard.py`) y sigue desplegado
(`aduanita-frontend` en `render.yaml`), pero está en retiro — **`frontend-react/` es el frontend sobre el
que hay que trabajar**; no agregar funcionalidad nueva a la app de Streamlit.

## Comandos

### Backend (FastAPI)

```bash
# instalar dependencias (raíz del repo)
pip install -r requirements.txt

# correr el servidor de desarrollo (lee .env via pydantic-settings)
uvicorn app.main:app --reload

# chequeo de sintaxis/imports de un solo archivo (no hay linter configurado para Python)
python -m py_compile app/main.py
```

**No hay suite de tests automatizada** (no hay carpeta `tests/`, no hay configuración de pytest). Los
cambios de backend se verifican escribiendo un script descartable que llama a la app FastAPI via
`TestClient` contra el proyecto **real** de Supabase y la API **real** de Gemini (nunca mockeado), usando
cuentas/filas descartables `@*-test.local` creadas y borradas en un `try/finally`, y después borrando el
script. Este es el método de verificación ya establecido en este código — ver el mensaje de cualquier
commit reciente para el patrón. Nunca tocar los datos de producción ni la cuenta real del usuario
mientras se hace esto. La clave de Gemini está en el **plan gratuito, con un tope de 20 solicitudes/día
por modelo** — evitar gastarla en re-corridas triviales; preferir sembrar filas directamente via el
cliente admin de Supabase antes que volver a correr una extracción/clasificación real cuando solo se está
probando lógica no relacionada (por ejemplo, un endpoint que lee datos ya procesados).

### Frontend (`frontend-react/`)

```bash
cd frontend-react
npm ci            # o npm install
npm run dev       # servidor de desarrollo de Vite
npm run build     # tsc -b && vite build -- ESTE es el chequeo real, no `tsc --noEmit`
npm run lint      # oxlint
```

`npm run build` ha encontrado errores de tipos reales que `tsc --noEmit` solo no detectó (es un chequeo
de project-references distinto y más estricto). Siempre correr el `build` real antes de dar por
verificado un cambio de frontend, no alcanza con un chequeo de tipos nada más.

Tampoco hay un test runner de frontend configurado; los cambios de UI se verifican compileando y, donde
importa, razonando el árbol de componentes a mano (no hay Playwright/Vitest en este repo).

### Base de datos

El esquema vive en `database/schema.sql` (mantenido a mano, se aplica via migraciones de Supabase — no
hay una instalación local de Postgres/Supabase CLI en este repo). Cuando cambies el esquema, aplicá la
migración con las herramientas de Supabase disponibles en tu sesión y después **actualizá
`database/schema.sql` para que coincida** — siempre debe reflejar exactamente lo que está en producción,
incluidos los comentarios que explican el *por qué*, no solo el DDL plano. Las secciones nuevas se
agregan al final, numeradas siguiendo la convención existente `-- N. <nombre>`.

### Scripts de una sola vez

`scripts/importar_arancel.py` reparsea el PDF del Arancel Nacional 2022 de SUNAT hacia
`partidas_arancelarias` (upsert por `codigo`, seguro de re-correr). `pdfs_prueba/` tiene PDFs de ejemplo
de Factura/BL/Seguro usados por scripts de verificación manuales y ad-hoc.

## Arquitectura

### Backend: un solo módulo FastAPI, services delgados

`app/main.py` (~2000 líneas) es una **app FastAPI de un solo archivo** — todas las rutas, los modelos
Pydantic de request/response, y la máquina de estados del despacho viven ahí; no hay una separación de
router por recurso. La lógica de negocio que no necesita saber de HTTP vive en `services/*.py`, un
módulo por responsabilidad:

- `pdf_processor.py` — detecta el tipo de archivo por firma binaria (PDF/JPEG/PNG/WEBP/HEIC, nunca por
  la extensión del nombre ni el Content-Type declarado), extrae texto via PyMuPDF o cae a Gemini Vision,
  y le pide a Gemini un JSON estructurado por cada tipo de documento
  (FACTURA/SEGURO/SWIFT_BANCARIO/BL/PACKING_LIST). La maquinaria de score de confianza
  (`derivar_nivel_confianza`, los umbrales) también vive acá, y la importa `gemini_classifier.py` para
  que las dos señales de confianza que ve el especialista usen los mismos cortes.
- `validation_engine.py` — motor genérico de validación cruzada entre documentos, manejado por la tabla
  `reglas_validacion` (editable por un admin), no por funciones de comparación hardcodeadas.
- `gemini_classifier.py` — propone la subpartida nacional de 10 dígitos, usando los antecedentes de
  `rag_service` y las candidatas de `arancel_service` como contexto.
- `rag_service.py` — embebe decisiones de clasificación humanas pasadas (embeddings de Gemini, 768
  dimensiones, truncados desde las 3072 nativas del modelo) y recupera antecedentes similares via el RPC
  de Postgres `match_antecedentes_aduaneros`, ponderado por `peso_prioridad` (una corrección humana pesa
  más que una aprobación pasiva).
- `arancel_service.py` — búsqueda full-text sobre el Arancel Nacional oficial (`partidas_arancelarias`,
  ~8000 filas cargadas por `scripts/importar_arancel.py`) via el RPC `buscar_partidas_candidatas`.
- `preliquidacion_service.py` — cálculo de tributos Ad Valorem/IGV/IPM/antidumping/derecho-específico
  (fórmulas SUNAT), un snapshot que el especialista puede recalcular.
- `email_draft_service.py` — genera el borrador de comunicación con **plantillas f-string
  determinísticas, no un LLM** (así nunca alucina una cifra o discrepancia que no es real).
- `clasificador_ia_service.py` — chat "Clasificador con IA" (pestaña de Clasificador): conversación sin
  estado (el frontend manda el historial completo + adjuntos cada turno), system prompt editable en
  `parametros_sistema` (predeterminado en el código), y en cada turno se le pasan al modelo subpartidas
  REALES del arancel (por texto y por prefijo de las partidas que pidió explorar) para que no invente
  códigos. Al clasificar valida el código y lee los tributos vigentes de SUNAT.
- `sunat_arancel_service.py` — consulta en vivo del portal de aranceles de SUNAT (gravámenes, ubicación en
  la nomenclatura, anexos). La preliquidación usa estos gravámenes (ad valorem, ISC, IGV, IPM) en vez de
  tasas fijas.
- `tipo_cambio_service.py` — tipo de cambio venta SUNAT del día (`tipoCambio.txt`), guardado por fecha en
  `tipos_cambio`; la preliquidación lo usa para mostrar los montos en soles.
- `export_service.py` — detalle del despacho → `.xlsx`, reusando el mismo armado `_armar_detalle_despacho`
  que `app/main.py` usa para la respuesta JSON.

`app/config.py` es el único lugar que lee `.env`; expone factories cacheadas
(`get_supabase_admin_client`, `get_supabase_user_client`, `get_genai_client`) que tanto `app/main.py`
como cada módulo de `services/*.py` importan desde ahí. Los nombres de los modelos de Gemini también
están ahí, como variables de entorno con valor por defecto en `Settings` (`GEMINI_MODEL_TEXTO_Y_VISION`,
`GEMINI_MODELS_RESPALDO`, `GEMINI_MODEL_EMBEDDINGS`) — verificar contra la API real antes de cambiarlos,
Google ya retiró antes nombres de modelo de los que este proyecto dependía. Toda llamada de texto/visión
pasa por `generar_contenido_gemini`, que reintenta con los modelos de respaldo ante 404/429/5xx; los
embeddings no tienen respaldo a propósito (otro modelo da vectores incompatibles con los guardados).

### Máquina de estados del despacho

Tres estados, dos roles internos manejan las transiciones:

```
REVISION_DOC -> CLASIFICACION -> FINALIZADO
```

1. `POST /despachos` lo crea (`REVISION_DOC`), opcionalmente con `id_cliente` (importador registrado) e
   `id_gestor` (miembro del equipo asignado, por defecto quien lo crea; independiente de `creado_por`,
   que es pura auditoría de autoría y nunca es editable por el usuario).
2. `POST /despachos/{id}/documentos` sube un archivo por tipo de documento — rápido, no llama a Gemini.
3. `POST /despachos/{id}/procesar-informacion` ("Extracción y validación" en la UI) es el único lugar
   que llama a Gemini para extraer: extrae los documentos pendientes, corre la validación cruzada,
   clasifica, y genera el borrador de comunicación, todo en una sola llamada. **No** cambia el estado del
   despacho y se puede re-correr tantas veces como haga falta.
4. `POST /despachos/{id}/enviar-a-clasificacion` es la **única** acción que mueve
   `REVISION_DOC -> CLASIFICACION`; exige que FACTURA+BL ya estén procesados.
5. `POST /despachos/{id}/decision` (solo LIQUIDADOR) acepta u observa la propuesta, alimenta la tabla de
   historial del RAG, y mueve el despacho a `FINALIZADO` en los dos casos (cuál de los dos pasó queda
   registrado en `historial_clasificaciones.tipo_accion`, no en el `estado` propio del despacho).

Los endpoints granulares (`/validar`, `/clasificar`, `/generar-borrador`) siguen disponibles sueltos
para depurar via `/docs`, pero nunca mueven el estado del despacho por sí solos.

### Auth y roles

Todo se autentica via un JWT de Supabase Auth en `Authorization: Bearer <token>`, validado en
`get_current_user`, que busca la fila del que llama en `perfiles_especialista` para su `rol`. **No hay
un rol por defecto** si falta esa fila — `get_current_user` lanza 403 en vez de asumir un rol en
silencio (esto corrigió a propósito un hueco de escalada de privilegios: una cuenta huérfana nunca debe
caer de vuelta a un rol interno).

Cuatro roles: tres internos (`GESTOR` sube/procesa documentos, `LIQUIDADOR` acepta/observa la
clasificación, `ADMIN` puede hacer cualquier cosa además de administrar los CRUD) y uno externo
(`CLIENTE`, la cuenta de portal del propio importador, vinculada via `perfiles_especialista.id_cliente`).

Hay dos dependencias más específicas, encima de `get_current_user`:

- `get_current_staff` — rechaza cuentas `CLIENTE`. Todo endpoint interno usa esta, no
  `get_current_user` directamente, **porque el backend habla con Postgres con la clave service_role**
  (bypassa RLS) — el chequeo de rol tiene que pasar en la capa de API, RLS sola no protege estas rutas.
- `get_current_cliente` — rechaza cualquier cosa que no sea un `CLIENTE` con un `id_cliente` vinculado.
  Los endpoints del portal (`/portal/*`) filtran estrictamente por el `usuario.id_cliente`
  **verificado** del perfil derivado del JWT, nunca por un parámetro de la request.

`_requiere_rol(usuario, {"ROL", ...})` acota una acción puntual a un conjunto de roles; `ADMIN` siempre
lo bypassa sin importar qué conjunto se le pase.

Como el backend usa service_role, el RLS en `database/schema.sql` es una **segunda barrera,
independiente** (no la única) — relevante sobre todo para el portal del cliente, donde el JWT de una
cuenta CLIENTE podría leer Postgres/Storage directamente via PostgREST, saltándose la API. Las políticas
de RLS ahí usan helpers `SECURITY DEFINER` (`es_personal_interno()`, `cliente_actual()`) para evitar
auto-recursión cuando una política sobre `perfiles_especialista` necesita leer esa misma tabla.

### Modelo de datos (`database/schema.sql`)

Secciones numeradas, en orden de dependencia — leer los comentarios de cada sección, explican la
intención, no solo las columnas. Mapa corto:

- `perfiles_especialista` — espejo 1:1 de `auth.users`, creado por un trigger al registrarse.
- `despachos` — la entidad central; `cliente` (texto libre, siempre presente) vs. `id_cliente` (FK a un
  importador registrado, opcional — vincularlo es lo único que habilita el portal del cliente para ese
  despacho).
- `documentos_extraidos` — una fila por tipo de documento por despacho; `contenido_json` validado contra
  el schema Pydantic correspondiente en `pdf_processor.py`; `confianza_extraccion` + `campos_inciertos`
  registran la confianza que reporta el propio modelo; `editado_por`/`editado_en` registran una
  corrección manual (volver a subir el archivo borra todo eso — es un documento distinto ahora).
- `resultados_validacion`, `historial_clasificaciones` (el feedback loop del RAG, embeddings +
  `peso_prioridad`), `borradores_correo` (el borrador de comunicación; `canal_envio` es solo un registro
  de intención — no hay integración real de envío por correo/WhatsApp).
- `reglas_validacion` — las reglas del motor de validación genérico, editables por un admin.
- `partidas_arancelarias` + el RPC `buscar_partidas_candidatas` — el Arancel Nacional oficial.
- `cargos_especiales_arancel`, `preliquidaciones` — insumos/snapshots del cálculo de tributos.
- `clientes` — la tabla de mantenimiento de importadores. **Internamente sigue llamándose/modelada como
  "cliente"** aunque la UI diga "Importador" en todas partes (renombrar la tabla/FKs/funciones de RLS
  se juzgó que no valía el radio de impacto solo por un cambio de etiqueta).

### Frontend (`frontend-react/`)

React 19 + Vite + TypeScript, Tailwind v4, TanStack Query para todo el estado de servidor, Zustand solo
para la sesión de auth (`useAuthStore`), React Router 7, React Hook Form + Zod para formularios,
primitivos de Radix UI envueltos bajo `src/components/ui/` (diseño propio, no los archivos generados de
shadcn — extender un wrapper existente ahí en vez de instalar uno nuevo). Alias de path `@/` → `src/`.

- `src/lib/api.ts` — el **único** lugar que llama al backend (`apiFetch`, lee el token de sesión de
  Supabase fresco en cada llamada). Cada endpoint tiene su función tipada acá.
- `src/lib/queryKeys.ts` — factory centralizada de query keys de TanStack Query.
  `queryKeys.despachos.list()` sin argumentos devuelve a propósito el prefijo corto `["despachos"]`, que
  — via el matching por prefijo de TanStack — también invalida `detail(id)` y cualquier entrada paginada
  `list(params)`; varias mutaciones dependen de esto para refrescar el despacho abierto sin tener su id a
  mano. No "arreglar" esto a una key de match exacto sin revisar a todos los que la llaman.
- `src/lib/types.ts` — tipos escritos a mano que reflejan los modelos de respuesta Pydantic del backend
  (no hay cliente generado).
- `src/routes/DashboardLayout.tsx` + `src/components/layout/IconRail.tsx` — el shell del equipo interno
  (barra de iconos + panel Cuenta colapsable). `src/routes/PortalPage.tsx` es una superficie **aparte,
  independiente** para cuentas CLIENTE con su propio layout — nunca compartir chrome entre las dos; a
  cuál de las dos cae un usuario lo impone `src/components/auth/RequireSurface.tsx` (solo comodidad del
  lado del cliente, el límite real son las capas de backend/RLS de arriba).
- `src/routes/DespachoPage.tsx` — shell de un despacho, una tira de `Tabs` (Explorador / Revisión / Pre
  Clasificación / Pre liquidación / Comunicaciones) respaldada por `src/routes/tabs/*.tsx`. Maneja tanto
  `/despachos` (sin id — solo la pestaña Explorador está habilitada) como `/despachos/:id` con el mismo
  componente.
- Las tablas con filtro/orden por columna en el header (ver `ExploradorTab.tsx`) usan
  `components/ui/column-filter.tsx` (popover de checkboxes estilo Excel, aplica al Aceptar, no en vivo) y
  `components/ui/column-sort.tsx` — reusar estos para cualquier grilla filtrable futura en vez de
  reconstruir el patrón.

### Patrones de uso de Gemini que conviene conocer antes de tocar extracción/clasificación

- La salida estructurada siempre pasa por `response_json_schema` (un JSON Schema ya serializado), no el
  `response_schema` más viejo (una clase Pydantic directa) — verificado contra la API real como el
  parámetro soportado actualmente; `response.parsed` no se usa, el JSON se parsea a mano desde
  `response.text`.
- La extracción envuelve el schema propio del documento en un envoltorio armado dinámicamente
  (`{datos, score_confianza, campos_inciertos}`, construido una sola vez por schema via `create_model` +
  `lru_cache`) para que el modelo reporte su propia confianza en vez de que se adivine del lado del
  cliente.
- Siempre se le pide al modelo un `score_confianza` numérico; la etiqueta categórica (ALTA/MEDIA/BAJA)
  se **deriva en Python** (`derivar_nivel_confianza`), nunca se le pide directamente al modelo — pedirle
  las dos cosas arriesga que se contradigan entre sí.
- La clave de Gemini del plan gratuito tiene un tope de **20 solicitudes/día por modelo** — esto ya
  bloqueó una verificación a mitad de sesión antes. Presupuestar con cuidado las llamadas reales a
  Gemini al probar.

### Despliegue

`render.yaml` define tres servicios de Render desde este mismo repo: `aduanita-backend` (FastAPI),
`aduanita-frontend` (la app de Streamlit en retiro), `aduanita-frontend-react` (static site, la que
importa). Las variables de entorno del frontend React (`VITE_*`) quedan **incrustadas en build time** —
cambiar una en el dashboard de Render exige un redeploy, no alcanza con un restart. `CORS_ORIGIN` en el
backend hoy lista los dos orígenes de frontend; achicarlo a solo el origen de React cuando Streamlit se
retire de verdad.
