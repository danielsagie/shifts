"""
Flask web server for Shift Scheduler.
Wraps the existing shift_schduler.py logic with REST API endpoints.
"""
import json
import os
from flask import Flask, render_template, jsonify, request

# Import existing scheduling logic
from shift_schduler import (
    Calendar, Worker, load_from_json, 
    generate_schedule, assign_departments, check_warnings
)

app = Flask(__name__)
WORKERS_FILE = os.path.join(os.path.dirname(__file__), "workers.json")


def load_json_data():
    """Load raw JSON data from workers file."""
    with open(WORKERS_FILE, "r") as f:
        return json.load(f)


def save_json_data(data):
    """Save JSON data back to workers file."""
    with open(WORKERS_FILE, "w") as f:
        json.dump(data, f, indent=4)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/calendar-info")
def calendar_info():
    """Get month, year, and shift configuration info."""
    data = load_json_data()
    cal = load_from_json(WORKERS_FILE)
    
    total_asked = sum(w.limit for w in cal.workers)
    
    return jsonify({
        "year": data["year"],
        "month": data["month"],
        "month_name": cal.month_name,
        "days_in_month": cal.days_in_month,
        "total_shifts": cal.total_shifts,
        "total_asked": total_asked,
        "team_size": len(data["workers"]),
    })


@app.route("/api/calendar-info", methods=["PUT"])
def update_calendar_info():
    """Update month and year in the JSON file."""
    body = request.json
    data = load_json_data()
    
    if "month" in body:
        data["month"] = int(body["month"])
    if "year" in body:
        data["year"] = int(body["year"])
    
    save_json_data(data)
    return jsonify({"status": "ok"})



@app.route("/api/workers")
def get_workers():
    """Get all workers with their availability details."""
    data = load_json_data()
    cal = load_from_json(WORKERS_FILE)
    
    # Calculate guaranteed shifts per worker
    workers_out = []
    for i, w_data in enumerate(data["workers"]):
        worker = cal.workers[i]
        
        # Count guaranteed shifts (non-overbooked preferred dates)
        guaranteed = 0
        for day in worker.can_work:
            wanting = [w for w in cal.workers if day in w.can_work]
            shifts_needed = cal.get_shifts_needed(day)
            if len(wanting) <= shifts_needed:
                guaranteed += 1
        
        workers_out.append({
            "name": worker.name,
            "limit": worker.limit,
            "limit_raw": w_data["limit"],  # null or int from JSON
            "cant_work": worker.cant_work,
            "can_work": worker.can_work,
            "rest_days_count": len(worker.rest_days),
            "guaranteed_shifts": guaranteed,
        })
    
    return jsonify(workers_out)


@app.route("/api/workers", methods=["POST"])
def add_worker():
    """Add a new worker to the JSON file."""
    body = request.json
    data = load_json_data()
    
    new_worker = {
        "name": body["name"],
        "limit": body.get("limit"),
        "cant_work": body.get("cant_work", []),
        "can_work": body.get("can_work", []),
    }
    data["workers"].append(new_worker)
    save_json_data(data)
    
    return jsonify({"status": "ok", "worker": new_worker}), 201


@app.route("/api/workers/<name>", methods=["PUT"])
def update_worker(name):
    """Update an existing worker."""
    body = request.json
    data = load_json_data()
    
    for w in data["workers"]:
        if w["name"] == name:
            w["name"] = body.get("name", w["name"])
            w["limit"] = body.get("limit", w["limit"])
            w["cant_work"] = body.get("cant_work", w["cant_work"])
            w["can_work"] = body.get("can_work", w["can_work"])
            save_json_data(data)
            return jsonify({"status": "ok", "worker": w})
    
    return jsonify({"error": "Worker not found"}), 404


@app.route("/api/workers/<name>", methods=["DELETE"])
def delete_worker(name):
    """Delete a worker."""
    data = load_json_data()
    data["workers"] = [w for w in data["workers"] if w["name"] != name]
    save_json_data(data)
    return jsonify({"status": "ok"})


@app.route("/api/warnings")
def get_warnings():
    """Run pre-generation checks and return warnings."""
    cal = load_from_json(WORKERS_FILE)
    
    warnings = []
    total_limit = sum(w.limit for w in cal.workers)
    total_needed = cal.total_shifts
    total_workers = len(cal.workers)
    
    # Total capacity check
    if total_limit < total_needed:
        warnings.append({
            "type": "critical",
            "message": f"Total worker limits ({total_limit}) < total shifts needed ({total_needed})",
        })
    
    # Per-day checks
    for day in cal.iter_days():
        shifts_needed = cal.get_shifts_needed(day)
        date_str = cal.format_date(day)
        weekday_name = cal.get_weekday_name(day)
        
        wanting = [w.name for w in cal.workers if day in w.can_work]
        blocked = [w.name for w in cal.workers if day in w.cant_work]
        available = total_workers - len(blocked)
        
        if len(wanting) > shifts_needed:
            warnings.append({
                "type": "warning",
                "day": day,
                "date_str": date_str,
                "weekday": weekday_name,
                "message": f"{len(wanting)} people preferred (Need {shifts_needed})",
                "workers": wanting,
                "label": "HIGH DEMAND",
            })
        
        if available < shifts_needed:
            warnings.append({
                "type": "critical",
                "day": day,
                "date_str": date_str,
                "weekday": weekday_name,
                "message": f"Only {available} available but {shifts_needed} needed",
                "workers": blocked,
                "label": "UNDERSTAFFED",
            })
    
    return jsonify(warnings)



def calculate_stats(cal, detailed_schedule):
    """
    Calculate analysis stats from a given schedule.
    Shared logic for generation and manual updates.
    """
    # Build preferred assignments set
    preferred = set()
    for w in cal.workers:
        for day in w.can_work:
            preferred.add((day, w.name))
            
    # Build worker stats
    assigned_count = {w.name: 0 for w in cal.workers}
    er_count = {w.name: 0 for w in cal.workers}
    
    # In detailed_schedule, keys are integers (days). 
    # But when coming from JSON, they might be strings. Handle both.
    normalized_schedule = {}
    for day, slots in detailed_schedule.items():
        if isinstance(slots, list):
            # Normalize day to int
            day_int = int(day)
            normalized_schedule[day_int] = slots
            
            for slot in slots:
                worker_name = slot.get("worker")
                if worker_name and slot.get("dept") != "EXTRA": # Handle potential empty slots or different formats
                    if worker_name in assigned_count:
                        assigned_count[worker_name] += 1
                        
                    if slot.get("dept") == "ER":
                        if worker_name in er_count:
                            er_count[worker_name] += 1

    # Build analysis data
    analysis = []
    for worker in cal.workers:
        got = assigned_count[worker.name]
        er = er_count[worker.name]
        
        # Calculate preference match
        requested = set(worker.can_work)
        assigned_days = set()
        
        for day_int, slots in normalized_schedule.items():
            for slot in slots:
                if slot.get("worker") == worker.name:
                    assigned_days.add(day_int)
        
        matched = requested & assigned_days
        # A worker can only be granted as many requested days as their shift target
        wishes_possible = min(len(requested), worker.limit)
        pref_match = min(100, round(len(matched) / wishes_possible * 100)) if wishes_possible else 100
        
        # Check for can't work violations
        cant_work_set = set(worker.cant_work)
        violations = sorted(list(assigned_days & cant_work_set))
        
        analysis.append({
            "name": worker.name,
            "got": got,
            "target": worker.limit,
            "er": er,
            "preference_match": pref_match,
            "wishes_possible": wishes_possible,
            "requested": sorted(list(requested)),
            "result": sorted(list(assigned_days)),
            "matched": sorted(list(matched)),
            "cant_work_violations": violations,
        })
    
    # Fairness range
    counts = [a["got"] for a in analysis]
    
    total_required = cal.total_shifts
    total_covered = sum(assigned_count.values())
    total_remaining = total_required - total_covered
    
    return {
        "analysis": analysis,
        "total_assigned": total_covered, # Kept for potential compatibility
        "total_required": total_required,
        "total_covered": total_covered,
        "total_remaining": total_remaining,
        "total_er": sum(er_count.values()),
        "fairness_min": min(counts) if counts else 0,
        "fairness_max": max(counts) if counts else 0,
    }

@app.route("/api/generate-preferred", methods=["POST"])
def generate_preferred():
    """Generate schedule strictly based on preferences for starting point view."""
    from shift_schduler import generate_starting_point_schedule, assign_departments_starting_point
    
    cal = load_from_json(WORKERS_FILE)
    
    # Generate the schedule strictly from preferences
    schedule = generate_starting_point_schedule(cal)
    detailed = assign_departments_starting_point(cal, schedule)
    
    stats = calculate_stats(cal, detailed)
    
    # Build schedule output for UI
    preferred = set()
    for w in cal.workers:
        for day in w.can_work:
            preferred.add((day, w.name))

    schedule_out = {}
    for day in cal.iter_days():
        slots = detailed[day]
        weekday = cal.get_weekday(day)
        weekday_name = cal.get_weekday_name(day)
        shifts_needed = cal.get_shifts_needed(day)
        
        if len(slots) > shifts_needed:
            demand_status = "over"
        elif len(slots) < shifts_needed:
            demand_status = "under"
        else:
            demand_status = "perfect"
            
        schedule_out[str(day)] = {
            "day": day,
            "weekday": weekday,
            "weekday_name": weekday_name,
            "date_str": cal.format_date(day),
            "shifts_needed": shifts_needed,
            "demand_status": demand_status,
            "slots": [
                {
                    "worker": s["worker"],
                    "dept": s["dept"],
                    "time": s["time"],
                    "is_preferred": True,
                }
                for s in slots
            ],
        }
    
    return jsonify({
        "schedule": schedule_out,
        "analysis": stats["analysis"],
        "total_assigned": stats["total_assigned"],
        "total_shifts": cal.total_shifts,
        "total_er": stats["total_er"],
        "fairness_min": stats["fairness_min"],
        "fairness_max": stats["fairness_max"],
        "month_name": cal.month_name,
        "year": cal.year,
        "days_in_month": cal.days_in_month,
    })


@app.route("/api/generate", methods=["POST"])
def generate():
    """Generate schedule and return full results."""
    cal = load_from_json(WORKERS_FILE)
    
    # Generate the schedule
    schedule = generate_schedule(cal)
    detailed = assign_departments(cal, schedule)
    
    # Calculate stats
    stats = calculate_stats(cal, detailed)
    
    # Build schedule output for UI
    # Build preferred assignments set (duplicate logic needed for UI flags)
    preferred = set()
    for w in cal.workers:
        for day in w.can_work:
            preferred.add((day, w.name))

    schedule_out = {}
    for day in cal.iter_days():
        slots = detailed[day]
        weekday = cal.get_weekday(day)
        weekday_name = cal.get_weekday_name(day)
        
        schedule_out[str(day)] = {
            "day": day,
            "weekday": weekday,
            "weekday_name": weekday_name,
            "date_str": cal.format_date(day),
            "shifts_needed": cal.get_shifts_needed(day),
            "slots": [
                {
                    "worker": s["worker"],
                    "dept": s["dept"],
                    "time": s["time"],
                    "is_preferred": (day, s["worker"]) in preferred,
                }
                for s in slots
            ],
        }
    
    return jsonify({
        "schedule": schedule_out,
        "analysis": stats["analysis"],
        "total_assigned": stats["total_assigned"],
        "total_shifts": cal.total_shifts,
        "total_er": stats["total_er"],
        "fairness_min": stats["fairness_min"],
        "fairness_max": stats["fairness_max"],
        "month_name": cal.month_name,
        "year": cal.year,
        "days_in_month": cal.days_in_month,
    })


@app.route("/api/custom-shifts/<int:day>", methods=["PUT"])
def update_custom_shifts(day):
    """Update custom shift requirements for a specific day."""
    body = request.json
    data = load_json_data()
    
    if "custom_shifts" not in data:
        data["custom_shifts"] = {}
        
    day_str = str(day)
    data["custom_shifts"][day_str] = {
        "DEP": body.get("DEP", 0),
        "ER": body.get("ER", 0)
    }
    
    save_json_data(data)
    return jsonify({"status": "ok"})


@app.route("/api/custom-shifts/<int:day>", methods=["DELETE"])
def delete_custom_shifts(day):
    """Reset custom shift requirements for a specific day to defaults."""
    data = load_json_data()
    day_str = str(day)
    
    if "custom_shifts" in data and day_str in data["custom_shifts"]:
        del data["custom_shifts"][day_str]
        save_json_data(data)
        
    return jsonify({"status": "ok"})


@app.route("/api/analyze", methods=["POST"])
def analyze_schedule():
    """Recalculate stats for a modified schedule."""
    body = request.json
    schedule_data = body.get("schedule", {})
    
    # Reconstruct detailed schedule format from UI structure
    # UI sends: { '1': { slots: [...] }, ... }
    # We need: { 1: [{worker, dept, time}, ...], ... }
    detailed = {}
    for day_str, day_data in schedule_data.items():
        day = int(day_str)
        slots = day_data.get("slots", [])
        detailed[day] = slots # The structure matches enough for stats calculation

    cal = load_from_json(WORKERS_FILE)
    stats = calculate_stats(cal, detailed)
    
    return jsonify(stats)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
