# slug

`slugify(text)` makes a URL slug.

1. Lowercase.
2. Remove accents (decompose to NFD and drop combining marks), so "Crème Brûlée" becomes "creme brulee".
3. Replace every run of characters that are not a-z or 0-9 with a single hyphen.
4. Remove leading and trailing hyphens.
5. If the result is empty, return "n-a".
6. If the result is longer than 60 characters: take the first 61 characters, cut at the last hyphen in them (so no word is split); if there is no hyphen, keep the first 60 characters.
