# Agent benchmark (OpenCode 1.19.1) 2026-10-25

| Variant | Mean score /100 | Fully passed | Mean seconds per task | Mean requests | Mean tool calls | Mean completion tokens | Mean thinking tokens | Timeouts |
|---|---|---|---|---|---|---|---|---|
| 27b-none | **100.0** | 8/8 | 43 | 8.9 | 10.8 | 973 | 0 | 0 |
| coder-fast | **98.6** | 7/8 | 150 | 18.8 | 15.8 | 2109 | 0 | 0 |

Per run:
- 27b-none, fix-cart: 9/9 tests, 40 s
- 27b-none, implement-slugify: 10/10 tests, 34 s
- 27b-none, rename-format: 11/11 tests, 58 s
- 27b-none, fix-lru: 9/9 tests, 37 s
- 27b-none, fix-cart: 9/9 tests, 41 s
- 27b-none, implement-slugify: 10/10 tests, 32 s
- 27b-none, rename-format: 11/11 tests, 62 s
- 27b-none, fix-lru: 9/9 tests, 39 s
- coder-fast, fix-cart: 9/9 tests, 98 s
- coder-fast, implement-slugify: 10/10 tests, 116 s
- coder-fast, rename-format: 11/11 tests, 251 s
- coder-fast, fix-lru: 9/9 tests, 118 s
- coder-fast, fix-cart: 8/9 tests, 79 s
- coder-fast, implement-slugify: 10/10 tests, 192 s
- coder-fast, rename-format: 11/11 tests, 180 s
- coder-fast, fix-lru: 9/9 tests, 165 s
