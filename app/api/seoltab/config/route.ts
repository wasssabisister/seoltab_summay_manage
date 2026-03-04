import { NextResponse } from 'next/server';

/**
 * Seoltab 기본 설정 API
 * 
 * 환경변수에 설정된 기본 메시지 템플릿 등을 프론트엔드에 전달합니다.
 */
export async function GET() {
  return NextResponse.json({
    defaultMessage: process.env.SEOLTAB_CRON_MESSAGE || '',
    env: process.env.SEOLTAB_ENV || 'staging',
  });
}
