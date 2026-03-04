import { NextResponse } from 'next/server';

/**
 * 기본 구글 시트 ID 조회 API
 * 환경 변수에서 기본 시트 ID를 가져옵니다.
 */
export async function GET() {
  const defaultSheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!defaultSheetId) {
    return NextResponse.json({ sheetId: null });
  }

  return NextResponse.json({ sheetId: defaultSheetId });
}
