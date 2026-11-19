function slugify(text) {
  let s = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) return "n-a";
  if (s.length > 60) {
    const head = s.slice(0, 61);
    const i = head.lastIndexOf("-");
    s = i > 0 ? head.slice(0, i) : s.slice(0, 60);
  }
  return s;
}

module.exports = { slugify };
