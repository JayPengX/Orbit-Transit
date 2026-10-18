// The reader's language (the kit's: what they picked, else the phone's),
// Chinese first. Under Node (the tests) Chinese, as the app was written.
import { detectLang } from '#kit/quadra.mjs';

export const lang = typeof document === 'undefined' ? 'zh' : detectLang();
export const en = lang === 'en';
// The words in the reader's language: W('今天', 'Today').
export const W = (zh, english) => (en ? english : zh);
