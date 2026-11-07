"""Pure scalar comparisons with independent Decimal bisection; no native model."""
import math
import unittest
from decimal import Decimal, localcontext

import passive_series as S


def oracle(extension, fibre, tendon):
    """Solve a different parameterization: balance forces at a fibre/tendon split."""
    with localcontext() as ctx:
        ctx.prec = max(82, 65-math.floor(math.log10(extension)))
        x, lf, lt = map(Decimal.from_float, (extension, fibre, tendon))
        one, three, five = Decimal(1), Decimal(3), Decimal(5)
        ef, toe_force, e0 = Decimal(".6"), Decimal(".33"), Decimal(".04")
        exp3 = three.exp()
        toe = 99*e0*exp3/(166*exp3-67)
        toe_extension = lt*toe
        def fibre_force(dx):
            return ((five*dx/(ef*lf)).exp()-one)/(five.exp()-one)
        def tendon_force(dx):
            if dx <= toe_extension:
                return toe_force*((three*dx/toe_extension).exp()-one)/(exp3-one)
            return toe_force+(one-toe_force)*(dx/lt-toe)/(e0-toe)
        left, right = Decimal(0), x
        for _ in range(100):
            mid = (left+right)/2
            if fibre_force(mid) < tendon_force(x-mid):
                left = mid
            else:
                right = mid
        return float(fibre_force((left+right)/2))


class PassiveSeriesTests(unittest.TestCase):
    def test_slack_is_zero_and_invalid_parameters_are_rejected(self):
        for x in (-1., -0., 0.):
            self.assertEqual(S.series_force(x, .08, .12), 0.)
        for args in ((math.nan, .1, .2), (0., 0., .2), (0., .1, math.inf), (.01, .1, -.1)):
            with self.subTest(args=args), self.assertRaises(ValueError):
                S.series_force(*args)

    def test_first_positive_through_both_tendon_branches(self):
        for x, fibre, tendon in ((1e-160, .07, .18), (1e-15, .02, .19), (2e-5, .18, .009),
                                 (.015, .05, .07), (.04, .06, .13), (.35, .09, .12)):
            with self.subTest(x=x, fibre=fibre, tendon=tendon):
                got = S.series_force(x, fibre, tendon)
                expected = oracle(x, fibre, tendon)
                self.assertGreater(got, 0.)
                self.assertLessEqual(abs(got-expected), max(3e-13*expected, 20*math.ulp(expected)))
                self.assertLessEqual(abs(S.series_extension(got, fibre, tendon)-x), max(2e-13*x, 16*math.ulp(x)))

    def test_toe_join_and_high_forces_have_no_artificial_plateau(self):
        fibre, tendon = .035, .21
        values = (1e-200, S.TOE_FORCE*(1.-1e-7), S.TOE_FORCE, S.TOE_FORCE*(1.+1e-7), 1., 200., 1e300)
        solved = []
        for target in values:
            x = S.series_extension(target, fibre, tendon)
            f = S.series_force(x, fibre, tendon)
            self.assertLessEqual(abs(f-target), max(3e-13*target, 20*math.ulp(target)))
            solved.append(f)
        self.assertEqual(solved, sorted(set(solved)))

    def test_exact_length_and_material_cache_is_bounded(self):
        S.series_force.cache_clear()
        try:
            one = S.series_force(.01, .08, .12)
            hit = S.series_force(.01, .08, .12)
            self.assertEqual(hit, one)
            self.assertEqual(S.series_force.cache_info().hits, 1)
            self.assertNotEqual(S.series_force(.01, .09, .12), one)
            self.assertNotEqual(S.series_force(.01, .08, .2), one)
            S.series_force(math.nextafter(.01, math.inf), .08, .12)
            self.assertEqual(S.series_force.cache_info().misses, 4)
            for i in range(S.CACHE_SIZE+9):
                S.series_force(.005+i*1e-6, .05, .11)
            self.assertEqual(S.series_force.cache_info().currsize, S.CACHE_SIZE)
        finally:
            S.series_force.cache_clear()


if __name__ == "__main__":
    unittest.main()

