import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongoose';
import { MessageDispatch } from '@/models/MessageDispatch';
import { sendAlimTalk } from '@/lib/sms';
import { callExternalAPI } from '@/lib/external-api';
import { NotificationLog } from '@/models/NotificationLog';

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const dispatchId = body?.dispatchId as string;
    const force = Boolean(body?.force);

    if (!dispatchId) {
      return NextResponse.json({ error: 'dispatchId is required' }, { status: 400 });
    }

    const dispatch = await MessageDispatch.findById(dispatchId);
    if (!dispatch) {
      return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });
    }

    if (dispatch.status === 'sent') {
      return NextResponse.json({ error: 'Already sent' }, { status: 400 });
    }

    if (dispatch.attemptCount >= dispatch.maxRetry && !force) {
      return NextResponse.json(
        {
          error: `Retry limit exceeded (${dispatch.attemptCount}/${dispatch.maxRetry})`,
        },
        { status: 400 }
      );
    }

    dispatch.status = 'pending';
    dispatch.lastAttemptAt = new Date();
    dispatch.attemptCount += 1;
    await dispatch.save();

    if (dispatch.channel === 'kakao') {
      const to = (dispatch.recipientPhone || '').replace(/[^0-9]/g, '');
      const templateId = dispatch.templateId || '';
      const pfid = (dispatch.metadata as any)?.pfid || process.env.COOLSMS_PFID || '';
      const variables = (dispatch.payload as any)?.variables || {};

      if (!to || !templateId || !pfid) {
        dispatch.status = 'failed';
        dispatch.errorMessage = 'Missing required kakao retry data (to/templateId/pfid)';
        await dispatch.save();
        return NextResponse.json({ error: dispatch.errorMessage }, { status: 400 });
      }

      const result = await sendAlimTalk({
        to,
        templateId,
        pfid,
        variables,
      });

      dispatch.status = result.success ? 'sent' : 'failed';
      dispatch.errorMessage = result.error;
      dispatch.response = result;
      dispatch.sentAt = result.success ? new Date() : undefined;
      await dispatch.save();

      await new NotificationLog({
        recipientPhone: dispatch.recipientPhone,
        recipientName: dispatch.recipientName,
        channel: 'kakao',
        templateKey: dispatch.templateId,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error,
        sentAt: result.success ? new Date() : undefined,
        triggerType: 'manual',
        metadata: {
          dispatchId: dispatch._id,
          isRetry: true,
        },
      }).save();

      return NextResponse.json({
        success: result.success,
        dispatchId: dispatch._id,
        status: dispatch.status,
        error: result.error,
      });
    }

    if (dispatch.channel === 'api') {
      const url = dispatch.externalApiUrl || '';
      const reqMeta = ((dispatch.metadata as any)?.request || {}) as {
        method?: 'POST' | 'GET' | 'PUT' | 'DELETE';
        headers?: Record<string, string>;
      };
      const method = reqMeta.method || 'POST';
      const headers = reqMeta.headers || {};
      const bodyPayload =
        dispatch.payload && (dispatch.payload as any).body !== undefined
          ? (dispatch.payload as any).body
          : dispatch.payload;

      if (!url) {
        dispatch.status = 'failed';
        dispatch.errorMessage = 'Missing externalApiUrl';
        await dispatch.save();
        return NextResponse.json({ error: dispatch.errorMessage }, { status: 400 });
      }

      const result = await callExternalAPI({
        url,
        method,
        headers,
        body: bodyPayload,
      });

      dispatch.status = result.success ? 'sent' : 'failed';
      dispatch.errorMessage = result.error;
      dispatch.response = result.data;
      dispatch.sentAt = result.success ? new Date() : undefined;
      await dispatch.save();

      await new NotificationLog({
        recipientPhone: dispatch.recipientPhone,
        recipientName: dispatch.recipientName,
        channel: 'api',
        externalApiUrl: url,
        status: result.success ? 'sent' : 'failed',
        errorMessage: result.error,
        externalApiResponse: result.data,
        sentAt: result.success ? new Date() : undefined,
        triggerType: 'manual',
        payload: typeof bodyPayload === 'object' ? bodyPayload : { raw: bodyPayload },
        metadata: {
          dispatchId: dispatch._id,
          isRetry: true,
          statusCode: result.statusCode,
        },
      }).save();

      return NextResponse.json({
        success: result.success,
        dispatchId: dispatch._id,
        status: dispatch.status,
        error: result.error,
      });
    }

    return NextResponse.json({ error: 'Unsupported dispatch channel' }, { status: 400 });
  } catch (error: any) {
    console.error('[Dispatches] retry error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
