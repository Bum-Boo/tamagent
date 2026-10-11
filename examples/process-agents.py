#!/usr/bin/env python3
"""Linux/macOS ps adapter. Process presence is an approximation of activity.

Only executable names are read; command-line arguments and prompts are not
collected. Matches claude, codex, gemini, and hermes. No shell is used.
"""
import json
import os
import subprocess
from pathlib import Path

output = subprocess.run(['ps', '-u', str(os.getuid()), '-o', 'pid=,stat=,comm='],
                        check=True, capture_output=True, text=True, timeout=5).stdout
agents = []
for row in output.splitlines():
    fields = row.strip().split(None, 2)
    if len(fields) != 3:
        continue
    pid, status, command = fields
    agent = Path(command).name.lower()
    if agent not in {'claude', 'codex', 'gemini', 'hermes'}:
        continue
    if status.startswith('Z'):
        state = 'failed'
    elif status.startswith(('T', 't')):
        state = 'waiting'
    elif status.startswith('R'):
        state = 'working'
    else:
        state = 'idle'
    agents.append({'id': f'process-{pid}', 'agent': agent, 'label': f'{agent} #{pid}',
                   'detail': f'ps state: {status}', 'state': state, 'group': 'Processes'})
print(json.dumps(agents))
