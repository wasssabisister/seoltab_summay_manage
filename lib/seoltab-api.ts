/**
 * Seoltab 과외채팅방 메시지 발송 유틸리티
 *
 * Postman에서 호출하던 Seoltab_send_push_message API를 코드로 자동화
 * - staging / production 환경 구분
 * - Content-Type: application/x-www-form-urlencoded
 * - 로그인 → 세션 쿠키 → 메시지 발송 흐름
 */

const SEOLTAB_URLS = {
  staging: 'https://staging.onuii.com:443/Seoltab_send_push_message',
  production: 'https://onuii.com:443/Seoltab_send_push_message',
} as const;

const SEOLTAB_LOGIN_URLS = {
  staging: 'https://staging.onuii.com:443/login',
  production: 'https://onuii.com:443/login',
} as const;

export type SeoltabEnv = 'staging' | 'production';
export type TargetUser = 'STUDENT' | 'TUTOR' | 'STUDENT,TUTOR';

export interface SeoltabMessageOptions {
  /** 과외방 LVT (LECTURE_VT_NO) */
  lectureVtNo: string;

  /** staging 또는 production */
  env?: SeoltabEnv;

  /** 푸시 알림 발송 여부 */
  isSendPush?: boolean;

  /** 채팅방 메시지 발송 여부 */
  isSendMessage?: boolean;

  /** 푸시 제목 */
  pushTitle?: string;

  /** 푸시 본문 */
  pushContent?: string;

  /** 채팅방 메시지 내용 */
  messageDetail: string;

  /** 메시지 수신 대상 */
  targetUser?: TargetUser;

  /** 이미지 URL (선택) */
  imgUrl?: string;

  /** 이미지 너비 (선택) */
  imgWidth?: string;

  /** 이미지 높이 (선택) */
  imgHeight?: string;

  /** 과외방에 이미지 전달 여부 (false = 발송, true = 미발송) */
  isNotInit?: boolean;

  /** 추가 필드 (EXCLUDED_STUDENT_NO, STUDENT_TYPE 등) */
  extraFields?: Record<string, string>;

  /** 요청 타임아웃 (ms) */
  timeout?: number;
}

export interface SeoltabResult {
  success: boolean;
  statusCode?: number;
  data?: any;
  rawBody?: string;
  error?: string;
}

// ─── 세션 쿠키 캐시 (환경별) ───
const sessionCache: Record<string, { cookie: string; expiresAt: number }> = {};
const SESSION_TTL = 30 * 60 * 1000; // 30분

/**
 * Seoltab 로그인 후 세션 쿠키 반환
 */
async function loginAndGetCookie(env: SeoltabEnv): Promise<string> {
  // 캐시된 세션이 아직 유효하면 재사용
  const cached = sessionCache[env];
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[Seoltab] 캐시된 세션 쿠키 사용 (${env})`);
    return cached.cookie;
  }

  const emailId = env === 'production'
    ? (process.env.SEOLTAB_PROD_EMAIL || process.env.SEOLTAB_EMAIL || '')
    : (process.env.SEOLTAB_STAGING_EMAIL || process.env.SEOLTAB_EMAIL || '');

  const password = env === 'production'
    ? (process.env.SEOLTAB_PROD_PASSWORD || process.env.SEOLTAB_PASSWORD || '')
    : (process.env.SEOLTAB_STAGING_PASSWORD || process.env.SEOLTAB_PASSWORD || '');

  if (!emailId || !password) {
    throw new Error(
      `Seoltab 로그인 정보가 없습니다. .env.local에 SEOLTAB_EMAIL / SEOLTAB_PASSWORD를 설정해주세요.`
    );
  }

  const url = SEOLTAB_LOGIN_URLS[env];
  console.log(`[Seoltab] 로그인 시도 - env: ${env}, email: ${emailId}`);

  const params = new URLSearchParams();
  params.append('EMAIL_ID', emailId);
  params.append('PASSWORD', password);
  params.append('GCM_REG_ID', 'summury_manage_auto');
  params.append('SERVICE_TYPE', 'LECTURE');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  // Set-Cookie 헤더에서 쿠키 추출
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  // getSetCookie()가 없는 환경 대비 fallback
  let cookieStr = '';
  if (setCookieHeaders.length > 0) {
    cookieStr = setCookieHeaders
      .map((c: string) => c.split(';')[0]) // 각 쿠키의 name=value 부분만
      .join('; ');
  } else {
    // raw 헤더에서 추출 시도
    const raw = response.headers.get('set-cookie');
    if (raw) {
      cookieStr = raw
        .split(/,(?=\s*\w+=)/)
        .map((c: string) => c.split(';')[0].trim())
        .join('; ');
    }
  }

  const rawBody = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    data = rawBody;
  }

  console.log(`[Seoltab] 로그인 응답 - status: ${response.status}`);
  console.log(`[Seoltab] 쿠키: ${cookieStr ? cookieStr.substring(0, 80) + '...' : '(없음)'}`);

  if (!response.ok) {
    throw new Error(`Seoltab 로그인 실패 (HTTP ${response.status}): ${rawBody.substring(0, 200)}`);
  }

  if (!cookieStr) {
    // 쿠키가 없어도 로그인은 성공 → 혹시 토큰 기반일 수 있음
    console.warn('[Seoltab] 로그인 성공했으나 Set-Cookie 헤더가 없습니다. 쿠키 없이 진행합니다.');
    // 응답에서 토큰이 있는지 확인
    if (data?.ONUEI_RES?.DATA?.TOKEN) {
      cookieStr = `TOKEN=${data.ONUEI_RES.DATA.TOKEN}`;
    }
  }

  // 캐시 저장
  sessionCache[env] = {
    cookie: cookieStr,
    expiresAt: Date.now() + SESSION_TTL,
  };

  return cookieStr;
}

/**
 * 세션 캐시 무효화
 */
export function clearSeoltabSession(env?: SeoltabEnv) {
  if (env) {
    delete sessionCache[env];
  } else {
    delete sessionCache['staging'];
    delete sessionCache['production'];
  }
}

/**
 * Seoltab 과외채팅방에 메시지 발송
 * - 자동으로 로그인 → 세션 쿠키 획득 → 메시지 발송
 */
export async function sendSeoltabMessage({
  lectureVtNo,
  env = 'staging',
  isSendPush = false,
  isSendMessage = true,
  pushTitle = '',
  pushContent = '',
  messageDetail,
  targetUser = 'STUDENT,TUTOR',
  imgUrl,
  imgWidth,
  imgHeight,
  isNotInit = false,
  extraFields,
  timeout = 30000,
}: SeoltabMessageOptions): Promise<SeoltabResult> {
  const url = SEOLTAB_URLS[env];

  // 1) 로그인하여 세션 쿠키 획득
  let cookie: string;
  try {
    cookie = await loginAndGetCookie(env);
  } catch (loginError: any) {
    console.error(`[Seoltab] 로그인 실패:`, loginError.message);
    return { success: false, error: `로그인 실패: ${loginError.message}` };
  }

  // 2) 메시지 발송 요청 구성
  const params = new URLSearchParams();
  params.append('LECTURE_VT_NO', lectureVtNo);
  params.append('IS_SEND_PUSH', String(isSendPush));
  params.append('IS_SEND_MESSAGE', String(isSendMessage));

  if (pushTitle) params.append('PUSH_TITLE', pushTitle);
  if (pushContent) params.append('PUSH_CONTENT', pushContent);

  params.append('MESSAGE_DETAIL', messageDetail);
  params.append('TARGET_USER', targetUser);

  if (imgUrl) {
    params.append('img_url', imgUrl);
    if (imgWidth) params.append('img_width', imgWidth);
    if (imgHeight) params.append('img_height', imgHeight);
  }

  params.append('is_not_init', String(isNotInit));

  // 추가 필드
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      params.append(key, value);
    }
  }

  console.log(`[Seoltab] 발송 요청 - env: ${env}, LVT: ${lectureVtNo}`);
  console.log(`[Seoltab] URL: ${url}`);
  console.log(`[Seoltab] TARGET_USER: ${targetUser}`);
  console.log(`[Seoltab] MESSAGE_DETAIL: ${messageDetail.substring(0, 100)}...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = rawBody;
    }

    console.log(`[Seoltab] 응답 - status: ${response.status}, body: ${rawBody.substring(0, 200)}`);

    // 401이면 세션 만료 → 캐시 무효화 후 1회 재시도
    if (response.status === 401) {
      console.log(`[Seoltab] 세션 만료 감지, 재로그인 후 재시도...`);
      clearSeoltabSession(env);

      try {
        const retryCookie = await loginAndGetCookie(env);
        const retryHeaders: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (retryCookie) {
          retryHeaders['Cookie'] = retryCookie;
        }

        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: retryHeaders,
          body: params.toString(),
        });

        const retryRawBody = await retryResponse.text();
        let retryData: any;
        try {
          retryData = JSON.parse(retryRawBody);
        } catch {
          retryData = retryRawBody;
        }

        console.log(`[Seoltab] 재시도 응답 - status: ${retryResponse.status}, body: ${retryRawBody.substring(0, 200)}`);

        return {
          success: retryResponse.ok,
          statusCode: retryResponse.status,
          data: retryData,
          rawBody: retryRawBody,
          error: retryResponse.ok ? undefined : `HTTP ${retryResponse.status}`,
        };
      } catch (retryError: any) {
        return { success: false, error: `재시도 실패: ${retryError.message}` };
      }
    }

    return {
      success: response.ok,
      statusCode: response.status,
      data,
      rawBody,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`[Seoltab] 타임아웃 (${timeout}ms)`);
      return { success: false, error: 'Request timeout' };
    }
    console.error(`[Seoltab] 발송 실패:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * 환경변수에서 기본 메시지 템플릿 가져오기
 */
export function getDefaultMessageTemplate(): string {
  return process.env.SEOLTAB_DEFAULT_MESSAGE_TEMPLATE || '';
}

/**
 * 환경변수에서 Seoltab 환경 가져오기
 */
export function getDefaultSeoltabEnv(): SeoltabEnv {
  const env = process.env.SEOLTAB_ENV || 'staging';
  return env === 'production' ? 'production' : 'staging';
}
