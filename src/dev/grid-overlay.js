// Dev only (imported from main.js behind import.meta.env.DEV): Ctrl+Shift+G draws the 4 px grid over the
// window and outlines every element's box, so misalignments are visible. It never takes the pointer.
const style = document.createElement('style');
style.textContent = `
#grid-overlay { position: fixed; inset: 0; z-index: 9999; pointer-events: none; display: none;
  background-image: linear-gradient(rgba(245, 165, 36, 0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(245, 165, 36, 0.10) 1px, transparent 1px);
  background-size: 4px 4px; }
#grid-overlay::after { content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(rgba(245, 165, 36, 0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(245, 165, 36, 0.28) 1px, transparent 1px);
  background-size: 16px 16px; }
body.grid-on #grid-overlay { display: block; }
body.grid-on *:not(#grid-overlay):not(svg *):not(path) { outline: 1px solid rgba(245, 165, 36, 0.35) !important; outline-offset: -1px; }
`;
document.head.append(style);
const overlay = document.createElement('div');
overlay.id = 'grid-overlay';
overlay.setAttribute('aria-hidden', 'true');
document.body.append(overlay);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); document.body.classList.toggle('grid-on'); }
}, true);
