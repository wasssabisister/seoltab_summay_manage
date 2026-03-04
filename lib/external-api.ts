/**
 * 외부 API POST 호출 유틸리티
 * 
 * Postman에서 사용하던 API 호출을 자동화
 */

type ExternalAPIOptions = {
  url: string;
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, any> | string;
  timeout?: number;
};

export async function callExternalAPI({
  url,
  method = 'POST',
  headers = {},
  body,
  timeout = 30000,
}: ExternalAPIOptions): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data.error || data.message || `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    return {
      success: true,
      data,
      statusCode: response.status,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout',
      };
    }

    console.error('[External API] Request failed:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error occurred',
    };
  }
}
