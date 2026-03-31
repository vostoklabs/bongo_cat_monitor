; Bongo Cat Application - Minimal Installer
; Focuses on background app essentials: installation + Windows startup

!define APP_NAME "Bongo Cat"
!define APP_EXE "BongoCat.exe"
!define APP_VERSION "2.2"
!define PUBLISHER "Bongo Cat Project"
!define INSTALL_DIR "$PROGRAMFILES\BongoCat"

; Modern UI
!include "MUI2.nsh"

; General settings
Name "${APP_NAME}"
OutFile "BongoCat_Release\BongoCat_Setup.exe"
InstallDir "${INSTALL_DIR}"
RequestExecutionLevel admin

; Interface Settings
!define MUI_ABORTWARNING
; !define MUI_ICON "bongo_cat_app\assets\tray_icon.png"  ; Commented out - PNG not supported

; Pages
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

; Version Information
VIProductVersion "2.2.0.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Installer"

; Installation Sections
Section "Bongo Cat Application" SecMain
    SectionIn RO  ; Required section
    
    ; Install files
    SetOutPath "$INSTDIR"
    File "dist\${APP_EXE}"
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    
    ; Registry entries for Add/Remove Programs
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${PUBLISHER}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1
    
SectionEnd

Section "Start with Windows" SecStartup
    ; Create a scheduled task for admin startup
    ; This ensures the app can run with admin privileges at startup
    
    ; Create XML task definition file
    FileOpen $0 "$TEMP\BongoCatTask.xml" w
    FileWrite $0 '<?xml version="1.0" encoding="UTF-16"?>$\r$\n'
    FileWrite $0 '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n'
    FileWrite $0 '  <RegistrationInfo>$\r$\n'
    FileWrite $0 '    <Description>Bongo Cat Typing Monitor - Auto Start</Description>$\r$\n'
    FileWrite $0 '    <Author>Bongo Cat Project</Author>$\r$\n'
    FileWrite $0 '  </RegistrationInfo>$\r$\n'
    FileWrite $0 '  <Triggers>$\r$\n'
    FileWrite $0 '    <LogonTrigger>$\r$\n'
    FileWrite $0 '      <Enabled>true</Enabled>$\r$\n'
    FileWrite $0 '      <Delay>PT10S</Delay>$\r$\n'
    FileWrite $0 '    </LogonTrigger>$\r$\n'
    FileWrite $0 '  </Triggers>$\r$\n'
    FileWrite $0 '  <Principals>$\r$\n'
    FileWrite $0 '    <Principal id="Author">$\r$\n'
    FileWrite $0 '      <RunLevel>HighestAvailable</RunLevel>$\r$\n'
    FileWrite $0 '      <LogonType>InteractiveToken</LogonType>$\r$\n'
    FileWrite $0 '    </Principal>$\r$\n'
    FileWrite $0 '  </Principals>$\r$\n'
    FileWrite $0 '  <Settings>$\r$\n'
    FileWrite $0 '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>$\r$\n'
    FileWrite $0 '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>$\r$\n'
    FileWrite $0 '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>$\r$\n'
    FileWrite $0 '    <AllowHardTerminate>true</AllowHardTerminate>$\r$\n'
    FileWrite $0 '    <StartWhenAvailable>true</StartWhenAvailable>$\r$\n'
    FileWrite $0 '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>$\r$\n'
    FileWrite $0 '    <IdleSettings>$\r$\n'
    FileWrite $0 '      <StopOnIdleEnd>false</StopOnIdleEnd>$\r$\n'
    FileWrite $0 '      <RestartOnIdle>false</RestartOnIdle>$\r$\n'
    FileWrite $0 '    </IdleSettings>$\r$\n'
    FileWrite $0 '    <AllowStartOnDemand>true</AllowStartOnDemand>$\r$\n'
    FileWrite $0 '    <Enabled>true</Enabled>$\r$\n'
    FileWrite $0 '    <Hidden>false</Hidden>$\r$\n'
    FileWrite $0 '    <RunOnlyIfIdle>false</RunOnlyIfIdle>$\r$\n'
    FileWrite $0 '    <WakeToRun>false</WakeToRun>$\r$\n'
    FileWrite $0 '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>$\r$\n'
    FileWrite $0 '    <Priority>7</Priority>$\r$\n'
    FileWrite $0 '  </Settings>$\r$\n'
    FileWrite $0 '  <Actions Context="Author">$\r$\n'
    FileWrite $0 '    <Exec>$\r$\n'
    FileWrite $0 '      <Command>$INSTDIR\${APP_EXE}</Command>$\r$\n'
    FileWrite $0 '      <Arguments></Arguments>$\r$\n'
    FileWrite $0 '      <WorkingDirectory>$INSTDIR</WorkingDirectory>$\r$\n'
    FileWrite $0 '    </Exec>$\r$\n'
    FileWrite $0 '  </Actions>$\r$\n'
    FileWrite $0 '</Task>$\r$\n'
    FileClose $0
    
    ; Create the scheduled task using schtasks command
    ExecWait 'schtasks /create /tn "BongoCat Auto Start" /xml "$TEMP\BongoCatTask.xml" /f' $1
    
    ; Clean up temporary file
    Delete "$TEMP\BongoCatTask.xml"
    
    ; Check if task creation was successful
    ${If} $1 == 0
        DetailPrint "Scheduled task created successfully"
    ${Else}
        DetailPrint "Warning: Could not create scheduled task (Error: $1)"
    ${EndIf}
    
SectionEnd

Section "Desktop Shortcut" SecDesktop
    ; Create desktop shortcut
    CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" ""
SectionEnd

Section "Start Now" SecStartNow
    ; Launch the application after installation
    Exec "$INSTDIR\${APP_EXE}"
SectionEnd

; Section Descriptions
LangString DESC_SecMain ${LANG_ENGLISH} "Installs the main Bongo Cat application."
LangString DESC_SecStartup ${LANG_ENGLISH} "Automatically start Bongo Cat when Windows starts (recommended)."
LangString DESC_SecDesktop ${LANG_ENGLISH} "Create a desktop shortcut to easily restart Bongo Cat."
LangString DESC_SecStartNow ${LANG_ENGLISH} "Start Bongo Cat immediately after installation."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_SecMain)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} $(DESC_SecStartup)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartNow} $(DESC_SecStartNow)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; Uninstaller
Section "Uninstall"
    ; Stop the application if running
    ExecWait "taskkill /F /IM ${APP_EXE}" $0
    
    ; Remove scheduled task
    ExecWait 'schtasks /delete /tn "BongoCat Auto Start" /f' $1
    
    ; Remove startup registry entry (legacy cleanup)
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}"
    
    ; Remove desktop shortcut
    Delete "$DESKTOP\${APP_NAME}.lnk"
    
    ; Remove files
    Delete "$INSTDIR\${APP_EXE}"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
    
    ; Remove registry entries
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
    
SectionEnd

; Functions
Function .onInit
    ; Check if already installed
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString"
    StrCmp $R0 "" done
    
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is already installed. Click OK to uninstall the previous version or Cancel to quit." IDOK uninst
    Abort
    
    uninst:
        ; Stop the application if running
        ExecWait "taskkill /F /IM ${APP_EXE}" $0
        ; Run uninstaller
        ExecWait '$R0 _?=$INSTDIR'
        
    done:
FunctionEnd 