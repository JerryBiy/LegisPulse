import { useState, useCallback, useEffect, useRef } from "react";

const COLLAPSE_THRESHOLD = 80;

/**
 * Hook for drag-resizable height with auto-collapse.
 * Returns { height, collapsed, onMouseDown, toggle }.
 *
 * @param {string}  storageKey    localStorage key for persisting height
 * @param {number}  defaultHeight default height in px (default 480)
 * @param {number}  minHeight     minimum height before collapse zone (default 120)
 */
export function useResizableHeight({
  storageKey,
  defaultHeight = 480,
  minHeight = 120,
}) {
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseInt(saved, 10) : defaultHeight;
  });
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(storageKey + "-collapsed") === "true";
  });
  const prevHeight = useRef(height);

  // Persist
  useEffect(() => {
    if (!collapsed) {
      localStorage.setItem(storageKey, String(height));
      prevHeight.current = height;
    }
  }, [height, storageKey, collapsed]);

  useEffect(() => {
    localStorage.setItem(storageKey + "-collapsed", String(collapsed));
  }, [collapsed, storageKey]);

  const onMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = collapsed ? prevHeight.current : height;

      const onMouseMove = (ev) => {
        const newH = startH + (ev.clientY - startY);
        if (newH < COLLAPSE_THRESHOLD) {
          setCollapsed(true);
        } else {
          setCollapsed(false);
          setHeight(Math.max(minHeight, newH));
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [height, collapsed, minHeight],
  );

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  return { height: collapsed ? 0 : height, collapsed, onMouseDown, toggle };
}

/**
 * Visual resize handle bar — place below the resizable container.
 */
export function ResizeHandle({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="h-3 cursor-ns-resize flex items-center justify-center group hover:bg-slate-100 transition-colors select-none"
    >
      <div className="w-10 h-1 bg-slate-200 rounded-full group-hover:bg-slate-400 transition-colors" />
    </div>
  );
}
