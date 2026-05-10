# Avatar art credits

The 24 avatar SVGs (3 species × 8 stages) in this directory are sourced from
[Noto Emoji](https://github.com/googlefonts/noto-emoji), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

| File | Emoji | Codepoint |
|---|---|---|
| `dragon-1.svg`    | 🥚 egg                           | U+1F95A |
| `dragon-2.svg`    | 🐣 hatching chick                | U+1F423 |
| `dragon-3.svg`    | 🦎 lizard                         | U+1F98E |
| `dragon-4.svg`    | 🐊 crocodile                      | U+1F40A |
| `dragon-5.svg`    | 🐲 dragon face                   | U+1F432 |
| `dragon-6.svg`    | 🐉 dragon                         | U+1F409 |
| `dragon-7.svg`    | 🦕 sauropod                       | U+1F995 |
| `dragon-8.svg`    | 🦖 T-Rex                          | U+1F996 |
| `cat-1.svg`       | 🐱 cat face                       | U+1F431 |
| `cat-2.svg`       | 😺 grinning cat                   | U+1F63A |
| `cat-3.svg`       | 🐈 cat                            | U+1F408 |
| `cat-4.svg`       | 🐈‍⬛ black cat                    | U+1F408 U+200D U+2B1B |
| `cat-5.svg`       | 🐆 leopard                        | U+1F406 |
| `cat-6.svg`       | 🐯 tiger face                     | U+1F42F |
| `cat-7.svg`       | 🐅 tiger                          | U+1F405 |
| `cat-8.svg`       | 🦁 lion face                      | U+1F981 |
| `astronaut-1.svg` | 🌍 globe (Europe + Africa)        | U+1F30D |
| `astronaut-2.svg` | 🪂 parachute                      | U+1FA82 |
| `astronaut-3.svg` | 🚀 rocket                         | U+1F680 |
| `astronaut-4.svg` | 🛸 flying saucer                  | U+1F6F8 |
| `astronaut-5.svg` | 🛰 satellite                       | U+1F6F0 |
| `astronaut-6.svg` | 🌙 crescent moon                  | U+1F319 |
| `astronaut-7.svg` | 🪐 ringed planet                  | U+1FA90 |
| `astronaut-8.svg` | 🌌 milky way                       | U+1F30C |

Replace any single file with your own SVG (keep the same filename) to
re-skin the avatar without touching code. The catalog at
`webapp/src/plugins/pocket-money/catalog/avatars.json` references these
files by path; no JSON change is needed for like-for-like swaps.

The set of stages and their lifetime-saved thresholds is defined at
`webapp/src/lib/pocket-money/types.ts` (`TIER_THRESHOLDS_CENTS`). To add
or remove stages, edit that array, add/remove entries in
`avatars.json`, and add the matching SVGs + `species.<id>.tier<N>` i18n
keys.
