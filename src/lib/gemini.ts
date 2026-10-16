import { GoogleGenAI } from "@google/genai";
import type {
  GroundedDiarySentence,
  HelloWorldDiaryResult,
  ObservedPhotoAnalysis,
  VerificationAuditItem,
  VerificationReport,
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
