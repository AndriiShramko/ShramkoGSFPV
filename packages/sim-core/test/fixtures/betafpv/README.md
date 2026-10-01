# BetaFPV Pavo20 CLI dumps (test vectors for `bfdiff.ts`)

These are the `diff all` dumps BetaFPV publishes for the Pavo20 Pro and the Pavo20 Pro II. They are the factory settings BetaFPV asks buyers to paste into the Betaflight CLI. `packages/sim-core/test/bfdiff-betafpv.test.ts` checks that every one of them parses and that the imported values are the ones listed below.

- **Retrieved:** 2026-09-28, through the Zendesk help-centre API of support.betafpv.com (`/api/v2/help_center/articles/<id>/attachments.json`). The web pages sit behind a browser check; the attachment URLs download directly.
- **Kept byte for byte:** mixed CRLF/LF line endings as downloaded (`.gitattributes` here turns off line-ending conversion). The test checks each file's SHA-256.
- **Licence:** BetaFPV states none. The files are factory configuration data that BetaFPV distributes freely to every owner, and they are kept here only as parser test vectors. If BetaFPV objects, replace them with trimmed vectors: the version line, the `master` idle and protocol lines, and the profile sections.

## Sources

| File | Betaflight | Board | BetaFPV article | Attachment |
|---|---|---|---|---|
| `pavo20pro-bf450-elrs-20241216.txt` | 4.5.0 | STM32F405 | [Pavo20 Pro, F405 2-3S 20A V1.0](https://support.betafpv.com/hc/en-us/articles/35964224026521) | `BF405 4.5.0_Pavo20 pro_20A v1.0_ELRS_20241216.txt`, https://support.betafpv.com/hc/article_attachments/45554638466201 |
| `pavo20pro-bf450-tbs-20240729.txt` | 4.5.0 | STM32F405 | same | `BF405 4.5.0_Pavo20 pro_20A v1.0_TBS_20240729.txt`, https://support.betafpv.com/hc/article_attachments/45554654854041 |
| `pavo20pro-bf450-sbus-20250610.txt` | 4.5.0 | STM32F405 | same | `BF405 4.5.0_Pavo20 pro_20A v1.0_SBUS_20250610.txt`, https://support.betafpv.com/hc/article_attachments/48107447447961 |
| `pavo20pro2-3s-bf453-f405-elrs-20251230.txt` | 4.5.3 | STM32F405 | [Pavo20 Pro II 3S, F405 2-3S 20A V1.0](https://support.betafpv.com/hc/en-us/articles/52638111624217) | `BF4.5.3 F405_20A_Pavo20 Pro II 3S_ELRS 20251230.txt`, https://support.betafpv.com/hc/article_attachments/57369034328729 |
| `pavo20pro2-3s-bf453-f405-sbus-20251230.txt` | 4.5.3 | STM32F405 | same | `BF4.5.3 F405_20A_Pavo20 Pro II 3S_SBUS 20251230.txt`, https://support.betafpv.com/hc/article_attachments/57369065486873 |
| `pavo20pro2-bf2025125-at32-elrs-20260810.txt` | 2025.12.5 | AT32F435G | same | `BF2025.12.5 F435_20A_Pavo20 Pro II_ELRS 20260810.txt`, https://support.betafpv.com/hc/article_attachments/62016732021657 |
| `pavo20pro2-bf2025125-at32-sbus-20260810.txt` | 2025.12.5 | AT32F435G | same | `BF2025.12.5 F435_20A_Pavo20 Pro II_SBUS 20260810.txt`, https://support.betafpv.com/hc/article_attachments/62016736556569 |
| `pavo20pro2-bf202661-at32-elrs-20260920.txt` | 2026.6.1 (label) | AT32F435G | same | `BF2026.6.1 F435_20A_Pavo20 Pro II_ELRS 20260920.txt`, https://support.betafpv.com/hc/article_attachments/62538091620633 |
| `pavo20pro2-bf202661-at32-sbus-20260920.txt` | 2026.6.1 (label) | AT32F435G | same | `BF2026.6.1 F435_20A_Pavo20 Pro II_SBUS 20260920.txt`, https://support.betafpv.com/hc/article_attachments/62538091628697 |

## What the import reads from them

| Drone / firmware | PID roll, pitch, yaw (P/I/D/F) | Rates | Throttle curve | Idle |
|---|---|---|---|---|
| Pro, 4.5.0 (3 files) | 54/111/44/0, 68/139/60/0, 54/111/0/0 | ACTUAL 7/67/0 (default) | mid 65, expo 20 | `dshot_idle_value 1000` = 10 % |
| Pro II F405, 4.5.3 (2 files), profile 0 "O4 Pro" | 51/105/46/41, 64/133/63/51, 51/105/0/41 | default | 50/0 | 10 % |
| Pro II AT32, 2025.12.5 and "2026.6.1" (4 files), profile 0 "O4 Pro" | 53/110/46/43, 67/139/63/53, 53/110/0/43 | default | 50/0 | `motor_idle 800` = 8 % |

**The "2026.6.1" dumps are 2025.12.5 builds.** Their version line reads `2026.6.1 Aug 10 2026 / 03:56:33 (7348054f2) MSP API: 1.47`:

- The build hash `7348054f2` is the tag commit of Betaflight **2025.12.5** (`git ls-remote https://github.com/betaflight/betaflight`). The 2026.6.1 tag is `6dbc4218f`.
- Their date and time equal those of BetaFPV's 2025.12.5 dumps.
- MSP API 1.47 is what 2025.12 reports; 2026.6 reports 1.48.
- They have no `battery_profile` sections, which a real 2026.6 `diff all` prints.

The import accepts them with a warning that says all of this. The imported values are the same under either reading, and the warning says that too.
