'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface CustomerData {
  상태: string;
  lvt: string;
  name: string;
  phone_number: string;
  subject: string;
  teacher_name: string;
  next_schedule_datetime: string;
  next_schedule_state: string;
  student_user_no: string;
  [key: string]: string;
}

type SeoltabEnv = 'staging' | 'production';
type TargetUser = 'STUDENT' | 'TUTOR' | 'STUDENT,TUTOR';

interface SendResult {
  lvt: string;
  name: string;
  subject: string;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  response?: any;
}

export default function SeoltabPage() {
  // 환경 설정
  const [env, setEnv] = useState<SeoltabEnv>('staging');
  const [targetUser, setTargetUser] = useState<TargetUser>('STUDENT,TUTOR');

  // 시트 데이터
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // 메시지 설정
  const [messageDetail, setMessageDetail] = useState('');
  const [isSendPush, setIsSendPush] = useState(false);
  const [isSendMessage, setIsSendMessage] = useState(true);
  const [pushTitle, setPushTitle] = useState('');
  const [pushContent, setPushContent] = useState('');

  // 발송
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 단건 테스트
  const [singleLvt, setSingleLvt] = useState('');
  const [singleResult, setSingleResult] = useState<any>(null);

  // 초기 데이터 + 기본 메시지 불러오기
  useEffect(() => {
    loadData();
    loadDefaultMessage();
  }, []);

  // 환경변수의 기본 메시지 템플릿 로드
  const loadDefaultMessage = async () => {
    try {
      const res = await fetch('/api/seoltab/config');
      if (res.ok) {
        const data = await res.json();
        if (data.defaultMessage) {
          // 환경변수의 \n 리터럴을 실제 줄바꿈으로 변환
          setMessageDetail(data.defaultMessage.replace(/\\n/g, '\n'));
        }
        if (data.env === 'staging' || data.env === 'production') {
          setEnv(data.env);
        }
      }
    } catch {
      // 무시 - 기본 메시지 없으면 직접 입력
    }
  };

  // MongoDB에서 수업 데이터 불러오기
  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/students/lessons?excludeFiltered=false');

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '데이터 로드 실패');
      }

      const data = await response.json();
      setCustomers(data.data || []);
      setDataLoaded(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 제외/보류 필터링 & LVT가 있는 것만
  const activeCustomers = customers.filter(
    (c) => !['제외', '보류'].includes(c.상태?.trim()) && c.lvt?.trim()
  );

  // 다음 수업이 오늘인 고객 (참고용 - 나중에 조건 세분화)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCustomers = activeCustomers.filter((c) => {
    const dt = c.next_schedule_datetime?.trim();
    return dt && dt.startsWith(todayStr);
  });

  // 단건 테스트 발송
  const handleSingleSend = async (dryRun: boolean = false) => {
    if (!singleLvt.trim()) {
      setError('LVT를 입력해주세요.');
      return;
    }
    if (!messageDetail.trim()) {
      setError('메시지 내용을 입력해주세요.');
      return;
    }

    setSending(true);
    setSingleResult(null);
    setError(null);

    try {
      const response = await fetch('/api/seoltab/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lvt: singleLvt.trim(),
          env,
          messageDetail,
          targetUser,
          isSendPush,
          isSendMessage,
          pushTitle,
          pushContent,
          dryRun,
          eventType: 'seoltab_test',
        }),
      });

      const data = await response.json();
      setSingleResult(data);

      if (!response.ok && !data.status) {
        setError(data.error || '발송 실패');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  // 대상 목록 일괄 발송
  const handleBulkSend = async (targetList: CustomerData[], dryRun: boolean = false) => {
    if (!messageDetail.trim()) {
      setError('메시지 내용을 입력해주세요.');
      return;
    }

    if (!dryRun) {
      const confirmed = confirm(
        `[${env.toUpperCase()}] 환경에서 ${targetList.length}개 과외방에 메시지를 발송합니다.\n\n진행하시겠습니까?`
      );
      if (!confirmed) return;
    }

    setSending(true);
    setResults([]);
    setError(null);

    const newResults: SendResult[] = [];

    for (const customer of targetList) {
      const lvt = customer.lvt?.trim();
      if (!lvt) continue;

      try {
        const response = await fetch('/api/seoltab/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lvt,
            env,
            messageDetail,
            targetUser,
            isSendPush,
            isSendMessage,
            pushTitle,
            pushContent,
            dryRun,
            eventType: 'seoltab_message',
            studentName: customer.name || '',
            teacherName: customer.teacher_name || '',
            subject: customer.subject || '',
          }),
        });

        const data = await response.json();

        newResults.push({
          lvt,
          name: customer.name || '-',
          subject: customer.subject || '-',
          status: data.status === 'sent' ? 'sent' : data.status === 'skipped' ? 'skipped' : data.dryRun ? 'skipped' : 'failed',
          reason: data.message || data.error,
          response: data,
        });
      } catch (err: any) {
        newResults.push({
          lvt,
          name: customer.name || '-',
          subject: customer.subject || '-',
          status: 'failed',
          reason: err.message,
        });
      }

      // 결과를 실시간 업데이트
      setResults([...newResults]);
    }

    setSending(false);
  };

  const sentCount = results.filter((r) => r.status === 'sent').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        {/* 헤더 */}
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">과외채팅방 메시지 발송</h1>
            <p className="text-sm text-slate-600">
              Seoltab API를 통해 과외채팅방에 메시지를 발송합니다.
            </p>
          </div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            ← 관리 페이지
          </Link>
        </div>

        {/* 환경 경고 */}
        {env === 'production' && (
          <div className="mb-6 rounded-lg border-2 border-red-400 bg-red-50 p-4 text-sm text-red-700">
            <strong>⚠️ PRODUCTION 환경입니다!</strong> 실제 유저에게 메시지가 발송됩니다. 신중하게 진행해주세요.
          </div>
        )}

        {/* 환경 설정 */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">환경 설정</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* 환경 선택 */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                환경 (Environment)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setEnv('staging')}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                    env === 'staging'
                      ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-400'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  🧪 Staging
                </button>
                <button
                  onClick={() => {
                    if (confirm('프로덕션으로 전환하면 실제 유저에게 메시지가 발송됩니다.\n전환하시겠습니까?')) {
                      setEnv('production');
                    }
                  }}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                    env === 'production'
                      ? 'bg-red-100 text-red-800 ring-2 ring-red-400'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  🚀 Production
                </button>
              </div>
            </div>

            {/* 대상 유저 */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                수신 대상 (TARGET_USER)
              </label>
              <select
                value={targetUser}
                onChange={(e) => setTargetUser(e.target.value as TargetUser)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="STUDENT,TUTOR">학생 + 선생님</option>
                <option value="STUDENT">학생만</option>
                <option value="TUTOR">선생님만</option>
              </select>
            </div>

            {/* 발송 옵션 */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">발송 옵션</label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isSendMessage}
                    onChange={(e) => setIsSendMessage(e.target.checked)}
                    className="rounded"
                  />
                  채팅방 메시지 발송
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isSendPush}
                    onChange={(e) => setIsSendPush(e.target.checked)}
                    className="rounded"
                  />
                  푸시 알림 발송
                </label>
              </div>
            </div>
          </div>

          {/* 푸시 설정 (푸시 활성 시만) */}
          {isSendPush && (
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">푸시 제목</label>
                <input
                  type="text"
                  value={pushTitle}
                  onChange={(e) => setPushTitle(e.target.value)}
                  placeholder="푸시 알림 제목"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">푸시 본문</label>
                <input
                  type="text"
                  value={pushContent}
                  onChange={(e) => setPushContent(e.target.value)}
                  placeholder="푸시 알림 본문"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* 메시지 내용 */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">메시지 내용</h2>
          <p className="mb-2 text-xs text-slate-500">
            시트 데이터로 자동 치환되는 변수: {'{{s_name}}'} → name (학생명), {'{{t_name}}'} → teacher_name (선생님명), {'{{subject}}'} → subject (과목)
          </p>
          <textarea
            value={messageDetail}
            onChange={(e) => setMessageDetail(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            placeholder="과외채팅방에 발송할 메시지를 입력하세요..."
          />
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              닫기
            </button>
          </div>
        )}

        {/* ────── 단건 테스트 ────── */}
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">🧪 단건 테스트</h2>
          <p className="mb-3 text-xs text-slate-600">
            특정 LVT 하나를 입력해서 메시지 발송을 테스트합니다.
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={singleLvt}
              onChange={(e) => setSingleLvt(e.target.value)}
              placeholder="LVT 번호 입력 (예: 137541)"
              className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            />
            <button
              onClick={() => handleSingleSend(true)}
              disabled={sending || !singleLvt.trim()}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              dryRun
            </button>
            <button
              onClick={() => handleSingleSend(false)}
              disabled={sending || !singleLvt.trim()}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                env === 'production'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {sending ? '발송 중...' : `발송 (${env})`}
            </button>
          </div>

          {singleResult && (
            <div className="mt-4 rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    singleResult.status === 'sent'
                      ? 'bg-green-100 text-green-800'
                      : singleResult.dryRun
                        ? 'bg-amber-100 text-amber-800'
                        : singleResult.status === 'skipped'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                  }`}
                >
                  {singleResult.status === 'sent'
                    ? '발송 성공'
                    : singleResult.dryRun
                      ? 'dryRun'
                      : singleResult.status === 'skipped'
                        ? '건너뜀'
                        : '실패'}
                </span>
                <span className="text-sm text-slate-600">{singleResult.message}</span>
              </div>
              <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                {JSON.stringify(singleResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* ────── 수업 데이터 기반 일괄 발송 ────── */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">수업 데이터 기반 일괄 발송</h2>
              <p className="text-xs text-slate-500 mt-1">
                {dataLoaded
                  ? `전체: ${activeCustomers.length}개 수업 | 오늘 수업 예정: ${todayCustomers.length}개`
                  : '데이터 로딩 중...'}
              </p>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? '로딩...' : '🔄 새로고침'}
            </button>
          </div>

          {/* 대상 테이블 */}
          {dataLoaded && activeCustomers.length > 0 && (
            <>
              <div className="mb-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">상태</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">LVT</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">이름</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">과목</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">선생님</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">다음 수업 일자</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {activeCustomers.slice(0, 30).map((customer, index) => {
                      const nextDt = customer.next_schedule_datetime?.trim() || '';
                      const isToday = nextDt.startsWith(todayStr);

                      return (
                        <tr key={index} className={isToday ? 'bg-blue-50' : ''}>
                          <td className="px-3 py-2">
                            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                              {customer.상태 || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{customer.lvt}</td>
                          <td className="px-3 py-2 font-medium">{customer.name || '-'}</td>
                          <td className="px-3 py-2">{customer.subject || '-'}</td>
                          <td className="px-3 py-2">{customer.teacher_name || '-'}</td>
                          <td className="px-3 py-2">
                            {nextDt ? (
                              <span className={isToday ? 'font-medium text-blue-700' : ''}>
                                {nextDt}
                                {isToday && ' 📌'}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {activeCustomers.length > 30 && (
                <p className="mb-4 text-xs text-slate-500">
                  총 {activeCustomers.length}개 중 30개만 표시
                </p>
              )}

              {/* 발송 버튼 */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleBulkSend(todayCustomers, true)}
                  disabled={sending || todayCustomers.length === 0}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  오늘 수업 대상 dryRun ({todayCustomers.length}건)
                </button>
                <button
                  onClick={() => handleBulkSend(todayCustomers, false)}
                  disabled={sending || todayCustomers.length === 0}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                    env === 'production'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {sending ? '발송 중...' : `오늘 수업 대상 발송 (${todayCustomers.length}건) [${env}]`}
                </button>
                <button
                  onClick={() => handleBulkSend(activeCustomers, true)}
                  disabled={sending || activeCustomers.length === 0}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  전체 대상 dryRun ({activeCustomers.length}건)
                </button>
              </div>
            </>
          )}

          {dataLoaded && activeCustomers.length === 0 && (
            <div className="py-8 text-center text-slate-500">
              발송 가능한 수업 데이터가 없습니다.
            </div>
          )}
        </div>

        {/* 발송 결과 */}
        {results.length > 0 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">발송 결과</h2>

            <div className="mb-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-green-50 p-3">
                <div className="text-xs text-green-600">성공</div>
                <div className="text-2xl font-bold text-green-700">{sentCount}</div>
              </div>
              <div className="rounded-md bg-yellow-50 p-3">
                <div className="text-xs text-yellow-600">건너뜀</div>
                <div className="text-2xl font-bold text-yellow-700">{skippedCount}</div>
              </div>
              <div className="rounded-md bg-red-50 p-3">
                <div className="text-xs text-red-600">실패</div>
                <div className="text-2xl font-bold text-red-700">{failedCount}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">LVT</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">이름</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">과목</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">상태</th>
                    <th className="px-2 py-1 text-left font-medium text-slate-500">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 font-mono">{r.lvt}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1">{r.subject}</td>
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
                          {r.status === 'sent' ? '성공' : r.status === 'skipped' ? '건너뜀' : '실패'}
                        </span>
                      </td>
                      <td className="px-2 py-1 max-w-xs truncate text-slate-500">{r.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
