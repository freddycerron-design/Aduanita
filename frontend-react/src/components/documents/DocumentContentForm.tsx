import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Un campo escalar se edita como texto; una lista (los `items` de la
 * factura o del packing list) como filas de texto. Todo viaja como string:
 * el backend coacciona al tipo real al validar contra el schema Pydantic,
 * que es la unica definicion de que tipo tiene cada campo. */
type Fila = Record<string, string>;
type ValorEditable = string | Fila[];

export interface DocumentContentFormProps {
  /** El `contenido_json` tal como lo devolvio el backend. */
  contenido: Record<string, unknown>;
  /** Campos que el modelo marco como dudosos, para resaltarlos. */
  camposInciertos: string[];
  /** Columnas de cada campo de tipo lista, segun el schema del backend. */
  columnasPorLista: Record<string, string[]>;
  guardando: boolean;
  onCancelar: () => void;
  onGuardar: (contenido: Record<string, unknown>) => void;
}

function esFila(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esListaDeFilas(valor: unknown): valor is Record<string, unknown>[] {
  return Array.isArray(valor) && valor.every(esFila);
}

function esEscalar(valor: unknown): boolean {
  return valor === null || ["string", "number", "boolean"].includes(typeof valor);
}

function aTexto(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

/** `peso_bruto_kg` -> `Peso bruto kg`. Generico a proposito: sirve igual
 * para los 5 tipos de documento actuales y para cualquiera que se agregue
 * despues, sin mantener un diccionario de etiquetas en paralelo al
 * schema. */
function etiqueta(campo: string): string {
  const texto = campo.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function filaVacia(columnas: string[]): Fila {
  return Object.fromEntries(columnas.map((columna) => [columna, ""]));
}

/**
 * Formulario de correccion de los datos extraidos, derivado del propio
 * JSON en vez de escrito a mano por tipo de documento: un solo formulario
 * cubre Factura, BL, Seguro, SWIFT y Packing List, y cubriria un tipo
 * nuevo sin tocar este archivo.
 *
 * Los campos que no son ni escalares ni listas de filas (hoy ninguno de
 * los 5 schemas tiene uno) no se muestran, pero se conservan intactos al
 * guardar para no perder datos por una forma que este formulario no sepa
 * dibujar.
 */
export function DocumentContentForm({
  contenido,
  camposInciertos,
  columnasPorLista,
  guardando,
  onCancelar,
  onGuardar,
}: DocumentContentFormProps) {
  const [valores, setValores] = useState<Record<string, ValorEditable>>(() => {
    const iniciales: Record<string, ValorEditable> = {};
    for (const [campo, valor] of Object.entries(contenido)) {
      if (esListaDeFilas(valor)) {
        const columnas = columnasPorLista[campo] ?? Object.keys(valor[0] ?? {});
        iniciales[campo] = valor.map((fila) =>
          Object.fromEntries(columnas.map((columna) => [columna, aTexto(fila[columna])])),
        );
      } else if (esEscalar(valor)) {
        iniciales[campo] = aTexto(valor);
      }
    }
    return iniciales;
  });

  function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();

    // Un campo vacio significa "este dato no figura en el documento", que
    // es null -- la misma convencion que sigue la extraccion. Si el campo
    // era obligatorio, el backend lo rechaza con el nombre del campo.
    const limpiar = (fila: Fila) =>
      Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));

    const corregido: Record<string, unknown> = { ...contenido };
    for (const [campo, valor] of Object.entries(valores)) {
      corregido[campo] = Array.isArray(valor)
        ? valor.map(limpiar)
        : valor.trim() === ""
          ? null
          : valor.trim();
    }
    onGuardar(corregido);
  }

  const campos = Object.entries(valores);
  const escalares = campos.filter(([, valor]) => !Array.isArray(valor)) as [string, string][];
  const listas = campos.filter(([, valor]) => Array.isArray(valor)) as [string, Fila[]][];

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-3">
      <div className="flex max-h-[480px] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3">
          {escalares.map(([campo, valor]) => {
            const incierto = camposInciertos.includes(campo);
            return (
              <div key={campo} className="flex flex-col gap-1.5">
                <Label htmlFor={`campo-${campo}`} className="flex items-center gap-2">
                  {etiqueta(campo)}
                  {incierto && (
                    <span className="text-[11px] font-normal text-amber">
                      el modelo no estaba seguro
                    </span>
                  )}
                </Label>
                <Input
                  id={`campo-${campo}`}
                  value={valor}
                  onChange={(evento) =>
                    setValores((previos) => ({ ...previos, [campo]: evento.target.value }))
                  }
                  placeholder="Sin dato en el documento"
                  className={cn(incierto && "border-amber/60")}
                />
              </div>
            );
          })}
        </div>

        {listas.map(([campo, filas]) => {
          const columnas = columnasPorLista[campo] ?? Object.keys(filas[0] ?? {});
          const incierto = camposInciertos.includes(campo);

          function actualizarFilas(siguientes: Fila[]) {
            setValores((previos) => ({ ...previos, [campo]: siguientes }));
          }

          return (
            <div key={campo} className="flex flex-col gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2">
                  {etiqueta(campo)}
                  {incierto && (
                    <span className="text-[11px] font-normal text-amber">
                      el modelo no estaba seguro
                    </span>
                  )}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => actualizarFilas([...filas, filaVacia(columnas)])}
                  disabled={columnas.length === 0}
                >
                  <Plus className="size-4" />
                  Agregar
                </Button>
              </div>

              {filas.length === 0 ? (
                <p className="text-[13px] text-texto-secundario">
                  El documento no detalla líneas. Puedes agregarlas a mano.
                </p>
              ) : (
                filas.map((fila, indice) => (
                  <div
                    key={indice}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-texto-secundario">
                        Línea {indice + 1}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => actualizarFilas(filas.filter((_, i) => i !== indice))}
                        aria-label={`Quitar línea ${indice + 1}`}
                        title="Quitar línea"
                        className="text-rojo hover:bg-rojo/10 hover:text-rojo"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {columnas.map((columna) => (
                      <div key={columna} className="flex flex-col gap-1.5">
                        <Label htmlFor={`campo-${campo}-${indice}-${columna}`}>
                          {etiqueta(columna)}
                        </Label>
                        <Input
                          id={`campo-${campo}-${indice}-${columna}`}
                          value={fila[columna] ?? ""}
                          onChange={(evento) =>
                            actualizarFilas(
                              filas.map((f, i) =>
                                i === indice ? { ...f, [columna]: evento.target.value } : f,
                              ),
                            )
                          }
                          placeholder="Sin dato en el documento"
                        />
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
