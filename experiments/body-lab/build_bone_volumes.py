"""Build audited body-local voxel collision proxies from the displayed bones.

The source triangles can be open or non-manifold. Six directional parity votes
are therefore combined with conservative triangle/voxel-box intersections;
one lattice-step closing may bridge small gaps, but no convex hull or global
hole filling is applied. These fields are display collision proxies, not an
exact signed distance to a certified closed anatomical surface.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

HERE = Path(__file__).resolve().parent
DEFAULT_GEOMETRY = HERE / "geometry/fullbody-bones.json"
DEFAULT_OUT = HERE.parents[1] / ".runtime-cache" / "bone-volume-build"
PROTOTYPE = (
    "pelvis",
    "femur_r",
    "scapula_r",
    "humerus_r",
    "clavicle_r",
    "tibia_r",
    "rib2_R",
    "femur_l",
    "scapula_l",
    "humerus_l",
    "clavicle_l",
    "tibia_l",
)


def load_body_mesh(data, body):
    points, faces = [], []
    offset = 0
    for record in body["meshes"]:
        mesh = data["meshes"][str(record.get("file", record.get("mesh")))]
        local = np.asarray(mesh["positions"], dtype=np.float64).reshape(-1, 3)
        matrix = np.asarray(record["matrix"], dtype=np.float64).reshape(4, 4).T
        points.append(local @ matrix[:3, :3].T + matrix[:3, 3])
        faces.append(
            np.asarray(mesh["indices"], dtype=np.int64).reshape(-1, 3) + offset
        )
        offset += len(local)
    points, faces = np.concatenate(points), np.concatenate(faces)
    # Weld exact/export-roundoff duplicate positions, not nearby anatomy.
    _, representatives, inverse = np.unique(
        np.round(points, 9), axis=0, return_index=True, return_inverse=True
    )
    points = points[representatives]
    faces = inverse[faces]
    area = np.linalg.norm(
        np.cross(
            points[faces[:, 1]] - points[faces[:, 0]],
            points[faces[:, 2]] - points[faces[:, 0]],
        ),
        axis=1,
    )
    faces = faces[area > 1e-16]
    before = len(faces)
    _, keep = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    faces = faces[np.sort(keep)]
    edges = np.sort(
        np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]])), axis=1
    )
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return (
        points,
        faces,
        {
            "duplicateFacesRemoved": before - len(faces),
            "boundaryEdges": int(np.sum(counts == 1)),
            "nonmanifoldEdges": int(np.sum(counts > 2)),
        },
    )


def grid_for(points, max_dim=192):
    low, high = points.min(0), points.max(0)
    largest = float(np.max(high - low))
    h = max(float(np.clip(largest / 120.0, 0.0005, 0.0015)), largest / (max_dim - 7))
    origin = low - 3 * h
    dimensions = np.ceil((high - low) / h).astype(int) + 7
    return origin, h, dimensions


def parity_votes(triangles, origin, h, dims):
    """Both directions on three orthogonal axes; no face orientation needed."""
    votes = np.zeros(tuple(dims[::-1]), dtype=np.uint8)
    for axis in range(3):
        uv = [i for i in range(3) if i != axis]
        # Array order is [axial, second projected axis, first projected axis].
        crossings = np.zeros((dims[axis] + 1, dims[uv[1]], dims[uv[0]]), dtype=bool)
        jitter = np.array([0.000017, -0.000023]) * h
        for tri in triangles:
            p = tri[:, uv]
            a, b, c = p
            determinant = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(determinant) < 1e-18:
                continue
            lo = np.maximum(
                0, np.ceil((p.min(0) - origin[uv] - jitter) / h).astype(int)
            )
            hi = np.minimum(
                dims[uv] - 1, np.floor((p.max(0) - origin[uv] - jitter) / h).astype(int)
            )
            if np.any(hi < lo):
                continue
            ii, jj = np.meshgrid(
                np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1)
            )
            xx = origin[uv[0]] + ii.ravel() * h + jitter[0] - a[0]
            yy = origin[uv[1]] + jj.ravel() * h + jitter[1] - a[1]
            b1 = (xx * (c[1] - a[1]) - yy * (c[0] - a[0])) / determinant
            b2 = ((b[0] - a[0]) * yy - (b[1] - a[1]) * xx) / determinant
            valid = (b1 >= 0) & (b2 >= 0) & (b1 + b2 <= 1)
            if not np.any(valid):
                continue
            depth = (
                tri[0, axis]
                + b1[valid] * (tri[1, axis] - tri[0, axis])
                + b2[valid] * (tri[2, axis] - tri[0, axis])
            )
            # Samples exactly on a surface are protected by the triangle shell.
            start = np.clip(
                np.floor((depth - origin[axis]) / h).astype(int) + 1, 0, dims[axis]
            )
            np.logical_xor.at(
                crossings, (start, jj.ravel()[valid], ii.ravel()[valid]), True
            )
        forward = np.logical_xor.accumulate(crossings, axis=0)
        reverse = forward[:-1] ^ forward[-1:]
        combined = forward[:-1].astype(np.uint8) + reverse.astype(np.uint8)
        source_axes = [axis, uv[1], uv[0]]
        votes += combined.transpose([source_axes.index(i) for i in (2, 1, 0)])
    return votes


def triangle_shell(triangles, origin, h, dims):
    """Conservative triangle/AABB SAT at each potentially intersected voxel."""
    shell = np.zeros(tuple(dims[::-1]), dtype=bool)
    basis = np.eye(3)
    for tri in triangles:
        lo = np.maximum(0, np.ceil((tri.min(0) - origin) / h - 0.5 - 1e-10).astype(int))
        hi = np.minimum(
            dims - 1, np.floor((tri.max(0) - origin) / h + 0.5 + 1e-10).astype(int)
        )
        if np.any(hi < lo):
            continue
        zz, yy, xx = np.meshgrid(
            np.arange(lo[2], hi[2] + 1),
            np.arange(lo[1], hi[1] + 1),
            np.arange(lo[0], hi[0] + 1),
            indexing="ij",
        )
        indices = np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))
        centers = origin + indices * h
        edges = np.roll(tri, -1, axis=0) - tri
        axes = [np.cross(edges[0], edges[1])]
        axes.extend(np.cross(edge, b) for edge in edges for b in basis)
        for a in axes:
            if np.linalg.norm(a) < 1e-15:
                continue
            projection = tri @ a
            center_projection = centers @ a
            radius = 0.5 * h * np.sum(np.abs(a))
            ok = (center_projection + radius >= projection.min() - 1e-14) & (
                center_projection - radius <= projection.max() + 1e-14
            )
            centers, indices = centers[ok], indices[ok]
            if not len(indices):
                break
        if len(indices):
            shell[indices[:, 2], indices[:, 1], indices[:, 0]] = True
    return shell


def winding_number(points, triangles):
    """Signed solid-angle sum; global triangle winding reversal is harmless.

    This is a confidence heuristic for open meshes, not a closed-mesh proof.
    The caller uses it only where directional rays disagree, per connected
    component, so disjoint or oppositely oriented bones cannot cancel.
    """
    values = np.empty(len(points))
    for start in range(0, len(points), 32):
        query = points[start : start + 32, None, :]
        a, b, c = (triangles[None, :, i] - query for i in range(3))
        la, lb, lc = (np.linalg.norm(v, axis=2) for v in (a, b, c))
        numerator = np.sum(a * np.cross(b, c), axis=2)
        denominator = (
            la * lb * lc
            + np.sum(a * b, axis=2) * lc
            + np.sum(b * c, axis=2) * la
            + np.sum(c * a, axis=2) * lb
        )
        values[start : start + len(query)] = np.sum(
            2 * np.arctan2(numerator, denominator), axis=1
        ) / (4 * np.pi)
    return values


def sample_field(field, points, origin, h):
    coords = ((points - origin) / h).T[::-1]
    return ndimage.map_coordinates(
        field, coords, order=1, mode="nearest", prefilter=False
    )


def surface_samples(triangles, spacing):
    for tri in triangles:
        n = max(
            1,
            int(
                np.ceil(
                    max(
                        np.linalg.norm(tri[i] - tri[j])
                        for i, j in ((0, 1), (1, 2), (2, 0))
                    )
                    / spacing
                )
            ),
        )
        # Dense face samples include the edges and vertices; bounded per triangle.
        rows = []
        for i in range(n + 1):
            j = np.arange(n - i + 1)
            rows.append(
                tri[0]
                + (i / n) * (tri[1] - tri[0])
                + (j / n)[:, None] * (tri[2] - tri[0])
            )
        yield np.concatenate(rows)


def triangle_distance(points, vertices, faces):
    """Complete triangle distance, including edges, with bounded batch memory."""
    a, b, c = np.moveaxis(vertices[faces], 1, 0)
    ab, ac = b - a, c - a
    normal = np.cross(ab, ac)
    nn = np.sum(normal * normal, axis=1)
    ab2, ac2 = np.sum(ab * ab, axis=1), np.sum(ac * ac, axis=1)
    abac = np.sum(ab * ac, axis=1)
    denominator = np.maximum(ab2 * ac2 - abac * abac, 1e-30)
    values = []
    for start in range(0, len(points), 32):
        p = points[start : start + 32, None, :]
        ap = p - a
        dapab, dapac = np.sum(ap * ab, axis=2), np.sum(ap * ac, axis=2)
        u = (ac2 * dapab - abac * dapac) / denominator
        v = (ab2 * dapac - abac * dapab) / denominator
        plane = np.sum(ap * normal, axis=2) ** 2 / np.maximum(nn, 1e-30)
        best = np.where(
            (u >= 0) & (v >= 0) & (u + v <= 1) & (nn > 1e-24), plane, np.inf
        )
        for e0, e1 in ((a, b), (b, c), (c, a)):
            edge = e1 - e0
            delta = p - e0
            t = np.clip(
                np.sum(delta * edge, axis=2)
                / np.maximum(np.sum(edge * edge, axis=1), 1e-30),
                0,
                1,
            )
            best = np.minimum(best, np.sum((delta - t[:, :, None] * edge) ** 2, axis=2))
        values.append(np.sqrt(best.min(axis=1)))
    return np.concatenate(values)


def zero_surface_samples(field, origin, h, count=2048):
    pieces = []
    for axis in range(3):
        first, second = [slice(None)] * 3, [slice(None)] * 3
        first[axis], second[axis] = slice(None, -1), slice(1, None)
        a, b = field[tuple(first)], field[tuple(second)]
        where = np.argwhere((a < 0) != (b < 0))
        if not len(where):
            continue
        where = where[
            np.linspace(0, len(where) - 1, min(count, len(where))).astype(int)
        ]
        indices = tuple(where.T)
        weight = a[indices] / (a[indices] - b[indices])
        sample = where.astype(float)
        sample[:, axis] += weight
        pieces.append(origin + sample[:, ::-1] * h)
    points = np.concatenate(pieces)
    if len(points) > count:
        points = points[np.linspace(0, len(points) - 1, count).astype(int)]
    return points


def unsigned_triangle_band(triangles, origin, h, dims, band):
    """Exact triangle distance at grid nodes within a finite near-surface band."""
    distance = np.full(tuple(dims[::-1]), np.inf)
    for tri in triangles:
        lo = np.maximum(0, np.ceil((tri.min(0) - band - origin) / h).astype(int))
        hi = np.minimum(
            dims - 1, np.floor((tri.max(0) + band - origin) / h).astype(int)
        )
        if np.any(hi < lo):
            continue
        a, b, c = tri
        ab, ac = b - a, c - a
        normal = np.cross(ab, ac)
        normal_length = np.linalg.norm(normal)
        if normal_length <= 1e-15:
            continue
        normal /= normal_length
        ab2, ac2, abac = ab @ ab, ac @ ac, ab @ ac
        denominator = max(ab2 * ac2 - abac * abac, 1e-30)
        for z0 in range(lo[2], hi[2] + 1, 16):
            zz, yy, xx = np.meshgrid(
                np.arange(z0, min(z0 + 16, hi[2] + 1)),
                np.arange(lo[1], hi[1] + 1),
                np.arange(lo[0], hi[0] + 1),
                indexing="ij",
            )
            indices = np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))
            p = origin + indices * h
            delta = p - a
            plane = delta @ normal
            possible = np.abs(plane) <= band
            indices, p, delta, plane = (
                indices[possible],
                p[possible],
                delta[possible],
                plane[possible],
            )
            if not len(indices):
                continue
            pab, pac = delta @ ab, delta @ ac
            u, v = (
                (ac2 * pab - abac * pac) / denominator,
                (ab2 * pac - abac * pab) / denominator,
            )
            best = np.where((u >= 0) & (v >= 0) & (u + v <= 1), plane * plane, np.inf)
            for e0, e1 in ((a, b), (b, c), (c, a)):
                edge, dp = e1 - e0, p - e0
                t = np.clip((dp @ edge) / max(float(edge @ edge), 1e-30), 0, 1)
                best = np.minimum(best, np.sum((dp - t[:, None] * edge) ** 2, axis=1))
            close = best <= band * band
            indices, best = indices[close], np.sqrt(best[close])
            key = (indices[:, 2], indices[:, 1], indices[:, 0])
            distance[key] = np.minimum(distance[key], best)
    return distance


def local_surface_correction(field, triangles, origin, h):
    """Only lower nearby lattice nodes needed to contain sampled source faces.

    Each point's eight trilinear weights define a minimum-norm lowering. Taking
    the componentwise maximum over constraints preserves every containment
    inequality without shifting the whole bone because of one sharp corner.
    """
    correction = np.zeros(field.size)
    dims = np.asarray(field.shape[::-1])
    count, positive = 0, -np.inf
    for samples in surface_samples(triangles, h / 3):
        value = sample_field(field, samples, origin, h)
        count += len(samples)
        positive = max(positive, float(value.max()))
        valid = value > -1e-6
        if not np.any(valid):
            continue
        coords = (samples[valid] - origin) / h
        lower = np.floor(coords).astype(int)
        lower = np.clip(lower, 0, dims - 2)
        fraction = coords - lower
        weights, indices = [], []
        for z in (0, 1):
            for y in (0, 1):
                for x in (0, 1):
                    corner = np.array([x, y, z])
                    weight = np.prod(np.where(corner, fraction, 1 - fraction), axis=1)
                    index = lower + corner
                    weights.append(weight)
                    indices.append(
                        index[:, 0] + dims[0] * (index[:, 1] + dims[1] * index[:, 2])
                    )
        weights = np.asarray(weights)
        magnitude = (value[valid] + 1e-6) / np.sum(weights * weights, axis=0)
        for index, weight in zip(indices, weights, strict=True):
            np.maximum.at(correction, index, magnitude * weight)
    return (
        (field - correction.reshape(field.shape)).astype("<f4"),
        count,
        positive,
        float(correction.max()),
    )


def build_volume(points, faces, max_dim=192, subvoxel=False):
    origin, h, dims = grid_for(points, max_dim)
    triangles = points[faces]
    edge = np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]))
    graph = coo_matrix(
        (np.ones(len(edge), dtype=np.uint8), (edge[:, 0], edge[:, 1])),
        shape=(len(points), len(points)),
    )
    component_count, labels = connected_components(graph, directed=False)
    votes = np.zeros(tuple(dims[::-1]), dtype=np.uint8)
    solid = np.zeros_like(votes, dtype=bool)
    winding_queries, winding_flips, winding_borderline = 0, 0, 0
    for label in np.unique(labels[faces[:, 0]]):
        # Union components instead of XORing their enclosed overlapping regions.
        part = triangles[labels[faces[:, 0]] == label]
        part_votes = parity_votes(part, origin, h, dims)
        part_solid = part_votes >= 4
        if subvoxel:
            uncertain = np.argwhere((part_votes > 0) & (part_votes < 6))
            if len(uncertain):
                query = origin + uncertain[:, ::-1] * h
                confidence = np.abs(winding_number(query, part))
                key = tuple(uncertain.T)
                resolved = confidence >= 0.5
                winding_flips += int(np.sum(part_solid[key] != resolved))
                winding_borderline += int(np.sum(np.abs(confidence - 0.5) < 0.05))
                winding_queries += len(uncertain)
                part_solid[key] = resolved
        solid |= part_solid
        np.maximum(votes, part_votes, out=votes)
    shell = triangle_shell(triangles, origin, h, dims)
    occupied = solid | shell
    closed = ndimage.binary_closing(
        occupied,
        structure=ndimage.generate_binary_structure(3, 1),
        iterations=1,
        border_value=0,
    )
    added = closed & ~occupied
    occupied |= closed
    # Distances from opposite class centers, offset half a cell at the interface.
    outside = ndimage.distance_transform_edt(~occupied) * h - 0.5 * h
    inside = ndimage.distance_transform_edt(occupied) * h - 0.5 * h
    field = np.where(occupied, -inside, outside)
    if subvoxel:
        unsigned = unsigned_triangle_band(triangles, origin, h, dims, 4 * h)
        near = np.isfinite(unsigned)
        corrected = np.where(solid, -unsigned, unsigned)
        x = np.clip((unsigned[near] - 2 * h) / (2 * h), 0, 1)
        blend = x**3 * (x * (x * 6 - 15) + 10)
        field[near] = corrected[near] * (1 - blend) + field[near] * blend
    if subvoxel:
        field, count, positive, maximum_correction = local_surface_correction(
            field, triangles, origin, h
        )
        offset = 0.0
    else:
        count, positive = 0, -np.inf
        for samples in surface_samples(triangles, h / 3):
            values = sample_field(field, samples, origin, h)
            count += len(samples)
            positive = max(positive, float(np.max(values)))
        offset = max(0.0, positive) + 1e-6
        maximum_correction = offset
        field = (field - offset).astype("<f4")
    maximum_after = -np.inf
    for samples in surface_samples(triangles, h / 3):
        maximum_after = max(
            maximum_after, float(np.max(sample_field(field, samples, origin, h)))
        )
    zero_points = zero_surface_samples(field, origin, h)
    zero_distances = triangle_distance(zero_points, points, faces)
    audit = {
        "voxelSizeM": h,
        "dimensions": dims.tolist(),
        "voxelCount": int(field.size),
        "shellVoxels": int(shell.sum()),
        "interiorVoxels": int(occupied.sum()),
        "oneStepClosingAddedVoxels": int(added.sum()),
        "ambiguousVoteRatio": float(np.mean((votes > 0) & (votes < 6))),
        "voteHistogram": np.bincount(votes.ravel(), minlength=7).tolist(),
        "windingQueries": winding_queries,
        "windingChangedVoteClassification": winding_flips,
        "windingBorderlineQueries": winding_borderline,
        "sourceSamples": count,
        "components": int(component_count),
        "voteMeaning": "Maximum six-direction vote count among connected triangle components; occupied interiors are their union.",
        "surfacePositiveMaxBeforeM": positive,
        "interpolationOutwardOffsetM": offset,
        "maximumLocalContainmentCorrectionM": maximum_correction,
        "surfacePositiveMaxM": maximum_after,
        "zeroSurfaceSamples": len(zero_points),
        "zeroSurfaceDistanceP50M": float(np.median(zero_distances)),
        "zeroSurfaceDistanceP95M": float(np.quantile(zero_distances, 0.95)),
        "zeroSurfaceDistanceMaxM": float(np.max(zero_distances)),
        "subvoxelTriangleBand": bool(subvoxel),
        "distanceMeaning": "Near nodes use true unsigned triangle distance. Six-direction ray disagreement is resolved by absolute generalized winding >=0.5 within each connected triangle component; source-face constraints lower only adjacent lattice nodes. Far field blends to voxel EDT. Exterior positive, interior negative; not an exact closed-mesh SDF."
        if subvoxel
        else "Voxel proxy signed EDT; exterior positive, interior negative. Not exact signed distance to original triangles.",
        "closure": "At most one 6-neighbour lattice closing step; no convex hull and no fill_holes.",
    }
    return field, votes, shell, occupied, origin, h, audit


def pack_sparse_bricks(field, first_brick, brick_size=8, outside_distance=0.01):
    """Exact retained values; omitted blocks are strictly outside the margin."""
    dimensions = np.asarray(field.shape[::-1])
    brick_dimensions = (dimensions + brick_size - 1) // brick_size
    lookup = np.full(tuple(brick_dimensions[::-1]), -1, dtype="<f4")
    bricks = []
    for z in range(brick_dimensions[2]):
        for y in range(brick_dimensions[1]):
            for x in range(brick_dimensions[0]):
                block = field[
                    z * brick_size : (z + 1) * brick_size,
                    y * brick_size : (y + 1) * brick_size,
                    x * brick_size : (x + 1) * brick_size,
                ]
                if np.all(block > outside_distance):
                    continue
                brick = np.full((brick_size,) * 3, outside_distance, dtype="<f4")
                brick[: block.shape[0], : block.shape[1], : block.shape[2]] = block
                index = first_brick + len(bricks)
                if index >= 2**24:
                    raise ValueError(
                        "Sparse brick IDs exceed exact Float32 integer range"
                    )
                lookup[z, y, x] = index
                bricks.append(brick.tobytes())
    return lookup, bricks, brick_dimensions.tolist()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geometry", type=Path, default=DEFAULT_GEOMETRY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--bodies", nargs="*", default=list(PROTOTYPE))
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--max-dim", type=int, default=192)
    parser.add_argument("--subvoxel", action="store_true")
    parser.add_argument("--sparse", action="store_true")
    args = parser.parse_args()
    if args.max_dim < 32 or args.max_dim > 384:
        parser.error("--max-dim must be in [32,384]")
    raw = args.geometry.read_bytes()
    data = json.loads(raw)
    wanted = {b["name"] for b in data["bodies"]} if args.all else set(args.bodies)
    missing = wanted - {b["name"] for b in data["bodies"]}
    if missing:
        raise ValueError(f"Unknown bodies: {sorted(missing)}")
    args.out.mkdir(parents=True, exist_ok=True)
    blocks, records, lookups = [], [], []
    float_offset = 0
    brick_count = 0
    lookup_offset = 0
    for body in data["bodies"]:
        if body["name"] not in wanted:
            continue
        began = time.perf_counter()
        points, faces, topology = load_body_mesh(data, body)
        field, votes, shell, occupied, origin, h, audit = build_volume(
            points, faces, args.max_dim, args.subvoxel
        )
        audit.update(topology)
        audit["buildSeconds"] = time.perf_counter() - began
        audit["sourceMeshSha256"] = hashlib.sha256(
            points.astype("<f8").tobytes() + faces.astype("<i8").tobytes()
        ).hexdigest()
        record = {
            "name": body["name"],
            "origin": origin.tolist(),
            "spacing": [h, h, h],
            "dimensions": list(field.shape[::-1]),
            "audit": audit,
        }
        if args.sparse:
            lookup, bricks, brick_dimensions = pack_sparse_bricks(field, brick_count)
            record.update(
                lookupOffset=lookup_offset,
                brickDimensions=brick_dimensions,
                occupiedBricks=len(bricks),
            )
            lookups.append(lookup.tobytes())
            blocks.extend(bricks)
            lookup_offset += lookup.size
            brick_count += len(bricks)
        else:
            record["floatOffset"] = float_offset
            blocks.append(field.tobytes())
            float_offset += field.size
        records.append(record)
        np.savez_compressed(
            args.out / (body["name"] + "-audit.npz"),
            field=field,
            votes=votes,
            shell=shell,
            occupied=occupied,
            points=points,
            faces=faces,
            origin=origin,
            spacing=h,
        )
        print(
            json.dumps(
                {
                    "body": body["name"],
                    "seconds": audit["buildSeconds"],
                    "grid": list(field.shape[::-1]),
                    "sourcePositiveMaxM": audit["surfacePositiveMaxM"],
                }
            ),
            flush=True,
        )
    binary = b"".join(lookups + blocks)
    manifest = {
        "version": 1,
        "storage": "sparse-bricks" if args.sparse else "dense",
        "coordinateSystem": "body-local native",
        "binaryFile": "bone-volumes.bin",
        "binarySha256": hashlib.sha256(binary).hexdigest(),
        "byteLength": len(binary),
        "sourceGeometrySha256": hashlib.sha256(raw).hexdigest(),
        "bones": records,
        "limitations": [
            "Rasterized display collision proxies, not a full-body soft-tissue solver.",
            "Open/non-manifold source geometry and finite voxel spacing require visual validation.",
            "Source sample containment does not prove exact continuous triangle containment or muscle-muscle separation.",
        ],
    }
    if args.sparse:
        manifest.update(
            brickSize=8,
            brickDataOffset=lookup_offset,
            outsideDistanceM=0.01,
            brickCount=brick_count,
        )
    (args.out / "bone-volumes.bin").write_bytes(binary)
    (args.out / "bone-volumes.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8"
    )
    print(
        json.dumps(
            {
                "bones": len(records),
                "bytes": len(binary),
                "binarySha256": manifest["binarySha256"],
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
