/**
 * A single die face, drawn as a faceted gem rather than a plain number in a
 * box. Six triangular facets fan out from the centre so it reads as a
 * polyhedral die at any size; the outline shape works for a d20 or a d6 alike
 * since both tray and roll-readout only ever need one face showing.
 */
export function DieFace({ value, className = '' }: { value: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`die-face ${className}`} aria-hidden="true">
      <polygon className="die-facet facet-1" points="50,4 95,27 50,50" />
      <polygon className="die-facet facet-2" points="95,27 95,73 50,50" />
      <polygon className="die-facet facet-3" points="95,73 50,96 50,50" />
      <polygon className="die-facet facet-4" points="50,96 5,73 50,50" />
      <polygon className="die-facet facet-5" points="5,73 5,27 50,50" />
      <polygon className="die-facet facet-6" points="5,27 50,4 50,50" />
      <polygon className="die-outline" points="50,4 95,27 95,73 50,96 5,73 5,27" />
      <text x="50" y="59" textAnchor="middle" className="die-number">
        {value}
      </text>
    </svg>
  );
}
