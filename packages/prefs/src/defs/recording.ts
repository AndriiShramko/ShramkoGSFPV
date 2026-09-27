// Recording (A.8, F.1-F.2; items 14 and 19). Owner: W3-5. The folder handle itself lives in
// IndexedDB (browser.ts IdbKv 'handles'); the setting keeps only its name for the chip.
import type { SettingDef } from '../schema';

export interface FolderValue { name: string }

export function validateFolder(v: unknown): FolderValue | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const name = (v as Record<string, unknown>).name;
    return typeof name === 'string' && name.length > 0 && name.length <= 255 ? { name } : null;
}

export const RECORDING_DEFS: readonly SettingDef[] = [
    { id: 'recording.fps', group: 'recording', scope: 'global', type: 'enum', options: ['30', '60'], default: '60', apply: 'live', shown: ['cinema', 'settings'], status: 'planned', since: 1, items: [19] },
    { id: 'recording.resolution', group: 'recording', scope: 'global', type: 'enum', options: ['1080p', '1440p', '2160p', 'native'], default: '1080p', apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [19] },
    { id: 'recording.auto', group: 'recording', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['cinema'], status: 'planned', since: 1, items: [14] },
    { id: 'recording.folder', group: 'recording', scope: 'global', type: 'json', kind: 'folder', validate: validateFolder, default: null, apply: 'live', shown: ['cinema'], status: 'planned', since: 1, items: [14] },
    // nothing reaches the disk before close(), so a split bounds what a tab crash loses (F.1)
    { id: 'recording.splitMin', group: 'recording', scope: 'global', type: 'number', min: 1, max: 30, step: 1, unit: 'min', default: 10, apply: 'live', shown: ['settings'], advanced: true, status: 'planned', since: 1, items: [14] }
];
