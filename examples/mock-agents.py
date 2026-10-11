#!/usr/bin/env python3
"""Synthetic agent source; requires only Python 3, prints JSON and exits."""
import json

print(json.dumps([
    {'id': 'writer', 'agent': 'codex', 'label': '코드 작성', 'detail': 'parser.py',
     'state': 'working', 'group': '작업'},
    {'id': 'review', 'agent': 'claude', 'label': '검토 대기', 'detail': '변경 파일 3개',
     'state': 'waiting', 'group': 'Review Queue'},
    {'id': 'rest', 'agent': 'gemini', 'label': '쉬는 중', 'detail': '다음 작업 대기',
     'state': 'idle'},
], ensure_ascii=False))
