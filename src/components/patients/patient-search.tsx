"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth/api-client";
import { GENDER_LABEL, REFERRAL_SOURCE_LABEL } from "@/lib/domain/patient";
import type { PatientListItem } from "@/server/patients/service";
import { Badge, Button, EmptyState, Input, Spinner, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";

const DEBOUNCE_MS = 300;

/**
 * 고객 검색 화면 — T3-2. 입력을 멈추면(0.3초) 검색한다. 목록의 이름·번호는 서버가 마스킹해서 준다.
 * 검색어는 주소창(URL)에 넣지 않는다(번호·이름이 브라우저 기록에 남지 않게).
 */
export function PatientSearch() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  /** 신환만 보기 (F-4): 내원한 적이 있거나 구환으로 등록한 고객은 빠진다 */
  const [newOnly, setNewOnly] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const result = useQuery({
    queryKey: ["patients", "search", query, newOnly],
    queryFn: () =>
      apiFetch<{ items: PatientListItem[] }>(`/api/patients?q=${encodeURIComponent(query)}${newOnly ? "&newOnly=1" : ""}`),
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 60_000,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">고객</h1>
        <Button size="lg" onClick={() => router.push("/patients/new")}>
          고객 등록
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input
          type="search"
          aria-label="고객 검색"
          placeholder="전화번호 뒷 4자리, 이름, 차트번호"
          autoComplete="off"
          autoFocus
          className="min-h-14 text-lg"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-base font-semibold">
          <input type="checkbox" className="size-5" checked={newOnly} onChange={(event) => setNewOnly(event.target.checked)} />
          신환만
        </label>
        {result.isFetching && <Spinner label="검색 중" />}
      </div>

      {result.isError ? (
        <EmptyState
          title={result.error.message}
          action={<Button onClick={() => result.refetch()}>다시 시도</Button>}
        />
      ) : result.isPending ? (
        <Spinner showLabel label="불러오는 중" />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title={query ? "검색 결과가 없습니다" : "등록된 고객이 없습니다"}
          description={query ? "번호 뒷 4자리, 이름, 차트번호를 다시 확인하세요." : undefined}
          action={<Button onClick={() => router.push("/patients/new")}>고객 등록</Button>}
        />
      ) : (
        <>
          {!query && <p className="text-sm text-slate-600">최근 등록한 고객입니다.</p>}
          <Table>
            <THead>
              <tr>
                <Th>이름</Th>
                <Th>휴대폰</Th>
                <Th>출생연도</Th>
                <Th>차트번호</Th>
                <Th>구분</Th>
                <Th>유입경로</Th>
                <Th>태그</Th>
              </tr>
            </THead>
            <TBody>
              {result.data.items.map((item) => (
                <Tr
                  key={item.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => router.push(`/patients/${item.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/patients/${item.id}`);
                  }}
                >
                  <Td className="font-semibold">
                    {item.nameMasked}
                    {item.gender && <span className="ml-1 text-sm text-slate-500">({GENDER_LABEL[item.gender]})</span>}
                  </Td>
                  <Td className="tabular-nums">{item.phoneMasked}</Td>
                  <Td className="tabular-nums">{item.birthYear ?? "-"}</Td>
                  <Td className="tabular-nums">{item.dentwebChartNo ?? "-"}</Td>
                  <Td>
                    <Badge tone={item.isNewPatient ? "info" : "neutral"}>{item.isNewPatient ? "신환" : "구환"}</Badge>
                    {item.noShowCount > 0 && (
                      <Badge tone="danger" className="ml-1">
                        노쇼 {item.noShowCount}
                      </Badge>
                    )}
                  </Td>
                  <Td>{item.referralSource ? REFERRAL_SOURCE_LABEL[item.referralSource] : "-"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <Badge key={tag} tone="muted">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
