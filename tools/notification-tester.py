"""
Kinboard — Notification Tester
Compact Windows GUI for testing the server-side notification system.
"""

import json
import threading
import tkinter as tk
from tkinter import ttk, scrolledtext
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from typing import Optional
import os

DEFAULT_URL = os.environ.get("KINBOARD_URL", "http://localhost:3001")

# Colors used throughout
BG = "#1a1a2e"
CARD = "#16213e"
ACCENT = "#0f3460"
TEXT = "#e4e4e4"
GREEN = "#2ecc71"
BLUE = "#3498db"
ORANGE = "#e67e22"
RED = "#e74c3c"
PURPLE = "#9b59b6"
CYAN = "#1abc9c"


def http_request(base: str, method: str, path: str, body: Optional[dict] = None) -> dict:
    url = f"{base}{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        try:
            return {"_error": True, "status": e.code, **json.loads(error_body)}
        except json.JSONDecodeError:
            return {"_error": True, "status": e.code, "body": error_body[:200]}
    except URLError as e:
        return {"_error": True, "reason": str(e.reason)}
    except Exception as e:
        return {"_error": True, "reason": str(e)}


class NotificationTester(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Kinboard — Notification Tester")
        self.geometry("680x780")
        self.minsize(580, 620)
        self.configure(bg=BG)
        self.iconname("Notification Tester")

        # Device list cache: [{id, device_id, is_active, user_agent, created_at}, ...]
        self._devices: list[dict] = []

        self._setup_styles()
        self._build_ui()

    def _setup_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD)
        style.configure("TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Card.TLabel", background=CARD, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Hint.TLabel", background=CARD, foreground="#8b949e", font=("Segoe UI", 8))
        style.configure("Header.TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 14, "bold"))
        style.configure("Sub.TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 11, "bold"))
        style.configure("TEntry", fieldbackground=ACCENT, foreground=TEXT, insertcolor=TEXT)

        # Combobox
        style.configure("TCombobox", fieldbackground=ACCENT, foreground=TEXT,
                        selectbackground=ACCENT, selectforeground=TEXT)
        style.map("TCombobox", fieldbackground=[("readonly", ACCENT)],
                  foreground=[("readonly", TEXT)])
        self.option_add("*TCombobox*Listbox.background", ACCENT)
        self.option_add("*TCombobox*Listbox.foreground", TEXT)
        self.option_add("*TCombobox*Listbox.selectBackground", BLUE)

        for name, color in [
            ("Green.TButton", GREEN), ("Blue.TButton", BLUE),
            ("Orange.TButton", ORANGE), ("Red.TButton", RED),
            ("Purple.TButton", PURPLE), ("Cyan.TButton", CYAN),
        ]:
            style.configure(name, background=color, foreground="white",
                            font=("Segoe UI", 10, "bold"), padding=(12, 6))
            style.map(name, background=[("active", color), ("pressed", ACCENT)])

    def _build_ui(self):
        # --- Header ---
        ttk.Label(self, text="Notification Tester", style="Header.TLabel").pack(pady=(12, 4))

        # --- Config card ---
        cfg = ttk.Frame(self, style="Card.TFrame", padding=12)
        cfg.pack(fill="x", padx=16, pady=(4, 8))
        cfg.columnconfigure(1, weight=1)

        # Base URL
        ttk.Label(cfg, text="Base URL", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        self.url_var = tk.StringVar(value=DEFAULT_URL)
        ttk.Entry(cfg, textvariable=self.url_var, width=52).grid(
            row=0, column=1, columnspan=2, sticky="ew", padx=(8, 0))

        # Family ID
        ttk.Label(cfg, text="Family ID", style="Card.TLabel").grid(
            row=1, column=0, sticky="w", pady=(6, 0))
        self.family_var = tk.StringVar()
        ttk.Entry(cfg, textvariable=self.family_var, width=42).grid(
            row=1, column=1, sticky="ew", padx=(8, 4), pady=(6, 0))
        ttk.Button(cfg, text="Load", style="Cyan.TButton",
                   command=self.load_devices).grid(row=1, column=2, sticky="e", pady=(6, 0))
        ttk.Label(cfg, text="UUID of the family (not the join code)",
                  style="Hint.TLabel").grid(row=2, column=1, columnspan=2, sticky="w", padx=(8, 0))

        # Device selector
        ttk.Label(cfg, text="Device", style="Card.TLabel").grid(
            row=3, column=0, sticky="w", pady=(8, 0))
        self.device_combo_var = tk.StringVar()
        self.device_combo = ttk.Combobox(
            cfg, textvariable=self.device_combo_var, state="readonly", width=50)
        self.device_combo.grid(row=3, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=(8, 0))
        self.device_combo.set("(click Load to fetch devices)")

        # Device info label
        self.device_info_var = tk.StringVar(value="")
        ttk.Label(cfg, textvariable=self.device_info_var,
                  style="Hint.TLabel").grid(row=4, column=1, columnspan=2, sticky="w", padx=(8, 0))

        self.device_combo.bind("<<ComboboxSelected>>", self._on_device_selected)

        # --- Actions ---
        actions = ttk.Frame(self, style="TFrame")
        actions.pack(fill="x", padx=16, pady=4)

        ttk.Label(actions, text="Actions", style="Sub.TLabel").pack(anchor="w", pady=(0, 6))

        btn_row1 = ttk.Frame(actions, style="TFrame")
        btn_row1.pack(fill="x", pady=2)
        ttk.Button(btn_row1, text="Check Status", style="Blue.TButton",
                   command=self.check_status).pack(side="left", padx=(0, 6))
        ttk.Button(btn_row1, text="Test Push", style="Green.TButton",
                   command=self.test_push).pack(side="left", padx=(0, 6))
        ttk.Button(btn_row1, text="Insert Test Item", style="Orange.TButton",
                   command=self.insert_test).pack(side="left", padx=(0, 6))

        btn_row2 = ttk.Frame(actions, style="TFrame")
        btn_row2.pack(fill="x", pady=2)
        ttk.Button(btn_row2, text="Process Queue Now", style="Purple.TButton",
                   command=self.process_now).pack(side="left", padx=(0, 6))
        ttk.Button(btn_row2, text="Clear Log", style="Red.TButton",
                   command=self.clear_log).pack(side="left", padx=(0, 6))

        # --- Log ---
        log_frame = ttk.Frame(self, style="TFrame")
        log_frame.pack(fill="both", expand=True, padx=16, pady=(8, 12))

        ttk.Label(log_frame, text="Log", style="Sub.TLabel").pack(anchor="w", pady=(0, 4))

        self.log = scrolledtext.ScrolledText(
            log_frame, wrap="word", font=("Consolas", 9),
            bg="#0d1117", fg="#c9d1d9", insertbackground="#c9d1d9",
            selectbackground="#264f78", relief="flat", padx=8, pady=8,
        )
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

        self.log.tag_configure("info", foreground="#58a6ff")
        self.log.tag_configure("success", foreground="#3fb950")
        self.log.tag_configure("error", foreground="#f85149")
        self.log.tag_configure("warn", foreground="#d29922")
        self.log.tag_configure("dim", foreground="#8b949e")

        self._log("Ready. Enter your Family UUID and click Load.", "info")

    # --- Helpers ---

    def _log(self, message: str, tag: str = ""):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{ts}] ", "dim")
        self.log.insert("end", f"{message}\n", tag)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _log_json(self, data: dict):
        formatted = json.dumps(data, indent=2, ensure_ascii=False)
        self.log.configure(state="normal")
        self.log.insert("end", f"{formatted}\n", "")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _base(self) -> str:
        return self.url_var.get().rstrip("/")

    def _family_id(self) -> str:
        return self.family_var.get().strip()

    def _selected_device_id(self) -> str:
        """Get the device_id from the currently selected combobox item."""
        idx = self.device_combo.current()
        if idx >= 0 and idx < len(self._devices):
            return self._devices[idx].get("device_id", "")
        return ""

    def _require_family(self) -> Optional[str]:
        fid = self._family_id()
        if not fid:
            self._log("Family ID is required", "error")
            return None
        return fid

    def _run_async(self, label: str, method: str, path: str,
                   body: Optional[dict] = None, callback=None):
        self._log(f"{label}...", "info")

        def task():
            result = http_request(self._base(), method, path, body)
            self.after(0, lambda: self._handle_result(label, result, callback))

        threading.Thread(target=task, daemon=True).start()

    def _handle_result(self, label: str, result: dict, callback=None):
        if result.get("_error"):
            self._log(f"{label} — FAILED", "error")
        else:
            self._log(f"{label} — OK", "success")
        self._log_json(result)
        if callback:
            callback(result)

    # --- Device selector ---

    def load_devices(self):
        fid = self._require_family()
        if not fid:
            return

        def on_result(result: dict):
            if result.get("_error"):
                return

            subs = result.get("subscriptions", [])
            self._devices = subs

            if not subs:
                self.device_combo["values"] = ["(no devices found)"]
                self.device_combo.current(0)
                self._log("No subscribed devices found for this family.", "warn")
                return

            display_items = []
            for i, sub in enumerate(subs):
                active = "ACTIVE" if sub.get("is_active") else "inactive"
                ua = sub.get("user_agent", "") or "unknown"
                # Shorten user agent to something readable
                short_ua = _shorten_ua(ua)
                display_items.append(
                    f"[{active}] {short_ua} — {sub.get('device_id', '?')[:8]}..."
                )

            self.device_combo["values"] = display_items
            self.device_combo.current(0)
            self._on_device_selected(None)
            self._log(f"Loaded {len(subs)} device(s).", "success")

        self._run_async(
            "Load Devices", "GET",
            f"/api/notifications/debug-trigger?familyId={fid}",
            callback=on_result,
        )

    def _on_device_selected(self, _event):
        idx = self.device_combo.current()
        if idx >= 0 and idx < len(self._devices):
            dev = self._devices[idx]
            self.device_info_var.set(
                f"ID: {dev.get('device_id', '?')}  |  "
                f"Active: {dev.get('is_active', '?')}  |  "
                f"Since: {dev.get('created_at', '?')[:10]}"
            )
        else:
            self.device_info_var.set("")

    # --- Actions ---

    def check_status(self):
        fid = self._require_family()
        if not fid:
            return
        self._run_async("Check Status", "GET",
                        f"/api/notifications/debug-trigger?familyId={fid}")

    def test_push(self):
        fid = self._require_family()
        if not fid:
            return
        body: dict = {"familyId": fid, "action": "test-push"}
        did = self._selected_device_id()
        if did:
            body["deviceId"] = did
        self._run_async("Test Push", "POST", "/api/notifications/debug-trigger", body)

    def insert_test(self):
        fid = self._require_family()
        if not fid:
            return
        body: dict = {"familyId": fid, "action": "insert-test"}
        did = self._selected_device_id()
        if did:
            body["deviceId"] = did
        self._run_async("Insert Test Item", "POST", "/api/notifications/debug-trigger", body)

    def process_now(self):
        fid = self._require_family()
        if not fid:
            return
        self._run_async("Process Queue", "POST", "/api/notifications/debug-trigger",
                        {"familyId": fid, "action": "process"})

    def clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self._log("Log cleared.", "dim")


def _shorten_ua(ua: str) -> str:
    """Extract a human-readable device name from a user agent string."""
    ua_lower = ua.lower()
    if "iphone" in ua_lower:
        return "iPhone"
    if "ipad" in ua_lower:
        return "iPad"
    if "android" in ua_lower:
        if "mobile" in ua_lower:
            return "Android Phone"
        return "Android Tablet"
    if "macintosh" in ua_lower or "mac os" in ua_lower:
        return "Mac"
    if "windows" in ua_lower:
        return "Windows PC"
    if "linux" in ua_lower:
        if "armv" in ua_lower or "aarch" in ua_lower:
            return "Linux ARM"
        return "Linux PC"
    if len(ua) > 30:
        return ua[:27] + "..."
    return ua or "Unknown"


if __name__ == "__main__":
    app = NotificationTester()
    app.mainloop()
