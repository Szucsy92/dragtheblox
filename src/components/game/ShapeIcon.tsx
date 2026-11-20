import type { ShapeKind } from "@/game/shapes";

export function ShapeIcon({ kind, color, className = "h-9 w-9" }: { kind: ShapeKind; color: string; className?: string }) {
  const s = { fill: color, stroke: "rgba(0,0,0,0.25)", strokeWidth: 1.5 };
  const shade = { fill: "rgba(0,0,0,0.18)" };
  const light = { fill: "rgba(255,255,255,0.35)" };
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      {kind === "cube" && (<><path d="M10 14 L20 9 L30 14 L30 28 L20 33 L10 28Z" {...s} /><path d="M10 14 L20 9 L30 14 L20 19Z" {...light} /><path d="M20 19 L30 14 L30 28 L20 33Z" {...shade} /></>)}
      {kind === "brick" && (<><path d="M4 17 L14 12 L36 18 L36 28 L26 33 L4 27Z" {...s} /><path d="M4 17 L14 12 L36 18 L26 23Z" {...light} /><path d="M26 23 L36 18 L36 28 L26 33Z" {...shade} /></>)}
      {kind === "cylinder" && (<><path d="M10 12 L10 29 A10 4 0 0 0 30 29 L30 12Z" {...s} /><ellipse cx="20" cy="12" rx="10" ry="4" {...s} /><ellipse cx="20" cy="12" rx="10" ry="4" {...light} /></>)}
      {kind === "arch" && (<path d="M4 32 L4 12 L36 12 L36 32 L28 32 L28 26 A8 8 0 0 0 12 26 L12 32Z" {...s} />)}
      {kind === "roof" && (<><path d="M4 30 L20 11 L36 30Z" {...s} /><path d="M20 11 L36 30 L28 30Z" {...shade} /></>)}
      {kind === "cone" && (<><path d="M20 6 L31 30 A11 4 0 0 1 9 30Z" {...s} /><path d="M20 6 L31 30 A11 4 0 0 1 24 33Z" {...shade} /></>)}
      {kind === "sphere" && (<><circle cx="20" cy="20" r="12" {...s} /><circle cx="16" cy="15" r="4" {...light} /></>)}
      {kind === "half" && (<><path d="M7 28 A13 13 0 0 1 33 28Z" {...s} /><circle cx="15" cy="21" r="3" {...light} /></>)}
    </svg>
  );
}
