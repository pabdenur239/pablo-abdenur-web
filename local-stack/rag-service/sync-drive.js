// Secretario Virtual Institucional — sincronización documental (Fase 1)
//
// Recorre la carpeta "SITIO WEB" de Google Drive, extrae el texto de cada
// documento, lo divide en fragmentos y los guarda embebidos (con el
// modelo local de Ollama) en el Postgres local, para que /asistente
// pueda buscarlos. Único servicio externo involucrado: la API de Google
// Drive en modo solo lectura, gratuita dentro de su cuota normal — no es
// una suscripción ni un servicio pago.
//
// La ejecuta el workflow de n8n "sync-drive" por cron, llamando a
// POST /sync-drive de este mismo servicio.
//
// Variables de entorno (ver local-stack/.env.example):
//   GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SITIO_WEB_FOLDER_ID
//
// LIMITACIÓN CONOCIDA: varios documentos de "SITIO WEB" son PDF
// escaneados (fotos de actas y ordenanzas pasadas por un OCR de
// escritorio). La conversión automática de acá usa el OCR de Google
// Drive, que es mejor, pero puede arrastrar errores en documentos
// escaneados de baja calidad. Ver local-stack/README.md.

import crypto from 'node:crypto';
import { pool } from './db.js';
import { embed } from './ollama.js';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

const NECESITA_CONVERSION = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function googleAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(credentials.private_key);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`No se pudo autenticar con Google: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function listarCarpeta(token, folderId, ruta) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=1000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive list falló: ${JSON.stringify(data)}`);

  let archivos = [];
  for (const file of data.files ?? []) {
    if (file.mimeType === GOOGLE_FOLDER) {
      archivos = archivos.concat(await listarCarpeta(token, file.id, `${ruta}/${file.name}`));
    } else {
      archivos.push({ ...file, ruta });
    }
  }
  return archivos;
}

async function extraerTexto(token, file) {
  if (file.mimeType === GOOGLE_DOC) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok ? await res.text() : null;
  }

  if (NECESITA_CONVERSION.has(file.mimeType)) {
    // Copia temporal como Google Doc: dispara el OCR/parseo de Drive.
    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/copy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `[temporal] ${file.name}`, mimeType: GOOGLE_DOC }),
    });
    const copia = await copyRes.json();
    if (!copyRes.ok) return null;

    try {
      const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${copia.id}/export?mimeType=text/plain`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return exportRes.ok ? await exportRes.text() : null;
    } finally {
      await fetch(`https://www.googleapis.com/drive/v3/files/${copia.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }

  return null; // tipo de archivo no soportado todavía (por ejemplo, imágenes sueltas)
}

function dividirEnFragmentos(texto) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  const fragmentos = [];
  let inicio = 0;
  while (inicio < limpio.length) {
    fragmentos.push(limpio.slice(inicio, inicio + CHUNK_SIZE));
    inicio += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return fragmentos.filter(f => f.length > 40);
}

function hashTexto(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

export async function sincronizar() {
  const resultado = { revisados: 0, actualizados: 0, sinCambios: 0, noSoportados: [], errores: [] };
  let client;

  try {
    client = await pool.connect();
    const token = await googleAccessToken();
    const folderId = process.env.DRIVE_SITIO_WEB_FOLDER_ID;
    const archivos = await listarCarpeta(token, folderId, 'SITIO WEB');

    for (const file of archivos) {
      resultado.revisados++;
      try {
        const texto = await extraerTexto(token, file);
        if (!texto) {
          resultado.noSoportados.push(`${file.ruta}/${file.name}`);
          continue;
        }

        const hash = hashTexto(texto);
        const { rows: existentes } = await client.query(
          'select id, hash_contenido from documentos_indexados where drive_file_id = $1',
          [file.id],
        );
        const existente = existentes[0];

        if (existente && existente.hash_contenido === hash) {
          resultado.sinCambios++;
          continue;
        }

        let documentoId;
        if (existente) {
          documentoId = existente.id;
          await client.query(
            'update documentos_indexados set hash_contenido = $1, ultima_actualizacion = now() where id = $2',
            [hash, documentoId],
          );
          await client.query('delete from fragmentos_embebidos where documento_id = $1', [documentoId]);
        } else {
          const { rows } = await client.query(
            'insert into documentos_indexados (drive_file_id, titulo, ruta_carpeta, hash_contenido) values ($1, $2, $3, $4) returning id',
            [file.id, file.name, file.ruta, hash],
          );
          documentoId = rows[0].id;
        }

        const fragmentos = dividirEnFragmentos(texto);
        for (const fragmentoTexto of fragmentos) {
          const embedding = await embed(fragmentoTexto);
          await client.query(
            'insert into fragmentos_embebidos (documento_id, texto, embedding) values ($1, $2, $3::vector)',
            [documentoId, fragmentoTexto, JSON.stringify(embedding)],
          );
        }
        resultado.actualizados++;
      } catch (err) {
        resultado.errores.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    resultado.errores.push(err instanceof Error ? err.message : String(err));
  } finally {
    client?.release();
  }

  return resultado;
}
