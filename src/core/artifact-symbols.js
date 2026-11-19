// A two-letter symbol and a readable name per artifact type, used by interfaces that draw the type
// as an element tile (data-sym, data-type); the classic interface shows the type word instead.
const SYMBOLS = { chart: 'Ch', table: 'Tb', html: 'Pg', markdown: 'Dc', svg: 'Sv', mermaid: 'Dg', javascript: 'Js', typescript: 'Ts', python: 'Py', rust: 'Rs', json: 'Jn', css: 'Cs', bash: 'Sh', shell: 'Sh' };
const NAMES = { html: 'Page', markdown: 'Document', svg: 'Image', mermaid: 'Diagram' };
export const elementSymbol = (type) => SYMBOLS[type] ?? (String(type).charAt(0).toUpperCase() + String(type).charAt(1).toLowerCase());
export const typeName = (type) => NAMES[type] ?? (String(type).charAt(0).toUpperCase() + String(type).slice(1));
