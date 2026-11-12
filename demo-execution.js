import {
  SETTINGS, norm, sub, rotate, curveFromEndpoint, evaluateCurve
} from "./sandbox-core.js?v=level-terminal-20261113";

export const WEB_EXECUTION = Object.freeze({
  version: "level-terminal-20261113",
  fixedAltitude: true,
  obstacleMargin: .12,
  terminalRadius: 6.5,
  terminalMaxPathRatio: 1.15,
  terminalMaxRetreat: .03,
  terminalMaxOvershoot: .03,
  terminalMinDuration: .8,
  terminalMaxDuration: 3,
  terminalAcceleration: 5
});

// Footprint clearance prevents a short obstacle from being overflown as well.
export function planarClearance(point, obstacles) {
  let distance = Infinity;
  for (const o of obstacles) {
    const dx = Math.abs(point[0] - o.x), dy = Math.abs(point[1] - o.y);
    const gap = o.type === "pillar" ? Math.hypot(dx, dy) - o.r :
      Math.hypot(Math.max(0, dx - o.w / 2), Math.max(0, dy - o.d / 2));
    distance = Math.min(distance, gap - SETTINGS.vehicleRadius);
  }
  return distance;
}

export function levelCurve(state, endpoint) {
  const adjusted = [...endpoint];
  adjusted[2] = 0;
  adjusted[5] = 0;
  adjusted[8] = 0;
  return curveFromEndpoint(state, adjusted);
}

export function curveIsClear(curve, duration, obstacles, margin = WEB_EXECUTION.obstacleMargin) {
  const samples = Math.ceil(duration / .025);
  for (let i = 0; i <= samples; i++) {
    const { p } = evaluateCurve(curve, duration * i / samples, duration);
    if (Math.abs(p[0]) > SETTINGS.bounds.x - .3 || Math.abs(p[1]) > SETTINGS.bounds.y - .3 ||
        planarClearance(p, obstacles) < margin) return false;
  }
  return true;
}

export function chooseLevelCandidate(curves, scores, obstacles) {
  const ranked = Array.from(scores, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  for (const duration of [SETTINGS.horizon, .8, .4]) {
    for (const index of ranked) {
      // The original curve horizon stays 2 s when checking a shorter prefix.
      const prefix = splitPrefix(curves[index], duration / SETTINGS.horizon);
      if (curveIsClear(prefix, duration, obstacles)) return index;
    }
  }
  return -1;
}

function splitPrefix(curve, fraction) {
  const work = curve.map(p => [...p]), prefix = [work[0]];
  for (let n = work.length - 1; n > 0; n--) {
    for (let j = 0; j < n; j++)
      work[j] = work[j].map((value, k) => value * (1 - fraction) + work[j + 1][k] * fraction);
    prefix.push(work[0]);
  }
  return prefix;
}

export function terminalCurve(state, goal, obstacles) {
  const delta = sub(goal, state.p), distance = norm(delta);
  if (distance > WEB_EXECUTION.terminalRadius) return null;
  const endpoint = [...rotate(delta, -state.yaw), 0, 0, 0, 0, 0, 0];
  let best = null;
  for (let tick = Math.round(WEB_EXECUTION.terminalMinDuration * 10);
    tick <= Math.round(WEB_EXECUTION.terminalMaxDuration * 10); tick++) {
    const duration = tick / 10, curve = curveFromEndpoint(state, endpoint, duration);
    let previous = state.p, previousDistance = distance, length = 0, retreat = 0, overshoot = 0;
    let feasible = true;
    for (let i = 1; i <= 60; i++) {
      const sample = evaluateCurve(curve, duration * i / 60, duration);
      const remaining = norm(sub(goal, sample.p));
      length += norm(sub(sample.p, previous));
      retreat += Math.max(0, remaining - previousDistance);
      overshoot = Math.max(overshoot, sub(sample.p, goal).reduce(
        (sum, value, k) => sum + value * delta[k] / Math.max(distance, 1e-9), 0));
      if (norm(sample.v) > Math.max(SETTINGS.speed, norm(state.v)) + .02 ||
          norm(sample.a) > Math.max(WEB_EXECUTION.terminalAcceleration, norm(state.a)) + .02 ||
          retreat > WEB_EXECUTION.terminalMaxRetreat || overshoot > WEB_EXECUTION.terminalMaxOvershoot ||
          planarClearance(sample.p, obstacles) < WEB_EXECUTION.obstacleMargin) {
        feasible = false; break;
      }
      previous = sample.p; previousDistance = remaining;
    }
    if (!feasible || length > Math.max(distance * WEB_EXECUTION.terminalMaxPathRatio, .02) ||
        !curveIsClear(curve, duration, obstacles)) continue;
    const cost = length + .08 * duration;
    if (!best || cost < best.cost) best = { curve, duration, cost, elapsed: 0, startDistance: distance };
  }
  return best;
}

export function assessRun(scene, history, result) {
  const points = [scene.start, ...history.map(step => step.p)];
  const distances = points.map(point => norm(sub(scene.goal, point)));
  const index = distances.findIndex(distance => distance <= 2);
  const pathLength = points.slice(1).reduce((sum, point, i) => sum + norm(sub(point, points[i])), 0);
  let tailLength = 0, retreat = 0, overshoot = 0;
  if (index >= 0) {
    const direction = sub(scene.goal, points[index]).map(x => x / Math.max(distances[index], 1e-9));
    for (let i = index + 1; i < points.length; i++) {
      tailLength += norm(sub(points[i], points[i - 1]));
      retreat += Math.max(0, distances[i] - distances[i - 1]);
      overshoot = Math.max(overshoot, sub(points[i], scene.goal).reduce(
        (sum, x, k) => sum + x * direction[k], 0));
    }
  }
  const ratio = index < 0 ? Infinity : tailLength / Math.max(distances[index], 1e-9);
  const level = points.every(point => Math.abs(point[2] - scene.start[2]) < 1e-8);
  const direct = norm(sub(scene.goal, scene.start));
  return {
    eligible: result === "arrived" && level && ratio <= 1.2 && retreat <= .2 && overshoot <= .2 &&
      pathLength <= direct * 1.35,
    level, pathLength, pathRatio: pathLength / Math.max(direct, 1e-9),
    terminalPathRatio: ratio, terminalRetreat: retreat, terminalOvershoot: overshoot
  };
}
