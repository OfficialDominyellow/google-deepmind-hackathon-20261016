import { NextResponse } from "next/server";
import {
  deleteSingleDiaryFromWorkspace,
  listWorkspaceDiaries,
  resetEntireWorkspace,
  updateDiaryPageContent,
  uploadWorkspaceMediaToGcs,
  WorkspaceAccessDeniedError,
} from "@/lib/storage";
import {
  generateCrayonIllustrationOnly,
  ILLUSTRATION_MODEL,
  runRealVerificationAndRepairLoop,
} from "@/lib/gemini";
import type { GroundedDiarySentence } from "@/types/diary";

function extractCredentials(request: Request, body?: Record<string, unknown>) {
  const { searchParams } = new URL(request.url);
  const workspaceId =
    request.headers.get("x-workspace-id") ||
    (typeof body?.workspaceId === "string" ? body.workspaceId : "") ||
    searchParams.get("workspaceId") ||
    "";
  const workspaceToken =
    request.headers.get("x-workspace-token") ||
    (typeof body?.workspaceToken === "string" ? body.workspaceToken : "") ||
    searchParams.get("workspaceToken") ||
    "";
  return { workspaceId, workspaceToken };
}

/**
 * GET /api/workspace
 * 현재 브라우저 익명 UUID 공간의 그림일기 목록, Memory Threads, 상태를 복원한다.
 */
export async function GET(request: Request) {
  try {
    const { workspaceId, workspaceToken } = extractCredentials(request);
    const { workspace, diaries } = await listWorkspaceDiaries(
      workspaceId,
      workspaceToken
    );

    return NextResponse.json({
      ok: true,
      workspaceId: workspace.workspaceId,
      generationEpoch: workspace.generationEpoch,
      activeJobStatus: workspace.activeJobStatus || "idle",
      lastResetAt: workspace.lastResetAt || null,
      pendingDeletePaths: workspace.pendingDeletePaths || [],
      diaries,
      memoryThreads: workspace.memoryThreads || [],
      updatedAt: workspace.updatedAt,
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
            : "워크스페이스 데이터를 불러오는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workspace
 * - action === "edit_diary": 사용자가 수정한 제목/문장 저장 (모델 출력과 사용자 수정 구분 보존)
 * - action === "reverify_diary": 현재 일기(또는 의도적 허위 문장 주입)에 대해 실제 검증 및 복구 루프 재실행
 * - action === "regenerate_crayon": 해당 일기 페이지의 크레파스 일러스트 재생성 및 GCS 저장
 */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { workspaceId, workspaceToken } = extractCredentials(request, body);
    const action = String(body.action || "edit_diary");
    const diaryId = String(body.diaryId || "");

    if (!diaryId) {
      return NextResponse.json(
        { ok: false, error: "대상 그림일기 ID(diaryId)가 필요합니다." },
        { status: 400 }
      );
    }

    const { diaries } = await listWorkspaceDiaries(workspaceId, workspaceToken);
    const target = diaries.find((d) => d.diaryId === diaryId);
    if (!target) {
      return NextResponse.json(
        { ok: false, error: "해당 그림일기를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (action === "edit_diary") {
      const updatedTitle =
        typeof body.diaryTitle === "string" ? body.diaryTitle : undefined;
      const incomingSentences = Array.isArray(body.sentences)
        ? (body.sentences as { id: string; text: string }[])
        : undefined;

      const mergedSentences: GroundedDiarySentence[] | undefined =
        incomingSentences
          ? target.sentences.map((orig) => {
              const found = incomingSentences.find((inc) => inc.id === orig.id);
              if (!found || found.text === orig.text) return orig;
              return {
                ...orig,
                text: found.text,
                originalModelText: orig.originalModelText || orig.text,
                isUserEdited: true,
              };
            })
          : undefined;

      const updated = await updateDiaryPageContent({
        workspaceId,
        workspaceToken,
        diaryId,
        diaryTitle: updatedTitle,
        sentences: mergedSentences,
      });

      return NextResponse.json({
        ok: true,
        diary: updated,
      });
    }

    if (action === "reverify_diary") {
      const injectHallucination = Boolean(
        body.injectHallucination || body.injectHallucinationForDemo
      );
      const candidateSentences: GroundedDiarySentence[] = [
        ...target.sentences,
      ];

      if (injectHallucination) {
        candidateSentences.push({
          id: `s_injected_${Date.now().toString().slice(-3)}`,
          text:
            target.language === "en"
              ? 'Suddenly a giant purple dinosaur landed in a spaceship and shouted "Let\'s fly to Mars!"'
              : '갑자기 보라색 공룡이 우주선을 타고 내려와서 "우리 같이 화성 놀이공원에 가자!"라고 외쳤어요.',
          originalModelText:
            target.language === "en"
              ? 'Suddenly a giant purple dinosaur landed in a spaceship and shouted "Let\'s fly to Mars!"'
              : '갑자기 보라색 공룡이 우주선을 타고 내려와서 "우리 같이 화성 놀이공원에 가자!"라고 외쳤어요.',
          isUserEdited: false,
          sourcePhotoIds: [target.photos[0]?.photoId || "photo_1"],
          groundingType: "observed",
          evidenceNote:
            target.language === "en"
              ? "[Injected Unverified Claim for Live Verification Loop Test]"
              : "[검증 및 복구 루프 작동을 확인하기 위해 의도적으로 주입된 허위 주장]",
        });
      }

      const consolidatedFacts = target.photos.map((p) => ({
        photoId: p.photoId,
        fileName: p.fileName,
        sceneSummary: p.analysis.sceneSummary,
        observedFacts: p.analysis.observedFacts,
        uncertainties: p.analysis.uncertainties,
      }));

      const verificationResult = await runRealVerificationAndRepairLoop({
        draftSentences: candidateSentences,
        consolidatedFacts,
        validPhotoIds: target.photos.map((p) => p.photoId),
        diaryDateText: target.diaryDateText,
        diaryTitle: target.diaryTitle,
        language: target.language,
        isHallucinationTest: injectHallucination,
      });

      const updated = await updateDiaryPageContent({
        workspaceId,
        workspaceToken,
        diaryId,
        sentences: verificationResult.finalSentences,
        verification: verificationResult.report,
      });

      return NextResponse.json({
        ok: true,
        diary: updated,
      });
    }

    if (action === "regenerate_crayon") {
      const prompt =
        target.crayonIllustration?.promptUsed ||
        `Authentic 7-year-old child's wax crayon drawing on warm cream sketchbook paper (#F7F3E8). Scene: ${target.fullDiaryText}. Style: uneven wax crayon strokes, layered colors, warm nostalgia, no text.`;

      const genResult = await generateCrayonIllustrationOnly(prompt);
      let gcsObjectPath = target.crayonIllustration?.gcsObjectPath || null;
      let mediaUrl = target.crayonIllustration?.mediaUrl || null;

      if (genResult.base64Data) {
        const uploaded = await uploadWorkspaceMediaToGcs({
          workspaceId,
          category: "illustrations",
          itemId: `${diaryId}_${Date.now().toString().slice(-4)}`,
          mimeType: genResult.mimeType,
          base64Data: genResult.base64Data,
        });
        gcsObjectPath = uploaded.gcsObjectPath;
        mediaUrl = `${uploaded.mediaUrl}&wid=${encodeURIComponent(workspaceId)}&wt=${encodeURIComponent(workspaceToken)}`;
      }

      const updated = await updateDiaryPageContent({
        workspaceId,
        workspaceToken,
        diaryId,
        crayonIllustration: {
          generatedByModel: ILLUSTRATION_MODEL,
          mimeType: genResult.mimeType,
          gcsObjectPath,
          mediaUrl,
          base64Data: genResult.base64Data,
          promptUsed: prompt,
          fallbackSvgUsed: genResult.fallbackSvgUsed,
          status: genResult.fallbackSvgUsed ? "failed" : "ready",
        },
      });

      return NextResponse.json({
        ok: true,
        diary: updated,
      });
    }

    return NextResponse.json(
      { ok: false, error: `지원하지 않는 action입니다: ${action}` },
      { status: 400 }
    );
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
            : "그림일기 업데이트 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workspace
 * - mode === "single": 특정 diaryId만 삭제 (Delete This Diary, 공유 참조 파일 보존)
 * - mode === "reset": 현재 브라우저 UUID 공간 전체 초기화 (Reset My Workspace)
 */
export async function DELETE(request: Request) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // query params fallback
    }

    const { searchParams } = new URL(request.url);
    const { workspaceId, workspaceToken } = extractCredentials(request, body);
    const mode = String(body.mode || searchParams.get("mode") || "reset");
    const diaryId = String(body.diaryId || searchParams.get("diaryId") || "");

    if (mode === "single") {
      if (!diaryId) {
        return NextResponse.json(
          { ok: false, error: "삭제할 그림일기 ID(diaryId)가 지정되지 않았습니다." },
          { status: 400 }
        );
      }

      const singleResult = await deleteSingleDiaryFromWorkspace({
        workspaceId,
        workspaceToken,
        diaryId,
      });

      return NextResponse.json({
        ok: true,
        mode: "single",
        ...singleResult,
      });
    }

    // 전체 초기화 (Reset My Workspace)
    const resetResult = await resetEntireWorkspace({
      workspaceId,
      workspaceToken,
    });

    return NextResponse.json({
      ok: true,
      mode: "reset",
      ...resetResult,
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
            : "삭제 또는 워크스페이스 초기화 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
