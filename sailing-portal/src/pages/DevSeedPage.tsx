import { useState } from "react";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../app/firebase";

const TEST_PROSPIES = [
  {
    id: "test_men_1",
    firstName: "John", lastName: "Smith", email: "john@example.com", gradYear: 2025, gender: "Male",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "yes", sailingEval2: "yes", notes1: "Great sailing skills, very enthusiastic" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "maybe", notes1: "Good team player, sometimes quiet" },
    stage2InterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Excellent on-water performance, strong leader" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_men_2",
    firstName: "Michael", lastName: "Johnson", email: "michael@example.com", gradYear: 2024, gender: "Male",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "maybe", sailingEval2: "yes", notes1: "Decent sailing experience, needs more practice" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Very friendly and outgoing" },
    stage2InterviewSummary: { eval1: "maybe", eval2: "maybe", notes1: "Good potential but slightly inconsistent" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_men_3",
    firstName: "David", lastName: "Brown", email: "david@example.com", gradYear: 2026, gender: "Male",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "no", sailingEval2: "maybe", notes1: "Needs improvement, first time sailing" },
    stage1PersonalityInterviewSummary: { eval1: "maybe", eval2: "no", notes1: "Quiet, takes time to open up" },
    stage2InterviewSummary: { eval1: "maybe", eval2: "no", notes1: "Struggled with water drills" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_men_4",
    firstName: "James", lastName: "Wilson", email: "james@example.com", gradYear: 2025, gender: "Male",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "yes", sailingEval2: "maybe", notes1: "Strong sailing background" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Natural leader, great communicator" },
    stage2InterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Excellent all-around performance" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_women_1",
    firstName: "Sarah", lastName: "Davis", email: "sarah@example.com", gradYear: 2025, gender: "Female",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "yes", sailingEval2: "yes", notes1: "Outstanding sailor, very dedicated" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Amazing personality, everyone loves her" },
    stage2InterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Perfect score across the board" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_women_2",
    firstName: "Emily", lastName: "Martinez", email: "emily@example.com", gradYear: 2024, gender: "Female",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "maybe", sailingEval2: "maybe", notes1: "Learning quickly, needs more experience" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Great attitude and work ethic" },
    stage2InterviewSummary: { eval1: "maybe", eval2: "yes", notes1: "Improved significantly, shows promise" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_women_3",
    firstName: "Jessica", lastName: "Garcia", email: "jessica@example.com", gradYear: 2026, gender: "Female",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "no", sailingEval2: "no", notes1: "Not a strong fit for sailing" },
    stage1PersonalityInterviewSummary: { eval1: "maybe", eval2: "maybe", notes1: "Neutral fit culturally" },
    stage2InterviewSummary: { eval1: "no", eval2: "no", notes1: "Did not perform well" },
    stage2: { interviewComplete: true },
  },
  {
    id: "test_women_4",
    firstName: "Amanda", lastName: "Lopez", email: "amanda@example.com", gradYear: 2025, gender: "Female",
    stage: 3,
    stage1SailingInterviewSummary: { sailingEval1: "yes", sailingEval2: "yes", notes1: "Impressive sailor, very talented" },
    stage1PersonalityInterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Great team member, positive energy" },
    stage2InterviewSummary: { eval1: "yes", eval2: "yes", notes1: "Consistently strong performance" },
    stage2: { interviewComplete: true },
  },
];

const TEST_VOTES = [
  {
    id: "test_voter_1",
    menSelections: ["test_men_1", "test_men_2", "test_men_4"],
    womenSelections: ["test_women_1", "test_women_4"],
  },
  {
    id: "test_voter_2",
    menSelections: ["test_men_1", "test_men_3"],
    womenSelections: ["test_women_1", "test_women_2", "test_women_4"],
  },
  {
    id: "test_voter_3",
    menSelections: ["test_men_2", "test_men_4"],
    womenSelections: ["test_women_1", "test_women_4"],
  },
];

const PROSPIE_IDS = TEST_PROSPIES.map((p) => p.id);
const VOTE_IDS = TEST_VOTES.map((v) => v.id);

type Status = "idle" | "loading" | "done" | "error";

export default function DevSeedPage() {
  const [seedStatus, setSeedStatus] = useState<Status>("idle");
  const [clearStatus, setClearStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  async function seedData() {
    setSeedStatus("loading");
    setLog([]);
    try {
      for (const p of TEST_PROSPIES) {
        const { id, ...data } = p;
        await setDoc(doc(db, "prospies", id), data);
        addLog(`✓ Created prospie: ${data.firstName} ${data.lastName}`);
      }
      for (const v of TEST_VOTES) {
        const { id, ...data } = v;
        await setDoc(doc(db, "stage3Votes", id), data);
        addLog(`✓ Created vote doc: ${id}`);
      }
      addLog("🎉 All test data created!");
      setSeedStatus("done");
    } catch (e: any) {
      addLog(`✗ Error: ${e.message}`);
      setSeedStatus("error");
    }
  }

  async function clearData() {
    setClearStatus("loading");
    setLog([]);
    try {
      for (const id of PROSPIE_IDS) {
        await deleteDoc(doc(db, "prospies", id));
        addLog(`✓ Deleted prospie: ${id}`);
      }
      for (const id of VOTE_IDS) {
        await deleteDoc(doc(db, "stage3Votes", id));
        addLog(`✓ Deleted vote: ${id}`);
      }
      addLog("🗑️ All test data cleared.");
      setClearStatus("done");
    } catch (e: any) {
      addLog(`✗ Error: ${e.message}`);
      setClearStatus("error");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-2xl font-bold text-amber-800">Dev: Seed Test Data</h1>
        <p className="mt-1 text-sm text-amber-700">
          Creates 8 test prospies and 3 vote docs. Remove this page before deploying.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-slate-900">What will be created</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>👨 4 men prospies (test_men_1 → test_men_4)</li>
            <li>👩 4 women prospies (test_women_1 → test_women_4)</li>
            <li>🗳️ 3 vote documents (test_voter_1 → test_voter_3)</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            onClick={seedData}
            disabled={seedStatus === "loading"}
            className="rounded-lg bg-purple-600 hover:bg-purple-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {seedStatus === "loading" ? "Creating…" : "Seed test data"}
          </button>

          <button
            onClick={clearData}
            disabled={clearStatus === "loading"}
            className="rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 px-5 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
          >
            {clearStatus === "loading" ? "Clearing…" : "Clear test data"}
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-900 p-4 font-mono text-sm text-green-400 space-y-1">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
