; LGU-SDSS Windows installer (Inno Setup 6)
; Built by BUILD-INSTALLER.bat -> installer\build_installer.ps1, which passes:
;   /DStage=<folder with python, pgsql, backend, data, frontend_dist, db, launcher>
;   /DOutDir=<where LGU-SDSS-Setup.exe is written>
;   /DAppVersion=<yyyy.mm.dd>

#ifndef Stage
  #error Run BUILD-INSTALLER.bat instead of compiling this file directly.
#endif
#ifndef AppVersion
  #define AppVersion "1.0"
#endif
#ifndef OutName
  #define OutName "LGU-SDSS-Setup"
#endif

[Setup]
AppId={{6C1E5B0A-6F1B-4E7E-9D3A-4C5D2B7A9E11}
AppName=LGU-SDSS
AppVersion={#AppVersion}
AppVerName=LGU-SDSS ({#AppVersion})
AppPublisher=LGU-SDSS - San Miguel, Iloilo
DefaultDirName={localappdata}\Programs\LGU-SDSS
DefaultGroupName=LGU-SDSS
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename={#OutName}
SetupIconFile={#Stage}\launcher\lgu.ico
UninstallDisplayIcon={app}\launcher\lgu.ico
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
WizardSmallImageFile=wizard_small.bmp
WizardImageFile=wizard_large.bmp
CloseApplications=yes
MinVersion=10.0

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\LGU-SDSS"; Filename: "{app}\python\python.exe"; Parameters: "-E -s ""{app}\launcher\lgu_sdss.py"""; WorkingDir: "{app}"; IconFilename: "{app}\launcher\lgu.ico"; Comment: "Start LGU-SDSS"
Name: "{group}\LGU-SDSS - reset database"; Filename: "{app}\python\python.exe"; Parameters: "-E -s ""{app}\launcher\lgu_sdss.py"" --reset"; WorkingDir: "{app}"; IconFilename: "{app}\launcher\lgu.ico"; Comment: "Delete the local database; the next start sets it up again from the installed copy"
Name: "{group}\Uninstall LGU-SDSS"; Filename: "{uninstallexe}"
Name: "{autodesktop}\LGU-SDSS"; Filename: "{app}\python\python.exe"; Parameters: "-E -s ""{app}\launcher\lgu_sdss.py"""; WorkingDir: "{app}"; IconFilename: "{app}\launcher\lgu.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\python\python.exe"; Parameters: "-E -s ""{app}\launcher\lgu_sdss.py"""; WorkingDir: "{app}"; Description: "Start LGU-SDSS now"; Flags: postinstall nowait skipifsilent

[InstallDelete]
; files an older installer copied in that this version no longer ships
Type: filesandordirs; Name: "{app}\backend\domain_pipeline_outputs"
Type: files; Name: "{app}\backend\*.csv"

[UninstallRun]
Filename: "{app}\python\python.exe"; Parameters: "-E -s ""{app}\launcher\lgu_sdss.py"" --stop"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopDatabase"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// An earlier LGU-SDSS left its database (%LOCALAPPDATA%\LGU-SDSS\pgdata) and its
// analysis files ({app}\data) on this PC. Ask whether to keep them or to start
// with an empty system (the CBMS files are then imported again in the system).
procedure CurStepChanged(CurStep: TSetupStep);
var
  Home, OldPy, OldLauncher: String;
  Code: Integer;
begin
  if CurStep <> ssInstall then Exit;
  Home := ExpandConstant('{localappdata}\LGU-SDSS');
  if not (DirExists(Home + '\pgdata') or DirExists(ExpandConstant('{app}\data\domain_pipeline_results'))) then Exit;
  if SuppressibleMsgBox('LGU-SDSS data from an earlier installation is on this PC ' +
     '(households, imported CBMS files and computed scores).' + #13#10 + #13#10 +
     'Start with an EMPTY system?' + #13#10 + #13#10 +
     'Yes  = delete that data. After installing you import the CBMS files again ' +
     '(Households > Import CBMS files). User accounts come from the installer.' + #13#10 +
     'No   = keep the data from the earlier installation.',
     mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) <> IDYES then Exit;
  OldPy := ExpandConstant('{app}\python\python.exe');
  OldLauncher := ExpandConstant('{app}\launcher\lgu_sdss.py');
  if FileExists(OldPy) and FileExists(OldLauncher) then
    Exec(OldPy, '-E -s "' + OldLauncher + '" --stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
  DelTree(Home + '\pgdata', True, True, True);
  DeleteFile(Home + '\database_loaded.txt');
  DelTree(ExpandConstant('{app}\data'), True, True, True);
  DelTree(ExpandConstant('{app}\backend'), True, True, True);
  if DirExists(Home + '\pgdata') then
    SuppressibleMsgBox('The old database could not be removed (is LGU-SDSS still open?).' + #13#10 +
      'Close it, then use Start menu > LGU-SDSS - reset database after installing.', mbError, MB_OK, IDOK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if SuppressibleMsgBox('Also delete the LGU-SDSS database on this PC?' + #13#10 + #13#10 +
       'Choose No to keep it (households added or imported here are kept for a later reinstall).',
       mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
      DelTree(ExpandConstant('{localappdata}\LGU-SDSS'), True, True, True);
end;
