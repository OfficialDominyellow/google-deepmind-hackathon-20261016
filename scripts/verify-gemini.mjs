/**
 * My Little Picasso — Gemini 4 Argon & 에이전트/멀티모달 API 검증 스크립트
 * 실행 방법: npm run verify:gemini
 */
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("[오류] GEMINI_API_KEY 환경 변수가 설정되어 있지 않습니다.");
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey });

// 테스트용 2x2 따뜻한 노란색/주황색 PNG (Base64)
const TINY_SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP8z8DAwMDAAAX8Av/5/67tAAAAAElFTkSuQmCC";

async function runVerification() {
  console.log("====================================================");
  console.log("🎨 My Little Picasso — Gemini API & 모델 호환성 검증");
  console.log("====================================================");

  const hasInteractionsApi = typeof client.interactions?.create === "function";
  console.log(`[SDK 점검] client.interactions.create 지원 여부: ${hasInteractionsApi}`);

  // 1. gemini-4-argon 기본 추론 호출 테스트
  try {
    const t0 = Date.now();
    if (hasInteractionsApi) {
      const interaction = await client.interactions.create({
        model: "gemini-4-argon",
        input:
          "안녕! 너는 가족 그림일기 에이전트 'My Little Picasso'의 핵심 두뇌야. 한국어로 한 문장으로 따뜻하게 인사해줘.",
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 32768,
        },
      });
      const elapsed = Date.now() - t0;
      console.log(`✅ [1] gemini-4-argon (Interactions API) 성공 (${elapsed}ms)`);
      console.log(`   응답: ${interaction.output_text?.trim()}`);
      console.log(`   Interaction ID: ${interaction.id}`);
    } else {
      const response = await client.models.generateContent({
        model: "gemini-4-argon",
        contents:
          "안녕! 너는 가족 그림일기 에이전트 'My Little Picasso'의 핵심 두뇌야. 한국어로 한 문장으로 따뜻하게 인사해줘.",
      });
      const elapsed = Date.now() - t0;
      console.log(`✅ [1] gemini-4-argon (models.generateContent) 성공 (${elapsed}ms)`);
      console.log(`   응답: ${response.text?.trim()}`);
    }
  } catch (err) {
    console.error(`❌ [1] gemini-4-argon 텍스트 호출 실패:`, err.message || err);
  }

  // 2. gemini-4-argon 멀티모달(이미지 입력) 호출 테스트
  try {
    const t0 = Date.now();
    if (hasInteractionsApi) {
      const interaction = await client.interactions.create({
        model: "gemini-4-argon",
        input: [
          {
            type: "image",
            data: TINY_SAMPLE_PNG_BASE64,
            mime_type: "image/png",
          },
          {
            type: "text",
            text: "이 이미지에서 관찰할 수 있는 색상이나 특징을 과장 없이 한 문장으로 설명해줘.",
          },
        ],
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 32768,
        },
      });
      const elapsed = Date.now() - t0;
      console.log(`✅ [2] gemini-4-argon 멀티모달 이미지 분석 성공 (${elapsed}ms)`);
      console.log(`   응답: ${interaction.output_text?.trim()}`);
    } else {
      const response = await client.models.generateContent({
        model: "gemini-4-argon",
        contents: [
          {
            inlineData: {
              data: TINY_SAMPLE_PNG_BASE64,
              mimeType: "image/png",
            },
          },
          "이 이미지에서 관찰할 수 있는 색상이나 특징을 과장 없이 한 문장으로 설명해줘.",
        ],
      });
      const elapsed = Date.now() - t0;
      console.log(`✅ [2] gemini-4-argon 멀티모달 이미지 분석 성공 (${elapsed}ms)`);
      console.log(`   응답: ${response.text?.trim()}`);
    }
  } catch (err) {
    console.error(`❌ [2] gemini-4-argon 멀티모달 호출 실패:`, err.message || err);
  }

  // 3. 크레용 일러스트 생성 모델 (gemini-nano-banana-2.1) 호출 테스트
  try {
    const t0 = Date.now();
    if (hasInteractionsApi) {
      const imgInteraction = await client.interactions.create({
        model: "gemini-nano-banana-2.1",
        input:
          "Warm childlike crayon drawing on aged cream sketchbook paper of a small yellow bicycle with training wheels parked under an autumn tree, rough wax crayon texture, muted orange and olive tones.",
      });
      const elapsed = Date.now() - t0;
      const hasImg = Boolean(imgInteraction.output_image?.data);
      console.log(
        `✅ [3] gemini-nano-banana-2.1 이미지 생성 응답 (${elapsed}ms) | 이미지 포함: ${hasImg}`
      );
    }
  } catch (err) {
    console.warn(`⚠️ [3] gemini-nano-banana-2.1 호출 참고:`, err.message || err);
  }

  console.log("====================================================");
}

runVerification();

