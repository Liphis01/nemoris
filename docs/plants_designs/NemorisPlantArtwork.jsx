import React, { useMemo } from "react";

const STAGES = [0, 1, 3, 7, 14, 30, 60, 100];

const DEFAULT_STAGE_SHIELDS = {
  0: 0,
  1: 0,
  3: 0,
  7: 1,
  14: 1,
  30: 2,
  60: 2,
  100: 3,
};

const SHIELD_SLOTS = {
  7: [
    { x: 318, y: 292, scale: 0.48, rotate: -32, flip: false },
  ],
  14: [
    { x: 318, y: 272, scale: 0.52, rotate: -30, flip: false },
    { x: 206, y: 326, scale: 0.48, rotate: 150, flip: true },
  ],
  30: [
    { x: 326, y: 286, scale: 0.54, rotate: -28, flip: false },
    { x: 204, y: 328, scale: 0.5, rotate: 150, flip: true },
  ],
  60: [
    { x: 335, y: 274, scale: 0.56, rotate: -28, flip: false },
    { x: 198, y: 322, scale: 0.52, rotate: 150, flip: true },
    { x: 314, y: 376, scale: 0.42, rotate: -18, flip: false },
  ],
  100: [
    { x: 338, y: 268, scale: 0.56, rotate: -28, flip: false },
    { x: 192, y: 318, scale: 0.52, rotate: 150, flip: true },
    { x: 310, y: 382, scale: 0.44, rotate: -18, flip: false },
  ],
};

function clampStage(stage) {
  const n = typeof stage === "number" ? stage : Number(stage);
  if (!Number.isFinite(n)) return 0;
  if (n >= 100) return 100;
  return STAGES.reduce((best, current) => (n >= current ? current : best), 0);
}

function uniqueId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function Defs({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-stem`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--nemoris-stem-light, #0d6a63)" />
        <stop offset="100%" stopColor="var(--nemoris-stem, #06443f)" />
      </linearGradient>

      <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--nemoris-leaf-light, #6aa98b)" />
        <stop offset="55%" stopColor="var(--nemoris-leaf, #2f806f)" />
        <stop offset="100%" stopColor="var(--nemoris-leaf-dark, #0b544e)" />
      </linearGradient>

      <linearGradient id={`${id}-leaf-vein`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--nemoris-leaf-vein, #9cc99d)" stopOpacity="0.35" />
        <stop offset="100%" stopColor="var(--nemoris-leaf-vein, #c8df9a)" stopOpacity="0.72" />
      </linearGradient>

      <linearGradient id={`${id}-soil`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--nemoris-soil-light, #7a4824)" />
        <stop offset="100%" stopColor="var(--nemoris-soil, #4b2a18)" />
      </linearGradient>

      <linearGradient id={`${id}-petal`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--nemoris-petal-light, #ff9b72)" />
        <stop offset="50%" stopColor="var(--nemoris-petal, #ff626b)" />
        <stop offset="100%" stopColor="var(--nemoris-petal-dark, #d93463)" />
      </linearGradient>

      <linearGradient id={`${id}-petal-warm`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--nemoris-petal-warm, #ffc45d)" />
        <stop offset="100%" stopColor="var(--nemoris-petal-light, #ff8e71)" />
      </linearGradient>

      <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="var(--nemoris-glow, #ffc95a)" stopOpacity="0.4" />
        <stop offset="70%" stopColor="var(--nemoris-glow, #ffc95a)" stopOpacity="0.1" />
        <stop offset="100%" stopColor="var(--nemoris-glow, #ffc95a)" stopOpacity="0" />
      </radialGradient>

      <filter id={`${id}-soft-glow`} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function Soil({ id, compact = false }) {
  const y = compact ? 440 : 438;
  return (
    <g className="soil" data-part="soil">
      <path
        d={`M148 ${y} C178 ${y - 24} 216 ${y - 18} 240 ${y - 25} C278 ${y - 36} 303 ${y - 18} 330 ${y - 23} C363 ${y - 28} 392 ${y - 10} 414 ${y} C358 ${y + 11} 214 ${y + 13} 148 ${y}Z`}
        fill={`url(#${id}-soil)`}
      />
      <ellipse cx="202" cy={y - 4} rx="8" ry="4" fill="#8a5630" opacity="0.75" />
      <ellipse cx="248" cy={y + 2} rx="7" ry="4" fill="#926035" opacity="0.7" />
      <ellipse cx="309" cy={y - 7} rx="6" ry="3.5" fill="#8f5a31" opacity="0.7" />
      <ellipse cx="365" cy={y - 2} rx="5" ry="3" fill="#97623a" opacity="0.65" />
    </g>
  );
}

function DormantSeed({ id }) {
  return (
    <g className="buds dormant-seed" data-part="buds">
      <g transform="translate(258 418) rotate(9)">
        <path
          d="M0 22 C-14 4 -8 -21 13 -35 C28 -19 27 9 0 22Z"
          fill={`url(#${id}-petal)`}
        />
        <path
          d="M6 16 C-1 0 4 -16 15 -28"
          fill="none"
          stroke="#ffb694"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path d="M13 -34 C20 -29 22 -21 19 -14" fill="none" stroke="#ffd66c" strokeWidth="4" strokeLinecap="round" />
      </g>
    </g>
  );
}

function StemPath({ id, stage }) {
  const paths = {
    1: "M256 433 C254 405 253 378 257 356",
    3: "M256 433 C254 392 255 338 263 292",
    7: "M256 433 C253 376 254 292 259 224",
    14: "M256 433 C250 355 259 250 265 162",
    30: "M256 433 C252 354 270 242 264 126",
    60: "M256 433 C249 348 269 226 264 106",
    100: "M256 433 C248 344 270 212 263 88",
  };

  return (
    <g className="stem" data-part="stem">
      <path
        d={paths[stage]}
        fill="none"
        stroke={`url(#${id}-stem)`}
        strokeWidth={stage <= 3 ? 9 : stage <= 7 ? 11 : 14}
        strokeLinecap="round"
      />
    </g>
  );
}

function Branch({ id, d, width = 7 }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={`url(#${id}-stem)`}
      strokeWidth={width}
      strokeLinecap="round"
      className="branch-stem"
    />
  );
}

function Leaf({ id, x, y, scale = 1, rotate = 0, flip = false, className = "", opacity = 1 }) {
  const sx = flip ? -scale : scale;

  return (
    <g
      className={`leaf ${className}`.trim()}
      transform={`translate(${x} ${y}) rotate(${rotate}) scale(${sx} ${scale})`}
      opacity={opacity}
      style={{ transformBox: "fill-box", transformOrigin: "0px 0px" }}
    >
      <path
        d="M0 0 C25 -28 65 -35 96 -6 C70 22 29 29 0 0Z"
        fill={`url(#${id}-leaf)`}
      />
      <path
        d="M7 -1 C31 -5 56 -7 88 -5"
        fill="none"
        stroke={`url(#${id}-leaf-vein)`}
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path
        d="M18 -8 C35 -24 61 -27 82 -13"
        fill="#9fc899"
        opacity="0.13"
      />
    </g>
  );
}

function Node({ x, y, r = 8 }) {
  return (
    <g className="bud-node">
      <circle cx={x} cy={y} r={r} fill="#68a18b" opacity="0.94" />
      <circle cx={x - r / 3} cy={y - r / 3} r={r / 2.7} fill="#9bc6a7" opacity="0.35" />
    </g>
  );
}

function ClosedBud({ id, x, y, scale = 1, rotate = 0, className = "" }) {
  return (
    <g className={`bud closed-bud ${className}`.trim()} transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <path d="M-18 22 C-34 -3 -19 -34 0 -52 C19 -34 34 -3 18 22Z" fill={`url(#${id}-petal)`} />
      <path d="M-4 -48 C11 -28 18 -5 11 18 C3 6 0 -21 -4 -48Z" fill={`url(#${id}-petal-warm)`} opacity="0.55" />
      <path d="M-12 20 C-20 0 -14 -26 -2 -44" fill="none" stroke="#ffb99c" strokeWidth="4" strokeLinecap="round" opacity="0.45" />
      <path d="M-24 22 C-12 13 -4 11 0 24 C4 11 13 13 24 22 C15 36 -15 36 -24 22Z" fill="#075149" />
    </g>
  );
}

function SideBud({ id, x, y, scale = 1, rotate = 0 }) {
  return (
    <g className="bud side-bud" transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <path d="M-14 16 C-25 -1 -13 -24 3 -35 C17 -20 22 4 10 18Z" fill={`url(#${id}-petal)`} />
      <path d="M2 -31 C12 -17 14 0 8 15" fill={`url(#${id}-petal-warm)`} opacity="0.48" />
      <path d="M-19 18 C-9 10 -3 9 1 20 C6 9 13 10 19 18 C9 28 -9 28 -19 18Z" fill="#075149" />
    </g>
  );
}

function Petal({ id, rotate, scaleY = 1, scaleX = 1, distance = 0, fill, opacity = 1 }) {
  return (
    <g transform={`rotate(${rotate}) translate(0 ${-distance}) scale(${scaleX} ${scaleY})`} opacity={opacity}>
      <path
        d="M0 -72 C24 -44 27 -14 0 10 C-27 -14 -24 -44 0 -72Z"
        fill={fill || `url(#${id}-petal)`}
      />
      <path
        d="M0 -62 C7 -39 7 -12 0 3"
        fill="none"
        stroke="#ffc0a3"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.35"
      />
    </g>
  );
}

function FlowerPetals({ id, x, y, scale = 1, richness = 1, rare = false }) {
  const outer = richness >= 3 ? [-105, -72, -39, 0, 39, 72, 105] : [-72, -36, 0, 36, 72];
  const middle = richness >= 2 ? [-52, -22, 10, 42] : [-35, 0, 35];
  const inner = rare ? [-26, 0, 26] : [-18, 18];

  return (
    <g
      className={`flower_petals flower-petals ${rare ? "flower-petals--rare" : ""}`.trim()}
      data-part="flower_petals"
      transform={`translate(${x} ${y}) scale(${scale})`}
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
    >
      {rare && <ellipse cx="0" cy="-18" rx="98" ry="88" fill={`url(#${id}-glow)`} filter={`url(#${id}-soft-glow)`} />}
      {outer.map((r) => (
        <Petal key={`outer-${r}`} id={id} rotate={r} scaleY={0.98} scaleX={1.04} distance={8} opacity={0.96} />
      ))}
      {middle.map((r) => (
        <Petal key={`middle-${r}`} id={id} rotate={r} scaleY={0.86} scaleX={0.82} distance={1} fill={`url(#${id}-petal-warm)`} opacity={0.93} />
      ))}
      {inner.map((r) => (
        <Petal key={`inner-${r}`} id={id} rotate={r} scaleY={0.62} scaleX={0.56} distance={-7} fill="#ff887d" opacity={0.94} />
      ))}
      {rare && (
        <path
          className="rare-flame-petal"
          d="M0 -112 C22 -82 25 -47 0 -18 C-25 -47 -22 -82 0 -112Z"
          fill={`url(#${id}-petal-warm)`}
          opacity="0.82"
        />
      )}
    </g>
  );
}

function FlowerCore({ x, y, scale = 1, rare = false }) {
  const stamens = rare ? [-48, -31, -15, 0, 15, 31, 48] : [-38, -20, 0, 20, 38];

  return (
    <g
      className={`flower_core flower-core ${rare ? "flower-core--rare" : ""}`.trim()}
      data-part="flower_core"
      transform={`translate(${x} ${y}) scale(${scale})`}
    >
      <circle cx="0" cy="8" r={rare ? 19 : 17} fill="#7044a5" />
      <circle cx="0" cy="8" r={rare ? 10 : 8} fill="#9b66d8" opacity="0.55" />
      {stamens.map((angle, index) => {
        const length = rare ? 54 - Math.abs(angle) * 0.28 : 43 - Math.abs(angle) * 0.22;
        return (
          <g key={angle} transform={`rotate(${angle})`}>
            <line x1="0" y1="0" x2="0" y2={-length} stroke="#ffc847" strokeWidth="4" strokeLinecap="round" />
            <circle cx="0" cy={-length - 4} r={index % 2 ? 6 : 7} fill="#ffd85f" />
          </g>
        );
      })}
      {rare && <path d="M0 -70 L8 -55 L0 -42 L-8 -55Z" fill="#ffe38a" opacity="0.9" />}
    </g>
  );
}

function Sparkles({ id, rare = false }) {
  if (!rare) return null;

  const items = [
    { x: 180, y: 119, s: 0.95 },
    { x: 345, y: 115, s: 0.75 },
    { x: 395, y: 175, s: 0.7 },
    { x: 150, y: 208, s: 0.45 },
    { x: 377, y: 315, s: 0.45 },
    { x: 224, y: 394, s: 0.45 },
  ];

  return (
    <g className="sparkles_glow sparkles" data-part="sparkles/glow" filter={`url(#${id}-soft-glow)`}>
      {items.map((p, index) => (
        <g key={index} transform={`translate(${p.x} ${p.y}) scale(${p.s})`} opacity={0.7 + index * 0.03}>
          <path d="M0 -11 L4 -3 L12 0 L4 3 L0 11 L-4 3 L-12 0 L-4 -3Z" fill="#ffd36b" />
        </g>
      ))}
      <circle cx="407" cy="222" r="3" fill="#ffd36b" />
      <circle cx="124" cy="170" r="3" fill="#ffd36b" />
      <circle cx="370" cy="398" r="2.5" fill="#ffd36b" />
    </g>
  );
}

function ShieldLeaf({ id, slot, index }) {
  return (
    <g className={`shield-leaf shield-leaf--${index + 1}`} data-shield-index={index}>
      <Leaf id={id} {...slot} className="shield-leaf__leaf" />
    </g>
  );
}

function ShieldLeaves({ id, stage, shieldLeaves }) {
  const slots = SHIELD_SLOTS[stage] || [];
  let count = shieldLeaves === "auto" ? DEFAULT_STAGE_SHIELDS[stage] || 0 : Number(shieldLeaves || 0);
  count = Math.max(0, Math.min(count, slots.length));

  return (
    <g className="shield_leaves shield-leaves" data-part="shield_leaves">
      {slots.slice(0, count).map((slot, index) => (
        <ShieldLeaf key={`${slot.x}-${slot.y}`} id={id} slot={slot} index={index} />
      ))}
    </g>
  );
}

function StageZero({ id }) {
  return (
    <>
      <Soil id={id} compact />
      <g className="stem" data-part="stem" />
      <g className="main_leaves" data-part="main_leaves" />
      <g className="shield_leaves" data-part="shield_leaves" />
      <DormantSeed id={id} />
      <g className="flower_petals" data-part="flower_petals" />
      <g className="flower_core" data-part="flower_core" />
      <g className="sparkles_glow" data-part="sparkles/glow" />
    </>
  );
}

function StageOne({ id, shieldLeaves }) {
  return (
    <>
      <Soil id={id} compact />
      <StemPath id={id} stage={1} />
      <g className="main_leaves" data-part="main_leaves">
        <Leaf id={id} x={252} y={356} scale={0.42} rotate={-160} flip />
        <Leaf id={id} x={260} y={355} scale={0.42} rotate={-20} />
      </g>
      <ShieldLeaves id={id} stage={1} shieldLeaves={shieldLeaves} />
      <g className="buds" data-part="buds" />
      <g className="flower_petals" data-part="flower_petals" />
      <g className="flower_core" data-part="flower_core" />
      <g className="sparkles_glow" data-part="sparkles/glow" />
    </>
  );
}

function StageThree({ id, shieldLeaves }) {
  return (
    <>
      <Soil id={id} />
      <g className="stem" data-part="stem">
        <StemPath id={id} stage={3} />
        <Branch id={id} d="M258 351 C229 333 214 317 191 300" width={6} />
        <Branch id={id} d="M260 323 C292 307 310 291 335 271" width={6} />
      </g>
      <g className="main_leaves" data-part="main_leaves">
        <Leaf id={id} x={190} y={300} scale={0.52} rotate={155} flip />
        <Leaf id={id} x={334} y={270} scale={0.58} rotate={-28} />
      </g>
      <ShieldLeaves id={id} stage={3} shieldLeaves={shieldLeaves} />
      <g className="buds" data-part="buds">
        <ClosedBud id={id} x={264} y={292} scale={0.7} />
        <Node x={227} y={331} r={7} />
      </g>
      <g className="flower_petals" data-part="flower_petals" />
      <g className="flower_core" data-part="flower_core" />
      <g className="sparkles_glow" data-part="sparkles/glow" />
    </>
  );
}

function StageSeven({ id, shieldLeaves }) {
  return (
    <>
      <Soil id={id} />
      <g className="stem" data-part="stem">
        <StemPath id={id} stage={7} />
        <Branch id={id} d="M257 356 C226 331 206 315 178 305" width={7} />
        <Branch id={id} d="M261 306 C291 287 309 272 338 255" width={7} />
        <Branch id={id} d="M260 258 C282 247 292 236 304 216" width={6} />
      </g>
      <g className="main_leaves" data-part="main_leaves">
        <Leaf id={id} x={178} y={305} scale={0.66} rotate={150} flip />
        <Leaf id={id} x={338} y={255} scale={0.66} rotate={-32} />
        <Leaf id={id} x={221} y={250} scale={0.48} rotate={-142} flip />
      </g>
      <ShieldLeaves id={id} stage={7} shieldLeaves={shieldLeaves} />
      <g className="buds" data-part="buds">
        <ClosedBud id={id} x={262} y={224} scale={0.82} />
        <Node x={304} y={216} r={8} />
        <Node x={224} y={312} r={8} />
      </g>
      <g className="flower_petals" data-part="flower_petals" />
      <g className="flower_core" data-part="flower_core" />
      <g className="sparkles_glow" data-part="sparkles/glow" />
    </>
  );
}

function StageFourteen({ id, shieldLeaves }) {
  return (
    <>
      <Soil id={id} />
      <g className="stem" data-part="stem">
        <StemPath id={id} stage={14} />
        <Branch id={id} d="M255 371 C223 344 203 329 174 314" width={7} />
        <Branch id={id} d="M263 300 C296 276 321 262 354 235" width={7} />
        <Branch id={id} d="M263 253 C229 237 211 218 190 197" width={6} />
        <Branch id={id} d="M265 222 C286 211 298 198 311 180" width={6} />
      </g>
      <g className="main_leaves" data-part="main_leaves">
        <Leaf id={id} x={174} y={314} scale={0.74} rotate={152} flip />
        <Leaf id={id} x={354} y={235} scale={0.8} rotate={-30} />
        <Leaf id={id} x={190} y={197} scale={0.55} rotate={-150} flip />
        <Leaf id={id} x={304} y={384} scale={0.46} rotate={-16} />
      </g>
      <ShieldLeaves id={id} stage={14} shieldLeaves={shieldLeaves} />
      <g className="buds" data-part="buds">
        <ClosedBud id={id} x={265} y={162} scale={1.05} />
        <SideBud id={id} x={190} y={195} scale={0.58} rotate={-28} />
        <Node x={311} y={180} r={8} />
        <Node x={223} y={309} r={8} />
      </g>
      <g className="flower_petals" data-part="flower_petals" />
      <g className="flower_core" data-part="flower_core" />
      <g className="sparkles_glow" data-part="sparkles/glow" />
    </>
  );
}

function FloweringStage({ id, stage, shieldLeaves }) {
  const is60 = stage === 60;
  const rare = stage === 100;
  const flower = rare
    ? { x: 263, y: 104, scale: 1.06, richness: 3 }
    : is60
      ? { x: 264, y: 124, scale: 0.96, richness: 3 }
      : { x: 264, y: 138, scale: 0.82, richness: 2 };

  return (
    <>
      <Soil id={id} />
      <g className="stem" data-part="stem">
        <StemPath id={id} stage={stage} />
        <Branch id={id} d="M255 372 C221 345 202 332 166 317" width="8" />
        <Branch id={id} d="M264 308 C304 278 329 264 365 232" width="8" />
        <Branch id={id} d="M265 255 C229 235 205 213 178 185" width="7" />
        <Branch id={id} d="M265 227 C294 211 307 193 327 168" width="7" />
        <Branch id={id} d="M260 385 C285 374 306 365 333 354" width="7" />
        {rare && <Branch id={id} d="M254 328 C215 298 188 273 150 253" width="7" />}
      </g>

      <g className="main_leaves" data-part="main_leaves">
        <Leaf id={id} x={166} y={317} scale={0.83} rotate={153} flip />
        <Leaf id={id} x={365} y={232} scale={0.87} rotate={-30} />
        <Leaf id={id} x={178} y={185} scale={0.58} rotate={-151} flip />
        <Leaf id={id} x={333} y={354} scale={0.52} rotate={-18} />
        <Leaf id={id} x={230} y={385} scale={0.42} rotate={-158} flip />
        {rare && <Leaf id={id} x={150} y={253} scale={0.65} rotate={160} flip />}
      </g>

      <ShieldLeaves id={id} stage={stage} shieldLeaves={shieldLeaves} />

      <g className="buds" data-part="buds">
        <SideBud id={id} x={178} y={184} scale={0.7} rotate={-28} />
        <SideBud id={id} x={333} y={354} scale={0.62} rotate={18} />
        <Node x={327} y={168} r={8} />
        <Node x={222} y={312} r={8} />
        <Node x={303} y={380} r={7} />
      </g>

      <FlowerPetals id={id} {...flower} rare={rare} />
      <FlowerCore x={flower.x} y={flower.y + (rare ? 8 : 12)} scale={flower.scale * (rare ? 0.95 : 0.84)} rare={rare} />
      <Sparkles id={id} rare={rare} />
    </>
  );
}

function PlantByStage({ id, stage, shieldLeaves }) {
  switch (stage) {
    case 0:
      return <StageZero id={id} />;
    case 1:
      return <StageOne id={id} shieldLeaves={shieldLeaves} />;
    case 3:
      return <StageThree id={id} shieldLeaves={shieldLeaves} />;
    case 7:
      return <StageSeven id={id} shieldLeaves={shieldLeaves} />;
    case 14:
      return <StageFourteen id={id} shieldLeaves={shieldLeaves} />;
    case 30:
    case 60:
    case 100:
      return <FloweringStage id={id} stage={stage} shieldLeaves={shieldLeaves} />;
    default:
      return <StageZero id={id} />;
  }
}

/**
 * NemorisPlantArtwork
 *
 * Hand-authored inline SVG plant artwork for the habit streak plant.
 * It deliberately avoids PNG tracing so the main groups remain animation-friendly.
 *
 * Props:
 * - stage: 0 | 1 | 3 | 7 | 14 | 30 | 60 | 100, or any number; numbers map down to the nearest milestone.
 * - shieldLeaves: number | "auto". Use 0 when the app controls shield leaves separately.
 * - size: number | string.
 * - title: accessible title.
 *
 * Group names available for animation:
 * - .soil
 * - .stem
 * - .main_leaves
 * - .shield_leaves
 * - .buds
 * - .flower_petals
 * - .flower_core
 * - .sparkles_glow
 */
export default function NemorisPlantArtwork({
  stage = 0,
  shieldLeaves = 0,
  size = 256,
  title = "Nemoris habit plant",
  className = "",
  style,
  ...svgProps
}) {
  const resolvedStage = clampStage(stage);
  const id = useMemo(() => uniqueId("nemoris"), []);

  return (
    <svg
      className={`nemoris-plant nemoris-plant--stage-${resolvedStage} ${className}`.trim()}
      data-stage={resolvedStage}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-labelledby={`${id}-title`}
      style={{ overflow: "visible", ...style }}
      xmlns="http://www.w3.org/2000/svg"
      {...svgProps}
    >
      <title id={`${id}-title`}>{title}</title>
      <Defs id={id} />
      <PlantByStage id={id} stage={resolvedStage} shieldLeaves={shieldLeaves} />
    </svg>
  );
}

export function NemorisShieldLeafAsset({
  state = "full",
  size = 96,
  title = "Nemoris shield leaf",
  className = "",
  style,
  ...svgProps
}) {
  const id = useMemo(() => uniqueId("nemoris-shield"), []);

  return (
    <svg
      className={`nemoris-shield-asset nemoris-shield-asset--${state} ${className}`.trim()}
      data-shield-state={state}
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-labelledby={`${id}-title`}
      style={{ overflow: "visible", ...style }}
      xmlns="http://www.w3.org/2000/svg"
      {...svgProps}
    >
      <title id={`${id}-title`}>{title}</title>
      <Defs id={id} />
      {state === "regrowing" ? (
        <g className="shield-leaf-regrowing" transform="translate(80 96)">
          <path d="M0 38 C-12 13 -8 -18 6 -36 C20 -15 22 15 0 38Z" fill={`url(#${id}-petal)`} />
          <path d="M-22 34 C-10 20 0 18 2 38 C5 18 16 20 25 34 C13 47 -13 47 -22 34Z" fill={`url(#${id}-leaf)`} />
        </g>
      ) : state === "fallen" ? (
        <g className="shield-leaf-fallen" transform="translate(34 94) rotate(-18)">
          <path d="M0 0 C26 -27 68 -28 94 -2 C66 21 26 25 0 0Z" fill={`url(#${id}-leaf)`} opacity="0.82" />
          <path d="M8 -1 C31 -5 57 -5 86 -3" fill="none" stroke={`url(#${id}-leaf-vein)`} strokeWidth="5" strokeLinecap="round" />
          <path d="M3 4 C34 13 62 11 90 -3" fill="none" stroke="#4b765f" strokeWidth="2" opacity="0.35" />
        </g>
      ) : (
        <g className="shield-leaf-full" transform="translate(32 82) rotate(-18)">
          <path d="M0 0 C26 -31 70 -34 100 -5 C73 25 29 29 0 0Z" fill={`url(#${id}-leaf)`} />
          <path d="M9 -1 C33 -6 61 -7 91 -5" fill="none" stroke={`url(#${id}-leaf-vein)`} strokeWidth="6" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

export const nemorisPlantStages = STAGES;
