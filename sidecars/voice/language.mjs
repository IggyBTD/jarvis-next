// Which language is this recognised text in, and is it one that is allowed?
//
// Why this exists: Nemotron 3.5 detects among about 40 locales and cannot be told to consider only
// a few (a list in the language option is refused and falls back to all of them), and its output
// carries no language tag. So the recognised text is judged here, and speech in a language that is
// not allowed is dropped before it can reach the chat.
//
// Two checks, both cheap:
//   1. Script: letters outside the Latin alphabet (Cyrillic, Arabic, Han, Hangul, ...) are never
//      English, Spanish, French or Italian.
//   2. Function words: the most common small words of each language. A text is scored per language;
//      a word that belongs to several languages ("de", "a", "no") counts fractionally for each.
//      Latin-script speech whose best match is a language that is not allowed is rejected.
// Texts of one or two words, and texts with no clear winner, are given the benefit of the doubt.

const WORDS = {
  // allowed by default
  en: 'the of and to is that it for you with was on are this be have not but they at what from or an can your will would there their which we my me do how about just like so if when who been has had were more some into than then them these those because want need make please tell show give let know think see look use going get go put create build write find explain'.split(' '),
  es: 'el la los las de que y en un una es por con para no se su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos todos uno les ni otros ese eso ante esto antes algunos qué unos yo otro otra él tanto esa estos mucho nada ella estar estas algo nosotros quiero puedes puedo hacer dime muéstrame dame favor gracias hola buenos buenas'.split(' '),
  fr: 'le la les de des du un une et est en que qui dans pour pas sur au avec ce il elle ils nous vous je tu ne se son sa ses mais ou où si plus par comme aux cette ces tout être avoir fait faire peux peut veux voulez dites montre donne merci bonjour salut très aussi bien moi toi lui leur même quoi comment pourquoi'.split(' '),
  it: 'il lo la i gli le di che e un una è per con non si su al come più ma suo sua suoi anche questo questa quello molto sono ho hai ha abbiamo hanno fare fatto posso puoi vuoi voglio dimmi mostrami dammi grazie ciao buongiorno perché quando dove cosa chi tutto tutti tra fra se mi ti ci vi ne già ancora sempre'.split(' '),
  // not allowed (Latin script); only used to recognise what the text is NOT
  de: 'der die das und ist nicht ich du er sie es wir ihr ein eine einen mit für auf den dem des zu von im auch aber wie was wenn dann noch nur schon sehr bitte danke hallo kann können will möchte machen zeig mir gib mal oder wird sind war haben hat'.split(' '),
  pt: 'o a os as de que e em um uma é por com para não se seu sua ao como mais mas você voce está estão são também isso muito obrigado olá bom dia quero posso pode fazer fala mostra dá me te nos já ainda sempre'.split(' '),
  nl: 'de het een en van in is dat op te zijn niet met voor ik je jij hij zij wij ze maar ook als er aan bij naar nog wel dan wat hoe waar wil kan kun alsjeblieft dank hallo doen laat zien geef mij'.split(' '),
  tr: 'bir bu ve için ile ben sen o biz siz ne var yok daha çok gibi ama de da mi mı mu mü değil evet hayır lütfen teşekkür merhaba yapmak istiyorum göster ver bana'.split(' '),
  pl: 'i w nie na to się z że do jest jak ale co tak czy jestem jesteś proszę dziękuję cześć dzień dobry chcę mogę pokaż daj mi'.split(' '),
  sv: 'och att det är en som på för med jag du han hon vi ni de inte men om har kan vill snälla tack hej gör visa ge mig'.split(' '),
  da: 'og at det er en som på for med jeg du han hun vi de ikke men om har kan vil tak hej gør vis giv mig'.split(' '),
  fi: 'ja on ei että se mutta kun niin minä sinä hän me te he voi haluan kiitos hei tee näytä anna minulle'.split(' '),
  cs: 'a je to se na že v s z do ale jak co ne jsem jsi byl byla prosím děkuji ahoj chci mohu ukaž dej mi'.split(' '),
  ro: 'și este un o de la în pe cu că nu se mai pentru dar ce cum eu tu el ea noi voi ei vreau pot vă rog mulțumesc bună arată dă mi'.split(' '),
  hu: 'és a az egy hogy nem van is de ez én te ő mi ti ők kérem köszönöm szia szeretnék tudok mutasd adj nekem'.split(' '),
  vi: 'và là của có không một những được cho này với trong tôi bạn anh chị em xin cảm ơn chào làm hãy cho tôi xem'.split(' '),
};

// word -> languages that have it, so a shared word is split between them
const OWNERS = new Map();
for (const [lang, words] of Object.entries(WORDS)) {
  for (const w of new Set(words)) OWNERS.set(w, [...(OWNERS.get(w) ?? []), lang]);
}

const tokens = (text) => text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];

// Mumbling makes the model write letters of other alphabets (Greek, Cyrillic, Arabic, Han, ...) into
// otherwise ordinary text. None of the allowed languages uses them, so they are removed from the
// text before anything else happens to it: nothing is shown or sent for them. Also removes the
// Unicode replacement character and zero-width characters, and marks left behind by removed letters.
// Latin letters with accents (é, ñ, ç, ì) are Latin and stay.
export function stripForeignScript(text) {
  let out = '';
  let keepMarks = false; // the last kept character was a Latin letter, so accents after it stay
  for (const ch of text.normalize('NFC')) {
    if (/\p{L}/u.test(ch)) {
      if (/\p{Script=Latin}/u.test(ch)) { out += ch; keepMarks = true; } else keepMarks = false;
    } else if (/\p{M}/u.test(ch)) {
      if (keepMarks) out += ch;
    } else if (/[�​-‏⁠﻿　-〿＀-￯،؛؟]/.test(ch)) {
      keepMarks = false; // replacement character, zero-width characters, CJK and Arabic punctuation
    } else {
      out += ch;
      keepMarks = false;
    }
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(out)) return ''; // only punctuation was left: nothing was said
  return out
    .replace(/([,;:])(\s*[,;:])+/g, '$1')        // "said, , ok" after a removed word
    .replace(/\s+([,.;:!?])/g, '$1')              // " ," left in front of a removed word
    .replace(/^[\s.,;:!?¿¡…\-–—]+/, '')           // punctuation orphaned at the start
    .trim();
}

// Share of the letters that are not Latin (0 to 1).
function foreignScriptShare(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return 1 - latin / letters.length;
}

export function scoreLanguages(text) {
  const score = {};
  for (const w of tokens(text).map((t) => t.replace(/’/g, "'"))) {
    const owners = OWNERS.get(w);
    if (!owners) continue;
    for (const lang of owners) score[lang] = (score[lang] ?? 0) + 1 / owners.length;
  }
  return score;
}

// allowed: list of bare language codes, e.g. ['en', 'es', 'fr', 'it']; empty or missing = no filter.
// partial: the text is still being spoken, so only judge when there is enough of it.
// Returns { allowed: boolean, language: best guess or null, why }.
export function languageVerdict(text, allowed, { partial = false } = {}) {
  if (!allowed?.length) return { allowed: true, language: null, why: 'no filter' };
  if (foreignScriptShare(text) > 0.3) return { allowed: false, language: 'non-latin', why: 'script' };
  const words = tokens(text).length;
  if (words < (partial ? 4 : 3)) return { allowed: true, language: null, why: 'too short to judge' };
  const score = scoreLanguages(text);
  let best = null;
  for (const [lang, s] of Object.entries(score)) if (!best || s > score[best]) best = lang;
  if (!best || score[best] < 1.5) return { allowed: true, language: best, why: 'no clear language' };
  const bestAllowed = Math.max(0, ...allowed.map((l) => score[l] ?? 0));
  if (allowed.includes(best) || bestAllowed >= score[best]) return { allowed: true, language: best, why: 'allowed language' };
  return { allowed: false, language: best, why: 'other language' };
}
