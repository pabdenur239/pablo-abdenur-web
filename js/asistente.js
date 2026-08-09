// Secretario Virtual Institucional — widget de chat (Fase 1)
// Arquitectura: el widget solo habla con un endpoint HTTP (una Supabase Edge
// Function). Nunca llama a OpenAI, Supabase o Google directamente, y nunca
// contiene claves. Mientras ASISTENTE_ENDPOINT esté vacío, el backend todavía
// no está desplegado: el widget lo informa con honestidad en vez de simular
// una respuesta.
const ASISTENTE_ENDPOINT = '';

const PERFILES = [
  'Vecino', 'Comerciante', 'Emprendedor', 'Periodista', 'Proveedor',
  'Institución', 'Empleado municipal', 'Funcionario', 'Concejal',
  'Posible inversor', 'Otro',
];

const STORAGE_KEY = 'asistente-abdenur';

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

  function addMessage(remitente, contenido, { persist = true } = {}) {
    const msg = document.createElement('div');
    msg.className = `asis-msg ${remitente}`;
    msg.textContent = contenido;
    messagesEl.append(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (persist) {
      state.mensajes.push({ remitente, contenido, ts: Date.now() });
      saveState(state);
    }
  }

  function renderHistory() {
    if (!state.mensajes.length) {
      addMessage('asistente', 'Hola, soy el Secretario Virtual de Pablo Abdenur. Elegí un perfil y contame en qué te puedo ayudar.', { persist: false });
      return;
    }
    state.mensajes.forEach(m => addMessage(m.remitente, m.contenido, { persist: false }));
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

  async function askAsistente(mensaje) {
    if (!ASISTENTE_ENDPOINT) {
      addMessage('sistema', 'La conexión con la base documental todavía está en preparación (Fase 2). Por ahora no puedo responder automáticamente, pero tu mensaje quedó registrado en este navegador.');
      return;
    }
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
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.visitanteId = data.visitanteId ?? state.visitanteId;
      state.conversacionId = data.conversacionId ?? state.conversacionId;
      saveState(state);
      addMessage('asistente', data.respuesta);
    } catch {
      addMessage('sistema', 'No pude conectarme con el asistente en este momento. Podés reintentar en unos minutos o escribir desde la sección de Contacto.');
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const mensaje = textarea.value.trim();
    if (!mensaje) return;
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
