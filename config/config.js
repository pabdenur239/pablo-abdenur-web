// Configuración global del sitio.
//
// Único lugar del proyecto donde se escriben URLs, endpoints, puertos y
// parámetros de entorno. Ningún otro archivo de frontend (como
// js/asistente.js) debe tener estos valores escritos directamente — todos
// se leen desde acá, en window.SITIO_CONFIG.
//
// Para cambiar de infraestructura en el futuro (por ejemplo, cuando el
// stack de local-stack/ quede desplegado, o al mover el asistente a otro
// servidor), modificar ÚNICAMENTE este archivo. El código del asistente no
// debería cambiar.
//
// Debe cargarse antes que cualquier otro script que lo use (ver el orden
// de los <script> en cada página HTML).

window.SITIO_CONFIG = {
  // 'desarrollo' | 'produccion'. Hoy no cambia el comportamiento del
  // widget; queda disponible para módulos futuros (por ejemplo, activar
  // registro detallado en consola solo en desarrollo).
  entorno: 'desarrollo',

  asistente: {
    // Endpoint que llama el widget para conversar (ver js/asistente.js).
    // Diseño original: el webhook del workflow de n8n "Secretario Virtual
    // — Conversación" (local-stack/n8n/workflows/asistente.json), que
    // reenvía tal cual a rag-service. En este entorno local, la
    // activación del workflow de n8n no tomó efecto para webhooks de
    // producción (probado por CLI, reinicio y API REST), así que por
    // ahora apunta directo al rag-service ya validado en Fase 3. n8n
    // sigue desplegado en local-stack para la sincronización documental
    // y como camino a retomar: una vez activado, basta con cambiar esta
    // URL a la del webhook (http://localhost:5678/webhook/asistente).
    // Vacío = el backend todavía no está desplegado; el widget lo informa
    // con honestidad en vez de simular una respuesta.
    endpointConversacion: 'http://localhost:3210/asistente',

    // URL base de n8n. No la usa el widget directamente hoy — queda acá
    // para módulos futuros (por ejemplo, un panel interno de estado).
    n8nUrl: 'http://localhost:5678',

    // URL del servicio rag-service (local-stack/rag-service). Coincide
    // hoy con endpointConversacion (ver nota arriba). Queda documentada
    // acá para no tener que buscarla en el código cuando haga falta.
    ragServiceUrl: 'http://localhost:3210',
  },

  // Clave de localStorage donde el widget guarda el historial y el
  // contexto de la conversación en el navegador del visitante.
  storageKey: 'asistente-abdenur',
};
