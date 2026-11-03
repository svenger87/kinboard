"""Eid al-Adha's art (RFC-020 §3.3): the cards' string lights and lanterns,
drawn by ./_eid.py as for Eid al-Fitr. The rising lanterns and sparkles are
Eid al-Fitr's parts, borrowed by the kit (`art: "eid-al-fitr"`), so this
writes no art JSON.

    python3 webapp/scripts/festival-art/eid-al-adha.py
"""
import sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art
import _eid

art = Art("eid-al-adha")
_eid.stills(art)
art.finish()
