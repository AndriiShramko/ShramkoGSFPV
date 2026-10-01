# Blackbox test vectors

## `pid-analyzer-good_tune-first64k.bbl` + `.official.json`

- **What:** the first 65,536 bytes of `good_tune.BBL`, a Betaflight 3.1.5 log of a CS110 quad on an Omnibus F4. It holds the header and 2,131 main frames. The last frame is cut by the excerpt's end.
- **Source:** https://github.com/Plasmatree/PID-Analyzer, file `good_tune.BBL` at commit `d2ab676ea93d96a7319d263bb9ff78278f390952` (2018-06-07). SHA-256 of the whole file: `a1a8e906f58c23d3f65acc31961c89249318300f38ea10e153e03f3d839de69f`. SHA-256 of the excerpt: `b818983f05765b5510e764474d187ae11cd3d30d20ab94dee5002bc320d85394`.
- **Licence:** the repository puts its own code under the Beer-Ware licence. The notice, kept here as it asks, reads: "THE BEER-WARE LICENSE" (Revision 42): florian.melsheimer@gmx.de wrote this file. As long as you retain this notice you can do whatever you want with this stuff. If we meet some day, and you think this stuff is worth it, you can buy me a beer in return. Florian Melsheimer. The notice sits in `PID-Analyzer.py`, and no separate licence covers the example logs. So only this 64 KB excerpt is stored, as a test vector.
- **`.official.json`:** what the official decoder, `blackbox_decode`, makes of the excerpt. It was built from https://github.com/betaflight/blackbox-tools master `f832acf9cd9dbe5ad8220de1a5f4eb4021523d72` and run with `--unit-vbat raw --unit-amperage raw --unit-flags raw`. The file keeps the column list, the row count, a SHA-256 over all rows in canonical form, and the first and last rows. `tools/blackbox/scripts/make-vectors.ts` writes it. The official tool also emits the frame cut by the excerpt's end, with its missing bytes read as zero, so the vector leaves that frame out (`--drop-last`).
- **Checked by:** `tools/blackbox/test/decode.test.ts`. Our decoder must reproduce all 2,130 rows x 35 columns exactly. It also emits 3 extra rows. These follow a flight-mode event (type 30), which this `blackbox_decode` does not know, so the official tool drops the frames up to the next I-frame.

## Not stored: the Betaflight 4.5.1 validation log

The end-to-end check on a modern log used `20_9_2026_bfl/LOG00002.BFL` from https://github.com/aprskalo1/betaflight-blackbox-analyzer at commit `e1f2149346f0f8ea7df1d5e007809e002b7b18ec`. That repository states no licence. Its SHA-256 is `db7b2541a87715145699cf7cf3004a6514fa6fe5ce25e20537621ffe2f7d9d52` and its size 11,774,209 bytes. Only the comparison numbers are kept: `evidence/2026-09-28/v03-blackbox-decoder.json`. To repeat the check, download the file and run:

```bash
blackbox_decode --unit-vbat raw --unit-amperage raw --unit-flags raw LOG00002.BFL
npx tsx tools/blackbox/src/cli.ts compare LOG00002.BFL LOG00002.01.csv --gps LOG00002.01.gps.csv
```
