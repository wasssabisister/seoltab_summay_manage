import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';

/**
 * LVT별 발송 이력 조회 API
 *
 * GET /api/lessons/history
 *   - 전체 LVT별 발송 횟수 집계
 *   - Query: ?lvt=137541  (특정 LVT의 상세 이력)
 *   - Query: ?limit=100   (최대 조회 수)
 *
 * GET /api/lessons/history?lvt=137541
 *   - 특정 LVT의 모든 발송 기록 상세
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const lvt = searchParams.get('lvt');
    const limit = parseInt(searchParams.get('limit') || '200', 10);

    // 특정 LVT의 상세 이력
    if (lvt) {
      const dispatches = await MessageDispatch.find({
        $or: [
          { lvt },
          { 'payload.lvt': lvt },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      // 이벤트 타입별 집계
      const summary: Record<string, { total: number; sent: number; failed: number; pending: number }> = {};
      for (const d of dispatches) {
        const et = d.eventType || 'unknown';
        if (!summary[et]) summary[et] = { total: 0, sent: 0, failed: 0, pending: 0 };
        summary[et].total++;
        if (d.status === 'sent') summary[et].sent++;
        else if (d.status === 'failed') summary[et].failed++;
        else if (d.status === 'pending') summary[et].pending++;
      }

      return NextResponse.json({
        lvt,
        totalDispatches: dispatches.length,
        summary,
        dispatches: dispatches.map((d) => ({
          id: d._id,
          channel: d.channel,
          eventType: d.eventType,
          status: d.status,
          recipientName: d.recipientName,
          recipientPhone: d.recipientPhone,
          attemptCount: d.attemptCount,
          sentAt: d.sentAt,
          errorMessage: d.errorMessage,
          createdAt: d.createdAt,
          metadata: d.metadata,
        })),
      });
    }

    // 전체 LVT별 집계 (MongoDB aggregation)
    const pipeline = [
      // lvt 필드가 있는 것만 (또는 payload.lvt)
      {
        $addFields: {
          resolvedLvt: { $ifNull: ['$lvt', '$payload.lvt'] },
        },
      },
      {
        $match: {
          resolvedLvt: { $ne: null, $exists: true },
        },
      },
      {
        $group: {
          _id: '$resolvedLvt',
          totalCount: { $sum: 1 },
          sentCount: {
            $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          // 채널별 집계
          alimtalkSent: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$channel', 'kakao'] }, { $eq: ['$status', 'sent'] }] },
                1,
                0,
              ],
            },
          },
          seoltabSent: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$channel', 'api'] }, { $eq: ['$status', 'sent'] }] },
                1,
                0,
              ],
            },
          },
          // 이벤트 타입 목록
          eventTypes: { $addToSet: '$eventType' },
          // 마지막 발송 시각
          lastSentAt: {
            $max: {
              $cond: [{ $eq: ['$status', 'sent'] }, '$sentAt', null],
            },
          },
          lastAttemptAt: { $max: '$lastAttemptAt' },
          // 수신자 정보 (첫 번째 것 사용)
          recipientName: { $first: '$recipientName' },
          metadata: { $first: '$metadata' },
        },
      },
      { $sort: { lastAttemptAt: -1 } },
      { $limit: limit },
    ];

    const results = await MessageDispatch.aggregate(pipeline);

    return NextResponse.json({
      total: results.length,
      lessons: results.map((r) => ({
        lvt: r._id,
        name: r.recipientName || '-',
        subject: r.metadata?.subject || '-',
        teacherName: r.metadata?.teacherName || '-',
        totalCount: r.totalCount,
        sentCount: r.sentCount,
        failedCount: r.failedCount,
        pendingCount: r.pendingCount,
        alimtalkSent: r.alimtalkSent,
        seoltabSent: r.seoltabSent,
        eventTypes: r.eventTypes,
        lastSentAt: r.lastSentAt,
        lastAttemptAt: r.lastAttemptAt,
      })),
    });
  } catch (error: any) {
    console.error('[Lessons/History] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
