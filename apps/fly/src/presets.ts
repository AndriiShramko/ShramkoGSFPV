import type { PresetJson } from '@gsfpv/sim-core';
import pavo20pro3s from '@gsfpv/sim-core/presets/pavo20pro-3s.json';
import pavo20pro23s from '@gsfpv/sim-core/presets/pavo20pro2-3s.json';
import pavo20pro24s from '@gsfpv/sim-core/presets/pavo20pro2-4s.json';
import pavopico2s from '@gsfpv/sim-core/presets/pavopico-2s.json';
import meteor65pro1s from '@gsfpv/sim-core/presets/meteor65pro-1s.json';
import air651s from '@gsfpv/sim-core/presets/air65-1s.json';

export const DEFAULT_PRESET = 'pavo20pro-3s';

export const PRESETS: Record<string, PresetJson> = {
    'pavo20pro-3s': pavo20pro3s as PresetJson,
    'pavo20pro2-3s': pavo20pro23s as PresetJson,
    'pavo20pro2-4s': pavo20pro24s as PresetJson,
    'pavopico-2s': pavopico2s as PresetJson,
    'meteor65pro-1s': meteor65pro1s as PresetJson,
    'air65-1s': air651s as PresetJson
};
