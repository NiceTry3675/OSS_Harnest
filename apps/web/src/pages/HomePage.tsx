import { useNavigate } from "react-router-dom";
import { TEMPLATE_NAME } from "@harnest/template-timetable";
import { useProject } from "../state";

export function HomePage() {
  const { reset } = useProject();
  const navigate = useNavigate();

  return (
    <div>
      <h1>AI에게 한 번 시키고 끝이 아니라, 당신이 승인한 기준으로 될 때까지 스스로 고치는 AI</h1>
      <p className="sub">채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.</p>

      <h2>템플릿</h2>
      <div className="card" style={{ maxWidth: 440 }}>
        <h2 style={{ margin: "0 0 6px" }}>{TEMPLATE_NAME}</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          근무자 명단과 원칙만 알려주세요. 연속 근무 한도·주당 상한·배정 형평을
          당신이 승인한 기준으로 채점하며, 통과할 때까지 근무표를 스스로 다듬습니다.
        </p>
        <button
          className="primary"
          onClick={() => {
            reset();
            navigate("/wizard");
          }}
        >
          시작하기
        </button>
      </div>
    </div>
  );
}
