// Output-rate probe: the whole page alternates black / white on every requestAnimationFrame.
// Desktop Duplication then counts how many distinct frames actually reach the screen per second;
// the page also reports its own rAF rate in the title (the two have disagreed before).
const q = new URLSearchParams(location.search);
const nonce = q.get('nonce') ?? '';
const el = document.body;
let n = 0;
const times: number[] = [];
const loop = (t: number) => {
    n++;
    el.style.background = n % 2 ? '#fff' : '#000';
    times.push(t);
    if (times.length > 120) times.shift();
    if (n % 30 === 0 && times.length > 10) {
        const hz = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
        document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio} raf=${hz.toFixed(2)}`;
    }
    requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;

export {};
