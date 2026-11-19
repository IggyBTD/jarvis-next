// Interface switch for the classic page: [data-ui] buttons store the choice and go to that page.
// index.html (the nodes interface) reads jarvis.ui before it paints and comes back here for 'classic'.
document.querySelectorAll('[data-ui]').forEach((b) => b.addEventListener('click', () => {
  try { localStorage.setItem('jarvis.ui', b.dataset.ui); } catch { /* storage blocked */ }
  if (b.dataset.ui === 'nodes') location.href = './index.html';
}));
