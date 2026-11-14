"use client";

import { createContext, useContext, useState } from "react";

/** Which outcome the trader has selected; shared by outcome rows and the bet panel. */
const PickContext = createContext<{ pick: number; setPick: (i: number) => void }>({ pick: 0, setPick: () => {} });

export function PickProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const [pick, setPick] = useState(initial);
  return <PickContext.Provider value={{ pick, setPick }}>{children}</PickContext.Provider>;
}

export const usePick = () => useContext(PickContext);

type Row = { index: number; label: string; price: number };

/** Outcome rows under the chart: big odds plus buttons that load the bet panel. */
export function OutcomeRows({ outcomes, binary }: { outcomes: Row[]; binary: boolean }) {
  const { pick, setPick } = usePick();
  if (binary) {
    const [yes, no] = outcomes;
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-4">
        <div className="flex-1">
          <div className="text-sm text-muted">Chance of Yes</div>
          <div className="tabular text-4xl font-bold">{Math.round(yes.price * 100)}%</div>
        </div>
        <button
          onClick={() => setPick(0)}
          className={`rounded-xl px-5 py-3 font-semibold ${pick === 0 ? "bg-yes text-white" : "bg-yes-soft text-yes"}`}
        >
          Bet Yes {Math.round(yes.price * 100)}%
        </button>
        <button
          onClick={() => setPick(1)}
          className={`rounded-xl px-5 py-3 font-semibold ${pick === 1 ? "bg-no text-white" : "bg-no-soft text-no"}`}
        >
          Bet No {Math.round(no.price * 100)}%
        </button>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
      {outcomes.map((o) => (
        <li key={o.index} className={`flex items-center gap-4 px-4 py-3 ${pick === o.index ? "bg-accent-soft/60" : ""}`}>
          <span className="flex-1 font-medium">{o.label}</span>
          <span className="tabular w-16 text-right text-2xl font-bold">{Math.round(o.price * 100)}%</span>
          <button
            onClick={() => setPick(o.index)}
            className={`w-28 rounded-lg py-2 text-sm font-semibold ${pick === o.index ? "bg-accent text-accent-ink" : "bg-accent-soft text-accent"}`}
          >
            Bet {Math.round(o.price * 100)}%
          </button>
        </li>
      ))}
    </ul>
  );
}
