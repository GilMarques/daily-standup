# Daily Standup

Pi agent extension for automated daily standup reports.

## Features

- `/save` - Save conversation summary to daily folder
- `/save [clickup-url]` - Save with ClickUp task link
- `/standup` - Generate today's standup report
- `/standup week` - Generate weekly report
- `/standups` - List saved summaries

## Setup

1. Copy `daily-standup.ts` to `~/.pi/agent/extensions/`
2. Copy `skills/daily-standup/` to `~/.pi/agent/skills/`
3. Run `/reload` in pi

## Output

Reports are saved to `~/.pi/daily-standup/YYYY-MM-DD/`

Report format:
```markdown
# Ponto de Situação - DD/MM/AAAA

## Hoje
- Tarefa 1 https://clickup.url
  - Detalhe técnico 1
  - Detalhe técnico 2

## Amanhã
- Task 1
- Task 2

## Bloqueios
- Nenhum
```

## Requirements

- Pi agent with extension support
- MiniMax or other configured AI model
