$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$phpCommand = Get-Command php -ErrorAction SilentlyContinue
$phpExecutable = if ($phpCommand) { $phpCommand.Source } else { Join-Path $projectRoot '.runtime\php\php.exe' }
if (-not (Test-Path -LiteralPath $phpExecutable)) {
    throw 'PHP not found. Install PHP or extract the Windows PHP ZIP into .runtime\php, then run start.cmd again.'
}
$port = 8765
$url = "http://127.0.0.1:$port/music.htm"
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener[0].OwningProcess)"
    if ($serverProcess.Name -ne 'php.exe' -or -not $serverProcess.CommandLine.Contains($projectRoot)) {
        throw "Port $port is already used by another application. Stop it or change the port in start.ps1."
    }
    if (-not $serverProcess.CommandLine.Contains('router.php')) {
        throw "A previous WebMusic server is running without authentication. Stop that PHP process and run start.cmd again."
    }
} else {
    $logDir = Join-Path $projectRoot '.runtime'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $router = Join-Path $projectRoot 'router.php'
    $server = Start-Process -FilePath $phpExecutable -ArgumentList @('-S', "127.0.0.1:$port", '-t', ('"' + $projectRoot + '"'), ('"' + $router + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.out.log') -RedirectStandardError (Join-Path $logDir 'server.err.log') -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 100
        if ($server.HasExited) { throw 'PHP failed to start. Check .runtime\server.err.log.' }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { break }
        } catch {
            if ($_.Exception.Response.StatusCode.value__ -eq 401) { $response = @{ StatusCode = 401 }; break }
        }
    }
    if (-not $response) { throw 'Local server did not respond. Check .runtime\server.err.log.' }
}
Write-Host "Music Folder Player: $url"
Start-Process $url
