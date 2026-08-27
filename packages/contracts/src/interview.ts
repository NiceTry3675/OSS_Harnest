/** 현재 인터뷰 입력 계약.
 *  템플릿 추가 = 스키마 무변경: 질문은 템플릿이 선언하고, 답변은 answers 맵으로만 흐른다. */

export interface InterviewSubmission {
  schemaVersion: "skeleton-1";
  templateId: string;
  answers: Record<string, unknown>;
}

/** judgeModel — 채점 모델을 고르는 단계. 입력 UI는 위저드가 소유한다(공급자·키·모델 목록). */
export type QuestionType =
  | "text" | "number" | "staffList" | "textarea" | "caseList" | "toggle" | "judgeModel"
  | "sourceDocuments";

/** 평가 케이스 — 케이스 기반 템플릿의 원료이자 정답(ground truth). */
export interface CaseDef {
  id: string;
  /** 실제로 받았던 질문·요청 */
  question: string;
  /** 그때의 실제 답·처리 — grader가 대조할 정답 */
  expectedAnswer: string;
  /** 케이스 출처 — 공개용 메타데이터. 엔진·프롬프트는 소비하지 않는다.
   *  생략 = 사용자가 직접 입력("user"). AI 초안은 사용자가 확인한 뒤에만 제출에 포함된다. */
  provenance?: "user" | "ai" | "ai_edited";
}

export interface Question {
  id: string;
  /** material=원료, constraints=수정 스코프/제약, criteria=평가 기준 파라미터 */
  role: "material" | "constraints" | "criteria";
  type: QuestionType;
  label: string;
  /** 입력면 머리에 붙는 짧은 이름 — 생략하면 label을 쓴다 */
  shortLabel?: string;
  help?: string;
  /** 다음 단계로 가는 버튼 문구 — 생략하면 "다음" */
  nextLabel?: string;
  /** 앞 질문과 같은 단계에서 함께 묻는다. 같은 대상을 정하는 질문끼리 붙일 때 쓴다.
   *  붙은 질문은 단계 표시줄에 따로 나오지 않는다. */
  sameStep?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  defaultValue?: unknown;
  /** textarea 전용 — 로컬 텍스트 파일을 첨부해 값에 이어붙이는 UI를 켠다(추출은 브라우저 안에서만) */
  attachText?: boolean;
  /** 문자 수 상한 — 위저드가 범용으로 검증한다 */
  maxChars?: number;
  /** textarea·sourceDocuments처럼 기본적으로 선택인 입력을 필수로 만들 때 사용한다. */
  required?: boolean;
  /** sourceDocuments 파일 선택기의 accept 문자열. 실제 형식 검증은 템플릿 추출기가 다시 한다. */
  accept?: string;
}
