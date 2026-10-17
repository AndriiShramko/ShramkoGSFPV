# Drone models: what each preset carries, and what the 3D view shows

Research notes, 2026-10-17, for the owner's item 3a of message 22 (`docs/wip/v09-plan.md`): "beautiful 3D models of the
drones, rendered in the browser, so users see which drone they fly, what equipment is on it, which cameras (does the
cinelifter carry a RED or Blackmagic camera or not)". Code: `apps/fly/src/drones3d/`; the equipment table is
`apps/fly/src/drones3d/equipment.ts`, which cites the rows below. Nothing here is endorsed by any maker.

Every equipment fact has a **basis**:

| basis | meaning |
|---|---|
| `maker` | stated on the maker's own product page (link given) |
| `listing` | stated by a retailer that reproduces the maker's sheet (the maker's page was unreachable) |
| `typical` | the maker does not say; what builds of this class usually carry. Shown as "typical" in the callouts |

Numbers the presets already hold (wheelbase, prop diameter, cells, mAh, KV, masses) are read from
`packages/sim-core/presets/*.json`, never copied. Shapes, sizes of parts and proportions follow the published
dimensions where there are any; colours, finishes, screws, wires and logos are stylised (no maker's livery is
reproduced), and the pack sizes are computed from capacity (section 5).

## 1. The cinelifter: does the Taurus X8 carry a RED or a Blackmagic camera?

iFlight sells the Taurus X8 V3 O4 6S **without a camera** (https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973,
read 2026-10-17):

- "Built for DSLR or cinema cameras", with the examples **Red Komodo, Zcam and BMPCC**; the photographed camera "is for
  display only and is not included". Maximum payload **3 kg**.
- Accessories are cables for the cameras' power: XT60H to RED Komodo, Z CAM E2, BMPCC 4K/6K. No GoPro or mirrorless
  camera is named for this product.
- Weight 1989 +- 10 g, take-off weight about 2872 +- 10 g with the Fullsend 6S 5600 mAh 95C pack (XT90; "a counterweight
  as well as the power source"): **both exclude the camera**. Hover time "approx. 5.5 min with a **2 kg** load".
- 400 mm wheelbase, 337 x 330 x 112 mm, 8 x XING2 3110 1250KV, HQ 8x4x3 props, two BLITZ E80 4-in-1 ESCs, BLITZ H7 Pro,
  **DJI O4 Air Unit Pro** as the FPV camera/link, two Albatross LHCP antennas, pre-installed GPS, integrated TPU landing
  gear, an adjustable CNC aluminium camera mount (5-35 deg) on a silicon-ball dampened carbon camera base.

What the preset assumes (`taurusx8-komodo-6s.json`, v0.8 note `drones-v08.md`): auw 4872 g = 2872 g + **2000 g camera
load**, the load of iFlight's own hover-time figure; a RED Komodo 6K body is about 950 g, the rest is lens, media, ND
filter and plate. So the physics **does** carry a cinema camera, a Komodo-class rig. The model therefore shows a RED
Komodo with a lens on the camera mount, and the payload choice (section 4) lets the pilot change it.

Camera data used for the model and the payload choice:

| Camera | Weight | Size | Source |
|---|---|---|---|
| RED KOMODO 6K body | 2.10 lb = 952 g (without body cap and CFast card) | 4 x 4 x 4 in (101.6 mm cube), Canon RF mount, Super35 27.03 x 14.26 mm | Lensrentals https://www.lensrentals.com/rent/red-komodo-6k-monochrome-standard, AbelCine https://www.abelcine.com/buy/cameras-accessories/digital-cinema-cameras/red-komodo-6k-digital-cinema-camera-rf-mount-2 (`listing`; RED's own spec page was not readable) |
| Blackmagic Pocket Cinema Camera 6K Pro body | 2.73 lb = 1238 g | 7.08 x 4.41 x 4.84 in (180 x 112 x 123 mm), active EF mount, Super35 23.10 x 12.99 mm, NP-F570 battery | Blackmagic tech specs (sensor, mount, battery: https://www.blackmagicdesign.com/products/blackmagicpocketcinemacamera/techspecs/W-CIN-12; the weight and size are an image there) and retail listings (Micro Center, Shopmoment) (`listing`) |
| GoPro HERO13 Black | 154 g with mounting fingers and battery (121 g without) | 71.8 x 50.8 x 33.6 mm | retail copies of GoPro's sheet (`listing`; gopro.com did not answer) |

## 2. The nine presets

For each: what the maker's page says, what the preset's mass assumes, what the model draws. "Action camera" is a
camera other than the FPV camera; where the FPV unit itself records (DJI O3/O4) it is not an extra camera.

### Ducted 2.2" and 1.8" HD cinewhoops (BetaFPV)

| | Pavo20 Pro 3S (default) | Pavo20 Pro II 3S / 4S | Pavo Pico 2S |
|---|---|---|---|
| Frame | PA12 "thickened whoop ducts", carbon plate, 93.7 mm wheelbase, 20 mm battery slot | PA12 ducts, redesigned carbon plate, 93.9 mm | PA12, 80.8 mm, HD bracket and duct lowered from 60.6 to 51.5 mm |
| Motors | LAVA 1104 7200KV (stator 11 x 04) | LAVA 1104 7200KV (3S) / 5500KV (4S) | 1102 14000KV (stator 11 x 02) |
| Props | Gemfan 2218 3-blade, 1.5 mm shaft | GF D2.2 3-blade | GF 45 mm 3-blade |
| Battery | 3S 550 mAh LAVA 75C, XT30 | 3S 580 / 4S 580 mAh LAVA II, XT30 | 2S 450 mAh LAVA 75C |
| FPV / video | digital HD only: **DJI O4 Air Unit Pro** (O4 Pro version) or O3 on the PNP; bracket tilts 0-40 deg | **DJI O4 Air Unit Pro** (O4, O4 Wide also supported), bracket 0-40 deg | digital HD: O3 / Avatar / Vista / Runcam Link; camera "movable angle within 30 deg"; O3 unit on a carbon plate with 4 rubber dampers |
| FC / ESC | F4 2-3S 20A AIO | F4 2-3S 20A AIO (3S), Cube 3IN1 2-4S 30A (4S) | F4 2-3S 20A AIO |
| Action camera | none mentioned | none mentioned | none mentioned |
| Preset mass assumes | 151 g: 108 g measured with an O3 + 43.2 g pack; Oscar Liang weighed about 150 g with the O4 Pro | 158 g: 116.2 g with the O4 Pro + 42 g pack | 99 g: 71.2 g with an O3 + 27 g pack |
| Model draws | O4 Air Unit Pro (module 33.5 x 33.5 x 13 mm, camera 25.55 x 20 x 23.3 mm), 4 ducts, top-mounted pack | same, 4S variant labelled | O3 Air Unit (module 32.5 x 30.5 x 14.5 mm, camera 21.2 x 20 x 19.5 mm) |
| Sources | https://betafpv.com/products/pavo20-pro-brushless-whoop-quadcopter, Oscar Liang https://oscarliang.com/betafpv-pavo20-pro-dji-o4-pro/ | https://betafpv.com/products/pavo20-pro-ii-brushless-whoop-quadcopter | https://betafpv.com/products/pavo-pico-brushless-whoop-quadcopter |
| Basis | `maker` | `maker` | `maker` (the camera system the preset's mass uses: the O3, 71.20 g) |

Neither page mentions a GoPro, naked GoPro or Insta360: a 2.2-inch whoop at 150 g does not carry one (the O4 Pro is
itself a 1/1.3-inch 4K camera). **Typical, not stated**: the top-mounted pack with a strap; the rear antenna.

### 65 mm tiny whoops (BetaFPV, analog, 1S)

| | Meteor65 Pro | Air65 (freestyle version) |
|---|---|---|
| Frame | 65 mm brushless whoop frame with ducts (85 mm over the ducts), canopy tilt 30 deg (20 optional) | 65 mm, frame 2.67 g, "Air Canopy" tilt 25-50 deg, **no duct is listed** |
| Motors | 0802SE 19500KV | 0702SE II 23000KV |
| Props | 35 mm 3-blade | HQ 31 mm Ultralight 3-blade (1 mm shaft) |
| Battery | 1S 300 mAh, BT2.0 | LAVA 1S 260 mAh, BT2.0 |
| FPV / video | **C03 FPV camera + M03 25-350 mW VTX** (analog) | **C03 camera (1.45 g) + onboard 5.8G 25-400 mW VTX** |
| FC | F4 1S 5A (ELRS or SPI Frsky) | Air 5-in-1 G473, ICM42688P, 3.6 g |
| Weight | 23.01 g without battery | 17.3 g |
| Action camera | none (65 mm whoop, 30 g) | none |
| Sources | `listing`: GetFPV (https://www.getfpv.com/drone-brands/betafpv/betafpv-meteor65-pro-brushless-whoop-quadcopter-2022.html), TinyWhoop (https://www.tinywhoop.com/products/meteor65-pro-2022); BetaFPV's own page answered 404 | `maker`: https://betafpv.com/products/air65-brushless-whoop-quadcopter |

**Typical, not stated**: the Air65's guards (the page lists none; modelled as a thin-wall ring, the usual 65 mm
whoop frame, marked typical); the pack hung under the board on both (the usual place for a 1S whoop pack).

### 5-inch quads (iFlight, open props)

| | Nazgul Evoque F5 V3 O4 Pro 6S (freestyle) | Mach R5 Sport 6S (race, analog) |
|---|---|---|
| Frame | injection-moulded parts (replacing TPU-printed ones), DeadCat (default, 236 mm) / True X (switchable, 239 mm); 230 x 207 x 54 mm (DC) / 207 x 199 x 54 mm (X) | 210 mm wheelbase, 148 x 148 x 51 mm; carbon panels with plastic parts, canopy of carbon plate and TPU, 20 x 20 stack |
| Motors | XING2 2207 1750KV (stator 22 x 07; listings: phi 29 x 19.25 mm, 5 mm shaft, 16 x 16 mount) | R5 2207 2050KV |
| Props | Nazgul F5 5.1 x 3.5, 3 blades | Nazgul R5 V2 5.1 x 3.8, 3 blades |
| Battery | 6S 1480 mAh (not included), 2 straps + pad | 6S 1400 mAh (not included), strap + pad |
| FPV / video | **DJI O4 Air Unit Pro** (1/1.3 inch, 155 deg, camera tilt 10-45 deg, module 33.5 x 33.5 x 13 mm, about 32 g), two 5.8 GHz antennas, ELRS | analog: **BLITZ Force VTX 600 mW** (29 x 29 mm, 4 g, MMCX), camera "iFlight" with no model named, one antenna, BLITZ Mini F722, E55R ESC |
| Action camera | **none included**; iFlight sells a "GoPro 9/10/11 TPU Mount" as an accessory; weights (492 / 736 g) exclude one | none |
| Preset mass assumes | 736 g (6S 1480 mAh, no GoPro) | 525 g (6S 1400 mAh) |
| Model draws | True X as flown by the preset (symmetric 239 mm X), O4 Air Unit Pro, no action camera | 210 mm True X, generic micro analog camera (typical, model not named), BLITZ-size VTX |
| Sources | https://shop.iflight.com/Nazgul-Evoque-F5-V3-O4-6S-HD-Pro2397, https://www.defiancerc.com/products/iflight-nazgul-evoque-f5-v3-o4-6s-hd-bnf, motor https://www.getfpv.com/iflight-xing2-2207-motor-w-logos-1750kv.html | https://fpv24.com/en/iflight/iflight-mach-r5-sport-6s-race-drone-copter-fpv-pnp (+ retail copies of the VTX line) |
| Basis | `maker` | `maker` except the camera (`typical`) |

The Mach R5 Sport is also sold with HDZero (HDZero Race V3 VTX + Nano 90 camera); the preset's mass (525 g) is the
analog PNP's. The GetFPV page (Cloudflare) could not be read; the camera line comes from search snippets.

### X8 cinelifter (iFlight Taurus X8 V3 O4 6S with a RED Komodo): section 1. Basis `maker`; the camera rig is the
preset's own assumption (2000 g load), the lens is `typical` (a compact RF/EF prime or zoom; the maker names none).

## 3. How the shapes follow the numbers

- Motor-to-motor diagonal = the preset's `wheelbase_mm`; prop disc = `prop_diameter_mm` (or, for the ducted whoops
  and tiny whoops, the size named in the prop string: 2218 = 2.2 in, 45 mm, 35 mm, 31 mm); blades from the prop
  string; motor stator from its name (11 x 04, 11 x 02, 08 x 02, 07 x 02, 22 x 07, 31 x 10; the first two digits are the
  stator diameter, the last two its height, mm); motor can sizes are the listings' where there are some (XING2 2207:
  29 x 19.25 mm; XING2 3110: 38.72 x 24.6 mm, rcdrone.top) and the stator plus the usual 1-3 mm elsewhere (`typical`).
- DJI O3 / O4 Pro units are modelled at their published module and camera sizes (sections above).
- Pack size is computed, not looked up: volume = energy / 0.30 Wh per cm^3 (the density of a racing pack, 6S 1400 mAh:
  31 Wh -> 104 cm^3, close to the usual 75 x 35 x 40 mm), with the proportions of the class (a tall narrow pack for the
  whoops, a long flat one for the 5-inch, a block for the X8). Marked `typical`; no pack dimension is shown as a number.

## 4. The cinelifter payload choice

Options (default = what the preset assumes, so the A6 hash and every number of today are unchanged):

| Choice | Payload (g) | How |
|---|---|---|
| RED Komodo 6K rig (default) | 2000 | the preset's own `payload_g`: body 950 g + lens, media, ND and plate |
| Blackmagic Pocket Cinema Camera 6K Pro rig | 2288 | body 1238 g + the same 1050 g allowance for lens, media and plate |
| GoPro HERO13 Black | 154 | the maker's body weight with its battery; no cage |
| none | 0 | iFlight's own take-off weight, 2872 g |

The motors do not change, so the thrust stays the preset's (T = 3.3 x 4.872 kg x g); the thrust-to-weight, hover
throttle, climb and inertia follow the mass (section 6 of `docs/wip/v09-d.md`, `sim-core` `payloadG`). The 1050 g
allowance is the preset's own estimate, not a maker figure; the maximum payload (3 kg) is the maker's.

## 5. Not verified

- The maker pages for the Meteor65 Pro (404) and the Mach R5 Sport camera (Cloudflare) were not readable; the model of
  the racer carries a generic micro analog camera and says so.
- No weight of the DJI O4 Air Unit Pro camera module alone beyond the DJI store's 16.4 g; the X8 and Evoque use the
  whole unit (about 32 g, iFlight).
- Layouts the makers do not state (where the pack and the antenna sit, wiring, screws, colours) are stylised.
- No photograph of a real build was used; the pictures are made from dimensions and parts lists.

## Sources

- iFlight Taurus X8 V3 O4 6S: https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973
- iFlight Nazgul Evoque F5 V3 O4 6S: https://shop.iflight.com/Nazgul-Evoque-F5-V3-O4-6S-HD-Pro2397
- Defiance RC listing of the Evoque: https://www.defiancerc.com/products/iflight-nazgul-evoque-f5-v3-o4-6s-hd-bnf
- Mach R5 Sport: https://fpv24.com/en/iflight/iflight-mach-r5-sport-6s-race-drone-copter-fpv-pnp
- BetaFPV Pavo20 Pro, Pavo20 Pro II, Pavo Pico, Air65 product pages (links in section 2)
- XING2 2207: https://www.getfpv.com/iflight-xing2-2207-motor-w-logos-1750kv.html; XING2 3110: https://rcdrone.top/pl/products/iflight-xing2-3110-fpv-motor
- DJI O4 Air Unit Pro camera module: https://store.dji.com/product/dji-o4-air-unit-pro-camera-module
- RED Komodo 6K: AbelCine, Lensrentals (links in section 1); Blackmagic Pocket Cinema Camera 6K Pro tech specs (section 1)
- The v0.8 note on the presets: `drones-v08.md`
