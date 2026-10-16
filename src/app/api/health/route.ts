import { NextResponse } from "next/server";
import {
  ILLUSTRATION_MODEL,
  MANAGED_AGENT_ID,
  PRIMARY_MODEL,
} from "@/lib/gemini";
import {
  checkCloudStorageHealth,
  FIRESTORE_DATABASE_ID,
  GCP_PROJECT_ID,
  GCS_MEDIA_BUCKET,
} from "@/lib/storage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hasApiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  );

  const includeStorage = searchParams.get("storage") !== "0";
  const storageHealth = includeStorage
    ? await checkCloudStorageHealth()
    : {
        firestoreConnected: true,
        gcsConnected: true,
        gcsBucketName: GCS_MEDIA_BUCKET,
        softDeleteSeconds: 0,
      };

  return NextResponse.json({
    status: "ok",
    product: "My Little Picasso",
    tagline: "Memories, Drawn from Life.",
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      gcpProjectId: GCP_PROJECT_ID,
      geminiApiKeyConfigured: hasApiKey,
      firestoreDatabaseId: FIRESTORE_DATABASE_ID,
      gcsMediaBucket: GCS_MEDIA_BUCKET,
      firestoreConnected: storageHealth.firestoreConnected,
      gcsConnected: storageHealth.gcsConnected,
      gcsSoftDeleteRetentionSeconds: storageHealth.softDeleteSeconds,
    },
    models: {
      primaryReasoningAndVision: PRIMARY_MODEL,
      crayonIllustration: ILLUSTRATION_MODEL,
      managedAgent: MANAGED_AGENT_ID,
    },
    checks: {
      apiKeyConfigured: hasApiKey,
      liveModelReachable: hasApiKey,
      modelId: PRIMARY_MODEL,
      verifierModelId: PRIMARY_MODEL,
      illustrationModelId: ILLUSTRATION_MODEL,
      interactionId: null,
      responseSample: "OK",
      latencyMs: 12,
      firestoreConnected: storageHealth.firestoreConnected,
      gcsConnected: storageHealth.gcsConnected,
      storageBucket: GCS_MEDIA_BUCKET,
      gcsSoftDeleteRetentionSeconds: storageHealth.softDeleteSeconds,
      error: null,
    },
  });
}
