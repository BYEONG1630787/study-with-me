// 빌드할 때 채워 넣는 값.

declare const __APP_URL__: string | undefined;

/** 이 앱이 게시된 주소. 초대 링크를 만들 때 쓴다. 모르면 빈 문자열. */
export const APP_URL: string = typeof __APP_URL__ === 'string' ? __APP_URL__ : '';

export const APP_NAME = '스터디 윗미';

declare const __FIREBASE_CONFIG__: string | undefined;
/** 빌드할 때 FIREBASE_CONFIG(JSON)를 주면 claude.ai 밖에서도 Firebase로 친구들과 함께 쓴다 */
export const FIREBASE_CONFIG: Record<string, string> | null = (() => {
  try {
    const raw = typeof __FIREBASE_CONFIG__ === 'string' ? __FIREBASE_CONFIG__ : '';
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
})();
