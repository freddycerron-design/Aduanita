import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
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
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Modulo {
  titulo: string;
  /** Nombre comercial corto del módulo (ej. "Docfy"), si tiene uno. */
  nombreComercial: string | null;
  icono: LucideIcon;
  descripcion: string;
  /** Si es `false`, la tarjeta se muestra atenuada y sin acción --
   * módulo todavía no construido. */
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

/**
 * Home: primera pantalla al entrar a la app. Lanzador de módulos -- una
 * tarjeta grande por cada módulo planeado del producto. Solo Docfy/Clasify
 * están activos hoy (navegan al flujo de despachos existente); el resto
 * se muestra atenuado con la etiqueta "Próximamente".
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map((modulo) => (
            <TarjetaModulo key={modulo.titulo} modulo={modulo} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Números del equipo arriba de los módulos. Cada tarjeta navega al
 * Validador (pestaña Explorador) cuando tiene sentido mirar esos despachos. */
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
        color="text-indigo"
        fondo="bg-indigo/30"
      />
      <TarjetaMetrica
        icono={Tags}
        etiqueta="Esperando decisión"
        valor={metricas.en_clasificacion}
        color="text-amber"
        fondo="bg-amber/15"
      />
      <TarjetaMetrica
        icono={CheckCircle2}
        etiqueta="Finalizados"
        valor={metricas.finalizados}
        color="text-verde"
        fondo="bg-verde/15"
      />
      <TarjetaMetrica
        icono={AlertTriangle}
        etiqueta="Hallazgos críticos"
        valor={metricas.hallazgos_altos_abiertos}
        color="text-rojo"
        fondo="bg-rojo/15"
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
}: {
  icono: LucideIcon;
  etiqueta: string;
  valor: number;
  color: string;
  fondo: string;
}) {
  return (
    <Link
      to="/despachos"
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-coral/40 hover:bg-surface-border/30"
    >
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", fondo, color)}>
        <Icono className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xl font-semibold tabular-nums text-texto">{valor}</span>
        <span className="truncate text-xs text-texto-secundario">{etiqueta}</span>
      </div>
    </Link>
  );
}

function TarjetaModulo({ modulo }: { modulo: Modulo }) {
  const Icono = modulo.icono;

  const contenido = (
    <>
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-xl",
          modulo.activo ? "bg-coral/15 text-coral" : "bg-surface-border text-texto-secundario",
        )}
      >
        <Icono className="size-5" />
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-texto">{modulo.titulo}</h2>
          {modulo.nombreComercial && (
            <span className="font-mono text-xs text-texto-secundario">({modulo.nombreComercial})</span>
          )}
          {!modulo.activo && <Badge variant="neutral">Próximamente</Badge>}
        </div>
        <p className="text-xs leading-relaxed text-texto-secundario">{modulo.descripcion}</p>
      </div>
    </>
  );

  const clasesTarjeta = cn(
    "flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors",
    modulo.activo ? "hover:border-coral/40 hover:bg-surface-border/30" : "cursor-not-allowed opacity-60",
  );

  if (modulo.activo && modulo.ruta) {
    return (
      <Link to={modulo.ruta} className={clasesTarjeta}>
        {contenido}
      </Link>
    );
  }

  return (
    <div className={clasesTarjeta} aria-disabled="true">
      {contenido}
    </div>
  );
}
