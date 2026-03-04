'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type DispatchStatus = 'pending' | 'sent' | 'failed' | 'skipped';
type DispatchChannel = 'kakao' | 'api';

type DispatchItem = {
  _id: string;
  idempotencyKey: string;
  channel: DispatchChannel;
  status: DispatchStatus;
  eventType: string;
  studentUserNo?: string;
  recipientPhone?: string;
  recipientName?: string;
  templateId?: string;
  externalApiUrl?: string;
  attemptCount: number;
  maxRetry: number;
  errorMessage?: string;
  sentAt?: string;
  createdAt: string;
};

type Counts = {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
};

const DEFAULT_COUNTS: Counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };

export default function DispatchesPage() {
  const [items, setItems] = useState<DispatchItem[]>([]);
  const [counts, setCounts] = useState<Counts>(DEFAULT_COUNTS);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | DispatchStatus>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | DispatchChannel>('all');
  const [limit, setLimit] = useState(100);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    params.set('limit', String(limit));
    return params.toString();
  }, [statusFilter, channelFilter, limit]);

  const loadDispatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/dispatches?${queryString}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '조회 실패');
      }
      setItems(data.data || []);
      setCounts(data.counts || DEFAULT_COUNTS);
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다');
      setItems([]);
      setCounts(DEFAULT_COUNTS);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    loadDispatches();
  }, [loadDispatches]);

  const handleRetry = async (dispatchId: string) => {
    if (!confirm('이 실패 건을 다시 발송할까요?')) return;
    setRetryingId(dispatchId);
    setError(null);
    try {
      const response = await fetch('/api/dispatches/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatchId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '재시도 실패');
      }
      await loadDispatches();
    } catch (err: any) {
      setError(err.message || '재시도 중 오류가 발생했습니다');
    } finally {
      setRetryingId(null);
    }
  };

  const statusClass = (status: DispatchStatus) => {
    if (status === 'sent') return 'bg-green-100 text-green-700';
    if (status === 'failed') return 'bg-red-100 text-red-700';
    if (status === 'pending') return 'bg-yellow-100 text-yellow-700';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">MessageDispatch 관리</h1>
            <p className="mt-2 text-sm text-slate-600">
              발송 작업 상태 조회 및 실패 건 수동 재시도
            </p>
          </div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            ← 뒤로가기
          </Link>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-md bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">pending</div>
            <div className="text-xl font-semibold text-yellow-700">{counts.pending}</div>
          </div>
          <div className="rounded-md bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">sent</div>
            <div className="text-xl font-semibold text-green-700">{counts.sent}</div>
          </div>
          <div className="rounded-md bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">failed</div>
            <div className="text-xl font-semibold text-red-700">{counts.failed}</div>
          </div>
          <div className="rounded-md bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">skipped</div>
            <div className="text-xl font-semibold text-slate-700">{counts.skipped}</div>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">상태: 전체</option>
            <option value="pending">pending</option>
            <option value="sent">sent</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
          </select>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as any)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">채널: 전체</option>
            <option value="kakao">kakao</option>
            <option value="api">api</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value={50}>50개</option>
            <option value={100}>100개</option>
            <option value={300}>300개</option>
            <option value={500}>500개</option>
          </select>
          <button
            onClick={loadDispatches}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            새로고침
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-lg bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-3 py-2 font-semibold">상태</th>
                  <th className="px-3 py-2 font-semibold">채널</th>
                  <th className="px-3 py-2 font-semibold">이벤트</th>
                  <th className="px-3 py-2 font-semibold">수신자</th>
                  <th className="px-3 py-2 font-semibold">시도/최대</th>
                  <th className="px-3 py-2 font-semibold">대상</th>
                  <th className="px-3 py-2 font-semibold">에러</th>
                  <th className="px-3 py-2 font-semibold">동작</th>
                </tr>
              </thead>
              <tbody>
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                      조회된 dispatch가 없습니다.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{item.channel}</td>
                    <td className="px-3 py-2">{item.eventType}</td>
                    <td className="px-3 py-2">
                      <div>{item.recipientName || '-'}</div>
                      <div className="text-[10px] text-slate-500">
                        {item.recipientPhone || item.studentUserNo || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {item.attemptCount}/{item.maxRetry}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-xs truncate text-[10px] text-slate-600">
                        {item.channel === 'kakao' ? item.templateId || '-' : item.externalApiUrl || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-xs truncate text-[10px] text-red-600">
                        {item.errorMessage || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {item.status === 'failed' ? (
                        <button
                          onClick={() => handleRetry(item._id)}
                          disabled={retryingId === item._id}
                          className="rounded bg-orange-500 px-2 py-1 text-[11px] text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          {retryingId === item._id ? '재시도중...' : '재시도'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
