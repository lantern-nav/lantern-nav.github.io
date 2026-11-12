import { Box3, Ray, Vector3 } from "./assets/vendor/three.module.js";

export const SETTINGS = Object.freeze({
  width: 160, height: 96, horizontalFov: 90, verticalFov: 60,
  depthRange: 20, dt: .1, horizon: 2, speed: 5, acceleration: 5,
  vehicleRadius: .22, timeout: 40,
  bounds: { x: 16, y: 10, z: 7 },
  arrivalDistance: .1, arrivalSpeed: .2, arrivalHold: .5
});

export const SCENE_GENERATION = Object.freeze({
  minimumObstacleGap: .12, endpointClearance: 0,
  bodyClearance: .6, gridStep: .2
});

export const norm = a => Math.hypot(...a);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const wrap = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
export function rotate(a, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c * a[0] - s * a[1], s * a[0] + c * a[1], a[2]];
}

export function randomGenerator(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function obstacleGap(a, b) {
  if (a.type === "pillar" && b.type === "pillar")
    return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  if (a.type === "pillar" || b.type === "pillar") {
    const circle = a.type === "pillar" ? a : b, box = a.type === "pillar" ? b : a;
    return Math.hypot(Math.max(0, Math.abs(circle.x - box.x) - box.w / 2),
      Math.max(0, Math.abs(circle.y - box.y) - box.d / 2)) - circle.r;
  }
  return Math.hypot(Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2),
    Math.max(0, Math.abs(a.y - b.y) - (a.d + b.d) / 2));
}

function hasLevelPassage(obstacles) {
  const step = SCENE_GENERATION.gridStep;
  const halfX = SETTINGS.bounds.x - 1, halfY = SETTINGS.bounds.y - 1;
  const columns = Math.round(2 * halfX / step) + 1, rows = Math.round(2 * halfY / step) + 1;
  const padding = SETTINGS.vehicleRadius + SCENE_GENERATION.bodyClearance + step / 2;
  const blocked = new Uint8Array(columns * rows);
  for (const o of obstacles) {
    const radiusX = o.type === "pillar" ? o.r : o.w / 2;
    const radiusY = o.type === "pillar" ? o.r : o.d / 2;
    const left = Math.max(0, Math.ceil((o.x - radiusX - padding + halfX) / step));
    const right = Math.min(columns - 1, Math.floor((o.x + radiusX + padding + halfX) / step));
    const bottom = Math.max(0, Math.ceil((o.y - radiusY - padding + halfY) / step));
    const top = Math.min(rows - 1, Math.floor((o.y + radiusY + padding + halfY) / step));
    for (let row = bottom; row <= top; row++) {
      for (let col = left; col <= right; col++) {
        const dx = Math.abs(-halfX + col * step - o.x), dy = Math.abs(-halfY + row * step - o.y);
        const distance = o.type === "pillar" ? Math.hypot(dx, dy) - o.r :
          Math.hypot(Math.max(0, dx - radiusX), Math.max(0, dy - radiusY));
        if (distance <= padding) blocked[row * columns + col] = 1;
      }
    }
  }
  // Flood fill accepts geometry only. Neither a path nor this grid reaches the planner.
  const row = Math.round(halfY / step);
  const start = row * columns + Math.round((halfX - 12) / step);
  const goal = row * columns + Math.round((halfX + 12) / step);
  if (blocked[start] || blocked[goal]) return false;
  const queue = new Int32Array(blocked.length);
  let head = 0, tail = 1;
  queue[0] = start;
  blocked[start] = 1;
  while (head < tail) {
    const cell = queue[head++], column = cell % columns;
    if (cell === goal) return true;
    for (const next of [column > 0 ? cell - 1 : -1,
      column < columns - 1 ? cell + 1 : -1, cell - columns, cell + columns]) {
      if (next >= 0 && next < blocked.length && !blocked[next]) {
        blocked[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return false;
}

export function generateScene(kind, seed, count) {
  if (!["pillar", "box", "wall", "mixed"].includes(kind) ||
      !Number.isInteger(seed) || seed < 0 || seed > 4294967295 ||
      !Number.isInteger(count) || count < 0 || count > 80)
    throw new Error("Expected a valid scene type, integer seed, and 0 to 80 obstacles.");
  const rng = randomGenerator(seed), attempts = Math.max(3000, count * 500);
  const minimumCrossings = count ? Math.min(4, Math.max(1, Math.floor(count / 8))) : 0;
  for (let layout = 0; layout < 128; layout++) {
    const obstacles = [];
    for (let attempt = 0; obstacles.length < count && attempt < attempts; attempt++) {
      const type = kind === "mixed" ? (rng() < .55 ? "pillar" : "box") : kind;
      const obstacle = { id: obstacles.length + 1, type,
        x: -8.5 + rng() * 17, y: -7.5 + rng() * 15,
        h: type === "wall" ? 3.5 + rng() * 1.5 : 3 + rng() * 3 };
      if (type === "pillar") obstacle.r = .35 + rng() * .35;
      else {
        obstacle.w = type === "wall" ? .45 : .7 + rng() * 1.1;
        obstacle.d = type === "wall" ? 2 + rng() * 2 : .7 + rng() * 1.1;
      }
      if (obstacles.every(other => obstacleGap(obstacle, other) >= SCENE_GENERATION.minimumObstacleGap)) {
        obstacles.push(obstacle);
        if (!hasLevelPassage(obstacles)) obstacles.pop();
      }
    }
    const crossings = obstacles.filter(o => Math.abs(o.y) <=
      (o.type === "pillar" ? o.r : o.d / 2)).length;
    if (obstacles.length === count && crossings >= minimumCrossings)
      return { version: 1, kind, seed: Number(seed), start: [-12, 0, 2],
        goal: [12, 0, 2], obstacles };
  }
  throw new Error("Could not generate a passable layout. Change the seed or reduce the obstacle count.");
}

function boxFor(o) {
  return new Box3(new Vector3(o.x - o.w / 2, o.y - o.d / 2, 0),
    new Vector3(o.x + o.w / 2, o.y + o.d / 2, o.h));
}

export function clearance(position, obstacles) {
  const p = new Vector3(...position);
  let nearest = position[2], id = "ground";
  for (const o of obstacles) {
    let distance;
    if (o.type === "pillar") {
      const radial = Math.hypot(p.x - o.x, p.y - o.y) - o.r;
      const vertical = Math.max(-p.z, p.z - o.h);
      distance = Math.hypot(Math.max(0, radial), Math.max(0, vertical))
        + Math.min(Math.max(radial, vertical), 0);
    } else distance = boxFor(o).distanceToPoint(p);
    if (distance < nearest) { nearest = distance; id = o.id; }
  }
  return { distance: nearest - SETTINGS.vehicleRadius, id };
}

// Rays retain their axial parameter: p = origin + depth * [1, left, up].
export function renderDepth(position, yaw, obstacles) {
  const depth = new Float32Array(SETTINGS.width * SETTINGS.height);
  const c = Math.cos(yaw), s = Math.sin(yaw), fy = 48 / Math.tan(Math.PI / 6);
  const boxes = obstacles.filter(o => o.type !== "pillar").map(boxFor);
  const pillars = obstacles.filter(o => o.type === "pillar");
  const origin = new Vector3(...position), direction = new Vector3();
  const ray = new Ray(origin, direction), hit = new Vector3();
  for (let row = 0; row < 96; row++) {
    const dz = -(row - 48) / fy;
    for (let col = 0; col < 160; col++) {
      const left = -(col - 80) / 80;
      const dx = c - s * left, dy = s + c * left;
      let nearest = dz < 0 ? Math.min(20, -position[2] / dz) : 20;
      direction.set(dx, dy, dz);
      for (const box of boxes) {
        if (ray.intersectBox(box, hit)) {
          const t = (hit.x - position[0]) * c + (hit.y - position[1]) * s;
          if (t >= .04 && t < nearest) nearest = t;
        }
      }
      for (const o of pillars) {
        const ox = position[0] - o.x, oy = position[1] - o.y;
        const a = dx * dx + dy * dy, b = ox * dx + oy * dy;
        const disc = b * b - a * (ox * ox + oy * oy - o.r * o.r);
        if (disc >= 0) {
          const root = Math.sqrt(disc);
          for (const t of [(-b - root) / a, (-b + root) / a]) {
            const z = position[2] + t * dz;
            if (t >= .04 && t < nearest && z >= 0 && z <= o.h) nearest = t;
          }
        }
        if (dz !== 0) {
          const t = (o.h - position[2]) / dz;
          if (t >= .04 && t < nearest &&
              (ox + t * dx) ** 2 + (oy + t * dy) ** 2 <= o.r ** 2) nearest = t;
        }
      }
      depth[row * 160 + col] = Math.floor(Math.max(.04, nearest) / 20 * 255) / 255;
    }
  }
  return depth;
}

export function bodyState(state, goal) {
  return new Float32Array([
    ...rotate(state.v, -state.yaw), ...rotate(state.a, -state.yaw),
    ...rotate(sub(goal, state.p), -state.yaw)
  ]);
}

export function curveFromEndpoint(state, endpoint) {
  const T = SETTINGS.horizon;
  const endP = rotate(endpoint.slice(0, 3), state.yaw).map((v, i) => v + state.p[i]);
  const endV = rotate(endpoint.slice(3, 6), state.yaw);
  const endA = rotate(endpoint.slice(6, 9), state.yaw);
  const p0 = [...state.p];
  const p1 = p0.map((v, i) => v + state.v[i] * T / 5);
  const p2 = p0.map((v, i) => state.a[i] * T * T / 20 + 2 * p1[i] - v);
  const p5 = endP, p4 = p5.map((v, i) => v - endV[i] * T / 5);
  const p3 = p5.map((v, i) => endA[i] * T * T / 20 + 2 * p4[i] - v);
  return [p0, p1, p2, p3, p4, p5];
}

function bezier(points, u) {
  const work = points.map(p => [...p]);
  for (let n = work.length - 1; n > 0; n--)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < 3; k++) work[j][k] = work[j][k] * (1 - u) + work[j + 1][k] * u;
  return work[0];
}

export function evaluateCurve(points, t) {
  const T = SETTINGS.horizon, u = t / T;
  const first = points.slice(0, -1).map((p, i) => p.map((v, k) => (points[i + 1][k] - v) * 5 / T));
  const second = first.slice(0, -1).map((p, i) => p.map((v, k) => (first[i + 1][k] - v) * 4 / T));
  return { p: bezier(points, u), v: bezier(first, u), a: bezier(second, u) };
}

export function calculateYaw(velocity, goalDirection, lastYaw, dt) {
  const speed = Math.hypot(...velocity.slice(0, 2));
  const distance = Math.hypot(...goalDirection.slice(0, 2));
  let desired;
  if (speed < .05) {
    if (distance <= .5) return wrap(lastYaw);
    desired = Math.atan2(goalDirection[1], goalDirection[0]);
  } else if (distance <= .5) desired = lastYaw;
  else {
    const weight = 6 * Math.abs(wrap(Math.atan2(goalDirection[1], goalDirection[0]) - lastYaw)) / Math.PI;
    desired = Math.atan2(velocity[1] / speed + weight * goalDirection[1] / (distance + 1e-5),
      velocity[0] / speed + weight * goalDirection[0] / (distance + 1e-5));
  }
  const limit = .5 * Math.PI * dt;
  return wrap(lastYaw + Math.max(-limit, Math.min(limit, wrap(desired - lastYaw))));
}

export function validateScene(scene) {
  if (!scene || scene.version !== 1 || !Array.isArray(scene.obstacles) || scene.obstacles.length > 80)
    throw new Error("Expected a LANTERN scene with at most 80 obstacles.");
  const bounded = (x, min, max) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  for (const point of [scene.start, scene.goal]) {
    if (!Array.isArray(point) || point.length !== 3 ||
        !bounded(point[0], 1 - SETTINGS.bounds.x, SETTINGS.bounds.x - 1) ||
        !bounded(point[1], 1 - SETTINGS.bounds.y, SETTINGS.bounds.y - 1) || !bounded(point[2], .3, 6))
      throw new Error("Start and goal must be inside the scene bounds.");
  }
  const ids = new Set();
  for (const o of scene.obstacles) {
    if (!Number.isInteger(o.id) || ids.has(o.id) || !["pillar", "box", "wall"].includes(o.type) ||
        !bounded(o.x, 1 - SETTINGS.bounds.x, SETTINGS.bounds.x - 1) ||
        !bounded(o.y, 1 - SETTINGS.bounds.y, SETTINGS.bounds.y - 1) || !bounded(o.h, .3, 6) ||
        (o.type === "pillar" ? !bounded(o.r, .15, 2) :
          !bounded(o.w, .15, 6) || !bounded(o.d, .15, 6)))
      throw new Error("Invalid obstacle geometry.");
    ids.add(o.id);
  }
  return structuredClone(scene);
}
