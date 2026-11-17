import os
import unittest

from shift_schduler import Calendar, Worker, load_from_json, generate_schedule

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_calendar(needed: dict, year=2026, month=2):
    """A month where only the days in `needed` have slots (DEP count per day)."""
    days = range(1, 29)
    custom = {d: {"DEP": needed.get(d, 0), "ER": 0} for d in days}
    return Calendar(year, month, custom_shifts=custom)


def assert_hard_rules(test, cal, schedule):
    for d in cal.iter_days():
        test.assertLessEqual(len(schedule[d]), cal.get_shifts_needed(d), f"day {d} overstaffed")
        test.assertEqual(len(schedule[d]), len(set(schedule[d])), f"day {d} has a duplicate")
    for w in cal.workers:
        mine = sorted(d for d in cal.iter_days() if w.name in schedule[d])
        test.assertLessEqual(len(mine), w.limit, f"{w.name} over limit")
        test.assertFalse(set(mine) & set(w.cant_work), f"{w.name} booked on a can't-work day")
        can = set(w.can_work)
        for a, b in zip(mine, mine[1:]):
            if b == a + 1:
                test.assertTrue(a in can and b in can, f"{w.name} back-to-back on {a},{b}")


class HardRules(unittest.TestCase):
    def test_project_data_files(self):
        for rel_path in ("workers.json", os.path.join("tests", "test_february.json")):
            with self.subTest(file=rel_path):
                cal = load_from_json(os.path.join(ROOT, rel_path))
                assert_hard_rules(self, cal, generate_schedule(cal))


class Priorities(unittest.TestCase):
    def test_lower_limit_worker_wins_a_contested_preferred_day(self):
        cal = make_calendar({10: 1, 20: 1})
        Worker("Busy", 5, [], [10], cal)
        Worker("Light", 1, [], [10], cal)
        schedule = generate_schedule(cal)
        self.assertEqual(schedule[10], ["Light"])
        self.assertEqual(schedule[20], ["Busy"])

    def test_preferred_days_are_used_before_other_days(self):
        cal = make_calendar({3: 1, 10: 1, 17: 1})
        Worker("A", 1, [], [17], cal)
        Worker("B", 2, [], [], cal)
        schedule = generate_schedule(cal)
        self.assertEqual(schedule[17], ["A"])
        self.assertEqual(sorted(schedule[3] + schedule[10]), ["B", "B"])

    def test_reaches_each_workers_count_when_possible(self):
        cal = make_calendar({d: 1 for d in (2, 5, 9, 12, 16, 19)})
        Worker("A", 2, [2, 5], [], cal)
        Worker("B", 4, [], [2, 5], cal)
        schedule = generate_schedule(cal)
        counts = {n: sum(n in schedule[d] for d in cal.iter_days()) for n in ("A", "B")}
        self.assertEqual(counts, {"A": 2, "B": 4})
        assert_hard_rules(self, cal, schedule)

    def test_backtracks_where_greedy_order_would_leave_a_hole(self):
        # Day 1 can be covered by either; day 2 only by A. A must go to day 2.
        cal = make_calendar({1: 1, 2: 1})
        Worker("A", 1, [], [], cal)
        Worker("B", 1, [2], [], cal)
        schedule = generate_schedule(cal)
        self.assertEqual(schedule[1], ["B"])
        self.assertEqual(schedule[2], ["A"])


if __name__ == "__main__":
    unittest.main()
