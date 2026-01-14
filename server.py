#!/usr/bin/env python3
"""
LedWeb Server Wrapper
Simple entry point that runs backend/main.py
"""

import sys
import os
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_path))

# Import and run main
if __name__ == '__main__':
    try:
        from backend import main
        main.run()
    except ImportError:
        # Fallback: run main.py directly
        os.chdir(backend_path)
        exec(open('main.py').read())
