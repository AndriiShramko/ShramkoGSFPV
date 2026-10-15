# Phase E — real radio and camera latency (stand and 5-step instruction)

Everything before phase E was measured with a **simulated** EdgeTX radio (SimRadio) and with operating-system input injection. Phase E measures the parts no script can: the radio's own USB/mixer path, the real HID stack, and the panel's response. It covers two controllers — the RadioMaster (EdgeTX, WebHID) and the DJI controller (WebHID, or the Gamepad API) — and needs a person with both for about twenty minutes.

## Stand

- The radio (RadioMaster with EdgeTX; note model and EdgeTX version) on USB, **Joystick mode**, RF module **off** (1 kHz reports) — then once more with RF on. It connects with the **Radio or controller over USB (EdgeTX, DJI)** button (WebHID).
- The DJI controller (note model and firmware version) on its USB-C cable, switched on. Connect it with the **Radio or controller over USB (EdgeTX, DJI)** button and pick it in the browser's list ("HID Interface" on Windows, "DJI Virtual Joystick" on macOS and Linux): since 2026-10-15 the WebHID path reads any HID joystick or gamepad through its report descriptor (the DJI RC 3 sends 13-byte reports the EdgeTX layout refused; docs/research/radios/dji-rc3.md). The **Gamepad or radio as gamepad** button connected it in Chrome 152 (the wizard was not finished there; in Chrome 140 no pad was exposed at rest; docs/research/radios/dji-rc3.md).
- A phone or camera filming at **240 fps**, fixed on a stand so that one frame shows both the stick and the monitor.
- The simulator opened at `/en/fly/?scene=39e63ce9&lat=1` in desktop Chrome, monitor at its highest refresh rate, variable refresh off, nothing heavy on the GPU (close video editors).
- A bright LED or the controller's own screen in the shot is optional; the stick itself is the event.

## Five steps

1. Run the calibration wizard with the RadioMaster and save the profile; note the report rate the wizard shows. Reload, then do the same with the DJI controller through the USB button (WebHID), and once through **Gamepad or radio as gamepad** (if the wizard does not see it, move a stick first — browsers expose a gamepad only after an input — and write down what happened).
2. Start the 240 fps recording; flick the roll stick of the RadioMaster from centre to full and back **20 times**, one second apart.
3. Do the same 20 flicks with the RadioMaster's RF on, then 20 flicks with the DJI controller (one recording each).
4. Send the three video files (or put them next to the repo in `.cache/phase-e/`); the agent counts frames from the first stick movement to the first change of the black/white latency marker in the picture.
5. Write down: RadioMaster model and EdgeTX version, DJI controller model and firmware, monitor refresh rate — the agent reports median / p95 stick-to-photon latency per controller and compares it with the SendInput method on the same machine.
