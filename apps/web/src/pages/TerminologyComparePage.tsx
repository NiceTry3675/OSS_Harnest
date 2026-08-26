import { useEffect } from "react";
import { setFlowStep } from "../lib/flowStep";
import { InfoTip } from "../components/InfoTip";

interface CompareCopy {
  columnTitle: string;
  columnNote: string;
  steps: string[];
  blueprintTitle: string;
  criteria: Array<{ title: string; weight: number; help?: string }>;
  showPreviewGate: boolean;
  showPreviewQuestionUse: boolean;
  showPreviewJudge: boolean;
  gateState: string;
  caseGroups: string;
  caseGroupHelp: string;
  judge: string;
  approvalTitle: string;
  approvalSub: string;
  requiredTitle: string;
  requiredState: string;
  splitTitle: string;
  splitDetail: string;
  checkTitle: string;
  checkState: string;
  approveButton: string;
  sealTitle: string;
  sealSub: string;
  codeLabel: string;
  consoleTitle: string;
  runState: string;
  consoleSub: string;
  lockBadge: string;
  guardBadge: string;
  guardHelp: string;
  callBudget: string;
  streamTitle: string;
  emptyRounds: string;
  savedProgress: string;
  totalRounds: string;
  guardResult: string;
  holdoutResult: string;
  protectionTitle: string;
  scoringBadge: string;
  adoptionBadge: string;
  splitBadge: string;
  reportBadge: string;
}

const BEFORE: CompareCopy = {
  columnTitle: "기존 문구",
  columnNote: "문서 커밋 직전 프런트에서 사용하던 표현",
  steps: ["질문과 답", "점검·승인", "잠금", "실행", "결과"],
  blueprintTitle: "이렇게 채점됩니다",
  criteria: [
    { title: "문서만 보고 실제 질문에 답할 수 있는가 (질문 3개로 실제 확인)", weight: 80 },
    { title: "간결성 (분량 상한 8,000자 대비 여유 — 답변력이 0이면 0점)", weight: 20 },
  ],
  showPreviewGate: true,
  showPreviewQuestionUse: true,
  showPreviewJudge: true,
  gateState: "미충족 시 탈락",
  caseGroups: "중간 점검 질문 · 숨긴 질문",
  caseGroupHelp: "질문을 고치는 데 쓰는 질문 · 중간 점검 · 숨긴 질문으로 나눕니다.",
  judge: "채점 모델",
  approvalTitle: "채점 기준 승인",
  approvalSub: "채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.",
  requiredTitle: "반드시 지켜야 할 조건",
  requiredState: "미충족 시 탈락",
  splitTitle: "질문 나누기",
  splitDetail: "중간 점검 질문 2개 · 숨긴 질문 1개",
  checkTitle: "채점 모델 점검",
  checkState: "검증 리포트: 통과",
  approveButton: "승인하고 잠그기",
  sealTitle: "승인 완료 · 잠김",
  sealSub: "잠긴 기준은 여기서 고칠 수 없습니다.",
  codeLabel: "기준 지문",
  consoleTitle: "관제실",
  runState: "실행 중",
  consoleSub: "채점 기준은 당신이 승인했고, 실행 중 AI는 이 기준을 변경할 수 없습니다.",
  lockBadge: "기준 잠김",
  guardBadge: "중간 점검: 82점",
  guardHelp: "중간 점검 질문 점수 — 이 점수가 떨어지는 후보는 채택되지 않습니다",
  callBudget: "라운드당 약 5회 모델 호출 · 최대 8라운드",
  streamTitle: "추론 실황",
  emptyRounds: "기록된 라운드 판정이 없습니다.",
  savedProgress: "지금까지의 진행은 체크포인트에 저장되어 있습니다.",
  totalRounds: "총 5라운드",
  guardResult: "중간 점검 질문 — 시작 78점 → 종료 82점",
  holdoutResult: "루프에 숨긴 검증 케이스에서 — 시작 70점 → 종료 86점",
  protectionTitle: "활성 방어 세트",
  scoringBadge: "케이스 실측 채점(저지: model)",
  adoptionBadge: "채택 기준: 점수가 오르고, 중간 점검도 떨어지지 않을 때",
  splitBadge: "중간 점검 2개 · 숨긴 질문 1개",
  reportBadge: "검증 리포트: 통과",
};

const AFTER: CompareCopy = {
  columnTitle: "통일안 적용",
  columnNote: "같은 기능과 배치를 유지하고 용어만 바꾼 표현",
  steps: ["질문과 답", "사전 점검·승인", "기준 확정", "실행", "결과"],
  blueprintTitle: "평가 구성 미리보기",
  criteria: [
    { title: "답변 가능성", weight: 80, help: "문서만 보고 실제 질문 3개에 답할 수 있는지 확인" },
  ],
  showPreviewGate: false,
  showPreviewQuestionUse: false,
  showPreviewJudge: false,
  gateState: "위반 시 제외",
  caseGroups: "질문 사용 구분",
  caseGroupHelp: "질문을 세 가지 용도로 나눕니다.\n개선용: 평가 결과를 다음 개선에 반영합니다.\n중간 점검용: 매 회차 평가하되 합계 점수만 새 개선안의 채택 판단에 사용합니다.\n최종 확인용: 개선에는 사용하지 않고 시작과 끝에서만 평가합니다.\n중간 점검 점수가 현재 결과보다 25점 넘게 낮으면 새 개선안을 채택하지 않습니다.",
  judge: "사용할 AI 모델",
  approvalTitle: "평가 구성 승인",
  approvalSub: "AI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다.",
  requiredTitle: "필수 조건",
  requiredState: "위반 시 제외",
  splitTitle: "질문 사용 구분",
  splitDetail: "개선용 3개 · 중간 점검용 2개 · 최종 확인용 1개",
  checkTitle: "AI 평가 사전 점검",
  checkState: "사전 점검: 통과",
  approveButton: "평가 구성 승인",
  sealTitle: "기준 확정",
  sealSub: "AI가 결과물을 만들고 평가하는 동안 평가 구성은 바뀌지 않습니다.\n변경하려면 다시 승인하세요.",
  codeLabel: "확인 코드",
  consoleTitle: "실행",
  runState: "개선 중…",
  consoleSub: "AI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다.",
  lockBadge: "평가 구성 적용 중",
  guardBadge: "중간 점검: 82점",
  guardHelp: "개선안이 기존 결과보다 크게 나빠지지 않았는지 확인한 점수입니다.",
  callBudget: "회차당 AI 요청 약 5회 · 최대 8회 개선",
  streamTitle: "AI 작업 기록",
  emptyRounds: "기록된 개선안 비교 결과가 없습니다.",
  savedProgress: "진행 상태가 저장되었습니다.",
  totalRounds: "총 5회 개선",
  guardResult: "중간 점검 — 시작 78점 → 종료 82점",
  holdoutResult: "최종 확인 — 시작 70점 → 종료 86점",
  protectionTitle: "적용된 보호 규칙",
  scoringBadge: "평가 사례 채점 · model",
  adoptionBadge: "채택: 점수 상승 + 중간 점검 통과",
  splitBadge: "중간 점검 2개 · 최종 확인 1개",
  reportBadge: "사전 점검: 통과",
};

type AuditKind = "text" | "title" | "badge" | "button" | "error";

interface AuditChange {
  place: string;
  before: string;
  after: string;
  kind?: AuditKind;
}

interface AuditGroup {
  title: string;
  note: string;
  changes: AuditChange[];
}

const AUDIT_GROUPS: AuditGroup[] = [
  {
    title: "첫 방문 안내와 진행 단계",
    note: "IntroTour · StepBar",
    changes: [
      {
        place: "첫 페이지 서비스 설명",
        before: "AI 개선 관제실",
        after: "AI 결과물 생성·평가",
        kind: "badge",
      },
      {
        place: "첫 페이지 기준 유지 설명",
        before: "채점 기준을 승인하는 순간 잠깁니다. AI는 실행 내내 그 기준을 바꿀 수 없습니다. 올라간 점수를 믿을 수 있는 이유입니다.",
        after: "채점 기준을 결정하면 AI는 실행 내내 그 기준을 바꿀 수 없습니다.\n올라간 점수를 믿을 수 있는 이유입니다.",
      },
      {
        place: "인수인계 상단 단계",
        before: "점검·승인 → 잠금 → 실행",
        after: "사전 점검·승인 → 기준 확정 → 실행",
        kind: "badge",
      },
      {
        place: "시간표 상단 단계",
        before: "기준 승인 → 잠금 → 실행",
        after: "평가 구성 승인 → 기준 확정 → 실행",
        kind: "badge",
      },
      {
        place: "안내 1 · 입력 설명",
        before: "맡길 일을 설명하고 실제로 받았던 질문과 답을 넣습니다. 분량과 채점 모델도 여기서 정합니다.",
        after: "맡길 일, 실제 질문과 답, 분량, 사용할 AI 모델을 정합니다.",
      },
      {
        place: "안내 2 · 평가 기준",
        before: "2 — 채점표\n그 목표가 그대로 채점표가 됩니다\n적은 내용이 기준과 가중치, 반드시 지켜야 할 조건으로 정리됩니다. 사람이 읽을 수 있는 형태입니다.",
        after: "2 — 평가 기준\n평가 기준과 필수 조건을 정리합니다\n입력한 목표를 평가 항목과 가중치, 반드시 지킬 조건으로 정리합니다.",
      },
      {
        place: "안내 3 · 사전 점검",
        before: "3 — 점검·승인\n채점할 AI가 제대로 채점하는지 먼저 시험합니다\n순서를 바꿔도 같은 판정을 내리는지, 없는 내용을 지어내지 않는지 확인합니다. 통과해야 승인할 수 있습니다.",
        after: "3 — 사전 점검\n선택한 AI의 평가를 먼저 점검합니다\n재채점 결과가 안정적인지, 꾸며낸 답을 가려내는지 확인합니다.",
      },
      {
        place: "안내 4 · 기준 확정",
        before: "4 — 잠금\n승인하는 순간 채점표가 잠깁니다\n기준과 조건, 채점 모델까지 함께 잠깁니다. 실행이 끝날 때까지 AI도 사람도 바꾸지 못합니다.",
        after: "4 — 기준 확정\n승인한 평가 구성을 그대로 사용합니다\n실행하는 동안 평가 기준, 필수 조건, 사용할 AI 모델은 바뀌지 않습니다.",
      },
      {
        place: "안내 5 · 실행과 결과",
        before: "5 — 실행·결과\n회차마다 같은 채점표로 재고, 점수가 실제로 오른 것만 남깁니다. 일부 질문은 개선에 쓰지 않고 시작과 끝에만 따로 채점합니다.",
        after: "5 — 실행·결과\n같은 방법으로 채점해 점수가 오른 개선안만 남깁니다. 최종 확인 질문은 시작과 끝에만 채점합니다.",
      },
      {
        place: "안내 그림 · AI 선택",
        before: "채점 모델 선택 / 채점 모델",
        after: "AI 모델 선택 / 사용할 AI 모델",
        kind: "badge",
      },
      {
        place: "안내 그림 · 최종 확인",
        before: "개선에 쓰지 않은 질문으로 시작과 끝을 따로 잽니다",
        after: "최종 확인 질문으로 시작과 끝을 채점합니다",
      },
    ],
  },
  {
    title: "입력 화면과 템플릿 안내",
    note: "WizardPage · WizardBlueprint · templates",
    changes: [
      {
        place: "질문·답변 사례 도움말",
        before: "한 줄씩 넣으면 됩니다. 4~30개를 넣을 수 있고, 질문은 자동으로 세 묶음으로 나뉩니다 — 고치는 데 쓰는 질문, 중간 점검 질문(한쪽으로 치우치지 않게), 숨긴 질문(시작과 끝에만 채점).",
        after: "한 줄씩 4~30개 입력하세요. 질문은 개선·중간 점검·최종 확인에 나누어 씁니다. 최종 확인 질문은 시작과 끝에만 채점합니다.",
      },
      {
        place: "다음 단계 버튼",
        before: "채점 모델 고르기",
        after: "분량 정하러 가기",
        kind: "button",
      },
      {
        place: "분량 단계 · 다음 버튼",
        before: "간결성 설정으로",
        after: "간결성과 AI 모델 정하기",
        kind: "button",
      },
      {
        place: "간결성 설정 질문과 설명",
        before: "분량을 아껴 쓰면 가점을 줄까요?\n켜면 커버리지 80% + 간결성 20%로 채점합니다. 같은 커버리지면 짧은 문서가 더 높은 점수를 받고, 끄면 케이스 답변력 100%로만 채점합니다.",
        after: "문서 길이를 점수에 반영할까요?\n사용: 답변 가능성 80% + 간결성 20%. 답변 수준이 같으면 더 짧은 문서가 높은 점수를 받습니다.\n사용 안 함: 문서 길이는 점수에 반영하지 않습니다.",
      },
      {
        place: "분량 제한 도움말",
        before: "이 분량을 넘는 문서는 실격 처리됩니다. 기록 전체가 상한 안에 들어갈 만큼 넉넉하면 베끼기 방어(분량 게이트)가 약해집니다.",
        after: "이 분량을 넘는 문서는 점수 비교에서 제외됩니다. 기록 전체가 상한 안에 들어갈 만큼 넉넉하면 필수 분량 조건만으로 베끼기를 막기 어려워집니다.",
      },
      {
        place: "채점 대상 선택 제목",
        before: "무엇으로 채점할까요?",
        after: "사용할 AI 모델 선택",
        kind: "title",
      },
      {
        place: "사용할 AI 모델 선택 설명",
        before: "고른 모델은 판정 절차와 함께 잠깁니다. 바꾸려면 다시 승인해야 합니다.",
        after: "선택한 AI가 결과물을 만들고 평가합니다. 모델을 변경하면 다시 승인해야 합니다.",
      },
      {
        place: "평가 미리보기 제목",
        before: "이렇게 채점됩니다",
        after: "평가 구성 미리보기",
        kind: "title",
      },
      {
        place: "평가 미리보기 · 답변 가능성 상세",
        before: "문서만 보고 실제 질문에 답할 수 있는가 (질문 3개로 실제 확인)",
        after: "답변 가능성 · i 도움말: 문서만 보고 실제 질문 3개에 답할 수 있는지 확인",
      },
      {
        place: "평가 미리보기 · 간결성 상세",
        before: "간결성 (분량 상한 8,000자 대비 여유 — 답변력이 0이면 0점)",
        after: "간결성 · i 도움말: 분량 상한 8,000자 대비 여유 — 답변력이 0이면 0점",
      },
      {
        place: "평가 미리보기 · 필수 조건 결과",
        before: "미충족 시 탈락",
        after: "위반 시 제외",
        kind: "badge",
      },
      {
        place: "평가 미리보기 · 사례 구분",
        before: "중간 점검 질문 · 숨긴 질문",
        after: "중간 점검 · 최종 확인",
        kind: "title",
      },
      {
        place: "평가 미리보기 · 사용할 AI 모델",
        before: "채점 모델",
        after: "사용할 AI 모델 / 결과물 생성과 평가에 함께 사용합니다.",
        kind: "title",
      },
      {
        place: "평가 미리보기 · 승인 안내",
        before: "이 기준은 다음 단계에서 당신이 직접 승인합니다.",
        after: "삭제 — 상단 진행 단계와 승인 화면에서 이미 안내",
      },
      {
        place: "평가 미리보기 · 아직 정하지 않은 항목",
        before: "질문과 답만 입력해도 분량, 질문 사용 구분, 채점 모델을 기본값으로 표시",
        after: "현재 단계까지 정한 항목만 표시하고, 나머지는 해당 설정 단계나 승인 화면에서 표시",
      },
      {
        place: "인수인계 · 채택 조건 안내",
        before: "미적용 — 중간 점검 점수가 떨어지지 않고 합계 점수가 이전보다 확실히 오를 때만 채택합니다.",
        after: "개선안 채택 조건: 필수 조건과 중간 점검을 통과하고, 종합 점수가 현재 결과보다 높아야 합니다.",
      },
      {
        place: "인수인계 · 질문 사용 구분",
        before: "질문을 고치는 데 쓰는 질문 · 중간 점검 · 숨긴 질문으로 나눕니다. 중간 점검은 합계 점수가 떨어지지 않았는지 볼 때만 쓰이고, 숨긴 질문은 시작과 끝에만 채점합니다.",
        after: "질문을 세 가지 용도로 나눕니다.\n개선용: 평가 결과를 다음 개선에 반영합니다.\n중간 점검용: 매 회차 평가하되 합계 점수만 새 개선안의 채택 판단에 사용합니다.\n최종 확인용: 개선에는 사용하지 않고 시작과 끝에서만 평가합니다.",
      },
      {
        place: "인수인계 · 분량 설정 알림",
        before: "정답을 통째로 옮겨 적는 문서를 분량 게이트가 걸러내지 못하는 설정입니다. 결과에서는 숨김 케이스 점수를 함께 확인하세요.",
        after: "정답을 통째로 옮겨 적는 문서를 필수 분량 조건으로 걸러내지 못하는 설정입니다. 결과에서는 최종 확인 점수를 함께 확인하세요.",
      },
      {
        place: "시간표 · AI 평가 점검 제외 사유",
        before: "해당 없음 — 결정적 채점 전용",
        after: "해당 없음 — AI 판단 없이 규칙 기반 채점",
      },
      {
        place: "시간표 · 최종 확인 제외 사유",
        before: "해당 없음 — 이 개발용 템플릿에는 숨긴 질문이 없습니다",
        after: "해당 없음 — 이 개발용 템플릿에는 최종 확인용 평가 사례가 없습니다",
      },
    ],
  },
  {
    title: "승인과 사전 점검 화면",
    note: "ApprovalPage · SealPanel · examiner",
    changes: [
      {
        place: "승인 화면 제목과 설명",
        before: "채점 기준 승인\n채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.",
        after: "평가 구성 승인\nAI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다.",
        kind: "title",
      },
      {
        place: "안정성 점검 항목",
        before: "같은 답에 같은 점수인가\n같은 문서를 다시 채점해도 흔들리지 않는지",
        after: "재채점 결과가 안정적인가\n같은 문서의 점수 차이가 허용 범위 안인지",
      },
      {
        place: "꾸며낸 답 점검 항목",
        before: "꼼수에 속지 않는가\n날조·아첨 응답을 정답으로 치지 않는지",
        after: "꾸며낸 답을 가려내는가\n사실을 꾸미거나 칭찬만 하는 답을 구분하는지",
      },
      {
        place: "점검 대기 상태",
        before: "시험하는 중 / 대기",
        after: "점검 중 / 점검 시작 전",
        kind: "badge",
      },
      {
        place: "적용·제외 항목 라벨",
        before: "검증 리포트 / 두 개씩 맞대어 비교",
        after: "AI 평가 사전 점검 / 두 결과 직접 비교",
      },
      {
        place: "AI 작업 상태",
        before: "채점 기준을 시험하는 중",
        after: "선택한 AI의 평가를 사전 점검하는 중",
        kind: "badge",
      },
      {
        place: "연결 후 재점검 버튼",
        before: "연결 확인 후 다시 검증",
        after: "연결 확인 후 다시 점검",
        kind: "button",
      },
      {
        place: "재점검 버튼",
        before: "다시 검증",
        after: "다시 점검",
        kind: "button",
      },
      {
        place: "승인 완료 상세 열기",
        before: "승인한 기준 자세히 보기",
        after: "승인 내용 보기",
        kind: "button",
      },
      {
        place: "모의 모델 표시",
        before: "사용할 AI 모델: 모의 · 모의 모델",
        after: "사용할 AI 모델: 모의 모델",
      },
      {
        place: "분량 상한 안내",
        before: "기록 전체(약 409자)가 분량 상한 8,000자 안에 들어갑니다 — 정답을 통째로 옮겨 적는 문서를 필수 분량 조건으로 걸러내지 못하는 설정입니다. 상한을 낮추면 베끼기 방어가 살아나며, 결과에서는 최종 확인 점수를 함께 확인하세요.",
        after: "질문·답 전체(약 409자)를 그대로 옮겨도 8,000자 제한을 넘지 않습니다.\n이를 막으려면 분량 상한을 낮추세요. 그대로 두려면 최종 확인 점수를 확인하세요.",
      },
      {
        place: "필수 조건 제목과 상태",
        before: "반드시 지켜야 할 조건 / 미충족 시 탈락",
        after: "필수 조건 / 위반 시 제외",
      },
      {
        place: "필수 조건 없음",
        before: "이 평가에는 반드시 지켜야 할 조건이 없습니다.",
        after: "설정된 필수 조건이 없습니다.",
      },
      {
        place: "채점 주체와 비교 방식",
        before: "채점 모델 / 두 개씩 맞대어 비교",
        after: "사용할 AI 모델 / 두 결과 직접 비교",
      },
      {
        place: "적용·제외 항목 제목",
        before: "검증·면제 표기",
        after: "적용·제외 항목",
        kind: "title",
      },
      {
        place: "질문 사용 구분 제목과 설명",
        before: "질문 나누기\n중간 점검 질문 2개(점수가 ±25점까지 떨어지는 것은 허용) · 숨긴 질문 1개",
        after: "질문 사용 구분\n개선용 3개 · 중간 점검용 2개 · 최종 확인용 1개 ⓘ",
      },
      {
        place: "질문 출처",
        before: "케이스 출처\n확인한 AI 초안도 채점 기준이 되어 잠겼습니다.",
        after: "질문 출처\n확인한 AI 초안은 평가 구성에 포함됩니다.",
      },
      {
        place: "사전 점검 제목",
        before: "채점 모델 점검",
        after: "AI 평가 사전 점검",
        kind: "title",
      },
      {
        place: "사전 점검 안내",
        before: "승인하기 전에 채점 모델이 믿을 만한지 확인합니다. 같은 글을 다시 채점해도 같은 점수가 나오는지, 그럴듯하게 꾸며낸 답이나 칭찬만 늘어놓은 답에 속지 않는지 봅니다. 기준을 고치면 자동으로 다시 확인합니다.",
        after: "재채점 결과가 안정적인지, 꾸며낸 답을 가려내는지 확인합니다. 기준을 바꾸면 다시 점검합니다.",
      },
      {
        place: "점검에 사용한 AI",
        before: "점검에 쓴 모델",
        after: "점검에 사용한 AI 모델",
      },
      {
        place: "점검 기록 없음",
        before: "지금 기준에 대한 점검 기록이 없습니다.",
        after: "현재 평가 구성의 점검 기록이 없습니다.",
      },
      {
        place: "사전 점검 실패",
        before: "점검을 통과하지 못한 기준은 잠글 수 없습니다 — 기준을 수정하면 자동으로 다시 검증됩니다.",
        after: "사전 점검 실패 — 기준을 수정하면 다시 점검합니다.",
        kind: "error",
      },
      {
        place: "점검 실행 상태",
        before: "검증 중… / 다시 검증",
        after: "점검 중… / 다시 점검",
        kind: "button",
      },
      {
        place: "승인과 수정 버튼",
        before: "승인하고 잠그기 / 수정하러 가기",
        after: "평가 구성 승인 / 입력 수정",
        kind: "button",
      },
      {
        place: "사전 점검 기록 빈 상태",
        before: "검증을 실행하면 AI가 만든 문서와 판정 사유가 여기에 흐릅니다.",
        after: "사전 점검 결과가 여기에 표시됩니다.",
      },
      {
        place: "승인 완료 제목",
        before: "승인 완료 · 잠김",
        after: "기준 확정",
        kind: "title",
      },
      {
        place: "승인 완료 설명",
        before: "잠긴 기준은 여기서 고칠 수 없습니다. 바꾸려면 처음부터 새 기준을 만들어 다시 승인해야 합니다.",
        after: "AI가 결과물을 만들고 평가하는 동안 평가 구성은 바뀌지 않습니다.\n변경하려면 다시 승인하세요.",
      },
      {
        place: "평가 구성 식별값",
        before: "기준 지문",
        after: "확인 코드",
        kind: "badge",
      },
      {
        place: "사전 점검 실패 메시지",
        before: "재채점마다 점수가 크게 흔들립니다 — 이 저지 모델은 신뢰하기 어렵습니다.",
        after: "재채점마다 점수가 크게 흔들립니다 — 선택한 AI 모델의 평가를 신뢰하기 어렵습니다.",
        kind: "error",
      },
      {
        place: "사전 점검 진행 메시지",
        before: "날조·아첨 오염 응답으로 채점 모델을 찔러보는 중…",
        after: "선택한 AI가 꾸며낸 답이나 칭찬만 하는 답을 가려내는지 확인하는 중…",
      },
    ],
  },
  {
    title: "실행 화면과 개선안 기록",
    note: "ConsolePage · ActivityConsole · ExperimentTree",
    changes: [
      {
        place: "실행 화면 제목",
        before: "관제실",
        after: "실행",
        kind: "title",
      },
      {
        place: "실행 상태",
        before: "실행 중",
        after: "개선 중…",
        kind: "badge",
      },
      {
        place: "실행 제어 버튼",
        before: "개선 시작 / 개선 일시정지 / 개선 재개",
        after: "시작 / 일시정지 / 재개",
        kind: "button",
      },
      {
        place: "실행 화면 설명과 상태 배지",
        before: "채점 기준은 당신이 승인했고, 실행 중 AI는 이 기준을 변경할 수 없습니다. / 기준 잠김",
        after: "AI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다. / 평가 구성 적용 중",
      },
      {
        place: "생성·평가 작업 상태",
        before: "산출물을 만들고 채점하는 중",
        after: "결과물을 만들고 평가하는 중",
        kind: "badge",
      },
      {
        place: "실행 전 승인 안내",
        before: "실행 전에 채점 기준을 확인하고 승인해야 합니다. 승인된 기준만이 실행에 쓰이며, 실행 중에는 변경되지 않습니다.",
        after: "실행하기 전에 채점 기준을 확인하고 승인해야 합니다. 승인된 기준만 사용하며, 실행 중에는 바뀌지 않습니다.",
      },
      {
        place: "AI 작업 기록 제목",
        before: "추론 실황",
        after: "AI 작업 기록",
        kind: "title",
      },
      {
        place: "개선안 비교 빈 상태",
        before: "기록된 라운드 판정이 없습니다.",
        after: "기록된 개선안 비교 결과가 없습니다.",
      },
      {
        place: "개선안 비교 도움말",
        before: "후보 81점 vs 챔피언 79점",
        after: "개선안 81점 · 현재 결과 79점",
      },
      {
        place: "개선안 비교 상태",
        before: "더 나아서 채택 / 필수 조건을 못 지켜 탈락 / 중간 점검이 떨어져 기각 / 지금 것이 더 나음",
        after: "개선안 채택 / 필수 조건 위반 / 중간 점검 점수 기준 미달 / 점수 개선 없음",
        kind: "badge",
      },
      {
        place: "필수 조건 위반 상세",
        before: "반드시 지켜야 할 조건을 못 지켜 점수와 무관하게 탈락했습니다.",
        after: "새 개선안이 필수 조건을 지키지 않아 점수를 비교하지 않고 제외했습니다.",
      },
      {
        place: "중간 점검 기준 미달 상세",
        before: "점수는 86점이지만 눈에 보이는 질문에만 맞춰 쓴 것으로 보아 기각합니다. 중간 점검은 61점으로 허용 오차를 넘어 떨어졌습니다.",
        after: "새 개선안의 중간 점검 점수 61점이 허용 범위보다 낮아 현재 결과물을 유지했습니다.",
      },
      {
        place: "개선안 채택 상세",
        before: "새 산출물 86점이 기존 80점보다 6점 높아 바꿔 답았습니다.",
        after: "새 개선안의 종합 점수 86점이 현재 결과물보다 6점 높아 채택했습니다.",
      },
      {
        place: "점수 개선 없음 상세",
        before: "새 산출물 80점이 기존 80점을 넘지 못해 기존을 유지합니다 — 동점도 바꾸지 않습니다.",
        after: "새 개선안의 종합 점수 80점이 현재 결과물의 80점보다 높지 않아 현재 결과물을 유지했습니다. 동점도 바꾸지 않습니다.",
      },
      {
        place: "채택 결정 기록 제목",
        before: "3회차 판단 — 지금 것이 더 나음",
        after: "3회차 채택 결정 — 점수 개선 없음",
      },
      {
        place: "중간 점검 점수 도움말",
        before: "중간 점검 질문 점수 — 이 점수가 떨어지는 후보는 채택되지 않습니다",
        after: "개선안이 기존 결과보다 크게 나빠지지 않았는지 확인한 점수입니다.",
      },
      {
        place: "최종 확인 점수",
        before: "숨긴 질문(시작): 70점 / 숨긴 질문(종료): 분량 조건을 못 지켜 탈락 — 점수 없음",
        after: "최종 확인(시작): 70점 / 최종 확인(종료): 필수 조건 위반 — 점수 없음",
      },
      {
        place: "최종 확인 오류",
        before: "시작할 때 숨긴 질문 채점 오류 / 끝날 때 숨긴 질문 채점 오류",
        after: "시작할 때 최종 확인 채점 오류 / 끝날 때 최종 확인 채점 오류",
        kind: "error",
      },
      {
        place: "AI 요청 한도",
        before: "라운드당 약 5회 모델 호출 · 최대 8라운드 · 실행 1회 호출 예산 40회",
        after: "회차당 AI 요청 약 5회 · 최대 8회 개선 · 실행 1회 AI 요청 한도 40회",
      },
      {
        place: "최종 확인 진행 버튼",
        before: "숨긴 질문 채점 중…",
        after: "최종 확인 채점 중…",
        kind: "button",
      },
      {
        place: "오류 뒤 재개 안내",
        before: "지금까지의 진행은 체크포인트에 저장되어 있습니다 — 다시 시도하면 이어서 진행됩니다.",
        after: "진행 상태가 저장되었습니다. 다시 시도하면 이어집니다.",
      },
      {
        place: "저장된 상태 불일치",
        before: "체크포인트의 판정 절차가 현재 승인본과 다릅니다 — 이어받을 수 없습니다(재승인 필요).",
        after: "저장된 진행 상태의 평가 구성이 현재 승인본과 다릅니다. 다시 승인해야 이어갈 수 있습니다.",
        kind: "error",
      },
      {
        place: "AI 모델 연결 제목",
        before: "채점 모델 자격 증명",
        after: "AI 모델 연결 정보",
        kind: "title",
      },
      {
        place: "평가 구성 재설정 버튼",
        before: "기준 다시 만들기",
        after: "평가 구성 다시 설정",
        kind: "button",
      },
      {
        place: "연결 정보 없음 안내",
        before: "자격 증명 없이 사용하려면 기준을 처음부터 다시 만들어 모의 모델로 승인해 주세요 — 승인된 판정 절차는 여기서 바꿀 수 없습니다.",
        after: "연결 정보가 없으면 모의 모델로 평가 구성을 다시 승인하세요. 승인된 평가 구성은 여기서 바꿀 수 없습니다.",
      },
    ],
  },
  {
    title: "결과 화면과 저장 안내",
    note: "ResultsPage",
    changes: [
      {
        place: "실행 기록 종류",
        before: "라운드",
        after: "개선 회차",
        kind: "badge",
      },
      {
        place: "최종 확인 필수 조건 위반",
        before: "분량 게이트 실격 — 점수 미계산",
        after: "필수 조건 위반 — 점수 없음",
        kind: "badge",
      },
      {
        place: "개선 횟수",
        before: "총 5라운드",
        after: "총 5회 개선",
      },
      {
        place: "결과 화면 상단 설명",
        before: "승인한 기준으로 매긴 점수입니다. 점수를 먼저 확인한 뒤 결과물을 받으세요.",
        after: "삭제 — 점수 카드와 결과물 제목에서 이미 드러남",
      },
      {
        place: "최고 점수 안내",
        before: "반드시 지켜야 할 조건이 실제로 걸리는지 살펴보세요. 숨긴 질문 점수와 차이가 크다면 좋은 단서입니다.",
        after: "필수 조건이 실제로 걸리는지 살펴보세요. 최종 확인 점수와 차이가 크다면 좋은 단서입니다.",
      },
      {
        place: "서버 저장 범위",
        before: "입력한 내용, 승인한 기준과 점검 근거, 실행 결과와 숨긴 질문 점수가 하나의 JSON 파일로 서버에 저장됩니다.",
        after: "`저장되는 내용`을 열었을 때만 입력 내용, 평가 구성, 실행 결과와 최종 확인 점수의 저장 범위를 표시",
      },
      {
        place: "저장 대기 안내",
        before: "숨긴 질문 채점이 끝난 뒤에 기록할 수 있습니다.",
        after: "최종 확인 채점이 끝난 뒤에 기록할 수 있습니다.",
      },
      {
        place: "중간 점검 결과 카드",
        before: "중간 점검 질문 — 시작 78점 → 종료 82점",
        after: "중간 점검 — 시작 78점 → 종료 82점 · 작동 설명은 i 도움말",
        kind: "title",
      },
      {
        place: "최종 확인 결과 카드",
        before: "루프에 숨긴 검증 케이스에서 — 시작 70점 → 종료 86점",
        after: "최종 확인 — 시작 70점 → 종료 86점 · 작동 방식과 반복·신규 구분은 i 도움말",
        kind: "title",
      },
      {
        place: "최종 확인 설명",
        before: "숨긴 질문의 채점 결과는 고치는 동안 한 번도 쓰이지 않았습니다 — 시작할 때와 종료 시에만 측정한 참고 지표입니다.",
        after: "최종 확인용 질문의 채점 결과는 개선 과정에 한 번도 쓰이지 않았습니다 — 시작할 때와 종료 시에만 측정한 참고 지표입니다.",
      },
      {
        place: "최종 확인 표 제목",
        before: "숨긴 질문",
        after: "최종 확인용 질문",
        kind: "title",
      },
      {
        place: "겹치는 질문 설명",
        before: "반복은 같은 질문이 가시 세트에도 등장했음을, 신규는 질문 문면이 가시 세트에 없었음을 뜻합니다.",
        after: "반복은 같은 질문이 개선에 사용하는 질문에도 등장했음을, 신규는 질문 문면이 개선에 사용하는 질문에 없었음을 뜻합니다.",
      },
      {
        place: "보호 규칙 제목",
        before: "활성 방어 세트",
        after: "접힌 `평가 및 기록 상세` 안의 `적용된 보호 규칙`",
        kind: "title",
      },
      {
        place: "전체 실행 기록",
        before: "결과 화면에 `기록` 카드로 항상 표시",
        after: "접힌 `평가 및 기록 상세`를 열었을 때 표시",
      },
      {
        place: "규칙 기반 채점 배지",
        before: "결정적 채점 전용 / 검증 리포트: 해당 없음(특례) / 숨긴 질문: 없음",
        after: "규칙 기반 채점 / 사전 점검: 해당 없음 / 최종 확인: 사용 안 함",
        kind: "badge",
      },
      {
        place: "AI 채점 배지",
        before: "케이스 실측 채점(저지: model) / 채택 기준: 점수가 오르고, 중간 점검도 떨어지지 않을 때",
        after: "평가 사례 채점 · model / 채택: 점수 상승 + 중간 점검 통과",
        kind: "badge",
      },
      {
        place: "사례 구분과 사전 점검 배지",
        before: "중간 점검 2개 · 숨긴 질문 1개 / 검증 리포트: 통과",
        after: "중간 점검 2개 · 최종 확인 1개 / 사전 점검: 통과",
        kind: "badge",
      },
      {
        place: "사례 출처 배지",
        before: "케이스 출처: AI 초안 8/12 / 케이스 전부 직접 입력",
        after: "평가 사례: AI 초안 8/12 / 평가 사례 전부 직접 입력",
        kind: "badge",
      },
      {
        place: "AI 초안 배지 도움말",
        before: "확인한 초안은 승인할 때 함께 잠깁니다",
        after: "확인한 초안은 승인한 평가 구성에 포함됩니다",
      },
    ],
  },
  {
    title: "연결·복원·실행 오류",
    note: "templates · project export/snapshot",
    changes: [
      {
        place: "승인한 AI 연결 정보 없음",
        before: "승인된 채점 모델의 키가 없습니다 — 키를 입력하거나, 기준을 다시 만들어 모의 모델로 승인하세요.",
        after: "승인된 AI 모델의 연결 정보가 없습니다 — 연결 정보를 입력하거나, 평가 구성을 다시 만들어 모의 모델로 승인하세요.",
        kind: "error",
      },
      {
        place: "AI 모델 준비 실패",
        before: "채점 모델이 준비되지 않았습니다 — 키를 입력하거나 모의 모델을 선택하세요.",
        after: "AI 모델이 준비되지 않았습니다 — 연결 정보를 입력하거나 모의 모델을 선택하세요.",
        kind: "error",
      },
      {
        place: "승인한 AI 사용 불가",
        before: "승인된 채점 모델을 사용할 수 없습니다 — 기준을 다시 만들어 승인해 주세요.",
        after: "승인된 AI 모델을 사용할 수 없습니다 — 평가 구성을 다시 만들어 승인해 주세요.",
        kind: "error",
      },
      {
        place: "전체 기록 저장 전 오류",
        before: "숨긴 질문 채점이 아직 끝나지 않았습니다.",
        after: "최종 확인 채점이 아직 끝나지 않았습니다.",
        kind: "error",
      },
      {
        place: "저장 기록 복원 오류",
        before: "저장된 기록에 시작할 때의 숨긴 질문 결과가 없어 복원할 수 없습니다.",
        after: "저장된 기록에 시작할 때의 최종 확인 결과가 없어 복원할 수 없습니다.",
        kind: "error",
      },
    ],
  },
];

function MiniSteps({ labels }: { labels: string[] }) {
  return (
    <ol className="compare-mini-steps" aria-label="상단 단계 표시 예시">
      {labels.map((label, index) => (
        <li key={label} className={index === 2 ? "is-current" : ""}>
          <span>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function CompareColumn({ copy }: { copy: CompareCopy }) {
  return (
    <article className="compare-column">
      <header className="compare-column-head">
        <h2>{copy.columnTitle}</h2>
        <p>{copy.columnNote}</p>
      </header>

      <section className="compare-screen">
        <span className="compare-screen-label">상단 단계</span>
        <MiniSteps labels={copy.steps} />
      </section>

      <section className="compare-screen">
        <span className="compare-screen-label">입력 중 평가 미리보기</span>
        <div className="card blueprint compare-card">
          <h2>{copy.blueprintTitle}</h2>
          {copy.criteria.map((criterion, index) => (
            <div className="bp-row" key={criterion.title}>
              <span className="bp-ic">{index + 1}</span>
              <div className="bp-body">
                <b>
                  {criterion.title}
                  {criterion.help ? (
                    <InfoTip label={criterion.title} text={criterion.help} />
                  ) : null}
                </b>
                <p>가중치 {criterion.weight}%</p>
              </div>
            </div>
          ))}
          {copy.showPreviewGate ? (
            <div className="bp-row is-gate">
              <span className="bp-ic">!</span>
              <div className="bp-body"><b>8,000자 이하</b><p>{copy.gateState}</p></div>
            </div>
          ) : null}
          {copy.showPreviewQuestionUse ? <div className="bp-row is-seal">
            <span className="bp-ic">?</span>
            <div className="bp-body">
              <b>{copy.caseGroups}</b>
              <p>
                {copy.splitDetail}
                <InfoTip label="질문 사용 구분" text={copy.caseGroupHelp} />
              </p>
            </div>
          </div> : null}
          {copy.showPreviewJudge ? <div className="bp-row">
            <span className="bp-ic">＊</span>
            <div className="bp-body"><b>{copy.judge}</b><p>OpenAI · model</p></div>
          </div> : null}
        </div>
      </section>

      <section className="compare-screen">
        <span className="compare-screen-label">승인 화면</span>
        <h1>{copy.approvalTitle}</h1>
        <p className="sub">{copy.approvalSub}</p>
        <div className="card compare-card">
          <h2>채점 기준</h2>
          <p>답변 가능성 80% · 간결성 20%</p>
          <h2>{copy.requiredTitle}</h2>
          <p>8,000자 이하 <span className="badge muted">{copy.requiredState}</span></p>
          <h2>{copy.splitTitle}</h2>
          <p>
            {copy.splitDetail}
            <InfoTip label="질문 사용 구분" text={copy.caseGroupHelp} />
          </p>
          <h2>{copy.checkTitle}</h2>
          <span className="badge">{copy.checkState}</span>
          <div className="compare-actions"><button className="primary">{copy.approveButton}</button></div>
        </div>
      </section>

      <section className="compare-screen compare-seal">
        <span className="compare-screen-label">승인 완료</span>
        <div className="seal-lock is-shut compare-lock" aria-hidden="true">✓</div>
        <h2 className="seal-title">{copy.sealTitle}</h2>
        <p className="seal-sub copy-lines">{copy.sealSub}</p>
        <div className="seal-fp"><span className="hint">{copy.codeLabel}</span><code>3f9c2ab41d7e0c86…</code></div>
      </section>

      <section className="compare-screen">
        <span className="compare-screen-label">실행 화면</span>
        <h1>{copy.consoleTitle}</h1>
        <p className="sub">{copy.consoleSub} <span className="lock-badge">{copy.lockBadge}</span></p>
        <div className="card compare-card">
          <span className="badge">{copy.runState}</span>{" "}
          <span className="badge">{copy.guardBadge}</span>
          <p className="hint">{copy.guardHelp}</p>
          <p className="hint">{copy.callBudget}</p>
        </div>
        <div className="stream compare-stream">
          <div className="stream-top"><span className="stream-name">{copy.streamTitle}</span></div>
          <div className="stream-body"><span className="stream-empty">{copy.emptyRounds}</span></div>
        </div>
        <p className="hint">{copy.savedProgress}</p>
      </section>

      <section className="compare-screen">
        <span className="compare-screen-label">결과 화면</span>
        <div className="card compare-card">
          <strong>처음 64점 → 고친 뒤 86점</strong>
          <p className="hint">{copy.totalRounds}</p>
        </div>
        <div className="card compare-card"><strong>{copy.guardResult}</strong></div>
        <div className="card compare-card"><strong>{copy.holdoutResult}</strong></div>
        <h2>{copy.protectionTitle}</h2>
        <div className="card compare-card compare-badges">
          <span className="badge">{copy.scoringBadge}</span>
          <span className="badge">{copy.adoptionBadge}</span>
          <span className="badge">{copy.splitBadge}</span>
          <span className="badge">{copy.reportBadge}</span>
        </div>
      </section>
    </article>
  );
}

function AuditValue({ value, kind = "text" }: { value: string; kind?: AuditKind }) {
  if (kind === "badge") return <span className="badge compare-audit-value">{value}</span>;
  if (kind === "button") return <button className="compare-audit-button" disabled>{value}</button>;
  if (kind === "error") return <p className="error compare-audit-value">{value}</p>;
  if (kind === "title") return <strong className="compare-audit-value">{value}</strong>;
  return <p className="compare-audit-value">{value}</p>;
}

function FullCopyAudit() {
  const total = AUDIT_GROUPS.reduce((sum, group) => sum + group.changes.length, 0);

  return (
    <section className="compare-audit">
      <div className="compare-audit-head">
        <span className="eyebrow">전체 변경 문구</span>
        <h2>사용자에게 보이는 변경 {total}곳</h2>
        <p className="sub">
          현재 작업 트리의 사용자 노출 문구 변경을 화면 위치별로 대조했습니다. 같은 문구가 한
          화면에서 반복되는 경우에는 한 행으로 묶었고, 테스트 코드와 개발용 비교 링크 자체는
          제외했습니다.
        </p>
      </div>

      {AUDIT_GROUPS.map((group) => (
        <details className="compare-audit-group" key={group.title} open>
          <summary>
            <span>{group.title}</span>
            <small>{group.note} · {group.changes.length}곳</small>
          </summary>
          <div className="compare-audit-table">
            <div className="compare-audit-table-head" aria-hidden="true">
              <span>화면 위치</span>
              <span>기존 문구</span>
              <span>통일안 적용</span>
            </div>
            {group.changes.map((change) => (
              <div className="compare-audit-row" key={change.place}>
                <div className="compare-audit-place">{change.place}</div>
                <div className="compare-audit-cell" data-label="기존 문구">
                  <AuditValue value={change.before} kind={change.kind} />
                </div>
                <div className="compare-audit-cell is-after" data-label="통일안 적용">
                  <AuditValue value={change.after} kind={change.kind} />
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

export function TerminologyComparePage() {
  useEffect(() => setFlowStep({ kind: "outside" }), []);

  return (
    <div className="compare-page">
      <div className="compare-page-head">
        <span className="eyebrow">개발용 비교 화면</span>
        <h1>기존 문구와 통일안 직접 비교</h1>
        <p className="sub">
          실제 기능은 실행하지 않는 화면 껍데기입니다. 두 열은 같은 구조이며 문구만 다릅니다.
          홈의 표어와 브랜드 문구는 비교 대상에서 제외했습니다.
        </p>
      </div>
      <div className="compare-grid">
        <CompareColumn copy={BEFORE} />
        <CompareColumn copy={AFTER} />
      </div>
      <FullCopyAudit />
    </div>
  );
}
