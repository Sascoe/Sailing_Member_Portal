import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../app/firebase";
import { useUserRole } from "../auth/useUserRole";

type PacketCategory = "auto_on" | "probably" | "maybe" | "probably_not";
type YesMaybeNo = "yes" | "maybe" | "no";

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
    notes1?: string;
  };
  stage1PersonalityInterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
    notes1?: string;
  };
  stage2InterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
    notes1?: string;
  };
  stage2?: {
    interviewComplete?: boolean;
  };
  stage3?: {
    packetCategory?: PacketCategory | null;
    blurb?: string;
  };
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
  packetCategory: PacketCategory | null;
};

const CATEGORY_LABELS: Record<PacketCategory, string> = {
  auto_on: "Auto-ons",
  probably: "Probablys",
  maybe: "Maybes",
  probably_not: "Probably nots",
};

const CATEGORY_COLORS: Record<PacketCategory, string> = {
  auto_on: "bg-emerald-50 border-emerald-200",
  probably: "bg-blue-50 border-blue-200",
  maybe: "bg-amber-50 border-amber-200",
  probably_not: "bg-red-50 border-red-200",
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
  if (["woman", "female", "girl", "women"].includes(v)) return "women";
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
    packetCategory: data.stage3?.packetCategory ?? null,
  };
}

function ProspieCard({
  row,
  onCategoryChange,
}: {
  row: ProspieRow;
  onCategoryChange: (uid: string, category: PacketCategory | null) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="w-full md:w-32 shrink-0">
          {row.photoUrl ? (
            <img
              src={row.photoUrl}
              alt={row.name}
              className="h-40 w-full rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
              No photo
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col justify-between md:flex-row md:items-start md:justify-between gap-2">
            <div>
              <h4 className="font-semibold text-slate-900">{row.name}</h4>
              <p className="text-xs text-slate-600">
                {row.gradYear && `Grad ${row.gradYear}`}
                {row.email && ` · ${row.email}`}
              </p>
            </div>

            <select
              value={row.packetCategory ?? ""}
              onChange={(e) =>
                onCategoryChange(row.id, (e.target.value as PacketCategory) || null)
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium"
            >
              <option value="">Uncategorized</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 md:grid-cols-3 text-xs">
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-700 mb-1">Stage 1 sailing</div>
              <div className="space-y-0.5">
                {row.sailingScores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-2">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-700 mb-1">Stage 1 personality</div>
              <div className="space-y-0.5">
                {row.personalityScores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-2">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-700 mb-1">Stage 2</div>
              <div className="space-y-0.5">
                {row.stage2Scores.map((item) => (
                  <div key={item.label} className="flex justify-between gap-2">
                    <span>{item.label}</span>
                    <span className="font-medium">{titleCaseVote(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-2">
            <div className="text-xs font-semibold text-slate-700 mb-1">Interview summary</div>
            <p className="text-xs text-slate-600 line-clamp-2">{row.interviewBlurb}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChairPacketBuildingPage() {
  const navigate = useNavigate();
  const { positions, loading: roleLoading } = useUserRole();
  const isChair = positions.includes("recruitment_chair");

  const [rows, setRows] = useState<ProspieRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "prospies"), (snap) => {
      const next = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as ProspieDoc }))
        .filter(({ data }) => data.stage2?.interviewComplete === true)
        .map(({ id, data }) => toRow(id, data));

      setRows(next);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const menRows = useMemo(() => rows.filter((r) => r.genderBucket === "men"), [rows]);
  const womenRows = useMemo(() => rows.filter((r) => r.genderBucket === "women"), [rows]);
  const otherRows = useMemo(() => rows.filter((r) => r.genderBucket === "other"), [rows]);

  const menUncategorized = menRows.filter((r) => !r.packetCategory).length;
  const womenUncategorized = womenRows.filter((r) => !r.packetCategory).length;

  async function updateCategory(uid: string, category: PacketCategory | null) {
    await updateDoc(doc(db, "prospies", uid), {
      "stage3.packetCategory": category,
    });
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

  function PacketBucket({ title, rows }: { title: string; rows: ProspieRow[] }) {
    return (
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {CATEGORY_ORDER.map((category) => {
          const group = rows.filter((r) => r.packetCategory === category);
          if (group.length === 0) return null;

          return (
            <div key={category} className={`rounded-lg border-2 ${CATEGORY_COLORS[category]} p-4`}>
              <div className="text-sm font-semibold text-slate-800 mb-3">
                {CATEGORY_LABELS[category]} ({group.length})
              </div>
              <div className="space-y-3">
                {group.map((row) => (
                  <ProspieCard
                    key={row.id}
                    row={row}
                    onCategoryChange={updateCategory}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Uncategorized */}
        {rows.filter((r) => !r.packetCategory).length > 0 && (
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 mb-3">
              Uncategorized ({rows.filter((r) => !r.packetCategory).length})
            </div>
            <div className="space-y-3">
              {rows
                .filter((r) => !r.packetCategory)
                .map((row) => (
                  <ProspieCard
                    key={row.id}
                    row={row}
                    onCategoryChange={updateCategory}
                  />
                ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (roleLoading || loading) {
    return <div className="p-6">Loading…</div>;
  }

  if (!isChair) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-slate-600">You don't have permission to build packets.</p>
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
            <h1 className="text-3xl font-bold text-purple-600">Build packets</h1>
            <p className="mt-2 text-slate-600">
              Organize prospies into interview strength categories before publishing for voting.
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

      {/* Men packet section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Men packet</h2>
            <p className="mt-1 text-sm text-slate-600">
              {menUncategorized} uncategorized
              {menUncategorized > 0 && (
                <>
                  {" "}
                  ·
                  <button
                    onClick={() => bulkAssignUncategorized("men", "maybe")}
                    className="ml-1 text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Move all to maybes
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
        {menRows.length > 0 ? (
          <PacketBucket title="" rows={menRows} />
        ) : (
          <p className="text-slate-500">No men prospies advanced to Stage 3 yet.</p>
        )}
      </div>

      {/* Women packet section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Women packet</h2>
            <p className="mt-1 text-sm text-slate-600">
              {womenUncategorized} uncategorized
              {womenUncategorized > 0 && (
                <>
                  {" "}
                  ·
                  <button
                    onClick={() => bulkAssignUncategorized("women", "maybe")}
                    className="ml-1 text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Move all to maybes
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
        {womenRows.length > 0 ? (
          <PacketBucket title="" rows={womenRows} />
        ) : (
          <p className="text-slate-500">No women prospies advanced to Stage 3 yet.</p>
        )}
      </div>

      {/* Other genders warning */}
      {otherRows.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          There are {otherRows.length} prospies whose gender field did not map to men/women.
          Please update their gender in prospie records before publishing packets.
        </div>
      )}
    </div>
  );
}
