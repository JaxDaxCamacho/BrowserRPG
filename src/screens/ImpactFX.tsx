/**
 * What a blow looks like when it lands on a token: sparks for a graze, a small
 * blood splatter for a hit and a large one for a critical hit. Drawn with CSS
 * and SVG, so it needs no art pack. The spray flies away from the attacker.
 */

export type ImpactKind = 'spark' | 'blood' | 'gore';

/** A small seeded random source, so each blow sprays differently but never changes on a re-render. */
function randomFrom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spray {
  count: number;
  /** How far the drops fly, in px. */
  reach: [number, number];
  /** Drop size, in px. */
  size: [number, number];
  /** Half the width of the spray cone, in radians. */
  spread: number;
  /** Size of the splat at the point of impact, in px. */
  splat: number;
}

const SPRAYS: Record<'blood' | 'gore', Spray> = {
  blood: { count: 10, reach: [16, 34], size: [4, 8], spread: 1.1, splat: 32 },
  gore: { count: 22, reach: [24, 64], size: [5, 12], spread: 1.5, splat: 56 },
};

function between(rand: () => number, [lo, hi]: [number, number]): number {
  return lo + rand() * (hi - lo);
}

function Sparks({ seed }: { seed: string }) {
  const rand = randomFrom(seed);
  const rays = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * 360 + rand() * 30;
    const length = 10 + rand() * 12;
    return { angle, length, delay: rand() * 60 };
  });
  return (
    <span className="impact impact-spark" aria-hidden="true">
      <span className="spark-core" />
      {rays.map((r, i) => (
        <span
          key={i}
          className="spark-ray"
          style={{ transform: `rotate(${r.angle}deg)`, ['--len' as string]: `${r.length}px`, animationDelay: `${r.delay}ms` }}
        />
      ))}
    </span>
  );
}

function Blood({ seed, kind, dir }: { seed: string; kind: 'blood' | 'gore'; dir: number }) {
  const rand = randomFrom(seed);
  const spray = SPRAYS[kind];
  const drops = Array.from({ length: spray.count }, () => {
    const angle = dir + (rand() * 2 - 1) * spray.spread;
    const dist = between(rand, spray.reach);
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: between(rand, spray.size),
      delay: rand() * 70,
    };
  });
  // The splat: an irregular cluster of blobs, pushed a little the way the blow went.
  const blobs = Array.from({ length: kind === 'gore' ? 9 : 5 }, () => {
    const angle = dir + (rand() * 2 - 1) * 1.6;
    const off = rand() * spray.splat * 0.3;
    return { cx: 50 + Math.cos(angle) * off, cy: 50 + Math.sin(angle) * off, r: 10 + rand() * 14 };
  });
  return (
    <span className={`impact impact-${kind}`} aria-hidden="true">
      <svg className="blood-splat" viewBox="0 0 100 100" style={{ width: spray.splat, height: spray.splat }}>
        {blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} />
        ))}
      </svg>
      {drops.map((d, i) => (
        <span
          key={i}
          className="blood-drop"
          style={{
            width: d.size,
            height: d.size,
            ['--dx' as string]: `${d.dx}px`,
            ['--dy' as string]: `${d.dy}px`,
            animationDelay: `${d.delay}ms`,
          }}
        />
      ))}
    </span>
  );
}

/** One impact effect. `dir` is the direction the blow travelled, in radians (0 = to the right). */
export function ImpactFX({ kind, seed, dir = 0 }: { kind: ImpactKind; seed: string; dir?: number }) {
  if (kind === 'spark') return <Sparks seed={seed} />;
  return <Blood seed={seed} kind={kind} dir={dir} />;
}
