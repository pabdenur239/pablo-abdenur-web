// Extracción local de texto (PDF y Word) a partir de los bytes descargados de
// Drive con permiso de solo lectura. No crea ni modifica nada en Drive.
//
// PDF: primero el texto embebido (pdftotext); si es un escaneo, OCR local
// (pdftoppm + tesseract en español). Word: se lee word/document.xml.
// El resultado se guarda en caché por id + checksum, para no repetir el OCR
// de un archivo sin cambios en cada sincronización diaria.

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const OPCIONES = { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 };
const CACHE_DIR = process.env.CACHE_DIR || join(tmpdir(), 'cache-extraccion');
const MINIMO_CARACTERES_POR_PAGINA = 100;

export const MIME_PDF = 'application/pdf';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function textoPdf(ruta, dir) {
  const { stdout } = await run('pdftotext', ['-layout', ruta, '-'], OPCIONES);
  const paginas = Math.max(1, stdout.split('\f').length - 1);
  if (stdout.replace(/\s+/g, '').length >= paginas * MINIMO_CARACTERES_POR_PAGINA) return stdout;

  await run('pdftoppm', ['-r', '200', '-gray', '-png', ruta, join(dir, 'p')], OPCIONES);
  const imagenes = (await readdir(dir)).filter(n => n.endsWith('.png')).sort();
  let texto = '';
  for (const imagen of imagenes) {
    const ocr = await run('tesseract', [join(dir, imagen), 'stdout', '-l', 'spa'], OPCIONES);
    texto += `${ocr.stdout}\n`;
  }
  return texto;
}

async function textoDocx(ruta) {
  const { stdout } = await run('unzip', ['-p', ruta, 'word/document.xml'], OPCIONES);
  return stdout
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:(tab|br)\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export async function extraerDeBytes(bytes, mimeType) {
  const dir = await mkdtemp(join(tmpdir(), 'doc-'));
  try {
    const ruta = join(dir, 'entrada');
    await writeFile(ruta, bytes);
    if (mimeType === MIME_PDF) return await textoPdf(ruta, dir);
    if (mimeType === MIME_DOCX) return await textoDocx(ruta);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// `descargar` solo se invoca si no hay una extracción en caché para esta
// versión exacta del archivo.
export async function extraerConCache(file, descargar) {
  const version = String(file.md5Checksum || file.modifiedTime || '').replace(/[^\w-]/g, '');
  const clave = version ? join(CACHE_DIR, `${file.id.replace(/[^\w-]/g, '')}-${version}.txt`) : null;
  if (clave) {
    try {
      return await readFile(clave, 'utf-8');
    } catch { /* sin caché todavía */ }
  }
  const texto = await extraerDeBytes(await descargar(), file.mimeType);
  if (clave && texto && texto.trim()) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(clave, texto);
  }
  return texto;
}
