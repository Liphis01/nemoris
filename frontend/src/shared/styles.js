export const fadeInStyle = {
    animation: "fadeIn 0.3s ease"
};

// Subtle diagonal hatch behind object-fit:contain media, distinguishable from
// any solid-color image content (e.g. a flag with a black stripe at the edge)
// so letterboxed padding never blends into the picture itself.
export const letterboxPatternBg = [
    "repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0 3px, rgba(255, 255, 255, 0) 3px 6px)",
    "#0d0d0d"
].join(", ");

export const buttonBase = {
    transition: "all 0.15s ease",
    cursor: "pointer",
};