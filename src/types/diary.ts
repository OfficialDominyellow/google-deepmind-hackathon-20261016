/**
 * My Little Picasso — 핵심 데이터 모델 및 검증/일기/영구저장소 스키마 정의
 * 관찰 가능한 사실(Observed)과 추론(Inferred)을 구분하고,
 * 모든 일기 문장을 원본 사진 ID 및 검증 루프 상태와 연결한다.
 */

export type DiaryLanguage = "ko" | "en";
export type WeatherKind = "sunny" | "cloudy" | "rainy" | "snowy";
export type GroupingBasis =
  | "confirmed_date"
  | "visual_context_inferred"
  | "date_uncertain";

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
  /** 사용자가 수정하기 전 AI가 생성/검증한 원문 보존 */
  originalModelText?: string;
  /** 사용자가 직접 수정했는지 여부 (모델 출력과 사용자 수정 구분 보존) */
  isUserEdited?: boolean;
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

export interface VerificationAttemptRecord {
  attempt: number;
  stage: "initial_audit" | "repair_and_reverify" | "hallucination_test_audit";
  passed: boolean;
  repairedCount: number;
  omittedCount: number;
  critique: string;
  timestamp: string;
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
  history?: VerificationAttemptRecord[];
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

/**
 * 영구 저장소(Cloud Storage + Firestore)에 보관되는 원본 사진 메타데이터
 */
export interface StoredPhotoItem {
  photoId: string;
  fileName: string;
  mimeType: string;
  capturedAt: string | null;
  dateConfidence: "exif_verified" | "inferred" | "unknown";
  /** Cloud Storage 내부 객체 경로 (예: workspaces/{uuid}/photos/{photoId}.jpg) */
  gcsObjectPath: string;
  /** 브라우저 표시용 인증 미디어 URL 또는 Data URL */
  mediaUrl: string;
  width?: number;
  height?: number;
  duplicateOfPhotoId?: string | null;
  analysis: ObservedPhotoAnalysis;
}

/**
 * 한 페이지의 완성된 그림일기 (하나의 기억 그룹 = 한 페이지의 그림일기)
 */
export interface SavedDiaryPage {
  diaryId: string;
  workspaceId: string;
  language: DiaryLanguage;
  createdAt: string;
  updatedAt: string;
  /** 정렬용 ISO 날짜 문자열 (예: "2026-05-05"), 날짜 미상이면 null */
  dateIso: string | null;
  /** 일기장 상단에 표시할 날짜/요일 텍스트 */
  diaryDateText: string;
  /** 날씨 아이콘 */
  weather: WeatherKind;
  /** 그림일기 제목 */
  diaryTitle: string;
  isTitleUserEdited?: boolean;
  /** 기억 그룹화 기준 및 설명 */
  groupingBasis: GroupingBasis;
  groupingReason: string;
  /** 이 일기 페이지에 속한 원본 사진 목록 */
  photos: StoredPhotoItem[];
  /** 검증 및 복구를 거친 최종 문장 목록 */
  sentences: GroundedDiarySentence[];
  /** 전체 본문 텍스트 */
  fullDiaryText: string;
  /** 검증 및 복구 루프 상세 리포트 */
  verification: VerificationReport;
  /** 크레파스 일러스트 정보 */
  crayonIllustration: {
    generatedByModel: string;
    mimeType: string;
    gcsObjectPath?: string | null;
    mediaUrl?: string | null;
    base64Data?: string;
    promptUsed: string;
    fallbackSvgUsed: boolean;
    status: "ready" | "failed" | "retrying";
    errorMessage?: string;
  };
  meta: {
    primaryModel: string;
    verifierModel: string;
    illustrationModel: string;
    totalDurationMs: number;
    interactionIds: string[];
  };
}

/**
 * Memory Threads / Memory Time Machine 연결 노드 및 스레드 구조
 */
export interface MemoryThreadNode {
  diaryId: string;
  diaryTitle: string;
  diaryDateText: string;
  dateIso: string | null;
  photoId: string;
  photoFileName: string;
  photoMediaUrl: string;
  matchedClue: string;
}

export interface MemoryThreadConnection {
  threadId: string;
  title: string;
  category: "object" | "place" | "activity" | "growth_change";
  sharedSubject: string;
  summary: string;
  confidence: "high" | "medium";
  /** 왜 이 사진들이 연결되었는지 사진 속 실제 시각적/시간적 근거 */
  evidenceDescription: string;
  /** 사진만으로 단정할 수 없는 한계점 명시 */
  limitationNote: string;
  nodes: MemoryThreadNode[];
}

/**
 * 브라우저별 독립 사용자 공간(Workspace) 전체 상태
 */
export interface WorkspaceDocument {
  workspaceId: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  /** 전체 초기화나 삭제 시 진행 중인 AI 작업이 덮어쓰지 못하도록 하는 세대(Epoch) 번호 */
  generationEpoch: number;
  activeJobStatus?: "idle" | "running" | "completed" | "cancelled" | "failed";
  lastResetAt?: string | null;
  pendingDeletePaths?: string[];
  memoryThreads: MemoryThreadConnection[];
}
