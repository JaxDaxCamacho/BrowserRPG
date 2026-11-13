import { TILE_CHARS, type DungeonDefinition, type Pos, type TileChar, type TileType } from '../engine';

/** Same palette as the game's map, so the editor looks like what the player sees. */
const TILE_COLOURS: Record<TileType, string> = {
  wall: '#2e2822',
  corridor: '#6b5d4f',
  room: '#7d6d5c',
  hall: '#8c7b65',
  door: '#a0703f',
  lockedDoor: '#7a3030',
  stairs: '#55707c',
};

export function tileColour(ch: TileChar): string {
  return TILE_COLOURS[TILE_CHARS[ch]];
}

export type Selection = { kind: 'feature'; id: string } | { kind: 'room'; id: string } | null;

export interface Overlay {
  selection: Selection;
  /** Rectangle being dragged out by the rectangle or room tool. */
  preview?: { a: Pos; b: Pos; colour: string };
  /** Tile under the pointer. */
  hover?: Pos | null;
}

function marker(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, label: string) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#14110f';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(9, r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 0.5);
}

export function drawMap(ctx: CanvasRenderingContext2D, d: DungeonDefinition, size: number, overlay: Overlay): void {
  const w = d.width * size;
  const h = d.height * size;
  ctx.clearRect(0, 0, w, h);

  for (let y = 0; y < d.height; y++) {
    const row = d.tiles[y] ?? '';
    for (let x = 0; x < d.width; x++) {
      const ch = (row[x] ?? '#') as TileChar;
      ctx.fillStyle = TILE_CHARS[ch] ? tileColour(ch) : '#ff00ff';
      ctx.fillRect(x * size, y * size, size, size);
      if (ch === '+' || ch === 'L') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x * size + size * 0.3, y * size + size * 0.3, size * 0.4, size * 0.4);
      }
      if (ch === '>') {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let k = 0; k < 3; k++) ctx.fillRect(x * size + 3, y * size + 3 + k * (size / 3.5), size - 6 - k * 3, 2);
      }
    }
  }

  // Grid
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= d.width; x++) {
    ctx.moveTo(x * size + 0.5, 0);
    ctx.lineTo(x * size + 0.5, h);
  }
  for (let y = 0; y <= d.height; y++) {
    ctx.moveTo(0, y * size + 0.5);
    ctx.lineTo(w, y * size + 0.5);
  }
  ctx.stroke();

  // Rooms
  for (const room of d.rooms) {
    const selected = overlay.selection?.kind === 'room' && overlay.selection.id === room.id;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeStyle = selected ? '#ffffff' : '#c9963c';
    ctx.strokeRect(room.x * size + 1, room.y * size + 1, room.width * size - 2, room.height * size - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c9963c';
    ctx.font = `${Math.max(10, size * 0.45)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${room.name ?? room.id} · ${room.rows} rows`, room.x * size + 4, room.y * size + 3);
  }

  // Start
  const r = size * 0.38;
  marker(ctx, (d.start.x + 0.5) * size, (d.start.y + 0.5) * size, r, '#3f8f4f', 'S');

  // Features
  for (const f of d.features) {
    const cx = (f.x + 0.5) * size;
    const cy = (f.y + 0.5) * size;
    switch (f.type) {
      case 'goal':
        marker(ctx, cx, cy, r, '#c9963c', '★');
        break;
      case 'trap':
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r * 0.8);
        ctx.lineTo(cx - r, cy + r * 0.8);
        ctx.closePath();
        ctx.fillStyle = '#e0a030';
        ctx.fill();
        ctx.strokeStyle = '#14110f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#14110f';
        ctx.font = `bold ${Math.max(9, r)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', cx, cy + r * 0.2);
        break;
      case 'encounter':
        marker(ctx, cx, cy, r, '#d0533c', String(f.monsters.reduce((n, m) => n + m.count, 0)));
        break;
      case 'event':
        marker(ctx, cx, cy, r, '#4a78b0', 'E');
        break;
    }
    if (overlay.selection?.kind === 'feature' && overlay.selection.id === f.id) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(f.x * size + 1.5, f.y * size + 1.5, size - 3, size - 3);
    }
  }

  if (overlay.preview) {
    const { a, b, colour } = overlay.preview;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x0 * size, y0 * size, (Math.abs(a.x - b.x) + 1) * size, (Math.abs(a.y - b.y) + 1) * size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 * size + 0.5, y0 * size + 0.5, (Math.abs(a.x - b.x) + 1) * size - 1, (Math.abs(a.y - b.y) + 1) * size - 1);
  }

  if (overlay.hover) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(overlay.hover.x * size + 1, overlay.hover.y * size + 1, size - 2, size - 2);
  }
}
