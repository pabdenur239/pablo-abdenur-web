// Secretario Virtual Institucional — sincronización documental (Fase 1)
//
// Recorre la carpeta "SITIO WEB" de Google Drive, extrae el texto de cada
// documento, lo divide en fragmentos y los guarda embebidos en Supabase
// (fragmentos_embebidos) para que "asistente/index.ts" pueda buscarlos.
// No modifica ni escribe nada en Drive salvo la copia temporal descrita
// más abajo, que borra apenas termina de leerla.
//
// Pensada para ejecutarse por cron (Supabase Scheduled Functions o
// pg_cron), no en cada visita al sitio.
//
// Variables de entorno requeridas (secrets del proyecto, nunca en este
// archivo):
//   OPENAI_API_KEY                 — ver supabase/README.md
//   GOOGLE_SERVICE_ACCOUNT_JSON    — credencial de una cuenta de servicio
//                                     de Google con permiso de LECTURA
//                                     sobre la carpeta "SITIO WEB"
//   DRIVE_SITIO_WEB_FOLDER_ID      — el ID de esa carpeta en Drive
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — los inyecta Supabase
//
// LIMITACIÓN CONOCIDA: varios documentos de "SITIO WEB" son PDF
// escaneados (fotos de actas y ordenanzas pasadas por OCR de escritorio).
// La conversión automática que hace esta función usa el OCR de Google
// Drive, que es mejor, pero igual puede arrastrar errores de texto en
// documentos escaneados de baja calidad. Ver supabase/README.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CHUNK_SIZE = 1200;   // caracteres aproximados por fragmento
const CHUNK_OVERLAP = 150; // superposición entre fragmentos, para no cortar ideas a la mitad
const EMBEDDING_MODEL = 'text-embedding-3-small';

// Mimetypes de Drive que requieren conversión (OCR/parseo) antes de poder
// exportarse como texto plano. Los Google Docs nativos no la necesitan.
const NECESITA_CONVERSION = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';

function supabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function googleAccessToken(): Promise<string> {
  const credentials = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const encode = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${encode(header)}.${encode(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`No se pudo autenticar con Google: ${JSON.stringify(data)}`);
  return data.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const raw = atob(b64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}

type DriveFile = { id: string; name: string; mimeType: string };

async function listarCarpeta(token: string, folderId: string, ruta: string): Promise<Array<DriveFile & { ruta: string }>> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=1000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive list falló: ${JSON.stringify(data)}`);

  let archivos: Array<DriveFile & { ruta: string }> = [];
  for (const file of data.files ?? []) {
    if (file.mimeType === GOOGLE_FOLDER) {
      archivos = archivos.concat(await listarCarpeta(token, file.id, `${ruta}/${file.name}`));
    } else {
      archivos.push({ ...file, ruta });
    }
  }
  return archivos;
}

async function extraerTexto(token: string, file: DriveFile): Promise<string | null> {
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

function dividirEnFragmentos(texto: string): string[] {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  const fragmentos: string[] = [];
  let inicio = 0;
  while (inicio < limpio.length) {
    fragmentos.push(limpio.slice(inicio, inicio + CHUNK_SIZE));
    inicio += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return fragmentos.filter(f => f.length > 40);
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings falló: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function hashTexto(texto: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async () => {
  const resultado = { revisados: 0, actualizados: 0, sinCambios: 0, noSoportados: [] as string[], errores: [] as string[] };

  try {
    const token = await googleAccessToken();
    const supabase = supabaseClient();
    const folderId = Deno.env.get('DRIVE_SITIO_WEB_FOLDER_ID')!;
    const archivos = await listarCarpeta(token, folderId, 'SITIO WEB');

    for (const file of archivos) {
      resultado.revisados++;
      try {
        const texto = await extraerTexto(token, file);
        if (!texto) {
          resultado.noSoportados.push(`${file.ruta}/${file.name}`);
          continue;
        }

        const hash = await hashTexto(texto);
        const { data: existente } = await supabase
          .from('documentos_indexados')
          .select('id, hash_contenido')
          .eq('drive_file_id', file.id)
          .maybeSingle();

        if (existente && existente.hash_contenido === hash) {
          resultado.sinCambios++;
          continue;
        }

        const documentoId = existente
          ? existente.id
          : (await supabase.from('documentos_indexados').insert({
              drive_file_id: file.id, titulo: file.name, ruta_carpeta: file.ruta, hash_contenido: hash,
            }).select('id').single()).data!.id;

        if (existente) {
          await supabase.from('documentos_indexados').update({
            hash_contenido: hash, ultima_actualizacion: new Date().toISOString(),
          }).eq('id', documentoId);
          await supabase.from('fragmentos_embebidos').delete().eq('documento_id', documentoId);
        }

        const fragmentos = dividirEnFragmentos(texto);
        for (const fragmentoTexto of fragmentos) {
          const embedding = await embed(fragmentoTexto);
          await supabase.from('fragmentos_embebidos').insert({
            documento_id: documentoId, texto: fragmentoTexto, embedding,
          });
        }
        resultado.actualizados++;
      } catch (err) {
        resultado.errores.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    resultado.errores.push(err instanceof Error ? err.message : String(err));
  }

  return new Response(JSON.stringify(resultado, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
