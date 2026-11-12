import * as THREE from "./assets/vendor/three.module.js";
import { OrbitControls } from "./assets/vendor/OrbitControls.js";
import {
  SETTINGS, norm, sub, generateScene, renderDepth, bodyState,
  evaluateCurve, calculateYaw, clearance, validateScene
} from "./sandbox-core.js?v=level-terminal-20261113";
import {
  WEB_EXECUTION, levelCurve, chooseLevelCandidate, terminalCurve, planarClearance, assessRun
} from "./demo-execution.js?v=level-terminal-20261113";

const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embedded");
let sceneData = generateScene("mixed", 42, 24);
let state, path, history, simTime, arrivalHold, result, running = false, busy = false;
let epoch = 0, modelReady = false, selected = -1, inferenceMs = 0, metadata;
let lastPrediction = null, animationStart = 0, previousPosition = null;
let seedCatalog = null, qualifying = false, cancelQualification = false;
let sceneSelection = { mode: "custom" };
let terminalPlan = null;
const qualificationAttempts = [];
const viewport = $("viewport");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#080b0b");
const camera = new THREE.PerspectiveCamera(43, 1, .1, 180);
camera.up.set(0, 0, 1);
camera.position.set(-20, -25, 24);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.prepend(renderer.domElement);
renderer.domElement.setAttribute("aria-label", "3D obstacle scene with live LANTERN trajectories");
renderer.domElement.setAttribute("role", "img");
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 1);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 140;
controls.maxPolarAngle = Math.PI * .49;
scene.add(new THREE.HemisphereLight(0xffffff, 0x4f6b60, 2.2));
const light = new THREE.DirectionalLight(0xffffff, 2.5);
light.position.set(-8, -6, 18);
scene.add(light);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * SETTINGS.bounds.x, 2 * SETTINGS.bounds.y),
  new THREE.MeshStandardMaterial({ color: 0x101616, roughness: 1, side: THREE.DoubleSide }));
floor.position.z = -.025;
scene.add(floor);
const grid = new THREE.GridHelper(2 * SETTINGS.bounds.x, SETTINGS.bounds.x, 0x3c4b47, 0x202c28);
grid.rotation.x = Math.PI / 2;
grid.position.z = -.012;
scene.add(grid);
const obstacleGroup = new THREE.Group(), candidateGroup = new THREE.Group();
scene.add(obstacleGroup, candidateGroup);
const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x677a71, roughness: .82 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x9ab2a4, transparent: true, opacity: .65 });
const executedMaterial = new THREE.LineBasicMaterial({ color: 0x83e7c0 });
const executedLine = new THREE.Line(new THREE.BufferGeometry(), executedMaterial);
scene.add(executedLine);
const drone = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(.44, .28, .16),
  new THREE.MeshStandardMaterial({ color: 0xf3e86a, roughness: .5 }));
drone.add(body);
for (const x of [-.28, .28]) for (const y of [-.28, .28]) {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .4, 8),
    new THREE.MeshStandardMaterial({ color: 0xc3cbc5 }));
  arm.rotation.z = -Math.atan2(x, y);
  arm.position.set(x / 2, y / 2, 0);
  drone.add(arm);
  const rotor = new THREE.Mesh(new THREE.TorusGeometry(.16, .018, 5, 24),
    new THREE.MeshBasicMaterial({ color: 0xf3e86a }));
  rotor.position.set(x, y, .06);
  drone.add(rotor);
}
const nose = new THREE.Mesh(new THREE.ConeGeometry(.09, .25, 8),
  new THREE.MeshBasicMaterial({ color: 0xf3e86a }));
nose.rotation.z = -Math.PI / 2;
nose.position.x = .4;
drone.add(nose);
scene.add(drone);

function marker(text, color) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.45, .035, 8, 48),
    new THREE.MeshBasicMaterial({ color }));
  group.add(ring);
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext("2d");
  context.font = "bold 24px Arial";
  context.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  context.textAlign = "center";
  context.fillText(text, 128, 40);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas),
    depthTest: false, transparent: true }));
  sprite.scale.set(2.4, .6, 1);
  sprite.position.z = .75;
  group.add(sprite);
  scene.add(group);
  return group;
}
const startMarker = marker("START", 0x83e7c0), goalMarker = marker("GOAL", 0xf3e86a);
let meshes = [];
function releaseGroup(group) {
  [...group.children].forEach(child => {
    child.traverse(item => { if (item.geometry) item.geometry.dispose(); });
    group.remove(child);
  });
}
function drawObstacles() {
  releaseGroup(obstacleGroup);
  meshes = [];
  for (const o of sceneData.obstacles) {
    const geometry = o.type === "pillar"
      ? new THREE.CylinderGeometry(o.r, o.r, o.h, 32)
      : new THREE.BoxGeometry(o.w, o.d, o.h);
    if (o.type === "pillar") geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, obstacleMaterial);
    mesh.position.set(o.x, o.y, o.h / 2);
    mesh.userData.obstacle = o;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial);
    mesh.add(edge);
    obstacleGroup.add(mesh);
    meshes.push(mesh);
  }
  $("obstacle-total").textContent = `${sceneData.obstacles.length} obstacles`;
}
function frameScene() {
  const box = new THREE.Box3();
  for (const point of [sceneData.start, sceneData.goal]) {
    box.expandByPoint(new THREE.Vector3(point[0] - 2, point[1] - 3, 0));
    box.expandByPoint(new THREE.Vector3(point[0] + 2, point[1] + 3, point[2] + 1));
  }
  for (const o of sceneData.obstacles) {
    const x = o.type === "pillar" ? o.r : o.w / 2, y = o.type === "pillar" ? o.r : o.d / 2;
    box.expandByPoint(new THREE.Vector3(o.x - x, o.y - y, 0));
    box.expandByPoint(new THREE.Vector3(o.x + x, o.y + y, o.h));
  }
  const center = box.getCenter(new THREE.Vector3());
  const direction = camera.position.clone().sub(controls.target).normalize();
  const right = new THREE.Vector3().crossVectors(direction.clone().negate(), camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, direction.clone().negate()).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = 8;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
    for (const z of [box.min.z, box.max.z]) {
      const offset = new THREE.Vector3(x, y, z).sub(center);
      distance = Math.max(distance, offset.dot(direction) + Math.max(
        Math.abs(offset.dot(right)) / (tangent * camera.aspect), Math.abs(offset.dot(up)) / tangent));
    }
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance * 1.12);
  controls.update();
}
function setStatus(text, kind = "") {
  $("run-status").textContent = text;
  $("run-status").dataset.result = kind;
}
function showError(error) {
  $("scene-error").hidden = !error;
  $("scene-error").textContent = error ? String(error) : "";
}
function drawDepth(depth) {
  const context = $("depth").getContext("2d"), image = context.createImageData(160, 96);
  for (let i = 0; i < depth.length; i++) {
    const value = Math.round(depth[i] * 255), offset = i * 4;
    image.data[offset] = value; image.data[offset + 1] = value;
    image.data[offset + 2] = value; image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function updatePath() {
  executedLine.geometry.dispose();
  executedLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map(p => new THREE.Vector3(...p)));
}
function updateStats() {
  const speed = norm(state.v);
  $("scene-selection").textContent = sceneSelection.mode === "selected" ? "Selected seed" : "Custom scene";
  $("speed").textContent = speed.toFixed(2);
  $("speed-arc").style.strokeDasharray = `${Math.min(100, speed / 5 * 100)} 100`;
  $("sim-time").textContent = simTime.toFixed(1);
  $("goal-distance").textContent = norm(sub(sceneData.goal, state.p)).toFixed(2);
  $("selected-query").textContent = terminalPlan ? "Terminal" :
    selected < 0 ? "--" : String(selected + 1).padStart(2, "0");
  $("inference-ms").textContent = inferenceMs ? inferenceMs.toFixed(1) : "--";
  $("run").querySelector("span").textContent = running ? "Pause" : "Run LANTERN";
  $("run").querySelector("img").src = `assets/${running ? "pause" : "play"}.svg`;
  $("run").disabled = !modelReady || qualifying || Boolean(result);
  $("step").disabled = !modelReady || qualifying || running || Boolean(result);
}
function pause() {
  running = false;
  epoch++;
  if (!result && modelReady) setStatus(simTime > 0 ? "Paused" : "Ready");
  if (state) updateStats();
}
function reset() {
  pause();
  showError(null);
  state = { p: [...sceneData.start], v: [0, 0, 0], a: [0, 0, 0],
    yaw: Math.atan2(sceneData.goal[1] - sceneData.start[1], sceneData.goal[0] - sceneData.start[0]) };
  simTime = 0; arrivalHold = 0; result = null; selected = -1; inferenceMs = 0;
  history = []; path = [[...state.p]]; lastPrediction = null; previousPosition = null;
  terminalPlan = null;
  releaseGroup(candidateGroup);
  startMarker.position.set(...sceneData.start);
  goalMarker.position.set(...sceneData.goal);
  $("flight-height").value = sceneData.start[2];
  drone.position.set(...state.p); drone.rotation.z = state.yaw;
  drawDepth(renderDepth(state.p, state.yaw, sceneData.obstacles));
  updatePath(); updateStats();
  setStatus(modelReady ? "Ready" : "Loading model...");
}
function setScene(data, selection = { mode: "custom" }) {
  const checked = validateScene(data);
  sceneData = checked;
  sceneSelection = selection;
  if (["pillar", "box", "wall", "mixed"].includes(checked.kind)) $("scene-kind").value = checked.kind;
  if (Number.isInteger(checked.seed)) $("scene-seed").value = checked.seed;
  $("obstacle-count").max = Math.max(60, checked.obstacles.length);
  $("obstacle-count").value = checked.obstacles.length;
  $("count-label").value = checked.obstacles.length;
  drawObstacles();
  reset();
  frameScene();
}

let requestId = 0;
const requests = new Map();
const worker = new Worker(new URL("./planner-worker.js?v=terminal-zero-e2c551b3", import.meta.url));
const readyPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Model loading timed out. Reload to try again.")), 90000);
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "ready") { clearTimeout(timer); resolve(); }
    if (data.type === "error" && data.id === undefined) { clearTimeout(timer); reject(new Error(data.message)); }
  });
  worker.addEventListener("error", event => { clearTimeout(timer); reject(new Error(event.message)); });
});
worker.addEventListener("message", ({ data }) => {
  const entry = requests.get(data.id);
  if (!entry) return;
  requests.delete(data.id);
  clearTimeout(entry.timer);
  if (data.type === "error") entry.reject(new Error(data.message));
  else entry.resolve(data);
});
worker.addEventListener("error", event => {
  for (const entry of requests.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message)); }
  requests.clear();
});
function infer(depth, observation) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error("Inference timed out. Reset the scene to try again."));
    }, 30000);
    requests.set(id, { resolve, reject, timer });
    worker.postMessage({ id, depth, state: observation });
  });
}
const candidateMaterials = [
  new THREE.LineBasicMaterial({ color: 0x798780, transparent: true, opacity: .28 }),
  new THREE.LineBasicMaterial({ color: 0xf3e86a })
];
function drawCandidates(curves, choice) {
  releaseGroup(candidateGroup);
  curves.forEach((curve, i) => {
    const positions = [];
    for (let j = 0; j <= 40; j++) positions.push(new THREE.Vector3(...evaluateCurve(curve, j / 20).p));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),
      candidateMaterials[Number(i === choice)]);
    line.userData.selected = i === choice;
    line.visible = i === choice || $("show-candidates").checked;
    candidateGroup.add(line);
  });
}
function finish(kind, text) {
  result = kind;
  running = false;
  if (!qualifying) setStatus(text, kind);
}
async function planningStep({ quiet = false } = {}) {
  if (busy || !modelReady || result || (qualifying && !quiet)) return false;
  const activeEpoch = epoch;
  const initialClearance = clearance(state.p, sceneData.obstacles);
  if (initialClearance.distance <= 0) {
    finish("collision", "Collision at start"); updateStats(); return false;
  }
  busy = true;
  try {
    const depth = renderDepth(state.p, state.yaw, sceneData.obstacles);
    const prediction = await infer(depth, bodyState(state, sceneData.goal));
    if (activeEpoch !== epoch) return false;
    if (![...prediction.endstates, ...prediction.scores].every(Number.isFinite))
      throw new Error("Non-finite model prediction.");
    const curves = Array.from({ length: 24 }, (_, i) =>
      levelCurve(state, Array.from(prediction.endstates.slice(i * 9, (i + 1) * 9))));
    if (!terminalPlan) terminalPlan = terminalCurve(state, sceneData.goal, sceneData.obstacles);
    selected = chooseLevelCandidate(curves, prediction.scores, sceneData.obstacles);
    if (!terminalPlan && selected < 0) {
      finish("blocked", "No feasible level candidate"); updateStats(); return false;
    }
    if (terminalPlan) selected = -1;
    inferenceMs = prediction.inferenceMs;
    lastPrediction = { endstates: Array.from(prediction.endstates),
      scores: Array.from(prediction.scores), selected,
      networkSelected: prediction.scores.indexOf(Math.min(...prediction.scores)),
      execution: terminalPlan ? "terminal-quintic" : "level-filtered",
      terminalDuration: terminalPlan?.duration, terminalElapsed: terminalPlan?.elapsed };
    if (!quiet) {
      if (terminalPlan) {
        releaseGroup(candidateGroup);
        const points = Array.from({ length: 61 }, (_, i) =>
          new THREE.Vector3(...evaluateCurve(terminalPlan.curve,
            terminalPlan.duration * i / 60, terminalPlan.duration).p));
        candidateGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), candidateMaterials[1]));
      } else drawCandidates(curves, selected);
      drawDepth(depth);
    }
    previousPosition = [...state.p]; animationStart = performance.now();
    const curve = curves[selected], yawBefore = state.yaw;
    let elapsed = SETTINGS.dt, next;
    // Sample the executed 100 ms segment at 10 ms for contact detection.
    for (let i = 1; i <= 10; i++) {
      next = terminalPlan ? evaluateCurve(terminalPlan.curve,
        Math.min(terminalPlan.duration, terminalPlan.elapsed + i * .01), terminalPlan.duration)
        : evaluateCurve(curve, i * .01);
      const contact = clearance(next.p, sceneData.obstacles);
      if (contact.distance <= 0 || planarClearance(next.p, sceneData.obstacles) <= 0) {
        elapsed = i * .01;
        finish("collision", `Collision · ${contact.id === "ground" ? "ground" : "obstacle " + contact.id}`);
        break;
      }
      if (Math.abs(next.p[0]) > SETTINGS.bounds.x || Math.abs(next.p[1]) > SETTINGS.bounds.y ||
          next.p[2] > SETTINGS.bounds.z) {
        elapsed = i * .01; finish("bounds", "Scene boundary reached"); break;
      }
    }
    if (terminalPlan) terminalPlan.elapsed += elapsed;
    simTime += elapsed;
    state = { ...next, yaw: calculateYaw(next.v, sub(sceneData.goal, next.p), yawBefore, elapsed) };
    path.push([...state.p]);
    if (!quiet) updatePath();
    if (norm(sub(sceneData.goal, state.p)) <= SETTINGS.arrivalDistance &&
        norm(state.v) <= SETTINGS.arrivalSpeed) arrivalHold += elapsed;
    else arrivalHold = 0;
    if (!result && arrivalHold >= SETTINGS.arrivalHold - 1e-8) finish("arrived", "Arrived & stopped");
    if (!result && simTime >= SETTINGS.timeout - 1e-8) finish("timeout", "40 s timeout");
    history.push({ t: simTime, p: [...state.p], v: [...state.v], a: [...state.a],
      yaw: state.yaw, selected, predictedScore: selected < 0 ? null : prediction.scores[selected],
      inferenceMs, result, execution: terminalPlan ? "terminal-quintic" : "level-filtered" });
    if (!quiet) {
      if (!result) setStatus(running ? "Running LANTERN" : "Paused");
      updateStats();
    }
    return true;
  } catch (error) {
    if (activeEpoch === epoch) { finish("error", "Inference error"); showError(error.message); updateStats(); }
    throw error;
  } finally { busy = false; }
}
async function runLoop() {
  if (!running) return;
  const activeEpoch = epoch, started = performance.now();
  try { await planningStep(); } catch { return; }
  if (activeEpoch !== epoch || !running) return;
  const delay = SETTINGS.dt * 1000 / Number($("simulation-rate").value) - (performance.now() - started);
  setTimeout(runLoop, Math.max(0, delay));
}
function start() {
  if (!modelReady || qualifying || result || running) return;
  running = true; epoch++; updateStats(); setStatus("Running LANTERN");
  runLoop();
}
$("run").addEventListener("click", () => running ? pause() : start());
$("step").addEventListener("click", () => planningStep().catch(() => {}));
$("reset").addEventListener("click", reset);
$("generate").addEventListener("click", () => {
  const seed = Number($("scene-seed").value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    showError("Seed must be an integer from 0 to 4294967295."); return;
  }
  try {
    setScene(generateScene($("scene-kind").value, seed, Number($("obstacle-count").value)));
  } catch (error) { showError(error.message); }
});
function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
async function randomizeScene() {
  if (qualifying) { cancelQualification = true; pause(); return; }
  if (!modelReady) return;
  const kind = $("scene-kind").value, count = Number($("obstacle-count").value);
  const seeds = (seedCatalog?.cells[`${kind}:${count}`] || []).filter(seed => seed !== sceneData.seed);
  if (seeds.length) {
    const seed = seeds[randomSeed() % seeds.length];
    setScene(generateScene(kind, seed, count), {
      mode: "selected", source: "offline-screened seed catalog",
      catalog_version: seedCatalog.version, success_selected: true
    });
    return;
  }
  const previous = structuredClone(sceneData), previousSelection = structuredClone(sceneSelection);
  const locked = ["generate", "clear", "scene-kind", "scene-seed", "obstacle-count",
    "edit-mode", "obstacle-shape", "flight-height", "import", "export", "reset"];
  qualifying = true; cancelQualification = false; pause();
  locked.forEach(id => $(id).disabled = true);
  $("randomize").textContent = "Cancel";
  viewport.setAttribute("aria-busy", "true");
  updateStats();
  try {
    while (busy) await new Promise(resolve => setTimeout(resolve, 20));
    for (let attempt = 1; attempt <= 64 && !cancelQualification; attempt++) {
      const seed = randomSeed();
      setScene(generateScene(kind, seed, count));
      setStatus(`Checking seed · ${attempt}`);
      for (let i = 0; i < 400 && !result && !cancelQualification; i++)
        await planningStep({ quiet: true });
      const assessment = assessRun(sceneData, history, result), eligible = assessment.eligible;
      qualificationAttempts.push(structuredClone({
        scene: sceneData, state, history, simTime, result: cancelQualification ? "cancelled" : result,
        assessment, eligible, success_selected: true
      }));
      if (eligible && !cancelQualification) {
        sceneSelection = { mode: "selected", source: "live preflight screening",
          success_selected: true, qualification_attempt: qualificationAttempts.length };
        drawObstacles(); reset();
        return;
      }
    }
    setScene(previous, previousSelection);
    if (!cancelQualification) showError("No passing seed found. Randomize again or lower the obstacle count.");
  } catch (error) {
    setScene(previous, previousSelection);
    showError(error.message);
    throw error;
  } finally {
    qualifying = false;
    locked.forEach(id => $(id).disabled = false);
    $("randomize").textContent = "Randomize";
    viewport.removeAttribute("aria-busy");
    updateStats();
  }
}
$("randomize").addEventListener("click", () => randomizeScene().catch(() => {}));
$("obstacle-count").addEventListener("input", () => { $("count-label").value = $("obstacle-count").value; });
$("clear").addEventListener("click", () => setScene({ ...sceneData, obstacles: [] }));
$("show-candidates").addEventListener("change", () => {
  candidateGroup.children.forEach(line => { line.visible = line.userData.selected || $("show-candidates").checked; });
});
$("flight-height").addEventListener("change", () => {
  const value = Number($("flight-height").value);
  if (!Number.isFinite(value) || value < .5 || value > 2.5) {
    $("flight-height").value = sceneData.start[2]; return;
  }
  sceneData.start[2] = value; sceneData.goal[2] = value; reset();
  sceneSelection = { mode: "custom" }; drawObstacles();
});
$("top-view").addEventListener("click", () => {
  camera.position.set(0, -16, 84); controls.target.set(0, 0, 0); frameScene();
});
$("edit-mode").addEventListener("change", () => {
  pause(); controls.enabled = $("edit-mode").value === "orbit";
  renderer.domElement.style.cursor = controls.enabled ? "grab" : "crosshair";
});

const raycaster = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let downPoint = null, drag = null;
function pointerInfo(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const point = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
  return { point, hit: raycaster.intersectObjects(meshes, false)[0]?.object };
}
function clampPoint(point) {
  return [Math.max(1 - SETTINGS.bounds.x, Math.min(SETTINGS.bounds.x - 1, point.x)),
    Math.max(1 - SETTINGS.bounds.y, Math.min(SETTINGS.bounds.y - 1, point.y))];
}
renderer.domElement.addEventListener("pointerdown", event => {
  if (qualifying || $("edit-mode").value === "orbit") return;
  pause(); downPoint = [event.clientX, event.clientY];
  const { hit, point } = pointerInfo(event);
  if ($("edit-mode").value === "move" && point) {
    if (hit) drag = { kind: "obstacle", obstacle: hit.userData.obstacle };
    else {
      const [x, y] = clampPoint(point);
      const key = Math.hypot(x - sceneData.start[0], y - sceneData.start[1]) <
        Math.hypot(x - sceneData.goal[0], y - sceneData.goal[1]) ? "start" : "goal";
      if (Math.hypot(x - sceneData[key][0], y - sceneData[key][1]) < 1.5) drag = { kind: key };
    }
    renderer.domElement.setPointerCapture(event.pointerId);
  }
});
renderer.domElement.addEventListener("pointermove", event => {
  if (!drag) return;
  const { point } = pointerInfo(event);
  if (!point) return;
  const [x, y] = clampPoint(point);
  sceneSelection = { mode: "custom" };
  if (drag.kind === "obstacle") { drag.obstacle.x = x; drag.obstacle.y = y; drawObstacles(); }
  else { sceneData[drag.kind][0] = x; sceneData[drag.kind][1] = y; }
  reset();
});
renderer.domElement.addEventListener("pointerup", event => {
  if (qualifying) return;
  if (drag) { drag = null; reset(); return; }
  if (!downPoint || Math.hypot(event.clientX - downPoint[0], event.clientY - downPoint[1]) > 6) return;
  downPoint = null;
  const mode = $("edit-mode").value, { point, hit } = pointerInfo(event);
  if (!point || Math.abs(point.x) > SETTINGS.bounds.x - 1 ||
      Math.abs(point.y) > SETTINGS.bounds.y - 1) return;
  sceneSelection = { mode: "custom" };
  if (mode === "erase" && hit) {
    sceneData.obstacles = sceneData.obstacles.filter(o => o !== hit.userData.obstacle); drawObstacles();
  } else if (mode === "add") {
    if (sceneData.obstacles.length >= 80) { showError("Maximum 80 obstacles."); return; }
    const type = $("obstacle-shape").value;
    sceneData.obstacles.push({ id: Math.max(0, ...sceneData.obstacles.map(o => o.id)) + 1,
      type, x: point.x, y: point.y, h: 4,
      ...(type === "pillar" ? { r: .5 } : { w: type === "wall" ? .45 : 1.2, d: type === "wall" ? 3 : 1.2 }) });
    drawObstacles();
  } else if (mode === "start" || mode === "goal") {
    sceneData[mode][0] = point.x; sceneData[mode][1] = point.y;
  }
  reset();
});
renderer.domElement.addEventListener("pointercancel", () => { drag = null; downPoint = null; });

$("export").addEventListener("click", () => {
  const data = { scene: sceneData, run: { model: metadata, environment: SETTINGS,
    web_execution: WEB_EXECUTION, scene_selection: sceneSelection, qualification_attempts: qualificationAttempts,
    result: result || (simTime > 0 ? "unfinished" : "not_started"), trajectory: history } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url;
  link.download = `LANTERN-scene-${sceneData.seed ?? "custom"}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$("import").addEventListener("click", () => $("scene-file").click());
$("scene-file").addEventListener("change", async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 25000000) throw new Error("Scene file must be smaller than 25 MB.");
    const data = JSON.parse(await file.text()); setScene(data.scene || data);
  } catch (error) { showError(error.message); }
  event.target.value = "";
});

const resize = new ResizeObserver(() => {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height; camera.updateProjectionMatrix();
  frameScene();
});
resize.observe(viewport);
function animate() {
  requestAnimationFrame(animate);
  if (state && !qualifying) {
    const amount = previousPosition && running
      ? Math.min(1, (performance.now() - animationStart) / (100 / Number($("simulation-rate").value))) : 1;
    const position = previousPosition ? state.p.map((v, i) => previousPosition[i] + (v - previousPosition[i]) * amount) : state.p;
    drone.position.set(...position); drone.rotation.z = state.yaw;
  }
  controls.update(); renderer.render(scene, camera);
}
drawObstacles(); reset(); animate();
const initialSceneEpoch = epoch;
Promise.all([readyPromise, fetch("assets/planner-metadata.json?v=level-terminal-20261113").then(response => {
  if (!response.ok) throw new Error("Model metadata could not be loaded.");
  return response.json();
}), fetch("assets/demo-seeds.json?v=level-terminal-20261113").then(
  response => response.ok ? response.json() : null)]).then(async ([, model, catalog]) => {
  if (catalog) {
    const hashes = await Promise.all(["sandbox-core.js", "demo-execution.js", "demo.js"].map(async name => {
      const source = await fetch(new URL(`${name}?v=level-terminal-20261113`, import.meta.url));
      if (!source.ok) throw new Error("Demo source could not be checked.");
      const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    }));
    if (catalog.model_sha256 === model.onnx_sha256 && catalog.generator_sha256 === hashes[0] &&
        catalog.execution_sha256 === hashes[1] && catalog.controller_sha256 === hashes[2]) seedCatalog = catalog;
    else catalog = null;
    if (catalog && epoch === initialSceneEpoch) setScene(
      generateScene(catalog.default.kind, catalog.default.seed, catalog.default.count),
      { mode: "selected", source: "offline-screened seed catalog",
        catalog_version: catalog.version, success_selected: true });
  }
  metadata = model; modelReady = true;
  $("randomize").disabled = false;
  $("model-label").textContent = "Level flight · ONNX / WASM";
  setStatus("Ready"); updateStats();
}).catch(error => {
  setStatus("Model unavailable", "error"); showError(error.message);
  $("model-label").textContent = "Model unavailable";
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", () => worker.terminate());
window.addEventListener("message", event => {
  if (event.origin === location.origin && event.source === parent && event.data?.type === "lantern-pause") pause();
});
if (document.body.classList.contains("embedded")) {
  const reportHeight = () => parent.postMessage(
    { type: "lantern-height", height: document.body.getBoundingClientRect().height + 2 }, location.origin);
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener("load", reportHeight);
}

window.lanternSandbox = {
  ready: () => modelReady,
  snapshot: () => structuredClone({ scene: sceneData, state, simTime, result,
    running, busy, selected, prediction: lastPrediction, history, sceneSelection,
    qualifying, qualificationAttempts, webExecution: WEB_EXECUTION }),
  setScene, generateScene, reset, pause, start, step: planningStep,
  randomize: randomizeScene,
  projectPoint: point => {
    const vector = new THREE.Vector3(...point).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (vector.x + 1) * rect.width / 2,
      y: rect.top + (1 - vector.y) * rect.height / 2 };
  },
  infer: async (depth, observation) => {
    await readyPromise;
    const output = await infer(new Float32Array(depth), new Float32Array(observation));
    return { endstates: Array.from(output.endstates), scores: Array.from(output.scores) };
  }
};
