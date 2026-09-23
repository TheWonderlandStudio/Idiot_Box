// ─── Smart Custom Cursor (shared: hub + onboarding) ──────────────────────────
// User-provided vanilla cursor system ka React port: velocity-based rotation,
// fast-move shrink, click shrink, dark/light auto color, clickable straighten.
// `scope` batata hai cursor kin areas me active rahe (selector list, default
// ".phub"). Scope se bahar mouse jane par custom cursor hide ho jata hai taaki
// double cursor na dikhe. Native cursor hide karne wali CSS scope wali jagah
// par lagao (hub: hub.css, onboarding: ONBOARD_CSS).
import React, { useEffect, useRef } from "react";

const CURSOR_PATH_D =
  "M82 32 C75 33 68 39 65 46 C64 48 64 52 64.5 58 L71 204 " +
  "C71.5 214 77 221 86 223 C94 225 101 221 107 214 L132 180 " +
  "C139 171 148 167 160 166 L211 166 C219 166 224 160 224 151 " +
  "C224 144 221 138 214 132 L104 39 C97 34 89 31 82 32 Z";

const CustomCursor = ({ scope = ".phub" }) => {
  const cursorRef = useRef(null);
  const pathRef = useRef(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    const cursorPath = pathRef.current;
    if (!cursor || !cursorPath) return;

    // ── Mouse position ──
    let mouseX = 0, mouseY = 0;
    let currentX = 0, currentY = 0;

    // ── Velocity ──
    let velocityX = 0, velocityY = 0;
    let lastMouseX = 0, lastMouseY = 0;

    // ── Rotation ──
    let currentAngle = 0, targetAngle = 0;

    // ── Scale ──
    const NORMAL_SCALE = 1;
    const FAST_SCALE = 0.72; // fast movement par 72% size
    const CLICK_SCALE = 0.78; // click par kitna chhota
    let currentScale = NORMAL_SCALE;
    let targetScale = NORMAL_SCALE;

    // ── State ──
    let initialized = false;
    let mouseDown = false;
    let isClickable = false;
    let rafId = 0;

    // ── Tuning ──
    const FAST_THRESHOLD = 10;
    const DIRECTION_THRESHOLD = 2; // chhoti movement ignore (no jitter)
    const POSITION_SMOOTHING = 0.22;
    const ROTATION_SMOOTHING = 0.08;
    const CLICKABLE_ROTATION_SMOOTHING = 0.14;
    const SCALE_SMOOTHING = 0.12;
    const VELOCITY_SMOOTHING = 0.30;
    const VELOCITY_DECAY = 0.88;

    const clickableSelector =
      'a, button, input, textarea, select, option, summary, ' +
      '[role="button"], [onclick], [tabindex]:not([tabindex="-1"])';

    const lerp = (current, target, amount) => current + (target - current) * amount;

    // 359 -> 1 ko 358 deg ke bajay 2 deg rotate karega
    const angleLerp = (current, target, amount) => {
      let difference = target - current;
      while (difference > 180) difference -= 360;
      while (difference < -180) difference += 360;
      return current + difference * amount;
    };

    const getBrightness = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114;

    const parseRGB = (color) => {
      const rgb = String(color || "").match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (!rgb) return null;
      return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    };

    const findBackground = (element) => {
      let current = element;
      while (current && current !== document.documentElement) {
        let background = null;
        try { background = window.getComputedStyle(current).backgroundColor; } catch { background = null; }
        if (background && background !== "transparent" && !background.includes("rgba(0, 0, 0, 0)")) {
          return background;
        }
        current = current.parentElement;
      }
      try { return window.getComputedStyle(document.body).backgroundColor; } catch { return null; }
    };

    const updateCursorColor = (x, y) => {
      let element = null;
      try { element = document.elementFromPoint(x, y); } catch { element = null; }
      if (!element) return;
      const color = parseRGB(findBackground(element));
      if (!color) return;
      // dark bg -> white cursor, light bg -> black cursor
      cursorPath.style.fill = getBrightness(color.r, color.g, color.b) < 145 ? "#ffffff" : "#000000";
    };

    const checkClickable = (x, y) => {
      let element = null;
      try { element = document.elementFromPoint(x, y); } catch { element = null; }
      if (!element || !element.closest) return false;
      return Boolean(element.closest(clickableSelector));
    };

    const updateDirection = () => {
      const speed = Math.hypot(velocityX, velocityY);
      if (speed < DIRECTION_THRESHOLD) return; // tiny movements ignore
      const angle = (Math.atan2(velocityY, velocityX) * 180) / Math.PI;
      targetAngle = angle + 90; // +90 SVG shape ki natural orientation ki wajah se
    };

    const onMouseMove = (event) => {
      // Scope se bahar custom cursor hide (native cursor wapas dikhega)
      const inside =
        event.target && event.target.closest ? Boolean(event.target.closest(scope)) : false;
      cursor.style.opacity = inside ? "1" : "0";
      if (!inside) return;

      mouseX = event.clientX;
      mouseY = event.clientY;

      updateCursorColor(mouseX, mouseY);

      if (!initialized) {
        currentX = mouseX; currentY = mouseY;
        lastMouseX = mouseX; lastMouseY = mouseY;
        initialized = true;
        return;
      }

      const dx = mouseX - lastMouseX;
      const dy = mouseY - lastMouseY;
      const distance = Math.hypot(dx, dy);

      if (distance > 2) {
        velocityX = velocityX * (1 - VELOCITY_SMOOTHING) + dx * VELOCITY_SMOOTHING;
        velocityY = velocityY * (1 - VELOCITY_SMOOTHING) + dy * VELOCITY_SMOOTHING;
        lastMouseX = mouseX;
        lastMouseY = mouseY;
        if (!isClickable) updateDirection();
      }

      const clickable = checkClickable(mouseX, mouseY);
      if (clickable) {
        if (!isClickable) {
          isClickable = true;
          targetAngle = 0; // clickable par cursor straight
        }
      } else if (isClickable) {
        isClickable = false;
        velocityX = 0; velocityY = 0; // sudden rotation avoid
        lastMouseX = mouseX; lastMouseY = mouseY;
      }
    };

    const onMouseDown = () => {
      mouseDown = true;
      targetScale = CLICK_SCALE;
    };
    const onMouseUp = () => {
      mouseDown = false;
    };
    // Window se bahar jane par hide
    const onMouseOut = (event) => {
      if (!event.relatedTarget) {
        cursor.style.opacity = "0";
        velocityX = 0; velocityY = 0;
        targetScale = NORMAL_SCALE;
        currentScale = NORMAL_SCALE;
      }
    };

    const animate = () => {
      currentX = lerp(currentX, mouseX, POSITION_SMOOTHING);
      currentY = lerp(currentY, mouseY, POSITION_SMOOTHING);

      velocityX *= VELOCITY_DECAY;
      velocityY *= VELOCITY_DECAY;
      const speed = Math.hypot(velocityX, velocityY);

      if (mouseDown) {
        targetScale = CLICK_SCALE;
      } else if (speed >= FAST_THRESHOLD) {
        targetScale = FAST_SCALE;
      } else {
        targetScale = NORMAL_SCALE;
      }

      currentAngle = angleLerp(
        currentAngle,
        targetAngle,
        isClickable ? CLICKABLE_ROTATION_SMOOTHING : ROTATION_SMOOTHING
      );
      currentScale = lerp(currentScale, targetScale, SCALE_SMOOTHING);

      cursor.style.transform =
        `translate3d(${currentX - 4}px, ${currentY - 4}px, 0) ` +
        `rotate(${currentAngle}deg) scale(${currentScale})`;

      rafId = requestAnimationFrame(animate);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mouseout", onMouseOut);
    rafId = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mouseout", onMouseOut);
      try { cancelAnimationFrame(rafId); } catch {}
    };
  }, [scope]);

  return (
    <div className="smart-cursor" ref={cursorRef} aria-hidden="true">
      <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
        <path ref={pathRef} d={CURSOR_PATH_D} />
      </svg>
    </div>
  );
};

export default CustomCursor;
