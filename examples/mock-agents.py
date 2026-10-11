#!/usr/bin/env python3
"""Synthetic agent source; requires only Python 3, prints JSON and exits.

    python3 mock-agents.py          # English labels
    python3 mock-agents.py --lang ko
"""
import json
import sys

KO = '--lang' in sys.argv and sys.argv[sys.argv.index('--lang') + 1:][:1] == ['ko']
T = (lambda ko, en: ko) if KO else (lambda ko, en: en)

print(json.dumps([
    {'id': 'writer', 'agent': 'codex', 'label': T('코드 작성', 'Writing code'), 'detail': 'parser.py',
     'state': 'working', 'group': T('작업', 'Build')},
    {'id': 'review', 'agent': 'claude', 'label': T('검토 대기', 'Needs review'), 'detail': T('변경 파일 3개', '3 changed files'),
     'state': 'waiting', 'group': 'Review Queue'},
    {'id': 'rest', 'agent': 'gemini', 'label': T('쉬는 중', 'Resting'), 'detail': T('다음 작업 대기', 'Waiting for the next task'),
     'state': 'idle'},
], ensure_ascii=False))
