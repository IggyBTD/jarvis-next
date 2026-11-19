const TOOLS = { 'files.read': 'T0', 'web.search': 'T1', 'files.write': 'T2', 'shell.run': 'T3', 'mail.send': 'T3' };

function tierOf(tool) {
  return TOOLS[tool] ?? null;
}

function badPath(p) {
  return /^([a-zA-Z]:|[\\/])/.test(p) || p.split(/[\\/]/).includes('..');
}

function decide({ tool, args = {}, source = 'chat' }) {
  const tier = tierOf(tool);
  if (!tier) return { verdict: 'deny', reason: 'unknown tool' };
  if (tool.startsWith('files.') && badPath(String(args.path ?? ''))) return { verdict: 'deny', reason: 'path outside workspace' };
  if (source === 'schedule' && tier === 'T3') return { verdict: 'deny', reason: 'scheduled jobs never run T3' };
  if (tier === 'T2' || tier === 'T3') return { verdict: 'ask', reason: `${tier} needs approval` };
  return { verdict: 'allow', reason: '' };
}

module.exports = { decide, tierOf };
