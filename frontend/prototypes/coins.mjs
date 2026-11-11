// Prototype only: eight 3D looks for the agent's coin icon. Three.js is loaded from a CDN, so nothing is
// installed. One WebGL renderer draws every coin and copies each frame onto that coin's own canvas.
// No API is called and nothing in the app imports this.
import * as THREE from "https://esm.sh/three@0.170.0";
import "./coins.css";

const MARK =
  "M58 46H134C158 46 174 64 174 86C174 104 163 119 144 125L174.5 155.5L178 152L184 194L142 188L154 176L86 108V164H58ZM86 72H132C141 72 148 78 148 86C148 94 141 100 132 100H86Z";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAU = Math.PI * 2;

// Colours come from the app's tokens, never from literals.
const css = getComputedStyle(document.documentElement);
const C = Object.fromEntries(
  ["ink", "panel", "rule", "paper", "wash", "line", "dim", "sub", "mint", "mint-ink", "mint-wash"].map((n) => [
    n,
    new THREE.Color(css.getPropertyValue(`--${n}`).trim()),
  ]),
);

/* ---------- shared geometry ---------- */

const H = 0.07; // half the coin's thickness
const RIM = 0.035;

// The R mark's two outlines (outer shape, then the bowl's hole), centred and flipped to y-up.
function markOutlines(scale) {
  const tokens = MARK.match(/[MHVLCZ]|-?\d*\.?\d+/g);
  const X = (v) => (v - 120) * scale;
  const Y = (v) => (120 - v) * scale;
  const paths = [];
  let p = null;
  let x = 0;
  let y = 0;
  let i = 0;
  let cmd = "";
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[MHVLCZ]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === "M") {
      p = new THREE.Path();
      paths.push(p);
      x = num();
      y = num();
      p.moveTo(X(x), Y(y));
    } else if (cmd === "H") {
      x = num();
      p.lineTo(X(x), Y(y));
    } else if (cmd === "V") {
      y = num();
      p.lineTo(X(x), Y(y));
    } else if (cmd === "L") {
      x = num();
      y = num();
      p.lineTo(X(x), Y(y));
    } else if (cmd === "C") {
      const a = num();
      const b = num();
      const c = num();
      const d = num();
      x = num();
      y = num();
      p.bezierCurveTo(X(a), Y(b), X(c), Y(d), X(x), Y(y));
    } else if (cmd === "Z") {
      p.closePath();
    }
  }
  return paths.map((path) => {
    const pts = path.getPoints(14);
    if (pts[0].equals(pts[pts.length - 1])) pts.pop();
    return pts;
  });
}

const [OUTER, HOLE] = markOutlines(0.0062);
const markShape = new THREE.Shape(OUTER);
markShape.holes.push(new THREE.Path(HOLE));
const markGeo = new THREE.ExtrudeGeometry(markShape, {
  depth: 0.05,
  bevelEnabled: true,
  bevelThickness: 0.012,
  bevelSize: 0.01,
  bevelSegments: 2,
});

// A coin with a raised rim on both faces. Profile points are doubled so each corner stays a hard edge.
function coinGeometry() {
  const pts = [new THREE.Vector2(0, -H)];
  const corner = (x, y) => pts.push(new THREE.Vector2(x, y), new THREE.Vector2(x, y));
  corner(0.86, -H);
  corner(0.9, -H - RIM);
  corner(0.975, -H - RIM);
  corner(1, -H);
  corner(1, H);
  corner(0.975, H + RIM);
  corner(0.9, H + RIM);
  corner(0.86, H);
  pts.push(new THREE.Vector2(0, H));
  const g = new THREE.LatheGeometry(pts, 128);
  g.rotateX(Math.PI / 2);
  return g;
}
const bodyGeo = coinGeometry();

const mesh = (geo, mat, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.z = z;
  return m;
};

// The ring side: a track and a progress arc that starts at 12 o'clock.
function ringSide(z, trackMat, arcMat, tube = 0.055) {
  const g = new THREE.Group();
  const track = new THREE.Mesh(new THREE.TorusGeometry(0.52, tube * 0.7, 16, 96), trackMat);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.52, tube, 16, 96, TAU * 0.72), arcMat);
  arc.rotation.z = Math.PI / 2;
  g.add(track, arc);
  g.position.z = z;
  return g;
}

// A soft round alpha mask; the colour comes from the material that uses it.
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
const dot = softDot();

const inside = (pts, x, y) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/* ---------- materials ---------- */

const metal = (color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });

// Hatch lines in screen space; the darker the surface, the thicker the lines, then a second set crosses.
function hatch(base, period) {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { uBase: { value: base }, uInk: { value: C.ink }, uPeriod: { value: period } },
    vertexShader: `
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uBase;
      uniform vec3 uInk;
      uniform float uPeriod;
      varying vec3 vN;
      float lines(float c, float w) {
        float tri = abs(fract(c / uPeriod) - 0.5) * 2.0;
        float aa = 2.0 / uPeriod;
        return (1.0 - smoothstep(w - aa, w + aa, tri)) * smoothstep(0.0, 0.04, w);
      }
      void main() {
        vec3 n = normalize(vN);
        float lit = clamp(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0, 1.0);
        float edge = pow(1.0 - abs(n.z), 3.0);
        float dark = clamp(1.0 - lit + edge * 0.8, 0.0, 1.0);
        vec2 p = gl_FragCoord.xy * 0.7071;
        float a = lines(p.x + p.y, 0.14 + smoothstep(0.05, 0.9, dark) * 0.62);
        float b = lines(p.x - p.y, smoothstep(0.5, 1.0, dark) * 0.6);
        gl_FragColor = vec4(mix(uBase, uInk, max(a, b)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// A point cloud that drifts away from its resting shape by `amp`.
// Additive light for dark cards; plain ink-on-paper blending for light ones.
function cloud(base, color, size, additive = true) {
  const n = base.length / 3;
  const pos = new Float32Array(base);
  const dir = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * TAU;
    const s = Math.sqrt(1 - u * u) * (0.3 + Math.random() * 0.7);
    dir.set([Math.cos(a) * s, Math.sin(a) * s, u * (0.3 + Math.random() * 0.7)], i * 3);
    seed[i] = Math.random() * TAU;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color,
      size,
      map: dot,
      opacity: additive ? 0.7 : 1,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
  );
  points.frustumCulled = false;
  return {
    points,
    update(t, amp) {
      for (let i = 0; i < n; i++) {
        const k = amp * (0.55 + 0.45 * Math.sin(t * 1.3 + seed[i]));
        pos[i * 3] = base[i * 3] + dir[i * 3] * k;
        pos[i * 3 + 1] = base[i * 3 + 1] + dir[i * 3 + 1] * k;
        pos[i * 3 + 2] = base[i * 3 + 2] + dir[i * 3 + 2] * k;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/* ---------- the eight coins ---------- */
// Each build returns { group, front?, back?, update? }. When front and back are given, only the side
// facing the viewer is shown (for see-through coins).

const VARIANTS = [
  {
    name: "Minted",
    note: "Solid mint metal, raised R, reeded edge.",
    bg: "wash",
    build() {
      const group = new THREE.Group();
      const mint = metal(C.mint, 0.28);
      const deep = metal(C["mint-ink"], 0.34);
      group.add(mesh(bodyGeo, mint), mesh(markGeo, deep, H), ringSide(-H - 0.01, mint, deep));
      const reeds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.02, H * 1.9), mint, 150);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 150; i++) {
        const a = (i / 150) * TAU;
        m.makeRotationZ(a).setPosition(Math.cos(a) * 1.002, Math.sin(a) * 1.002, 0);
        reeds.setMatrixAt(i, m);
      }
      group.add(reeds);
      return { group };
    },
  },
  {
    name: "Ink glow",
    note: "Ink coin. The R and rim light up with each breath.",
    bg: "panel",
    env: 0.7,
    build() {
      const group = new THREE.Group();
      const ink = new THREE.MeshStandardMaterial({ color: C.ink, metalness: 0.8, roughness: 0.38 });
      const lit = new THREE.MeshStandardMaterial({ color: C.mint, emissive: C.mint, roughness: 0.5 });
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: dot,
          color: C.mint,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.scale.setScalar(3.4);
      halo.position.z = -0.4;
      const rim = (z) => mesh(new THREE.TorusGeometry(0.938, 0.012, 8, 128), lit, z);
      group.add(
        halo,
        mesh(bodyGeo, ink),
        mesh(markGeo, lit, H),
        rim(H + RIM),
        rim(-H - RIM),
        ringSide(-H - 0.01, new THREE.MeshStandardMaterial({ color: C.rule, metalness: 0.6, roughness: 0.5 }), lit),
      );
      return {
        group,
        update(_t, breath) {
          lit.emissiveIntensity = 0.35 + breath * 0.9;
          halo.material.opacity = 0.12 + breath * 0.3;
        },
      };
    },
  },
  {
    name: "Glass",
    note: "Clear lens with the R floating inside.",
    bg: "wash",
    build() {
      const group = new THREE.Group();
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(1, 72, 48),
        new THREE.MeshPhysicalMaterial({
          transmission: 1,
          thickness: 0.7,
          ior: 1.5,
          roughness: 0.04,
          attenuationColor: C.mint,
          attenuationDistance: 0.8,
          clearcoat: 1,
        }),
      );
      lens.scale.z = 0.22;
      const deep = metal(C["mint-ink"], 0.3);
      const front = mesh(markGeo, deep, -0.025);
      const back = ringSide(0, metal(C.mint, 0.3), deep);
      group.add(lens, mesh(new THREE.TorusGeometry(1, 0.028, 12, 128), deep), front, back);
      return { group, front, back };
    },
  },
  {
    name: "Engraved",
    note: "Drawn in hatch lines that follow the light.",
    bg: "paper",
    build(dpr) {
      const group = new THREE.Group();
      const paper = hatch(C.paper, 5 * dpr);
      const mint = hatch(C.mint, 5 * dpr);
      group.add(mesh(bodyGeo, paper), mesh(markGeo, mint, H), ringSide(-H - 0.01, paper, mint));
      return { group };
    },
  },
  {
    name: "Hologram",
    note: "Wireframe with a scan line and pulse rings.",
    bg: "panel",
    build() {
      const group = new THREE.Group();
      const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
      const line = new THREE.LineBasicMaterial({ color: C.mint, ...add, opacity: 0.4 });
      const fill = new THREE.MeshBasicMaterial({ color: C.mint, ...add, opacity: 0.1 });
      const front = new THREE.Group();
      front.add(new THREE.LineSegments(new THREE.EdgesGeometry(markGeo, 30), line), mesh(markGeo, fill));
      front.position.z = H;
      const back = ringSide(0, fill, new THREE.MeshBasicMaterial({ color: C.mint, ...add, opacity: 0.7 }), 0.03);
      const scan = mesh(new THREE.PlaneGeometry(2, 0.025), new THREE.MeshBasicMaterial({ color: C.mint, ...add }), H + 0.07);
      const pulses = [0, 1, 2].map(() =>
        mesh(new THREE.RingGeometry(1, 1.018, 128), new THREE.MeshBasicMaterial({ color: C.mint, ...add })),
      );
      group.add(
        new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 25), line),
        mesh(new THREE.CircleGeometry(0.86, 96), new THREE.MeshBasicMaterial({ color: C.mint, ...add, opacity: 0.05 })),
        front,
        back,
        scan,
        ...pulses,
      );
      return {
        group,
        front,
        back,
        update(t) {
          const y = Math.sin(t * 0.9) * 0.84;
          scan.position.y = y;
          scan.scale.x = Math.sqrt(1 - y * y) * 0.98;
          pulses.forEach((p, i) => {
            const k = (t / 4.2 + i / 3) % 1;
            p.scale.setScalar(1 + k * 0.42);
            p.material.opacity = (1 - k) * 0.6;
          });
        },
      };
    },
  },
  {
    name: "Gyro",
    note: "Small coin inside three orbiting rings.",
    bg: "wash",
    scale: 0.86,
    build() {
      const group = new THREE.Group();
      const core = new THREE.Group();
      const ink = new THREE.MeshStandardMaterial({ color: C.ink, metalness: 0.9, roughness: 0.3 });
      const mint = metal(C.mint, 0.25);
      core.add(mesh(bodyGeo, ink), mesh(markGeo, mint, H), ringSide(-H - 0.01, ink, mint));
      core.scale.setScalar(0.56);
      const rings = [
        [0.78, metal(C["mint-ink"], 0.3)],
        [0.93, mint],
        [1.08, ink],
      ].map(([r, mat]) => new THREE.Mesh(new THREE.TorusGeometry(r, 0.024, 12, 128), mat));
      group.add(core, ...rings);
      return {
        group,
        update(t, breath) {
          rings[0].rotation.set(t * 0.6, 0.3, 0);
          rings[1].rotation.set(0.5, t * 0.45, 0);
          rings[2].rotation.set(1 - t * 0.35, 0, t * 0.2);
          rings.forEach((r, i) => r.scale.setScalar(1 + breath * 0.035 * (i + 1)));
        },
      };
    },
  },
  {
    name: "Liquid",
    note: "Liquid metal that never sits still.",
    bg: "wash",
    scale: 0.94,
    build() {
      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(1, 80, 56);
      const P = geo.attributes.position.array;
      const N = geo.attributes.normal.array;
      const D = P.slice();
      // [kx, ky, kz, amplitude, speed, phase]
      const waves = [
        [3.1, 1.3, 0.7, 0.04, 1.1, 0],
        [-1.7, 3.6, 1.1, 0.032, 0.8, 2],
        [0.9, -2.2, 4, 0.02, 1.4, 4],
        [4.6, 2.9, -1.3, 0.014, 1.9, 1],
      ];
      const blob = new THREE.Mesh(geo, metal(C.mint, 0.1));
      blob.scale.z = 0.32;
      const front = mesh(markGeo, new THREE.MeshStandardMaterial({ color: C.ink, metalness: 0.6, roughness: 0.35 }), 0.36);
      group.add(blob, front, ringSide(-0.38, metal(C["mint-ink"], 0.3), metal(C.ink, 0.3)));
      const update = (t) => {
        for (let i = 0; i < D.length; i += 3) {
          const x = D[i];
          const y = D[i + 1];
          const z = D[i + 2];
          let r = 1;
          let gx = 0;
          let gy = 0;
          let gz = 0;
          for (const [kx, ky, kz, a, w, ph] of waves) {
            const s = kx * x + ky * y + kz * z + w * t + ph;
            r += a * Math.sin(s);
            const c = a * Math.cos(s);
            gx += kx * c;
            gy += ky * c;
            gz += kz * c;
          }
          const gd = gx * x + gy * y + gz * z;
          P[i] = x * r;
          P[i + 1] = y * r;
          P[i + 2] = z * r;
          // The surface normal of a radially displaced sphere: r * dir minus the surface gradient.
          const nx = x * r - (gx - gd * x);
          const ny = y * r - (gy - gd * y);
          const nz = z * r - (gz - gd * z);
          const l = Math.hypot(nx, ny, nz) || 1;
          N[i] = nx / l;
          N[i + 1] = ny / l;
          N[i + 2] = nz / l;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.normal.needsUpdate = true;
        front.position.z = 0.36 + Math.sin(t * 1.1) * 0.012;
      };
      update(0);
      return { group, update };
    },
  },
  ...[false, true].map((onPaper) => ({
    name: onPaper ? "Particles on white" : "Particles",
    note: onPaper ? "The same cloud in ink and deep mint, on the white page." : "Points drift out and pull back with each breath.",
    bg: onPaper ? "paper" : "panel",
    build() {
      const group = new THREE.Group();
      const r = Math.random;
      const mark = [];
      while (mark.length < 2600 * 3) {
        const x = (r() - 0.5) * 0.85;
        const y = (r() - 0.5) * 0.95;
        if (inside(OUTER, x, y) && !inside(HOLE, x, y)) mark.push(x, y, H + r() * 0.05);
      }
      const shell = [];
      for (let i = 0; i < 2200; i++) {
        const a = r() * TAU;
        const rad = i < 1500 ? 0.9 + r() * 0.1 : Math.sqrt(r()) * 0.88;
        shell.push(Math.cos(a) * rad, Math.sin(a) * rad, (r() - 0.5) * 2 * H);
      }
      const arc = [];
      for (let i = 0; i < 1500; i++) {
        const on = i < 1000;
        const a = Math.PI / 2 + r() * TAU * (on ? 0.72 : 1);
        const rad = 0.52 + (r() - 0.5) * (on ? 0.1 : 0.04);
        arc.push(Math.cos(a) * rad, Math.sin(a) * rad, -H - r() * 0.04);
      }
      const front = onPaper ? cloud(mark, C.ink, 0.1, false) : cloud(mark, C.mint, 0.1);
      const back = onPaper ? cloud(arc, C.ink, 0.1, false) : cloud(arc, C.mint, 0.1);
      const body = onPaper ? cloud(shell, C["mint-ink"], 0.12, false) : cloud(shell, C["mint-ink"], 0.12);
      group.add(body.points, front.points, back.points);
      return {
        group,
        front: front.points,
        back: back.points,
        update(t, breath) {
          const amp = 0.015 + breath * breath * 0.2;
          front.update(t, amp * 0.6);
          back.update(t, amp * 0.6);
          body.update(t, amp);
        },
      };
    },
  })),
];

/* ---------- page ---------- */

const grid = document.getElementById("grid");
const BG = { wash: "bg-wash", panel: "bg-panel on-ink", paper: "bg-paper" };
const dpr = Math.min(devicePixelRatio || 1, 2);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch {
  grid.insertAdjacentHTML("beforebegin", '<p class="text-14 text-dim">This page needs WebGL, which this browser has switched off.</p>');
}

if (renderer) {
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;

  // A small studio for reflections: a grey room, two softboxes, a mint kicker and a front fill.
  const studio = new THREE.Scene();
  studio.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(24, 24, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.32, 0.31), side: THREE.BackSide }),
    ),
  );
  const light = (w, h, color, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    studio.add(m);
  };
  light(12, 7, new THREE.Color(6, 6, 6), [0, 10, 4]);
  light(3, 14, new THREE.Color(5, 5, 5), [-10, 2, 5]);
  light(3, 12, C.mint.clone().multiplyScalar(4), [10, -1, 3]);
  light(14, 2.5, new THREE.Color(3, 3, 3), [0, -4, 10]);
  light(9, 9, new THREE.Color(1.1, 1.1, 1.1), [0, 1, 11]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(studio, 0.03).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.z = 5.4;

  const coins = VARIANTS.map((v, i) => {
    const figure = document.createElement("figure");
    figure.className = "m-0 flex flex-col gap-2";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `block aspect-square w-full cursor-pointer overflow-hidden rounded-md border border-line p-0 ${BG[v.bg]}`;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    canvas.setAttribute("aria-hidden", "true");
    button.append(canvas);
    const caption = document.createElement("figcaption");
    caption.className = "flex flex-col";
    caption.innerHTML = `<span class="text-14 font-medium"><span class="ref text-dim">${i + 1}</span> ${v.name}</span><span class="text-13 text-dim">${v.note}</span>`;
    figure.append(button, caption);
    grid.append(figure);

    const scene = new THREE.Scene();
    scene.background = C[v.bg];
    scene.environment = env;
    scene.environmentIntensity = v.env ?? 1;
    const key = new THREE.DirectionalLight(C.paper, 1.4);
    key.position.set(-2, 3, 4);
    const pivot = new THREE.Group();
    scene.add(key, new THREE.AmbientLight(C.paper, 0.25), pivot);
    const built = v.build(dpr);
    pivot.add(built.group);

    const coin = { ...built, i, scene, pivot, button, canvas, ctx: canvas.getContext("2d"), scale: v.scale ?? 1 };
    Object.assign(coin, { w: 0, h: 0, seen: true, flip: 0, vel: 0, target: 0, px: 0, py: 0, tx: 0, ty: 0 });

    const label = () => {
      const ring = coin.target !== 0;
      button.setAttribute("aria-pressed", String(ring));
      button.setAttribute("aria-label", `Coin ${i + 1}, ${v.name}. Showing the ${ring ? "ring" : "R"} side. Flip it.`);
    };
    label();
    button.addEventListener("click", () => {
      coin.target = coin.target === 0 ? Math.PI : 0;
      label();
      if (reduced) frame(performance.now());
    });
    button.addEventListener("pointermove", (e) => {
      const b = button.getBoundingClientRect();
      coin.tx = ((e.clientX - b.left) / b.width - 0.5) * 2;
      coin.ty = ((e.clientY - b.top) / b.height - 0.5) * 2;
      if (reduced) frame(performance.now());
    });
    button.addEventListener("pointerleave", () => {
      coin.tx = coin.ty = 0;
      if (reduced) frame(performance.now());
    });
    return coin;
  });
  window.__coins = coins; // for poking at a coin from the console

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const coin = coins.find((c) => c.canvas === entry.target);
      coin.w = coin.canvas.width = Math.round(entry.contentRect.width * dpr);
      coin.h = coin.canvas.height = Math.round(entry.contentRect.height * dpr);
    }
    if (reduced) frame(performance.now());
  });
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) coins.find((c) => c.button === entry.target).seen = entry.isIntersecting;
  });
  coins.forEach((c) => {
    ro.observe(c.canvas);
    io.observe(c.button);
  });

  let last = performance.now();
  let size = "";
  function frame(now) {
    const t = reduced ? 0 : now / 1000;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const breath = reduced ? 0.5 : 0.5 - 0.5 * Math.cos((t * TAU) / 4.2);
    for (const c of coins) {
      if (!c.seen || !c.w || !c.h) continue;
      if (reduced) {
        c.flip = c.target;
        c.px = c.tx;
        c.py = c.ty;
      } else {
        c.vel += ((c.target - c.flip) * 70 - c.vel * 10) * dt;
        c.flip += c.vel * dt;
        c.px += (c.tx - c.px) * Math.min(1, dt * 8);
        c.py += (c.ty - c.py) * Math.min(1, dt * 8);
      }
      const sway = reduced ? 0 : Math.sin(t * 0.7 + c.i * 0.8) * 0.32;
      const nod = reduced ? 0 : Math.sin(t * 0.9 + c.i) * 0.07;
      c.pivot.rotation.set(-0.14 + nod + c.py * 0.5, c.flip + sway + c.px * 0.6, 0);
      c.pivot.scale.setScalar(c.scale * (0.97 + 0.06 * breath));
      c.pivot.position.y = reduced ? 0 : Math.sin(t * 1.5 + c.i) * 0.03;
      if (c.front && c.back) {
        const facing = Math.cos(c.flip) > 0;
        c.front.visible = facing;
        c.back.visible = !facing;
      }
      c.update?.(t, breath);
      if (size !== `${c.w}x${c.h}`) {
        renderer.setSize(c.w, c.h, false);
        size = `${c.w}x${c.h}`;
      }
      renderer.render(c.scene, camera);
      c.ctx.drawImage(renderer.domElement, 0, 0, c.w, c.h);
    }
    if (!reduced) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
