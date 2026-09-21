import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../app/firebase";

type MemberOption = { uid: string; firstName: string; lastName: string };

export default function MemberPicker({
  value,
  onChange,
  excludeUid,
  label = "Second interviewer (optional)",
}: {
  value: string | null;
  onChange: (uid: string | null) => void;
  excludeUid?: string | null;
  label?: string;
}) {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "members"), (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          uid: d.id,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
        };
      });
      setMembers(rows);
    });
    return () => unsub();
  }, []);

  const selected = members.find((m) => m.uid === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.uid !== excludeUid)
      .filter((m) => !q || `${m.firstName} ${m.lastName}`.toLowerCase().includes(q))
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      );
  }, [members, query, excludeUid]);

  return (
    <div className="relative">
      <div className="text-sm font-medium text-slate-700">{label}</div>

      {selected ? (
        <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-300 bg-white p-2">
          <span className="text-slate-900">
            {selected.firstName} {selected.lastName}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-medium text-purple-600 hover:text-purple-700"
          >
            Clear
          </button>
        </div>
      ) : (
        <div>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search members by name…"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400"
          />

          {open && filtered.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {filtered.map((m) => (
                <button
                  key={m.uid}
                  type="button"
                  onMouseDown={() => {
                    onChange(m.uid);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-purple-50"
                >
                  {m.firstName} {m.lastName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
