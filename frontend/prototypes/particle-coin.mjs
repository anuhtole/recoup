// Prototype only: the particle coin's engine. Blender designed the shapes (blender/coin_poses.py wrote
// coin-poses.bin and coin-poses.json); this file plays them. Three.js comes from a CDN, so nothing is
// installed. No API is called and nothing in the app imports this.
import * as THREE from "https://esm.sh/three@0.170.0";

const TAU = Math.PI * 2;
const HERE = import.meta.url;

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
  arcFill: 0.6, // the ring settling to its value, and later changes of value
  reducedFade: 0.3, // reduced motion: every change is a fade this long
};

// How far each state pushes points along Blender's "burst" pose (0 = on the coin, 1 = fully thrown).
const AMOUNT = { idleRest: 0.012, idleBreath: 0.07, found: 0.45, approval: 0.06 };
const MARK_SHARE = 0.6; // the R moves less than the body, so it stays readable
const RING_GROW = 0.22; // the ring is drawn a little larger than the coin

// Talking: the rim breaks into bars that stand out from the coin and rise and fall with the voice,
// like a sound meter wrapped around it. Sizes are in coin radii.
const VOICE = {
  bars: 20, // how many bars stand around the coin (even, so left mirrors right)
  rim: 0.6, // the tallest bar at full loudness
  floor: 0.08, // the share of that height the quietest bar keeps
  squeeze: 0.78, // how far the rim's points close in on their bar's centre line (share of the way)
  calm: 0.9, // the share of its drift the rim gives up while talking, so the bars stay crisp
  face: 0.03, // how far the inner points lift with the loudness (share of the burst pose)
  rate: 21, // syllables, in radians per second (about 3.3 a second)
  ease: 12, // how quickly the loudness follows the syllables
};

// The pointer's wake: points near a moving pointer are dragged along and pushed aside, spring back,
// and rings spread out from its path like ripples on water. Sizes are in coin radii.
const WAKE = {
  reach: 0.3, // how far from the pointer points feel it
  drag: 3, // how hard points are pulled along with the pointer
  part: 2, // how hard they are pushed aside
  spring: 40, // how firmly they return
  damping: 5, // how soon the wobble dies
  markShare: 0.7, // the R gives way a little less than the body
  maxStep: 0.5, // the most pointer travel one frame counts
  linger: 3, // seconds the springs keep running after the pointer stops
  rippleEvery: 0.22, // pointer travel between two rings
  rippleSpeed: 1.1, // how fast a ring spreads, per second
  rippleWidth: 0.13,
  rippleSize: 0.045, // a ring's height when it starts
  rippleFade: 0.6, // seconds for a ring to fall to about a third
  rippleLife: 1.8, // seconds until a ring is dropped
  ripples: 8, // the most rings at once
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
  const get = async (name) => {
    const res = await fetch(new URL(name, HERE));
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res;
  };
  const [manifest, buffer] = await Promise.all([
    get("coin-poses.json").then((r) => r.json()),
    get("coin-poses.bin").then((r) => r.arrayBuffer()),
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
  const want = { state: "idle", ring: null, value: 0 };
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
    const bars = new Float32Array(VOICE.bars); // talking: each bar's height right now
    const halfBars = VOICE.bars / 2;
    const slotAngle = TAU / VOICE.bars;
    let spin = 0; // thinking: how far the rim has turned around the coin, in radians
    let arcShown = 0;
    // The pointer's wake: each point's offset from its place and that offset's speed, the pointer's
    // last place on the coin, and the rings spreading from its path.
    const off = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const at = { x: 0, y: 0 };
    const ripples = [];
    const caster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const inverse = new THREE.Matrix4();
    const from = new THREE.Vector3();
    const aim = new THREE.Vector3();
    const reach2 = WAKE.reach * WAKE.reach;
    let sinceRing = 0;
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
      wTicks = ease(wTicks, want.ring === "deadline" ? 1 : 0, 8);
      ringColor.lerp(want.ring === "deadline" ? C.ink : C["mint-ink"], 1 - Math.exp(-dt * 8));

      // Forward: the points make the ring, then it settles to its value. Back: it un-settles first.
      const goal = want.ring ? 1 : 0;
      if (reduced) {
        settle = 1;
      } else {
        settle = ease(settle, goal && m >= 1 ? 1 : 0, goal ? 3 / TIMING.arcFill : 12);
        if (settle < 0.001) settle = 0;
      }
      if (reduced || goal > m || settle < 0.03) {
        const step = dt / (reduced ? TIMING.reducedFade : total);
        m += Math.sign(goal - m) * Math.min(Math.abs(goal - m), step);
      }
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
          if (moved > 0) {
            wakeUntil = t + WAKE.linger;
            sinceRing += moved;
            if (sinceRing >= WAKE.rippleEvery) {
              sinceRing = 0;
              if (ripples.length === WAKE.ripples) ripples.shift();
              ripples.push({ x: lx, y: ly, born: t, front: 0, size: 0 });
            }
          }
        }
        pointer.moved = false;
        while (ripples.length && t - ripples[0].born > WAKE.rippleLife) ripples.shift();
        for (const ripple of ripples) {
          const age = t - ripple.born;
          ripple.front = age * WAKE.rippleSpeed;
          ripple.size = WAKE.rippleSize * Math.exp(-age / WAKE.rippleFade) * smooth(clamp01(age / 0.08));
        }
        const stirred = t < wakeUntil || ripples.length > 0;
        if (stirredBefore && !stirred) {
          off.fill(0);
          vel.fill(0);
        }
        stirredBefore = stirred;
        const pull = WAKE.spring * dt;
        const damp = Math.exp(-WAKE.damping * dt);

        const cosS = Math.cos(spin);
        const sinS = Math.sin(spin);
        const thinking = wThink > 0.001;
        const talking = wTalk > 0.001;
        const loud = talking ? wTalk * voice : 0;
        // Each bar has its own rhythm, and the bar opposite it across the coin's upright shares it.
        if (talking) {
          for (let b = 0; b < VOICE.bars; b++) {
            const h = b < halfBars ? b : b - halfBars;
            const pair = (b < halfBars ? 0 : halfBars) + Math.min(h, halfBars - 1 - h);
            const level = 0.5 + 0.5 * Math.sin(t * (7 + 4 * ((pair * 0.618) % 1)) + pair * 2.4);
            bars[b] = VOICE.rim * loud * (VOICE.floor + (1 - VOICE.floor) * level);
          }
        }
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
            // Talking: the rim's points close in on their bar's centre line and spread out along
            // the bar, so the rim becomes a ring of bars whose heights follow the voice.
            if (talking) {
              const slot = ((bear[i] + Math.PI) / TAU) * VOICE.bars;
              const b = Math.min(VOICE.bars - 1, Math.floor(slot));
              const turn = -(slot - b - 0.5) * slotAngle * VOICE.squeeze * wTalk;
              const g = 1 + (bars[b] * stagger[i]) / rad[i];
              const cs = Math.cos(turn);
              const sn = Math.sin(turn);
              const px = (x * cs - y * sn) * g;
              y = (x * sn + y * cs) * g;
              x = px;
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
            landed = easeInOut(clamp01((ts - flyFrom - turnAt[i] * landSpread) / TIMING.fly));
            if (landed > 0) {
              const spin = (1 - landed) * 1.1;
              const cs = Math.cos(spin);
              const sn = Math.sin(spin);
              const rx = ring[j] * cs - ring[j + 1] * sn;
              const ry = ring[j] * sn + ring[j + 1] * cs;
              x += (rx - x) * landed;
              y += (ry - y) * landed;
              z += (ring[j + 2] - z) * landed;
            }
            sunk = smooth(clamp01((sweepRaw - turnAt[i]) / SINK_LEAD + 1));
            if (sunk > 0) {
              x += (mid[i * 2] - x) * sunk;
              y += (mid[i * 2 + 1] - y) * sunk;
              z -= z * sunk;
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

          // The pointer's wake. A moving pointer drags the points near it along and pushes them
          // aside; they spring back, and rings spread out from its path.
          if (stirred) {
            const share = (1 - 0.8 * landed) * (1 - sunk) * (isMark ? WAKE.markShare : 1);
            if (moved > 0) {
              const dx = out[j] - at.x;
              const dy = out[j + 1] - at.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < reach2 * 6) {
                const near = Math.exp(-d2 / reach2);
                const aside = (moved * WAKE.part) / (Math.sqrt(d2) || 1);
                vel[j] += (mx * WAKE.drag + dx * aside) * near;
                vel[j + 1] += (my * WAKE.drag + dy * aside) * near;
                vel[j + 2] += moved * WAKE.part * near * (stagger[i] - 0.5);
              }
            }
            for (let a = 0; a < 3; a++) {
              const v = (vel[j + a] - off[j + a] * pull) * damp;
              vel[j + a] = v;
              off[j + a] += v * dt;
            }
            x += off[j] * share;
            y += off[j + 1] * share;
            z += off[j + 2] * share;
            for (let r = 0; r < ripples.length; r++) {
              const ripple = ripples[r];
              const dx = x - ripple.x;
              const dy = y - ripple.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const s = (dist - ripple.front) / WAKE.rippleWidth;
              if (s > -2.5 && s < 2.5 && dist > 0.001) {
                const lift = ripple.size * Math.exp(-s * s) * share;
                x += (dx / dist) * lift;
                y += (dy / dist) * lift;
                z += lift * 0.6;
              }
            }
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
      const shown = reduced ? 1 - m : 1 - smooth(clamp01(settle * 5));
      body.mat.opacity = shown * (reduced ? 1 - 0.45 * wThink : 1);
      mark.mat.opacity = shown;
      body.points.visible = mark.points.visible = shown > 0.001;

      // The solid ring: it sweeps around in the points' colour, then pales and thins into a track
      // while the value's arc stays.
      ringGroup.visible = sweep > 0.001;
      if (ringGroup.visible) {
        const radius = tube * (1 - 0.3 * settle);
        if (Math.abs(sweep - trackBuilt[0]) > 0.0005 || Math.abs(radius - trackBuilt[1]) > 0.0002) buildTrack(sweep, radius);
        trackMat.color.copy(ringColor).lerp(C.line, settle);
        if (want.ring) {
          const waiting = !reduced && settle < 0.02; // unseen, so it starts at its value
          arcShown = reduced || waiting ? want.value : ease(arcShown, want.value, 3 / TIMING.arcFill);
          if (Math.abs(arcShown - want.value) < 0.001) arcShown = want.value;
        }
        if (Math.abs(arcShown - arcBuilt) > 0.0005) buildArc(arcShown);
        arcGroup.visible = arcShown > 0.004 && (reduced || settle >= 0.02);
        arcMat.color.copy(ringColor);
        const seen = reduced ? m : 1;
        trackMat.opacity = arcMat.opacity = seen;
        tickMat.opacity = seen * settle * wTicks;
        ticks.visible = tickMat.opacity > 0.01;
      }

      // The whole thing: a slow sway, and the breath in its size.
      const face = 1 - 0.75 * easeInOut(m); // the ring faces you, so its figure stays readable
      const sway = reduced ? 0 : 1;
      pivot.rotation.y = 0.2 * Math.sin(t * 0.5) * sway * face;
      pivot.rotation.x = (-0.1 + 0.05 * Math.sin(t * 0.37) * sway) * face;
      const size = reduced ? 1 : 0.985 + 0.03 * breath * calm + 0.035 * beat * wApprove;
      pivot.scale.setScalar(size * (1 + RING_GROW * (reduced ? m : easeInOut(m))));

      renderer.render(scene, camera);
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
