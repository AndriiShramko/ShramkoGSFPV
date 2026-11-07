// The viewport of the Fly by Sound page (v0.12, docs/wip/v12-plan.md 4.2 step 8): apps/fly/index.html asks for no zoom
// (a flight screen must not pinch); a person who sees badly must be able to zoom the start screen, so the mode
// rewrites the tag when it opens. Kept apart from the start screen so it needs no page to be tested.

/** The viewport tag without `maximum-scale` and `user-scalable=no`. A page with no such tag is left alone. */
export function enableZoom(doc: Pick<Document, 'querySelector'> = document): void {
    doc.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
