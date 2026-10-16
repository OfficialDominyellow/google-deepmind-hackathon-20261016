/**
 * 클라이언트 측 이미지 전처리(EXIF 보존 + API 전송용 640px 리사이즈) 및
 * 다중 날짜 가족 추억 데모 앨범 생성기 (Memory Grouping + Memory Threads 즉시 검증용)
 */

export interface ClientUploadPhoto {
  photoId: string;
  fileName: string;
  mimeType: string;
  /** 화면 표시 및 Cloud Storage 원본 보관용 고화질 Data URL */
  previewDataUrl: string;
  /** Cloud Storage 저장용 Base64 (원본 해상도 유지 또는 최대 1400px) */
  originalBase64Data: string;
  /** Gemini API 비전 호출용 경량 Base64 (최대 640px JPEG) */
  apiBase64Data: string;
  capturedAt: string | null;
  dateConfidence: "exif_verified" | "inferred" | "unknown";
  fingerprint: string;
  isDuplicateOf?: string | null;
  customGroupKey?: string;
  status: "ready" | "analyzing" | "done" | "error";
  errorMessage?: string;
}

/**
 * 고해상도 사진을 지정된 최대 크기의 JPEG Base64로 리사이즈한다.
 */
export function resizeImageDataUrl(
  sourceDataUrl: string,
  maxDimension = 640,
  quality = 0.82
): Promise<{ base64Data: string; mimeType: string; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({
          base64Data: sourceDataUrl.replace(/^data:[^;]+;base64,/, ""),
          mimeType: "image/jpeg",
          width: img.width,
          height: img.height,
        });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const resizedUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({
        base64Data: resizedUrl.replace(/^data:[^;]+;base64,/, ""),
        mimeType: "image/jpeg",
        width,
        height,
      });
    };
    img.onerror = () => {
      resolve({
        base64Data: sourceDataUrl.replace(/^data:[^;]+;base64,/, ""),
        mimeType: "image/jpeg",
        width: 640,
        height: 480,
      });
    };
    img.src = sourceDataUrl;
  });
}

/**
 * 간단한 시각적 핑거프린트(8x8 평균 밝기 해시)를 계산해 중복 사진을 감지한다.
 */
export function computeVisualFingerprint(sourceDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(`len_${sourceDataUrl.length}`);
        return;
      }
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const grays: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        grays.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
      }
      const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
      const bits = grays.map((g) => (g >= avg ? "1" : "0")).join("");
      resolve(bits);
    };
    img.onerror = () => resolve(`len_${sourceDataUrl.length}`);
    img.src = sourceDataUrl;
  });
}

function drawYellowBicycle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale = 1,
  withTrainingWheels = true
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // 바퀴 2개
  ctx.strokeStyle = "#3A2E25";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(-55, 25, 32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(55, 25, 32, 0, Math.PI * 2);
  ctx.stroke();

  // 바퀴 살
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8C7A6B";
  for (const wx of [-55, 55]) {
    ctx.beginPath();
    ctx.moveTo(wx - 28, 25);
    ctx.lineTo(wx + 28, 25);
    ctx.moveTo(wx, 25 - 28);
    ctx.lineTo(wx, 25 + 28);
    ctx.stroke();
  }

  // 노란색 자전거 프레임 (핵심 연결 단서: 노란색 프레임 + 앞바구니 + 별 스티커)
  ctx.strokeStyle = "#F0B429";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-55, 25);
  ctx.lineTo(-10, -22);
  ctx.lineTo(42, -22);
  ctx.lineTo(55, 25);
  ctx.moveTo(-10, -22);
  ctx.lineTo(5, 25);
  ctx.lineTo(-55, 25);
  ctx.stroke();

  // 핸들과 갈색 안장
  ctx.strokeStyle = "#5C4A3E";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(42, -22);
  ctx.lineTo(35, -48);
  ctx.lineTo(20, -48);
  ctx.stroke();

  ctx.fillStyle = "#6E473B";
  ctx.beginPath();
  ctx.roundRect(-24, -32, 28, 10, 5);
  ctx.fill();

  // 앞바구니
  ctx.fillStyle = "#D98A3C";
  ctx.fillRect(42, -40, 22, 18);

  // 보조바퀴 (초기 날짜 사진에서만 표시하거나 옵션 처리)
  if (withTrainingWheels) {
    ctx.strokeStyle = "#D96B43";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-55, 25);
    ctx.lineTo(-72, 46);
    ctx.stroke();
    ctx.fillStyle = "#D96B43";
    ctx.beginPath();
    ctx.arc(-72, 48, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawChildFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shirtColor: string,
  helmetColor: string,
  heightScale = 1
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(heightScale, heightScale);

  // 몸통
  ctx.fillStyle = shirtColor;
  ctx.beginPath();
  ctx.roundRect(-22, -25, 44, 52, 14);
  ctx.fill();

  // 다리
  ctx.strokeStyle = "#3B4D6B";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-10, 25);
  ctx.lineTo(-14, 62);
  ctx.moveTo(10, 25);
  ctx.lineTo(14, 62);
  ctx.stroke();

  // 얼굴
  ctx.fillStyle = "#F6D5B8";
  ctx.beginPath();
  ctx.arc(0, -48, 22, 0, Math.PI * 2);
  ctx.fill();

  // 헬멧
  ctx.fillStyle = helmetColor;
  ctx.beginPath();
  ctx.arc(0, -54, 24, Math.PI, 0);
  ctx.fill();

  // 미소와 눈
  ctx.fillStyle = "#3A2E25";
  ctx.beginPath();
  ctx.arc(-7, -48, 2.5, 0, Math.PI * 2);
  ctx.arc(7, -48, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3A2E25";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -44, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

/**
 * 다중 날짜 가족 추억 데모 앨범 (총 5장, 3개 날짜 그룹)
 * - 2025-05-05 (3장): 봄 공원 산책길에서 노란 보조바퀴 자전거 첫 연습 + 벤치에서 오렌지 주스 마시기 + 노을빛 산책길 귀가 (하루 3장 다중 사진 레이아웃 & 그룹화 검증)
 * - 2025-05-08 (1장): 같은 주 목요일 공원 잔디밭 피크닉 매트 옆에 세워둔 노란 자전거와 비눗방울 놀이 (월간 달력 & 주간 대표 그림 검증)
 * - 2026-04-19 (1장): 이듬해 봄 벚꽃 공원에서 보조바퀴를 떼고 같은 노란 자전거를 타는 모습 (Memory Threads 시간 변화 검증)
 */
export async function generateMultiDateFamilyDemoPhotos(): Promise<ClientUploadPhoto[]> {
  const specs = [
    {
      photoId: "demo_20250505_bike",
      fileName: "20250505_park_yellow_bike_1.jpg",
      capturedAt: "2025-05-05",
      scene: "spring_practice",
    },
    {
      photoId: "demo_20250505_bench",
      fileName: "20250505_park_bench_juice_2.jpg",
      capturedAt: "2025-05-05",
      scene: "spring_bench",
    },
    {
      photoId: "demo_20250505_sunset",
      fileName: "20250505_park_sunset_walk_3.jpg",
      capturedAt: "2025-05-05",
      scene: "spring_sunset",
    },
    {
      photoId: "demo_20250508_picnic",
      fileName: "20250508_may_picnic_bubbles.jpg",
      capturedAt: "2025-05-08",
      scene: "may_picnic",
    },
    {
      photoId: "demo_20260419_blossom",
      fileName: "20260419_spring_blossom_grown_bike.jpg",
      capturedAt: "2026-04-19",
      scene: "next_spring_grown",
    },
  ] as const;

  const results: ClientUploadPhoto[] = [];

  for (const spec of specs) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 440;
    const ctx = canvas.getContext("2d")!;

    if (spec.scene === "spring_practice") {
      // 맑은 봄 하늘과 초록 잔디 공원 산책길
      ctx.fillStyle = "#DCEEFB";
      ctx.fillRect(0, 0, 640, 270);
      ctx.fillStyle = "#8CBF75";
      ctx.fillRect(0, 270, 640, 170);
      // 산책로
      ctx.fillStyle = "#E6D7BE";
      ctx.beginPath();
      ctx.moveTo(0, 340);
      ctx.lineTo(640, 310);
      ctx.lineTo(640, 410);
      ctx.lineTo(0, 430);
      ctx.closePath();
      ctx.fill();
      // 태양과 봄 나무
      ctx.fillStyle = "#F4C44E";
      ctx.beginPath();
      ctx.arc(540, 72, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#795548";
      ctx.fillRect(110, 140, 28, 140);
      ctx.fillStyle = "#5FA463";
      ctx.beginPath();
      ctx.arc(124, 130, 65, 0, Math.PI * 2);
      ctx.fill();

      drawChildFigure(ctx, 305, 285, "#E57348", "#F4C44E", 0.95);
      drawYellowBicycle(ctx, 320, 335, 1.0, true);
    } else if (spec.scene === "spring_bench") {
      // 같은 날(2025-05-05) 공원 나무 벤치 옆에 세워둔 노란 보조바퀴 자전거와 오렌지 주스를 마시는 아이
      ctx.fillStyle = "#DCEEFB";
      ctx.fillRect(0, 0, 640, 265);
      ctx.fillStyle = "#8CBF75";
      ctx.fillRect(0, 265, 640, 175);
      // 나무 벤치
      ctx.fillStyle = "#8D6E63";
      ctx.fillRect(120, 270, 210, 18);
      ctx.fillRect(120, 235, 210, 24);
      ctx.fillRect(140, 288, 16, 45);
      ctx.fillRect(294, 288, 16, 45);

      drawChildFigure(ctx, 220, 255, "#E57348", "#F4C44E", 0.95);
      // 손에 든 오렌지 주스 팩
      ctx.fillStyle = "#FF9800";
      ctx.fillRect(245, 230, 18, 26);

      // 벤치 옆에 세워진 동일한 노란 보조바퀴 자전거
      drawYellowBicycle(ctx, 455, 330, 0.95, true);
    } else if (spec.scene === "spring_sunset") {
      // 같은 날(2025-05-05) 저녁 노을빛 공원 산책길에서 노란 보조바퀴 자전거를 끌고 걸어가는 모습
      ctx.fillStyle = "#FBE4C9";
      ctx.fillRect(0, 0, 640, 268);
      ctx.fillStyle = "#7AA865";
      ctx.fillRect(0, 268, 640, 172);
      ctx.fillStyle = "#DFCBB2";
      ctx.fillRect(0, 322, 640, 88);
      // 노을 태양
      ctx.fillStyle = "#E8834A";
      ctx.beginPath();
      ctx.arc(110, 110, 38, 0, Math.PI * 2);
      ctx.fill();
      drawChildFigure(ctx, 260, 282, "#E57348", "#F4C44E", 0.95);
      drawYellowBicycle(ctx, 375, 335, 0.95, true);
    } else if (spec.scene === "may_picnic") {
      // 2025-05-08 같은 주 목요일: 체크무늬 피크닉 매트와 비눗방울, 옆에 세워둔 노란 자전거
      ctx.fillStyle = "#E2F2FD";
      ctx.fillRect(0, 0, 640, 265);
      ctx.fillStyle = "#88BE70";
      ctx.fillRect(0, 265, 640, 175);
      // 빨간 체크 피크닉 매트
      ctx.fillStyle = "#E56B55";
      ctx.beginPath();
      ctx.roundRect(110, 315, 220, 75, 10);
      ctx.fill();
      ctx.fillStyle = "#FFF8EE";
      ctx.fillRect(140, 325, 40, 55);
      ctx.fillRect(220, 325, 40, 55);
      // 비눗방울들
      ctx.strokeStyle = "#7CC1E8";
      ctx.lineWidth = 3;
      for (const [bx, by, br] of [
        [280, 180, 16],
        [325, 145, 22],
        [365, 190, 12],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawChildFigure(ctx, 220, 275, "#F2B138", "#F4C44E", 0.96);
      drawYellowBicycle(ctx, 470, 335, 0.95, true);
    } else {
      // 2026-04-19 이듬해 봄 벚꽃 나무 아래에서 훌쩍 자란 아이가 보조바퀴 없이 노란 자전거를 타는 모습
      ctx.fillStyle = "#E6F3FC";
      ctx.fillRect(0, 0, 640, 265);
      ctx.fillStyle = "#7EBA68";
      ctx.fillRect(0, 265, 640, 175);
      ctx.fillStyle = "#E6D7BE";
      ctx.fillRect(0, 325, 640, 85);

      // 분홍 벚꽃 나무
      ctx.fillStyle = "#6D4C41";
      ctx.fillRect(470, 130, 32, 145);
      ctx.fillStyle = "#F6B8C6";
      ctx.beginPath();
      ctx.arc(485, 120, 74, 0, Math.PI * 2);
      ctx.fill();

      // 조금 더 자란 키(heightScale 1.12) + 보조바퀴 제거(withTrainingWheels = false)
      drawChildFigure(ctx, 275, 270, "#3D7EA6", "#F4C44E", 1.12);
      drawYellowBicycle(ctx, 285, 335, 1.05, false);
    }

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const cleanBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    const fp = await computeVisualFingerprint(dataUrl);

    results.push({
      photoId: spec.photoId,
      fileName: spec.fileName,
      mimeType: "image/jpeg",
      previewDataUrl: dataUrl,
      originalBase64Data: cleanBase64,
      apiBase64Data: cleanBase64,
      capturedAt: spec.capturedAt,
      dateConfidence: "exif_verified",
      fingerprint: fp,
      status: "ready",
    });
  }

  return results;
}

