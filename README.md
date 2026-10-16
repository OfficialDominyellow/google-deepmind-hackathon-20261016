# My Little Picasso 🎨

> **Memories, Drawn from Life.**  
> *"귀여움은 아이의 그림에서 나오고, 감동은 시간이 흐른다는 사실에서 나와야 해."*

**My Little Picasso**는 가족 사진을 단순 변환하는 앱이 아니라, 실제 사진에서 관찰 가능한 시각적 사실을 추출하고 여러 사진 사이의 맥락을 이해하여 **근거 있는(Grounded) 그림일기**와 **시간의 흐름을 잇는 추억 연결고리(Memory Threads)**를 자율적으로 만들어 보존하는 멀티모달 AI 메모리 에이전트입니다.

---

## 1. 기술 스택 및 해커톤 모델 구성

- **프레임워크**: Next.js 15 (App Router, TypeScript, Standalone 컨테이너 빌드)
- **스타일링**: Tailwind CSS v4 + 디지털 스케치북 커스텀 테마 (오래된 크림색 종이 `#F7F3E8`, 바랜 주황색 `#D96B43`, 머스터드 `#D9A441`, 흙빛 갈색 `#5C4A3E`, 차분한 올리브 `#6B7B5C`)
- **AI & 에이전트 SDK**: 공식 `@google/genai` (`>= 2.29.1`) **Interactions API** (`client.interactions.create`)
- **지정 모델**:
  - 핵심 추론·멀티모달 분석·독립 검증 루프: **`gemini-4-argon`** (`thinking_level` 제어)
  - 크레용 일러스트 생성: **`gemini-nano-banana-2.1`** (참조 사진 기반 크레용 질감 삽화 생성)
  - 매니지드 에이전트 호환: **`antigravity-preview-09-2026`**
- **GCP 프로젝트**: `h2gdm-hack26icn-2627` (`H2 KR GDM AI hack-2627`)

---

## 2. 로컬 실행 및 모델 검증 방법

### 환경 변수 설정
루트 디렉터리의 `.env.example`을 참고하여 `.env` 파일을 구성합니다 (보안을 위해 `.env`는 Git에 커밋되지 않습니다).

```bash
GEMINI_API_KEY=your_hackathon_gcp_api_key
GCP_PROJECT_ID=h2gdm-hack26icn-2627
```

### CLI 모델 연결 검증
```bash
npm run verify:gemini
```

### 개발 서버 실행
```bash
npm run dev
```
브라우저에서 `http://localhost:3000`에 접속하면 다음 기능을 바로 확인할 수 있습니다.
1. **`gemini-4-argon` 및 `gemini-nano-banana-2.1` 실시간 호환성 검증 패널**
2. **Hello World 엔드투엔드 파이프라인**:
   - 사진 업로드(EXIF 촬영일 자동 추출) 또는 샘플 가족 스냅샷 선택
   - `1단계` 멀티모달 관찰 사실(`observedFacts`) 및 불확실성(`uncertainties`) 분리 추출
   - `2단계` 문장별 근거 사진 ID가 연결된 따뜻한 그림일기 초안 생성
   - `3단계` 결정론적 검증 + 독립 감사관(Auditor) 모델 검증 및 수정 루프
   - `4단계` 크레용 질감 삽화 생성 및 디지털 스케치북 페이지 조립
