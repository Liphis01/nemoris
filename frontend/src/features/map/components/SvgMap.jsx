import { useEffect, useRef, useState } from "react";

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

export default function SvgMap({
    svgPath,
    found,
    missed = [],
    dueItems = [],
    unsaved = [],
    selected,
    focusCode,
    focusVersion = 0,
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
    const [svgVersion, setSvgVersion] = useState(0);

    useEffect(() => {
        // Keep the latest transform available to effects/event handlers that
        // should not close over stale scale/offset values.
        transformRef.current = { scale, offset };
    }, [scale, offset]);

    function handleMouseDown(e) {
        if (e.button !== 2) return; // clic droit uniquement

        e.preventDefault(); // empêche menu contextuel

        setIsDragging(true);
        setStart({
            x: e.clientX - offset.x,
            y: e.clientY - offset.y
        });
    }

    function handleMouseMove(e) {
        if (!isDragging) return;

        setOffset({
            x: e.clientX - start.x,
            y: e.clientY - start.y
        });
    }

    function handleMouseUp() {
        setIsDragging(false);
    }

    useEffect(() => {
        let cancelled = false;

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
        const unsavedSet = new Set(unsaved);

        const getColor = (code) => {
            if (selected === code) return "#f39c12";
            if (unsavedSet.has(code)) return "#facc15";
            if (foundSet.has(code)) return "#21eb75";
            if (missedSet.has(code)) return "#e93723";
            if (dueSet.has(code)) return "#0e3e5adc";
            return "#444";
        };

        const cleanupFns = zoneElementsRef.current.map(({ el, code }) => {
            el.style.fill = getColor(code);

            const handleClick = () => {
                if (code && onSelect) onSelect(code);
            };

            const handleEnter = () => {
                if (!foundSet.has(code) && !unsavedSet.has(code) && selected !== code) {
                    el.style.fill = "#888";
                }
            };

            const handleLeave = () => {
                el.style.fill = getColor(code);
            };

            el.addEventListener("click", handleClick);
            el.addEventListener("mouseenter", handleEnter);
            el.addEventListener("mouseleave", handleLeave);

            return () => {
                el.removeEventListener("click", handleClick);
                el.removeEventListener("mouseenter", handleEnter);
                el.removeEventListener("mouseleave", handleLeave);
            };
        });

        return () => {
            cleanupFns.forEach(fn => fn());
        };
    }, [svgVersion, found, missed, selected, dueItems, unsaved, onSelect]);

    useEffect(() => {
        if (!focusCode || !wrapperRef.current) return;

        // Center and zoom on a selected zone by translating its rendered screen
        // box back into the map's unscaled coordinate space.
        const target = zoneElementsRef.current.find(({ code }) => code === focusCode);
        if (!target?.el) return;

        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        if (!wrapperRect.width || !wrapperRect.height) return;

        const renderedBox = target.el.getBoundingClientRect();
        if (!renderedBox.width || !renderedBox.height) return;

        const currentScale = transformRef.current.scale || 1;
        const currentOffset = transformRef.current.offset || { x: 0, y: 0 };
        const box = {
            x: (renderedBox.left - wrapperRect.left - currentOffset.x) / currentScale,
            y: (renderedBox.top - wrapperRect.top - currentOffset.y) / currentScale,
            width: renderedBox.width / currentScale,
            height: renderedBox.height / currentScale
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
                15
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
            onMouseLeave={handleMouseUp}
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
        </div>
    );
}
