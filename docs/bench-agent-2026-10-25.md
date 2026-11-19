# Agent benchmark (OpenCode 1.19.1) 2026-10-25

| Variant | Mean score /100 | Fully passed | Mean seconds per task | Mean requests | Mean tool calls | Mean completion tokens | Mean thinking tokens | Timeouts |
|---|---|---|---|---|---|---|---|---|
| coder | **111.9** | 5/8 | 191 | 23.1 | 20.0 | 2846 | 0 | 0 |
| coder-fast | **104.5** | 7/8 | 139 | 17.0 | 15.0 | 1931 | 0 | 0 |
| 27b-none | **108.0** | 6/8 | 41 | 8.0 | 9.4 | 894 | 0 | 0 |
| 27b-b2000 | **106.8** | 6/8 | 169 | 11.3 | 13.3 | 5601 | 4193 | 0 |
| 27b-b1000 | **109.1** | 6/8 | 190 | 12.8 | 16.4 | 6267 | 4662 | 0 |

Per run:
- coder, fix-cart: 9/9 tests, 348 s
- coder, implement-slugify: 10/10 tests, 220 s
- coder, rename-format: 15/11 tests, 202 s
- coder, fix-lru: 11/9 tests, 134 s
- coder, fix-cart: 9/9 tests, 83 s
- coder, implement-slugify: 10/10 tests, 144 s
- coder, rename-format: 15/11 tests, 204 s
- coder, fix-lru: 9/9 tests, 195 s
- coder-fast, fix-cart: 9/9 tests, 88 s
- coder-fast, implement-slugify: 10/10 tests, 129 s
- coder-fast, rename-format: 11/11 tests, 188 s
- coder-fast, fix-lru: 9/9 tests, 145 s
- coder-fast, fix-cart: 9/9 tests, 113 s
- coder-fast, implement-slugify: 10/10 tests, 153 s
- coder-fast, rename-format: 15/11 tests, 167 s
- coder-fast, fix-lru: 9/9 tests, 130 s
- 27b-none, fix-cart: 9/9 tests, 38 s
- 27b-none, implement-slugify: 10/10 tests, 33 s
- 27b-none, rename-format: 14/11 tests, 52 s
- 27b-none, fix-lru: 9/9 tests, 39 s
- 27b-none, fix-cart: 9/9 tests, 36 s
- 27b-none, implement-slugify: 10/10 tests, 32 s
- 27b-none, rename-format: 15/11 tests, 57 s
- 27b-none, fix-lru: 9/9 tests, 38 s
- 27b-b2000, fix-cart: 9/9 tests, 355 s
- 27b-b2000, implement-slugify: 10/10 tests, 85 s
- 27b-b2000, rename-format: 14/11 tests, 101 s
- 27b-b2000, fix-lru: 9/9 tests, 389 s
- 27b-b2000, fix-cart: 9/9 tests, 93 s
- 27b-b2000, implement-slugify: 10/10 tests, 77 s
- 27b-b2000, rename-format: 14/11 tests, 135 s
- 27b-b2000, fix-lru: 9/9 tests, 117 s
- 27b-b1000, fix-cart: 9/9 tests, 345 s
- 27b-b1000, implement-slugify: 10/10 tests, 103 s
- 27b-b1000, rename-format: 15/11 tests, 149 s
- 27b-b1000, fix-lru: 9/9 tests, 128 s
- 27b-b1000, fix-cart: 9/9 tests, 159 s
- 27b-b1000, implement-slugify: 10/10 tests, 409 s
- 27b-b1000, rename-format: 15/11 tests, 133 s
- 27b-b1000, fix-lru: 9/9 tests, 91 s
