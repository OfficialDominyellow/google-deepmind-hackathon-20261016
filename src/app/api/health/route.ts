import { NextResponse } from "next/server";
import {
  ILLUSTRATION_MODEL,
  MANAGED_AGENT_ID,
  PRIMARY_MODEL,
} from "@/lib/gemini";

export async function GET() {
  const hasApiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  );

  return NextResponse.json({
    status: "ok",
    product: "My Little Picasso",
    tagline: "Memories, Drawn from Life.",
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      gcpProjectId: process.env.GCP_PROJECT_ID || "h2gdm-hack26icn-2627",
      geminiApiKeyConfigured: hasApiKey,
    },
    models: {
      primaryReasoningAndVision: PRIMARY_MODEL,
      crayonIllustration: ILLUSTRATION_MODEL,
      managedAgent: MANAGED_AGENT_ID,
    },
  });
}

