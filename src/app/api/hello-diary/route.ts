import { NextResponse } from "next/server";
import {
  runHelloWorldGroundedPipeline,
  type PipelineProgressEvent,
} from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      photoId = `photo_${Date.now()}`,
      fileName = "family_moment.jpg",
      mimeType = "image/jpeg",
      base64Data,
      capturedAt = null,
      generateCrayonImage = true,
      stream = true,
    } = body || {};

    if (!base64Data || typeof base64Data !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "분석할 사진 데이터(base64Data)가 전달되지 않았습니다.",
        },
        { status: 400 }
      );
    }

    if (!stream) {
      const result = await runHelloWorldGroundedPipeline({
        photoId,
        fileName,
        mimeType,
        base64Data,
        capturedAt,
        generateCrayonImage,
      });

      return NextResponse.json({
        ok: true,
        data: result,
      });
    }

    // 실시간 단계별 진행률 스트리밍 (NDJSON)
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const sendEvent = (payload: unknown) => {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        };

        try {
          const result = await runHelloWorldGroundedPipeline(
            {
              photoId,
              fileName,
              mimeType,
              base64Data,
              capturedAt,
              generateCrayonImage,
            },
            (progressEvent: PipelineProgressEvent) => {
              sendEvent(progressEvent);
            }
          );

          sendEvent({
            type: "complete",
            ok: true,
            data: result,
          });
        } catch (err: unknown) {
          sendEvent({
            type: "error",
            ok: false,
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
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "그림일기 생성 파이프라인 요청 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
