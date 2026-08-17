"use client";

import { useState } from "react";

type Theme = "dark" | "light";
const themeStorageKey = "harnest-theme-v2";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const savedTheme = window.localStorage.getItem(themeStorageKey) as Theme | null;
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    return nextTheme;
  });

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(themeStorageKey, nextTheme);
  }

  return (
    <div className="theme-toggle" aria-label="테마 선택">
      <button
        aria-pressed={theme === "dark"}
        className={theme === "dark" ? "active" : ""}
        onClick={() => changeTheme("dark")}
        type="button"
      >
        Dark
      </button>
      <button
        aria-pressed={theme === "light"}
        className={theme === "light" ? "active" : ""}
        onClick={() => changeTheme("light")}
        type="button"
      >
        Light
      </button>
    </div>
  );
}
