#!/bin/bash
# 매칭 알림톡 자동 발송 스크립트
# macOS 작업 스케줄러(launchd)나 crontab에서 호출합니다.
#
# 사용법:
#   ./scripts/cron-matching.sh
#
# 환경변수:
#   CRON_SECRET: .env.local에 설정된 CRON_SECRET 값
#   BASE_URL: 서버 주소 (기본값: http://localhost:3000)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/logs/cron-matching-$(date +%Y%m%d).log"

# 로그 디렉토리 생성
mkdir -p "$PROJECT_DIR/logs"

# .env.local에서 CRON_SECRET 읽기
if [ -f "$PROJECT_DIR/.env.local" ]; then
  CRON_SECRET=$(grep '^CRON_SECRET=' "$PROJECT_DIR/.env.local" | cut -d'=' -f2)
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 매칭 알림톡 자동 발송 시작" >> "$LOG_FILE"
echo "BASE_URL: $BASE_URL" >> "$LOG_FILE"

# API 호출
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "${BASE_URL}/api/cron/matching?secret=${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  2>> "$LOG_FILE")

# HTTP 상태 코드와 응답 본문 분리
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE" >> "$LOG_FILE"
echo "Response: $BODY" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 완료" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 실패 시 exit code 1
if [ "$HTTP_CODE" != "200" ]; then
  echo "[ERROR] 매칭 알림톡 발송 실패 (HTTP $HTTP_CODE)" >> "$LOG_FILE"
  exit 1
fi

exit 0
