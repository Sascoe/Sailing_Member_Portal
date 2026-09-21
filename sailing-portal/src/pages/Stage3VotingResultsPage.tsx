import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import { db, functions } from "../app/firebase";
import { useUserRole } from "../auth/useUserRole";

type PacketCategory = "auto_on" | "probably" | "maybe" | "probably_not";
type FinalDecision = "offer" | "drop" | "undecided";
type YesMaybeNo = "yes" | "maybe" | "no";

const MAX_SCORE = 7;

function evalScore(v?: YesMaybeNo): number {
  if (v === "yes") return 1;
  if (v === "maybe") return 0.5;
  return 0;
}

function calcScore(data: ProspieDoc): number {
  return (
    evalScore(data.stage1SailingInterviewSummary?.sailingEval1) +
    evalScore(data.stage1SailingInterviewSummary?.sailingEval2) +
    evalScore(data.stage1PersonalityInterviewSummary?.eval1) +
    evalScore(data.stage1PersonalityInterviewSummary?.eval2) +
    evalScore(data.stage2?.onTheWaterEval) +
    evalScore(data.stage2InterviewSummary?.eval1) +
    evalScore(data.stage2InterviewSummary?.eval2)
  );
}

type ProspieDoc = {
  firstName?: string;
  lastName?: string;
  email?: string;
  gradYear?: number;
  gender?: string;
  photoUrl?: string;
  name?: string;
  stage1SailingInterviewSummary?: {
    sailingEval1?: YesMaybeNo;
    sailingEval2?: YesMaybeNo;
  };
  stage1PersonalityInterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
  };
  stage2?: {
    onTheWaterEval?: YesMaybeNo;
  };
  stage2InterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
  };
  stage3?: {
    packetCategory?: PacketCategory | null;
    blurb?: string;
    packetNotes?: string;
    finalDecision?: FinalDecision;
  };
};

type VoteDoc = {
  menSelections?: string[];
  womenSelections?: string[];
};

type RecruitmentSettings = {
  recruitment?: {
    menOfferThreshold?: number;
    womenOfferThreshold?: number;
  };
};

type FinalizedDoc = {
  decision?: "offer" | "drop";
  emailSent?: boolean;
};

type ResultRow = {
  id: string;
  name: string;
  email?: string;
  gradYear?: number;
  genderBucket: "men" | "women";
  photoUrl?: string;
  category: PacketCategory | null;
  voteCount: number;
  finalDecision: FinalDecision;
  packetNotes: string;
  totalScore: number;
};

const CATEGORY_LABELS: Record<PacketCategory, string> = {
  auto_on: "Auto-on",
  probably: "Probably",
  maybe: "Maybe",
  probably_not: "Probably not",
};

function normalizeGenderBucket(raw?: string): "men" | "women" {
  const v = (raw ?? "").trim().toLowerCase();
  if (["man", "male", "boy", "men", "guy", "guys"].includes(v)) return "men";
  return "women";
}

function toResultRow(id: string, data: ProspieDoc, voteCount: number): ResultRow {
  const first = data.firstName ?? "";
  const last = data.lastName ?? "";
  const name = `${first} ${last}`.trim() || data.name || data.email || id;

  return {
    id,
    name,
    email: data.email,
    gradYear: data.gradYear,
    genderBucket: normalizeGenderBucket(data.gender),
    photoUrl: data.photoUrl,
    category: data.stage3?.packetCategory ?? null,
    voteCount,
    finalDecision: data.stage3?.finalDecision ?? "undecided",
    packetNotes: data.stage3?.packetNotes ?? "",
    totalScore: calcScore(data),
  };
}

type SortColumn = "name" | "votes" | "category";
type SortOrder = "asc" | "desc";

function ResultsTable({
  title,
  rows,
  threshold,
  onThresholdChange,
  isChair,
  onOfferAboveThreshold,
  onFinalDecisionChange,
}: {
  title: string;
  rows: ResultRow[];
  threshold: number;
  onThresholdChange: (value: number) => void;
  isChair: boolean;
  onOfferAboveThreshold: () => void;
  onFinalDecisionChange: (uid: string, decision: FinalDecision) => void;
}) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("votes");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortColumn === "votes") {
        aVal = a.voteCount;
        bVal = b.voteCount;
      } else {
        aVal = a[sortColumn];
        bVal = b[sortColumn];
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortColumn, sortOrder]);

  const offerCount = sorted.filter((r) => r.finalDecision === "offer").length;
  const dropCount = sorted.filter((r) => r.finalDecision === "drop").length;
  const undecidedCount = sorted.filter((r) => r.finalDecision === "undecided").length;

  const toggleSort = (col: SortColumn) => {
    if (col === sortColumn) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortOrder("desc");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {rows.length} prospies · {offerCount} offers · {dropCount} drops · {undecidedCount} undecided
          </p>
        </div>

        {isChair && (
          <div className="flex gap-3">
            <label className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Threshold:</span>
              <input
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => onThresholdChange(Math.max(0, Number(e.target.value)))}
                className="w-16 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              />
              <span className="text-xs text-slate-600">votes</span>
            </label>
            <button
              onClick={onOfferAboveThreshold}
              className="rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Offer all ≥ threshold
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900">
                Name
              </th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900">
                Category
              </th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900">
                Score
              </th>
              <th
                className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900 cursor-pointer hover:bg-slate-200"
                onClick={() => toggleSort("votes")}
              >
                Votes {sortColumn === "votes" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900">
                Pass/Fail
              </th>
              {isChair && (
                <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold text-slate-900">
                  Final Decision
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const passes = row.voteCount >= threshold;
              const statusColor = row.finalDecision === "offer" ? "bg-green-50" : row.finalDecision === "drop" ? "bg-red-50" : "bg-slate-50";

              return (
                <tr key={row.id} className={`border-b border-slate-200 hover:bg-slate-50 ${statusColor}`}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {row.photoUrl && (
                        <img
                          src={row.photoUrl}
                          alt={row.name}
                          className="h-8 w-8 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{row.name}</div>
                        {row.email && (
                          <div className="text-xs text-slate-500 truncate">{row.email}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-block rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-800">
                      {row.category ? CATEGORY_LABELS[row.category] : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {(() => {
                      const pct = row.totalScore / MAX_SCORE;
                      const color = pct >= 0.75 ? "bg-green-100 text-green-800" : pct >= 0.5 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
                      return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{row.totalScore}/{MAX_SCORE}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-3 font-semibold text-slate-900">{row.voteCount}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            passes ? "bg-green-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(100, (row.voteCount / threshold) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium ${passes ? "text-green-700" : "text-red-700"}`}>
                        {passes ? "✓ Pass" : "✗ Fail"}
                      </span>
                    </div>
                  </td>
                  {isChair && (
                    <td className="px-3 py-3">
                      <select
                        value={row.finalDecision}
                        onChange={(e) =>
                          onFinalDecisionChange(row.id, e.target.value as FinalDecision)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                      >
                        <option value="undecided">Undecided</option>
                        <option value="offer">Offer</option>
                        <option value="drop">Drop</option>
                      </select>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Stage3VotingResultsPage() {
  const navigate = useNavigate();
  const { positions, loading: roleLoading } = useUserRole();
  const isChair = positions.includes("recruitment_chair");

  const [prospies, setProspies] = useState<Record<string, ProspieDoc>>({});
  const [votes, setVotes] = useState<Record<string, VoteDoc>>({});
  const [loading, setLoading] = useState(true);

  const [menThreshold, setMenThreshold] = useState(5);
  const [womenThreshold, setWomenThreshold] = useState(5);

  const [finalized, setFinalized] = useState<Record<string, FinalizedDoc>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [startingNewCycle, setStartingNewCycle] = useState(false);

  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as RecruitmentSettings) ?? {};
      const rec = data.recruitment ?? {};
      setMenThreshold(rec.menOfferThreshold ?? 5);
      setWomenThreshold(rec.womenOfferThreshold ?? 5);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "prospies"), (snap) => {
      const next: Record<string, ProspieDoc> = {};
      snap.docs.forEach((d) => {
        next[d.id] = d.data() as ProspieDoc;
      });
      setProspies(next);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stage3Votes"), (snap) => {
      const next: Record<string, VoteDoc> = {};
      snap.docs.forEach((d) => {
        next[d.id] = d.data() as VoteDoc;
      });
      setVotes(next);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "stage3FinalizedProspies"), (snap) => {
      const next: Record<string, FinalizedDoc> = {};
      snap.docs.forEach((d) => {
        next[d.id] = d.data() as FinalizedDoc;
      });
      setFinalized(next);
    });
    return () => unsub();
  }, []);

  const voteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(votes).forEach((voteDoc) => {
      (voteDoc.menSelections ?? []).forEach((uid) => {
        counts[uid] = (counts[uid] ?? 0) + 1;
      });
      (voteDoc.womenSelections ?? []).forEach((uid) => {
        counts[uid] = (counts[uid] ?? 0) + 1;
      });
    });
    return counts;
  }, [votes]);

  const menResults = useMemo(() => {
    return Object.entries(prospies)
      .filter(([_, data]) => data.stage3?.packetCategory && normalizeGenderBucket(data.gender) === "men")
      .map(([id, data]) => toResultRow(id, data, voteCounts[id] ?? 0))
      .sort((a, b) => b.voteCount - a.voteCount);
  }, [prospies, voteCounts]);

  const womenResults = useMemo(() => {
    return Object.entries(prospies)
      .filter(([_, data]) => data.stage3?.packetCategory && normalizeGenderBucket(data.gender) === "women")
      .map(([id, data]) => toResultRow(id, data, voteCounts[id] ?? 0))
      .sort((a, b) => b.voteCount - a.voteCount);
  }, [prospies, voteCounts]);

  async function updateFinalDecision(uid: string, decision: FinalDecision) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.finalDecision": decision,
    });
  }

  async function offerAllAboveThreshold(bucket: "men" | "women") {
    const threshold = bucket === "men" ? menThreshold : womenThreshold;
    const results = bucket === "men" ? menResults : womenResults;
    const toOffer = results.filter((r) => r.voteCount >= threshold);

    if (toOffer.length === 0) {
      alert(`No ${bucket} prospies above threshold of ${threshold}.`);
      return;
    }

    const batch = writeBatch(db);
    toOffer.forEach((row) => {
      batch.update(doc(db, "prospies", row.id), {
        "stage3.finalDecision": "offer",
      });
    });
    await batch.commit();
  }

  async function updateOfferThreshold(bucket: "men" | "women", value: number) {
    const key = bucket === "men" ? "recruitment.menOfferThreshold" : "recruitment.womenOfferThreshold";
    await updateDoc(doc(db, "settings", "global"), { [key]: value });
  }

  const finalizedList = Object.values(finalized);
  const pendingEmailCount = finalizedList.filter((f) => !f.emailSent).length;

  async function handleFinalizeStage3() {
    if (
      !confirm(
        "Finalize Stage 3? Every remaining undecided prospie will be auto-resolved by vote count, offers will become members, and drops will be marked dropped. This cannot be undone."
      )
    ) {
      return;
    }

    setFinalizing(true);
    try {
      const finalize = httpsCallable(functions, "finalizeStage3");
      const result: any = await finalize({});
      alert(
        `Finalized. Offered: ${result.data.offered}, Dropped: ${result.data.dropped}, Already finalized: ${result.data.skipped}.`
      );
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to finalize Stage 3.");
    } finally {
      setFinalizing(false);
    }
  }

  async function handleSendDecisionEmails() {
    if (!confirm(`Email ${pendingEmailCount} finalized prospie(s) their decision now?`)) {
      return;
    }

    setSendingEmails(true);
    try {
      const send = httpsCallable(functions, "sendStage3DecisionEmails");
      const result: any = await send({});
      alert(
        `Emails queued. Offers: ${result.data.offeredEmailed}, Drops: ${result.data.droppedEmailed}, Skipped (no email): ${result.data.skippedNoEmail}.`
      );
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to send decision emails.");
    } finally {
      setSendingEmails(false);
    }
  }

  async function handleStartNewCycle() {
    if (
      !confirm(
        "Start a new recruitment cycle? This reopens recruitment and resets Stage 1 back to Day 1 interviews, and resets Stage 3 packet/voting settings. It does NOT delete any prospie data from the previous cycle — that needs to be handled separately."
      )
    ) {
      return;
    }

    setStartingNewCycle(true);
    try {
      await updateDoc(doc(db, "settings", "global"), {
        "recruitment.isOpen": true,
        "recruitment.activeStage": "stage1",
        "recruitment.stage1Phase": "day1_interviews",
        "recruitment.menPacketsPublished": false,
        "recruitment.womenPacketsPublished": false,
        "recruitment.menVotingOpen": false,
        "recruitment.womenVotingOpen": false,
        "recruitment.menVotesAllowed": 0,
        "recruitment.womenVotesAllowed": 0,
        "recruitment.menOfferThreshold": 5,
        "recruitment.womenOfferThreshold": 5,
      });
      alert("New recruitment cycle started. Stage 1, Day 1 interviews are now open.");
      navigate("/member/recruitment");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to start new recruitment cycle.");
    } finally {
      setStartingNewCycle(false);
    }
  }

  if (roleLoading || loading) {
    return <div className="p-6">Loading…</div>;
  }

  if (!isChair) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-600">You don't have permission to view voting results.</p>
          <button
            onClick={() => navigate("/member/recruitment")}
            className="mt-4 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to recruitment
          </button>
        </div>
      </div>
    );
  }

  const totalVotes = Object.values(votes).reduce((sum, v) => sum + (v.menSelections?.length ?? 0) + (v.womenSelections?.length ?? 0), 0);
  const totalVoters = Object.keys(votes).length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-purple-600">Voting results</h1>
            <p className="mt-2 text-slate-600">
              {totalVoters} voters · {totalVotes} votes cast
            </p>
            {finalizedList.length > 0 && (
              <p className="mt-1 text-sm text-slate-500">
                {finalizedList.length} finalized · {pendingEmailCount} awaiting decision email
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleFinalizeStage3}
              disabled={finalizing}
              className="rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {finalizing ? "Finalizing…" : "Finalize Stage 3"}
            </button>
            <button
              onClick={handleSendDecisionEmails}
              disabled={sendingEmails || pendingEmailCount === 0}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingEmails ? "Sending…" : `Email decisions${pendingEmailCount > 0 ? ` (${pendingEmailCount})` : ""}`}
            </button>
            <button
              onClick={handleStartNewCycle}
              disabled={startingNewCycle}
              className="rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {startingNewCycle ? "Starting…" : "Start new recruitment cycle"}
            </button>
            <button
              onClick={() => navigate("/member/recruitment")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
            >
              Back to recruitment
            </button>
          </div>
        </div>
      </div>

      {/* Men results */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ResultsTable
          title="Men results"
          rows={menResults}
          threshold={menThreshold}
          onThresholdChange={(value) => updateOfferThreshold("men", value)}
          isChair={isChair}
          onOfferAboveThreshold={() => offerAllAboveThreshold("men")}
          onFinalDecisionChange={updateFinalDecision}
        />
      </div>

      {/* Women results */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ResultsTable
          title="Women results"
          rows={womenResults}
          threshold={womenThreshold}
          onThresholdChange={(value) => updateOfferThreshold("women", value)}
          isChair={isChair}
          onOfferAboveThreshold={() => offerAllAboveThreshold("women")}
          onFinalDecisionChange={updateFinalDecision}
        />
      </div>
    </div>
  );
}
