"""Ramadan's art (RFC-020 §3.3): a lantern hanging beside each card after
sunset. No visitor, no outfit. The lantern is the fanous drawn in
./_lanterns.py, shared with the Eids, here in amber and turquoise.

    python3 webapp/scripts/festival-art/ramadan.py
"""
import sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art
from _lanterns import side_lantern

art = Art("ramadan")
# One lantern on a chain beside each card; a shorter and a longer chain for alternate cards.
art.still("lantern-side-a", side_lantern("amber", 8))
art.still("lantern-side-b", side_lantern("turquoise", 20))
art.finish()
