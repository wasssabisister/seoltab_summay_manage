/**
 * 쿨에스엠에스 알림톡 발송 유틸리티
 * 
 * 실제 API 키는 .env.local에 설정:
 * - COOLSMS_API_KEY
 * - COOLSMS_API_SECRET
 * - COOLSMS_SENDER_PHONE
 */

type SendSMSOptions = {
  to: string;
  message: string;
  templateKey?: string;
  templateParams?: Record<string, string>;
  useKakaoTalk?: boolean;
  kakaoTemplateId?: string;
  pfid?: string;
};

type SendAlimTalkOptions = {
  to: string;
  templateId: string;
  pfid: string;
  variables: Record<string, string>;
  buttons?: Array<{
    name: string;
    linkType: string;
    linkPc: string;
    linkMobile: string;
  }>;
};

/**
 * 쿨에스엠에스 API를 통해 알림톡/문자 발송
 */
export async function sendSMS({
  to,
  message,
  templateKey,
  templateParams,
  useKakaoTalk = false,
  kakaoTemplateId,
  pfid: providedPfid,
}: SendSMSOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const senderPhone = process.env.COOLSMS_SENDER_PHONE;

  if (!apiKey || !apiSecret || !senderPhone) {
    console.error('[SMS] Missing credentials');
    return {
      success: false,
      error: 'SMS credentials not configured. Check COOLSMS_API_KEY, COOLSMS_API_SECRET, COOLSMS_SENDER_PHONE in .env.local',
    };
  }

  try {
    const normalizedTo = to.replace(/-/g, '');
    const normalizedFrom = senderPhone.replace(/-/g, '');

    // 알림톡 사용 시
    if (useKakaoTalk && kakaoTemplateId) {
      const pfid = providedPfid || (templateParams as any)?.pfid || process.env.COOLSMS_PFID || '';
      if (!pfid) {
        return {
          success: false,
          error: 'PFID not configured',
        };
      }

      const { pfid: _, ...variables } = templateParams || {};

      return await sendAlimTalk({
        to: normalizedTo,
        templateId: kakaoTemplateId,
        pfid: pfid,
        variables: variables,
      });
    }

    // 일반 SMS 발송
    const CoolsmsMessageService = require('coolsms-node-sdk').default;
    const messageService = new CoolsmsMessageService(apiKey, apiSecret);

    const res: any = await messageService.sendOne({
      to: normalizedTo,
      from: normalizedFrom,
      text: message,
    });

    const messageId =
      res?.messageId || res?.groupId || res?.message?.messageId || `coolsms-${Date.now()}`;

    console.log('[SMS] Sent successfully:', { to: normalizedTo, messageId, templateKey });
    return { success: true, messageId };
  } catch (error: any) {
    console.error('[SMS] Request failed:', error);
    return {
      success: false,
      error: error?.message || error?.errorMessage || 'Unknown error occurred',
    };
  }
}

/**
 * 알림톡 발송 (coolsms-node-sdk 사용)
 */
export async function sendAlimTalk({
  to,
  templateId,
  pfid,
  variables,
  buttons,
}: SendAlimTalkOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const senderPhone = process.env.COOLSMS_SENDER_PHONE;

  if (!apiKey || !apiSecret) {
    return {
      success: false,
      error: 'COOLSMS_API_KEY or COOLSMS_API_SECRET not configured',
    };
  }

  if (!senderPhone) {
    return {
      success: false,
      error: 'COOLSMS_SENDER_PHONE not configured',
    };
  }

  try {
    const CoolsmsMessageService = require('coolsms-node-sdk').default;
    const messageService = new CoolsmsMessageService(apiKey, apiSecret);

    const normalizedTo = to.replace(/-/g, '');
    const normalizedFrom = senderPhone.replace(/-/g, '');

    const messagePayload: any = {
      to: normalizedTo,
      from: normalizedFrom,
      type: 'ATA', // 알림톡
      kakaoOptions: {
        pfId: pfid,
        templateId: templateId,
        variables: variables,
        ...(buttons && { buttons }),
      },
    };

    console.log('[AlimTalk] Sending:', {
      to: normalizedTo,
      templateId,
      pfid,
      variables,
    });

    const res: any = await messageService.sendOne(messagePayload);

    const messageId =
      res?.messageId || res?.groupId || res?.message?.messageId || `alimtalk-${Date.now()}`;

    console.log('[AlimTalk] Sent successfully:', { to: normalizedTo, messageId });
    return { success: true, messageId };
  } catch (error: any) {
    console.error('[AlimTalk] Request failed:', error);
    return {
      success: false,
      error: error?.message || error?.errorMessage || 'Unknown error occurred',
    };
  }
}
