"use client";

import { useEffect, useState } from "react";
import { OPS, WEATHER_METRICS, suggestQuestion, type AutoRule, type Op, type WeatherMetric } from "@/core/auto-rules";
import { fromMadison } from "@/core/time";

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
const OP_LABEL: Record<Op, string> = { ">=": "≥ at least", ">": "> more than", "<=": "≤ at most", "<": "< fewer than" };

type Facility = { location_id: number; location_name: string; facility_name: string; last_count: number; capacity: number; is_closed: boolean };

/** Weather or rec-center rule inputs for the market form. Calls onChange with a rule (or null while incomplete). */
export function AutoRuleFields({ kind, onChange }: { kind: "weather" | "facility"; onChange: (rule: AutoRule | null) => void }) {
  const [metric, setMetric] = useState<WeatherMetric>("temp_max_f");
  const [date, setDate] = useState("");
  const [op, setOp] = useState<Op>(">=");
  const [threshold, setThreshold] = useState("");
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [at, setAt] = useState("");
  const [unit, setUnit] = useState<"count" | "percent">("count");

  useEffect(() => {
    if (kind !== "facility" || facilities) return;
    fetch("/api/campus/facilities")
      .then((r) => r.json())
      .then((j) => (j.facilities ? setFacilities(j.facilities) : setLoadError(j.error ?? "Couldn't load rec center spaces.")))
      .catch(() => setLoadError("Couldn't load rec center spaces."));
  }, [kind, facilities]);

  useEffect(() => {
    const t = Number(threshold);
    if (threshold === "" || !Number.isFinite(t)) return onChange(null);
    if (kind === "weather") {
      onChange(date ? { kind, metric, date, op, threshold: t } : null);
    } else {
      const f = facilities?.find((x) => x.location_id === locationId);
      onChange(f && at ? { kind, location_id: f.location_id, location_name: f.location_name, at: fromMadison(at).toISOString(), op, threshold: t, unit } : null);
    }
  }, [kind, metric, date, op, threshold, locationId, at, unit, facilities, onChange]);

  const selected = facilities?.find((x) => x.location_id === locationId);

  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-4 text-sm">
      {kind === "weather" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="font-medium">Measurement (Madison)</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as WeatherMetric)} className={field}>
              {Object.entries(WEATHER_METRICS).map(([k, m]) => (
                <option key={k} value={k}>{m.label} ({m.unit})</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Day</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="font-medium">Space</span>
            <select value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value) || null)} className={field}>
              <option value="">{facilities ? "Pick a space" : loadError ?? "Loading…"}</option>
              {facilities?.map((f) => (
                <option key={f.location_id} value={f.location_id}>{f.location_name}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Checked at (Madison time)</span>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} />
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="block space-y-1">
          <span className="font-medium">Yes if the value is</span>
          <select value={op} onChange={(e) => setOp(e.target.value as Op)} className={field}>
            {OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-medium">
            {kind === "weather" ? `Threshold (${WEATHER_METRICS[metric].unit})` : unit === "percent" ? "Threshold (% full)" : "Threshold (people)"}
          </span>
          <input type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={field} />
        </label>
        {kind === "facility" && (
          <label className="block space-y-1">
            <span className="font-medium">Measure</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as "count" | "percent")} className={field}>
              <option value="count">people</option>
              <option value="percent">% full</option>
            </select>
          </label>
        )}
      </div>
      {selected && (
        <p className="text-xs text-muted">
          Right now: {selected.is_closed ? "closed" : `${selected.last_count} of ${selected.capacity} (${selected.capacity ? Math.round((100 * selected.last_count) / selected.capacity) : 0}%)`}
        </p>
      )}
      <p className="text-xs text-muted">
        {kind === "weather"
          ? "Settles automatically the morning after, from Open-Meteo. Trading must close by the start of that day."
          : "Settles automatically from the UW Rec Well live count closest to that time (within 45 min). Trading must close by the check time. If there's no count, an admin resolves it by hand."}
      </p>
    </div>
  );
}

export { suggestQuestion };
