; Windows installer for Rounds (Inno Setup 6). Built by .github/workflows/desktop.yml:
;   iscc /DAppVersion=0.1.0 /DSourceDir=dist\Rounds /DOutputDir=release desktop\windows-installer.iss
;
; Installs for the current user only (no administrator prompt), adds a Start
; menu shortcut and an optional desktop shortcut. Uninstalling removes the app
; but never the user's cards (%APPDATA%\Rounds).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Rounds"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif

[Setup]
AppId={{6F1E0C9A-4B7D-4C1E-9E2B-7A52D3C8F0A1}
AppName=Rounds
AppVersion={#AppVersion}
AppPublisher=Rounds
AppPublisherURL=https://github.com/bensdev-p/anki_wrapper
DefaultDirName={localappdata}\Programs\Rounds
DefaultGroupName=Rounds
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Rounds-{#AppVersion}-Windows-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\Rounds.exe
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Rounds"; Filename: "{app}\Rounds.exe"
Name: "{autodesktop}\Rounds"; Filename: "{app}\Rounds.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Rounds.exe"; Description: "Open Rounds now"; Flags: nowait postinstall skipifsilent
