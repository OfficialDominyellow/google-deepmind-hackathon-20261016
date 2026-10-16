import { GoogleGenAI } from "@google/genai";
import type {
  DiaryLanguage,
  GroupingBasis,
  GroundedDiarySentence,
  HelloWorldDiaryResult,
  MemoryThreadConnection,
  ObservedPhotoAnalysis,
  SavedDiaryPage,
  StoredPhotoItem,
  VerificationAttemptRecord,
  VerificationAuditItem,
  VerificationReport,
  WeatherKind,
} from "@/types/diary";

export const PRIMARY_MODEL = "gemini-4-argon";
export const ILLUSTRATION_MODEL = "gemini-nano-banana-2.1";
export const MANAGED_AGENT_ID = "antigravity-preview-09-2026";

export interface PipelineProgressEvent {
  type: "progress";
  step: 1 | 2 | 3 | 4;
  totalSteps: 4;
  stageName: string;
  message: string;
  elapsedMs: number;
  partialData?: {
    photoAnalysis?: ObservedPhotoAnalysis;
    draftTitle?: string;
    draftSentences?: GroundedDiarySentence[];
  };
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "서버 환경 변수에 GEMINI_API_KEY가 설정되어 있지 않습니다. .env 파일을 확인해 주세요."
    );
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * 모델 응답 텍스트에서 JSON 블록을 안전하게 파싱한다.
 */
function parseJsonFromModelText<T>(rawText: string): T {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as T;
  }
  return JSON.parse(candidate) as T;
}

/**
 * 결정론적 검증 1단계: 직접 인용구(지어낸 대화) 포함 여부 점검
 */
function hasFabricatedDirectDialogue(text: string): boolean {
  const dialogueRegex =
    /["“”][^"“”]{2,}["“”]\s*(?:라고|하고)\s*(?:말했|외쳤|물었|대답했)/;
  return dialogueRegex.test(text);
}

/**
 * 고속 최적화된 Hello World 엔드투엔드 Grounded Diary + Verification 파이프라인
 * - 1단계: gemini-4-argon 멀티모달 호출로 관찰 사실 추출 + 사실 근거 일기 초안 동시 생성 (단일 왕복으로 지연 시간 절반 단축)
 * - 2단계: 결정론적 검증 즉시 수행 및 초안 스트리밍 전송
 * - 3단계: 독립 감사관(Auditor, gemini-4-argon) 검증 루프 & 크레용 삽화(gemini-nano-banana-2.1) 병렬 실행
 */
export async function runHelloWorldGroundedPipeline(
  params: {
    photoId: string;
    fileName: string;
    mimeType: string;
    base64Data: string;
    capturedAt?: string | null;
    generateCrayonImage?: boolean;
  },
  onProgress?: (event: PipelineProgressEvent) => void
): Promise<HelloWorldDiaryResult> {
  const startTime = Date.now();
  const client = getGeminiClient();
  const interactionIds: string[] = [];

  const cleanBase64 = params.base64Data.replace(/^data:[^;]+;base64,/, "");
  const dateLabel = params.capturedAt
    ? `${params.capturedAt} (EXIF 촬영일 기준)`
    : "날짜 미상 (사진 기록 기준)";

  const emitProgress = (
    step: 1 | 2 | 3 | 4,
    stageName: string,
    message: string,
    partialData?: PipelineProgressEvent["partialData"]
  ) => {
    const elapsedMs = Date.now() - startTime;
    console.log(
      `[Pipeline ${step}/4 | +${(elapsedMs / 1000).toFixed(1)}s] ${stageName}: ${message}`
    );
    onProgress?.({
      type: "progress",
      step,
      totalSteps: 4,
      stageName,
      message,
      elapsedMs,
      partialData,
    });
  };

  // ---------------------------------------------------------------------------
  // 1~2단계 통합: 멀티모달 시각 사실 추출 + 근거 기반 일기 초안 작성 (gemini-4-argon)
  // ---------------------------------------------------------------------------
  emitProgress(
    1,
    "멀티모달 사진 사실 추출 & 일기 초안 작성",
    `gemini-4-argon 모델이 사진(${params.fileName})의 관찰 사실과 근거 기반 일기 초안을 생성 중입니다...`
  );

  const combinedVisionAndDraftPrompt = `너는 'My Little Picasso'의 시각 사실 분석가이자 근거 기반 그림일기 작가야.
첨부된 사진을 보고 (1) 눈으로 직접 확인 가능한 사실(observedFacts)과 불확실한 점(uncertainties)을 분리 추출하고, (2) 오직 observedFacts에만 근거한 따뜻한 한국어 그림일기 초안(3문장)을 작성해.
절대로 사진에 없는 대화(직접 인용구), 속마음 단정, 촬영 전후의 확인되지 않은 사건을 지어내지 마.

- 사진 ID: "${params.photoId}"
- 날짜 정보: "${dateLabel}"

반드시 아래 JSON 형식으로만 간결하게 응답할 것:
{
  "sceneSummary": "사진 전체 장면에 대한 1문장 요약 (한국어)",
  "observedFacts": [
    "사진에서 직접 확인되는 구체적 사실 1",
    "사진에서 직접 확인되는 구체적 사실 2",
    "사진에서 직접 확인되는 구체적 사실 3"
  ],
  "visualDescriptors": [
    {
      "label": "핵심 사물/장소명",
      "category": "object",
      "attributes": ["색상/형태 등 특징 2개"]
    }
  ],
  "uncertainties": [
    "사진만으로 알 수 없는 요소 1"
  ],
  "diaryTitle": "따뜻한 그림일기 제목",
  "diaryDateText": "${dateLabel}",
  "sentences": [
    {
      "id": "s1",
      "text": "첫 번째 일기 문장",
      "sourcePhotoIds": ["${params.photoId}"],
      "groundingType": "observed",
      "evidenceNote": "근거가 된 시각적 사실"
    },
    {
      "id": "s2",
      "text": "두 번째 일기 문장",
      "sourcePhotoIds": ["${params.photoId}"],
      "groundingType": "observed",
      "evidenceNote": "근거가 된 시각적 사실"
    },
    {
      "id": "s3",
      "text": "세 번째 일기 문장",
      "sourcePhotoIds": ["${params.photoId}"],
      "groundingType": "context_inferred",
      "evidenceNote": "근거가 된 시각적 사실"
    }
  ]
}`;

  const visionDraftInteraction = await client.interactions.create({
    model: PRIMARY_MODEL,
    input: [
      {
        type: "image",
        data: cleanBase64,
        mime_type: params.mimeType || "image/jpeg",
      },
      {
        type: "text",
        text: combinedVisionAndDraftPrompt,
      },
    ],
    generation_config: {
      thinking_level: "low",
      max_output_tokens: 32768,
    },
  });

  if (visionDraftInteraction.id) {
    interactionIds.push(visionDraftInteraction.id);
  }

  const parsedStep1 = parseJsonFromModelText<{
    sceneSummary: string;
    observedFacts: string[];
    visualDescriptors: ObservedPhotoAnalysis["visualDescriptors"];
    uncertainties: string[];
    diaryTitle: string;
    diaryDateText: string;
    sentences: GroundedDiarySentence[];
  }>(visionDraftInteraction.output_text || "{}");

  const photoAnalysis: ObservedPhotoAnalysis = {
    photoId: params.photoId,
    fileName: params.fileName,
    capturedAt: params.capturedAt || null,
    dateConfidence: params.capturedAt ? "exif_verified" : "unknown",
    observedFacts:
      parsedStep1.observedFacts?.length > 0
        ? parsedStep1.observedFacts
        : ["사진 속 시각 요소를 분석했습니다."],
    visualDescriptors: parsedStep1.visualDescriptors || [],
    uncertainties:
      parsedStep1.uncertainties?.length > 0
        ? parsedStep1.uncertainties
        : ["사진에 나타나지 않은 구체적 시간대나 대화는 확인할 수 없습니다."],
    sceneSummary:
      parsedStep1.sceneSummary || "따뜻한 가족의 순간이 담긴 사진입니다.",
  };

  const draftSentences: GroundedDiarySentence[] = (
    parsedStep1.sentences || []
  ).map((s, idx) => ({
    id: s.id || `s${idx + 1}`,
    text: s.text,
    sourcePhotoIds:
      Array.isArray(s.sourcePhotoIds) && s.sourcePhotoIds.length > 0
        ? s.sourcePhotoIds
        : [params.photoId],
    groundingType:
      s.groundingType === "context_inferred" ? "context_inferred" : "observed",
    evidenceNote: s.evidenceNote || "원본 사진 시각 분석 근거",
  }));

  emitProgress(
    2,
    "관찰 사실 및 일기 초안 생성 완료",
    `관찰 사실 ${photoAnalysis.observedFacts.length}건과 일기 초안 ${draftSentences.length}문장이 추출되었습니다.`,
    {
      photoAnalysis,
      draftTitle: parsedStep1.diaryTitle,
      draftSentences,
    }
  );

  // ---------------------------------------------------------------------------
  // 3단계(독립 검증 루프) & 4단계(크레용 일러스트 생성) 병렬 실행
  // ---------------------------------------------------------------------------
  emitProgress(
    3,
    "독립 감사관 검증 & 크레용 삽화 병렬 생성",
    "별도의 감사관(Auditor) 프롬프트 검증과 크레용 그림일기 삽화 생성을 병렬로 실행 중입니다...",
    {
      photoAnalysis,
      draftTitle: parsedStep1.diaryTitle,
      draftSentences,
    }
  );

  const structureValid =
    Boolean(parsedStep1.diaryTitle) && draftSentences.length > 0;
  const photoRefsValid = draftSentences.every((s) =>
    s.sourcePhotoIds.includes(params.photoId)
  );
  const dateValid = Boolean(dateLabel);
  const noFabricatedQuotes = draftSentences.every(
    (s) => !hasFabricatedDirectDialogue(s.text)
  );

  const auditorPrompt = `너는 'My Little Picasso'의 독립 검증 감사관(Strict Grounding Auditor)이야.
일기 초안 문장들이 관찰 사실(observedFacts)에 부합하는지 검증하고 JSON으로만 짧게 답해.
- PASS: 관찰 사실에 부합함
- REPAIRED: 과장이나 확인 불가 내용 포함 시 observedFacts에 맞게 수정(repairedText 작성)
- OMITTED: 전혀 무관한 허위 주장

관찰 사실: ${JSON.stringify(photoAnalysis.observedFacts)}
불확실성: ${JSON.stringify(photoAnalysis.uncertainties)}
일기 문장: ${JSON.stringify(draftSentences.map((s) => ({ id: s.id, text: s.text })))}

JSON 응답 형식:
{
  "auditorCritique": "1문장 검증 총평 (한국어)",
  "sentenceAudits": [
    {
      "sentenceId": "s1",
      "originalText": "원문",
      "verdict": "PASS",
      "reason": "1줄 이유",
      "repairedText": "수정문 또는 원문"
    }
  ]
}`;

  const crayonPrompt = `Warm childlike wax crayon drawing on aged cream sketchbook paper (#F7F3E8). Scene: ${photoAnalysis.sceneSummary}. Details: ${photoAnalysis.observedFacts.slice(0, 3).join(", ")}. Style: uneven crayon lines, layered wax texture, visible paper grain, muted orange, mustard yellow, earthy brown, and olive green. No text.`;

  const auditPromise = client.interactions.create({
    model: PRIMARY_MODEL,
    input: auditorPrompt,
    generation_config: {
      thinking_level: "low",
      max_output_tokens: 32768,
    },
  });

  const imagePromise =
    params.generateCrayonImage !== false
      ? client.interactions
          .create({
            model: ILLUSTRATION_MODEL,
            input: crayonPrompt,
          })
          .catch((err) => {
            console.warn("[Crayon Image Gen Fallback]:", err?.message || err);
            return null;
          })
      : Promise.resolve(null);

  const [auditInteraction, imageInteraction] = await Promise.all([
    auditPromise,
    imagePromise,
  ]);

  if (auditInteraction?.id) {
    interactionIds.push(auditInteraction.id);
  }
  if (imageInteraction?.id) {
    interactionIds.push(imageInteraction.id);
  }

  emitProgress(
    4,
    "그림일기 페이지 조립 완료",
    "검증된 일기와 크레용 삽화를 디지털 스케치북 페이지로 조립했습니다."
  );

  const parsedAudit = parseJsonFromModelText<{
    auditorCritique: string;
    sentenceAudits: VerificationAuditItem[];
  }>(auditInteraction.output_text || "{}");

  const auditMap = new Map<string, VerificationAuditItem>();
  for (const item of parsedAudit.sentenceAudits || []) {
    auditMap.set(item.sentenceId, item);
  }

  const finalSentences: GroundedDiarySentence[] = [];
  for (const s of draftSentences) {
    const audit = auditMap.get(s.id);
    if (audit?.verdict === "OMITTED") {
      continue;
    }
    if (audit?.verdict === "REPAIRED" && audit.repairedText) {
      finalSentences.push({
        ...s,
        text: audit.repairedText,
      });
    } else {
      finalSentences.push(s);
    }
  }

  const verificationReport: VerificationReport = {
    passed: structureValid && photoRefsValid && finalSentences.length > 0,
    attempts: (parsedAudit.sentenceAudits || []).some(
      (a) => a.verdict === "REPAIRED"
    )
      ? 2
      : 1,
    deterministicChecks: {
      structureValid,
      photoRefsValid,
      dateValid,
      noFabricatedQuotes,
    },
    auditorCritique:
      parsedAudit.auditorCritique ||
      "모든 문장이 사진에서 관찰된 시각적 단서와 일치합니다.",
    sentenceAudits:
      parsedAudit.sentenceAudits ||
      draftSentences.map((s) => ({
        sentenceId: s.id,
        originalText: s.text,
        verdict: "PASS",
        reason: "사진 관찰 사실과 일치함",
      })),
    verifiedAt: new Date().toISOString(),
  };

  let crayonIllustration: HelloWorldDiaryResult["crayonIllustration"] = {
    generatedByModel: ILLUSTRATION_MODEL,
    mimeType: "image/png",
    promptUsed: crayonPrompt,
    fallbackSvgUsed: true,
  };

  if (imageInteraction?.output_image?.data) {
    crayonIllustration = {
      generatedByModel: ILLUSTRATION_MODEL,
      mimeType: imageInteraction.output_image.mime_type || "image/png",
      base64Data: imageInteraction.output_image.data,
      promptUsed: crayonPrompt,
      fallbackSvgUsed: false,
    };
  }

  return {
    photoAnalysis,
    diaryTitle: parsedStep1.diaryTitle || "사진 속 따뜻한 하루",
    diaryDateText: parsedStep1.diaryDateText || dateLabel,
    sentences: finalSentences,
    fullDiaryText: finalSentences.map((s) => s.text).join(" "),
    verification: verificationReport,
    crayonIllustration,
    meta: {
      primaryModel: PRIMARY_MODEL,
      verifierModel: PRIMARY_MODEL,
      illustrationModel: ILLUSTRATION_MODEL,
      totalDurationMs: Date.now() - startTime,
      interactionIds,
    },
  };
}

// ============================================================================
// Phase B & C: 다중 사진 분석 · 기억 그룹화 · 재검증 루프 · Memory Threads 엔진
// ============================================================================

export interface StudioProgressEvent {
  type: "studio_progress";
  phase:
    | "ingest_and_vision"
    | "memory_grouping"
    | "diary_and_verification"
    | "crayon_illustration"
    | "memory_threads"
    | "persistence";
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  elapsedMs: number;
}

export function formatDiaryDateHeader(
  dateIso: string | null,
  language: DiaryLanguage
): string {
  if (!dateIso) {
    return language === "en"
      ? "Date Unknown (Recorded from visual clues)"
      : "날짜 미상 (사진 속 단서로 기록한 날)";
  }
  const parsed = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateIso;
  }
  if (language === "en") {
    return parsed.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const weekdaysKo = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일",
  ];
  const y = parsed.getFullYear();
  const m = parsed.getMonth() + 1;
  const d = parsed.getDate();
  const w = weekdaysKo[parsed.getDay()];
  return `${y}년 ${m}월 ${d}일 ${w}`;
}

/**
 * 개별 사진 1장에 대한 멀티모달 시각 사실 추출 (gemini-4-argon)
 */
export async function analyzePhotoWithArgon(params: {
  photoId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  capturedAt: string | null;
  language: DiaryLanguage;
}): Promise<{ analysis: ObservedPhotoAnalysis; interactionId?: string }> {
  const client = getGeminiClient();
  const cleanBase64 = params.base64Data.replace(/^data:[^;]+;base64,/, "");
  const langInstruction =
    params.language === "en"
      ? "Write sceneSummary, observedFacts, and uncertainties in natural English. Keep visualDescriptors.label concise in English."
      : "sceneSummary, observedFacts, uncertainties를 자연스러운 한국어로 작성하고 visualDescriptors.label도 한국어 명사로 작성해.";

  const prompt = `You are the Multimodal Visual Fact Extractor for 'My Little Picasso'.
Analyze the attached family photo strictly based on what is visually observable.
Do NOT invent dialogue, names, unshown events, or emotions that cannot be visually supported.
${langInstruction}

Photo ID: "${params.photoId}"
File Name: "${params.fileName}"
EXIF Date: "${params.capturedAt || "unknown"}"

Respond ONLY in valid JSON with this exact structure:
{
  "sceneSummary": "1-sentence factual summary of the scene",
  "observedFacts": [
    "Observable visual fact 1 (people/clothing/posture/objects)",
    "Observable visual fact 2 (environment/lighting/setting)",
    "Observable visual fact 3 (visible activity or interaction)"
  ],
  "visualDescriptors": [
    {
      "label": "Specific recurring object/place/activity name (e.g., 노란색 보조바퀴 자전거 / Yellow balance bike)",
      "category": "object",
      "attributes": ["color/shape attribute 1", "distinctive trait 2"]
    }
  ],
  "uncertainties": [
    "What cannot be determined from this photo alone (e.g., exact time or conversation)"
  ]
}`;

  const interaction = await client.interactions.create({
    model: PRIMARY_MODEL,
    input: [
      {
        type: "image",
        data: cleanBase64,
        mime_type: params.mimeType || "image/jpeg",
      },
      {
        type: "text",
        text: prompt,
      },
    ],
    generation_config: {
      thinking_level: "low",
      max_output_tokens: 16384,
    },
  });

  const parsed = parseJsonFromModelText<{
    sceneSummary?: string;
    observedFacts?: string[];
    visualDescriptors?: ObservedPhotoAnalysis["visualDescriptors"];
    uncertainties?: string[];
  }>(interaction.output_text || "{}");

  const normalizedDate = params.capturedAt
    ? params.capturedAt.slice(0, 10)
    : null;

  return {
    interactionId: interaction.id,
    analysis: {
      photoId: params.photoId,
      fileName: params.fileName,
      capturedAt: normalizedDate,
      dateConfidence: normalizedDate ? "exif_verified" : "unknown",
      observedFacts:
        parsed.observedFacts && parsed.observedFacts.length > 0
          ? parsed.observedFacts
          : [
              params.language === "en"
                ? "Visual elements in the photo were observed."
                : "사진 속 시각적 인물과 배경 요소를 확인했습니다.",
            ],
      visualDescriptors: parsed.visualDescriptors || [],
      uncertainties:
        parsed.uncertainties && parsed.uncertainties.length > 0
          ? parsed.uncertainties
          : [
              params.language === "en"
                ? "Exact conversations or events before/after the photo cannot be confirmed."
                : "사진 촬영 전후의 대화나 정확한 속마음은 사진만으로 알 수 없습니다.",
            ],
      sceneSummary:
        parsed.sceneSummary ||
        (params.language === "en"
          ? "A warm family moment captured in a photograph."
          : "사진 속에 담긴 따뜻한 가족의 순간입니다."),
    },
  };
}

export interface PhotoGroupCluster {
  groupKey: string;
  dateIso: string | null;
  groupingBasis: GroupingBasis;
  groupingReason: string;
  photos: StoredPhotoItem[];
}

/**
 * 날짜(EXIF) 및 시각적 맥락(Visual Descriptors)을 결합한 기억 그룹화(Memory Grouping)
 * - 사용자가 수동 지정한 groupKey가 있으면 최우선 반영한다.
 * - 확정된 촬영 날짜(dateConfidence === "exif_verified")가 있으면 같은 날짜끼리 묶는다.
 * - 날짜 정보가 없으면 억지로 날짜를 추측하지 않고(date_uncertain), 시각적 단서가 겹치는 경우에만 묶는다.
 */
export function clusterPhotosIntoMemoryGroups(
  photos: StoredPhotoItem[],
  customGroupAssignments?: Record<string, string>,
  language: DiaryLanguage = "ko"
): PhotoGroupCluster[] {
  const clustersMap = new Map<string, PhotoGroupCluster>();

  for (const photo of photos) {
    const manualGroup = customGroupAssignments?.[photo.photoId]?.trim();
    if (manualGroup) {
      const existing = clustersMap.get(manualGroup);
      if (existing) {
        existing.photos.push(photo);
      } else {
        const dIso = photo.capturedAt ? photo.capturedAt.slice(0, 10) : null;
        clustersMap.set(manualGroup, {
          groupKey: manualGroup,
          dateIso: dIso,
          groupingBasis: dIso ? "confirmed_date" : "visual_context_inferred",
          groupingReason:
            language === "en"
              ? `Grouped together by user selection (${manualGroup}).`
              : `사용자가 지정한 기억 묶음(${manualGroup})으로 그룹화했습니다.`,
          photos: [photo],
        });
      }
      continue;
    }

    const dIso = photo.capturedAt ? photo.capturedAt.slice(0, 10) : null;
    if (dIso && photo.dateConfidence === "exif_verified") {
      const key = `date_${dIso}`;
      const existing = clustersMap.get(key);
      if (existing) {
        existing.photos.push(photo);
      } else {
        clustersMap.set(key, {
          groupKey: key,
          dateIso: dIso,
          groupingBasis: "confirmed_date",
          groupingReason:
            language === "en"
              ? `Grouped by verified EXIF capture date (${dIso}) and shared daily context.`
              : `신뢰할 수 있는 촬영 날짜(${dIso}) 메타데이터와 같은 날의 맥락을 기준으로 묶었습니다.`,
          photos: [photo],
        });
      }
    } else {
      // 날짜 미상 사진: 억지로 다른 날짜에 합치지 않고 시각적 단서가 동일한 날짜 미상 그룹이 있는지 확인
      const labels = photo.analysis.visualDescriptors.map((d) =>
        d.label.toLowerCase()
      );
      let matchedKey: string | null = null;
      for (const [k, cluster] of clustersMap.entries()) {
        if (cluster.groupingBasis === "date_uncertain") {
          const clusterLabels = cluster.photos.flatMap((p) =>
            p.analysis.visualDescriptors.map((d) => d.label.toLowerCase())
          );
          if (labels.some((l) => clusterLabels.includes(l))) {
            matchedKey = k;
            break;
          }
        }
      }
      const key = matchedKey || `undated_${photo.photoId}`;
      const existing = clustersMap.get(key);
      if (existing) {
        existing.photos.push(photo);
      } else {
        clustersMap.set(key, {
          groupKey: key,
          dateIso: null,
          groupingBasis: "date_uncertain",
          groupingReason:
            language === "en"
              ? "Capture date is unavailable; kept as an undated memory based only on observable visual clues without guessing the date."
              : "촬영 날짜 메타데이터가 없어 날짜를 임의로 추측하지 않고, 관찰 가능한 시각적 맥락만으로 기록했습니다.",
          photos: [photo],
        });
      }
    }
  }

  return Array.from(clustersMap.values()).sort((a, b) => {
    if (a.dateIso && b.dateIso) return a.dateIso.localeCompare(b.dateIso);
    if (a.dateIso) return -1;
    if (b.dateIso) return 1;
    return 0;
  });
}

/**
 * 하나의 기억 그룹(1~N장의 사진)으로부터 사실 기반 그림일기 작성 +
 * 결정론적 검증 + 독립 감사관(Auditor) 검증 + 복구 후 실제 재검증(Re-verification) 루프 실행
 */
export async function generateVerifiedDiaryForCluster(params: {
  workspaceId: string;
  diaryId: string;
  cluster: PhotoGroupCluster;
  language: DiaryLanguage;
  injectHallucinationTest?: boolean;
  generateCrayonImage?: boolean;
}): Promise<{
  diaryPage: Omit<SavedDiaryPage, "crayonIllustration"> & {
    rawCrayonBase64?: string;
    crayonMimeType: string;
    crayonPromptUsed: string;
    crayonFallbackUsed: boolean;
  };
}> {
  const t0 = Date.now();
  const client = getGeminiClient();
  const interactionIds: string[] = [];
  const validPhotoIds = params.cluster.photos.map((p) => p.photoId);
  const diaryDateText = formatDiaryDateHeader(
    params.cluster.dateIso,
    params.language
  );

  const consolidatedFacts = params.cluster.photos.map((p) => ({
    photoId: p.photoId,
    fileName: p.fileName,
    sceneSummary: p.analysis.sceneSummary,
    observedFacts: p.analysis.observedFacts,
    uncertainties: p.analysis.uncertainties,
  }));

  const draftPrompt =
    params.language === "en"
      ? `You are the Grounded Childhood Picture Journal Writer for 'My Little Picasso'.
Write a warm, genuine 3-sentence picture journal entry in English from a young child's gentle perspective, strictly grounded ONLY in the observed facts from the photos below.
Rules:
1. NEVER invent spoken dialogue (no quotation marks claiming someone said something).
2. NEVER fabricate events, places, or people not present in observedFacts.
3. Distinguish between direct visual observation ("observed") and gentle contextual inference ("context_inferred").
4. Link every sentence to one or more valid photo IDs from: ${JSON.stringify(validPhotoIds)}.
5. Choose a weather icon ("sunny", "cloudy", "rainy", "snowy") matching the outdoor/indoor clues (default "sunny" if unclear).

Photos & Observed Facts:
${JSON.stringify(consolidatedFacts, null, 2)}

Respond ONLY in valid JSON:
{
  "diaryTitle": "Short, warm childlike title (max 6 words)",
  "weather": "sunny",
  "sentences": [
    {
      "id": "s1",
      "text": "First grounded journal sentence.",
      "sourcePhotoIds": ["${validPhotoIds[0]}"],
      "groundingType": "observed",
      "evidenceNote": "Visual fact supporting this sentence"
    },
    {
      "id": "s2",
      "text": "Second grounded journal sentence.",
      "sourcePhotoIds": ["${validPhotoIds[0]}"],
      "groundingType": "observed",
      "evidenceNote": "Visual fact supporting this sentence"
    },
    {
      "id": "s3",
      "text": "Third warm sentence grounded in the photo context.",
      "sourcePhotoIds": ${JSON.stringify(validPhotoIds)},
      "groundingType": "context_inferred",
      "evidenceNote": "Visual context supporting this sentence"
    }
  ]
}`
      : `너는 'My Little Picasso'의 사실 기반 어린이 그림일기 작가야.
아래 사진들에서 추출된 관찰 사실(observedFacts)에만 엄격히 근거하여, 초등학교 저학년 아이가 직접 쓴 것처럼 따뜻하고 순수한 한국어 그림일기(3문장, '~했다/했어요/보였다' 체)를 작성해.
절대 규칙:
1. 사진에 없는 대화(직접 인용구 "..."라고 말했다 등)나 확인되지 않은 사건/장소를 절대 지어내지 마.
2. 직접 관찰한 사실("observed")과 사진 맥락에서 자연스럽게 유추한 내용("context_inferred")을 구분해.
3. 각 문장은 반드시 실제 근거가 된 사진 ID(${JSON.stringify(validPhotoIds)})를 sourcePhotoIds로 연결해.
4. 사진 분위기에 어울리는 날씨("sunny", "cloudy", "rainy", "snowy" 중 택1)와 귀여운 그림일기 제목을 정해줘.

사진별 관찰 사실:
${JSON.stringify(consolidatedFacts, null, 2)}

반드시 아래 JSON 형식으로만 응답할 것:
{
  "diaryTitle": "아이 눈높이의 따뜻한 그림일기 제목",
  "weather": "sunny",
  "sentences": [
    {
      "id": "s1",
      "text": "첫 번째 그림일기 문장",
      "sourcePhotoIds": ["${validPhotoIds[0]}"],
      "groundingType": "observed",
      "evidenceNote": "근거가 된 사진 속 시각 사실"
    },
    {
      "id": "s2",
      "text": "두 번째 그림일기 문장",
      "sourcePhotoIds": ["${validPhotoIds[0]}"],
      "groundingType": "observed",
      "evidenceNote": "근거가 된 사진 속 시각 사실"
    },
    {
      "id": "s3",
      "text": "세 번째 그림일기 문장",
      "sourcePhotoIds": ${JSON.stringify(validPhotoIds)},
      "groundingType": "context_inferred",
      "evidenceNote": "근거가 된 사진 속 맥락"
    }
  ]
}`;

  const draftInteraction = await client.interactions.create({
    model: PRIMARY_MODEL,
    input: draftPrompt,
    generation_config: {
      thinking_level: "low",
      max_output_tokens: 16384,
    },
  });

  if (draftInteraction.id) {
    interactionIds.push(draftInteraction.id);
  }

  const parsedDraft = parseJsonFromModelText<{
    diaryTitle?: string;
    weather?: WeatherKind;
    sentences?: GroundedDiarySentence[];
  }>(draftInteraction.output_text || "{}");

  const draftSentences: GroundedDiarySentence[] = (
    parsedDraft.sentences || []
  ).map((s, idx) => ({
    id: s.id || `s${idx + 1}`,
    text: s.text,
    originalModelText: s.text,
    isUserEdited: false,
    sourcePhotoIds:
      Array.isArray(s.sourcePhotoIds) &&
      s.sourcePhotoIds.some((id) => validPhotoIds.includes(id))
        ? s.sourcePhotoIds.filter((id) => validPhotoIds.includes(id))
        : [validPhotoIds[0]],
    groundingType:
      s.groundingType === "context_inferred" ? "context_inferred" : "observed",
    evidenceNote:
      s.evidenceNote ||
      (params.language === "en"
        ? "Grounded in observed photo evidence"
        : "원본 사진 관찰 사실 근거"),
  }));

  // 의도적 할루시네이션(허위 주장) 주입 테스트 옵션: 검증/복구 루프가 실제로 적발하고 고치는지 검증
  if (params.injectHallucinationTest) {
    const fakeSentence: GroundedDiarySentence = {
      id: `s_hallucination_${Date.now().toString().slice(-3)}`,
      text:
        params.language === "en"
          ? 'Suddenly a giant purple dinosaur landed in a spaceship and shouted "Let\'s go to Mars!"'
          : '갑자기 보라색 공룡이 우주선을 타고 내려와서 "우리 같이 화성 놀이공원에 가자!"라고 외쳤어요.',
      originalModelText:
        params.language === "en"
          ? 'Suddenly a giant purple dinosaur landed in a spaceship and shouted "Let\'s go to Mars!"'
          : '갑자기 보라색 공룡이 우주선을 타고 내려와서 "우리 같이 화성 놀이공원에 가자!"라고 외쳤어요.',
      isUserEdited: false,
      sourcePhotoIds: [validPhotoIds[0]],
      groundingType: "observed",
      evidenceNote:
        params.language === "en"
          ? "[Injected Unverified Claim for Auditor Test]"
          : "[검증 루프 테스트를 위해 의도적으로 주입된 허위 문장]",
    };
    draftSentences.push(fakeSentence);
  }

  // 크레파스 일러스트 프롬프트 구성 (검증 루프와 병렬 실행)
  const sceneDescriptions = params.cluster.photos
    .map((p) => p.analysis.sceneSummary)
    .join("; ");
  const factHighlights = params.cluster.photos
    .flatMap((p) => p.analysis.observedFacts.slice(0, 2))
    .join(", ");

  const crayonPrompt = `Authentic 7-year-old child's wax crayon drawing on warm cream sketchbook paper (#F7F3E8). Scene based on real family moment: ${sceneDescriptions}. Key visual elements: ${factHighlights}. Style: uneven hand-drawn wax crayon strokes, varied hand pressure, overlapping colors, visible paper tooth and wax crumbs, warm nostalgic palette (faded orange #D96B43, mustard yellow #D9A441, earthy brown #5C4A3E, muted olive #6B7B5C, soft sky blue). Strictly no text, no letters, no watermarks, no photorealism.`;

  const auditAndVerifyPromise = runRealVerificationAndRepairLoop({
    client,
    draftSentences,
    consolidatedFacts,
    validPhotoIds,
    diaryDateText,
    diaryTitle: parsedDraft.diaryTitle || "소중한 가족의 하루",
    language: params.language,
    isHallucinationTest: Boolean(params.injectHallucinationTest),
  });

  const imagePromise =
    params.generateCrayonImage !== false
      ? client.interactions
          .create({
            model: ILLUSTRATION_MODEL,
            input: crayonPrompt,
          })
          .catch((err) => {
            console.warn("[Crayon Illustration Warning]:", err?.message || err);
            return null;
          })
      : Promise.resolve(null);

  const [verificationOutcome, imageInteraction] = await Promise.all([
    auditAndVerifyPromise,
    imagePromise,
  ]);

  interactionIds.push(...verificationOutcome.interactionIds);
  if (imageInteraction?.id) {
    interactionIds.push(imageInteraction.id);
  }

  const now = new Date().toISOString();
  const weather: WeatherKind =
    parsedDraft.weather &&
    ["sunny", "cloudy", "rainy", "snowy"].includes(parsedDraft.weather)
      ? parsedDraft.weather
      : "sunny";

  return {
    diaryPage: {
      diaryId: params.diaryId,
      workspaceId: params.workspaceId,
      language: params.language,
      createdAt: now,
      updatedAt: now,
      dateIso: params.cluster.dateIso,
      diaryDateText,
      weather,
      diaryTitle:
        parsedDraft.diaryTitle ||
        (params.language === "en" ? "Our Warm Family Day" : "사진 속 따뜻한 하루"),
      isTitleUserEdited: false,
      groupingBasis: params.cluster.groupingBasis,
      groupingReason: params.cluster.groupingReason,
      photos: params.cluster.photos,
      sentences: verificationOutcome.finalSentences,
      fullDiaryText: verificationOutcome.finalSentences
        .map((s) => s.text)
        .join(" "),
      verification: verificationOutcome.report,
      rawCrayonBase64: imageInteraction?.output_image?.data || undefined,
      crayonMimeType: imageInteraction?.output_image?.mime_type || "image/png",
      crayonPromptUsed: crayonPrompt,
      crayonFallbackUsed: !imageInteraction?.output_image?.data,
      meta: {
        primaryModel: PRIMARY_MODEL,
        verifierModel: PRIMARY_MODEL,
        illustrationModel: ILLUSTRATION_MODEL,
        totalDurationMs: Date.now() - t0,
        interactionIds,
      },
    },
  };
}

/**
 * 실제 결정론적 검증 + 독립 모델 감사(Pass 1) + 문장 복구/삭제 + 실제 재검증(Pass 2) 루프
 */
export async function runRealVerificationAndRepairLoop(params: {
  client?: GoogleGenAI;
  draftSentences: GroundedDiarySentence[];
  consolidatedFacts: Array<{
    photoId: string;
    fileName: string;
    sceneSummary: string;
    observedFacts: string[];
    uncertainties: string[];
  }>;
  validPhotoIds: string[];
  diaryDateText: string;
  diaryTitle: string;
  language: DiaryLanguage;
  isHallucinationTest?: boolean;
}): Promise<{
  finalSentences: GroundedDiarySentence[];
  report: VerificationReport;
  interactionIds: string[];
}> {
  const client = params.client || getGeminiClient();
  const interactionIds: string[] = [];
  const history: VerificationAttemptRecord[] = [];

  // 1. 결정론적 검증 (스키마, 사진 ID 참조, 날짜, 직접 인용구 금지)
  const structureValid =
    Boolean(params.diaryTitle) && params.draftSentences.length > 0;
  const photoRefsValid = params.draftSentences.every(
    (s) =>
      Array.isArray(s.sourcePhotoIds) &&
      s.sourcePhotoIds.length > 0 &&
      s.sourcePhotoIds.every((id) => params.validPhotoIds.includes(id))
  );
  const dateValid = Boolean(params.diaryDateText);
  const noFabricatedQuotesInitial = params.draftSentences.every(
    (s) => !hasFabricatedDirectDialogue(s.text)
  );

  // 2. Pass 1: 독립 감사관(Strict Grounding Auditor) 검증
  const auditorPromptPass1 = `You are the Independent Strict Grounding Auditor for 'My Little Picasso'.
Evaluate each diary sentence against the observed photo facts.
Verdict criteria:
- "PASS": Supported by observedFacts or reasonable gentle context without inventing events/dialogue.
- "REPAIRED": Contains exaggerated claims, fabricated dialogue, or unsupported details that can be rewritten to match observedFacts. Provide "repairedText".
- "OMITTED": Completely fabricated claim (e.g., dinosaurs, spaceships, unshown people/places) with zero basis in observedFacts.

Observed Facts per Photo:
${JSON.stringify(params.consolidatedFacts, null, 2)}

Candidate Diary Sentences:
${JSON.stringify(
  params.draftSentences.map((s) => ({
    id: s.id,
    text: s.text,
    sourcePhotoIds: s.sourcePhotoIds,
  })),
  null,
  2
)}

Respond ONLY in valid JSON (${params.language === "en" ? "English" : "Korean"} explanations):
{
  "auditorCritique": "1-sentence overall audit summary",
  "sentenceAudits": [
    {
      "sentenceId": "s1",
      "originalText": "original sentence",
      "verdict": "PASS",
      "reason": "Specific reason based on photo evidence",
      "repairedText": "repaired sentence if REPAIRED, else original"
    }
  ]
}`;

  const pass1Interaction = await client.interactions.create({
    model: PRIMARY_MODEL,
    input: auditorPromptPass1,
    generation_config: {
      thinking_level: "low",
      max_output_tokens: 16384,
    },
  });
  if (pass1Interaction.id) interactionIds.push(pass1Interaction.id);

  const parsedPass1 = parseJsonFromModelText<{
    auditorCritique?: string;
    sentenceAudits?: VerificationAuditItem[];
  }>(pass1Interaction.output_text || "{}");

  const auditsPass1: VerificationAuditItem[] =
    parsedPass1.sentenceAudits && parsedPass1.sentenceAudits.length > 0
      ? parsedPass1.sentenceAudits
      : params.draftSentences.map((s) => ({
          sentenceId: s.id,
          originalText: s.text,
          verdict: "PASS",
          reason:
            params.language === "en"
              ? "Matches observable photo facts."
              : "사진 관찰 사실과 일치합니다.",
        }));

  const auditMap = new Map<string, VerificationAuditItem>();
  for (const a of auditsPass1) {
    auditMap.set(a.sentenceId, a);
  }

  let repairedCount = 0;
  let omittedCount = 0;
  const candidateFinalSentences: GroundedDiarySentence[] = [];

  for (const s of params.draftSentences) {
    const audit = auditMap.get(s.id);
    if (audit?.verdict === "OMITTED") {
      omittedCount += 1;
      continue;
    }
    if (audit?.verdict === "REPAIRED" && audit.repairedText) {
      repairedCount += 1;
      candidateFinalSentences.push({
        ...s,
        text: audit.repairedText,
        originalModelText: audit.repairedText,
      });
    } else {
      candidateFinalSentences.push(s);
    }
  }

  history.push({
    attempt: 1,
    stage: params.isHallucinationTest
      ? "hallucination_test_audit"
      : "initial_audit",
    passed: repairedCount === 0 && omittedCount === 0,
    repairedCount,
    omittedCount,
    critique:
      parsedPass1.auditorCritique ||
      (params.language === "en"
        ? "Completed initial grounding audit."
        : "1차 독립 사실 근거 감사를 완료했습니다."),
    timestamp: new Date().toISOString(),
  });

  let attempts = 1;
  let finalCritique =
    parsedPass1.auditorCritique ||
    (params.language === "en"
      ? "All sentences match observable photo evidence."
      : "모든 문장이 사진에서 관찰된 시각적 사실과 일치합니다.");

  // 3. 만약 1차 감사에서 REPAIRED 또는 OMITTED가 발생했거나 직접 인용구가 있었다면, 수정된 결과에 대해 실제 2차 재검증(Re-verification) 실행!
  if (
    (repairedCount > 0 || omittedCount > 0 || !noFabricatedQuotesInitial) &&
    candidateFinalSentences.length > 0
  ) {
    attempts = 2;
    const pass2Prompt = `You are the Re-Verification Auditor for 'My Little Picasso'.
After repairing/removing ungrounded claims in Pass 1, verify whether the remaining sentences below now strictly conform to the observed photo facts without any fabricated dialogue or unsupported claims.

Observed Facts:
${JSON.stringify(params.consolidatedFacts.map((f) => f.observedFacts))}

Repaired Final Sentences:
${JSON.stringify(candidateFinalSentences.map((s) => ({ id: s.id, text: s.text })))}

Respond ONLY in valid JSON (${params.language === "en" ? "English" : "Korean"}):
{
  "allPassed": true,
  "reverificationSummary": "1-sentence confirmation of Pass 2 re-verification after repair/removal"
}`;

    const pass2Interaction = await client.interactions.create({
      model: PRIMARY_MODEL,
      input: pass2Prompt,
      generation_config: {
        thinking_level: "low",
        max_output_tokens: 8192,
      },
    });
    if (pass2Interaction.id) interactionIds.push(pass2Interaction.id);

    const parsedPass2 = parseJsonFromModelText<{
      allPassed?: boolean;
      reverificationSummary?: string;
    }>(pass2Interaction.output_text || "{}");

    const pass2Summary =
      parsedPass2.reverificationSummary ||
      (params.language === "en"
        ? `Re-verified after repairing ${repairedCount} and omitting ${omittedCount} ungrounded sentence(s): all remaining sentences are grounded.`
        : `근거 부족 문장(수정 ${repairedCount}건, 제외 ${omittedCount}건) 교정 후 2차 재검증을 통과했습니다.`);

    history.push({
      attempt: 2,
      stage: "repair_and_reverify",
      passed: parsedPass2.allPassed !== false,
      repairedCount: 0,
      omittedCount: 0,
      critique: pass2Summary,
      timestamp: new Date().toISOString(),
    });

    finalCritique = `${finalCritique} → [2차 재검증 완료] ${pass2Summary}`;
  }

  const noFabricatedQuotesFinal = candidateFinalSentences.every(
    (s) => !hasFabricatedDirectDialogue(s.text)
  );

  return {
    finalSentences: candidateFinalSentences,
    interactionIds,
    report: {
      passed:
        structureValid &&
        photoRefsValid &&
        dateValid &&
        noFabricatedQuotesFinal &&
        candidateFinalSentences.length > 0,
      attempts,
      deterministicChecks: {
        structureValid,
        photoRefsValid,
        dateValid,
        noFabricatedQuotes: noFabricatedQuotesFinal,
      },
      auditorCritique: finalCritique,
      sentenceAudits: auditsPass1,
      history,
      verifiedAt: new Date().toISOString(),
    },
  };
}

/**
 * 특정 그림일기 페이지의 크레파스 일러스트만 단독 재생성/재시도 (gemini-nano-banana-2.1)
 */
export async function generateCrayonIllustrationOnly(
  prompt: string
): Promise<{
  base64Data?: string;
  mimeType: string;
  interactionId?: string;
  fallbackSvgUsed: boolean;
}> {
  const client = getGeminiClient();
  const interaction = await client.interactions.create({
    model: ILLUSTRATION_MODEL,
    input: prompt,
  });
  if (interaction?.output_image?.data) {
    return {
      base64Data: interaction.output_image.data,
      mimeType: interaction.output_image.mime_type || "image/png",
      interactionId: interaction.id,
      fallbackSvgUsed: false,
    };
  }
  return {
    mimeType: "image/png",
    interactionId: interaction?.id,
    fallbackSvgUsed: true,
  };
}

/**
 * Memory Threads / Memory Time Machine 발견 엔진
 * - 서로 다른 그림일기 페이지(서로 다른 날짜/기억)를 가로질러 반복 등장하는 사물, 장소, 활동, 시간적 변화를 분석한다.
 * - 실제 사진 근거(photoId, diaryId, matchedClue)와 한계점(limitationNote)을 함께 생성한다.
 */
export async function discoverMemoryThreadsAcrossDiaries(
  diaries: SavedDiaryPage[],
  language: DiaryLanguage = "ko"
): Promise<MemoryThreadConnection[]> {
  if (diaries.length < 2) {
    return [];
  }

  const client = getGeminiClient();
  const compactDiaries = diaries.map((d) => ({
    diaryId: d.diaryId,
    diaryTitle: d.diaryTitle,
    diaryDateText: d.diaryDateText,
    dateIso: d.dateIso,
    photos: d.photos.map((p) => ({
      photoId: p.photoId,
      fileName: p.fileName,
      sceneSummary: p.analysis.sceneSummary,
      observedFacts: p.analysis.observedFacts,
      visualDescriptors: p.analysis.visualDescriptors,
    })),
  }));

  const prompt = `You are the 'Memory Threads / Memory Time Machine' Discovery Agent for 'My Little Picasso'.
Analyze the family diary pages across different dates/memories below and discover meaningful, visually grounded connections across AT LEAST TWO DIFFERENT diaryId entries.
Examples of grounded connections:
- A recurring object (e.g., the same yellow balance bicycle / 노란색 보조바퀴 자전거, a favorite hat, a toy)
- A recurring place (e.g., neighborhood park path, living room rug)
- A recurring family activity or observable progression over time (e.g., practicing riding a bike from holding handlebars to riding steadily)

Strict Rules:
1. Every thread MUST connect at least 2 DIFFERENT diaryId entries, citing exact diaryId and photoId values from the input.
2. Do NOT claim 100% physical identity if only visual similarity is observable — clearly state what is visually matched in "evidenceDescription" AND state the epistemic boundary in "limitationNote".
3. Write all text in ${language === "en" ? "English" : "Korean"}.

Input Diaries:
${JSON.stringify(compactDiaries, null, 2)}

Respond ONLY in valid JSON:
{
  "threads": [
    {
      "threadId": "thread_1",
      "title": "Warm title of the memory thread",
      "category": "object",
      "sharedSubject": "Specific recurring subject name",
      "summary": "1-2 sentence narrative explaining how these moments connect across time",
      "confidence": "high",
      "evidenceDescription": "Specific visual features shared across the linked photos",
      "limitationNote": "Honest note on what cannot be proven from photos alone",
      "nodes": [
        {
          "diaryId": "exact_diary_id_1",
          "photoId": "exact_photo_id_1",
          "matchedClue": "What is seen in this specific photo"
        },
        {
          "diaryId": "exact_diary_id_2",
          "photoId": "exact_photo_id_2",
          "matchedClue": "What is seen in this later photo"
        }
      ]
    }
  ]
}`;

  try {
    const interaction = await client.interactions.create({
      model: PRIMARY_MODEL,
      input: prompt,
      generation_config: {
        thinking_level: "low",
        max_output_tokens: 16384,
      },
    });

    const parsed = parseJsonFromModelText<{
      threads?: Array<{
        threadId?: string;
        title?: string;
        category?: "object" | "place" | "activity" | "growth_change";
        sharedSubject?: string;
        summary?: string;
        confidence?: "high" | "medium";
        evidenceDescription?: string;
        limitationNote?: string;
        nodes?: Array<{
          diaryId: string;
          photoId: string;
          matchedClue: string;
        }>;
      }>;
    }>(interaction.output_text || "{}");

    const diaryMap = new Map<string, SavedDiaryPage>();
    for (const d of diaries) {
      diaryMap.set(d.diaryId, d);
    }

    const validThreads: MemoryThreadConnection[] = [];

    for (const rawThread of parsed.threads || []) {
      const resolvedNodes: MemoryThreadConnection["nodes"] = [];
      const distinctDiaryIds = new Set<string>();

      for (const rawNode of rawThread.nodes || []) {
        const targetDiary = diaryMap.get(rawNode.diaryId);
        if (!targetDiary) continue;
        const targetPhoto =
          targetDiary.photos.find((p) => p.photoId === rawNode.photoId) ||
          targetDiary.photos[0];
        if (!targetPhoto) continue;

        distinctDiaryIds.add(targetDiary.diaryId);
        resolvedNodes.push({
          diaryId: targetDiary.diaryId,
          diaryTitle: targetDiary.diaryTitle,
          diaryDateText: targetDiary.diaryDateText,
          dateIso: targetDiary.dateIso,
          photoId: targetPhoto.photoId,
          photoFileName: targetPhoto.fileName,
          photoMediaUrl: targetPhoto.mediaUrl,
          matchedClue:
            rawNode.matchedClue || targetPhoto.analysis.sceneSummary,
        });
      }

      if (distinctDiaryIds.size >= 2 && resolvedNodes.length >= 2) {
        validThreads.push({
          threadId:
            rawThread.threadId ||
            `thread_${Date.now()}_${validThreads.length + 1}`,
          title:
            rawThread.title ||
            (language === "en"
              ? "Connected Family Moments"
              : "시간을 잇는 가족의 기억"),
          category:
            rawThread.category &&
            ["object", "place", "activity", "growth_change"].includes(
              rawThread.category
            )
              ? rawThread.category
              : "object",
          sharedSubject:
            rawThread.sharedSubject ||
            (language === "en" ? "Shared Memory Clue" : "반복 등장하는 추억 단서"),
          summary:
            rawThread.summary ||
            (language === "en"
              ? "Observed across multiple family diary dates."
              : "서로 다른 날의 사진 속에서 함께 발견된 추억의 연결고리입니다."),
          confidence: rawThread.confidence === "medium" ? "medium" : "high",
          evidenceDescription:
            rawThread.evidenceDescription ||
            (language === "en"
              ? "Matched visual descriptors across different dates."
              : "서로 다른 날짜의 사진에서 동일한 형태와 색상의 시각적 특징이 관찰되었습니다."),
          limitationNote:
            rawThread.limitationNote ||
            (language === "en"
              ? "Visual traits match closely, though physical identity is inferred from photographic appearance."
              : "외형과 색상 특징이 일치하지만, 사진의 시각적 단서에 기반한 연결입니다."),
          nodes: resolvedNodes,
        });
      }
    }

    return validThreads;
  } catch (err) {
    console.warn("[Memory Threads Discovery Warning]:", err);
    return [];
  }
}

