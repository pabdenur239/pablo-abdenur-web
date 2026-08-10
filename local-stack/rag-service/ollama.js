// Cliente mínimo para el motor de IA local (Ollama). Sin claves, sin costo:
// todo corre en el mismo servidor donde se despliega este stack.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'llama3.2';

// Mantiene llama3.2 cargado en memoria más tiempo del default de Ollama
// (5 minutos), para evitar el costo de recarga en consultas normales
// espaciadas. No es "infinito" a propósito: sigue liberando la memoria
// tras un período largo sin uso.
const CHAT_KEEP_ALIVE = '30m';

export async function embed(texto, { signal } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: texto }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama embeddings falló: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embedding;
}

export async function chat(systemPrompt, userPrompt, { signal } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      keep_alive: CHAT_KEEP_ALIVE,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama chat falló: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.message.content.trim();
}

export async function classify(perfiles, mensaje, { signal } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      keep_alive: CHAT_KEEP_ALIVE,
      options: { temperature: 0 },
      messages: [
        {
          role: 'system',
          content: `Clasificá el mensaje del visitante en uno de estos perfiles exactos: ${perfiles.join(', ')}. Respondé solo con la palabra del perfil, sin explicación. Si no es claro, respondé "otro".`,
        },
        { role: 'user', content: mensaje },
      ],
    }),
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const perfil = data.message.content.trim().toLowerCase();
  return perfiles.includes(perfil) ? perfil : 'otro';
}
