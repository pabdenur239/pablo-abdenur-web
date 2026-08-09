// Filtros de indexación (Fase 2).
//
// Decide qué documentos de "SITIO WEB" entran al índice del asistente y
// qué parte de su texto. Combina dos capas:
//
//  1. Heurísticas automáticas sobre el nombre y el contenido del archivo
//     (borrador, material de otro municipio, archivo temporal, etc.).
//  2. exclusiones.json, editable a mano, que tiene la última palabra:
//     puede forzar una exclusión o una inclusión sobre lo que decida la
//     heurística.
//
// Ante la duda, la heurística EXCLUYE — es preferible que falte un
// documento (se nota y se corrige a mano en exclusiones.json) a que el
// asistente cite por error un borrador o un texto de otro municipio.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function cargarExclusiones() {
  try {
    const raw = readFileSync(join(__dirname, 'exclusiones.json'), 'utf-8');
    const data = JSON.parse(raw);
    return { excluir: data.excluir ?? [], incluir: data.incluir ?? [] };
  } catch {
    return { excluir: [], incluir: [] };
  }
}

const EXCLUSIONES = cargarExclusiones();

const PATRONES_NOMBRE_EXCLUIDO = [
  /borrador/i, /draft/i, /temporal/i, /duplicad[oa]/i, /copia de/i, /\[temporal\]/i,
];

// Frases que, si aparecen entre los primeros ~800 caracteres, marcan el
// documento como borrador de trabajo o material no definitivo.
const MARCADORES_BORRADOR = [
  /borrador de trabajo/i,
  /versi[oó]n preliminar/i,
  /no reemplaza la auditor[ií]a/i,
  /documento de referencia/i,
  /material de referencia/i,
  /versi[oó]n no definitiva/i,
];

// Encabezados de secciones internas que nunca deben citarse en una
// respuesta pública, aunque el resto del documento sí sea indexable.
const SECCIONES_INTERNAS = [
  /KIT DE DEFENSA POL[IÍ]TICA/i,
];

function coincideRuta(criterio, rutaCompleta) {
  if (criterio.driveFileId) return false; // se compara aparte, por id
  if (criterio.rutaContiene) return rutaCompleta.toLowerCase().includes(criterio.rutaContiene.toLowerCase());
  return false;
}

function reglaManual(file, rutaCompleta) {
  const excluida = EXCLUSIONES.excluir.find(
    r => r.driveFileId === file.id || coincideRuta(r, rutaCompleta),
  );
  if (excluida) return { forzado: 'excluir', motivo: excluida.motivo };

  const incluida = EXCLUSIONES.incluir.find(
    r => r.driveFileId === file.id || coincideRuta(r, rutaCompleta),
  );
  if (incluida) return { forzado: 'incluir', motivo: incluida.motivo };

  return null;
}

// Evalúa si un archivo debe indexarse, ANTES de extraer su texto
// (nombre y ruta solamente). Devuelve { indexar: boolean, motivo: string }.
export function evaluarPorNombre(file, ruta) {
  const rutaCompleta = `${ruta}/${file.name}`;
  const manual = reglaManual(file, rutaCompleta);
  if (manual) return { indexar: manual.forzado === 'incluir', motivo: manual.motivo, manual: true };

  const patronNombre = PATRONES_NOMBRE_EXCLUIDO.find(p => p.test(file.name));
  if (patronNombre) return { indexar: false, motivo: `Nombre de archivo sugiere borrador/temporal (${patronNombre}).` };

  return { indexar: true, motivo: null };
}

// Segunda pasada, ya con el texto extraído: confirma o revierte la
// decisión anterior en base al contenido, y devuelve el texto ya
// depurado de secciones internas.
export function evaluarPorContenido(file, ruta, texto) {
  const rutaCompleta = `${ruta}/${file.name}`;
  const manual = reglaManual(file, rutaCompleta);
  if (manual) {
    return {
      indexar: manual.forzado === 'incluir',
      motivo: manual.motivo,
      manual: true,
      texto: depurarSeccionesInternas(texto),
    };
  }

  const inicio = texto.slice(0, 800);
  const marcador = MARCADORES_BORRADOR.find(p => p.test(inicio));
  if (marcador) {
    return { indexar: false, motivo: `El texto se identifica como borrador/material no definitivo (coincide con ${marcador}).` };
  }

  return { indexar: true, motivo: null, texto: depurarSeccionesInternas(texto) };
}

// Corta el texto en el primer encabezado de una sección interna (por
// ejemplo, un apéndice de estrategia política) y descarta todo lo que
// sigue, conservando el resto del documento como indexable.
function depurarSeccionesInternas(texto) {
  let recorte = texto;
  for (const patron of SECCIONES_INTERNAS) {
    const match = recorte.match(patron);
    if (match && typeof match.index === 'number') {
      recorte = recorte.slice(0, match.index);
    }
  }
  return recorte;
}
