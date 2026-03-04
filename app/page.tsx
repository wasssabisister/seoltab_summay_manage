import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <h1 className="text-3xl font-bold mb-8">자동 알림 관리 시스템</h1>
        
        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/admin"
            className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">관리 페이지</h2>
            <p className="text-slate-600">
              알림톡 발송 관리, 외부 API 호출 관리, 발송 이력 확인
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
