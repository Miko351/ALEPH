# AI B 작업 기록

- 작업 시작: 2026-10-02 15:14:46 KST (도구로 확인한 실제 시각)
- 작업 종료: 2026-10-02 15:23:07 KST (구현·검사·정리 완료 후 기록 확정 시각)
- 실제 요청 수: 1회. 사용자의 이번 작업 지시 메시지 1건이며, 내부 도구 호출은 세지 않는다.
- 상한: 실제 작업시간 60분, 작업 요청 15회
- 범위: 미리보기 문구 포인터 드래그 개선, 기존 슬라이더·세 비율·템플릿 저장/불러오기 유지
- Git 업로드·배포: 수행하지 않음

## 인수 및 시작 검증

HANDOFF.md와 FIXED_TESTS.md를 직접 읽었다. 이전 AI 대화는 제공받지 않았다. 문서에 안내된 세 명령을 변경 없이 순서대로 실행했다.

| 명령 | 수정 전 결과 | 종료 코드 |
| --- | --- | --- |
| `node tests/fixed-drag-check.mjs` | 7/10 PASS, D04·D05·D10 FAIL | 1 |
| `node tests/browser-check.mjs --all --extremes` | 전체 PASS, 극단 입력 12건 PASS, 세 기준 화면 넘침 0건, JS 예외 0건 | 0 |
| `node tests/verify-examples.mjs` | 세 예제의 PNG 크기·메타데이터 검사 PASS | 0 |

## 고정 검사 결과

A 중단 결과는 HANDOFF.md의 기록을 옮겼다. B 수정 전 결과는 실제 재실행 결과다. 검사 ID·입력·기대값 및 기존 검사 실행기를 변경하지 않는다.

| 검사 ID | A 중단 (인수인계 기록) | B 수정 전 (실행) | B 완료 |
| --- | --- | --- | --- |
| D01 | PASS | PASS | PASS |
| D02 | PASS | PASS | PASS |
| D03 | PASS | PASS | PASS |
| D04 | FAIL | FAIL | PASS |
| D05 | FAIL | FAIL | PASS |
| D06 | PASS | PASS | PASS |
| D07 | PASS | PASS | PASS |
| D08 | PASS | PASS | PASS |
| D09 | PASS | PASS | PASS |
| D10 | FAIL | FAIL | PASS |

수정 전 D04·D05: 50%·50%가 70%·70%로 변경됨. D10: 저장 당시 미리보기 그림이 복원되지 않음.

## 보존 확인용 시작 SHA-256

| 파일 | SHA-256 |
| --- | --- |
| HANDOFF.md | C2C1AE079C3B69CE15FD8034C182B89FF659FFC1D29151F763F1F89986F086DB |
| FIXED_TESTS.md | 8246670E8F60EBBD3DB8ED9B23CB32CF2AF4BC5960C0BB3F9F22AA556310DF9F |
| WORK_LOG.md | 3CBF0FB2D31C92F6F90CB32E0953792DE66F943392E274EBA96143729CA5C067 |
| dist/index.html | EB17BE50D64F2505BB081291EB05789CA3E5CC42790EB1206141F06C5EEFD548 |
| dist/styles.css | C5FCC683C32A0614251B6FB8BCBE1B1C280A6CC298D7CC538940FF607F7128F5 |
| dist/app.js (A 인수 작업본) | 76324A6211C00FEFA00C5A013663AEBCDA28D39E72E8EE1850C6602AD0BFF394 |
| tests/fixed-drag-check.mjs | B115A42181C3BA4C51F7EB1E3E16FD6A81CBED7F3406026D712ABB6AB4787B44 |
| tests/browser-check.mjs | EAC4B9AA025260D8971C58838ABEBB007D2C98A1C15CD5F3F7C2006BC78E5607 |
| tests/verify-examples.mjs | C8A4FF5575B097BE7935BC87432628336C4E85F7EBBF97922A2380CE9ABC755F |

## 최종 작업 내용

최종 변경 파일은 dist/app.js, dist/styles.css, 새 B_WORK_LOG.md다.

1. 문구를 그릴 때 줄별 실제 글자 경계(TextMetrics actualBoundingBox)와 외곽선 두께를 저장한다. 줄바꿈·자동 축소·가장자리 안쪽 배치가 적용된 최종 좌표를 사용한다. 화면 좌표를 캔버스 좌표로 환산해 이 영역에서 시작한 기본 포인터 드래그만 허용한다. 빈 문구·공백만 있는 문구·빈 줄·빈 배경에서는 시작하지 않는다.
2. 드래그 변화량은 기존 가로·세로 슬라이더와 출력 표시로 전달한다. 기존 10~90% 범위, 세 화면비, 키보드 방향키 조절, 템플릿 저장 형식을 유지한다.
3. 문구 렌더링을 ctx.save()/ctx.restore()로 감싼다. D10의 원인은 drawText()의 lineJoin='round'가 다음 기본 배경의 테두리 그리기에 남는 상태 누출이었다. 템플릿 불러오기의 setRatio()가 캔버스 상태를 초기화하면 첫 배경은 기본 miter로 그려져 저장 전 그림과 달라졌다. 수정 전 별도 임시 진단에서 복원 직후 그림 일치는 false, 동일 문구로 추가 렌더링 후 일치는 true임을 확인했고, 상태 분리 후 원본 D10의 PNG 데이터 동일성 검사가 통과했다.
4. 캔버스에 touch-action: none을 적용해 터치로 문구를 끌 수 있게 한다. pointerup·pointercancel·lostpointercapture 및 포인터 캡처의 즉시 해제 시 드래그 상태와 커서를 정리한다. 추가 검사에서 즉시 캡처 해제 시 상태가 남는 경우를 발견했고 pointermove의 캡처 확인으로 해결했다.
5. 원본 HANDOFF.md·FIXED_TESTS.md·WORK_LOG.md, dist/index.html, 기존 검사 실행기 세 파일은 시작 SHA-256과 최종 SHA-256이 같다. 고정 검사 ID·입력·기대값·실행기는 변경하지 않았다. JSON 검증·이미지 처리·기존 템플릿 데이터 구조는 변경하지 않았다.

## 최종 검사 결과 (최종 코드에서 실제 재실행)

| 명령 | 결과 | 종료 코드 |
| --- | --- | --- |
| `node tests/fixed-drag-check.mjs` | D01~D10 전부 PASS, 10/10 PASS·0/10 FAIL | 0 |
| `node tests/browser-check.mjs --all --extremes` | 기존 전체 검사 PASS | 0 |
| `node tests/verify-examples.mjs` | 세 PNG 예제 검사 PASS | 0 |
| `node --check dist/app.js` | JavaScript 문법 검사 PASS | 0 |

브라우저 검사 상세: JPEG·PNG, 위치·크기·색, 잘못된 파일 보존, 세 비율 미리보기/출력 픽셀 차이 square:0·portrait:0·story:0, 템플릿 3개 CRUD 및 새로고침 유지, JSON 정상·문법 손상·필수 누락 처리 PASS. 극단 입력 12건 PASS. 1366×768·1920×1080·375×812 가로/미리보기 넘침 0건. 첫 화면 편집 도구 표시·미리보기 갱신·1080×1080 PNG 출력 PASS. JavaScript 예외 0건.

예제 검사: 01-square.png 1080×1080·1,139,669 bytes, 02-portrait.png 1080×1350·1,511,219 bytes, 03-story.png 1080×1920·1,732,353 bytes. 세 파일 모두 EXIF·텍스트 메타데이터 0건.

## 보충 검사와 실행 중 관찰

고정 검사 원본을 수정하지 않고 별도 임시 Chrome/CDP 실행기로 아래 일곱 경우를 확인했다. 진단 및 보충 검사 임시 파일은 작업 종료 전에 삭제했다.

| 보충 검사 | 입력 및 확인 내용 | 최종 결과 |
| --- | --- | --- |
| S01 | 공백 및 개행만 있는 문구에서 중앙→70%·70% 드래그: 위치·그림 유지 | PASS |
| S02 | 세 줄 문구의 첫 줄 실제 글자 영역에서 가로·세로 10% 이동: 위치 약60%·60%, 그림 이동 | PASS |
| S03 | 첫 줄과 끝 줄 사이 빈 줄 중앙에서 드래그: 위치·그림 유지 | PASS |
| S04 | 9:16, 긴 문구 30회 반복·144px 요청의 자동 축소/줄바꿈 뒤 실제 첫 줄에서 드래그: 위치 약60%·60% | PASS |
| S05 | 10%·10%의 안쪽으로 제한된 실제 글자 영역을 다시 선택해 20% 이동: 약30%·30%, 그림 이동 | PASS |
| S06 | 문구 중앙을 누른 직후 포인터 캡처 해제, 70%·70%로 이동: 위치·그림 유지 및 커서 정리 | PASS |
| S07 | 375×812, 4:5에서 CDP 터치 취소·재시작 뒤 10%·10% 이동: 약60%·60%, 그림 이동 및 커서 정리 | PASS |

보충 검사 최초 실행은 Chrome DevToolsActivePort 파일의 일시적 EBUSY로 시작하지 못했다. 기존 고정 실행기 코드는 바꾸지 않고 재실행했다. 이후 보충 검사에서 S06만 FAIL(캡처 해제 뒤 70%·70%로 변경)을 확인해 수정했고, 수정 후 보충 7/7 PASS 및 원본 세 명령 전체 PASS를 다시 확인했다.

Git 상태 읽기는 저장소 소유권 경고가 있어 해당 명령에만 safe.directory 옵션을 지정했다. 전역 Git 설정, 커밋, 업로드, 배포는 수행하지 않았다.

## 최종 파일 SHA-256

| 파일 | SHA-256 |
| --- | --- |
| dist/app.js | BBCC8CA520F8012EFBF36761A10E8F3ABB8AE30CAF8ED45A9D997E29388B6906 |
| dist/styles.css | 6EBAC904D7C70F41B4F5771D898BEC547222AA8FC5836A55E261C99536AEA714 |

## 남은 문제 및 확인 한계

- 요청 범위와 D01~D10에서 확인된 미해결 기능 문제: 없음.
- 검사 실행기의 Chrome 시작 파일 읽기에서 일시적 EBUSY가 1회 있었다. 재실행으로 정상 진행했고, 기존 실행기는 보존했다.
- 터치는 Chrome CDP 에뮬레이션으로 검증했다. 실제 터치 하드웨어·펜 및 다른 브라우저에서는 직접 확인하지 않았다.

- 실제 작업시간: 8분 21초. 60분 상한 이내.
- 최종 실제 요청 수: 1회. 15회 상한 이내.
