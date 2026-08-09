# Secretario Virtual Institucional — backend (Fase 1)

Código listo para desplegar. Nada de esto está corriendo todavía porque
no existe un proyecto de Supabase ni una API key de OpenAI. Esta guía es
para cuando se creen esas cuentas.

## 1. Crear el proyecto de Supabase

1. Crear una cuenta en [supabase.com](https://supabase.com) (plan gratuito).
2. Crear un proyecto nuevo (elegir una región cercana, por ejemplo São Paulo).
3. En **SQL Editor**, pegar y ejecutar el contenido completo de `schema.sql`.

## 2. Obtener la API key de OpenAI

1. Crear una cuenta en [platform.openai.com](https://platform.openai.com).
2. Cargar un método de pago (el uso es medido, no hay plan gratuito para la API).
3. En **API keys**, crear una nueva clave secreta.

## 3. Configurar los secrets del proyecto de Supabase

En el panel de Supabase → **Edge Functions → Secrets** (nunca en este
repositorio ni en el chat), cargar:

| Nombre | Valor |
|---|---|
| `OPENAI_API_KEY` | la clave creada en el paso 2 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ver paso 5 |
| `DRIVE_SITIO_WEB_FOLDER_ID` | ver paso 5 |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los agrega Supabase automáticamente.

## 4. Desplegar las funciones

Con el [Supabase CLI](https://supabase.com/docs/guides/cli) instalado y logueado:

```
supabase link --project-ref <ref-del-proyecto>
supabase functions deploy asistente
supabase functions deploy sync-drive
```

Copiar la URL que devuelve el deploy de `asistente` (algo como
`https://<ref>.supabase.co/functions/v1/asistente`) y pegarla como valor
de `ASISTENTE_ENDPOINT` al principio de `js/asistente.js`.

## 5. Cuenta de servicio de Google (para leer "SITIO WEB")

1. En [Google Cloud Console](https://console.cloud.google.com), crear un
   proyecto y habilitar la **Google Drive API**.
2. Crear una **cuenta de servicio** y descargar su clave en formato JSON.
   Ese JSON completo es el valor de `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. En Google Drive, compartir la carpeta "SITIO WEB" con el email de esa
   cuenta de servicio (termina en `...gserviceaccount.com`), con permiso
   de **Lector**.
4. El ID de la carpeta (`DRIVE_SITIO_WEB_FOLDER_ID`) es la parte de la URL
   después de `folders/` cuando se abre "SITIO WEB" en Drive.

## 6. Ejecutar la primera sincronización

Una vez desplegada, llamar una vez a mano a `sync-drive` (por ejemplo con
`curl` o desde el dashboard de Supabase) para indexar todo lo que ya
existe en Drive. Después puede programarse por cron para que corra sola,
por ejemplo una vez por día.

## Limitación conocida

Varios documentos de "SITIO WEB" son PDF escaneados (fotos pasadas por
un OCR de escritorio, no texto real). `sync-drive` los convierte usando
el OCR propio de Google Drive, que en general es mejor, pero en
documentos escaneados de baja calidad el texto extraído puede tener
errores. Conviene revisar manualmente los primeros resultados antes de
confiar en las respuestas que se generen a partir de esos documentos.
