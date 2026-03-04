'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';

interface CustomerData {
  상태: string;
  lvt: string;
  first_active_timestamp: string;
  student_user_no: string;
  year: string;
  name: string;
  phone_number: string;
  tutoring_state: string;
  total_dm: string;
  final_done: string;
  subject: string;
  teacher_user_no: string;
  teacher_name: string;
  ff_tuda: string;
  fs_ss: string;
  next_schedule_datetime: string;
  next_schedule_state: string;
  latest_done_update: string;
  latest_done_schedule: string;
  latest_assign_datetime: string;
}

export default function AdminPage() {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    excluded: number;
  } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [sendingMatching, setSendingMatching] = useState(false);
  const [matchingResult, setMatchingResult] = useState<any>(null);

  // LVT별 발송 이력 집계 데이터
  const [dispatchCounts, setDispatchCounts] = useState<
    Record<string, { alimtalkSent: number; seoltabSent: number; totalSent: number; failedCount: number }>
  >({});

  // 페이지네이션
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // 페이지 로드 시 MongoDB에서 데이터 불러오기
  useEffect(() => {
    loadFromDB();
    loadSheetIdFromEnv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 시트 ID를 환경변수에서 가져오기 (동기화용)
  const loadSheetIdFromEnv = async () => {
    try {
      const response = await fetch('/api/sheets/default-id');
      if (response.ok) {
        const data = await response.json();
        if (data.sheetId) {
          setSpreadsheetId(extractSheetId(data.sheetId));
          return;
        }
      }
    } catch {
      // ignore
    }
    const saved = localStorage.getItem('googleSheetId');
    if (saved) setSpreadsheetId(saved);
  };

  // MongoDB에서 수업 데이터 로드 (빠름!)
  const loadFromDB = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/students/lessons?excludeFiltered=false');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'DB 데이터 로드 실패');
      }

      const data = await response.json();
      const loadedCustomers = data.data || [];
      setCustomers(loadedCustomers);
      setStats({
        total: data.total || 0,
        active: data.active || 0,
        excluded: data.excluded || 0,
      });
      setLastSyncedAt(data.lastSyncedAt || null);

      if (loadedCustomers.length === 0) {
        setError('DB에 데이터가 없습니다. 구글 시트를 먼저 동기화해주세요.');
      }

      // 발송 이력도 함께 로드
      loadDispatchCounts();
    } catch (err: any) {
      console.error('[Admin] DB load error:', err);
      setError(err.message || '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  const loadDispatchCounts = async () => {
    try {
      const response = await fetch('/api/lessons/history?limit=500');
      if (response.ok) {
        const data = await response.json();
        const counts: Record<string, { alimtalkSent: number; seoltabSent: number; totalSent: number; failedCount: number }> = {};
        for (const lesson of data.lessons || []) {
          counts[lesson.lvt] = {
            alimtalkSent: lesson.alimtalkSent || 0,
            seoltabSent: lesson.seoltabSent || 0,
            totalSent: lesson.sentCount || 0,
            failedCount: lesson.failedCount || 0,
          };
        }
        setDispatchCounts(counts);
      }
    } catch (err) {
      console.log('발송 이력 집계 로드 실패:', err);
    }
  };

  const extractSheetId = (url: string) => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : url;
  };

  // 구글 시트에서 동기화 → MongoDB 저장 → 테이블 갱신
  const handleSyncSheet = async () => {
    const id = spreadsheetId ? extractSheetId(spreadsheetId) : '';
    if (!id) {
      setError('시트 ID를 입력해주세요');
      return;
    }

    setSyncing(true);
    setError(null);
    setSyncMessage(null);

    try {
      const response = await fetch(
        `/api/sheets/raw-data?spreadsheetId=${encodeURIComponent(id)}&sheetName=RAW&excludeFiltered=false`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '시트 동기화 실패');
      }

      const data = await response.json();
      localStorage.setItem('googleSheetId', id);

      setSyncMessage(
        `✅ 동기화 완료! 총 ${data.total}건 (신규: ${data.saved || 0}, 업데이트: ${data.updated || 0}, 상태변경: ${data.stateChanged || 0})`
      );

      // 동기화 후 DB에서 다시 로드
      await loadFromDB();
    } catch (err: any) {
      setError(err.message || '시트 동기화 중 오류가 발생했습니다');
    } finally {
      setSyncing(false);
    }
  };

  // 제외/보류 아닌 고객만 필터링
  const EXCLUDED_STATUSES = ['제외', '보류'];
  const activeCustomers = customers.filter(
    (customer) => {
      const status = (customer.상태 || '').trim();
      return status !== '' && !EXCLUDED_STATUSES.includes(status);
    }
  );

  // 매칭 알림톡 발송
  const handleSendMatching = async (dryRun: boolean = false) => {
    if (!dryRun && !confirm(`발송 대상에게 매칭 알림톡을 발송합니다.\n이미 발송된 수업은 자동으로 건너뜁니다.\n\n진행하시겠습니까?`)) {
      return;
    }

    setSendingMatching(true);
    setMatchingResult(null);
    setError(null);

    try {
      const response = await fetch('/api/alimtalk/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '발송 실패');
      }

      setMatchingResult(data);

      // 발송 후 이력 갱신
      if (!dryRun) loadDispatchCounts();
    } catch (err: any) {
      setError(err.message || '매칭 알림톡 발송 중 오류가 발생했습니다.');
    } finally {
      setSendingMatching(false);
    }
  };

  // 페이지네이션 계산
  const totalPages = Math.max(1, Math.ceil(customers.length / PAGE_SIZE));
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return customers.slice(start, start + PAGE_SIZE);
  }, [customers, currentPage]);

  // 페이지 변경 시 범위 초과 방지
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [customers.length, currentPage, totalPages]);

  // 엑셀 다운로드
  const handleDownloadExcel = () => {
    const rows = customers.map((c) => ({
      '상태': c.상태 || '',
      'lvt': c.lvt || '',
      'first_active_timestamp': c.first_active_timestamp || '',
      'student_user_no': c.student_user_no || '',
      'year': c.year || '',
      'name': c.name || '',
      'phone_number': c.phone_number || '',
      'tutoring_state': c.tutoring_state || '',
      'total_dm': c.total_dm || '',
      'final_done': c.final_done || '',
      'subject': c.subject || '',
      'teacher_user_no': c.teacher_user_no || '',
      'teacher_name': c.teacher_name || '',
      'ff_tuda': c.ff_tuda || '',
      'fs_ss': c.fs_ss || '',
      'next_schedule_datetime': c.next_schedule_datetime || '',
      'next_schedule_state': c.next_schedule_state || '',
      'latest_done_update': c.latest_done_update || '',
      'latest_done_schedule': c.latest_done_schedule || '',
      'latest_assign_datetime': c.latest_assign_datetime || '',
      '알림톡': dispatchCounts[c.lvt]?.alimtalkSent ? `${dispatchCounts[c.lvt].alimtalkSent}회` : '',
      '채팅방': dispatchCounts[c.lvt]?.seoltabSent ? `${dispatchCounts[c.lvt].seoltabSent}회` : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // 열 너비 자동 조절
    const colWidths = Object.keys(rows[0] || {}).map((key) => {
      const maxLen = Math.max(
        key.length,
        ...rows.map((r) => String((r as any)[key] || '').length)
      );
      return { wch: Math.min(maxLen + 2, 30) };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '전체 고객 데이터');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `summury_고객데이터_${today}.xlsx`);
  };

  const formatSyncTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">관리 페이지</h1>
            <p className="text-sm text-slate-600">운영 고객 대상 관리 및 알림 발송</p>
          </div>
        </div>

        {/* 구글 시트 동기화 */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">구글 시트 동기화</h3>
              <p className="text-xs text-slate-500">
                시트 업데이트 후 동기화 버튼을 눌러주세요. 평상시에는 DB에서 바로 불러옵니다.
              </p>
            </div>
            {lastSyncedAt && (
              <div className="text-xs text-slate-500">
                마지막 동기화: <span className="font-medium">{formatSyncTime(lastSyncedAt)}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSyncSheet();
              }}
              placeholder="구글 시트 URL 또는 ID"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleSyncSheet}
              disabled={syncing || !spreadsheetId.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {syncing ? '동기화 중...' : '🔄 시트 동기화'}
            </button>
          </div>
          {syncMessage && (
            <p className="mt-2 text-xs text-green-700 bg-green-50 rounded-md px-3 py-2">
              {syncMessage}
            </p>
          )}
        </div>

        {/* 오류 메시지 */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 통계 */}
        {stats && (
          <div className="mb-6 grid grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="rounded-md bg-slate-50 p-4">
              <div className="text-sm text-slate-600">전체 고객</div>
              <div className="mt-1 text-2xl font-bold">{stats.total}</div>
            </div>
            <div className="rounded-md bg-green-50 p-4">
              <div className="text-sm text-green-700">발송 대상</div>
              <div className="mt-1 text-2xl font-bold text-green-700">
                {stats.active}
              </div>
            </div>
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-700">제외 대상</div>
              <div className="mt-1 text-2xl font-bold text-red-700">
                {stats.excluded}
              </div>
            </div>
          </div>
        )}

        {/* 운영 대상 테이블 */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              전체 고객 데이터 ({customers.length}명)
              {activeCustomers.length !== customers.length && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  (발송 대상: {activeCustomers.length}명)
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownloadExcel}
                disabled={customers.length === 0}
                className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📥 엑셀 다운로드
              </button>
              <button
                onClick={loadFromDB}
                disabled={loading}
                className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
              >
                {loading ? '로딩...' : '🔄 새로고침'}
              </button>
              <Link
                href="/admin/lesson-history"
                className="text-sm text-blue-600 hover:underline"
              >
                발송 이력 →
              </Link>
            </div>
          </div>

          {customers.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              {loading ? '데이터를 불러오는 중...' : 'DB에 데이터가 없습니다. 시트를 먼저 동기화해주세요.'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">상태</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">lvt</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">이름</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">전화번호</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">과목</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">다음 수업 일자</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">알림톡</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-500">채팅방</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {paginatedCustomers.map((customer, index) => {
                      const status = customer.상태?.trim() || '-';
                      const isExcluded = status === '제외';
                      const isHold = status === '보류';
                      const isInactive = isExcluded || isHold;

                      return (
                        <tr
                          key={`${customer.lvt}-${index}`}
                          className={`hover:bg-slate-50 ${isInactive ? 'bg-red-50 opacity-60' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                isExcluded
                                  ? 'bg-red-100 text-red-800'
                                  : isHold
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-green-100 text-green-800'
                              }`}
                            >
                              {status}
                            </span>
                          </td>
                          <td className="px-3 py-2">{customer.lvt || '-'}</td>
                          <td className="px-3 py-2 font-medium">{customer.name || '-'}</td>
                          <td className="px-3 py-2">{customer.phone_number || '-'}</td>
                          <td className="px-3 py-2">{customer.subject || '-'}</td>
                          <td className="px-3 py-2">{customer.next_schedule_datetime || '-'}</td>
                          <td className="px-3 py-2 text-center">
                            {dispatchCounts[customer.lvt]?.alimtalkSent ? (
                              <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                                {dispatchCounts[customer.lvt].alimtalkSent}회
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {dispatchCounts[customer.lvt]?.seoltabSent ? (
                              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {dispatchCounts[customer.lvt].seoltabSent}회
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    총 {customers.length}건 중 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, customers.length)}건 표시
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ‹
                    </button>

                    {/* 페이지 번호 */}
                    {(() => {
                      const pages: number[] = [];
                      let start = Math.max(1, currentPage - 2);
                      let end = Math.min(totalPages, start + 4);
                      if (end - start < 4) start = Math.max(1, end - 4);
                      for (let i = start; i <= end; i++) pages.push(i);
                      return pages.map((p) => (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`rounded px-2.5 py-1 text-xs font-medium ${
                            p === currentPage
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {p}
                        </button>
                      ));
                    })()}

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ›
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      »
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 매칭 알림톡 발송 */}
        {customers.length > 0 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">매칭 알림톡 발송</h2>
                <p className="text-xs text-slate-500 mt-1">
                  각 수업(lvt)에 최초 1회만 발송됩니다. 이미 발송된 수업은 자동으로 건너뜁니다.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSendMatching(true)}
                  disabled={sendingMatching || activeCustomers.length === 0}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingMatching ? '확인 중...' : '대상 확인 (dryRun)'}
                </button>
                <button
                  onClick={() => handleSendMatching(false)}
                  disabled={sendingMatching || activeCustomers.length === 0}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingMatching ? '발송 중...' : '알림톡 발송'}
                </button>
              </div>
            </div>

            {/* 발송 결과 */}
            {matchingResult && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 grid grid-cols-4 gap-3 text-center">
                  <div className="rounded-md bg-white p-2">
                    <div className="text-xs text-slate-500">발송 대상</div>
                    <div className="text-lg font-bold">{matchingResult.active}</div>
                  </div>
                  <div className="rounded-md bg-green-50 p-2">
                    <div className="text-xs text-green-600">발송 성공</div>
                    <div className="text-lg font-bold text-green-700">{matchingResult.sent}</div>
                  </div>
                  <div className="rounded-md bg-yellow-50 p-2">
                    <div className="text-xs text-yellow-600">건너뜀</div>
                    <div className="text-lg font-bold text-yellow-700">{matchingResult.skipped}</div>
                  </div>
                  <div className="rounded-md bg-red-50 p-2">
                    <div className="text-xs text-red-600">실패</div>
                    <div className="text-lg font-bold text-red-700">{matchingResult.failed}</div>
                  </div>
                </div>

                {matchingResult.dryRun && (
                  <p className="mb-2 text-xs font-medium text-amber-600">
                    dryRun 모드 - 실제 발송되지 않았습니다.
                  </p>
                )}

                {matchingResult.results && matchingResult.results.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium text-slate-500">lvt</th>
                          <th className="px-2 py-1 text-left font-medium text-slate-500">이름</th>
                          <th className="px-2 py-1 text-left font-medium text-slate-500">전화번호</th>
                          <th className="px-2 py-1 text-left font-medium text-slate-500">상태</th>
                          <th className="px-2 py-1 text-left font-medium text-slate-500">사유</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {matchingResult.results.map((r: any, i: number) => (
                          <tr key={i}>
                            <td className="px-2 py-1">{r.lvt}</td>
                            <td className="px-2 py-1">{r.name}</td>
                            <td className="px-2 py-1">{r.phone}</td>
                            <td className="px-2 py-1">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                  r.status === 'sent'
                                    ? 'bg-green-100 text-green-800'
                                    : r.status === 'skipped'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {r.status === 'sent' ? '발송' : r.status === 'skipped' ? '건너뜀' : '실패'}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-slate-500">{r.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 메뉴 카드 */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/admin/dispatches"
            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">📨 발송 상태 관리</h2>
            <p className="text-slate-600 text-sm">
              발송 작업 상태 조회 및 실패 건 수동 재시도
            </p>
          </Link>

          <Link
            href="/admin/seoltab"
            className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">💬 과외채팅방 메시지</h2>
            <p className="text-slate-600 text-sm">
              Seoltab API로 과외채팅방에 메시지 발송 (스테이징/프로덕션)
            </p>
          </Link>

          <Link
            href="/admin/lesson-history"
            className="rounded-lg border border-indigo-200 bg-indigo-50 p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">📋 수업별 발송 이력</h2>
            <p className="text-slate-600 text-sm">
              각 수업(LVT)별 알림톡/채팅방 발송 횟수 및 상세 이력 확인
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
