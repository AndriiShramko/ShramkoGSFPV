// Starts apps/api/tests/rig_server.py for the browser runs of Fly by Sound's sending and admin (sonicrec-upload.ts, sonicrec-admin.ts): a LOCAL copy of
// the recordings' API (the real handler, store and delivery workers, a fake Telegram and a fake SMTP on this machine) on free ports, with a control
// port for what a real outside would do (a channel failing, the clock moving, a restart). See the head of rig_server.py.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './sonicrec-serve';

export interface Rig {
    readonly api: number;
    readonly control: number;
    readonly data: string;
    /** GET (no body) or POST (a body) on the control port; the answer's JSON */
    ctl(path: string, body?: object): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    state(): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    stop(): Promise<void>;
}

/**
 * `adminPassword`: a TEST password for the owner's admin on this copy (never the live admin's). `apiPort` and `controlPort`: the two
 * ports, when a run has to keep to a range (the end-to-end run of Fly by Sound); else free ones the system picks.
 */
export async function startRig(dataDir: string, options: { adminPassword?: string; apiPort?: number; controlPort?: number } = {}): Promise<Rig> {
    const python = process.env.PYTHON ?? 'python';
    const args = ['-X', 'utf8', join(REPO, 'apps', 'api', 'tests', 'rig_server.py'), '--data', dataDir];
    if (options.adminPassword !== undefined) args.push('--admin-password', options.adminPassword);
    if (options.apiPort !== undefined) args.push('--api-port', String(options.apiPort));
    if (options.controlPort !== undefined) args.push('--control-port', String(options.controlPort));
    const proc: ChildProcess = spawn(python, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const info: { api: number; control: number; data: string } = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the rig did not start')), 30000);
        let buf = '';
        proc.stdout?.on('data', (b: Buffer) => {
            buf += b.toString();
            if (buf.includes('\n')) {
                clearTimeout(timer);
                resolve(JSON.parse(buf.split('\n')[0] as string));
            }
        });
        proc.on('exit', (code) => reject(new Error(`the rig exited ${code}`)));
    });
    const ctl = async (path: string, body?: object): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = await fetch(`http://127.0.0.1:${info.control}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
        return r.json();
    };
    return {
        ...info,
        ctl,
        state: () => ctl('/state'),
        async stop() {
            proc.stdin?.end();
            await new Promise<void>((resolve) => {
                proc.once('exit', () => resolve());
                setTimeout(resolve, 5000);
            });
            proc.kill();
        }
    };
}
