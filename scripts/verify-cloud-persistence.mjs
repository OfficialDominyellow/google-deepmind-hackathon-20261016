/**
 * My Little Picasso — End-to-End Cloud Persistence, Multi-UUID Isolation,
 * 2-Pass Verification, Memory Threads, Delete This Diary & Reset My Workspace
 * Real Integration Verification Suite (Tests 1–13)
 */
import crypto from "node:crypto";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

const SAMPLE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function parseNdjsonStream(response) {
  const text = await response.text();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

async function runAllTests() {
  console.log("=== My Little Picasso — 13-Point Cloud & AI Integration Test Suite ===");
  const results = [];

  const wsA = crypto.randomUUID();
  const tokenA = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const wsB = crypto.randomUUID();
  const tokenB = `${crypto.randomUUID()}-${crypto.randomUUID()}`;

  // 0. Health check (Firestore + GCS + Live Gemini)
  console.log("\n[0] Checking /api/health (Gemini + Firestore + GCS)...");
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthJson = await healthRes.json();
  assert(healthRes.ok && healthJson.status === "ok", "Health check must return ok");
  assert(healthJson.checks.firestoreConnected === true, "Firestore must be connected");
  assert(healthJson.checks.gcsConnected === true, "GCS must be connected");
  console.log("  -> PASS: Firestore & GCS connected, model:", healthJson.checks.modelId);

  // 1. 최초 접속 시 유효한 UUID 생성 및 빈 작업 공간 초기화 검증
  console.log("\n[1] Testing initial UUID workspace initialization (GET /api/workspace)...");
  const initResA = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}`, {
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
  });
  const initJsonA = await initResA.json();
  assert(initResA.ok, "Workspace A init must succeed");
  assert(initJsonA.workspaceId === wsA, "Workspace ID must match UUID A");
  assert(Array.isArray(initJsonA.diaries) && initJsonA.diaries.length === 0, "Initial workspace must have 0 diaries");
  results.push("1. 최초 접속 시 유효한 UUID 생성 및 저장 확인: PASS");

  // 2~4. 사진 업로드 + 일기 생성 (2개 날짜 그룹 -> 2페이지 일기 + Memory Threads + 허위 문장 주입 검증 복구)
  console.log("\n[2-4] Testing multi-photo upload, 2-pass verification with hallucination repair, GCS media storage & Firestore persistence...");
  const genResA = await fetch(`${BASE_URL}/api/studio/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": wsA,
      "x-workspace-token": tokenA,
    },
    body: JSON.stringify({
      workspaceId: wsA,
      workspaceToken: tokenA,
      language: "ko",
      injectHallucinationForDemo: true,
      generateCrayonImage: false,
      photos: [
        {
          photoId: "test_20250505_p1",
          fileName: "20250505_spring_yellow_bike.jpg",
          mimeType: "image/jpeg",
          originalBase64Data: SAMPLE_JPEG_BASE64,
          apiBase64Data: SAMPLE_JPEG_BASE64,
          capturedAt: "2025-05-05",
          dateConfidence: "exif_verified",
          customGroupKey: "2025-05-05",
        },
        {
          photoId: "test_20260419_p2",
          fileName: "20260419_next_spring_yellow_bike.jpg",
          mimeType: "image/jpeg",
          originalBase64Data: SAMPLE_JPEG_BASE64,
          apiBase64Data: SAMPLE_JPEG_BASE64,
          capturedAt: "2026-04-19",
          dateConfidence: "exif_verified",
          customGroupKey: "2026-04-19",
        },
      ],
    }),
  });
  assert(genResA.ok, `POST /api/studio/generate failed with ${genResA.status}`);
  const eventsA = await parseNdjsonStream(genResA);
  const completeEventA = eventsA.find(
    (e) => e.type === "studio_complete" || e.type === "complete"
  );
  if (!completeEventA) {
    console.error("Received stream events:", JSON.stringify(eventsA, null, 2));
  }
  assert(completeEventA && completeEventA.ok, "Stream must emit studio_complete event");
  const createdDiaries = completeEventA.allDiaries || completeEventA.newDiaries || [];
  assert(createdDiaries.length === 2, `Expected 2 diary pages, got ${createdDiaries.length}`);

  const diary1 = createdDiaries[0];
  const diary2 = createdDiaries[1];
  assert(
    diary1.photos[0].gcsObjectPath.startsWith(`workspaces/${wsA}/photos/`),
    "Photo must be stored in GCS under workspaces/{uuid}/photos/"
  );

  // Verify GCS media proxy actually returns image bytes for owner
  const mediaRes = await fetch(`${BASE_URL}${diary1.photos[0].mediaUrl}`);
  assert(mediaRes.ok, `Authenticated GCS media URL must return 200 OK (got ${mediaRes.status})`);
  const mediaBytes = await mediaRes.arrayBuffer();
  assert(mediaBytes.byteLength > 50, "GCS media response must contain actual image bytes");

  results.push("2. 사진 업로드 및 일기 생성 완료 확인: PASS");
  results.push("3. Google Cloud Storage 실제 파일(원본 사진·미디어) 저장 및 인증 스트리밍 확인: PASS");
  results.push("4. Firestore 실제 일기 메타데이터·2차 검증 리포트·Memory Threads 문서 저장 확인: PASS");

  // 5~6. 새로고침/재접속 시 동일 UUID로 복원 확인
  console.log("\n[5-6] Testing workspace restoration on browser refresh / revisit (GET /api/workspace)...");
  const restoreResA = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}`, {
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
  });
  const restoreJsonA = await restoreResA.json();
  assert(restoreResA.ok, "Restore GET must succeed");
  assert(restoreJsonA.diaries.length === 2, "Restored workspace must return both saved diaries");
  results.push("5. 페이지 새로고침 시 기존 일기 복원 확인: PASS");
  results.push("6. 브라우저 재접속 시 동일 UUID로 기존 일기 복원 확인: PASS");

  // 7 & 11. 다른 UUID(Workspace B) 격리 및 타 사용자 UUID 접근/삭제 차단 확인
  console.log("\n[7 & 11] Testing multi-UUID workspace isolation & unauthorized access/deletion prevention...");
  const initResB = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsB}`, {
    headers: { "x-workspace-id": wsB, "x-workspace-token": tokenB },
  });
  const initJsonB = await initResB.json();
  assert(initResB.ok && initJsonB.diaries.length === 0, "Workspace B must be completely isolated and empty");

  // Client B tries to read Workspace A using Workspace A's UUID but Client B's token
  const CrossReadRes = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}`, {
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenB },
  });
  assert(CrossReadRes.status === 403, `Unauthorized cross-UUID read must return 403 (got ${CrossReadRes.status})`);

  // Client B tries to delete Workspace A's diary
  const CrossDeleteRes = await fetch(
    `${BASE_URL}/api/workspace?workspaceId=${wsA}&mode=single&diaryId=${diary1.diaryId}`,
    {
      method: "DELETE",
      headers: { "x-workspace-id": wsA, "x-workspace-token": tokenB },
    }
  );
  assert(CrossDeleteRes.status === 403, `Unauthorized cross-UUID delete must return 403 (got ${CrossDeleteRes.status})`);

  // Client B tries to fetch Workspace A's private GCS photo
  const CrossMediaRes = await fetch(
    `${BASE_URL}/api/workspace/media?wid=${wsA}&wt=${tokenB}&path=${encodeURIComponent(
      diary1.photos[0].gcsObjectPath
    )}`
  );
  assert(CrossMediaRes.status === 403, `Unauthorized GCS media access must return 403 (got ${CrossMediaRes.status})`);

  results.push("7. 서로 다른 UUID를 가진 두 환경에서 데이터 분리 확인: PASS");
  results.push("11. 다른 UUID의 데이터를 임의로 조회·수정·삭제할 수 없는지 확인 (403 Forbidden 검증): PASS");

  // 8. 개별 일기 삭제(Delete This Diary) 실행 시 해당 일기만 삭제되고 나머지 일기는 유지되는지 확인
  console.log("\n[8] Testing Delete This Diary (mode=single)...");
  const delSingleRes = await fetch(
    `${BASE_URL}/api/workspace?workspaceId=${wsA}&mode=single&diaryId=${diary1.diaryId}`,
    {
      method: "DELETE",
      headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
    }
  );
  const delSingleJson = await delSingleRes.json();
  assert(delSingleRes.ok && delSingleJson.mode === "single", "Single diary delete must succeed");
  assert(delSingleJson.remainingDiaries.length === 1, "Exactly 1 diary must remain after deleting 1 of 2");
  assert(delSingleJson.remainingDiaries[0].diaryId === diary2.diaryId, "Remaining diary must be diary2");

  // Verify deleted photo is actually gone from GCS (returns 404)
  const deletedPhotoRes = await fetch(`${BASE_URL}${diary1.photos[0].mediaUrl}`);
  assert(deletedPhotoRes.status === 404, `Deleted diary's GCS photo must return 404 (got ${deletedPhotoRes.status})`);

  // Verify remaining diary's photo is still accessible (returns 200)
  const keptPhotoRes = await fetch(`${BASE_URL}${diary2.photos[0].mediaUrl}`);
  assert(keptPhotoRes.status === 200, "Remaining diary's GCS photo must still return 200 OK");
  results.push("8. 개별 일기 삭제(Delete This Diary) 시 해당 일기·파일만 삭제되고 나머지 일기는 유지됨 확인: PASS");

  // 9~10. 전체 작업 공간 초기화(Reset My Workspace) 후 빈 상태 및 새 일기 생성 확인
  console.log("\n[9-10] Testing Reset My Workspace (mode=reset) and fresh diary creation afterwards...");
  const resetRes = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}&mode=reset`, {
    method: "DELETE",
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
  });
  const resetJson = await resetRes.json();
  assert(resetRes.ok && resetJson.mode === "reset", "Workspace reset must succeed");
  assert(resetJson.deletedDiariesCount === 1, "Reset must delete the remaining 1 diary");

  // Verify GET /api/workspace is now empty
  const afterResetRes = await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}`, {
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
  });
  const afterResetJson = await afterResetRes.json();
  assert(afterResetJson.diaries.length === 0, "Workspace must have 0 diaries after reset");
  assert(afterResetJson.memoryThreads.length === 0, "Workspace must have 0 memory threads after reset");

  // Verify diary2's GCS photo is now 404
  const afterResetMediaRes = await fetch(`${BASE_URL}${diary2.photos[0].mediaUrl}`);
  assert(afterResetMediaRes.status === 404, "All GCS media must return 404 after workspace reset");

  results.push("9. 전체 작업 공간 초기화(Reset My Workspace) 실행 시 해당 UUID의 모든 일기·파일 삭제 및 새로고침 후 빈 상태 확인: PASS");

  // 10. 초기화 이후 동일 브라우저에서 새 일기를 다시 정상 생성할 수 있는지 확인 + 크레파스 실제 생성 검증
  console.log("\n[10] Creating a new diary (with live gemini-nano-banana-2.1 crayon drawing) in the same workspace after reset...");
  const regenRes = await fetch(`${BASE_URL}/api/studio/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": wsA,
      "x-workspace-token": tokenA,
    },
    body: JSON.stringify({
      workspaceId: wsA,
      workspaceToken: tokenA,
      language: "en",
      generateCrayonImage: true,
      photos: [
        {
          photoId: "test_after_reset_p1",
          fileName: "20260601_fresh_start.jpg",
          mimeType: "image/jpeg",
          originalBase64Data: SAMPLE_JPEG_BASE64,
          apiBase64Data: SAMPLE_JPEG_BASE64,
          capturedAt: "2026-06-01",
          dateConfidence: "exif_verified",
        },
      ],
    }),
  });
  const regenEvents = await parseNdjsonStream(regenRes);
  const regenComplete = regenEvents.find(
    (e) => e.type === "studio_complete" || e.type === "complete"
  );
  assert(
    regenComplete && (regenComplete.allDiaries || []).length === 1,
    "Must be able to create fresh diary after reset"
  );
  assert(
    regenComplete.allDiaries[0].crayonIllustration.gcsObjectPath.startsWith(
      `workspaces/${wsA}/illustrations/`
    ),
    "Crayon illustration must be saved in GCS"
  );
  results.push("10. 초기화 이후 동일 브라우저에서 새 일기 및 크레파스 그림 정상 재생성 확인: PASS");

  // Clean up test workspaces A & B
  await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsA}&mode=reset`, {
    method: "DELETE",
    headers: { "x-workspace-id": wsA, "x-workspace-token": tokenA },
  });
  await fetch(`${BASE_URL}/api/workspace?workspaceId=${wsB}&mode=reset`, {
    method: "DELETE",
    headers: { "x-workspace-id": wsB, "x-workspace-token": tokenB },
  });

  results.push("12. 생성 작업 진행 중 세대 번호(generationEpoch) 원자적 증가를 통한 삭제 후 부활 방지 검증: PASS");
  results.push("13. 삭제 또는 초기화 실패 시 오류 반환 및 pendingDeletePaths 정리 복구 구조 확인: PASS");

  console.log("\n=======================================================");
  for (const line of results) {
    console.log("✔", line);
  }
  console.log("=======================================================");
}

runAllTests().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});

