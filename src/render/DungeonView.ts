import { Application, Assets, BlurFilter, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  roomsLitFrom,
  SIGHT_RADIUS,
  tileAt,
  visibleFrom,
  type DungeonDefinition,
  type DungeonState,
  type FeatureDefinition,
  type Pos,
  type TileType,
} from '../engine';

/** Size of one map tile in world pixels. */
export const TILE = 40;

const TILE_COLOURS: Record<TileType, number> = {
  wall: 0x2e2822,
  corridor: 0x6b5d4f,
  room: 0x7d6d5c,
  hall: 0x8c7b65,
  door: 0xa0703f,
  lockedDoor: 0x7a3030,
  stairs: 0x55707c,
};

const GOLD = 0xc9963c;
const ENEMY = 0xd0533c;
const TRAP = 0xe0a030;
const QUIET = 0x9a8f80;

export interface MarkerInfo {
  /** Picture for the marker, from the asset library. */
  image?: string;
  /** Shown on the marker when there is no picture. */
  label: string;
  /** Number of enemies, shown as a badge. */
  count?: number;
}

export interface DungeonViewCallbacks {
  onTileTap: (pos: Pos) => void;
  /** Turns an asset id into a URL, or null when assets are not available. */
  assetUrl: (id: string) => string;
  /** How to draw an encounter, event or goal marker. */
  markerFor: (feature: FeatureDefinition) => MarkerInfo;
}

interface ViewState {
  def: DungeonDefinition;
  dungeon: DungeonState;
  leaderPortrait?: string;
  leaderInitials: string;
  /** Which group the main token is, while the party is split. */
  groupId?: string;
  /** The other groups' tokens. */
  others?: { id: string; pos: Pos; portrait?: string; initials: string; fighting: boolean }[];
}

/**
 * Draws a dungeon with PixiJS. React owns the game state and calls `update`
 * whenever it changes; this class only draws and reports taps.
 */
export class DungeonView {
  private app = new Application();
  private world = new Container();
  private tiles = new Graphics();
  /** Darkness over the map, blurred so the edges of sight are soft. */
  private fog = new Graphics();
  private pathLayer = new Graphics();
  private markers = new Container();
  private token = new Container();
  private otherTokens = new Container();
  private textures = new Map<string, Texture | null>();
  private state: ViewState | null = null;
  private ready = false;
  private destroyed = false;
  private tokenTarget = { x: 0, y: 0 };
  private hasCentred = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; worldX: number; worldY: number } | null = null;
  private dragged = false;
  private pinchStart: { distance: number; scale: number } | null = null;

  constructor(
    private host: HTMLElement,
    private callbacks: DungeonViewCallbacks,
  ) {}

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: 0x0b0908,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';

    this.fog.filters = [new BlurFilter({ strength: TILE * 0.35, quality: 4 })];
    // Markers sit above the fog so the goal can be seen from the start; only seen markers are drawn otherwise.
    this.world.addChild(this.tiles, this.fog, this.pathLayer, this.markers, this.otherTokens, this.token);
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = new Rectangle(-1e6, -1e6, 2e6, 2e6);
    this.app.stage.on('pointerdown', this.onPointerDown);
    this.app.stage.on('pointermove', this.onPointerMove);
    this.app.stage.on('pointerup', this.onPointerUp);
    this.app.stage.on('pointerupoutside', this.onPointerUp);
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.ticker.add(this.onTick);

    this.ready = true;
    if (this.state) this.redraw();
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.ready) return;
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.destroy(true, { children: true });
  }

  update(next: ViewState): void {
    const moved = !this.state || this.state.dungeon.pos.x !== next.dungeon.pos.x || this.state.dungeon.pos.y !== next.dungeon.pos.y;
    const newMap = !this.state || this.state.def.id !== next.def.id;
    // The turn passed to another group: jump to it rather than slide across the map.
    const switched = !!this.state && this.state.groupId !== next.groupId;
    this.state = next;
    if (newMap) this.hasCentred = false;
    if (!this.ready) return;
    this.redraw();
    if (switched) {
      const p = next.dungeon.pos;
      this.token.position.set((p.x + 0.5) * TILE, (p.y + 0.5) * TILE);
      this.tokenTarget = { x: this.token.x, y: this.token.y };
      this.centreOnParty();
    } else if (moved) this.keepPartyInView();
  }

  /** Centres the camera on the party. */
  centreOnParty(): void {
    if (!this.state) return;
    const { pos } = this.state.dungeon;
    const s = this.world.scale.x;
    this.world.position.set(
      this.app.screen.width / 2 - (pos.x + 0.5) * TILE * s,
      this.app.screen.height / 2 - (pos.y + 0.5) * TILE * s,
    );
  }

  // ---------- drawing ----------

  private texture(id: string | undefined): Texture | null {
    if (!id) return null;
    const url = this.callbacks.assetUrl(id);
    if (this.textures.has(url)) return this.textures.get(url) ?? null;
    this.textures.set(url, null);
    Assets.load<Texture>(url)
      .then((t) => {
        this.textures.set(url, t);
        if (!this.destroyed && this.state) this.redraw();
      })
      .catch(() => this.textures.set(url, null));
    return null;
  }

  private redraw(): void {
    const s = this.state!;
    // Tiles are redrawn every time: what is lit changes whenever the party moves.
    this.drawTiles(s);
    this.drawPath(s);
    this.drawMarkers(s);
    this.drawToken(s);
    if (!this.hasCentred && this.app.screen.width > 0) {
      const fit = Math.min(1.4, Math.max(0.6, this.app.screen.height / (11 * TILE)));
      this.world.scale.set(fit);
      this.centreOnParty();
      const p = s.dungeon.pos;
      this.token.position.set((p.x + 0.5) * TILE, (p.y + 0.5) * TILE);
      this.tokenTarget = { x: this.token.x, y: this.token.y };
      this.hasCentred = true;
    }
  }

  private drawTiles({ def, dungeon }: ViewState): void {
    const g = this.tiles.clear();
    const walkable = (x: number, y: number) => tileAt(def, x, y) !== 'wall';
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        const i = y * def.width + x;
        if (dungeon.seen[i] !== '1') continue;
        const type = tileAt(def, x, y);
        const px = x * TILE;
        const py = y * TILE;
        if (type === 'wall') {
          // Stone blocks: a dark face with a lighter edge wherever the wall meets open floor.
          g.rect(px, py, TILE, TILE).fill(TILE_COLOURS.wall);
          g.rect(px + 3, py + 3, TILE - 6, TILE - 6).fill({ color: 0x000000, alpha: 0.25 });
          const edge = { color: 0x8a7a66, alpha: 0.55, width: 3 };
          if (walkable(x, y + 1)) g.moveTo(px, py + TILE - 1.5).lineTo(px + TILE, py + TILE - 1.5).stroke(edge);
          if (walkable(x, y - 1)) g.moveTo(px, py + 1.5).lineTo(px + TILE, py + 1.5).stroke(edge);
          if (walkable(x + 1, y)) g.moveTo(px + TILE - 1.5, py).lineTo(px + TILE - 1.5, py + TILE).stroke(edge);
          if (walkable(x - 1, y)) g.moveTo(px + 1.5, py).lineTo(px + 1.5, py + TILE).stroke(edge);
          continue;
        }
        g.rect(px, py, TILE, TILE).fill(TILE_COLOURS[type]);
        g.rect(px + 0.5, py + 0.5, TILE - 1, TILE - 1).stroke({ width: 1, color: 0x000000, alpha: 0.18 });
        if (type === 'door' || type === 'lockedDoor') {
          g.rect(px + TILE * 0.3, py + TILE * 0.3, TILE * 0.4, TILE * 0.4).fill({ color: 0x000000, alpha: 0.25 });
        }
        if (type === 'stairs') {
          for (let k = 0; k < 4; k++) g.rect(px + 6, py + 6 + k * 8, TILE - 12 - k * 6, 4).fill({ color: 0xffffff, alpha: 0.25 });
        }
      }
    }
    this.drawFog(def, dungeon);
  }

  /**
   * Darkness over the map: black where unseen, half-dark where remembered,
   * and fading light around the party (or a whole lit room). Blurred, so edges are soft.
   */
  private drawFog(def: DungeonDefinition, dungeon: DungeonState): void {
    const visible = visibleFrom(def, dungeon.pos);
    const litRooms = roomsLitFrom(def, dungeon.pos);
    const inLitRoom = (x: number, y: number) =>
      litRooms.some((r) => x >= r.x - 1 && x <= r.x + r.width && y >= r.y - 1 && y <= r.y + r.height);
    const f = this.fog.clear();
    // A margin of solid dark around the map so the blur does not leave a bright rim.
    f.rect(-TILE * 2, -TILE * 2, (def.width + 4) * TILE, TILE * 2).fill(0x0b0908);
    f.rect(-TILE * 2, def.height * TILE, (def.width + 4) * TILE, TILE * 2).fill(0x0b0908);
    f.rect(-TILE * 2, 0, TILE * 2, def.height * TILE).fill(0x0b0908);
    f.rect(def.width * TILE, 0, TILE * 2, def.height * TILE).fill(0x0b0908);
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        const i = y * def.width + x;
        let alpha: number;
        if (dungeon.seen[i] !== '1') alpha = 1;
        else if (!visible.has(i)) alpha = 0.58;
        else if (inLitRoom(x, y)) alpha = 0.04;
        else {
          // Light fades with distance from the party.
          const d = Math.hypot(x - dungeon.pos.x, y - dungeon.pos.y) / (SIGHT_RADIUS + 0.5);
          alpha = Math.min(0.45, d * d * 0.45);
        }
        if (alpha > 0.01) f.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x0b0908, alpha });
      }
    }
  }

  private drawPath({ dungeon }: ViewState): void {
    const g = this.pathLayer.clear();
    dungeon.path.forEach((p, i) => {
      const last = i === dungeon.path.length - 1;
      g.circle((p.x + 0.5) * TILE, (p.y + 0.5) * TILE, last ? 6 : 3).fill({ color: GOLD, alpha: last ? 0.9 : 0.6 });
    });
  }

  private disc(image: string | undefined, label: string, radius: number, border: number, dim = false): Container {
    const c = new Container();
    const tex = this.texture(image);
    const back = new Graphics().circle(0, 0, radius).fill(0x1f1a17);
    c.addChild(back);
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = radius * 2;
      const mask = new Graphics().circle(0, 0, radius).fill(0xffffff);
      sprite.mask = mask;
      c.addChild(sprite, mask);
    } else {
      const text = new Text({ text: label, style: { fill: border, fontSize: radius * 0.8, fontWeight: 'bold', fontFamily: 'Georgia, serif' } });
      text.anchor.set(0.5);
      c.addChild(text);
    }
    c.addChild(new Graphics().circle(0, 0, radius).stroke({ width: 3, color: border }));
    if (dim) c.alpha = 0.45;
    return c;
  }

  private drawMarkers({ def, dungeon }: ViewState): void {
    this.markers.removeChildren().forEach((c) => c.destroy({ children: true }));
    const seen = (f: FeatureDefinition) => dungeon.seen[f.y * def.width + f.x] === '1';

    // With the goal done, the entrance is the way out.
    const goalDone = def.features.some((f) => f.type === 'goal' && dungeon.resolved.includes(f.id));
    if (goalDone) {
      const exit = this.disc(undefined, '⇧', TILE * 0.38, GOLD);
      exit.position.set((def.start.x + 0.5) * TILE, (def.start.y + 0.5) * TILE);
      this.markers.addChild(exit);
    }

    for (const f of def.features) {
      const done = dungeon.resolved.includes(f.id);
      const cx = (f.x + 0.5) * TILE;
      const cy = (f.y + 0.5) * TILE;

      if (f.type === 'goal') {
        // The objective is known from the start.
        if (done) continue;
        const info = this.callbacks.markerFor(f);
        const m = this.disc(info.image, '★', TILE * 0.42, GOLD);
        m.position.set(cx, cy);
        if (!seen(f)) m.alpha = 0.7;
        this.markers.addChild(m);
        continue;
      }
      if (!seen(f)) continue;

      if (f.type === 'trap') {
        if (done || !dungeon.spotted.includes(f.id)) continue;
        const g = new Graphics()
          .poly([cx, cy - 13, cx + 13, cy + 10, cx - 13, cy + 10])
          .fill({ color: TRAP, alpha: 0.9 })
          .stroke({ width: 2, color: 0x1a1408 });
        const bang = new Text({ text: '!', style: { fill: 0x1a1408, fontSize: 16, fontWeight: 'bold' } });
        bang.anchor.set(0.5);
        bang.position.set(cx, cy + 2);
        this.markers.addChild(g, bang);
      } else if (f.type === 'encounter') {
        if (done) {
          const x = new Graphics()
            .moveTo(cx - 10, cy - 10)
            .lineTo(cx + 10, cy + 10)
            .moveTo(cx + 10, cy - 10)
            .lineTo(cx - 10, cy + 10)
            .stroke({ width: 4, color: QUIET, alpha: 0.8 });
          this.markers.addChild(x);
          continue;
        }
        const info = this.callbacks.markerFor(f);
        const m = this.disc(info.image, info.label, TILE * 0.44, ENEMY);
        m.position.set(cx, cy);
        if (info.count && info.count > 1) {
          const badge = new Graphics().circle(TILE * 0.32, -TILE * 0.32, 10).fill(ENEMY);
          const n = new Text({ text: String(info.count), style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' } });
          n.anchor.set(0.5);
          n.position.set(TILE * 0.32, -TILE * 0.32);
          m.addChild(badge, n);
        }
        this.markers.addChild(m);
      } else if (f.type === 'event') {
        if (done) continue;
        const info = this.callbacks.markerFor(f);
        const m = this.disc(info.image, info.label, TILE * 0.36, GOLD);
        m.position.set(cx, cy);
        this.markers.addChild(m);
      }
    }
  }

  private drawToken({ dungeon, leaderPortrait, leaderInitials, others }: ViewState): void {
    this.otherTokens.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const o of others ?? []) {
      const t = this.disc(o.portrait, o.initials, TILE * 0.36, o.fighting ? ENEMY : QUIET);
      t.position.set((o.pos.x + 0.5) * TILE, (o.pos.y + 0.5) * TILE);
      t.alpha = 0.85;
      this.otherTokens.addChild(t);
    }
    this.token.removeChildren().forEach((c) => c.destroy({ children: true }));
    const glow = new Graphics().circle(0, 0, TILE * 0.5).fill({ color: GOLD, alpha: 0.25 });
    this.token.addChild(glow, this.disc(leaderPortrait, leaderInitials, TILE * 0.42, GOLD));
    this.tokenTarget = { x: (dungeon.pos.x + 0.5) * TILE, y: (dungeon.pos.y + 0.5) * TILE };
  }

  /** Slides the token towards its tile each frame, so walking looks smooth. */
  private onTick = (): void => {
    const dx = this.tokenTarget.x - this.token.x;
    const dy = this.tokenTarget.y - this.token.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      this.token.position.set(this.tokenTarget.x, this.tokenTarget.y);
      return;
    }
    this.token.x += dx * 0.3;
    this.token.y += dy * 0.3;
  };

  /** Scrolls only when the party gets near the edge of the view. */
  private keepPartyInView(): void {
    if (!this.state) return;
    const s = this.world.scale.x;
    const { pos } = this.state.dungeon;
    const sx = this.world.x + (pos.x + 0.5) * TILE * s;
    const sy = this.world.y + (pos.y + 0.5) * TILE * s;
    const margin = Math.min(this.app.screen.width, this.app.screen.height) * 0.25;
    if (sx < margin || sy < margin || sx > this.app.screen.width - margin || sy > this.app.screen.height - margin) {
      this.centreOnParty();
    }
  }

  // ---------- input ----------

  private onPointerDown = (e: FederatedPointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (this.pointers.size === 1) {
      this.dragStart = { x: e.global.x, y: e.global.y, worldX: this.world.x, worldY: this.world.y };
      this.dragged = false;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: this.world.scale.x };
      this.dragged = true;
    }
  };

  private onPointerMove = (e: FederatedPointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
    if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, (this.pinchStart.scale * distance) / this.pinchStart.distance);
      return;
    }
    if (this.dragStart) {
      const dx = e.global.x - this.dragStart.x;
      const dy = e.global.y - this.dragStart.y;
      if (!this.dragged && Math.hypot(dx, dy) > 8) this.dragged = true;
      if (this.dragged) this.world.position.set(this.dragStart.worldX + dx, this.dragStart.worldY + dy);
    }
  };

  private onPointerUp = (e: FederatedPointerEvent): void => {
    const wasTap = this.pointers.size === 1 && !this.dragged;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.dragStart = null;
    if (!wasTap || !this.state) return;
    const local = this.world.toLocal(e.global);
    const pos = { x: Math.floor(local.x / TILE), y: Math.floor(local.y / TILE) };
    if (pos.x >= 0 && pos.y >= 0 && pos.x < this.state.def.width && pos.y < this.state.def.height) {
      this.callbacks.onTileTap(pos);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, this.world.scale.x * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  };

  private zoomAt(screenX: number, screenY: number, scale: number): void {
    const clamped = Math.min(2.5, Math.max(0.35, scale));
    const before = { x: (screenX - this.world.x) / this.world.scale.x, y: (screenY - this.world.y) / this.world.scale.y };
    this.world.scale.set(clamped);
    this.world.position.set(screenX - before.x * clamped, screenY - before.y * clamped);
  }
}
