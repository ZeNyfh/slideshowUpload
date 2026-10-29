#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# Prefer python -m pip; repair venv if pip is missing/broken
if ! python -m pip --version >/dev/null 2>&1; then
  python -m ensurepip --upgrade
fi
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if [[ $# -ge 1 ]]; then
  if [[ ! "$1" =~ ^[0-9]+$ ]] || (( $1 < 1 || $1 > 65535 )); then
    echo "Usage: ./start.sh [port]" >&2
    echo "  port must be an integer 1–65535 (default 5050)" >&2
    exit 1
  fi
  export PORT="$1"
fi

exec python app.py
