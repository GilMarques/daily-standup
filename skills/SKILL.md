---
name: daily-standup
description: Saves conversation summaries to daily folders and generates end-of-day standup reports. Use when ending your workday or whenever you need a summary.
---

# Daily Standup Automation

Track your work throughout the day and generate end-of-day standup reports.

## Commands

| Command | Description |
|---------|-------------|
| `/save` | Save current conversation summary to daily folder |
| `/standup` | Generate today's standup report |
| `/standup week` | Generate this week's standup report |
| `/standups` | List all saved summaries |

## How It Works

1. **Throughout the day** — run `/save` after finishing a task or conversation
2. **End of day** — run `/standup` to generate your full report

## Output Format

Reports are saved to `~/.pi/daily-standup/YYYY-MM-DD/` and include:

```markdown
# Daily Standup - YYYY-MM-DD

## Worked On Today
- Task 1 summary
- Task 2 summary
- ...

## Technical Details
Key files modified, code changes, decisions

## Tomorrow's Plan
What you're planning to work on next

## Blockers
Any issues or missing dependencies
```

## Tips

- Run `/save` after each major task — don't wait until end of day
- Check `~/.pi/daily-standup/` to review past summaries
- Use descriptive session names — they become conversation titles
