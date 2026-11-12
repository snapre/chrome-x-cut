(function initXPhotoSaver() {
  "use strict";

  const BUTTON_ID = "x-photo-saver-button";
  const TOAST_ID = "x-photo-saver-toast";
  const MEDIA_SELECTOR = 'img, source, [src], [srcset], [style*="pbs.twimg.com/media/"], [style*="cdninstagram.com"], [style*="fbcdn.net"]';
  const MEDIA_HIT_CONTAINER_SELECTOR = 'picture, figure, article, a[href*="/photo/"], a[href*="/post/"], a[href*="/p/"], a[href*="/reel/"], [data-testid="tweetPhoto"], [data-testid="swipe-to-dismiss"]';
  const MIN_IMAGE_AREA = 180 * 180;
  const BUTTON_MARGIN = 10;
  const HIDE_DELAY_MS = 100;
  const QUEUE_FEEDBACK_MS = 1200;
  const CONFETTI_COLORS = ["#2f80ed", "#4f46e5", "#ef4444", "#f59e0b", "#22c55e", "#ec4899"];
  const CONFETTI_PARTICLE_COUNT = 260;
  const CONFETTI_DURATION_MS = 2200;
  const CONFETTI_SIDE_BURST_RATIO = 0.46;
  let activeCandidate = null;
  let lastPointerPoint = null;
  let hideTimer = 0;
  let queueFeedbackTimer = 0;
  let shutterAudioContext = null;
  let confettiCanvas = null;
  let confettiAnimation = 0;

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleRefresh, { passive: true });
  window.addEventListener("resize", scheduleRefresh, { passive: true });
  window.addEventListener("scroll", scheduleRefresh, true);
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerover", handlePointerMove, true);
  document.addEventListener("pointerout", handlePointerOut, true);
  document.addEventListener("keydown", handleKeydown, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) {
      return undefined;
    }

    if (message.type === "X_GET_AND_SAVE") {
      saveCurrentPhoto().then(sendResponse);
      return true;
    }

    if (message.documentUrl && message.documentUrl !== location.href) {
      return undefined;
    }
    if (message.type === "X_SAVE_RESULT" && message.result?.ok && !document.hidden) {
      playShutterSound();
      launchSuccessConfetti();
    }
    if (message.type === "X_QUEUE_RESULT") {
      const candidate = activeCandidate?.src === message.srcUrl ? activeCandidate : null;
      showQueueResult(message.result, candidate);
    }

    return undefined;
  });

  scheduleRefresh();

  function scheduleRefresh() {
    window.setTimeout(refreshActiveButton, 80);
  }

  function refreshActiveButton() {
    if (!activeCandidate) {
      return;
    }

    const candidate = lastPointerPoint ?
      getCandidateAtPoint(lastPointerPoint.x, lastPointerPoint.y) :
      refreshCandidate(activeCandidate);

    if (candidate) {
      showButtonForCandidate(candidate);
    } else {
      hideButton();
    }
  }

  function createCutButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.className = "x-photo-saver-button";
    button.type = "button";
    button.innerHTML = '<span class="x-photo-saver-icon" aria-hidden="true"></span><span aria-live="polite"></span>';
    setCutFeedback(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      primeShutterSound();
      saveCandidate(activeCandidate || getBestImageCandidate());
    });
    getOverlayRoot().appendChild(button);
    return button;
  }

  function positionButton(button, candidate) {
    const rect = candidate.rect;
    const minLeft = Math.max(rect.left + BUTTON_MARGIN, BUTTON_MARGIN);
    const maxLeft = Math.min(rect.right - button.offsetWidth - BUTTON_MARGIN, window.innerWidth - button.offsetWidth - BUTTON_MARGIN);
    const minTop = Math.max(rect.top + BUTTON_MARGIN, BUTTON_MARGIN);
    const maxTop = Math.min(rect.bottom - button.offsetHeight - BUTTON_MARGIN, window.innerHeight - button.offsetHeight - BUTTON_MARGIN);
    const left = clamp(rect.left + BUTTON_MARGIN, minLeft, maxLeft);
    const top = clamp(rect.top + BUTTON_MARGIN, minTop, maxTop);
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
  }

  function handlePointerMove(event) {
    if (event.pointerType === "touch") {
      return;
    }

    lastPointerPoint = { x: event.clientX, y: event.clientY };

    if (isButtonTarget(event.target)) {
      cancelHide();
      return;
    }

    const candidate = getCandidateAtPoint(event.clientX, event.clientY);
    if (candidate) {
      showButtonForCandidate(candidate);
      return;
    }

    scheduleHideButton();
  }

  function handlePointerOut(event) {
    if (!activeCandidate || isButtonTarget(event.relatedTarget)) {
      return;
    }

    const point = lastPointerPoint;
    if (!point || !containsPoint(activeCandidate.rect, point.x, point.y)) {
      scheduleHideButton();
    }
  }

  function showButtonForCandidate(candidate) {
    cancelHide();
    const button = document.getElementById(BUTTON_ID) || createCutButton();
    if (queueFeedbackTimer && !isSameCandidate(activeCandidate, candidate)) {
      setCutFeedback(button);
    }
    activeCandidate = candidate;
    positionButton(button, candidate);
    button.classList.add("is-visible");
  }

  function hideButton() {
    activeCandidate = null;
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      if (queueFeedbackTimer) {
        setCutFeedback(button);
      }
      button.classList.remove("is-visible");
    }
  }

  function scheduleHideButton() {
    cancelHide();
    hideTimer = window.setTimeout(hideButton, HIDE_DELAY_MS);
  }

  function cancelHide() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function isButtonTarget(target) {
    return target instanceof Element && Boolean(target.closest(`#${BUTTON_ID}`));
  }

  function clamp(value, min, max) {
    if (max < min) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  async function saveCurrentPhoto() {
    return saveCandidate(getBestImageCandidate());
  }

  async function saveCandidate(candidate) {
    let result;
    try {
      if (!candidate) {
        throw new Error("没有找到当前图片。");
      }
      result = await sendMessage({
        type: "X_SAVE_PHOTO",
        srcUrl: candidate.src,
        pageUrl: getCandidatePageUrl(candidate)
      });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    showQueueResult(result, candidate);
    return result;
  }

  function getBestImageCandidate() {
    const candidates = collectMediaCandidates().filter((candidate) => {
      return isUsableCandidate(candidate);
    });

    candidates.sort((a, b) => b.area - a.area);
    return candidates[0] || null;
  }

  function getCandidateAtPoint(x, y) {
    const hitTarget = getPageHitTarget(x, y);
    if (!hitTarget) {
      return null;
    }

    const candidates = collectMediaCandidates().filter((candidate) => {
      return isUsableCandidate(candidate) &&
        containsPoint(candidate.rect, x, y) &&
        isCandidateForHitTarget(candidate, hitTarget);
    });

    candidates.sort((a, b) => a.area - b.area);
    return candidates[0] || null;
  }

  function getPageHitTarget(x, y) {
    if (typeof document.elementsFromPoint === "function") {
      const elements = document.elementsFromPoint(x, y);
      return elements.find((element) => !isExtensionOverlayElement(element)) || null;
    }

    const element = document.elementFromPoint(x, y);
    return element && !isExtensionOverlayElement(element) ? element : null;
  }

  function isExtensionOverlayElement(element) {
    return element instanceof Element && Boolean(element.closest(
      `#${BUTTON_ID}, #${TOAST_ID}, .x-photo-saver-confetti-canvas`
    ));
  }

  function isCandidateForHitTarget(candidate, hitTarget) {
    if (!(candidate.element instanceof Element) || !(hitTarget instanceof Element)) {
      return false;
    }

    const mediaElement = candidate.element.tagName === "SOURCE" && candidate.element.parentElement ?
      candidate.element.parentElement :
      candidate.element;
    if (mediaElement === hitTarget || mediaElement.contains(hitTarget) || hitTarget.contains(mediaElement)) {
      return true;
    }

    const mediaContainer = mediaElement.closest(MEDIA_HIT_CONTAINER_SELECTOR);
    return Boolean(mediaContainer && mediaContainer.contains(hitTarget));
  }

  function refreshCandidate(candidate) {
    if (!candidate || !candidate.element || !document.documentElement.contains(candidate.element)) {
      return null;
    }

    const rect = getUsefulRect(candidate.element);
    const area = rect.width * rect.height;
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;

    return {
      element: candidate.element,
      src: candidate.src,
      rect,
      area,
      visible
    };
  }

  function isUsableCandidate(candidate) {
    if (!candidate.visible || candidate.area < MIN_IMAGE_AREA) {
      return false;
    }

    try {
      XPhotoSaverUrlUtils.normalizeMediaImageUrl(candidate.src, location.href);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function collectMediaCandidates() {
    const elements = Array.from(document.querySelectorAll(MEDIA_SELECTOR));
    const candidates = [];

    for (const element of elements) {
      const urls = extractMediaUrls(element);
      if (!urls.length) {
        continue;
      }

      const rect = getUsefulRect(element);
      const area = rect.width * rect.height;
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < window.innerHeight && rect.left < window.innerWidth;

      for (const src of urls) {
        candidates.push({ element, src, rect, area, visible });
      }
    }

    return candidates;
  }

  function extractMediaUrls(element) {
    const values = [
      element.currentSrc,
      element.src,
      element.getAttribute && element.getAttribute("src"),
      element.srcset,
      element.getAttribute && element.getAttribute("srcset"),
      element.getAttribute && element.getAttribute("style")
    ].filter(Boolean);

    const urls = [];
    for (const value of values) {
      urls.push(...extractMediaUrlsFromText(String(value)));
    }
    return XPhotoSaverUrlUtils.sortMediaImageUrlsByQuality(Array.from(new Set(urls)));
  }

  function extractMediaUrlsFromText(text) {
    const urls = [];
    const regex = /https:\/\/[^"')\s,]+/g;
    let match = regex.exec(text);
    while (match) {
      urls.push(match[0]);
      match = regex.exec(text);
    }
    return urls;
  }

  function getUsefulRect(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }

    const parent = element.parentElement;
    return parent ? parent.getBoundingClientRect() : rect;
  }

  function containsPoint(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getCandidatePageUrl(candidate) {
    const link = findPostLink(candidate.element);
    return link ? new URL(link.href, location.href).toString() : location.href;
  }

  function findPostLink(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const closestStatusLink = element.closest('a[href*="/status/"], a[href*="/statuses/"], a[href*="/post/"], a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
    if (closestStatusLink) {
      return closestStatusLink;
    }

    const article = element.closest("article");
    if (!article) {
      return null;
    }

    const photoLink = article.querySelector('a[href*="/status/"][href*="/photo/"], a[href*="/statuses/"][href*="/photo/"], a[href*="/post/"], a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
    if (photoLink) {
      return photoLink;
    }

    return article.querySelector('a[href*="/status/"], a[href*="/statuses/"], a[href*="/post/"], a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
  }

  function handleKeydown(event) {
    if (!event.repeat && event.altKey && event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      primeShutterSound();
      saveCurrentPhoto();
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function isSameCandidate(a, b) {
    return Boolean(a && b && a.element === b.element && a.src === b.src);
  }

  function showQueueResult(result, candidate) {
    if (!result?.ok) {
      const error = result?.error || "未能加入队列。";
      const needsRefresh = /context invalidated|receiving end does not exist|message port closed/i.test(error);
      showErrorToast(needsRefresh ? "请刷新页面后再 Cut。" : error);
      return;
    }

    const button = document.getElementById(BUTTON_ID);
    if (!button || !isSameCandidate(activeCandidate, candidate)) {
      return;
    }

    setCutFeedback(button, result.duplicate ? "已在队列中" : "已加入队列");
    positionButton(button, activeCandidate);
    queueFeedbackTimer = window.setTimeout(() => {
      setCutFeedback(button);
      if (activeCandidate) {
        positionButton(button, activeCandidate);
      }
    }, QUEUE_FEEDBACK_MS);
  }

  function setCutFeedback(button, label = "") {
    window.clearTimeout(queueFeedbackTimer);
    queueFeedbackTimer = 0;
    button.classList.toggle("is-queued", Boolean(label));
    button.firstElementChild.textContent = label ? "✓" : "↓";
    button.lastElementChild.textContent = label || "Cut";
    button.title = label || "一键保存当前原图";
  }

  function showErrorToast(message) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "x-photo-saver-toast";
    toast.setAttribute("role", "alert");
    toast.textContent = message;
    getOverlayRoot().appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function getOverlayRoot() {
    return document.body || document.documentElement;
  }

  function primeShutterSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    try {
      shutterAudioContext ||= new AudioContext();
      if (shutterAudioContext.state === "suspended") {
        shutterAudioContext.resume().catch(() => {});
      }
    } catch (_error) {
      // Saving and visual feedback can proceed when audio is unavailable.
    }
  }

  function playShutterSound() {
    if (!shutterAudioContext && navigator.userActivation?.hasBeenActive) {
      primeShutterSound();
    }
    const context = shutterAudioContext;
    if (!context || context.state !== "running") {
      return;
    }

    const start = context.currentTime + 0.01;
    playClickTone(context, start, 1250, 0.04, 0.14);
    playClickTone(context, start + 0.055, 760, 0.06, 0.1);
    playShutterNoise(context, start + 0.015, 0.075, 0.04);
  }

  function playClickTone(context, start, frequency, duration, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function playShutterNoise(context, start, duration, volume) {
    const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, start);
    filter.Q.setValueAtTime(0.8, start);
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + duration);
  }

  function launchSuccessConfetti() {
    if (confettiAnimation || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const button = document.getElementById(BUTTON_ID);
    const rect = button?.classList.contains("is-visible") ? button.getBoundingClientRect() : null;
    const origin = rect ? {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    } : {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };

    const canvas = getConfettiCanvas();
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    resizeConfettiCanvas(canvas, context);
    const particles = createConfettiParticles(origin, CONFETTI_PARTICLE_COUNT);
    const startTime = performance.now();
    const duration = CONFETTI_DURATION_MS;

    function drawFrame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.gravity;
        particle.vx *= 0.992;
        particle.rotation += particle.spin;
        particle.opacity = Math.max(0, 1 - Math.max(0, progress - 0.78) / 0.22);
        drawConfettiParticle(context, particle);
      }

      if (progress < 1) {
        confettiAnimation = requestAnimationFrame(drawFrame);
      } else {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        canvas.remove();
        confettiCanvas = null;
        confettiAnimation = 0;
      }
    }

    confettiAnimation = requestAnimationFrame(drawFrame);
  }

  function getConfettiCanvas() {
    if (confettiCanvas && document.documentElement.contains(confettiCanvas)) {
      return confettiCanvas;
    }

    confettiCanvas = document.createElement("canvas");
    confettiCanvas.className = "x-photo-saver-confetti-canvas";
    getOverlayRoot().appendChild(confettiCanvas);
    return confettiCanvas;
  }

  function resizeConfettiCanvas(canvas, context) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(window.innerWidth * ratio);
    canvas.height = Math.ceil(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function createConfettiParticles(origin, count) {
    const particles = [];
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      const fromSide = i > count * CONFETTI_SIDE_BURST_RATIO;
      const speed = fromSide ? 6 + Math.random() * 9 : 5 + Math.random() * 9;
      const sideX = Math.random() < 0.5 ? -20 : window.innerWidth + 20;
      const sideY = window.innerHeight * (0.26 + Math.random() * 0.58);
      const startX = fromSide ? sideX : origin.x;
      const startY = fromSide ? sideY : origin.y;
      const direction = fromSide ? (sideX < 0 ? -0.15 : Math.PI + 0.15) + (Math.random() - 0.5) * 0.75 : angle;

      particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(direction) * speed,
        vy: Math.sin(direction) * speed - Math.random() * 2,
        gravity: 0.1 + Math.random() * 0.14,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.42,
        width: 4 + Math.random() * 9,
        height: 7 + Math.random() * 16,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        shape: Math.floor(Math.random() * 3),
        opacity: 1
      });
    }
    return particles;
  }

  function drawConfettiParticle(context, particle) {
    context.save();
    context.globalAlpha = particle.opacity;
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.fillStyle = particle.color;

    if (particle.shape === 0) {
      context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
    } else if (particle.shape === 1) {
      context.beginPath();
      context.ellipse(0, 0, particle.width / 2, particle.height / 2, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(0, -particle.height / 2);
      context.lineTo(particle.width / 2, particle.height / 2);
      context.lineTo(-particle.width / 2, particle.height / 2);
      context.closePath();
      context.fill();
    }

    context.restore();
  }
})();
