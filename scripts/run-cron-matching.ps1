# ============================================
# summury_manage - 매칭 알림톡 자동 발송 스크립트 (Windows)
# ============================================
# 작업 스케줄러(Task Scheduler)에서 호출합니다.
#
# 사용법:
#   powershell -ExecutionPolicy Bypass -File "C:\path\to\summury_manage\scripts\run-cron-matching.ps1"
#
# ============================================

$ErrorActionPreference = "Continue"

# 프로젝트 경로 자동 감지
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

# 로그 디렉토리 생성
$LogDir = Join-Path $ProjectDir "logs"
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$LogFile = Join-Path $LogDir "cron-matching-$(Get-Date -Format 'yyyyMMdd').log"

function Write-Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$timestamp] $msg" | Out-File -Append -Encoding utf8 $LogFile
}

Write-Log "========================================"
Write-Log "매칭 알림톡 자동 발송 시작"

# .env.local 에서 CRON_SECRET 읽기
$EnvFile = Join-Path $ProjectDir ".env.local"
$CronSecret = ""
if (Test-Path $EnvFile) {
    $lines = Get-Content $EnvFile -Encoding utf8
    foreach ($line in $lines) {
        if ($line -match "^CRON_SECRET=(.+)$") {
            $CronSecret = $Matches[1].Trim()
        }
    }
}

if ([string]::IsNullOrEmpty($CronSecret)) {
    Write-Log "[ERROR] CRON_SECRET을 .env.local에서 찾을 수 없습니다."
    exit 1
}

# summury_manage 는 포트 3001 사용 (onboarding_rela가 3000 사용 중)
$BaseUrl = "http://localhost:3001"

Write-Log "BASE_URL: $BaseUrl"

try {
    $response = Invoke-WebRequest -Method POST `
        -Uri "$BaseUrl/api/cron/matching?secret=$CronSecret" `
        -ContentType "application/json" `
        -Body "{}" `
        -UseBasicParsing `
        -TimeoutSec 120

    Write-Log "HTTP Status: $($response.StatusCode)"
    Write-Log "Response: $($response.Content)"

    if ($response.StatusCode -eq 200) {
        Write-Log "매칭 알림톡 자동 발송 완료 (성공)"
        exit 0
    } else {
        Write-Log "[ERROR] 비정상 응답 (HTTP $($response.StatusCode))"
        exit 1
    }
} catch {
    Write-Log "[ERROR] API 호출 실패: $($_.Exception.Message)"
    exit 1
}
