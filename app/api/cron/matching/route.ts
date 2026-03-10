import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';
import { StudentLessonState } from '@/models/StudentLessonState';
import { sendAlimTalk } from '@/lib/sms';

const EVENT_TYPE = 'matching_first';

/**
 * 매칭 알림톡 자동 발송 Cron 엔드포인트
 * 
 * 매일 특정 시간에 호출되어 첫 수업 완료된 수업에 대해 매칭 알림톡을 자동 발송합니다.
 * - 각 수업(lvt)에 최초 1회만 발송
 * - ffTuda(첫 수업 일자)가 어제이고, fsSs(첫 수업 상태)가 DONE인 수업만 대상
 * - MongoDB의 StudentLessonState에서 데이터를 읽어 시트 API 호출 없이 빠르게 동작
 * 
 * Query Parameters:
 * - secret: CRON_SECRET 환경 변수와 일치해야 함
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');

    // Secret 검증
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const templateId = process.env.COOLSMS_TEMPLATE_SUMMURY_MATCHING;
    const pfid = process.env.COOLSMS_PFID;

    if (!templateId || !pfid) {
      return NextResponse.json(
        { error: 'COOLSMS_TEMPLATE_SUMMURY_MATCHING 또는 COOLSMS_PFID가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    await connectDB();

    // 어제 날짜 계산 (KST 기준)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    const kstYesterday = new Date(kstNow);
    kstYesterday.setDate(kstYesterday.getDate() - 1);
    const yesterdayStr = kstYesterday.toISOString().slice(0, 10);

    console.log(`[Cron/Matching] 실행 시각: ${kstNow.toISOString()}, 어제: ${yesterdayStr}`);

    // MongoDB에서 활성 수업 조회 (제외/보류 아닌 것 + ffTuda가 어제 + fsSs가 DONE)
    const allLessons = await StudentLessonState.find({
      status: { $nin: ['제외', '보류'] },
    }).lean();

    // 첫 수업 일자가 어제이고 첫 수업 상태가 DONE인 수업 필터링
    const targetLessons = allLessons.filter((lesson) => {
      const ffTuda = lesson.ffTuda?.trim();
      const fsSs = lesson.fsSs?.trim()?.toUpperCase();
      if (!ffTuda || fsSs !== 'DONE') return false;
      return ffTuda.slice(0, 10) === yesterdayStr;
    });

    console.log(`[Cron/Matching] 전체 활성: ${allLessons.length}, 어제 첫 수업 완료(DONE): ${targetLessons.length}`);

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const results: Array<{
      lvt: string;
      name: string;
      phone: string;
      status: string;
      reason?: string;
    }> = [];

    for (const lesson of targetLessons) {
      const lvt = lesson.lvt?.trim();
      if (!lvt) {
        skippedCount++;
        continue;
      }

      const phone = lesson.phoneNumber?.trim();
      if (!phone) {
        skippedCount++;
        results.push({ lvt, name: lesson.name || '-', phone: '-', status: 'skipped', reason: '전화번호 없음' });
        continue;
      }

      const name = lesson.name?.trim() || '-';
      const idempotencyKey = `${EVENT_TYPE}:${lvt}`;

      // 이미 발송된 기록 확인
      const existing = await MessageDispatch.findOne({
        idempotencyKey,
        status: 'sent',
      }).lean();

      if (existing) {
        skippedCount++;
        continue;
      }

      // MessageDispatch 생성 (pending)
      const dispatch = await MessageDispatch.findOneAndUpdate(
        { idempotencyKey },
        {
          $set: {
            channel: 'kakao',
            status: 'pending',
            eventType: EVENT_TYPE,
            lvt,
            studentUserNo: lesson.studentUserNo || '',
            recipientPhone: phone,
            recipientName: name,
            templateId,
            payload: { lvt, variables: { '#{학생명}': name } },
            lastAttemptAt: new Date(),
            maxRetry: 3,
            metadata: {
              subject: lesson.subject || '',
              teacherName: lesson.teacherName || '',
              triggerType: 'cron',
            },
          },
          $inc: { attemptCount: 1 },
        },
        { upsert: true, new: true }
      );

      // 알림톡 발송
      try {
        const result = await sendAlimTalk({
          to: phone,
          templateId,
          pfid,
          variables: { '#{학생명}': name },
        });

        if (result.success) {
          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            { $set: { status: 'sent', sentAt: new Date(), response: { messageId: result.messageId } } }
          );
          sentCount++;
          results.push({ lvt, name, phone, status: 'sent' });
          console.log(`[Cron/Matching] 발송 성공: lvt=${lvt}, name=${name}`);
        } else {
          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            { $set: { status: 'failed', errorMessage: result.error } }
          );
          failedCount++;
          results.push({ lvt, name, phone, status: 'failed', reason: result.error });
          console.error(`[Cron/Matching] 발송 실패: lvt=${lvt}, error=${result.error}`);
        }
      } catch (error: any) {
        await MessageDispatch.updateOne(
          { _id: dispatch._id },
          { $set: { status: 'failed', errorMessage: error.message } }
        );
        failedCount++;
        results.push({ lvt, name, phone, status: 'failed', reason: error.message });
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Cron/Matching] 완료: sent=${sentCount}, skipped=${skippedCount}, failed=${failedCount}, elapsed=${elapsed}ms`);

    return NextResponse.json({
      message: '매칭 알림톡 자동 발송 완료',
      date: yesterdayStr,
      total: allLessons.length,
      active: targetLessons.length,
      sent: sentCount,
      skipped: skippedCount,
      failed: failedCount,
      elapsed: `${elapsed}ms`,
      results,
    });
  } catch (error: any) {
    console.error('[Cron/Matching] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
