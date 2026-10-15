// English: the source of every key. Other languages must have exactly these keys
// (lib/i18n/i18n.test.ts checks, and their files are typed against this one).
import { collect } from "./en/collect";
import { common } from "./en/common";
import { insights } from "./en/insights";
import { ledger } from "./en/ledger";
import { settings } from "./en/settings";
import { share } from "./en/share";
import { shell } from "./en/shell";
import { tab } from "./en/tab";

export const en = { ...common, ...shell, ...ledger, ...collect, ...insights, ...tab, ...settings, ...share } as const;

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;
