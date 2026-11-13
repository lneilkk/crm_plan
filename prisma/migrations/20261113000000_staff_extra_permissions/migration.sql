-- 확장 계획 S-2: 직원 개인 추가 권한.
-- 한 사람의 권한 = 직무(staff.role) 기본 권한 ∪ extra_permissions (src/lib/auth/permissions.ts).
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "extra_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 변환: S-2 전에는 의사 역할이 통계·실적 보기와 상담 보기를 가졌다. 의사 직무 기본값에서 두 권한을 뺐으므로,
-- 이미 있는 의사 계정에는 개인 추가 권한으로 남겨 사람별 권한이 바뀌지 않게 한다 (LEGACY_ROLE_EXTRAS와 같아야 함).
UPDATE "staff" SET "extra_permissions" = ARRAY['stats.read', 'consult.read']::TEXT[] WHERE "role" = 'DOCTOR' AND "extra_permissions" = ARRAY[]::TEXT[];
