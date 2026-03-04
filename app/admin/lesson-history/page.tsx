'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface LessonSummary {
  lvt: string;
  name: string;
  subject: string;
  teacherName: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  alimtalkSent: number;
  seoltabSent: number;
  eventTypes: string[];
  lastSentAt: string | null;
  lastAttemptAt: string | null;
}

interface DispatchDetail {
  id: string;
  channel: string;
  eventType: string;
  status: string;
  recipientName: string;
  recipientPhone: string;
  attemptCount: number;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  metadata: any;
}

interface LvtDetailData {
  lvt: string;
  totalDispatches: number;
  summary: Record<string, { total: number; sent: number; failed: number; pending: number }>;
  dispatches: DispatchDetail[];
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  matching_first: '매칭 알림톡',
  seoltab_message: '채팅방 메시지 (수동)',
  seoltab_test: '채팅방 메시지 (테스트)',
  seoltab_schedule_reminder: '채팅방 메시지 (자동)',
};

const CHANNEL_LABELS: Record<string, string> = {
  kakao: '알림톡',
  api: 'Seoltab',
};

export default function LessonHistoryPage() {
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 상세 보기
  const [selectedLvt, setSelectedLvt] = useState<string | null>(null);
  const [detail, setDetail] = useState<LvtDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 검색
  const [searchLvt, setSearchLvt] = useState('');

  useEffect(() => {
    loadLessons();
  }, []);

  const loadLessons = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/lessons/history?limit=300');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '데이터 로드 실패');
      }
      const data = await response.json();
      setLessons(data.lessons || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (lvt: string) => {
    setSelectedLvt(lvt);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/lessons/history?lvt=${encodeURIComponent(lvt)}`);
      if (!response.ok) throw new Error('상세 조회 실패');
      const data = await response.json();
      setDetail(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredLessons = searchLvt.trim()
    ? lessons.filter(
        (l) =>
          l.lvt.includes(searchLvt.trim()) ||
          l.name.includes(searchLvt.trim()) ||
          l.subject.includes(searchLvt.trim())
      )
    : lessons;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        {/* 헤더 */}
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">수업별 발송 이력</h1>
            <p className="text-sm text-slate-600">
              각 수업(LVT)별로 알림톡 및 채팅방 메시지가 몇 번 발송되었는지 확인합니다.
            </p>
          </div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            ← 관리 페이지
          </Link>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">닫기</button>
          </div>
        )}

        {/* 검색 */}
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={searchLvt}
            onChange={(e) => setSearchLvt(e.target.value)}
            placeholder="LVT, 이름, 과목으로 검색..."
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={loadLessons}
            disabled={loading}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            {loading ? '로딩...' : '🔄 새로고침'}
          </button>
        </div>

        {/* 전체 요약 */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">
            전체 수업 발송 현황 ({filteredLessons.length}개 수업)
          </h2>

          {loading ? (
            <div className="py-8 text-center text-slate-500">로딩 중...</div>
          ) : filteredLessons.length === 0 ? (
            <div className="py-8 text-center text-slate-500">발송 이력이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">LVT</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">이름</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">과목</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">선생님</th>
                    <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">
                      알림톡
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">
                      채팅방
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">
                      전체
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">
                      실패
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                      마지막 발송
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredLessons.map((lesson) => (
                    <tr
                      key={lesson.lvt}
                      className={`hover:bg-slate-50 ${
                        selectedLvt === lesson.lvt ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{lesson.lvt}</td>
                      <td className="px-3 py-2 font-medium">{lesson.name}</td>
                      <td className="px-3 py-2">{lesson.subject}</td>
                      <td className="px-3 py-2">{lesson.teacherName}</td>
                      <td className="px-3 py-2 text-center">
                        {lesson.alimtalkSent > 0 ? (
                          <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                            {lesson.alimtalkSent}회
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {lesson.seoltabSent > 0 ? (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {lesson.seoltabSent}회
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {lesson.sentCount}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {lesson.failedCount > 0 ? (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            {lesson.failedCount}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatDate(lesson.lastSentAt)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => loadDetail(lesson.lvt)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* LVT 상세 이력 */}
        {selectedLvt && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                📋 LVT {selectedLvt} 상세 발송 이력
              </h2>
              <button
                onClick={() => { setSelectedLvt(null); setDetail(null); }}
                className="text-sm text-slate-500 hover:underline"
              >
                닫기 ✕
              </button>
            </div>

            {detailLoading ? (
              <div className="py-6 text-center text-slate-500">로딩 중...</div>
            ) : detail ? (
              <>
                {/* 이벤트 타입별 요약 */}
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Object.entries(detail.summary).map(([eventType, counts]) => (
                    <div
                      key={eventType}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="mb-1 text-xs font-medium text-slate-600">
                        {EVENT_TYPE_LABELS[eventType] || eventType}
                      </div>
                      <div className="flex gap-2 text-sm">
                        <span className="text-green-700 font-bold">{counts.sent}건 성공</span>
                        {counts.failed > 0 && (
                          <span className="text-red-600">{counts.failed}건 실패</span>
                        )}
                        {counts.pending > 0 && (
                          <span className="text-yellow-600">{counts.pending}건 대기</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 상세 테이블 */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">채널</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">이벤트</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">상태</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">수신자</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">시도</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">발송 시각</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">생성 시각</th>
                        <th className="px-2 py-1 text-left font-medium text-slate-500">에러</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.dispatches.map((d) => (
                        <tr key={d.id}>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                d.channel === 'kakao'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {CHANNEL_LABELS[d.channel] || d.channel}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {EVENT_TYPE_LABELS[d.eventType] || d.eventType}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                d.status === 'sent'
                                  ? 'bg-green-100 text-green-800'
                                  : d.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : d.status === 'pending'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {d.status === 'sent' ? '성공' : d.status === 'failed' ? '실패' : d.status === 'pending' ? '대기' : d.status}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {d.recipientName || '-'}
                            {d.recipientPhone && (
                              <span className="ml-1 text-slate-400">({d.recipientPhone})</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">{d.attemptCount}회</td>
                          <td className="px-2 py-1">{formatDate(d.sentAt)}</td>
                          <td className="px-2 py-1">{formatDate(d.createdAt)}</td>
                          <td className="px-2 py-1 max-w-xs truncate text-red-500">
                            {d.errorMessage || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
