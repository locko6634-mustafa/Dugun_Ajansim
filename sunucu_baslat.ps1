# Bağımsız Sunucu Başlatıcı (Taşınabilir Sürüm)
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = Get-Location }

# Sistemdeki Python yolunu dinamik olarak bul
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    Write-Host "Hata: Python sisteminizde yuklu degil veya PATH degiskenine eklenmemis!" -ForegroundColor Red
    Exit
}
$pythonPath = $pythonCommand.Source
$workingDir = $scriptPath
$port = 8000

# Eğer port doluysa eski python sürecini temizle
$oldProcess = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($oldProcess) {
    Write-Host "Port $port dolu. Eski islem (PID: $oldProcess) sonlandiriliyor..." -ForegroundColor Yellow
    Stop-Process -Id $oldProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "Sunucu WMI ile bagimsiz olarak baslatiliyor..." -ForegroundColor Cyan
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = """$pythonPath"" -m http.server $port"
    CurrentDirectory = $workingDir
}

if ($result.ReturnValue -eq 0) {
    Write-Host "Sunucu basariyla baslatildi! PID: $($result.ProcessId)" -ForegroundColor Green
    Write-Host "Proje Dizini: $workingDir" -ForegroundColor Green
    Write-Host "Tarayicinizdan http://localhost:$port adresine gidebilirsiniz." -ForegroundColor Green
} else {
    Write-Host "Sunucu baslatilamadi. Hata Kodu: $($result.ReturnValue)" -ForegroundColor Red
}
