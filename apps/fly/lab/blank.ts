// Latency floor control: an empty page that repaints the same 4-cell marker from the keydown
// handler (DOM, no WebGPU, no physics). Whatever latency this shows is the browser + compositor +
// display floor that no simulator can beat on this machine.
const q = new URLSearchParams(location.search);
const nonce = q.get('nonce') ?? '';
const cells: HTMLDivElement[] = [];
for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${(i % 2) * 8}px;top:${(i >> 1) * 8}px;width:8px;height:8px;background:#000`;
    document.body.append(d);
    cells.push(d);
}
let id = 0;
const records: { id: number; tEvent: number; tHandler: number }[] = [];
addEventListener('keydown', (e) => {
    if (e.code === 'F24' || e.key === 'F24') {
        fetch('/report', { method: 'POST', body: JSON.stringify({ page: 'blank', records, visibility: document.visibilityState, userAgent: navigator.userAgent }) })
            .then(() => { document.title = `GSFPV-LAT ${nonce} reported`; });
        return;
    }
    if (!/^F(1[3-9]|2[0-3])$/.test(e.code) && !/^F(1[3-9]|2[0-3])$/.test(e.key)) return;
    id++;
    const v = id % 16;
    for (let i = 0; i < 4; i++) cells[i].style.background = (v >> i) & 1 ? '#fff' : '#000';
    records.push({ id, tEvent: e.timeStamp, tHandler: performance.now() });
    e.preventDefault();
}, { capture: true });
document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;

export {};
