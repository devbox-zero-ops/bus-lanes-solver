# Core DDR comparison

Base: 1/10 boards, 217/606 nets. Fix: 1/10 boards, 217/606 nets.

| Board | Base | Fix | Base connected | Fix connected |
| --- | --- | --- | --- | --- |
| h3 | failed | failed | 16/53 | 16/53 |
| a64 | timeout | timeout | 16/75 | 16/75 |
| stmp157 | timeout | timeout | 32/72 | 32/72 |
| orangecrab | timeout | timeout | 16/50 | 16/50 |
| a13 | timeout | timeout | 24/96 | 24/96 |
| h616 | timeout | timeout | 16/53 | 16/53 |
| butterstick | timeout | timeout | 16/55 | 16/55 |
| glider | passed | passed | 49/49 | 49/49 |
| imx6 | timeout | timeout | 16/53 | 16/53 |
| icepi | timeout | timeout | 16/50 | 16/50 |

Both use Core `1799ee7`, the identical official fixture/harness fingerprints, Bun 1.4.3, 120 seconds/board, Capacity 0.0.1133, Fanout 0.0.89, Checks 0.0.282 and Props 0.0.735. Each gets one CPU (base 2/fix 3); read-only sampled observers verified all ten workers and every observed thread mask. Package hashes remained pinned.

Core fixtures declare no skew targets. This checks routing regression; matching is covered by the explicit five-bus regression and AM3352. The older historical 4/10 result used a different Core/dependency baseline and is not this comparison.
