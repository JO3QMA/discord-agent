/**
 * Discord 側の会話鍵（CONTEXT.md「会話」）。
 * 通常チャンネル／DM は場所共有（送信者を載せない）。スレッドは thread 鍵。
 * 個人付帯は operatorKey を使う。
 */
export function conversationKey(
  channel: { id: string; isThread: () => boolean } | null,
): string {
  if (channel?.isThread()) return `thread:${channel.id}`;
  if (channel?.id) return `channel:${channel.id}`;
  return "channel:unknown";
}

/** Operator 個人の鍵（人格・USER など）。場所を表さない。 */
export function operatorKey(userId: string): string {
  return `user:${userId}`;
}
