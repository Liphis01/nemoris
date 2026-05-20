import unittest

from fastapi import HTTPException

from app.services.timeline import (
    build_timeline_range,
    date_lower_value,
    date_upper_value,
    grade_timeline_date,
    validate_timeline_data
)


def timeline_date(year, precision="year", month=None, day=None):
    return {
        "year": year,
        "month": month,
        "day": day,
        "precision": precision
    }


class TimelineBcTests(unittest.TestCase):
    def test_valid_bc_point_and_bc_to_ac_interval_are_accepted(self):
        point = validate_timeline_data({
            "timeline": {
                "kind": "point",
                "start": timeline_date(-44)
            }
        })
        interval = validate_timeline_data({
            "timeline": {
                "kind": "interval",
                "start": timeline_date(-44),
                "end": timeline_date(476)
            }
        })

        self.assertEqual(point["start"]["year"], -44)
        self.assertEqual(interval["start"]["year"], -44)
        self.assertEqual(interval["end"]["year"], 476)

    def test_year_zero_and_out_of_range_years_are_rejected(self):
        for year in [0, -10000, 10000]:
            with self.subTest(year=year):
                with self.assertRaises(HTTPException):
                    validate_timeline_data({
                        "timeline": {
                            "kind": "point",
                            "start": timeline_date(year)
                        }
                    })

    def test_one_bc_and_one_ac_are_adjacent(self):
        one_bc_year = timeline_date(-1)
        one_ac_year = timeline_date(1)
        one_bc_last_day = timeline_date(-1, "day", 12, 31)
        one_ac_first_day = timeline_date(1, "day", 1, 1)

        self.assertEqual(date_lower_value(one_ac_year) - date_upper_value(one_bc_year), 1)
        self.assertEqual(date_lower_value(one_ac_first_day) - date_lower_value(one_bc_last_day), 1)

    def test_grading_uses_no_year_zero_across_boundary(self):
        year_result = grade_timeline_date(timeline_date(1), timeline_date(-1))
        month_result = grade_timeline_date(
            timeline_date(1, "month", 1),
            timeline_date(-1, "month", 12)
        )
        day_result = grade_timeline_date(
            timeline_date(1, "day", 1, 1),
            timeline_date(-1, "day", 12, 31)
        )

        self.assertEqual(year_result["distance"], 1)
        self.assertEqual(year_result["quality"], 1)
        self.assertEqual(month_result["distance"], 1)
        self.assertEqual(month_result["quality"], 1)
        self.assertEqual(day_result["distance"], 1)
        self.assertEqual(day_result["quality"], 1)

    def test_review_range_can_span_bc_and_ac(self):
        timeline = validate_timeline_data({
            "timeline": {
                "kind": "interval",
                "start": timeline_date(-44),
                "end": timeline_date(476)
            }
        })
        review_range = build_timeline_range([{"timeline": timeline}])

        self.assertLess(review_range["start_value"], date_lower_value(timeline["start"]))
        self.assertGreater(review_range["end_value"], date_upper_value(timeline["end"]))


if __name__ == "__main__":
    unittest.main()
