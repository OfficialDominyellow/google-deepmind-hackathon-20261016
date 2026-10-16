import { NextResponse } from "next/server";
import {
  getGeminiClient,
  ILLUSTRATION_MODEL,
  MANAGED_AGENT_ID,
  PRIMARY_MODEL,
} from "@/lib/gemini";

// 2x2 따뜻한 크림/주황 톤 샘플 이미지 (Base64 PNG)
const TINY_WARM_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP8z8DAwMDAAAX8Av/5/67tAAAAAElFTkSuQmCC";

export async function POST(request: Request) {
  const startTotal = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const includeImageGen = Boolean(body?.includeImageGen);
    const includeAgentCheck = Boolean(body?.includeAgentCheck);

    const client = getGeminiClient();
    const results: {
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
      managedAgent?: {
        ok: boolean;
        agent: string;
        model: string;
        latencyMs: number;
        interactionId?: string;
        outputText?: string;
        error?: string;
      };
    } = {
      textReasoning: {
        ok: false,
        model: PRIMARY_MODEL,
        latencyMs: 0,
      },
      multimodalVision: {
        ok: false,
        model: PRIMARY_MODEL,
        latencyMs: 0,
      },
    };

    // 1. Gemini 4 Argon 기본 텍스트 & 추론 호출 검증
    const t1 = Date.now();
    try {
      const textInt = await client.interactions.create({
        model: PRIMARY_MODEL,
        input:
          "안녕! 너는 가족의 실제 사진으로 따뜻한 그림일기를 만드는 'My Little Picasso' 에이전트야. 한국어로 한 문장으로 반갑게 인사해줘.",
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 32768,
        },
      });
      results.textReasoning = {
        ok: true,
        model: PRIMARY_MODEL,
        latencyMs: Date.now() - t1,
        interactionId: textInt.id,
        outputText: textInt.output_text?.trim() || "(응답 수신 완료)",
      };
    } catch (err: unknown) {
      results.textReasoning = {
        ok: false,
        model: PRIMARY_MODEL,
        latencyMs: Date.now() - t1,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. Gemini 4 Argon 멀티모달 이미지 관찰 사실 추출 검증
    const t2 = Date.now();
    try {
      const visionInt = await client.interactions.create({
        model: PRIMARY_MODEL,
        input: [
          {
            type: "image",
            data: TINY_WARM_PNG_BASE64,
            mime_type: "image/png",
          },
          {
            type: "text",
            text: "이 작은 테스트 이미지에서 실제로 관찰 가능한 색상을 과장 없이 한국어 한 문장으로 답해줘.",
          },
        ],
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 32768,
        },
      });
      results.multimodalVision = {
        ok: true,
        model: PRIMARY_MODEL,
        latencyMs: Date.now() - t2,
        interactionId: visionInt.id,
        outputText: visionInt.output_text?.trim() || "(멀티모달 분석 완료)",
      };
    } catch (err: unknown) {
      results.multimodalVision = {
        ok: false,
        model: PRIMARY_MODEL,
        latencyMs: Date.now() - t2,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. 크레용 일러스트 생성 모델 (gemini-nano-banana-2.1) 선택적 검증
    if (includeImageGen) {
      const t3 = Date.now();
      try {
        const imgInt = await client.interactions.create({
          model: ILLUSTRATION_MODEL,
          input:
            "Warm childlike wax crayon drawing on cream sketchbook paper of a small yellow paper airplane and an orange sun, rough crayon texture.",
        });
        results.crayonImageGen = {
          ok: Boolean(imgInt.output_image?.data),
          model: ILLUSTRATION_MODEL,
          latencyMs: Date.now() - t3,
          interactionId: imgInt.id,
          hasImageBytes: Boolean(imgInt.output_image?.data),
        };
      } catch (err: unknown) {
        results.crayonImageGen = {
          ok: false,
          model: ILLUSTRATION_MODEL,
          latencyMs: Date.now() - t3,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // 4. Managed Agent (antigravity-preview-09-2026 + gemini-4-argon) 선택적 검증
    if (includeAgentCheck) {
      const t4 = Date.now();
      try {
        const agentInt = await client.interactions.create({
          agent: MANAGED_AGENT_ID,
          input:
            "Return a one-sentence confirmation in Korean that the Antigravity managed agent environment is reachable.",
          environment: "remote",
          agent_config: {
            type: "antigravity",
            model: PRIMARY_MODEL,
          },
        });
        results.managedAgent = {
          ok: true,
          agent: MANAGED_AGENT_ID,
          model: PRIMARY_MODEL,
          latencyMs: Date.now() - t4,
          interactionId: agentInt.id,
          outputText: agentInt.output_text?.trim() || "(에이전트 응답 완료)",
        };
      } catch (err: unknown) {
        results.managedAgent = {
          ok: false,
          agent: MANAGED_AGENT_ID,
          model: PRIMARY_MODEL,
          latencyMs: Date.now() - t4,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const allCoreOk =
      results.textReasoning.ok && results.multimodalVision.ok;

    return NextResponse.json({
      ok: allCoreOk,
      sdkPackage: "@google/genai (Interactions API)",
      totalLatencyMs: Date.now() - startTotal,
      results,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

