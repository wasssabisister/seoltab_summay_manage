import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { StudentLessonState } from '@/models/StudentLessonState';

/**
 * MongoDB에서 수업 데이터 조회 API
 * 
 * 시트를 다시 불러오지 않고, 이미 동기화된 MongoDB 데이터를 직접 조회합니다.
 *
 * Query Parameters:
 * - excludeFiltered: 'true' → 제외 상태 제외 (기본값: false)
 * - status: 특정 상태만 조회 (예: '진행중')
 * - limit: 최대 조회 수 (기본값: 1000)
 * - sort: 정렬 기준 (기본값: 'lastSyncedAt')
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const excludeFiltered = searchParams.get('excludeFiltered') === 'true';
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '1000', 10);

    // 쿼리 조건
    const query: Record<string, any> = {};
    if (excludeFiltered) {
      query.status = { $nin: ['제외', '보류'] };
    }
    if (status) {
      query.status = status;
    }

    const lessons = await StudentLessonState.find(query)
      .sort({ lastSyncedAt: -1 })
      .limit(limit)
      .lean();

    // 통계
    const totalCount = await StudentLessonState.countDocuments({});
    const activeCount = await StudentLessonState.countDocuments({ status: { $nin: ['제외', '보류'] } });
    const excludedCount = totalCount - activeCount;

    // 시트 형태의 CustomerData 포맷으로 변환 (기존 프론트엔드 호환)
    const data = lessons.map((lesson) => ({
      상태: lesson.status || '',
      lvt: lesson.lvt || '',
      first_active_timestamp: lesson.firstActiveTimestamp || '',
      student_user_no: lesson.studentUserNo || '',
      year: lesson.year || '',
      name: lesson.name || '',
      phone_number: lesson.phoneNumber || '',
      tutoring_state: lesson.tutoringState || '',
      total_dm: lesson.totalDm || '',
      final_done: lesson.finalDone || '',
      subject: lesson.subject || '',
      teacher_user_no: lesson.teacherUserNo || '',
      teacher_name: lesson.teacherName || '',
      ff_tuda: lesson.ffTuda || '',
      fs_ss: lesson.fsSs || '',
      next_schedule_datetime: lesson.nextScheduleDatetime || '',
      next_schedule_state: lesson.nextScheduleState || '',
      latest_done_update: lesson.latestDoneUpdate || '',
      latest_done_schedule: lesson.latestDoneSchedule || '',
      latest_assign_datetime: lesson.latestAssignDatetime || '',
    }));

    // 마지막 동기화 시점
    const latestSync = lessons.length > 0 ? lessons[0].lastSyncedAt : null;

    return NextResponse.json({
      total: totalCount,
      active: activeCount,
      excluded: excludedCount,
      lastSyncedAt: latestSync,
      data,
    });
  } catch (error: any) {
    console.error('[Students/Lessons] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
