# 자동 알림 관리 시스템 (summury_manage)

구글 시트 기반 자동 알림톡 및 외부 API 발송 관리 시스템

## 주요 기능

- 📊 **구글 시트 연동**: 운영 구글 시트를 데이터 소스로 사용
- 📱 **자동 알림톡 발송**: 시간 기반 자동 알림톡 발송
- 🔗 **외부 API 자동 호출**: Postman API를 자동으로 호출
- 📋 **관리 페이지**: 발송 이력 확인, 수동 발송, 설정 관리

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일을 생성하고 다음 변수들을 설정하세요:

```env
# MongoDB
MONGODB_URI=mongodb://...

# CoolSMS (알림톡)
COOLSMS_API_KEY=your_api_key
COOLSMS_API_SECRET=your_api_secret
COOLSMS_SENDER_PHONE=01012345678
COOLSMS_PFID=your_pfid

# 구글 시트 (선택사항)
GOOGLE_SHEETS_CREDENTIALS={"type":"service_account",...}
# 또는
GOOGLE_SHEETS_CLIENT_EMAIL=your_email
GOOGLE_SHEETS_PRIVATE_KEY=your_private_key

# 기본 구글 시트 ID (자동 연동용)
GOOGLE_SHEET_ID=16stKifqmNVG7S_-_hps_N4dtJknZUohUkdxFR7wNH-g
# 또는 전체 URL
# GOOGLE_SHEET_ID=https://docs.google.com/spreadsheets/d/16stKifqmNVG7S_-_hps_N4dtJknZUohUkdxFR7wNH-g/edit

# Cron Secret
CRON_SECRET=your-secret-key
```

### 3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인하세요.

## 프로젝트 구조

```
summury_manage/
├── app/
│   ├── admin/              # 관리 페이지
│   │   ├── notifications/  # 알림톡 관리
│   │   ├── api-calls/      # 외부 API 호출 관리
│   │   ├── schedules/      # 자동 발송 스케줄
│   │   └── sheets/         # 구글 시트 연동
│   └── api/                # API 엔드포인트
├── lib/
│   ├── mongoose.ts         # MongoDB 연결
│   ├── sms.ts              # 알림톡 발송
│   ├── external-api.ts     # 외부 API 호출
│   └── google-sheets.ts   # 구글 시트 연동
└── models/
    ├── NotificationLog.ts  # 발송 이력 모델
    └── ScheduleRule.ts     # 스케줄 규칙 모델
```

## 다음 단계

1. 구글 시트 연동 기능 구현
2. 자동 발송 스케줄 관리 기능 구현
3. 외부 API 호출 자동화 기능 구현
