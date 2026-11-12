const methodData = {
  overview: {
    description: "24 queries generate and score quintic curves; the selected curve is rebuilt from the handoff state.",
    alt: "Schematic of the complete LANTERN framework, including common-cost training and reference handoff."
  },
  attention: {
    description: "Actual validation prediction on the left; fixed-grid readout schematic on the right.",
    alt: "Actual LANTERN validation attention and trajectories alongside a schematic fixed-grid readout."
  },
  anchors: {
    description: "Directional anchors retain candidate roles; bounded residuals reshape curves around obstacles. Schematic.",
    alt: "Illustrative directional anchor curves, obstacles, and a selected rebuilt trajectory avoiding the obstacles."
  },
  goal: {
    description: "Six queries become goal-relative inside 5 m; their residuals shrink with goal distance. Schematic.",
    alt: "Illustration of 18 directional and 6 goal-relative queries with the distance-dependent blend."
  },
  learning: {
    description: "The rebuilt curve cost provides both detached training weights and score targets. Schematic.",
    alt: "Illustration of 24 candidate costs and corresponding cost-based training weights."
  }
};
function selectTab(button, group) {
  group.querySelectorAll('[role="tab"]').forEach(tab => {
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
}
document.querySelectorAll("[data-method]").forEach(button => {
  button.addEventListener("click", () => {
    selectTab(button, button.parentElement);
    const key = button.dataset.method, image = document.querySelector("#method-image");
    image.src = `assets/method-${key}.png`;
    image.alt = methodData[key].alt;
    document.querySelector("#method-description").textContent = methodData[key].description;
    document.querySelector("#method-panel").setAttribute("aria-labelledby", button.id);
  });
});
const flights = {
  outdoor5: "Outdoor 5 · 5m/s · VINS estimate",
  indoor: "Indoor · Motion-capture estimate"
};
document.querySelectorAll("[data-flight]").forEach(button => {
  button.addEventListener("click", () => {
    selectTab(button, button.parentElement);
    const key = button.dataset.flight, video = document.querySelector("#flight-video");
    video.pause();
    video.poster = `assets/${key}-poster.jpg`;
    video.querySelector("source").src = `assets/${key}.mp4`;
    video.setAttribute("aria-label", flights[key]);
    video.load();
    document.querySelector("#flight-description").textContent = flights[key];
    document.querySelector("#flight-panel").setAttribute("aria-labelledby", button.id);
  });
});
document.querySelectorAll('[role="tablist"]').forEach(group => {
  group.addEventListener("keydown", event => {
    const buttons = [...group.querySelectorAll('[role="tab"]')], current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault(); buttons[next].click(); buttons[next].focus();
    }
  });
});
const dialog = document.querySelector("#figure-dialog");
document.querySelector("[data-enlarge]").addEventListener("click", () => {
  const source = document.querySelector("#method-image"), target = document.querySelector("#enlarged-image");
  target.src = source.src; target.alt = source.alt; dialog.showModal();
});
document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
const latencyObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("in-view"); latencyObserver.unobserve(entry.target); }
  });
}, { threshold: .2 });
document.querySelectorAll(".latency-block").forEach(item => latencyObserver.observe(item));
const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    navLinks.forEach(link => {
      if (link.hash === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  });
}, { rootMargin: "-15% 0px -65% 0px" });
document.querySelectorAll("main section[id]").forEach(section => sectionObserver.observe(section));
window.addEventListener("scroll", () => {
  if (window.scrollY < document.querySelector("#overview").offsetTop - innerHeight * .35)
    navLinks.forEach(link => link.removeAttribute("aria-current"));
}, { passive: true });
document.querySelectorAll("video").forEach(video => {
  video.addEventListener("play", () => {
    document.querySelectorAll("video").forEach(other => {
      if (other !== video) other.pause();
    });
  });
});
const sandboxFrame = document.querySelector("#live-sandbox");
const launchDemo = document.querySelector("#launch-demo");
const closeDemo = document.querySelector("#close-demo");
const demoPreview = document.querySelector("#demo-preview");
launchDemo.addEventListener("click", () => {
  sandboxFrame.src = sandboxFrame.dataset.src;
  sandboxFrame.hidden = false;
  demoPreview.hidden = true;
  closeDemo.hidden = false;
  sandboxFrame.focus({ preventScroll: true });
});
closeDemo.addEventListener("click", () => {
  sandboxFrame.contentWindow.postMessage({ type: "lantern-pause" }, location.origin);
  sandboxFrame.removeAttribute("src");
  sandboxFrame.hidden = true;
  demoPreview.hidden = false;
  closeDemo.hidden = true;
  launchDemo.focus({ preventScroll: true });
});
window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== sandboxFrame.contentWindow ||
      event.data?.type !== "lantern-height" || !Number.isFinite(event.data.height)) return;
  sandboxFrame.style.height = `${Math.max(600, Math.min(1400, event.data.height))}px`;
});
const sandboxObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting && sandboxFrame.hasAttribute("src"))
      sandboxFrame.contentWindow.postMessage({ type: "lantern-pause" }, location.origin);
  });
});
sandboxObserver.observe(sandboxFrame);
