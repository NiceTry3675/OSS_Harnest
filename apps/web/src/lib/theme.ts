/** 테마 — 고른 적이 없으면 시스템 설정을 따르고, 한 번 고르면 그 선택이 이긴다.
 *  선택은 이 브라우저(localStorage)에만 남는다.
 *
 *  토글은 지금 보이는 화면의 반대로 바로 넘어간다. 시스템·밝게·어둡게를 순환시키면
 *  시스템이 이미 밝은 화면일 때 첫 클릭이 아무 변화도 만들지 않아 두 번 눌러야 한다. */

export type ThemeChoice = "system" | "light" | "dark";
export type Rendered = "light" | "dark";

const KEY = "harnest.theme";

export function readTheme(): ThemeChoice {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** system이면 data-theme를 지워 prefers-color-scheme에 맡긴다 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function saveTheme(choice: ThemeChoice): void {
  if (choice === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
  applyTheme(choice);
}

/** 지금 화면에 실제로 적용된 테마 — 고른 값이 없으면 시스템 설정을 읽는다 */
export function resolvedTheme(choice: ThemeChoice = readTheme()): Rendered {
  if (choice === "light" || choice === "dark") return choice;
  if (typeof matchMedia !== "function") return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 지금 보이는 화면의 반대 */
export function oppositeTheme(choice: ThemeChoice = readTheme()): Rendered {
  return resolvedTheme(choice) === "dark" ? "light" : "dark";
}

export const THEME_LABEL: Record<Rendered, string> = {
  light: "밝은 화면",
  dark: "어두운 화면",
};

export const THEME_ICON: Record<Rendered, string> = {
  light: "☀",
  dark: "☾",
};
