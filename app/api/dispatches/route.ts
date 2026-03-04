import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    const eventType = searchParams.get('eventType');
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);

    const query: Record<string, any> = {};
    if (status && status !== 'all') query.status = status;
    if (channel && channel !== 'all') query.channel = channel;
    if (eventType && eventType !== 'all') query.eventType = eventType;

    const dispatches = await MessageDispatch.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const countsAgg = await MessageDispatch.aggregate([
      { $match: {} },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts: Record<string, number> = {
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
    for (const row of countsAgg) {
      counts[row._id] = row.count;
    }

    return NextResponse.json({
      data: dispatches,
      count: dispatches.length,
      counts,
    });
  } catch (error: any) {
    console.error('[Dispatches] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
