// Arnés de prueba: corre exactamente la misma lógica de indexación que
// sync-drive.js (filtros, hash, chunking, embeddings, guardado,
// eliminación de borrados) contra un manifiesto de archivos ya
// descargado, sin pasar por la autenticación real de Google.
//
// Uso:
//   MANIFEST_PATH=/ruta/al/manifiesto.mjs node test/probar-indexacion.js
//
// El manifiesto debe exportar `documentos`: un array de
// { id, name, mimeType, ruta, texto }.
//
// Este script no incluye ningún documento real de "SITIO WEB" — el
// manifiesto se provee aparte y no se sube al repositorio, porque su
// contenido es la documentación oficial del Concejo, no código.

import { pool } from '../db.js';
import { procesarArchivos } from '../sync-drive.js';

const manifestPath = process.env.MANIFEST_PATH;
if (!manifestPath) {
  console.error('Falta MANIFEST_PATH (ruta a un archivo .mjs que exporte "documentos").');
  process.exit(1);
}

const { documentos } = await import(manifestPath);

const archivos = documentos.map(d => ({ id: d.id, name: d.name, mimeType: d.mimeType, ruta: d.ruta }));
const textoPorId = new Map(documentos.map(d => [d.id, d.texto]));

const client = await pool.connect();
try {
  const resultado = await procesarArchivos(client, archivos, file => textoPorId.get(file.id) ?? null);
  console.log(JSON.stringify(resultado, null, 2));
} finally {
  client.release();
  await pool.end();
}
