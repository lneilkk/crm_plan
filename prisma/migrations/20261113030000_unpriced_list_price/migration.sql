-- S-3 보완: "단가 미입력"을 0원(무료)과 구분한다.
-- 예약의 단가(list_price)가 null이면 예약 당시 그 항목의 단가가 미입력이었다는 뜻이다. 실적에서는 금액에 넣지 않고 따로 센다.
-- 숨은 0원이 생기지 않도록 기본값도 없앤다(등록·항목 변경·가져오기는 항상 서버가 항목 설정에서 단가를 넣는다).
ALTER TABLE "appointment" ALTER COLUMN "list_price" DROP NOT NULL;
ALTER TABLE "appointment" ALTER COLUMN "list_price" DROP DEFAULT;
