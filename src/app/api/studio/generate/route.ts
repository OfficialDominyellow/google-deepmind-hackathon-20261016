import { NextResponse } from "next/server";
import {
  analyzePhotoWithArgon,
  clusterPhotosIntoMemoryGroups,
  discoverMemoryThreadsAcrossDiaries,
  generateVerifiedDiaryForCluster,
  ILLUSTRATION_MODEL,
  type StudioProgressEvent,
} from "@/lib/gemini";
import {
  beginWorkspaceGenerationJob,
  listWorkspaceDiaries,
  saveGeneratedDiariesAndThreads,
  uploadWorkspaceMediaToGcs,
  WorkspaceAccessDeniedError,
  WorkspaceConflictError,
} from "@/lib/storage";
import type {
  DiaryLanguage,
  SavedDiaryPage,
  StoredPhotoItem,
} from "@/types/diary";

interface IncomingPhotoInput {
  photoId: string;
  fileName: string;
  mimeType: string;
  /** Gemini 비전 분석용 경량 Base64 이미지 (640px) */
  apiBase64Data: string;
  /** Cloud Storage에 원본 보존할 Base64 이미지 (생략 시 apiBase64Data 사용) */
  originalBase64Data?: string;
  capturedAt?: string | null;
  width?: number;
  height?: number;
  customGroupKey?: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workspaceId =
      request.headers.get("x-workspace-id") || body?.workspaceId || "";
    const workspaceToken =
      request.headers.get("x-workspace-token") || body?.workspaceToken || "";
    const language: DiaryLanguage = body?.language === "en" ? "en" : "ko";
    const injectHallucinationTest = Boolean(
      body?.injectHallucinationTest || body?.injectHallucinationForDemo
    );
    const generateCrayonImage = body?.generateCrayonImage !== false;
    const photos: IncomingPhotoInput[] = Array.isArray(body?.photos)
      ? body.photos
      : [];
    const customGroupAssignments: Record<string, string> = {
      ...(body?.customGroupAssignments || {}),
    };
    for (const p of photos) {
      if (p.customGroupKey && p.customGroupKey !== "auto") {
        customGroupAssignments[p.photoId] = p.customGroupKey;
      }
    }

    if (photos.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            language === "en"
              ? "Please upload at least one photo to create a picture diary."
              : "그림일기를 만들 사진을 최소 1장 이상 선택해 주세요.",
        },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
    const startTime = Date.now();

    const readable = new ReadableStream({
      async start(controller) {
        const sendEvent = (payload: unknown) => {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        };

        const emitPhase = (
          phase: StudioProgressEvent["phase"],
          step: number,
          totalSteps: number,
          title: string,
          detail: string
        ) => {
          sendEvent({
            type: "studio_progress",
            phase,
            step,
            totalSteps,
            title,
            detail,
            elapsedMs: Date.now() - startTime,
          } satisfies StudioProgressEvent);
        };

        const uploadedGcsPathsDuringJob: string[] = [];

        try {
          // 0. 워크스페이스 인증 및 현재 generationEpoch 확보
          const { generationEpoch } = await beginWorkspaceGenerationJob(
            workspaceId,
            workspaceToken
          );
          const { diaries: existingDiaries } = await listWorkspaceDiaries(
            workspaceId,
            workspaceToken
          );

          // 1단계: 다중 사진 Cloud Storage 원본 저장 + gemini-4-argon 멀티모달 분석 (병렬)
          emitPhase(
            "ingest_and_vision",
            1,
            5,
            language === "en"
              ? "Uploading original photos & extracting observable visual facts"
              : "원본 사진 Cloud Storage 보존 & 멀티모달 사실 추출",
            language === "en"
              ? `Analyzing ${photos.length} photo(s) with gemini-4-argon and storing untouched originals in Cloud Storage...`
              : `${photos.length}장의 원본 사진을 Cloud Storage에 저장하고 gemini-4-argon으로 관찰 가능한 사실을 추출합니다...`
          );

          const storedPhotos: StoredPhotoItem[] = await Promise.all(
            photos.map(async (p, idx) => {
              const rawForStorage = p.originalBase64Data || p.apiBase64Data;
              const [gcsSaved, visionResult] = await Promise.all([
                uploadWorkspaceMediaToGcs({
                  workspaceId,
                  category: "photos",
                  itemId: `${p.photoId}_${Date.now().toString().slice(-4)}_${idx}`,
                  mimeType: p.mimeType || "image/jpeg",
                  base64Data: rawForStorage,
                }),
                analyzePhotoWithArgon({
                  photoId: p.photoId,
                  fileName: p.fileName,
                  mimeType: p.mimeType || "image/jpeg",
                  base64Data: p.apiBase64Data,
                  capturedAt: p.capturedAt || null,
                  language,
                }),
              ]);

              uploadedGcsPathsDuringJob.push(gcsSaved.gcsObjectPath);
              const authenticatedMediaUrl = `${gcsSaved.mediaUrl}&wid=${encodeURIComponent(workspaceId)}&wt=${encodeURIComponent(workspaceToken)}`;

              return {
                photoId: p.photoId,
                fileName: p.fileName,
                mimeType: p.mimeType || "image/jpeg",
                capturedAt: visionResult.analysis.capturedAt || null,
                dateConfidence: visionResult.analysis.dateConfidence,
                gcsObjectPath: gcsSaved.gcsObjectPath,
                mediaUrl: authenticatedMediaUrl,
                width: p.width,
                height: p.height,
                analysis: visionResult.analysis,
              };
            })
          );

          // 2단계: 날짜(EXIF) 및 시각적 맥락 기반 기억 그룹화 (Memory Grouping)
          const clusters = clusterPhotosIntoMemoryGroups(
            storedPhotos,
            customGroupAssignments,
            language
          );

          emitPhase(
            "memory_grouping",
            2,
            5,
            language === "en"
              ? `Grouped ${storedPhotos.length} photo(s) into ${clusters.length} memory page(s)`
              : `사진 ${storedPhotos.length}장을 ${clusters.length}개의 기억(그림일기 페이지)으로 그룹화 완료`,
            clusters
              .map(
                (c) =>
                  `${c.dateIso || (language === "en" ? "Undated" : "날짜미상")} (${c.photos.length}장)`
              )
              .join(" · ")
          );

          // 중간 결과: 분석된 사진 및 그룹화 정보 먼저 클라이언트에 스트리밍
          sendEvent({
            type: "clusters_preview",
            clusters: clusters.map((c) => ({
              groupKey: c.groupKey,
              dateIso: c.dateIso,
              groupingBasis: c.groupingBasis,
              groupingReason: c.groupingReason,
              photoIds: c.photos.map((p) => p.photoId),
            })),
            analyzedPhotos: storedPhotos.map((p) => ({
              photoId: p.photoId,
              fileName: p.fileName,
              capturedAt: p.capturedAt,
              analysis: p.analysis,
            })),
          });

          // 3~4단계: 각 기억 그룹별로 근거 기반 일기 작성 + 2차 재검증 루프 + 크레파스 일러스트 병렬 생성
          emitPhase(
            "diary_and_verification",
            3,
            5,
            language === "en"
              ? "Writing grounded picture diary & running 2-pass verification + crayon drawing"
              : "사실 기반 그림일기 작성 · 독립 감사관 검증/복구 루프 · 크레파스 그림 생성",
            language === "en"
              ? `Generating ${clusters.length} diary page(s) with gemini-4-argon & gemini-nano-banana-2.1...`
              : `${clusters.length}개 페이지의 일기 검증(gemini-4-argon)과 크레파스 그림(gemini-nano-banana-2.1)을 병렬 생성 중입니다...`
          );

          const generatedPages: SavedDiaryPage[] = await Promise.all(
            clusters.map(async (cluster, idx) => {
              const diaryId = `diary_${Date.now()}_${idx + 1}`;
              const { diaryPage } = await generateVerifiedDiaryForCluster({
                workspaceId,
                diaryId,
                cluster,
                language,
                injectHallucinationTest:
                  injectHallucinationTest && idx === 0,
                generateCrayonImage,
              });

              let illGcsPath: string | null = null;
              let illMediaUrl: string | null = null;

              if (diaryPage.rawCrayonBase64) {
                const uploadedIll = await uploadWorkspaceMediaToGcs({
                  workspaceId,
                  category: "illustrations",
                  itemId: diaryId,
                  mimeType: diaryPage.crayonMimeType,
                  base64Data: diaryPage.rawCrayonBase64,
                });
                uploadedGcsPathsDuringJob.push(uploadedIll.gcsObjectPath);
                illGcsPath = uploadedIll.gcsObjectPath;
                illMediaUrl = `${uploadedIll.mediaUrl}&wid=${encodeURIComponent(workspaceId)}&wt=${encodeURIComponent(workspaceToken)}`;
              }

              const {
                rawCrayonBase64: _rawCrayonBase64,
                crayonMimeType,
                crayonPromptUsed,
                crayonFallbackUsed,
                ...restDiary
              } = diaryPage;
              void _rawCrayonBase64;

              return {
                ...restDiary,
                crayonIllustration: {
                  generatedByModel: ILLUSTRATION_MODEL,
                  mimeType: crayonMimeType,
                  gcsObjectPath: illGcsPath,
                  mediaUrl: illMediaUrl,
                  promptUsed: crayonPromptUsed,
                  fallbackSvgUsed: crayonFallbackUsed,
                  status: crayonFallbackUsed ? "failed" : "ready",
                },
              };
            })
          );

          // 5단계: 전체 그림일기(기존 + 신규)에 걸친 Memory Threads / Time Machine 연결 발견
          const allDiariesCombined = [...existingDiaries, ...generatedPages].sort(
            (a, b) => {
              if (a.dateIso && b.dateIso && a.dateIso !== b.dateIso) {
                return a.dateIso.localeCompare(b.dateIso);
              }
              return a.createdAt.localeCompare(b.createdAt);
            }
          );

          emitPhase(
            "memory_threads",
            4,
            5,
            language === "en"
              ? "Discovering Memory Threads across dates"
              : "Memory Threads 타임머신 추억 연결점 탐색",
            allDiariesCombined.length >= 2
              ? language === "en"
                ? `Searching for grounded recurring objects, places, and activities across ${allDiariesCombined.length} diary pages...`
                : `총 ${allDiariesCombined.length}개의 그림일기 페이지 사이에서 반복 등장하는 사물·장소·활동을 연결합니다...`
              : language === "en"
                ? "Single diary page created (upload photos from 2+ dates to activate Memory Threads)."
                : "단일 페이지 생성 완료 (서로 다른 날짜의 추억이 2개 이상 모이면 Memory Threads가 연결됩니다)."
          );

          const memoryThreads =
            allDiariesCombined.length >= 2
              ? await discoverMemoryThreadsAcrossDiaries(
                  allDiariesCombined,
                  language
                )
              : [];

          // 6단계: Firestore 영구 저장 (진행 중 Reset 충돌 여부 Epoch 검증 포함)
          emitPhase(
            "persistence",
            5,
            5,
            language === "en"
              ? "Saving diaries & Memory Threads to Firestore"
              : "Firestore 및 Cloud Storage 영구 저장 완료",
            language === "en"
              ? `Saved ${generatedPages.length} diary page(s) and ${memoryThreads.length} Memory Thread(s).`
              : `새 그림일기 ${generatedPages.length}페이지와 Memory Threads ${memoryThreads.length}건을 안전하게 저장했습니다.`
          );

          await saveGeneratedDiariesAndThreads({
            workspaceId,
            workspaceToken,
            expectedEpoch: generationEpoch,
            newDiaries: generatedPages,
            memoryThreads,
            uploadedGcsPathsDuringJob,
          });

          sendEvent({
            type: "studio_complete",
            ok: true,
            newDiaries: generatedPages,
            allDiaries: allDiariesCombined,
            memoryThreads,
            totalElapsedMs: Date.now() - startTime,
          });
        } catch (err: unknown) {
          const isAccessDenied = err instanceof WorkspaceAccessDeniedError;
          const isConflict = err instanceof WorkspaceConflictError;
          sendEvent({
            type: "studio_error",
            ok: false,
            statusCode: isAccessDenied ? 403 : isConflict ? 409 : 500,
            error:
              err instanceof Error
                ? err.message
                : "그림일기 생성 파이프라인 실행 중 오류가 발생했습니다.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    if (err instanceof WorkspaceAccessDeniedError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "요청을 처리하는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
