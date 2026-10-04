import { useState } from "react";
import type { FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CampoEstructura, EstructuraDocumento } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  /** Etiquetas, tipos y orden de los campos (ver `estructura` en el backend). */
  estructura: EstructuraDocumento;
  /** true = mismo layout de documento, sin inputs ni botones. */
  soloLectura?: boolean;
  guardando?: boolean;
  onCancelar?: () => void;
  onGuardar?: (contenido: Record<string, unknown>) => void;
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

/** Fallback para un campo que el schema del backend no describe (no
 * deberia pasar): `peso_bruto_kg` -> `Peso bruto kg`. */
function humanizar(campo: string): string {
  const texto = campo.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function filaVacia(columnas: string[]): Fila {
  return Object.fromEntries(columnas.map((columna) => [columna, ""]));
}

function esNumerico(info: CampoEstructura | undefined): boolean {
  return info?.tipo_dato === "Número" || info?.tipo_dato === "Entero";
}

/** Textos que en papel ocupan un renglón entero (descripciones, marcas,
 * coberturas): en una celda de 1/3 de ancho quedarían cortados. Se decide
 * por nombre y, para cualquier otro campo, por el largo real del valor. */
function esTextoLargo(campo: string, valor: string): boolean {
  return /descripcion|marcas|cobertura|direccion/.test(campo) || valor.length > 60;
}

/** Interpreta un número tal como lo escribe el modelo o una persona
 * ("1,250.50", "1250.5"). null si no es un número. */
function aNumero(texto: string): number | null {
  if (texto.trim() === "") return null;
  const numero = Number(texto.replace(/,/g, ""));
  return Number.isFinite(numero) ? numero : null;
}

const formatoMonto = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function valoresDesdeContenido(
  contenido: Record<string, unknown>,
  columnasPorLista: Record<string, string[]>,
): Record<string, ValorEditable> {
  const valores: Record<string, ValorEditable> = {};
  for (const [campo, valor] of Object.entries(contenido)) {
    if (esListaDeFilas(valor)) {
      const columnas = columnasPorLista[campo] ?? Object.keys(valor[0] ?? {});
      valores[campo] = valor.map((fila) =>
        Object.fromEntries(columnas.map((columna) => [columna, aTexto(fila[columna])])),
      );
    } else if (esEscalar(valor)) {
      valores[campo] = aTexto(valor);
    }
  }
  return valores;
}

function AvisoIncierto() {
  return <span className="text-xs font-normal text-amber">dudoso</span>;
}

/**
 * Datos extraídos de un documento, dibujados como se ven en papel: la
 * cabecera en una grilla de hasta 3 columnas (se adapta al ancho real del
 * panel via container queries, porque el visor puede mostrar 2 documentos
 * lado a lado) y el detalle (`items`) como la tabla de líneas de una
 * factura. El mismo layout sirve para leer (`soloLectura`) y para
 * corregir, así quien revisa no cambia de mapa mental al pasar a editar.
 *
 * Sigue siendo genérico: campos, etiquetas, tipos y orden salen de la
 * `estructura` que manda el backend, así que cubre los 5 tipos actuales y
 * cualquiera nuevo sin tocar este archivo. Los campos que no son ni
 * escalares ni listas de filas no se muestran, pero se conservan intactos
 * al guardar.
 */
export function DocumentContentForm({
  contenido,
  camposInciertos,
  columnasPorLista,
  estructura,
  soloLectura = false,
  guardando = false,
  onCancelar,
  onGuardar,
}: DocumentContentFormProps) {
  const [editados, setEditados] = useState<Record<string, ValorEditable>>(() =>
    valoresDesdeContenido(contenido, columnasPorLista),
  );
  // En lectura se deriva en cada render: si el documento se reprocesa o se
  // guarda una corrección, lo que se ve es siempre el contenido vigente.
  const valores = soloLectura ? valoresDesdeContenido(contenido, columnasPorLista) : editados;

  const infoCabecera = new Map(estructura.cabecera.map((c) => [c.campo, c]));
  const infoDetalle = new Map(estructura.detalle.map((d) => [d.campo, d]));

  // Orden del schema primero (es el orden en que se leen en papel) y
  // después cualquier campo que no figure en él.
  const ordenados = [
    ...estructura.cabecera.map((c) => c.campo).filter((campo) => campo in valores),
    ...Object.keys(valores).filter((campo) => !infoCabecera.has(campo) && !infoDetalle.has(campo)),
  ];
  const escalares = ordenados.filter((campo) => !Array.isArray(valores[campo]));
  const cortos = escalares.filter((campo) => !esTextoLargo(campo, valores[campo] as string));
  const largos = escalares.filter((campo) => esTextoLargo(campo, valores[campo] as string));
  const listas = Object.keys(valores).filter((campo) => Array.isArray(valores[campo]));

  function cambiarEscalar(campo: string, valor: string) {
    setEditados((previos) => ({ ...previos, [campo]: valor }));
  }

  function cambiarFilas(campo: string, filas: Fila[]) {
    setEditados((previos) => ({ ...previos, [campo]: filas }));
  }

  function alEnviar(evento: FormEvent) {
    evento.preventDefault();

    // Un campo vacio significa "este dato no figura en el documento", que
    // es null -- la misma convencion que sigue la extraccion. Si el campo
    // era obligatorio, el backend lo rechaza con el nombre del campo.
    const limpiar = (fila: Fila) =>
      Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));

    const corregido: Record<string, unknown> = { ...contenido };
    for (const [campo, valor] of Object.entries(editados)) {
      corregido[campo] = Array.isArray(valor)
        ? valor.map(limpiar)
        : valor.trim() === ""
          ? null
          : valor.trim();
    }
    onGuardar?.(corregido);
  }

  function renderCampo(campo: string, largo: boolean) {
    const info = infoCabecera.get(campo);
    const valor = valores[campo] as string;
    const incierto = camposInciertos.includes(campo);
    const numerico = esNumerico(info);
    const id = `campo-${campo}`;

    return (
      <div key={campo} className={cn("flex min-w-0 flex-col gap-1", largo && "col-span-full")}>
        <label htmlFor={soloLectura ? undefined : id} className="flex items-center gap-2 text-[13px] text-texto-secundario">
          {info?.etiqueta ?? humanizar(campo)}
          {incierto && <AvisoIncierto />}
        </label>
        {soloLectura ? (
          <p
            className={cn(
              "min-h-6 break-words text-[15px] leading-snug text-texto",
              numerico && "tabular-nums",
              incierto && "border-l-2 border-amber pl-2",
            )}
          >
            {valor === "" ? <span className="text-texto-secundario">—</span> : valor}
          </p>
        ) : largo ? (
          <Textarea
            id={id}
            rows={2}
            value={valor}
            onChange={(evento) => cambiarEscalar(campo, evento.target.value)}
            placeholder="Sin dato en el documento"
            className={cn("bg-bg", incierto && "border-amber/60")}
          />
        ) : (
          <Input
            id={id}
            value={valor}
            inputMode={numerico ? "decimal" : undefined}
            onChange={(evento) => cambiarEscalar(campo, evento.target.value)}
            placeholder={info?.tipo_dato === "Fecha" ? "AAAA-MM-DD" : "Sin dato"}
            className={cn("h-9 bg-bg", numerico && "text-right tabular-nums", incierto && "border-amber/60")}
          />
        )}
      </div>
    );
  }

  function renderTabla(campo: string) {
    const filas = valores[campo] as Fila[];
    const detalle = infoDetalle.get(campo);
    const columnas = columnasPorLista[campo] ?? detalle?.columnas.map((c) => c.campo) ?? Object.keys(filas[0] ?? {});
    const infoColumna = new Map((detalle?.columnas ?? []).map((c) => [c.campo, c]));
    const incierto = camposInciertos.includes(campo);

    // Suma de control de una factura: cantidad × precio unitario por
    // línea. Solo si el documento tiene esas dos columnas.
    const conImporte = columnas.includes("cantidad") && columnas.includes("precio_unitario");
    const importes = filas.map((fila) => {
      const cantidad = aNumero(fila.cantidad ?? "");
      const precio = aNumero(fila.precio_unitario ?? "");
      return cantidad !== null && precio !== null ? cantidad * precio : null;
    });
    const sumaLineas = importes.reduce<number>((suma, importe) => suma + (importe ?? 0), 0);
    const montoTotal = typeof valores.monto_total === "string" ? aNumero(valores.monto_total) : null;
    const difiereDelTotal =
      conImporte && montoTotal !== null && importes.some((i) => i !== null) && Math.abs(sumaLineas - montoTotal) > 0.01;

    return (
      <div key={campo} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-texto">
            {detalle?.etiqueta ?? humanizar(campo)}
            <span className="text-[13px] font-normal text-texto-secundario">
              ({filas.length} {filas.length === 1 ? "línea" : "líneas"})
            </span>
            {incierto && <AvisoIncierto />}
          </h4>
          {!soloLectura && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => cambiarFilas(campo, [...filas, filaVacia(columnas)])}
              disabled={columnas.length === 0}
            >
              <Plus />
              Agregar línea
            </Button>
          )}
        </div>

        {filas.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[13px] text-texto-secundario">
            El documento no detalla líneas.{!soloLectura && " Puedes agregarlas a mano."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-bg text-left text-[13px] text-texto-secundario">
                  <th scope="col" className="w-10 px-2 py-2 text-center font-medium">
                    #
                  </th>
                  {columnas.map((columna) => (
                    <th
                      key={columna}
                      scope="col"
                      className={cn(
                        "px-2 py-2 font-medium",
                        esNumerico(infoColumna.get(columna)) ? "w-28 text-right" : "min-w-32",
                        columna === "descripcion" && "min-w-64",
                      )}
                    >
                      {infoColumna.get(columna)?.etiqueta ?? humanizar(columna)}
                    </th>
                  ))}
                  {conImporte && (
                    <th scope="col" className="w-28 px-2 py-2 text-right font-medium">
                      Importe
                    </th>
                  )}
                  {!soloLectura && (
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, indice) => (
                  <tr key={indice} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-center text-[13px] tabular-nums text-texto-secundario">
                      {indice + 1}
                    </td>
                    {columnas.map((columna) => {
                      const numerico = esNumerico(infoColumna.get(columna));
                      const etiquetaColumna = infoColumna.get(columna)?.etiqueta ?? humanizar(columna);
                      return (
                        <td key={columna} className={cn(soloLectura ? "px-2 py-2" : "px-1 py-1")}>
                          {soloLectura ? (
                            <span className={cn("block text-texto", numerico && "text-right tabular-nums")}>
                              {fila[columna] || <span className="text-texto-secundario">—</span>}
                            </span>
                          ) : (
                            <Input
                              value={fila[columna] ?? ""}
                              aria-label={`${etiquetaColumna}, línea ${indice + 1}`}
                              inputMode={numerico ? "decimal" : undefined}
                              onChange={(evento) =>
                                cambiarFilas(
                                  campo,
                                  filas.map((f, i) => (i === indice ? { ...f, [columna]: evento.target.value } : f)),
                                )
                              }
                              className={cn(
                                // Celda tipo hoja de cálculo: sin caja hasta
                                // que se pasa el mouse o se enfoca.
                                "h-8 rounded-md border-transparent bg-transparent px-2 hover:border-border",
                                numerico && "text-right tabular-nums",
                              )}
                            />
                          )}
                        </td>
                      );
                    })}
                    {conImporte && (
                      <td className="px-2 py-2 text-right tabular-nums text-texto-secundario">
                        {importes[indice] === null ? "—" : formatoMonto.format(importes[indice] as number)}
                      </td>
                    )}
                    {!soloLectura && (
                      <td className="px-1 py-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => cambiarFilas(campo, filas.filter((_, i) => i !== indice))}
                          aria-label={`Quitar línea ${indice + 1}`}
                          title="Quitar línea"
                          className="size-8 text-rojo hover:bg-rojo/10 hover:text-rojo"
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {conImporte && (
                <tfoot>
                  <tr className="border-t border-border bg-bg">
                    <td colSpan={columnas.length + 1} className="px-2 py-2 text-right text-[13px] text-texto-secundario">
                      Suma de líneas
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-texto">
                      {formatoMonto.format(sumaLineas)}
                    </td>
                    {!soloLectura && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {difiereDelTotal && (
          <p className="text-[13px] text-amber">
            La suma de líneas ({formatoMonto.format(sumaLineas)}) no coincide con el monto total de la cabecera (
            {formatoMonto.format(montoTotal as number)}).
          </p>
        )}
      </div>
    );
  }

  const cuerpo = (
    <div className="@container flex flex-col gap-5 rounded-xl border border-border bg-surface p-4">
      {cortos.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 @md:grid-cols-2 @2xl:grid-cols-3">
          {cortos.map((campo) => renderCampo(campo, false))}
        </div>
      )}
      {largos.length > 0 && (
        <div className="grid grid-cols-1 gap-3">{largos.map((campo) => renderCampo(campo, true))}</div>
      )}
      {listas.map((campo) => (
        <div key={campo} className="border-t border-border pt-4">
          {renderTabla(campo)}
        </div>
      ))}
    </div>
  );

  if (soloLectura) return cuerpo;

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-3">
      {cuerpo}
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
