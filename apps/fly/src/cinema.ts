// Cinema mode (phase D): full detail, no quality governor, and a video recorder built on WebCodecs.
// Recording is offered only for showcase scenes (their author agreed to it), and every recorded
// frame carries the scene credit burned into the picture, so a clip shared anywhere keeps it.
// WebCodecs' VideoEncoder encodes; Mediabunny (MPL-2.0) only writes the MP4 container.
import { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } from 'mediabunny';

export interface RecorderInfo {
    codec: string;
    width: number;
    height: number;
    frames: number;
    bytes: number;
    seconds: number;
}

/** Pick the first codec this browser can encode at this size (H.264 first: plays everywhere). */
async function pickCodec(width: number, height: number): Promise<{ muxCodec: 'avc' | 'vp9'; config: VideoEncoderConfig } | null> {
    const candidates: { muxCodec: 'avc' | 'vp9'; codec: string }[] = [
        { muxCodec: 'avc', codec: 'avc1.640033' }, // High, level 5.1: up to 4K
        { muxCodec: 'avc', codec: 'avc1.42003e' },
        { muxCodec: 'vp9', codec: 'vp09.00.51.08' }
    ];
    for (const c of candidates) {
        const config: VideoEncoderConfig = { codec: c.codec, width, height, bitrate: Math.round(width * height * 30 * 0.15), framerate: 30, latencyMode: 'quality' };
        try {
            const s = await VideoEncoder.isConfigSupported(config);
            if (s.supported) return { muxCodec: c.muxCodec, config };
        } catch { /* try the next one */ }
    }
    return null;
}

export class CinemaRecorder {
    private output: Output<Mp4OutputFormat, BufferTarget> | null = null;
    private track: EncodedVideoPacketSource | null = null;
    private writes: Promise<void> = Promise.resolve();
    private encoder: VideoEncoder | null = null;
    private comp: OffscreenCanvas;
    private ctx: OffscreenCanvasRenderingContext2D;
    private t0 = -1;
    private frames = 0;
    private codec = '';
    readonly credit: string;
    readonly width: number;
    readonly height: number;
    recording = false;
    /** luminance spread of the credit strip in the last composed frame (acceptance check) */
    lastCreditStripStd = 0;

    constructor(width: number, height: number, credit: string) {
        // even sizes: H.264 needs them
        this.width = width & ~1;
        this.height = height & ~1;
        this.credit = credit;
        this.comp = new OffscreenCanvas(this.width, this.height);
        this.ctx = this.comp.getContext('2d', { willReadFrequently: false })!;
    }

    static get supported(): boolean {
        return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    }

    async start(): Promise<string> {
        const pick = await pickCodec(this.width, this.height);
        if (!pick) throw new Error('no WebCodecs video encoder for this size');
        this.codec = pick.config.codec;
        this.output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
        const track = new EncodedVideoPacketSource(pick.muxCodec);
        this.track = track;
        this.output.addVideoTrack(track, { frameRate: 30 });
        await this.output.start();
        this.writes = Promise.resolve();
        // packets must reach the container in decode order: chain the writes
        this.encoder = new VideoEncoder({ output: (chunk, meta) => { const pkt = EncodedPacket.fromEncodedChunk(chunk); this.writes = this.writes.then(() => track.add(pkt, meta)); }, error: (e) => { this.recording = false; console.error('encoder', e); } });
        this.encoder.configure(pick.config);
        this.t0 = -1;
        this.frames = 0;
        this.recording = true;
        return this.codec;
    }

    /** Call right after the engine rendered a frame (same task), with the WebGPU canvas. */
    addFrame(source: HTMLCanvasElement, nowMs: number): void {
        if (!this.recording || !this.encoder) return;
        if (this.encoder.encodeQueueSize > 8) return; // the encoder is behind: drop, never stall the flight
        const c = this.ctx;
        c.drawImage(source, 0, 0, this.width, this.height);
        // the credit, bottom left, readable on any scene
        const fs = Math.max(14, Math.round(this.height / 40));
        c.font = `600 ${fs}px system-ui, sans-serif`;
        const pad = Math.round(fs * 0.6);
        const w = c.measureText(this.credit).width + pad * 2;
        const h = fs + pad * 2;
        const y = this.height - h - pad;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(pad, y, w, h);
        c.fillStyle = '#ffffff';
        c.textBaseline = 'middle';
        c.fillText(this.credit, pad * 2, y + h / 2);
        if (this.frames % 30 === 0) this.lastCreditStripStd = this.stripStd(pad, y, Math.min(w, this.width - pad), h);
        if (this.t0 < 0) this.t0 = nowMs;
        const frame = new VideoFrame(this.comp, { timestamp: Math.round((nowMs - this.t0) * 1000) });
        this.encoder.encode(frame, { keyFrame: this.frames % 60 === 0 });
        frame.close();
        this.frames++;
    }

    private stripStd(x: number, y: number, w: number, h: number): number {
        const d = this.ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) {
            const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            s += L; s2 += L * L; n++;
        }
        const m = s / n;
        return Math.sqrt(Math.max(0, s2 / n - m * m));
    }

    async stop(): Promise<{ bytes: Uint8Array; info: RecorderInfo }> {
        if (!this.encoder || !this.output) throw new Error('not recording');
        this.recording = false;
        await this.encoder.flush();
        this.encoder.close();
        await this.writes;
        await this.output.finalize();
        const bytes = new Uint8Array(this.output.target.buffer ?? new ArrayBuffer(0));
        const info: RecorderInfo = { codec: this.codec, width: this.width, height: this.height, frames: this.frames, bytes: bytes.length, seconds: this.t0 < 0 ? 0 : (performance.now() - this.t0) / 1000 };
        this.encoder = null;
        this.output = null;
        this.track = null;
        return { bytes, info };
    }
}
