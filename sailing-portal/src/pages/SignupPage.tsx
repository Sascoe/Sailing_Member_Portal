import { type FormEvent, useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../app/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../app/firebase";
import type {User} from "firebase/auth";

function isNorthwesternU(email: string) {
  return email.toLowerCase().endsWith("@u.northwestern.edu");
}

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gradYear, setGradYear] = useState<number | "">("");
  const [gender, setGender] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  async function onSubmit(e: FormEvent) {
  e.preventDefault();
  setError(null);

  if (!isNorthwesternU(email)) {
    setError("Please use your @u.northwestern.edu email address.");
    return;
  }

  if (!firstName.trim() || !lastName.trim()) {
    setError("Please enter your first and last name.");
    return;
  }

  if (gradYear === "" || gradYear < 2026 || gradYear > 2035) {
    setError("Please enter a valid graduating year.");
    return;
  }

  if (!gender) {
    setError("Please select a gender.");
    return;
  }

  if (!photoFile) {
    setError("Please upload a profile photo.");
    return;
  }

  setLoading(true);

  let createdUser: User | null = null;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    createdUser = cred.user;

    const uid = createdUser.uid;

    // Upload photo
    const photoRef = ref(storage, `prospies/${uid}/profile.jpg`);
    await uploadBytes(photoRef, photoFile, { contentType: photoFile.type });
    const photoUrl = await getDownloadURL(photoRef);

    // Create users/{uid}
    await setDoc(doc(db, "users", uid), {
      role: "prospie",
      email: createdUser.email,
      createdAt: serverTimestamp(),
    });

    // Create prospies/{uid}
    await setDoc(doc(db, "prospies", uid), {
      uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      email: createdUser.email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gradYear,
      gender,
      photoUrl,

      stage: 1,
      status: "active",
      stage1Complete: false,
      profileComplete: true,
    });

    // Optional: navigate("/prospie");
  } catch (err: any) {
    console.error(err);

    // Roll back the Auth user if we created one
    if (createdUser) {
      try {
        await createdUser.delete();
        console.warn("Rolled back auth user due to signup failure.");
      } catch (rollbackErr) {
        console.warn("Failed to rollback auth user:", rollbackErr);
        // Note: if delete fails, user may need to be removed from Auth console manually
      }
    }

    setError(err?.message ?? "Signup failed.");
  } finally {
    setLoading(false);
  }
}


return (
  <div className="min-h-screen flex items-center justify-center p-6 bg-white">
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-slate-900 shadow-lg border border-slate-200"
    >
      <h1 className="text-2xl font-bold text-center text-purple-600">Create account</h1>

      {/* First + Last name */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="text-sm font-medium text-slate-700">First name</div>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            required
          />
        </label>

        <label className="block">
          <div className="text-sm font-medium text-slate-700">Last name</div>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            required
          />
        </label>
      </div>

      {/* Grad year */}
      <label className="block">
        <div className="text-sm font-medium text-slate-700">Graduating year</div>
        <input
          type="number"
          value={gradYear}
          onChange={(e) =>
            setGradYear(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="e.g., 2028"
          required
        />
      </label>

      {/* Gender */}
      <label className="block">
        <div className="text-sm font-medium text-slate-700">Gender</div>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          required
        >
          <option value="" disabled>
            Select…
          </option>
          <option value="woman">Woman</option>
          <option value="man">Man</option>
          <option value="nonbinary">Non-binary</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
          <option value="other">Other</option>
        </select>
      </label>

      {/* Photo upload */}
      <label className="block">
        <div className="text-sm font-medium text-slate-700">Profile photo</div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-slate-900 hover:file:bg-slate-200"
          required
        />
        <div className="mt-1 text-xs text-slate-500">
          Upload a clear headshot (JPG/PNG).
        </div>
      </label>

      {/* Email */}
      <label className="block">
        <div className="text-sm font-medium text-slate-700">Email</div>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          type="email"
          required
        />
      </label>

      {/* Password */}
      <label className="block">
        <div className="text-sm font-medium text-slate-700">Password</div>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          type="password"
          required
        />
      </label>

      {error && (
        <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        className="w-full rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        disabled={loading}
      >
        {loading ? "Creating..." : "Sign up"}
      </button>
    </form>
  </div>
);
}
