import { useEffect, useRef, useState } from "react";

export default function SvgMap({
    svgPath,
    found,
    missed = [],
    dueItems = [],
    selected,
    onSelect
}) {
    const containerRef = useRef(null);
    const wrapperRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [start, setStart] = useState({ x: 0, y: 0 });

    function handleWheel(e) {
        e.preventDefault();

        const zoomFactor = 0.1;
        const newScale = Math.min(
            Math.max(0.5, scale - e.deltaY * zoomFactor * 0.01),
            5
        );

        setScale(newScale);
    }

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
        fetch(svgPath)
            .then((res) => res.text())
            .then((svg) => {
                containerRef.current.innerHTML = svg;

                console.log(svgPath);

                const svgEl = containerRef.current.querySelector("svg");
                if (!svgEl) {
                    console.error("SVG non trouvé dans le fichier:", svgPath);
                    return;
                }

                svgEl.style.width = "100%";
                svgEl.style.height = "auto";

                const getColor = (code) => {
                    if (selected === code) return "#f39c12"; // orange priorité max
                    if (found.includes(code)) return "#2ecc71"; // vert
                    if (missed.includes(code)) return "#e74c3c"; // rouge
                    if (dueItems.includes(code)) return "#f1c40f"; // jaune
                    return "#444"; // gris
                };

                // RESET + couleur initiale
                containerRef.current.querySelectorAll("path").forEach((el) => {
                    const code = el.getAttribute("data-code");

                    el.style.fill = getColor(code);
                    el.style.cursor = "pointer";

                    // CLICK
                    el.addEventListener("click", () => {
                        if (code && onSelect) {
                            onSelect(code);
                        }
                    });

                    // HOVER
                    el.addEventListener("mouseenter", () => {
                        if (!found.includes(code) && selected !== code) {
                            el.style.fill = "#888";
                        }
                    });

                    el.addEventListener("mouseleave", () => {
                        el.style.fill = getColor(code);
                    });
                });
            });
    }, [svgPath, found, missed, selected, dueItems]);

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
                height: "450px",
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
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: "0 0",
                    cursor: isDragging ? "grabbing" : "grab",
                    transition: isDragging ? "none" : "transform 0.15s ease-out"
                }}
            />
        </div>
    );
}