# 패스키 인증 구현 설명

과제 1의 공개 소개 구성과 경험 내용은 유지하되, 원래 공개 페이지와 시안에 있던 실제 이름은 개인정보 0건 조건에 맞춰 익명 표현으로 바꿨다. `index.html`은 누구나 볼 수 있고, `private.html`은 잠긴 자리의 안내와 로그인 UI만 담는다. 가입 시 입력한 비공개 메모 세 항목은 패스키 확인이 성공한 뒤 서버 DB에만 저장되며 공개 HTML·JS·서버 소스에 미리 들어 있지 않다. 실제 개인정보 대신 만들어 넣은 문구를 사용한다.

## ① 무엇으로 붙였나

- WebAuthn 패스키: `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0.
- 저장: libSQL/Turso(`@libsql/client` 0.18.0). 서버는 자격 증명 ID·공개키·서명 카운터만 보관한다. 비밀번호와 개인키는 저장하지 않는다.
- 로그인 유지: 서버 DB에 해시만 저장하는 12시간 세션. 브라우저에는 `HttpOnly`·`SameSite=Lax` 쿠키를 주고 HTTPS에서는 `Secure`를 붙인다.
- 로컬 실기기 확인에서는 첫 패스키를 Chrome/Google 비밀번호 관리자에, 두 번째 패스키를 Windows에 저장했다. 두 번째 패스키는 앱에서 삭제했다. 자동 검사에서는 별도의 가상 자격 증명을 사용했다.

## ② 왜 골랐나

WebAuthn 검증을 직접 암호 구현하지 않고 검증된 라이브러리에 맡기면서, 공개키·일회용 질문·원본 출처 검사를 서버에서 명확히 확인할 수 있기 때문이다. 별도 인증 서비스는 이 소규모 소개 페이지에 외부 로그인 흐름을 더하므로 선택하지 않았다. 질문은 5분 뒤 만료되며 검증을 시도할 때 DB에서 한 번만 꺼내고 삭제한다.

## ③ 어디를 어떻게 고쳤나

| 흐름 | 소스 |
| --- | --- |
| 공개/비공개 경계 | `dist/index.html`, `dist/private.html`, `dist/private.js` |
| 등록·두 번째 패스키 추가 | `src/passkey-service.js`의 `startRegistration`·`finishRegistration`, `api/passkey.js` |
| 로그인과 서명 검증 | `src/passkey-service.js`의 `startAuthentication`·`finishAuthentication` |
| 로그아웃·세션 소멸 | `src/security.js`의 `logout`, `api/passkey.js` |
| 비공개 자료 조회·계정 구분 | `src/passkey-service.js`의 `getData`·`updateNote`, `src/security.js`의 `requireUser` |
| DB와 저장 구조 | `src/db.js`, `src/schema.js` |

공개 배포 시 Vercel 프로젝트의 **Root Directory는 비워 두고**, 저장소 루트의 `vercel.json`이 `dist`를 정적 출력으로 지정하도록 한다. 서버 함수는 루트의 `api/`에 있다. 필요한 배포 환경변수는 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, 최종 공개 HTTPS 주소와 정확히 같은 `PASSKEY_ORIGIN` 세 가지다. 값은 Git에 올리지 않는다. 로컬 실행은 `npm.cmd install` → `npm.cmd run dev` → `http://localhost:8000/` 순서다.

패스키는 등록한 도메인에 묶이므로, 실제 기기 등록은 최종 공개 도메인을 정한 뒤 진행한다.

## ④ 안 열리는 것을 확인한 기록

`npm.cmd test` 결과 **7/7 통과**. 아래 계정·키·메모는 자동 검사를 위해 만든 합성 값이다. 세션 값·서명 원문은 표시하지 않았다. 테스트 소스: `tests/api.test.mjs`, `tests/passkey.test.mjs`.

| 확인 | 통과 요청·응답 | 거절 요청·응답 |
| --- | --- | --- |
| 로그인 없이 직접 열기 | `GET /api/passkey?action=private`, 유효 세션 → 해당 계정 메모 3건 | 같은 GET, 쿠키 없음 → `401`, `패스키 로그인이 필요합니다.` |
| 남의 계정 내용 | A·B 각자 `GET ?action=note&id=자기_메모_ID` → 본인 메모 `200`; 각자 전체 조회 → 메모 3건 | A가 B의 메모 ID를 조회 → `404`; B가 A의 메모 ID를 조회 → `404`. 두 방향 모두 상대 메모 건수 3건 유지. 남의 메모 수정·패스키 삭제도 `404`; 전체 조회 주소에 상대 `user_id`를 적어도 내 메모만 반환 |
| 남의 패스키로 로그인 | A 계정의 새 질문에 A 패스키로 서명 → 로그인 성공 | A 계정의 새 질문에 B 패스키로 서명해 `authentication-verify` 요청 → `403`, `이 계정의 패스키가 아닙니다.` |
| 일회용 질문과 서명 | 새 질문·올바른 서명으로 로그인 → 성공; 등록·로그인 요청마다 질문 값 다름 | 틀린 서명 → `401`; 성공에 쓴 질문·응답 재전송 → `401` |
| 패스키 삭제 뒤 로그인 | A 패스키 2개 중 하나를 삭제한 뒤 남은 키로 로그인 → 성공 | 삭제한 키로 로그인 → `403`; 마지막 남은 키 삭제 → `409` |
| 로그아웃 | 로그인 상태에서 자료 조회 → 메모 3건 | 로그아웃 뒤 **같은 쿠키**로 같은 GET → `401` |

로그인 요청·판정의 상세 기록(합성 자격 증명, `tests/passkey.test.mjs`; 질문 ID·서명·세션 값은 가림). 각 행은 별도의 새 질문으로 시도했고, 마지막 행만 성공 요청을 그대로 재전송했다. 서비스가 반환한 `HttpError` 상태·문구는 `api/passkey.js`에서 같은 상태의 JSON 오류 응답으로 변환된다.

| `POST /api/passkey` 요청의 `action`·핵심 입력 | 통과/거절 판정 |
| --- | --- |
| `authentication-options`, `username=alice-demo` → 새 질문; `authentication-verify`, 같은 `challengeId`·A 패스키의 정상 서명 | 통과, `{ "authenticated": true }`; 세션 쿠키 값 비공개 |
| `authentication-options`, `username=alice-demo` → 새 질문; `authentication-verify`, 같은 `challengeId`·B 패스키 ID와 B의 서명 | `403`, `{ "error": "이 계정의 패스키가 아닙니다." }` |
| `authentication-options`, `username=alice-demo` → 새 질문; `authentication-verify`, 같은 `challengeId`·A 패스키의 변조된 서명 | `401`, `{ "error": "패스키 서명 확인에 실패했습니다." }` |
| 성공한 `authentication-verify`의 `challengeId`와 서명 응답을 다시 전송 | `401`, `{ "error": "질문이 만료되었거나 이미 사용되었습니다." }` |

실제 로컬 계정으로 확인한 교차 조회(2026-10-14 KST, `localhost:8000`; 메모 내용·쿠키는 기록하지 않음):

| 로그인 계정 | 요청한 상대 메모 ID | 관찰한 응답 | 확인 뒤 메모 건수 |
| --- | --- | --- | --- |
| `test1234` | `b64f4499-212a-426c-a939-f58e8747d680` (`detest` 소유) | `404`, `{"error":"이 계정의 메모를 찾을 수 없습니다."}` | 각 계정 3건 |
| `detest` | `538b3c03-5e58-4a48-b043-ef0345d132e1` (`test1234` 소유) | `404`, `{"error":"이 계정의 메모를 찾을 수 없습니다."}` | 각 계정 3건 |

합성 검사에서 관찰한 질문 값 두 쌍(서로 다른 요청, 이미 폐기된 값):

| 종류 | 첫 요청 | 다음 요청 |
| --- | --- | --- |
| 등록 | `RESO8UHmau4WtvinxPiQC4qG_FAHjGn8qjDgU12CKto` | `B-uGP16KC53zb-E6tsYzuJ-EnMT3IHb9NIGJi6ngc1U` |
| 로그인 | `eafvnLxC0YQOzU92iLlhDSGQcxzjFsgX0RWhbWqb-AQ` | `tCNrBwKX9wjkyvtCQFqir5yANan8stIzpOfzMRn6Ux4` |

등록 취소 뒤 계정·패스키·질문 행이 모두 0건임을 확인했다. DB의 `passkeys.public_key`는 77바이트 공개키 BLOB으로 저장됐고, `users` 테이블에는 비밀번호 열이 없다. 등록 응답에는 공개키와 자격 증명 정보만 있으며 개인키는 포함되지 않는다. 합성 자동 검사에서 저장된 공개키의 base64url 값 한 건은 아래와 같다. 이는 비밀번호나 개인키가 아니다.

합성 검사에서 서버로 보낸 등록 확인 요청의 본문 구조(긴 인코딩 값만 가림):

```json
{
  "action": "registration-verify",
  "data": {
    "mode": "new",
    "challengeId": "[합성 질문 ID]",
    "response": {
      "id": "[합성 자격 증명 ID]",
      "rawId": "[합성 자격 증명 ID]",
      "type": "public-key",
      "response": {
        "clientDataJSON": "[base64url]",
        "attestationObject": "[공개키가 포함된 base64url]",
        "transports": ["internal"]
      },
      "clientExtensionResults": {},
      "authenticatorAttachment": "platform"
    },
    "notes": ["가상의 프로젝트 메모", "가상의 목록", "가상의 회고"]
  }
}
```

이 요청에는 개인키 필드가 없다. 기기에서 생성한 개인키는 WebAuthn 등록 응답에 포함되지 않으며, 서버는 검증을 마친 공개키만 `passkeys.public_key`에 저장한다.

```text
pQECAyYgASFYIOYGg0TAQOioDNDyaPcCrGP2tE11jjoKsSjGIXuBkHA8Ilgg_3oIcTxl3b6XFtfAZnO2D4P4_XJKJqxn_jD0ks8V_wA
```

실제 계정의 공개키 저장값은 등록 뒤 아래 읽기 전용 명령으로 확인할 수 있다. 결과에는 비밀키가 나오지 않지만, 실제 계정 이름은 공개 문서에 옮기지 않는다.

```powershell
node --env-file=.env.local scripts/inspect-public-key.mjs --username 본인이_등록한_아이디
```

로컬 실기기에서는 `test1234`에 패스키 2개를 등록하고 Windows 쪽 1개를 앱에서 삭제한 뒤, 남은 키로 다시 로그인했다. 삭제 전 두 패스키의 이름과 등록일이 보이는 [로컬 목록 화면](evidence/passkeys-two-registered-local.png)을 보관했다. `detest`에도 별도 패스키와 서로 다른 예시 메모 3건을 등록했다. 현재 로컬 DB에는 계정별 패스키 1개·메모 3건이 남아 있다. **공개 HTTPS 배포에서의 확인은 아직 완료로 기록하지 않는다.** 최종 도메인에서는 패스키를 새로 등록해야 하며, 지운 키로 로그인 거절·비로그인 직접 요청·공개키 저장값도 실배포에서 확인해 기록한다.

## ⑤ AI와 나

AI: 공개 소개를 유지한 채 패스키 서버·화면·합성 자동 검사를 구현했다. 사용자: 실제 패스키 보관 위치, 실제 기기에서의 두 패스키 확인, 배포 및 제출 범위를 최종 판단한다. AI 제안을 따르지 않은 일은 실제 협업 과정에서 생긴 사실만 제출 시 기록한다.

## ⑥ 아직 못 막은 것

- 가입·로그인 시도의 서버 측 횟수 제한이 없다. 대량 요청으로 DB 사용량이 늘거나 사용자 아이디를 탐색할 위험이 있다.
- 등록된 패스키를 모두 잃었을 때 복구 절차가 없다. 화면은 마지막 등록 기록의 삭제를 막지만, 실제 기기·패스키 관리자에 접근할 수 없으면 계정에 들어갈 수 없다.
- 패스키 삭제 전에 별도 재인증을 요구하지 않는다. 이미 열린 세션을 탈취당하면 남은 키 중 하나가 삭제될 수 있다.
