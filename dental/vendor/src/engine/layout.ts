/**
 * Phase 2 of the arch dissection: every visible structure laid out side by side
 * on a board facing the viewer, like parts on a table.
 *
 * `shelfLayout` is a pure 2D packer: items are placed in rows ("shelves") in
 * reading order, each group (skull, upper jaw, upper teeth, …) starting a new
 * row, so the board reads top to bottom like the head. The row width is chosen
 * so the board's shape matches the viewport.
 */

export interface LayoutItem {
  key: string;
  /** footprint on the board (bounding-box width and height) */
  w: number;
  h: number;
  /** band: lower numbers are placed higher on the board */
  group: number;
  /** reading order within the group */
  order: number;
}

export interface Board {
  centers: Map<string, { x: number; y: number }>;
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

function pack(items: LayoutItem[], maxWidth: number, gap: number) {
  const rows: { items: LayoutItem[]; w: number; h: number }[] = [];
  const bands = new Map<number, LayoutItem[]>();
  for (const it of items) bands.set(it.group, [...(bands.get(it.group) ?? []), it]);
  for (const band of bands.values()) {
    // a band that needs several rows is split into rows of similar width (no short last row)
    const total = band.reduce((a, it) => a + it.w + gap, -gap);
    const target = total / Math.ceil(total / maxWidth);
    let row: (typeof rows)[number] | undefined;
    for (const it of band) {
      if (!row || (row.w + gap + it.w > target + 1e-9 && row.items.length && row.w + gap + it.w / 2 > target) || row.w + gap + it.w > maxWidth) {
        row = { items: [], w: -gap, h: 0 };
        rows.push(row);
      }
      row.items.push(it);
      row.w += gap + it.w;
      row.h = Math.max(row.h, it.h);
    }
  }
  const width = Math.max(...rows.map((r) => r.w));
  const height = rows.reduce((a, r) => a + r.h, 0) + gap * 1.5 * (rows.length - 1);
  return { rows, width, height };
}

export function shelfLayout(input: LayoutItem[], aspect: number, gap: number): Board {
  const items = [...input].sort((a, b) => a.group - b.group || a.order - b.order);
  const centers = new Map<string, { x: number; y: number }>();
  if (!items.length) return { centers, bounds: { x0: 0, x1: 0, y0: 0, y1: 0 } };

  // try a range of row widths and keep the one whose board shape is closest to the viewport
  const minW = Math.max(...items.map((i) => i.w));
  const maxW = items.reduce((a, i) => a + i.w + gap, 0);
  let best = pack(items, minW, gap);
  let bestScore = Infinity;
  for (let k = 0; k <= 48; k++) {
    const p = pack(items, minW + ((maxW - minW) * k) / 48, gap);
    const score = Math.abs(Math.log(p.width / p.height / aspect));
    if (score < bestScore - 1e-9) {
      best = p;
      bestScore = score;
    }
  }

  let y = best.height / 2;
  for (const r of best.rows) {
    let x = -r.w / 2;
    for (const it of r.items) {
      centers.set(it.key, { x: x + it.w / 2, y: y - r.h / 2 });
      x += it.w + gap;
    }
    y -= r.h + gap * 1.5;
  }
  return { centers, bounds: { x0: -best.width / 2, x1: best.width / 2, y0: -best.height / 2, y1: best.height / 2 } };
}

const LAYER_ORDER = ['tooth', 'enamel', 'dentin-coronal', 'dentin-radicular', 'cementum', 'pdl', 'pulp-chamber', 'canal'];

/** Open partitions cut from one source bone must share a board position to re-form its surface. */
export function boardAssemblyKey(meshKey: string): string {
  const upper = /^maxillary-alveolar-process-(left|right)$/.exec(meshKey);
  if (upper) return `maxilla-${upper[1]}`;
  if (meshKey === 'mandibular-alveolar-process' || meshKey === 'mandible-body' || /^mandibular-condyle-(left|right)$/.test(meshKey)) return 'mandible-body';
  const fossa = /^articular-fossa-(left|right)$/.exec(meshKey);
  if (fossa) return `temporal-bone-${fossa[1]}`;
  return meshKey;
}

export function archOrder(fdi: number): number {
  const q = Math.floor(fdi / 10);
  const pos = fdi % 10;
  return q === 1 || q === 4 ? 8 - pos : 8 + pos;
}

/**
 * Board reading rank per FDI for a shuffled board order (16 upper slots, then
 * 16 lower). Each arch keeps its own row, so a tooth can only take a slot of
 * its own arch and two teeth can never share one.
 */
export function shuffledRanks(board: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < 16; i++) {
    m.set(board[i], i);
    m.set(board[16 + i], i);
  }
  return m;
}

/**
 * Board row band and reading order for a mesh. Bands run top to bottom like the
 * head: skull and joint (with the upper nerves), maxilla and upper gingiva, upper
 * teeth, lower teeth, lower gingiva and mandible, lower nerves and vessels,
 * muscles. Each band starts a new row; within a band, sub-groups follow each other
 * in reading order. Right-side structures come first (they are on the viewer's
 * left when facing the patient).
 */
export function boardSlot(meshKey: string, cats: readonly string[], fdi: number | undefined, toothRank?: (fdi: number) => number | undefined): { group: number; order: number } {
  const side = meshKey.endsWith('-left') || meshKey.includes('-left-') ? 1 : 0;
  const slot = (band: number, sub: number, order: number) => ({ group: band, order: sub * 1000 + order });
  if (fdi !== undefined) {
    const layer = Math.max(0, LAYER_ORDER.findIndex((l) => meshKey.startsWith(`${l}-`)));
    // while Quiz shuffles positions, a tooth may take any slot of its own arch
    const rank = toothRank?.(fdi);
    return slot(fdi < 30 ? 2 : 3, 0, (rank ?? archOrder(fdi)) * 10 + layer);
  }
  const vessel = cats.includes('nerves') || cats.includes('arteries') || cats.includes('veins');
  if (/^(articular-(fossa|disc)|mandibular-condyle)/.test(meshKey)) return slot(0, 1, side * 10 + (meshKey.startsWith('articular-fossa') ? 0 : meshKey.startsWith('articular-disc') ? 1 : 2));
  if (vessel && /superior-alveolar|infraorbital|maxillary-nerve|trigeminal|descending-palatine/.test(meshKey)) return slot(0, 2, side * 10);
  if (/^(maxilla|maxillary-alveolar|palatine)/.test(meshKey)) return slot(1, 0, side * 10 + (meshKey.startsWith('maxilla-') ? 0 : meshKey.startsWith('maxillary-sinus') ? 3 : meshKey.startsWith('maxillary') ? 1 : 2));
  if (meshKey === 'gingiva-upper') return slot(1, 1, 0);
  if (meshKey === 'gingiva-lower') return slot(4, 0, 0);
  if (/^mandib/.test(meshKey)) return slot(4, 1, meshKey === 'mandible-body' ? 0 : 1);
  if (vessel) return slot(5, 0, side * 10);
  if (cats.includes('muscles')) return slot(6, 0, side * 10);
  if (cats.includes('skull')) return slot(0, 0, side * 10);
  return slot(7, 0, 0);
}
