/** 테마 — 시스템 설정을 기본으로 쓰되, 사용자가 고르면 그 선택이 이긴다.
 *  선택은 이 브라우저(localStorage)에만 남는다. */

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "harnest.theme";
const ORDER: ThemeChoice[] = ["system", "light", "dark"];

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

export function nextTheme(current: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "시스템 설정을 따름",
  light: "밝은 화면",
  dark: "어두운 화면",
};

export const THEME_ICON: Record<ThemeChoice, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};
