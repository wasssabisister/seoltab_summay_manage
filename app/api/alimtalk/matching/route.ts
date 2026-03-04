import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';
import { StudentLessonState } from '@/models/StudentLessonState';
import { sendAlimTalk } from '@/lib/sms';

const EVENT_TYPE = 'matching_first';

/**
 * 매칭 알림톡 발송 API
 * 
 * 모든 수업(lvt)에 대해 최초 1회만 COOLSMS_TEMPLATE_SUMMURY_MATCHING 알림톡 발송
 * - MongoDB의 StudentLessonState에서 데이터를 읽어 시트 호출 없이 빠르게 동작
 * - idempotencyKey: matching_first:{lvt}
 * - 변수: #{학생명} → lesson.name
 * - 수신자: lesson.phoneNumber
 * 
 * POST Body:
 * - dryRun?: true이면 실제 발송 없이 대상만 확인
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dryRun = false } = body;

    const templateId = process.env.COOLSMS_TEMPLATE_SUMMURY_MATCHING;
    const pfid = process.env.COOLSMS_PFID;

    if (!templateId) {
      return NextResponse.json(
        { error: 'COOLSMS_TEMPLATE_SUMMURY_MATCHING 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    if (!pfid) {
      return NextResponse.json(
        { error: 'COOLSMS_PFID 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    await connectDB();

    // MongoDB에서 활성 수업 데이터 읽기 (제외/보류 아닌 것)
    const allLessons = await StudentLessonState.find({
      status: { $nin: ['제외', '보류'] },
    }).lean();

    const totalCount = await StudentLessonState.countDocuments({});
    console.log(`[Matching] 전체: ${totalCount}, 발송 대상: ${allLessons.length}`);

    // 어제 날짜 계산 (KST 기준)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    const kstYesterday = new Date(kstNow);
    kstYesterday.setDate(kstYesterday.getDate() - 1);
    const yesterdayStr = kstYesterday.toISOString().slice(0, 10);
    console.log(`[Matching] 어제 날짜(KST): ${yesterdayStr}`);

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const results: Array<{
      lvt: string;
      name: string;
      phone: string;
      status: 'sent' | 'skipped' | 'failed';
      reason?: string;
    }> = [];

    for (const lesson of allLessons) {
      const lvt = lesson.lvt?.trim();
      if (!lvt) {
        skippedCount++;
        results.push({
          lvt: '-',
          name: lesson.name || '-',
          phone: lesson.phoneNumber || '-',
          status: 'skipped',
          reason: 'lvt 없음',
        });
        continue;
      }

      // latestAssignDatetime 필터
      const assignDatetime = lesson.latestAssignDatetime?.trim();
      if (!assignDatetime) {
        skippedCount++;
        results.push({
          lvt,
          name: lesson.name || '-',
          phone: lesson.phoneNumber || '-',
          status: 'skipped',
          reason: '선생님 배정 일시 없음',
        });
        continue;
      }

      const assignDate = assignDatetime.slice(0, 10);
      if (assignDate !== yesterdayStr) {
        skippedCount++;
        results.push({
          lvt,
          name: lesson.name || '-',
          phone: lesson.phoneNumber || '-',
          status: 'skipped',
          reason: `배정일이 어제가 아님 (${assignDate})`,
        });
        continue;
      }

      const phone = lesson.phoneNumber?.trim();
      if (!phone) {
        skippedCount++;
        results.push({
          lvt,
          name: lesson.name || '-',
          phone: '-',
          status: 'skipped',
          reason: '전화번호 없음',
        });
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
        results.push({
          lvt,
          name,
          phone,
          status: 'skipped',
          reason: '이미 발송됨',
        });
        continue;
      }

      // dryRun이면 실제 발송하지 않음
      if (dryRun) {
        results.push({
          lvt,
          name,
          phone,
          status: 'sent',
          reason: 'dryRun - 발송 대상',
        });
        sentCount++;
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
            payload: {
              lvt,
              variables: { '#{학생명}': name },
            },
            lastAttemptAt: new Date(),
            maxRetry: 3,
            metadata: {
              subject: lesson.subject || '',
              teacherName: lesson.teacherName || '',
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
            {
              $set: {
                status: 'sent',
                sentAt: new Date(),
                response: { messageId: result.messageId },
              },
            }
          );
          sentCount++;
          results.push({ lvt, name, phone, status: 'sent' });
          console.log(`[Matching] 발송 성공: lvt=${lvt}, name=${name}, phone=${phone}`);
        } else {
          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            {
              $set: {
                status: 'failed',
                errorMessage: result.error,
              },
            }
          );
          failedCount++;
          results.push({ lvt, name, phone, status: 'failed', reason: result.error });
          console.error(`[Matching] 발송 실패: lvt=${lvt}, error=${result.error}`);
        }
      } catch (error: any) {
        await MessageDispatch.updateOne(
          { _id: dispatch._id },
          {
            $set: {
              status: 'failed',
              errorMessage: error.message,
            },
          }
        );
        failedCount++;
        results.push({ lvt, name, phone, status: 'failed', reason: error.message });
        console.error(`[Matching] 발송 에러: lvt=${lvt}`, error);
      }
    }

    return NextResponse.json({
      message: dryRun ? '발송 대상 확인 완료 (dryRun)' : '매칭 알림톡 발송 완료',
      dryRun,
      total: totalCount,
      active: allLessons.length,
      sent: sentCount,
      skipped: skippedCount,
      failed: failedCount,
      results,
    });
  } catch (error: any) {
    console.error('[Matching] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
