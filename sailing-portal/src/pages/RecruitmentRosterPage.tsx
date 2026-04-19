import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth, functions } from "../app/firebase";
import { useUserRole } from "../auth/useUserRole";

import { httpsCallable } from "firebase/functions";

type YesMaybeNo = "yes" | "maybe" | "no";
type Stage1Decision = "undecided" | "advance" | "drop";

type ProspieDoc = {
  firstName?: string;
  lastName?: string;
  email?: string;
  gradYear?: number;
  gender?: string;
  photoUrl?: string;

  stage1SailingInterviewSummary?: {
    sailingEval1?: YesMaybeNo;
    sailingEval2?: YesMaybeNo;
    hasSailingExperience?: boolean;
    availability?: string[];
  };

  stage1PersonalityInterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
    completedAt?: any; // Firestore Timestamp
  };

  stage1Complete?: boolean;

  // Optional future-proof field if you ever store it top-level
  stage1CompletedAt?: any;

  // bucket fields
  stage1Decision?: Stage1Decision;
  stage1DecisionUpdatedAt?: any;
  stage1DecisionUpdatedBy?: string | null;
};

function scoreYNM(v?: YesMaybeNo) {
  if (v === "yes") return 1;
  if (v === "maybe") return 0.5;
  if (v === "no") return 0;
  return 0;
}

function totalScore(p: ProspieDoc) {
  const s = p.stage1SailingInterviewSummary;
  const per = p.stage1PersonalityInterviewSummary;

  return (
    scoreYNM(s?.sailingEval1) +
    scoreYNM(s?.sailingEval2) +
    scoreYNM(per?.eval1) +
    scoreYNM(per?.eval2)
  );
}

// Convert Firestore Timestamp-ish to millis safely
function toMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return null;
}

// Local date key YYYY-MM-DD (local timezone, not UTC)
function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function RecruitmentRosterPage() {
  const { positions, loading: roleLoading } = useUserRole();
  const isRecruitmentChair = positions?.includes("recruitment_chair") ?? false;

  const [prospies, setProspies] = useState<{ id: string; data: ProspieDoc }[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  type SortKey = "score" | "lastName" | "gradYear" | "firstName";
  type SortDir = "asc" | "desc";

  // Filters (ordered in UI later)
  const [dayFilter, setDayFilter] = useState<"all" | "day1" | "day2">("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [sailingExpFilter, setSailingExpFilter] = useState<string>("all");
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bucketFilter, setBucketFilter] = useState<
    "all" | "undecided" | "advance" | "drop"
  >("all");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // action loading states
  const [assigningSlots, setAssigningSlots] = useState(false);
  const [finalizingStage1, setFinalizingStage1] = useState(false);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelected() {
    setSelected(new Set());
  }

  async function setDecisionForSelected(decision: Stage1Decision) {
    if (selected.size === 0) return;

    const batch = writeBatch(db);

    selected.forEach((uid) => {
      const ref = doc(db, "prospies", uid);
      batch.update(ref, {
        stage1Decision: decision,
        stage1DecisionUpdatedAt: serverTimestamp(),
        stage1DecisionUpdatedBy: auth.currentUser?.uid ?? null,
      });
    });

    await batch.commit();
    clearSelected();
  }

  // Assign Stage 2 slots button handler
  async function handleAssignStage2Slots() {
    if (!confirm("Assign Stage 2 time slots for all Stage 1 completed (not dropped) prospies?")) {
      return;
    }

    setAssigningSlots(true);
    try {
      const assign = httpsCallable(functions, "assignStageTwoSlots");
      const result = await assign({});
      // result.data shape depends on what your function returns
      console.log("assignStageTwoSlots result:", result.data);
      alert("Stage 2 slots assigned successfully.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to assign Stage 2 slots.");
    } finally {
      setAssigningSlots(false);
    }
  }

  // Existing: Finalize Stage 1 handler (wrapped w/ loading state)
  async function handleFinalizeStage1() {
    if (!confirm("Finalize Stage 1 decisions and send emails?")) return;

    setFinalizingStage1(true);
    try {
      const finalize = httpsCallable(functions, "finalizeStage1");
      const result: any = await finalize({});
      alert(`Advanced: ${result.data.advanced}, Dropped: ${result.data.dropped}`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to finalize Stage 1.");
    } finally {
      setFinalizingStage1(false);
    }
  }

  useEffect(() => {
    if (!isRecruitmentChair) return;

    setLoading(true);

    const q = query(
      collection(db, "prospies"),
      where("stage1Complete", "==", true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as ProspieDoc,
        }));
        setProspies(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Roster onSnapshot error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isRecruitmentChair]);

  // Determine Day 1 / Day 2 based on unique completion dates present in data
  const completionDates = useMemo(() => {
    const set = new Set<string>();

    for (const p of prospies) {
      const ms =
        toMillis(p.data.stage1PersonalityInterviewSummary?.completedAt) ??
        toMillis(p.data.stage1CompletedAt);

      if (ms != null) set.add(localDateKey(ms));
    }

    return Array.from(set).sort(); // earliest date = Day 1
  }, [prospies]);

  const visibleRows = useMemo(() => {
    const day1Key = completionDates[0] ?? null;
    const day2Key = completionDates[1] ?? null;

    // 1) filter
    const filtered = prospies.filter(({ data }) => {
      // Day filter
      if (dayFilter !== "all") {
        const ms =
          toMillis(data.stage1PersonalityInterviewSummary?.completedAt) ??
          toMillis(data.stage1CompletedAt);

        const key = ms != null ? localDateKey(ms) : null;

        if (dayFilter === "day1" && day1Key && key !== day1Key) return false;
        if (dayFilter === "day2" && day2Key && key !== day2Key) return false;

        if (dayFilter === "day2" && !day2Key) return false;
      }

      // Min score filter
      const score = totalScore(data);
      if (score < minScore) return false;

      // Sailing experience filter
      if (sailingExpFilter !== "all") {
        const exp = data.stage1SailingInterviewSummary?.hasSailingExperience;
        if (sailingExpFilter === "yes" && exp !== true) return false;
        if (sailingExpFilter === "no" && exp !== false) return false;
      }

      // Gender filter
      if (genderFilter !== "all" && (data.gender ?? "") !== genderFilter) {
        return false;
      }

      // Bucket filter
      if (bucketFilter !== "all") {
        const bucket = data.stage1Decision ?? "undecided";
        if (bucket !== bucketFilter) return false;
      }

      return true;
    });

    // 2) sort
    const sorted = [...filtered].sort((a, b) => {
      const A = a.data;
      const B = b.data;

      let primary = 0;

      if (sortKey === "score") {
        primary = totalScore(A) - totalScore(B);
      } else if (sortKey === "lastName") {
        primary = (A.lastName ?? "").localeCompare(B.lastName ?? "");
      } else if (sortKey === "firstName") {
        primary = (A.firstName ?? "").localeCompare(B.firstName ?? "");
      } else if (sortKey === "gradYear") {
        primary = (A.gradYear ?? 0) - (B.gradYear ?? 0);
      }

      const dirMult = sortDir === "asc" ? 1 : -1;
      let result = primary * dirMult;

      if (result === 0) {
        result = (A.lastName ?? "").localeCompare(B.lastName ?? "");
        if (result === 0) {
          result = (A.firstName ?? "").localeCompare(B.firstName ?? "");
        }
      }

      return result;
    });

    return sorted;
  }, [
    prospies,
    completionDates,
    dayFilter,
    minScore,
    sailingExpFilter,
    genderFilter,
    bucketFilter,
    sortKey,
    sortDir,
  ]);

  // bucket counts (based on ALL loaded prospies)
  const counts = useMemo(() => {
    const c = { undecided: 0, advance: 0, drop: 0 };
    prospies.forEach((p) => {
      const bucket = (p.data.stage1Decision ?? "undecided") as Stage1Decision;
      c[bucket] += 1;
    });
    return c;
  }, [prospies]);

  const visibleIds = visibleRows.map((p) => p.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function resetFilters() {
    setDayFilter("all");
    setMinScore(0);
    setSailingExpFilter("all");
    setGenderFilter("all");
    setSortKey("score");
    setSortDir("desc");
    setBucketFilter("all");
  }

  if (roleLoading) return <div className="p-6">Loading…</div>;
  if (!isRecruitmentChair) return <div className="p-6">Access denied</div>;
  if (loading) return <div className="p-6">Loading roster…</div>;

  const day1Label = completionDates[0] ? `Day 1 (${completionDates[0]})` : "Day 1";
  const day2Label = completionDates[1] ? `Day 2 (${completionDates[1]})` : "Day 2";

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl rounded-2xl bg-white p-6 shadow">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-center text-purple-600">
            Stage 1 Completed Prospies
          </h1>

          <div className="flex flex-wrap gap-3 text-sm text-slate-700">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Undecided:{" "}
              <span className="font-semibold text-slate-900">
                {counts.undecided}
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Advance:{" "}
              <span className="font-semibold text-slate-900">
                {counts.advance}
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              Drop:{" "}
              <span className="font-semibold text-slate-900">{counts.drop}</span>
            </div>

            {/* Assign Stage 2 Slots */}
            <button
              type="button"
              onClick={handleAssignStage2Slots}
              disabled={assigningSlots || finalizingStage1}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {assigningSlots ? "Assigning…" : "Assign Stage 2 Slots"}
            </button>

            {/* Finalize Stage 1 */}
            <button
              type="button"
              onClick={handleFinalizeStage1}
              disabled={finalizingStage1 || assigningSlots}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {finalizingStage1 ? "Finalizing…" : "Finalize Stage 1"}
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            {/* 1) Day */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Day</div>
              <select
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value as any)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="all">All</option>
                <option value="day1">{day1Label}</option>
                <option value="day2" disabled={completionDates.length < 2}>
                  {day2Label}
                </option>
              </select>
            </label>

            {/* 2) Min score */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Min score</div>
              <input
                type="number"
                min={0}
                value={minScore}
                onChange={(e) =>
                  setMinScore(e.target.value === "" ? 0 : Number(e.target.value))
                }
                className="mt-1 w-24 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              />
            </label>

            {/* 3) Sailing experience */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">
                Sailing experience
              </div>
              <select
                value={sailingExpFilter}
                onChange={(e) => setSailingExpFilter(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="all">All</option>
                <option value="yes">Has experience</option>
                <option value="no">No experience</option>
              </select>
            </label>

            {/* 4) Gender */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Gender</div>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="all">All</option>
                <option value="man">Man</option>
                <option value="woman">Woman</option>
                <option value="nonbinary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
                <option value="other">Other</option>
              </select>
            </label>

            {/* 5) Sort by */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Sort by</div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="score">Score</option>
                <option value="lastName">Last name</option>
                <option value="firstName">First name</option>
                <option value="gradYear">Grad year</option>
              </select>
            </label>

            {/* 6) Direction */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Direction</div>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as any)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </label>

            {/* 7) Filter (bucket) */}
            <label className="block">
              <div className="text-xs font-medium text-slate-600">Filter</div>
              <select
                value={bucketFilter}
                onChange={(e) => setBucketFilter(e.target.value as any)}
                className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              >
                <option value="all">All</option>
                <option value="undecided">Undecided</option>
                <option value="advance">Advance</option>
                <option value="drop">Drop</option>
              </select>
            </label>
          </div>

          {/* Reset + showing */}
          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Reset
            </button>

            <div className="text-sm text-slate-600">
              Showing{" "}
              <span className="font-semibold text-slate-900">
                {visibleRows.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-900">
                {prospies.length}
              </span>
            </div>
          </div>
        </div>

        {/* Selection + actions */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              className="h-4 w-4"
            />
            <span className="text-sm text-slate-700">
              Selected{" "}
              <span className="font-semibold text-slate-900">
                {selected.size}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDecisionForSelected("advance")}
              disabled={selected.size === 0}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Mark Advance
            </button>

            <button
              type="button"
              onClick={() => setDecisionForSelected("drop")}
              disabled={selected.size === 0}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Mark Drop
            </button>

            <button
              type="button"
              onClick={() => setDecisionForSelected("undecided")}
              disabled={selected.size === 0}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Clear Bucket
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Select</th>
                <th className="py-2 pr-4">Photo</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Year</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Gender</th>
                <th className="py-2 pr-4">Sailing exp</th>
                <th className="py-2 pr-4">Availability</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2 pr-4">Bucket</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ id, data }) => {
                const avail =
                  data.stage1SailingInterviewSummary?.availability ?? [];
                const exp =
                  data.stage1SailingInterviewSummary?.hasSailingExperience;

                const bucket = data.stage1Decision ?? "undecided";

                return (
                  <tr key={id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleSelected(id)}
                        className="h-4 w-4"
                      />
                    </td>

                    <td className="py-2 pr-4">
                      {data.photoUrl ? (
                        <img
                          src={data.photoUrl}
                          alt={`${data.firstName ?? ""} ${data.lastName ?? ""}`}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-slate-200" />
                      )}
                    </td>

                    <td className="py-2 pr-4 font-semibold text-slate-900">
                      {(data.firstName ?? "—") + " " + (data.lastName ?? "")}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.gradYear ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.email ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.gender ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {exp === true ? "Yes" : exp === false ? "No" : "—"}
                    </td>

                    <td className="py-2 pr-4">
                      {avail.length === 0 ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {avail.map((a) => (
                            <span
                              key={a}
                              className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="py-2 pr-4 font-semibold text-slate-900">
                      {totalScore(data)}
                    </td>

                    <td className="py-2 pr-4">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        {bucket}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-600">
                    No prospies match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}