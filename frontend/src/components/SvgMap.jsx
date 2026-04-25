import { useEffect, useRef } from "react";

export default function SvgMap({ svgPath, found, onSelect }) {
    const containerRef = useRef(null);

    useEffect(() => {
        fetch(svgPath)
            .then((res) => res.text())
            .then((svg) => {
                containerRef.current.innerHTML = svg;

                const svgEl = containerRef.current.querySelector("svg");
                if (!svgEl) {
                    console.error("SVG non trouvé dans le fichier:", svgPath);
                    return;
                }

                svgEl.style.width = "100%";
                svgEl.style.height = "auto";

                // RESET couleurs
                containerRef.current.querySelectorAll("path").forEach((el) => {
                    el.style.fill = "#444";
                    el.style.cursor = "pointer";
                });

                // colorer les éléments trouvés
                found.forEach((code) => {
                    const elements =
                        containerRef.current.querySelectorAll(
                            `[data-code="${code}"]`
                        );

                    elements.forEach((el) => {
                        el.style.fill = "#2ecc71";
                    });
                });

                // 🖱️ CLICK HANDLER
                containerRef.current.querySelectorAll("path").forEach((el) => {
                    el.addEventListener("click", () => {
                        const code = el.getAttribute("data-code");
                        if (code) {
                            onSelect(code);
                        }
                    });

                    el.addEventListener("mouseenter", () => {
                        if (!found.includes(el.id)) {
                            el.style.fill = "#888";
                        }
                    });

                    el.addEventListener("mouseleave", () => {
                        if (!found.includes(el.id)) {
                            el.style.fill = "#444";
                        }
                    });
                });

            });
    }, [svgPath, found]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                maxWidth: "800px",
                margin: "0 auto"
            }}
        />
    );
}