import { google } from 'googleapis';

/**
 * 구글 시트 연동 유틸리티
 * 
 * 환경 변수 필요:
 * - GOOGLE_SHEETS_CREDENTIALS (서비스 계정 JSON 문자열 또는 경로)
 * - 또는 GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY
 */

export async function getGoogleSheetsClient() {
  const credentials = process.env.GOOGLE_SHEETS_CREDENTIALS;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let auth: any;

  if (credentials) {
    // JSON 문자열로 제공된 경우
    try {
      const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
      auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
    } catch (error) {
      throw new Error('Invalid GOOGLE_SHEETS_CREDENTIALS format');
    }
  } else if (clientEmail && privateKey) {
    // 개별 필드로 제공된 경우
    auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  } else {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SHEETS_CREDENTIALS or GOOGLE_SHEETS_CLIENT_EMAIL/GOOGLE_SHEETS_PRIVATE_KEY');
  }

  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

/**
 * 구글 시트에서 데이터 읽기
 */
export async function readGoogleSheet(
  spreadsheetId: string,
  range: string
): Promise<any[][]> {
  const sheets = await getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values || [];
}

/**
 * 공개 구글 시트에서 CSV로 데이터 읽기 (인증 불필요)
 * - sheetName이 있으면 해당 탭을 직접 조회
 * - sheetName이 없으면 gid(또는 첫 번째 탭) 조회
 */
export async function readPublicGoogleSheetCSV(
  spreadsheetId: string,
  gid?: string,
  sheetName?: string
): Promise<any[][]> {
  const url = sheetName
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    : gid
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google Sheet: ${response.statusText}`);
  }

  const csvText = await response.text();
  const lines = csvText.split('\n').filter(line => line.trim());
  
  return lines.map(line => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  });
}

/**
 * 운영 고객 대상 데이터 타입 정의
 * RAW 시트의 A10~T10 컬럼 구조
 */
export interface CustomerData {
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

/**
 * RAW 시트에서 운영 고객 대상 데이터 읽기
 * A2부터 헤더가 시작되고, A2~T2까지 컬럼이 있음 (A1은 구별용 기록)
 * 공개 CSV 방식을 우선 사용 (인증 불필요)
 */
export async function readRawSheetData(
  spreadsheetId: string,
  sheetName: string = 'RAW'
): Promise<CustomerData[]> {
  // 헤더 매핑 함수 (공통)
  // 컬럼 순서: A=상태, B=lvt, C=first_active_timestamp, D=student_user_no, E=year, F=name, G=phone_number, ...
  const getHeaderMap = (): Record<string, string> => ({
    '상태': '상태',
    'LVT': 'lvt',
    'lvt': 'lvt',
    'first_active_timestamp': 'first_active_timestamp',
    '생성 시점': 'first_active_timestamp',
    'student_user_no': 'student_user_no',
    'year': 'year',
    'name': 'name',
    'phone_number': 'phone_number',
    'tutoring_state': 'tutoring_state',
    'total_dm': 'total_dm',
    'final_done': 'final_done',
    'subject': 'subject',
    'teacher_user_no': 'teacher_user_no',
    'teacher_name': 'teacher_name',
    'ff_tuda': 'ff_tuda',
    'fs_ss': 'fs_ss',
    'next_schedule_datetime': 'next_schedule_datetime',
    'next_schedule_state': 'next_schedule_state',
    'latest_done_update': 'latest_done_update',
    'latest_done_schedule': 'latest_done_schedule',
    'latest_assign_datetime': 'latest_assign_datetime',
    // Backward compatibility for Korean headers.
    '현재 첫 수업 일자': 'ff_tuda',
    '첫 수업 상태': 'fs_ss',
    '다음 수업 일자': 'next_schedule_datetime',
    '다음 수업 상태': 'next_schedule_state',
    '지난 수업 업데이트 시점': 'latest_done_update',
    '지난 수업 일자': 'latest_done_schedule',
    '현재 선생님 배정 시점': 'latest_assign_datetime',
  });

  // 헤더 문자열을 실제 컬럼 키로 해석 (예: "상태 상태", "생성 시점 first_active_timestamp")
  const resolveHeaderKey = (rawHeader: string): string | null => {
    const header = String(rawHeader || '').trim();
    if (!header) return null;

    const headerMap = getHeaderMap();

    // 1) 완전 일치 우선
    if (headerMap[header]) {
      return headerMap[header];
    }

    // 2) 포함 매칭은 긴 키 우선으로 처리해 충돌 방지
    //    예: "teacher_name"이 "name"으로 잘못 매핑되는 문제 방지
    //    예: "첫 수업 상태"가 "상태"로 잘못 매핑되는 문제 방지
    const sortedKeys = Object.keys(headerMap).sort((a, b) => b.length - a.length);
    for (const sourceKey of sortedKeys) {
      if (header.includes(sourceKey)) {
        return headerMap[sourceKey];
      }
    }

    return null;
  };

  const buildHeaderIndexMap = (headers: string[]): Record<string, number> => {
    const map: Record<string, number> = {};
    headers.forEach((header, index) => {
      const resolvedKey = resolveHeaderKey(header);
      if (!resolvedKey) return;

      // 동일 키가 여러 열에서 매핑되어도 첫 번째 열(A->T 순서)을 유지
      // ex) 상태/이름이 뒤쪽 "...상태", "teacher_name"에 덮어써지는 문제 방지
      if (map[resolvedKey] === undefined) {
        map[resolvedKey] = index;
      }
    });
    return map;
  };

  const findBestHeaderRow = (
    data: any[][],
    maxScanRows: number = 30
  ): { headerRowIndex: number; dataStartIndex: number; mappedCount: number } | null => {
    if (!data.length) return null;

    let bestIndex = -1;
    let bestCount = -1;
    const scanLimit = Math.min(maxScanRows, data.length);

    for (let i = 0; i < scanLimit; i++) {
      const row = data[i] || [];
      const headers = row.map((h: string) => String(h || '').trim());
      const mappedCount = Object.keys(buildHeaderIndexMap(headers)).length;
      if (mappedCount > bestCount) {
        bestCount = mappedCount;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) return null;
    return {
      headerRowIndex: bestIndex,
      dataStartIndex: bestIndex + 1,
      mappedCount: bestCount,
    };
  };

  // 데이터 파싱 함수 (공통)
  const parseCustomers = (
    data: any[][],
    headerRowIndex: number,
    dataStartIndex: number
  ): CustomerData[] => {
    if (data.length <= headerRowIndex) {
      console.log('[parseCustomers] Data too short, headerRowIndex:', headerRowIndex, 'data.length:', data.length);
      return [];
    }

    const headers = data[headerRowIndex].map((h: string) => String(h || '').trim());
    console.log('[parseCustomers] Headers found (first 20):', headers.slice(0, 20));
    console.log('[parseCustomers] Expected order: 상태, lvt, first_active_timestamp, student_user_no, year, name, phone_number, ...');
    const headerIndexMap = buildHeaderIndexMap(headers);

    console.log('[parseCustomers] Header mapping:', Object.keys(headerIndexMap).length, 'fields mapped');
    console.log('[parseCustomers] Full header index map:', JSON.stringify(headerIndexMap, null, 2));
    console.log('[parseCustomers] name field index:', headerIndexMap['name'], 'teacher_name field index:', headerIndexMap['teacher_name']);
    
    // 헤더 순서 검증: F열(인덱스 5)이 name인지 확인
    if (headers.length > 5) {
      console.log('[parseCustomers] Column F (index 5) header:', headers[5], 'should be "name"');
    }
    if (headers.length > 12) {
      console.log('[parseCustomers] Column M (index 12) header:', headers[12], 'should be "teacher_name"');
    }

    // 데이터 행 파싱
    const customers: CustomerData[] = [];
    for (let i = dataStartIndex; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const customer: any = {};
      Object.keys(headerIndexMap).forEach((key) => {
        const index = headerIndexMap[key];
        customer[key] = row[index] ? String(row[index]).trim() : '';
      });
      
      // 디버깅: 첫 번째 행의 name과 teacher_name 값 확인
      if (i === dataStartIndex) {
        console.log('[parseCustomers] First row - name:', customer.name, 'teacher_name:', customer.teacher_name);
      }

      // 필수 필드가 있는 경우만 추가 (더 관대하게 체크)
      // phone_number나 student_user_no가 있거나, name이 있으면 추가
      if (customer.phone_number || customer.student_user_no || customer.name) {
        customers.push(customer as CustomerData);
      }
    }

    console.log('[parseCustomers] Parsed customers:', customers.length);
    return customers;
  };

  // 공개 CSV 방식 우선 시도 (인증 불필요)
  try {
    const csvData = await readPublicGoogleSheetCSV(spreadsheetId, undefined, sheetName);
    console.log('[readRawSheetData] CSV total rows:', csvData.length);

    if (csvData.length < 2) {
      console.log('[readRawSheetData] CSV data too short:', csvData.length);
      return [];
    }

    console.log('[readRawSheetData] CSV row 0 (A1):', csvData[0]?.slice(0, 5));
    if (csvData.length > 1) console.log('[readRawSheetData] CSV row 1 (A2):', csvData[1]?.slice(0, 10));
    if (csvData.length > 2) console.log('[readRawSheetData] CSV row 2 (A3):', csvData[2]?.slice(0, 10));

    // 넓은 범위(최대 30행)에서 가장 많은 필드가 매핑되는 행을 헤더로 자동 감지
    const headerInfo = findBestHeaderRow(csvData, 30);
    
    if (!headerInfo || headerInfo.mappedCount < 5) {
      console.log('[readRawSheetData] Could not detect valid header row. Best found:', headerInfo);
      // 마지막 시도: 모든 행 스캔
      const fullScan = findBestHeaderRow(csvData, csvData.length);
      if (fullScan && fullScan.mappedCount >= 5) {
        console.log('[readRawSheetData] Full scan found header at row', fullScan.headerRowIndex, 'mapped:', fullScan.mappedCount);
        return parseCustomers(csvData, fullScan.headerRowIndex, fullScan.dataStartIndex);
      }
      console.log('[readRawSheetData] No valid header row found in entire CSV');
      return [];
    }

    console.log('[readRawSheetData] Header row detected at index', headerInfo.headerRowIndex, '(row', headerInfo.headerRowIndex + 1, '), mapped:', headerInfo.mappedCount, 'fields');
    return parseCustomers(csvData, headerInfo.headerRowIndex, headerInfo.dataStartIndex);
  } catch (csvError: any) {
    console.error('[readRawSheetData] CSV error:', csvError);
    // CSV 방식 실패 시 Google Sheets API 시도
    try {
      const range = `${sheetName}!A1:T`;
      const data = await readGoogleSheet(spreadsheetId, range);
      
      if (data.length === 0) {
        console.log('[readRawSheetData] API data empty');
        return [];
      }

      console.log('[readRawSheetData] API total rows:', data.length);
      console.log('[readRawSheetData] API row 0:', data[0]?.slice(0, 10));
      if (data.length > 1) {
        console.log('[readRawSheetData] API row 1:', data[1]?.slice(0, 10));
      }

      const headerInfo = findBestHeaderRow(data, 5);
      if (!headerInfo || headerInfo.mappedCount < 3) {
        console.log('[readRawSheetData] Could not detect valid API header row');
        return [];
      }

      console.log('[readRawSheetData] API header row detected:', headerInfo.headerRowIndex, 'mapped:', headerInfo.mappedCount);
      return parseCustomers(data, headerInfo.headerRowIndex, headerInfo.dataStartIndex);
    } catch (apiError: any) {
      console.error('[readRawSheetData] API error:', apiError);
      throw new Error(
        `Failed to read RAW sheet. CSV error: ${csvError.message}, API error: ${apiError.message}`
      );
    }
  }
}

/**
 * 제외 상태인 고객을 필터링
 */
const EXCLUDED_STATUSES = ['제외', '보류'];

export function filterExcludedCustomers(customers: CustomerData[]): CustomerData[] {
  return customers.filter(
    (customer) => {
      const status = (customer.상태 || '').trim();
      return status !== '' && !EXCLUDED_STATUSES.includes(status);
    }
  );
}
