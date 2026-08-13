param(
  [ValidateSet("all", "build", "boot", "test", "cleanup")]
  [string]$Phase = "all",
  [switch]$SkipBuild,
  [switch]$SkipCore,
  [switch]$SkipChannels
)

$ErrorActionPreference = "Stop"
$projectName = "dugun-ajansim-phase06"
$composeArgs = @("compose", "-f", "compose.quality.yaml", "-p", $projectName)
$phaseEnvironmentNames = @(
  "PHASE06_POSTGRES_PASSWORD",
  "PHASE06_RUNTIME_PASSWORD",
  "PHASE06_TURNSTILE_SECRET",
  "PHASE06_DATA_ENCRYPTION_KEY",
  "PHASE06_DATA_ENCRYPTION_KEYRING_JSON",
  "PHASE06_BLIND_INDEX_KEY",
  "PHASE06_BLIND_INDEX_KEYRING_JSON",
  "PHASE06_RATE_LIMIT_HMAC_KEY",
  "PHASE06_ADMIN_PASSWORD",
  "PHASE06_SALON_PASSWORD",
  "PHASE06_CUSTOMER_PASSWORD",
  "PHASE06_ADMIN_TOTP_SECRET",
  "PHASE06_HTTP_PORT",
  "PHASE06_POSTGRES_PORT",
  "PHASE06_BASE_URL",
  "PHASE06_DATABASE_URL",
  "PHASE06_RUNTIME_DATABASE_URL",
  "PHASE06_RELEASE_SHA"
)
$sensitiveEnvironmentNames = $phaseEnvironmentNames | Where-Object {
  $_ -notin @(
    "PHASE06_HTTP_PORT",
    "PHASE06_POSTGRES_PORT",
    "PHASE06_BASE_URL",
    "PHASE06_RELEASE_SHA"
  )
}
$resultDirectory = Join-Path $PSScriptRoot "..\test-results\phase06"

function New-Hex([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-Base32([int]$length = 32) {
  $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  $bytes = New-Object byte[] $length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Invoke-Checked([string]$command, [string[]]$arguments) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$command komutu $LASTEXITCODE koduyla başarısız oldu."
  }
}

function Mask-Line([string]$line) {
  $masked = $line
  foreach ($name in $sensitiveEnvironmentNames) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $masked = $masked.Replace($value, "[MASKED]") }
  }
  return $masked
}

function Set-PhaseEnvironment([string]$name, [string]$value) {
  [Environment]::SetEnvironmentVariable($name, $value)
}

function Initialize-PhaseEnvironment {
  if (-not $env:PHASE06_POSTGRES_PASSWORD) {
    Set-PhaseEnvironment "PHASE06_POSTGRES_PASSWORD" "P6~Owner-$(New-Hex 24)"
  }
  if (-not $env:PHASE06_RUNTIME_PASSWORD) {
    Set-PhaseEnvironment "PHASE06_RUNTIME_PASSWORD" "P6~Runtime-$(New-Hex 24)"
  }
  if (-not $env:PHASE06_TURNSTILE_SECRET) {
    Set-PhaseEnvironment "PHASE06_TURNSTILE_SECRET" (New-Hex)
  }
  if (-not $env:PHASE06_DATA_ENCRYPTION_KEY) {
    Set-PhaseEnvironment "PHASE06_DATA_ENCRYPTION_KEY" (New-Hex)
  }
  if (-not $env:PHASE06_DATA_ENCRYPTION_KEYRING_JSON) {
    Set-PhaseEnvironment "PHASE06_DATA_ENCRYPTION_KEYRING_JSON" (
      @{ phase06 = $env:PHASE06_DATA_ENCRYPTION_KEY } | ConvertTo-Json -Compress
    )
  }
  if (-not $env:PHASE06_BLIND_INDEX_KEY) {
    Set-PhaseEnvironment "PHASE06_BLIND_INDEX_KEY" (New-Hex)
  }
  if (-not $env:PHASE06_BLIND_INDEX_KEYRING_JSON) {
    Set-PhaseEnvironment "PHASE06_BLIND_INDEX_KEYRING_JSON" (
      @{ phase06 = $env:PHASE06_BLIND_INDEX_KEY } | ConvertTo-Json -Compress
    )
  }
  if (-not $env:PHASE06_RATE_LIMIT_HMAC_KEY) {
    Set-PhaseEnvironment "PHASE06_RATE_LIMIT_HMAC_KEY" (New-Hex)
  }
  if (-not $env:PHASE06_ADMIN_PASSWORD) {
    Set-PhaseEnvironment "PHASE06_ADMIN_PASSWORD" "P6!Admin-$(New-Hex 16)"
  }
  if (-not $env:PHASE06_SALON_PASSWORD) {
    Set-PhaseEnvironment "PHASE06_SALON_PASSWORD" "P6!Salon-$(New-Hex 16)"
  }
  if (-not $env:PHASE06_CUSTOMER_PASSWORD) {
    Set-PhaseEnvironment "PHASE06_CUSTOMER_PASSWORD" "P6!Musteri-$(New-Hex 16)"
  }
  if (-not $env:PHASE06_ADMIN_TOTP_SECRET) {
    Set-PhaseEnvironment "PHASE06_ADMIN_TOTP_SECRET" (New-Base32)
  }
  if (-not $env:PHASE06_HTTP_PORT) { Set-PhaseEnvironment "PHASE06_HTTP_PORT" "8186" }
  if (-not $env:PHASE06_POSTGRES_PORT) { Set-PhaseEnvironment "PHASE06_POSTGRES_PORT" "55436" }
  if (-not $env:PHASE06_BASE_URL) {
    Set-PhaseEnvironment "PHASE06_BASE_URL" "http://127.0.0.1:$($env:PHASE06_HTTP_PORT)"
  }
  if (-not $env:PHASE06_DATABASE_URL) {
    Set-PhaseEnvironment "PHASE06_DATABASE_URL" (
      "postgresql://phase06_owner:$($env:PHASE06_POSTGRES_PASSWORD)@127.0.0.1:$($env:PHASE06_POSTGRES_PORT)/dugun_ajansim_phase06"
    )
  }
  if (-not $env:PHASE06_RUNTIME_DATABASE_URL) {
    Set-PhaseEnvironment "PHASE06_RUNTIME_DATABASE_URL" (
      "postgresql://phase06_runtime:$($env:PHASE06_RUNTIME_PASSWORD)@127.0.0.1:$($env:PHASE06_POSTGRES_PORT)/dugun_ajansim_phase06"
    )
  }
  if (-not $env:PHASE06_RELEASE_SHA) {
    $releaseSha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $releaseSha -notmatch "^[a-f0-9]{40}$") {
      throw "Release SHA okunamadı."
    }
    Set-PhaseEnvironment "PHASE06_RELEASE_SHA" $releaseSha
  }
  if ($env:PHASE06_RELEASE_SHA -notmatch "^[a-f0-9]{40}$") {
    throw "PHASE06_RELEASE_SHA geçerli bir Git SHA değil."
  }

  if ($env:GITHUB_ENV) {
    foreach ($name in $sensitiveEnvironmentNames) {
      $value = [Environment]::GetEnvironmentVariable($name)
      if ($value) { Write-Output "::add-mask::$value" }
    }
    foreach ($name in $phaseEnvironmentNames) {
      $value = [Environment]::GetEnvironmentVariable($name)
      if (-not $value) { throw "$name Faz 06 için üretilemedi." }
      Add-Content -LiteralPath $env:GITHUB_ENV -Value "$name=$value" -Encoding UTF8
    }
  }
}

function Assert-PhaseEnvironment {
  foreach ($name in $phaseEnvironmentNames) {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
      throw "$name Faz 06 $Phase aşaması için zorunludur."
    }
  }
}

function Write-PhaseDuration([string]$name, [TimeSpan]$elapsed) {
  $seconds = [Math]::Round($elapsed.TotalSeconds, 2)
  Write-Output "PHASE06_TIMING phase=$name durationSeconds=$seconds"
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      "### Phase06 $name süresi",
      "",
      "- **$seconds saniye**"
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding UTF8
  }
}

function Invoke-TimedPhase([string]$name, [scriptblock]$action) {
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  try {
    & $action
  } finally {
    $stopwatch.Stop()
    Write-PhaseDuration $name $stopwatch.Elapsed
  }
}

function Write-Diagnostics {
  New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
  try {
    (& docker @composeArgs ps --all 2>&1) | ForEach-Object { Mask-Line "$_" } |
      Set-Content -LiteralPath (Join-Path $resultDirectory "compose-status.txt") -Encoding UTF8
  } catch { }
  try {
    (& docker @composeArgs logs --no-color --tail 120 2>&1) | ForEach-Object { Mask-Line "$_" } |
      Set-Content -LiteralPath (Join-Path $resultDirectory "container-logs.txt") -Encoding UTF8
  } catch { }
}

function Invoke-BuildPhase {
  Invoke-Checked "docker" ($composeArgs + @("config", "--quiet"))
  if (-not $SkipBuild) {
    Invoke-Checked "docker" ($composeArgs + @("build"))
  }
}

function Invoke-BootPhase {
  Invoke-Checked "docker" ($composeArgs + @("config", "--quiet"))
  Invoke-Checked "docker" ($composeArgs + @("up", "--detach", "--no-build"))

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(4)
  $healthy = $false
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$($env:PHASE06_BASE_URL)/healthz" -TimeoutSec 3
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) { throw "Faz 06 frontend healthcheck zaman aşımına uğradı." }

  New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
  [ordered]@{
    releaseSha = $env:PHASE06_RELEASE_SHA
    composeProject = $projectName
    generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    syntheticDataOnly = $true
    productionSecretsUsed = $false
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resultDirectory "release.json") -Encoding UTF8
}

function Invoke-TestPhase {
  try {
    if (-not $SkipCore) {
      Invoke-Checked "npm" @("run", "test:phase06")
      Invoke-Checked "npm" @("run", "test:phase06:sanitize-har")
    }
    if (-not $SkipChannels -and $env:CI -ne "true") {
      Invoke-Checked "npm" @("run", "test:phase06:channels")
    }
  } catch {
    if (-not $SkipCore) {
      try { Invoke-Checked "npm" @("run", "test:phase06:sanitize-har") } catch { }
    }
    throw
  }
}

function Invoke-CleanupPhase {
  Write-Diagnostics
  try {
    Invoke-Checked "docker" ($composeArgs + @("down", "--volumes", "--remove-orphans", "--timeout", "10"))
    $containers = ((& docker ps --all --quiet --filter "label=com.docker.compose.project=$projectName") | Out-String).Trim()
    $volumes = ((& docker volume ls --quiet --filter "label=com.docker.compose.project=$projectName") | Out-String).Trim()
    if ($containers -or $volumes) {
      throw "İzole Faz 06 container/volume cleanup doğrulaması başarısız."
    }
  } finally {
    foreach ($name in $phaseEnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name, $null)
    }
  }
}

if ($Phase -in @("all", "build", "boot")) {
  Initialize-PhaseEnvironment
} else {
  Assert-PhaseEnvironment
}

if ($Phase -eq "all") {
  $primaryError = $null
  $cleanupError = $null
  try {
    if (-not $SkipBuild) { Invoke-TimedPhase "build" { Invoke-BuildPhase } }
    Invoke-TimedPhase "boot" { Invoke-BootPhase }
    Invoke-TimedPhase "test" { Invoke-TestPhase }
  } catch {
    $primaryError = $_
  } finally {
    try {
      Invoke-TimedPhase "cleanup" { Invoke-CleanupPhase }
    } catch {
      $cleanupError = $_
    }
  }
  if ($cleanupError) { throw $cleanupError }
  if ($primaryError) { throw $primaryError }
  Write-Output "Faz 06 izole full-stack kalite kapısı başarıyla tamamlandı ve ortam temizlendi."
  exit 0
}

try {
  switch ($Phase) {
    "build" { Invoke-TimedPhase "build" { Invoke-BuildPhase } }
    "boot" { Invoke-TimedPhase "boot" { Invoke-BootPhase } }
    "test" { Invoke-TimedPhase "test" { Invoke-TestPhase } }
    "cleanup" { Invoke-TimedPhase "cleanup" { Invoke-CleanupPhase } }
  }
} catch {
  if ($Phase -in @("boot", "test")) { Write-Diagnostics }
  throw
}
