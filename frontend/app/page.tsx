"use client";

import { useReducer, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STEP_NAMES = ["Market Research", "TAM Mapping", "ICP Mapping", "Campaign Strategy"];

type StepStatus = "pending" | "running" | "done";

interface Step {
  status: StepStatus;
  name: string;
  output: string;
}

interface State {
  steps: Step[];
  activeTab: number;
  isRunning: boolean;
  downloadFile: string | null;
  error: string | null;
  isFetching: boolean;
}

type Action =
  | { type: "RESET" }
  | { type: "FETCHING" }
  | { type: "STEP_START"; step: number }
  | { type: "TOKEN"; step: number; text: string }
  | { type: "STEP_END"; step: number }
  | { type: "DONE"; filename: string }
  | { type: "ERROR"; message: string }
  | { type: "SET_TAB"; tab: number };

function initialSteps(): Step[] {
  return STEP_NAMES.map((name) => ({ status: "pending", name, output: "" }));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "RESET":
      return {
        steps: initialSteps(),
        activeTab: 0,
        isRunning: true,
        downloadFile: null,
        error: null,
        isFetching: false,
      };
    case "FETCHING":
      return { ...state, isFetching: true };
    case "STEP_START": {
      const idx = action.step - 1;
      const steps = state.steps.map((s, i) =>
        i === idx ? { ...s, status: "running" as StepStatus } : s
      );
      return { ...state, steps, activeTab: idx, isFetching: false };
    }
    case "TOKEN": {
      const idx = action.step - 1;
      const steps = state.steps.map((s, i) =>
        i === idx ? { ...s, output: s.output + action.text } : s
      );
      return { ...state, steps };
    }
    case "STEP_END": {
      const idx = action.step - 1;
      const steps = state.steps.map((s, i) =>
        i === idx ? { ...s, status: "done" as StepStatus } : s
      );
      return { ...state, steps };
    }
    case "DONE":
      return { ...state, isRunning: false, downloadFile: action.filename };
    case "ERROR":
      return { ...state, isRunning: false, error: action.message, isFetching: false };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    default:
      return state;
  }
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, {
    steps: initialSteps(),
    activeTab: 0,
    isRunning: false,
    downloadFile: null,
    error: null,
    isFetching: false,
  });

  const urlRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll output panel
  useEffect(() => {
    if (outputRef.current && state.isRunning) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [state.steps[state.activeTab]?.output, state.isRunning]);

  const handleGenerate = useCallback(async () => {
    let url = urlRef.current?.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: "RESET" });
    dispatch({ type: "FETCHING" });

    try {
      const res = await fetch("http://localhost:8000/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (!res.ok) {
        dispatch({ type: "ERROR", message: `HTTP ${res.status}` });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw);
            switch (event.type) {
              case "website_fetch":
                dispatch({ type: "FETCHING" });
                break;
              case "step_start":
                dispatch({ type: "STEP_START", step: event.step });
                break;
              case "token":
                dispatch({ type: "TOKEN", step: event.step, text: event.text });
                break;
              case "step_end":
                dispatch({ type: "STEP_END", step: event.step });
                break;
              case "done":
                dispatch({ type: "DONE", filename: event.filename });
                break;
              case "error":
                dispatch({ type: "ERROR", message: event.message });
                break;
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        dispatch({ type: "ERROR", message: err.message });
      }
    }
  }, []);

  const activeStep = state.steps[state.activeTab];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#08080f" }}>
      {/* Header */}
      <header className="border-b border-[#1e1e35] px-6 py-4 flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold">
          ◈
        </div>
        <span className="font-semibold text-slate-100 tracking-tight">Campaign AI</span>
        <span className="text-slate-400 text-sm ml-1">B2B Pipeline</span>
      </header>

      {/* URL bar */}
      <div className="border-b border-[#1e1e35] px-6 py-4 flex gap-3">
        <input
          ref={urlRef}
          type="text"
          placeholder="company.com or https://company.com"
          disabled={state.isRunning}
          className="flex-1 bg-[#0f0f1a] border border-[#1e1e35] rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
          onKeyDown={(e) => e.key === "Enter" && !state.isRunning && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={state.isRunning}
          className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {state.isRunning ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin-slow w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Running
            </span>
          ) : (
            "Generate ▶"
          )}
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — progress */}
        <aside className="w-56 border-r border-[#1e1e35] flex flex-col p-4 gap-1 shrink-0">
          {state.isFetching && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-amber-400 text-xs mb-2">
              <svg className="animate-spin-slow w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching website...
            </div>
          )}

          {state.steps.map((step, i) => (
            <button
              key={i}
              onClick={() => dispatch({ type: "SET_TAB", tab: i })}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                state.activeTab === i
                  ? "bg-[#1e1e35] text-white"
                  : "text-slate-300 hover:text-white hover:bg-[#0f0f1a]"
              }`}
            >
              <StepIcon status={step.status} />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">Step {i + 1}</span>
                <span className="truncate">{step.name}</span>
              </div>
            </button>
          ))}

          {state.downloadFile && (
            <a
              href={`http://localhost:8000/download/${state.downloadFile}`}
              download
              className="mt-4 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-emerald-400 border border-emerald-900 hover:bg-emerald-950 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          )}

          {state.error && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-red-950 border border-red-900 text-red-400 text-xs">
              {state.error}
            </div>
          )}
        </aside>

        {/* Right panel — output */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[#1e1e35] px-4 gap-1 pt-1">
            {state.steps.map((step, i) => (
              <button
                key={i}
                onClick={() => dispatch({ type: "SET_TAB", tab: i })}
                className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors border-b-2 -mb-px ${
                  state.activeTab === i
                    ? "text-indigo-300 border-indigo-400 bg-[#0f0f1a]"
                    : "text-slate-300 border-transparent hover:text-white"
                } ${step.status === "pending" ? "opacity-40 cursor-default" : ""}`}
                disabled={step.status === "pending"}
              >
                <span className="flex items-center gap-2">
                  <TabDot status={step.status} />
                  {step.name}
                </span>
              </button>
            ))}
          </div>

          {/* Output content */}
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto p-6 font-mono text-sm"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {!state.isRunning && !activeStep?.output && !state.error ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-12 h-12 rounded-xl bg-[#0f0f1a] border border-[#1e1e35] flex items-center justify-center text-2xl">
                  ◈
                </div>
                <p className="text-sm">Enter a company URL and click Generate</p>
              </div>
            ) : (
              <div className="prose-dark max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeStep?.output || ""}
                </ReactMarkdown>
                {activeStep?.status === "running" && (
                  <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse-dot ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <svg className="animate-spin-slow w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    );
  }
  return <div className="w-4 h-4 rounded-full border border-slate-700 shrink-0" />;
}

function TabDot({ status }: { status: StepStatus }) {
  if (status === "done") return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (status === "running") return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse-dot shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />;
}
