import { useState, useCallback, createContext, useContext } from "react";
import zhCN from "../locales/zh-CN.json";
import enUS from "../locales/en-US.json";

type Locale = "zh-CN" | "en-US";
type Messages = Record<string, string>;

const localeMap: Record<Locale, Messages> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

export const I18nContext = createContext<I18nContextType>({
  locale: "zh-CN",
  setLocale: () => {},
  t: (key) => key,
});

export function useI18nProvider(initialLocale: Locale = "zh-CN") {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return localeMap[locale]?.[key] ?? key;
    },
    [locale]
  );

  return { locale, setLocale, t };
}

export function useLocale() {
  return useContext(I18nContext);
}
