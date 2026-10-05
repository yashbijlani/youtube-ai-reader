# Transcript extraction — measured results

Videos: 60 (captions available: 42, no captions: 13)

| Method | Success | Success rate | Timestamped | Median latency | P95 latency | Avg segments |
|---|---:|---:|---:|---:|---:|---:|
| Player-response fetch (Method A) | 0/42 | 0% | —% | —ms | —ms | — |
| MAIN-world intercept (Method C) | 41/42 | 97.6% | 100% | 5546ms | 6790ms | 924 |
| Rendered caption DOM (Method D) | 35/42 | 83.3% | 100% | 6092ms | 6414ms | 7 |
| Transcript panel (Method F) | 0/42 | 0% | —% | —ms | —ms | — |

Intercept coverage: 36 full (≥90%), 5 partial (<90%) of 41 successes

| Category | n | has captions | no captions | C success |
|---|---:|---:|---:|---:|
| A_normal_podcast | 6 | 6 | 0 | 6 |
| B_long_podcast | 6 | 6 | 0 | 6 |
| G_popular | 6 | 5 | 1 | 5 |
| C_auto_captions | 6 | 6 | 0 | 6 |
| D_manual_captions | 6 | 5 | 1 | 4 |
| F_multilanguage | 6 | 6 | 0 | 6 |
| I_shorts | 6 | 5 | 1 | 5 |
| J_live | 6 | 0 | 6 | 1 |
| H_recent | 6 | 3 | 3 | 4 |
| E_no_captions | 6 | 0 | 1 | 0 |
