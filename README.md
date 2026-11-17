# Shift Scheduler

A web-based shift scheduling application for managing worker availability and generating fair monthly schedules.

## Prerequisites

- Python 3.8+
- pip (Python package manager)

## Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the Application
```bash
python app.py
```

### 3. Open in Browser
Navigate to `http://localhost:5000`

## About workers.json

The `workers.json` file contains the scheduling configuration:

- **month / year** — The month and year for the schedule
- **workers** — Array of worker profiles, each with:
  - `name` — Worker's name
  - `limit` — Target number of shifts per month
  - `can_work` — List of days (1-31) the worker prefers to work
  - `cant_work` — List of days (1-31) the worker cannot work

## How to Use

1. **Edit workers.json** — Update worker availability, shift limits, and scheduling preferences
2. **Click "Generate Schedule"** — The app analyzes preferences and generates an optimal schedule
3. **Review Results** — See the schedule, warnings, and fairness metrics
4. **Adjust as Needed** — Modify individual shifts or worker details directly in the UI
5. **Export** — Use the generated schedule for publishing

## Features

- Preference-based scheduling algorithm
- Conflict detection and warnings
- Fair shift distribution analysis
- Real-time schedule adjustments
- Department/ER shift balancing

