-- 확장 계획 S-2b: 직무별 권한을 DB에 둔다. 관리자가 편집한다(S-7).
-- 행이 있으면 그 직무가 그 권한을 가진다. 모르는 권한 이름은 프로그램이 무시한다(기본 거부).
CREATE TABLE "job_permission" (
    "id" UUID NOT NULL,
    "role" "staff_role" NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_permission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_permission_role_permission_key" ON "job_permission"("role", "permission");

-- 첫 설치 값 (src/lib/auth/permissions.ts INITIAL_JOB_PERMISSIONS와 같음 — tests/integration/job-permission.test.ts가 확인).
-- S-2 코드의 직무별 기본 권한과 같아 기존 계정의 권한은 바뀌지 않는다. 이 값은 이 마이그레이션이 한 번만 넣고,
-- 시드·재시작·재배포는 덮어쓰지 않는다. 기본 키는 UUID v7(앞 48비트 = 밀리초 시각, 버전 7)을 직접 만든다.
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
  ('FRONT', 'patient.read'),
  ('FRONT', 'appointment.read'),
  ('FRONT', 'settings.read'),
  ('FRONT', 'staff.read'),
  ('FRONT', 'surgery.record'),
  ('FRONT', 'patient.write'),
  ('FRONT', 'appointment.write'),
  ('FRONT', 'visit.write'),
  ('COUNSELOR', 'patient.read'),
  ('COUNSELOR', 'appointment.read'),
  ('COUNSELOR', 'settings.read'),
  ('COUNSELOR', 'staff.read'),
  ('COUNSELOR', 'surgery.record'),
  ('COUNSELOR', 'patient.write'),
  ('COUNSELOR', 'appointment.write'),
  ('COUNSELOR', 'visit.write'),
  ('COUNSELOR', 'consult.read'),
  ('COUNSELOR', 'consult.write'),
  ('DOCTOR', 'patient.read'),
  ('DOCTOR', 'appointment.read'),
  ('DOCTOR', 'settings.read'),
  ('DOCTOR', 'staff.read'),
  ('DOCTOR', 'surgery.record'),
  ('DOCTOR', 'surgery.note'),
  ('NURSE', 'patient.read'),
  ('NURSE', 'appointment.read'),
  ('NURSE', 'settings.read'),
  ('NURSE', 'staff.read'),
  ('NURSE', 'surgery.record'),
  ('NURSE', 'visit.write'),
  ('ADMIN', 'patient.read'),
  ('ADMIN', 'patient.write'),
  ('ADMIN', 'appointment.read'),
  ('ADMIN', 'appointment.write'),
  ('ADMIN', 'visit.write'),
  ('ADMIN', 'stats.read'),
  ('ADMIN', 'settings.read'),
  ('ADMIN', 'settings.write'),
  ('ADMIN', 'staff.read'),
  ('ADMIN', 'staff.manage'),
  ('ADMIN', 'consult.read'),
  ('ADMIN', 'consult.write'),
  ('ADMIN', 'surgery.record'),
  ('ADMIN', 'surgery.note'),
  ('ADMIN', 'data.import')
) AS v(role, permission);
