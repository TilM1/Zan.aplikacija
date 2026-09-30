/// <reference lib="webworker" />
/**
 * Reads .xlsx / .csv files off the main thread so the page never freezes,
 * even for very large files.
 */
import { readSheet } from "read-excel-file/web-worker";
import Papa from "papaparse";

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const file = e.data.file;
  const lower = file.name.toLowerCase();
  try {
    let sheet: unknown[][];
    if (lower.endsWith(".xlsx")) {
      sheet = (await readSheet(file)) as unknown[][];
    } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      const text = await file.text();
      sheet = Papa.parse<string[]>(text, { skipEmptyLines: true, delimitersToGuess: [";", ",", "\t", "|"] }).data;
    } else {
      throw new Error("unsupported");
    }
    (self as unknown as Worker).postMessage({ ok: true, sheet });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
