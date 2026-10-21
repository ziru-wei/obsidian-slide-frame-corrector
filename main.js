/* Slide Frame Corrector 0.2.1 — compiled plugin, no runtime network requests */
(function(){
const __modules={
"./geometry": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dist = dist;
exports.quadArea = quadArea;
exports.isValidQuad = isValidQuad;
exports.insetQuad = insetQuad;
exports.squareToQuad = squareToQuad;
exports.project = project;
exports.outputSize = outputSize;
exports.distToSegment = distToSegment;
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function quadArea(q) {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        sum += a.x * b.y - a.y * b.x;
    }
    return Math.abs(sum) / 2;
}
function isValidQuad(q, w, h) {
    if (quadArea(q) < w * h * 0.01)
        return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
        if (!Number.isFinite(a.x + a.y) || a.x < 0 || a.x > w || a.y < 0 || a.y > h)
            return false;
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-7)
            return false;
        if (sign && cross * sign < 0)
            return false;
        sign = cross;
    }
    return true;
}
function insetQuad(w, h, margin = 0.07) {
    return [
        { x: w * margin, y: h * margin }, { x: w * (1 - margin), y: h * margin },
        { x: w * (1 - margin), y: h * (1 - margin) }, { x: w * margin, y: h * (1 - margin) }
    ];
}
// Solve 8x8 DLT, mapping destination unit square (u,v) to photo x,y.
function squareToQuad(q) {
    const target = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const rows = [];
    for (let i = 0; i < 4; i++) {
        const [u, v] = target[i], { x, y } = q[i];
        rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
        rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (let i = 0; i < 8; i++) {
        let piv = i;
        for (let j = i + 1; j < 8; j++)
            if (Math.abs(rows[j][i]) > Math.abs(rows[piv][i]))
                piv = j;
        if (Math.abs(rows[piv][i]) < 1e-10)
            throw new Error('Invalid or degenerate crop corners.');
        [rows[i], rows[piv]] = [rows[piv], rows[i]];
        const d = rows[i][i];
        for (let k = i; k <= 8; k++)
            rows[i][k] /= d;
        for (let j = 0; j < 8; j++)
            if (j !== i) {
                const f = rows[j][i];
                for (let k = i; k <= 8; k++)
                    rows[j][k] -= f * rows[i][k];
            }
    }
    return rows.map(r => r[8]);
}
function project(h, u, v) {
    const z = h[6] * u + h[7] * v + 1;
    return { x: (h[0] * u + h[1] * v + h[2]) / z, y: (h[3] * u + h[4] * v + h[5]) / z };
}
function outputSize(q, aspect, maxSide = 3000) {
    let w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    let h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    if (aspect === '16:9')
        h = w * 9 / 16;
    if (aspect === '4:3')
        h = w * 3 / 4;
    const scale = Math.min(1, maxSide / Math.max(w, h), 9000000 / (w * h) > 1 ? 1 : Math.sqrt(9000000 / (w * h)));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

},
"./links": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseImageRefs = parseImageRefs;
exports.relativeToNote = relativeToNote;
exports.makeReplacement = makeReplacement;
exports.selectOccurrence = selectOccurrence;
/** Supported: ![[image.png|300]], ![caption](image.png), and ![caption](<image file.png>).
 * Does not intentionally scan HTML images, remote URLs, or fenced code blocks.
 */
function parseImageRefs(text) {
    const re = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+['"][^'"\n]*['"])?\)/g;
    const refs = [];
    let m;
    while ((m = re.exec(text))) {
        const pre = text.slice(0, m.index), line = pre.lastIndexOf('\n') + 1;
        // Skip fenced source code (both ``` and ~~~).
        const priorLines = pre.slice(0, line).split('\n');
        let fence = null;
        for (const row of priorLines) {
            const found = row.match(/^\s*(`{3,}|~{3,})/);
            if (found) {
                if (!fence)
                    fence = found[1][0];
                else if (found[1][0] === fence)
                    fence = null;
            }
        }
        if (fence)
            continue;
        if (m[1] !== undefined) {
            const pipe = m[1].indexOf('|');
            const target = (pipe < 0 ? m[1] : m[1].slice(0, pipe)).split('#')[0];
            const suffix = pipe < 0 ? '' : m[1].slice(pipe);
            if (target)
                refs.push({ raw: m[0], target, start: m.index, end: m.index + m[0].length, kind: 'wiki', suffix, alt: '' });
        }
        else {
            const target = m[3].startsWith('<') ? m[3].slice(1, -1) : m[3];
            if (!/^(https?:|data:|file:)/i.test(target))
                refs.push({ raw: m[0], target, start: m.index, end: m.index + m[0].length, kind: 'markdown', suffix: '', alt: m[2] });
        }
    }
    return refs;
}
function relativeToNote(notePath, assetPath) {
    const from = notePath.split('/').slice(0, -1), to = assetPath.split('/');
    while (from.length && to.length && from[0] === to[0]) {
        from.shift();
        to.shift();
    }
    return [...from.map(() => '..'), ...to].join('/');
}
function makeReplacement(ref, newPath, notePath) {
    if (ref.kind === 'wiki')
        return `![[${newPath}${ref.suffix}]]`;
    const relative = relativeToNote(notePath, newPath);
    // Angle brackets in Markdown allow filenames with spaces. Encode special URL chars.
    const href = relative.split('/').map(s => encodeURIComponent(s)).join('/');
    return `![${ref.alt}](<${href}>)`;
}
function selectOccurrence(content, ref) {
    // Prefer original offset; prevent a blind replace when the note has changed.
    if (content.slice(ref.start, ref.end) === ref.raw)
        return ref;
    const all = parseImageRefs(content).filter(v => v.raw === ref.raw);
    return all.length === 1 ? all[0] : null;
}

},
"./warp": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.warpPixels = warpPixels;
const geometry_1 = require("./geometry");
// Inverse-mapped bilinear resampling. No WebGL, native modules or network dependencies.
function warpPixels(src, q, width, height) {
    if (!(0, geometry_1.isValidQuad)(q, src.width, src.height))
        throw new Error('The four corners must form a convex quadrilateral inside the photo.');
    const H = (0, geometry_1.squareToQuad)(q);
    const out = new ImageData(width, height);
    const s = src.data, d = out.data, sw = src.width, sh = src.height;
    for (let y = 0; y < height; y++) {
        const v = height === 1 ? 0 : y / (height - 1);
        for (let x = 0; x < width; x++) {
            const u = width === 1 ? 0 : x / (width - 1);
            const z = H[6] * u + H[7] * v + 1;
            const px = (H[0] * u + H[1] * v + H[2]) / z;
            const py = (H[3] * u + H[4] * v + H[5]) / z;
            const di = 4 * (y * width + x);
            if (!Number.isFinite(px + py) || px < 0 || py < 0 || px > sw - 1 || py > sh - 1) {
                d[di + 3] = 255;
                continue;
            }
            const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
            const fx = px - x0, fy = py - y0;
            const i00 = 4 * (y0 * sw + x0), i10 = 4 * (y0 * sw + x1), i01 = 4 * (y1 * sw + x0), i11 = 4 * (y1 * sw + x1);
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
            for (let c = 0; c < 3; c++)
                d[di + c] = s[i00 + c] * w00 + s[i10 + c] * w10 + s[i01 + c] * w01 + s[i11 + c] * w11;
            d[di + 3] = 255;
        }
    }
    return out;
}

},
"./detect": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refineQuad = refineQuad;
exports.detectSlide = detectSlide;
const geometry_1 = require("./geometry");
const RAD = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/** How far an edge may move (fraction of the photo's short side) and how dark/bright the band and the interior must be.
 *  'wide' reaches past thicker bands but can cut into the slide; it is meant for slides with a light background. */
const TRIM = {
    normal: { maxFrac: 0.05, low: 0.72, reach: 0.85 },
    wide: { maxFrac: 0.12, low: 0.8, reach: 0.8 },
};
function refineQuad(gray, w, h, q, trim = 'normal') {
    const cfg = TRIM[trim];
    const maxShift = Math.max(3, Math.round(cfg.maxFrac * Math.min(w, h)));
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    const lines = [];
    for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len, ny = dx / len;
        if ((cx - a.x) * nx + (cy - a.y) * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
        const raw = [];
        for (let k = 0; k <= maxShift + 6; k++) {
            let sum = 0, cnt = 0;
            for (let s = 0; s < 40; s++) {
                const t = 0.1 + 0.8 * s / 39;
                const x = Math.round(a.x + dx * t + nx * k), y = Math.round(a.y + dy * t + ny * k);
                if (x >= 0 && x < w && y >= 0 && y < h) {
                    sum += gray[y * w + x];
                    cnt++;
                }
            }
            raw.push(cnt ? sum / cnt : NaN);
        }
        const prof = raw.map((v, k) => {
            const win = [raw[k - 1], v, raw[k + 1]].filter(x => x !== undefined && !Number.isNaN(x));
            return win.length ? win.reduce((m, n) => m + n, 0) / win.length : NaN;
        });
        let ref = 0;
        for (let k = 2; k < prof.length; k++)
            if (prof[k] > ref)
                ref = prof[k];
        let shift = 0;
        if (ref >= 110 && prof[0] < cfg.low * ref) {
            // the 3-tap smoothing delays the transition by one pixel, which doubles as a one-pixel safety margin
            for (let k = 1; k <= maxShift + 1; k++) {
                if (prof[k] >= cfg.reach * ref && prof[Math.min(k + 2, prof.length - 1)] >= (cfg.reach - 0.05) * ref) {
                    shift = k;
                    break;
                }
            }
        }
        lines.push({ p: { x: a.x + nx * shift, y: a.y + ny * shift }, dx, dy });
    }
    const out = q.map((orig, i) => {
        const l1 = lines[(i + 3) % 4], l2 = lines[i];
        const det = l1.dx * l2.dy - l1.dy * l2.dx;
        if (Math.abs(det) < 1e-6)
            return orig;
        const t = ((l2.p.x - l1.p.x) * l2.dy - (l2.p.y - l1.p.y) * l2.dx) / det;
        return { x: l1.p.x + l1.dx * t, y: l1.p.y + l1.dy * t };
    });
    return (0, geometry_1.isValidQuad)(out, w, h) && (0, geometry_1.quadArea)(out) > (0, geometry_1.quadArea)(q) * 0.7 ? out : q;
}
/** Detect straight slide frame in a 640px-or-smaller ImageData, with a safe manual-edit fallback.
 * Hough peaks use gradient direction so small projected edges survive busy slide contents.
 */
function detectSlide(img, opts = {}) {
    const { width: w, height: h, data } = img;
    const fallback = { quad: (0, geometry_1.insetQuad)(w, h), confident: false, score: 0, corners: [[], [], [], []] };
    if (w < 80 || h < 80)
        return fallback;
    const gray = new Float32Array(w * h), mag = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
        gray[i] = .2126 * data[i * 4] + .7152 * data[i * 4 + 1] + .0722 * data[i * 4 + 2];
    let nonzero = 0;
    for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const dx = -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
            const dy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
            const m = Math.hypot(dx, dy);
            mag[i] = m;
            gx[i] = dx;
            gy[i] = dy;
            if (m > 75)
                nonzero++;
        }
    if (nonzero < 60)
        return fallback;
    const angleStep = 2, na = 90, rStep = 3, maxR = Math.hypot(w, h), nr = Math.ceil(2 * maxR / rStep) + 1;
    const acc = new Int32Array(na * nr);
    const cos = Array.from({ length: na }, (_, i) => Math.cos(i * angleStep * RAD));
    const sin = Array.from({ length: na }, (_, i) => Math.sin(i * angleStep * RAD));
    const step = w * h > 240000 ? 2 : 1;
    for (let y = 2; y < h - 2; y += step)
        for (let x = 2; x < w - 2; x += step) {
            const i = y * w + x, m = mag[i];
            if (m < 75)
                continue;
            const theta = (Math.atan2(gy[i], gx[i]) / RAD + 180) % 180;
            const bin = Math.round(theta / angleStep);
            const wt = Math.min(12, Math.max(1, Math.round(m / 75)));
            for (let d = -2; d <= 2; d++) {
                const t = (bin + d + na) % na;
                const r = Math.round((x * cos[t] + y * sin[t] + maxR) / rStep);
                if (r >= 0 && r < nr)
                    acc[t * nr + r] += wt * (d === 0 ? 3 : 1);
            }
        }
    const peaks = [];
    let maxVote = 0;
    for (let i = 0; i < acc.length; i++)
        if (acc[i] > maxVote)
            maxVote = acc[i];
    const cutoff = Math.max(65, maxVote * .12);
    for (let t = 0; t < na; t++)
        for (let r = 2; r < nr - 2; r++) {
            const value = acc[t * nr + r];
            if (value < cutoff)
                continue;
            let greater = false;
            for (let da = -1; da <= 1 && !greater; da++)
                for (let dr = -2; dr <= 2; dr++) {
                    if (da === 0 && dr === 0)
                        continue;
                    const tt = (t + da + na) % na;
                    if (acc[tt * nr + r + dr] > value) {
                        greater = true;
                        break;
                    }
                }
            if (!greater)
                peaks.push({ t, r, votes: value });
        }
    peaks.sort((a, b) => b.votes - a.votes);
    const top = [], bottom = [], left = [], right = [];
    const cy = h / 2, cx = w / 2;
    function pushUnique(list, l, near = 13) {
        if (list.some(x => Math.abs(x.atCenter - l.atCenter) < near))
            return;
        if (list.length < 10)
            list.push(l);
    }
    for (const p of peaks.slice(0, 200)) {
        const a = cos[p.t], b = sin[p.t], r = p.r * rStep - maxR;
        if (Math.abs(b) > .57) {
            const y = (r - a * cx) / b;
            if (y > h * .015 && y < h * .65)
                pushUnique(top, { a, b, r, votes: p.votes, atCenter: y });
            if (y > h * .35 && y < h * .985)
                pushUnique(bottom, { a, b, r, votes: p.votes, atCenter: y });
        }
        if (Math.abs(a) > .64) {
            const x = (r - b * cy) / a;
            if (x > w * .015 && x < w * .65)
                pushUnique(left, { a, b, r, votes: p.votes, atCenter: x });
            if (x > w * .35 && x < w * .985)
                pushUnique(right, { a, b, r, votes: p.votes, atCenter: x });
        }
        if (top.length >= 10 && bottom.length >= 10 && left.length >= 10 && right.length >= 10)
            break;
    }
    const missingSide = !top.length || !bottom.length || !left.length || !right.length;
    function meet(l1, l2) {
        const det = l1.a * l2.b - l2.a * l1.b;
        if (Math.abs(det) < .20)
            return null;
        return { x: (l1.r * l2.b - l2.r * l1.b) / det, y: (l1.a * l2.r - l2.a * l1.r) / det };
    }
    function sample(a, b, center) {
        let grad = 0, brightness = 0;
        const n = 36, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 25)
            return 0;
        let nx = -dy / len, ny = dx / len;
        if ((center.x - (a.x + b.x) / 2) * nx + (center.y - (a.y + b.y) / 2) * ny < 0) {
            nx = -nx;
            ny = -ny;
        }
        const offset = Math.max(3, Math.min(8, Math.min(w, h) * .013));
        for (let i = 1; i < n; i++) {
            const px = a.x + dx * i / n, py = a.y + dy * i / n;
            const x = Math.round(px), y = Math.round(py);
            if (x >= 1 && x < w - 1 && y >= 1 && y < h - 1)
                grad += Math.min(1, mag[y * w + x] / 260);
            const ix = Math.round(px + nx * offset), iy = Math.round(py + ny * offset);
            const ox = Math.round(px - nx * offset), oy = Math.round(py - ny * offset);
            if (ix >= 0 && ix < w && iy >= 0 && iy < h && ox >= 0 && ox < w && oy >= 0 && oy < h) {
                const diff = gray[iy * w + ix] - gray[oy * w + ox];
                brightness += clamp(diff / 70, -.5, 1);
            }
        }
        return .7 * grad / (n - 1) + .3 * Math.max(0, brightness / (n - 1));
    }
    const strengthCache = new Map();
    /** Edge support of a whole line, measured over the part of it that lies inside the photo. */
    function lineStrength(l) {
        const cached = strengthCache.get(l);
        if (cached !== undefined)
            return cached;
        const pts = [];
        if (Math.abs(l.b) > 1e-3)
            for (const x of [0, w]) {
                const y = (l.r - l.a * x) / l.b;
                if (y >= 0 && y <= h)
                    pts.push({ x, y });
            }
        if (Math.abs(l.a) > 1e-3)
            for (const y of [0, h]) {
                const x = (l.r - l.b * y) / l.a;
                if (x >= 0 && x <= w)
                    pts.push({ x, y });
            }
        let v = 0;
        if (pts.length >= 2) {
            let a = pts[0], b = pts[1];
            for (const p of pts)
                for (const q of pts)
                    if (Math.hypot(p.x - q.x, p.y - q.y) > Math.hypot(a.x - b.x, a.y - b.y)) {
                        a = p;
                        b = q;
                    }
            v = sample(a, b, { x: w / 2, y: h / 2 });
        }
        strengthCache.set(l, v);
        return v;
    }
    function collect() {
        const pairs = [[top, left], [top, right], [bottom, right], [bottom, left]];
        // Border each horizontal/vertical frame line can run into, per corner (x border for top/bottom lines, y border for left/right).
        const borders = [[0, 0], [w, 0], [w, h], [0, h]];
        return pairs.map(([A, B], ci) => {
            const out = [];
            const add = (p, score) => {
                if (p.x < 0 || p.y < 0 || p.x > w || p.y > h)
                    return;
                if (out.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 4))
                    return;
                out.push({ x: p.x, y: p.y, score });
            };
            for (const l1 of A)
                for (const l2 of B) {
                    const p = meet(l1, l2);
                    if (p)
                        add(p, (lineStrength(l1) + lineStrength(l2)) / 2);
                }
            const [bx, by] = borders[ci];
            for (const l of A)
                if (Math.abs(l.b) > .2)
                    add({ x: bx, y: (l.r - l.a * bx) / l.b }, lineStrength(l));
            for (const l of B)
                if (Math.abs(l.a) > .2)
                    add({ x: (l.r - l.b * by) / l.a, y: by }, lineStrength(l));
            return out;
        });
    }
    // A slide cut off by the photo has no frame line on that side; the other lines still give corner candidates.
    if (missingSide)
        return { ...fallback, corners: collect() };
    let bestScore = 0, best = null;
    for (const t of top)
        for (const b of bottom) {
            if (b.atCenter - t.atCenter < h * .23)
                continue;
            for (const l of left)
                for (const r of right) {
                    if (r.atCenter - l.atCenter < w * .23)
                        continue;
                    const tl = meet(t, l), tr = meet(t, r), br = meet(b, r), bl = meet(b, l);
                    if (!tl || !tr || !br || !bl)
                        continue;
                    const q = [tl, tr, br, bl];
                    if (!(0, geometry_1.isValidQuad)(q, w, h))
                        continue;
                    const area = (0, geometry_1.quadArea)(q) / (w * h);
                    if (area < .17 || area > .94)
                        continue;
                    const center = { x: (tl.x + tr.x + br.x + bl.x) / 4, y: (tl.y + tr.y + br.y + bl.y) / 4 };
                    const edge = (sample(tl, tr, center) + sample(tr, br, center) + sample(br, bl, center) + sample(bl, tl, center)) / 4;
                    const areaFactor = Math.min(1, area / .42);
                    const score = edge * (.75 + .25 * areaFactor);
                    if (score > bestScore) {
                        bestScore = score;
                        best = q;
                    }
                }
        }
    // Weak edges are not guessed as trustworthy. User can drag the inset fallback.
    if (!best || bestScore < .15)
        return { ...fallback, corners: collect() };
    const trim = opts.trim ?? 'normal';
    return { quad: trim === 'off' ? best : refineQuad(gray, w, h, best, trim), confident: bestScore > .25, score: bestScore, corners: collect() };
}

},
"./color": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_STRENGTH = void 0;
exports.flattenBackground = flattenBackground;
exports.autoColor = autoColor;
exports.applyTone = applyTone;
exports.COLOR_STRENGTH = { off: 0, soft: 0.5, standard: 0.8, strong: 1 };
/** Histograms (sampled) of the three channels and of luma. */
function stats(d) {
    const n = d.length / 4;
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const luma = new Uint32Array(256);
    const step = Math.max(1, Math.floor(n / 200000));
    let count = 0;
    for (let i = 0; i < n; i += step) {
        const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2];
        hist[0][r]++;
        hist[1][g]++;
        hist[2][b]++;
        luma[Math.round(.2126 * r + .7152 * g + .0722 * b)]++;
        count++;
    }
    const percentile = (h, p) => {
        const cut = count * p;
        let acc = 0;
        for (let v = 0; v < 256; v++) {
            acc += h[v];
            if (acc >= cut)
                return v;
        }
        return 255;
    };
    return { hist, luma, percentile };
}
/** Flat-field correction for a light slide: estimates the slide background in a coarse grid (a high percentile
 *  per cell and channel; a cell darker than its neighbourhood borrows the neighbourhood median,
 *  then smoothed) and divides it out. Uneven lighting and colour tints that vary across the photo (a blue top,
 *  a warm bottom) end up as an even white. Works in place; `strength` blends with the original. */
function flattenBackground(img, strength) {
    const { width: w, height: h, data: d } = img;
    if (w < 8 || h < 8)
        return;
    const gx = Math.max(4, Math.min(20, Math.round(w / 60))), gy = Math.max(3, Math.min(14, Math.round(h / 60)));
    const nb = gx * gy;
    const hist = new Uint32Array(nb * 3 * 256), counts = new Uint32Array(nb);
    const sx = Math.max(1, Math.floor(Math.sqrt(w * h / 250000)));
    for (let y = 0; y < h; y += sx) {
        const by = Math.min(gy - 1, Math.floor(y * gy / h));
        for (let x = 0; x < w; x += sx) {
            const b = by * gx + Math.min(gx - 1, Math.floor(x * gx / w));
            const i = 4 * (y * w + x);
            counts[b]++;
            hist[(b * 3) * 256 + d[i]]++;
            hist[(b * 3 + 1) * 256 + d[i + 1]]++;
            hist[(b * 3 + 2) * 256 + d[i + 2]]++;
        }
    }
    // per cell/channel background level = 85th percentile
    let bg = new Array(nb * 3).fill(255);
    for (let b = 0; b < nb; b++)
        for (let c = 0; c < 3; c++) {
            if (!counts[b]) {
                bg[b * 3 + c] = 255;
                continue;
            }
            const cut = counts[b] * 0.85;
            let acc = 0, v = 0;
            for (; v < 255; v++) {
                acc += hist[(b * 3 + c) * 256 + v];
                if (acc >= cut)
                    break;
            }
            bg[b * 3 + c] = v;
        }
    const filter = (src, pick) => {
        const out = new Array(src.length).fill(0);
        for (let y = 0; y < gy; y++)
            for (let x = 0; x < gx; x++)
                for (let c = 0; c < 3; c++) {
                    const vals = [];
                    for (let dy = -1; dy <= 1; dy++)
                        for (let dx = -1; dx <= 1; dx++) {
                            const yy = Math.min(gy - 1, Math.max(0, y + dy)), xx = Math.min(gx - 1, Math.max(0, x + dx));
                            vals.push(src[(yy * gx + xx) * 3 + c]);
                        }
                    out[(y * gx + x) * 3 + c] = pick(vals);
                }
        return out;
    };
    // a cell darker than its neighbourhood is mostly picture/text, not background: lift it to the neighbourhood median
    bg = filter(bg, v => Math.max(v[4], [...v].sort((a, b) => a - b)[4]));
    bg = filter(bg, v => v.reduce((a, b) => a + b, 0) / v.length);
    // bilinear sampling of the grid at every pixel (cell centres)
    const gxs = new Float32Array(w), gx0 = new Int32Array(w), gx1 = new Int32Array(w);
    for (let x = 0; x < w; x++) {
        const f = Math.min(gx - 1, Math.max(0, (x + 0.5) * gx / w - 0.5));
        gx0[x] = Math.floor(f);
        gx1[x] = Math.min(gx - 1, gx0[x] + 1);
        gxs[x] = f - gx0[x];
    }
    for (let y = 0; y < h; y++) {
        const fy = Math.min(gy - 1, Math.max(0, (y + 0.5) * gy / h - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(gy - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < w; x++) {
            const i = 4 * (y * w + x);
            for (let c = 0; c < 3; c++) {
                const a = bg[(y0 * gx + gx0[x]) * 3 + c] * (1 - gxs[x]) + bg[(y0 * gx + gx1[x]) * 3 + c] * gxs[x];
                const b = bg[(y1 * gx + gx0[x]) * 3 + c] * (1 - gxs[x]) + bg[(y1 * gx + gx1[x]) * 3 + c] * gxs[x];
                const level = Math.max(1, a * (1 - ty) + b * ty);
                const gain = Math.min(3, Math.max(1, 255 / level));
                const v = d[i + c];
                d[i + c] = v + (Math.min(255, v * gain) - v) * strength;
            }
        }
    }
}
/** Auto colour correction, applied in place. `strength` (0..1) blends with the original pixels.
 *  0. Light slides only: flatten the background (see flattenBackground), so lighting and tint that vary across the photo are evened out first.
 *  1. Black/white points are measured per channel from the photo's own histogram, which removes a
 *     colour cast (white balance) at the same time. On a light slide the white point is the 92nd
 *     percentile (the slide background, so it ends up pure white and glare above it is clipped);
 *     on a dark slide it is the 99.5th percentile so highlights are not blown out.
 *  2. A smoothstep S-curve then pushes darks darker and lights lighter (the "curve" step). */
function autoColor(img, strength) {
    if (strength <= 0)
        return;
    let st = stats(img.data);
    const lightSlide = st.percentile(st.luma, 0.5) > 120;
    if (lightSlide) {
        flattenBackground(img, strength);
        st = stats(img.data);
    }
    const d = img.data, n = d.length / 4;
    const hiP = lightSlide ? 0.92 : 0.995;
    const CONTRAST = 0.75; // 0 = linear levels only, 1 = full smoothstep
    const luts = [];
    for (let c = 0; c < 3; c++) {
        const lo = st.percentile(st.hist[c], 0.005), hi = st.percentile(st.hist[c], hiP);
        const range = Math.max(hi - lo, 90); // never amplify a flat image by more than ~2.8x
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
            const t = Math.min(1, Math.max(0, (v - lo) / range));
            const curved = t + CONTRAST * (t * t * (3 - 2 * t) - t);
            lut[v] = v * (1 - strength) + curved * 255 * strength;
        }
        luts.push(lut);
    }
    for (let i = 0; i < n; i++) {
        d[4 * i] = luts[0][d[4 * i]];
        d[4 * i + 1] = luts[1][d[4 * i + 1]];
        d[4 * i + 2] = luts[2][d[4 * i + 2]];
    }
}
/** Monochrome output: 'gray' keeps the tones, 'bw' is pure black/white split at the Otsu threshold. In place. */
function applyTone(img, tone) {
    if (tone === 'color')
        return;
    const d = img.data, n = d.length / 4;
    const y = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
        y[i] = .2126 * d[4 * i] + .7152 * d[4 * i + 1] + .0722 * d[4 * i + 2];
        hist[y[i]]++;
    }
    let threshold = 128;
    if (tone === 'bw') {
        let sum = 0;
        for (let v = 0; v < 256; v++)
            sum += v * hist[v];
        let wB = 0, sumB = 0, best = -1;
        for (let v = 0; v < 256; v++) {
            wB += hist[v];
            if (!wB)
                continue;
            const wF = n - wB;
            if (!wF)
                break;
            sumB += v * hist[v];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) {
                best = between;
                threshold = v;
            }
        }
    }
    for (let i = 0; i < n; i++) {
        const v = tone === 'bw' ? (y[i] > threshold ? 255 : 0) : y[i];
        d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v;
    }
}

},
"./i18n": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLang = setLang;
exports.t = t;
let current = 'en';
/** Resolve 'auto' from Obsidian's own language setting. */
function setLang(lang) {
    if (lang === 'auto') {
        let l = '';
        try {
            l = (window.localStorage.getItem('language') || navigator.language || '').toLowerCase();
        }
        catch { /* ignore */ }
        current = l.startsWith('zh') ? 'zh' : 'en';
    }
    else
        current = lang;
}
const ZH = {
    'Crop': '裁切', 'Aspect': '比例', 'Color': '矫色', 'Tone': '色调', 'Save as': '保存为',
    'On': '开', 'Off': '关', 'Off (color only)': '关（仅调色）', 'Auto': '自动', 'Soft': '轻', 'Standard': '标准', 'Strong': '强',
    'Full color': '彩色', 'Grayscale': '灰度', 'Black & white': '纯黑白',
    'Auto (follow Obsidian)': '自动（跟随 Obsidian）',
    'Auto-detect': '自动检测', 'Reset corners': '重置角点', 'Reset': '重置', 'Auto-detect all': '全部自动检测',
    'Show processed': '显示已处理', 'Select all': '全选', 'Cancel': '取消', 'Close': '关闭',
    'Correct projected slide': '校正投影幻灯片',
    'Batch correct slides in note…': '批量校正本笔记幻灯片…',
    'Correct one photo': '校正单张照片', 'Correct all photos': '批量校正全部照片',
    'New photo': '新照片', 'Changed: {0}': '改动：{0}', ', ': '、', 'Frame': '框', 'Format': '格式',
    'Drag a corner or an edge to align with the slide boundary': '拖动角点或边，使其与幻灯片边界对齐',
    '1 · Drag corners or edges · keys 1–4 cycle a corner': '1 · 拖动角点或边 · 按 1–4 切换角点候选',
    '2 · Corrected preview': '2 · 校正预览',
    'Original photo stays untouched. Only this embed will change.': '原图不会被修改，只替换笔记中的这处引用。',
    'Save & replace in note': '保存并替换',
    'Saving…': '保存中…',
    'Editing from the original photo: {0}': '正在从原图编辑：{0}',
    'Original photo not found — editing the processed image.': '找不到原图 —— 正在编辑已处理的图片。',
    'Image could not be opened: {0}': '无法打开图片：{0}',
    'Could not open slide photo.': '无法打开幻灯片照片。',
    'Please adjust the crop corners: {0}': '请调整裁切角点：{0}',
    'Saved corrected slide: {0}': '已保存校正后的幻灯片：{0}',
    'Could not save corrected slide: {0}': '无法保存校正后的幻灯片：{0}',
    'Save failed. The original image and embed were not overwritten.': '保存失败，原图和笔记引用都没有被改动。',
    'Adjust the four corners to form a valid quadrilateral.': '请调整四个角点，使其构成有效的四边形。',
    'Slide photos in this note': '本笔记中的幻灯片照片',
    'Originals stay untouched. Each selected photo is saved as a new image and its embed is replaced.': '原图不会被修改。每张选中的照片会另存为新图，并替换笔记中的引用。',
    'Save': '保存', 'Save selected': '保存所选', 'Save {0} selected': '保存所选 {0} 张',
    '{0}/{1} selected changed': '所选 {1} 张中 {0} 张有改动',
    'Save {0} changed': '保存 {0} 张有改动的',
    'No changes — nothing to save.': '没有改动，无需保存。',
    '{0} unchanged skipped.': '已跳过 {0} 张未改动的。',
    'Loading…': '加载中…',
    'From original: {0}': '来自原图：{0}',
    'Could not open: {0}': '无法打开：{0}',
    'Saved ✓': '已保存 ✓',
    'Failed: {0}': '失败：{0}',
    'Saving {0}/{1}…': '保存中 {0}/{1}…',
    '{0} shown': '显示 {0} 张',
    ' · {0} processed hidden': ' · 已隐藏 {0} 张已处理',
    'Number key: next corner candidate · Shift+number: previous candidate': '数字键：切换候选角点；Shift+数字：回到上一个候选',
    '1 · Adjust frame': '1 · 调整框', 'Photo {0}': '照片 {0}', 'Image': '图片', 'Image path': '图片路径', 'Original path': '原图路径', 'Copied': '已复制', 'More': '更多',
    'Saved corrected slide.': '已保存校正后的幻灯片。',
    'All {0} photos in this note are already processed. Tick “Show processed” to re-edit one.': '本笔记中的 {0} 张照片都已处理。勾选“显示已处理”可重新编辑。',
    'Saved {0} corrected slide(s).': '已保存 {0} 张校正后的幻灯片。',
    'Saved {0} corrected slide(s); {1} failed (see the dashboard).': '已保存 {0} 张；{1} 张失败（见面板）。',
    'No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.': '本笔记中没有本地的 JPG/PNG/WebP/BMP/AVIF 图片。',
    'Failed to read note images: {0}': '读取笔记图片失败：{0}',
    'Aspect ratio': '输出比例', 'Save as ': '保存格式',
    'Output shape of the corrected slide. These choices are also remembered when you change them in the editor.': '校正后幻灯片的形状。在编辑窗口里修改的选择也会被记住。',
    'File format of the corrected image.': '校正后图片的文件格式。',
    'Edge trim': '边缘内收', 'Wide ⚠': '宽 ⚠',
    'Pulls the detected frame inward past dark/gold screen bands. Wide reaches thicker bands but can cut into the slide; it works best on light-background slides.': '自动检测时把框往里收,去掉屏幕的黑边/金边。“宽”能收更厚的边,但可能切进幻灯片,对浅色底幻灯片比较有效。',
    'Crop to slide': '裁切到幻灯片', 'Off keeps the whole photo and only applies color/tone.': '关闭后保留整张照片，只应用矫色和色调。',
    'Color correction': '矫色', 'Auto white balance and levels. Off keeps the original colors; Strong is the most aggressive.': '自动白平衡和色阶曲线。关闭则保持原色；“强”最激进。',
    'Color, grayscale, or pure black & white (applied after color correction).': '彩色、灰度或纯黑白（在矫色之后应用）。',
    'Language': '语言', 'Language of this plugin’s interface. Commands update after reloading Obsidian.': '插件界面语言。命令名称需重载 Obsidian 后更新。',
    'Clean originals': '清理原图',
    'Move original photos that already have a corrected version and are no longer used in any note to the trash. You confirm the list first.': '把已有校正版本、且不再被任何笔记使用的原图移到回收站。操作前会先让你确认清单。',
    'Clean…': '清理…',
    'Nothing to clean: no original photo has a corrected version that is unused elsewhere.': '没有可清理的原图。',
    'Clean processed originals?': '清理已处理的原图？',
    '{0} original photo(s) already have a corrected version and are not used in any note. They will be moved to the trash (according to your Obsidian “Deleted files” setting).': '{0} 张原图已有校正版本，且不被任何笔记使用。它们会被移到回收站（遵循 Obsidian 的“已删除文件”设置）。',
    'Move {0} to trash': '将 {0} 张移到回收站',
    'Moved {0} original photo(s) to the trash.': '已将 {0} 张原图移到回收站。',
};
function t(key, ...args) {
    let s = current === 'zh' ? (ZH[key] ?? key) : key;
    args.forEach((a, i) => { s = s.split(`{${i}}`).join(String(a)); });
    return s;
}

},
"./main": function(module,exports,require){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const links_1 = require("./links");
const detect_1 = require("./detect");
const geometry_1 = require("./geometry");
const warp_1 = require("./warp");
const i18n_1 = require("./i18n");
const color_1 = require("./color");
const outPrefs = (p) => ({ aspect: p.aspect, format: p.format, color: p.color, tone: p.tone, crop: p.crop });
const sameOutPrefs = (a, b) => a.aspect === b.aspect && a.format === b.format && a.color === b.color && a.tone === b.tone && a.crop === b.crop;
const sameQuad = (a, b, tol = 0.75) => a.every((p, i) => Math.abs(p.x - b[i].x) <= tol && Math.abs(p.y - b[i].y) <= tol);
/** True when the frame/output settings differ from the baseline. Moving a corner and putting it back (within ~0.3% of the photo) is not a change, and with crop off the frame and aspect do not matter. */
function modifiedParts(base, quad, prefs, natW, natH) {
    const parts = [];
    if (base.prefs.crop !== prefs.crop)
        parts.push('Crop');
    if (prefs.crop) {
        if (!sameQuad(base.quad, quad, Math.max(1.5, 0.003 * Math.max(natW, natH))))
            parts.push('Frame');
        if (base.prefs.aspect !== prefs.aspect)
            parts.push('Aspect');
    }
    if (base.prefs.color !== prefs.color)
        parts.push('Color');
    if (base.prefs.tone !== prefs.tone)
        parts.push('Tone');
    if (base.prefs.format !== prefs.format)
        parts.push('Format');
    return parts;
}
const isModified = (base, quad, prefs, natW, natH) => modifiedParts(base, quad, prefs, natW, natH).length > 0;
/** Remember a frame the user dragged (or forget it once they ask for auto-detect again), whether or not they save. */
function noteDraft(plugin, file, editor, sameAsSaved = false) {
    if (sameAsSaved)
        plugin.clearDraft(file.path); // dragged back to the saved frame: nothing pending
    else if (editor.origin === 'user')
        plugin.setDraft(file.path, { src: file.path, quad: editor.quad.map(v => ({ ...v })), w: editor.natW, h: editor.natH });
    else if (editor.origin === 'auto')
        plugin.clearDraft(file.path);
}
const DEFAULT_PREFS = { aspect: '16:9', format: 'image/jpeg', color: 'off', tone: 'color', crop: true, lang: 'auto', trim: 'normal' };
const TRIM_OPTIONS = [['Off', 'off'], ['Normal', 'normal'], ['Wide ⚠', 'wide']];
/** Edge trim used by the next auto-detect (kept in sync with the setting). */
let currentTrim = 'normal';
const TRIM_HINT = 'Pulls the detected frame inward past dark/gold screen bands. Wide reaches thicker bands but can cut into the slide; it works best on light-background slides.';
const LANG_OPTIONS = [['Auto (follow Obsidian)', 'auto'], ['English', 'en'], ['中文', 'zh']];
const ASPECT_OPTIONS = [['16:9', '16:9'], ['4:3', '4:3'], ['Auto', 'auto']];
const FORMAT_OPTIONS = [['JPG', 'image/jpeg'], ['PNG', 'image/png']];
const COLOR_OPTIONS = [['Off', 'off'], ['Soft', 'soft'], ['Standard', 'standard'], ['Strong', 'strong']];
const TONE_OPTIONS = [['Full color', 'color'], ['Grayscale', 'gray'], ['Black & white', 'bw']];
const CROP_OPTIONS = [['On', 'on'], ['Off (color only)', 'off']];
const SUPPORTED = /\.(png|jpe?g|webp|bmp|avif)$/i;
/** Files written by this plugin are named `<photo>-slide-001.jpg`; they count as already processed. */
const PROCESSED = /-slide-\d{3}$/;
const isProcessed = (file) => PROCESSED.test(file.basename);
function decodeTarget(t) {
    try {
        return decodeURIComponent(t.replace(/\\([ ()])/g, '$1'));
    }
    catch {
        return t;
    }
}
function getRefFile(app, ref, note) {
    const target = decodeTarget(ref.target);
    const file = app.metadataCache.getFirstLinkpathDest(target, note.path);
    return file && SUPPORTED.test(file.name) ? file : null;
}
function getContent(view, app) {
    if (view.getMode() === 'source')
        return Promise.resolve(view.editor.getValue());
    return app.vault.cachedRead(view.file);
}
async function loadImageFile(app, file) {
    const data = await app.vault.readBinary(file);
    const lower = file.extension.toLowerCase();
    const type = lower === 'jpg' || lower === 'jpeg' ? 'image/jpeg' : lower === 'png' ? 'image/png' : lower === 'webp' ? 'image/webp' : lower === 'avif' ? 'image/avif' : 'image/bmp';
    const url = URL.createObjectURL(new Blob([data], { type }));
    const img = new Image();
    img.src = url;
    try {
        await new Promise((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Unsupported or damaged image')); });
    }
    catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
    if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        throw new Error('Empty photo');
    }
    return { img, release: () => URL.revokeObjectURL(url) };
}
/** Size a canvas to fit inside `box` (contain) and centre it, so a row of cards never needs vertical scrolling. */
function fitCanvas(canvas, box) {
    const bw = box.clientWidth - 2, bh = box.clientHeight - 2;
    if (bw <= 0 || bh <= 0 || !canvas.width || !canvas.height)
        return;
    const k = Math.min(bw / canvas.width, bh / canvas.height);
    const st = canvas.style;
    st.position = 'absolute';
    st.left = '50%';
    st.top = '50%';
    st.transform = 'translate(-50%,-50%)';
    st.maxHeight = 'none';
    st.maxWidth = 'none';
    st.width = `${Math.floor(canvas.width * k)}px`;
    st.height = `${Math.floor(canvas.height * k)}px`;
}
function addSelect(parent, label, opts, current, onChange, hint) {
    const holder = parent.createEl('label', { cls: 'sfc-field' });
    if (hint)
        holder.setAttribute('title', hint);
    holder.createEl('span', { text: (0, i18n_1.t)(label) });
    const select = holder.createEl('select');
    for (const [caption, value] of opts) {
        const option = select.createEl('option', { text: (0, i18n_1.t)(caption), attr: { value } });
        if (value === current)
            option.selected = true;
    }
    select.addEventListener('change', () => onChange(select.value));
}
function setAutoBadge(btn, label, ok) {
    btn.setText(ok ? `✓ ${(0, i18n_1.t)(label)}` : (0, i18n_1.t)(label));
    btn.toggleClass('sfc-auto-ok', ok);
}
function addButton(parent, label, onClick) {
    const button = parent.createEl('button', { text: (0, i18n_1.t)(label), attr: { type: 'button' } });
    button.addEventListener('click', onClick);
    return button;
}
const KEY_HINT = 'Number key: next corner candidate · Shift+number: previous candidate';
/** The "…" menu: file name and paths live here instead of on the page; clicking a row copies it. */
function showInfoMenu(ev, rows) {
    const menu = new obsidian_1.Menu();
    for (const [label, value] of rows)
        menu.addItem(item => item.setTitle(`${(0, i18n_1.t)(label)}: ${value}`).setIcon('copy').onClick(() => {
            void navigator.clipboard?.writeText(value);
            new obsidian_1.Notice((0, i18n_1.t)('Copied'));
        }));
    menu.showAtMouseEvent(ev);
}
function fileRows(entry, source) {
    const rows = [['Image', entry.file.name], ['Image path', entry.file.path]];
    if (source && source.path !== entry.file.path)
        rows.push(['Original path', source.path]);
    return rows;
}
/** Crop (perspective warp) or keep the whole photo, then apply colour correction and tone. */
function makeOutput(src, quad, prefs, maxSide) {
    let out;
    if (prefs.crop) {
        const size = (0, geometry_1.outputSize)(quad, prefs.aspect, maxSide);
        out = (0, warp_1.warpPixels)(src, quad, size.width, size.height);
    }
    else {
        const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
        if (scale >= 1)
            out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
        else {
            const a = document.createElement('canvas');
            a.width = src.width;
            a.height = src.height;
            a.getContext('2d').putImageData(src, 0, 0);
            const b = document.createElement('canvas');
            b.width = Math.max(1, Math.round(src.width * scale));
            b.height = Math.max(1, Math.round(src.height * scale));
            const bc = b.getContext('2d', { willReadFrequently: true });
            bc.drawImage(a, 0, 0, b.width, b.height);
            out = bc.getImageData(0, 0, b.width, b.height);
        }
    }
    (0, color_1.autoColor)(out, color_1.COLOR_STRENGTH[prefs.color]);
    (0, color_1.applyTone)(out, prefs.tone);
    return out;
}
async function renderCorrected(img, quad, prefs) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, 4200 / Math.max(w, h), Math.sqrt(14000000 / (w * h)));
    const source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(w * scale));
    source.height = Math.max(1, Math.round(h * scale));
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, source.width, source.height);
    const src = ctx.getImageData(0, 0, source.width, source.height);
    const q = quad.map(p => ({ x: p.x * source.width / w, y: p.y * source.height / h }));
    const result = makeOutput(src, q, prefs, prefs.crop ? 3000 : 4200);
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext('2d').putImageData(result, 0, 0);
    return canvas;
}
async function saveCorrection(app, entry, source, img, quad, prefs) {
    if (prefs.crop && !(0, geometry_1.isValidQuad)(quad, img.naturalWidth, img.naturalHeight))
        throw new Error((0, i18n_1.t)('Adjust the four corners to form a valid quadrilateral.'));
    const canvas = await renderCorrected(img, quad, prefs);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Encoding failed')), prefs.format, .94));
    const bytes = await blob.arrayBuffer();
    const ext = prefs.format === 'image/png' ? 'png' : 'jpg';
    const original = source;
    const folder = original.parent?.path === '/' ? '' : original.parent?.path ?? '';
    const base = original.basename.replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 72);
    let path = '';
    for (let i = 1; i <= 9999; i++) {
        const name = `${base}-slide-${String(i).padStart(3, '0')}.${ext}`;
        const candidate = folder ? `${folder}/${name}` : name;
        if (!app.vault.getAbstractFileByPath(candidate)) {
            path = candidate;
            break;
        }
    }
    if (!path)
        throw new Error('Could not find a unique filename');
    const saved = await app.vault.createBinary(path, bytes);
    try {
        await replaceEmbed(app, entry, saved);
    }
    catch (err) {
        // Only revert the newly created output, never alter the source photo.
        try {
            await app.vault.delete(saved);
        }
        catch { /* recovery file can remain */ }
        throw err;
    }
    return saved;
}
/** Where to edit from: the original photo (with the frame used last time) when this embed is one of our outputs. */
function resolveSource(app, plugin, entry) {
    const rec = plugin.records[entry.file.path] ?? null;
    if (rec) {
        const f = app.vault.getAbstractFileByPath(rec.src);
        if (f instanceof obsidian_1.TFile)
            return { file: f, rec, fromOriginal: true };
    }
    if (isProcessed(entry.file)) {
        const base = entry.file.basename.replace(PROCESSED, '');
        const folder = entry.file.parent?.path === '/' ? '' : entry.file.parent?.path ?? '';
        for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'heic', 'avif', 'bmp']) {
            const f = app.vault.getAbstractFileByPath(folder ? `${folder}/${base}.${ext}` : `${base}.${ext}`);
            if (f instanceof obsidian_1.TFile && SUPPORTED.test(f.name))
                return { file: f, rec: null, fromOriginal: true };
        }
    }
    return { file: entry.file, rec: null, fromOriginal: false };
}
function usableQuad(rec, img) {
    return rec && rec.w === img.naturalWidth && rec.h === img.naturalHeight && (0, geometry_1.isValidQuad)(rec.quad, rec.w, rec.h) ? rec.quad : undefined;
}
async function replaceEmbed(app, entry, newFile) {
    const { note, ref } = entry;
    const replacement = (0, links_1.makeReplacement)(ref, newFile.path, note.path);
    // The live editor is authoritative when a note is being edited.
    let open = null;
    app.workspace.iterateAllLeaves(leaf => {
        if (!open && leaf.view instanceof obsidian_1.MarkdownView && leaf.view.file?.path === note.path && leaf.view.getMode() === 'source')
            open = leaf.view;
    });
    if (open) {
        const editor = open.editor;
        const found = (0, links_1.selectOccurrence)(editor.getValue(), ref);
        if (!found)
            throw new Error('The embed changed while editing. No note content was replaced.');
        editor.replaceRange(replacement, editor.offsetToPos(found.start), editor.offsetToPos(found.end));
        return;
    }
    await app.vault.process(note, current => {
        const found = (0, links_1.selectOccurrence)(current, ref);
        if (!found)
            throw new Error('The embed changed while editing. No note content was replaced.');
        return current.slice(0, found.start) + replacement + current.slice(found.end);
    });
}
let activeEditor = null;
/** Canvas with four draggable corners and four draggable edges (an edge slides along its normal). */
class QuadEditor {
    constructor(stage, img, onChange, maxSide = 1000, lensSize = 130) {
        this.onChange = onChange;
        /** True while the frame is exactly what the detector confidently proposed. */
        this.autoResult = false;
        /** Where the current frame came from: the detector, the user's hands, or a frame restored from storage. */
        this.origin = 'auto';
        this.enabled = true;
        this.active = null;
        this.dragging = false;
        this.startQuad = null;
        this.startPoint = null;
        this.candidates = [[], [], [], []];
        this.cycle = null;
        this.sampled = null;
        this.initial = null;
        this.candidatesPending = false;
        this.pointerDown = (event) => {
            activeEditor = this;
            if (!this.enabled)
                return;
            const location = this.location(event);
            const ci = this.hitCandidate(location);
            if (ci >= 0 && this.cycle) {
                // Clicking a candidate applies it.
                const corner = this.cycle.corner, q = this.quad.map(v => ({ ...v }));
                q[corner] = this.cycle.list[ci];
                if ((0, geometry_1.isValidQuad)(q, this.natW, this.natH)) {
                    this.quad = q;
                    this.cycle.index = ci;
                    this.autoResult = false;
                    this.origin = 'user';
                    this.draw();
                    this.onChange(true);
                }
                event.preventDefault();
                return;
            }
            const hit = this.hit(location);
            if (!hit)
                return;
            this.ensureCandidates();
            if (!(hit.kind === 'corner' && this.cycle?.corner === hit.index))
                this.cycle = null;
            this.autoResult = false;
            this.origin = 'user';
            this.active = hit;
            this.dragging = true;
            this.startQuad = this.quad.map(v => ({ ...v }));
            this.startPoint = location;
            this.canvas.setPointerCapture(event.pointerId);
            this.draw();
            this.drawLens(location);
            event.preventDefault();
        };
        this.pointerMove = (event) => {
            if (!this.enabled)
                return;
            const p = this.location(event);
            if (!this.dragging || !this.active || !this.startQuad || !this.startPoint) {
                if (this.hitCandidate(p) >= 0) {
                    this.canvas.style.cursor = 'pointer';
                    return;
                }
                const hit = this.hit(p);
                this.canvas.style.cursor = hit ? (hit.kind === 'corner' ? 'grab' : 'move') : 'crosshair';
                return;
            }
            const w = this.natW, h = this.natH;
            if (this.active.kind === 'corner') {
                const q = this.quad.map(v => ({ ...v }));
                const target = { x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) };
                q[this.active.index] = target;
                // Reject crossed corners; the output always uses a convex polygon.
                if ((0, geometry_1.isValidQuad)(q, w, h))
                    this.quad = q;
            }
            else {
                const i = this.active.index, j = (i + 1) % 4, s = this.startQuad;
                const ex = s[j].x - s[i].x, ey = s[j].y - s[i].y, len = Math.hypot(ex, ey) || 1;
                const nx = -ey / len, ny = ex / len;
                const amount = (p.x - this.startPoint.x) * nx + (p.y - this.startPoint.y) * ny;
                // Back off until the moved edge is valid, so the edge stops at the photo border instead of sticking.
                for (let f = 1, tries = 0; tries < 14; tries++, f *= 0.8) {
                    const q = s.map(v => ({ ...v }));
                    q[i] = { x: s[i].x + nx * amount * f, y: s[i].y + ny * amount * f };
                    q[j] = { x: s[j].x + nx * amount * f, y: s[j].y + ny * amount * f };
                    if ((0, geometry_1.isValidQuad)(q, w, h)) {
                        this.quad = q;
                        break;
                    }
                }
            }
            this.draw();
            this.drawLens(p);
            this.onChange(false);
            event.preventDefault();
        };
        this.pointerUp = (event) => {
            if (!this.dragging)
                return;
            this.dragging = false;
            this.active = null;
            this.startQuad = null;
            this.startPoint = null;
            this.lens.style.display = 'none';
            if (this.canvas.hasPointerCapture(event.pointerId))
                this.canvas.releasePointerCapture(event.pointerId);
            this.draw();
            this.onChange(true);
        };
        this.natW = img.naturalWidth;
        this.natH = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(this.natW, this.natH));
        this.view = document.createElement('canvas');
        this.view.width = Math.round(this.natW * scale);
        this.view.height = Math.round(this.natH * scale);
        this.view.getContext('2d').drawImage(img, 0, 0, this.view.width, this.view.height);
        this.canvas = stage.createEl('canvas', { cls: 'sfc-edit-canvas' });
        this.canvas.width = this.view.width;
        this.canvas.height = this.view.height;
        this.canvas.setAttribute('aria-label', (0, i18n_1.t)('Drag a corner or an edge to align with the slide boundary'));
        this.lensSize = lensSize;
        this.lens = stage.createEl('canvas', { cls: 'sfc-loupe' });
        this.lens.width = lensSize;
        this.lens.height = lensSize;
        this.lens.style.width = `${lensSize}px`;
        this.lens.style.height = `${lensSize}px`;
        this.lens.style.display = 'none';
        this.quad = (0, geometry_1.insetQuad)(this.natW, this.natH);
        this.canvas.addEventListener('pointerdown', this.pointerDown);
        this.canvas.addEventListener('pointermove', this.pointerMove);
        this.canvas.addEventListener('pointerup', this.pointerUp);
        this.canvas.addEventListener('pointercancel', this.pointerUp);
        this.draw();
    }
    /** Downscaled pixels of the photo (cached), used for live previews. */
    sampleData() {
        if (!this.sampled)
            this.sampled = this.view.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.view.width, this.view.height);
        return this.sampled;
    }
    /** Put back a frame set aside earlier (used when auto-detect-all is switched off). */
    restore(q, origin) {
        this.quad = q.map(v => ({ ...v }));
        this.cycle = null;
        this.autoResult = false;
        this.origin = origin;
        this.draw();
        this.onChange(true);
    }
    setQuad(q) { this.quad = q.map(v => ({ ...v })); this.cycle = null; this.autoResult = false; this.origin = 'user'; this.draw(); this.onChange(true); }
    /** With crop off the frame is hidden and cannot be edited. */
    setEnabled(on) {
        this.enabled = on;
        this.canvas.style.cursor = on ? 'crosshair' : 'default';
        this.cycle = null;
        this.draw();
    }
    /** Candidate vertices currently on screen (after pressing 1-4). */
    shown() {
        return this.cycle ? { corner: this.cycle.corner, list: this.cycle.list } : null;
    }
    /** Make this editor the target of the 1-4 keys. */
    focus() { activeEditor = this; }
    /** Remember the frame the editor opened with; Reset returns to it (the state before this round of adjustments). */
    markInitial() { this.initial = { quad: this.quad.map(v => ({ ...v })), origin: this.origin, auto: this.autoResult }; }
    reset() {
        const i = this.initial;
        if (i) {
            this.quad = i.quad.map(v => ({ ...v }));
            this.autoResult = i.auto;
            this.origin = i.origin === 'auto' ? 'auto' : 'user';
        }
        else {
            this.quad = (0, geometry_1.insetQuad)(this.natW, this.natH);
            this.autoResult = false;
            this.origin = 'user';
        }
        this.cycle = null;
        this.draw();
        this.onChange(true);
    }
    /** Key 1-4: jump that corner to the next candidate vertex, best edge support first (line intersections and line/photo-border crossings, then the photo/inset corners). */
    cycleCorner(corner, dir) {
        this.ensureCandidates();
        if (!this.cycle || this.cycle.corner !== corner) {
            const cur = this.quad[corner];
            const extras = [(0, geometry_1.insetQuad)(this.natW, this.natH)[corner], [{ x: 0, y: 0 }, { x: this.natW, y: 0 }, { x: this.natW, y: this.natH }, { x: 0, y: this.natH }][corner]];
            const list = [...this.candidates[corner], ...extras]
                .filter((c, i, all) => (0, geometry_1.dist)(c, cur) > this.natW * 0.004 && all.findIndex(o => (0, geometry_1.dist)(o, c) < this.natW * 0.004) === i)
                .filter(c => { const q = this.quad.map(v => ({ ...v })); q[corner] = c; return (0, geometry_1.isValidQuad)(q, this.natW, this.natH); })
                .sort((a, b) => ((b.score ?? -1) - (a.score ?? -1)) || ((0, geometry_1.dist)(a, cur) - (0, geometry_1.dist)(b, cur)))
                .slice(0, 8);
            list.push({ ...cur }); // last stop returns to where the corner started
            this.cycle = { corner, list, index: -1 };
        }
        const c = this.cycle;
        if (c.list.length < 2) {
            this.draw();
            return;
        }
        c.index = (c.index + dir + c.list.length) % c.list.length;
        const q = this.quad.map(v => ({ ...v }));
        q[corner] = c.list[c.index];
        this.quad = q;
        this.autoResult = false;
        this.origin = 'user';
        this.draw();
        this.onChange(true);
    }
    runDetection() {
        const scale = Math.min(1, 640 / Math.max(this.natW, this.natH));
        const t = document.createElement('canvas');
        t.width = Math.round(this.natW * scale);
        t.height = Math.round(this.natH * scale);
        const ctx = t.getContext('2d', { willReadFrequently: true });
        if (!ctx)
            return null;
        ctx.drawImage(this.view, 0, 0, t.width, t.height);
        const detection = (0, detect_1.detectSlide)(ctx.getImageData(0, 0, t.width, t.height), { trim: currentTrim });
        const toNat = (p) => ({ x: p.x * this.natW / t.width, y: p.y * this.natH / t.height });
        return { detection, toNat };
    }
    /** Candidate vertices are only computed when first needed when a saved frame was restored. */
    ensureCandidates() {
        if (!this.candidatesPending)
            return;
        this.candidatesPending = false;
        const r = this.runDetection();
        if (r)
            this.candidates = r.detection.corners.map(list => list.map(c => ({ ...r.toNat(c), score: c.score })));
    }
    /** Returns true when the detector is confident. With `preset` (a frame restored from an earlier save) no detection runs; the frame is just set. */
    autoDetect(preset) {
        if (preset) {
            this.quad = preset.map(v => ({ ...v }));
            this.candidatesPending = true;
            this.cycle = null;
            this.autoResult = false;
            this.origin = 'restored';
            this.draw();
            this.onChange(true);
            return false;
        }
        const r = this.runDetection();
        if (!r)
            return false;
        this.candidatesPending = false;
        this.quad = r.detection.quad.map(r.toNat);
        this.candidates = r.detection.corners.map(list => list.map(c => ({ ...r.toNat(c), score: c.score })));
        this.cycle = null;
        this.autoResult = r.detection.confident;
        this.origin = 'auto';
        this.draw();
        this.onChange(true);
        return this.autoResult;
    }
    draw() {
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            return;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(this.view, 0, 0, w, h);
        if (!this.enabled)
            return;
        // The canvas is shown scaled down, so size every mark in on-screen pixels (u = canvas px per screen px).
        const u = Math.max(1, w / Math.max(1, this.canvas.getBoundingClientRect().width));
        const q = this.quad.map(p => ({ x: p.x * w / this.natW, y: p.y * h / this.natH }));
        ctx.fillStyle = 'rgba(0,0,0,.38)';
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.moveTo(q[0].x, q[0].y);
        for (let i = 1; i < 4; i++)
            ctx.lineTo(q[i].x, q[i].y);
        ctx.closePath();
        ctx.fill('evenodd');
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
            const a = q[i], b = q[(i + 1) % 4], on = this.active?.kind === 'edge' && this.active.index === i;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = 'rgba(0,0,0,.5)';
            ctx.lineWidth = (on ? 5 : 4) * u;
            ctx.stroke();
            ctx.strokeStyle = on ? '#ffffff' : '#4be2d2';
            ctx.lineWidth = (on ? 2.5 : 1.6) * u;
            ctx.stroke();
        }
        // Edge handles: small pills at the midpoints
        for (let i = 0; i < 4; i++) {
            const a = q[i], b = q[(i + 1) % 4], on = this.active?.kind === 'edge' && this.active.index === i;
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            ctx.save();
            ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
            ctx.rotate(ang);
            const pw = (on ? 22 : 18) * u, ph = (on ? 9 : 7) * u;
            ctx.beginPath();
            ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
            ctx.fillStyle = on ? '#ffffff' : 'rgba(12,52,64,.85)';
            ctx.fill();
            ctx.strokeStyle = on ? '#4be2d2' : '#4be2d2';
            ctx.lineWidth = 1.5 * u;
            ctx.stroke();
            ctx.restore();
        }
        const shown = this.shown();
        if (shown) {
            const cur = this.quad[shown.corner];
            for (const c of shown.list) {
                const x = c.x * w / this.natW, y = c.y * h / this.natH, on = (0, geometry_1.dist)(c, cur) < 1;
                ctx.beginPath();
                ctx.arc(x, y, (on ? 8 : 6) * u, 0, 2 * Math.PI);
                ctx.strokeStyle = 'rgba(0,0,0,.55)';
                ctx.lineWidth = 4 * u;
                ctx.stroke();
                ctx.strokeStyle = on ? '#ffffff' : '#ffd166';
                ctx.lineWidth = 2 * u;
                ctx.stroke();
            }
        }
        const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
        for (let i = 0; i < 4; i++) {
            const p = q[i], on = (this.active?.kind === 'corner' && this.active.index === i) || shown?.corner === i;
            // Corner handle: an L-shaped bracket hugging the frame, so the exact corner stays visible and it reads
            // differently from the round candidate rings and from the numbered key cap below.
            const prev = q[(i + 3) % 4], next = q[(i + 1) % 4];
            const unit = (t) => { const dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l, l }; };
            const d1 = unit(prev), d2 = unit(next);
            const leg = Math.min((on ? 24 : 19) * u, d1.l * 0.4, d2.l * 0.4);
            ctx.beginPath();
            ctx.moveTo(p.x + d1.x * leg, p.y + d1.y * leg);
            ctx.lineTo(p.x, p.y);
            ctx.lineTo(p.x + d2.x * leg, p.y + d2.y * leg);
            ctx.strokeStyle = 'rgba(0,0,0,.55)';
            ctx.lineWidth = (on ? 7 : 6) * u;
            ctx.stroke();
            ctx.strokeStyle = on ? '#ffffff' : '#4be2d2';
            ctx.lineWidth = (on ? 4 : 3.2) * u;
            ctx.stroke();
            // Number as a keyboard key cap (the number is also the key that cycles this corner), set well away from the corner.
            let dx = p.x - cx, dy = p.y - cy;
            const dl = Math.hypot(dx, dy) || 1;
            dx /= dl;
            dy /= dl;
            const k = 22 * u, half = k / 2, m = half + 3 * u;
            const bx = Math.min(w - m, Math.max(m, p.x + dx * 34 * u)), by = Math.min(h - m, Math.max(m, p.y + dy * 34 * u));
            ctx.beginPath();
            ctx.roundRect(bx - half, by - half + 2 * u, k, k, 6 * u);
            ctx.fillStyle = 'rgba(0,0,0,.5)';
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(bx - half, by - half, k, k, 6 * u);
            ctx.fillStyle = on ? '#4be2d2' : '#f4f6f7';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,.35)';
            ctx.lineWidth = 1.2 * u;
            ctx.stroke();
            ctx.font = `700 ${13 * u}px -apple-system, "SF Pro Text", "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#0c3440';
            ctx.fillText(String(i + 1), bx, by + 0.5 * u);
        }
    }
    /** Called by the plugin's key handler; returns true when the key was used. */
    handleKey(key, shift) {
        if (!this.enabled || !this.canvas.isConnected || !'1234'.includes(key) || key.length !== 1)
            return false;
        this.cycleCorner(Number(key) - 1, shift ? -1 : 1);
        return true;
    }
    location(event) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: (event.clientX - rect.left) / rect.width * this.natW, y: (event.clientY - rect.top) / rect.height * this.natH };
    }
    /** A visible candidate dot under the pointer (ignoring the one the corner already sits on). */
    hitCandidate(p) {
        if (!this.cycle || this.dragging)
            return -1;
        const k = this.natW / Math.max(1, this.canvas.getBoundingClientRect().width);
        const cur = this.quad[this.cycle.corner];
        let best = -1, bestDist = 10 * k;
        this.cycle.list.forEach((c, i) => {
            if ((0, geometry_1.dist)(c, cur) < 12 * k)
                return;
            const d = (0, geometry_1.dist)(c, p);
            if (d < bestDist) {
                best = i;
                bestDist = d;
            }
        });
        return best;
    }
    hit(p) {
        const rect = this.canvas.getBoundingClientRect();
        const k = this.natW / Math.max(1, rect.width);
        let best = -1, bestDist = 22 * k;
        this.quad.forEach((c, i) => { const d = (0, geometry_1.dist)(c, p); if (d < bestDist) {
            best = i;
            bestDist = d;
        } });
        if (best >= 0)
            return { kind: 'corner', index: best };
        bestDist = 12 * k;
        for (let i = 0; i < 4; i++) {
            const d = (0, geometry_1.distToSegment)(p, this.quad[i], this.quad[(i + 1) % 4]);
            if (d < bestDist) {
                best = i;
                bestDist = d;
            }
        }
        return best >= 0 ? { kind: 'edge', index: best } : null;
    }
    drawLens(p) {
        const ctx = this.lens.getContext('2d');
        if (!ctx)
            return;
        const size = this.lensSize, half = size / 2, sourceSize = Math.max(32, this.natW / 22);
        const k = this.view.width / this.natW;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(this.view, (p.x - sourceSize / 2) * k, (p.y - sourceSize / 2) * k, sourceSize * k, sourceSize * k, 0, 0, size, size);
        ctx.strokeStyle = '#4be2d2';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(half, 0);
        ctx.lineTo(half, size);
        ctx.moveTo(0, half);
        ctx.lineTo(size, half);
        ctx.stroke();
        this.lens.style.display = 'block';
    }
}
class CorrectSlideModal extends obsidian_1.Modal {
    constructor(app, plugin, entry) {
        super(app);
        this.plugin = plugin;
        this.entry = entry;
        this.img = null;
        this.source = null;
        this.base = null;
        this.release = null;
        this.editor = null;
        this.timer = null;
        this.previewData = null;
        this.busy = false;
    }
    async onOpen() {
        this.modalEl.addClass('sfc-modal');
        this.titleEl.setText((0, i18n_1.t)('Correct projected slide'));
        this.info = this.contentEl.createDiv({ cls: 'sfc-help' });
        const toolbar = this.contentEl.createDiv({ cls: 'sfc-toolbar' });
        this.autoButton = addButton(toolbar, 'Auto-detect', () => this.editor?.autoDetect());
        this.resetButton = addButton(toolbar, 'Reset corners', () => this.editor?.reset());
        const more = addButton(toolbar, '⋯', ev => showInfoMenu(ev, fileRows(this.entry, this.source)));
        more.addClass('sfc-more');
        more.setAttribute('aria-label', (0, i18n_1.t)('More'));
        const prefs = this.plugin.prefs;
        addSelect(toolbar, 'Crop', CROP_OPTIONS, prefs.crop ? 'on' : 'off', v => {
            this.plugin.setPref('crop', v === 'on');
            this.editor?.setEnabled(v === 'on');
            this.updateCropUi();
            this.requestPreview(false);
        });
        addSelect(toolbar, 'Aspect', ASPECT_OPTIONS, prefs.aspect, v => { this.plugin.setPref('aspect', v); this.requestPreview(false); });
        addSelect(toolbar, 'Edge trim', TRIM_OPTIONS, prefs.trim, v => {
            this.plugin.setPref('trim', v);
            if (this.editor?.origin === 'auto')
                this.editor.autoDetect(); // re-run only if the frame is still the detector's own
        }, (0, i18n_1.t)(TRIM_HINT));
        addSelect(toolbar, 'Color', COLOR_OPTIONS, prefs.color, v => { this.plugin.setPref('color', v); this.requestPreview(false); });
        addSelect(toolbar, 'Tone', TONE_OPTIONS, prefs.tone, v => { this.plugin.setPref('tone', v); this.requestPreview(false); });
        addSelect(toolbar, 'Save as', FORMAT_OPTIONS, prefs.format, v => this.plugin.setPref('format', v));
        const body = this.contentEl.createDiv({ cls: 'sfc-body' });
        const panels = body.createDiv({ cls: 'sfc-panels' });
        const left = panels.createDiv({ cls: 'sfc-panel' });
        left.createEl('div', { cls: 'sfc-label', text: (0, i18n_1.t)('1 · Adjust frame') });
        const stage = left.createDiv({ cls: 'sfc-stage' });
        left.createDiv({ cls: 'sfc-help sfc-keyhint', text: (0, i18n_1.t)(KEY_HINT) });
        const right = panels.createDiv({ cls: 'sfc-panel' });
        right.createEl('div', { cls: 'sfc-label', text: (0, i18n_1.t)('2 · Corrected preview') });
        const prevWrap = right.createDiv({ cls: 'sfc-preview-wrap' });
        this.preview = prevWrap.createEl('canvas', { cls: 'sfc-preview' });
        const footer = this.contentEl.createDiv({ cls: 'sfc-footer' });
        footer.createDiv({ cls: 'sfc-help', text: (0, i18n_1.t)('Original photo stays untouched. Only this embed will change.') });
        const buttons = footer.createDiv({ cls: 'sfc-footer-buttons' });
        addButton(buttons, 'Cancel', () => this.close());
        this.saveButton = addButton(buttons, 'Save & replace in note', () => void this.save());
        this.saveButton.addClass('mod-cta');
        this.saveButton.disabled = true;
        try {
            const src = resolveSource(this.app, this.plugin, this.entry);
            this.source = src.file;
            const { img, release } = await loadImageFile(this.app, src.file);
            this.img = img;
            this.release = release;
            if (!src.fromOriginal && isProcessed(this.entry.file))
                this.info.setText((0, i18n_1.t)('Original photo not found — editing the processed image.'));
            const pscale = Math.min(1, 1150 / Math.max(img.naturalWidth, img.naturalHeight));
            const p = document.createElement('canvas');
            p.width = Math.round(img.naturalWidth * pscale);
            p.height = Math.round(img.naturalHeight * pscale);
            const pc = p.getContext('2d', { willReadFrequently: true });
            if (!pc)
                throw new Error('Canvas is unavailable');
            pc.drawImage(img, 0, 0, p.width, p.height);
            this.previewData = pc.getImageData(0, 0, p.width, p.height);
            this.editor = new QuadEditor(stage, img, final => {
                setAutoBadge(this.autoButton, 'Auto-detect', this.editor?.autoResult ?? false);
                if (final && this.editor)
                    noteDraft(this.plugin, src.file, this.editor, !!this.base && !isModified(this.base, this.editor.quad, outPrefs(this.plugin.prefs), this.editor.natW, this.editor.natH));
                this.requestPreview(!final);
            });
            this.editor.focus();
            const recQuad = usableQuad(src.rec, img);
            this.editor.autoDetect(usableQuad(this.plugin.drafts[src.file.path] ?? src.rec, img));
            this.editor.markInitial();
            if (isProcessed(this.entry.file))
                this.base = { quad: (recQuad ?? this.editor.quad).map(v => ({ ...v })), prefs: src.rec?.prefs ?? outPrefs(this.plugin.prefs) };
            this.editor.setEnabled(this.plugin.prefs.crop);
            this.updateCropUi();
            this.saveButton.disabled = false;
        }
        catch (err) {
            this.info.setText((0, i18n_1.t)('Image could not be opened: {0}', String(err)));
            new obsidian_1.Notice((0, i18n_1.t)('Could not open slide photo.'));
        }
    }
    onClose() {
        if (this.timer !== null)
            window.clearTimeout(this.timer);
        this.release?.();
        this.contentEl.empty();
    }
    updateCropUi() {
        const on = this.plugin.prefs.crop;
        this.autoButton.disabled = !on;
        this.resetButton.disabled = !on;
    }
    requestPreview(dragging) {
        if (!this.editor || !this.previewData)
            return;
        if (this.timer !== null)
            window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => { this.timer = null; this.renderPreview(); }, dragging ? 170 : 20);
    }
    renderPreview() {
        if (!this.editor || !this.previewData)
            return;
        const src = this.previewData;
        const sx = src.width / this.editor.natW, sy = src.height / this.editor.natH;
        const q = this.editor.quad.map(p => ({ x: p.x * sx, y: p.y * sy }));
        try {
            const processed = makeOutput(src, q, this.plugin.prefs, 680);
            this.preview.width = processed.width;
            this.preview.height = processed.height;
            this.preview.getContext('2d')?.putImageData(processed, 0, 0);
        }
        catch (err) {
            this.info.setText((0, i18n_1.t)('Please adjust the crop corners: {0}', String(err)));
        }
    }
    async save() {
        if (!this.img || !this.editor || this.busy)
            return;
        if (this.base && !isModified(this.base, this.editor.quad, outPrefs(this.plugin.prefs), this.editor.natW, this.editor.natH)) {
            new obsidian_1.Notice((0, i18n_1.t)('No changes — nothing to save.'));
            this.close();
            return;
        }
        this.busy = true;
        this.saveButton.disabled = true;
        this.saveButton.setText((0, i18n_1.t)('Saving…'));
        try {
            const saved = await saveCorrection(this.app, this.entry, this.source ?? this.entry.file, this.img, this.editor.quad, this.plugin.prefs);
            this.plugin.clearDraft((this.source ?? this.entry.file).path);
            this.plugin.addRecord(saved.path, { src: (this.source ?? this.entry.file).path, quad: this.editor.quad.map(v => ({ ...v })), w: this.img.naturalWidth, h: this.img.naturalHeight, prefs: outPrefs(this.plugin.prefs) });
            new obsidian_1.Notice((0, i18n_1.t)('Saved corrected slide.'));
            this.close();
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.t)('Could not save corrected slide: {0}', err instanceof Error ? err.message : String(err)), 6500);
            this.info.setText((0, i18n_1.t)('Save failed. The original image and embed were not overwritten.'));
        }
        finally {
            this.busy = false;
            if (this.saveButton?.isConnected) {
                this.saveButton.disabled = false;
                this.saveButton.setText((0, i18n_1.t)('Save & replace in note'));
            }
        }
    }
}
/** Dashboard: every embedded photo in the note as a card with its own editable frame. */
class BatchModal extends obsidian_1.Modal {
    constructor(app, plugin, entries) {
        super(app);
        this.plugin = plugin;
        this.defaultInclude = true;
        this.autoAll = false;
        this.observers = [];
        this.showProcessed = false;
        this.busy = false;
        this.closed = false;
        this.pumping = false;
        this.cards = entries.map(entry => ({ entry, source: null, processed: isProcessed(entry.file), root: null, editor: null, status: null, prev: null, refit: null, reason: null, base: null, include: null, autoBtn: null, preview: null, timer: null, loading: false, saved: false, failed: false }));
    }
    onOpen() {
        this.modalEl.addClass('sfc-modal');
        this.modalEl.addClass('sfc-batch-modal');
        this.titleEl.setText((0, i18n_1.t)('Slide photos in this note'));
        const toolbar = this.contentEl.createDiv({ cls: 'sfc-toolbar' });
        const prefs = this.plugin.prefs;
        addSelect(toolbar, 'Crop', CROP_OPTIONS, prefs.crop ? 'on' : 'off', v => {
            this.plugin.setPref('crop', v === 'on');
            for (const c of this.cards)
                c.editor?.setEnabled(v === 'on');
            this.refreshPreviews();
        });
        addSelect(toolbar, 'Aspect', ASPECT_OPTIONS, prefs.aspect, v => { this.plugin.setPref('aspect', v); this.refreshPreviews(); });
        addSelect(toolbar, 'Edge trim', TRIM_OPTIONS, prefs.trim, v => {
            this.plugin.setPref('trim', v);
            for (const c of this.cards)
                if (c.editor?.origin === 'auto')
                    c.editor.autoDetect();
        }, (0, i18n_1.t)(TRIM_HINT));
        addSelect(toolbar, 'Color', COLOR_OPTIONS, prefs.color, v => { this.plugin.setPref('color', v); this.refreshPreviews(); });
        addSelect(toolbar, 'Tone', TONE_OPTIONS, prefs.tone, v => { this.plugin.setPref('tone', v); this.refreshPreviews(); });
        addSelect(toolbar, 'Save as', FORMAT_OPTIONS, prefs.format, v => this.plugin.setPref('format', v));
        const autoAll = toolbar.createEl('label', { cls: 'sfc-field' });
        const autoBox = autoAll.createEl('input', { attr: { type: 'checkbox' } });
        autoAll.createEl('span', { text: (0, i18n_1.t)('Auto-detect all') });
        autoBox.addEventListener('change', () => {
            this.autoAll = autoBox.checked;
            for (const c of this.visible())
                if (autoBox.checked)
                    this.applyAuto(c);
                else
                    this.undoAuto(c);
        });
        const toggle = toolbar.createEl('label', { cls: 'sfc-field' });
        const box = toggle.createEl('input', { attr: { type: 'checkbox' } });
        toggle.createEl('span', { text: (0, i18n_1.t)('Show processed') });
        box.addEventListener('change', () => { this.showProcessed = box.checked; this.render(); });
        const all = toolbar.createEl('label', { cls: 'sfc-field' });
        this.master = all.createEl('input', { attr: { type: 'checkbox' } });
        this.master.checked = true;
        all.createEl('span', { text: (0, i18n_1.t)('Select all') });
        this.master.addEventListener('change', () => {
            this.defaultInclude = this.master.checked;
            for (const c of this.visible())
                if (c.include && !c.include.disabled)
                    c.include.checked = this.defaultInclude;
            this.updateSave();
        });
        this.summary = this.contentEl.createDiv({ cls: 'sfc-help' });
        const body = this.contentEl.createDiv({ cls: 'sfc-body' });
        this.grid = body.createDiv({ cls: 'sfc-grid' });
        this.empty = body.createDiv({ cls: 'sfc-empty sfc-help' });
        const footer = this.contentEl.createDiv({ cls: 'sfc-footer' });
        footer.createDiv({ cls: 'sfc-help', text: (0, i18n_1.t)('Originals stay untouched. Each selected photo is saved as a new image and its embed is replaced.') });
        const right = footer.createDiv({ cls: 'sfc-footer-right' });
        const buttons = right.createDiv({ cls: 'sfc-footer-buttons' });
        addButton(buttons, 'Close', () => this.close());
        this.saveButton = addButton(buttons, 'Save', () => void this.saveAll());
        this.saveButton.addClass('mod-cta');
        this.countEl = right.createDiv({ cls: 'sfc-help sfc-count' });
        this.render();
    }
    onClose() {
        this.closed = true;
        for (const c of this.cards)
            if (c.timer !== null)
                window.clearTimeout(c.timer);
        for (const o of this.observers)
            o.disconnect();
        this.contentEl.empty();
    }
    /** Tint the whole card when saving it would produce something new, and say what is different. */
    paintChange(c) {
        if (!c.root || !c.reason)
            return;
        const on = !!c.editor && !c.saved && this.changed(c);
        c.root.toggleClass('sfc-changed-card', on);
        let text = '';
        if (on) {
            if (!c.processed)
                text = (0, i18n_1.t)('New photo');
            else if (c.base && c.editor) {
                const parts = modifiedParts(c.base, c.editor.quad, outPrefs(this.plugin.prefs), c.editor.natW, c.editor.natH);
                text = (0, i18n_1.t)('Changed: {0}', parts.map(x => (0, i18n_1.t)(x)).join((0, i18n_1.t)(', ')));
            }
        }
        c.reason.setText(text);
    }
    refreshPreviews() { for (const c of this.cards)
        if (c.editor)
            this.schedulePreview(c, 20); this.updateSave(); }
    /** New photos always need saving; processed ones only if the frame or output settings moved since the last save. */
    changed(c) {
        if (!c.processed)
            return true;
        if (!c.base || !c.editor)
            return false;
        return isModified(c.base, c.editor.quad, outPrefs(this.plugin.prefs), c.editor.natW, c.editor.natH);
    }
    schedulePreview(card, delay = 120) {
        if (card.timer !== null)
            window.clearTimeout(card.timer);
        card.timer = window.setTimeout(() => { card.timer = null; this.renderPreview(card); }, delay);
    }
    renderPreview(card) {
        if (!card.editor || !card.preview || this.closed)
            return;
        const src = card.editor.sampleData();
        const sx = src.width / card.editor.natW, sy = src.height / card.editor.natH;
        const q = card.editor.quad.map(p => ({ x: p.x * sx, y: p.y * sy }));
        try {
            const out = makeOutput(src, q, this.plugin.prefs, 520);
            card.preview.width = out.width;
            card.preview.height = out.height;
            card.preview.getContext('2d')?.putImageData(out, 0, 0);
            card.refit?.();
        }
        catch { /* invalid frame while dragging: keep the last preview */ }
    }
    visible() { return this.cards.filter(c => this.showProcessed || !c.processed); }
    render() {
        const visible = this.visible();
        for (const card of this.cards) {
            const show = visible.includes(card);
            if (show && !card.root)
                this.buildCard(card);
            if (card.root)
                card.root.style.display = show ? '' : 'none';
        }
        const hidden = this.cards.length - visible.length;
        this.empty.setText(visible.length ? '' : (0, i18n_1.t)('All {0} photos in this note are already processed. Tick “Show processed” to re-edit one.', this.cards.length));
        this.empty.style.display = visible.length ? 'none' : '';
        this.summary.setText((0, i18n_1.t)('{0} shown', visible.length) + (hidden ? (0, i18n_1.t)(' · {0} processed hidden', hidden) : '') + ' · ' + (0, i18n_1.t)(KEY_HINT));
        this.updateSave();
        void this.pump();
    }
    buildCard(card) {
        const root = this.grid.createDiv({ cls: 'sfc-card' });
        const head = root.createDiv({ cls: 'sfc-card-head' });
        const label = head.createEl('label', { cls: 'sfc-card-name' });
        const include = label.createEl('input', { attr: { type: 'checkbox' } });
        include.checked = this.defaultInclude;
        include.addEventListener('change', () => this.updateSave());
        label.createEl('span', { text: (0, i18n_1.t)('Photo {0}', this.cards.indexOf(card) + 1) });
        const tools = head.createDiv({ cls: 'sfc-card-tools' });
        card.autoBtn = addButton(tools, 'Auto', () => { card.editor?.autoDetect(); });
        addButton(tools, 'Reset', () => { card.editor?.reset(); });
        const more = addButton(tools, '⋯', ev => showInfoMenu(ev, fileRows(card.entry, card.source)));
        more.addClass('sfc-more');
        more.setAttribute('aria-label', (0, i18n_1.t)('More'));
        card.reason = root.createDiv({ cls: 'sfc-reason' });
        card.status = root.createDiv({ cls: 'sfc-help', text: (0, i18n_1.t)('Loading…') });
        root.addEventListener('pointerdown', () => this.select(card), true);
        root.createDiv({ cls: 'sfc-stage' });
        const prev = root.createDiv({ cls: 'sfc-preview-wrap sfc-card-preview' });
        card.preview = prev.createEl('canvas', { cls: 'sfc-preview' });
        card.root = root;
        card.include = include;
        const stageEl = root.querySelector('.sfc-stage');
        const refit = () => {
            if (card.editor) {
                fitCanvas(card.editor.canvas, stageEl);
                card.editor.draw();
            }
            if (card.preview)
                fitCanvas(card.preview, prev);
        };
        card.refit = refit;
        const ro = new ResizeObserver(refit);
        ro.observe(stageEl);
        ro.observe(prev);
        this.observers.push(ro);
    }
    /** Auto-detect, remembering the frame it replaces so unticking the box can bring it back. */
    applyAuto(card) {
        if (!card.editor)
            return;
        if (!card.prev)
            card.prev = { quad: card.editor.quad.map(v => ({ ...v })), origin: card.editor.origin };
        card.editor.autoDetect();
    }
    /** Restore the earlier frame, unless the user has dragged this one since. */
    undoAuto(card) {
        const prev = card.prev;
        card.prev = null;
        if (!prev || !card.editor || card.editor.origin !== 'auto')
            return;
        card.editor.restore(prev.quad, prev.origin === 'auto' ? 'auto' : 'user');
    }
    select(card) {
        for (const c of this.cards)
            c.root?.toggleClass('sfc-selected', c === card);
        card.editor?.focus();
    }
    /** Loads cards one at a time so a long note stays responsive. */
    async pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            for (;;) {
                if (this.closed)
                    return;
                const card = this.visible().find(c => c.root && !c.editor && !c.loading && !c.failed);
                if (!card)
                    return;
                card.loading = true;
                try {
                    const src = resolveSource(this.app, this.plugin, card.entry);
                    card.source = src.file;
                    const { img, release } = await loadImageFile(this.app, src.file);
                    try {
                        if (this.closed)
                            return;
                        const stage = card.root.querySelector('.sfc-stage');
                        const editor = new QuadEditor(stage, img, final => { if (card.autoBtn)
                            setAutoBadge(card.autoBtn, 'Auto', editor.autoResult); if (final)
                            noteDraft(this.plugin, src.file, editor, !!card.base && !isModified(card.base, editor.quad, outPrefs(this.plugin.prefs), editor.natW, editor.natH)); this.schedulePreview(card); this.updateSave(); }, 900, 100);
                        card.editor = editor;
                        card.refit?.();
                        const recQuad = usableQuad(src.rec, img);
                        editor.autoDetect(usableQuad(this.plugin.drafts[src.file.path] ?? src.rec, img));
                        editor.markInitial();
                        if (card.processed)
                            card.base = { quad: (recQuad ?? editor.quad).map(v => ({ ...v })), prefs: src.rec?.prefs ?? outPrefs(this.plugin.prefs) };
                        editor.setEnabled(this.plugin.prefs.crop);
                        if (this.autoAll)
                            this.applyAuto(card);
                        card.status?.setText('');
                        if (!this.cards.some(c => c.root?.hasClass('sfc-selected')))
                            this.select(card);
                    }
                    finally {
                        release();
                    }
                }
                catch (err) {
                    card.failed = true;
                    card.status?.setText((0, i18n_1.t)('Could not open: {0}', err instanceof Error ? err.message : String(err)));
                    card.status?.addClass('sfc-warn');
                    if (card.include) {
                        card.include.checked = false;
                        card.include.disabled = true;
                    }
                }
                finally {
                    card.loading = false;
                }
                this.updateSave();
                await new Promise(r => window.setTimeout(r, 0));
            }
        }
        finally {
            this.pumping = false;
        }
    }
    selected() {
        return this.visible().filter(c => c.include?.checked && c.editor && !c.saved);
    }
    updateSave() {
        if (!this.saveButton)
            return;
        const sel = this.selected(), n = sel.filter(c => this.changed(c)).length, visible = this.visible();
        this.saveButton.setText((0, i18n_1.t)('Save'));
        this.saveButton.disabled = this.busy || n === 0;
        this.countEl.setText((0, i18n_1.t)('{0}/{1} selected changed', n, sel.length));
        for (const c of this.cards)
            this.paintChange(c);
        const eligible = visible.filter(c => c.include && !c.include.disabled);
        const checked = eligible.filter(c => c.include.checked).length;
        this.master.checked = eligible.length > 0 && checked === eligible.length;
        this.master.indeterminate = checked > 0 && checked < eligible.length;
        this.master.disabled = eligible.length === 0;
    }
    async saveAll() {
        if (this.busy)
            return;
        // Replace later embeds first so earlier offsets in the note stay valid.
        const skipped = this.selected().filter(c => !this.changed(c)).length;
        const todo = this.selected().filter(c => this.changed(c)).sort((a, b) => a.entry.note.path === b.entry.note.path ? b.entry.ref.start - a.entry.ref.start : 0);
        if (!todo.length)
            return;
        this.busy = true;
        this.updateSave();
        let ok = 0, bad = 0;
        for (const [i, card] of todo.entries()) {
            this.saveButton.setText((0, i18n_1.t)('Saving {0}/{1}…', i + 1, todo.length));
            card.status?.setText((0, i18n_1.t)('Saving…'));
            card.status?.removeClass('sfc-warn');
            let release = null;
            try {
                const source = card.source ?? card.entry.file;
                const loaded = await loadImageFile(this.app, source);
                release = loaded.release;
                const quad = card.editor.quad.map(v => ({ ...v }));
                const saved = await saveCorrection(this.app, card.entry, source, loaded.img, quad, this.plugin.prefs);
                this.plugin.clearDraft(source.path);
                this.plugin.addRecord(saved.path, { src: source.path, quad, w: loaded.img.naturalWidth, h: loaded.img.naturalHeight, prefs: outPrefs(this.plugin.prefs) });
                card.base = card.processed ? { quad, prefs: outPrefs(this.plugin.prefs) } : null;
                card.saved = true;
                ok++;
                card.status?.setText((0, i18n_1.t)('Saved ✓'));
                card.root?.addClass('sfc-saved');
                if (card.include) {
                    card.include.checked = false;
                    card.include.disabled = true;
                }
            }
            catch (err) {
                bad++;
                card.status?.setText((0, i18n_1.t)('Failed: {0}', err instanceof Error ? err.message : String(err)));
                card.status?.addClass('sfc-warn');
            }
            finally {
                release?.();
            }
        }
        this.busy = false;
        new obsidian_1.Notice((bad ? (0, i18n_1.t)('Saved {0} corrected slide(s); {1} failed (see the dashboard).', ok, bad) : (0, i18n_1.t)('Saved {0} corrected slide(s).', ok)) + (skipped ? ' ' + (0, i18n_1.t)('{0} unchanged skipped.', skipped) : ''), bad ? 6500 : 4000);
        if (!bad && !this.closed)
            this.close();
        else
            this.updateSave();
    }
}
class CleanOriginalsModal extends obsidian_1.Modal {
    constructor(app, plugin, files) {
        super(app);
        this.plugin = plugin;
        this.files = files;
    }
    onOpen() {
        this.titleEl.setText((0, i18n_1.t)('Clean processed originals?'));
        this.contentEl.createDiv({ cls: 'sfc-help', text: (0, i18n_1.t)('{0} original photo(s) already have a corrected version and are not used in any note. They will be moved to the trash (according to your Obsidian “Deleted files” setting).', this.files.length) });
        const list = this.contentEl.createEl('ul', { cls: 'sfc-clean-list' });
        for (const f of this.files)
            list.createEl('li', { text: f.path });
        const buttons = this.contentEl.createDiv({ cls: 'sfc-footer-buttons sfc-clean-buttons' });
        addButton(buttons, 'Cancel', () => this.close());
        const go = addButton(buttons, (0, i18n_1.t)('Move {0} to trash', this.files.length), () => void this.run(go));
        go.addClass('mod-warning');
    }
    async run(btn) {
        btn.disabled = true;
        let n = 0;
        for (const f of this.files) {
            try {
                await this.app.fileManager.trashFile(f);
                n++;
                this.plugin.forgetOriginal(f.path);
            }
            catch (err) {
                new obsidian_1.Notice(`${f.path}: ${err instanceof Error ? err.message : String(err)}`, 6000);
            }
        }
        new obsidian_1.Notice((0, i18n_1.t)('Moved {0} original photo(s) to the trash.', n));
        this.close();
    }
    onClose() { this.contentEl.empty(); }
}
class SlideFrameSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        const dropdown = (name, desc, opts, key, rerender = false) => {
            new obsidian_1.Setting(containerEl).setName((0, i18n_1.t)(name)).setDesc((0, i18n_1.t)(desc)).addDropdown(d => {
                for (const [caption, value] of opts)
                    d.addOption(value, (0, i18n_1.t)(caption));
                d.setValue(String(this.plugin.prefs[key])).onChange(v => { this.plugin.setPref(key, v); if (rerender)
                    this.display(); });
            });
        };
        dropdown('Language', 'Language of this plugin’s interface. Commands update after reloading Obsidian.', LANG_OPTIONS, 'lang', true);
        dropdown('Aspect ratio', 'Output shape of the corrected slide. These choices are also remembered when you change them in the editor.', ASPECT_OPTIONS, 'aspect');
        dropdown('Save as', 'File format of the corrected image.', FORMAT_OPTIONS, 'format');
        new obsidian_1.Setting(containerEl).setName((0, i18n_1.t)('Crop to slide')).setDesc((0, i18n_1.t)('Off keeps the whole photo and only applies color/tone.')).addToggle(tg => tg.setValue(this.plugin.prefs.crop).onChange(v => this.plugin.setPref('crop', v)));
        dropdown('Edge trim', TRIM_HINT, TRIM_OPTIONS, 'trim');
        dropdown('Color correction', 'Auto white balance and levels. Off keeps the original colors; Strong is the most aggressive.', COLOR_OPTIONS, 'color');
        dropdown('Tone', 'Color, grayscale, or pure black & white (applied after color correction).', TONE_OPTIONS, 'tone');
        new obsidian_1.Setting(containerEl).setName((0, i18n_1.t)('Clean originals')).setDesc((0, i18n_1.t)('Move original photos that already have a corrected version and are no longer used in any note to the trash. You confirm the list first.'))
            .addButton(b => b.setButtonText((0, i18n_1.t)('Clean…')).setWarning().onClick(() => this.plugin.openCleanOriginals()));
    }
}
class SlideFrameCorrector extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.prefs = { ...DEFAULT_PREFS };
        /** Output image path -> original photo and the frame that produced it, so re-editing starts from the original. */
        this.records = {};
        /** Frames the user dragged but did not save, keyed by original photo path. */
        this.drafts = {};
        this.rightClickImage = null;
        this.ctx = null;
        this.lastMenuShown = 0;
    }
    setPref(key, value) {
        this.prefs[key] = value;
        if (key === 'lang')
            (0, i18n_1.setLang)(value);
        if (key === 'trim')
            currentTrim = value;
        this.persist();
    }
    addRecord(path, rec) { this.records[path] = rec; this.persist(); }
    setDraft(path, rec) { this.drafts[path] = rec; this.persist(); }
    clearDraft(path) { if (this.drafts[path]) {
        delete this.drafts[path];
        this.persist();
    } }
    /** Drop records whose original photo was removed, so re-editing falls back gracefully. */
    forgetOriginal(srcPath) {
        for (const [k, r] of Object.entries(this.records))
            if (r.src === srcPath)
                delete this.records[k];
        delete this.drafts[srcPath];
        this.persist();
    }
    /** Originals that have a corrected output and are not linked from any note any more. */
    findCleanableOriginals() {
        const linked = new Set();
        for (const links of Object.values(this.app.metadataCache.resolvedLinks))
            for (const target of Object.keys(links))
                linked.add(target);
        const out = new Map();
        for (const [outPath, rec] of Object.entries(this.records)) {
            const o = this.app.vault.getAbstractFileByPath(outPath), src = this.app.vault.getAbstractFileByPath(rec.src);
            if (o instanceof obsidian_1.TFile && src instanceof obsidian_1.TFile && src.path !== o.path && !linked.has(src.path))
                out.set(src.path, src);
        }
        return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
    openCleanOriginals() {
        const files = this.findCleanableOriginals();
        if (!files.length) {
            new obsidian_1.Notice((0, i18n_1.t)('Nothing to clean: no original photo has a corrected version that is unused elsewhere.'));
            return;
        }
        new CleanOriginalsModal(this.app, this, files).open();
    }
    persist() { void this.saveData({ ...this.prefs, records: this.records, drafts: this.drafts }); }
    async onload() {
        const saved = (await this.loadData()) ?? {};
        const pick = (v, opts, fallback) => opts.some(o => o[1] === v) ? v : fallback;
        this.prefs = {
            aspect: pick(saved.aspect, ASPECT_OPTIONS, DEFAULT_PREFS.aspect),
            format: pick(saved.format, FORMAT_OPTIONS, DEFAULT_PREFS.format),
            color: pick(saved.color, COLOR_OPTIONS, DEFAULT_PREFS.color),
            tone: pick(saved.tone, TONE_OPTIONS, DEFAULT_PREFS.tone),
            crop: typeof saved.crop === 'boolean' ? saved.crop : DEFAULT_PREFS.crop,
            lang: pick(saved.lang, LANG_OPTIONS, DEFAULT_PREFS.lang),
            trim: pick(saved.trim, TRIM_OPTIONS, DEFAULT_PREFS.trim)
        };
        (0, i18n_1.setLang)(this.prefs.lang);
        currentTrim = this.prefs.trim;
        this.records = saved.records && typeof saved.records === 'object' ? saved.records : {};
        this.drafts = saved.drafts && typeof saved.drafts === 'object' ? saved.drafts : {};
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            let changed = false;
            if (this.records[oldPath]) {
                this.records[file.path] = this.records[oldPath];
                delete this.records[oldPath];
                changed = true;
            }
            for (const r of Object.values(this.records))
                if (r.src === oldPath) {
                    r.src = file.path;
                    changed = true;
                }
            if (this.drafts[oldPath]) {
                this.drafts[file.path] = { ...this.drafts[oldPath], src: file.path };
                delete this.drafts[oldPath];
                changed = true;
            }
            if (changed)
                this.persist();
        }));
        this.addSettingTab(new SlideFrameSettingTab(this.app, this));
        // Keys 1-4 act on the editor the pointer last entered; typing in inputs/selects is never intercepted.
        this.registerDomEvent(document, 'keydown', (event) => {
            if (!activeEditor || event.ctrlKey || event.metaKey || event.altKey)
                return;
            const t = event.target;
            if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
                return;
            if (activeEditor.handleKey(event.key, event.shiftKey)) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
        this.addCommand({
            id: 'correct-slide-in-current-note',
            name: (0, i18n_1.t)('Correct one photo'),
            checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
                if (!view?.file)
                    return false;
                if (!checking)
                    void this.fromCommand(view);
                return true;
            }
        });
        this.addCommand({
            id: 'batch-correct-slides-in-current-note',
            name: (0, i18n_1.t)('Correct all photos'),
            checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
                if (!view?.file)
                    return false;
                if (!checking)
                    void this.openBatch(view);
                return true;
            }
        });
        // Remember the image under the pointer for Live Preview's native editor-menu.
        this.addCommand({ id: 'clean-processed-originals', name: (0, i18n_1.t)('Clean originals'), callback: () => this.openCleanOriginals() });
        // Right-click on an image -> "Correct projected slide"; on the document -> "Batch correct…".
        // Obsidian's own menu is kept: our item is appended to whatever menu Obsidian opens for that click,
        // and only if Obsidian opens none (e.g. blank space in reading view) do we show a menu of our own.
        this.registerDomEvent(document, 'contextmenu', (event) => {
            this.ctx = null;
            this.rightClickImage = null;
            const el = event.target;
            if (!(el instanceof Element) || !el.closest('.markdown-preview-view, .markdown-source-view'))
                return;
            const view = this.viewFor(el);
            if (!view?.file)
                return;
            // In Live Preview the click can land on the embed's wrapper rather than on the <img> itself, so look inside the embed too.
            const embed = el.closest('.internal-embed, .image-embed, .media-embed, .cm-embed-block');
            const img = el.closest('img') ?? embed?.querySelector('img') ?? null;
            this.rightClickImage = img;
            let kind = null;
            if (img)
                kind = 'image';
            else if (embed)
                kind = null; // some other embed or widget: leave Obsidian's menu alone
            else if (el.closest('.cm-editor') || el.matches('.markdown-source-view, .markdown-preview-view, .markdown-preview-sizer, .markdown-preview-pusher'))
                kind = 'batch';
            if (!kind)
                return;
            const time = Date.now();
            const ctx = { kind, view, img, time };
            this.ctx = ctx;
            window.setTimeout(() => {
                if (this.lastMenuShown >= time || this.ctx !== ctx)
                    return;
                const menu = new obsidian_1.Menu();
                menu.__sfc = true;
                this.fillMenu(menu, ctx);
                menu.showAtMouseEvent(event);
            }, 40);
        }, true);
        const proto = obsidian_1.Menu.prototype;
        for (const name of ['showAtMouseEvent', 'showAtPosition']) {
            const orig = proto[name];
            if (typeof orig !== 'function')
                continue;
            const self = this;
            proto[name] = function (...args) {
                try {
                    self.lastMenuShown = Date.now();
                    const c = self.ctx;
                    if (!this.__sfc && c && Date.now() - c.time < 300) {
                        this.__sfc = true;
                        self.fillMenu(this, c);
                    }
                }
                catch { /* never block Obsidian's own menu */ }
                return orig.apply(this, args);
            };
            this.register(() => { proto[name] = orig; });
        }
    }
    fillMenu(menu, c) {
        menu.addSeparator();
        if (c.kind === 'image')
            menu.addItem(item => item.setTitle((0, i18n_1.t)('Correct projected slide')).setIcon('scan-line').onClick(() => void this.openForView(c.view, c.img, c.view.getMode() === 'source' ? c.view.editor : undefined)));
        else
            menu.addItem(item => item.setTitle((0, i18n_1.t)('Batch correct slides in note…')).setIcon('layout-grid').onClick(() => void this.openBatch(c.view)));
    }
    viewFor(el) {
        let view = null;
        this.app.workspace.iterateAllLeaves(leaf => {
            if (!view && leaf.view instanceof obsidian_1.MarkdownView && leaf.view.containerEl.contains(el))
                view = leaf.view;
        });
        return view;
    }
    async entriesFor(view) {
        const note = view.file;
        if (!note)
            return [];
        const refs = (0, links_1.parseImageRefs)(await getContent(view, this.app));
        const entries = [];
        for (const ref of refs) {
            const file = getRefFile(this.app, ref, note);
            if (file)
                entries.push({ ref, file, note });
        }
        return entries;
    }
    async fromCommand(view) {
        await this.openForView(view, null, view.getMode() === 'source' ? view.editor : undefined);
    }
    async openBatch(view) {
        try {
            const entries = await this.entriesFor(view);
            if (!entries.length) {
                new obsidian_1.Notice((0, i18n_1.t)('No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.'));
                return;
            }
            new BatchModal(this.app, this, entries).open();
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.t)('Failed to read note images: {0}', String(err)));
        }
    }
    async openForView(view, img, editor) {
        try {
            const entries = await this.entriesFor(view);
            if (!entries.length) {
                new obsidian_1.Notice((0, i18n_1.t)('No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.'));
                return;
            }
            let selection = null;
            if (img) {
                const embed = img.closest('.internal-embed') ?? img.closest('.image-embed');
                const target = embed?.getAttribute('src')?.split('|')[0] ?? '';
                const filename = decodeTarget(target);
                const same = entries.filter(e => {
                    const resource = this.app.vault.getResourcePath(e.file);
                    return (filename && (e.ref.target === filename || e.file.path === filename || e.file.name === filename || e.file.basename === filename))
                        || img.src.split('?')[0] === resource.split('?')[0];
                });
                if (same.length === 1)
                    selection = same[0];
            }
            if (!selection && editor) {
                const index = editor.posToOffset(editor.getCursor());
                selection = entries.find(e => index >= e.ref.start && index <= e.ref.end) ?? null;
            }
            if (selection)
                this.openEditor(selection);
            else if (entries.length === 1)
                this.openEditor(entries[0]);
            else
                new BatchModal(this.app, this, entries).open();
        }
        catch (err) {
            new obsidian_1.Notice((0, i18n_1.t)('Failed to read note images: {0}', String(err)));
        }
    }
    openEditor(entry) { new CorrectSlideModal(this.app, this, entry).open(); }
}
exports.default = SlideFrameCorrector;

}
};
const __cache={};
function __load(id){
if(!Object.prototype.hasOwnProperty.call(__modules,id))return require(id);
if(__cache[id])return __cache[id].exports;
const m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__load);return m.exports;
}
module.exports=__load('./main');
})();
