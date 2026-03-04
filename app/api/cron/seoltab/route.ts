import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';
import { StudentLessonState } from '@/models/StudentLessonState';
import { sendSeoltabMessage, SeoltabEnv } from '@/lib/seoltab-api';

/**
 * Seoltab 과외채팅방 메시지 자동 발송 Cron 엔드포인트
 *
 * ── 핵심 로직 ──
 * 1시간마다 실행 → 현재~1시간 15분 이내 수업 조회 (여유 있게)
 * 각 수업에 대해 (lvt, next_schedule_datetime) 조합으로 발송 기록 확인
 * 기록 없으면 발송 → 기록 저장 (sentForSchedule에 일정 기록)
 *
 * ── 멱등성 ──
 * idempotencyKey = seoltab_cron:{lvt}:{todayDate}
 * → 같은 수업은 하루에 1회만 발송
 * → 일정이 19:00→20:00으로 바뀌어도 이미 19:00에 발송했으면 재발송 안 함
 *
 * ── 발송 기록 ──
 * sentForSchedule: "2026-02-12 19:00:00" (어떤 일정에 대해 보냈는지)
 * sentAt: 실제 발송 시각
 *
 * Query Parameters:
 * - secret: CRON_SECRET 환경 변수와 일치해야 함
 *
 * POST Body (선택):
 * - env: 'staging' | 'production' (기본값: SEOLTAB_ENV 환경변수 또는 'staging')
 * - messageTemplate: 메시지 템플릿 (없으면 SEOLTAB_CRON_MESSAGE 환경변수 사용)
 * - eventType: 이벤트 타입 (기본값: 'seoltab_schedule_reminder')
 * - targetUser: 'STUDENT' | 'TUTOR' | 'STUDENT,TUTOR' (기본값: 'STUDENT,TUTOR')
 * - windowMinutes: 수업 조회 시간 윈도우 (기본값: 75분)
 * - isSendPush: boolean (기본값: false)
 * - pushTitle: string
 * - pushContent: string
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

    // Body 파싱
    let env: SeoltabEnv = (process.env.SEOLTAB_ENV as SeoltabEnv) || 'staging';
    let messageTemplate = process.env.SEOLTAB_CRON_MESSAGE || '';
    let eventType = 'seoltab_schedule_reminder';
    let targetUser = 'STUDENT,TUTOR';
    let windowMinutes = 75; // 기본 75분 (1시간 + 15분 여유)
    let isSendPush = false;
    let isSendMessage = true;
    let pushTitle = '';
    let pushContent = '';

    try {
      const body = await request.json();
      if (body.env === 'staging' || body.env === 'production') env = body.env;
      if (body.messageTemplate) messageTemplate = body.messageTemplate;
      if (body.eventType) eventType = body.eventType;
      if (body.targetUser) targetUser = body.targetUser;
      if (body.windowMinutes && Number(body.windowMinutes) > 0) windowMinutes = Number(body.windowMinutes);
      if (body.isSendPush !== undefined) isSendPush = body.isSendPush;
      if (body.isSendMessage !== undefined) isSendMessage = body.isSendMessage;
      if (body.pushTitle) pushTitle = body.pushTitle;
      if (body.pushContent) pushContent = body.pushContent;
    } catch {
      // body가 없어도 OK
    }

    // \n 리터럴을 실제 줄바꿈으로 변환
    if (messageTemplate) {
      messageTemplate = messageTemplate.replace(/\\n/g, '\n');
    }

    if (!messageTemplate) {
      return NextResponse.json(
        { error: '메시지 템플릿이 없습니다. SEOLTAB_CRON_MESSAGE 환경변수를 설정하거나 body에 messageTemplate을 포함해주세요.' },
        { status: 400 }
      );
    }

    await connectDB();

    // 현재 시각 (KST)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    const todayStr = kstNow.toISOString().slice(0, 10);

    // 시간 윈도우: 현재 ~ windowMinutes분 후
    const windowEnd = new Date(kstNow.getTime() + windowMinutes * 60 * 1000);
    const kstNowStr = kstNow.toISOString().slice(0, 19).replace('T', ' ');
    const windowEndStr = windowEnd.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`[Cron/Seoltab] ── 실행 시작 ──`);
    console.log(`[Cron/Seoltab] 현재 시각(KST): ${kstNowStr}`);
    console.log(`[Cron/Seoltab] 조회 윈도우: ${kstNowStr} ~ ${windowEndStr} (${windowMinutes}분)`);
    console.log(`[Cron/Seoltab] 환경: ${env}, 이벤트: ${eventType}`);

    // MongoDB에서 활성 수업 조회 (제외/보류 아닌 것)
    const allLessons = await StudentLessonState.find({
      status: { $nin: ['제외', '보류'] },
    }).lean();

    // ── 시간 윈도우 필터: nextScheduleDatetime이 현재~75분 이내인 수업만 ──
    const targetLessons = allLessons.filter((lesson) => {
      const nextSchedule = lesson.nextScheduleDatetime?.trim();
      if (!nextSchedule) return false;

      // "2026-02-12 19:00:00" 형식 → 비교용 문자열
      // 날짜가 오늘이 아니면 제외
      if (!nextSchedule.startsWith(todayStr)) return false;

      // 시간 비교: nextSchedule이 [kstNow, windowEnd] 범위 안에 있는지
      // nextSchedule은 "YYYY-MM-DD HH:mm:ss" 형식이라 문자열 비교 가능
      const scheduleStr = nextSchedule.slice(0, 19);
      return scheduleStr >= kstNowStr.slice(0, 19) && scheduleStr <= windowEndStr.slice(0, 19);
    });

    console.log(`[Cron/Seoltab] 전체 활성: ${allLessons.length}, 오늘 수업: ${allLessons.filter(l => l.nextScheduleDatetime?.trim()?.startsWith(todayStr)).length}, 윈도우 내 대상: ${targetLessons.length}`);

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const results: Array<{
      lvt: string;
      name: string;
      teacherName: string;
      subject: string;
      nextSchedule: string;
      status: string;
      reason?: string;
    }> = [];

    for (const lesson of targetLessons) {
      const lvt = lesson.lvt?.trim();
      if (!lvt) {
        skippedCount++;
        continue;
      }

      const name = lesson.name?.trim() || '-';
      const teacherName = lesson.teacherName?.trim() || '-';
      const subject = lesson.subject?.trim() || '-';
      const nextSchedule = lesson.nextScheduleDatetime?.trim() || '';

      // ── 멱등성 키: lvt + 오늘 날짜 ──
      // 같은 수업은 하루에 1회만 발송 (일정이 변경되어도 재발송 안 함)
      const idempotencyKey = `seoltab_cron:${lvt}:${todayStr}`;

      // 이미 발송된 기록 확인
      const existing = await MessageDispatch.findOne({
        idempotencyKey,
        status: 'sent',
      }).lean();

      if (existing) {
        const existingSchedule = (existing as any).sentForSchedule || '(기록없음)';
        skippedCount++;
        results.push({
          lvt, name, teacherName, subject, nextSchedule,
          status: 'skipped',
          reason: `이미 발송됨 (일정: ${existingSchedule})`,
        });
        continue;
      }

      // 메시지 변수 치환
      let finalMessage = messageTemplate;
      finalMessage = finalMessage.replace(/\{\{s_name\}\}/g, name);
      finalMessage = finalMessage.replace(/\{\{t_name\}\}/g, teacherName);
      finalMessage = finalMessage.replace(/\{\{subject\}\}/g, subject);
      finalMessage = finalMessage.replace(/\{\{next_schedule\}\}/g, nextSchedule);
      finalMessage = finalMessage.replace(/\{\{lvt\}\}/g, lvt);

      // 푸시 내용도 치환
      let finalPushTitle = pushTitle;
      let finalPushContent = pushContent;
      if (finalPushTitle) {
        finalPushTitle = finalPushTitle.replace(/\{\{s_name\}\}/g, name).replace(/\{\{t_name\}\}/g, teacherName);
      }
      if (finalPushContent) {
        finalPushContent = finalPushContent.replace(/\{\{s_name\}\}/g, name).replace(/\{\{t_name\}\}/g, teacherName);
      }

      // ── MessageDispatch 생성 (pending) + sentForSchedule 기록 ──
      const dispatch = await MessageDispatch.findOneAndUpdate(
        { idempotencyKey },
        {
          $set: {
            channel: 'api',
            status: 'pending',
            eventType,
            lvt,
            sentForSchedule: nextSchedule,  // ← 핵심: 어떤 일정에 대해 발송하는지
            externalApiUrl: `seoltab_${env}`,
            recipientName: name,
            payload: {
              lvt,
              env,
              messageDetail: finalMessage,
              originalTemplate: messageTemplate,
              variables: { s_name: name, t_name: teacherName, subject },
              targetUser,
              isSendPush,
              isSendMessage,
            },
            lastAttemptAt: new Date(),
            maxRetry: 3,
            metadata: {
              subject,
              teacherName,
              scheduleDate: todayStr,
              sentForSchedule: nextSchedule,
              seoltabEnv: env,
              triggerType: 'cron',
              windowMinutes,
            },
          },
          $inc: { attemptCount: 1 },
        },
        { upsert: true, new: true }
      );

      // Seoltab API 호출
      try {
        const result = await sendSeoltabMessage({
          lectureVtNo: lvt,
          env,
          isSendPush,
          isSendMessage,
          pushTitle: finalPushTitle,
          pushContent: finalPushContent,
          messageDetail: finalMessage,
          targetUser: targetUser as any,
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
          sentCount++;
          results.push({ lvt, name, teacherName, subject, nextSchedule, status: 'sent' });
          console.log(`[Cron/Seoltab] ✅ 발송 성공: lvt=${lvt}, name=${name}, teacher=${teacherName}, schedule=${nextSchedule}`);
        } else {
          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            {
              $set: {
                status: 'failed',
                errorMessage: result.error || `HTTP ${result.statusCode}`,
                response: { statusCode: result.statusCode, data: result.data },
              },
            }
          );
          failedCount++;
          results.push({
            lvt, name, teacherName, subject, nextSchedule,
            status: 'failed', reason: result.error || `HTTP ${result.statusCode}`,
          });
          console.error(`[Cron/Seoltab] ❌ 발송 실패: lvt=${lvt}, error=${result.error}`);
        }
      } catch (error: any) {
        await MessageDispatch.updateOne(
          { _id: dispatch._id },
          { $set: { status: 'failed', errorMessage: error.message } }
        );
        failedCount++;
        results.push({
          lvt, name, teacherName, subject, nextSchedule,
          status: 'failed', reason: error.message,
        });
        console.error(`[Cron/Seoltab] ❌ 발송 에러: lvt=${lvt}, error=${error.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Cron/Seoltab] ── 완료 ── sent=${sentCount}, skipped=${skippedCount}, failed=${failedCount}, elapsed=${elapsed}ms`);

    return NextResponse.json({
      message: 'Seoltab 자동 발송 완료',
      date: todayStr,
      window: { from: kstNowStr, to: windowEndStr, minutes: windowMinutes },
      env,
      eventType,
      total: allLessons.length,
      todayLessons: allLessons.filter(l => l.nextScheduleDatetime?.trim()?.startsWith(todayStr)).length,
      windowTarget: targetLessons.length,
      sent: sentCount,
      skipped: skippedCount,
      failed: failedCount,
      elapsed: `${elapsed}ms`,
      results,
    });
  } catch (error: any) {
    console.error('[Cron/Seoltab] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
