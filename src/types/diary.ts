/**
 * My Little Picasso — 핵심 데이터 모델 및 검증/일기 스키마 정의
 * 관찰 가능한 사실(Observed)과 추론(Inferred)을 구분하고,
 * 모든 일기 문장을 원본 사진 ID 및 검증 루프 상태와 연결한다.
 */

export interface ObservedPhotoAnalysis {
  photoId: string;
  fileName: string;
  capturedAt?: string | null;
  dateConfidence: "exif_verified" | "inferred" | "unknown";
  /** 사진에서 직접 눈으로 확인 가능한 인물, 사물, 배경, 행동 단서 */
  observedFacts: string[];
  /** 반복 등장 연결(Memory Threads)을 위한 구체적 사물/장소 시각 특징 */
  visualDescriptors: {
    label: string;
    category: "object" | "place" | "activity" | "person_trait";
    attributes: string[];
  }[];
  /** 사진만으로 확정할 수 없는 불확실한 요소 및 한계 */
  uncertainties: string[];
  sceneSummary: string;
}

export interface GroundedDiarySentence {
  id: string;
  text: string;
  /** 이 문장을 뒷받침하는 원본 사진 ID 목록 */
  sourcePhotoIds: string[];
  /** 직접 관찰 사실인지, 사진 맥락에 기반한 합리적 추론인지 구분 */
  groundingType: "observed" | "context_inferred";
  /** 문장의 근거 설명 */
  evidenceNote: string;
}

export interface VerificationAuditItem {
  sentenceId: string;
  originalText: string;
  verdict: "PASS" | "REPAIRED" | "OMITTED";
  reason: string;
  repairedText?: string;
}

export interface VerificationReport {
  passed: boolean;
  attempts: number;
  deterministicChecks: {
    structureValid: boolean;
    photoRefsValid: boolean;
    dateValid: boolean;
    noFabricatedQuotes: boolean;
  };
  auditorCritique: string;
  sentenceAudits: VerificationAuditItem[];
  verifiedAt: string;
}

export interface HelloWorldDiaryResult {
  photoAnalysis: ObservedPhotoAnalysis;
  diaryTitle: string;
  diaryDateText: string;
  sentences: GroundedDiarySentence[];
  fullDiaryText: string;
  verification: VerificationReport;
  crayonIllustration?: {
    generatedByModel: string;
    mimeType: string;
    base64Data?: string;
    promptUsed: string;
    fallbackSvgUsed: boolean;
  };
  meta: {
    primaryModel: string;
    verifierModel: string;
    illustrationModel: string;
    totalDurationMs: number;
    interactionIds: string[];
  };
}

