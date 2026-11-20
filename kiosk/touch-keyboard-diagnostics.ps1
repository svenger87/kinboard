# Run in a normal PowerShell window while signed in as the kiosk user.
# This script only reads settings and opens the Windows touch-keyboard settings page.

$ErrorActionPreference = 'Continue'

function Show-Check {
    param([string]$Name, [string]$Value)
    Write-Output ('{0,-34} {1}' -f ($Name + ':'), $Value)
}

function Read-RegistryValue {
    param([string]$Path, [string]$Name)
    try {
        $key = Get-ItemProperty -Path $Path -ErrorAction Stop
        $value = $key.PSObject.Properties[$Name]
        if ($null -eq $value) { return '(not set)' }
        return [string]$value.Value
    } catch {
        return '(not set)'
    }
}

Write-Output 'Kinboard touch-keyboard diagnostics'
Write-Output 'Run this in the signed-in kiosk account, not as SYSTEM or a different administrator.'
Write-Output ''

Show-Check 'Windows user' ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
Show-Check 'Session name' $(if ($env:SESSIONNAME) { $env:SESSIONNAME } else { '(unknown)' })
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    Show-Check 'Windows version/build' ('{0} / {1}' -f $os.Version, $os.BuildNumber)
} catch {
    Show-Check 'Windows version/build' ('unavailable: ' + $_.Exception.Message)
}

$tabletTipKey = 'HKCU:\Software\Microsoft\TabletTip\1.7'
$shellKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell'
$priorityKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\PriorityControl'
Show-Check 'EnableDesktopModeAutoInvoke' (Read-RegistryValue $tabletTipKey 'EnableDesktopModeAutoInvoke')
Show-Check 'TipbandDesiredVisibility' (Read-RegistryValue $tabletTipKey 'TipbandDesiredVisibility')
Show-Check 'TabletMode (legacy setting)' (Read-RegistryValue $shellKey 'TabletMode')
Show-Check 'ConvertibleSlateMode' (Read-RegistryValue $priorityKey 'ConvertibleSlateMode')

foreach ($name in @('TabletInputService', 'TextInputManagementService')) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        Show-Check $name '(not present on this Windows build)'
    } else {
        Show-Check $name ('{0}; startup: {1}' -f $service.State, $service.StartMode)
    }
}

foreach ($name in @('TabTip', 'TextInputHost', 'msedge')) {
    $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    Show-Check ($name + ' processes') $processes.Count
}

try {
    # Keyboard-class devices include HID keyboards and some virtual keyboard interfaces.
    $keyboards = @(Get-PnpDevice -PresentOnly -Class Keyboard -ErrorAction Stop)
    Show-Check 'Present keyboard devices' $keyboards.Count
    foreach ($keyboard in $keyboards) {
        Show-Check 'Keyboard device' ('{0}; {1}; {2}' -f $keyboard.FriendlyName, $keyboard.Status, $keyboard.InstanceId)
    }
} catch {
    Show-Check 'Present keyboard devices' ('unavailable: ' + $_.Exception.Message)
}

try {
    $touchDevices = @(Get-PnpDevice -PresentOnly -Class HIDClass -ErrorAction Stop | Where-Object {
        $_.FriendlyName -match 'touch screen|touchscreen'
    })
    if ($touchDevices.Count -eq 0) {
        Show-Check 'HID touch screens' '(none reported by Get-PnpDevice)'
    } else {
        foreach ($device in $touchDevices) {
            Show-Check 'HID touch screen' ('{0}; {1}' -f $device.FriendlyName, $device.Status)
        }
    }
} catch {
    Show-Check 'HID touch screens' ('unavailable: ' + $_.Exception.Message)
}

try {
    $task = Get-ScheduledTask -TaskName 'KioskLauncher' -ErrorAction Stop
    Show-Check 'KioskLauncher account' $task.Principal.UserId
    Show-Check 'KioskLauncher logon type' ([string]$task.Principal.LogonType)
} catch {
    Show-Check 'KioskLauncher task' '(not found)'
}

Write-Output ''
Write-Output 'Next checks:'
Write-Output '1. In Settings > Time & language > Typing > Touch keyboard, set'
Write-Output '   "Show the touch keyboard" to "Always" for a kiosk. This controls auto-open'
Write-Output '   when a text field is tapped; the taskbar icon is a separate setting.'
Write-Output '2. Tap a text field with a finger in Edge, then in Notepad. A mouse click'
Write-Output '   does not test touch-keyboard auto-open.'
Write-Output '3. If it works in Notepad but not Edge, also test Edge outside kiosk mode.'
Write-Output '4. If the service is Disabled, enable it in services.msc and sign out/in.'
Write-Output '5. If the task runs under another account, its HKCU values affect that'
Write-Output '   account rather than the signed-in kiosk user.'
Write-Output '6. Check "Present keyboard devices" after unplugging the physical keyboard.'
Write-Output '   A remaining HID or virtual keyboard may make Windows think one is attached.'
Write-Output '   Compare device names and IDs before/after unplugging; do not disable a'
Write-Output '   device until you know what it is. "Always" avoids this detection condition.'
Write-Output ''
Write-Output 'Opening the Windows Typing settings page...'
Start-Process 'ms-settings:typing'
