import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapZoneGeometry } from "./mapGeometry";

const emptyZoneLabels = {};

function normalizeCode(code) {
    // SVG data-code attributes are the stable link between drawn zones and
    // Question.data.code values.
    return code?.trim() || "";
}

function setSvgStyle(element, property, value) {
    if (element.style) {
        element.style[property] = value;
        return;
    }

    // XML nodes imported by jsdom do not receive SVGElement.style, while real
    // browsers do. Attribute fallback keeps the DOMParser/importNode path
    // testable without reverting to HTML-string insertion.
    const cssName = property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
    const declarations = new Map(
        String(element.getAttribute("style") || "")
            .split(";")
            .map(part => part.split(":"))
            .filter(parts => parts.length >= 2)
            .map(([name, ...rest]) => [name.trim(), rest.join(":").trim()])
    );
    declarations.set(cssName, value);
    element.setAttribute(
        "style",
        [...declarations].map(([name, cssValue]) => `${name}: ${cssValue}`).join("; ")
    );
}

function adoptSvgNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.nodeValue || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    // Recreate imported XML elements in the live document's SVG namespace.
    // This makes them full SVGElement instances in jsdom as well as browsers.
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

const zoneStrokeStyle = {
    color: "#111",
    width: "0.35",
    linecap: "round",
    linejoin: "round"
};

const dragThresholdPx = 4;

// Maximum wheel-zoom factor. Kept high so the tiny island hit-areas can be
// zoomed in far enough to see and click comfortably.
const maxZoom = 80;
const keyboardZoomFactor = 1.25;

// Exponent applied to the auto-zoom fit (see fitFocusedZone). Below 1 it pulls
// deep fits back out, and the deeper the fit the more it pulls.
const autoZoomFalloff = 0.75;

// Baseline island hit-area opacity; unresolved due hit areas get a stronger
// overlay below so tiny cyan shapes do not disappear into grey map detail.
const hitAreaRevealOpacity = "0.35";
const hitAreaDueOpacity = "0.55";
const hitAreaDueColor = "#22d3ee";
const hitAreaDueHoverColor = "#7dd3fc";

export default function SvgMap({
    svgPath,
    mapManifest = null,
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
    zoomDirection = 0,
    zoomVersion = 0,
    onSelect,
    onCodesLoaded,
    onGeometryLoaded
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
    const [loadError, setLoadError] = useState("");
    // Set while applying a transform that must not animate (a resize-driven re-fit).
    const [instantTransform, setInstantTransform] = useState(false);
    // True once the user pans/zooms by hand, so a resize re-fit leaves their view alone.
    const userAdjustedRef = useRef(false);
    // Size of the wrapper the last fit was computed against.
    const lastFitSizeRef = useRef(null);
    const clickableCodeSet = useMemo(() => {
        if (!Array.isArray(clickableCodes)) return null;

        return new Set(clickableCodes.filter(Boolean));
    }, [clickableCodes]);

    useEffect(() => {
        // Keep the latest transform available to effects/event handlers that
        // should not close over stale scale/offset values.
        transformRef.current = { scale, offset };
    }, [scale, offset]);

    const hideTooltip = useCallback(() => {
        setTooltip(null);
    }, []);

    const zoomAtPoint = useCallback((point, factor) => {
        const wrapper = wrapperRef.current;
        if (!wrapper || !Number.isFinite(factor) || factor === 0) return;

        const currentTransform = transformRef.current || {};
        const currentScale = currentTransform.scale || 1;
        const currentOffset = currentTransform.offset || { x: 0, y: 0 };
        const nextScale = Math.min(Math.max(1, currentScale * factor), maxZoom);
        const worldX = (point.x - currentOffset.x) / currentScale;
        const worldY = (point.y - currentOffset.y) / currentScale;

        userAdjustedRef.current = true;
        hideTooltip();
        setScale(nextScale);
        setOffset({
            x: point.x - worldX * nextScale,
            y: point.y - worldY * nextScale
        });
    }, [hideTooltip]);

    const zoomAtCenter = useCallback((direction) => {
        const wrapper = wrapperRef.current;
        if (!wrapper || direction === 0) return;

        const rect = wrapper.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        zoomAtPoint({
            x: rect.width / 2,
            y: rect.height / 2
        }, direction > 0 ? keyboardZoomFactor : 1 / keyboardZoomFactor);
    }, [zoomAtPoint]);

    useEffect(() => {
        if (!zoomVersion || !zoomDirection) return;

        zoomAtCenter(zoomDirection);
    }, [zoomAtCenter, zoomDirection, zoomVersion]);

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
            userAdjustedRef.current = true;
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
        setLoadError("");

        const isV2 = mapManifest?.schema_version === 2;
        const sourceUrl = new URL(svgPath, window.location.href);
        const isBackendOwnedLegacy = (
            sourceUrl.origin === window.location.origin
            || ["localhost", "127.0.0.1"].includes(sourceUrl.hostname)
        );

        if (!isV2 && !isBackendOwnedLegacy) {
            setLoadError("Cette carte externe doit être mise à niveau avant utilisation.");
            onCodesLoaded?.([]);
            onGeometryLoaded?.({ diagonal: 0, zones: {} });
            return undefined;
        }

        fetch(svgPath)
            .then((res) => {
                if (res.ok === false) {
                    throw new Error("Map SVG could not be loaded");
                }
                return res.text();
            })
            .then((svg) => {
                if (cancelled || !containerRef.current) return;

                const parsed = new DOMParser().parseFromString(
                    svg, "image/svg+xml"
                );
                const parsedRoot = parsed.documentElement;
                if (
                    parsed.querySelector("parsererror")
                    || parsedRoot?.localName?.toLowerCase() !== "svg"
                    || (
                        parsedRoot.namespaceURI
                        && parsedRoot.namespaceURI !== "http://www.w3.org/2000/svg"
                    )
                ) {
                    throw new Error("Map response is not a valid SVG");
                }
                const importedRoot = document.importNode(parsedRoot, true);
                const svgEl = adoptSvgNode(importedRoot);
                containerRef.current.replaceChildren(svgEl);

                setSvgStyle(svgEl, "width", "100%");
                setSvgStyle(svgEl, "height", "100%");
                setSvgStyle(svgEl, "display", "block");

                const zoneElements = [];
                let mapCodes = [];

                if (isV2) {
                    const shapesById = new Map();
                    containerRef.current
                        .querySelectorAll("[data-nemoris-shape]")
                        .forEach((el) => {
                            const shapeId = el.getAttribute("data-nemoris-shape");
                            if (shapeId && !shapesById.has(shapeId)) {
                                shapesById.set(shapeId, el);
                            }
                        });
                    const seenShapes = new Set();
                    let invalidManifest = false;
                    mapCodes = (mapManifest.zones || []).map(zone => {
                        const code = normalizeCode(zone.code);
                        [
                            ...(zone.shape_ids || []).map(id => [id, false]),
                            ...(zone.hit_shape_ids || []).map(id => [id, true])
                        ].forEach(([shapeId, isHitArea]) => {
                            const el = shapesById.get(shapeId);
                            if (!el || seenShapes.has(shapeId) || !code) {
                                invalidManifest = true;
                                return;
                            }
                            seenShapes.add(shapeId);
                            zoneElements.push({ el, code, isHitArea });
                        });
                        return code;
                    }).filter(Boolean);

                    if (invalidManifest) {
                        containerRef.current.replaceChildren();
                        throw new Error("Map manifest does not match its SVG");
                    }
                } else {
                    const seenCodes = new Set();
                    containerRef.current
                        .querySelectorAll("[data-code]")
                        .forEach((el) => {
                            const code = normalizeCode(el.getAttribute("data-code"));
                            if (code && !seenCodes.has(code)) {
                                seenCodes.add(code);
                                mapCodes.push(code);
                            }
                            zoneElements.push({
                                el,
                                code,
                                isHitArea: el.getAttribute("data-hit-area") === "1"
                            });
                        });
                }

                zoneElements.forEach(({ el }) => {
                    setSvgStyle(el, "cursor", "pointer");
                    setSvgStyle(el, "stroke", zoneStrokeStyle.color);
                    setSvgStyle(el, "strokeWidth", zoneStrokeStyle.width);
                    setSvgStyle(el, "strokeLinecap", zoneStrokeStyle.linecap);
                    setSvgStyle(el, "strokeLinejoin", zoneStrokeStyle.linejoin);
                });

                zoneElementsRef.current = zoneElements;
                setSvgVersion(version => version + 1);

                if (onCodesLoaded) {
                    onCodesLoaded(mapCodes);
                }
                onGeometryLoaded?.(mapZoneGeometry(zoneElements, svgEl));
            })
            .catch((error) => {
                if (cancelled) return;
                zoneElementsRef.current = [];
                containerRef.current?.replaceChildren();
                setLoadError(error.message || "Impossible de charger la carte.");
                onCodesLoaded?.([]);
                onGeometryLoaded?.({ diagonal: 0, zones: {} });
            });

        return () => {
            cancelled = true;
            zoneElementsRef.current = [];
        };
    }, [svgPath, mapManifest, onCodesLoaded, onGeometryLoaded]);

    useEffect(() => {
        // Apply semantic colors to the imported SVG without modifying the SVG
        // file itself.
        const foundSet = new Set(found);
        const missedSet = new Set(missed);
        const dueSet = new Set(dueItems);
        const flashSet = new Set(flashCodes);
        const unsavedSet = new Set(unsaved);

        const getColor = (code, isHitArea = false) => {
            if (flashSet.has(code)) return "#fb7185";
            if (selected === code) return "#f39c12";
            if (unsavedSet.has(code)) return "#facc15";
            if (foundSet.has(code)) return "#21eb75";
            if (missedSet.has(code)) return "#e93723";
            if (isHitArea && dueSet.has(code)) return hitAreaDueColor;
            if (dueSet.has(code)) return "#0e3e5adc";
            return "#444";
        };

        const getHoverColor = (code, isHitArea = false) => {
            if (flashSet.has(code)) return "#fecdd3";
            if (selected === code) return "#fbbf24";
            if (unsavedSet.has(code)) return "#fde047";
            if (foundSet.has(code)) return "#34d399";
            if (missedSet.has(code)) return "#fb7185";
            if (isHitArea && dueSet.has(code)) return hitAreaDueHoverColor;
            if (dueSet.has(code)) return "#38bdf8";
            return "#888";
        };

        const getHitAreaOpacity = (code) => (
            dueSet.has(code)
            && !flashSet.has(code)
            && selected !== code
            && !unsavedSet.has(code)
            && !foundSet.has(code)
            && !missedSet.has(code)
                ? hitAreaDueOpacity
                : hitAreaRevealOpacity
        );

        const canSelectCode = (code) => (
            !clickableCodeSet || clickableCodeSet.has(code)
        );

        const cleanupFns = zoneElementsRef.current.map(({ el, code, isHitArea }) => {
            const isClickable = canSelectCode(code);
            // Hit-area shapes cover islands too small to draw. They behave like any
            // other zone but use a brighter unresolved-due blue than country paths:
            // at fixed translucency, the normal dark blue reads too close to grey.
            const displayColor = hoveredCode === code
                ? getHoverColor(code, isHitArea)
                : getColor(code, isHitArea);
            setSvgStyle(el, "fill", displayColor);
            setSvgStyle(el, "cursor", "pointer");
            if (isHitArea) setSvgStyle(el, "opacity", getHitAreaOpacity(code));
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
                setSvgStyle(el, "fill", getHoverColor(code, isHitArea));

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
                setSvgStyle(el, "fill", getColor(code, isHitArea));
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

    const fitFocusedZone = useCallback(({ instant = false } = {}) => {
        if (!focusCode || !wrapperRef.current) return;

        // Find ALL elements with this code (large zones like Argentina, Australia have multiple paths)
        const allTargets = zoneElementsRef.current.filter(({ code }) => code === focusCode);
        if (allTargets.length === 0) return;

        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        if (!wrapperRect.width || !wrapperRect.height) return;

        // Remember the box this fit was computed against, so a resize observed
        // afterwards can tell whether the box actually changed under it.
        lastFitSizeRef.current = {
            width: wrapperRect.width,
            height: wrapperRect.height
        };

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
        // A raw fit frames every zone at the same on-screen size, so a small
        // country gets magnified as hard as a continent and loses the
        // surrounding coastlines that make it recognisable. Softening the fit
        // sub-linearly leaves shallow fits (large zones) almost untouched while
        // pulling deep ones back out, so the smaller the zone the more of the
        // fit it gives up. Still capped at maxZoom for the tiniest islands.
        const softenedScale = fitScale > 1
            ? fitScale ** autoZoomFalloff
            : fitScale;
        const newScale = Math.min(Math.max(softenedScale, 1), maxZoom);

        // A re-fit forced by the wrapper changing size must land instantly: the
        // zone was already framed, so animating it would read as a spurious
        // zoom (and the transform transition visibly blurs while it runs).
        if (instant) setInstantTransform(true);

        setScale(newScale);
        setOffset({
            x: (wrapperRect.width / 2) - (box.x + box.width / 2) * newScale,
            y: (wrapperRect.height / 2) - (box.y + box.height / 2) * newScale
        });
    }, [focusCode]);

    useEffect(() => {
        // A programmatic focus supersedes whatever the user had panned/zoomed to.
        userAdjustedRef.current = false;
        fitFocusedZone();
    }, [fitFocusedZone, focusVersion, svgVersion]);

    useEffect(() => {
        const wrapper = wrapperRef.current;

        if (!wrapper || typeof ResizeObserver === "undefined") return undefined;

        // The map box is a flex child, so panels appearing beside it (the review
        // quality bar, the manage zone editor, an alias chip wrapping to a new
        // line) silently resize it. Nothing re-fits on resize, so the zone keeps
        // its old scale and just gets cropped. Re-fit it to the new box instead.
        const observer = new ResizeObserver(() => {
            // Never clobber a pan/zoom the user performed themselves.
            if (userAdjustedRef.current) return;

            const rect = wrapperRef.current?.getBoundingClientRect();
            const lastFit = lastFitSizeRef.current;

            if (!rect || !rect.width || !rect.height) return;

            // Only act when the box changed size *after* the last fit. A fit that
            // already measured this box (e.g. focusing a zone in the same commit
            // that opens the editor panel) is left to animate normally.
            if (
                lastFit &&
                Math.abs(lastFit.width - rect.width) < 1 &&
                Math.abs(lastFit.height - rect.height) < 1
            ) {
                return;
            }

            fitFocusedZone({ instant: true });
        });

        observer.observe(wrapper);

        return () => observer.disconnect();
    }, [fitFocusedZone]);

    useEffect(() => {
        if (!instantTransform) return undefined;

        // Restore the transition once the instant transform has been painted.
        const frame = window.requestAnimationFrame(() => setInstantTransform(false));

        return () => window.cancelAnimationFrame(frame);
    }, [instantTransform, offset, scale]);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;

        function wheelHandler(e) {
            e.preventDefault();

            const rect = el.getBoundingClientRect();

            // Mouse position relative to the untransformed wrapper.
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomIntensity = 0.0015;
            zoomAtPoint(
                { x: mouseX, y: mouseY },
                1 - e.deltaY * zoomIntensity
            );
        }

        el.addEventListener("wheel", wheelHandler, { passive: false });

        return () => {
            el.removeEventListener("wheel", wheelHandler);
        };
    }, [zoomAtPoint]);

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
                    transition: isDragging || instantTransform
                        ? "none"
                        : "transform 0.15s ease-out"
                }}
            />
            {loadError && (
                <div
                    role="status"
                    style={{
                        color: "#fca5a5",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        padding: "24px",
                        position: "absolute",
                        textAlign: "center"
                    }}
                >
                    {loadError}
                </div>
            )}
            {tooltip && (
                <div
                    data-map-tooltip
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
