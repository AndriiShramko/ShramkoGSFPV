// int4 car 3: gen4b's Shift+G (and the pause menu's Generate) opens the Generate dialog first, outside Fly by Sound;
// nothing is built or replaced before its Build. Probes that want a course the old way press Shift+G, then Build by
// mouse. In the sound mode (?sonic= or Backslash) Shift+G still builds at once: there no dialog comes and these return
// false after `timeout` ms. Read-only: the dialog's Build only lays a course in the tab.

/** Waits for the Generate dialog and presses its Build; true when it was pressed. */
export async function buildFromDialog(page, timeout = 4000) {
    return page.waitForSelector('[data-testid=gen-dialog]', { timeout }).then(
        () => page.locator('[data-testid=gen-dialog] [data-action="gen-build"]').click().then(() => true),
        () => false
    );
}

/** Shift+G as a pilot makes a course now: the key, then the dialog's Build. */
export async function shiftG(page, timeout = 4000) {
    await page.keyboard.press('Shift+KeyG');
    return buildFromDialog(page, timeout);
}
