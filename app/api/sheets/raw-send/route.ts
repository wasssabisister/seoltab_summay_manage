import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { NotificationLog } from '@/models/NotificationLog';
import { MessageDispatch } from '@/models/MessageDispatch';
import { StudentLessonState } from '@/models/StudentLessonState';
import { readRawSheetData, filterExcludedCustomers, CustomerData } from '@/lib/google-sheets';
import { sendAlimTalk } from '@/lib/sms';
import { callExternalAPI } from '@/lib/external-api';

/**
 * RAW 시트 기반 알림톡/포스트맨 발송 API
 * 
 * Body:
 * - spreadsheetId: 구글 시트 ID
 * - sheetName: 시트 이름 (기본값: 'RAW')
 * - type: 'alimtalk' | 'api_call'
 * - alimtalkConfig?: { templateId, pfid, messageTemplate }
 * - apiConfig?: { url, method, headers, bodyTemplate }
 * - eventType?: 알림 이벤트 유형 (기본값: 'lesson_status_update')
 * - maxRetry?: 최대 재시도 횟수 (기본값: 3)
 * - retryFailed?: 재시도 한도를 넘은 실패 건 재시도 여부 (기본값: false)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      spreadsheetId,
      sheetName = 'RAW',
      type,
      alimtalkConfig,
      apiConfig,
      eventType = 'lesson_status_update',
      maxRetry = 3,
      retryFailed = false,
    } = body;

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'spreadsheetId is required' },
        { status: 400 }
      );
    }

    if (!type || (type !== 'alimtalk' && type !== 'api_call')) {
      return NextResponse.json(
        { error: 'type must be "alimtalk" or "api_call"' },
        { status: 400 }
      );
    }

    await connectDB();

    // RAW 시트에서 데이터 읽기
    let customers: CustomerData[];
    try {
      customers = await readRawSheetData(spreadsheetId, sheetName);
    } catch (error: any) {
      return NextResponse.json(
        { error: `Failed to read sheet: ${error.message}` },
        { status: 500 }
      );
    }

    // MongoDB에 저장/업데이트 (시트 데이터 동기화)
    let savedCount = 0;
    let updatedCount = 0;
    let stateChangedCount = 0;

    for (const customer of customers) {
      if (!customer.lvt) continue; // lvt가 없으면 저장 불가

      try {
        const existing = await StudentLessonState.findOne({
          lvt: customer.lvt,
        }).lean();

        const updateData: any = {
          lvt: customer.lvt,
          studentUserNo: customer.student_user_no || '',
          status: customer.상태?.trim() || '진행중',
          firstActiveTimestamp: customer.first_active_timestamp || '',
          year: customer.year || '',
          name: customer.name || '',
          phoneNumber: customer.phone_number || '',
          tutoringState: customer.tutoring_state || '',
          totalDm: customer.total_dm || '',
          finalDone: customer.final_done || '',
          subject: customer.subject || '',
          teacherUserNo: customer.teacher_user_no || '',
          teacherName: customer.teacher_name || '',
          ffTuda: customer.ff_tuda || '',
          fsSs: customer.fs_ss || '',
          nextScheduleDatetime: customer.next_schedule_datetime || '',
          nextScheduleState: customer.next_schedule_state || '',
          latestDoneUpdate: customer.latest_done_update || '',
          latestDoneSchedule: customer.latest_done_schedule || '',
          latestAssignDatetime: customer.latest_assign_datetime || '',
          lastSyncedAt: new Date(),
          sourceSheetId: spreadsheetId,
          sourceSheetName: sheetName,
        };

        // 상태 변경 감지
        if (existing) {
          const stateChanged = existing.status !== updateData.status;
          if (stateChanged) {
            updateData.previousState = existing.status;
            updateData.stateChangedAt = new Date();
            stateChangedCount++;
          }
          await StudentLessonState.updateOne(
            { lvt: customer.lvt },
            { $set: updateData }
          );
          updatedCount++;
        } else {
          await StudentLessonState.create(updateData);
          savedCount++;
        }
      } catch (error: any) {
        console.error(
          `[RawSend] Failed to save/update lvt ${customer.lvt}:`,
          error
        );
      }
    }

    console.log(
      `[RawSend] Saved: ${savedCount}, Updated: ${updatedCount}, StateChanged: ${stateChangedCount}`
    );

    // 제외 상태 필터링
    const activeCustomers = filterExcludedCustomers(customers);

    if (activeCustomers.length === 0) {
      return NextResponse.json({
        message: 'No active customers found (all excluded)',
        total: customers.length,
        active: 0,
        processed: 0,
        success: 0,
        failed: 0,
        saved: savedCount,
        updated: updatedCount,
        stateChanged: stateChangedCount,
      });
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const results: Array<{
      customer: CustomerData;
      success: boolean;
      skipped?: boolean;
      dispatchId?: string;
      error?: string;
    }> = [];

    const normalizedMaxRetry = Number.isFinite(Number(maxRetry))
      ? Math.max(1, Number(maxRetry))
      : 3;

    const buildIdempotencyKey = (params: {
      channel: 'kakao' | 'api';
      eventType: string;
      studentUserNo?: string;
      lessonKey?: string;
      targetKey?: string;
    }) => {
      return [
        params.channel,
        params.eventType,
        params.studentUserNo || 'unknown-student',
        params.lessonKey || 'unknown-lesson',
        params.targetKey || 'unknown-target',
      ].join('|');
    };

    // 알림톡 발송
    if (type === 'alimtalk') {
      if (!alimtalkConfig) {
        return NextResponse.json(
          { error: 'alimtalkConfig is required for alimtalk type' },
          { status: 400 }
        );
      }

      const { templateId, pfid, messageTemplate, variables } = alimtalkConfig;

      // 환경 변수에서 기본값 가져오기
      const defaultTemplateId = process.env.COOLSMS_TEMPLATE_SUMMURY_MATCHING;
      const defaultPfid = process.env.COOLSMS_PFID;
      
      const finalTemplateId = templateId || defaultTemplateId || '';
      const finalPfid = pfid || defaultPfid || '';

      if (!finalTemplateId || !finalPfid) {
        return NextResponse.json(
          { error: 'templateId and pfid are required (set in config or environment variables)' },
          { status: 400 }
        );
      }

      for (const customer of activeCustomers) {
        try {
          const lessonKey = `${customer.next_schedule_datetime || 'no-next'}|${customer.next_schedule_state || 'no-state'}`;
          const idempotencyKey = buildIdempotencyKey({
            channel: 'kakao',
            eventType,
            studentUserNo: customer.student_user_no,
            lessonKey,
            targetKey: finalTemplateId,
          });

          const existingDispatch = await MessageDispatch.findOne({ idempotencyKey }).lean();
          if (existingDispatch?.status === 'sent') {
            results.push({
              customer,
              success: true,
              skipped: true,
              dispatchId: String(existingDispatch._id),
              error: 'Already sent (idempotency key matched)',
            });
            totalSkipped++;
            continue;
          }

          if (
            existingDispatch?.status === 'failed' &&
            existingDispatch.attemptCount >= existingDispatch.maxRetry &&
            !retryFailed
          ) {
            results.push({
              customer,
              success: false,
              skipped: true,
              dispatchId: String(existingDispatch._id),
              error: `Retry limit exceeded (${existingDispatch.attemptCount}/${existingDispatch.maxRetry})`,
            });
            totalSkipped++;
            continue;
          }

          // 전화번호 검증
          const phone = customer.phone_number?.replace(/[^0-9]/g, '');
          if (!phone || phone.length < 10) {
            const invalidDispatch = await MessageDispatch.findOneAndUpdate(
              { idempotencyKey },
              {
                $set: {
                  idempotencyKey,
                  channel: 'kakao',
                  eventType,
                  lvt: customer.lvt || '',
                  studentUserNo: customer.student_user_no,
                  recipientPhone: customer.phone_number,
                  recipientName: customer.name,
                  templateId: finalTemplateId,
                  status: 'failed',
                  errorMessage: 'Invalid phone number',
                  lastAttemptAt: new Date(),
                },
                $setOnInsert: {
                  maxRetry: normalizedMaxRetry,
                },
                $inc: {
                  attemptCount: 1,
                },
              },
              {
                upsert: true,
                new: true,
              }
            );

            results.push({
              customer,
              success: false,
              dispatchId: String(invalidDispatch._id),
              error: 'Invalid phone number',
            });
            totalFailed++;
            continue;
          }

          // 변수 치환 (템플릿 변수에 고객 데이터 매핑)
          const templateVariables: Record<string, string> = {};
          
          // 환경 변수에서 변수 매핑 가져오기 (COOLSMS_VAR_* 패턴)
          // 예: COOLSMS_VAR_STUDENT_NAME=name -> 템플릿 변수명: student_name, 시트 컬럼명: name
          const envVarMappings: Record<string, string> = {};
          Object.keys(process.env).forEach((key) => {
            if (key.startsWith('COOLSMS_VAR_')) {
              // COOLSMS_VAR_STUDENT_NAME -> student_name
              const varName = key.replace('COOLSMS_VAR_', '').toLowerCase();
              // 환경 변수 값이 시트 컬럼명 (예: "name" 또는 "학생명")
              const columnName = process.env[key] || '';
              if (columnName) {
                envVarMappings[varName] = columnName;
              }
            }
          });

          // 1. 환경 변수 매핑 사용
          Object.keys(envVarMappings).forEach((varName) => {
            const columnName = envVarMappings[varName];
            // CustomerData에서 해당 컬럼명으로 값 가져오기
            // 컬럼명이 한글인 경우도 고려 (예: "학생명" -> customer.학생명)
            // 먼저 정확한 컬럼명으로 시도, 없으면 소문자/언더스코어 변환 시도
            let value = (customer as any)[columnName];
            if (value === undefined || value === '') {
              // 언더스코어 변환 시도 (예: "학생명" -> 찾을 수 없으면 "name" 시도)
              const normalizedColumn = columnName.toLowerCase().replace(/\s+/g, '_');
              value = (customer as any)[normalizedColumn];
            }
            templateVariables[varName] = String(value || '');
          });

          // 2. 요청에서 전달된 variables 사용 (환경 변수보다 우선)
          if (variables) {
            Object.keys(variables).forEach((key) => {
              const value = variables[key];
              // {{변수명}} 형식의 템플릿 변수 치환
              let replacedValue = value;
              replacedValue = replacedValue.replace(/\{\{name\}\}/g, customer.name || '');
              replacedValue = replacedValue.replace(/\{\{phone_number\}\}/g, customer.phone_number || '');
              replacedValue = replacedValue.replace(/\{\{teacher_name\}\}/g, customer.teacher_name || '');
              replacedValue = replacedValue.replace(/\{\{subject\}\}/g, customer.subject || '');
              replacedValue = replacedValue.replace(/\{\{next_schedule_datetime\}\}/g, customer.next_schedule_datetime || '');
              // Backward compatibility
              replacedValue = replacedValue.replace(/\{\{다음_수업_일자\}\}/g, customer.next_schedule_datetime || '');
              replacedValue = replacedValue.replace(/\{\{student_user_no\}\}/g, customer.student_user_no || '');
              templateVariables[key] = replacedValue;
            });
          }

          const dispatch = await MessageDispatch.findOneAndUpdate(
            { idempotencyKey },
            {
              $set: {
                idempotencyKey,
                channel: 'kakao',
                eventType,
                lvt: customer.lvt || '',
                studentUserNo: customer.student_user_no,
                recipientPhone: phone,
                recipientName: customer.name,
                templateId: finalTemplateId,
                status: 'pending',
                errorMessage: undefined,
                payload: {
                  lvt: customer.lvt || '',
                  variables: templateVariables,
                },
                metadata: {
                  lessonKey,
                  pfid: finalPfid,
                  next_schedule_datetime: customer.next_schedule_datetime,
                  next_schedule_state: customer.next_schedule_state,
                },
                lastAttemptAt: new Date(),
              },
              $setOnInsert: {
                maxRetry: normalizedMaxRetry,
              },
              $inc: {
                attemptCount: 1,
              },
            },
            {
              upsert: true,
              new: true,
            }
          );

          const result = await sendAlimTalk({
            to: phone,
            templateId: finalTemplateId,
            pfid: finalPfid,
            variables: templateVariables,
          });

          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            {
              $set: {
                status: result.success ? 'sent' : 'failed',
                errorMessage: result.error,
                response: result,
                sentAt: result.success ? new Date() : undefined,
              },
            }
          );

          // 로그 저장
          await new NotificationLog({
            recipientPhone: phone,
            recipientName: customer.name,
            channel: 'kakao',
            templateKey: finalTemplateId,
            message: messageTemplate || '',
            status: result.success ? 'sent' : 'failed',
            errorMessage: result.error,
            sentAt: result.success ? new Date() : undefined,
            triggerType: 'manual',
            metadata: {
              dispatchId: dispatch._id,
              customerData: customer,
              templateId: finalTemplateId,
              pfid: finalPfid,
            },
          }).save();

          results.push({
            customer,
            success: result.success,
            dispatchId: String(dispatch._id),
            error: result.error,
          });

          if (result.success) {
            totalSuccess++;
          } else {
            totalFailed++;
          }
        } catch (error: any) {
          console.error(`[RawSend] Failed to send alimtalk to ${customer.phone_number}:`, error);
          results.push({
            customer,
            success: false,
            error: error.message || 'Unknown error',
          });
          totalFailed++;
        }
      }
    }

    // 포스트맨 API 호출
    if (type === 'api_call') {
      if (!apiConfig) {
        return NextResponse.json(
          { error: 'apiConfig is required for api_call type' },
          { status: 400 }
        );
      }

      const { url, method = 'POST', headers = {}, bodyTemplate } = apiConfig;

      if (!url) {
        return NextResponse.json(
          { error: 'url is required in apiConfig' },
          { status: 400 }
        );
      }

      for (const customer of activeCustomers) {
        try {
          const lessonKey = `${customer.next_schedule_datetime || 'no-next'}|${customer.next_schedule_state || 'no-state'}`;
          const idempotencyKey = buildIdempotencyKey({
            channel: 'api',
            eventType,
            studentUserNo: customer.student_user_no,
            lessonKey,
            targetKey: url,
          });

          const existingDispatch = await MessageDispatch.findOne({ idempotencyKey }).lean();
          if (existingDispatch?.status === 'sent') {
            results.push({
              customer,
              success: true,
              skipped: true,
              dispatchId: String(existingDispatch._id),
              error: 'Already sent (idempotency key matched)',
            });
            totalSkipped++;
            continue;
          }

          if (
            existingDispatch?.status === 'failed' &&
            existingDispatch.attemptCount >= existingDispatch.maxRetry &&
            !retryFailed
          ) {
            results.push({
              customer,
              success: false,
              skipped: true,
              dispatchId: String(existingDispatch._id),
              error: `Retry limit exceeded (${existingDispatch.attemptCount}/${existingDispatch.maxRetry})`,
            });
            totalSkipped++;
            continue;
          }

          // bodyTemplate에서 변수 치환
          let body: any = {};
          if (bodyTemplate) {
            try {
              // JSON 문자열로 된 템플릿을 파싱
              let bodyStr = typeof bodyTemplate === 'string' 
                ? bodyTemplate 
                : JSON.stringify(bodyTemplate);
              
              // 고객 데이터로 변수 치환
              bodyStr = bodyStr.replace(/\{\{name\}\}/g, customer.name || '');
              bodyStr = bodyStr.replace(/\{\{phone_number\}\}/g, customer.phone_number || '');
              bodyStr = bodyStr.replace(/\{\{teacher_name\}\}/g, customer.teacher_name || '');
              bodyStr = bodyStr.replace(/\{\{subject\}\}/g, customer.subject || '');
              bodyStr = bodyStr.replace(/\{\{student_user_no\}\}/g, customer.student_user_no || '');
              bodyStr = bodyStr.replace(/\{\{teacher_user_no\}\}/g, customer.teacher_user_no || '');
              bodyStr = bodyStr.replace(/\{\{next_schedule_datetime\}\}/g, customer.next_schedule_datetime || '');
              bodyStr = bodyStr.replace(/\{\{ff_tuda\}\}/g, customer.ff_tuda || '');
              // Backward compatibility
              bodyStr = bodyStr.replace(/\{\{다음_수업_일자\}\}/g, customer.next_schedule_datetime || '');
              bodyStr = bodyStr.replace(/\{\{현재_첫_수업_일자\}\}/g, customer.ff_tuda || '');
              
              body = JSON.parse(bodyStr);
            } catch (parseError: any) {
              // 파싱 실패 시 원본 사용
              body = bodyTemplate;
            }
          }

          const dispatch = await MessageDispatch.findOneAndUpdate(
            { idempotencyKey },
            {
              $set: {
                idempotencyKey,
                channel: 'api',
                eventType,
                lvt: customer.lvt || '',
                studentUserNo: customer.student_user_no,
                recipientPhone: customer.phone_number,
                recipientName: customer.name,
                externalApiUrl: url,
                status: 'pending',
                errorMessage: undefined,
                payload: { lvt: customer.lvt || '', ...body },
                metadata: {
                  lessonKey,
                  request: {
                    method: method as 'POST' | 'GET' | 'PUT' | 'DELETE',
                    headers,
                  },
                  next_schedule_datetime: customer.next_schedule_datetime,
                  next_schedule_state: customer.next_schedule_state,
                },
                lastAttemptAt: new Date(),
              },
              $setOnInsert: {
                maxRetry: normalizedMaxRetry,
              },
              $inc: {
                attemptCount: 1,
              },
            },
            {
              upsert: true,
              new: true,
            }
          );

          const result = await callExternalAPI({
            url,
            method: method as 'POST' | 'GET' | 'PUT' | 'DELETE',
            headers,
            body,
          });

          await MessageDispatch.updateOne(
            { _id: dispatch._id },
            {
              $set: {
                status: result.success ? 'sent' : 'failed',
                errorMessage: result.error,
                response: result.data,
                sentAt: result.success ? new Date() : undefined,
              },
            }
          );

          // 로그 저장
          await new NotificationLog({
            recipientPhone: customer.phone_number,
            recipientName: customer.name,
            channel: 'api',
            externalApiUrl: url,
            status: result.success ? 'sent' : 'failed',
            errorMessage: result.error,
            externalApiResponse: result.data,
            sentAt: result.success ? new Date() : undefined,
            triggerType: 'manual',
            payload: body,
            metadata: {
              dispatchId: dispatch._id,
              customerData: customer,
              statusCode: result.statusCode,
            },
          }).save();

          results.push({
            customer,
            success: result.success,
            dispatchId: String(dispatch._id),
            error: result.error,
          });

          if (result.success) {
            totalSuccess++;
          } else {
            totalFailed++;
          }
        } catch (error: any) {
          console.error(`[RawSend] Failed to call API for ${customer.name}:`, error);
          results.push({
            customer,
            success: false,
            error: error.message || 'Unknown error',
          });
          totalFailed++;
        }
      }
    }

    return NextResponse.json({
      message: 'Processed',
      total: customers.length,
      active: activeCustomers.length,
      processed: activeCustomers.length,
      success: totalSuccess,
      failed: totalFailed,
      skipped: totalSkipped,
      saved: savedCount,
      updated: updatedCount,
      stateChanged: stateChangedCount,
      retryConfig: {
        maxRetry: normalizedMaxRetry,
        retryFailed,
      },
      results: results.slice(0, 100), // 최대 100개 결과만 반환
    });
  } catch (error: any) {
    console.error('[RawSend] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
