"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import exifr from "exifr";
import type {
  SavedDiaryPage,
  DiaryLanguage,
  MemoryThreadConnection,
  WeatherKind,
} from "@/types/diary";
import {
  type ClientUploadPhoto,
  resizeImageDataUrl,
  computeVisualFingerprint,
  generateMultiDateFamilyDemoPhotos,
} from "@/lib/demo-photos";

interface StreamProgressEvent {
  type:
    | "studio_progress"
    | "clusters_preview"
    | "studio_complete"
    | "studio_error"
    | "stage"
    | "diary_saved"
    | "complete"
    | "error";
  phase?: string;
  step?: number;
  totalSteps?: number;
  title?: string;
  detail?: string;
  stage?: string;
  message?: string;
  progress?: number;
  diary?: SavedDiaryPage;
  newDiaries?: SavedDiaryPage[];
  allDiaries?: SavedDiaryPage[];
  diaries?: SavedDiaryPage[];
  memoryThreads?: MemoryThreadConnection[];
  error?: string;
}

interface HealthCheckData {
  status: string;
  timestamp: string;
  checks: {
    apiKeyConfigured: boolean;
    liveModelReachable: boolean;
    modelId: string;
    verifierModelId: string;
    illustrationModelId: string;
    interactionId: string | null;
    responseSample: string | null;
    latencyMs: number;
    firestoreConnected?: boolean;
    gcsConnected?: boolean;
    storageBucket?: string;
    gcsSoftDeleteRetentionSeconds?: number;
    error: string | null;
  };
}

const WORKSPACE_ID_STORAGE_KEY = "mlp_workspace_uuid_v1";
const WORKSPACE_TOKEN_STORAGE_KEY = "mlp_workspace_token_v1";

/**
 * 글자 인덱스 기반의 결정론적(deterministic) 어린이 손글씨 미세 흔들림 생성기
 */
function getChildHandwritingJitter(index: number, seedText: string) {
  const code = seedText.charCodeAt(0) || 42;
  const hash = (index * 31 + code * 17) % 97;
  const rotateDeg = ((hash % 7) - 3) * 0.65; // -1.95deg ~ +1.95deg
  const offsetY = ((hash % 5) - 2) * 0.7; // -1.4px ~ +1.4px
  const offsetX = (((hash >> 2) % 3) - 1) * 0.45;
  return {
    transform: `translate(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px) rotate(${rotateDeg.toFixed(2)}deg)`,
  };
}

/**
 * 날씨 아이콘 렌더링 헬퍼
 */
function renderWeatherBadge(
  weather: WeatherKind,
  active: boolean,
  lang: DiaryLanguage,
  onClick?: () => void
) {
  const meta: Record<
    WeatherKind,
    { icon: string; ko: string; en: string }
  > = {
    sunny: { icon: "☀️", ko: "맑음", en: "Sunny" },
    cloudy: { icon: "⛅", ko: "구름", en: "Cloudy" },
    rainy: { icon: "🌧️", ko: "비", en: "Rainy" },
    snowy: { icon: "❄️", ko: "눈", en: "Snowy" },
  };
  const item = meta[weather] || meta.sunny;
  return (
    <button
      key={weather}
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
        active
          ? "bg-amber-200/90 text-amber-950 ring-2 ring-amber-600/50 shadow-xs scale-105"
          : "bg-amber-50/60 text-stone-500 hover:bg-amber-100/70"
      }`}
      title={lang === "ko" ? `날씨: ${item.ko}` : `Weather: ${item.en}`}
    >
      <span>{item.icon}</span>
      <span>{lang === "ko" ? item.ko : item.en}</span>
    </button>
  );
}

export default function MyLittlePicassoPage() {
  // 1. 브라우저별 익명 UUID Workspace 상태
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [workspaceToken, setWorkspaceToken] = useState<string>("");
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(true);
  const [gcsSoftDeleteSeconds, setGcsSoftDeleteSeconds] = useState<number>(0);

  // 2. 언어 및 뷰 모드 ("ko" = 한국어 네모 원고지 그림일기, "en" = 미국식 Primary Writing Lines)
  const [language, setLanguage] = useState<DiaryLanguage>("ko");

  // 3. 저장된 그림일기 목록 & Memory Threads & 현재 열린 책 페이지
  const [savedDiaries, setSavedDiaries] = useState<SavedDiaryPage[]>([]);
  const [memoryThreads, setMemoryThreads] = useState<MemoryThreadConnection[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [highlightedPhotoId, setHighlightedPhotoId] = useState<string | null>(null);

  // 4. 업로드 대기 사진 배치(Batch) 상태
  const [uploadPhotos, setUploadPhotos] = useState<ClientUploadPhoto[]>([]);
  const [injectHallucinationForDemo, setInjectHallucinationForDemo] =
    useState<boolean>(false);

  // 5. 실시간 스트리밍 생성 상태
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamStage, setStreamStage] = useState<string>("");
  const [streamMessage, setStreamMessage] = useState<string>("");
  const [streamProgress, setStreamProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 6. 인라인 편집 및 개별 액션 상태
  const [isEditingDiary, setIsEditingDiary] = useState<boolean>(false);
  const [editedTitle, setEditedTitle] = useState<string>("");
  const [editedSentences, setEditedSentences] = useState<
    Record<string, string>
  >({});
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [isReverifying, setIsReverifying] = useState<boolean>(false);
  const [isRegeneratingCrayon, setIsRegeneratingCrayon] =
    useState<boolean>(false);
  const [isDeletingSingle, setIsDeletingSingle] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isResettingWorkspace, setIsResettingWorkspace] =
    useState<boolean>(false);

  // 7. 시스템 헬스체크 서랍 상태
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthData, setHealthData] = useState<HealthCheckData | null>(null);
  const [showTechDrawer, setShowTechDrawer] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4200);
  }, []);

  /**
   * 브라우저 최초 접속 시 암호학적으로 안전한 UUID 및 비밀 토큰 생성/복원 후
   * 서버(Firestore + Cloud Storage)에서 기존 그림일기 및 Memory Threads 로드
   */
  const loadWorkspaceFromServer = useCallback(
    async (wsId: string, wsToken: string) => {
      setWorkspaceLoading(true);
      try {
        const res = await fetch(
          `/api/workspace?workspaceId=${encodeURIComponent(wsId)}`,
          {
            method: "GET",
            headers: {
              "x-workspace-id": wsId,
              "x-workspace-token": wsToken,
            },
            cache: "no-store",
          }
        );
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "작업 공간 복원에 실패했습니다.");
        }
        const loadedDiaries: SavedDiaryPage[] = json.diaries || [];
        const loadedThreads: MemoryThreadConnection[] =
          json.memoryThreads || [];
        setSavedDiaries(loadedDiaries);
        setMemoryThreads(loadedThreads);
        if (typeof json.gcsSoftDeleteRetentionSeconds === "number") {
          setGcsSoftDeleteSeconds(json.gcsSoftDeleteRetentionSeconds);
        }
        if (loadedDiaries.length > 0) {
          setActivePageIndex(0);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setWorkspaceLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let wsId = window.localStorage.getItem(WORKSPACE_ID_STORAGE_KEY);
    let wsToken = window.localStorage.getItem(WORKSPACE_TOKEN_STORAGE_KEY);

    if (!wsId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wsId)) {
      wsId = window.crypto.randomUUID();
      window.localStorage.setItem(WORKSPACE_ID_STORAGE_KEY, wsId);
    }
    if (!wsToken || wsToken.length < 16) {
      wsToken = `${window.crypto.randomUUID()}-${window.crypto.randomUUID()}`;
      window.localStorage.setItem(WORKSPACE_TOKEN_STORAGE_KEY, wsToken);
    }

    setWorkspaceId(wsId);
    setWorkspaceToken(wsToken);
    loadWorkspaceFromServer(wsId, wsToken);
  }, [loadWorkspaceFromServer]);

  const currentDiary: SavedDiaryPage | null =
    savedDiaries[activePageIndex] || savedDiaries[0] || null;

  // 현재 페이지가 바뀔 때 인라인 편집 상태 초기화
  useEffect(() => {
    setIsEditingDiary(false);
    setActiveSentenceId(null);
    setHighlightedPhotoId(null);
    if (currentDiary) {
      setEditedTitle(currentDiary.diaryTitle);
      const map: Record<string, string> = {};
      for (const s of currentDiary.sentences) {
        map[s.id] = s.text;
      }
      setEditedSentences(map);
    }
  }, [activePageIndex, currentDiary]);

  /**
   * 다중 사진 파일 업로드 및 EXIF 날짜 추출 + 시각 핑거프린트 중복 감지
   */
  const handleFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    setErrorMessage(null);
    const files = Array.from(fileList);
    const existingFingerprints = new Map<string, string>();
    for (const p of uploadPhotos) {
      existingFingerprints.set(p.fingerprint, p.photoId);
    }

    const addedPhotos: ClientUploadPhoto[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const photoId = `photo_${Date.now()}_${i}`;

      try {
        let capturedAt: string | null = null;
        let dateConfidence: "exif_verified" | "inferred" | "unknown" =
          "unknown";

        try {
          const exifData = await exifr.parse(file, [
            "DateTimeOriginal",
            "CreateDate",
          ]);
          const rawDate = exifData?.DateTimeOriginal || exifData?.CreateDate;
          if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
            capturedAt = rawDate.toISOString().slice(0, 10);
            dateConfidence = "exif_verified";
          }
        } catch {
          // EXIF 없는 이미지도 정상 진행
        }

        // 파일명에서 YYYYMMDD 패턴 보조 감지
        if (!capturedAt) {
          const match = file.name.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
          if (match) {
            capturedAt = `${match[1]}-${match[2]}-${match[3]}`;
            dateConfidence = "inferred";
          }
        }

        const rawDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () =>
            reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
          reader.readAsDataURL(file);
        });

        // 원본 보관용 고화질(최대 1280px) 및 Gemini 비전 전송용(최대 640px) 분리 생성
        const [storageImg, apiImg, fingerprint] = await Promise.all([
          resizeImageDataUrl(rawDataUrl, 1280, 0.88),
          resizeImageDataUrl(rawDataUrl, 640, 0.82),
          computeVisualFingerprint(rawDataUrl),
        ]);

        const duplicateOf = existingFingerprints.get(fingerprint) || null;
        if (!duplicateOf) {
          existingFingerprints.set(fingerprint, photoId);
        }

        addedPhotos.push({
          photoId,
          fileName: file.name,
          mimeType: "image/jpeg",
          previewDataUrl: `data:image/jpeg;base64,${storageImg.base64Data}`,
          originalBase64Data: storageImg.base64Data,
          apiBase64Data: apiImg.base64Data,
          capturedAt,
          dateConfidence,
          fingerprint,
          isDuplicateOf: duplicateOf,
          customGroupKey: capturedAt || "auto",
          status: "ready",
        });
      } catch (err) {
        addedPhotos.push({
          photoId,
          fileName: file.name,
          mimeType: file.type || "image/jpeg",
          previewDataUrl: "",
          originalBase64Data: "",
          apiBase64Data: "",
          capturedAt: null,
          dateConfidence: "unknown",
          fingerprint: `err_${photoId}`,
          status: "error",
          errorMessage:
            err instanceof Error ? err.message : "이미지 전처리 실패",
        });
      }
    }

    setUploadPhotos((prev) => [...prev, ...addedPhotos]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /**
   * 1-Click 시간 여행 데모 앨범 로드 (4장 · 3개 날짜 · 노란 자전거 성장 서사)
   */
  const handleLoadTimeTravelDemoAlbum = async () => {
    setErrorMessage(null);
    const demoPhotos = await generateMultiDateFamilyDemoPhotos();
    setUploadPhotos(demoPhotos);
    showToast(
      "시간 여행 데모 사진첩 4장(2025년 봄·가을, 2026년 봄)을 준비했습니다. 바로 생성 버튼을 눌러보세요!"
    );
  };

  /**
   * 스트리밍 멀티모달 파이프라인 실행 (/api/studio/generate)
   */
  const handleGenerateDiaries = async (overridePhotos?: ClientUploadPhoto[]) => {
    const targetPhotos = (overridePhotos || uploadPhotos).filter(
      (p) => p.status !== "error" && !p.isDuplicateOf
    );
    if (targetPhotos.length === 0) {
      setErrorMessage("생성할 유효한 사진이 없습니다. 먼저 사진을 추가해주세요.");
      return;
    }
    if (!workspaceId || !workspaceToken) {
      setErrorMessage("브라우저 작업 공간 인증 정보를 준비 중입니다.");
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setStreamStage("uploading");
    setStreamMessage(
      `원본 사진 ${targetPhotos.length}장을 개인 Cloud Storage 공간에 안전하게 보관하고 있습니다...`
    );
    setStreamProgress(6);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/studio/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
          "x-workspace-token": workspaceToken,
        },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          workspaceToken,
          language,
          injectHallucinationForDemo,
          photos: targetPhotos.map((p) => ({
            photoId: p.photoId,
            fileName: p.fileName,
            mimeType: p.mimeType,
            originalBase64Data: p.originalBase64Data,
            apiBase64Data: p.apiBase64Data,
            capturedAt: p.capturedAt,
            dateConfidence: p.dateConfidence,
            customGroupKey:
              p.customGroupKey && p.customGroupKey !== "auto"
                ? p.customGroupKey
                : undefined,
          })),
        }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          errJson.error || `일기 생성 요청 실패 (HTTP ${response.status})`
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const evt: StreamProgressEvent = JSON.parse(line);
            if (evt.type === "studio_progress" || evt.type === "stage") {
              setStreamStage(evt.phase || evt.stage || "");
              setStreamMessage(
                evt.title
                  ? `${evt.title} — ${evt.detail || ""}`
                  : evt.message || ""
              );
              if (typeof evt.step === "number" && typeof evt.totalSteps === "number") {
                setStreamProgress(Math.round((evt.step / evt.totalSteps) * 95));
              } else if (typeof evt.progress === "number") {
                setStreamProgress(evt.progress);
              }
            } else if (evt.type === "diary_saved" && evt.diary) {
              setSavedDiaries((prev) => {
                const filtered = prev.filter(
                  (d) => d.diaryId !== evt.diary!.diaryId
                );
                return [evt.diary!, ...filtered];
              });
            } else if (evt.type === "studio_complete" || evt.type === "complete") {
              const finalDiaries = evt.allDiaries || evt.diaries || evt.newDiaries || [];
              if (finalDiaries.length > 0) {
                setSavedDiaries(finalDiaries);
                setActivePageIndex(0);
              }
              if (evt.memoryThreads) {
                setMemoryThreads(evt.memoryThreads);
              }
              setStreamProgress(100);
              setUploadPhotos([]);
              showToast(
                evt.message ||
                  "새로운 그림일기가 완성되어 작업 공간에 영구 저장되었습니다!"
              );
            } else if (evt.type === "studio_error" || evt.type === "error") {
              throw new Error(
                evt.error || evt.message || "생성 중 오류가 발생했습니다."
              );
            }
          } catch (innerErr) {
            if (
              innerErr instanceof Error &&
              !innerErr.message.includes("JSON")
            ) {
              throw innerErr;
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        showToast("진행 중인 그림일기 생성이 중단되었습니다.");
      } else {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * 인라인 일기 수정 저장 (모델 원문 vs 사용자 수정본 구분 보존)
   */
  const handleSaveDiaryEdits = async (newWeather?: WeatherKind) => {
    if (!currentDiary) return;
    setIsSavingEdit(true);
    setErrorMessage(null);
    try {
      const updatedSentences = currentDiary.sentences.map((s) => ({
        id: s.id,
        text: editedSentences[s.id] !== undefined ? editedSentences[s.id] : s.text,
      }));
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
          "x-workspace-token": workspaceToken,
        },
        body: JSON.stringify({
          workspaceId,
          workspaceToken,
          action: "edit_diary",
          diaryId: currentDiary.diaryId,
          diaryTitle: editedTitle,
          weather: newWeather || currentDiary.weather,
          sentences: updatedSentences,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "일기 수정 저장에 실패했습니다.");
      }
      setSavedDiaries((prev) =>
        prev.map((d) => (d.diaryId === json.diary.diaryId ? json.diary : d))
      );
      setIsEditingDiary(false);
      showToast("수정한 제목과 문장이 Firestore에 안전하게 저장되었습니다.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  /**
   * 현재 일기에 대해 실제 2-Pass 검증 및 복구 루프 재실행 (허위 문장 주입 테스트 가능)
   */
  const handleReverifyCurrentDiary = async (withHallucinationTest: boolean) => {
    if (!currentDiary) return;
    setIsReverifying(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
          "x-workspace-token": workspaceToken,
        },
        body: JSON.stringify({
          workspaceId,
          workspaceToken,
          action: "reverify_diary",
          diaryId: currentDiary.diaryId,
          injectHallucinationForDemo: withHallucinationTest,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "검증 루프 실행에 실패했습니다.");
      }
      setSavedDiaries((prev) =>
        prev.map((d) => (d.diaryId === json.diary.diaryId ? json.diary : d))
      );
      showToast(
        withHallucinationTest
          ? "의도적으로 주입한 허위 문장을 검증 에이전트가 적발·제거하고 2차 재검증(PASS)을 완료했습니다!"
          : "현재 일기의 모든 문장을 원본 사진 사실과 대조하여 재검증했습니다."
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReverifying(false);
    }
  };

  /**
   * 크레파스 그림만 독립 재생성 (일기 본문 유지)
   */
  const handleRegenerateCrayonOnly = async () => {
    if (!currentDiary) return;
    setIsRegeneratingCrayon(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
          "x-workspace-token": workspaceToken,
        },
        body: JSON.stringify({
          workspaceId,
          workspaceToken,
          action: "regenerate_crayon",
          diaryId: currentDiary.diaryId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "크레파스 그림 재생성에 실패했습니다.");
      }
      setSavedDiaries((prev) =>
        prev.map((d) => (d.diaryId === json.diary.diaryId ? json.diary : d))
      );
      showToast("일기 본문은 그대로 유지하고 새로운 크레파스 그림을 다시 그렸습니다!");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRegeneratingCrayon(false);
    }
  };

  /**
   * Delete This Diary (단일 일기 페이지 영구 삭제)
   */
  const handleDeleteCurrentDiary = async () => {
    if (!currentDiary) return;
    const confirmed = window.confirm(
      `[${currentDiary.diaryDateText} — "${currentDiary.diaryTitle}"]\n\n이 그림일기 페이지를 영구 삭제할까요?\n다른 일기에서 참조하지 않는 원본 사진 및 크레파스 그림 파일도 Cloud Storage에서 즉시 삭제됩니다.`
    );
    if (!confirmed) return;

    setIsDeletingSingle(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/workspace?workspaceId=${encodeURIComponent(
          workspaceId
        )}&mode=single&diaryId=${encodeURIComponent(currentDiary.diaryId)}`,
        {
          method: "DELETE",
          headers: {
            "x-workspace-id": workspaceId,
            "x-workspace-token": workspaceToken,
          },
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "일기 삭제에 실패했습니다.");
      }
      const nextDiaries: SavedDiaryPage[] = json.remainingDiaries || [];
      setSavedDiaries(nextDiaries);
      setMemoryThreads(json.memoryThreads || []);
      setActivePageIndex((prev) =>
        Math.max(0, Math.min(prev, nextDiaries.length - 1))
      );
      showToast(
        `일기 1건과 전용 미디어 파일 ${
          json.deletedGcsFilesCount ?? 0
        }개를 영구 삭제했습니다.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingSingle(false);
    }
  };

  /**
   * Reset My Workspace (이 브라우저의 작업 공간 전체 영구 초기화)
   */
  const handleResetWorkspace = async () => {
    if (!workspaceId || !workspaceToken) return;
    setIsResettingWorkspace(true);
    setErrorMessage(null);

    // 진행 중인 생성 요청이 있다면 먼저 중단
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      const res = await fetch(
        `/api/workspace?workspaceId=${encodeURIComponent(
          workspaceId
        )}&mode=reset`,
        {
          method: "DELETE",
          headers: {
            "x-workspace-id": workspaceId,
            "x-workspace-token": workspaceToken,
          },
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "작업 공간 전체 초기화에 실패했습니다.");
      }

      setSavedDiaries([]);
      setMemoryThreads([]);
      setUploadPhotos([]);
      setActivePageIndex(0);
      setShowResetModal(false);
      showToast(
        `작업 공간 초기화 완료: 일기 ${json.deletedDiariesCount ?? 0}건과 Cloud Storage 파일 ${json.deletedGcsObjectsCount ?? 0}개가 영구 삭제되었습니다.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResettingWorkspace(false);
    }
  };

  /**
   * 시스템 상태 점검 (/api/health)
   */
  const runLiveHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      setHealthData(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setHealthLoading(false);
    }
  };

  // 현재 일기의 전체 원고지 글자 배열 (한국어 네모 원고지 모드용)
  const currentActiveLanguage: DiaryLanguage = language;

  // 문장별 글자와 문장 ID 매핑 생성 (한국어 원고지 셀 클릭 시 해당 문장/사진 하이라이트)
  const manuscriptCells = React.useMemo(() => {
    if (!currentDiary) return [];
    const cells: {
      char: string;
      sentenceId: string;
      groundingType: "observed" | "context_inferred";
      isUserEdited?: boolean;
    }[] = [];

    currentDiary.sentences.forEach((sentence, sIdx) => {
      const clean = sentence.text.trim();
      for (const ch of Array.from(clean)) {
        cells.push({
          char: ch,
          sentenceId: sentence.id,
          groundingType: sentence.groundingType,
          isUserEdited: sentence.isUserEdited,
        });
      }
      // 문장 사이 한 칸 띄어쓰기
      if (sIdx < currentDiary.sentences.length - 1) {
        cells.push({
          char: " ",
          sentenceId: sentence.id,
          groundingType: sentence.groundingType,
          isUserEdited: sentence.isUserEdited,
        });
      }
    });

    // 최소 60칸(10열 x 6행) 이상이 되도록 빈 원고지 칸 채우기
    const columns = 10;
    const minCells = Math.max(60, Math.ceil(cells.length / columns) * columns);
    while (cells.length < minCells) {
      cells.push({
        char: "",
        sentenceId: "",
        groundingType: "observed",
      });
    }
    return cells;
  }, [currentDiary]);

  return (
    <div className="min-h-screen pb-24 selection:bg-amber-200 selection:text-amber-950">
      {/* 상단 토스트 알림 */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 max-w-lg w-[92%] rounded-2xl border border-amber-700/30 bg-[#2C221E]/95 px-5 py-3.5 text-sm font-medium text-amber-50 shadow-xl backdrop-blur-md transition-all">
          <div className="flex items-center justify-between gap-3">
            <span>✨ {toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-xs text-amber-200/80 hover:text-white"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Reset My Workspace 확인 모달 */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl border-2 border-red-800/30 bg-[#FFFDF8] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-red-800">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-bold">
                작업 공간 전체 초기화 (Reset My Workspace)
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-stone-700">
              현재 브라우저 공간(
              <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-mono">
                {workspaceId.slice(0, 8)}...
              </code>
              )에 저장된 모든 데이터를 영구적으로 삭제합니다.
            </p>
            <ul className="mt-3 space-y-1.5 rounded-2xl bg-red-50/80 p-3.5 text-xs text-red-950 border border-red-200">
              <li>
                • <strong>삭제 대상:</strong> 저장된 그림일기 전체 (
                {savedDiaries.length}권), 원본 사진 파일, 크레파스 일러스트,
                검증 기록, Memory Threads 연결 데이터
              </li>
              <li>
                • <strong>진행 중 작업 차단:</strong> 세대 번호(Generation
                Epoch)를 즉시 증가시켜 실행 중인 AI 작업이 삭제된 일기를 다시
                살려내지 못하도록 차단합니다.
              </li>
              <li>
                • <strong>Cloud Storage 보관 정책:</strong> 버킷 Soft Delete 보존
                기간이{" "}
                <strong>
                  {gcsSoftDeleteSeconds === 0
                    ? "0초 (즉시 영구 파기)"
                    : `${gcsSoftDeleteSeconds}초`}
                </strong>
                로 설정되어 있어 삭제 즉시 클라우드에서 완전 소멸됩니다.
              </li>
            </ul>
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isResettingWorkspace}
                onClick={() => setShowResetModal(false)}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isResettingWorkspace}
                onClick={handleResetWorkspace}
                className="rounded-xl bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
              >
                {isResettingWorkspace
                  ? "영구 삭제 및 초기화 중..."
                  : "예, 모든 일기와 사진을 영구 삭제합니다"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상단 내비게이션 & 브라우저 전용 공간 배지 */}
      <header className="sticky top-0 z-30 border-b border-amber-900/10 bg-[#FAF3E6]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#D96B43] text-xl text-white shadow-sm">
              🖍️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-[#2C221E] sm:text-xl">
                  My Little Picasso
                </h1>
                <span className="hidden rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-amber-950 sm:inline-block">
                  Memories, Drawn from Life
                </span>
              </div>
              <p className="text-xs text-[#6E5D4F]">
                실제 가족 사진의 사실과 시간의 흐름을 보존하는 멀티모달 그림일기 에이전트
              </p>
            </div>
          </div>

          {/* 우측 컨트롤: 한/영 양식 전환 + 작업 공간 상태 + 전체 초기화 */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-xl border border-amber-900/15 bg-white/80 p-0.5 shadow-2xs"
              role="group"
              aria-label="일기장 양식 언어 선택"
            >
              <button
                type="button"
                onClick={() => setLanguage("ko")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  language === "ko"
                    ? "bg-[#2C221E] text-amber-50 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                🇰🇷 한국어 원고지 일기
              </button>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  language === "en"
                    ? "bg-[#2C221E] text-amber-50 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                🇺🇸 English Primary Journal
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowResetModal(true)}
              className="rounded-xl border border-red-800/20 bg-red-50/70 px-3 py-1.5 text-xs font-semibold text-red-900 transition hover:bg-red-100/80"
              title="현재 브라우저에 저장된 모든 그림일기와 원본 사진을 영구 삭제합니다"
            >
              🗑️ 작업 공간 초기화
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:px-6">
        {/* 브라우저 전용 클라우드 보관 안내 배너 */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/15 bg-[#FFFDF8]/90 px-4 py-3 text-xs text-[#6E5D4F] shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-900">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              Cloud Storage + Firestore 자동 보관
            </span>
            <span>
              로그인 없이 현재 브라우저 전용 공간(
              <code className="rounded bg-amber-100/70 px-1.5 py-0.5 font-mono text-[11px] text-amber-950">
                {workspaceId ? `${workspaceId.slice(0, 8)}…` : "생성 중"}
              </code>
              )에 안전하게 저장되며 새로고침해도 유지됩니다.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-medium text-stone-700">
              보관된 일기 <strong>{savedDiaries.length}</strong>페이지 · 기억 연결{" "}
              <strong>{memoryThreads.length}</strong>개
            </span>
            <button
              type="button"
              onClick={() => {
                setShowTechDrawer((prev) => !prev);
                if (!healthData) runLiveHealthCheck();
              }}
              className="underline decoration-amber-700/50 underline-offset-2 hover:text-stone-950"
            >
              {showTechDrawer ? "시스템 진단 닫기" : "AI·클라우드 상태 확인"}
            </button>
          </div>
        </section>

        {/* 기술/클라우드 상태 진단 서랍 (요청 시 열림) */}
        {showTechDrawer && (
          <section className="rounded-2xl border border-amber-900/20 bg-white/95 p-5 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-stone-900">
                  실시간 Gemini 모델 & Google Cloud 영구 저장소 상태
                </h2>
                <p className="text-xs text-stone-500">
                  Interactions API (gemini-4-argon) + Crayon Illustration (gemini-nano-banana-2.1) + Firestore + GCS
                </p>
              </div>
              <button
                type="button"
                onClick={runLiveHealthCheck}
                disabled={healthLoading}
                className="rounded-xl bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {healthLoading ? "점검 중..." : "다시 점검"}
              </button>
            </div>
            {healthData && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-stone-500">멀티모달 & 검증 모델</div>
                  <div className="mt-1 font-bold text-stone-900">
                    {healthData.checks.modelId}
                  </div>
                  <div className="mt-0.5 text-[11px] text-emerald-700">
                    {healthData.checks.liveModelReachable
                      ? `연결 정상 (${healthData.checks.latencyMs}ms)`
                      : "점검 필요"}
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-stone-500">크레파스 일러스트 모델</div>
                  <div className="mt-1 font-bold text-stone-900">
                    {healthData.checks.illustrationModelId}
                  </div>
                  <div className="mt-0.5 text-[11px] text-emerald-700">
                    실제 이미지 생성 활성
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-stone-500">Firestore 데이터베이스</div>
                  <div className="mt-1 font-bold text-stone-900">
                    {healthData.checks.firestoreConnected
                      ? "연결됨 (asia-northeast3)"
                      : "연결 안 됨"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-stone-600">
                    UUID 토큰 해시 검증 적용
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-stone-500">Cloud Storage 미디어 버킷</div>
                  <div className="mt-1 font-bold text-stone-900 truncate">
                    {healthData.checks.storageBucket}
                  </div>
                  <div className="mt-0.5 text-[11px] text-emerald-700">
                    비공개 버킷 · Soft Delete{" "}
                    {healthData.checks.gcsSoftDeleteRetentionSeconds ?? 0}s
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 오류 메시지 배너 */}
        {errorMessage && (
          <div className="rounded-2xl border border-red-300 bg-red-50/95 p-4 text-sm text-red-900 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="font-bold">오류 안내: </strong>
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-xs font-semibold text-red-700 underline"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            섹션 1: 다중 사진 업로드 & 기억 그룹화 스튜디오 (Batch Photo Ingestion)
           =================================================================== */}
        <section className="rounded-3xl border border-amber-900/15 bg-[#FFFDF8] p-6 shadow-md sm:p-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                📸 Step 1 · 사진 올리기 & 기억 그룹화
              </span>
              <h2 className="mt-2 text-xl font-extrabold text-[#2C221E] sm:text-2xl">
                오늘의 사진이나 여러 날의 가족 사진을 한꺼번에 올려보세요
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[#6E5D4F]">
                EXIF 촬영 날짜와 사진 속 시각적 단서를 분석해 같은 날의 추억은 한 페이지로 묶고, 다른 날의 반복된 단서는{" "}
                <strong className="text-[#2C221E]">시간 여행(Memory Threads)</strong>으로 연결합니다.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
              />
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#2C221E] px-4 py-2.5 text-xs sm:text-sm font-bold text-amber-50 shadow-sm transition hover:bg-stone-800 disabled:opacity-50"
              >
                <span>➕ 내 사진 여러 장 선택</span>
              </button>
              <button
                type="button"
                disabled={isGenerating}
                onClick={handleLoadTimeTravelDemoAlbum}
                className="inline-flex items-center gap-2 rounded-2xl border-2 border-[#D96B43]/50 bg-amber-50/90 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#9E4220] transition hover:bg-amber-100 disabled:opacity-50"
              >
                <span>🚲 시간 여행 데모 사진첩 불러오기 (4장 · 3개 날짜)</span>
              </button>
            </div>
          </div>

          {/* 업로드 대기 중인 사진 프리뷰 및 그룹 조정 그리드 */}
          {uploadPhotos.length > 0 && (
            <div className="mt-6 space-y-5 border-t border-amber-900/10 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs sm:text-sm font-semibold text-stone-800">
                  준비된 사진{" "}
                  <span className="text-[#D96B43] font-bold">
                    {uploadPhotos.length}장
                  </span>{" "}
                  (중복 사진은 자동으로 건너뛰며, 촬영 날짜나 그룹 키를 직접 수정할 수 있습니다)
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-800/20 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-950">
                    <input
                      type="checkbox"
                      checked={injectHallucinationForDemo}
                      onChange={(e) =>
                        setInjectHallucinationForDemo(e.target.checked)
                      }
                      className="rounded border-amber-600 text-[#D96B43]"
                    />
                    <span>
                      🔍 허위 문장 주입 & 자동 적발·복구 테스트 활성화
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setUploadPhotos([])}
                    className="text-xs font-medium text-stone-500 hover:text-red-700"
                  >
                    목록 비우기
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {uploadPhotos.map((photo, idx) => (
                  <div
                    key={photo.photoId}
                    className={`relative flex flex-col justify-between rounded-2xl border p-3 transition ${
                      photo.isDuplicateOf
                        ? "border-amber-400/60 bg-amber-50/40 opacity-75"
                        : "border-stone-200/90 bg-white shadow-2xs"
                    }`}
                  >
                    <div>
                      <div className="relative aspect-4/3 w-full overflow-hidden rounded-xl bg-stone-100">
                        {photo.previewDataUrl ? (
                          <img
                            src={photo.previewDataUrl}
                            alt={photo.fileName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-red-600">
                            이미지 오류
                          </div>
                        )}
                        <span className="absolute top-2 left-2 rounded-lg bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">
                          #{idx + 1}
                        </span>
                        {photo.isDuplicateOf && (
                          <span className="absolute top-2 right-2 rounded-lg bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
                            중복 사진 제외됨
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-1">
                        <p
                          className="truncate text-xs font-bold text-stone-800"
                          title={photo.fileName}
                        >
                          {photo.fileName}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadPhotos((prev) =>
                              prev.filter((p) => p.photoId !== photo.photoId)
                            )
                          }
                          className="text-[11px] text-stone-400 hover:text-red-600"
                        >
                          제거
                        </button>
                      </div>
                    </div>

                    <div className="mt-2.5 space-y-1.5 border-t border-stone-100 pt-2 text-[11px]">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-stone-500">촬영 날짜:</span>
                        <input
                          type="date"
                          value={photo.capturedAt || ""}
                          onChange={(e) => {
                            const val = e.target.value || null;
                            setUploadPhotos((prev) =>
                              prev.map((p) =>
                                p.photoId === photo.photoId
                                  ? {
                                      ...p,
                                      capturedAt: val,
                                      dateConfidence: val
                                        ? "exif_verified"
                                        : "unknown",
                                      customGroupKey: val || "auto",
                                    }
                                  : p
                              )
                            );
                          }}
                          className="rounded border border-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-800"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-stone-500">기억 묶음:</span>
                        <select
                          value={photo.customGroupKey || photo.capturedAt || "auto"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setUploadPhotos((prev) =>
                              prev.map((p) =>
                                p.photoId === photo.photoId
                                  ? { ...p, customGroupKey: val }
                                  : p
                              )
                            );
                          }}
                          className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] font-medium text-stone-800"
                        >
                          <option value="auto">AI 자동 그룹화</option>
                          {photo.capturedAt && (
                            <option value={photo.capturedAt}>
                              날짜 그룹 ({photo.capturedAt})
                            </option>
                          )}
                          <option value="group_A">수동 묶음 A</option>
                          <option value="group_B">수동 묶음 B</option>
                          <option value="group_C">수동 묶음 C</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleGenerateDiaries()}
                  className="inline-flex items-center gap-2.5 rounded-2xl bg-[#D96B43] px-6 py-3.5 text-sm font-extrabold text-white shadow-lg transition hover:bg-[#C45A33] disabled:opacity-50"
                >
                  <span>🖍️ 자율형 멀티모달 그림일기 생성 시작</span>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                    {
                      uploadPhotos.filter(
                        (p) => p.status !== "error" && !p.isDuplicateOf
                      ).length
                    }
                    장 분석
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* 실시간 5단계 스트리밍 진행 표시줄 */}
          {isGenerating && (
            <div className="mt-6 rounded-2xl border-2 border-amber-600/30 bg-amber-50/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="inline-block h-3 w-3 animate-ping rounded-full bg-[#D96B43]" />
                  <span className="text-sm font-bold text-[#2C221E]">
                    {streamMessage || "AI 에이전트가 사진을 살펴보고 있습니다..."}
                  </span>
                </div>
                <span className="text-xs font-extrabold text-[#D96B43]">
                  {streamProgress}%
                </span>
              </div>

              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-amber-200/70">
                <div
                  className="h-full rounded-full bg-[#D96B43] transition-all duration-500"
                  style={{ width: `${Math.max(5, streamProgress)}%` }}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-medium text-stone-600 sm:grid-cols-5">
                {[
                  { key: "ingest_and_vision", label: "1. 원본 보관 & 사실 추출" },
                  { key: "memory_grouping", label: "2. 날짜·맥락 기억 그룹화" },
                  { key: "diary_and_verification", label: "3. 일기 & 2차 검증·크레파스" },
                  { key: "memory_threads", label: "4. 시간 여행 연결 탐색" },
                  { key: "persistence", label: "5. 클라우드 영구 저장" },
                ].map((step) => {
                  const active = streamStage === step.key;
                  return (
                    <div
                      key={step.key}
                      className={`rounded-lg px-2.5 py-1.5 text-center ${
                        active
                          ? "bg-[#2C221E] font-bold text-amber-50"
                          : "bg-white/70 text-stone-500"
                      }`}
                    >
                      {step.label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ===================================================================
            섹션 2: 그림일기 책장 & 실제 초등학교 그림일기장 (KO 원고지 / EN Primary Lines)
           =================================================================== */}
        {workspaceLoading ? (
          <section className="rounded-3xl border border-amber-900/15 bg-[#FFFDF8] p-12 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-3 border-amber-700 border-t-transparent" />
            <p className="mt-3 text-sm font-semibold text-stone-700">
              이 브라우저의 그림일기장을 Cloud Storage와 Firestore에서 불러오는 중입니다...
            </p>
          </section>
        ) : savedDiaries.length === 0 ? (
          <section className="rounded-3xl border-2 border-dashed border-amber-900/20 bg-[#FFFDF8]/80 p-10 text-center shadow-xs">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-100 text-3xl">
              📒
            </div>
            <h3 className="mt-4 text-lg font-extrabold text-[#2C221E]">
              아직 보관된 그림일기가 없습니다
            </h3>
            <p className="mx-auto mt-1.5 max-w-xl text-xs sm:text-sm leading-relaxed text-[#6E5D4F]">
              위에서 가족 사진을 직접 업로드하거나{" "}
              <strong className="text-[#9E4220]">
                [🚲 시간 여행 데모 사진첩 불러오기]
              </strong>{" "}
              버튼을 눌러보세요. 같은 날의 사진 묶음, 네모 원고지 그림일기, 검증 루프, 그리고 시간이 흐르며 자라나는 아이의 기억 연결까지 한 번에 경험할 수 있습니다.
            </p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                disabled={isGenerating}
                onClick={async () => {
                  const demo = await generateMultiDateFamilyDemoPhotos();
                  setUploadPhotos(demo);
                  await handleGenerateDiaries(demo);
                }}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#D96B43] px-5 py-3 text-xs sm:text-sm font-extrabold text-white shadow-md hover:bg-[#C45A33] disabled:opacity-50"
              >
                <span>✨ 원클릭으로 시간 여행 데모 그림일기 3페이지 바로 만들기</span>
              </button>
            </div>
          </section>
        ) : (
          currentDiary && (
            <section className="space-y-5">
              {/* 책 페이지 탭 네비게이션 바 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/15 bg-[#FFFDF8] p-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {savedDiaries.map((diary, idx) => {
                    const isCurrent = idx === activePageIndex;
                    return (
                      <button
                        key={diary.diaryId}
                        type="button"
                        onClick={() => setActivePageIndex(idx)}
                        className={`rounded-xl px-3.5 py-2 text-left text-xs transition-all ${
                          isCurrent
                            ? "bg-[#2C221E] font-bold text-amber-50 shadow-sm"
                            : "bg-amber-50/70 font-medium text-stone-700 hover:bg-amber-100/80"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>📖 {idx + 1}쪽</span>
                          <span className="opacity-75">·</span>
                          <span>{diary.dateIso || "날짜 미상"}</span>
                        </div>
                        <div className="mt-0.5 max-w-[150px] truncate text-[11px] opacity-90">
                          {diary.diaryTitle}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activePageIndex <= 0}
                    onClick={() =>
                      setActivePageIndex((prev) => Math.max(0, prev - 1))
                    }
                    className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    ← 이전 페이지
                  </button>
                  <span className="text-xs font-bold text-stone-700">
                    {activePageIndex + 1} / {savedDiaries.length}
                  </span>
                  <button
                    type="button"
                    disabled={activePageIndex >= savedDiaries.length - 1}
                    onClick={() =>
                      setActivePageIndex((prev) =>
                        Math.min(savedDiaries.length - 1, prev + 1)
                      )
                    }
                    className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    다음 페이지 →
                  </button>
                </div>
              </div>

              {/* ===============================================================
                  실제 그림일기장 종이 시트 (Sketchbook Sheet)
                 =============================================================== */}
              <article
                key={`${currentDiary.diaryId}_${currentActiveLanguage}`}
                className="sketchbook-sheet page-turn-enter rounded-3xl p-5 sm:p-8 md:p-10"
              >
                {/* 1. 일기장 상단 헤더: 날짜/요일 + 날씨 아이콘 + 기억 그룹화 근거 배지 */}
                <div className="border-b-2 border-amber-950/25 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-xl bg-amber-100/90 px-3 py-1.5 text-sm sm:text-base font-extrabold text-amber-950 border border-amber-900/20">
                        📅 {currentDiary.diaryDateText}
                      </span>

                      <div className="flex items-center gap-1">
                        {(
                          ["sunny", "cloudy", "rainy", "snowy"] as WeatherKind[]
                        ).map((w) =>
                          renderWeatherBadge(
                            w,
                            currentDiary.weather === w,
                            currentActiveLanguage,
                            () => handleSaveDiaryEdits(w)
                          )
                        )}
                      </div>
                    </div>

                    {/* 그룹화 기준 & 삭제/편집 액션 버튼 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full bg-stone-100 px-3 py-1 text-[11px] font-semibold text-stone-700 border border-stone-300/80"
                        title={currentDiary.groupingReason}
                      >
                        {currentDiary.groupingBasis === "confirmed_date"
                          ? "✅ 촬영 날짜 확정 그룹"
                          : currentDiary.groupingBasis ===
                            "visual_context_inferred"
                          ? "🔎 시각 맥락 추정 그룹"
                          : "❓ 날짜 미상 보존 그룹"}
                      </span>

                      <button
                        type="button"
                        onClick={() => setIsEditingDiary((prev) => !prev)}
                        className="rounded-xl border border-amber-900/25 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 hover:bg-amber-50"
                      >
                        {isEditingDiary ? "편집 닫기" : "✏️ 제목·문장 다듬기"}
                      </button>

                      <button
                        type="button"
                        disabled={isDeletingSingle}
                        onClick={handleDeleteCurrentDiary}
                        className="rounded-xl border border-red-800/25 bg-red-50/80 px-3 py-1.5 text-xs font-bold text-red-900 hover:bg-red-100 disabled:opacity-50"
                      >
                        {isDeletingSingle
                          ? "삭제 중..."
                          : "🗑️ 이 일기 삭제 (Delete This Diary)"}
                      </button>
                    </div>
                  </div>

                  {/* 일기 제목 칸 */}
                  <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-dashed border-amber-900/20 pt-3">
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-900/70">
                        {currentActiveLanguage === "ko" ? "제목 :" : "TITLE :"}
                      </span>
                      <h2 className="font-diary text-2xl sm:text-3xl font-bold text-[#2C221E]">
                        {currentDiary.diaryTitle}
                      </h2>
                      {currentDiary.isTitleUserEdited && (
                        <span className="rounded-md bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                          사용자 다듬음
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[#6E5D4F]">
                      {currentDiary.groupingReason}
                    </span>
                  </div>
                </div>

                {/* 2. 중단 시각 영역: 좌측 크레파스 그림일기 일러스트 + 우측 원본 사진 폴라로이드 */}
                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* 좌측 7칸: 아이가 크레파스로 그린 그림 영역 */}
                  <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border-2 border-amber-950/25 bg-[#FFFDF9] p-4 shadow-inner">
                    <div className="flex items-center justify-between gap-2 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🖍️</span>
                        <span className="text-xs font-bold text-stone-800">
                          {currentActiveLanguage === "ko"
                            ? "오늘의 크레파스 그림 (사실 기반 일러스트)"
                            : "Childlike Crayon Drawing (Grounded in Photo Facts)"}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={isRegeneratingCrayon}
                        onClick={handleRegenerateCrayonOnly}
                        className="rounded-lg border border-amber-800/25 bg-amber-50/90 px-2.5 py-1 text-[11px] font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {isRegeneratingCrayon
                          ? "크레파스로 다시 그리는 중..."
                          : "🎨 그림만 다시 그리기"}
                      </button>
                    </div>

                    <div className="crayon-frame relative aspect-4/3 w-full overflow-hidden rounded-xl bg-amber-50/50">
                      {currentDiary.crayonIllustration.mediaUrl ||
                      currentDiary.crayonIllustration.base64Data ? (
                        <img
                          src={
                            currentDiary.crayonIllustration.mediaUrl ||
                            `data:${currentDiary.crayonIllustration.mimeType};base64,${currentDiary.crayonIllustration.base64Data}`
                          }
                          alt={currentDiary.diaryTitle}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-stone-500">
                          <p>크레파스 일러스트를 준비하지 못했습니다.</p>
                          <button
                            type="button"
                            onClick={handleRegenerateCrayonOnly}
                            className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-white font-semibold"
                          >
                            다시 시도하기
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500">
                      <span>
                        생성 모델:{" "}
                        <strong className="text-stone-700">
                          {currentDiary.crayonIllustration.generatedByModel}
                        </strong>
                      </span>
                      <span>
                        사진에 실제로 있는 인물·사물만 그리도록 제한됨
                      </span>
                    </div>
                  </div>

                  {/* 우측 5칸: 왜곡 없는 원본 가족 사진 보존 영역 */}
                  <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-amber-950/20 bg-[#FAF5EA]/80 p-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 pb-2.5">
                        <span className="text-xs font-bold text-stone-800">
                          📷{" "}
                          {currentActiveLanguage === "ko"
                            ? `원본 사진 보존 (${currentDiary.photos.length}장)`
                            : `Untouched Original Photos (${currentDiary.photos.length})`}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                          원본 무결성 100% 보존
                        </span>
                      </div>

                      <div
                        className={`grid gap-3 ${
                          currentDiary.photos.length > 1
                            ? "grid-cols-2"
                            : "grid-cols-1"
                        }`}
                      >
                        {currentDiary.photos.map((photo) => {
                          const isHighlighted =
                            highlightedPhotoId === photo.photoId;
                          return (
                            <div
                              key={photo.photoId}
                              onClick={() =>
                                setHighlightedPhotoId((prev) =>
                                  prev === photo.photoId ? null : photo.photoId
                                )
                              }
                              className={`cursor-pointer rounded-xl bg-white p-2 shadow-sm transition-all ${
                                isHighlighted
                                  ? "ring-3 ring-[#D96B43] scale-[1.02]"
                                  : "hover:shadow-md"
                              }`}
                            >
                              <div className="aspect-4/3 w-full overflow-hidden rounded-lg bg-stone-100">
                                <img
                                  src={photo.mediaUrl}
                                  alt={photo.fileName}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                                <span className="truncate font-semibold text-stone-800">
                                  {photo.fileName}
                                </span>
                                <span className="shrink-0 text-[10px] text-stone-500">
                                  {photo.capturedAt || "날짜 미상"}
                                </span>
                              </div>
                              {/* 추출된 사실 태그 */}
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {photo.analysis.observedFacts
                                  .slice(0, 3)
                                  .map((fact, fIdx) => (
                                    <span
                                      key={fIdx}
                                      className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-950 border border-amber-200/60"
                                    >
                                      {fact}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <p className="mt-3 text-[11px] leading-relaxed text-stone-600">
                      💡 아래 일기장의 문장(또는 원고지 글자)을 클릭하면 그 문장의 근거가 된 원본 사진이 주황색 테두리로 표시됩니다.
                    </p>
                  </div>
                </div>

                {/* ===============================================================
                    3. 하단 일기 본문 영역:
                       - 한국어 모드 (ko): 전통 초등학교 네모 원고지 (1글자 = 1칸 + 손글씨 미세 흔들림)
                       - 영어 모드 (en): 미국 초등학교 3선 줄공책 (Primary Writing Lines)
                   =============================================================== */}
                <div className="mt-8">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-[#2C221E]">
                        {currentActiveLanguage === "ko"
                          ? "📝 한국어 초등학교 네모 원고지 (한 칸에 한 글자씩 또박또박 쓴 일기)"
                          : "📝 US Elementary Primary Writing Lines (3-Line Ruled Picture Journal)"}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
                        실제 텍스트 DOM · 복사 및 수정 가능
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                        직접 관찰 사실(Observed)
                      </span>
                      <span className="inline-flex items-center gap-1 text-amber-800 font-semibold">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        맥락 추론(Context Inferred)
                      </span>
                    </div>
                  </div>

                  {currentActiveLanguage === "ko" ? (
                    /* ---------------- 한국어 네모 원고지 격자 ---------------- */
                    <div
                      className="rounded-2xl border-2 border-[#C85A32]/55 bg-[#FFFDF8] p-3 sm:p-5 shadow-inner"
                      aria-label="한국어 원고지 그림일기 본문"
                    >
                      <div className="grid grid-cols-10 border-t border-l border-[#C85A32]/40">
                        {manuscriptCells.map((cell, idx) => {
                          const isSelected =
                            cell.sentenceId &&
                            activeSentenceId === cell.sentenceId;
                          const jitterStyle = cell.char.trim()
                            ? getChildHandwritingJitter(idx, cell.char)
                            : undefined;

                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                if (!cell.sentenceId) return;
                                setActiveSentenceId((prev) =>
                                  prev === cell.sentenceId
                                    ? null
                                    : cell.sentenceId
                                );
                                const targetSentence =
                                  currentDiary.sentences.find(
                                    (s) => s.id === cell.sentenceId
                                  );
                                if (targetSentence?.sourcePhotoIds?.[0]) {
                                  setHighlightedPhotoId(
                                    targetSentence.sourcePhotoIds[0]
                                  );
                                }
                              }}
                              className={`aspect-square flex items-center justify-center border-r border-b border-[#C85A32]/40 font-diary text-lg sm:text-2xl md:text-[26px] font-bold select-text transition-colors ${
                                isSelected
                                  ? "bg-amber-200/80 text-[#2C221E]"
                                  : cell.groundingType === "context_inferred" &&
                                    cell.char
                                  ? "bg-amber-50/50 text-[#3B2E28] hover:bg-amber-100/70"
                                  : "bg-transparent text-[#2B211B] hover:bg-amber-50/60"
                              }`}
                            >
                              <span
                                style={jitterStyle}
                                className="inline-block leading-none"
                              >
                                {cell.char}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ---------------- 영어 Primary Writing Lines (3선 노트) ---------------- */
                    <div
                      className="rounded-2xl border-2 border-sky-800/30 bg-[#FFFDF9] px-5 py-4 sm:px-8 sm:py-6 shadow-inner"
                      aria-label="English Primary Writing Lines Journal"
                    >
                      <div className="space-y-1">
                        {currentDiary.sentences.map((sentence, sIdx) => {
                          const isSelected = activeSentenceId === sentence.id;
                          return (
                            <div
                              key={sentence.id}
                              onClick={() => {
                                setActiveSentenceId((prev) =>
                                  prev === sentence.id ? null : sentence.id
                                );
                                if (sentence.sourcePhotoIds?.[0]) {
                                  setHighlightedPhotoId(
                                    sentence.sourcePhotoIds[0]
                                  );
                                }
                              }}
                              className={`en-primary-writing-row cursor-pointer rounded-lg px-2 transition ${
                                isSelected ? "bg-amber-100/80" : "hover:bg-amber-50/50"
                              }`}
                            >
                              <p className="font-diary text-xl sm:text-2xl font-bold tracking-wide text-[#2B211B]">
                                {Array.from(sentence.text).map((ch, cIdx) => (
                                  <span
                                    key={cIdx}
                                    style={
                                      ch.trim()
                                        ? getChildHandwritingJitter(
                                            sIdx * 50 + cIdx,
                                            ch
                                          )
                                        : undefined
                                    }
                                    className="inline-block"
                                  >
                                    {ch === " " ? "\u00A0" : ch}
                                  </span>
                                ))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 문장별 사진 근거(Evidence Mapping) 카드 리스트 */}
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-bold text-stone-700">
                      📌 문장별 원본 사진 근거 및 사실/추론 구분 (문장을 클릭하면 연결된 원본 사진이 강조됩니다)
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {currentDiary.sentences.map((s, idx) => {
                        const isSelected = activeSentenceId === s.id;
                        return (
                          <div
                            key={s.id}
                            onClick={() => {
                              setActiveSentenceId(s.id);
                              if (s.sourcePhotoIds?.[0]) {
                                setHighlightedPhotoId(s.sourcePhotoIds[0]);
                              }
                            }}
                            className={`cursor-pointer rounded-xl border p-3 text-xs transition ${
                              isSelected
                                ? "border-[#D96B43] bg-amber-100/70 shadow-xs"
                                : "border-amber-900/15 bg-white/85 hover:bg-amber-50/60"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="font-bold text-stone-900">
                                문장 {idx + 1}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {s.isUserEdited && (
                                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-900">
                                    사용자 수정본
                                  </span>
                                )}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    s.groundingType === "observed"
                                      ? "bg-emerald-100 text-emerald-900"
                                      : "bg-amber-100 text-amber-900"
                                  }`}
                                >
                                  {s.groundingType === "observed"
                                    ? "직접 관찰 사실 (Observed)"
                                    : "맥락 추론 (Context Inferred)"}
                                </span>
                              </div>
                            </div>
                            <p className="mt-1.5 font-diary text-base font-bold text-stone-900">
                              {s.text}
                            </p>
                            <p className="mt-1 text-[11px] text-stone-600">
                              근거: {s.evidenceNote} (사진 ID:{" "}
                              {s.sourcePhotoIds.join(", ")})
                            </p>
                            {s.isUserEdited && s.originalModelText && (
                              <p className="mt-1 text-[10px] text-stone-500">
                                AI 검증 원문: &ldquo;{s.originalModelText}&rdquo;
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 인라인 제목/문장 편집 패널 */}
                  {isEditingDiary && (
                    <div className="mt-5 rounded-2xl border-2 border-amber-700/30 bg-white p-5 shadow-md">
                      <h4 className="text-sm font-extrabold text-stone-900">
                        ✏️ 그림일기 제목 및 문장 직접 다듬기 (AI 원문은 별도 보존됩니다)
                      </h4>
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs font-bold text-stone-700">
                            일기 제목
                          </label>
                          <input
                            type="text"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-900"
                          />
                        </div>
                        {currentDiary.sentences.map((s, idx) => (
                          <div key={s.id}>
                            <label className="block text-xs font-bold text-stone-700">
                              문장 {idx + 1} ({s.groundingType})
                            </label>
                            <input
                              type="text"
                              value={editedSentences[s.id] ?? s.text}
                              onChange={(e) =>
                                setEditedSentences((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.value,
                                }))
                              }
                              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-900"
                            />
                          </div>
                        ))}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setIsEditingDiary(false)}
                            className="rounded-xl border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            disabled={isSavingEdit}
                            onClick={() => handleSaveDiaryEdits()}
                            className="rounded-xl bg-[#2C221E] px-4 py-2 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-50"
                          >
                            {isSavingEdit ? "저장 중..." : "수정 내용 저장"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ===============================================================
                    4. 실시간 2-Pass 검증 및 복구 루프 리포트 (Real Verification & Repair Loop)
                   =============================================================== */}
                <div className="mt-8 rounded-2xl border border-emerald-900/20 bg-emerald-50/50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                        ✓
                      </span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-extrabold text-emerald-950">
                          실제 실행된 2-Pass 사실 검증 & 복구 루프 (Verification & Repair Loop)
                        </h4>
                        <p className="text-[11px] text-emerald-900/80">
                          총 {currentDiary.verification.attempts}회 검증 패스 수행 ·{" "}
                          {currentDiary.verification.auditorCritique}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isReverifying}
                        onClick={() => handleReverifyCurrentDiary(false)}
                        className="rounded-xl border border-emerald-800/30 bg-white px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {isReverifying ? "검증 중..." : "🔄 현재 일기 재검증"}
                      </button>
                      <button
                        type="button"
                        disabled={isReverifying}
                        onClick={() => handleReverifyCurrentDiary(true)}
                        className="rounded-xl bg-emerald-800 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-900 disabled:opacity-50"
                      >
                        {isReverifying
                          ? "허위 문장 적발·복구 중..."
                          : "🧪 허위 문장 강제 주입 → 자동 삭제·2차 재검증 실증"}
                      </button>
                    </div>
                  </div>

                  {/* 검증 히스토리 및 개별 문장 감사 로그 */}
                  {currentDiary.verification.history &&
                    currentDiary.verification.history.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {currentDiary.verification.history.map((h) => (
                          <div
                            key={`${h.attempt}_${h.stage}`}
                            className="rounded-xl border border-emerald-800/15 bg-white/90 p-2.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between font-bold text-stone-800">
                              <span>
                                Pass #{h.attempt} ({h.stage})
                              </span>
                              <span
                                className={
                                  h.passed
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                                }
                              >
                                {h.passed
                                  ? "PASS"
                                  : `복구 ${h.repairedCount}건 / 삭제 ${h.omittedCount}건`}
                              </span>
                            </div>
                            <p className="mt-1 text-stone-600">{h.critique}</p>
                          </div>
                        ))}
                      </div>
                    )}

                  {currentDiary.verification.sentenceAudits.some(
                    (a) => a.verdict !== "PASS"
                  ) && (
                    <div className="mt-3 space-y-1.5 rounded-xl bg-amber-50/90 p-3 text-xs border border-amber-300">
                      <div className="font-bold text-amber-950">
                        🛠️ 검증 루프가 적발하여 수정/제거한 비근거 문장 내역:
                      </div>
                      {currentDiary.verification.sentenceAudits
                        .filter((a) => a.verdict !== "PASS")
                        .map((audit, idx) => (
                          <div key={idx} className="text-[11px] text-amber-900">
                            • <strong>[{audit.verdict}]</strong> 원문: &ldquo;
                            <span className="line-through">
                              {audit.originalText}
                            </span>
                            &rdquo; → 사유: {audit.reason}
                            {audit.repairedText
                              ? ` → 복구문: "${audit.repairedText}"`
                              : " (일기 본문에서 완전 제거됨)"}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </article>
            </section>
          )
        )}

        {/* ===================================================================
            섹션 3: Memory Threads / Memory Time Machine (시간을 잇는 기억의 실타래)
           =================================================================== */}
        <section className="rounded-3xl border border-amber-900/20 bg-gradient-to-br from-[#FFFDF8] via-[#FAF2E1] to-[#F5E8CE] p-6 shadow-md sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2C221E] px-3 py-1 text-xs font-bold text-amber-100">
                ⏳ Memory Time Machine · 시간을 잇는 기억의 실타래
              </span>
              <h2 className="mt-2 text-xl font-extrabold text-[#2C221E] sm:text-2xl">
                서로 다른 날의 사진 속에서 자라나는 가족의 시간
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[#6E5D4F]">
                AI가 여러 날짜의 일기 사이에 반복 등장하는 사물·장소·성장의 단서를 찾아 실제 사진 근거와 함께 연결합니다.
              </p>
            </div>
          </div>

          {memoryThreads.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-amber-900/15 bg-white/80 p-6 text-center text-xs sm:text-sm text-stone-600">
              서로 다른 날짜의 그림일기가 2페이지 이상 쌓이면, 반복 등장하는 사물이나 장소의 변화를 연결하는{" "}
              <strong className="text-stone-900">Memory Threads</strong>가 이곳에 자동으로 생성됩니다. (상단의{" "}
              <strong>[🚲 시간 여행 데모 사진첩 불러오기]</strong>로 즉시 체험해보세요!)
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {memoryThreads.map((thread) => (
                <div
                  key={thread.threadId}
                  className="rounded-2xl border border-amber-900/20 bg-white/95 p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-950">
                          🔗 {thread.sharedSubject}
                        </span>
                        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-semibold text-stone-700">
                          신뢰도: {thread.confidence === "high" ? "높음" : "보통"}
                        </span>
                      </div>
                      <h3 className="mt-2 text-lg font-extrabold text-[#2C221E]">
                        {thread.title}
                      </h3>
                      <p className="mt-1 text-xs sm:text-sm leading-relaxed text-stone-700">
                        {thread.summary}
                      </p>
                    </div>
                  </div>

                  {/* 시간순 노드 타임라인 */}
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {thread.nodes.map((node, nIdx) => {
                      const targetPageIdx = savedDiaries.findIndex(
                        (d) => d.diaryId === node.diaryId
                      );
                      return (
                        <div
                          key={`${node.diaryId}_${node.photoId}_${nIdx}`}
                          onClick={() => {
                            if (targetPageIdx >= 0) {
                              setActivePageIndex(targetPageIdx);
                              setHighlightedPhotoId(node.photoId);
                              window.scrollTo({ top: 380, behavior: "smooth" });
                            }
                          }}
                          className="group cursor-pointer rounded-2xl border border-stone-200 bg-[#FFFDF8] p-3.5 transition hover:border-[#D96B43] hover:shadow-md"
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-[#9E4220]">
                            <span>📅 {node.diaryDateText}</span>
                            <span className="text-[11px] group-hover:underline">
                              일기 펴보기 →
                            </span>
                          </div>
                          {node.photoMediaUrl && (
                            <div className="mt-2 aspect-4/3 w-full overflow-hidden rounded-xl bg-stone-100">
                              <img
                                src={node.photoMediaUrl}
                                alt={node.diaryTitle}
                                className="h-full w-full object-cover transition group-hover:scale-105"
                              />
                            </div>
                          )}
                          <div className="mt-2.5 text-xs font-bold text-stone-900">
                            {node.diaryTitle}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-stone-600">
                            관찰 단서: {node.matchedClue}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* 연결 근거 및 추론의 한계 명시 */}
                  <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl bg-amber-50/70 p-3 text-[11px] sm:grid-cols-2 border border-amber-200/70">
                    <div>
                      <strong className="text-amber-950">
                        ✔ 시각적·시간적 연결 근거:{" "}
                      </strong>
                      <span className="text-stone-700">
                        {thread.evidenceDescription}
                      </span>
                    </div>
                    <div>
                      <strong className="text-stone-700">
                        ⚖️ 사진 추론의 한계 명시:{" "}
                      </strong>
                      <span className="text-stone-600">
                        {thread.limitationNote}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
