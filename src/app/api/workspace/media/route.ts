import { NextResponse } from "next/server";
import {
  downloadWorkspaceMediaFromGcs,
  WorkspaceAccessDeniedError,
} from "@/lib/storage";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gcsObjectPath = searchParams.get("path") || "";
    const workspaceId =
      request.headers.get("x-workspace-id") || searchParams.get("wid") || "";
    const workspaceToken =
      request.headers.get("x-workspace-token") || searchParams.get("wt") || "";

    if (!gcsObjectPath) {
      return NextResponse.json(
        { ok: false, error: "미디어 경로(path)가 지정되지 않았습니다." },
        { status: 400 }
      );
    }

    const { buffer, contentType } = await downloadWorkspaceMediaFromGcs({
      workspaceId,
      workspaceToken,
      gcsObjectPath,
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
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
            : "미디어 파일을 불러오는 중 오류가 발생했습니다.",
      },
      { status: 404 }
    );
  }
}

