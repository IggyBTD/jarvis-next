// Chooses which registry tools the model sees on a request. A 27B model gets worse with a long tool list, so at most
// maxToolsPerRequest registry tools are sent, picked by category keywords in the recent conversation (English, Spanish,
// French, plurals included), then by recent use. list_action_categories lets the model unlock another category for the
// rest of the conversation. Deterministic: same input, same list.
const KEYWORDS = {
  apps: ['open', 'launch', 'start', 'close', 'quit', 'app', 'application', 'window', 'abrir', 'abre', 'cerrar', 'cierra', 'lanzar', 'ejecutar', 'programa', 'ouvrir', 'ouvre', 'fermer', 'lancer', 'fenêtre', 'ventana', 'url', 'site'],
  workspaces: ['workspace', 'workflow', 'dev server', 'espacio de trabajo', 'entorno', 'environnement'],
  audio: ['volume', 'sound', 'mute', 'unmute', 'music', 'song', 'audio', 'track', 'pause', 'volumen', 'sonido', 'silenciar', 'música', 'musica', 'canción', 'son', 'musique', 'couper le son', 'morceau'],
  display: ['screen', 'display', 'brightness', 'wallpaper', 'dark mode', 'night light', 'monitor', 'pantalla', 'brillo', 'fondo de pantalla', 'modo oscuro', 'écran', 'luminosité', 'fond d\'écran', 'mode sombre'],
  power: ['lock', 'sleep', 'hibernate', 'shutdown', 'shut down', 'restart', 'reboot', 'battery', 'power plan', 'awake', 'sign out', 'bloquear', 'dormir', 'suspender', 'apagar', 'reiniciar', 'batería', 'bateria', 'verrouiller', 'veille', 'éteindre', 'redémarrer', 'batterie'],
  performance: ['game', 'gaming', 'fps', 'process', 'kill', 'priority', 'startup', 'temp files', 'recycle bin', 'trash', 'juego', 'jugar', 'proceso', 'rendimiento', 'papelera', 'jeu', 'jouer', 'processus', 'corbeille'],
  system: ['cpu', 'gpu', 'ram', 'memory', 'disk', 'storage', 'temperature', 'uptime', 'system', 'specs', 'hardware', 'load', 'vram', 'memoria', 'disco', 'sistema', 'temperatura', 'mémoire', 'disque', 'système', 'température', 'carga'],
  network: ['wifi', 'wi-fi', 'network', 'internet', 'ping', 'ip address', 'dns', 'port', 'tailscale', 'wake on lan', 'red', 'conexión', 'réseau', 'connexion', 'adresse ip'],
  files: ['file', 'folder', 'directory', 'copy', 'move', 'delete', 'zip', 'download', 'downloads', 'duplicate', 'archivo', 'carpeta', 'fichero', 'copiar', 'mover', 'borrar', 'descargas', 'fichier', 'dossier', 'copier', 'déplacer', 'supprimer', 'téléchargements'],
  clipboard: ['clipboard', 'screenshot', 'notification', 'notify', 'portapapeles', 'captura', 'notificación', 'presse-papiers', 'capture d\'écran'],
  time: ['timer', 'remind', 'reminder', 'alarm', 'schedule', 'minutes', 'in an hour', 'temporizador', 'recordatorio', 'recuérdame', 'recuerdame', 'avísame', 'rappel', 'rappelle', 'minuteur'],
  dev: ['git', 'docker', 'terminal', 'editor', 'vscode', 'repo', 'repository', 'commit', 'branch', 'diff', 'repositorio', 'dépôt'],
  maintenance: ['update', 'updates', 'upgrade', 'backup', 'restore point', 'defender', 'antivirus', 'actualizar', 'actualización', 'copia de seguridad', 'mise à jour', 'sauvegarde'],
  mac: ['shortcut', 'applescript', 'spotlight', 'atajo', 'raccourci'],
  browser: ['web', 'website', 'browse', 'browser', 'google', 'search online', 'look up', 'http', 'https', 'page', 'navegador', 'sitio', 'página', 'busca en internet', 'navigateur', 'cherche sur internet'],
  scripts: ['script'],
};
const DEFAULT_ORDER = ['system', 'apps', 'audio', 'power', 'time', 'workspaces', 'performance', 'scripts'];

const re = (kw) => new RegExp(`(?<![\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu');
const COMPILED = Object.fromEntries(Object.entries(KEYWORDS).map(([cat, list]) => [cat, list.map(re)]));

export const categoryScores = (text) => Object.fromEntries(Object.entries(COMPILED).map(([c, list]) => [c, list.reduce((n, r) => n + (r.test(text) ? 1 : 0), 0)]));

/**
 * @param {{defs: {name: string, category: string}[], text: string, recent?: string[], unlocked?: Set<string>, max?: number}} o
 * @returns {{tools: object[], categories: string[]}}
 */
export function selectTools({ defs, text, recent = [], unlocked = new Set(), max = 15 }) {
  const scores = categoryScores(text);
  const present = [...new Set(defs.map((d) => d.category))];
  const ranked = Object.entries(scores).filter(([c, n]) => n > 0 && present.includes(c)).sort((a, b) => b[1] - a[1] || present.indexOf(a[0]) - present.indexOf(b[0])).map(([c]) => c);
  const order = [...new Set([...ranked, ...unlocked, ...(ranked.length ? [] : DEFAULT_ORDER)])].filter((c) => present.includes(c));
  const used = new Set(recent);
  const picked = [];
  const add = (d) => { if (picked.length < max && !picked.includes(d)) picked.push(d); };
  defs.filter((d) => used.has(d.name) && order.includes(d.category)).forEach(add);
  for (const cat of order) defs.filter((d) => d.category === cat).forEach(add);
  return { tools: picked, categories: order };
}

export const allCategories = (defs) => [...new Set(defs.map((d) => d.category))];
