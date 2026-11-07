"""Normalized passive FDS tension from the Thelen parallel element and series tendon.

Both elements carry one nonnegative tension f = F/Fmax. Their inverse
lengths add. Constants follow OpenSim Thelen2003Muscle::calcfse and calcfpe
(E0 tendon .04, E0 fibre .6, passive shape 5, toe force .33, shape 3).
This scalar law is position dependent; it has no activation or velocity term.
"""
from __future__ import annotations

import math
import sys
from functools import lru_cache

TOE_FORCE = .33
TOE_STRAIN = 99.*.04*math.exp(3.)/(166.*math.exp(3.)-67.)
LINEAR_SLOPE = .67/(.04-TOE_STRAIN)
FIBRE_LOG_SCALE = .6/5.
FIBRE_FACTOR = math.expm1(5.)
TOE_LOG_SCALE = TOE_STRAIN/3.
TOE_FACTOR = math.expm1(3.)/TOE_FORCE
TOE_END_DERIVATIVE = TOE_LOG_SCALE/(TOE_FORCE+1./TOE_FACTOR)
RELATIVE_LIMIT = 2e-13
MAX_ITERATIONS = 64
CACHE_SIZE = 512


def _length_and_slope(f: float, fibre: float, tendon: float) -> tuple[float, float]:
    if f <= sys.float_info.max/FIBRE_FACTOR:
        fibre_log = math.log1p(FIBRE_FACTOR*f)
    else:
        # Keep the same log at finite forces whose product with expm1(5)
        # would overflow; log(f + 1/B) + log(B) is equivalent.
        fibre_log = math.log(f+1./FIBRE_FACTOR)+math.log(FIBRE_FACTOR)
    fibre_length = fibre*FIBRE_LOG_SCALE*fibre_log
    fibre_slope = fibre*FIBRE_LOG_SCALE/(f+1./FIBRE_FACTOR)
    if f <= TOE_FORCE:
        strain = TOE_LOG_SCALE*math.log1p(TOE_FACTOR*f)
        derivative = TOE_LOG_SCALE/(f+1./TOE_FACTOR)
    else:
        strain = TOE_STRAIN+(f-TOE_FORCE)/LINEAR_SLOPE
        derivative = 1./LINEAR_SLOPE
    return fibre_length+tendon*strain, fibre_slope+tendon*derivative


def _parameters(fibre: float, tendon: float) -> None:
    if not (math.isfinite(fibre) and math.isfinite(tendon) and fibre > 0. and tendon > 0.):
        raise ValueError("Expected finite positive fibre and tendon lengths in metres")


def series_extension(force: float, fibre_length_m: float, tendon_length_m: float) -> float:
    """Forward check in metres at a normalized, nonnegative equilibrium tension."""
    _parameters(fibre_length_m, tendon_length_m)
    if not math.isfinite(force) or force < 0.:
        raise ValueError("Expected a finite nonnegative normalized tension")
    value, _ = _length_and_slope(force, fibre_length_m, tendon_length_m)
    if not math.isfinite(value):
        raise ArithmeticError("Series extension exceeds floating-point range")
    return value


@lru_cache(maxsize=CACHE_SIZE)
def series_force(extension_m: float, fibre_length_m: float, tendon_length_m: float) -> float:
    """Invert total extension, returning normalized tension only on a certified solve.

    A strictly increasing, concave length law bounds force error by length
    residual divided by the smallest slope on the bracket. The solve checks
    both this force radius and the reconstructed extension, with relative and
    floating-point roundoff limits. Unresolvable inputs raise explicitly.
    """
    fibre, tendon = fibre_length_m, tendon_length_m
    _parameters(fibre, tendon)
    if not math.isfinite(extension_m):
        raise ValueError("Expected finite total extension")
    if extension_m <= 0.:
        return 0.

    toe_length, toe_slope = _length_and_slope(TOE_FORCE, fibre, tendon)
    _, initial_slope = _length_and_slope(0., fibre, tendon)
    if not all(math.isfinite(v) and v > 0. for v in (initial_slope, toe_length, toe_slope)):
        raise ArithmeticError("Passive-series length scale is unrepresentable")
    if extension_m <= toe_length:
        lo = 0.
        hi = min(TOE_FORCE, extension_m/toe_slope)
        f = extension_m/initial_slope
    else:
        lo = TOE_FORCE
        linear_compliance = tendon/LINEAR_SLOPE
        if linear_compliance <= 0.:
            raise ArithmeticError("Passive-series linear compliance is unrepresentable")
        delta = extension_m-toe_length
        hi = min(sys.float_info.max, TOE_FORCE+delta/linear_compliance)
        f = TOE_FORCE+delta/toe_slope

    # Round the analytic upper bound outward, and check it with the actual law.
    hi = min(sys.float_info.max, math.nextafter(hi, math.inf))
    if _length_and_slope(hi, fibre, tendon)[0] < extension_m:
        hi = min(sys.float_info.max, 2.*hi)
        if _length_and_slope(hi, fibre, tendon)[0] < extension_m:
            raise ArithmeticError("Positive normalized tension is outside the representable bracket")
    f = min(hi, max(lo, f))
    length_tol = max(RELATIVE_LIMIT*extension_m, 16.*math.ulp(extension_m))
    for _ in range(MAX_ITERATIONS):
        length, slope = _length_and_slope(f, fibre, tendon)
        if not math.isfinite(length) or not math.isfinite(slope) or slope <= 0.:
            raise ArithmeticError("Invalid passive-series length or slope")
        residual = length-extension_m
        roundoff = 8.*max(math.ulp(length), math.ulp(extension_m))
        if residual > roundoff:
            hi = f
        elif residual < -roundoff:
            lo = f
        _, min_slope = _length_and_slope(hi, fibre, tendon)
        if hi > TOE_FORCE and lo < TOE_FORCE:
            # Allow for the rounding of the two analytic slopes at the join.
            min_slope = min(min_slope, fibre*FIBRE_LOG_SCALE/(hi+1./FIBRE_FACTOR)+tendon*TOE_END_DERIVATIVE)
        if min_slope <= 0. or not math.isfinite(min_slope):
            raise ArithmeticError("Passive-series force error bound is unrepresentable")
        radius = min(max(f-lo, hi-f), (abs(residual)+roundoff)/min_slope)
        force_tol = max(RELATIVE_LIMIT*f, 16.*math.ulp(f))
        if f > 0. and abs(residual) <= length_tol and radius <= force_tol:
            return f
        trial = f-residual/slope
        if not lo < trial < hi or trial == f:
            trial = .5*lo+.5*hi
        if trial == f:
            raise ArithmeticError("Representable normalized tension cannot meet both series tolerances")
        f = trial
    raise ArithmeticError("Passive-series inverse did not meet both tolerances within its iteration bound")

