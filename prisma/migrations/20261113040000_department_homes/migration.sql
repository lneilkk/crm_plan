-- 확장 계획 S-4: 부서별 첫 화면을 설정값으로 둔다(코드에 고정하지 않음).
-- 기본값은 첫 설치 값(src/lib/auth/screen-registry.ts INITIAL_DEPARTMENT_HOMES와 같음)이다. 이미 있는 설정 행에도 이 값이 한 번 들어가고,
-- 이후에는 관리자가 [편집] → [부서별 첫 화면]에서 바꾼 값이 기준이다. 시드·재배포는 덮어쓰지 않는다.
ALTER TABLE "clinic_setting" ADD COLUMN "department_homes" JSONB NOT NULL DEFAULT '{"FRONT": "/board", "CONSULT": "/consult", "CLINICAL": "/calendar", "OPERATIONS": "/stats"}';
