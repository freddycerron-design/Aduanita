import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileSignature,
  FileStack,
  PackageCheck,
  Receipt,
  Route,
  ShoppingCart,
  Tags,
} from "lucide-react";
import { Link } from "react-router-dom";

import { useMetricas } from "@/hooks/useMetricas";
import { useProfile } from "@/hooks/useProfile";
import type { EstadoDespacho } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface Modulo {
  titulo: string;
  /** Nombre comercial corto del módulo (ej. "Docfy"), si tiene uno. */
  nombreComercial: string | null;
  icono: LucideIcon;
  descripcion: string;
  /** Si es `false`, el módulo va en la lista "En camino" (sin acción) --
   * todavía no está construido. */
  activo: boolean;
  ruta?: string;
}

/**
 * Mapa de ruta del producto. Solo "Validador Documental" (Docfy) y
 * "Clasificador" (Clasify) están construidos hoy -- ambos navegan al
 * mismo flujo de despachos (Revisión + Clasificación + Pre-liquidación +
 * Correo, ver DespachoPage.tsx). El resto son módulos planeados,
 * mostrados para dar contexto del roadmap pero sin acción todavía.
 */
const MODULOS: Modulo[] = [
  {
    titulo: "Validador Documental",
    nombreComercial: "Docfy",
    icono: FileCheck2,
    descripcion: "Carga, valida y compara los documentos de un despacho.",
    activo: true,
    ruta: "/despachos",
  },
  {
    titulo: "Clasificador",
    nombreComercial: "Clasify",
    icono: Tags,
    descripcion: "Propuesta de subpartida arancelaria asistida por IA.",
    activo: true,
    ruta: "/despachos",
  },
  {
    titulo: "Tracking",
    nombreComercial: null,
    icono: Route,
    descripcion: "Seguimiento en tiempo real de tus embarques y contenedores.",
    activo: false,
  },
  {
    titulo: "Compra Internacional",
    nombreComercial: null,
    icono: ShoppingCart,
    descripcion: "Gestiona órdenes de compra y proveedores en el exterior.",
    activo: false,
  },
  {
    titulo: "Proforma",
    nombreComercial: "Profy",
    icono: FileSignature,
    descripcion: "Genera y comparte cotizaciones proforma con tus clientes.",
    activo: false,
  },
  {
    titulo: "Levante-Retiro",
    nombreComercial: "Deliverify",
    icono: PackageCheck,
    descripcion: "Coordina el levante y retiro de la mercancía.",
    activo: false,
  },
  {
    titulo: "Facturación",
    nombreComercial: "Factufy",
    icono: Receipt,
    descripcion: "Emite y controla la facturación de tus servicios.",
    activo: false,
  },
];

const MODULOS_ACTIVOS = MODULOS.filter((m) => m.activo);
const MODULOS_EN_CAMINO = MODULOS.filter((m) => !m.activo);

/** Link al Explorador ya filtrado por estado. El formato (`?estado=A,B`,
 * valores separados por comas en un solo param) lo lee `ExploradorTab`. */
function rutaExplorador(estados: EstadoDespacho[]): string {
  return `/despachos?estado=${estados.join(",")}`;
}

/**
 * Home: primera pantalla al entrar a la app. Arriba las métricas del
 * equipo; después los módulos activos hoy (Docfy/Clasify) como tarjetas
 * grandes, que es a donde el usuario va casi siempre; y al final el
 * roadmap ("En camino") como lista compacta y tranquila. Antes los 7
 * módulos iban mezclados en la misma grilla, con los inactivos atenuados
 * y un badge "Próximamente" en cada uno, y los dos que sí funcionan se
 * perdían entre ellos.
 */
export function HomePage() {
  const { data: perfil } = useProfile();

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div>
          <h1 className="text-xl font-semibold text-texto">
            Bienvenido{perfil?.nombre_completo ? `, ${perfil.nombre_completo}` : ""}
          </h1>
          <p className="mt-1 text-sm text-texto-secundario">Elige un módulo para comenzar.</p>
        </div>

        <FranjaMetricas />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {MODULOS_ACTIVOS.map((modulo) => (
            <TarjetaModuloActivo key={modulo.titulo} modulo={modulo} />
          ))}
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-texto-secundario">En camino</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {MODULOS_EN_CAMINO.map((modulo) => (
              <FilaModuloEnCamino key={modulo.titulo} modulo={modulo} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Números del equipo arriba de los módulos. Cada tarjeta abre el
 * Explorador ya filtrado por los estados que cuenta. */
function FranjaMetricas() {
  const { data: metricas, isLoading, isError } = useMetricas();

  if (isError) return null; // las métricas son secundarias: si fallan, el Home igual sirve

  if (isLoading || !metricas) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <TarjetaMetrica
        icono={FileStack}
        etiqueta="En revisión"
        valor={metricas.en_revision}
        color="text-indigo-texto"
        fondo="bg-indigo/30"
        ruta={rutaExplorador(["REVISION_DOC"])}
      />
      <TarjetaMetrica
        icono={Tags}
        etiqueta="Esperando decisión"
        valor={metricas.en_clasificacion}
        color="text-amber"
        fondo="bg-amber/15"
        ruta={rutaExplorador(["CLASIFICACION"])}
      />
      <TarjetaMetrica
        icono={CheckCircle2}
        etiqueta="Finalizados"
        valor={metricas.finalizados}
        color="text-verde"
        fondo="bg-verde/15"
        ruta={rutaExplorador(["FINALIZADO"])}
      />
      {/* El Explorador no tiene un filtro "con hallazgos ALTA abiertos": lo
          más cercano es mostrar los despachos todavía abiertos (no
          finalizados), que es donde viven esos hallazgos. */}
      <TarjetaMetrica
        icono={AlertTriangle}
        etiqueta="Hallazgos críticos"
        valor={metricas.hallazgos_altos_abiertos}
        color="text-rojo"
        fondo="bg-rojo/15"
        ruta={rutaExplorador(["REVISION_DOC", "CLASIFICACION"])}
      />
    </div>
  );
}

function TarjetaMetrica({
  icono: Icono,
  etiqueta,
  valor,
  color,
  fondo,
  ruta,
}: {
  icono: LucideIcon;
  etiqueta: string;
  valor: number;
  color: string;
  fondo: string;
  ruta: string;
}) {
  return (
    <Link
      to={ruta}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-coral/40 hover:bg-surface-border/30"
    >
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", fondo, color)}>
        <Icono className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xl font-semibold tabular-nums text-texto">{valor}</span>
        <span className="truncate text-[13px] text-texto-secundario">{etiqueta}</span>
      </div>
    </Link>
  );
}

/** Tarjeta grande de un módulo ya construido -- toda la tarjeta es el link. */
function TarjetaModuloActivo({ modulo }: { modulo: Modulo }) {
  const Icono = modulo.icono;

  return (
    <Link
      to={modulo.ruta ?? "/"}
      className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:border-coral/40 hover:bg-surface-border/30"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-coral/15 text-coral">
        <Icono className="size-6" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-base font-semibold text-texto">{modulo.titulo}</h2>
          {modulo.nombreComercial && <span className="text-sm text-texto-secundario">{modulo.nombreComercial}</span>}
        </div>
        <p className="text-sm leading-relaxed text-texto-secundario">{modulo.descripcion}</p>
      </div>
      <ArrowRight className="mt-1 size-4 shrink-0 text-texto-secundario transition-transform group-hover:translate-x-0.5 group-hover:text-coral" />
    </Link>
  );
}

/** Fila compacta del roadmap: sin acción ni badge propio -- el título de
 * la sección ("En camino") ya dice que todavía no están disponibles. */
function FilaModuloEnCamino({ modulo }: { modulo: Modulo }) {
  const Icono = modulo.icono;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-border/60 text-texto-secundario">
        <Icono className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <span className="shrink-0 text-sm font-medium text-texto">
          {modulo.titulo}
          {modulo.nombreComercial && (
            <span className="ml-2 font-normal text-texto-secundario">{modulo.nombreComercial}</span>
          )}
        </span>
        <span className="min-w-0 truncate text-[13px] text-texto-secundario">{modulo.descripcion}</span>
      </div>
    </li>
  );
}
