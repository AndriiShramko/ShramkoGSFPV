// The legend beside the 3D model: one row per piece of equipment, in words (v0.9 lane D). Pure: the text function is
// passed in, so a Node test builds the rows of every drone in all four languages. Brand and model names are the
// makers' and are never translated; the words around them come from packages/i18n/locales/fly/drones3d.
import type { Build } from './build';
import type { Basis, FrameMaterial } from './equipment';
import type { CalloutId } from './kit';
import { PAYLOADS } from './payloads';

export type Say = (key: string, vars?: Record<string, string | number>) => string;

export interface CalloutRow {
    id: CalloutId;
    /** "Motors", "Propellers"... */
    label: string;
    /** the maker's name for the part (or "None") */
    title: string;
    /** short facts, already in words */
    facts: string[];
    /** how sure the table is of this row (equipment.ts) */
    basis: Basis;
    /** the page that says it */
    ref?: string;
    /** the row says the drone carries nothing of this kind */
    none?: boolean;
}

const MATERIAL_KEY: Readonly<Record<FrameMaterial, string>> = { carbon: 'd3.m.carbon', pa12: 'd3.m.pa12', tpu: 'd3.m.tpu', plastic: 'd3.m.plastic', aluminium: 'd3.m.aluminium' };

const round = (v: number): string => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const two = (n: number): string => String(n).padStart(2, '0');

/** The legend of a build: frame, motors, propellers, battery, the FPV camera (and transmitter), the action camera, the cinema camera. */
export function calloutRows(b: Build, say: Say): CalloutRow[] {
    const e = b.equipment;
    const rows: CalloutRow[] = [];
    const ducted = b.family === 'cinewhoop' || b.family === 'tiny-whoop';
    rows.push({
        id: 'frame', label: say('d3.l.frame'), title: e.frame.name, basis: e.frame.basis, ref: e.frame.ref,
        facts: [
            say('d3.f.wheelbase', { mm: round(b.wheelbaseMm) }),
            say(ducted ? 'd3.f.ducted' : b.family === 'x8' ? 'd3.f.coaxial' : 'd3.f.open'),
            say('d3.f.madeOf', { list: e.frame.materials.map((m) => say(MATERIAL_KEY[m])).join(', ') })
        ]
    });
    const motors = b.family === 'x8' ? 8 : 4;
    rows.push({
        id: 'motors', label: say('d3.l.motors'), title: `${e.motor.name} ${b.motorKv} KV`, basis: e.motor.basis, ref: e.motor.ref,
        facts: [say('d3.f.stator', { size: `${two(e.motor.stator[0])}${two(e.motor.stator[1])}` }), say('d3.f.count', { n: motors })]
    });
    rows.push({
        id: 'props', label: say('d3.l.props'), title: e.prop.name, basis: e.prop.basis, ref: e.prop.ref,
        facts: [say('d3.f.diameter', { mm: round(b.propDiameterMm) }), say('d3.f.blades', { n: e.prop.blades })]
    });
    rows.push({
        id: 'battery', label: say('d3.l.battery'), title: `${b.cells}S ${b.mah} mAh`, basis: e.battery.basis, ref: e.battery.ref,
        facts: [say('d3.f.connector', { name: e.battery.connector }), say(e.battery.mount === 'top' ? 'd3.f.packTop' : 'd3.f.packBottom')]
    });
    const v = e.video;
    const tilt = v.tilt ? say('d3.f.tilt', { min: v.tilt[0], max: v.tilt[1], now: round(b.tiltDeg) }) : null;
    if (v.kind === 'analog') {
        rows.push({ id: 'camera', label: say('d3.l.camera'), title: v.name, basis: v.basis, ref: v.ref, facts: [say('d3.f.analog'), ...(tilt ? [tilt] : [])] });
        if (v.vtx) rows.push({ id: 'vtx', label: say('d3.l.vtx'), title: v.vtx, basis: v.vtxBasis ?? v.basis, ref: v.ref, facts: [say('d3.f.analog')] });
    } else {
        rows.push({ id: 'camera', label: say('d3.l.cameraLink'), title: v.name, basis: v.basis, ref: v.ref, facts: [say('d3.f.digital'), say('d3.f.records'), ...(tilt ? [tilt] : [])] });
    }

    // the action camera: only the cinelifter may carry one (a GoPro from its payload choice); the rest carry none
    const pay = b.payload ? PAYLOADS[b.payload] : null;
    if (pay && pay.kind === 'action') {
        rows.push({ id: 'action', label: say('d3.l.action'), title: pay.name ?? '', basis: pay.basis, ref: pay.ref, facts: [say('d3.f.load', { g: pay.loadG })] });
    } else {
        rows.push({
            id: 'action', label: say('d3.l.action'), title: say('d3.f.none'), basis: 'maker', none: true,
            facts: [v.records ? say('d3.f.noneRecords', { name: v.name }) : say('d3.f.noneCarried')]
        });
    }
    if (b.payload) {
        const p = PAYLOADS[b.payload];
        if (p.kind === 'cinema') {
            rows.push({
                id: 'payload', label: say('d3.l.payload'), title: p.name ?? '', basis: p.basis, ref: p.ref,
                facts: [say('d3.f.load', { g: p.loadG }), say('d3.f.body', { w: round(p.sizeMm![0]), h: round(p.sizeMm![1]), d: round(p.sizeMm![2]) }), say('d3.f.maxPayload', { kg: 3 })]
            });
        } else if (p.kind === 'none') {
            rows.push({ id: 'payload', label: say('d3.l.payload'), title: say('d3.f.none'), basis: 'maker', ref: p.ref, none: true, facts: [say('d3.f.noCamera', { g: b.auwG - (b.presetPayloadG ?? 0) }), say('d3.f.maxPayload', { kg: 3 })] });
        }
    }
    return rows;
}

/** The words that turn the bare facts into the truth about the cinelifter: sold without a camera, what this preset carries. */
export function cinelifterNote(b: Build, say: Say): string | null {
    if (b.family !== 'x8' || b.presetPayloadG === null) return null;
    const assumed = PAYLOADS.komodo;
    return say('d3.cine.note', { camera: assumed.name ?? '', g: b.presetPayloadG, maker: b.auwG - b.presetPayloadG });
}
