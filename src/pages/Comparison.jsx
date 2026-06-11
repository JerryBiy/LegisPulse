import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GitCompare,
  Search,
  X,
  FileText,
  Building2,
  Sparkles,
  Loader2,
  Plus,
  Minus,
  Pencil,
} from "lucide-react";
import { api } from "@/api/apiClient";
import {
  searchGABills,
  fetchBillTextVersionsForAI,
  fetchNewestBillText,
  getGASessions,
  findBillInSession,
  isLegiScanConfigured,
} from "@/services/legiscan";
import { fetchBillVersionsGa } from "@/services/legisGa";

// ── Chamber / LC helpers ─────────────────────────────────────
// Bill numbers look like "HB1020", "SB45", "HR12", "SR3".
function originChamberFromNumber(billNumber) {
  const n = String(billNumber || "").toUpperCase();
  if (n.startsWith("H")) return "House";
  if (n.startsWith("S")) return "Senate";
  return "Unknown";
}

// LC numbers look like "LC 52 2837" (no substitute) or "LC 82 2837RCS"
// where trailing letters mark a substitute + chamber.
const LC_SUFFIX_REGEX = /^\s*LC\s+\d+\s+\d+\s*([A-Z]+)\s*$/i;
function lcSubstituteChamber(lc) {
  const m = String(lc || "").match(LC_SUFFIX_REGEX);
  if (!m) return null;
  const sfx = m[1].toUpperCase();
  if (sfx.includes("H")) return "House";
  if (sfx.includes("S")) return "Senate";
  return null;
}

const safeArr = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

// Attach authoritative legis.ga.gov LC numbers + chamber to LegiScan text
// versions. LegiScan versions arrive newest-first; legis.ga.gov LC versions
// arrive oldest-first. The substantive versions map 1:1, so we align them by
// recency (newest ↔ newest) — robust even if one source is missing an older
// version. Each returned version gains { lc, chamber, versionName }.
function mergeGaLcIntoVersions(legiscanNewestFirst, gaOldestFirst) {
  const gaNewestFirst = [...(gaOldestFirst || [])].reverse();
  return (legiscanNewestFirst || []).map((v, i) => {
    const ga = gaNewestFirst[i];
    return {
      ...v,
      lc: ga?.lc || null,
      chamber: ga?.chamber || null,
      versionName: ga?.name || null,
    };
  });
}

// ── Reusable bill search box ─────────────────────────────────
function BillSearch({ placeholder, sessionId, value, onSelect, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchGABills(q, sessionId, 20);
        setResults(r);
        setOpen(true);
      } catch (err) {
        console.warn("bill search failed", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, sessionId]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{value.bill_number}</p>
          <p className="truncate text-sm text-slate-500">{value.title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => {
            setQuery("");
            onClear?.();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder || "Search by bill number or keyword…"}
          className="pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((b) => (
            <button
              key={b.legiscan_id}
              className="flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
              onClick={() => {
                onSelect(b);
                setOpen(false);
                setQuery("");
              }}
            >
              <span className="font-semibold text-slate-900">
                {b.bill_number}
              </span>
              <span className="line-clamp-2 text-xs text-slate-500">
                {b.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comparison result renderer ───────────────────────────────
function ChamberBadge({ chamber }) {
  if (!chamber || chamber === "Unknown") return null;
  const cls =
    chamber === "House"
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : "bg-purple-100 text-purple-700 border-purple-200";
  return (
    <Badge variant="outline" className={cls}>
      <Building2 className="mr-1 h-3 w-3" />
      {chamber}
    </Badge>
  );
}

function ChangeList({ title, items, icon: Icon, color }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h5
        className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${color}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h5>
      <ul className="list-disc space-y-1 pl-6 text-sm text-slate-800">
        {items.map((it, i) => (
          <li key={`${title}-${i}`}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonResult({ result }) {
  if (!result) return null;
  const { sideA, sideB, ai } = result;
  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GitCompare className="h-5 w-5 text-amber-600" />
          Comparison Result
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Side headers */}
        <div className="grid gap-3 sm:grid-cols-2">
          {[sideA, sideB].map((s, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {idx === 0 ? "Previous / A" : "New / B"}
                </span>
                <ChamberBadge chamber={s.chamber} />
              </div>
              <p className="font-semibold text-slate-900">{s.label}</p>
              {s.lc && <p className="text-xs text-slate-500">LC: {s.lc}</p>}
              {s.date && <p className="text-xs text-slate-500">{s.date}</p>}
            </div>
          ))}
        </div>

        {ai?.chamberNote && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {ai.chamberNote}
          </div>
        )}

        {/* AI change breakdown */}
        <div className="space-y-4">
          <ChangeList
            title="Added"
            items={ai?.added}
            icon={Plus}
            color="text-green-700"
          />
          <ChangeList
            title="Removed"
            items={ai?.removed}
            icon={Minus}
            color="text-red-700"
          />
          <ChangeList
            title="Modified"
            items={ai?.modified}
            icon={Pencil}
            color="text-blue-700"
          />
        </div>

        {ai?.summary && (
          <div className="rounded-lg bg-slate-50 p-4">
            <h5 className="mb-1 text-sm font-semibold text-slate-900">
              Overall Summary
            </h5>
            <p className="whitespace-pre-line text-sm text-slate-700">
              {ai.summary}
            </p>
          </div>
        )}

        {/* Side-by-side raw text */}
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-slate-700">
            View side-by-side text
          </summary>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
            {[sideA, sideB].map((s, idx) => (
              <div key={idx} className="bg-white p-3">
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  {s.label}
                </p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                  {s.text || "No text available."}
                </pre>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ── AI compare core ──────────────────────────────────────────
async function compareTexts(sideA, sideB) {
  const prompt = `You are analyzing differences between two versions of Georgia legislation.

VERSION A (previous / baseline)
  Label: ${sideA.label}
  LC number: ${sideA.lc || "unknown"}
  Originating chamber: ${sideA.chamber || "unknown"}
  Date: ${sideA.date || "unknown"}
  Text:
  ${sideA.text}

VERSION B (new / comparison)
  Label: ${sideB.label}
  LC number: ${sideB.lc || "unknown"}
  Originating chamber: ${sideB.chamber || "unknown"}
  Date: ${sideB.date || "unknown"}
  Text:
  ${sideB.text}

Return ONLY valid JSON with these fields:
{
  "chamber": "House" | "Senate" | "Unknown",
  "chamber_note": "one sentence saying which chamber introduced version B / the change (e.g. 'New substitute introduced in the Senate'). If the two are unrelated bills, briefly state that instead.",
  "added": ["bullet describing something present in B but not A", ...],
  "removed": ["bullet describing something in A but dropped from B", ...],
  "modified": ["bullet describing a substantive modification between A and B", ...],
  "summary": "short paragraph (3-5 sentences) summarizing the overall differences and practical effect"
}

Requirements:
- Each bullet must be one concise sentence in plain, neutral legislative language.
- Do not include policy arguments or opinions.
- If a category has no changes, return an empty array for it.
- Focus on substantive legal changes (definitions, eligibility, penalties, funding, deadlines, agency duties), not formatting or renumbering.
- Be accurate; if the two texts appear identical, say so in "summary" and return empty arrays.`;

  const response = await api.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        chamber: { type: "string" },
        chamber_note: { type: "string" },
        added: { type: "array", items: { type: "string" } },
        removed: { type: "array", items: { type: "string" } },
        modified: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["chamber", "added", "removed", "modified", "summary"],
    },
  });

  return {
    chamber:
      typeof response?.chamber === "string" && response.chamber.trim()
        ? response.chamber.trim()
        : "Unknown",
    chamberNote:
      (typeof response?.chamber_note === "string" &&
        response.chamber_note.trim()) ||
      "",
    added: safeArr(response?.added),
    removed: safeArr(response?.removed),
    modified: safeArr(response?.modified),
    summary:
      (typeof response?.summary === "string" && response.summary.trim()) || "",
  };
}

// Build an LC-number lookup from global LC tracking (best-effort).
async function loadLcMap() {
  try {
    const map = await api.LcTracking.getAll();
    return map || {};
  } catch {
    return {};
  }
}

// ════════════════════════════════════════════════════════════
//  Page
// ════════════════════════════════════════════════════════════
export default function Comparison() {
  const configured = isLegiScanConfigured();
  const [lcMap, setLcMap] = useState({});
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [error, setError] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!configured) return;
    loadLcMap().then(setLcMap);
    getGASessions()
      .then((s) => {
        setSessions(s);
        if (s.length) setCurrentSessionId(s[0].session_id);
      })
      .catch((e) => console.warn("session list failed", e));
  }, [configured]);

  const lcFor = useCallback(
    (billNumber) => {
      const rec = lcMap[String(billNumber || "").toUpperCase()];
      return rec || null;
    },
    [lcMap],
  );

  const runCompare = useCallback(async (sideA, sideB) => {
    setError("");
    setResult(null);
    if (!sideA?.text || !sideB?.text) {
      setError(
        "Could not retrieve text for both versions from LegiScan. One of the documents may not have published text yet.",
      );
      return;
    }
    setIsComparing(true);
    try {
      const ai = await compareTexts(sideA, sideB);
      setResult({ sideA, sideB, ai });
    } catch (e) {
      console.error("comparison failed", e);
      setError(
        e?.message ||
          "Failed to generate the comparison. Check your AI API key and try again.",
      );
    } finally {
      setIsComparing(false);
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="shrink-0 rounded-lg bg-amber-100 p-2 text-amber-700">
          <GitCompare className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">Comparison</h1>
          <p className="text-sm text-slate-500">
            Compare bill versions, substitutes, and policy changes with an
            AI-generated summary.
          </p>
        </div>
      </div>

      {!configured && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">
            LegiScan is not configured. Add <code>VITE_LEGISCAN_API_KEY</code>{" "}
            to your environment to enable bill comparison.
          </CardContent>
        </Card>
      )}

      {configured && (
        <Tabs defaultValue="versions" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:h-9 sm:grid-cols-4">
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="two-bills">Two Bills</TabsTrigger>
            <TabsTrigger value="across-years">Across Years</TabsTrigger>
            <TabsTrigger value="by-topic">By Topic</TabsTrigger>
          </TabsList>

          <TabsContent value="versions" className="mt-4">
            <VersionsMode
              sessionId={currentSessionId}
              onCompare={runCompare}
              busy={isComparing}
            />
          </TabsContent>

          <TabsContent value="two-bills" className="mt-4">
            <TwoBillsMode
              sessionId={currentSessionId}
              lcFor={lcFor}
              onCompare={runCompare}
              busy={isComparing}
            />
          </TabsContent>

          <TabsContent value="across-years" className="mt-4">
            <AcrossYearsMode
              sessions={sessions}
              lcFor={lcFor}
              onCompare={runCompare}
              busy={isComparing}
            />
          </TabsContent>

          <TabsContent value="by-topic" className="mt-4">
            <ByTopicMode
              sessionId={currentSessionId}
              lcFor={lcFor}
              onCompare={runCompare}
              busy={isComparing}
            />
          </TabsContent>
        </Tabs>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">
            {error}
          </CardContent>
        </Card>
      )}

      {isComparing && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Generating AI comparison…
        </div>
      )}

      {!isComparing && <ComparisonResult result={result} />}
    </div>
  );
}

// ── Mode 1: versions of one bill ─────────────────────────────
function VersionsMode({ sessionId, lcFor, onCompare, busy }) {
  const [bill, setBill] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [aIdx, setAIdx] = useState("");
  const [bIdx, setBIdx] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setVersions([]);
    setAIdx("");
    setBIdx("");
    setLocalError("");
    if (!bill) return;
    let cancelled = false;
    setLoadingVersions(true);
    // Fetch LegiScan text versions (for the diff) and the authoritative
    // legis.ga.gov LC-labeled versions in parallel, then merge so each
    // version carries its own LC number + chamber.
    Promise.all([
      fetchBillTextVersionsForAI(bill.legiscan_id, 8),
      api.LcTracking.getLegislationId(bill.bill_number)
        .then((lid) => (lid ? fetchBillVersionsGa(lid) : []))
        .catch((e) => {
          console.warn("legis.ga.gov versions failed", e);
          return [];
        }),
    ])
      .then(([vs, gaVersions]) => {
        if (cancelled) return;
        const merged = mergeGaLcIntoVersions(vs, gaVersions);
        setVersions(merged);
        if (merged.length >= 2) {
          setAIdx("1"); // older of the two newest
          setBIdx("0"); // newest
        }
      })
      .catch((e) => {
        if (!cancelled) setLocalError(e?.message || "Failed to load versions.");
      })
      .finally(() => !cancelled && setLoadingVersions(false));
    return () => {
      cancelled = true;
    };
  }, [bill]);

  const versionLabel = (v, i) =>
    `${v.lc || v.type || "Version"}${v.date ? ` — ${v.date}` : ""}${i === 0 ? " (newest)" : ""}`;

  const handleCompare = () => {
    setLocalError("");
    if (aIdx === "" || bIdx === "" || aIdx === bIdx) {
      setLocalError("Pick two different versions to compare.");
      return;
    }
    const vA = versions[Number(aIdx)];
    const vB = versions[Number(bIdx)];
    const origin = originChamberFromNumber(bill.bill_number);
    const sideA = {
      label: `${bill.bill_number} — ${vA.lc || vA.type || "Version"}`,
      lc: vA.lc || null,
      chamber: vA.chamber || origin,
      date: vA.date,
      text: vA.text,
    };
    const sideB = {
      label: `${bill.bill_number} — ${vB.lc || vB.type || "Version"}`,
      lc: vB.lc || null,
      chamber:
        vB.chamber ||
        lcSubstituteChamber(vB.lc) ||
        (origin === "House" ? "Senate" : "House"),
      date: vB.date,
      text: vB.text,
    };
    onCompare(sideA, sideB);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Compare versions / substitutes of one bill
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <BillSearch
          placeholder="Search a bill (e.g. HB 1020)…"
          sessionId={sessionId}
          value={bill}
          onSelect={setBill}
          onClear={() => setBill(null)}
        />

        {loadingVersions && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
          </div>
        )}

        {bill && !loadingVersions && versions.length < 2 && (
          <p className="text-sm text-slate-500">
            This bill has fewer than two distinct text versions available to
            compare.
          </p>
        )}

        {versions.length >= 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Version A (baseline)
              </label>
              <Select value={aIdx} onValueChange={setAIdx}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v, i) => (
                    <SelectItem key={`a-${i}`} value={String(i)}>
                      {versionLabel(v, i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Version B (compare)
              </label>
              <Select value={bIdx} onValueChange={setBIdx}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v, i) => (
                    <SelectItem key={`b-${i}`} value={String(i)}>
                      {versionLabel(v, i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {localError && <p className="text-sm text-red-600">{localError}</p>}

        <Button
          onClick={handleCompare}
          disabled={busy || versions.length < 2}
          className="bg-amber-600 hover:bg-amber-700"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Compare Changes
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Mode 2: two different bills ──────────────────────────────
function TwoBillsMode({ sessionId, lcFor, onCompare, busy }) {
  const [billA, setBillA] = useState(null);
  const [billB, setBillB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleCompare = async () => {
    setLocalError("");
    if (!billA || !billB) {
      setLocalError("Select two bills to compare.");
      return;
    }
    setLoading(true);
    try {
      const [tA, tB] = await Promise.all([
        fetchNewestBillText(billA.legiscan_id),
        fetchNewestBillText(billB.legiscan_id),
      ]);
      const sideA = {
        label: `${billA.bill_number} — ${tA?.type || "Latest"}`,
        lc: lcFor(billA.bill_number)?.current_lc || null,
        chamber: originChamberFromNumber(billA.bill_number),
        date: tA?.date,
        text: tA?.text,
      };
      const sideB = {
        label: `${billB.bill_number} — ${tB?.type || "Latest"}`,
        lc: lcFor(billB.bill_number)?.current_lc || null,
        chamber: originChamberFromNumber(billB.bill_number),
        date: tB?.date,
        text: tB?.text,
      };
      onCompare(sideA, sideB);
    } catch (e) {
      setLocalError(e?.message || "Failed to load bill text.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compare two different bills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Bill A
            </label>
            <BillSearch
              placeholder="Search bill A…"
              sessionId={sessionId}
              value={billA}
              onSelect={setBillA}
              onClear={() => setBillA(null)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Bill B
            </label>
            <BillSearch
              placeholder="Search bill B…"
              sessionId={sessionId}
              value={billB}
              onSelect={setBillB}
              onClear={() => setBillB(null)}
            />
          </div>
        </div>

        {localError && <p className="text-sm text-red-600">{localError}</p>}

        <Button
          onClick={handleCompare}
          disabled={busy || loading || !billA || !billB}
          className="bg-amber-600 hover:bg-amber-700"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Compare Bills
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Mode 3: across years ─────────────────────────────────────
function AcrossYearsMode({ sessions, lcFor, onCompare, busy }) {
  const [billNumber, setBillNumber] = useState("");
  const [sessionA, setSessionA] = useState("");
  const [sessionB, setSessionB] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const sessionLabel = (s) =>
    `${s.session_name}${s.year_start ? ` (${s.year_start}${s.year_end && s.year_end !== s.year_start ? `–${s.year_end}` : ""})` : ""}`;

  const handleCompare = async () => {
    setLocalError("");
    const num = billNumber.trim();
    if (!num) {
      setLocalError("Enter a bill number (e.g. HB 1020).");
      return;
    }
    if (!sessionA || !sessionB || sessionA === sessionB) {
      setLocalError("Pick two different sessions/years.");
      return;
    }
    setLoading(true);
    try {
      const [foundA, foundB] = await Promise.all([
        findBillInSession(num, Number(sessionA)),
        findBillInSession(num, Number(sessionB)),
      ]);
      if (!foundA || !foundB) {
        setLocalError(
          `Could not find ${num.toUpperCase()} in both selected sessions.`,
        );
        setLoading(false);
        return;
      }
      const [tA, tB] = await Promise.all([
        fetchNewestBillText(foundA.legiscan_id),
        fetchNewestBillText(foundB.legiscan_id),
      ]);
      const sA = sessions.find((s) => String(s.session_id) === sessionA);
      const sB = sessions.find((s) => String(s.session_id) === sessionB);
      const origin = originChamberFromNumber(num);
      const sideA = {
        label: `${foundA.bill_number} — ${sA?.year_start || "year A"}`,
        lc: null,
        chamber: origin,
        date: tA?.date,
        text: tA?.text,
      };
      const sideB = {
        label: `${foundB.bill_number} — ${sB?.year_start || "year B"}`,
        lc: null,
        chamber: origin,
        date: tB?.date,
        text: tB?.text,
      };
      onCompare(sideA, sideB);
    } catch (e) {
      setLocalError(e?.message || "Failed to load versions across years.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Compare the same bill across years
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Bill number
          </label>
          <Input
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            placeholder="e.g. HB 1020"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Year A
            </label>
            <Select value={sessionA} onValueChange={setSessionA}>
              <SelectTrigger>
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem
                    key={`ya-${s.session_id}`}
                    value={String(s.session_id)}
                  >
                    {sessionLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Year B
            </label>
            <Select value={sessionB} onValueChange={setSessionB}>
              <SelectTrigger>
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem
                    key={`yb-${s.session_id}`}
                    value={String(s.session_id)}
                  >
                    {sessionLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {localError && <p className="text-sm text-red-600">{localError}</p>}

        <Button
          onClick={handleCompare}
          disabled={busy || loading}
          className="bg-amber-600 hover:bg-amber-700"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Compare Years
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Mode 4: by topic ─────────────────────────────────────────
function ByTopicMode({ sessionId, lcFor, onCompare, busy }) {
  const [topic, setTopic] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState([]); // up to 2 bills
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const runSearch = async () => {
    setLocalError("");
    setResults([]);
    const q = topic.trim();
    if (q.length < 2) {
      setLocalError("Enter a topic or keyword.");
      return;
    }
    setSearching(true);
    try {
      const r = await searchGABills(q, sessionId, 30);
      setResults(r);
      if (r.length === 0) setLocalError("No bills matched that topic.");
    } catch (e) {
      setLocalError(e?.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const togglePick = (bill) => {
    setPicked((prev) => {
      const exists = prev.find((b) => b.legiscan_id === bill.legiscan_id);
      if (exists) return prev.filter((b) => b.legiscan_id !== bill.legiscan_id);
      if (prev.length >= 2) return [prev[1], bill]; // keep last two
      return [...prev, bill];
    });
  };

  const handleCompare = async () => {
    setLocalError("");
    if (picked.length !== 2) {
      setLocalError("Select exactly two bills from the results to compare.");
      return;
    }
    setLoading(true);
    try {
      const [tA, tB] = await Promise.all([
        fetchNewestBillText(picked[0].legiscan_id),
        fetchNewestBillText(picked[1].legiscan_id),
      ]);
      const sideA = {
        label: `${picked[0].bill_number} — ${tA?.type || "Latest"}`,
        lc: lcFor(picked[0].bill_number)?.current_lc || null,
        chamber: originChamberFromNumber(picked[0].bill_number),
        date: tA?.date,
        text: tA?.text,
      };
      const sideB = {
        label: `${picked[1].bill_number} — ${tB?.type || "Latest"}`,
        lc: lcFor(picked[1].bill_number)?.current_lc || null,
        chamber: originChamberFromNumber(picked[1].bill_number),
        date: tB?.date,
        text: tB?.text,
      };
      onCompare(sideA, sideB);
    } catch (e) {
      setLocalError(e?.message || "Failed to load bill text.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Find bills by topic, then compare two
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="e.g. education, firearms, tax credit…"
          />
          <Button onClick={runSearch} disabled={searching} variant="outline">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {results.length > 0 && (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {results.map((b) => {
              const isPicked = picked.find(
                (p) => p.legiscan_id === b.legiscan_id,
              );
              return (
                <button
                  key={b.legiscan_id}
                  onClick={() => togglePick(b)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                    isPicked ? "bg-amber-50 ring-1 ring-amber-300" : ""
                  }`}
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">
                      {b.bill_number}
                    </span>
                    <span className="ml-2 text-slate-500">{b.title}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Selected:</span>
            {picked.map((b) => (
              <Badge
                key={b.legiscan_id}
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                {b.bill_number}
              </Badge>
            ))}
          </div>
        )}

        {localError && <p className="text-sm text-red-600">{localError}</p>}

        <Button
          onClick={handleCompare}
          disabled={busy || loading || picked.length !== 2}
          className="bg-amber-600 hover:bg-amber-700"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Compare Selected
        </Button>
      </CardContent>
    </Card>
  );
}
