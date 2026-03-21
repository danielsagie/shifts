import shift_schduler
from shift_schduler import Calendar, load_from_json, generate_schedule, assign_departments

def run():
    cal = load_from_json("workers.json")
    schedule = generate_schedule(cal)
    detailed = assign_departments(cal, schedule)

    output = []
    
    # Part 1: Check March 30 and 31
    output.append("\n=== March 30, 31 Shift Analysis ===")
    for day in [30, 31]:
        if day > cal.days_in_month:
            output.append(f"March {day} is out of range.")
            continue
            
        shifts_needed = cal.get_shifts_needed(day)
        weekday_name = cal.get_weekday_name(day)
        assigned = [s["worker"] for s in detailed[day]]
        
        output.append(f"March {day} ({weekday_name}): Needed={shifts_needed}, Assigned={len(assigned)} ({', '.join(assigned)})")

    # Part 2: Check who is working 27, 28, 29
    output.append("\n=== March 27, 28, 29 Worker Analysis ===")
    days_check = [27, 28, 29]
    worker_assignments = {} # worker -> list of days worked in this range

    for day in days_check:
        if day > cal.days_in_month:
            continue
        for slot in detailed[day]:
            w = slot["worker"]
            if w not in worker_assignments:
                worker_assignments[w] = []
            worker_assignments[w].append(day)

    found_consecutive = False
    for worker_name, days in worker_assignments.items():
        if len(days) == 3: # Worked all 3 days
            found_consecutive = True
            output.append(f"Worker '{worker_name}' is scheduled for all 3 days: {days}")
            
            # Check their preferences
            w_obj = next(w for w in cal.workers if w.name == worker_name)
            output.append(f"Preferences for {worker_name}:")
            output.append(f"  Start Limit: {w_obj.limit}")
            output.append(f"  Can Work (Preferred): {w_obj.can_work}")
            output.append(f"  Cant Work: {w_obj.cant_work}")
            
            # Check consecutive rule logic
            consecutive_allowed = True
            for d in days:
                if d not in w_obj.can_work:
                    consecutive_allowed = False
                    output.append(f"  Review: Day {d} is NOT in can_work, this might be a consecutive violation issue if they weren't explicitly allowed.")
            
            if consecutive_allowed:
                 output.append(f"  Review: All 3 days are in 'can_work', so consecutive shifts are ALLOWED.")
    
    if not found_consecutive:
        output.append("No worker found working consecutively on 27, 28, 29.")

    output.append("\n=== Final Worker Stats ===")
    assigned_count = {w.name: 0 for w in cal.workers}
    for day, slots in detailed.items():
        for slot in slots:
            assigned_count[slot["worker"]] += 1
            
    for w in cal.workers:
        output.append(f"{w.name}: {assigned_count[w.name]}/{w.limit} shifts")

    with open("debug_result.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(output))

if __name__ == "__main__":
    run()
