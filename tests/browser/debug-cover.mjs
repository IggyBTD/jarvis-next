// temporary: reproduce the folder-item covered-by-side-foot finding at 960x600
import { chromium } from 'playwright';
const base = process.env.BASE ?? 'http://127.0.0.1:5174/';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('jarvis.mode', 'server'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#sidebar', { state: 'visible' });
  await page.click('#folder-add');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  const info = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
    const sidebar = document.querySelector('#sidebar');
    const kids = [...sidebar.children].map((c) => ({ cls: c.className, id: c.id, rect: r(c) }));
    const folder = document.querySelector('.folder-item');
    const foot = document.querySelector('#side-foot');
    const list = document.querySelector('#chat-list');
    const fr = folder?.getBoundingClientRect();
    let topAtCenter = null;
    if (fr) {
      // visible center like the scan computes it
      topAtCenter = document.elementFromPoint((fr.left + fr.right) / 2, (fr.top + fr.bottom) / 2)?.outerHTML?.slice(0, 120);
    }
    return { kids, folder: r(folder), foot: r(foot), list: r(list), listScrollH: list?.scrollHeight, topAtCenter, folderParent: folder?.parentElement?.id ?? folder?.parentElement?.className };
  });
  console.log(JSON.stringify(info, null, 1));
} finally { await browser.close(); }
