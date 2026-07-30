import { useEffect, useMemo, useRef, useState } from "react";


function adoptSvgNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.nodeValue || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const adopted = document.createElementNS(
    node.namespaceURI || "http://www.w3.org/2000/svg",
    node.localName
  );
  [...node.attributes].forEach(attribute => {
    adopted.setAttributeNS(
      attribute.namespaceURI,
      attribute.name,
      attribute.value
    );
  });
  [...node.childNodes].forEach(child => {
    const adoptedChild = adoptSvgNode(child);
    if (adoptedChild) adopted.appendChild(adoptedChild);
  });
  return adopted;
}


function selectionRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
}


function intersects(left, right) {
  return (
    left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top
  );
}


export default function SvgRepairCanvas({
  svgPath,
  shapes,
  selectedRefs,
  hoveredRef,
  onSelectionChange,
  onHover
}) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const dragRef = useRef(null);
  const originalStyleRef = useRef(new Map());
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState("select");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState(null);
  const selectedSet = useMemo(
    () => new Set(selectedRefs || []),
    [selectedRefs]
  );
  const shapeByRef = useMemo(
    () => new Map((shapes || []).map(shape => [shape.ref, shape])),
    [shapes]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");

    fetch(svgPath, { cache: "no-store", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("SVG inspection could not be loaded");
        return response.text();
      })
      .then(source => {
        if (!contentRef.current) return;
        const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
        const root = parsed.documentElement;
        if (
          parsed.querySelector("parsererror")
          || root?.localName?.toLowerCase() !== "svg"
          || (
            root.namespaceURI
            && root.namespaceURI !== "http://www.w3.org/2000/svg"
          )
        ) {
          throw new Error("Invalid SVG inspection preview");
        }
        const adopted = adoptSvgNode(root);
        adopted.setAttribute("width", "100%");
        adopted.setAttribute("height", "100%");
        adopted.setAttribute("preserveAspectRatio", "xMidYMid meet");
        originalStyleRef.current = new Map();
        adopted.querySelectorAll("[data-nemoris-draft-shape]").forEach(element => {
          const ref = element.getAttribute("data-nemoris-draft-shape");
          originalStyleRef.current.set(ref, {
            opacity: element.getAttribute("opacity"),
            pointerEvents: element.getAttribute("pointer-events"),
            stroke: element.getAttribute("stroke"),
            strokeWidth: element.getAttribute("stroke-width")
          });
        });
        contentRef.current.replaceChildren(adopted);
        setLoadVersion(version => version + 1);
      })
      .catch(error => {
        if (error.name !== "AbortError") {
          setLoadError("Impossible d’afficher l’aperçu d’inspection.");
        }
      });

    return () => controller.abort();
  }, [svgPath]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current
      .querySelectorAll("[data-nemoris-draft-shape]")
      .forEach(element => {
        const ref = element.getAttribute("data-nemoris-draft-shape");
        const shape = shapeByRef.get(ref);
        const original = originalStyleRef.current.get(ref) || {};
        const restore = (name, value) => {
          if (value == null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        };
        restore("opacity", original.opacity);
        restore("stroke", original.stroke);
        restore("stroke-width", original.strokeWidth);
        element.setAttribute("pointer-events", "all");
        element.style.cursor = mode === "pan" ? "grab" : "crosshair";

        if (shape?.role === "unresolved") {
          element.setAttribute(
            "stroke", shape.risk === "required" ? "#ef4444" : "#f59e0b"
          );
          element.setAttribute("stroke-width", "1.5");
        } else if (shape?.role === "label") {
          element.setAttribute("stroke", "#d946ef");
          element.setAttribute("stroke-width", "1.5");
          element.setAttribute("opacity", "0.7");
        } else if (shape?.role === "decoration") {
          element.setAttribute("opacity", "0.5");
        } else if (shape?.role === "excluded") {
          element.setAttribute("opacity", "0.18");
        }

        if (ref === hoveredRef) {
          element.setAttribute("stroke", "#67e8f9");
          element.setAttribute("stroke-width", "2");
        }
        if (selectedSet.has(ref)) {
          element.setAttribute("stroke", "#22d3ee");
          element.setAttribute("stroke-width", "2.5");
          element.setAttribute("opacity", "1");
        }
      });
  }, [hoveredRef, loadVersion, mode, selectedSet, shapeByRef]);

  function targetRef(event) {
    return event.target
      ?.closest?.("[data-nemoris-draft-shape]")
      ?.getAttribute("data-nemoris-draft-shape") || null;
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      last: { x: event.clientX, y: event.clientY },
      targetRef: targetRef(event),
      additive: event.shiftKey,
      moved: false,
      initialOffset: offset
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      onHover?.(targetRef(event));
      return;
    }
    const distance = Math.hypot(
      event.clientX - drag.start.x,
      event.clientY - drag.start.y
    );
    if (distance > 4) drag.moved = true;
    drag.last = { x: event.clientX, y: event.clientY };
    if (!drag.moved) return;

    if (mode === "pan") {
      setOffset({
        x: drag.initialOffset.x + event.clientX - drag.start.x,
        y: drag.initialOffset.y + event.clientY - drag.start.y
      });
      return;
    }
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    if (!wrapper) return;
    setBox(selectionRect(
      { x: drag.start.x - wrapper.left, y: drag.start.y - wrapper.top },
      { x: event.clientX - wrapper.left, y: event.clientY - wrapper.top }
    ));
  }

  function finishPointer(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setBox(null);

    if (mode === "pan") return;
    if (!drag.moved) {
      if (!drag.targetRef) {
        if (!drag.additive) onSelectionChange?.([]);
        return;
      }
      if (drag.additive) {
        const next = new Set(selectedSet);
        if (next.has(drag.targetRef)) next.delete(drag.targetRef);
        else next.add(drag.targetRef);
        onSelectionChange?.([...next]);
      } else {
        onSelectionChange?.([drag.targetRef]);
      }
      return;
    }

    const area = selectionRect(drag.start, drag.last);
    const matches = [];
    contentRef.current
      ?.querySelectorAll("[data-nemoris-draft-shape]")
      .forEach(element => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width > 0
          && rect.height > 0
          && intersects(area, rect)
        ) {
          matches.push(element.getAttribute("data-nemoris-draft-shape"));
        }
      });
    if (drag.additive) {
      onSelectionChange?.([...new Set([...selectedSet, ...matches])]);
    } else {
      onSelectionChange?.(matches);
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.16 : 0.86;
    setScale(value => Math.min(30, Math.max(0.5, value * factor)));
  }

  return (
    <div
      ref={wrapperRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onPointerLeave={() => onHover?.(null)}
      onWheel={handleWheel}
      style={{
        background: "#0d0d0d",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
        width: "100%"
      }}
    >
      <div style={{
        display: "flex",
        gap: "6px",
        left: "10px",
        position: "absolute",
        top: "10px",
        zIndex: 5
      }}>
        {[
          ["select", "Sélection"],
          ["pan", "Déplacer"]
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMode(value);
            }}
            style={{
              background: mode === value ? "#164e63" : "#222",
              border: "1px solid #3b3b3b",
              borderRadius: "6px",
              color: "#eee",
              cursor: "pointer",
              padding: "6px 9px"
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          style={{
            background: "#222",
            border: "1px solid #3b3b3b",
            borderRadius: "6px",
            color: "#eee",
            cursor: "pointer",
            padding: "6px 9px"
          }}
        >
          Recentrer
        </button>
      </div>

      <div
        ref={contentRef}
        style={{
          height: "100%",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "50% 50%",
          width: "100%"
        }}
      />
      {box && (
        <div style={{
          background: "rgba(34, 211, 238, 0.12)",
          border: "1px solid #22d3ee",
          left: box.left,
          pointerEvents: "none",
          position: "absolute",
          top: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top
        }} />
      )}
      {loadError && (
        <div style={{
          color: "#fca5a5",
          left: "50%",
          position: "absolute",
          top: "50%",
          transform: "translate(-50%, -50%)"
        }}>
          {loadError}
        </div>
      )}
    </div>
  );
}
