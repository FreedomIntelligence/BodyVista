"""Declared mechanical additions for the MS740 motion-repair research model.

The shoulder coefficient retains the source parameter magnitude. It is an
engineering approximation, not an individually measured joint property.
"""

import mujoco
import numpy as np


SHOULDER_DAMPING_NMS_PER_RAD = 0.6
SHOULDER_PARAMETER_COORDINATES = tuple(
    f"{stem}_{side}"
    for side in "rl"
    for stem in (
        "unrotscap_r2", "unrotscap_r3", "unrothum_r1", "unrothum_r2",
        "unrothum_r3", "shoulder1_r2", "elv_angle", "shoulder_elv", "shoulder_rot",
    )
)


def shoulder_passive_forces(ctx, data):
    """Apply equal/opposite damping to real humerus/scapula angular velocity.

    J = J_humerus - J_scapula, Q = -c J.T J qdot. Thus power is always
    -c ||J qdot||^2 <= 0, including at the shoulder parameterization poles.
    This force is independent of recruitment residuals and supplies no actuator.
    """
    model = ctx.model
    force = np.zeros(model.nv)
    for side in "rl":
        child = np.zeros((3, model.nv))
        parent = np.zeros((3, model.nv))
        mujoco.mj_jacBody(model, data, None, child, ctx.body_ids[f"humerus_{side}"])
        mujoco.mj_jacBody(model, data, None, parent, ctx.body_ids[f"scapula_{side}"])
        relative = child - parent
        omega = relative @ data.qvel
        force -= relative.T @ (SHOULDER_DAMPING_NMS_PER_RAD * omega)
    return force


def tendon_branch_paths(data, tendon, definitions, world):
    """Split native wrap points at pulley markers instead of joining branches.

    MuJoCo stores -2 for a pulley in wrap_obj. A pulley starts a new path;
    its wrap_xpos entry is not a physical point on the muscle.
    """
    start, count = int(data.ten_wrapadr[tendon]), int(data.ten_wrapnum[tendon])
    points = data.wrap_xpos.reshape(-1, 3)
    objects = data.wrap_obj.reshape(-1)
    paths = [[]]
    for index in range(start, start + count):
        if objects[index] == -2:
            if paths[-1]:
                paths.append([])
        else:
            paths[-1].append(np.round(world @ points[index], 6).tolist())
    paths = [path for path in paths if path]
    if len(paths) != len(definitions) or any(len(path) < 2 for path in paths):
        raise RuntimeError("Native tendon branches do not match the model declaration")
    return [{**definition, "path": path, "force": None}
            for definition, path in zip(definitions, paths)]
