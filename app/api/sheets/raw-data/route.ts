import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { readRawSheetData, filterExcludedCustomers, CustomerData } from '@/lib/google-sheets';
import { StudentLessonState } from '@/models/StudentLessonState';

/**
 * RAW 시트 데이터 조회 API
 * 
 * Query Parameters:
 * - spreadsheetId: 구글 시트 ID
 * - sheetName: 시트 이름 (기본값: 'RAW')
 * - excludeFiltered: 제외 상태 필터링 여부 (기본값: false)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const spreadsheetId = searchParams.get('spreadsheetId');
    const sheetName = searchParams.get('sheetName') || 'RAW';
    const excludeFiltered = searchParams.get('excludeFiltered') === 'true';

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'spreadsheetId is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // RAW 시트에서 데이터 읽기
    let customers: CustomerData[];
    try {
      customers = await readRawSheetData(spreadsheetId, sheetName);
      console.log('[RawData] Loaded customers:', customers.length);
      
      // 디버깅: 첫 번째 고객 데이터 확인
      if (customers.length > 0) {
        console.log('[RawData] First customer sample:', {
          상태: customers[0].상태,
          name: customers[0].name,
          phone_number: customers[0].phone_number,
          teacher_name: customers[0].teacher_name,
          subject: customers[0].subject,
          next_schedule_datetime: customers[0].next_schedule_datetime,
        });
      } else {
        console.log('[RawData] WARNING: No customers parsed from sheet!');
      }
    } catch (error: any) {
      console.error('[RawData] Error reading sheet:', error);
      return NextResponse.json(
        { error: `Failed to read sheet: ${error.message}` },
        { status: 500 }
      );
    }

    // MongoDB에 저장/업데이트 (bulkWrite로 한 번에 처리)
    let savedCount = 0;
    let updatedCount = 0;
    let stateChangedCount = 0;

    const validCustomers = customers.filter((c) => !!c.lvt);

    if (validCustomers.length > 0) {
      // 상태 변경 감지를 위해 기존 데이터 한 번에 조회
      const lvtList = validCustomers.map((c) => c.lvt);
      const existingList = await StudentLessonState.find(
        { lvt: { $in: lvtList } },
        { lvt: 1, status: 1 }
      ).lean();
      const existingMap: Record<string, string> = {};
      for (const e of existingList) {
        existingMap[e.lvt] = e.status;
      }

      const now = new Date();
      const bulkOps = validCustomers.map((customer) => {
        const newStatus = customer.상태?.trim() || '진행중';
        const prevStatus = existingMap[customer.lvt];
        const isNew = prevStatus === undefined;
        const stateChanged = !isNew && prevStatus !== newStatus;

        if (isNew) savedCount++;
        else updatedCount++;
        if (stateChanged) stateChangedCount++;

        const setData: any = {
          lvt: customer.lvt,
          studentUserNo: customer.student_user_no || '',
          status: newStatus,
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
          lastSyncedAt: now,
          sourceSheetId: spreadsheetId,
          sourceSheetName: sheetName,
        };

        if (stateChanged) {
          setData.previousState = prevStatus;
          setData.stateChangedAt = now;
        }

        return {
          updateOne: {
            filter: { lvt: customer.lvt },
            update: { $set: setData },
            upsert: true,
          },
        };
      });

      try {
        await StudentLessonState.bulkWrite(bulkOps, { ordered: false });
      } catch (error: any) {
        console.error('[RawData] bulkWrite error:', error);
      }
    }

    console.log(
      `[RawData] Saved: ${savedCount}, Updated: ${updatedCount}, StateChanged: ${stateChangedCount}`
    );

    // 제외 상태 필터링
    const activeCustomers = filterExcludedCustomers(customers);
    const dataToReturn = excludeFiltered ? activeCustomers : customers;

    console.log('[RawData] Returning data:', {
      total: customers.length,
      active: activeCustomers.length,
      excluded: customers.length - activeCustomers.length,
      dataCount: dataToReturn.length,
      saved: savedCount,
      updated: updatedCount,
    });

    return NextResponse.json({
      total: customers.length,
      active: activeCustomers.length,
      excluded: customers.length - activeCustomers.length,
      saved: savedCount,
      updated: updatedCount,
      stateChanged: stateChangedCount,
      data: dataToReturn,
    });
  } catch (error: any) {
    console.error('[RawData] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
