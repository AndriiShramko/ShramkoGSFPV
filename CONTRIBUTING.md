# Contributing to ShramkoGSFPV

Thanks for your interest. The project is pre-alpha, so the rules are few and practical.

## What helps most right now

1. **Measurements on other hardware.** Run the harness in [`tools/probe/`](tools/probe/README.md) on a non-NVIDIA GPU, a Mac, or a 144/240 Hz display and open an issue with the JSON result. Always include the idle cadence line — it is the negative control that tells us whether a frame number means anything.
2. **Radios in USB joystick mode.** Tell us the radio, firmware version, how many axes the browser sees and in what order.
3. **Flight-model review.** If you tune real quads, check the physics notes in [`docs/decisions.md`](docs/decisions.md) and tell us what would feel wrong.

## Ground rules

- **No number without a measurement.** If you report a figure, say how you measured it. Estimates are welcome when labelled as estimates.
- **No GPL code.** The project is MIT so it can be contributed back upstream. Formulas are fine; copied GPL source is not.
- **No secrets, no private scans.** Never commit keys, tokens, `.env` files or scans of private homes you do not own the rights to.
- **English only** in code, comments, issues and docs.
- Small pull requests with a clear description beat big ones.

## Licence of contributions

By submitting a contribution you agree that it is licensed under the project's [MIT License](LICENSE).

## Contact

Andrii Shramko — [LinkedIn](https://www.linkedin.com/in/andrii-shramko/) · [book a call](https://calendar.app.google/Ff729HqGk4RpzPNDA) · zmei116@gmail.com
