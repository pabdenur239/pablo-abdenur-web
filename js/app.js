const toggle = document.querySelector('#navToggle');
const nav = document.querySelector('#mainNav');

function setMenu(open) {
  nav.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('.sr-only').textContent = open ? 'Cerrar menú' : 'Abrir menú';
  document.body.classList.toggle('menu-open', open);
}

toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setMenu(false);
});
document.querySelector('#year').textContent = new Date().getFullYear();
