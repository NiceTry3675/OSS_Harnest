/** 인터뷰 계약 — interview_schema.md v0.3의 스켈레톤 부분집합.
 *  템플릿 추가 = 스키마 무변경: 질문은 템플릿이 선언하고, 답변은 answers 맵으로만 흐른다. */

export interface InterviewSubmission {
  schemaVersion: "skeleton-1";
  templateId: string;
  answers: Record<string, unknown>;
}

export type QuestionType = "text" | "number" | "staffList";

export interface Question {
  id: string;
  /** material=원료, constraints=수정 스코프/제약, criteria=평가 기준 파라미터 */
  role: "material" | "constraints" | "criteria";
  type: QuestionType;
  label: string;
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  defaultValue?: unknown;
}
