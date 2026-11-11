import "server-only";

import { type Algorithm, hash, verify } from "@node-rs/argon2";

/**
 * 직원 비밀번호 해시 — 기획서 10장("비밀번호는 일방향(해시) 암호화"), T1-4·T2-1.
 *
 * - 알고리즘: argon2id (버전 0x13). salt는 라이브러리가 매번 16바이트를 무작위로 뽑는다.
 * - 파라미터: 메모리 19 MiB(19456 KiB), 반복 2회, 병렬 1, 출력 32바이트.
 *   OWASP Password Storage Cheat Sheet의 argon2id 최소 권장값(m=19 MiB, t=2, p=1)이다.
 *   @node-rs/argon2 2.x의 기본값도 같지만, 라이브러리 기본값이 바뀌어도 정책이 그대로 유지되도록 명시한다.
 * - 해시 문자열(PHC 형식)에 파라미터가 함께 저장되므로, 나중에 값을 올려도 기존 해시는 그대로 검증된다.
 * - 비밀번호 원문과 해시는 로그·에러 메시지에 넣지 않는다.
 */

// Algorithm은 const enum이라 isolatedModules에서 값으로 쓸 수 없다. 2 = Algorithm.Argon2id
const ARGON2ID = 2 as Algorithm;

const HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** 비밀번호를 argon2id로 해시한다. 결과는 "$argon2id$v=19$m=19456,t=2,p=1$..." 형식이다. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTIONS);
}

/**
 * 저장된 해시와 비밀번호가 맞는지 확인한다.
 * 비밀번호가 틀리거나 해시 형식이 깨졌으면 예외 없이 false를 돌려준다(로그인은 둘을 구분하지 않는다).
 */
export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
