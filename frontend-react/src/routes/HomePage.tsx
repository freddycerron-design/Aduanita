import type { LucideIcon } from "lucide-react";
import {
  FileCheck2,
  FileSignature,
  PackageCheck,
  Receipt,
  Route,
  ShoppingCart,
  Tags,
} from "lucide-react";
import { Link } from "react-router-dom";

import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map((modulo) => (
            <TarjetaModulo key={modulo.titulo} modulo={modulo} />
          ))}
        </div>
      </div>
    </div>
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
