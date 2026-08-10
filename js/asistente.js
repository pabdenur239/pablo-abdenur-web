// Secretario Virtual Institucional — widget de chat (Fase 1)
// Arquitectura: el widget solo habla con un endpoint HTTP — el webhook del
// workflow de n8n "Secretario Virtual — Conversación" (ver local-stack/).
// Nunca llama a Ollama, Postgres o Google directamente, y nunca contiene
// claves. Todo el backend corre local y sin costo.
//
// Este archivo no define ninguna URL, puerto ni parámetro de entorno: todo
// eso vive en config/config.js (window.SITIO_CONFIG). Para apuntar el
// widget a otro backend, cambiar únicamente ese archivo.
const CONFIG = window.SITIO_CONFIG.asistente;
const ASISTENTE_ENDPOINT = CONFIG.endpointConversacion;
const STORAGE_KEY = window.SITIO_CONFIG.storageKey;

// Un poco mayor que el timeout del backend (90s), para que sea el propio
// rag-service quien corte primero de forma prolija (con un 504 y mensaje
// claro) en vez de que el widget se rinda antes de que llegue esa respuesta.
const TIMEOUT_MS = 100_000;
// A partir de acá, sin respuesta todavía, se avisa que la consulta sigue en
// curso (las respuestas normales rondan los 35-50s corriendo en CPU).
const ESPERA_LARGA_MS = 12_000;

const PERFILES = [
  'Vecino', 'Comerciante', 'Emprendedor', 'Periodista', 'Proveedor',
  'Institución', 'Empleado municipal', 'Funcionario', 'Concejal',
  'Posible inversor', 'Otro',
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { visitanteId: null, conversacionId: null, perfil: null, mensajes: [] };
    return JSON.parse(raw);
  } catch {
    return { visitanteId: null, conversacionId: null, perfil: null, mensajes: [] };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage no disponible (modo privado, cuota excedida): la
    // conversación sigue funcionando, solo no persiste entre visitas.
  }
}

function buildWidget() {
  const state = loadState();

  const launcher = document.createElement('button');
  launcher.className = 'asis-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-label', 'Abrir Secretario Virtual');
  launcher.innerHTML = '<span class="badge" aria-hidden="true"></span><span class="label">💬 Consultar al Asistente</span>';

  const panel = document.createElement('div');
  panel.className = 'asis-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Asistente virtual institucional');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="asis-head">
      <div class="asis-head-title">
        <b>Secretario Virtual</b>
        <span>Pablo Abdenur · Concejal</span>
      </div>
      <button type="button" class="asis-close" aria-label="Cerrar el asistente">✕</button>
    </div>
    <div class="asis-profile">
      <p>¿Cómo te identificás?</p>
      <div class="asis-profile-grid" role="group" aria-label="Elegir perfil"></div>
    </div>
    <div class="asis-messages" role="log" aria-live="polite" aria-label="Conversación"></div>
    <form class="asis-form">
      <textarea rows="1" placeholder="Escribí tu consulta…" aria-label="Escribir un mensaje" required></textarea>
      <button type="submit" aria-label="Enviar">↑</button>
    </form>
    <p class="asis-disclaimer">Responde únicamente con información oficial publicada por el Concejo. Si no hay información suficiente, te lo va a decir.</p>
  `;

  document.body.append(launcher, panel);

  const profileGrid = panel.querySelector('.asis-profile-grid');
  const messagesEl = panel.querySelector('.asis-messages');
  const form = panel.querySelector('.asis-form');
  const textarea = form.querySelector('textarea');
  const sendBtn = form.querySelector('button');
  const closeBtn = panel.querySelector('.asis-close');

  PERFILES.forEach(perfil => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = perfil;
    btn.setAttribute('aria-pressed', String(state.perfil === perfil));
    btn.addEventListener('click', () => {
      state.perfil = perfil;
      saveState(state);
      profileGrid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    });
    profileGrid.append(btn);
  });

  function addMessage(remitente, contenido, { persist = true, fuentes = [] } = {}) {
    const msg = document.createElement('div');
    msg.className = `asis-msg ${remitente}`;
    msg.textContent = contenido;
    if (fuentes.length) {
      const lista = document.createElement('ul');
      lista.className = 'asis-fuentes';
      // El backend manda una fuente por fragmento recuperado: varios
      // fragmentos suelen venir del mismo documento, así que se
      // deduplica por título antes de mostrarlas.
      const titulos = [...new Set(fuentes.map(f => f.titulo).filter(Boolean))];
      titulos.forEach(titulo => {
        const item = document.createElement('li');
        item.textContent = titulo;
        lista.append(item);
      });
      if (lista.children.length) {
        const etiqueta = document.createElement('p');
        etiqueta.className = 'asis-fuentes-label';
        etiqueta.textContent = 'Fuentes:';
        msg.append(etiqueta, lista);
      }
    }
    messagesEl.append(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (persist) {
      state.mensajes.push({ remitente, contenido, ts: Date.now(), fuentes });
      saveState(state);
    }
  }

  function showTyping() {
    const msg = document.createElement('div');
    msg.className = 'asis-msg asistente asis-typing';
    msg.setAttribute('aria-live', 'polite');
    msg.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.append(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Consultas normales rondan los 35-50s (modelo corriendo en CPU): a
    // los ESPERA_LARGA_MS se lo avisa al visitante para que no piense que
    // el widget se colgó, sin reintentar ni duplicar la consulta.
    const avisoId = setTimeout(() => {
      const aviso = document.createElement('p');
      aviso.className = 'asis-espera-larga';
      aviso.setAttribute('aria-live', 'polite');
      aviso.textContent = 'Estoy consultando la documentación institucional. Esta respuesta puede demorar unos segundos.';
      msg.before(aviso);
    }, ESPERA_LARGA_MS);

    return () => {
      clearTimeout(avisoId);
      msg.remove();
      panel.querySelector('.asis-espera-larga')?.remove();
    };
  }

  function renderHistory() {
    if (!state.mensajes.length) {
      addMessage('asistente', 'Hola, soy el Secretario Virtual de Pablo Abdenur. Elegí un perfil y contame en qué te puedo ayudar.', { persist: false });
      return;
    }
    state.mensajes.forEach(m => addMessage(m.remitente, m.contenido, { persist: false, fuentes: m.fuentes ?? [] }));
  }
  renderHistory();

  let open = false;
  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      textarea.focus();
    } else {
      launcher.focus();
    }
  }

  launcher.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) setOpen(false);
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  });

  // Enter envía la consulta; Shift+Enter inserta un salto de línea.
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  // Mensajes según el tipo de fallo, sin exponer detalle técnico al
  // visitante. Por defecto (error de red u otro no contemplado) se usa el
  // mensaje general ya existente.
  const MENSAJE_FALLBACK = 'No pude conectarme con el asistente en este momento. Podés reintentar en unos minutos o escribir desde la sección de Contacto.';
  function mensajeDeError(status) {
    if (status === 429) return 'Hay varias consultas en este momento. Intentá nuevamente en unos segundos.';
    if (status === 502 || status === 503) return 'El Secretario Virtual no está disponible temporalmente. Intentá nuevamente en unos minutos.';
    if (status === 504) return 'El Secretario Virtual está tardando más de lo esperado. Podés volver a intentar la consulta.';
    return MENSAJE_FALLBACK;
  }

  async function askAsistente(mensaje) {
    if (!ASISTENTE_ENDPOINT) {
      addMessage('sistema', 'La conexión con la base documental todavía está en preparación. Por ahora no puedo responder automáticamente, pero tu mensaje quedó registrado en este navegador.');
      return;
    }
    const hideTyping = showTyping();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ASISTENTE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje,
          visitanteId: state.visitanteId,
          conversacionId: state.conversacionId,
          perfil: state.perfil,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        hideTyping();
        addMessage('sistema', mensajeDeError(res.status));
        return;
      }
      const data = await res.json();
      state.visitanteId = data.visitanteId ?? state.visitanteId;
      state.conversacionId = data.conversacionId ?? state.conversacionId;
      saveState(state);
      hideTyping();
      addMessage('asistente', data.respuesta, { fuentes: data.fuentes ?? [] });
    } catch (error) {
      hideTyping();
      if (error.name === 'AbortError') {
        addMessage('sistema', 'El Secretario Virtual está tardando más de lo esperado. Podés volver a intentar la consulta.');
      } else {
        addMessage('sistema', MENSAJE_FALLBACK);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const mensaje = textarea.value.trim();
    if (!mensaje || sendBtn.disabled) return;
    addMessage('visitante', mensaje);
    textarea.value = '';
    textarea.style.height = 'auto';
    sendBtn.disabled = true;
    askAsistente(mensaje).finally(() => { sendBtn.disabled = false; });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildWidget);
} else {
  buildWidget();
}
