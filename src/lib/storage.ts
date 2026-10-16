import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";
import type {
  MemoryThreadConnection,
  SavedDiaryPage,
  WorkspaceDocument,
} from "@/types/diary";

export const GCP_PROJECT_ID =
  process.env.GCP_PROJECT_ID || "h2gdm-hack26icn-2627";
export const GCS_MEDIA_BUCKET =
  process.env.GCS_MEDIA_BUCKET || "h2gdm-hack26icn-2627-picasso-media";
export const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || "(default)";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkspaceAccessDeniedError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessDeniedError";
  }
}

export class WorkspaceConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}

export function isValidWorkspaceId(workspaceId: string): boolean {
  return Boolean(workspaceId && UUID_V4_REGEX.test(workspaceId.trim()));
}

export function isValidWorkspaceToken(token: string): boolean {
  return Boolean(
    token && typeof token === "string" && token.trim().length >= 24
  );
}

export function hashWorkspaceToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

function safeCompareHash(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * 로컬 Windows 개발 환경에서 ADC 파일이 없을 때 gcloud CLI 토큰을 브릿지하는 헬퍼
 */
let cachedCliToken: { token: string; expiresAt: number } | null = null;

function createGcloudCliOAuthClient(): OAuth2Client {
  const client = new OAuth2Client();
  client.refreshHandler = async () => {
    const now = Date.now();
    if (cachedCliToken && cachedCliToken.expiresAt > now + 60_000) {
      return {
        access_token: cachedCliToken.token,
        expiry_date: cachedCliToken.expiresAt,
      };
    }
    const cmd =
      process.platform === "win32"
        ? "gcloud.cmd auth print-access-token"
        : "gcloud auth print-access-token";
    const raw = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    }).trim();
    if (!raw) {
      throw new Error("gcloud access token empty");
    }
    cachedCliToken = {
      token: raw,
      expiresAt: now + 40 * 60 * 1000,
    };
    return {
      access_token: raw,
      expiry_date: cachedCliToken.expiresAt,
    };
  };
  return client;
}

let firestoreInstance: Firestore | null = null;
let storageInstance: Storage | null = null;

function shouldUseGcloudCliBridge(): boolean {
  if (process.env.K_SERVICE || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return false;
  }
  const winAdc = process.env.APPDATA
    ? path.join(
        process.env.APPDATA,
        "gcloud",
        "application_default_credentials.json"
      )
    : "";
  if (winAdc && fs.existsSync(winAdc)) {
    return false;
  }
  return true;
}

export function getFirestoreClient(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  if (shouldUseGcloudCliBridge()) {
    const authClient = createGcloudCliOAuthClient();
    firestoreInstance = new Firestore({
      projectId: GCP_PROJECT_ID,
      databaseId: FIRESTORE_DATABASE_ID,
      preferRest: true,
      ignoreUndefinedProperties: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authClient: authClient as any,
    });
  } else {
    firestoreInstance = new Firestore({
      projectId: GCP_PROJECT_ID,
      databaseId: FIRESTORE_DATABASE_ID,
      preferRest: true,
      ignoreUndefinedProperties: true,
    });
  }
  return firestoreInstance;
}

export function getStorageClient(): Storage {
  if (storageInstance) return storageInstance;
  if (shouldUseGcloudCliBridge()) {
    const authClient = createGcloudCliOAuthClient();
    storageInstance = new Storage({
      projectId: GCP_PROJECT_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authClient: authClient as any,
    });
  } else {
    storageInstance = new Storage({
      projectId: GCP_PROJECT_ID,
    });
  }
  return storageInstance;
}

/**
 * 사용자 공간(Workspace) 문서 조회 및 서버 측 접근 제어 검증
 * - 최초 방문 UUID인 경우 tokenHash와 함께 문서를 자동 생성한다.
 * - 이미 존재하는 UUID인데 tokenHash가 다르면 즉시 403 에러를 발생시켜 타인의 UUID 도용을 차단한다.
 */
export async function verifyAndGetWorkspace(
  workspaceId: string,
  workspaceToken: string
): Promise<WorkspaceDocument> {
  if (!isValidWorkspaceId(workspaceId)) {
    throw new WorkspaceAccessDeniedError(
      "유효하지 않은 브라우저 사용자 공간 식별자(UUID)입니다."
    );
  }
  if (!isValidWorkspaceToken(workspaceToken)) {
    throw new WorkspaceAccessDeniedError(
      "유효하지 않은 사용자 공간 보안 토큰입니다. 다른 사용자의 데이터에 접근할 수 없습니다."
    );
  }

  const db = getFirestoreClient();
  const docRef = db.collection("workspaces").doc(workspaceId);
  const snap = await docRef.get();
  const incomingHash = hashWorkspaceToken(workspaceToken);
  const now = new Date().toISOString();

  if (!snap.exists) {
    const initialDoc: WorkspaceDocument = {
      workspaceId,
      tokenHash: incomingHash,
      createdAt: now,
      updatedAt: now,
      generationEpoch: 1,
      activeJobStatus: "idle",
      lastResetAt: null,
      pendingDeletePaths: [],
      memoryThreads: [],
    };
    await docRef.set(initialDoc);
    return initialDoc;
  }

  const data = snap.data() as WorkspaceDocument;
  if (!safeCompareHash(data.tokenHash, incomingHash)) {
    throw new WorkspaceAccessDeniedError(
      "접근 거부(403): 요청한 브라우저 토큰이 해당 UUID 공간의 소유자 정보와 일치하지 않습니다."
    );
  }

  return data;
}

/**
 * Cloud Storage에 이미지(원본 사진 또는 크레파스 일러스트) 저장
 * - 반드시 workspaces/{workspaceId}/... 하위 경로로만 저장하여 격리 보장
 */
export async function uploadWorkspaceMediaToGcs(params: {
  workspaceId: string;
  category: "photos" | "illustrations";
  itemId: string;
  mimeType: string;
  base64Data: string;
}): Promise<{ gcsObjectPath: string; mediaUrl: string }> {
  if (!isValidWorkspaceId(params.workspaceId)) {
    throw new WorkspaceAccessDeniedError("유효하지 않은 워크스페이스 ID입니다.");
  }

  const cleanItemId = params.itemId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = params.mimeType.includes("png")
    ? "png"
    : params.mimeType.includes("webp")
      ? "webp"
      : "jpg";
  const gcsObjectPath = `workspaces/${params.workspaceId}/${params.category}/${cleanItemId}.${ext}`;

  const cleanBase64 = params.base64Data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");

  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_MEDIA_BUCKET);
  const file = bucket.file(gcsObjectPath);

  await file.save(buffer, {
    resumable: false,
    contentType: params.mimeType || "image/jpeg",
    metadata: {
      cacheControl: "private, max-age=3600",
      metadata: {
        workspaceId: params.workspaceId,
        category: params.category,
        createdAt: new Date().toISOString(),
      },
    },
  });

  const mediaUrl = `/api/workspace/media?path=${encodeURIComponent(gcsObjectPath)}`;
  return { gcsObjectPath, mediaUrl };
}

/**
 * Cloud Storage에서 인증된 사용자의 미디어 파일 바이트 조회
 * - 경로가 반드시 workspaces/{workspaceId}/ 로 시작하는지 결정론적으로 검증
 */
export async function downloadWorkspaceMediaFromGcs(params: {
  workspaceId: string;
  workspaceToken: string;
  gcsObjectPath: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
  await verifyAndGetWorkspace(params.workspaceId, params.workspaceToken);

  const expectedPrefix = `workspaces/${params.workspaceId}/`;
  if (
    !params.gcsObjectPath.startsWith(expectedPrefix) ||
    params.gcsObjectPath.includes("..")
  ) {
    throw new WorkspaceAccessDeniedError(
      "접근 거부(403): 다른 사용자 공간의 미디어 파일 경로에 접근할 수 없습니다."
    );
  }

  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_MEDIA_BUCKET);
  const file = bucket.file(params.gcsObjectPath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error("요청한 미디어 파일이 Cloud Storage에 존재하지 않습니다.");
  }

  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();

  return {
    buffer,
    contentType: metadata.contentType || "image/jpeg",
  };
}

/**
 * 워크스페이스의 전체 그림일기 목록 및 메타데이터 조회
 */
export async function listWorkspaceDiaries(
  workspaceId: string,
  workspaceToken: string
): Promise<{
  workspace: WorkspaceDocument;
  diaries: SavedDiaryPage[];
}> {
  const workspace = await verifyAndGetWorkspace(workspaceId, workspaceToken);
  const db = getFirestoreClient();

  const snapshot = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("diaries")
    .get();

  const diaries: SavedDiaryPage[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data() as SavedDiaryPage;
    if (data && data.diaryId) {
      diaries.push(data);
    }
  });

  // 최신 날짜 / 생성일 순 정렬
  diaries.sort((a, b) => {
    if (a.dateIso && b.dateIso && a.dateIso !== b.dateIso) {
      return a.dateIso.localeCompare(b.dateIso);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  return { workspace, diaries };
}

/**
 * AI 생성 작업 시작 시 현재 generationEpoch를 기록하고 가져온다.
 */
export async function beginWorkspaceGenerationJob(
  workspaceId: string,
  workspaceToken: string
): Promise<{ generationEpoch: number }> {
  const workspace = await verifyAndGetWorkspace(workspaceId, workspaceToken);
  const db = getFirestoreClient();
  await db.collection("workspaces").doc(workspaceId).update({
    activeJobStatus: "running",
    updatedAt: new Date().toISOString(),
  });
  return { generationEpoch: workspace.generationEpoch };
}

/**
 * 생성된 그림일기 페이지들과 Memory Threads를 Firestore에 저장한다.
 * - 만약 작업 도중 사용자가 Reset My Workspace를 실행해 generationEpoch가 변경되었다면
 *   삭제된 그림일기가 부활하지 않도록 저장을 즉시 중단하고 새로 생성된 GCS 파일도 정리한다.
 */
export async function saveGeneratedDiariesAndThreads(params: {
  workspaceId: string;
  workspaceToken: string;
  expectedEpoch: number;
  newDiaries: SavedDiaryPage[];
  memoryThreads: MemoryThreadConnection[];
  uploadedGcsPathsDuringJob: string[];
}): Promise<{ savedCount: number }> {
  const currentWorkspace = await verifyAndGetWorkspace(
    params.workspaceId,
    params.workspaceToken
  );

  if (currentWorkspace.generationEpoch !== params.expectedEpoch) {
    // 초기화(Reset) 또는 취소 이후 완료된 지연 AI 작업이므로 저장 차단 및 고아 객체 정리
    await deleteGcsPathsSafely(params.uploadedGcsPathsDuringJob);
    throw new WorkspaceConflictError(
      "작업 진행 중 워크스페이스 초기화(Reset)가 실행되어 생성 결과를 저장하지 않고 안전하게 폐기했습니다."
    );
  }

  const db = getFirestoreClient();
  const wsRef = db.collection("workspaces").doc(params.workspaceId);
  const batch = db.batch();

  for (const diary of params.newDiaries) {
    const diaryRef = wsRef.collection("diaries").doc(diary.diaryId);
    const cleanDiary = JSON.parse(JSON.stringify(diary)) as SavedDiaryPage;
    batch.set(diaryRef, cleanDiary);
  }

  batch.update(wsRef, {
    memoryThreads: JSON.parse(JSON.stringify(params.memoryThreads)),
    activeJobStatus: "completed",
    updatedAt: new Date().toISOString(),
  });

  await batch.commit();
  return { savedCount: params.newDiaries.length };
}

/**
 * 개별 그림일기 문장 또는 제목 수정 업데이트 (모델 출력과 사용자 수정 구분 보존)
 */
export async function updateDiaryPageContent(params: {
  workspaceId: string;
  workspaceToken: string;
  diaryId: string;
  diaryTitle?: string;
  sentences?: SavedDiaryPage["sentences"];
  verification?: SavedDiaryPage["verification"];
  crayonIllustration?: SavedDiaryPage["crayonIllustration"];
}): Promise<SavedDiaryPage> {
  await verifyAndGetWorkspace(params.workspaceId, params.workspaceToken);
  const db = getFirestoreClient();
  const diaryRef = db
    .collection("workspaces")
    .doc(params.workspaceId)
    .collection("diaries")
    .doc(params.diaryId);

  const snap = await diaryRef.get();
  if (!snap.exists) {
    throw new Error("수정할 그림일기 페이지를 찾을 수 없습니다.");
  }

  const existing = snap.data() as SavedDiaryPage;
  if (existing.workspaceId !== params.workspaceId) {
    throw new WorkspaceAccessDeniedError("권한이 없는 그림일기입니다.");
  }

  const updatedSentences = params.sentences ?? existing.sentences;
  const updated: SavedDiaryPage = {
    ...existing,
    diaryTitle: params.diaryTitle ?? existing.diaryTitle,
    isTitleUserEdited:
      params.diaryTitle !== undefined &&
      params.diaryTitle !== existing.diaryTitle
        ? true
        : existing.isTitleUserEdited,
    sentences: updatedSentences,
    fullDiaryText: updatedSentences.map((s) => s.text).join(" "),
    verification: params.verification ?? existing.verification,
    crayonIllustration:
      params.crayonIllustration ?? existing.crayonIllustration,
    updatedAt: new Date().toISOString(),
  };

  await diaryRef.set(updated);
  return updated;
}

/**
 * GCS 객체 목록을 안전하게 삭제하고, 실패한 경로를 반환한다.
 */
async function deleteGcsPathsSafely(
  paths: string[]
): Promise<{ deletedCount: number; failedPaths: string[] }> {
  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_MEDIA_BUCKET);
  let deletedCount = 0;
  const failedPaths: string[] = [];

  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  await Promise.all(
    uniquePaths.map(async (objectPath) => {
      try {
        await bucket.file(objectPath).delete({ ignoreNotFound: true });
        deletedCount += 1;
      } catch (err) {
        console.warn(`[GCS Delete Failed] ${objectPath}:`, err);
        failedPaths.push(objectPath);
      }
    })
  );

  return { deletedCount, failedPaths };
}

/**
 * 개별 그림일기 삭제 (Delete This Diary)
 * - 다른 그림일기에서 공유 참조 중인 원본 사진/파일은 삭제하지 않고 보존한다.
 * - 삭제된 일기를 참조하던 Memory Threads 노드도 함께 정리한다.
 */
export async function deleteSingleDiaryFromWorkspace(params: {
  workspaceId: string;
  workspaceToken: string;
  diaryId: string;
}): Promise<{
  deletedDiaryId: string;
  deletedGcsFilesCount: number;
  preservedSharedFilesCount: number;
  failedPaths: string[];
  remainingDiariesCount: number;
  remainingDiaries: SavedDiaryPage[];
  memoryThreads: MemoryThreadConnection[];
}> {
  const { workspace, diaries } = await listWorkspaceDiaries(
    params.workspaceId,
    params.workspaceToken
  );

  const targetDiary = diaries.find((d) => d.diaryId === params.diaryId);
  if (!targetDiary) {
    throw new Error("삭제할 그림일기가 존재하지 않거나 이미 삭제되었습니다.");
  }

  const otherDiaries = diaries.filter((d) => d.diaryId !== params.diaryId);

  // 다른 그림일기에서 참조하고 있는 GCS 경로 집합
  const referencedByOthers = new Set<string>();
  for (const other of otherDiaries) {
    for (const p of other.photos || []) {
      if (p.gcsObjectPath) referencedByOthers.add(p.gcsObjectPath);
    }
    if (other.crayonIllustration?.gcsObjectPath) {
      referencedByOthers.add(other.crayonIllustration.gcsObjectPath);
    }
  }

  // 삭제 대상 일기의 GCS 경로 중 다른 일기에서 참조하지 않는 파일만 삭제
  const candidatePaths: string[] = [];
  let preservedSharedFilesCount = 0;

  for (const p of targetDiary.photos || []) {
    if (p.gcsObjectPath && p.gcsObjectPath.startsWith(`workspaces/${params.workspaceId}/`)) {
      if (referencedByOthers.has(p.gcsObjectPath)) {
        preservedSharedFilesCount += 1;
      } else {
        candidatePaths.push(p.gcsObjectPath);
      }
    }
  }

  const illPath = targetDiary.crayonIllustration?.gcsObjectPath;
  if (illPath && illPath.startsWith(`workspaces/${params.workspaceId}/`)) {
    if (referencedByOthers.has(illPath)) {
      preservedSharedFilesCount += 1;
    } else {
      candidatePaths.push(illPath);
    }
  }

  const { deletedCount, failedPaths } = await deleteGcsPathsSafely(candidatePaths);

  // 남은 일기들 기준으로 Memory Threads 정리 (노드가 2개 이상 남은 스레드만 유지)
  const updatedThreads = (workspace.memoryThreads || [])
    .map((thread) => ({
      ...thread,
      nodes: thread.nodes.filter((n) => n.diaryId !== params.diaryId),
    }))
    .filter((thread) => thread.nodes.length >= 2);

  const db = getFirestoreClient();
  const wsRef = db.collection("workspaces").doc(params.workspaceId);
  await wsRef.collection("diaries").doc(params.diaryId).delete();

  const mergedPendingDeletes = Array.from(
    new Set([...(workspace.pendingDeletePaths || []), ...failedPaths])
  );

  await wsRef.update({
    memoryThreads: updatedThreads,
    pendingDeletePaths: mergedPendingDeletes,
    updatedAt: new Date().toISOString(),
  });

  return {
    deletedDiaryId: params.diaryId,
    deletedGcsFilesCount: deletedCount,
    preservedSharedFilesCount,
    failedPaths,
    remainingDiariesCount: otherDiaries.length,
    remainingDiaries: otherDiaries,
    memoryThreads: updatedThreads,
  };
}

/**
 * 전체 초기화 (Reset My Workspace)
 * - 현재 익명 UUID 공간의 generationEpoch를 즉시 +1 증가시켜 진행 중인 AI 작업을 무효화한다.
 * - 현재 UUID에 속한 모든 그림일기, 원본 사진, 일러스트, Memory Threads, 미결 삭제 목록을 삭제한다.
 * - 다른 UUID 공간의 데이터는 건드리지 않는다.
 */
export async function resetEntireWorkspace(params: {
  workspaceId: string;
  workspaceToken: string;
}): Promise<{
  workspaceId: string;
  newGenerationEpoch: number;
  deletedDiariesCount: number;
  deletedGcsObjectsCount: number;
  failedPaths: string[];
  resetAt: string;
}> {
  const workspace = await verifyAndGetWorkspace(
    params.workspaceId,
    params.workspaceToken
  );

  const db = getFirestoreClient();
  const wsRef = db.collection("workspaces").doc(params.workspaceId);
  const newEpoch = (workspace.generationEpoch || 1) + 1;
  const resetAt = new Date().toISOString();

  // 1. 먼저 generationEpoch를 올려 진행 중인 AI 파이프라인이 완료되더라도 저장하지 못하게 차단
  await wsRef.update({
    generationEpoch: newEpoch,
    activeJobStatus: "cancelled",
    updatedAt: resetAt,
  });

  // 2. 하위 diaries 문서 전체 조회 및 수집
  const snapshot = await wsRef.collection("diaries").get();
  const gcsPathsToRemove: string[] = [...(workspace.pendingDeletePaths || [])];

  snapshot.forEach((doc) => {
    const d = doc.data() as SavedDiaryPage;
    for (const p of d.photos || []) {
      if (
        p.gcsObjectPath &&
        p.gcsObjectPath.startsWith(`workspaces/${params.workspaceId}/`)
      ) {
        gcsPathsToRemove.push(p.gcsObjectPath);
      }
    }
    if (
      d.crayonIllustration?.gcsObjectPath &&
      d.crayonIllustration.gcsObjectPath.startsWith(
        `workspaces/${params.workspaceId}/`
      )
    ) {
      gcsPathsToRemove.push(d.crayonIllustration.gcsObjectPath);
    }
  });

  // 3. GCS prefix(workspaces/{workspaceId}/) 아래에 남아 있을 수 있는 고아 파일까지 모두 조회
  const storage = getStorageClient();
  const bucket = storage.bucket(GCS_MEDIA_BUCKET);
  try {
    const [files] = await bucket.getFiles({
      prefix: `workspaces/${params.workspaceId}/`,
    });
    for (const f of files) {
      gcsPathsToRemove.push(f.name);
    }
  } catch (err) {
    console.warn("[GCS Prefix Scan Warning]:", err);
  }

  // 4. GCS 객체 삭제 실행
  const { deletedCount, failedPaths } =
    await deleteGcsPathsSafely(gcsPathsToRemove);

  // 5. Firestore 하위 diaries 문서 일괄 삭제
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  batch.update(wsRef, {
    generationEpoch: newEpoch,
    activeJobStatus: "idle",
    memoryThreads: [],
    pendingDeletePaths: failedPaths,
    lastResetAt: resetAt,
    updatedAt: resetAt,
  });

  await batch.commit();

  return {
    workspaceId: params.workspaceId,
    newGenerationEpoch: newEpoch,
    deletedDiariesCount: snapshot.size,
    deletedGcsObjectsCount: deletedCount,
    failedPaths,
    resetAt,
  };
}

/**
 * Firestore & Cloud Storage 실시간 연결 상태 점검
 */
export async function checkCloudStorageHealth(): Promise<{
  firestoreConnected: boolean;
  gcsConnected: boolean;
  gcsBucketName: string;
  softDeleteSeconds: number | null;
}> {
  let firestoreConnected = false;
  let gcsConnected = false;
  let softDeleteSeconds: number | null = null;

  try {
    const db = getFirestoreClient();
    await db.collection("workspaces").limit(1).get();
    firestoreConnected = true;
  } catch (err) {
    console.warn("[Firestore Health Warning]:", err);
  }

  try {
    const storage = getStorageClient();
    const [metadata] = await storage.bucket(GCS_MEDIA_BUCKET).getMetadata();
    gcsConnected = true;
    softDeleteSeconds = Number(
      metadata.softDeletePolicy?.retentionDurationSeconds ?? 0
    );
  } catch (err) {
    console.warn("[GCS Health Warning]:", err);
  }

  return {
    firestoreConnected,
    gcsConnected,
    gcsBucketName: GCS_MEDIA_BUCKET,
    softDeleteSeconds,
  };
}
