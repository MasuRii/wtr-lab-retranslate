// Ambient userscript-manager globals granted by the userscript metadata
// (see userscript.metadata.cjs). Mirrors the declaration used by sibling
// WTR-Lab userscript repos so `src/` typechecks without external @types.

type GMStorageValue = string | number | boolean | object | null;

declare function GM_getValue<T = GMStorageValue>(key: string, defaultValue: T): T;
declare function GM_setValue(key: string, value: GMStorageValue): void;
declare function GM_registerMenuCommand(name: string, callback: () => void): void;
