# My Little Picasso 🎨📒

**Tagline:** *Memories, Drawn from Life.*  
**Vision:** *Turn real family moments into illustrated memories that remain meaningful over time.*

> **"귀여움은 아이의 그림에서 나오고, 감동은 시간이 흐른다는 사실에서 나와야 해."**

My Little Picasso는 가족 사진을 예쁜 그림으로 바꾸는 단순한 필터 앱이 아닙니다.  
사진 속 관찰 가능한 사실을 이해하고, 여러 사진 사이의 시간적·시각적 맥락을 발견하여 기억 그룹으로 묶고, 사실에 근거한 일기를 작성하며, 실제 검증 및 복구 루프(2-Pass Verification & Repair Loop)를 거쳐 손으로 만든 듯한 크레파스 그림일기와 **시간을 잇는 기억의 실타래(Memory Threads / Memory Time Machine)**로 보존하는 자율형 멀티모달 AI 메모리 에이전트입니다.

---

## 🌐 배포 주소 (Google Cloud Run — `asia-northeast3`)

- **서비스 URL:** https://my-little-picasso-501770174905.asia-northeast3.run.app
- **라이브 헬스체크 API:** https://my-little-picasso-501770174905.asia-northeast3.run.app/api/health

---

## ✨ 핵심 기능 및 아키텍처

1. **다중 사진 업로드 & 기억 그룹화 (Batch Photo Ingestion & Memory Grouping)**
   - 다중 사진 업로드, EXIF 촬영 날짜 추출, 시각 핑거프린트(8x8 해시) 기반 중복 사진 자동 감지 및 제외
   - 확정된 촬영 날짜(`confirmed_date`), 시각 맥락 추정(`visual_context_inferred`), 날짜 미상 보존(`date_uncertain`)을 엄격히 구분하여 기억 그룹화
2. **멀티모달 사진 사실 추출 (`gemini-4-argon` via Interactions API)**
   - 사진에서 직접 관찰 가능한 사실(`observedFacts`), 반복 등장 사물·장소 시각 특징(`visualDescriptors`), 사진만으로 알 수 없는 불확실성(`uncertainties`) 분리 추출
3. **근거 기반 일기 작성 & 실제 2-Pass 검증·복구 루프 (Real Verification & Repair Loop)**
   - 각 일기 문장을 원본 사진 ID 및 관찰 사실(`observed`) / 맥락 추론(`context_inferred`)과 1:1 매핑
   - **1차 검증 패스:** 결정론적 규칙 검증 + `gemini-4-argon` 독립 감사자(Auditor)가 사진 근거 없는 문장 적발
   - **자동 복구 및 2차 재검증 패스:** 적발된 문장을 보수적으로 수정(`REPAIRED`)하거나 완전 삭제(`OMITTED`)한 뒤 **실제 2차 재검증 패스**를 수행하여 통과한 문장만 최종 반영 (UI에서 **허위 문장 강제 주입 테스트** 즉시 실행 가능)
4. **한국어 네모 원고지(`KO`) & 영어 Primary Writing Lines(`EN`) 그림일기장**
   - **한국어 모드 (`KO`):** 전통 초등학교 그림일기장의 **네모 원고지(Squared Manuscript Grid)**에 한 글자씩 들어가며 결정론적 손글씨 미세 흔들림이 적용된 실제 DOM 텍스트
   - **영어 모드 (`EN`):** 미국 초등학교 Draw-and-Write 줄공책의 **3선 Primary Writing Lines(상단선·중간 점선·기준선)** 양식 지원
   - **크레파스 일러스트 (`gemini-nano-banana-2.1`):** 관찰된 사실에만 기반해 따뜻한 어린이 크레파스 질감의 그림을 생성하며, 원본 가족 사진은 필터 없이 100% 무결성 보존
5. **Memory Threads / Memory Time Machine (시간을 잇는 기억의 실타래)**
   - 서로 다른 시기의 일기들 사이에서 반복 등장하는 사물(예: 노란 자전거), 장소, 아이의 성장 변화를 자동 발굴하여 타임라인으로 연결하고 시각적 근거와 추론 한계를 함께 표시
6. **로그인 없는 브라우저 전용 영구 저장소 & 삭제·초기화 (`Firestore` + `Cloud Storage`)**
   - 각 브라우저는 암호학적으로 안전한 `workspaceId` (UUID v4)와 비밀 토큰(`workspaceToken`)을 `localStorage`에 생성·보관하며, 서버는 `SHA-256(workspaceToken)` 해시를 타이밍 안전 비교(`timingSafeEqual`)로 검증하여 타 사용자의 UUID 조회·수정·삭제를 원천 차단(`403 Forbidden`)
   - **`Delete This Diary` (개별 일기 삭제):** 선택한 일기 페이지와 다른 일기에서 참조하지 않는 전용 Cloud Storage 미디어 파일만 즉시 영구 삭제
   - **`Reset My Workspace` (전체 작업 공간 초기화):** 세대 번호(`generationEpoch`)를 원자적으로 먼저 증가시켜 진행 중인 AI 생성 작업의 부활을 차단하고, 해당 UUID의 모든 Firestore 문서와 Cloud Storage 객체를 즉시 영구 파기 (버킷 Soft Delete `0초` 설정)

---

## 🛠️ 로컬 실행 및 클라우드 배포 방법

### 1. 환경 변수 설정 (`.env`)
`.env.example`을 참고하여 `.env` 파일을 구성합니다 (API 키는 절대 저장소에 커밋하지 마세요):
```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLOUD_PROJECT=h2gdm-hack26icn-2627
GOOGLE_CLOUD_LOCATION=asia-northeast3
FIRESTORE_DATABASE_ID=(default)
GCS_MEDIA_BUCKET=h2gdm-hack26icn-2627-picasso-media
```

### 2. 로컬 개발 서버 및 통합 검증 실행
```bash
npm install
npm run dev
# 별도 터미널에서 13개 항목 클라우드 영구 저장·격리·삭제·초기화 통합 검증 실행
node scripts/verify-cloud-persistence.mjs
```

### 3. Google Cloud Run 배포 (`asia-northeast3`)
```bash
gcloud run deploy my-little-picasso \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```
