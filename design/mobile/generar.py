# Genera los artboards .dc.html de la versión mobile de Perito.
import json, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pantallas")

# ---- Tokens (resueltos desde app/globals.css, tema claro) ----
FG = "#0F172A"
PRIMARY = "#0F172A"
PRIMARY_FG = "#F8FAFC"
MUTED = "#F1F5F9"
MUTED_FG = "#64748B"
BORDER = "#E2E8F0"
BG = "#FBFCFD"
CARD = "#FFFFFF"
SUCCESS = "#1CA64F"
WARNING = "#F59F0A"
DANGER = "#ED2C2C"
S10 = "#E8F6ED"
W10 = "#FEF5E6"
D10 = "#FDEAEA"
P5 = "#F3F4F5"
P10 = "#E7E8EA"
WARN_TXT = "#B45309"
R = "9.6px"     # --radius (lg)
RMD = "7.6px"   # md
RSM = "5.6px"   # sm
RXL = "12px"    # rounded-xl (Card)

ICONS = {
 "dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
 "calendar": '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
 "clipboard": '<rect width="8" height="4" x="8" y="2" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path>',
 "plus": '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
 "menu": '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path>',
 "car": '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"></path><circle cx="7" cy="17" r="2"></circle><path d="M9 17h6"></path><circle cx="17" cy="17" r="2"></circle>',
 "contact": '<path d="M16 2v2"></path><path d="M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"></path><path d="M8 2v2"></path><circle cx="12" cy="11" r="3"></circle><rect x="3" y="4" width="18" height="18" rx="2"></rect>',
 "building": '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path>',
 "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
 "message": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
 "user-circle": '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path>',
 "search": '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
 "chev-left": '<path d="m15 18-6-6 6-6"></path>',
 "chev-right": '<path d="m9 18 6-6-6-6"></path>',
 "chev-down": '<path d="m6 9 6 6 6-6"></path>',
 "check": '<path d="M20 6 9 17l-5-5"></path>',
 "check-circle": '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
 "alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
 "cloud": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>',
 "lock": '<rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
 "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path>',
 "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m17 8-5-5-5 5"></path><path d="M12 3v12"></path>',
 "copy": '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
 "file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
 "sheet": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M8 13h2"></path><path d="M14 13h2"></path><path d="M8 17h2"></path><path d="M14 17h2"></path>',
 "camera": '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>',
 "image-plus": '<path d="M16 5h6"></path><path d="M19 2v6"></path><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"></path><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path><circle cx="9" cy="9" r="2"></circle>',
 "scan": '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path>',
 "mic": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3"></path>',
 "trash": '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2"></path>',
 "clock": '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
 "pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
 "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>',
 "user": '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
 "logout": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path>',
 "help": '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path>',
 "sun": '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
 "moon": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>',
 "arrow-left": '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
 "arrow-right": '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
 "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
 "shield-alert": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path>',
 "store": '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"></path>',
 "scroll": '<path d="M15 12h-5"></path><path d="M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path>',
 "database": '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5V19A9 3 0 0 0 21 19V5"></path><path d="M3 12A9 3 0 0 0 21 12"></path>',
 "settings": '<path d="M20 7h-9"></path><path d="M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>',
 "send": '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path><path d="m21.854 2.147-10.94 10.939"></path>',
 "qr": '<rect width="5" height="5" x="3" y="3" rx="1"></rect><rect width="5" height="5" x="16" y="3" rx="1"></rect><rect width="5" height="5" x="3" y="16" rx="1"></rect><path d="M21 16h-3a2 2 0 0 0-2 2v3"></path><path d="M21 21v.01"></path><path d="M12 7v3a2 2 0 0 1-2 2H7"></path><path d="M3 12h.01"></path><path d="M12 3h.01"></path><path d="M12 16v.01"></path><path d="M16 12h1"></path><path d="M21 12v.01"></path><path d="M12 21v-1"></path>',
 "pen": '<path d="M12 20h9"></path><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"></path>',
 "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
 "trend": '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"></path><path d="M16 7h6v6"></path>',
 "up-right": '<path d="M7 7h10v10"></path><path d="M7 17 17 7"></path>',
 "list-checks": '<path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
 "check-check": '<path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path>',
 "filter": '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"></path>',
 "key": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path><circle cx="16.5" cy="7.5" r=".5"></circle>',
 "user-x": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="m17 8 5 5"></path><path d="m22 8-5 5"></path>',
 "user-check": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="m16 11 2 2 4-4"></path>',
 "crown": '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"></path><path d="M5 21h14"></path>',
 "share": '<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.59 13.51 6.83 3.98"></path><path d="m15.41 6.51-6.82 3.98"></path>',
 "gauge": '<path d="m12 14 4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path>',
 "dollar": '<path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>',
 "x": '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
 "phone-device": '<rect width="14" height="20" x="5" y="2" rx="2"></rect><path d="M12 18h.01"></path>',
 "sparkles": '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path>',
 "list": '<path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path>',
 "info": '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
 "play": '<path d="M6 3l14 9-14 9z"></path>',
 "pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path>',
 "id-card": '<rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M16 10h2"></path><path d="M16 14h2"></path><path d="M6.17 15a3 3 0 0 1 5.66 0"></path><circle cx="9" cy="11" r="2"></circle>',
 "mail": '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
 "refresh": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
 "login": '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><path d="m10 17 5-5-5-5"></path><path d="M15 12H3"></path>',
 "pause": '<rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect>',
 "link": '<path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><path d="M8 12h16"></path>',
 "more": '<circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle>',
 "undo": '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path>',
}


def ic(name, size=20, color="currentColor", sw=2):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; display: block">'
            f'{ICONS[name]}</svg>')


BADGE = {
    "default": (PRIMARY, PRIMARY_FG),
    "success": (SUCCESS, "#FFFFFF"),
    "warning": (WARNING, "#FFFFFF"),
    "danger": (DANGER, "#FFFFFF"),
    "neutral": (MUTED, MUTED_FG),
    "soft-success": (S10, "#15803D"),
    "soft-warning": (W10, WARN_TXT),
    "soft-danger": (D10, "#B91C1C"),
}


def badge(text, v="default", icon=None):
    bg, fg = BADGE[v]
    i = ic(icon, 11, fg, 2.5) if icon else ""
    return (f'<span style="display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 8px; '
            f'font-size: 10px; font-weight: 600; line-height: 16px; background: {bg}; color: {fg}; white-space: nowrap">{i}{text}</span>')


def plate(p, big=False):
    fs = "15px" if big else "13px"
    return (f'<span style="display: inline-flex; align-items: center; border: 1.5px solid {FG}; border-radius: {RSM}; padding: 2px 8px; '
            f'font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: {fs}; font-weight: 700; letter-spacing: 0.08em; background: #FFFFFF">{p}</span>')


def btn(text, v="default", icon=None, full=False, h=44, icon_right=None, fs="14px"):
    styles = {
        "default": f"background: {PRIMARY}; color: {PRIMARY_FG}; border: 1px solid {PRIMARY}",
        "outline": f"background: #FFFFFF; color: {FG}; border: 1px solid {BORDER}",
        "secondary": f"background: {MUTED}; color: {FG}; border: 1px solid {MUTED}",
        "ghost": f"background: transparent; color: {FG}; border: 1px solid transparent",
        "success": f"background: {SUCCESS}; color: #FFFFFF; border: 1px solid {SUCCESS}",
        "danger": f"background: #FFFFFF; color: {DANGER}; border: 1px solid {BORDER}",
    }[v]
    w = "width: 100%; " if full else ""
    col = PRIMARY_FG if v == "default" else ("#FFFFFF" if v == "success" else (DANGER if v == "danger" else FG))
    li = ic(icon, 18, col) if icon else ""
    ri = ic(icon_right, 18, col) if icon_right else ""
    return (f'<div style="{w}display: flex; align-items: center; justify-content: center; gap: 8px; height: {h}px; padding: 0 16px; '
            f'border-radius: {RMD}; font-size: {fs}; font-weight: 500; box-sizing: border-box; white-space: nowrap; {styles}">{li}<span>{text}</span>{ri}</div>')


def icon_btn(name, color=FG, border=True):
    b = f"border: 1px solid {BORDER}; background: #FFFFFF;" if border else "border: 1px solid transparent;"
    return (f'<div style="width: 44px; height: 44px; border-radius: {RMD}; {b} display: flex; align-items: center; justify-content: center; box-sizing: border-box">'
            f'{ic(name, 18, color)}</div>')


def card(inner, pad="16px", extra=""):
    return (f'<div style="background: {CARD}; border: 1px solid {BORDER}; border-radius: {RXL}; padding: {pad}; '
            f'box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); {extra}">{inner}</div>')


def field(label, value="", placeholder="", req=False, mono=False, hint="", warn=False, h=44, prefix="", select=False):
    star = f'<span style="color: {DANGER}"> *</span>' if req else ""
    txt = value if value else placeholder
    col = FG if value else MUTED_FG
    ff = "font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.06em; font-weight: 600;" if mono else ""
    bd = f"border: 1px solid {WARNING}; background: #FFFBF3; box-shadow: 0 0 0 1px {WARNING};" if warn else f"border: 1px solid {BORDER}; background: #FFFFFF;"
    pre = (f'<span style="color: {MUTED_FG}; padding-right: 10px; margin-right: 10px; border-right: 1px solid {BORDER}">{prefix}</span>' if prefix else "")
    chev = ic("chev-down", 16, MUTED_FG) if select else ""
    hint_html = f'<div style="font-size: 12px; line-height: 16px; color: {MUTED_FG}">{hint}</div>' if hint else ""
    return (f'<div style="display: flex; flex-direction: column; gap: 6px">'
            f'<div style="font-size: 14px; font-weight: 500; line-height: 20px">{label}{star}</div>'
            f'<div style="display: flex; align-items: center; justify-content: space-between; height: {h}px; padding: 0 12px; border-radius: {RMD}; {bd} font-size: 16px; color: {col}; box-sizing: border-box; {ff}">'
            f'<div style="display: flex; align-items: center; min-width: 0">{pre}<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{txt}</span></div>{chev}</div>'
            f'{hint_html}</div>')


def section_label(text, right=""):
    return (f'<div style="display: flex; align-items: center; justify-content: space-between; padding: 0 4px">'
            f'<div style="font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: {MUTED_FG}">{text}</div>{right}</div>')


def logo_mark(size=32):
    return f'<img src="logo.jpg" alt="Peritajes del Llano" style="width: {size}px; height: {size}px; border-radius: {RMD}; object-fit: cover; display: block">'


def topbar(sync="ok"):
    pills = {
        "ok": badge("Sincronizado", "soft-success", "check-circle"),
        "pending": badge("2 por subir", "soft-warning", "cloud"),
    }
    return (f'<div style="height: 56px; flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 16px; '
            f'background: rgba(255, 255, 255, 0.92); border-bottom: 1px solid {BORDER}">'
            f'{logo_mark(30)}'
            f'<div style="flex: 1; min-width: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Peritajes del Llano</div>'
            f'{pills[sync]}'
            f'<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: {MUTED_FG}">{ic("help", 20, MUTED_FG)}</div>'
            f'</div>')


def backbar(title, sub="", right=""):
    s = f'<div style="font-size: 12px; color: {MUTED_FG}; line-height: 16px">{sub}</div>' if sub else ""
    return (f'<div style="height: 56px; flex-shrink: 0; display: flex; align-items: center; gap: 4px; padding: 0 12px 0 4px; '
            f'background: #FFFFFF; border-bottom: 1px solid {BORDER}">'
            f'<div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center">{ic("chev-left", 24, FG)}</div>'
            f'<div style="flex: 1; min-width: 0"><div style="font-size: 16px; font-weight: 600; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{title}</div>{s}</div>'
            f'{right}</div>')


def page_title(title, sub="", right=""):
    s = f'<div style="font-size: 14px; line-height: 20px; color: {MUTED_FG}; text-wrap: pretty">{sub}</div>' if sub else ""
    return (f'<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px">'
            f'<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0">'
            f'<div style="font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 32px">{title}</div>{s}</div>{right}</div>')


TABS = [
    ("inicio", "Inicio", "dashboard"),
    ("agenda", "Agenda", "calendar"),
    ("nuevo", "Nuevo", "plus"),
    ("peritajes", "Peritajes", "clipboard"),
    ("mas", "Más", "menu"),
]


def tabbar(active):
    items = []
    for key, label, icon in TABS:
        if key == "nuevo":
            items.append(
                f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2px">'
                f'<div style="width: 52px; height: 52px; margin-top: -18px; border-radius: 999px; background: {PRIMARY}; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.28); border: 3px solid #FFFFFF">{ic("plus", 24, PRIMARY_FG, 2.5)}</div>'
                f'<div style="font-size: 11px; font-weight: 600; color: {FG}">{label}</div></div>')
            continue
        on = key == active
        col = FG if on else MUTED_FG
        pill = f"background: {MUTED};" if on else ""
        items.append(
            f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding-top: 8px">'
            f'<div style="width: 56px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; {pill}">{ic(icon, 22, col, 2.2 if on else 1.8)}</div>'
            f'<div style="font-size: 11px; font-weight: {600 if on else 500}; color: {col}">{label}</div></div>')
    return (f'<div style="flex-shrink: 0; height: 80px; display: flex; align-items: flex-start; padding: 0 4px 14px; box-sizing: border-box; '
            f'background: #FFFFFF; border-top: 1px solid {BORDER}">{"".join(items)}</div>')


def bottom_actions(inner):
    return (f'<div style="flex-shrink: 0; display: flex; gap: 10px; padding: 12px 16px 26px; background: rgba(255, 255, 255, 0.96); '
            f'border-top: 1px solid {BORDER}">{inner}</div>')


HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
  <style>
    body { margin: 0; background: #FBFCFD; color: #0F172A; font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; font-feature-settings: "cv11", "ss01"; }
    a { color: #0F172A; text-decoration: underline; text-underline-offset: 3px; }
    a:hover { color: #334155; }
    * { box-sizing: border-box; }
  </style>
</helmet>
"""
TAIL = """
</x-dc>
</body>
</html>
"""


def screen(name, h, parts_top, body, bottom="", bg=BG, gap=16, pad="20px 16px 24px"):
    html = (f'<div style="width: 390px; height: {h}px; display: flex; flex-direction: column; background: {bg}; overflow: hidden">'
            f'{parts_top}'
            f'<div style="flex: 1; min-height: 0; display: flex; flex-direction: column; gap: {gap}px; padding: {pad}; overflow: hidden">{body}</div>'
            f'{bottom}</div>')
    with open(os.path.join(OUT, name), "w") as f:
        f.write(HEAD + html + TAIL)


def row(inner, gap=12, align="center", extra=""):
    return f'<div style="display: flex; align-items: {align}; gap: {gap}px; {extra}">{inner}</div>'


def col(inner, gap=4, extra=""):
    return f'<div style="display: flex; flex-direction: column; gap: {gap}px; min-width: 0; {extra}">{inner}</div>'


def t(text, size=14, weight=400, color=FG, extra=""):
    lh = {10: 14, 11: 16, 12: 16, 13: 18, 14: 20, 15: 22, 16: 24, 18: 26, 20: 28, 24: 32, 28: 34, 36: 40}.get(size, size + 6)
    return f'<div style="font-size: {size}px; font-weight: {weight}; line-height: {lh}px; color: {color}; {extra}">{text}</div>'


def ellip(text, size=14, weight=400, color=FG):
    return t(text, size, weight, color, "white-space: nowrap; overflow: hidden; text-overflow: ellipsis")


def icon_tile(name, bg=MUTED, color=FG, size=40, isz=20):
    return (f'<div style="width: {size}px; height: {size}px; border-radius: {RMD}; background: {bg}; flex-shrink: 0; '
            f'display: flex; align-items: center; justify-content: center">{ic(name, isz, color)}</div>')


def searchbar(ph):
    return (f'<div style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px; border-radius: {RMD}; '
            f'border: 1px solid {BORDER}; background: #FFFFFF">{ic("search", 18, MUTED_FG)}'
            f'<span style="font-size: 15px; color: {MUTED_FG}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{ph}</span></div>')


def chips(items, active=0):
    out = []
    for i, it in enumerate(items):
        on = i == active
        st = (f"background: {PRIMARY}; color: {PRIMARY_FG}; border: 1px solid {PRIMARY};" if on
              else f"background: #FFFFFF; color: {FG}; border: 1px solid {BORDER};")
        out.append(f'<div style="height: 36px; padding: 0 14px; border-radius: 999px; display: flex; align-items: center; font-size: 13px; font-weight: 500; white-space: nowrap; {st}">{it}</div>')
    return f'<div style="display: flex; gap: 8px; overflow: hidden">{"".join(out)}</div>'


def list_card(rows_html):
    sep = f'<div style="height: 1px; background: {BORDER}; margin-left: 68px"></div>'
    return (f'<div style="background: {CARD}; border: 1px solid {BORDER}; border-radius: {RXL}; overflow: hidden; '
            f'box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05)">{sep.join(rows_html)}</div>')


def list_row(lead, title, sub, right="", chevron=True):
    ch = ic("chev-right", 18, "#CBD5E1") if chevron else ""
    return (f'<div style="display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 14px 10px 16px">'
            f'{lead}<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">'
            f'{ellip(title, 15, 600)}{ellip(sub, 13, 400, MUTED_FG)}</div>{right}{ch}</div>')


RISK = {"Bajo": "success", "Medio": "warning", "Alto": "danger", "Crítico": "danger"}


def bar(pct, color, h=6, bg=MUTED):
    return (f'<div style="height: {h}px; border-radius: 999px; background: {bg}; overflow: hidden">'
            f'<div style="width: {pct}%; height: 100%; border-radius: 999px; background: {color}"></div></div>')


# =============================================================
#  PÁGINA 1 — OPERACIÓN DIARIA
# =============================================================

def s_login():
    body = (
        f'<div style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 28px">'
        + col(logo_mark(64) + t("Peritajes del Llano", 16, 600), 12, "align-items: center")
        + col(t("Inicia sesión", 26, 700, FG, "letter-spacing: -0.02em; text-align: center")
              + t("Entra con tu usuario para acceder a tus peritajes.", 14, 400, MUTED_FG, "text-align: center"), 6)
        + col(
            field("Usuario", "cmendoza")
            + f'<div style="display: flex; flex-direction: column; gap: 6px">'
              f'<div style="display: flex; justify-content: space-between; align-items: center"><div style="font-size: 14px; font-weight: 500">Contraseña</div>'
              f'<div style="font-size: 13px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px">¿La olvidaste?</div></div>'
              f'<div style="display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 4px 0 12px; border-radius: {RMD}; border: 1px solid {BORDER}; background: #FFFFFF">'
              f'<span style="font-size: 18px; letter-spacing: 0.2em">••••••••••</span>'
              f'<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center">{ic("eye", 18, MUTED_FG)}</div></div></div>'
            + btn("Iniciar sesión", "default", full=True, h=48, fs="15px"), 16)
        + t("¿No tienes cuenta? Las crea el dueño de tu empresa desde el panel.", 12, 400, MUTED_FG, "text-align: center; padding: 0 24px")
        + '</div>'
    )
    screen("Login.dc.html", 844, "", body, "", bg=BG, pad="24px 24px 40px")


def s_dashboard():
    def kpi(label, value, sub, icon, tone):
        ib = {"muted": (MUTED, FG), "danger": (D10, DANGER), "success": (S10, SUCCESS)}[tone]
        return card(
            col(row(t(label, 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase; flex: 1") + icon_tile(icon, ib[0], ib[1], 30, 16), 8)
                + t(value, 26, 700, FG, "letter-spacing: -0.02em") + sub, 2),
            pad="12px 12px 14px", extra="flex: 1; min-width: 0")

    kpis = row(
        kpi("Este mes", "38", row(ic("up-right", 12, SUCCESS) + t("12%", 11, 600, SUCCESS), 2), "trend", "muted")
        + kpi("Riesgo alto", "4", t("9% · 1 crítico", 11, 400, MUTED_FG), "alert", "danger"), 10, "stretch")

    # Tendencia (área)
    pts = [18, 24, 21, 29, 34, 38]
    w, hh = 320, 90
    xs = [int(i * w / 5) for i in range(6)]
    ys = [int(hh - (p / 40) * hh) for p in pts]
    line = " ".join(f"{'M' if i == 0 else 'L'}{x} {y}" for i, (x, y) in enumerate(zip(xs, ys)))
    area = line + f" L{w} {hh} L0 {hh} Z"
    months = "".join(f'<span>{m}</span>' for m in ["Abr", "May", "Jun", "Jul", "Ago", "Sep"])
    trend = card(
        col(row(col(t("Tendencia mensual", 16, 600) + t("Últimos 6 meses", 13, 400, MUTED_FG), 0, "flex: 1")
                + col(t("38", 28, 700, FG, "letter-spacing: -0.02em; text-align: right") + t("peritajes · sep", 11, 400, MUTED_FG, "text-align: right"), 0), 8, "flex-start")
            + f'<svg width="100%" height="96" viewBox="0 -4 {w} {hh + 6}" preserveAspectRatio="none" style="display: block">'
              f'<path d="{area}" fill="{PRIMARY}" fill-opacity="0.07"></path>'
              f'<path d="{line}" fill="none" stroke="{PRIMARY}" stroke-width="2" stroke-linejoin="round"></path>'
              f'<circle cx="{xs[-1]}" cy="{ys[-1]}" r="4" fill="{PRIMARY}"></circle></svg>'
            + f'<div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: {MUTED_FG}">{months}</div>', 10))

    dist = card(col(
        row(t("Distribución de riesgo", 16, 600, FG, "flex: 1") + t("164 peritajes", 12, 400, MUTED_FG))
        + f'<div style="display: flex; height: 12px; border-radius: 999px; overflow: hidden; gap: 2px">'
          f'<div style="flex: 58; background: {SUCCESS}"></div><div style="flex: 27; background: {WARNING}"></div>'
          f'<div style="flex: 11; background: {DANGER}"></div><div style="flex: 4; background: {DANGER}; opacity: 0.7"></div></div>'
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px">'
        + "".join(row(f'<div style="width: 8px; height: 8px; border-radius: 999px; background: {c}; opacity: {o}"></div>' + t(l, 13, 400, FG, "flex: 1") + t(n, 13, 600), 8)
                  for l, c, o, n in [("Bajo", SUCCESS, 1, "95"), ("Medio", WARNING, 1, "44"), ("Alto", DANGER, 1, "18"), ("Crítico", DANGER, 0.7, "7")])
        + '</div>', 12))

    def rec(p, veh, when, risk, done):
        right = ic("check-circle", 18, SUCCESS) if done else ic("clock", 18, MUTED_FG)
        return list_row(icon_tile("clipboard", MUTED, FG, 40, 18),
                        f'{p} &nbsp;{badge(risk, RISK[risk])}', f"{veh} · {when}", right, chevron=False)

    recent = col(
        section_label("Peritajes recientes", t("Ver todos", 13, 600, FG))
        + list_card([
            rec("ABC123", "Toyota Corolla · 2020", "hoy 10:24", "Bajo", False),
            rec("BPA481", "Renault Sandero · 2016", "ayer", "Medio", True),
            rec("JFG459", "Mazda CX-30 · 2021", "14 sep", "Alto", True),
        ]), 8)

    body = (page_title("Hola, Carlos", "Control de tu actividad de peritajes.") + kpis + trend + dist + recent)
    screen("Main.dc.html", 1060, topbar(), body, tabbar("inicio"))


def s_peritajes():
    def pcard(p, veh, cons, risk, tipo, status, km, fecha, perito, hall, pending=False, finished=False):
        st = badge("Finalizado", "soft-success", "lock") if finished else badge("Borrador", "neutral")
        up = badge("Por subir", "soft-warning", "cloud") if pending else ""
        pl = plate(p) if p else t("Sin placa", 15, 600, MUTED_FG)
        grid = ('<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px">'
                + "".join(col(t(k, 10, 600, MUTED_FG, "letter-spacing: 0.05em; text-transform: uppercase") + ellip(v, 13, 500), 2)
                          for k, v in [("Fecha", fecha), ("Km", km), ("Perito", perito), ("Hallazgos", hall)])
                + '</div>')
        acts = row(
            f'<div style="flex: 1">{btn("Abrir", "ghost", "file", h=40, fs="14px")}</div>'
            + (icon_btn("download") if finished else "") + icon_btn("copy") + icon_btn("more", FG), 6)
        return card(col(
            row(col(row(pl + (f'<span style="font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: {MUTED_FG}; background: {MUTED}; padding: 2px 6px; border-radius: 4px">{cons}</span>' if cons else ""), 8)
                    + ellip(veh, 14, 400, MUTED_FG), 6, "flex: 1")
                + f'<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px">{badge(risk, RISK[risk])}{badge(tipo, "neutral")}</div>', 8, "flex-start")
            + row(st + up, 6)
            + grid
            + f'<div style="height: 1px; background: {BORDER}; margin: 0 -14px"></div>'
            + acts, 12), pad="14px 14px 8px")

    body = (
        page_title("Peritajes", "164 peritajes registrados.", icon_btn("sheet"))
        + searchbar("Buscar por placa, VIN, propietario…")
        + chips(["Todos", "Borradores", "Finalizados", "Por subir"], 0)
        + pcard("ABC123", "Toyota Corolla XEI · 2020", "", "Bajo", "Plus", "", "40.000 km", "16 sep", "C. Mendoza", "2", pending=True)
        + pcard("BPA481", "Renault Sandero · 2016", "PER-2026-0041", "Medio", "Pro", "", "85.000 km", "15 sep", "C. Mendoza", "6", finished=True)
        + pcard("JFG459", "Mazda CX-30 · 2021", "PER-2026-0040", "Alto", "Plus", "", "62.300 km", "14 sep", "L. Rincón", "11", finished=True)
    )
    screen("Peritajes.dc.html", 1060, topbar("pending"), body, tabbar("peritajes"))


def s_agenda():
    days = ["L", "M", "X", "J", "V", "S", "D"]
    nums = [15, 16, 17, 18, 19, 20, 21]
    dots = [1, 2, 0, 1, 3, 0, 0]
    strip = '<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px">'
    for d, n, k in zip(days, nums, dots):
        on = n == 16
        bgc = PRIMARY if on else "#FFFFFF"
        fc = PRIMARY_FG if on else FG
        dd = "".join(f'<div style="width: 4px; height: 4px; border-radius: 999px; background: {PRIMARY_FG if on else PRIMARY}"></div>' for _ in range(min(k, 3)))
        strip += (f'<div style="height: 68px; border-radius: {R}; background: {bgc}; border: 1px solid {PRIMARY if on else BORDER}; '
                  f'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px">'
                  f'<div style="font-size: 11px; font-weight: 500; color: {PRIMARY_FG if on else MUTED_FG}">{d}</div>'
                  f'<div style="font-size: 17px; font-weight: 700; color: {fc}">{n}</div>'
                  f'<div style="display: flex; gap: 3px; height: 4px">{dd}</div></div>')
    strip += '</div>'

    seg = (f'<div style="display: flex; padding: 3px; border-radius: {RMD}; border: 1px solid {BORDER}; background: #FFFFFF">'
           f'<div style="height: 32px; padding: 0 10px; border-radius: {RSM}; background: {PRIMARY}; color: {PRIMARY_FG}; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500">{ic("list", 15, PRIMARY_FG)}Lista</div>'
           f'<div style="height: 32px; padding: 0 10px; border-radius: {RSM}; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500">{ic("calendar", 15)}Mes</div></div>')

    def appt(hour, st, stv, p, name, phone, place, primary_action, note=""):
        n = (f'<div style="border-left: 2px solid {BORDER}; background: {MUTED}; padding: 6px 10px; border-radius: 0 {RSM} {RSM} 0; font-size: 12px; color: {MUTED_FG}">{note}</div>' if note else "")
        return card(col(
            row(row(ic("clock", 18, FG) + t(hour, 18, 700, FG, "letter-spacing: -0.01em"), 6, extra="flex: 1") + badge(st, stv))
            + row(plate(p) + ellip(name, 14, 500), 10)
            + col(row(ic("phone", 15, MUTED_FG) + t(phone, 13, 500, FG, "text-decoration: underline; text-underline-offset: 3px"), 8)
                  + row(ic("pin", 15, MUTED_FG) + ellip(place, 13, 400, MUTED_FG), 8), 6)
            + n
            + row(f'<div style="flex: 1">{primary_action}</div>' + icon_btn("pencil") + icon_btn("more"), 6), 12), pad="14px")

    body = (
        page_title("Agenda", "Martes, 16 de septiembre", seg)
        + row(t("Septiembre 2026", 15, 600, FG, "flex: 1") + ic("chev-left", 20, MUTED_FG) + ic("chev-right", 20, FG), 16)
        + strip
        + section_label("Hoy", badge("2", "neutral"))
        + appt("08:30", "En curso", "warning", "ABC123", "Juan Pérez Gómez", "310 555 1234", "Taller principal · Villavicencio",
               btn("Abrir peritaje", "outline", "calendar", full=True, h=44))
        + appt("11:00", "Programada", "default", "KLM456", "Santiago García", "313 880 7390", "Cra. 33 #15-20, Barzal",
               btn("Iniciar peritaje", "default", "play", full=True, h=44), "Cliente pide informe antes de las 3 p. m. para el banco.")
    )
    screen("Agenda.dc.html", 940, topbar(), body, tabbar("agenda"))


def s_intake():
    def opt(title, icon, secs, desc, on=False):
        bd = f"border: 2px solid {PRIMARY}; background: {P5};" if on else f"border: 2px solid {BORDER}; background: #FFFFFF;"
        chk = ic("check-circle", 22, PRIMARY) if on else f'<div style="width: 20px; height: 20px; border-radius: 999px; border: 2px solid {BORDER}"></div>'
        return (f'<div style="border-radius: {RXL}; padding: 14px; {bd} display: flex; gap: 12px; align-items: flex-start">'
                + icon_tile(icon, PRIMARY if on else MUTED, PRIMARY_FG if on else FG, 40, 20)
                + col(row(t(title, 15, 600, FG, "flex: 1") + chk, 8) + t(desc, 13, 400, MUTED_FG, "text-wrap: pretty") + t(f"{secs} secciones", 12, 600, FG), 4, "flex: 1")
                + '</div>')

    def step(n, label):
        return row(f'<div style="width: 24px; height: 24px; border-radius: 999px; background: {PRIMARY}; color: {PRIMARY_FG}; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center">{n}</div>' + t(label, 15, 600), 10)

    veh = ["Sedán", "Hatchback", "SUV", "Pick Up Doble Cabina", "Moto", "Otros…"]
    vgrid = '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">'
    for i, v in enumerate(veh):
        on = i == 0
        st = f"border: 2px solid {PRIMARY}; background: {P5}; font-weight: 600;" if on else f"border: 1px solid {BORDER}; background: #FFFFFF;"
        vgrid += f'<div style="min-height: 48px; border-radius: {RMD}; {st} display: flex; align-items: center; justify-content: center; text-align: center; font-size: 13px; padding: 4px 6px">{v}</div>'
    vgrid += '</div>'

    body = (
        col(t("Elige el tipo de vehículo a inspeccionar y el tipo de peritaje.", 14, 400, MUTED_FG), 4)
        + col(step(1, "Tipo de vehículo") + vgrid
              + t("Automóvil de 4 puertas con baúl separado.", 12, 400, MUTED_FG), 10)
        + col(step(2, "Tipo de peritaje")
              + opt("Peritaje Plus", "clipboard", 10, "El más completo: estructura, carrocería, identificación, siniestros, antecedentes, improntas, eléctrica, motor y prueba de compresión.", True)
              + opt("Peritaje Pro", "gauge", 10, "Igual que Plus pero sin la prueba de compresión del motor.")
              + opt("Peritaje Sencillo", "dollar", 8, "Lo esencial: estructura, carrocería, identificación y reclamación de siniestros."), 10)
    )
    screen("NuevoPeritaje.dc.html", 1000, backbar("Nuevo peritaje"), body,
           bottom_actions(btn("Iniciar peritaje", "default", full=True, h=48, icon_right="arrow-right", fs="15px")))


def s_mas():
    def group(title, items):
        rows = [list_row(icon_tile(i, MUTED, FG, 36, 18), l, s) for i, l, s in items]
        return col(section_label(title) + list_card(rows), 8)

    user = card(row(
        f'<div style="width: 48px; height: 48px; border-radius: 999px; background: {PRIMARY}; color: {PRIMARY_FG}; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600">CM</div>'
        + col(t("Carlos Mendoza", 16, 600) + t("@cmendoza · Dueño", 13, 400, MUTED_FG), 2, "flex: 1")
        + ic("chev-right", 18, "#CBD5E1"), 12))

    sync = card(row(icon_tile("cloud", W10, WARNING, 36, 18)
                    + col(t("2 cambios por subir", 14, 600) + t("Se suben solos al recuperar señal.", 12, 400, MUTED_FG), 2, "flex: 1")
                    + btn("Subir", "outline", h=36, fs="13px"), 12), pad="12px 14px")

    theme = col(section_label("Tema") + f'<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">'
                + "".join(f'<div style="height: 64px; border-radius: {R}; border: {"2px solid " + PRIMARY if i == 0 else "1px solid " + BORDER}; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: {600 if i == 0 else 500}">{ic(icn, 20)}{lbl}</div>'
                          for i, (icn, lbl) in enumerate([("sun", "Claro"), ("moon", "Oscuro"), ("eye", "Exterior")]))
                + '</div>', 8)

    body = (
        page_title("Más")
        + user + sync
        + group("Registros", [("car", "Vehículos", "Histórico por placa"), ("contact", "Propietarios", "Cartera de clientes")])
        + group("Mi empresa", [("building", "Empresa", "Datos del encabezado del PDF"), ("users", "Empleados", "4 personas en tu equipo"), ("message", "WhatsApp", "Conectado · Kapso")])
        + theme
        + row(f'<div style="flex: 1">{btn("Guía de uso", "outline", "help", full=True)}</div>'
              + f'<div style="flex: 1">{btn("Salir", "danger", "logout", full=True)}</div>', 10)
    )
    screen("Mas.dc.html", 1040, topbar("pending"), body, tabbar("mas"))


# =============================================================
#  PÁGINA 2 — INSPECCIÓN (wizard)
# =============================================================

def wiz_top(step_n, total, label, findings=0, saved="Guardado hace 5 s"):
    pct = int(step_n / total * 100)
    fb = badge(f"{findings}", "warning", "alert") if findings else ""
    return (
        backbar("Peritaje Plus · Sedán",
                f'<span style="display: inline-flex; align-items: center; gap: 6px"><span style="font-family: ui-monospace, Menlo, monospace; font-weight: 700; color: {FG}">ABC123</span> · '
                f'<span style="display: inline-flex; align-items: center; gap: 3px; color: {SUCCESS}">{ic("check", 12, SUCCESS, 2.5)}{saved}</span></span>',
                f'<div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center">{ic("menu", 22, FG)}</div>')
        + f'<div style="flex-shrink: 0; background: #FFFFFF; padding: 10px 16px 12px; border-bottom: 1px solid {BORDER}; display: flex; flex-direction: column; gap: 10px">'
        + row(f'<div style="width: 30px; height: 30px; border-radius: {RMD}; background: {P10}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700">{step_n}</div>'
              + col(t(f"Paso {step_n} / {total}", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase") + t(label, 15, 600), 0, "flex: 1")
              + fb + ic("list-checks", 20, FG), 10)
        + bar(pct, PRIMARY, 4)
        + '</div>'
    )


def wiz_bottom(next_label="Siguiente"):
    return bottom_actions(
        f'<div style="flex: 1">{btn("Atrás", "outline", "arrow-left", full=True, h=48)}</div>'
        + f'<div style="flex: 1.4">{btn(next_label, "default", full=True, h=48, icon_right="arrow-right")}</div>')


def s_wiz_vehiculo():
    scan = card(col(
        row(t("Tarjeta de propiedad", 16, 600, FG, "flex: 1") + badge("1 de 2", "soft-warning"))
        + t("Escanea las dos caras. El frente extrae los datos solo.", 13, 400, MUTED_FG)
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">'
        + col(f'<div style="height: 96px; border-radius: {RMD}; background: linear-gradient(135deg, #DCE7F3, #C7D6E8); position: relative; overflow: hidden">'
              f'<div style="position: absolute; left: 10px; top: 12px; width: 60%; height: 6px; border-radius: 3px; background: rgba(15,23,42,0.18)"></div>'
              f'<div style="position: absolute; left: 10px; top: 26px; width: 40%; height: 6px; border-radius: 3px; background: rgba(15,23,42,0.14)"></div>'
              f'<div style="position: absolute; left: 10px; top: 40px; width: 70%; height: 6px; border-radius: 3px; background: rgba(15,23,42,0.14)"></div>'
              f'<div style="position: absolute; left: 8px; bottom: 8px">{badge("Capturado", "success", "check")}</div></div>'
              + t("Frente", 13, 500), 6)
        + col(f'<div style="height: 96px; border-radius: {RMD}; border: 2px dashed {BORDER}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: {MUTED}">{ic("camera", 22, MUTED_FG)}<span style="font-size: 12px; color: {MUTED_FG}">Sin captura</span></div>'
              + t("Reverso", 13, 500), 6)
        + '</div>'
        + row(f'<div style="flex: 1">{btn("Re-escanear", "outline", "scan", full=True, h=44, fs="13px")}</div>'
              + f'<div style="flex: 1">{btn("Capturar reverso", "default", "camera", full=True, h=44, fs="13px")}</div>', 8), 12))

    pend = (f'<div style="border: 1px solid {WARNING}; background: {W10}; border-radius: {R}; padding: 12px; display: flex; gap: 10px">'
            + ic("alert", 18, WARNING)
            + col(t("2 campos por completar", 14, 600) + t("Revisa la tarjeta fotografiada; quedan resaltados abajo.", 12, 400, FG), 2)
            + '</div>')

    datos = card(col(
        t("Datos del vehículo", 16, 600)
        + pend
        + f'<div style="display: flex; flex-direction: column; gap: 6px"><div style="display: flex; justify-content: space-between; align-items: center"><div style="font-size: 14px; font-weight: 500">Placa<span style="color: {DANGER}"> *</span></div>{badge("Consultado", "soft-success", "check-circle")}</div>'
          f'<div style="height: 52px; border-radius: {RMD}; border: 1px solid {BORDER}; background: #FFFFFF; display: flex; align-items: center; padding: 0 12px; font-family: ui-monospace, Menlo, monospace; font-size: 22px; font-weight: 700; letter-spacing: 0.14em">ABC123</div></div>'
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
        + field("Marca", "TOYOTA", req=True) + field("Modelo", "2020", req=True)
        + '</div>'
        + field("Línea", "COROLLA XEI 1.8", req=True)
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
        + field("Color", "BLANCO") + field("Carrocería", "SEDÁN", select=True)
        + field("Kilometraje", "", "85000", req=True, warn=True) + field("Combustible", "GASOLINA", select=True)
        + '</div>'
        + field("No. Serial", "1HGBH41JXMN109186", mono=True)
        + field("Celular del cliente", "", "310 555 1234", req=True, warn=True, prefix="+57",
                hint="Obligatorio para entregar el PDF al cliente al finalizar."), 14))

    ident = (f'<div style="border: 1px solid #C9CCD2; background: {P5}; border-radius: {R}; padding: 10px 12px; display: flex; gap: 8px; align-items: center">'
             + ic("user-check", 16, FG) + t("Registrando como perito: <b>Carlos Mendoza</b>", 13) + '</div>')

    body = ident + scan + datos
    screen("PasoVehiculo.dc.html", 1440, wiz_top(1, 12, "Vehículo"), body, wiz_bottom(), gap=14)


def s_wiz_recorrido():
    def item(label, note, state, sv, photos=0, open_=False):
        ph = row(ic("camera", 13, MUTED_FG) + t(str(photos), 12, 500, MUTED_FG), 3) if photos else ""
        chip = (f'<span style="display: inline-flex; border-radius: 999px; border: 1px dashed {BORDER}; padding: 3px 10px; font-size: 11px; font-weight: 600; color: {MUTED_FG}">Pendiente</span>'
                if sv is None else
                f'<span style="display: inline-flex; border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 600; '
                f'background: {dict(success=S10, warning=W10, danger=D10)[sv]}; color: {dict(success="#15803D", warning=WARN_TXT, danger="#B91C1C")[sv]}; '
                f'border: 1px solid {dict(success="#BBE5C9", warning="#FAD7A0", danger="#F7B9B9")[sv]}">{state}</span>')
        bd = f"border: 1px solid #FAD7A0;" if sv == "warning" else f"border: 1px solid {BORDER};"
        head = row(col(ellip(label, 15, 500) + (ellip(note, 12, 400, MUTED_FG) if note else ""), 1, "flex: 1") + ph + chip
                   + ic("chev-down", 18, MUTED_FG), 8)
        body_ = ""
        if open_:
            def qb(l, c, cbg, on):
                st = f"background: {c}; color: #FFFFFF; border: 1px solid {c};" if on else f"background: {cbg}; color: {FG}; border: 1px solid transparent;"
                return f'<div style="flex: 1; min-height: 44px; border-radius: {RMD}; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; {st}">{l}</div>'
            body_ = (
                f'<div style="height: 1px; background: {BORDER}; margin: 12px -14px"></div>'
                + col(
                    row(qb("Bueno", SUCCESS, S10, False) + qb("N/A", MUTED_FG, MUTED, False), 8)
                    + t("Estado", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase")
                    + f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">'
                    + qb("Regular", WARNING, W10, False) + qb("Rayón", WARNING, W10, False) + qb("Sumido", WARNING, W10, False) + qb("Deformado", DANGER, D10, False)
                    + '</div>'
                    + t("Intervención", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase")
                    + f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">'
                    + qb("Bien reparado", WARNING, W10, False) + qb("Repintado", WARNING, W10, True) + qb("Mal reparado", DANGER, D10, False)
                    + '</div>'
                    + f'<div style="border: 1px solid {BORDER}; border-radius: {RMD}; padding: 10px 12px; min-height: 64px; display: flex; justify-content: space-between; gap: 8px">'
                      f'<span style="font-size: 14px; color: {FG}">Repinte parcial, diferencia de brillo en la esquina.</span>'
                      f'<div style="width: 36px; height: 36px; border-radius: {RMD}; background: {MUTED}; display: flex; align-items: center; justify-content: center; flex-shrink: 0">{ic("mic", 18)}</div></div>'
                    + '<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px">'
                    + "".join(f'<div style="aspect-ratio: 1; border-radius: {RMD}; background: linear-gradient({a}deg, #94A3B8, #CBD5E1)"></div>' for a in (20, 140))
                    + f'<div style="aspect-ratio: 1; border-radius: {RMD}; border: 2px dashed {BORDER}; display: flex; align-items: center; justify-content: center">{ic("image-plus", 22, MUTED_FG)}</div>'
                    + '</div>', 10))
        return f'<div style="background: #FFFFFF; {bd} border-radius: {R}; padding: 12px 14px">{head}{body_}</div>'

    body = (
        col(t("Frente y delantero izquierdo", 20, 700, FG, "letter-spacing: -0.01em")
            + t("Capó, punta y guardafangos izquierdos, suspensión y llanta delantera izq.", 13, 400, MUTED_FG), 4)
        + btn("Marcar 5 restantes como Bueno", "outline", "check-check", full=True, h=44)
        + item("Capó", "", "Bueno", "success")
        + item("Bomper delantero", "", "Bueno", "success")
        + item("Guardafangos delantero izquierdo", "Repinte parcial, diferencia de brillo…", "Repintado", "warning", 2, True)
        + item("Punta delantera izquierda", "", "", None)
        + item("Torre delantera izquierda", "", "", None)
    )
    screen("PasoRecorrido.dc.html", 1180, wiz_top(2, 12, "Frente", 3), body, wiz_bottom(), gap=10)


def s_wiz_llanta():
    def qb(l, c, cbg, on, flex=True):
        st = f"background: {c}; color: #FFFFFF; border: 1px solid {c};" if on else f"background: {cbg}; color: {FG}; border: 1px solid transparent;"
        return f'<div style="{"flex: 1; " if flex else ""}min-height: 44px; padding: 0 10px; border-radius: {RMD}; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; {st}">{l}</div>'

    def seg(items, active, colors=None):
        out = ""
        for i, it in enumerate(items):
            on = i == active
            c = (colors[i] if colors else PRIMARY)
            st = f"background: {c}; color: #FFFFFF; border: 1px solid {c};" if on else f"background: #FFFFFF; color: {FG}; border: 1px solid {BORDER};"
            out += f'<div style="flex: 1; height: 40px; border-radius: {RMD}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 500; {st}">{it}</div>'
        return f'<div style="display: flex; gap: 6px">{out}</div>'

    tire = card(col(
        row(col(t("Llanta trasera izquierda", 16, 600) + t("Conjunto rueda", 12, 400, MUTED_FG), 0, "flex: 1")
            + t("42%", 22, 700, WARNING) + badge("Regular", "soft-warning"), 10)
        + t("Neumático", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase")
        + row(t("Profundidad de banda", 14, 500, FG, "flex: 1")
              + f'<div style="height: 36px; width: 72px; border-radius: {RMD}; border: 1px solid {BORDER}; display: flex; align-items: center; justify-content: center; gap: 2px; font-size: 15px; font-weight: 600">42<span style="color: {MUTED_FG}; font-weight: 400">%</span></div>', 8)
        + f'<div style="position: relative; height: 32px; display: flex; align-items: center">'
          f'<div style="position: absolute; left: 0; right: 0; height: 6px; border-radius: 999px; background: linear-gradient(90deg, {DANGER} 0%, {DANGER} 25%, {WARNING} 25%, {WARNING} 50%, {SUCCESS} 50%)"></div>'
          f'<div style="position: absolute; left: calc(42% - 14px); width: 28px; height: 28px; border-radius: 999px; background: #FFFFFF; border: 2px solid {FG}; box-shadow: 0 2px 6px rgba(0,0,0,0.18)"></div></div>'
        + row(qb("Bueno", SUCCESS, S10, False) + qb("Regular", WARNING, W10, True) + qb("N/A", MUTED_FG, MUTED, False), 8)
        + f'<div style="height: 1px; background: {BORDER}"></div>'
        + t("Rin", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase")
        + col(t("Material", 13, 500) + seg(["Acero", "Aluminio", "Magnesio"], 1), 6)
        + col(t("Origen", 13, 500) + seg(["Original", "Réplica", "Aftermarket"], 0, [SUCCESS, WARNING, WARNING]), 6)
        + col(t("Calificación del rin", 13, 500)
              + row(qb("Bueno", SUCCESS, S10, False) + qb("Rayado", WARNING, W10, True) + qb("Doblado", DANGER, D10, False), 8), 6)
        + btn("Agregar foto", "outline", "image-plus", full=True, h=44), 12), pad="14px")

    body = (
        col(t("Costado izquierdo", 20, 700, FG, "letter-spacing: -0.01em")
            + t("Puertas, estribo y llanta trasera izquierda.", 13, 400, MUTED_FG), 4)
        + tire
    )
    screen("PasoLlanta.dc.html", 1000, wiz_top(3, 12, "Izquierda", 4, "Guardado justo ahora"), body, wiz_bottom(), gap=12)


def s_wiz_fugas():
    def grp(name, done, total, rows, open_=True, finding=False):
        head = row(t(name, 15, 600, FG, "flex: 1")
                   + (badge("Hallazgos", "danger") if finding else "")
                   + badge(f"{done}/{total}", "success" if done == total else "neutral")
                   + ic("chev-down", 18, MUTED_FG), 8)
        if not open_:
            return card(head, pad="14px")
        rr = ""
        for n, st, sv in rows:
            c = dict(success=("#15803D", S10), warning=(WARN_TXT, W10), danger=("#B91C1C", D10))[sv]
            rr += (f'<div style="display: flex; align-items: center; gap: 10px; min-height: 48px; border-top: 1px solid {BORDER}">'
                   f'<div style="flex: 1; font-size: 14px">{n}</div>'
                   f'<span style="border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 600; background: {c[1]}; color: {c[0]}">{st}</span>'
                   f'{ic("chev-right", 16, "#CBD5E1")}</div>')
        return card(col(head + f'<div style="margin-top: 8px">{rr}</div>', 0), pad="14px 14px 4px")

    prog = card(col(
        row(col(t("Líquidos del motor", 17, 600) + t("Fugas y estado de fluidos.", 13, 400, MUTED_FG), 2, "flex: 1")
            + col(t("Inspeccionados", 10, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase; text-align: right")
                  + t("14/14", 18, 700, FG, "text-align: right") + t("2 hallazgos", 11, 600, WARN_TXT, "text-align: right"), 0), 10, "flex-start")
        + bar(100, SUCCESS, 6), 10))

    body = (
        prog
        + grp("Niveles de fluidos", 6, 6, [("Aceite motor", "Full", "success"), ("Aceite caja", "Full", "success"),
                                            ("Refrigerante", "Medio", "warning"), ("Líquido de frenos", "Full", "success"),
                                            ("Lava parabrisas", "Bajo", "danger")], True, True)
        + grp("Fugas de fluidos", 8, 8, [("Fuga de aceite motor", "Humedad", "warning"), ("Fuga de refrigerante", "Sin fugas", "success"),
                                          ("Fuga de líquido de frenos", "Sin fugas", "success")], True, True)
    )
    screen("PasoFugas.dc.html", 960, wiz_top(7, 12, "Fugas", 6), body, wiz_bottom(), gap=12)


def s_wiz_fotos():
    slots = [("Diagonal Delantera Izquierda", True), ("Diagonal Trasera Derecha", True), ("Habitáculo Interno", True),
             ("Número de Chasis", False), ("Número de Motor", True), ("Número de Plaqueta", False)]
    grid = '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">'
    for i, (lbl, ok) in enumerate(slots):
        if ok:
            img = (f'<div style="aspect-ratio: 4 / 3; border-radius: {RMD}; background: linear-gradient({30 + i * 40}deg, #94A3B8, #D5DDE7); position: relative">'
                   f'<div style="position: absolute; right: 6px; top: 6px; width: 22px; height: 22px; border-radius: 999px; background: {SUCCESS}; display: flex; align-items: center; justify-content: center">{ic("check", 13, "#FFFFFF", 3)}</div></div>')
        else:
            img = (f'<div style="aspect-ratio: 4 / 3; border-radius: {RMD}; border: 2px dashed #F7B9B9; background: {D10}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px">'
                   f'{ic("camera", 24, DANGER)}<span style="font-size: 12px; font-weight: 600; color: #B91C1C">Tomar foto</span></div>')
        grid += col(img + t(f'{lbl}<span style="color: {DANGER}"> *</span>', 13, 500, FG, "text-wrap: pretty"), 6)
    grid += '</div>'

    body = (
        card(col(row(icon_tile("camera", P10, FG, 36, 18)
                     + col(t("Fotografías obligatorias", 16, 600) + t("Estas 6 tomas son requeridas.", 13, 400, MUTED_FG), 2, "flex: 1")
                     + badge("4/6", "warning"), 10)
                 + grid, 14))
        + card(row(icon_tile("image-plus", MUTED, FG, 36, 18)
                   + col(t("Fotografías adicionales", 15, 600) + t("3 fotos adjuntas", 13, 400, MUTED_FG), 2, "flex: 1")
                   + btn("Agregar", "outline", "plus", h=40, fs="13px"), 10))
    )
    screen("PasoFotos.dc.html", 1000, wiz_top(11, 12, "Fotos", 6), body, wiz_bottom(), gap=12)


def s_wiz_resumen():
    pillars = [("Estructura y seguridad", "45%", "92", "88"), ("Mecánica", "30%", "78", "81"),
               ("Carrocería y pintura", "15%", "70", "74"), ("Llantas y accesorios", "10%", "85", "85")]
    prow = ""
    for name, w, val, auto in pillars:
        v = int(val)
        c = SUCCESS if v >= 80 else (WARNING if v >= 55 else DANGER)
        prow += (f'<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid {BORDER}">'
                 + row(col(t(name, 14, 600) + t(f"Peso {w} · Automático: {auto}%", 12, 400, MUTED_FG), 2, "flex: 1")
                       + f'<div style="display: flex; align-items: center; height: 44px; border-radius: {RMD}; border: 1px solid {BORDER}; background: #FFFFFF; overflow: hidden">'
                         f'<div style="width: 36px; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: {MUTED_FG}; border-right: 1px solid {BORDER}">−</div>'
                         f'<div style="width: 52px; text-align: center; font-size: 17px; font-weight: 700">{val}<span style="font-size: 12px; font-weight: 500; color: {MUTED_FG}">%</span></div>'
                         f'<div style="width: 36px; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: {MUTED_FG}; border-left: 1px solid {BORDER}">+</div></div>', 10)
                 + bar(v, c, 6)
                 + '</div>')

    modules = card(col(
        t("Calificación por módulos", 16, 600)
        + t("Asigna el porcentaje de cada módulo. Es el que sale en el informe; el cálculo automático queda como referencia.", 13, 400, MUTED_FG, "text-wrap: pretty")
        + f'<div style="margin-top: 4px">{prow}</div>'
        + f'<div style="border-radius: {R}; background: {PRIMARY}; color: {PRIMARY_FG}; padding: 14px; display: flex; align-items: center; justify-content: space-between">'
          f'<div><div style="font-size: 12px; opacity: 0.7">Estado general · promedio ponderado</div><div style="font-size: 14px; font-weight: 600">Riesgo bajo</div></div>'
          f'<div style="font-size: 32px; font-weight: 700; letter-spacing: -0.02em">84%</div></div>', 6))

    def seg2(a, b, on):
        def one(l, active, c):
            st = f"background: {c}; color: #FFFFFF; border: 1px solid {c};" if active else f"background: #FFFFFF; color: {FG}; border: 1px solid {BORDER};"
            return f'<div style="flex: 1; height: 44px; border-radius: {RMD}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; {st}">{l}</div>'
        return row(one(a, on == 0, SUCCESS) + one(b, on == 1, DANGER), 8)

    concl = card(col(
        t("Conclusión técnica", 16, 600)
        + field("Condición general", "ESTÁNDAR", req=True, select=True)
        + col(t("Concepto de asegurabilidad", 14, 500) + seg2("ASEGURABLE SÍ", "ASEGURABLE NO", 0), 6)
        + col(t("Observaciones generales", 14, 500)
              + f'<div style="border: 1px solid {BORDER}; border-radius: {RMD}; padding: 10px 12px; min-height: 88px; display: flex; justify-content: space-between; gap: 8px; background: #FFFFFF">'
                f'<span style="font-size: 14px; line-height: 20px">Vehículo en buen estado general. Repinte en guardafangos delantero izquierdo y humedad leve en el retén del motor.</span>'
                f'<div style="width: 36px; height: 36px; border-radius: {RMD}; background: {MUTED}; display: flex; align-items: center; justify-content: center; flex-shrink: 0">{ic("mic", 18)}</div></div>', 6), 14))

    firma = card(col(
        row(t("Firma del cliente", 16, 600, FG, "flex: 1") + badge("Pendiente", "soft-warning"))
        + t("Firma de Juan Pérez Gómez · CC 1.234.567.890", 13, 400, MUTED_FG)
        + row(f'<div style="flex: 1">{btn("Firmar con QR", "default", "qr", full=True)}</div>'
              + f'<div style="flex: 1">{btn("En esta pantalla", "outline", "pen", full=True, fs="13px")}</div>', 8)
        + f'<div style="border: 1px solid #C9CCD2; background: {P5}; border-radius: {R}; padding: 12px; display: flex; gap: 10px; align-items: center">'
          + ic("send", 18, FG) + col(t("¿El cliente no está presente?", 14, 600) + t("Envíale un link por WhatsApp, válido 72 horas.", 12, 400, MUTED_FG), 2, "flex: 1")
          + '</div>', 12))

    head = (f'<div style="border: 1px solid #BBE5C9; background: {S10}; border-radius: {R}; padding: 10px 12px; display: flex; gap: 8px; align-items: center">'
            + ic("check-circle", 18, SUCCESS) + t("Fotos obligatorias: 8/8", 13, 600, "#15803D") + '</div>')

    body = head + modules + concl + firma
    bottom = bottom_actions(
        f'<div style="flex: 1">{btn("Previsualizar", "outline", "eye", full=True, h=48)}</div>'
        + f'<div style="flex: 1.4">{btn("Finalizar peritaje", "success", "lock", full=True, h=48)}</div>')
    screen("PasoResumen.dc.html", 1560, wiz_top(12, 12, "Resumen", 9, "Guardado justo ahora"), body, bottom, gap=12)


def s_wiz_pasos():
    steps = [("Datos", True, 0), ("Frente", True, 3), ("Izquierda", True, 4), ("Trasera", True, 0), ("Derecha", False, 0),
             ("Motor", False, 0), ("Fugas", True, 2), ("Estructura", False, 0), ("Compresión", False, 0),
             ("Ruta", False, 0), ("Fotos", False, 0), ("Resumen", False, 0)]
    rows = ""
    for i, (l, done, f) in enumerate(steps, 1):
        cur = i == 5
        circ = (f'<div style="width: 32px; height: 32px; border-radius: 999px; background: {SUCCESS}; display: flex; align-items: center; justify-content: center">{ic("check", 16, "#FFFFFF", 3)}</div>'
                if done else
                f'<div style="width: 32px; height: 32px; border-radius: 999px; background: {PRIMARY if cur else MUTED}; color: {PRIMARY_FG if cur else MUTED_FG}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700">{i}</div>')
        bg = f"background: {P5};" if cur else ""
        rows += (f'<div style="display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 12px; border-radius: {R}; {bg}">'
                 + circ + col(t(l, 15, 600 if cur else 500) + t("Completo" if done else ("Estás aquí" if cur else "Pendiente"), 12, 400, SUCCESS if done else MUTED_FG), 0, "flex: 1")
                 + (badge(str(f), "warning", "alert") if f else "") + '</div>')

    sheet = (f'<div style="position: absolute; left: 0; right: 0; bottom: 0; top: 64px; background: #FFFFFF; border-radius: 20px 20px 0 0; box-shadow: 0 -8px 30px rgba(15,23,42,0.18); display: flex; flex-direction: column">'
             f'<div style="display: flex; justify-content: center; padding: 8px 0 4px"><div style="width: 40px; height: 5px; border-radius: 999px; background: {BORDER}"></div></div>'
             f'<div style="padding: 8px 20px 12px; display: flex; flex-direction: column; gap: 4px">'
             + row(ic("list-checks", 20) + t("Pasos del peritaje", 18, 700, FG, "flex: 1") + ic("x", 22, MUTED_FG), 10)
             + t("Toca un paso para ir directo. Los hallazgos aparecen en naranja.", 13, 400, MUTED_FG)
             + f'</div><div style="padding: 0 8px; display: flex; flex-direction: column; gap: 2px">{rows}</div></div>')

    html = (f'<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: {BG}">'
            f'<div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45)"></div>'
            f'{sheet}</div>')
    with open(os.path.join(OUT, "PasosDelPeritaje.dc.html"), "w") as f:
        f.write(HEAD + html + TAIL)


# =============================================================
#  PÁGINA 3 — GESTIÓN
# =============================================================

def s_vehiculos():
    data = [("ABC123", "Toyota Corolla XEI · 2020", "2", "16 sep"), ("BPA481", "Renault Sandero · 2016", "1", "15 sep"),
            ("JFG459", "Mazda CX-30 · 2021", "3", "14 sep"), ("XYZ789", "Peugeot 206 XR · 2003", "1", "02 sep"),
            ("KLM456", "Chevrolet Onix · 2022", "1", "28 ago"), ("TST001", "Kia Picanto · 2019", "2", "21 ago")]
    rows = [list_row(icon_tile("car", MUTED, FG, 40, 20), f'<span style="font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.06em">{p}</span>', v,
                     col(t(f"{n} peritaje{'s' if n != '1' else ''}", 12, 600, FG, "text-align: right") + t(d, 12, 400, MUTED_FG, "text-align: right"), 0))
            for p, v, n, d in data]
    body = page_title("Vehículos", "128 vehículos en histórico.") + searchbar("Buscar por placa, marca, modelo o VIN…") + list_card(rows)
    screen("Vehiculos.dc.html", 844, backbar("Más"), body, tabbar("mas"))


def s_propietario():
    info = card(col(
        row(f'<div style="width: 56px; height: 56px; border-radius: 999px; background: {MUTED}; display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 600">JP</div>'
            + col(t("Juan Pérez Gómez", 19, 700, FG, "letter-spacing: -0.01em") + t("Cliente desde marzo 2026", 13, 400, MUTED_FG), 2, "flex: 1"), 12)
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">'
        + btn("Llamar", "outline", "phone", full=True) + btn("WhatsApp", "outline", "message", full=True)
        + '</div>'
        + f'<div style="height: 1px; background: {BORDER}"></div>'
        + "".join(row(ic(i, 17, MUTED_FG) + col(t(k, 11, 600, MUTED_FG, "letter-spacing: 0.05em; text-transform: uppercase") + t(v, 14, 500, FG, m), 0), 12)
                  for i, k, v, m in [("id-card", "Documento", "CC 1.234.567.890", "font-family: ui-monospace, Menlo, monospace"),
                                     ("phone", "Teléfono", "310 555 1234", "font-family: ui-monospace, Menlo, monospace"),
                                     ("mail", "Email", "juan.perez@correo.co", ""),
                                     ("pin", "Dirección", "Cra. 40 #26-15, Villavicencio", "")]), 12))

    def h(p, st, sv, tipo, cons, veh, d):
        return list_row(icon_tile("clipboard", MUTED, FG, 40, 18),
                        f'<span style="font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.06em">{p}</span> {badge(st, sv)} {badge(tipo, "neutral")}',
                        f"{veh} · {cons + ' · ' if cons else ''}{d}")

    body = (info + section_label("Historial de peritajes", badge("3", "neutral"))
            + list_card([h("ABC123", "Borrador", "warning", "Plus", "", "Toyota Corolla", "16 sep"),
                         h("ABC123", "Finalizado", "success", "Pro", "PER-2026-0012", "Toyota Corolla", "22 mar"),
                         h("QWE852", "Finalizado", "success", "Sencillo", "PER-2026-0009", "Kia Rio", "10 mar")]))
    screen("Propietario.dc.html", 900, backbar("Propietarios"), body, tabbar("mas"), gap=12)


def s_empleados():
    def emp(ini, name, role, rv, sub, you=False, inactive=False):
        extra = (" " + badge("Inactivo", "danger")) if inactive else ""
        extra += f' <span style="font-size: 12px; font-weight: 400; color: {MUTED_FG}">(tú)</span>' if you else ""
        av = f'<div style="width: 40px; height: 40px; border-radius: 999px; background: {PRIMARY if you else MUTED}; color: {PRIMARY_FG if you else FG}; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; opacity: {0.5 if inactive else 1}">{ini}</div>'
        return list_row(av, f"{name} {badge(role, rv)}{extra}", sub)

    team = card(col(
        row(icon_tile("users", MUTED, FG, 30, 16) + t("Rendimiento del equipo · septiembre", 14, 600, FG, "flex: 1"), 10)
        + "".join(col(row(t(n, 14, 500, FG, "flex: 1") + t(str(v), 16, 700) + t(f"{p}%", 11, 400, MUTED_FG, "width: 30px; text-align: right"), 8) + bar(p, PRIMARY, 5), 6)
                  for n, v, p in [("Carlos Mendoza", 17, 45), ("Laura Rincón", 13, 34), ("Andrés Beltrán", 8, 21)]), 12))

    body = (
        page_title("Empleados", "4 personas en tu equipo (te incluye).")
        + btn("Nuevo empleado", "default", "plus", full=True)
        + team
        + list_card([
            emp("CM", "Carlos Mendoza", "Dueño", "neutral", "@cmendoza · último acceso hoy", you=True),
            emp("LR", "Laura Rincón", "Empleado", "neutral", "@lrincon · último acceso hoy"),
            emp("AB", "Andrés Beltrán", "Empleado", "neutral", "@abeltran · último acceso ayer"),
            emp("DV", "Diana Vargas", "Empleado", "neutral", "@dvargas · sin accesos aún", inactive=True),
        ])
    )
    screen("Empleados.dc.html", 960, backbar("Más"), body, tabbar("mas"), gap=14)


def s_empleado_acciones():
    # Hoja de acciones sobre un empleado (sustituye los 4 botones en fila)
    rows = ""
    for icn, lbl, c in [("key", "Cambiar contraseña", FG), ("link", "Generar link de reset", FG), ("user-x", "Desactivar", DANGER)]:
        rows += (f'<div style="display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 0 20px; border-top: 1px solid {BORDER}">'
                 f'{ic(icn, 20, c)}<div style="font-size: 16px; font-weight: 500; color: {c}">{lbl}</div></div>')
    sheet = (f'<div style="position: absolute; left: 0; right: 0; bottom: 0; background: #FFFFFF; border-radius: 20px 20px 0 0; padding-bottom: 28px; box-shadow: 0 -8px 30px rgba(15,23,42,0.18)">'
             f'<div style="display: flex; justify-content: center; padding: 8px 0 4px"><div style="width: 40px; height: 5px; border-radius: 999px; background: {BORDER}"></div></div>'
             f'<div style="padding: 10px 20px 16px; display: flex; align-items: center; gap: 12px">'
             f'<div style="width: 44px; height: 44px; border-radius: 999px; background: {MUTED}; display: flex; align-items: center; justify-content: center; font-weight: 600">LR</div>'
             + col(t("Laura Rincón", 17, 600) + t("@lrincon · laura@peritajesdelllano.co", 13, 400, MUTED_FG), 2) + '</div>'
             + rows + '</div>')
    html = (f'<div style="width: 390px; height: 844px; position: relative; overflow: hidden; background: {BG}">'
            f'<div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45)"></div>{sheet}</div>')
    with open(os.path.join(OUT, "EmpleadoAcciones.dc.html"), "w") as f:
        f.write(HEAD + html + TAIL)


def s_empresa():
    logo = card(row(
        f'<img src="logo.jpg" alt="Logo" style="width: 64px; height: 64px; border-radius: {RMD}; object-fit: cover; border: 1px solid {BORDER}">'
        + col(t("Logo", 14, 600) + t("PNG, SVG o JPG. Máximo 200 KB.", 12, 400, MUTED_FG)
              + row(t("Cambiar", 13, 600) + t("Quitar logo", 13, 500, DANGER), 16, extra="margin-top: 4px"), 2, "flex: 1"), 14))

    toggle = card(row(
        col(t("Concepto de asegurabilidad", 14, 600)
            + t("Emitir <b>ASEGURABLE SÍ / NO</b> en los peritajes.", 13, 400, MUTED_FG), 2, "flex: 1")
        + f'<div style="width: 50px; height: 30px; border-radius: 999px; background: {SUCCESS}; position: relative; flex-shrink: 0"><div style="position: absolute; right: 3px; top: 3px; width: 24px; height: 24px; border-radius: 999px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,0.2)"></div></div>', 12))

    body = (
        page_title("Empresa", "Datos que aparecen en el encabezado del PDF y comunicaciones.")
        + logo
        + card(col(field("Nombre", "Peritajes del Llano", req=True) + field("NIT", "901.234.567-8")
                   + field("Slogan", "Inspecciones y avalúos vehiculares")
                   + field("Teléfono", "313 880 7390") + field("Email", "contacto@peritajesdelllano.co"), 14))
        + toggle
    )
    screen("Empresa.dc.html", 1000, backbar("Más"), body,
           bottom_actions(btn("Guardar cambios", "default", full=True, h=48)), gap=14)


def s_whatsapp():
    status = card(col(
        row(icon_tile("message", S10, SUCCESS, 44, 22)
            + col(t("Estado de conexión", 16, 600) + row(badge("Conectado", "success") + badge("Kapso (API Oficial)", "neutral"), 6), 6, "flex: 1"), 12)
        + f'<div style="height: 1px; background: {BORDER}"></div>'
        + "".join(row(t(k, 13, 400, MUTED_FG, "flex: 1") + t(v, 14, 500), 8) for k, v in [("Número de empresa", "+57 313 880 7390"), ("Token", "Configurado y activo")])
        + t("El botón de prueba envía un texto libre a tu número para validar la conexión.", 12, 400, MUTED_FG)
        + btn("Enviar mensaje de prueba", "outline", "send", full=True), 12))

    tips = card(col(
        row(ic("info", 18) + t("Recomendaciones", 15, 600), 8)
        + "".join(row(f'<div style="width: 6px; height: 6px; border-radius: 999px; background: {FG}; margin-top: 7px; flex-shrink: 0"></div>' + t(x, 13, 400, FG, "text-wrap: pretty"), 10, "flex-start")
                  for x in ["Carga el celular del cliente en el paso Vehículo: el PDF se le envía solo al finalizar.",
                            "Si un envío falla, puedes reenviarlo desde el resumen del peritaje.",
                            "Usa el mismo número para firmas remotas por link."]), 10))

    body = page_title("WhatsApp", "Integración con la API oficial de WhatsApp Business.") + status + tips
    screen("WhatsApp.dc.html", 844, backbar("Más"), body, tabbar("mas"))


def s_cuenta():
    firma = card(col(
        row(ic("pen", 18) + t("Firma del perito", 15, 600, FG, "flex: 1") + badge("Registrada", "soft-success", "check"), 8)
        + f'<div style="height: 120px; border-radius: {RMD}; border: 1px solid {BORDER}; background: #FFFFFF; display: flex; align-items: center; justify-content: center">'
          f'<svg width="200" height="70" viewBox="0 0 200 70" fill="none" stroke="{FG}" stroke-width="2.2" stroke-linecap="round"><path d="M10 50 C 25 10, 35 10, 40 40 S 55 60, 65 30 S 80 10, 88 45 C 92 60, 100 30, 112 35 S 130 55, 140 30 C 146 18, 150 50, 162 42 S 180 30, 192 36"></path></svg></div>'
        + row(f'<div style="flex: 1">{btn("Subir imagen", "outline", "upload", full=True)}</div>'
              + f'<div style="flex: 1">{btn("Volver a firmar", "outline", "pen", full=True)}</div>', 8), 12))

    body = (
        page_title("Mi cuenta", "Tu perfil y preferencias.")
        + card(col(field("Nombre completo", "Carlos Mendoza", req=True)
                   + field("Licencia / Documento", "PI-20451")
                   + field("Email", "perito@vestel.com.co")
                   + field("WhatsApp", "310 555 1234", prefix="+57", hint="Para recibir avisos internos (intake nuevo, firmas).")
                   + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
                   + col(t("Usuario", 12, 500, MUTED_FG) + t("@cmendoza", 14, 600), 2)
                   + col(t("Rol", 12, 500, MUTED_FG) + t("Dueño", 14, 600), 2)
                   + '</div>'
                   + btn("Guardar cambios", "default", full=True), 14))
        + firma
        + card(row(icon_tile("key", MUTED, FG, 36, 18) + t("Cambiar contraseña", 15, 600, FG, "flex: 1") + ic("chev-right", 18, "#CBD5E1"), 12), pad="12px 14px")
    )
    screen("MiCuenta.dc.html", 1200, backbar("Más"), body, tabbar("mas"), gap=14)


# =============================================================
#  PÁGINA 4 — ADMINISTRADOR Y PÚBLICO
# =============================================================

def admin_tabbar(active):
    items = [("inicio", "Panel", "dashboard"), ("clientes", "Clientes", "store"), ("peritajes", "Peritajes", "clipboard"),
             ("auditoria", "Auditoría", "scroll"), ("mas", "Más", "menu")]
    out = []
    for key, label, icon in items:
        on = key == active
        c = FG if on else MUTED_FG
        pill = f"background: {MUTED};" if on else ""
        out.append(f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding-top: 8px">'
                   f'<div style="width: 56px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; {pill}">{ic(icon, 22, c, 2.2 if on else 1.8)}</div>'
                   f'<div style="font-size: 11px; font-weight: {600 if on else 500}; color: {c}">{label}</div></div>')
    return (f'<div style="flex-shrink: 0; height: 80px; display: flex; align-items: flex-start; padding: 0 4px 14px; box-sizing: border-box; '
            f'background: #FFFFFF; border-top: 1px solid {BORDER}">{"".join(out)}</div>')


def admin_topbar():
    return (f'<div style="height: 56px; flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 16px; background: #FFFFFF; border-bottom: 1px solid {BORDER}">'
            f'{logo_mark(30)}<div style="flex: 1; font-size: 15px; font-weight: 600">Perito · Vestel</div>'
            f'{badge("Administrador", "default")}'
            f'<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center">{ic("help", 20, MUTED_FG)}</div></div>')


def s_admin_dash():
    def k(label, v, hint, icon, tone):
        tb = {"m": (MUTED, FG), "s": (S10, SUCCESS), "w": (W10, WARNING)}[tone]
        return card(col(row(icon_tile(icon, tb[0], tb[1], 30, 16) + t(label, 12, 500, MUTED_FG, "flex: 1"), 8)
                        + t(v, 24, 700, FG, "letter-spacing: -0.02em") + t(hint, 11, 400, MUTED_FG), 4), pad="12px")

    kpis = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">'
            + k("Empresas activas", "12", "de 14 totales", "building", "m")
            + k("Peritajes este mes", "312", "+18% vs agosto", "clipboard", "m")
            + k("Finalizados", "268", "86% del mes", "check-circle", "s")
            + k("En borrador", "44", "pendientes de cierre", "file", "w")
            + '</div>')

    vals = [220, 241, 236, 259, 264, 312]
    bars = '<div style="display: flex; align-items: flex-end; gap: 10px; height: 120px">'
    for i, v in enumerate(vals):
        bars += (f'<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px">'
                 f'<div style="font-size: 10px; font-weight: 600; color: {FG if i == 5 else MUTED_FG}">{v}</div>'
                 f'<div style="width: 100%; height: {int(v / 312 * 86)}px; border-radius: 4px 4px 0 0; background: {PRIMARY if i == 5 else "#CBD5E1"}"></div></div>')
    bars += '</div>'
    chart = card(col(row(ic("trend", 18) + t("Peritajes por mes", 15, 600), 8) + bars
                     + '<div style="display: flex; gap: 10px">' + "".join(f'<div style="flex: 1; text-align: center; font-size: 11px; text-transform: uppercase; color: {MUTED_FG}">{m}</div>' for m in ["Abr", "May", "Jun", "Jul", "Ago", "Sep"]) + '</div>', 10))

    idle = col(section_label("Sin actividad este mes", badge("2", "neutral"))
               + list_card([list_row(icon_tile("alert", W10, WARNING, 36, 18), "Avalúos Meta", "Pedro Silva · último peritaje 12 jul"),
                            list_row(icon_tile("alert", W10, WARNING, 36, 18), "AutoCheck Granada", "Marta Ruiz · nunca ha creado peritajes")]), 8)

    body = page_title("Panel", "Todos los clientes · septiembre 2026") + kpis + chart + idle
    screen("AdminPanel.dc.html", 1000, admin_topbar(), body, admin_tabbar("inicio"))


def s_clientes():
    def c(name, owner, emp, month, suspended=False):
        right = icon_btn("login")
        title = name + (" " + badge("Suspendida", "danger", "pause") if suspended else "")
        sub = (f'<span style="display: inline-flex; gap: 10px"><span>Dueño: {owner}</span></span>')
        return (f'<div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px">'
                + row(icon_tile("store", MUTED, FG, 40, 20) + col(ellip(title, 15, 600) + ellip(sub, 13, 400, MUTED_FG), 2, "flex: 1") + right, 12)
                + row(row(ic("users", 14, MUTED_FG) + t(f"{emp} empleado{'s' if emp != 1 else ''}", 12, 500, MUTED_FG), 4)
                      + row(ic("clipboard", 14, MUTED_FG) + t(f"{month} este mes", 12, 500, MUTED_FG), 4), 16, extra="padding-left: 52px")
                + '</div>')

    cards_ = [c("Peritajes del Llano", "Carlos Mendoza", 4, 38), c("Avalúos Meta", "Pedro Silva", 2, 0),
              c("Revisar Autos Bogotá", "Juan Pérez", 7, 112), c("AutoCheck Granada", "Marta Ruiz", 1, 0, True)]
    lst = (f'<div style="background: {CARD}; border: 1px solid {BORDER}; border-radius: {RXL}; overflow: hidden">'
           + f'<div style="height: 1px; background: {BORDER}"></div>'.join(cards_) + '</div>')
    body = (page_title("Clientes", "14 empresas clientes del servicio.")
            + btn("Nueva empresa", "default", "plus", full=True)
            + searchbar("Buscar empresa o dueño…") + lst)
    screen("Clientes.dc.html", 844, admin_topbar(), body, admin_tabbar("clientes"), gap=14)


def s_auditoria():
    def e(time, action, av, user, detail):
        return (f'<div style="display: flex; flex-direction: column; gap: 6px; padding: 12px 16px">'
                + row(f'<span style="font-family: ui-monospace, Menlo, monospace; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: {BADGE[av][0]}; color: {BADGE[av][1]}">{action}</span>'
                      + t(time, 12, 400, MUTED_FG, "margin-left: auto"), 8)
                + t(user, 14, 600)
                + t(detail, 12, 400, MUTED_FG, "font-family: ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis")
                + '</div>')

    lst = (f'<div style="background: {CARD}; border: 1px solid {BORDER}; border-radius: {RXL}; overflow: hidden">'
           + f'<div style="height: 1px; background: {BORDER}"></div>'.join([
               e("16 sep · 10:31", "inspection.completed", "success", "cmendoza · Peritajes del Llano", "BPA481 · PER-2026-0041"),
               e("16 sep · 10:12", "auth.login", "default", "lrincon · Peritajes del Llano", "ip 190.24.x.x · Android"),
               e("16 sep · 09:58", "user.password", "warning", "cmendoza · Peritajes del Llano", "reset de @dvargas"),
               e("16 sep · 09:40", "inspection.deleted", "danger", "admin · Vestel", "XYZ789 · borrador duplicado"),
               e("16 sep · 09:02", "inspection.updated", "neutral", "abeltran · Revisar Autos Bogotá", "JFG459 · paso Fugas"),
           ]) + '</div>')

    filt = row(f'<div style="flex: 1">{searchbar("Buscar usuario o placa…")}</div>'
               + f'<div style="width: 44px; height: 44px; border-radius: {RMD}; background: {PRIMARY}; display: flex; align-items: center; justify-content: center; position: relative">{ic("filter", 18, PRIMARY_FG)}'
                 f'<div style="position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 999px; background: {WARNING}; color: #FFFFFF; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #FFFFFF">2</div></div>', 8)

    body = (page_title("Auditoría", "Registro inmutable de acciones del sistema.", icon_btn("refresh"))
            + filt + chips(["Hoy", "Peritajes del Llano", "Todas las acciones"], 0) + lst)
    screen("Auditoria.dc.html", 900, admin_topbar(), body, admin_tabbar("auditoria"), gap=14)


def s_firma_publica():
    ctx = card(col(
        col(t("Vehículo", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase")
            + row(plate("ABC123", True) + t("Toyota Corolla XEI · 2020", 14, 500), 10), 6)
        + f'<div style="height: 1px; background: {BORDER}"></div>'
        + '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
        + col(t("Perito inspector", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase") + t("Carlos Mendoza", 14, 500), 2)
        + col(t("Propietario", 11, 600, MUTED_FG, "letter-spacing: 0.06em; text-transform: uppercase") + t("Juan Pérez Gómez", 14, 500), 2)
        + '</div>', 12))

    pad_ = card(col(
        row(t("Firma del cliente", 15, 600, FG, "flex: 1") + row(ic("undo", 16, MUTED_FG) + t("Borrar", 13, 500, MUTED_FG), 4), 8)
        + f'<div style="height: 200px; border-radius: {RMD}; border: 2px dashed {BORDER}; background: #FFFFFF; position: relative; display: flex; align-items: center; justify-content: center">'
          f'<svg width="240" height="90" viewBox="0 0 200 70" fill="none" stroke="{FG}" stroke-width="2.4" stroke-linecap="round"><path d="M12 48 C 22 18, 32 14, 38 38 S 50 58, 60 34 C 66 20, 74 22, 78 44 S 96 50, 104 30 C 110 16, 118 44, 132 40 S 150 26, 162 34"></path></svg>'
          f'<div style="position: absolute; left: 20px; right: 20px; bottom: 36px; height: 1px; background: {BORDER}"></div>'
          f'<div style="position: absolute; bottom: 12px; font-size: 11px; color: {MUTED_FG}">Firma con el dedo dentro del recuadro</div></div>', 10))

    body = (
        row(ic("shield-check", 22) + t("Firma del peritaje", 18, 700), 8)
        + ctx
        + t("Al firmar abajo, usted declara haber recibido el informe de peritaje del vehículo descrito.", 13, 400, MUTED_FG, "text-wrap: pretty")
        + pad_
    )
    screen("FirmaCliente.dc.html", 844, "", body,
           bottom_actions(btn("Enviar firma", "default", full=True, h=52, fs="16px")), pad="24px 16px")


def s_firma_gate():
    card_ = (f'<div style="background: #FFFFFF; border: 1px solid {BORDER}; border-radius: 20px 20px 0 0; padding: 20px 20px 28px; box-shadow: 0 -8px 30px rgba(15,23,42,0.12); display: flex; flex-direction: column; gap: 14px">'
             + row(f'<div style="width: 40px; height: 40px; border-radius: 999px; background: {W10}; display: flex; align-items: center; justify-content: center">{ic("shield-alert", 20, WARNING)}</div>'
                   + t("Carga tu firma para continuar", 17, 700, FG, "flex: 1"), 12)
             + t("Necesitas registrar tu firma una sola vez. Sale en todos los informes que emitas.", 14, 400, MUTED_FG, "text-wrap: pretty")
             + f'<div style="height: 170px; border-radius: {RMD}; border: 2px dashed {BORDER}; display: flex; align-items: center; justify-content: center; color: {MUTED_FG}; font-size: 13px">Dibújala con el dedo o sube una imagen</div>'
             + row(f'<div style="flex: 1">{btn("Subir imagen", "outline", "upload", full=True, h=48)}</div>'
                   + f'<div style="flex: 1.3">{btn("Guardar y continuar", "default", full=True, h=48)}</div>', 8)
             + '</div>')
    html = (f'<div style="width: 390px; height: 844px; display: flex; flex-direction: column; justify-content: flex-end; background: rgba(241, 245, 249, 0.97)">'
            + col(logo_mark(56) + t("Peritajes del Llano", 15, 600), 10, "align-items: center; flex: 1; justify-content: center")
            + card_ + '</div>')
    with open(os.path.join(OUT, "FirmaObligatoria.dc.html"), "w") as f:
        f.write(HEAD + html + TAIL)


# ---- Generar todo ----
for fn in [s_login, s_dashboard, s_peritajes, s_agenda, s_intake, s_mas,
           s_wiz_vehiculo, s_wiz_recorrido, s_wiz_llanta, s_wiz_fugas, s_wiz_fotos, s_wiz_resumen, s_wiz_pasos,
           s_vehiculos, s_propietario, s_empleados, s_empleado_acciones, s_empresa, s_whatsapp, s_cuenta,
           s_admin_dash, s_clientes, s_auditoria, s_firma_publica, s_firma_gate]:
    fn()

# ---- canvas.json ----
PAGES = [
    ("page-1", "Operación diaria", [("Login", "Iniciar sesión", 844), ("Main", "Inicio (dashboard)", 1060), ("Agenda", "Agenda", 940),
                                     ("NuevoPeritaje", "Nuevo peritaje", 1000), ("Peritajes", "Peritajes", 1060), ("Mas", "Más", 1040)]),
    ("page-2", "Inspección", [("PasoVehiculo", "1 · Vehículo", 1440), ("PasoRecorrido", "2 · Frente (ítem abierto)", 1180),
                              ("PasoLlanta", "3 · Izquierda (llanta)", 1000), ("PasoFugas", "7 · Fugas", 960),
                              ("PasoFotos", "11 · Fotos", 1000), ("PasoResumen", "12 · Resumen", 1560),
                              ("PasosDelPeritaje", "Pasos (hoja)", 844)]),
    ("page-3", "Gestión", [("Vehiculos", "Vehículos", 844), ("Propietario", "Ficha de propietario", 900),
                           ("Empleados", "Empleados", 960), ("EmpleadoAcciones", "Acciones de empleado", 844),
                           ("Empresa", "Empresa", 1000), ("WhatsApp", "WhatsApp", 844), ("MiCuenta", "Mi cuenta", 1200)]),
    ("page-4", "Administrador y público", [("AdminPanel", "Panel admin", 1000), ("Clientes", "Clientes", 844),
                                           ("Auditoria", "Auditoría", 900), ("FirmaCliente", "Firma remota (cliente)", 844),
                                           ("FirmaObligatoria", "Firma obligatoria del perito", 844)]),
]
NOTES = {
    "page-1": "Rediseño tipo app nativa: barra inferior (Inicio · Agenda · Nuevo · Peritajes · Más) en vez del menú lateral.\nEl empleado no ve Inicio: su primera pestaña es Agenda.\nVehículos, Propietarios, Empresa, Empleados, WhatsApp y Mi cuenta viven en «Más».",
    "page-2": "Wizard sin barra de pestañas: Atrás / Siguiente fijos abajo.\nEl encabezado muestra placa + estado de guardado; el ícono de lista abre la hoja de pasos.\nLos % por módulo se ponen a mano con − / + (pasos de 1).",
    "page-3": "Las acciones por fila (contraseña, reset, desactivar) pasan a una hoja inferior en vez de 4 botones en línea.",
    "page-4": "El admin tiene su propia barra: Panel · Clientes · Peritajes · Auditoría · Más (Backup y Configuración van en Más).\nLa firma remota del cliente es pública, sin barra de navegación.",
}
artboards, annotations, pages = [], [], []
for pid, pname, items in PAGES:
    pages.append({"id": pid, "name": pname})
    x = 0
    for stem, title, h in items:
        artboards.append({"file": f"{stem}.dc.html", "x": x, "y": 0, "w": 390, "h": h, "title": title, "page": pid})
        x += 390 + 90
    annotations.append({"id": f"nota-{pid}", "x": 0, "y": -200, "w": 520, "text": NOTES[pid], "page": pid})

canvas = {"pages": pages, "artboards": artboards, "annotations": annotations,
          "launch": {"view": "canvas", "page": "page-1"}}
with open(os.path.join(OUT, "canvas.json"), "w") as f:
    json.dump(canvas, f, ensure_ascii=False, indent=2)
print("ok", len(artboards))
