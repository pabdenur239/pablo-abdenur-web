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
    // Webhook del workflow de n8n "Secretario Virtual — Conversación"
    // (ver local-stack/n8n/workflows/asistente.json). Vacío = el backend
    // todavía no está desplegado; el widget lo informa con honestidad
    // en vez de simular una respuesta.
    endpointConversacion: '',

    // URL base de n8n. No la usa el widget directamente hoy — queda acá
    // para módulos futuros (por ejemplo, un panel interno de estado).
    n8nUrl: '',

    // URL del servicio rag-service (local-stack/rag-service). El widget
    // nunca la llama de forma directa: siempre pasa por el webhook de
    // n8n. Queda documentada acá para no tener que buscarla en el
    // código cuando haga falta.
    ragServiceUrl: '',
  },

  // Clave de localStorage donde el widget guarda el historial y el
  // contexto de la conversación en el navegador del visitante.
  storageKey: 'asistente-abdenur',
};
