# PyInstaller build for the Rounds desktop app.
#
#   (cd frontend && npm ci && npm run build)
#   pip install -r backend/requirements.txt -r desktop/requirements.txt
#   pyinstaller desktop/rounds.spec --noconfirm
#
# Output: dist/Rounds.app (macOS), dist/Rounds/Rounds.exe (Windows),
# dist/Rounds/Rounds (Linux). The GitHub workflow wraps these in a .dmg,
# an installer and a .tar.gz.

import re
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"
DIST_UI = ROOT / "frontend" / "dist"
ICON_PNG = ROOT / "frontend" / "public" / "icon-512.png"
VERSION = re.search(r'__version__ = "([^"]+)"', (BACKEND / "version.py").read_text()).group(1)

if not (DIST_UI / "index.html").exists():
    sys.exit("Build the UI first: (cd frontend && npm ci && npm run build)")

datas = [(str(DIST_UI), "frontend/dist")]
binaries = []
hiddenimports = []

# Anki's engine: the Rust bridge, translations and other data files.
for package in ("anki",):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

# The server is imported by name inside the launcher; make sure all of it is in.
hiddenimports += ["safety", "version"]
hiddenimports += collect_submodules("api", filter=lambda name: "tests" not in name)
hiddenimports += collect_submodules("service")
hiddenimports += collect_submodules("uvicorn")

# Linux only: Qt WebEngine is bundled, but none of these parts of Qt are used.
UNUSED_QT = [
    f"PyQt6.{m}"
    for m in (
        "Qt3DAnimation Qt3DCore Qt3DExtras Qt3DInput Qt3DLogic Qt3DRender QtBluetooth QtDesigner "
        "QtHelp QtMultimedia QtMultimediaWidgets QtNfc QtQuick3D QtRemoteObjects QtSensors "
        "QtSerialPort QtSpatialAudio QtSql QtSvgWidgets QtTest QtTextToSpeech QtXml QtPdf QtPdfWidgets"
    ).split()
]

a = Analysis(
    [str(ROOT / "desktop" / "rounds_desktop.py")],
    pathex=[str(BACKEND)],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "tests", "PIL", *UNUSED_QT],  # Pillow: build time only
    noarchive=False,
)
if sys.platform.startswith("linux"):
    # PyInstaller copies every Qt library next to WebEngine; drop the unused ones.
    unused = re.compile(
        r"(libQt6|Qt6/qml/Qt)(3D|Quick3D|Multimedia|SpatialAudio|Sensors|SerialPort|TextToSpeech|"
        r"RemoteObjects|Test|QuickTest|Pdf|Bluetooth|Nfc|Designer|Help|Sql|Charts|DataVisualization|Graphs)"
    )
    a.binaries = [b for b in a.binaries if not unused.search(b[0].replace("\\", "/"))]
    a.datas = [d for d in a.datas if not unused.search(d[0].replace("\\", "/"))]

pyz = PYZ(a.pure)

icon = str(ICON_PNG)  # PyInstaller converts it to .icns / .ico (needs Pillow)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Rounds",
    console=False,
    icon=icon,
    # Unsigned builds are ad-hoc signed on macOS; see the README for Gatekeeper.
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(exe, a.binaries, a.datas, name="Rounds")

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Rounds.app",
        icon=icon,
        bundle_identifier="app.rounds.desktop",
        version=VERSION,
        info_plist={
            "CFBundleName": "Rounds",
            "CFBundleDisplayName": "Rounds",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "LSMinimumSystemVersion": "12.0",
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.education",
            # The window talks to the app's own server on this computer (and,
            # when sharing is on, the phone talks to it over the home network).
            "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
            "NSLocalNetworkUsageDescription": "Rounds can share your study session with your phone on the same Wi-Fi.",
        },
    )
