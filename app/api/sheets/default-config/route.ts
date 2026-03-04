import { NextResponse } from 'next/server';

/**
 * 기본 알림톡 설정 조회 API
 * 환경 변수에서 기본 템플릿 ID, PFID, 변수 매핑을 가져옵니다.
 */
export async function GET() {
  const defaultTemplateId = process.env.COOLSMS_TEMPLATE_SUMMURY_MATCHING;
  const defaultPfid = process.env.COOLSMS_PFID;
  
  // 환경 변수에서 변수 매핑 가져오기 (COOLSMS_VAR_* 패턴)
  const varMappings: Record<string, string> = {};
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('COOLSMS_VAR_')) {
      const varName = key.replace('COOLSMS_VAR_', '');
      const columnName = process.env[key] || '';
      varMappings[varName] = columnName;
    }
  });

  return NextResponse.json({
    templateId: defaultTemplateId || '',
    pfid: defaultPfid || '',
    varMappings,
  });
}
