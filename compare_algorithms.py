"""Compare the greedy and CP-SAT schedulers on a workers file."""
import sys
import time

from shift_schduler import load_from_json, generate_schedule, generate_schedule_greedy


def evaluate(cal, schedule):
    open_slots = sum(max(0, cal.get_shifts_needed(d) - len(schedule[d])) for d in cal.iter_days())
    rows = []
    cant_violations = over_limit = consecutive = 0
    pref_granted = pref_total = 0
    for w in cal.workers:
        mine = sorted(d for d in cal.iter_days() if w.name in schedule[d])
        can = set(w.can_work)
        cant_violations += len(set(mine) & set(w.cant_work))
        over_limit += max(0, len(mine) - w.limit)
        consecutive += sum(
            1 for a, b in zip(mine, mine[1:]) if b == a + 1 and not (a in can and b in can)
        )
        granted = len(set(mine) & can)
        pref_granted += granted
        pref_total += len(can)
        rows.append((w.name, w.limit, len(mine), granted, len(can)))
    return {
        "open": open_slots,
        "cant": cant_violations,
        "over": over_limit,
        "consec": consecutive,
        "pref": f"{pref_granted}/{pref_total}",
        "rows": rows,
    }


def main(path):
    cal = load_from_json(path)
    print(f"{path}: {cal.month_name} {cal.year}, {cal.total_shifts} slots, "
          f"capacity {sum(w.limit for w in cal.workers)}\n")
    results = {}
    for label, fn in (("greedy", generate_schedule_greedy), ("cp-sat", generate_schedule)):
        t = time.perf_counter()
        sched = fn(cal)
        results[label] = evaluate(cal, sched)
        results[label]["secs"] = time.perf_counter() - t

    for label, r in results.items():
        print(f"{label:7} open={r['open']:2}  cant-violations={r['cant']}  over-limit={r['over']}  "
              f"consecutive={r['consec']}  preferred={r['pref']}  ({r['secs']:.2f}s)")

    print(f"\n{'worker':10} {'limit':>5} | {'greedy got/pref':>15} | {'cp-sat got/pref':>15}")
    for g, c in zip(results["greedy"]["rows"], results["cp-sat"]["rows"]):
        name, limit = g[0], g[1]
        print(f"{name:10} {limit:5} | {g[2]:6}/{g[3]:<2} of {g[4]:<3} | {c[2]:6}/{c[3]:<2} of {c[4]:<3}")


def slack_sweep(path, max_slack=3):
    cal = load_from_json(path)
    for s in range(max_slack + 1):
        r = evaluate(cal, generate_schedule(cal, coverage_slack=s))
        low = ", ".join(f"{n} {g}/{p}" for n, l, c, g, p in r["rows"] if l <= 6)
        print(f"slack={s} open={r['open']} preferred={r['pref']} cant={r['cant']} over={r['over']} "
              f"consec={r['consec']} | limit<=6 wishes: {low}")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--sweep"]:
        slack_sweep(sys.argv[2] if len(sys.argv) > 2 else "workers.json")
        sys.exit()
    for p in sys.argv[1:] or ["workers.json"]:
        main(p)
        print()
