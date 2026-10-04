"""
Regenera los embeddings de `historial_clasificaciones` con el modelo de
embeddings vigente (GEMINI_MODEL_EMBEDDINGS, ver app/config.py).

Hace falta cuando se cambia de modelo de embeddings (por ejemplo, porque
Google retiro el anterior): los vectores de modelos distintos no son
comparables, y la busqueda de antecedentes (rag_service) solo usa filas
cuyo `modelo_embedding` coincide con el modelo vigente. El texto de origen
(descripcion_comercial + atributos_json) esta guardado en cada fila, asi
que no se pierde nada: solo se recalcula el vector.

Seguro de re-correr: solo toca las filas que todavia no estan en el modelo
vigente (o todas con --todas). Se puede correr con el backend en marcha:
mientras avanza, la busqueda funciona con las filas ya regeneradas.

Uso:
    python scripts/recalcular_embeddings.py            # filas pendientes
    python scripts/recalcular_embeddings.py --simular  # solo cuenta
    python scripts/recalcular_embeddings.py --todas    # fuerza todas

Para cambiar de modelo: poner GEMINI_MODEL_EMBEDDINGS en Render (y en el
.env local con el que se corre esto), y correr este script.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_supabase_admin_client  # noqa: E402
from services.rag_service import (  # noqa: E402
    construir_texto_para_embedding,
    generar_embeddings,
    modelo_embedding_vigente,
)

# Textos por llamada a la API: pocas llamadas aunque el historial crezca
# (importa con la cuota diaria del plan gratuito).
TAMANO_LOTE = 50


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--todas", action="store_true", help="regenera todas las filas, no solo las pendientes")
    parser.add_argument("--simular", action="store_true", help="solo informa cuantas filas se regenerarian")
    args = parser.parse_args()

    admin = get_supabase_admin_client()
    modelo = modelo_embedding_vigente()

    consulta = admin.table("historial_clasificaciones").select(
        "id, descripcion_comercial, atributos_json, modelo_embedding"
    )
    if not args.todas:
        consulta = consulta.neq("modelo_embedding", modelo)
    filas = consulta.execute().data or []

    print(f"Modelo vigente: {modelo}")
    print(f"Filas a regenerar: {len(filas)}")
    if args.simular or not filas:
        return

    hechas = 0
    for inicio in range(0, len(filas), TAMANO_LOTE):
        lote = filas[inicio : inicio + TAMANO_LOTE]
        textos = [construir_texto_para_embedding(f["descripcion_comercial"], f["atributos_json"] or {}) for f in lote]
        vectores = generar_embeddings(textos)
        for fila, vector in zip(lote, vectores):
            admin.table("historial_clasificaciones").update(
                {"embedding": vector, "modelo_embedding": modelo}
            ).eq("id", fila["id"]).execute()
        hechas += len(lote)
        print(f"  {hechas}/{len(filas)}")

    print("Listo.")


if __name__ == "__main__":
    main()
