# 화면·권한 지도 (S-1 현황 조사)

2026-11-13 기준 · 코드 변경 없음 · 확장 계획([EXPANSION.md](EXPANSION.md)) 1장 S-1

이 문서는 **지금 코드가 실제로 어떻게 되어 있는지**를 적는다. 바꿀 방향은 S-2~S-7에서 정한다. 조사한 코드:
- `src/lib/auth/permissions.ts` (권한 표, 메뉴)
- `src/app/api/**/route.ts` 34개 파일, 처리기 44개
- `src/app/(app)/**/page.tsx` 9개
- `src/components/**`

## S-3 이후 바뀐 점 (2026-11-13)

- **금액:** 예약 금액(단가·할인율·실적 금액·항목 단가)은 새 권한 `appointment.price`가 있을 때만 보이고 고칠 수 있다. 첫 설치 값은 상담·관리자 직무와 원장 계정(추가 권한)이다.
  - 권한이 없으면 API 응답에서 항목 자체가 빠진다. 0장 5번은 해결됐다.
- **화면 등록부:** 화면의 권한 판단은 모두 화면 등록부(`src/lib/auth/screen-registry.ts`)의 영역 이름으로만 한다. 역할을 넘기던 곳(4장)도 모두 바꿨다.
  - 역할·부서 직접 비교와 권한 이름 직접 검사가 화면 코드에 생기면 `src/components/auth/no-role-checks.test.ts`가 실패한다.
- **고객 버튼:** 고객 [고객 등록]·[수정]은 `patient.write`가 있을 때만 보인다. 0장 4번은 해결됐다.
- **주소 직접 입력(S-4에서 통일):** 모든 화면(페이지)을 화면 등록부의 `SCREENS`에 등록했다.
  - 권한이 없는 화면 주소로 들어오면 화면 틀이 그 화면을 그리지 않고 "이 화면을 볼 권한이 없습니다" 안내와 [첫 화면으로]만 보인다.
  - 데이터 API를 부르지 않고 가짜 값도 그리지 않는다(브라우저 테스트로 확인). 0장 3번과 7장의 A·B·C·D 반응은 이것 하나로 바뀌었다.
- **첫 화면(S-4):** 부서별 첫 화면은 설정값(`clinic_setting.department_homes`)이다. 초기값은 프론트 내원 보드, 상담 상담, 진료 예약 캘린더, 운영 통계다.
  - 관리자가 [편집] → [부서별 첫 화면]에서 바꾼다.
  - 권한이 없는 화면을 정해 두면 볼 수 있는 메뉴의 첫 화면으로 간다.
- 아래 본문은 S-1 조사 당시 기록이다.

## 0. 핵심 발견

1. **서버 차단은 빠짐없이 되어 있다.**
   - 모든 API 처리기 44개가 `defineRoute`로 권한을 선언한다.
   - 공개 처리기는 로그인과 헬스체크 두 개뿐이다.
   - 로그인만 필요한 처리기는 내 정보, 로그아웃, 비밀번호 변경 세 개다.
2. **화면 코드에 역할 직접 비교로 하는 권한 판단은 없다.**
   - 버튼·영역을 숨길 때는 모두 `can(role, 권한)`을 쓴다.
   - 역할 값이 직접 나오는 곳은 4군데이고, 모두 권한 판단이 아니다. 목록 조회 조건, 표시 순서, 배지 색이 그런 경우다(4장).
   - 다만 화면은 권한 목록이 아니라 **역할 값(`role`)을 받아서** 그 자리에서 `can()`을 부른다. S-2에서 부서 + 추가 권한으로 바꾸면, 이렇게 역할을 넘기는 7곳을 "권한 집합"으로 바꿔야 한다.
3. **페이지 단위의 진입 검사는 없다.** 메뉴에서만 숨기므로, 주소를 직접 입력하면 화면 틀은 열린다. 데이터는 API가 403으로 막으므로 새는 정보는 없다. 다만 화면마다 반응이 다르다(7장: 역할 5개로 브라우저에서 직접 확인).

   | 화면 | 권한 없는 사람이 주소를 직접 입력하면 |
   | --- | --- |
   | `/stats` | "권한 없음" 안내가 나온다 |
   | `/consult` | 상담 목록 자리에 API 오류 문구가 나온다 |
   | `/import` | 업로드 화면이 그대로 열린다. 엑셀 읽기는 브라우저 안에서만 하고, [가져오기]를 누르면 403 |
   | `/patients/new` | 원장·간호도 양식이 열린다. 저장하면 403 |

4. **권한이 없어도 보이는 버튼이 있다.**
   - 고객 화면의 **[고객 등록]**과 고객 상세의 **[수정]**이 원장·간호에게도 보인다. 원장·간호에게는 patient.write가 없다.
5. **예약 금액이 모든 역할에 보인다.**
   - 예약 상세 API가 단가·할인율을 함께 내보낸다.
   - 화면도 프론트·간호를 포함한 모든 역할에 "금액" 줄을 보여 준다.
   - 확장 계획의 "상담·할인 영역"을 권한으로 나누려면 화면만 아니라 **API 응답에서도** 빼야 한다(S-5).
6. **설정은 예약 캘린더 안에 있다.**
   - [편집]은 상단 메뉴가 아니라 예약 캘린더 안의 탭이다. settings.write가 있을 때만 보인다.
   - 직원 관리도 그 안의 하위 메뉴다. 직원 관리 API는 staff.manage를 쓰는데, 지금은 두 권한이 모두 관리자에게만 있어 차이가 드러나지 않는다.
7. **첫 화면은 모두 내원 보드다.** `/` → `/board`로 보내며, 역할과 관계없다.

## 1. 역할 × 권한 (현재)

> S-2b부터 직무별 권한은 DB(`job_permission`)가 기준이고 관리자가 바꿀 수 있다. 아래 표는 첫 설치 값(`INITIAL_JOB_PERMISSIONS`)에 S-2 변환 추가 권한(의사 계정: 통계·상담 보기)을 더한 것이다.

출처: `src/lib/auth/permissions.ts`. 화면에 보이는 역할 이름은 프론트·상담·의사·간호·관리자다.

| 권한 | 뜻 | 프론트 | 상담 | 의사 | 간호 | 관리자 |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| patient.read | 고객 보기 | O | O | O | O | O |
| patient.write | 고객 등록·수정 | O | O | – | – | O |
| appointment.read | 예약·내원 보드 보기 | O | O | O | O | O |
| appointment.write | 예약 만들기·옮기기·고치기·라벨·예약변경 | O | O | – | – | O |
| visit.write | 내원 상태 변경·되돌리기 | O | O | – | O | O |
| stats.read | 통계·실적 | – | – | O | – | O |
| settings.read | 병원 설정 읽기(드롭다운 등) | O | O | O | O | O |
| settings.write | 병원 설정 바꾸기, [편집] 탭 | – | – | – | – | O |
| staff.read | 직원 이름·역할 목록(드롭다운용) | O | O | O | O | O |
| staff.manage | 직원 계정 관리 | – | – | – | – | O |
| consult.read | 상담 보기(내용 포함) | – | O | O | – | O |
| consult.write | 상담 쓰기·수술예약 전환 | – | O | – | – | O |
| surgery.record | 수술 참여 직원 기록 | O | O | O | O | O |
| surgery.note | 수술 메모 보기·쓰기 | – | – | O | – | O |
| data.import | 기존 CRM 가져오기 | – | – | – | – | O |

## 2. 메뉴와 화면

### 2-1. 상단 메뉴

출처: `NAV_SECTIONS`. 그 메뉴의 권한이 있는 사람에게만 보인다.

| 메뉴 | 주소 | 필요한 권한 | 보이는 역할 |
| --- | --- | --- | --- |
| 내원 보드 | /board | appointment.read | 전원 |
| 예약 캘린더 | /calendar | appointment.read | 전원 |
| 상담 | /consult | consult.read | 상담·의사·관리자 |
| 고객 | /patients | patient.read | 전원 |
| 통계 | /stats | stats.read | 의사·관리자 |
| 가져오기 | /import | data.import | 관리자 |

상단 바 오른쪽의 [비밀번호 변경](/account/password)과 [로그아웃]은 전원에게 보인다.

메뉴 수: 관리자 6개, 의사 5개, 상담 4개, 프론트 3개, 간호 3개. 확장 계획의 원칙은 부서별 4개 이하다.

### 2-2. 화면 안의 영역·버튼

"숨김 근거"는 화면이 그 영역을 숨기는 조건이다. 실제 차단은 오른쪽 열의 API가 한다.

**내원 보드** (`board-screen.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 오늘 목록·요약·빠른 검색 | 없음 | GET /api/board (appointment.read), GET /api/patients (patient.read) |
| [내원] [노쇼] [당일취소] 등 상태 버튼, [되돌리기] | `can(visit.write)` | POST …/status, …/revert (visit.write) |
| [예약변경] | `can(appointment.write)` | POST …/reschedule (appointment.write) |
| 행의 버튼 칸 자체 | visit.write 또는 appointment.write | — |

**예약 캘린더** (`calendar-screen.tsx`, `day-view.tsx`, `week-view.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 일·주 보기, 범례, 칸 크기 | 없음 | GET /api/appointments (appointment.read), GET /api/settings, …/calendar-style (settings.read) |
| 빈 칸 눌러 예약 등록 | `canWrite` = appointment.write | POST /api/appointments (appointment.write) |
| 끌어서 옮기기 | `canWrite` + 대기 상태 | PATCH …/move (appointment.write) |
| [편집] 탭(하위 메뉴 7개) | `can(settings.write)` | 아래 2-3 |

**예약 상세** (`appointment-detail-dialog.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 기본 정보·메모·상태 이력 | 없음 | GET /api/appointments/[id] (appointment.read) |
| **금액(단가·할인율)** | **없음 — 전원에게 보임** | 같은 응답에 포함됨 |
| 색 라벨 보기 | 없음 | 같은 응답 |
| [고치기] → 항목·체어·담당·메모·할인율, 라벨 고르기 | `canWrite` | PATCH /api/appointments/[id], PUT …/labels (appointment.write) |
| [예약변경] | `canWrite` + 대기 상태 + 오늘 이후 | POST …/reschedule (appointment.write) |
| 수술 기록 칸 | 고가 항목이거나 참여 직원이 있을 때 | — |
| ㄴ 참여 직원 고르기 | `can(surgery.record)` | PUT …/participants (surgery.record) |
| ㄴ 수술 메모 | `can(surgery.note)` | GET·PUT …/surgery-note (surgery.note) |

**상담** (`consult-screen.tsx`, `consult-detail-dialog.tsx`, `consult-new-dialog.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 상담 보드·요약·상담자별 표 | 메뉴만 | GET /api/consultations, …/stats (consult.read) |
| 상담 상세 보기 | 없음 | GET /api/consultations/[id] (consult.read) |
| [+ 새 상담], [고치기], [→ 수술예약] | `can(consult.write)` | POST·PATCH /api/consultations…, POST …/book (consult.write) |

**고객** (`patient-search.tsx`, `patient-detail.tsx`, `patient-form.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 검색·목록(마스킹), [신환만] | 없음 | GET /api/patients (patient.read) |
| 고객 상세(전체 번호·생년월일, 예약 이력) | 없음 | GET /api/patients/[id] (patient.read), 조회마다 감사 로그 |
| **[고객 등록]** (목록 위, 검색 결과가 없을 때) | **없음 — 의사·간호에게도 보임** | POST /api/patients (patient.write) |
| **[수정]** (상세) | **없음 — 의사·간호에게도 보임** | PATCH /api/patients/[id] (patient.write) |

**통계** (`stats-dashboard.tsx`, `performance-view.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 화면 전체 | `can(stats.read)` 아니면 "권한 없음" | — |
| [내원 통계] 탭 | 위와 같음 | GET /api/stats (stats.read) |
| [실적] 탭 | 위와 같음 | GET /api/stats/performance (stats.read) |

**가져오기** (`import-screen.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 화면 전체(파일 고르기, 열 맞추기) | **메뉴만** | — (브라우저 안에서만 읽음) |
| [시험 실행] [가져오기] | 없음 | POST /api/import/[kind] (data.import) |

**계정** (`password-form.tsx`)

| 영역·버튼 | 숨김 근거 | 막는 API (권한) |
| --- | --- | --- |
| 비밀번호 변경 | 로그인만 | POST /api/auth/password (authenticated) |

### 2-3. [편집] 하위 메뉴

위치는 예약 캘린더 → [편집]이고, settings.write가 있을 때만 보인다(`settings-editor.tsx`).

| 하위 메뉴 | 컴포넌트 | 쓰는 API (권한) |
| --- | --- | --- |
| 예약 항목 | `calendar/treatment-items-editor.tsx` | PUT /api/settings/treatment-items (settings.write) |
| 색 라벨 | `calendar/calendar-style-editor.tsx` (section=labels) | PUT /api/settings/calendar-style (settings.write) |
| 상태 표시 | `calendar/calendar-style-editor.tsx` (section=statuses) | PUT /api/settings/calendar-style (settings.write) |
| 체어·열 | `settings/chairs-editor.tsx` | PUT /api/settings/chairs (settings.write) |
| 상담 결과 | `settings/consult-outcomes-editor.tsx` | GET·PUT /api/settings/consult-outcomes (settings.read / settings.write) |
| 진료시간·기준 | `settings/clinic-rules-editor.tsx` | PUT /api/settings/clinic (settings.write) |
| 직원 | `settings/staff-editor.tsx` | GET /api/staff/accounts, POST /api/staff, PATCH /api/staff/[id], POST /api/staff/[id]/unlock (**staff.manage**) |

## 3. API 목록

모두 `defineRoute`를 거친다. 감사 로그 열의 "none"은 감사 로그를 남기지 않는 처리기다. 해당하는 것은 설정·직원 이름 목록 읽기와 로그인 상태 확인이고, 모두 환자 정보가 없다.

| 메서드 | 경로 | 권한 | 감사 로그 동작 |
| --- | --- | --- | --- |
| POST | /api/auth/login | public | none (로그인 기록은 따로) |
| POST | /api/auth/logout | authenticated | AUTH_LOGOUT |
| GET | /api/auth/me | authenticated | none |
| POST | /api/auth/password | authenticated | STAFF_PASSWORD_CHANGE |
| GET | /api/health | public | none |
| GET | /api/board | appointment.read | BOARD_READ |
| GET | /api/appointments | appointment.read | APPOINTMENT_LIST |
| POST | /api/appointments | appointment.write | APPOINTMENT_CREATE |
| GET | /api/appointments/[id] | appointment.read | APPOINTMENT_READ |
| PATCH | /api/appointments/[id] | appointment.write | APPOINTMENT_UPDATE |
| PUT | /api/appointments/[id]/labels | appointment.write | APPOINTMENT_LABELS_UPDATE |
| PATCH | /api/appointments/[id]/move | appointment.write | APPOINTMENT_MOVE |
| POST | /api/appointments/[id]/reschedule | appointment.write | APPOINTMENT_RESCHEDULE |
| POST | /api/appointments/[id]/status | visit.write | VISIT_STATUS_CHANGE |
| POST | /api/appointments/[id]/revert | visit.write | VISIT_STATUS_REVERT |
| PUT | /api/appointments/[id]/participants | surgery.record | SURGERY_PARTICIPANTS_UPDATE |
| GET | /api/appointments/[id]/surgery-note | surgery.note | SURGERY_NOTE_READ |
| PUT | /api/appointments/[id]/surgery-note | surgery.note | SURGERY_NOTE_UPDATE |
| GET | /api/patients | patient.read | PATIENT_SEARCH |
| POST | /api/patients | patient.write | PATIENT_CREATE |
| GET | /api/patients/[id] | patient.read | PATIENT_READ |
| PATCH | /api/patients/[id] | patient.write | PATIENT_UPDATE |
| GET | /api/consultations | consult.read | CONSULT_LIST |
| POST | /api/consultations | consult.write | CONSULT_CREATE |
| GET | /api/consultations/[id] | consult.read | CONSULT_READ |
| PATCH | /api/consultations/[id] | consult.write | CONSULT_UPDATE |
| POST | /api/consultations/[id]/book | consult.write | CONSULT_BOOK |
| GET | /api/consultations/stats | consult.read | CONSULT_STATS |
| GET | /api/stats | stats.read | STATS_READ |
| GET | /api/stats/performance | stats.read | STATS_PERFORMANCE_READ |
| POST | /api/import/[kind] | data.import | DATA_IMPORT |
| GET | /api/settings | settings.read | none |
| GET | /api/settings/calendar-style | settings.read | none |
| PUT | /api/settings/calendar-style | settings.write | CALENDAR_STYLE_UPDATE |
| PUT | /api/settings/chairs | settings.write | SETTINGS_CHAIRS_UPDATE |
| PUT | /api/settings/clinic | settings.write | SETTINGS_RULES_UPDATE |
| GET | /api/settings/consult-outcomes | settings.read | none |
| PUT | /api/settings/consult-outcomes | settings.write | CONSULT_OUTCOMES_UPDATE |
| PUT | /api/settings/treatment-items | settings.write | TREATMENT_ITEMS_UPDATE |
| GET | /api/staff | staff.read | none |
| POST | /api/staff | staff.manage | STAFF_CREATE |
| GET | /api/staff/accounts | staff.manage | STAFF_LIST |
| PATCH | /api/staff/[id] | staff.manage | STAFF_UPDATE |
| POST | /api/staff/[id]/unlock | staff.manage | STAFF_UNLOCK |

**응답에 담기는 민감 항목**

| API | 담기는 것 | 받는 역할 |
| --- | --- | --- |
| GET /api/appointments | 가린 이름, 번호 뒷 4자리, 메모가 있는지(내용은 없음) | 전원 |
| GET /api/appointments/[id] | 가린 이름, 메모 내용, **단가·할인율**, 참여 직원 | 전원 |
| GET /api/patients/[id] | 전체 번호·생년월일. T3-3 [원문 보기]는 R3에 남아 있음 | 전원 |
| GET /api/appointments/[id]/surgery-note | 수술 메모 | 의사·관리자 |

## 4. 화면 코드에서 역할 값이 직접 나오는 곳

검색 조건: `src/app`·`src/components`(API 제외)에서 역할 비교(`role ===` 등)와 역할 문자열(`"FRONT"` 등).

| 위치 | 하는 일 | 권한 판단인가 |
| --- | --- | --- |
| `calendar/booking-dialog.tsx:66`, `calendar/appointment-edit-section.tsx:38`, `consult/consult-screen.tsx:45` | 상담자 목록 조회 `/api/staff?role=COUNSELOR` | 아님 (드롭다운 목록) |
| `calendar/calendar-screen.tsx:66`, `consult/consult-screen.tsx:46` | 의사 목록 조회 `/api/staff?role=DOCTOR` | 아님 |
| `calendar/surgery-section.tsx:39` | 참여 직원 후보 정렬 순서(간호 → 의사 → …) | 아님 |
| `calendar/surgery-section.tsx:51` | 간호 배지 색 | 아님 |
| `settings/staff-editor.tsx:20,116,130` | 새 직원의 기본 역할(간호), 역할 변경 여부 비교 | 아님 (편집 값) |

**권한 판단에 역할을 넘기는 곳.** 아래는 `can()`에 쓰려고 역할을 받는다. S-3에서 권한 집합(또는 등록부 컴포넌트)으로 바꿀 대상이다.
- `board/board-screen.tsx:165-166`
- `calendar/calendar-screen.tsx:97-99, 110` (`role`을 상세 창까지 넘김)
- `calendar/appointment-detail-dialog.tsx:48, 131` (`role` prop)
- `calendar/surgery-section.tsx:19-21` (`role` prop)
- `consult/consult-screen.tsx:56`
- `stats/stats-dashboard.tsx:45`

부서로 바뀌면 상담자·의사 목록 조회(`?role=`)도 영향을 받는다. "의사 목록"이 부서 기준(진료 부서에는 간호도 있음)인지 직무 기준인지 S-2에서 정해야 한다.

## 5. 중복·정리 후보 (S-6용)

| 후보 | 위치 | 내용 |
| --- | --- | --- |
| 목록 편집기 4벌 | `calendar/treatment-items-editor.tsx`, `calendar/calendar-style-editor.tsx`, `settings/chairs-editor.tsx`, `settings/consult-outcomes-editor.tsx` | 모두 "행 추가·이름·색·순서 위아래·삭제·저장" 구조이고 각자 `Draft` 타입이 있다. 공통 목록 편집 부품 하나로 줄일 수 있다. |
| 설정 편집기의 폴더 위치 | 예약 항목·색 라벨·상태 표시 편집기는 `calendar/`, 나머지는 `settings/` | [편집]의 하위 메뉴인데 두 폴더에 나뉘어 있다. |
| 직원 목록 조회 반복 | `["staff","COUNSELOR"]` 3곳, `["staff","DOCTOR"]` 2곳, 상담 쪽 `StaffOption` 타입 2벌 | 공통 훅 하나로 모을 수 있다. 부서 도입 때 한 곳만 고치게 된다. |
| 내 정보 조회 반복 | `ME_QUERY_KEY` 조회가 app-shell 외 5개 화면에 있음 | 권한 집합을 주는 공통 훅(예: `usePermissions`)으로 모으면 S-3과 맞물린다. |
| 병원 설정 조회 반복 | `["settings"]` 6곳 | 같은 키라 캐시는 공유된다. 훅으로 모으면 타입이 한 곳에 생긴다. |
| 고객 고르기 부품의 위치 | `PatientPicker`가 `calendar/booking-dialog.tsx`에 있고 상담 화면이 가져다 씀 | 공용 위치로 옮길 후보. |
| 권한 없음 안내 | `NoPermission`이 통계 화면 안에만 있음 | 페이지 진입 검사(S-4)를 만들 때 공용으로 쓸 수 있다. |
| 큰 파일 | `calendar-screen.tsx` 537줄, `board-screen.tsx` 496줄, `booking-dialog.tsx` 494줄, `appointment-detail-dialog.tsx` 428줄 | 상세 창은 S-5에서 권한 단위 영역으로 나눌 때 같이 쪼갠다. |

쓰지 않는 코드는 이번 조사에서 따로 찾지 않았다. S-6에서 도구(타입 검사의 미사용 export 검사 등)로 찾는다.

## 6. 확장 계획 초안과 지금의 차이 (S-2·S-4 전에 정할 것)

확장 계획 1장의 부서별 메뉴 초안과 지금 코드를 비교했다.

| 부서 | 초안의 메뉴 | 지금 그 역할의 메뉴 | 차이 |
| --- | --- | --- | --- |
| 프론트 | 내원 보드, 예약 캘린더, 고객 | 같음 | 없음 |
| 상담 | 상담 보드, 예약 캘린더, 고객 | 내원 보드, 예약 캘린더, 상담, 고객 | 내원 보드가 빠진다. 상담은 지금 visit.write(내원 상태 변경)가 있다. 메뉴만 빼고 권한은 둘지 정해야 한다. |
| 진료(의사·간호) | **오늘 진료 일정, 수술 기록** | 의사: 내원 보드, 캘린더, 상담, 고객, 통계 / 간호: 내원 보드, 캘린더, 고객 | **두 화면 모두 아직 없다.** 수술 기록은 지금 예약 상세 안의 한 칸이다. 새 화면이라 S-4보다 큰 일이다. 내원 보드로 대신할지 정해야 한다. |
| 운영 | 통계·실적, 편집, 직원, 가져오기, 감사 로그 + 전체 | 관리자: 메뉴 6개 + 캘린더 안 [편집] | [편집]·[직원]을 상단 메뉴로 꺼내야 한다. **감사 로그 화면은 T8-2(R3)라 아직 없다.** 메뉴가 4개를 넘는다. |

그 밖에 정할 것:
- **진료 부서 권한의 차이:** 의사와 간호가 같은 부서가 되지만 지금 권한이 서로 다르다.
  - 간호에게만 있는 것: 내원 상태 변경(visit.write).
  - 의사에게만 있는 것: 통계, 상담 보기, 수술 메모.
  - "변환 전후 사람별 권한이 같음"(S-2 완료 기준)을 지키려면 다음 중 하나다.
    - 진료 부서 기본값을 둘의 공통 권한으로 하고, 나머지는 개인 추가 권한으로 준다.
    - 부서 안에 직무(의사·간호)를 둔다.
- **추가 권한만으로 충분한가:** 개인 "추가" 권한만 있고 "빼기"가 없다. 그러면 부서 기본값은 그 부서에서 가장 적게 가진 사람에게 맞춰야 한다.
- **금액 보기 권한:** 예약 금액을 누가 볼지 정해야 한다. 지금은 전원이 본다.
  - 영역을 나누면(S-5) 예약 상세 API 응답도 같이 나눠야 한다.
  - 실적 계산은 서버에서 하므로 영향이 없다.
- **고객 [등록]·[수정] 버튼:** 의사·간호에게 보이는 문제를 S-3에서 권한으로 숨긴다. 동작 변화가 아니라 표시 정리다.
- **페이지 진입 검사:** 숨긴 화면 주소를 직접 입력했을 때 반응을 하나로 통일한다(S-4 완료 기준). 지금은 화면마다 다르다(0장 3번).

## 7. 주소 직접 입력 시 반응 (브라우저 확인, S-4 통일 기준)

**어떻게 확인했나**
- 2026-11-13, S-2 코드로 시험했다.
- 실제 브라우저(Playwright Chromium)로 역할 5개 계정에 각각 로그인해 아래 주소를 직접 열었다.
- 화면 제목·본문·버튼과, 4xx로 실패한 API를 기록했다.
- 시험 서버(crm-gbc.com)는 병원·관리자 IP에서만 열리므로, 이 PC에서는 같은 코드를 로컬 시험 서버(E2E DB)에 띄워 확인했다.
- 시험 서버에서는 API 응답 코드와 메뉴만 확인했다(체크리스트 S-2 메모).

**표 읽는 법**
- 메뉴에 있는 칸은 "메뉴"라고만 적었다.
- 메뉴에 없는 칸은 주소를 직접 입력했을 때의 반응이다.

| 주소 | 프론트 | 상담 | 의사(원장) | 간호 | 관리자 |
| --- | --- | --- | --- | --- | --- |
| /board | 메뉴, 상태 버튼 있음 | 메뉴, 상태 버튼 있음 | 메뉴, **버튼 없음(보기만)** | 메뉴, 상태 버튼 있음 | 메뉴 |
| /calendar | 메뉴 | 메뉴 | 메뉴 | 메뉴 | 메뉴, [편집] 탭 |
| /consult | **A** | 메뉴, [+ 상담 등록] | 메뉴, 등록 버튼 없음 | **A** | 메뉴 |
| /patients | 메뉴, [고객 등록] | 메뉴, [고객 등록] | 메뉴, **[고객 등록] 보임** | 메뉴, **[고객 등록] 보임** | 메뉴 |
| /patients/new | 양식 | 양식 | **B** | **B** | 양식 |
| /patients/[id] | [수정] | [수정] | **[수정] 보임** | **[수정] 보임** | [수정] |
| /stats | **C** | **C** | 메뉴 | **C** | 메뉴 |
| /import | **D** | **D** | **D** | **D** | 메뉴 |

**A — 상담 (프론트·간호)**
- 머리글과 날짜 이동은 그대로 보인다.
- 요약 칸에 "전체 상담 0 … 전환율 -"이 **실제 값처럼 0으로** 보인다.
- 그 아래에 "이 작업을 할 권한이 없습니다. [다시 시도]"가 나온다.
- API 403: `/api/consultations`, `/api/consultations/stats`.
- 0을 실제 값처럼 보여 오해할 수 있다.

**B — 고객 등록 양식 (의사·간호)**
- 양식이 그대로 열린다.
- [등록]을 누르면 서버가 403으로 막는다.

**C — 통계**
- "권한이 없습니다 / 통계는 원장과 관리자만 볼 수 있습니다." 안내만 나온다. API를 부르지 않는다.
- 지금 화면 중 유일하게 의도된 반응이다.
- 문구가 역할 이름을 적고 있어, 추가 권한(S-2)을 도입한 뒤에는 "통계 보기 권한이 없습니다"처럼 권한 기준으로 바꿔야 한다.

**D — 가져오기**
- 관리자 화면이 그대로 열린다: 안내문과 [고객 기본 정보] [예약·내원 이력] [상담 기록] 선택.
- 파일 읽기는 브라우저 안에서만 하므로 API 호출이 없다.
- [시험 실행]·[가져오기]를 누르면 403이다.

S-4에서 통일할 기준(제안):
- 메뉴에 없는 화면 주소로 들어오면, 화면 틀 안에 C처럼 "이 화면을 볼 권한이 없습니다" 안내 하나만 보인다.
  - 데이터 API는 부르지 않는다.
  - 0 같은 가짜 값도 그리지 않는다.
- 권한 없는 버튼(B, [고객 등록], [수정])은 그리지 않는다(S-3).
