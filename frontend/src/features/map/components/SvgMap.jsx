import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const emptyZoneLabels = {};

function normalizeCode(code) {
    // SVG data-code attributes are the stable link between drawn zones and
    // Question.data.code values.
    return code?.trim() || "";
}

const zoneStrokeStyle = {
    color: "#111",
    width: "0.35",
    linecap: "round",
    linejoin: "round"
};

const dragThresholdPx = 4;

// Maximum wheel-zoom factor. Kept high so the tiny island hit-areas can be
// zoomed in far enough to see and click comfortably.
const maxZoom = 40;

// Island hit-area shapes always render at this opacity so they stay see-through
// (the map shows through them) while behaving like any other zone.
const hitAreaRevealOpacity = "0.35";

export default function SvgMap({
    svgPath,
    found,
    missed = [],
    dueItems = [],
    unsaved = [],
    selected,
    focusCode,
    focusVersion = 0,
    flashCodes = [],
    clickableCodes = null,
    zoneLabels = emptyZoneLabels,
    onSelect,
    onCodesLoaded
}) {
    // SvgMap injects raw SVG markup, then manages interaction by attaching
    // listeners/styles to elements that declare data-code.
    const containerRef = useRef(null);
    const wrapperRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [start, setStart] = useState({ x: 0, y: 0 });
    const zoneElementsRef = useRef([]);
    const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
    const dragStartRef = useRef(null);
    const didDragRef = useRef(false);
    const ignoreNextClickRef = useRef(false);
    const clickResetTimeoutRef = useRef(null);
    const [svgVersion, setSvgVersion] = useState(0);
    const [tooltip, setTooltip] = useState(null);
    const [hoveredCode, setHoveredCode] = useState(null);
    const clickableCodeSet = useMemo(() => {
        if (!Array.isArray(clickableCodes)) return null;

        return new Set(clickableCodes.filter(Boolean));
    }, [clickableCodes]);

    useEffect(() => {
        // Keep the latest transform available to effects/event handlers that
        // should not close over stale scale/offset values.
        transformRef.current = { scale, offset };
    }, [scale, offset]);

    function handleMouseDown(e) {
        if (e.button !== 0 && e.button !== 2) return;

        if (e.button === 2) {
            e.preventDefault(); // empêche menu contextuel
        }

        const currentOffset = transformRef.current.offset || offset;
        window.clearTimeout(clickResetTimeoutRef.current);
        ignoreNextClickRef.current = false;
        didDragRef.current = false;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
        setStart({
            x: e.clientX - currentOffset.x,
            y: e.clientY - currentOffset.y
        });
    }

    function handleMouseMove(e) {
        if (!isDragging) return;

        const dragStart = dragStartRef.current;

        if (dragStart && !didDragRef.current) {
            const distance = Math.hypot(
                e.clientX - dragStart.x,
                e.clientY - dragStart.y
            );

            if (distance < dragThresholdPx) {
                return;
            }

            didDragRef.current = true;
            hideTooltip();
        }

        setOffset({
            x: e.clientX - start.x,
            y: e.clientY - start.y
        });
    }

    function handleMouseUp() {
        if (didDragRef.current) {
            ignoreNextClickRef.current = true;
            window.clearTimeout(clickResetTimeoutRef.current);
            clickResetTimeoutRef.current = window.setTimeout(() => {
                ignoreNextClickRef.current = false;
            }, 0);
        }

        dragStartRef.current = null;
        didDragRef.current = false;
        setIsDragging(false);
    }

    const hideTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    const showTooltip = useCallback((event, label) => {
        if (!label || !wrapperRef.current) {
            hideTooltip();
            return;
        }

        const rect = wrapperRef.current.getBoundingClientRect();
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        const x = Math.min(Math.max(rawX, 28), Math.max(rect.width - 28, 28));
        const showBelow = rawY < 54;

        setTooltip({
            label,
            x,
            y: showBelow ? rawY + 14 : rawY - 14,
            placement: showBelow ? "below" : "above"
        });
    }, [hideTooltip]);

    useEffect(() => () => {
        window.clearTimeout(clickResetTimeoutRef.current);
    }, []);

    useEffect(() => {
        let cancelled = false;

        setTooltip(null);
        setHoveredCode(null);

        // Vite serves map SVGs from public/maps. After loading, discover every
        // data-code zone so editors can know which SVG regions are assignable.
        fetch(svgPath)
            .then((res) => res.text())
            .then((svg) => {
                if (cancelled || !containerRef.current) return;

                containerRef.current.innerHTML = svg;

                const svgEl = containerRef.current.querySelector("svg");
                if (!svgEl) return;

                svgEl.style.width = "100%";
                svgEl.style.height = "100%";
                svgEl.style.display = "block";

                const mapCodes = new Set();
                const zoneElements = [];

                containerRef.current.querySelectorAll("[data-code]").forEach((el) => {
                    const code = normalizeCode(el.getAttribute("data-code"));
                    if (code) mapCodes.add(code);

                    el.style.cursor = "pointer";
                    el.style.stroke = zoneStrokeStyle.color;
                    el.style.strokeWidth = zoneStrokeStyle.width;
                    el.style.strokeLinecap = zoneStrokeStyle.linecap;
                    el.style.strokeLinejoin = zoneStrokeStyle.linejoin;
                    zoneElements.push({ el, code });
                });

                zoneElementsRef.current = zoneElements;
                setSvgVersion(version => version + 1);

                if (onCodesLoaded) {
                    onCodesLoaded([...mapCodes]);
                }
            });

        return () => {
            cancelled = true;
            zoneElementsRef.current = [];
        };
    }, [svgPath, onCodesLoaded]);

    useEffect(() => {
        // Apply semantic colors to the imported SVG without modifying the SVG
        // file itself.
        const foundSet = new Set(found);
        const missedSet = new Set(missed);
        const dueSet = new Set(dueItems);
        const flashSet = new Set(flashCodes);
        const unsavedSet = new Set(unsaved);

        const getColor = (code) => {
            if (flashSet.has(code)) return "#fb7185";
            if (selected === code) return "#f39c12";
            if (unsavedSet.has(code)) return "#facc15";
            if (foundSet.has(code)) return "#21eb75";
            if (missedSet.has(code)) return "#e93723";
            if (dueSet.has(code)) return "#0e3e5adc";
            return "#444";
        };

        const getHoverColor = (code) => {
            if (flashSet.has(code)) return "#fecdd3";
            if (selected === code) return "#fbbf24";
            if (unsavedSet.has(code)) return "#fde047";
            if (foundSet.has(code)) return "#34d399";
            if (missedSet.has(code)) return "#fb7185";
            if (dueSet.has(code)) return "#38bdf8";
            return "#888";
        };

        const canSelectCode = (code) => (
            !clickableCodeSet || clickableCodeSet.has(code)
        );

        const getDisplayColor = (code) => (
            hoveredCode === code
                ? getHoverColor(code)
                : getColor(code)
        );

        const cleanupFns = zoneElementsRef.current.map(({ el, code }) => {
            const isClickable = canSelectCode(code);
            // Hit-area shapes cover islands too small to draw. They behave like any
            // other zone (same neutral/state colors, always visible and clickable)
            // but stay permanently translucent, reading as a see-through overlay so
            // the underlying map still shows through.
            const isHitArea = el.getAttribute("data-hit-area") === "1";

            el.style.fill = getDisplayColor(code);
            el.style.cursor = "pointer";
            if (isHitArea) el.style.opacity = hitAreaRevealOpacity;
            const tooltipLabel = String(zoneLabels[code] || "");
            const flashAnimation = flashSet.has(code) && typeof el.animate === "function"
                ? el.animate(
                    [
                        { fill: "#fb7185" },
                        { fill: "#fecdd3" },
                        { fill: "#fb7185" }
                    ],
                    {
                        duration: 360,
                        iterations: 2
                    }
                )
                : null;

            const handleClick = (event) => {
                if (ignoreNextClickRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreNextClickRef.current = false;
                    return;
                }

                if (!isClickable) {
                    event.preventDefault();
                    return;
                }

                if (code && onSelect) onSelect(code);
            };

            const handleEnter = (event) => {
                setHoveredCode(code);
                el.style.fill = getHoverColor(code);

                if (tooltipLabel) {
                    showTooltip(event, tooltipLabel);
                }
            };

            const handleMove = (event) => {
                if (tooltipLabel) {
                    showTooltip(event, tooltipLabel);
                }
            };

            const handleLeave = () => {
                setHoveredCode(currentCode => currentCode === code ? null : currentCode);
                el.style.fill = getColor(code);
                hideTooltip();
            };

            el.addEventListener("click", handleClick);
            el.addEventListener("mouseenter", handleEnter);
            el.addEventListener("mousemove", handleMove);
            el.addEventListener("mouseleave", handleLeave);

            return () => {
                flashAnimation?.cancel();
                el.removeEventListener("click", handleClick);
                el.removeEventListener("mouseenter", handleEnter);
                el.removeEventListener("mousemove", handleMove);
                el.removeEventListener("mouseleave", handleLeave);
            };
        });

        return () => {
            cleanupFns.forEach(fn => fn());
        };
    }, [
        svgVersion,
        found,
        missed,
        flashCodes,
        selected,
        dueItems,
        unsaved,
        clickableCodeSet,
        hoveredCode,
        zoneLabels,
        onSelect,
        showTooltip,
        hideTooltip
    ]);

    useEffect(() => {
        if (!focusCode || !wrapperRef.current) return;

        // Find ALL elements with this code (large zones like Argentina, Australia have multiple paths)
        const allTargets = zoneElementsRef.current.filter(({ code }) => code === focusCode);
        if (allTargets.length === 0) return;

        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        if (!wrapperRect.width || !wrapperRect.height) return;

        // Calculate combined bounding box of all paths for this zone
        let minLeft = Infinity;
        let minTop = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;

        for (const target of allTargets) {
            const renderedBox = target.el.getBoundingClientRect();
            if (renderedBox.width > 0 && renderedBox.height > 0) {
                minLeft = Math.min(minLeft, renderedBox.left);
                minTop = Math.min(minTop, renderedBox.top);
                maxRight = Math.max(maxRight, renderedBox.right);
                maxBottom = Math.max(maxBottom, renderedBox.bottom);
            }
        }

        if (!isFinite(minLeft) || !isFinite(minTop)) return;

        // Read the transform actually rendered right now rather than the React
        // state target in transformRef. When the focus advances, this effect runs
        // twice (focusCode prop change, then focusVersion bump) while the
        // container is still mid CSS transition toward the previous target, so the
        // state target no longer matches the measured getBoundingClientRect. The
        // live computed matrix stays consistent with the measured rect, keeping
        // the back-projection (and therefore the new scale/offset) correct.
        const liveMatrix = containerRef.current
            ? new DOMMatrixReadOnly(getComputedStyle(containerRef.current).transform)
            : null;
        const currentScale = (liveMatrix?.a) || transformRef.current.scale || 1;
        const currentOffset = liveMatrix
            ? { x: liveMatrix.e, y: liveMatrix.f }
            : (transformRef.current.offset || { x: 0, y: 0 });
        const box = {
            x: (minLeft - wrapperRect.left - currentOffset.x) / currentScale,
            y: (minTop - wrapperRect.top - currentOffset.y) / currentScale,
            width: (maxRight - minLeft) / currentScale,
            height: (maxBottom - minTop) / currentScale
        };

        const padding = 0.48;
        const fitScale = Math.min(
            wrapperRect.width / box.width,
            wrapperRect.height / box.height
        ) * padding;
        const newScale = Math.min(Math.max(fitScale, 1), 8);

        setScale(newScale);
        setOffset({
            x: (wrapperRect.width / 2) - (box.x + box.width / 2) * newScale,
            y: (wrapperRect.height / 2) - (box.y + box.height / 2) * newScale
        });
    }, [focusCode, focusVersion, svgVersion]);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;

        function wheelHandler(e) {
            e.preventDefault();

            const rect = el.getBoundingClientRect();

            // Mouse position relative to the untransformed wrapper.
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // World coordinate under the cursor before applying the new scale.
            const worldX = (mouseX - offset.x) / scale;
            const worldY = (mouseY - offset.y) / scale;

            const zoomIntensity = 0.0015;
            const newScale = Math.min(
                Math.max(1, scale * (1 - e.deltaY * zoomIntensity)),
                maxZoom
            );

            const newOffset = {
                x: mouseX - worldX * newScale,
                y: mouseY - worldY * newScale
            };

            setScale(newScale);
            setOffset(newOffset);
        }

        el.addEventListener("wheel", wheelHandler, { passive: false });

        return () => {
            el.removeEventListener("wheel", wheelHandler);
        };
    }, [scale, offset]);

    return (
        <div
            ref={wrapperRef}
            style={{
                width: "100%",
                height: "100%",
                overflow: "hidden",
                position: "relative",
                userSelect: "none"
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
                handleMouseUp();
                hideTooltip();
            }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div
                ref={containerRef}
                style={{
                    width: "100%",
                    height: "100%",
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: "0 0",
                    cursor: isDragging ? "grabbing" : "grab",
                    transition: isDragging ? "none" : "transform 0.15s ease-out"
                }}
            />
            {tooltip && (
                <div
                    style={{
                        ...mapTooltipStyle,
                        left: `${tooltip.x}px`,
                        top: `${tooltip.y}px`,
                        transform: tooltip.placement === "below"
                            ? "translate(-50%, 0)"
                            : "translate(-50%, -100%)"
                    }}
                >
                    {tooltip.label}
                </div>
            )}
        </div>
    );
}

const mapTooltipStyle = {
    position: "absolute",
    zIndex: 5,
    maxWidth: "220px",
    padding: "7px 10px",
    borderRadius: "999px",
    border: "1px solid rgba(126, 226, 168, 0.4)",
    background: "rgba(14, 18, 16, 0.92)",
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.36)",
    color: "#ecfdf5",
    fontSize: "12px",
    fontWeight: "700",
    lineHeight: "16px",
    overflow: "hidden",
    pointerEvents: "none",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
};
