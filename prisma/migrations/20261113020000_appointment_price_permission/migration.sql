-- 확장 계획 S-3: 새 권한 appointment.price (예약 금액 — 단가·할인율 보기·고치기).
--
-- 고정 규칙 5("새 권한은 기본 꺼짐")의 예외로 처음부터 준다. 이유: S-3 전에는 예약을 보는 모든 직원이 금액을 봤다.
-- 이 변경은 보는 사람을 줄이는 것이고, 사용자가 기본값을 상담·운영·원장으로 정했다(2026-11-13, CHECKLIST.md S 절).
-- 관리자는 [편집]에서 나중에 바꿀 수 있다(S-7).

-- 직무: 상담·관리자 (src/lib/auth/permissions.ts INITIAL_JOB_PERMISSIONS와 같음). 관리자가 이미 바꾼 값은 건드리지 않는다.
INSERT INTO "job_permission" ("id", "role", "permission")
SELECT encode(
         set_bit(set_bit(
           overlay(uuid_send(gen_random_uuid())
                   placing substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                   FROM 1 FOR 6),
           52, 1), 53, 1),
         'hex')::uuid,
       v.role::"staff_role", v.permission
FROM (VALUES
  ('COUNSELOR', 'appointment.price'),
  ('ADMIN', 'appointment.price')
) AS v(role, permission)
ON CONFLICT ("role", "permission") DO NOTHING;

-- 원장: 통계 보기를 개인 추가 권한으로 가진 의사 계정(S-2 변환을 받은 원장 계정)에 개인 추가 권한으로 준다.
UPDATE "staff" SET "extra_permissions" = array_append("extra_permissions", 'appointment.price')
WHERE "role" = 'DOCTOR' AND 'stats.read' = ANY("extra_permissions") AND NOT ('appointment.price' = ANY("extra_permissions"));
