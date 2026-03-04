import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';
import { sendSeoltabMessage, SeoltabEnv, TargetUser } from '@/lib/seoltab-api';

/**
 * Seoltab 과외채팅방 메시지 발송 API
 *
 * POST /api/seoltab/send
 *
 * Body:
 *  - lvt: string (필수) - 과외방 LVT
 *  - env: 'staging' | 'production' (기본값: staging)
 *  - messageDetail: string (필수) - 채팅방 메시지
 *  - targetUser: 'STUDENT' | 'TUTOR' | 'STUDENT,TUTOR' (기본값: STUDENT,TUTOR)
 *  - isSendPush: boolean (기본값: false)
 *  - isSendMessage: boolean (기본값: true)
 *  - pushTitle: string
 *  - pushContent: string
 *  - imgUrl, imgWidth, imgHeight: string
 *  - isNotInit: boolean
 *  - eventType: string (MessageDispatch 이벤트 타입, 기본값: 'seoltab_message')
 *  - dryRun: boolean (true면 실제 발송 안 함)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      lvt,
      env = 'staging',
      messageDetail,
      targetUser = 'STUDENT,TUTOR',
      isSendPush = false,
      isSendMessage = true,
      pushTitle = '',
      pushContent = '',
      imgUrl,
      imgWidth,
      imgHeight,
      isNotInit = false,
      eventType = 'seoltab_message',
      dryRun = false,
      extraFields,
      // 변수 치환용 (시트 데이터)
      studentName,
      teacherName,
      subject,
    } = body;

    if (!lvt) {
      return NextResponse.json({ error: 'lvt는 필수입니다.' }, { status: 400 });
    }

    if (!messageDetail) {
      return NextResponse.json({ error: 'messageDetail은 필수입니다.' }, { status: 400 });
    }

    // 메시지 내 변수 치환: {{s_name}} → 학생명, {{t_name}} → 선생님명, {{subject}} → 과목
    let finalMessage = messageDetail;
    if (studentName) finalMessage = finalMessage.replace(/\{\{s_name\}\}/g, studentName);
    if (teacherName) finalMessage = finalMessage.replace(/\{\{t_name\}\}/g, teacherName);
    if (subject) finalMessage = finalMessage.replace(/\{\{subject\}\}/g, subject);

    if (env !== 'staging' && env !== 'production') {
      return NextResponse.json({ error: 'env는 staging 또는 production이어야 합니다.' }, { status: 400 });
    }

    await connectDB();

    // 멱등성 키: 채널 + 이벤트타입 + lvt + 환경
    const idempotencyKey = `seoltab:${eventType}:${lvt}`;

    // 이미 발송된 기록 확인
    const existing = await MessageDispatch.findOne({
      idempotencyKey,
      status: 'sent',
    }).lean();

    if (existing) {
      return NextResponse.json({
        message: '이미 발송된 기록이 있습니다.',
        status: 'skipped',
        idempotencyKey,
        existingDispatch: {
          sentAt: (existing as any).sentAt,
          attemptCount: (existing as any).attemptCount,
        },
      });
    }

    if (dryRun) {
      return NextResponse.json({
        message: 'dryRun 모드 - 실제 발송하지 않았습니다.',
        dryRun: true,
        wouldSend: {
          lvt,
          env,
          messageDetail: finalMessage.substring(0, 500) + (finalMessage.length > 500 ? '...' : ''),
          targetUser,
          isSendPush,
          isSendMessage,
          studentName: studentName || '(없음)',
          teacherName: teacherName || '(없음)',
          subject: subject || '(없음)',
        },
      });
    }

    // MessageDispatch 생성/갱신 (pending)
    const dispatch = await MessageDispatch.findOneAndUpdate(
      { idempotencyKey },
      {
        $set: {
          channel: 'api',
          status: 'pending',
          eventType,
          lvt,
          externalApiUrl: `seoltab_${env}`,
          recipientName: studentName || '',
          payload: {
            lvt,
            env,
            messageDetail: finalMessage,
            originalTemplate: messageDetail,
            variables: { studentName, teacherName, subject },
            targetUser,
            isSendPush,
            isSendMessage,
            pushTitle,
            pushContent,
          },
          lastAttemptAt: new Date(),
          maxRetry: 3,
          metadata: {
            subject: subject || '',
            seoltabEnv: env,
            triggerType: 'manual',
          },
        },
        $inc: { attemptCount: 1 },
      },
      { upsert: true, new: true }
    );

    // Seoltab API 호출 (치환된 메시지 사용)
    const result = await sendSeoltabMessage({
      lectureVtNo: lvt,
      env: env as SeoltabEnv,
      isSendPush,
      isSendMessage,
      pushTitle,
      pushContent,
      messageDetail: finalMessage,
      targetUser: targetUser as TargetUser,
      imgUrl,
      imgWidth,
      imgHeight,
      isNotInit,
      extraFields,
    });

    if (result.success) {
      await MessageDispatch.updateOne(
        { _id: dispatch._id },
        {
          $set: {
            status: 'sent',
            sentAt: new Date(),
            response: { statusCode: result.statusCode, data: result.data },
          },
        }
      );

      return NextResponse.json({
        message: '발송 성공',
        status: 'sent',
        lvt,
        env,
        dispatchId: dispatch._id,
        response: result.data,
      });
    } else {
      await MessageDispatch.updateOne(
        { _id: dispatch._id },
        {
          $set: {
            status: 'failed',
            errorMessage: result.error || `HTTP ${result.statusCode}`,
            response: { statusCode: result.statusCode, data: result.data, rawBody: result.rawBody },
          },
        }
      );

      return NextResponse.json(
        {
          message: '발송 실패',
          status: 'failed',
          lvt,
          env,
          error: result.error || `HTTP ${result.statusCode}`,
          dispatchId: dispatch._id,
          rawResponse: result.rawBody?.substring(0, 500),
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error('[Seoltab/Send] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
