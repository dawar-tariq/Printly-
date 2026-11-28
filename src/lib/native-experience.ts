import 'server-only';

/**
 * A deliberately small, backwards-compatible set of presentation settings.
 * No URLs, executable content, access rules, pricing or payment decisions.
 */
export function nativeExperience(env: Record<string, string | undefined> = process.env) {
  const plain = (value: string | undefined, limit: number) => {
    const text = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
    return text.length <= limit ? text : '';
  };
  const seconds = env.PRINTLY_NATIVE_BOARD_REFRESH_SECONDS;
  const parsed = seconds && /^\d{1,2}$/.test(seconds) ? Number(seconds) : 15;
  return {
    schema: 1,
    notice: plain(env.PRINTLY_NATIVE_NOTICE, 180),
    home_subtitle: plain(env.PRINTLY_NATIVE_HOME_SUBTITLE, 120),
    board_refresh_seconds: parsed >= 10 && parsed <= 60 ? parsed : 15,
  };
}
