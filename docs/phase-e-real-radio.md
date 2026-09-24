# Phase E — real radio and camera latency (stand and 5-step instruction)

Everything before phase E was measured with a **simulated** EdgeTX radio (SimRadio) and with operating-system input injection. Phase E measures the parts no script can: the radio's own USB/mixer path, the real HID stack, and the panel's response. It needs a person with the radio for ten minutes.

## Stand

- The radio (RadioMaster with EdgeTX; note model and EdgeTX version) on USB, **Joystick mode**, RF module **off** (1 kHz reports) — then once more with RF on.
- A phone or camera filming at **240 fps**, fixed on a stand so that one frame shows both the stick and the monitor.
- The simulator opened at `/en/fly/?scene=39e63ce9&lat=1` in desktop Chrome, monitor at its highest refresh rate, variable refresh off, nothing heavy on the GPU (close video editors).
- A bright LED or the radio's own screen in the shot is optional; the stick itself is the event.

## Five steps

1. Run the calibration wizard with the real radio and save the profile; note the report rate the wizard shows.
2. Start the 240 fps recording; flick the roll stick from centre to full and back **20 times**, one second apart.
3. Stop recording; do the same 20 flicks with RF on.
4. Send the two video files (or put them next to the repo in `.cache/phase-e/`); the agent counts frames from the first stick movement to the first change of the black/white latency marker in the picture.
5. Write down: radio model, EdgeTX version, monitor refresh rate — the agent reports median / p95 stick-to-photon latency and compares it with the SendInput method on the same machine.
