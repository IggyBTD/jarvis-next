// Finds controls a user could not use: covered by something else, cut off by a box that does not scroll, off the window, or
// sitting on top of another control. Runs inside the page. Returns a list of plain-text findings (empty = every control is clear).
export const scanLayout = () => {
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], [role=menuitem], [role=separator][tabindex]';
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}${(el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 24) ? ` "${(el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"` : ''}`;
  const shown = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || n.hasAttribute('hidden') || n.inert) return false;
      if (n.parentElement?.tagName === 'DETAILS' && !n.parentElement.open && n.tagName !== 'SUMMARY') return false; // the body of a folded card is not drawn
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // the part of the element that is inside every clipping ancestor and the window
  const visibleRect = (el) => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    const full = { left, top, right, bottom };
    let clippedByHidden = false;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) {
        const r = n.getBoundingClientRect();
        const scrolls = /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
        const nl = Math.max(left, r.left), nt = Math.max(top, r.top), nr = Math.min(right, r.right), nb = Math.min(bottom, r.bottom);
        if (!scrolls && (nr - nl < right - left - 1 || nb - nt < bottom - top - 1)) clippedByHidden = true;
        [left, top, right, bottom] = [nl, nt, nr, nb];
      }
    }
    const vl = Math.max(left, 0), vt = Math.max(top, 0), vr = Math.min(right, innerWidth), vb = Math.min(bottom, innerHeight);
    return { l: vl, t: vt, r: vr, b: vb, full, clippedByHidden, area: Math.max(0, vr - vl) * Math.max(0, vb - vt) };
  };
  // an open menu is meant to sit over other things: what it covers is not a fault, but the menu's own rows are still checked
  const popup = (el) => !!el?.closest?.('[role="menu"], #command-palette, #app-menu, dialog[open], #toast');
  const out = [];
  const items = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!shown(el) || el.closest('dialog:not([open])')) continue;
    const v = visibleRect(el);
    const fullArea = (v.full.right - v.full.left) * (v.full.bottom - v.full.top);
    if (v.area === 0) continue; // scrolled out of its own scroll box: reachable by scrolling, not a layout fault
    if (v.clippedByHidden && v.area < fullArea * 0.9) { out.push(`cut off: ${name(el)}`); continue; }
    const cx = (v.l + v.r) / 2, cy = (v.t + v.b) / 2;
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !(popup(top) && !popup(el))) out.push(`covered: ${name(el)} by ${name(top)}`);
    items.push({ el, v });
  }
  // two controls on top of each other (neither holds the other)
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el) || popup(a.el) !== popup(b.el)) continue;
      const w = Math.min(a.v.r, b.v.r) - Math.max(a.v.l, b.v.l);
      const h = Math.min(a.v.b, b.v.b) - Math.max(a.v.t, b.v.t);
      if (w > 2 && h > 2) out.push(`overlap: ${name(a.el)} and ${name(b.el)}`);
    }
  }
  return [...new Set(out)];
};
