const canvas = document.querySelector("#jellyCanvas");
const stageWrap = document.querySelector("#stageWrap");
const springControl = document.querySelector("#springControl");
const dampingControl = document.querySelector("#dampingControl");
const pullControl = document.querySelector("#pullControl");

const ctx = canvas.getContext("2d", { alpha: true });

const CONFIG = {
  gridX: 24,
  gridY: 24,
  spring: Number(springControl.value),
  damping: Number(dampingControl.value),
  maxPull: Number(pullControl.value),
  cheekRadius: 94,
  globalBreath: 0.006,
  maxDisplaySize: 450,
};

const cheeks = {
  left: { id: "left", x: 0.25, y: 0.62 },
  right: { id: "right", x: 0.75, y: 0.62 },
};

const pointerState = new Map();
const points = [];
const triangles = [];
let image = null;
let meshReady = false;
let startedAt = performance.now();
let lastFrame = performance.now();
let jellyEnergy = 0;
let displayRect = { x: 0, y: 0, w: 0, h: 0 };
let canvasCss = { w: 1, h: 1 };
let hasInteracted = false;

const focus = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  strength: 0,
  targetStrength: 0,
  life: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`圖片載入失敗：${src}`));
    img.src = src;
  });
}

function buildMesh() {
  points.length = 0;
  triangles.length = 0;

  for (let y = 0; y <= CONFIG.gridY; y++) {
    for (let x = 0; x <= CONFIG.gridX; x++) {
      const u = x / CONFIG.gridX;
      const v = y / CONFIG.gridY;
      const px = u * image.width;
      const py = v * image.height;

      points.push({
        u,
        v,
        baseX: px,
        baseY: py,
        x: px,
        y: py,
        vx: 0,
        vy: 0,
      });
    }
  }

  const row = CONFIG.gridX + 1;
  for (let y = 0; y < CONFIG.gridY; y++) {
    for (let x = 0; x < CONFIG.gridX; x++) {
      const a = y * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      triangles.push([a, c, b], [b, c, d]);
    }
  }

  meshReady = true;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  canvasCss = {
    w: Math.max(1, rect.width),
    h: Math.max(1, rect.height),
  };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateDisplayRect() {
  if (!image) return;

  const imageAspect = image.width / image.height;
  const maxByWidth = canvasCss.w * 0.74;
  const maxByHeight = canvasCss.h * 0.78;
  let w = Math.min(maxByWidth, maxByHeight * imageAspect, CONFIG.maxDisplaySize);
  let h = w / imageAspect;

  if (h > maxByHeight) {
    h = maxByHeight;
    w = h * imageAspect;
  }

  w = Math.max(160, w);
  h = Math.max(160, h);

  displayRect = {
    x: (canvasCss.w - w) / 2,
    y: (canvasCss.h - h) / 2,
    w,
    h,
  };
}

function cssToImagePoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left - displayRect.x) / displayRect.w) * image.width;
  const y = ((clientY - rect.top - displayRect.y) / displayRect.h) * image.height;
  return { x, y };
}

function clientToStagePoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function imagePointToCss(x, y) {
  return {
    x: displayRect.x + (x / image.width) * displayRect.w,
    y: displayRect.y + (y / image.height) * displayRect.h,
  };
}

function getCheekPixel(cheek) {
  return {
    x: cheek.x * image.width,
    y: cheek.y * image.height,
  };
}

function getAvailableCheek(point) {
  const usedCheeks = new Set([...pointerState.values()].map((p) => p.cheekId));
  const candidates = Object.values(cheeks)
    .filter((cheek) => !usedCheeks.has(cheek.id))
    .map((cheek) => {
      const c = getCheekPixel(cheek);
      const distance = Math.hypot(point.x - c.x, point.y - c.y);
      return { cheek, distance };
    })
    .sort((a, b) => a.distance - b.distance);

  const first = candidates[0];
  if (!first) return null;

  const maxStartDistance = image.width * 0.34;
  return first.distance <= maxStartDistance ? first.cheek : null;
}

function clampVector(dx, dy, maxLength) {
  const length = Math.hypot(dx, dy);
  if (length <= maxLength || length === 0) return { dx, dy };
  const ratio = maxLength / length;
  return { dx: dx * ratio, dy: dy * ratio };
}

function setFocusFromClient(clientX, clientY, strength = 0.7, life = 1.2) {
  const point = clientToStagePoint(clientX, clientY);
  const centerX = displayRect.x + displayRect.w / 2;
  const centerY = displayRect.y + displayRect.h / 2;
  const dx = (point.x - centerX) / (displayRect.w * 0.5);
  const dy = (point.y - centerY) / (displayRect.h * 0.5);
  const length = Math.hypot(dx, dy) || 1;
  const limited = Math.min(length, 1.25) / length;

  focus.targetX = clamp(dx * limited, -1.15, 1.15);
  focus.targetY = clamp(dy * limited, -1.15, 1.15);
  focus.targetStrength = Math.max(focus.targetStrength, strength);
  focus.life = Math.max(focus.life, life);
}

function isPointInsideAvatar(point) {
  const nx = (point.x / image.width - 0.5) / 0.52;
  const ny = (point.y / image.height - 0.54) / 0.48;
  return nx * nx + ny * ny <= 1.0;
}

function handlePointerDown(event) {
  if (!meshReady) return;

  hasInteracted = true;
  stageWrap.classList.add("has-interacted");

  const point = cssToImagePoint(event.clientX, event.clientY);
  const cheek = pointerState.size < 2 ? getAvailableCheek(point) : null;

  if (!cheek) {
    setFocusFromClient(event.clientX, event.clientY, isPointInsideAvatar(point) ? 0.45 : 0.95, 1.6);
    jellyEnergy = Math.min(1, jellyEnergy + 0.14);
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  const cheekPixel = getCheekPixel(cheek);
  pointerState.set(event.pointerId, {
    cheekId: cheek.id,
    startX: point.x,
    startY: point.y,
    cheekX: cheekPixel.x,
    cheekY: cheekPixel.y,
    dragX: 0,
    dragY: 0,
  });

  focus.targetStrength = 0;
  focus.life = 0;
  jellyEnergy = Math.min(1, jellyEnergy + 0.22);
  stageWrap.classList.add("is-dragging");
}

function handlePointerMove(event) {
  if (!meshReady) return;

  const pointer = pointerState.get(event.pointerId);
  if (!pointer) {
    if (event.pointerType !== "touch" && pointerState.size === 0) {
      setFocusFromClient(event.clientX, event.clientY, 0.38, 0.22);
    }
    return;
  }

  const point = cssToImagePoint(event.clientX, event.clientY);
  const rawX = point.x - pointer.startX;
  const rawY = point.y - pointer.startY;
  const clamped = clampVector(rawX, rawY, CONFIG.maxPull);
  pointer.dragX = clamped.dx;
  pointer.dragY = clamped.dy;
  jellyEnergy = Math.min(1, jellyEnergy + Math.hypot(pointer.dragX, pointer.dragY) / 850);
}

function releasePointer(event) {
  const pointer = pointerState.get(event.pointerId);
  if (!pointer) return;

  for (const point of points) {
    const distance = Math.hypot(point.baseX - pointer.cheekX, point.baseY - pointer.cheekY);
    const influence = Math.exp(-(distance * distance) / (2 * CONFIG.cheekRadius * CONFIG.cheekRadius));
    point.vx += pointer.dragX * influence * 0.035;
    point.vy += pointer.dragY * influence * 0.035;
  }

  pointerState.delete(event.pointerId);
  jellyEnergy = Math.min(1, jellyEnergy + 0.3);

  if (pointerState.size === 0) {
    stageWrap.classList.remove("is-dragging");
  }
}

function handlePointerLeave() {
  if (pointerState.size > 0) return;
  focus.life = 0;
  focus.targetStrength = 0;
}

function updateFocus(delta) {
  const dtScale = Math.min(2, delta / 16.67);

  if (pointerState.size > 0) {
    focus.targetStrength = 0;
  } else if (focus.life > 0) {
    focus.life -= delta / 1000;
  } else {
    focus.targetStrength = 0;
    focus.targetX *= Math.pow(0.92, dtScale);
    focus.targetY *= Math.pow(0.92, dtScale);
  }

  focus.x += (focus.targetX - focus.x) * 0.08 * dtScale;
  focus.y += (focus.targetY - focus.y) * 0.08 * dtScale;
  focus.strength += (focus.targetStrength - focus.strength) * 0.08 * dtScale;
}

function updatePhysics(delta) {
  const time = (performance.now() - startedAt) / 1000;
  const dtScale = Math.min(2, delta / 16.67);
  const activePulls = [...pointerState.values()];
  const breathX = Math.sin(time * 2.1) * CONFIG.globalBreath;
  const breathY = Math.cos(time * 2.0) * CONFIG.globalBreath;
  const centerX = image.width * 0.5;
  const centerY = image.height * 0.5;
  const idlePower = pointerState.size === 0 ? focus.strength : 0;
  const lookX = focus.x * idlePower;
  const lookY = focus.y * idlePower;

  for (const point of points) {
    const horizontal = (point.baseX - centerX) / centerX;
    const vertical = (point.baseY - centerY) / centerY;
    let targetX = point.baseX + (point.baseX - centerX) * breathX;
    let targetY = point.baseY + (point.baseY - centerY) * breathY;

    if (idlePower > 0.005) {
      // 沒有真正捏到麻糬時，整體會微微往滑鼠/點擊方向「探頭」。
      targetX += lookX * 12;
      targetY += lookY * 8;
      targetX += vertical * lookX * 15;
      targetY += horizontal * lookY * 5;
      targetX -= horizontal * Math.abs(lookX) * 3.2;
      targetY -= vertical * Math.abs(lookY) * 2.2;
    }

    for (const pull of activePulls) {
      const distance = Math.hypot(point.baseX - pull.cheekX, point.baseY - pull.cheekY);
      const localInfluence = Math.exp(-(distance * distance) / (2 * CONFIG.cheekRadius * CONFIG.cheekRadius));
      const broadInfluence = Math.exp(-(distance * distance) / (2 * Math.pow(CONFIG.cheekRadius * 1.75, 2))) * 0.16;
      targetX += pull.dragX * (localInfluence + broadInfluence);
      targetY += pull.dragY * (localInfluence + broadInfluence);
    }

    point.vx += (targetX - point.x) * CONFIG.spring * dtScale;
    point.vy += (targetY - point.y) * CONFIG.spring * dtScale;
    point.vx *= Math.pow(CONFIG.damping, dtScale);
    point.vy *= Math.pow(CONFIG.damping, dtScale);
    point.x += point.vx * dtScale;
    point.y += point.vy * dtScale;
  }

  jellyEnergy *= Math.pow(0.94, dtScale);
}

function pointToCanvas(point) {
  return imagePointToCss(point.x, point.y);
}

function drawTriangle(triangle) {
  const p0 = points[triangle[0]];
  const p1 = points[triangle[1]];
  const p2 = points[triangle[2]];
  const d0 = pointToCanvas(p0);
  const d1 = pointToCanvas(p1);
  const d2 = pointToCanvas(p2);

  const sx0 = p0.baseX;
  const sy0 = p0.baseY;
  const sx1 = p1.baseX;
  const sy1 = p1.baseY;
  const sx2 = p2.baseX;
  const sy2 = p2.baseY;
  const dx0 = d0.x;
  const dy0 = d0.y;
  const dx1 = d1.x;
  const dy1 = d1.y;
  const dx2 = d2.x;
  const dy2 = d2.y;

  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(det) < 0.0001) return;

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / det;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / det;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / det;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / det;
  const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / det;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / det;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function drawShadow() {
  const cx = displayRect.x + displayRect.w / 2 + focus.x * focus.strength * 10;
  const cy = displayRect.y + displayRect.h * 0.82;
  ctx.save();
  ctx.globalAlpha = 0.18 + jellyEnergy * 0.07;
  ctx.filter = "blur(18px)";
  ctx.fillStyle = "rgba(92, 44, 128, 0.36)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, displayRect.w * 0.34, displayRect.h * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGloss() {
  const energy = clamp(jellyEnergy, 0, 1);
  const cx = displayRect.x;
  const cy = displayRect.y;
  const w = displayRect.w;
  const h = displayRect.h;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.32 + energy * 0.18;

  let gradient = ctx.createRadialGradient(cx + w * 0.62, cy + h * 0.14, 4, cx + w * 0.62, cy + h * 0.14, w * 0.23);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.72)");
  gradient.addColorStop(0.42, "rgba(255, 221, 255, 0.22)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.62, cy + h * 0.14, w * 0.16, h * 0.09, -0.62, 0, Math.PI * 2);
  ctx.fill();

  gradient = ctx.createRadialGradient(cx + w * 0.38, cy + h * 0.22, 2, cx + w * 0.38, cy + h * 0.22, w * 0.12);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.54)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx + w * 0.38, cy + h * 0.22, w * 0.055, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.11 + energy * 0.12;
  const wave = ctx.createLinearGradient(cx, cy, cx + w, cy + h);
  wave.addColorStop(0, "rgba(255, 255, 255, 0)");
  wave.addColorStop(0.45, "rgba(255, 255, 255, 0.65)");
  wave.addColorStop(0.62, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = wave;
  ctx.fillRect(cx, cy, w, h);

  ctx.restore();
}

function render() {
  const now = performance.now();
  const delta = now - lastFrame;
  lastFrame = now;

  resizeCanvas();
  updateDisplayRect();

  ctx.clearRect(0, 0, canvasCss.w, canvasCss.h);

  if (meshReady) {
    updateFocus(delta);
    updatePhysics(delta);
    drawShadow();

    for (const triangle of triangles) {
      drawTriangle(triangle);
    }

    drawGloss();
  }

  requestAnimationFrame(render);
}

function connectControls() {
  springControl.addEventListener("input", () => {
    CONFIG.spring = Number(springControl.value);
  });

  dampingControl.addEventListener("input", () => {
    CONFIG.damping = Number(dampingControl.value);
  });

  pullControl.addEventListener("input", () => {
    CONFIG.maxPull = Number(pullControl.value);
  });
}

async function main() {
  image = await loadImage("./assets/avatar.png");
  buildMesh();
  connectControls();

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("resize", resizeCanvas);

  requestAnimationFrame(render);
}

main().catch((error) => {
  console.error(error);
  const message = document.createElement("p");
  message.style.color = "#b00020";
  message.style.fontWeight = "800";
  message.textContent = error.message;
  document.body.append(message);
});
