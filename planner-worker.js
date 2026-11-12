/* LANTERN learned weights with web terminal tuning; selection uses the learned cost head. */
importScripts("assets/vendor/ort.wasm.min.js");

let session;
const ready = (async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL("assets/vendor/", self.location.href).href;
  session = await ort.InferenceSession.create(
    new URL("assets/lantern-planner.onnx?v=terminal-zero-e2c551b3", self.location.href).href,
    { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
  );
  self.postMessage({ type: "ready" });
})();
ready.catch(error => self.postMessage({ type: "error", message: String(error) }));

self.onmessage = async ({ data }) => {
  try {
    await ready;
    const started = performance.now();
    const result = await session.run({
      depth: new ort.Tensor("float32", data.depth, [1, 1, 96, 160]),
      body_state: new ort.Tensor("float32", data.state, [1, 9])
    });
    const endstates = new Float32Array(result.endstates.data);
    const scores = new Float32Array(result.scores.data);
    self.postMessage({
      id: data.id, type: "prediction", endstates, scores,
      inferenceMs: performance.now() - started
    }, [endstates.buffer, scores.buffer]);
    Object.values(result).forEach(tensor => tensor.dispose());
  } catch (error) {
    self.postMessage({ id: data.id, type: "error", message: String(error) });
  }
};
