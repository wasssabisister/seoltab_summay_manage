import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { StudentLessonState } from '@/models/StudentLessonState';

/**
 * 저장된 학생 수업 상태 조회 API
 * 
 * Query Parameters:
 * - limit: 조회할 최대 개수 (기본값: 10)
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const students = await StudentLessonState.find()
      .sort({ lastSyncedAt: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json({
      count: students.length,
      total: await StudentLessonState.countDocuments(),
      data: students,
    });
  } catch (error: any) {
    console.error('[Students] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
