# Security and safety

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **zmei116@gmail.com** with a description and steps to reproduce. You will get an answer within a few days.

## What the app does with your data and devices

- **Radio / gamepad access (WebHID, Gamepad API).** The browser asks your permission before the app can read a HID device. The app only reads stick and switch positions; it never writes to the radio.
- **Calibration profiles and flight history** are stored locally in your browser (localStorage). Nothing is uploaded.
- **Scenes** are loaded from their publishers (SuperSplat CDN). Their authors' licences apply.
- **Analytics** (on the public site only) run after consent, per EU rules.

## Physical safety

This is a simulator. Time in the simulator does not make a real flight legal or safe: follow your local drone regulations, fly real drones only where allowed, and never practise over people. See [`docs/warnings.md`](docs/warnings.md) for known limits of the simulation, including photosensitivity and motion-sickness notes.
