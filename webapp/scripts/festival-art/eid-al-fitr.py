"""Eid al-Fitr's art (RFC-020 §3.3): lanterns and sparkles rising, string
lights and lanterns on the cards. Drawn in ./_eid.py, which Eid al-Adha
shares: its visitor flies these same parts.

    python3 webapp/scripts/festival-art/eid-al-fitr.py
"""
import sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art
import _eid

art = Art("eid-al-fitr")
_eid.visitor(art)
_eid.stills(art)
art.finish()
