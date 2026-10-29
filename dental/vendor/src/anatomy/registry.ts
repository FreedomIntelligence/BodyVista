/**
 * Structure registry: the single source of truth for anatomy in the app.
 * Built once from the asset manifest + declarative tables.
 */
import { STRUCTURE_DEFS } from './structures.ts';
import { featureNames } from './surfaceFeatures.ts';
import { DEVELOPMENT_TEETH, developmentId } from './development.ts';
import { DEVELOPMENT_TEXT } from '../i18n/development.ts';
import { LANGS } from '../i18n/lang.ts';
import {
  PERMANENT_FDI,
  archOf,
  notationFor,
  sideOf,
  toothAliases,
  toothName,
  typeOf,
} from './notation.ts';
import type { CategoryId, Manifest, ManifestMesh, RootInfo, Structure, Vec3 } from './types.ts';
import {
  PART_ALIASES,
  STRUCTURE_SHORT,
  apicalForamenNames,
  canalNames,
  partNames,
  partShort,
  pulpHornNames,
  rootNames,
  structureAliases,
  structureNames,
  toothNameIn,
  toothSearchAliases,
  type Names,
  type PartKey,
} from '../i18n/anatomy.ts';

/** Translated names as extra search terms. */
const nameTerms = (n: Names) => [n.sv, n.de, n.es, n.la];

const QUADRANT_GROUP: Record<number, string> = {
  1: 'upper-right-quadrant',
  2: 'upper-left-quadrant',
  3: 'lower-left-quadrant',
  4: 'lower-right-quadrant',
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class Registry {
  readonly byId = new Map<string, Structure>();
  /** mesh key → owning (most specific) structure id */
  readonly meshOwner = new Map<string, string>();
  readonly manifest: Manifest;
  readonly rootId = 'dental-anatomy';

  constructor(manifest: Manifest) {
    this.manifest = manifest;
    this.buildStatic();
    this.buildTeeth();
    this.buildDevelopment();
    this.link();
  }

  /* ------------------------------------------------------------ build */

  private add(s: Structure) {
    if (this.byId.has(s.id)) throw new Error(`Duplicate structure id ${s.id}`);
    this.byId.set(s.id, s);
  }

  private meshInfo(key: string): ManifestMesh | undefined {
    return this.manifest.meshes[key];
  }

  private buildStatic() {
    for (const d of STRUCTURE_DEFS) {
      const meshes = (d.meshes ?? []).filter((m) => this.meshInfo(m));
      const kind = d.kind ?? (d.landmark ? 'landmark' : meshes.length ? 'mesh' : 'group');
      const info = meshes[0] ? this.meshInfo(meshes[0]) : undefined;
      const names = structureNames(d.id, d.name) ?? { en: d.name, sv: d.name, de: d.name, es: d.name, la: d.name };
      const short = d.shortName ? STRUCTURE_SHORT[d.id.replace(/-(right|left)$/, '')] : undefined;
      this.add({
        id: d.id,
        name: d.name,
        names,
        kind,
        parent: d.parent,
        children: [],
        categories: d.categories ?? [],
        meshes,
        aliases: [...(d.aliases ?? []), ...structureAliases(d.id), ...nameTerms(names)],
        provenance: d.provenance ?? info?.provenance ?? 'source',
        sourceRef: info?.sourceRef,
        stage: info?.stage ?? 1,
        anchor: d.landmark ? this.manifest.landmarks[d.landmark] : undefined,
        labelPriority: d.labelPriority ?? 1,
        ...(d.regional ? { regional: true } : {}),
        shortName: d.shortName,
        shortNames: d.shortName
          ? { en: d.shortName, sv: short?.sv ?? d.shortName, de: short?.de ?? d.shortName, es: short?.es ?? d.shortName, la: short?.la ?? d.shortName }
          : undefined,
      });
    }
  }

  private buildTeeth() {
    for (const fdi of PERMANENT_FDI) {
      const mt = this.manifest.teeth[String(fdi)];
      const notation = notationFor(fdi);
      const tId = `tooth-${fdi}`;
      const layers = mt?.layers ?? [];
      const has = (layer: string) => layers.includes(layer);
      const key = (layer: string) => `${layer}-${fdi}`;
      const cats = (c: CategoryId[]): CategoryId[] => ['permanent-teeth', ...c];
      const base = { toothFdi: fdi, stage: 4 as const, provenance: 'modeled' as const };
      const shellInfo = this.meshInfo(tId);
      const tName = toothName(fdi);
      const tIn = (l: 'sv' | 'de' | 'es' | 'la') => toothNameIn(typeOf(fdi), archOf(fdi), sideOf(fdi), l);
      const tNames: Names = { en: tName, sv: tIn('sv'), de: tIn('de'), es: tIn('es'), la: tIn('la') };

      // roots and canals (typical configuration derived by the pipeline)
      const roots: RootInfo[] = (mt?.roots ?? []).map((r) => ({
        label: r.label,
        canals: r.canals.map((c) => key(c)),
      }));

      this.add({
        id: tId,
        name: tName,
        names: tNames,
        kind: 'mesh',
        parent: QUADRANT_GROUP[Math.floor(fdi / 10)],
        children: [],
        categories: ['permanent-teeth'],
        meshes: shellInfo ? [tId] : [],
        aliases: [
          ...toothAliases(fdi),
          `tooth ${fdi}`,
          `tooth ${notation.universal}`,
          `#${notation.universal}`,
          notation.palmer,
          `fdi ${fdi}`,
          `universal ${notation.universal}`,
          ...toothSearchAliases(typeOf(fdi), archOf(fdi), fdi),
          ...nameTerms(tNames),
        ],
        provenance: mt?.provenance ?? 'source',
        sourceRef: shellInfo?.sourceRef,
        stage: 1,
        toothFdi: fdi,
        tooth: {
          fdi,
          notation,
          arch: archOf(fdi),
          side: sideOf(fdi),
          type: typeOf(fdi),
          dentition: 'permanent',
          roots,
          layers: layers.map(key),
          asset: mt?.asset,
          frame: mt?.frame,
        },
        labelPriority: 5,
      });

      if (!layers.length) continue;
      // search context: the tooth's name in every language and its numbers
      const ctx = [tName.toLowerCase(), ...nameTerms(tNames).map((n) => n.toLowerCase()), `tooth ${fdi}`, `tand ${fdi}`, `zahn ${fdi}`, `diente ${fdi}`, `dens ${fdi}`, `#${notation.universal}`];
      /** part names (all languages) plus their search terms */
      const p = (k: PartKey, aliasKey: string = k) => ({ names: partNames(k), extra: [...(PART_ALIASES[aliasKey] ?? []), ...nameTerms(partNames(k))] });
      type Part = { names: Names; extra: string[] };

      const region = (id: string, part: Part, meshKeys: string[], aliases: string[]) =>
        this.add({ id, name: part.names.en, names: part.names, kind: 'region', parent: tId, children: [], categories: ['permanent-teeth'], meshes: meshKeys.filter((k) => layers.includes(k.replace(`-${fdi}`, ''))), aliases: [...aliases, ...part.extra, ...ctx], labelPriority: 3, ...base });
      region(`crown-${fdi}`, p('crown'), [key('enamel'), key('dentin-coronal')], ['anatomical crown', 'crown']);
      region(`root-${fdi}`, p(roots.length > 1 ? 'roots' : 'root', 'root'), [key('dentin-radicular'), key('cementum')], ['root', 'roots', 'radicular']);
      for (const feature of mt.surfaceFeatures ?? []) {
        const names = featureNames(feature.key);
        this.add({ id: `surface-${feature.key}-${fdi}`, name: names.en, names, kind: 'landmark', parent: `crown-${fdi}`, children: [], categories: ['permanent-teeth', 'enamel'], meshes: [], aliases: [feature.key.replaceAll('-', ' '), ...Object.values(names), ...ctx], provenance: 'schematic', stage: 4, toothFdi: fdi, anchor: feature.anchor, surfaceFeature: feature.key, labelPriority: 4 });
      }

      const mesh = (layer: string, part: Part, parent: string, c: CategoryId[], aliases: string[], prio: number, shortNames?: Names) => {
        if (!has(layer)) return;
        this.add({ id: key(layer), name: part.names.en, names: part.names, kind: 'mesh', parent, children: [], categories: cats(c), meshes: [key(layer)], aliases: [...aliases, ...part.extra, ...ctx], labelPriority: prio, shortName: shortNames?.en, shortNames, ...base });
      };
      const group = (id: string, part: Part, parent: string, c: CategoryId[], aliases: string[], prio: number) =>
        this.add({ id, name: part.names.en, names: part.names, kind: 'group', parent, children: [], categories: cats(c), meshes: [], aliases: [...aliases, ...part.extra, ...ctx], labelPriority: prio, ...base });
      const landmark = (id: string, part: Part, parent: string, c: CategoryId[], aliases: string[], anchor: Vec3, prio: number, shortNames: Names) =>
        this.add({ id, name: part.names.en, names: part.names, kind: 'landmark', parent, children: [], categories: cats(c), meshes: [], aliases: [...aliases, ...part.extra, ...ctx], anchor, labelPriority: prio, shortName: shortNames.en, shortNames, ...base });

      mesh('enamel', p('enamel'), tId, ['enamel'], ['enamel', 'tooth enamel', 'enamel cap'], 4);
      group(`dentin-${fdi}`, p('dentin'), tId, ['dentin'], ['dentin', 'dentine'], 4);
      mesh('dentin-coronal', p('dentin-coronal', 'dentin'), `dentin-${fdi}`, ['dentin'], ['dentin', 'crown dentin'], 3);
      mesh('dentin-radicular', p('dentin-radicular', 'dentin'), `dentin-${fdi}`, ['dentin'], ['dentin', 'root dentin'], 3);
      mesh('cementum', p('cementum'), tId, ['cementum'], ['cementum', 'root surface'], 3);
      group(`pulp-${fdi}`, p('pulp'), tId, ['dental-pulp'], ['pulp', 'nerve of the tooth', 'pulp tissue'], 4);
      mesh('pulp-chamber', p('pulp-chamber'), `pulp-${fdi}`, ['dental-pulp'], ['pulp chamber', 'coronal pulp', 'pulp'], 4);
      mesh('pdl', p('pdl'), tId, ['periodontal-ligament'], ['pdl', 'periodontal ligament', 'periodontal membrane'], 2, partShort('pdl'));

      // canals
      const canalIds = roots.flatMap((r) => r.canals);
      if (canalIds.length) group(`root-canals-${fdi}`, p(canalIds.length > 1 ? 'root-canals' : 'root-canal', 'root-canals'), `pulp-${fdi}`, ['dental-pulp', 'root-canals'], ['root canal', 'root canals', 'canal system', 'radicular pulp'], 3);
      const frame = mt.frame;
      for (const r of mt.roots ?? []) {
        const nCanals = r.canals.length;
        // order canals buccal → lingual using apical foramen landmarks
        const withPos = r.canals.map((c) => {
          const lm = mt.landmarks?.[`apical-foramen-${c.replace('canal-', '')}`];
          const b = lm && frame ? dot(sub(lm, frame.origin), frame.buccal) : 0;
          return { c, lm, b };
        });
        withPos.sort((a, b) => b.b - a.b);
        withPos.forEach(({ c, lm }, i) => {
          const nm = canalNames(r.label, nCanals, i, archOf(fdi));
          const canalPart = { names: nm.names, extra: [...PART_ALIASES.canal, ...nameTerms(nm.names)] };
          mesh(c, canalPart, `root-canals-${fdi}`, ['dental-pulp', 'root-canals'], ['root canal', 'canal', nm.abbr.en.toLowerCase(), `${r.label} canal`], 3, nm.abbr);
          if (lm) {
            const af = apicalForamenNames(nm.abbr);
            landmark(`apical-foramen-${c.replace('canal-', '')}-${fdi}`, { names: af, extra: [...PART_ALIASES['apical-foramen'], ...nameTerms(af)] }, key(c), ['dental-pulp', 'root-canals'], ['apical foramen', 'apex', 'foramen'], lm, 2, partShort('apical-foramen'));
          }
        });
      }
      // landmarks
      for (const [lk, pos] of Object.entries(mt.landmarks ?? {})) {
        if (lk.startsWith('pulp-horn-')) {
          const ph = pulpHornNames(lk.slice(10));
          landmark(`${lk}-${fdi}`, { names: ph, extra: [...PART_ALIASES['pulp-horn'], ...nameTerms(ph)] }, key('pulp-chamber'), ['dental-pulp'], ['pulp horn', 'pulp horns'], pos, 1, partShort('pulp-horn'));
        }
      }
      if (mt.landmarks?.['cervical-line']) {
        landmark(`cej-${fdi}`, p('cej'), tId, [], ['cej', 'cervical line', 'neck of tooth', 'cementoenamel junction'], mt.landmarks['cervical-line'], 2, partShort('cej'));
      }
      if (mt.landmarks?.apex) {
        landmark(`apex-${fdi}`, p('apex'), `root-${fdi}`, [], ['apex', 'root apex', 'root tip'], mt.landmarks.apex, 1, partShort('apex'));
      }
      // label for root structure
      const rootStruct = this.byId.get(`root-${fdi}`);
      if (rootStruct && roots.length > 1) rootStruct.aliases.push(...roots.flatMap((r) => { const n = rootNames(r.label); return n ? [n.en.toLowerCase(), ...nameTerms(n)] : [r.label]; }));
    }
  }

  private buildDevelopment() {
    const namesFor = (get: (lang: typeof LANGS[number]) => string) => Object.fromEntries(LANGS.map((lang) => [lang, get(lang)])) as Names;
    const groupNames = namesFor((lang) => DEVELOPMENT_TEXT[lang].title);
    this.add({ id: 'development-dentition', name: groupNames.en, names: groupNames, kind: 'group', parent: this.rootId, children: [], categories: [], meshes: [], aliases: nameTerms(groupNames), provenance: 'schematic', stage: 1, labelPriority: 2 });
    for (const upper of [true, false]) {
      const id = upper ? 'development-maxillary-arch' : 'development-mandibular-arch';
      const names = namesFor((lang) => DEVELOPMENT_TEXT[lang][upper ? 'upperArch' : 'lowerArch']);
      this.add({ id, name: names.en, names, kind: 'mesh', parent: 'development-dentition', children: [], categories: ['alveolar-bone'], meshes: [id], aliases: nameTerms(names), provenance: 'schematic', stage: 1, labelPriority: 2 });
    }
    for (const t of DEVELOPMENT_TEETH) {
      const id = developmentId(t.fdi);
      const names = namesFor((lang) => `${DEVELOPMENT_TEXT[lang][t.dentition === 'primary' ? 'primaryPrefix' : 'permanentPrefix']} ${toothNameIn(t.type, t.arch, t.side, lang)} (FDI ${t.fdi})`);
      this.add({ id, name: names.en, names, kind: 'mesh', parent: 'development-dentition', children: [], categories: [t.dentition === 'primary' ? 'primary-teeth' : 'permanent-teeth'], meshes: [id], aliases: [String(t.fdi), `fdi ${t.fdi}`, ...Object.values(names)], provenance: 'schematic', stage: 1, labelPriority: 4, development: t });
    }
  }

  private link() {
    for (const s of this.byId.values()) {
      if (s.parent) {
        const p = this.byId.get(s.parent);
        if (!p) throw new Error(`Missing parent ${s.parent} for ${s.id}`);
        p.children.push(s.id);
      }
      if (s.kind === 'mesh') for (const m of s.meshes) this.meshOwner.set(m, s.id);
    }
    // structures with multiple meshes where one is also its own id (e.g. mental-nerve branches)
    for (const s of this.byId.values()) for (const m of s.meshes) if (!this.meshOwner.has(m)) this.meshOwner.set(m, s.id);
  }

  /* ------------------------------------------------------------ queries */

  get(id: string): Structure | undefined {
    return this.byId.get(id);
  }

  require(id: string): Structure {
    const s = this.byId.get(id);
    if (!s) throw new Error(`Unknown structure ${id}`);
    return s;
  }

  ancestors(id: string): Structure[] {
    const out: Structure[] = [];
    let cur = this.byId.get(id)?.parent;
    while (cur) {
      const s = this.byId.get(cur);
      if (!s) break;
      out.push(s);
      cur = s.parent;
    }
    return out;
  }

  descendants(id: string): Structure[] {
    const out: Structure[] = [];
    const stack = [...(this.byId.get(id)?.children ?? [])];
    while (stack.length) {
      const s = this.byId.get(stack.pop()!)!;
      out.push(s);
      stack.push(...s.children);
    }
    return out;
  }

  isDescendant(id: string, ancestorId: string): boolean {
    if (id === ancestorId) return true;
    return this.ancestors(id).some((a) => a.id === ancestorId);
  }

  /** All mesh keys a structure resolves to (own + descendants). */
  meshesOf(id: string): string[] {
    const s = this.byId.get(id);
    if (!s) return [];
    const set = new Set(s.meshes);
    for (const d of this.descendants(id)) for (const m of d.meshes) set.add(m);
    return [...set];
  }

  categoriesOfMesh(meshKey: string): CategoryId[] {
    const owner = this.meshOwner.get(meshKey);
    if (!owner) return [];
    const s = this.byId.get(owner)!;
    // inherit categories from ancestors for structures that declare none
    if (s.categories.length) return s.categories;
    for (const a of this.ancestors(owner)) if (a.categories.length) return a.categories;
    return [];
  }

  countByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [mesh] of this.meshOwner) {
      for (const c of this.categoriesOfMesh(mesh)) {
        // The developmental permanent teeth and arches are a separate scene;
        // their copies must not inflate the adult atlas layer counts.
        if (mesh.startsWith('development-') && c !== 'primary-teeth') continue;
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    // tooth layers not yet loaded still count (they are listed in the manifest)
    return counts;
  }

  teeth(): Structure[] {
    return PERMANENT_FDI.map((f) => this.byId.get(`tooth-${f}`)!).filter(Boolean);
  }
}
