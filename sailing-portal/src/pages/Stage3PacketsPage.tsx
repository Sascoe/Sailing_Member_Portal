import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../app/firebase";
import { useUserRole } from "../auth/useUserRole";

type YesMaybeNo = "yes" | "maybe" | "no";
type PacketCategory = "auto_on" | "probably" | "maybe" | "probably_not";
type FinalDecision = "offer" | "drop" | "undecided";

type RecruitmentSettings = {
  recruitment?: {
    isOpen?: boolean;
    activeStage?: string;
    menPacketsPublished?: boolean;
    womenPacketsPublished?: boolean;
    menVotesAllowed?: number;
    womenVotesAllowed?: number;
  };
};

type ProspieDoc = {
  firstName?: string;
  lastName?: string;
  email?: string;
  gradYear?: number;
  gender?: string;
  photoUrl?: string;
  name?: string;
  stage?: number;
  stage1Decision?: string;
  stage1FinalDecision?: string;
  stage1SailingInterviewSummary?: {
    completed?: boolean;
    sailingEval1?: YesMaybeNo;
    sailingEval2?: YesMaybeNo;
    notes1?: string;
    notes2?: string;
    hasSailingExperience?: boolean;
    availability?: string[];
  };
  stage1PersonalityInterviewSummary?: {
    completed?: boolean;
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
    notes1?: string;
    notes2?: string;
  };
  stage2InterviewSummary?: {
    completed?: boolean;
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
    notes1?: string;
    notes2?: string;
  };
  stage2?: {
    onTheWaterComplete?: boolean;
    interviewComplete?: boolean;
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

type ProspieRow = {
  id: string;
  name: string;
  email?: string;
  gradYear?: number;
  genderLabel: string;
  genderBucket: "men" | "women" | "other";
  photoUrl?: string;
  sailingScores: { label: string; value: YesMaybeNo | "—" }[];
  personalityScores: { label: string; value: YesMaybeNo | "—" }[];
  stage2Scores: { label: string; value: YesMaybeNo | "—" }[];
  interviewBlurb: string;
  packetNotes: string;
  packetCategory: PacketCategory | null;
  finalDecision: FinalDecision;
};

const CATEGORY_LABELS: Record<PacketCategory, string> = {
  auto_on: "Auto-ons",
  probably: "Probablys",
  maybe: "Maybes",
  probably_not: "Probably nots",
};

const CATEGORY_ORDER: PacketCategory[] = [
  "auto_on",
  "probably",
  "maybe",
  "probably_not",
];

function normalizeGenderBucket(raw?: string): "men" | "women" | "other" {
  const v = (raw ?? "").trim().toLowerCase();
  if (["man", "male", "boy", "men", "guy", "guys"].includes(v)) return "men";
  if (["woman", "female", "girl", "women", "girl packet", "boy packet"].includes(v)) return "women";
  return "other";
}

function scoreLabel(v?: YesMaybeNo): YesMaybeNo | "—" {
  return v ?? "—";
}

function titleCaseVote(v: YesMaybeNo | "—") {
  if (v === "—") return v;
  return v[0].toUpperCase() + v.slice(1);
}

function coalesceBlurb(data: ProspieDoc): string {
  return (
    data.stage3?.blurb?.trim() ||
    data.stage2InterviewSummary?.notes1?.trim() ||
    data.stage1PersonalityInterviewSummary?.notes1?.trim() ||
    data.stage1SailingInterviewSummary?.notes1?.trim() ||
    data.stage2InterviewSummary?.notes2?.trim() ||
    data.stage1PersonalityInterviewSummary?.notes2?.trim() ||
    data.stage1SailingInterviewSummary?.notes2?.trim() ||
    "No blurb added yet."
  );
}

function toRow(id: string, data: ProspieDoc): ProspieRow {
  const first = data.firstName ?? "";
  const last = data.lastName ?? "";
  const name = `${first} ${last}`.trim() || data.name || data.email || id;
  const genderBucket = normalizeGenderBucket(data.gender);

  return {
    id,
    name,
    email: data.email,
    gradYear: data.gradYear,
    genderLabel: data.gender ?? "Unspecified",
    genderBucket,
    photoUrl: data.photoUrl,
    sailingScores: [
      { label: "Sailing 1", value: scoreLabel(data.stage1SailingInterviewSummary?.sailingEval1) },
      { label: "Sailing 2", value: scoreLabel(data.stage1SailingInterviewSummary?.sailingEval2) },
    ],
    personalityScores: [
      { label: "Personality 1", value: scoreLabel(data.stage1PersonalityInterviewSummary?.eval1) },
      { label: "Personality 2", value: scoreLabel(data.stage1PersonalityInterviewSummary?.eval2) },
    ],
    stage2Scores: [
      { label: "On the water", value: scoreLabel(data.stage2InterviewSummary?.eval1) },
      { label: "Stage 2 interview", value: scoreLabel(data.stage2InterviewSummary?.eval2) },
    ],
    interviewBlurb: coalesceBlurb(data),
    packetNotes: data.stage3?.packetNotes ?? "",
    packetCategory: data.stage3?.packetCategory ?? null,
    finalDecision: data.stage3?.finalDecision ?? "undecided",
  };
}

function PacketCard({
  row,
  isChair,
  voteCount,
  selected,
  onToggleVote,
  onCategoryChange,
  onBlurbSave,
  onPacketNotesSave,
  onFinalDecisionChange,
}: {
  row: ProspieRow;
  isChair: boolean;
  voteCount: number;
  selected: boolean;
  onToggleVote: (uid: string, checked: boolean) => void;
  onCategoryChange: (uid: string, category: PacketCategory) => void;
  onBlurbSave: (uid: string, blurb: string) => void;
  onPacketNotesSave: (uid: string, notes: string) => void;
  onFinalDecisionChange: (uid: string, decision: FinalDecision) => void;
}) {
  const [draftBlurb, setDraftBlurb] = useState(row.interviewBlurb);
  const [draftPacketNotes, setDraftPacketNotes] = useState(row.packetNotes);

  useEffect(() => setDraftBlurb(row.interviewBlurb), [row.interviewBlurb]);
  useEffect(() => setDraftPacketNotes(row.packetNotes), [row.packetNotes]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full md:w-44 shrink-0">
          {row.photoUrl ? (
            <img
              src={row.photoUrl}
              alt={row.name}
              className="h-52 w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-52 w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500">
              No photo
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">{row.name}</h3>
              <p className="text-sm text-slate-600">
                Grad year: {row.gradYear ?? "—"} · Gender: {row.genderLabel}
              </p>
              {row.email && <p className="text-sm text-slate-500">{row.email}</p>}
            </div>

            {isChair ? (
              <div className="flex flex-wrap gap-2">
                <select
                  value={row.packetCategory ?? ""}
                  onChange={(e) => onCategoryChange(row.id, e.target.value as PacketCategory)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Set packet category</option>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>

                <select
                  value={row.finalDecision}
                  onChange={(e) => onFinalDecisionChange(row.id, e.target.value as FinalDecision)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="undecided">Final: undecided</option>
                  <option value="offer">Final: offer</option>
                  <option value="drop">Final: drop</option>
                </select>
              </div>
            ) : row.packetCategory !== "auto_on" ? (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => onToggleVote(row.id, e.target.checked)}
                  className="h-4 w-4"
                />
                Vote for this prospie
              </label>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                Auto-on
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Stage 1 sailing</div>
              <div className="space-y-1 text-sm text-slate-700">
                {row.sailingScores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Stage 1 personality</div>
              <div className="space-y-1 text-sm text-slate-700">
                {row.personalityScores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Stage 2</div>
              <div className="space-y-1 text-sm text-slate-700">
                {row.stage2Scores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
                {isChair && (
                  <div className="mt-2 border-t border-slate-200 pt-2 text-sm font-medium text-slate-900">
                    Votes: {voteCount}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900">Packet blurb</div>
            {isChair ? (
              <>
                <textarea
                  rows={4}
                  value={draftBlurb}
                  onChange={(e) => setDraftBlurb(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900"
                />
                <button
                  onClick={() => onBlurbSave(row.id, draftBlurb)}
                  className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white"
                >
                  Save blurb
                </button>
              </>
            ) : (
              <p className="text-sm leading-6 text-slate-700">{row.interviewBlurb}</p>
            )}
          </div>

          {isChair && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">Chair packet notes</div>
              <textarea
                rows={3}
                value={draftPacketNotes}
                onChange={(e) => setDraftPacketNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900"
                placeholder="Optional chair-only notes for packet discussion"
              />
              <button
                onClick={() => onPacketNotesSave(row.id, draftPacketNotes)}
                className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white"
              >
                Save packet notes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PacketSection({
  title,
  rows,
  isChair,
  selections,
  voteCounts,
  onToggleVote,
  onCategoryChange,
  onBlurbSave,
  onPacketNotesSave,
  onFinalDecisionChange,
}: {
  title: string;
  rows: ProspieRow[];
  isChair: boolean;
  selections: string[];
  voteCounts: Record<string, number>;
  onToggleVote: (uid: string, checked: boolean) => void;
  onCategoryChange: (uid: string, category: PacketCategory) => void;
  onBlurbSave: (uid: string, blurb: string) => void;
  onPacketNotesSave: (uid: string, notes: string) => void;
  onFinalDecisionChange: (uid: string, decision: FinalDecision) => void;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
      {CATEGORY_ORDER.map((category) => {
        const group = rows.filter((r) => r.packetCategory === category);
        if (group.length === 0) return null;

        return (
          <div key={category} className="space-y-3">
            <div className="inline-block rounded-md bg-amber-100 px-3 py-1 text-lg font-semibold text-slate-900">
              {CATEGORY_LABELS[category]}
            </div>
            <div className="space-y-4">
              {group.map((row) => (
                <PacketCard
                  key={row.id}
                  row={row}
                  isChair={isChair}
                  voteCount={voteCounts[row.id] ?? 0}
                  selected={selections.includes(row.id)}
                  onToggleVote={onToggleVote}
                  onCategoryChange={onCategoryChange}
                  onBlurbSave={onBlurbSave}
                  onPacketNotesSave={onPacketNotesSave}
                  onFinalDecisionChange={onFinalDecisionChange}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default function Stage3PacketsPage() {
  const navigate = useNavigate();
  const { positions, loading: roleLoading } = useUserRole();
  const isChair = positions.includes("recruitment_chair");
  const myUid = auth.currentUser?.uid ?? null;

  const [settings, setSettings] = useState<RecruitmentSettings["recruitment"]>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [rows, setRows] = useState<ProspieRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [votes, setVotes] = useState<Record<string, VoteDoc>>({});
  const [savingVote, setSavingVote] = useState(false);

  const [myMenSelections, setMyMenSelections] = useState<string[]>([]);
  const [myWomenSelections, setMyWomenSelections] = useState<string[]>([]);

  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as RecruitmentSettings) ?? {};
      setSettings(data.recruitment ?? {});
      setLoadingSettings(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "prospies"), (snap) => {
      const next = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as ProspieDoc }))
        .filter(({ data }) => {
          return (
            data.stage1Decision === "advance" ||
            data.stage1FinalDecision === "advance" ||
            data.stage2?.interviewComplete === true ||
            (data.stage ?? 0) >= 3
          );
        })
        .map(({ id, data }) => toRow(id, data));

      setRows(next);
      setLoadingRows(false);
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
    if (!myUid) return;
    const mine = votes[myUid];
    setMyMenSelections(mine?.menSelections ?? []);
    setMyWomenSelections(mine?.womenSelections ?? []);
  }, [votes, myUid]);

  const menRows = useMemo(() => rows.filter((r) => r.genderBucket === "men"), [rows]);
  const womenRows = useMemo(() => rows.filter((r) => r.genderBucket === "women"), [rows]);
  const otherRows = useMemo(() => rows.filter((r) => r.genderBucket === "other"), [rows]);

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

  const menVotesAllowed = Math.max(0, settings.menVotesAllowed ?? 0);
  const womenVotesAllowed = Math.max(0, settings.womenVotesAllowed ?? 0);
  const menPublished = Boolean(settings.menPacketsPublished);
  const womenPublished = Boolean(settings.womenPacketsPublished);

  async function updateRecruitmentSettings(patch: Record<string, unknown>) {
    await updateDoc(doc(db, "settings", "global"), patch);
  }

  async function updatePacketCategory(uid: string, category: PacketCategory) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.packetCategory": category,
    });
  }

  async function updateBlurb(uid: string, blurb: string) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.blurb": blurb.trim(),
    });
  }

  async function updatePacketNotes(uid: string, notes: string) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.packetNotes": notes.trim(),
    });
  }

  async function updateFinalDecision(uid: string, decision: FinalDecision) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.finalDecision": decision,
      "stage3.finalDecisionUpdatedAt": serverTimestamp(),
      "stage3.finalDecisionUpdatedBy": myUid,
    });
  }

  function toggleSelection(
    current: string[],
    uid: string,
    checked: boolean,
    limit: number,
    setter: (next: string[]) => void
  ) {
    if (checked) {
      if (current.includes(uid)) return;
      if (current.length >= limit) {
        alert(`You can only vote for ${limit} prospie${limit === 1 ? "" : "s"} in this packet.`);
        return;
      }
      setter([...current, uid]);
      return;
    }

    setter(current.filter((id) => id !== uid));
  }

  async function submitVotes() {
    if (!myUid) return;
    setSavingVote(true);
    try {
      await setDoc(
        doc(db, "stage3Votes", myUid),
        {
          submittedBy: myUid,
          menSelections: myMenSelections,
          womenSelections: myWomenSelections,
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      alert("Votes submitted.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to submit votes.");
    } finally {
      setSavingVote(false);
    }
  }

  async function publishPackets(bucket: "men" | "women", nextValue: boolean) {
    if (bucket === "men") {
      await updateRecruitmentSettings({ "recruitment.menPacketsPublished": nextValue });
      return;
    }
    await updateRecruitmentSettings({ "recruitment.womenPacketsPublished": nextValue });
  }

  async function setVoteLimit(bucket: "men" | "women", value: number) {
    const safe = Math.max(0, Math.floor(value));
    if (bucket === "men") {
      await updateRecruitmentSettings({ "recruitment.menVotesAllowed": safe });
      return;
    }
    await updateRecruitmentSettings({ "recruitment.womenVotesAllowed": safe });
  }

  async function bulkAssignUncategorized(bucket: "men" | "women", category: PacketCategory) {
    const targetRows = (bucket === "men" ? menRows : womenRows).filter((r) => !r.packetCategory);
    if (targetRows.length === 0) {
      alert("No uncategorized prospies in this packet.");
      return;
    }

    const batch = writeBatch(db);
    targetRows.forEach((row) => {
      batch.update(doc(db, "prospies", row.id), {
        "stage3.packetCategory": category,
      });
    });
    await batch.commit();
  }

  if (roleLoading || loadingSettings || loadingRows) {
    return <div className="p-6">Loading…</div>;
  }

  if (settings.activeStage !== "stage3") {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-center text-purple-600">Stage 3 packets</h1>
          <p className="mt-2 text-slate-600">This page is only active when recruitment is in Stage 3.</p>
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-center text-purple-600">Stage 3 packets</h1>
            <p className="mt-2 text-slate-600">
              Chairs can build and publish packets. Members can vote once packets are published.
            </p>
          </div>

          <button
            onClick={() => navigate("/member/recruitment")}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Back to recruitment
          </button>
        </div>
      </div>

      {isChair && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Men packet controls</h2>
            <label className="block">
              <div className="mb-1 text-sm font-medium text-slate-700">Votes allowed</div>
              <input
                type="number"
                min={0}
                value={menVotesAllowed}
                onChange={(e) => setVoteLimit("men", Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => publishPackets("men", !menPublished)}
                className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white"
              >
                {menPublished ? "Unpublish men packet" : "Publish men packet"}
              </button>
              <button
                onClick={() => bulkAssignUncategorized("men", "maybe")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
              >
                Put uncategorized into maybes
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Women packet controls</h2>
            <label className="block">
              <div className="mb-1 text-sm font-medium text-slate-700">Votes allowed</div>
              <input
                type="number"
                min={0}
                value={womenVotesAllowed}
                onChange={(e) => setVoteLimit("women", Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => publishPackets("women", !womenPublished)}
                className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white"
              >
                {womenPublished ? "Unpublish women packet" : "Publish women packet"}
              </button>
              <button
                onClick={() => bulkAssignUncategorized("women", "maybe")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
              >
                Put uncategorized into maybes
              </button>
            </div>
          </div>
        </div>
      )}

      {!isChair && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-semibold text-slate-900">Men packet voting</div>
            <p className="mt-2 text-sm text-slate-600">
              Votes remaining: {Math.max(0, menVotesAllowed - myMenSelections.length)} / {menVotesAllowed}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-semibold text-slate-900">Women packet voting</div>
            <p className="mt-2 text-sm text-slate-600">
              Votes remaining: {Math.max(0, womenVotesAllowed - myWomenSelections.length)} / {womenVotesAllowed}
            </p>
          </div>
        </div>
      )}

      {menPublished || isChair ? (
        <PacketSection
          title="Men packet"
          rows={menRows}
          isChair={isChair}
          selections={myMenSelections}
          voteCounts={voteCounts}
          onToggleVote={(uid, checked) =>
            toggleSelection(myMenSelections, uid, checked, menVotesAllowed, setMyMenSelections)
          }
          onCategoryChange={updatePacketCategory}
          onBlurbSave={updateBlurb}
          onPacketNotesSave={updatePacketNotes}
          onFinalDecisionChange={updateFinalDecision}
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          Please wait for the men packet to be published.
        </div>
      )}

      {womenPublished || isChair ? (
        <PacketSection
          title="Women packet"
          rows={womenRows}
          isChair={isChair}
          selections={myWomenSelections}
          voteCounts={voteCounts}
          onToggleVote={(uid, checked) =>
            toggleSelection(myWomenSelections, uid, checked, womenVotesAllowed, setMyWomenSelections)
          }
          onCategoryChange={updatePacketCategory}
          onBlurbSave={updateBlurb}
          onPacketNotesSave={updatePacketNotes}
          onFinalDecisionChange={updateFinalDecision}
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          Please wait for the women packet to be published.
        </div>
      )}

      {isChair && otherRows.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          There are {otherRows.length} prospies whose gender field did not map cleanly into the men/women packet split.
          They are being kept out of the published voting packets until you normalize their gender field.
        </div>
      )}

      {!isChair && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={submitVotes}
            disabled={savingVote}
            className="rounded-xl bg-purple-600 hover:bg-purple-700 px-5 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-50"
          >
            {savingVote ? "Submitting…" : "Submit votes"}
          </button>
        </div>
      )}
    </div>
  );
}