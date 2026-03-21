import calendar
import json
import sys
from typing import Dict, List, Tuple
from datetime import date, timedelta


class Calendar:
    """
    A calendar class for managing shift scheduling operations.
    Encapsulates month/year logic, weekday calculations, and shift requirements.
    """
    
    # Default shift requirements by weekday (0=Monday, 6=Sunday)
    DEFAULT_SHIFTS_BY_WEEKDAY = {
        0: 3,  # Monday
        1: 3,  # Tuesday
        2: 3,  # Wednesday
        3: 3,  # Thursday
        4: 1,  # Friday
        5: 2,  # Saturday
        6: 3   # Sunday
    }
    
    # Shift slot templates: (time_range, department) per weekday
    # Weekday (Sun-Thu): 16:00-23:00, 2 DEP + 1 ER
    # Friday: 13:00-20:00, 1 DEP
    # Saturday: 09:00-16:00 DEP + 16:00-23:00 DEP
    DEFAULT_SHIFT_SLOTS = {
        0: [("16:00-23:00", "DEP"), ("16:00-23:00", "DEP"), ("16:00-23:00", "ER")],   # Monday
        1: [("16:00-23:00", "DEP"), ("16:00-23:00", "DEP"), ("16:00-23:00", "ER")],   # Tuesday
        2: [("16:00-23:00", "DEP"), ("16:00-23:00", "DEP"), ("16:00-23:00", "ER")],   # Wednesday
        3: [("16:00-23:00", "DEP"), ("16:00-23:00", "DEP"), ("16:00-23:00", "ER")],   # Thursday
        4: [("13:00-20:00", "DEP")],                                                    # Friday
        5: [("09:00-16:00", "DEP"), ("16:00-23:00", "DEP")],                            # Saturday
        6: [("16:00-23:00", "DEP"), ("16:00-23:00", "DEP"), ("16:00-23:00", "ER")],   # Sunday
    }
    
    def __init__(self, year: int, month: int, shifts_by_weekday: Dict[int, int] = None, custom_shifts: Dict[int, Dict[str, int]] = None):
        """
        Initialize a Calendar for a specific month and year.
        
        Args:
            year: The year (e.g., 2025)
            month: The month (1-12)
            shifts_by_weekday: Optional custom shift requirements per weekday
            custom_shifts: Optional overrides per day (DEP/ER counts)
        """
        self.year = year
        self.month = month
        self.shifts_by_weekday = shifts_by_weekday or self.DEFAULT_SHIFTS_BY_WEEKDAY.copy()
        self.custom_shifts = custom_shifts or {}
        self._cal = calendar.Calendar()
        self.workers = []
        
    @property
    def days_in_month(self) -> int:
        """Get the number of days in this month."""
        return calendar.monthrange(self.year, self.month)[1]
    
    @property
    def month_name(self) -> str:
        """Get the full name of the month."""
        return calendar.month_name[self.month]
    
    @property
    def total_shifts(self) -> int:
        """Calculate total shifts needed for the entire month."""
        return sum(self.get_shifts_needed(day) for day in range(1, self.days_in_month + 1))
    
    def get_weekday(self, day: int) -> int:
        """
        Get the weekday for a specific day in this month.
        
        Args:
            day: Day of the month (1-based)
            
        Returns:
            Weekday index (0=Monday, 6=Sunday)
        """
        return calendar.weekday(self.year, self.month, day)
    
    def get_weekday_name(self, day: int) -> str:
        """
        Get the weekday name for a specific day in this month.
        
        Args:
            day: Day of the month (1-based)
            
        Returns:
            Weekday name (e.g., 'Monday')
        """
        return calendar.day_name[self.get_weekday(day)]
    
    def get_shift_slots(self, day: int) -> List[Tuple[str, str]]:
        """
        Get the exact expected slot layout (time, dept) for a given day.
        Accounts for manual holiday/custom overrides.
        """
        weekday = self.get_weekday(day)
        if day in self.custom_shifts:
            dep_count = self.custom_shifts[day].get("DEP", 0)
            er_count = self.custom_shifts[day].get("ER", 0)
            default_slots = self.DEFAULT_SHIFT_SLOTS[weekday]
            default_time = default_slots[0][0] if default_slots else "16:00-23:00"
            return [(default_time, "DEP")] * dep_count + [(default_time, "ER")] * er_count
        return self.DEFAULT_SHIFT_SLOTS[weekday]

    def get_shifts_needed(self, day: int) -> int:
        """
        Get the number of shifts needed for a specific day.
        
        Args:
            day: Day of the month (1-based)
            
        Returns:
            Number of shifts required
        """
        return len(self.get_shift_slots(day))
    
    def count_weekday_occurrences(self, weekday: int) -> int:
        """
        Count how many times a specific weekday occurs in this month.
        
        Args:
            weekday: Weekday index (0=Monday, 6=Sunday)
            
        Returns:
            Number of occurrences
        """
        return sum(
            1 for day, wd in self._cal.itermonthdays2(self.year, self.month)
            if day and wd == weekday
        )
    
    def get_date(self, day: int) -> date:
        """
        Get a date object for a specific day in this month.
        
        Args:
            day: Day of the month (1-based)
            
        Returns:
            date object
        """
        return date(self.year, self.month, day)
    
    def format_date(self, day: int, format_str: str = "%d/%m") -> str:
        """
        Format a date string for a specific day.
        
        Args:
            day: Day of the month (1-based)
            format_str: Format string (default: "DD/MM")
            
        Returns:
            Formatted date string
        """
        return f"{str(day).zfill(2)}/{str(self.month).zfill(2)}"
    
    def iter_days(self) -> range:
        """
        Iterate over all days in the month.
        
        Returns:
            Range object from 1 to days_in_month (inclusive)
        """
        return range(1, self.days_in_month + 1)
    
    def get_weekend_days(self) -> List[int]:
        """
        Get all weekend days (Friday and Saturday) in this month.
        
        Returns:
            List of day numbers that fall on Friday or Saturday
        """
        return [
            day for day in self.iter_days()
            if self.get_weekday(day) in [4, 5]  # Friday, Saturday
        ]
    
    def get_weekday_days(self, weekday: int) -> List[int]:
        """
        Get all days in the month that fall on a specific weekday.
        
        Args:
            weekday: Weekday index (0=Monday, 6=Sunday)
            
        Returns:
            List of day numbers
        """
        return [
            day for day in self.iter_days()
            if self.get_weekday(day) == weekday
        ]
    
    def is_weekend(self, day: int) -> bool:
        """
        Check if a day falls on a weekend (Friday or Saturday).
        
        Args:
            day: Day of the month (1-based)
            
        Returns:
            True if weekend, False otherwise
        """
        return self.get_weekday(day) in [4, 5]
    
    def get_shifts_summary(self) -> Dict[str, int]:
        """
        Get a summary of shifts needed per weekday.
        
        Returns:
            Dictionary mapping weekday names to total shifts needed
        """
        summary = {}
        for weekday in range(7):
            weekday_name = calendar.day_name[weekday]
            occurrences = self.count_weekday_occurrences(weekday)
            shifts_per_day = self.shifts_by_weekday[weekday]
            total = occurrences * shifts_per_day
            summary[weekday_name] = total
        return summary
    
    def __str__(self) -> str:
        """String representation of the calendar."""
        return f"Calendar({self.month_name} {self.year})"
    
    def __repr__(self) -> str:
        """Developer-friendly representation."""
        return f"Calendar(year={self.year}, month={self.month})"
    
    def summary(self) -> None:
        """
        Print a comprehensive summary of the calendar.
        Shows basic info, shifts by weekday, and first week details.
        """
        print(f"Calendar: {self}")
        print(f"Days in month: {self.days_in_month}")
        print(f"Total shifts needed: {self.total_shifts}")
        print()
        
        

class Worker:
    def __init__(self, name: str, limit: int, cant_work: list[int], can_work: list[int], calendar: Calendar):
        self.name = name
        self.limit = limit
        self.cant_work = cant_work
        self.can_work = can_work
        self.calendar = calendar
        self.calendar.workers.append(self)
        # Use set operations for O(1) lookups instead of O(N) list scans
        all_days = set(self.calendar.iter_days())
        excluded_days = set(self.cant_work) | set(self.can_work)
        self.rest_days = sorted(list(all_days - excluded_days))
    
    def __repr__(self) -> str:
        """Developer-friendly representation."""
        return f"Worker(name='{self.name}', limit={self.limit}, rest_days={len(self.rest_days)})"



# ANSI color codes
RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
RESET = "\033[0m"


def load_from_json(filepath: str) -> Calendar:
    """
    Load calendar and workers from a JSON file.
    Returns a Calendar with all workers auto-registered.
    """
    with open(filepath, "r") as f:
        data = json.load(f)

    raw_custom = data.get("custom_shifts", {})
    custom_shifts = {int(k): v for k, v in raw_custom.items()}

    cal = Calendar(data["year"], data["month"], custom_shifts=custom_shifts)
    
    # Calculate default limit for workers with null limit (average)
    num_workers = len(data["workers"])
    default_limit = round(cal.total_shifts / num_workers) if num_workers > 0 else 0
    
    for w in data["workers"]:
        limit = w["limit"] if w["limit"] is not None else default_limit
        Worker(w["name"], limit, w["cant_work"], w["can_work"], cal)
    return cal


def check_warnings(cal: Calendar) -> bool:
    """
    Run pre-generation checks and print colored warnings.
    Returns True if there are any red (critical) warnings.
    """
    has_critical = False
    total_limit = sum(w.limit for w in cal.workers)
    total_needed = cal.total_shifts
    total_workers = len(cal.workers)

    # 1. Total capacity check
    if total_limit < total_needed:
        has_critical = True
        print(f"{RED}[CRITICAL] Total worker limits ({total_limit}) < total shifts needed ({total_needed}){RESET}")

    # Build per-day sets once for efficiency
    cant_by_day: Dict[int, List[str]] = {}
    can_by_day: Dict[int, List[str]] = {}
    for day in cal.iter_days():
        cant_by_day[day] = [w.name for w in cal.workers if day in w.cant_work]
        can_by_day[day] = [w.name for w in cal.workers if day in w.can_work]

    for day in cal.iter_days():
        shifts_needed = cal.get_shifts_needed(day)
        date_str = cal.format_date(day)
        weekday_name = cal.get_weekday_name(day)

        # 2. Overbooked: more workers want the date than shifts needed
        wanting = can_by_day[day]
        if len(wanting) > shifts_needed:
            print(f"{YELLOW}[WARNING] {date_str} ({weekday_name}): "
                  f"{len(wanting)} workers want to work but only {shifts_needed} shifts needed. "
                  f"Workers: {', '.join(wanting)}{RESET}")

        # 3. Understaffed: too many cant_work, not enough available
        blocked = cant_by_day[day]
        available = total_workers - len(blocked)
        if available < shifts_needed:
            has_critical = True
            print(f"{RED}[CRITICAL] {date_str} ({weekday_name}): "
                  f"only {available} workers available but {shifts_needed} shifts needed. "
                  f"Blocked: {', '.join(blocked)}{RESET}")

    return has_critical


def print_wanted_dates(cal: Calendar) -> None:
    """
    Print a calendar view showing which workers want each date.
    Helps visualize the 'already booked' situation before scheduling.
    """
    print(f"\n{'='*70}")
    print("WANTED DATES (Workers who prefer each date)")
    print(f"{'='*70}")
    
    # Build per-day wanted workers
    for day in cal.iter_days():
        wanting = [w.name for w in cal.workers if day in w.can_work]
        if wanting:  # Only show dates that someone wants
            date_str = cal.format_date(day)
            weekday_name = cal.get_weekday_name(day)
            shifts_needed = cal.get_shifts_needed(day)
            
            # Color code based on demand
            if len(wanting) > shifts_needed:
                color = YELLOW  # Overbooked
            elif len(wanting) == shifts_needed:
                color = GREEN  # Perfectly booked
            else:
                color = ""  # Underbooked (normal)
            
            print(f"{color}{date_str} ({weekday_name[:3]}) - {shifts_needed} shifts needed: "
                  f"{', '.join(wanting)}{RESET if color else ''}")


def generate_starting_point_schedule(cal: Calendar) -> Dict[int, List[str]]:
    """
    Generate a schedule purely based on preferred dates for all workers.
    Ignores limits, fairness, and slot required count.
    Used for visual starting point visualization.
    """
    schedule = {day: [] for day in cal.iter_days()}
    for day in cal.iter_days():
        wanting = [w.name for w in cal.workers if day in w.can_work]
        schedule[day] = wanting
    return schedule


def assign_departments_starting_point(cal: Calendar, schedule: Dict[int, List[str]]) -> Dict[int, List[dict]]:
    """
    Assigns dummy departments/times for the preferred schedule to match UI format.
    If overbooked, the extra workers still get rendered.
    """
    detailed: Dict[int, List[dict]] = {}
    for day in cal.iter_days():
        slots = cal.get_shift_slots(day)
        workers = schedule[day]
        shifts_needed = len(slots)
        
        day_assignments = []
        for i in range(max(shifts_needed, len(workers))):
            if i < len(workers):
                worker = workers[i]
            else:
                worker = None
                
            if i < shifts_needed:
                time_range, dept = slots[i]
            else:
                time_range, dept = "EXTRA", "EXTRA"
                
            day_assignments.append({
                "worker": worker,
                "dept": dept,
                "time": time_range
            })
        detailed[day] = day_assignments
    return detailed


def generate_schedule(cal: Calendar) -> Dict[int, List[str]]:
    """
    Generate a fair shift schedule using a 3-phase algorithm.
    
    Phase 1: Lock in guaranteed shifts (non-overbooked preferred dates)
    Phase 2: Fill gaps with available workers sorted by furthest from limit
    Phase 3: Resolve overbooked (yellow) dates with fairness sorting
    
    Constraint: No consecutive shifts unless both days are in can_work
    
    Returns:
        Dict mapping day -> list of assigned worker names
    """
    schedule: Dict[int, List[str]] = {day: [] for day in cal.iter_days()}
    assigned_count: Dict[str, int] = {w.name: 0 for w in cal.workers}
    cant_work_sets = {w.name: set(w.cant_work) for w in cal.workers}
    can_work_sets = {w.name: set(w.can_work) for w in cal.workers}
    workers_by_name = {w.name: w for w in cal.workers}
    
    def is_consecutive_allowed(worker_name: str, day: int) -> bool:
        """Check if assigning this worker to this day would violate consecutive shift rule."""
        # Check if worker already assigned to previous day
        if day > 1 and worker_name in schedule[day - 1]:
            # Only allow if both days are in can_work
            if day not in can_work_sets[worker_name] or (day - 1) not in can_work_sets[worker_name]:
                return False
        
        # Check if worker already assigned to next day
        if day < cal.days_in_month and worker_name in schedule[day + 1]:
            # Only allow if both days are in can_work
            if day not in can_work_sets[worker_name] or (day + 1) not in can_work_sets[worker_name]:
                return False
        
        return True
    
    # Phase 1: Lock in non-overbooked preferred dates
    for day in cal.iter_days():
        wanting = [w for w in cal.workers if day in w.can_work]
        shifts_needed = cal.get_shifts_needed(day)
        
        if len(wanting) <= shifts_needed:
            # All wanting workers get this shift (consecutive is OK since both days are in can_work)
            for w in wanting:
                if assigned_count[w.name] < w.limit and is_consecutive_allowed(w.name, day):
                    schedule[day].append(w.name)
                    assigned_count[w.name] += 1
    
    # Phase 3 (before Phase 2 so overbooked preferences are resolved first):
    # Resolve overbooked dates — pick by fairness
    for day in cal.iter_days():
        wanting = [w for w in cal.workers if day in w.can_work]
        shifts_needed = cal.get_shifts_needed(day)
        
        if len(wanting) > shifts_needed:
            already_assigned = set(schedule[day])
            candidates = [
                w for w in wanting
                if w.name not in already_assigned 
                and assigned_count[w.name] < w.limit
                and is_consecutive_allowed(w.name, day)
            ]
            
            # Sort by: furthest from limit first
            candidates.sort(key=lambda w: (
                (w.limit - assigned_count[w.name]) / max(w.limit, 1),  # % remaining (descending)
            ), reverse=True)
            
            slots = shifts_needed - len(schedule[day])
            for w in candidates[:slots]:
                schedule[day].append(w.name)
                assigned_count[w.name] += 1
    
    # Phase 2: Fill remaining gaps from rest days
    for day in cal.iter_days():
        shifts_needed = cal.get_shifts_needed(day)
        already_assigned = set(schedule[day])
        
        while len(schedule[day]) < shifts_needed:
            # Find available workers: not blocked, not already assigned today, not at limit, no consecutive violation
            candidates = [
                w for w in cal.workers
                if w.name not in already_assigned
                and day not in cant_work_sets[w.name]
                and assigned_count[w.name] < w.limit
                and is_consecutive_allowed(w.name, day)
            ]
            
            if not candidates:
                # No one available — can't fill this slot
                break
            
            # Sort by: furthest from limit first, then fewer rest days (less flexible first)
            candidates.sort(key=lambda w: (
                (w.limit - assigned_count[w.name]) / max(w.limit, 1),  # % remaining (descending)
                -len(w.rest_days),  # fewer rest days = less flexible = pick first
            ), reverse=True)
            
            best = candidates[0]
            schedule[day].append(best.name)
            assigned_count[best.name] += 1
            already_assigned.add(best.name)
    
    return schedule


def assign_departments(cal: Calendar, schedule: Dict[int, List[str]]) -> Dict[int, List[dict]]:
    """
    Assign departments (DEP/ER) and time slots to each shift.
    ER shifts are distributed fairly — worker with fewest ER shifts so far gets ER.
    
    Returns:
        Dict mapping day -> list of {"worker": str, "dept": str, "time": str}
    """
    detailed: Dict[int, List[dict]] = {}
    er_count: Dict[str, int] = {w.name: 0 for w in cal.workers}
    
    for day in cal.iter_days():
        slots = cal.get_shift_slots(day)
        workers = schedule[day]
        
        day_assignments = []
        
        # Separate ER slots from DEP slots
        er_slots = [i for i, (_, dept) in enumerate(slots) if dept == "ER"]
        dep_slots = [i for i, (_, dept) in enumerate(slots) if dept == "DEP"]
        
        # Assign ER first: pick the worker with fewest ER shifts so far
        er_assigned = set()
        for _ in er_slots:
            # Pick from assigned workers who haven't been placed yet
            available = [w for w in workers if w not in er_assigned]
            if available:
                # Worker with fewest ER shifts gets ER
                best = min(available, key=lambda w: er_count[w])
                er_assigned.add(best)
                er_count[best] += 1
        
        # Build final assignments in slot order
        remaining_workers = [w for w in workers if w not in er_assigned]
        er_iter = iter(er_assigned)
        dep_iter = iter(remaining_workers)
        
        for time_range, dept in slots:
            if dept == "ER":
                worker = next(er_iter, None)
            else:
                worker = next(dep_iter, None)
            
            if worker:
                day_assignments.append({
                    "worker": worker,
                    "dept": dept,
                    "time": time_range
                })
        
        detailed[day] = day_assignments
    
    return detailed


CYAN = "\033[96m"  # For ER highlighting


def print_schedule(cal: Calendar, detailed_schedule: Dict[int, List[dict]]) -> None:
    """Print the final generated schedule with department and time info."""
    # Build set of preferred assignments for color coding
    preferred_assignments = set()
    for w in cal.workers:
        for day in w.can_work:
            preferred_assignments.add((day, w.name))
    
    print(f"\n{'='*70}")
    print("GENERATED SCHEDULE")
    print(f"{'='*70}")
    
    for day in cal.iter_days():
        date_str = cal.format_date(day)
        weekday_name = cal.get_weekday_name(day)[:3]
        shifts_needed = cal.get_shifts_needed(day)
        slots = detailed_schedule[day]
        
        # Group by time range
        time_groups: Dict[str, List[str]] = {}
        for slot in slots:
            time_range = slot["time"]
            name = slot["worker"]
            dept = slot["dept"]
            
            # Color: ER in cyan, preferred in green, rest normal
            if dept == "ER":
                display = f"{CYAN}{name}(ER){RESET}"
            elif (day, name) in preferred_assignments:
                display = f"{GREEN}{name}{RESET}"
            else:
                display = name
            
            if time_range not in time_groups:
                time_groups[time_range] = []
            time_groups[time_range].append(display)
        
        # Mark if understaffed
        if len(slots) < shifts_needed:
            status = f" {RED}(MISSING {shifts_needed - len(slots)}){RESET}"
        else:
            status = ""
        
        # Print each time group
        parts = []
        for time_range, names in time_groups.items():
            parts.append(f"{time_range}: {', '.join(names)}")
        
        print(f"{date_str} ({weekday_name}) [{len(slots)}/{shifts_needed}] | {' | '.join(parts)}{status}")


def print_worker_final_stats(cal: Calendar, detailed_schedule: Dict[int, List[dict]]) -> None:
    """Print final worker statistics after scheduling, including ER count."""
    assigned_count: Dict[str, int] = {w.name: 0 for w in cal.workers}
    er_count: Dict[str, int] = {w.name: 0 for w in cal.workers}
    
    for day, slots in detailed_schedule.items():
        for slot in slots:
            assigned_count[slot["worker"]] += 1
            if slot["dept"] == "ER":
                er_count[slot["worker"]] += 1
    
    print(f"\n{'='*70}")
    print("FINAL WORKER STATS")
    print(f"{'='*70}")
    
    for worker in cal.workers:
        count = assigned_count[worker.name]
        er = er_count[worker.name]
        
        if count >= worker.limit:
            color = GREEN
        elif count >= worker.limit * 0.7:
            color = YELLOW
        else:
            color = RED
        
        er_str = f" ({CYAN}{er} ER{RESET})" if er > 0 else ""
        print(f"{color}{worker.name}: {count}/{worker.limit} shifts{RESET}{er_str}")
    
    total_assigned = sum(assigned_count.values())
    total_er = sum(er_count.values())
    total_needed = cal.total_shifts
    print(f"\nTotal assigned: {total_assigned}/{total_needed} ({total_er} ER)")


# CLI usage
if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "workers.json"
    cal = load_from_json(filepath)
    cal.summary()
    
    # Show total shifts asked by workers
    total_asked = sum(w.limit for w in cal.workers)
    print(f"Total shifts asked: {total_asked}")
    
    # Calculate guaranteed shifts per worker (from non-overbooked preferred dates)
    print(f"\n{'='*70}")
    print("WORKER SUMMARY (Guaranteed shifts from preferences)")
    print(f"{'='*70}")
    
    total_guaranteed = 0
    for worker in cal.workers:
        # Count shifts from preferred dates that aren't overbooked
        guaranteed_shifts = 0
        for day in worker.can_work:
            wanting = [w for w in cal.workers if day in w.can_work]
            shifts_needed = cal.get_shifts_needed(day)
            # Only count if not overbooked (yellow)
            if len(wanting) <= shifts_needed:
                guaranteed_shifts += 1
        
        total_guaranteed += guaranteed_shifts
        
        # Color code based on progress toward limit
        if guaranteed_shifts >= worker.limit:
            color = GREEN  # Met or exceeded limit
        elif guaranteed_shifts >= worker.limit * 0.7:
            color = YELLOW  # Close to limit
        else:
            color = RED  # Far from limit
        
        print(f"{color}{worker.name}: {guaranteed_shifts}/{worker.limit} shifts{RESET}")
    
    missing = cal.total_shifts - total_guaranteed
    print(f"\nMissing shifts to fill: {missing}")

    print(f"\nWorkers loaded: {[w.name for w in cal.workers]}")
    
    # Show wanted dates calendar
    print_wanted_dates(cal)
    
    print(f"\n{'='*50}")
    print("PRE-GENERATION WARNINGS")
    print(f"{'='*50}")

    has_critical = check_warnings(cal)

    if has_critical:
        print(f"\n{RED}Schedule has critical issues. Resolve before generating.{RESET}")
    else:
        print(f"\nAll checks passed. Ready to generate schedule.")
    
    # Generate and print the schedule
    schedule = generate_schedule(cal)
    detailed_schedule = assign_departments(cal, schedule)
    print_schedule(cal, detailed_schedule)
    print_worker_final_stats(cal, detailed_schedule)
