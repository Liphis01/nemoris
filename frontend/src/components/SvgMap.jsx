import { useEffect, useRef, useState } from "react";

function normalizeCode(code) {
    return code?.trim() || "";
}

export default function SvgMap({
    svgPath,
    found,
    missed = [],
    dueItems = [],
    selected,
    onSelect,
    onCodesLoaded
}) {
    const containerRef = useRef(null);
    const wrapperRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [start, setStart] = useState({ x: 0, y: 0 });
    const zoneElementsRef = useRef([]);
    const [svgVersion, setSvgVersion] = useState(0);

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
        const foundSet = new Set(found);
        const missedSet = new Set(missed);
        const dueSet = new Set(dueItems);

        const getColor = (code) => {
            if (selected === code) return "#f39c12";
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
                if (!foundSet.has(code) && selected !== code) {
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
    }, [svgVersion, found, missed, selected, dueItems, onSelect]);

    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;

        function wheelHandler(e) {
            e.preventDefault();

            const rect = el.getBoundingClientRect();

            // position souris RELATIVE AU WRAPPER (non transformé)
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // coordonnées monde
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
