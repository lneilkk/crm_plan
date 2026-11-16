/** 목록에서 index 자리의 항목을 delta(−1 = 위로, +1 = 아래로)만큼 옮긴 새 목록. 범위를 벗어나면 원래 목록 그대로 */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list as T[];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
