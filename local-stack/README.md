# Secretario Virtual Institucional — stack local (Fase 2)

Todo lo que hace falta para correr el asistente corre en la propia
computadora o servidor, sin ninguna cuenta paga ni suscripción:

| Pieza | Qué hace | Costo |
|---|---|---|
| **Ollama** | motor de IA local (chat + embeddings) | gratis |
| **n8n Community** | recibe el mensaje del widget y lo orquesta | gratis |
| **PostgreSQL + pgvector** | guarda conversaciones y la base documental | gratis |
| **rag-service** (Node.js, en este repo) | hace la búsqueda y arma la respuesta | gratis |
| **Google Drive API** | lee "SITIO WEB" en modo solo lectura | gratis dentro de su cuota normal |

Lo único pago que podría aparecer en el futuro es Google Calendar/Gmail
si se supera una cuota muy alta de uso normal — no antes, y no sin
avisar.

## 1. Requisitos

- [Docker](https://www.docker.com/) y Docker Compose.
- Nada más. No hace falta instalar Node, Postgres ni n8n por separado:
  el `docker-compose.yml` los levanta a todos.

## 2. Levantar el stack

```bash
cd local-stack
cp .env.example .env      # completar si hace falta (ver más abajo)
docker compose up -d
```

Esto deja corriendo:
- Postgres en `localhost:5432` (con el esquema de `postgres/schema.sql` ya aplicado la primera vez).
- Ollama en `localhost:11434`.
- rag-service en `localhost:3210`.
- n8n en `localhost:5678`.

## 3. Descargar los modelos de Ollama

Una sola vez:

```bash
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama pull nomic-embed-text
```

`llama3.2` responde las preguntas; `nomic-embed-text` es el modelo de
embeddings que arma la búsqueda semántica. Ambos son gratuitos y quedan
guardados en el volumen `ollama_data` (no hay que volver a bajarlos).

## 4. Importar los workflows de n8n

1. Abrir `http://localhost:5678` y crear el usuario administrador local (lo pide n8n la primera vez, no es una cuenta en la nube).
2. **Workflows → Import from File** y cargar `n8n/workflows/asistente.json`.
3. Repetir con `n8n/workflows/sync-drive.json`.
4. Abrir cada uno y activarlo (interruptor "Active" arriba a la derecha).
5. Los nodos usan los nombres estándar de n8n, pero conviene revisarlos una vez importados — la versión exacta de cada nodo puede variar según la versión de n8n instalada.

Al activar el workflow "Secretario Virtual — Conversación", n8n va a mostrar la URL del webhook, algo como:

```
http://localhost:5678/webhook/asistente
```

## 5. Conectar el widget del sitio

Copiar esa URL como valor de `ASISTENTE_ENDPOINT` al principio de
`js/asistente.js` (en la raíz del repositorio, no acá). Con eso el
widget ya deja de mostrar "en preparación" y conversa de verdad.

## 6. Indexar "SITIO WEB" (para que el asistente tenga qué responder)

Hace falta una cuenta de servicio de Google, gratuita, de solo lectura:

1. En [Google Cloud Console](https://console.cloud.google.com), crear un proyecto y habilitar la **Google Drive API** (sin costo).
2. Crear una **cuenta de servicio** y descargar su clave en JSON.
3. En Google Drive, compartir la carpeta "SITIO WEB" con el email de esa cuenta de servicio (termina en `...gserviceaccount.com`), permiso **Lector**.
4. Completar en `local-stack/.env`:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: el contenido completo del JSON descargado.
   - `DRIVE_SITIO_WEB_FOLDER_ID`: el ID de la carpeta (la parte de la URL después de `folders/`).
5. `docker compose up -d --build rag-service` para que tome las variables nuevas.
6. Disparar la primera sincronización a mano: en n8n, abrir el workflow "Secretario Virtual — Sincronización documental" y ejecutarlo una vez manualmente ("Execute workflow"). Después corre solo, todos los días a las 4:00.

## Probar todo localmente sin Docker (solo el widget)

El widget funciona sin ningún backend levantado — muestra honestamente
que la conexión está en preparación:

```bash
python3 -m http.server 8000
```

y abrir `http://localhost:8000/index.html`.

Para probar el `rag-service` solo (sin Docker), con Node 18+ instalado:

```bash
cd local-stack/rag-service
npm install
node server.js
```

`GET http://localhost:3210/health` debería responder `{"ok":true}`. Sin
Postgres ni Ollama corriendo, `/asistente` va a devolver un error 500
controlado (no rompe el proceso) — es lo esperado hasta levantar el
resto del stack.

## Qué documentos entran al índice (Fase 2)

`sync-drive.js` filtra dos veces antes de indexar un archivo (ver
`filtros.js`):

1. **Por nombre**, antes de gastar una extracción/OCR: descarta archivos
   cuyo nombre sugiera borrador, copia o temporal.
2. **Por contenido**, ya con el texto extraído: descarta documentos cuyo
   propio texto se identifique como borrador o material de referencia, y
   recorta cualquier sección marcada como interna (por ejemplo, un
   apéndice de estrategia política) antes de embeberlo — el resto del
   documento sí se indexa.

`exclusiones.json` tiene la última palabra sobre ambos filtros: permite
forzar a mano que un archivo puntual se excluya o se incluya, con el
motivo documentado. Editarlo ahí, no en el código.

También se descartan duplicados exactos (mismo contenido en dos
archivos distintos) y se eliminan del índice los documentos que ya no
aparecen en "SITIO WEB" (borrados, movidos, o sin permiso de lectura).

## Probar la indexación sin Google Drive ni Ollama

`test/probar-indexacion.js` corre la misma lógica de filtrado, hash,
chunking y guardado que la sincronización real, a partir de un
manifiesto local en lugar de Drive:

```bash
cd local-stack/rag-service
npm install
MANIFEST_PATH=/ruta/a/un/manifiesto.mjs DATABASE_URL=postgresql://... node test/probar-indexacion.js
```

El manifiesto debe exportar `documentos`: un array de
`{ id, name, mimeType, ruta, texto }`. Sirve para probar cambios en los
filtros o en el chunking contra una base de Postgres real, sin
necesitar la cuenta de servicio de Google todavía.

## Limitación conocida

Varios documentos de "SITIO WEB" son PDF escaneados (fotos pasadas por
un OCR de escritorio, con errores visibles). La sincronización los
convierte usando el OCR propio de Google Drive, que es mejor, pero en
documentos escaneados de baja calidad el texto extraído puede seguir
teniendo errores. Conviene revisar a mano los primeros resultados antes
de confiar plenamente en las respuestas basadas en esos documentos.
