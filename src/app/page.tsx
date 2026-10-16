"use client";

import React, { useEffect, useState } from "react";
import exifr from "exifr";
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck2,
  Image as ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  AlertCircle,
} from "lucide-react";
import type {
  GroundedDiarySentence,
  HelloWorldDiaryResult,
  ObservedPhotoAnalysis,
} from "@/types/diary";

interface HealthData {
  status: string;
  product: string;
  tagline: string;
  timestamp: string;
  environment: {
    nodeVersion: string;
    gcpProjectId: string;
    geminiApiKeyConfigured: boolean;
  };
  models: {
    primaryReasoningAndVision: string;
    crayonIllustration: string;
    managedAgent: string;
  };
}

interface VerifyResponse {
  ok: boolean;
  sdkPackage: string;
  totalLatencyMs: number;
  results?: {
    textReasoning: {
      ok: boolean;
      model: string;
      latencyMs: number;
      interactionId?: string;
      outputText?: string;
      error?: string;
    };
    multimodalVision: {
      ok: boolean;
      model: string;
      latencyMs: number;
      interactionId?: string;
      outputText?: string;
      error?: string;
    };
    crayonImageGen?: {
      ok: boolean;
      model: string;
      latencyMs: number;
      interactionId?: string;
      hasImageBytes?: boolean;
      error?: string;
    };
  };
  error?: string;
}

interface SamplePreset {
  id: string;
  title: string;
  capturedAt: string;
  description: string;
  drawScene: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: "preset_yellow_bike",
    title: "가을 공원의 노란 보조바퀴 자전거",
    capturedAt: "2026-10-12 15:20:00",
    description:
      "단풍나무 아래 벤치 옆에 세워진 작은 노란색 보조바퀴 어린이 자전거와 파란 헬멧이 찍힌 가족 산책 스냅샷",
    drawScene: (ctx, w, h) => {
      ctx.fillStyle = "#E8F0F2";
      ctx.fillRect(0, 0, w, h * 0.58);
      ctx.fillStyle = "#D4C69E";
      ctx.fillRect(0, h * 0.58, w, h * 0.42);

      ctx.fillStyle = "#C5B089";
      ctx.beginPath();
      ctx.moveTo(0, h * 0.72);
      ctx.lineTo(w, h * 0.65);
      ctx.lineTo(w, h * 0.85);
      ctx.lineTo(0, h * 0.92);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#6E4B35";
      ctx.fillRect(w * 0.72, h * 0.28, 28, h * 0.36);
      ctx.fillStyle = "#D96B43";
      ctx.beginPath();
      ctx.arc(w * 0.74, h * 0.25, 68, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#D9A441";
      ctx.beginPath();
      ctx.arc(w * 0.66, h * 0.3, 48, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#7C583E";
      ctx.fillRect(w * 0.55, h * 0.52, 130, 12);
      ctx.fillRect(w * 0.55, h * 0.56, 130, 10);
      ctx.fillRect(w * 0.58, h * 0.52, 10, 32);
      ctx.fillRect(w * 0.78, h * 0.52, 10, 32);

      ctx.strokeStyle = "#2E2925";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(w * 0.28, h * 0.72, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.48, h * 0.72, 34, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(w * 0.21, h * 0.76, 13, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#F0B429";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(w * 0.28, h * 0.72);
      ctx.lineTo(w * 0.37, h * 0.6);
      ctx.lineTo(w * 0.46, h * 0.6);
      ctx.lineTo(w * 0.48, h * 0.72);
      ctx.moveTo(w * 0.37, h * 0.6);
      ctx.lineTo(w * 0.38, h * 0.72);
      ctx.lineTo(w * 0.28, h * 0.72);
      ctx.stroke();

      ctx.strokeStyle = "#5C4A3E";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w * 0.46, h * 0.6);
      ctx.lineTo(w * 0.44, h * 0.51);
      ctx.stroke();
      ctx.fillStyle = "#B88B58";
      ctx.fillRect(w * 0.46, h * 0.53, 24, 18);

      ctx.fillStyle = "#4A7C9B";
      ctx.beginPath();
      ctx.arc(w * 0.63, h * 0.51, 16, Math.PI, 0);
      ctx.fill();
    },
  },
  {
    id: "preset_livingroom_blocks",
    title: "거실 창가의 알록달록 나무 블록 성",
    capturedAt: "2026-10-15 17:05:00",
    description:
      "햇살이 들어오는 거실 러그 위에 빨강·노랑·초록 나무 블록으로 쌓아 올린 작은 성곽과 그림책",
    drawScene: (ctx, w, h) => {
      ctx.fillStyle = "#F3ECE0";
      ctx.fillRect(0, 0, w, h * 0.62);
      ctx.fillStyle = "#C9A679";
      ctx.fillRect(0, h * 0.62, w, h * 0.38);

      ctx.fillStyle = "#FBE6B2";
      ctx.fillRect(w * 0.12, h * 0.1, 140, 110);
      ctx.strokeStyle = "#8C6D4F";
      ctx.lineWidth = 6;
      ctx.strokeRect(w * 0.12, h * 0.1, 140, 110);

      ctx.fillStyle = "#E5DBC7";
      ctx.beginPath();
      ctx.ellipse(w * 0.52, h * 0.76, 190, 52, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#D96B43";
      ctx.fillRect(w * 0.38, h * 0.56, 36, 68);
      ctx.fillRect(w * 0.56, h * 0.56, 36, 68);

      ctx.fillStyle = "#D9A441";
      ctx.fillRect(w * 0.36, h * 0.5, 130, 22);

      ctx.fillStyle = "#6B7B5C";
      ctx.beginPath();
      ctx.moveTo(w * 0.36, h * 0.5);
      ctx.lineTo(w * 0.43, h * 0.38);
      ctx.lineTo(w * 0.5, h * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(w * 0.52, h * 0.5);
      ctx.lineTo(w * 0.59, h * 0.38);
      ctx.lineTo(w * 0.66, h * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#FAF6EE";
      ctx.fillRect(w * 0.7, h * 0.7, 74, 42);
      ctx.strokeStyle = "#5C4A3E";
      ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.7, h * 0.7, 74, 42);
    },
  },
];

function renderPresetToDataUrl(preset: SamplePreset): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    preset.drawScene(ctx, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}

/**
 * 원본 사진은 화면 표시용으로 그대로 보존하고,
 * 모델 API 전송용으로는 긴 변 최대 1024px JPEG로 전처리하여 업로드/추론 지연을 방지한다.
 */
async function createResizedApiImage(
  originalDataUrl: string,
  maxDimension = 640
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        1,
        maxDimension / Math.max(img.width || 1, img.height || 1)
      );
      const targetW = Math.max(1, Math.round(img.width * scale));
      const targetH = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve({
          dataUrl: canvas.toDataURL("image/jpeg", 0.8),
          mimeType: "image/jpeg",
        });
      } else {
        resolve({ dataUrl: originalDataUrl, mimeType: "image/jpeg" });
      }
    };
    img.onerror = () =>
      resolve({ dataUrl: originalDataUrl, mimeType: "image/jpeg" });
    img.src = originalDataUrl;
  });
}

const PIPELINE_STAGES = [
  {
    step: 1,
    title: "1단계: 멀티모달 시각 사실 추출",
    desc: "gemini-4-argon이 사진에서 직접 확인 가능한 사실(Observed)과 불확실성을 분리합니다.",
  },
  {
    step: 2,
    title: "2단계: 사실 근거 그림일기 초안 작성",
    desc: "추출된 사실만을 조합해 문장마다 원본 사진 출처가 연결된 일기 초안을 작성합니다.",
  },
  {
    step: 3,
    title: "3단계: 독립 감사관 검증 루프 & 크레용 삽화 병렬 생성",
    desc: "독립 검증기(Auditor)의 사실 대조와 gemini-nano-banana-2.1 크레용 그림 생성을 동시에 수행합니다.",
  },
  {
    step: 4,
    title: "4단계: 디지털 스케치북 페이지 조립",
    desc: "원본 사진, 검증된 일기, 크레용 그림을 하나의 일기장 페이지로 완성합니다.",
  },
];

export default function HomePage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [verifyState, setVerifyState] = useState<{
    loading: boolean;
    includeImageGen: boolean;
    data: VerifyResponse | null;
  }>({
    loading: false,
    includeImageGen: true,
    data: null,
  });

  // 선택된 사진 상태 (원본 표시용 URL과 API 분석용 전처리 URL 분리)
  const [selectedPhoto, setSelectedPhoto] = useState<{
    photoId: string;
    fileName: string;
    capturedAt: string | null;
    displayDataUrl: string;
    apiDataUrl: string;
    apiMimeType: string;
    sourceLabel: string;
  } | null>(null);

  const [generateCrayon, setGenerateCrayon] = useState<boolean>(true);
  const [pipelineLoading, setPipelineLoading] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [pipelineStepText, setPipelineStepText] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [partialAnalysis, setPartialAnalysis] =
    useState<ObservedPhotoAnalysis | null>(null);
  const [partialDraft, setPartialDraft] = useState<{
    title?: string;
    sentences?: GroundedDiarySentence[];
  } | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [diaryResult, setDiaryResult] = useState<HelloWorldDiaryResult | null>(
    null
  );
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);

  // 초기 헬스체크 및 기본 샘플 사진 준비
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => null);

    const firstPreset = SAMPLE_PRESETS[0];
    const url = renderPresetToDataUrl(firstPreset);
    setSelectedPhoto({
      photoId: firstPreset.id,
      fileName: "autumn_park_yellow_bike.png",
      capturedAt: firstPreset.capturedAt,
      displayDataUrl: url,
      apiDataUrl: url,
      apiMimeType: "image/png",
      sourceLabel: firstPreset.title,
    });
  }, []);

  // 실행 중 실시간 초시계 타이머
  useEffect(() => {
    if (!pipelineLoading) return;
    const t0 = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - t0) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }, [pipelineLoading]);

  // 지정 모델 실시간 검증 호출
  async function handleVerifyModels() {
    setVerifyState((prev) => ({ ...prev, loading: true, data: null }));
    try {
      const res = await fetch("/api/verify-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeImageGen: verifyState.includeImageGen,
          includeAgentCheck: false,
        }),
      });
      const data: VerifyResponse = await res.json();
      setVerifyState((prev) => ({ ...prev, loading: false, data }));
    } catch (err: unknown) {
      setVerifyState((prev) => ({
        ...prev,
        loading: false,
        data: {
          ok: false,
          sdkPackage: "@google/genai",
          totalLatencyMs: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  // 프리셋 선택 핸들러
  function handleSelectPreset(preset: SamplePreset) {
    const url = renderPresetToDataUrl(preset);
    setSelectedPhoto({
      photoId: preset.id,
      fileName: `${preset.id}.png`,
      capturedAt: preset.capturedAt,
      displayDataUrl: url,
      apiDataUrl: url,
      apiMimeType: "image/png",
      sourceLabel: preset.title,
    });
    setDiaryResult(null);
    setPartialAnalysis(null);
    setPartialDraft(null);
    setPipelineError(null);
  }

  // 실제 사용자 사진 업로드 + EXIF 촬영일 추출 + API 전처리(리사이즈)
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPipelineError(null);
    setDiaryResult(null);
    setPartialAnalysis(null);
    setPartialDraft(null);

    let extractedDate: string | null = null;
    try {
      const exifData = await exifr.parse(file, [
        "DateTimeOriginal",
        "CreateDate",
      ]);
      const rawDate = exifData?.DateTimeOriginal || exifData?.CreateDate;
      if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
        extractedDate = rawDate.toISOString().slice(0, 19).replace("T", " ");
      }
    } catch {
      extractedDate = null;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const originalDataUrl = reader.result as string;
      const resized = await createResizedApiImage(originalDataUrl, 640);
      setSelectedPhoto({
        photoId: `upload_${Date.now()}`,
        fileName: file.name,
        capturedAt: extractedDate,
        displayDataUrl: originalDataUrl,
        apiDataUrl: resized.dataUrl,
        apiMimeType: resized.mimeType,
        sourceLabel: `사용자 업로드 사진 (${file.name})`,
      });
    };
    reader.readAsDataURL(file);
  }

  // Hello World 엔드투엔드 파이프라인 실행 (실시간 NDJSON 스트림 수신)
  async function handleRunHelloDiary() {
    if (!selectedPhoto) return;

    setPipelineLoading(true);
    setCurrentStep(1);
    setElapsedSeconds(0);
    setPipelineError(null);
    setDiaryResult(null);
    setPartialAnalysis(null);
    setPartialDraft(null);
    setPipelineStepText(
      "1단계 시작: gemini-4-argon이 사진 속 시각적 사실을 분석하고 있습니다..."
    );

    try {
      const res = await fetch("/api/hello-diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoId: selectedPhoto.photoId,
          fileName: selectedPhoto.fileName,
          mimeType: selectedPhoto.apiMimeType,
          base64Data: selectedPhoto.apiDataUrl,
          capturedAt: selectedPhoto.capturedAt,
          generateCrayonImage: generateCrayon,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "그림일기 생성 요청에 실패했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") {
            setCurrentStep(event.step);
            setPipelineStepText(`[${event.stageName}] ${event.message}`);
            if (event.partialData?.photoAnalysis) {
              setPartialAnalysis(event.partialData.photoAnalysis);
            }
            if (event.partialData?.draftSentences) {
              setPartialDraft({
                title: event.partialData.draftTitle,
                sentences: event.partialData.draftSentences,
              });
            }
          } else if (event.type === "complete" && event.ok) {
            const finalData = event.data as HelloWorldDiaryResult;
            setDiaryResult(finalData);
            if (finalData.sentences?.[0]?.id) {
              setActiveSentenceId(finalData.sentences[0].id);
            }
          } else if (event.type === "error") {
            throw new Error(event.error || "파이프라인 실행 중 오류 발생");
          }
        }
      }
    } catch (err: unknown) {
      setPipelineError(
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다."
      );
    } finally {
      setPipelineLoading(false);
    }
  }

  const activeSentence: GroundedDiarySentence | undefined =
    diaryResult?.sentences.find((s) => s.id === activeSentenceId) ||
    diaryResult?.sentences[0];

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-6xl mx-auto">
      {/* 상단 스케치북 표지 헤더 */}
      <header className="crayon-box bg-[#FAF6EC] p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D96B43]/15 text-[#D96B43] text-xs font-bold tracking-wide mb-3">
              <Palette className="w-3.5 h-3.5" />
              <span>STEP 1 · HELLO WORLD & GEMINI 4 ARGON VERIFICATION</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-[#3A2E25] tracking-tight flex items-center gap-3">
              <span>My Little Picasso</span>
              <span className="font-handwriting text-2xl sm:text-3xl text-[#D96B43] font-normal">
                Memories, Drawn from Life.
              </span>
            </h1>
            <p className="mt-2 text-[#5C4A3E] text-sm sm:text-base max-w-2xl leading-relaxed">
              &ldquo;귀여움은 아이의 그림에서 나오고, 감동은 시간이 흐른다는
              사실에서 나와야 해.&rdquo; — 사진 속 관찰 가능한 사실만을 근거로
              일기를 쓰고, 독립 검증 루프와 크레용 그림으로 보존하는 자율형
              멀티모달 가족 기억 에이전트
            </p>
          </div>

          {/* 시스템 상태 요약 배지 */}
          <div className="crayon-box-olive bg-[#F4F1E6] p-4 min-w-[260px] text-xs space-y-1.5">
            <div className="flex items-center justify-between font-bold text-[#3A2E25] border-b border-[#5C4A3E]/15 pb-1.5">
              <span>시스템 & 해커톤 환경 상태</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                  health?.environment.geminiApiKeyConfigured
                    ? "bg-[#6B7B5C]/20 text-[#4A593D]"
                    : "bg-red-100 text-red-700"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                {health?.environment.geminiApiKeyConfigured
                  ? "API Key 준비됨"
                  : "점검 필요"}
              </span>
            </div>
            <div className="flex justify-between text-[#5C4A3E]">
              <span>GCP Project:</span>
              <code className="font-mono font-semibold text-[#3A2E25]">
                {health?.environment.gcpProjectId || "h2gdm-hack26icn-2627"}
              </code>
            </div>
            <div className="flex justify-between text-[#5C4A3E]">
              <span>지정 추론/비전 모델:</span>
              <code className="font-mono font-semibold text-[#D96B43]">
                {health?.models.primaryReasoningAndVision || "gemini-4-argon"}
              </code>
            </div>
            <div className="flex justify-between text-[#5C4A3E]">
              <span>크레용 삽화 모델:</span>
              <code className="font-mono font-semibold text-[#6B7B5C]">
                {health?.models.crayonIllustration || "gemini-nano-banana-2.1"}
              </code>
            </div>
          </div>
        </div>
      </header>

      {/* 섹션 1: 지정 모델 (gemini-4-argon & gemini-nano-banana-2.1) 실시간 API 검증 패널 */}
      <section className="crayon-box bg-[#FAF6EC] p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#5C4A3E]/15 pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#3A2E25] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#6B7B5C]" />
              <span>
                1. 지정 모델(<code>gemini-4-argon</code>) 및 Interactions API
                실시간 호환성 검증
              </span>
            </h2>
            <p className="text-sm text-[#756354] mt-1">
              공식 <code>@google/genai</code> SDK의{" "}
              <code>client.interactions.create</code>를 호출하여 텍스트 추론,
              멀티모달 이미지 이해, 크레용 이미지 생성 모델이 실제로 동작하는지
              즉시 테스트합니다.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-[#5C4A3E] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={verifyState.includeImageGen}
                onChange={(e) =>
                  setVerifyState((prev) => ({
                    ...prev,
                    includeImageGen: e.target.checked,
                  }))
                }
                className="accent-[#D96B43] rounded"
              />
              <span>크레용 이미지 생성 모델 함께 검증</span>
            </label>

            <button
              onClick={handleVerifyModels}
              disabled={verifyState.loading}
              className="px-4 py-2.5 rounded-xl bg-[#5C4A3E] hover:bg-[#46372E] text-[#FAF6EC] text-sm font-bold flex items-center gap-2 transition cursor-pointer disabled:opacity-60"
            >
              {verifyState.loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>실제 API 호출 검증 중...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Gemini 4 Argon 라이브 검증 실행</span>
                </>
              )}
            </button>
          </div>
        </div>

        {verifyState.data && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#F2ECE0] border border-[#5C4A3E]/20 text-sm">
              <div className="flex items-center justify-between font-bold">
                <span>① 텍스트 추론 (Interactions API)</span>
                <span
                  className={
                    verifyState.data.results?.textReasoning.ok
                      ? "text-[#4A6B3B]"
                      : "text-red-600"
                  }
                >
                  {verifyState.data.results?.textReasoning.ok
                    ? "PASS"
                    : "FAIL"}
                </span>
              </div>
              <div className="text-xs text-[#756354] mt-1">
                모델:{" "}
                <code>{verifyState.data.results?.textReasoning.model}</code> ·
                소요 시간:{" "}
                {verifyState.data.results?.textReasoning.latencyMs ?? 0}ms
              </div>
              <p className="mt-2 text-xs bg-[#FAF6EC] p-2.5 rounded border border-[#5C4A3E]/10 text-[#3A2E25]">
                {verifyState.data.results?.textReasoning.outputText ||
                  verifyState.data.results?.textReasoning.error}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#F2ECE0] border border-[#5C4A3E]/20 text-sm">
              <div className="flex items-center justify-between font-bold">
                <span>② 멀티모달 이미지 분석</span>
                <span
                  className={
                    verifyState.data.results?.multimodalVision.ok
                      ? "text-[#4A6B3B]"
                      : "text-red-600"
                  }
                >
                  {verifyState.data.results?.multimodalVision.ok
                    ? "PASS"
                    : "FAIL"}
                </span>
              </div>
              <div className="text-xs text-[#756354] mt-1">
                모델:{" "}
                <code>{verifyState.data.results?.multimodalVision.model}</code>{" "}
                · 소요 시간:{" "}
                {verifyState.data.results?.multimodalVision.latencyMs ?? 0}ms
              </div>
              <p className="mt-2 text-xs bg-[#FAF6EC] p-2.5 rounded border border-[#5C4A3E]/10 text-[#3A2E25]">
                {verifyState.data.results?.multimodalVision.outputText ||
                  verifyState.data.results?.multimodalVision.error}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#F2ECE0] border border-[#5C4A3E]/20 text-sm">
              <div className="flex items-center justify-between font-bold">
                <span>③ 크레용 삽화 생성 모델</span>
                <span
                  className={
                    verifyState.data.results?.crayonImageGen?.ok
                      ? "text-[#4A6B3B]"
                      : "text-[#D96B43]"
                  }
                >
                  {verifyState.data.results?.crayonImageGen
                    ? verifyState.data.results.crayonImageGen.ok
                      ? "PASS"
                      : "CHECK"
                    : "SKIPPED"}
                </span>
              </div>
              {verifyState.data.results?.crayonImageGen ? (
                <>
                  <div className="text-xs text-[#756354] mt-1">
                    모델:{" "}
                    <code>{verifyState.data.results.crayonImageGen.model}</code>{" "}
                    · 소요 시간:{" "}
                    {verifyState.data.results.crayonImageGen.latencyMs}ms
                  </div>
                  <p className="mt-2 text-xs bg-[#FAF6EC] p-2.5 rounded border border-[#5C4A3E]/10 text-[#3A2E25]">
                    {verifyState.data.results.crayonImageGen.ok
                      ? "output_image Base64 이미지 바이트 생성 확인 완료!"
                      : verifyState.data.results.crayonImageGen.error}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-[#756354]">
                  체크박스를 켜고 실행하면 이미지 생성 모델을 함께 테스트합니다.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 섹션 2: Hello World 엔드투엔드 체험 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* 좌측: 입력 사진 선택 및 파이프라인 실행 컨트롤 */}
        <div className="lg:col-span-5 crayon-box bg-[#FAF6EC] p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-[#3A2E25] flex items-center gap-2">
              <Camera className="w-5 h-5 text-[#D96B43]" />
              <span>2. Hello World — 사진 선택 및 분석 실행</span>
            </h2>
            <p className="text-xs text-[#756354] mt-1">
              샘플 가족 스냅샷을 고르거나 직접 사진을 업로드하여{" "}
              <strong>
                관찰 사실 추출 → 근거 일기 작성 → 독립 감사관 검증 루프 → 크레용
                그림일기 조립
              </strong>
              을 실시간 스트리밍으로 확인해 보세요.
            </p>
          </div>

          {/* 샘플 프리셋 버튼 */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-[#5C4A3E] block">
              샘플 가족 스냅샷 선택:
            </span>
            <div className="grid grid-cols-1 gap-2">
              {SAMPLE_PRESETS.map((preset) => {
                const isSelected = selectedPhoto?.photoId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? "bg-[#D96B43]/15 border-[#D96B43] text-[#3A2E25]"
                        : "bg-[#F2ECE0] border-[#5C4A3E]/20 hover:bg-[#EAE1D0]"
                    }`}
                  >
                    <div className="font-bold text-sm flex items-center justify-between">
                      <span>{preset.title}</span>
                      <span className="text-[11px] font-mono text-[#756354]">
                        {preset.capturedAt.slice(0, 10)}
                      </span>
                    </div>
                    <p className="text-xs text-[#5C4A3E] mt-1">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 직접 사진 업로드 */}
          <div className="pt-2 border-t border-[#5C4A3E]/15">
            <label className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border-2 border-dashed border-[#5C4A3E]/40 hover:border-[#D96B43] bg-[#F2ECE0]/60 text-xs font-bold text-[#5C4A3E] cursor-pointer transition">
              <Upload className="w-4 h-4 text-[#D96B43]" />
              <span>
                내 컴퓨터에서 실제 가족 사진 업로드 (원본 보존 + EXIF 자동 추출)
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* 선택된 원본 사진 미리보기 카드 */}
          {selectedPhoto && (
            <div className="p-3.5 bg-[#F2ECE0] rounded-xl border border-[#5C4A3E]/20 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#3A2E25] truncate">
                  원본 사진: {selectedPhoto.sourceLabel}
                </span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#FAF6EC] text-[#5C4A3E]">
                  ID: {selectedPhoto.photoId}
                </span>
              </div>
              <div className="rounded-lg overflow-hidden border border-[#5C4A3E]/20 bg-[#FAF6EC]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedPhoto.displayDataUrl}
                  alt={selectedPhoto.sourceLabel}
                  className="w-full h-48 object-cover"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-[#756354]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  촬영 일시:{" "}
                  <strong className="text-[#3A2E25]">
                    {selectedPhoto.capturedAt ||
                      "EXIF 날짜 없음 (불확실성 유지)"}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* 크레용 삽화 생성 옵션 및 실행 버튼 */}
          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-2 text-xs text-[#5C4A3E] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={generateCrayon}
                onChange={(e) => setGenerateCrayon(e.target.checked)}
                className="accent-[#D96B43] rounded"
              />
              <span>
                <code>gemini-nano-banana-2.1</code> 모델로 실제 크레용 그림일기
                삽화 함께 그리기
              </span>
            </label>

            <button
              type="button"
              onClick={handleRunHelloDiary}
              disabled={!selectedPhoto || pipelineLoading}
              className="w-full py-3.5 px-5 rounded-xl bg-[#D96B43] hover:bg-[#C25A34] text-[#FAF6EC] font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-60"
            >
              {pipelineLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    에이전트 실행 중... ({elapsedSeconds.toFixed(1)}초 경과)
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>사실 근거 그림일기 생성 & 독립 검증 루프 실행</span>
                </>
              )}
            </button>

            {pipelineError && (
              <div className="p-3 rounded-lg bg-red-100 border border-red-300 text-xs text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{pipelineError}</span>
              </div>
            )}
          </div>
        </div>

        {/* 우측: 실시간 진행 모니터 또는 완성된 디지털 스케치북 그림일기 페이지 */}
        <div className="lg:col-span-7 space-y-6">
          {pipelineLoading && !diaryResult && (
            <div className="crayon-box bg-[#FAF6EC] p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between border-b border-[#5C4A3E]/15 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-[#3A2E25] flex items-center gap-2">
                    <Loader2 className="w-5 h-5 text-[#D96B43] animate-spin" />
                    <span>
                      자율형 멀티모달 에이전트 파이프라인 실시간 진행 중
                    </span>
                  </h3>
                  <p className="text-xs text-[#756354] mt-1">
                    {pipelineStepText}
                  </p>
                </div>
                <span className="font-mono text-sm font-bold px-3 py-1 rounded-full bg-[#D96B43]/15 text-[#D96B43]">
                  {elapsedSeconds.toFixed(1)}s
                </span>
              </div>

              {/* 4단계 실시간 체크리스트 */}
              <div className="space-y-3">
                {PIPELINE_STAGES.map((stage) => {
                  const isDone = currentStep > stage.step;
                  const isCurrent = currentStep === stage.step;
                  return (
                    <div
                      key={stage.step}
                      className={`p-3.5 rounded-xl border text-xs transition ${
                        isCurrent
                          ? "bg-[#FFF9ED] border-[#D96B43] text-[#3A2E25]"
                          : isDone
                          ? "bg-[#6B7B5C]/15 border-[#6B7B5C]/40 text-[#3A2E25]"
                          : "bg-[#F2ECE0]/60 border-[#5C4A3E]/15 text-[#756354]"
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span>{stage.title}</span>
                        <span>
                          {isDone
                            ? "✔ 완료"
                            : isCurrent
                            ? "⏳ 진행 중..."
                            : "대기"}
                        </span>
                      </div>
                      <p className="mt-1 opacity-85">{stage.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* 1단계 완료 즉시 실시간으로 보여주는 중간 추출 결과 */}
              {partialAnalysis && (
                <div className="p-4 rounded-xl bg-[#F2ECE0] border border-[#6B7B5C]/40 text-xs space-y-2">
                  <div className="font-bold text-[#4A593D]">
                    ✨ [1단계 실시간 완료] 추출된 시각적 사실 (
                    {partialAnalysis.observedFacts.length}건):
                  </div>
                  <p className="text-[#3A2E25] font-semibold">
                    장면 요약: {partialAnalysis.sceneSummary}
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-[#5C4A3E]">
                    {partialAnalysis.observedFacts.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 2단계 완료 즉시 실시간으로 보여주는 일기 초안 */}
              {partialDraft?.sentences && (
                <div className="p-4 rounded-xl bg-[#FFF9ED] border border-[#D9A441] text-xs space-y-2">
                  <div className="font-bold text-[#7A5813]">
                    📝 [2단계 실시간 완료] 생성된 일기 초안 (현재 독립 검증기 &
                    크레용 삽화 병렬 처리 중...):
                  </div>
                  <div className="font-handwriting text-xl text-[#3A2E25]">
                    <strong>{partialDraft.title}</strong> —{" "}
                    {partialDraft.sentences.map((s) => s.text).join(" ")}
                  </div>
                </div>
              )}
            </div>
          )}

          {!pipelineLoading && !diaryResult && (
            <div className="crayon-box bg-[#FAF6EC] p-10 text-center space-y-3 min-h-[520px] flex flex-col items-center justify-center">
              <BookOpen className="w-12 h-12 text-[#D9A441] stroke-[1.6]" />
              <h3 className="text-xl font-bold text-[#3A2E25]">
                아직 펼쳐진 그림일기 페이지가 없습니다
              </h3>
              <p className="text-sm text-[#756354] max-w-md leading-relaxed">
                왼쪽에서 가족 사진을 선택하고{" "}
                <strong>[사실 근거 그림일기 생성 & 독립 검증 루프 실행]</strong>{" "}
                버튼을 누르면, 단계별 진행 상태가 실시간으로 표시되며 완성된
                그림일기가 이곳에 조립됩니다.
              </p>
            </div>
          )}

          {diaryResult && (
            <>
              {/* 완성된 그림일기 스케치북 페이지 (Diary Page Assembly) */}
              <article className="crayon-box bg-[#FAF6EC] p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#5C4A3E] pb-4">
                  <div>
                    <div className="text-xs font-mono text-[#756354]">
                      날짜: {diaryResult.diaryDateText}
                    </div>
                    <h2 className="font-handwriting text-3xl sm:text-4xl font-bold text-[#3A2E25] mt-1">
                      제목: {diaryResult.diaryTitle}
                    </h2>
                  </div>

                  <div className="crayon-box-orange bg-[#FFF9ED] px-3.5 py-2 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D96B43]" />
                    <div>
                      <div className="font-bold text-[#D96B43]">
                        검증 완료 ({diaryResult.verification.attempts}회 루프)
                      </div>
                      <div className="text-[11px] text-[#756354]">
                        총 소요 시간:{" "}
                        {(diaryResult.meta.totalDurationMs / 1000).toFixed(1)}초
                      </div>
                    </div>
                  </div>
                </div>

                {/* 상단 시각 영역: 크레용 일러스트 (주인공) + 원본 사진 폴라로이드 (근거) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-[#F2ECE0] p-4 rounded-2xl border border-[#5C4A3E]/25">
                  <div className="md:col-span-7 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-[#5C4A3E]">
                      <span className="font-bold flex items-center gap-1">
                        <Palette className="w-3.5 h-3.5 text-[#D96B43]" />
                        크레용 그림일기 삽화
                      </span>
                      <span className="font-mono text-[11px] text-[#756354]">
                        {diaryResult.crayonIllustration?.fallbackSvgUsed
                          ? "크레용 스케치 폴백"
                          : diaryResult.crayonIllustration?.generatedByModel}
                      </span>
                    </div>

                    <div className="rounded-xl overflow-hidden border-2 border-[#5C4A3E]/30 bg-[#FAF6EC] aspect-[4/3] flex items-center justify-center">
                      {diaryResult.crayonIllustration?.base64Data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:${diaryResult.crayonIllustration.mimeType};base64,${diaryResult.crayonIllustration.base64Data}`}
                          alt="크레용 그림일기 삽화"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="p-6 text-center space-y-2">
                          <ImageIcon className="w-10 h-10 text-[#D96B43] mx-auto" />
                          <p className="font-handwriting text-xl text-[#5C4A3E]">
                            {diaryResult.photoAnalysis.sceneSummary}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 원본 사진 폴라로이드 카드 */}
                  <div className="md:col-span-5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-[#5C4A3E]">
                      <span className="font-bold flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5 text-[#6B7B5C]" />
                        실제 원본 사진 (사실 근거)
                      </span>
                      <span className="font-mono text-[11px] text-[#756354]">
                        #{diaryResult.photoAnalysis.photoId}
                      </span>
                    </div>
                    <div className="p-2.5 bg-[#FAF6EC] rounded-xl shadow-sm border border-[#5C4A3E]/25 rotate-[-1deg]">
                      {selectedPhoto && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedPhoto.displayDataUrl}
                          alt="원본 사진"
                          className="w-full aspect-[4/3] object-cover rounded"
                        />
                      )}
                      <div className="mt-2 text-[11px] text-center font-handwriting text-base text-[#5C4A3E]">
                        원본 기록 · {diaryResult.photoAnalysis.fileName}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 일기 본문 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#756354]">
                    <span>
                      💡 각 일기 문장을 클릭하면 연결된{" "}
                      <strong>원본 사진 근거와 검증 결과</strong>를 확인할 수
                      있습니다.
                    </span>
                  </div>

                  <div className="diary-ruled-paper bg-[#FAF6EC] p-4 sm:p-6 rounded-xl border border-[#5C4A3E]/25 font-handwriting text-2xl sm:text-[26px] text-[#3A2E25]">
                    {diaryResult.sentences.map((sentence) => {
                      const isSelected = activeSentence?.id === sentence.id;
                      return (
                        <span
                          key={sentence.id}
                          onClick={() => setActiveSentenceId(sentence.id)}
                          className={`cursor-pointer px-1.5 py-0.5 rounded transition mr-1.5 ${
                            isSelected
                              ? "bg-[#D9A441]/35 border-b-2 border-[#D96B43]"
                              : "hover:bg-[#D9A441]/15"
                          }`}
                        >
                          {sentence.text}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* 선택된 문장의 Grounding 근거 상세 박스 */}
                {activeSentence && (
                  <div className="p-4 rounded-xl bg-[#F2ECE0] border border-[#5C4A3E]/25 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[#3A2E25]">
                        🔍 선택 문장 근거 매핑 ({activeSentence.id})
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${
                            activeSentence.groundingType === "observed"
                              ? "bg-[#6B7B5C]/20 text-[#4A593D]"
                              : "bg-[#D9A441]/25 text-[#7A5813]"
                          }`}
                        >
                          {activeSentence.groundingType === "observed"
                            ? "직접 관찰 사실 (Observed)"
                            : "맥락 추론 (Context Inferred)"}
                        </span>
                        <span className="font-mono bg-[#FAF6EC] px-2 py-0.5 rounded border border-[#5C4A3E]/15">
                          출처 사진: {activeSentence.sourcePhotoIds.join(", ")}
                        </span>
                      </div>
                    </div>
                    <p className="text-[#5C4A3E]">
                      <strong>시각적 근거:</strong> {activeSentence.evidenceNote}
                    </p>
                  </div>
                )}
              </article>

              {/* 하단: 멀티모달 사실 분석 및 실제 검증 루프 감사 리포트 */}
              <div className="crayon-box-olive bg-[#FAF6EC] p-6 space-y-4">
                <h3 className="text-lg font-bold text-[#3A2E25] flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-[#6B7B5C]" />
                  <span>
                    에이전트 내부 관찰 근거 & 독립 검증 루프 감사 로그 (Audit
                    Trail)
                  </span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-[#F2ECE0] space-y-2">
                    <div className="font-bold text-[#4A593D]">
                      ✔ 사진에서 확인된 사실 (Observed Facts)
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[#3A2E25]">
                      {diaryResult.photoAnalysis.observedFacts.map(
                        (fact, i) => (
                          <li key={i}>{fact}</li>
                        )
                      )}
                    </ul>

                    <div className="font-bold text-[#D96B43] pt-2">
                      ⚠ 사진만으로 알 수 없는 불확실성 (Uncertainties)
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[#5C4A3E]">
                      {diaryResult.photoAnalysis.uncertainties.map((unc, i) => (
                        <li key={i}>{unc}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F2ECE0] space-y-2">
                    <div className="font-bold text-[#3A2E25]">
                      🛡 독립 검증기(Auditor) 판정 요약
                    </div>
                    <p className="text-[#5C4A3E] bg-[#FAF6EC] p-2.5 rounded border border-[#5C4A3E]/15">
                      {diaryResult.verification.auditorCritique}
                    </p>

                    <div className="space-y-1.5 pt-1">
                      {diaryResult.verification.sentenceAudits.map((audit) => (
                        <div
                          key={audit.sentenceId}
                          className="p-2 rounded bg-[#FAF6EC] border border-[#5C4A3E]/10"
                        >
                          <div className="flex items-center justify-between font-bold">
                            <span>문장 {audit.sentenceId}</span>
                            <span
                              className={
                                audit.verdict === "PASS"
                                  ? "text-[#4A6B3B]"
                                  : "text-[#D96B43]"
                              }
                            >
                              {audit.verdict}
                            </span>
                          </div>
                          <div className="text-[#756354] mt-0.5">
                            {audit.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
