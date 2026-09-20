import { SITES, type SiteId, type Telemetry } from '../experience/types';

interface SiteMapProps {
  telemetry: Telemetry;
  selected: SiteId;
  visited: SiteId[];
  interactive?: boolean;
  onSelect?: (id: SiteId) => void;
}

const mapX = (x: number) => Math.max(19, Math.min(181, 100 + x * 0.87));
const mapY = (z: number) => Math.max(19, Math.min(181, 100 + (z + 5) * 0.87));

export function SiteMap({ telemetry, selected, visited, interactive = false, onSelect }: SiteMapProps) {
  const id = interactive ? 'large-radar' : 'mini-radar';
  return (
    <svg viewBox="0 0 200 200" className="site-map" aria-label="Landing site map" role={interactive ? 'group' : 'img'}>
      <defs>
        <clipPath id={id}><circle cx="100" cy="100" r="85" /></clipPath>
        <radialGradient id={`${id}-background`}><stop stopColor="#2d3430" /><stop offset="1" stopColor="#17201e" /></radialGradient>
      </defs>
      <circle cx="100" cy="100" r="85" fill={`url(#${id}-background)`} fillOpacity=".8" stroke="#fff" strokeOpacity=".21" strokeWidth=".65" />
      <g clipPath={`url(#${id})`}>
        <g fill="none" stroke="#beaa8b" strokeOpacity=".18" strokeWidth=".65">
          <path d="M-10 76C28 74 18 24 59 34S99 78 115 55 166 51 211 0" />
          <path d="M-10 84C34 87 24 34 59 44S98 87 121 66 173 58 219 16" />
          <path d="M-10 96C41 92 32 48 60 54S99 96 127 77 186 69 219 27" />
          <path d="M-10 104C49 104 33 64 64 64S102 105 138 87 188 87 217 44" />
          <path d="M-10 153C17 119 38 133 63 120S102 129 122 121 173 98 217 113" />
          <path d="M-10 168C29 126 40 146 68 133S103 140 129 133 173 109 218 127" />
          <path d="M-10 182C32 140 46 160 77 148S101 153 138 148 177 125 218 140" />
          <path d="M-10 191C46 154 51 176 86 162S115 170 148 164 182 140 218 158" />
        </g>
        <g stroke="#fff" strokeOpacity=".06" strokeWidth=".5">
          {[40, 70, 100, 130, 160].map(n => <path key={n} d={`M${n} 15V185M15 ${n}H185`} />)}
        </g>
        <circle cx="100" cy="100" r="57" fill="none" stroke="#fff" strokeOpacity=".08" strokeWidth=".6" />
        <path d={`M${mapX(telemetry.x)} ${mapY(telemetry.z)}L${mapX(SITES.find(site => site.id === selected)!.x)} ${mapY(SITES.find(site => site.id === selected)!.z)}`} stroke="#e7956e" strokeOpacity=".5" strokeWidth=".75" strokeDasharray="2 3" />
        {SITES.map(site => (
          <g key={site.id} className={interactive ? 'map-site-interactive' : ''} transform={`translate(${mapX(site.x)},${mapY(site.z)})`}
            role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `Select ${site.name}` : undefined}
            onClick={interactive ? () => onSelect?.(site.id) : undefined}
            onKeyDown={interactive ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(site.id); } } : undefined}>
            <circle r="12" fill="transparent" />
            {selected === site.id && <circle r="8" fill="none" stroke="#eda680" strokeWidth=".7" />}
            <rect x="-2.5" y="-2.5" width="5" height="5" rx=".7" transform="rotate(45)" fill={selected === site.id ? '#efa77f' : visited.includes(site.id) ? '#a9c6ae' : '#e0e1d8'} />
            {interactive && <text x="10" y="-6" fill="#eeeee6" fontSize="6" fontFamily="monospace">{site.number}</text>}
          </g>
        ))}
        <g transform={`translate(${mapX(telemetry.x)},${mapY(telemetry.z)}) rotate(${-telemetry.heading * 180 / Math.PI})`}>
          <path d="M0 0L-15-28Q0-35 15-28Z" fill="#e89b70" opacity=".13" />
          <circle r="8" fill="#eaa37a" opacity=".08" />
          <path d="M0-5L3.8 4 0 2.5-3.8 4Z" fill="#f2b38e" stroke="#ffd7b6" strokeWidth=".6" />
        </g>
      </g>
      <g fill="#c4c7ba" fontSize="6.5" fontFamily="monospace" textAnchor="middle"><text x="100" y="9" fill="#efb08c">N</text><text x="100" y="198">S</text><text x="6" y="103">W</text><text x="194" y="103">E</text></g>
      <path d="M100 15v4M100 181v4M15 100h4M181 100h4" stroke="#f5d9c2" strokeOpacity=".65" strokeWidth=".8" />
    </svg>
  );
}