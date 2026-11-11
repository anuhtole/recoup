// The particle coin's engine. Blender designed the shapes (prototypes/blender/coin_poses.py wrote
// coin-poses.bin and coin-poses.json next to this file); this file plays them. Three.js comes from a
// CDN, so nothing is installed, and the app loads this file on demand (see Coin.tsx) so the rest of
// the app still works if the CDN cannot be reached. No API is called.
// The coin, its burst, swirl, loose cloud and ring come from Blender. The radar, bars, check and paper
// plane are worked out here for the same points (see `place`), and need no files of their own.
// This is version 2. Version 1 (water ripples, Talking as bars) is kept as prototypes/particle-coin-v1.mjs.
import * as THREE from "https://esm.sh/three@0.170.0";

const TAU = Math.PI * 2;
// Written out in full so the build can find both files and ship them.
const POSES_JSON = new URL("./coin-poses.json", import.meta.url);
const POSES_BIN = new URL("./coin-poses.bin", import.meta.url);

// Every duration, in seconds. Changing how a state feels is a change here, never a Blender re-export.
export const TIMING = {
  idleLoop: 4.5, // one breath out and back
  approvalLoop: 2, // the "needs your approval" pulse
  burstOut: 0.3, // found money: the throw
  burstSettle: 0.6, // found money: the spring back
  scatter: 0.3, // coin to ring: points let go into a loose cloud
  fly: 0.7, // coin to ring: each point's flight onto the ring
  fuse: 0.6, // coin to ring: the solid ring growing around as it takes the points in
  swirlTurn: 3, // thinking: one lap of the rim around the coin
  talkHold: 0.5, // talking: how long the voice outlasts the last word
  arcFill: 0.6, // the ring settling to its value, and later changes of value (and of the bars' heights)
  reducedFade: 0.3, // reduced motion: every change is a fade this long
  radarTurn: 2.6, // radar: one lap of the sweep line
  planeHold: 0.5, // paper plane: the beat it holds, whole, before it leaves
  planeFly: 0.9, // paper plane: its flight out of the picture
};

// How far each state pushes points along Blender's "burst" pose (0 = on the coin, 1 = fully thrown).
const AMOUNT = { idleRest: 0.012, idleBreath: 0.07, found: 0.45, approval: 0.06 };
const MARK_SHARE = 0.6; // the R moves less than the body, so it stays readable
const RING_GROW = 0.22; // the ring is drawn a little larger than the coin

// Talking: the rim stays one unbroken ring, and its outline bumps with the voice. A few broad swells
// travel around it, and they stand taller the louder the voice is. Sizes are in coin radii.
const VOICE = {
  swell: 0.17, // the tallest bump at full loudness
  lift: 0.03, // how far the whole ring stands off the coin at full loudness
  // Each swell: how many bumps it puts around the ring, how fast it travels (radians a second,
  // negative is clockwise) and its share of the height. The shares add up to 1.
  waves: [
    { bumps: 2, speed: 1.6, share: 0.4 },
    { bumps: 3, speed: -2.3, share: 0.35 },
    { bumps: 5, speed: 3.4, share: 0.25 },
  ],
  calm: 0.6, // the share of its drift the rim gives up while talking, so the ring stays one clean line
  face: 0.02, // how far the inner points lift with the loudness (share of the burst pose)
  rate: 21, // syllables, in radians per second (about 3.3 a second)
  ease: 10, // how quickly the loudness follows the syllables
};

// The pointer's wake: the points hang like dust in still air. A moving pointer carries the ones in
// its path along, the air curls back around it and takes others with it, and they all drift back
// home with no bounce. Sizes are in coin radii.
const WAKE = {
  reach: 0.22, // how far from the pointer points feel it
  push: 1.4, // how hard points in its path are carried along
  part: 1.6, // how hard they are pushed aside, out of its way
  curl: 1.6, // how hard the air curling back around its path carries the points beside it
  gust: 3.2, // each point's own random kick, so no two take the same path
  depth: 2, // how hard they are knocked toward you or away
  drag: 4, // how quickly the air stops a moving point
  home: 3.2, // how firmly a point is drawn back to its place (kept under the drag, so it settles without a bounce)
  eddy: 1.1, // how much a point's way home curls, in radians per second
  light: 0.9, // the spread between the lightest and heaviest points (light ones fly further and settle later)
  markShare: 0.4, // the R gives way less than the body, so it stays readable
  maxStep: 0.5, // the most pointer travel one frame counts
  linger: 6, // seconds the air keeps moving after the pointer stops
};

// The loose drift every point has on top of its pose, in coin radii.
const FLOW = {
  stream: 0.03, // a slow current that neighbouring points share
  wander: 0.022, // each point's own meander
  markShare: 0.3, // the R drifts this much of what the body does
  strayReach: 4, // a few body points roam up to this many times further
  thinkingCalm: 0.6, // the share of its drift the rim gives up while it circles the coin, so it stays a tight edge
};
const LAND_LEAD = 0.75; // points land on the ring this share of the sweep ahead of the solid
const SINK_LEAD = 0.07; // how far ahead of the solid's head (in turns) points start sinking into it

// The other formations the dust can make. Each is reached and left exactly as the ring is: the points
// let go, fly onto the shape and sink into a solid that grows over them. Their poses are worked out
// here, in code, for the same points. Sizes are in coin radii; "by" and "from" are shares of the
// solid's sweep (0 = its first moment, 1 = whole).
const SHAPES = ["radar", "bars", "plane", "check"];
const BAR_KEYS = ["", "bars1", "bars2", "bars3", "bars4", "bars5"]; // a new count is a new formation
// Radar: the ring, a smaller ring inside it and a hub, with a sweep line that keeps turning.
const RADAR = {
  inner: 0.5, // the inner ring's radius, as a share of the ring's
  tube: 0.026, // the inner ring's thickness
  innerShare: 0.2, // the share of the points that make the inner ring
  hub: 0.075, // the hub's radius
  hubShare: 0.02,
  hubBy: 0.15, // the hub is whole by this share of the sweep
  hand: 0.024, // the sweep line's thickness
  trail: 0.3, // how far the fade trails behind the sweep line, in turns
  glow: 0.34, // the fade's strength right behind the line
  thin: 0.45, // how much of its thickness the outer ring gives up once the sweep is running
  still: 0.11, // reduced motion: where the line rests, in turns
};
// Bars: one to five round-topped columns standing on a line, left to right.
const BARS = {
  radius: 0.11, // half a bar's width
  pitch: 0.36, // from one bar's centre to the next
  floor: -0.36, // the line they stand on
  low: 0.16, // the height of a bar worth 0
  high: 1.4, // the height of a bar worth 1
  half: 0.95, // half the line's length
  line: 0.022, // the line's thickness
  lineBy: 0.35, // the line is whole by this share of the sweep
  rise: 0.55, // the share of the sweep each bar takes to rise (they start one after another)
  lineShare: 0.5, // the line's pull on the points, where a full bar's is 1.4
  sink: 0.45, // how far from a bar's middle its points come to rest inside it, as a share of its radius
};
// Check: a smaller ring, lifted to leave room for a figure under it, with a check mark inside.
const CHECK = {
  scale: 0.85, // the ring's size against the savings ring
  lift: 0.34, // how far up it sits
  mark: [-0.3, 0.02, -0.07, -0.21, 0.33, 0.23], // the mark's three corners (x, y), before the scale and lift
  share: 0.16, // the share of the points that make the mark
  from: 0.45, // the mark is drawn between these shares of the sweep
  to: 0.95,
};
// Paper plane: an outline with one fold, nose to the upper right.
const PLANE = {
  outline: [-0.075, -0.075, -0.75, 0.225, 0.75, 0.75, 0.225, -0.75], // notch, left wing, nose, right wing (x, y)
  tube: 0.05, // the line's thickness
  outlineBy: 0.85, // the outline is whole by this share of the sweep
  foldFrom: 0.45, // the fold (notch to nose) is drawn from this share on
  far: 1.05, // how far it flies, right and up
  shrink: 0.7, // the share of its size it loses on the way, as if into the distance
  fade: 0.68, // it fades out from this share of the flight on
  shed: 0.6, // it drops its dust over this share of the flight
  hang: 0.8, // seconds a dropped point takes to drift from where it was left back to the loose cloud
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v) => 1 - (1 - v) ** 3;
const easeInOut = (v) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);
const smooth = (v) => v * v * (3 - 2 * v);

// A small seeded random source, so every visit shows the same motion.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadPoses() {
  const get = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url.pathname}: ${res.status}`);
    return res;
  };
  const [manifest, buffer] = await Promise.all([
    get(POSES_JSON).then((r) => r.json()),
    get(POSES_BIN).then((r) => r.arrayBuffer()),
  ]);
  const { count, scale, poses: names } = manifest;
  const raw = new Int16Array(buffer); // little-endian, like every browser this runs in
  if (raw.length !== count * 3 * names.length) throw new Error("coin-poses.bin does not match coin-poses.json");
  const poses = {};
  names.forEach((name, p) => {
    const out = new Float32Array(count * 3);
    const from = p * count * 3;
    for (let j = 0; j < out.length; j++) out[j] = (raw[from + j] * scale) / 32767;
    poses[name] = out;
  });
  return { manifest, poses };
}

// A soft round dot, so points read as light rather than squares.
function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Draws the coin on `canvas` and returns its controls.
 * setState: "idle" | "thinking" | "talking" | "found" | "approval". "found" replays its burst on every call.
 * setRing: "savings" | "deadline" with a 0..1 value turns the coin into the solid ring; null turns it back.
 * setShape: "radar" | "bars" | "plane" | "check" turns it into that shape; null turns it back. A shape
 *   and a ring are not set together (a shape wins if they are). Going from one formation to another
 *   runs back to the dust first, from wherever the points are.
 * watch: tells the page which formation is solid on screen, so it knows when a figure can show.
 * pulse: keeps the voice going; call it per word while a reply streams in.
 */
export function createCoin(canvas) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Colours come from the app's tokens, never from literals.
  const css = getComputedStyle(document.documentElement);
  const C = Object.fromEntries(
    ["ink", "paper", "line", "line-strong", "sub", "mint", "mint-ink", "amber"].map((n) => [
      n,
      new THREE.Color(css.getPropertyValue(`--${n}`).trim()),
    ]),
  );

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.z = 6.4;
  camera.updateMatrixWorld();
  const key = new THREE.DirectionalLight(C.paper, 2.4);
  key.position.set(-1.5, 2.5, 4);
  scene.add(key, new THREE.AmbientLight(C.paper, 1.9));
  const pivot = new THREE.Group();
  scene.add(pivot);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // What the page asked for. The frame loop eases toward it.
  // `key` names the formation that follows from it: "ring", a shape, "bars" with its count, or null.
  const want = { state: "idle", ring: null, value: 0, shape: null, fill: 0, bars: new Float32Array(5), barCount: 1, onDone: null, key: null };
  let spent = false; // the paper plane asked for has left: it is not formed again until it is asked for again
  let owed = false; // the plane's onDone is due once the coin is back
  let heard = null; // the page's watch() listener
  const rekey = () => {
    const shape = want.shape && !(want.shape === "plane" && spent) ? want.shape : null;
    want.key = shape === "bars" ? BAR_KEYS[want.barCount] : shape || (want.ring ? "ring" : null);
  };
  let speed = 1;
  let foundAt = -Infinity;
  let spoke = false; // a word arrived since the last frame
  // The pointer, in the canvas's own -1..1 space. The frame loop finds where that is on the coin.
  const pointer = { x: 0, y: 0, inside: false, moved: false, fresh: true };
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = 1 - ((e.clientY - r.top) / r.height) * 2;
    pointer.inside = pointer.moved = true;
  };
  const onLeave = () => {
    pointer.inside = false;
    pointer.fresh = true; // the next move has nothing to measure its travel from
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  let raf = 0;
  let disposed = false;
  const trash = [renderer];

  const ready = loadPoses().then(({ manifest, poses }) => {
    if (disposed) return;
    const n = manifest.count;
    const { coin, burst, swirl, scatter, ring } = poses;
    const markEnd = manifest.groups.mark[0] + manifest.groups.mark[1];
    const rimStart = manifest.groups.rim[0]; // the rim's points come last
    const R = manifest.ring.radius;
    const tube = manifest.ring.tube;

    // Per-point constants: timing offsets, how freely it drifts, and where it meets the ring.
    const rand = seeded(manifest.seed);
    const phase = new Float32Array(n);
    const stagger = new Float32Array(n);
    const rate = new Float32Array(n); // how fast it meanders
    const reach = new Float32Array(n); // how far it drifts
    const rad = new Float32Array(n); // its distance from the coin's centre
    const bear = new Float32Array(n); // its bearing from the coin's centre
    const turnAt = new Float32Array(n); // its place on the ring, in turns clockwise from 12 o'clock
    const mid = new Float32Array(n * 2); // the ring's centre line at that place
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      phase[i] = rand() * TAU;
      stagger[i] = rand();
      rate[i] = 0.5 + rand() * 0.9;
      const stray = rand() ** 4;
      reach[i] = i < markEnd ? FLOW.markShare : 1 + FLOW.strayReach * stray;
      rad[i] = Math.hypot(coin[j], coin[j + 1]) || 1;
      bear[i] = Math.atan2(coin[j + 1], coin[j]);
      const rx = ring[j];
      const ry = ring[j + 1];
      const len = Math.hypot(rx, ry) || 1;
      turnAt[i] = (Math.atan2(rx, ry) / TAU + 1) % 1;
      mid[i * 2] = (rx / len) * R;
      mid[i * 2 + 1] = (ry / len) * R;
    }

    // The points: the R in ink on top of the body in deep green. Both share one position buffer.
    const out = new Float32Array(n * 3);
    out.set(coin);
    const dot = softDot();
    const cloud = (from, to, color, size, order) => {
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(out.subarray(from * 3, to * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", attr);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4); // the points move every frame
      const mat = new THREE.PointsMaterial({ color, size, map: dot, transparent: true, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      points.renderOrder = order;
      pivot.add(points);
      trash.push(geo, mat);
      return { attr, mat, size, points };
    };
    const body = cloud(markEnd, n, C["mint-ink"], 0.12, 1);
    const mark = cloud(0, markEnd, C.ink, 0.1, 2);
    trash.push(dot);

    // The solid ring. It is drawn before the points and writes depth, so a point that has sunk to the
    // ring's centre line is hidden inside it: the solid takes the points in as it grows around.
    const solid = (color) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, transparent: true, opacity: 0 });
      trash.push(mat);
      return mat;
    };
    const ringGroup = new THREE.Group();
    ringGroup.visible = false;
    pivot.add(ringGroup);
    // Turned so an arc starts at 12 o'clock and runs clockwise.
    const clockwise = () => {
      const group = new THREE.Group();
      group.quaternion
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      ringGroup.add(group);
      return group;
    };
    const capGeo = new THREE.SphereGeometry(tube, 20, 12);

    // The track: the ring the points make. It ends up pale, under the value's arc.
    const trackMat = solid(C["mint-ink"]);
    const trackGroup = clockwise();
    const trackMesh = new THREE.Mesh(new THREE.BufferGeometry(), trackMat);
    const trackTail = new THREE.Mesh(capGeo, trackMat);
    const trackHead = new THREE.Mesh(capGeo, trackMat);
    trackTail.position.set(R, 0, 0);
    trackGroup.add(trackMesh, trackTail, trackHead);
    let trackBuilt = [-1, -1];
    const buildTrack = (share, radius) => {
      trackMesh.geometry.dispose();
      trackMesh.geometry = new THREE.TorusGeometry(R, radius, 16, Math.max(8, Math.round(128 * share)), share * TAU);
      trackHead.position.set(Math.cos(share * TAU) * R, Math.sin(share * TAU) * R, 0);
      trackHead.scale.setScalar(radius / tube);
      trackTail.scale.setScalar(radius / tube);
      trackHead.visible = trackTail.visible = share < 0.999;
      trackBuilt = [share, radius];
    };

    // The value: a filled arc from 12 o'clock, and clock ticks for the deadline.
    const arcMat = solid(C["mint-ink"]);
    const arcGroup = clockwise();
    const arcMesh = new THREE.Mesh(new THREE.BufferGeometry(), arcMat);
    const capStart = new THREE.Mesh(capGeo, arcMat);
    const capEnd = new THREE.Mesh(capGeo, arcMat);
    capStart.position.set(R, 0, 0);
    arcGroup.add(arcMesh, capStart, capEnd);
    const tickMat = solid(C.sub);
    const tickGeo = new THREE.BoxGeometry(0.018, 0.07, 0.018);
    const ticks = new THREE.Group();
    for (let h = 0; h < 12; h++) {
      const tick = new THREE.Mesh(tickGeo, tickMat);
      const a = (h / 12) * TAU;
      const long = h % 3 === 0;
      tick.scale.y = long ? 1.6 : 1;
      const r = R - tube - 0.07 - (long ? 0.02 : 0);
      tick.position.set(Math.sin(a) * r, Math.cos(a) * r, 0);
      tick.rotation.z = -a;
      ticks.add(tick);
    }
    ringGroup.add(ticks);
    trash.push(capGeo, tickGeo);
    let arcBuilt = -1;
    const buildArc = (value) => {
      arcMesh.geometry.dispose();
      arcMesh.geometry = new THREE.TorusGeometry(R, tube, 16, Math.max(8, Math.round(128 * value)), value * TAU);
      capEnd.position.set(Math.cos(value * TAU) * R, Math.sin(value * TAU) * R, 0);
      arcBuilt = value;
    };
    trash.push({ dispose: () => (arcMesh.geometry.dispose(), trackMesh.geometry.dispose()) });

    // The other formations' solids, in the ring's own material: lines are tubes with round ends, so
    // they catch the light the way the ring does. Each is a group that is only drawn while its
    // formation is on screen, and none of them is rebuilt while it moves: they are scaled and placed.
    const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const domeGeo = new THREE.SphereGeometry(1, 20, 8, 0, TAU, 0, Math.PI / 2);
    trash.push(tubeGeo, domeGeo);
    const group = () => {
      const made = new THREE.Group();
      made.visible = false;
      pivot.add(made);
      return made;
    };
    const bead = (parent, mat, x, y, radius) => {
      const made = new THREE.Mesh(capGeo, mat);
      made.position.set(x, y, 0);
      made.scale.setScalar(radius / tube);
      parent.add(made);
      return made;
    };
    // A straight line from a to b. The function it returns shows the line's first share, 0..1.
    const stroke = (parent, mat, ax, ay, bx, by, radius) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      const body = new THREE.Mesh(tubeGeo, mat);
      body.rotation.z = Math.atan2(-dx, dy);
      const head = bead(parent, mat, ax, ay, radius);
      parent.add(body);
      return (share) => {
        body.visible = head.visible = share > 0.001;
        if (!body.visible) return;
        body.position.set(ax + (dx * share) / 2, ay + (dy * share) / 2, 0);
        body.scale.set(radius, len * share, radius);
        head.position.set(ax + dx * share, ay + dy * share, 0);
      };
    };

    // Radar: the outer ring is the track above. Inside it, a thin ring that sweeps around with it
    // (one fixed tube, shown up to its head), a hub, and the sweep line with the fade behind it.
    const radarGroup = group();
    const innerMat = solid(C["mint-ink"]);
    const INNER_AROUND = 96;
    const INNER_ACROSS = 10;
    const innerR = R * RADAR.inner;
    const innerGeo = (() => {
      const row = INNER_ACROSS + 1;
      const at = new Float32Array((INNER_AROUND + 1) * row * 3);
      const normal = new Float32Array(at.length);
      const index = [];
      for (let a = 0; a <= INNER_AROUND; a++) {
        const turn = (a / INNER_AROUND) * TAU; // clockwise from 12 o'clock
        const ux = Math.sin(turn);
        const uy = Math.cos(turn);
        for (let c = 0; c <= INNER_ACROSS; c++) {
          const v = (c / INNER_ACROSS) * TAU;
          const o = (a * row + c) * 3;
          normal[o] = ux * Math.cos(v);
          normal[o + 1] = uy * Math.cos(v);
          normal[o + 2] = Math.sin(v);
          at[o] = ux * innerR + normal[o] * RADAR.tube;
          at[o + 1] = uy * innerR + normal[o + 1] * RADAR.tube;
          at[o + 2] = normal[o + 2] * RADAR.tube;
        }
        if (a < INNER_AROUND) for (let c = 0; c < INNER_ACROSS; c++) {
          const p = a * row + c;
          index.push(p, p + 1, p + row, p + row, p + 1, p + row + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(at, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
      geo.setIndex(index);
      return geo;
    })();
    radarGroup.add(new THREE.Mesh(innerGeo, innerMat));
    const innerTail = bead(radarGroup, innerMat, 0, innerR, RADAR.tube);
    const innerHead = bead(radarGroup, innerMat, 0, innerR, RADAR.tube);
    const hub = bead(radarGroup, arcMat, 0, 0, RADAR.hub);
    const handGroup = new THREE.Group();
    radarGroup.add(handGroup);
    const handMat = solid(C["mint-ink"]);
    stroke(handGroup, handMat, 0, 0, 0, R, RADAR.hand)(1);
    // The fade: a fan behind the line, strongest beside it and gone at its far edge.
    const TRAIL_STEPS = 48;
    const trailGeo = (() => {
      const at = new Float32Array((TRAIL_STEPS + 1) * 2 * 3);
      const tint = new Float32Array((TRAIL_STEPS + 1) * 2 * 4).fill(1);
      const index = [];
      const far = R - tube * 0.5;
      for (let s = 0; s <= TRAIL_STEPS; s++) {
        const back = (s / TRAIL_STEPS) * RADAR.trail * TAU; // counter-clockwise from the line
        at[s * 6 + 3] = -Math.sin(back) * far;
        at[s * 6 + 4] = Math.cos(back) * far;
        tint[s * 8 + 3] = tint[s * 8 + 7] = (1 - s / TRAIL_STEPS) ** 2;
        if (s < TRAIL_STEPS) index.push(s * 2, s * 2 + 1, s * 2 + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(at, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(tint, 4));
      geo.setIndex(index);
      return geo;
    })();
    const trailMat = new THREE.MeshBasicMaterial({
      color: C["mint-ink"],
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.renderOrder = -1; // under the rings and the line
    handGroup.add(trail);
    trash.push(innerGeo, trailGeo, trailMat);

    // Bars: up to five columns with domed tops, and the line they stand on.
    const barsGroup = group();
    const baseMat = solid(C["mint-ink"]);
    bead(barsGroup, baseMat, -BARS.half, BARS.floor, BARS.line);
    const showBase = stroke(barsGroup, baseMat, -BARS.half, BARS.floor, BARS.half, BARS.floor, BARS.line);
    const barBody = [];
    const barDome = [];
    for (let k = 0; k < 5; k++) {
      barBody.push(new THREE.Mesh(tubeGeo, arcMat));
      barDome.push(new THREE.Mesh(domeGeo, arcMat));
      barsGroup.add(barBody[k], barDome[k]);
    }
    const barTall = (value) => BARS.low + (BARS.high - BARS.low) * value;
    const showBar = (k, x, tall) => {
      const cap = Math.min(BARS.radius, tall); // a bar starts as a bead and grows to its width, then up
      const column = tall - cap;
      barDome[k].visible = tall > 0.002;
      barBody[k].visible = column > 0.002;
      barDome[k].position.set(x, BARS.floor + column, 0);
      barDome[k].scale.setScalar(cap);
      barBody[k].position.set(x, BARS.floor + column / 2, 0);
      barBody[k].scale.set(cap, column, cap);
    };
    const barNow = new Float32Array(5); // each bar's height on screen
    let barCount = 1; // how many the formation on screen has
    let barsMoved = false; // their heights have changed since the points were given their places

    // Check: the mark, inside the ring above (which is drawn smaller and higher for it).
    const checkGroup = group();
    const mark3 = CHECK.mark.map((v, k) => v * CHECK.scale + (k % 2 ? CHECK.lift : 0));
    const markTube = tube * CHECK.scale;
    const markLen = [Math.hypot(mark3[2] - mark3[0], mark3[3] - mark3[1]), Math.hypot(mark3[4] - mark3[2], mark3[5] - mark3[3])];
    bead(checkGroup, arcMat, mark3[0], mark3[1], markTube);
    const showMark = [
      stroke(checkGroup, arcMat, mark3[0], mark3[1], mark3[2], mark3[3], markTube),
      stroke(checkGroup, arcMat, mark3[2], mark3[3], mark3[4], mark3[5], markTube),
    ];

    // Paper plane: the outline is one line through its four corners and back, then the fold.
    const planeGroup = group();
    const planeMat = solid(C["mint-ink"]);
    const corner = PLANE.outline;
    bead(planeGroup, planeMat, corner[0], corner[1], PLANE.tube);
    const showPlane = [];
    const planeLen = [];
    for (let k = 0; k < 4; k++) {
      const a = k * 2;
      const b = ((k + 1) % 4) * 2;
      showPlane.push(stroke(planeGroup, planeMat, corner[a], corner[a + 1], corner[b], corner[b + 1], PLANE.tube));
      planeLen.push(Math.hypot(corner[b] - corner[a], corner[b + 1] - corner[a + 1]));
    }
    const outlineLen = planeLen[0] + planeLen[1] + planeLen[2] + planeLen[3];
    const foldLen = Math.hypot(corner[4] - corner[0], corner[5] - corner[1]);
    const showFold = stroke(planeGroup, planeMat, corner[0], corner[1], corner[4], corner[5], PLANE.tube);

    // Where the points go for a formation made here: the place each lands (on a solid's surface),
    // the place inside the solid it sinks to, and its turn (the share of the sweep at which the
    // solid reaches it). The ring's own come from Blender, above. One set is enough: only one
    // formation is on screen at a time, and it is filled in while no point is on its way anywhere.
    const madePose = new Float32Array(n * 3);
    const madeMid = new Float32Array(n * 2);
    const madeTurn = new Float32Array(n);
    const shedAt = new Float32Array(n); // paper plane: seconds into the flight at which it drops this point
    const shedFar = new Float32Array(n); // and how far along its way it is by then, 0..1
    const roll = seeded(manifest.seed + 2);
    // Spreads the points evenly over 0..1 whatever their order, so every part gets an even share.
    const spread = (i) => {
      const v = (i + 0.5) * 0.6180339887498949;
      return v - Math.floor(v);
    };
    // Puts point i on the surface of a tube from a to b, the share `along` of the way down it.
    const onTube = (i, ax, ay, bx, by, along, radius) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const around = roll() * TAU;
      const out = Math.cos(around) * radius;
      const cx = ax + dx * along;
      const cy = ay + dy * along;
      madePose[i * 3] = cx - (dy / len) * out;
      madePose[i * 3 + 1] = cy + (dx / len) * out;
      madePose[i * 3 + 2] = Math.sin(around) * radius;
      madeMid[i * 2] = cx;
      madeMid[i * 2 + 1] = cy;
    };
    // Puts point i on the ring from Blender, drawn `scale` times the size and `lift` higher, with
    // its tube `thick` times as thick.
    const onRing = (i, scale, lift, thick) => {
      const j = i * 3;
      const mx = mid[i * 2] * scale;
      const my = mid[i * 2 + 1] * scale + lift;
      madePose[j] = mx + (ring[j] - mid[i * 2]) * thick;
      madePose[j + 1] = my + (ring[j + 1] - mid[i * 2 + 1]) * thick;
      madePose[j + 2] = ring[j + 2] * thick;
      madeMid[i * 2] = mx;
      madeMid[i * 2 + 1] = my;
      madeTurn[i] = turnAt[i];
    };
    const place = {
      radar() {
        for (let i = 0; i < n; i++) {
          const u = spread(i);
          if (u < RADAR.hubShare) {
            const around = roll() * TAU;
            const up = roll() * 2 - 1;
            const flat = Math.sqrt(1 - up * up) * RADAR.hub;
            madePose[i * 3] = Math.cos(around) * flat;
            madePose[i * 3 + 1] = Math.sin(around) * flat;
            madePose[i * 3 + 2] = up * RADAR.hub;
            madeMid[i * 2] = madeMid[i * 2 + 1] = 0;
            madeTurn[i] = roll() * RADAR.hubBy;
          } else if (u < RADAR.hubShare + RADAR.innerShare) onRing(i, RADAR.inner, 0, RADAR.tube / tube);
          else onRing(i, 1, 0, 1);
        }
      },
      bars() {
        // The solids are at these heights now, whatever was asked for since.
        let pull = BARS.lineShare;
        for (let k = 0; k < barCount; k++) pull += barNow[k];
        const rise = barCount > 1 ? BARS.rise : 1;
        for (let i = 0; i < n; i++) {
          let left = spread(i) * pull;
          if (left < BARS.lineShare) {
            const along = left / BARS.lineShare;
            onTube(i, -BARS.half, BARS.floor, BARS.half, BARS.floor, along, BARS.line);
            madeTurn[i] = along * BARS.lineBy;
            continue;
          }
          left -= BARS.lineShare;
          let k = 0;
          while (k < barCount - 1 && left >= barNow[k]) left -= barNow[k++];
          const tall = barNow[k];
          const up = Math.min(1, left / tall);
          const x = (k - (barCount - 1) / 2) * BARS.pitch;
          const y = up * tall;
          const shoulder = tall - BARS.radius; // where the dome starts
          const wide = y > shoulder ? Math.sqrt(Math.max(0, BARS.radius ** 2 - (y - shoulder) ** 2)) : BARS.radius;
          const around = roll() * TAU;
          madePose[i * 3] = x + Math.cos(around) * wide;
          madePose[i * 3 + 1] = BARS.floor + y;
          madePose[i * 3 + 2] = Math.sin(around) * wide;
          // A bar is wide, so its points only sink part of the way to its middle: enough to be inside.
          madeMid[i * 2] = x + Math.cos(around) * wide * BARS.sink;
          madeMid[i * 2 + 1] = BARS.floor + Math.min(y, tall - BARS.radius * 0.5);
          madeTurn[i] = (barCount > 1 ? ((1 - rise) * k) / (barCount - 1) : 0) + rise * up;
        }
        barsMoved = false;
      },
      check() {
        const whole = markLen[0] + markLen[1];
        for (let i = 0; i < n; i++) {
          const u = spread(i);
          if (u >= CHECK.share) {
            onRing(i, CHECK.scale, CHECK.lift, CHECK.scale);
            continue;
          }
          const along = u / CHECK.share;
          const run = along * whole;
          if (run < markLen[0]) onTube(i, mark3[0], mark3[1], mark3[2], mark3[3], run / markLen[0], markTube);
          else onTube(i, mark3[2], mark3[3], mark3[4], mark3[5], (run - markLen[0]) / markLen[1], markTube);
          madeTurn[i] = CHECK.from + (CHECK.to - CHECK.from) * along;
        }
      },
      plane() {
        const whole = outlineLen + foldLen;
        for (let i = 0; i < n; i++) {
          let run = spread(i) * whole;
          if (run >= outlineLen) {
            const along = (run - outlineLen) / foldLen;
            onTube(i, corner[0], corner[1], corner[4], corner[5], along, PLANE.tube);
            madeTurn[i] = PLANE.foldFrom + (1 - PLANE.foldFrom) * along;
          } else {
            madeTurn[i] = (run / outlineLen) * PLANE.outlineBy;
            let k = 0;
            while (k < 3 && run >= planeLen[k]) run -= planeLen[k++];
            const a = k * 2;
            const b = ((k + 1) % 4) * 2;
            onTube(i, corner[a], corner[a + 1], corner[b], corner[b + 1], run / planeLen[k], PLANE.tube);
          }
          const when = roll() * PLANE.shed;
          shedAt[i] = when * TIMING.planeFly;
          shedFar[i] = when * when;
        }
      },
    };

    // Eased values the frame loop owns.
    let t = 0;
    let last = performance.now() / 1000;
    let m = 0; // 0 = coin, 1 = the points are all inside the solid ring
    let settle = 0; // 0 = the ring the points made, 1 = pale track with the value's arc on it
    let wThink = 0;
    let wApprove = 0;
    let wTalk = 0;
    let wTicks = 0;
    let talkUntil = -Infinity;
    let voice = 0; // talking: how loud the voice is right now, 0..1
    const waves = VOICE.waves;
    const swells = new Float32Array(waves.length); // talking: how far around each swell has travelled
    let spin = 0; // thinking: how far the rim has turned around the coin, in radians
    let arcShown = 0;
    // The pointer's wake: each point's offset from its place and that offset's speed, how heavy the
    // point is, which way its path home curls, and the pointer's last place on the coin.
    const off = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const weight = new Float32Array(n);
    const lean = new Float32Array(n);
    const air = seeded(manifest.seed + 1);
    for (let i = 0; i < n; i++) {
      weight[i] = 1 + WAKE.light * (air() - 0.5);
      lean[i] = WAKE.eddy * (air() * 2 - 1);
    }
    const at = { x: 0, y: 0 };
    const caster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const inverse = new THREE.Matrix4();
    const from = new THREE.Vector3();
    const aim = new THREE.Vector3();
    const reach2 = WAKE.reach * WAKE.reach;
    let wakeUntil = -Infinity;
    let stirredBefore = false;
    const ringColor = C["mint-ink"].clone();
    const bodyColor = new THREE.Color();
    // Coin to ring, in seconds: the cloud opens, points fly to the ring in order around it, and the
    // solid sweeps around behind them.
    const total = TIMING.scatter + TIMING.fly + TIMING.fuse;
    const flyFrom = TIMING.scatter * 0.6;
    const sweepFrom = flyFrom + TIMING.fly; // the first point has landed
    const sweepLen = total - sweepFrom;
    const landSpread = sweepLen * LAND_LEAD;

    // The formation the points are in or on their way to: `cur` is its key (see `want.key`), `kind`
    // the same without the bars' count, and the three arrays are its places. A formation that is no
    // longer wanted runs back as far as the loose cloud, where no point is on its way to anything,
    // and that is where it is dropped and the next one taken up: one formation never cuts to another.
    let cur = null;
    let kind = null;
    let pose = ring;
    let turnOf = turnAt;
    let sink = mid;
    const dustAt = flyFrom / total; // `m` at the loose cloud, before any point has set off
    let launch = -1; // paper plane: seconds since it took off, or -1 while it has not
    let held = 0; // paper plane: seconds it has been whole
    let veil = 0; // reduced motion: 1 while any formation is wanted, so the coin stays hidden between two
    let told = null; // the formation the page was last told is solid
    let hand = 0; // radar: how far around the sweep line is, in radians clockwise from 12 o'clock
    const take = (key) => {
      cur = key;
      kind = key === "ring" || SHAPES.includes(key) ? key : "bars";
      launch = -1;
      held = 0;
      hand = 0;
      if (kind === "bars") {
        barCount = want.barCount;
        for (let k = 0; k < barCount; k++) barNow[k] = barTall(want.bars[k]);
      }
      if (kind === "ring") {
        pose = ring;
        turnOf = turnAt;
        sink = mid;
      } else {
        place[kind]();
        pose = madePose;
        turnOf = madeTurn;
        sink = madeMid;
      }
      // The check's ring is the savings ring, smaller and higher.
      ringGroup.scale.setScalar(kind === "check" ? CHECK.scale : 1);
      ringGroup.position.y = kind === "check" ? CHECK.lift : 0;
    };
    const drop = () => {
      cur = kind = null;
      launch = -1;
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const wall = now / 1000;
      const dt = Math.min(0.05, Math.max(0, wall - last)) * speed;
      last = wall;
      t += dt;
      const ease = (cur, to, speedOf) => cur + (to - cur) * (1 - Math.exp(-dt * speedOf));

      if (spoke) {
        talkUntil = t + TIMING.talkHold;
        spoke = false;
      }
      wThink = ease(wThink, want.state === "thinking" ? 1 : 0, reduced ? 12 : 3);
      wApprove = ease(wApprove, want.state === "approval" ? 1 : 0, reduced ? 12 : 5);
      wTalk = ease(wTalk, want.state === "talking" && t < talkUntil ? 1 : 0, 5);
      // A stand-in for a voice's loudness: syllables of uneven length, with pauses between phrases.
      const syllable = 0.5 + 0.5 * Math.sin(t * VOICE.rate + 1.7 * Math.sin(t * 5.7));
      const phrase = smooth(clamp01(0.75 + 0.6 * Math.sin(t * 1.9 + 2 * Math.sin(t * 0.8))));
      voice = ease(voice, (0.3 + 0.7 * syllable ** 1.5) * phrase, VOICE.ease);
      // Thinking turns the rim. Afterwards it coasts on to a whole lap, so every point is home again.
      if (wThink > 0.001 || spin > 0) {
        spin += ((dt * TAU) / TIMING.swirlTurn) * Math.max(wThink, 0.25);
        if (spin >= TAU) spin = wThink > 0.001 ? spin - TAU : 0;
      }
      // Which formation the points are for. One that is no longer wanted (or a plane that has taken
      // off) is let go at the loose cloud, and the wanted one is taken up from there.
      const key = want.key;
      const dust = reduced ? 0 : dustAt;
      if (cur !== null && (launch >= 0 || cur !== key) && m <= dust + 1e-6) drop();
      if (cur === null && key !== null) take(key);
      const hold = cur !== null && launch < 0 && cur === key;
      // The deadline's ink is the ring's alone: a shape on its way out keeps its green.
      const clock = kind === "ring" && want.ring === "deadline";
      wTicks = ease(wTicks, clock ? 1 : 0, 8);
      ringColor.lerp(clock ? C.ink : C["mint-ink"], 1 - Math.exp(-dt * 8));

      // Forward: the points make the ring, then it settles to its value. Back: it un-settles first.
      // A formation that is making way for another goes back only as far as the dust.
      const goal = hold ? 1 : cur !== null && key !== null ? dust : 0;
      if (reduced) {
        settle = 1;
        veil += Math.sign((key ? 1 : 0) - veil) * Math.min(Math.abs((key ? 1 : 0) - veil), dt / TIMING.reducedFade);
      } else {
        settle = ease(settle, hold && m >= 1 ? 1 : 0, hold ? 3 / TIMING.arcFill : 12);
        if (settle < 0.001) settle = 0;
      }
      if (reduced || goal > m || settle < 0.03) {
        const step = dt / (reduced ? TIMING.reducedFade : total);
        m += Math.sign(goal - m) * Math.min(Math.abs(goal - m), step);
      }
      // The paper plane holds for a beat once it is whole, then leaves by itself.
      if (kind === "plane") {
        if (launch >= 0) launch += dt;
        else if (hold && m >= 1 && (held += dt) >= TIMING.planeHold) {
          launch = 0;
          spent = owed = true;
          rekey();
        }
      }
      // Where the plane is on its way out: how far (0..1, gathering speed), its size and its shift.
      const flying = launch >= 0 && !reduced;
      const flown = flying ? clamp01(launch / TIMING.planeFly) ** 2 : 0;
      const planeSize = 1 - PLANE.shrink * flown;
      const planeShift = PLANE.far * flown;
      const ts = m * total;
      const fly = reduced ? 0 : easeInOut(clamp01((ts - flyFrom) / TIMING.fly));
      const sweepRaw = (ts - sweepFrom) / sweepLen;
      const sweep = reduced ? (m > 0 ? 1 : 0) : clamp01(sweepRaw);

      // Found money: thrown out, then a damped spring home, with one mint flash.
      const since = t - foundAt;
      let kFound = 0;
      if (since >= 0 && since < TIMING.burstOut) kFound = easeOut(since / TIMING.burstOut);
      else if (since >= TIMING.burstOut) {
        const u = (since - TIMING.burstOut) / TIMING.burstSettle;
        kFound = u < 2 ? Math.exp(-5 * u) * Math.cos(u * TAU * 1.1) : 0;
      }
      const flash = since >= 0 ? clamp01(1 - since / (TIMING.burstOut + TIMING.burstSettle)) ** 2 : 0;

      const breath = 0.5 - 0.5 * Math.cos((t * TAU) / TIMING.idleLoop);
      const beat = 0.5 - 0.5 * Math.cos((t * TAU) / TIMING.approvalLoop);
      const calm = 1 - wApprove;
      const kOut =
        (AMOUNT.idleRest + AMOUNT.idleBreath * breath * breath) * calm +
        AMOUNT.approval * beat * wApprove +
        AMOUNT.found * kFound;

      if (!reduced) {
        // Where the pointer is on the coin, and how far it travelled since the last frame.
        let mx = 0;
        let my = 0;
        let moved = 0;
        if (pointer.moved && pointer.inside) {
          caster.setFromCamera(ndc.set(pointer.x, pointer.y), camera);
          inverse.copy(pivot.matrixWorld).invert();
          from.copy(caster.ray.origin).applyMatrix4(inverse);
          aim.copy(caster.ray.direction).transformDirection(inverse);
          const s = -from.z / aim.z;
          const lx = from.x + aim.x * s;
          const ly = from.y + aim.y * s;
          if (!pointer.fresh) {
            mx = lx - at.x;
            my = ly - at.y;
            moved = Math.hypot(mx, my);
            if (moved > WAKE.maxStep) {
              mx *= WAKE.maxStep / moved;
              my *= WAKE.maxStep / moved;
              moved = WAKE.maxStep;
            }
          }
          at.x = lx;
          at.y = ly;
          pointer.fresh = false;
          if (moved > 0) wakeUntil = t + WAKE.linger;
        }
        pointer.moved = false;
        const stirred = t < wakeUntil;
        if (stirredBefore && !stirred) {
          off.fill(0);
          vel.fill(0);
        }
        stirredBefore = stirred;
        const pull = WAKE.home * dt;
        const damp = Math.exp(-WAKE.drag * dt);

        const cosS = Math.cos(spin);
        const sinS = Math.sin(spin);
        const thinking = wThink > 0.001;
        const talking = wTalk > 0.001;
        const loud = talking ? wTalk * voice : 0;
        // Each swell travels around the ring at its own pace.
        if (talking) for (let s = 0; s < waves.length; s++) swells[s] = t * waves[s].speed + s * 2.1;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          const cx = coin[j];
          const cy = coin[j + 1];
          const cz = coin[j + 2];
          const ph = phase[i];
          const isMark = i < markEnd;
          const isRim = i >= rimStart;

          // Breathing, the approval beat and the found-money burst all push along the burst pose.
          // Talking lifts the inner points a little with the voice. The R holds still.
          let k = kOut;
          if (loud && !isMark && !isRim) k += VOICE.face * loud;
          if (isMark) k *= MARK_SHARE;
          k *= 0.7 + 0.3 * Math.sin(t * 1.1 + ph);
          let x = cx + (burst[j] - cx) * k;
          let y = cy + (burst[j + 1] - cy) * k;
          let z = cz + (burst[j + 2] - cz) * k;

          let w = 0;
          if (isRim) {
            // Talking: the rim stays one ring. Every point moves straight out from the centre by the
            // height of the swells passing its bearing, so the ring's outline bumps with the voice.
            if (talking) {
              let rise = 0;
              for (let s = 0; s < waves.length; s++) rise += waves[s].share * Math.sin(waves[s].bumps * bear[i] + swells[s]);
              const g = 1 + (loud * (VOICE.lift + VOICE.swell * (0.5 + 0.5 * rise))) / rad[i];
              x *= g;
              y *= g;
            }
            // Thinking: the rim gathers into Blender's streaks and circles the coin, clockwise.
            // The R and the inner points stay where they are.
            if (thinking) {
              w = smooth(clamp01(wThink * 1.35 - stagger[i] * 0.35));
              x += (swirl[j] - x) * w;
              y += (swirl[j + 1] - y) * w;
              z += (swirl[j + 2] - z) * w;
            }
            const rx = x * cosS + y * sinS;
            y = y * cosS - x * sinS;
            x = rx;
          }

          // Coin to ring: let go into a loose cloud, spiral onto the ring, then sink into the solid
          // as its head comes around.
          let landed = 0;
          let sunk = 0;
          if (m > 0) {
            const p1 = easeOut(clamp01((ts - stagger[i] * 0.08) / TIMING.scatter));
            x += (scatter[j] - x) * p1;
            y += (scatter[j + 1] - y) * p1;
            z += (scatter[j + 2] - z) * p1;
            if (launch < 0) {
              landed = easeInOut(clamp01((ts - flyFrom - turnOf[i] * landSpread) / TIMING.fly));
              if (landed > 0) {
                const spin = (1 - landed) * 1.1;
                const cs = Math.cos(spin);
                const sn = Math.sin(spin);
                const rx = pose[j] * cs - pose[j + 1] * sn;
                const ry = pose[j] * sn + pose[j + 1] * cs;
                x += (rx - x) * landed;
                y += (ry - y) * landed;
                z += (pose[j + 2] - z) * landed;
              }
              sunk = smooth(clamp01((sweepRaw - turnOf[i]) / SINK_LEAD + 1));
              if (sunk > 0) {
                x += (sink[i * 2] - x) * sunk;
                y += (sink[i * 2 + 1] - y) * sunk;
                z -= z * sunk;
              }
            } else {
              // The paper plane has taken off. A point rides inside it until the plane drops it;
              // from then it hangs where it was left and drifts back to the loose cloud.
              const left = launch - shedAt[i]; // seconds since the plane dropped it
              if (left <= 0) {
                x = sink[i * 2] * planeSize + planeShift;
                y = sink[i * 2 + 1] * planeSize + planeShift;
                z = 0;
                landed = sunk = 1;
              } else {
                const far = shedFar[i];
                const size = 1 - PLANE.shrink * far;
                const home = easeInOut(clamp01(left / PLANE.hang));
                const lx = sink[i * 2] * size + PLANE.far * far;
                const ly = sink[i * 2 + 1] * size + PLANE.far * far;
                x = lx + (x - lx) * home;
                y = ly + (y - ly) * home;
                z *= home;
                landed = 1 - home;
              }
            }
          }

          // The loose drift: a shared slow current plus each point's own meander. It calms as a
          // point lands on the ring and stops once it is inside the solid.
          const d = reach[i] * (1 - FLOW.thinkingCalm * w) * (isRim ? 1 - VOICE.calm * wTalk : 1) * (1 - 0.8 * landed) * (1 - sunk);
          if (d > 0.001) {
            const a = t * rate[i] + ph;
            x += d * (FLOW.stream * Math.sin(cy * 3.1 + t * 0.6) + FLOW.wander * Math.sin(a));
            y += d * (FLOW.stream * Math.sin(cx * 2.7 - t * 0.5) + FLOW.wander * Math.sin(a * 1.31 + ph));
            z += d * (FLOW.stream * Math.sin((cx + cy) * 2.3 + t * 0.7) + FLOW.wander * Math.cos(a * 0.83 + ph));
          }

          // The pointer's wake: dust in still air. A moving pointer carries the points in its path
          // along and parts them, the air curling back around it takes the points beside it the
          // other way, and each gets a kick of its own. The air soon stops them, and they drift
          // home slowly on a curling path, with no bounce.
          if (stirred) {
            const share = (1 - 0.8 * landed) * (1 - sunk) * (isMark ? WAKE.markShare : 1);
            if (moved > 0) {
              const dx = out[j] - at.x;
              const dy = out[j + 1] - at.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < reach2 * 6) {
                const near = Math.exp(-d2 / reach2) / weight[i];
                const aside = (moved * WAKE.part) / (Math.sqrt(d2) || 1);
                // Strongest beside the path and nothing straight ahead or behind.
                const back = (WAKE.curl * (mx * dy - my * dx)) / reach2;
                const kick = moved * WAKE.gust;
                vel[j] += (mx * WAKE.push + dx * aside - dy * back + kick * Math.sin(ph * 7.3 + t * 3.1)) * near;
                vel[j + 1] += (my * WAKE.push + dy * aside + dx * back + kick * Math.cos(ph * 5.1 - t * 2.3)) * near;
                vel[j + 2] += moved * WAKE.depth * near * Math.sin(ph * 3.7 + t * 1.9);
              }
            }
            const draw = pull * weight[i];
            const turn = lean[i] * dt;
            const vx = (vel[j] - off[j] * draw) * damp;
            const vy = (vel[j + 1] - off[j + 1] * draw) * damp;
            const vz = (vel[j + 2] - off[j + 2] * draw) * damp;
            vel[j] = vx - vy * turn;
            vel[j + 1] = vy + vx * turn;
            vel[j + 2] = vz;
            const ox = off[j] + vel[j] * dt;
            const oy = off[j + 1] + vel[j + 1] * dt;
            off[j] = ox - oy * turn;
            off[j + 1] = oy + ox * turn;
            off[j + 2] += vz * dt;
            x += off[j] * share;
            y += off[j + 1] * share;
            z += off[j + 2] * share;
          }
          out[j] = x;
          out[j + 1] = y;
          out[j + 2] = z;
        }
        body.attr.needsUpdate = true;
        mark.attr.needsUpdate = true;
      }

      // Colour and opacity. With reduced motion these fades are the whole animation.
      bodyColor.copy(C["mint-ink"]).lerp(C.amber, wApprove * (reduced ? 1 : 0.6 + 0.4 * beat));
      bodyColor.lerp(C.mint, flash * 0.85);
      body.mat.color.copy(bodyColor).lerp(ringColor, fly);
      mark.mat.color.copy(C.ink).lerp(ringColor, fly);
      body.mat.size = body.size * (1 + 0.45 * flash);
      // The points are hidden inside the solid by the time it starts to thin, so they fade out there.
      const shown = reduced ? 1 - Math.max(m, veil) : 1 - smooth(clamp01(settle * 5));
      body.mat.opacity = shown * (reduced ? 1 - 0.45 * wThink : 1);
      mark.mat.opacity = shown;
      body.points.visible = mark.points.visible = shown > 0.001;

      // The solids. With reduced motion they are whole from the start and only fade.
      const seen = reduced ? m : 1;
      arcMat.color.copy(ringColor);
      arcMat.opacity = seen;

      // The solid ring: it sweeps around in the points' colour, then pales and thins into a track
      // while the value's arc stays. The radar keeps it green, and thinner; the check fills its arc.
      const radar = kind === "radar";
      ringGroup.visible = (kind === "ring" || radar || kind === "check") && sweep > 0.001;
      if (ringGroup.visible) {
        const radius = tube * (1 - (radar ? RADAR.thin : 0.3) * settle);
        if (Math.abs(sweep - trackBuilt[0]) > 0.0005 || Math.abs(radius - trackBuilt[1]) > 0.0002) buildTrack(sweep, radius);
        trackMat.color.copy(ringColor).lerp(C.line, radar ? 0 : settle);
        const fill = kind === "check" ? (want.shape === "check" ? want.fill : -1) : kind === "ring" && want.ring ? want.value : -1;
        if (fill >= 0) {
          const waiting = !reduced && settle < 0.02; // unseen, so it starts at its value
          arcShown = reduced || waiting ? fill : ease(arcShown, fill, 3 / TIMING.arcFill);
          if (Math.abs(arcShown - fill) < 0.001) arcShown = fill;
        }
        if (Math.abs(arcShown - arcBuilt) > 0.0005) buildArc(arcShown);
        arcGroup.visible = !radar && arcShown > 0.004 && (reduced || settle >= 0.02);
        trackMat.opacity = seen;
        tickMat.opacity = seen * settle * wTicks;
        ticks.visible = tickMat.opacity > 0.01;
      }

      // Radar: the inner ring sweeps around with the outer one and pales; once both are whole the
      // sweep line fades in at 12 o'clock, where the ring closed, and keeps turning.
      radarGroup.visible = radar && sweep > 0.001;
      if (radarGroup.visible) {
        innerGeo.setDrawRange(0, Math.round(sweep * INNER_AROUND) * INNER_ACROSS * 6);
        innerHead.position.set(Math.sin(sweep * TAU) * innerR, Math.cos(sweep * TAU) * innerR, 0);
        innerHead.visible = innerTail.visible = sweep < 0.999;
        innerMat.color.copy(ringColor).lerp(C["line-strong"], settle);
        innerMat.opacity = seen;
        hub.scale.setScalar((RADAR.hub / tube) * smooth(clamp01(sweep / RADAR.hubBy)));
        if (reduced) hand = RADAR.still * TAU;
        else if (settle > 0) hand = (hand + (dt * TAU) / TIMING.radarTurn) % TAU;
        handGroup.rotation.z = -hand;
        handGroup.visible = settle > 0.01;
        handMat.opacity = seen * smooth(settle);
        // With reduced motion the line rests and the fade behind it breathes instead.
        trailMat.opacity = handMat.opacity * RADAR.glow * (reduced ? 0.55 + 0.45 * beat : 1);
      }

      // Bars: the line runs out from the left and the bars rise off it one after another. Once the
      // points are inside, a change of heights moves the bars.
      barsGroup.visible = kind === "bars" && sweep > 0.001;
      if (barsGroup.visible) {
        if (hold && want.shape === "bars" && (reduced || settle > 0.5)) {
          for (let k = 0; k < barCount; k++) {
            const to = barTall(want.bars[k]);
            if (barNow[k] === to) continue;
            barNow[k] = Math.abs(barNow[k] - to) < 0.002 ? to : ease(barNow[k], to, 3 / TIMING.arcFill);
            barsMoved = true;
          }
        } else if (!hold && barsMoved) place.bars(); // leaving: the points come out of the bars as they stand
        showBase(clamp01(sweep / BARS.lineBy));
        baseMat.color.copy(ringColor).lerp(C["line-strong"], settle);
        baseMat.opacity = seen;
        const rise = barCount > 1 ? BARS.rise : 1;
        for (let k = 0; k < 5; k++) {
          const from = barCount > 1 ? ((1 - rise) * k) / (barCount - 1) : 0;
          showBar(k, (k - (barCount - 1) / 2) * BARS.pitch, k < barCount ? barNow[k] * clamp01((sweep - from) / rise) : 0);
        }
      }

      // Check: the mark is drawn inside the ring as the ring closes.
      checkGroup.visible = kind === "check" && sweep > 0.001;
      if (checkGroup.visible) {
        const run = clamp01((sweep - CHECK.from) / (CHECK.to - CHECK.from)) * (markLen[0] + markLen[1]);
        showMark[0](clamp01(run / markLen[0]));
        showMark[1](clamp01((run - markLen[0]) / markLen[1]));
      }

      // Paper plane: drawn in one line, then the fold. Once it has taken off it stays whole, flies
      // up and to the right, gets smaller and fades.
      const away = kind === "plane" && launch >= 0;
      planeGroup.visible = kind === "plane" && (away ? (reduced ? m > 0.001 : launch < TIMING.planeFly) : sweep > 0.001);
      if (planeGroup.visible) {
        const drawn = away ? 1 : sweep;
        let run = clamp01(drawn / PLANE.outlineBy) * outlineLen;
        for (let k = 0; k < 4; k++) {
          showPlane[k](clamp01(run / planeLen[k]));
          run -= planeLen[k];
        }
        showFold(clamp01((drawn - PLANE.foldFrom) / (1 - PLANE.foldFrom)));
        planeGroup.position.set(planeShift, planeShift, 0);
        planeGroup.scale.setScalar(planeSize);
        planeMat.color.copy(ringColor);
        planeMat.opacity = seen * (1 - smooth(clamp01(((flying ? launch / TIMING.planeFly : 0) - PLANE.fade) / (1 - PLANE.fade))));
      }

      // The whole thing: a slow sway, and the breath in its size.
      const face = 1 - 0.75 * easeInOut(m); // the ring faces you, so its figure stays readable
      const sway = reduced ? 0 : 1;
      pivot.rotation.y = 0.2 * Math.sin(t * 0.5) * sway * face;
      pivot.rotation.x = (-0.1 + 0.05 * Math.sin(t * 0.37) * sway) * face;
      const size = reduced ? 1 : 0.985 + 0.03 * breath * calm + 0.035 * beat * wApprove;
      pivot.scale.setScalar(size * (1 + RING_GROW * (reduced ? m : easeInOut(m))));

      renderer.render(scene, camera);

      // Tell the page what is solid on screen now, and that a plane has gone and the coin is back.
      const solidNow = hold && m >= 1 ? kind : null;
      if (solidNow !== told) {
        told = solidNow;
        if (heard) heard(told);
      }
      if (owed && cur === null && m <= 0) {
        owed = false;
        if (want.onDone) want.onDone();
      }
    };
    raf = requestAnimationFrame(frame);

    handle.setState = (state) => {
      want.state = state;
      if (state === "found") foundAt = t;
    };
  });

  const handle = {
    ready,
    setState(state) {
      want.state = state;
    },
    setRing(kind, value = 0) {
      want.ring = kind;
      want.value = clamp01(value);
      rekey();
    },
    /**
     * options.value: how full the check's ring is, 0..1. options.bars: the bars' heights, 0..1, left to
     * right, one to five; new heights for the same number of bars move them, a new number goes through
     * the dust. options.onDone: called once, when the plane has gone and the coin is back; not called
     * if another shape, a ring or null is asked for before that.
     */
    setShape(kind, options = {}) {
      const again = kind === "plane" && want.shape === "plane"; // the same plane: it does not fly twice
      want.shape = SHAPES.includes(kind) ? kind : null;
      if (kind === "check") want.fill = clamp01(Number(options.value) || 0);
      if (kind === "bars") {
        const list = options.bars && options.bars.length ? options.bars : [0];
        want.barCount = Math.min(5, list.length);
        for (let k = 0; k < want.barCount; k++) want.bars[k] = clamp01(Number(list[k]) || 0);
      }
      if (kind === "plane") want.onDone = options.onDone || null;
      if (!again) spent = owed = false;
      rekey();
    },
    /** `listener(kind)` is called when a formation becomes solid ("ring" or a shape) and with null when it starts to leave. */
    watch(listener) {
      heard = listener;
    },
    pulse() {
      spoke = true;
    },
    /** 1 is real time; the test page uses 0.25 to study a move. */
    setSpeed(next) {
      speed = Math.max(0, next);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      observer.disconnect();
      for (const item of trash) item.dispose();
    },
  };
  return handle;
}
