param(
    [int]$DebounceSeconds = 5
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$GitDirectory = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot ".git"))

function Write-WatcherLog {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray)
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "[$time] $Message" -ForegroundColor $Color
}

function Test-IgnoredEvent {
    param([string]$FullPath)

    if ([string]::IsNullOrWhiteSpace($FullPath)) { return $true }
    $resolvedPath = [System.IO.Path]::GetFullPath($FullPath)
    return $resolvedPath.StartsWith($GitDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SecretPath {
    param([string]$RelativePath)

    $path = $RelativePath.Replace("\", "/")
    return $path -match '(^|/)\.env($|\.)' -or
           $path -match '(?i)(^|/)(id_rsa|id_ed25519)(\.|$)' -or
           $path -match '(?i)\.(pem|key|p12|pfx|jks|secret)$' -or
           $path -match '(?i)(^|/)(credentials(\..*)?\.json|service[-_]account.*\.json|secrets?\.json)$'
}

function Invoke-GitCommand {
    param([string[]]$Arguments)

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed."
    }
}

function Invoke-AutoCommitAndPush {
    Push-Location $ProjectRoot
    try {
        & git diff --quiet
        $workingTreeChanged = $LASTEXITCODE -ne 0
        & git diff --cached --quiet
        $indexChanged = $LASTEXITCODE -ne 0
        $untracked = & git ls-files --others --exclude-standard

        if (-not $workingTreeChanged -and -not $indexChanged -and -not $untracked) {
            Write-WatcherLog "No Git changes to save."
            return
        }

        Invoke-GitCommand -Arguments @("add", "-A", "--", ".")

        $stagedPaths = @(& git diff --cached --name-only --diff-filter=ACMR)
        $secretPaths = @($stagedPaths | Where-Object { Test-SecretPath $_ })
        foreach ($secretPath in $secretPaths) {
            & git restore --staged -- $secretPath 2>$null
            if ($LASTEXITCODE -ne 0) {
                & git reset -q HEAD -- $secretPath
            }
            Write-WatcherLog "Skipped possible secret file: $secretPath" Yellow
        }

        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-WatcherLog "No changes remain to commit."
            return
        }

        $commitMessage = "auto: save changes $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        Invoke-GitCommand -Arguments @("commit", "-m", $commitMessage)
        Invoke-GitCommand -Arguments @("push", "origin", "main")
        Write-WatcherLog "Committed and pushed to main." Green
    }
    catch {
        Write-WatcherLog $_.Exception.Message Red
        Write-WatcherLog "Your changes are still present. Check Git settings and network access." Yellow
    }
    finally {
        Pop-Location
    }
}

Push-Location $ProjectRoot
try {
    Invoke-GitCommand -Arguments @("rev-parse", "--is-inside-work-tree")
    $currentBranch = (& git branch --show-current).Trim()
    if ($currentBranch -ne "main") {
        throw "Current branch is '$currentBranch'. Start this watcher on main."
    }
    Invoke-GitCommand -Arguments @("remote", "get-url", "origin")
}
finally {
    Pop-Location
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $ProjectRoot
$watcher.Filter = "*"
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor
                        [System.IO.NotifyFilters]::DirectoryName -bor
                        [System.IO.NotifyFilters]::LastWrite -bor
                        [System.IO.NotifyFilters]::CreationTime

$sourceIds = @("CatWater.Changed", "CatWater.Created", "CatWater.Deleted", "CatWater.Renamed")
Register-ObjectEvent $watcher Changed -SourceIdentifier $sourceIds[0] | Out-Null
Register-ObjectEvent $watcher Created -SourceIdentifier $sourceIds[1] | Out-Null
Register-ObjectEvent $watcher Deleted -SourceIdentifier $sourceIds[2] | Out-Null
Register-ObjectEvent $watcher Renamed -SourceIdentifier $sourceIds[3] | Out-Null
$watcher.EnableRaisingEvents = $true

Write-WatcherLog "Auto Git watcher started. Press Ctrl+C to stop." Cyan
Write-WatcherLog "Changes will be grouped for $DebounceSeconds seconds before commit and push."

try {
    while ($true) {
        $event = Wait-Event
        $eventPath = $event.SourceEventArgs.FullPath
        Remove-Event -EventIdentifier $event.EventIdentifier
        if (Test-IgnoredEvent $eventPath) { continue }

        Write-WatcherLog "Change detected: $($event.SourceEventArgs.Name)"
        $lastChange = Get-Date

        while (((Get-Date) - $lastChange).TotalSeconds -lt $DebounceSeconds) {
            $nextEvent = Wait-Event -Timeout 1
            if ($null -eq $nextEvent) { continue }

            $nextPath = $nextEvent.SourceEventArgs.FullPath
            Remove-Event -EventIdentifier $nextEvent.EventIdentifier
            if (-not (Test-IgnoredEvent $nextPath)) {
                $lastChange = Get-Date
            }
        }

        Invoke-AutoCommitAndPush
    }
}
finally {
    $watcher.EnableRaisingEvents = $false
    foreach ($sourceId in $sourceIds) {
        Unregister-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue
    }
    $watcher.Dispose()
    Write-WatcherLog "Auto Git watcher stopped." Cyan
}
