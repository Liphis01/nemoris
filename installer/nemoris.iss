; Inno Setup 6 script - builds Nemoris-Setup.exe from the PyInstaller output.
; Run via package-windows.ps1 (auto-detected) or open in the Inno Setup IDE.

#define MyAppName "Nemoris"
#define MyAppVersion "1.0.5"
#define MyAppExeName "Nemoris.exe"
#define BuildDir "..\backend\dist\Nemoris"

[Setup]
AppId={{B7F3D2A4-9C61-4E8B-A5D0-3F2E8C7B1A96}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
; Per-user install (like Discord): no admin prompt, lands in
; %LocalAppData%\Programs\Nemoris. User data lives in %AppData%\Nemoris
; and survives uninstall/reinstall.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\backend\dist
OutputBaseFilename=Nemoris-Setup
SetupIconFile=..\backend\assets\nemoris.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// Nemoris renders in the WebView2 runtime. It ships with Windows 11 and
// most Windows 10 machines; install it silently when absent so the app
// never has to fall back to the user's browser.
function IsWebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM,
      'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version) or
    RegQueryStringValue(HKCU,
      'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version);

  if Result then
    Result := (Version <> '') and (Version <> '0.0.0.0');
end;

procedure InstallWebView2;
var
  ResultCode: Integer;
begin
  try
    DownloadTemporaryFile(
      'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
      'MicrosoftEdgeWebView2Setup.exe', '', nil);
    Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe'),
      '/silent /install', '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
  except
    // Soft failure: the app falls back to the default browser without the
    // runtime, so never block the install on this.
    MsgBox('Could not install the WebView2 runtime automatically. ' +
      'Nemoris will open in your browser until it is installed from ' +
      'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and (not IsWebView2Installed) then
    InstallWebView2;
end;
